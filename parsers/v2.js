const axios = require('axios');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const Site = require('./modal/Site')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const dbConnect = async (uri) => {
    try {
        await mongoose.connect(uri)
        console.log("CONNECTED TO DATABASE")
    } catch (e) {
        console.log(e)
    }
}

let startUrl = "https://github.com/"
let level = 0
const webCrawler = async (url) => {

    //      DOMAIN RESTRICTOR
    let baseDomain = new URL(url).hostname


    console.log("START CRAWLING")
    let urlQueue = [{ url, level }]
    let visitedUrl = new Set()
    while (urlQueue.length > 0) {
        try {
            let currentItem = urlQueue.shift()
            let currentLevel = currentItem.level
            let currentUrl = currentItem.url
            console.log(`URL: ${currentUrl} LEVEL: ${level}`)
            if (visitedUrl.has(currentUrl)) continue
            visitedUrl.add(currentUrl)
            let response = await axios.get(currentUrl)
            let $ = cheerio.load(response.data)
            let title = $('title').text()
            let site = await Site.create({
                title: title.trim().split(/\s+/).slice(0,2).join(' '),
                level: currentLevel,
                url: currentUrl
            })
            console.log(`ADDED TO DB: ${site}`)
            $("a").each((i, e) => {
                if ($(e).attr('href')[0] !== '#') {
                    try {

                        let scrapedObj = new URL($(e).attr('href'), currentUrl)
                        if(scrapedObj.hostname === baseDomain){
                            let scrapedUrl = scrapedObj.href
                            if (!visitedUrl.has(scrapedUrl)) {
                            urlQueue.push({ url: scrapedUrl, level: currentLevel + 1 })
                        }
                        }
                    } catch (e) {
                        console.log(e)
                    }
                }
            })
        } catch (e) {
            console.log(e)
        }
        await sleep(3000)

    }
}

(async () => {
    await dbConnect(process.env.DB_URL)
    await webCrawler(startUrl)
})()