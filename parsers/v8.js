const axios = require('axios');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const Site = require('../modal/Site');
const Queue = require('../modal/Queue');
const Domain = require('../modal/Domain'); 

const CONCURRENT_DOMAINS = porcess.env.CONCURRENT_DOMAINS

const dbConnect = async (uri) => {
    try {
        await mongoose.connect(uri);
        console.log("Connected to MongoDB");
    } catch (e) {
        console.log(e);
    }
}

const crawlOnePage = async (domain) => {
    const hostname = domain.hostname; 

    try {
        const currentItem = await Queue.findOneAndUpdate(
            { visited: false, hostname: hostname }, 
            { visited: true },
            { sort: { _id: 1 } }
        );

        if (!currentItem) {
            console.log(`[${hostname}] No more links. Marking domain complete.`);
            await Domain.updateOne({ hostname: hostname }, { status: "complete" });
            return;
        }

        const currentUrl = currentItem.url;
        const currentLevel = currentItem.level;
        
        const response = await axios.get(currentUrl, { 
            timeout: 5000,
            validateStatus: (status) => status < 500 
        });

        // CHECK FOR BROKEN SITES
        if (response.status >= 400) {
            await Domain.updateOne({ hostname: hostname }, { lastCrawledAt: new Date() });
            return; 
        }

        // THE SHIELD: Only parse HTML! Skip PDFs, Images, XML, JSON, etc.
        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('text/html')) {
            console.log(`[${hostname}] Skipped non-HTML file: ${contentType}`);
            await Domain.updateOne({ hostname: hostname }, { lastCrawledAt: new Date() });
            return;
        }

        const $ = cheerio.load(response.data);

        const title = $('title').text().replace(/\s+/g, ' ').trim() || "No Title";
        const description = $('meta[name="description"]').attr('content') || "";
        const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim() || "";

        let faviconUrl = "";
        const iconHref = $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').first().attr('href');

        try {
            if (iconHref) {
                faviconUrl = new URL(iconHref, currentUrl).href;
            } else {
                faviconUrl = new URL('/favicon.ico', currentUrl).href;
            }
        } catch (err) {
            faviconUrl = ""; 
        }

        $('script, style, noscript, nav, footer').remove();
        const content = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 2000);

        // --- UPGRADE 1: Use upsert instead of create ---
        // This safely updates the page if it already exists, or creates it if it's new.
        await Site.updateOne(
            { url: currentUrl },
            { 
                $set: { 
                    title: title, 
                    description: description, 
                    h1: h1, 
                    content: content, 
                    level: currentLevel, 
                    favicon: faviconUrl 
                },
                // $setOnInsert: { backlinks: 0 } // Initialize backlinks to 0 if brand new
                $setOnInsert: { internalBacklinks: 0, externalBacklinks: 0 }
            },
            { upsert: true }
        );
        
        console.log(`[${hostname}] Crawled: ${title.substring(0, 40)}...`);

        const newLinks = new Set(); 
        const externalDomains = new Set();
        const externalLinks = new Map(); 

        $("a").each((i, e) => {
            const href = $(e).attr('href');
            if (href && !href.startsWith('#')) {
                try {
                    const scrapedObj = new URL(href, currentUrl);
                    
                    if (scrapedObj.hostname === hostname) {
                        newLinks.add(scrapedObj.href); 
                    } 
                    else {
                        externalDomains.add(scrapedObj.hostname);
                        externalLinks.set(scrapedObj.href, scrapedObj.hostname);
                    }
                } catch (e) {}
            }
        });

        if (newLinks.size > 0) {
            const operations = Array.from(newLinks).map(link => ({
                updateOne: {
                    filter: { url: link },
                    update: { $setOnInsert: { url: link, hostname: hostname, level: currentLevel + 1, visited: false } },
                    upsert: true
                }
            }));
            await Queue.bulkWrite(operations);
        }

        if (externalDomains.size > 0) {
            const domainOps = Array.from(externalDomains).map(extHost => ({
                updateOne: {
                    filter: { hostname: extHost },
                    update: { $setOnInsert: { hostname: extHost, status: "pending" } },
                    upsert: true
                }
            }));
            await Domain.bulkWrite(domainOps);
        }

        if (externalLinks.size > 0) {
            const extLinkOps = Array.from(externalLinks.entries()).map(([extUrl, extHost]) => ({
                updateOne: {
                    filter: { url: extUrl },
                    update: { $setOnInsert: { url: extUrl, hostname: extHost, level: 0, visited: false } },
                    upsert: true
                }
            }));
            await Queue.bulkWrite(extLinkOps);
        }

        // --- UPGRADE 2: The Authority Engine (Link Juice) ---
        // --- UPGRADE 2: The Split Authority Engine ---
        
        // 1. Internal Link Juice (Worth 1 point)
        if (newLinks.size > 0) {
            const intBacklinkOps = Array.from(newLinks).map(link => ({
                updateOne: {
                    filter: { url: link },
                    update: { $inc: { internalBacklinks: 1 } }, 
                    upsert: true 
                }
            }));
            Site.bulkWrite(intBacklinkOps).catch(() => {}); 
        }

        // 2. External Link Juice (Worth 10 points)
        if (externalLinks.size > 0) {
            const extBacklinkOps = Array.from(externalLinks.keys()).map(link => ({
                updateOne: {
                    filter: { url: link },
                    update: { $inc: { externalBacklinks: 1 } }, 
                    upsert: true 
                }
            }));
            Site.bulkWrite(extBacklinkOps).catch(() => {}); 
        }

        await Domain.updateOne({ hostname: hostname }, { lastCrawledAt: new Date() });

    } catch (e) {
        await Domain.updateOne({ hostname: hostname }, { lastCrawledAt: new Date() }).catch(()=>{});
    }
};

const startManager = async () => {
    console.log(`Starting Cluster Manager (Concurrency: ${CONCURRENT_DOMAINS})`);

    while (true) {
        const activeDomains = await Domain.find({ status: { $ne: "complete" } })
            .sort({ lastCrawledAt: 1 }) 
            .limit(CONCURRENT_DOMAINS)
            .lean(); // THE DIET: Returns raw JS objects to save memory!

        if (activeDomains.length === 0) {
            console.log("No active domains found. Waiting for seeds...");
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        await Promise.all(activeDomains.map(domain => crawlOnePage(domain)));
        await new Promise(r => setTimeout(r, 1000));
    }
};

(async () => {
    // ⚠️ Don't forget to change this password before deploying!
    await dbConnect(process.env.DB_URL);
    
    await Domain.updateOne(
        { hostname: "github.com" }, 
        { $setOnInsert: { hostname: "github.com", status: "pending", lastCrawledAt: new Date(0) } },
        { upsert: true }
    );
    
    await Queue.updateOne(
        { url: "https://github.com/" }, 
        { $setOnInsert: { url: "https://github.com/", hostname: "github.com", level: 0, visited: false } }, 
        { upsert: true }
    );

    startManager();
})();