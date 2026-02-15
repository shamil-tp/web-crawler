require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const redis = require('redis'); // ADDED: Redis
const Site = require('../modal/Site');
const Domain = require('../modal/Domain'); 
// REMOVED: Queue model (MongoDB queue is now obsolete)

const CONCURRENT_DOMAINS = porcess.env.CONCURRENT_DOMAINS;

// --- INITIALIZE REDIS CLIENT ---
const redisClient = redis.createClient({
    url: process.env.REDIS_URI
});
redisClient.on('error', (err) => console.log('Redis Crawler Error', err));

const dbConnect = async (uri) => {
    try {
        await mongoose.connect(uri);
        console.log("Connected to MongoDB (Storage & Link Juice)");
    } catch (e) {
        console.log("Database connection error:", e.message);
    }
}

const crawlOnePage = async (domain) => {
    const hostname = domain.hostname; 
    
    // REDIS KEYS: Each domain gets its own Queue List and Seen Set
    const queueKey = `queue:${hostname}`;
    const seenKey = `seen:${hostname}`;

    try {
        // 1. POP FROM REDIS QUEUE (Lightning fast memory access)
        const currentItemStr = await redisClient.lPop(queueKey);

        if (!currentItemStr) {
            console.log(`[${hostname}] Queue empty. Marking domain complete.`);
            await Domain.updateOne({ hostname: hostname }, { status: "complete" });
            return;
        }

        const currentItem = JSON.parse(currentItemStr);
        const currentUrl = currentItem.url;
        const currentLevel = currentItem.level;
        
        // 2. THE ARMOR: 5MB File Limit
        const response = await axios.get(currentUrl, { 
            timeout: 5000,
            validateStatus: (status) => status < 500,
            maxContentLength: 5 * 1024 * 1024, 
            maxBodyLength: 5 * 1024 * 1024 
        });

        // CHECK FOR BROKEN SITES
        if (response.status >= 400) {
            await Domain.updateOne({ hostname: hostname }, { lastCrawledAt: new Date() });
            return; 
        }

        // 3. THE SHIELD: Only parse HTML
        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('text/html')) {
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

        // 4. SAVE TO MONGODB (Storage of the actual site data)
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
                    const cleanUrl = scrapedObj.href.split('#')[0].replace(/\/$/, "");
                    if (scrapedObj.hostname === hostname) {
                        // newLinks.add(scrapedObj.href); 
                        newLinks.add(cleanUrl);
                    } else {
                        externalDomains.add(scrapedObj.hostname);
                        externalLinks.set(scrapedObj.href, scrapedObj.hostname);
                    }
                } catch (e) {}
            }
        });

        // 5. INTERNAL QUEUE (Pushing to Redis)
        if (newLinks.size > 0) {
            await Promise.all(Array.from(newLinks).map(async (link) => {
                // sAdd acts as a Bloom Filter. It returns 1 if new, 0 if duplicate.
                const isNew = await redisClient.sAdd(seenKey, link); 
                if (isNew) {
                    await redisClient.rPush(queueKey, JSON.stringify({ url: link, level: currentLevel + 1 }));
                }
            }));
        }

        // 6. EXTERNAL QUEUE (Waking up new Domains in Redis)
        if (externalLinks.size > 0) {
            await Promise.all(Array.from(externalLinks.entries()).map(async ([extUrl, extHost]) => {
                const isNew = await redisClient.sAdd(`seen:${extHost}`, extUrl);
                if (isNew) {
                    await redisClient.rPush(`queue:${extHost}`, JSON.stringify({ url: extUrl, level: 0 }));
                }
            }));
        }

        // 7. EXTERNAL DOMAINS MONGODB REGISTRATION 
        if (externalDomains.size > 0) {
            const domainOps = Array.from(externalDomains).map(extHost => ({
                updateOne: {
                    filter: { hostname: extHost },
                    update: { $set: { status: "pending" }, $setOnInsert: { hostname: extHost } },
                    upsert: true
                }
            }));
            await Domain.bulkWrite(domainOps).catch(()=>{});
        }

        // 8. THE AUTHORITY ENGINE (Link Juice goes to MongoDB)
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

// --- BOOT SEQUENCE ---
const bootSystem = async () => {
    // 1. Connect to Redis & Mongo
    await redisClient.connect();
    console.log("Connected to Redis (Queue & Deduplication)");
    
    await dbConnect(process.env.DB_URL);
    
    // 2. Initial MongoDB Seed
    await Domain.updateOne(
        { hostname: "github.com" }, 
        { $set: { status: "pending" }, $setOnInsert: { hostname: "github.com", lastCrawledAt: new Date(0) } },
        { upsert: true }
    );
    
    // 3. Initial Redis Seed
    const isNewSeed = await redisClient.sAdd("seen:github.com", "https://github.com/");
    if (isNewSeed) {
        await redisClient.rPush("queue:github.com", JSON.stringify({ url: "https://github.com/", level: 0 }));
    }

    // 4. Start Engines
    startManager();
};

bootSystem();