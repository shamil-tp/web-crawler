const axios = require('axios');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const Site = require('../modal/Site');
const Queue = require('../modal/Queue');
const Domain = require('../modal/Domain'); 

const CONCURRENT_DOMAINS = 20; 

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

        // THIS IS EMPTY DOMAIN CHECK!
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

        //      CHECK FOR BROKEN SITES
        if (response.status >= 400) {
            await Domain.updateOne({ hostname: hostname }, { lastCrawledAt: new Date() });
            return; 
        }

        // ... inside your crawler (crawlOnePage) ...

        const $ = cheerio.load(response.data);

        const title = $('title').text().replace(/\s+/g, ' ').trim() || "No Title";
        const description = $('meta[name="description"]').attr('content') || "";
        const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim() || "";

        // --- THE FAVICON EXTRACTOR ---
        let faviconUrl = "";
        // Look for the standard icon, shortcut icon, or Apple touch icon
        const iconHref = $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').first().attr('href');

        try {
            if (iconHref) {
                // If it's a relative link like "/icon.png", this resolves it to the full URL!
                faviconUrl = new URL(iconHref, currentUrl).href;
            } else {
                // Fallback: If no tag exists, guess the standard root location
                faviconUrl = new URL('/favicon.ico', currentUrl).href;
            }
        } catch (err) {
            faviconUrl = ""; // Silently fail if the URL is completely broken
        }

        $('script, style, noscript, nav, footer').remove();
        const content = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 2000);

        // Save ALL the data, including the new favicon
        await Site.create({ 
            title, 
            description, 
            h1, 
            content, 
            level: currentLevel, 
            url: currentUrl,
            favicon: faviconUrl // Save it here!
        });
        
        // Keep the log short so it doesn't flood your terminal
        console.log(`[${hostname}] Crawled: ${title.substring(0, 40)}...`);
        // console.log(`[${hostname}] Crawled: ${title}`);

        const newLinks = [];
        $("a").each((i, e) => {
            const href = $(e).attr('href');
            if (href && !href.startsWith('#')) {
                try {
                    const scrapedObj = new URL(href, currentUrl);
                    
                    //      CHECK TO PUSH ONLY URL REALATED TO DOMAIN
                    if (scrapedObj.hostname === hostname) {
                        newLinks.push(scrapedObj.href);
                    } 
                    else {
                        // 1. INSERT THE NEW FOUND DOMAIN TO DB
                         Domain.updateOne(
                            { hostname: scrapedObj.hostname },
                            { $setOnInsert: { hostname: scrapedObj.hostname, status: "pending" } },
                            { upsert: true }
                        ).catch(() => {}); 

                        // 2. THE FIX: ADD THIS URL AS THE SEED FOR THE NEW DOMAIN
                        Queue.updateOne(
                            { url: scrapedObj.href },
                            { $setOnInsert: { url: scrapedObj.href, hostname: scrapedObj.hostname, level: 0, visited: false } },
                            { upsert: true }
                        ).catch(() => {});
                    }
                } catch (e) {}
            }
        });

        if (newLinks.length > 0) {
            const operations = newLinks.map(link => ({
                updateOne: {
                    filter: { url: link },
                    update: { $setOnInsert: { url: link, hostname: hostname, level: currentLevel + 1, visited: false } },
                    upsert: true
                }
            }));
            await Queue.bulkWrite(operations);
        }

        await Domain.updateOne({ hostname: hostname }, { lastCrawledAt: new Date() });
        console.log()

    } catch (e) {
        await Domain.updateOne({ hostname: hostname }, { lastCrawledAt: new Date() }).catch(()=>{});
        console.log()
    }
};

const startManager = async () => {
    console.log(`Starting Cluster Manager (Concurrency: ${CONCURRENT_DOMAINS})`);

    while (true) {
        const activeDomains = await Domain.find({ status: { $ne: "complete" } })
            .sort({ lastCrawledAt: 1 }) 
            .limit(CONCURRENT_DOMAINS);

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