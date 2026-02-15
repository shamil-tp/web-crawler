const axios = require('axios');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const Site = require('./modal/Site')
const Queue = require('./modal/Queue')

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
    // let urlQueue = [{ url, level }]  CHANGED QUEUE TO DATABASE
    await Queue.updateOne(
            {url:url},
            {$setOnInsert:{url:url,level:0,visited:false}},
            {upsert:true})


    // let visitedUrl = new Set()       NO NEED FOR THIS DB HAS VISITED FIELD
    while (true) {
        try {
            //      GETS FIRST ITEM [FIFO]
            let currentItem = await Queue.findOneAndUpdate(
                {visited:false},
                {visited:true},
                {sort:{_id:1}}
            )

            //      DOMAIN CONQURED
            if(!currentItem){
                console.log("SUCCESSFULLY COMPLETED CRAWLING THIS DOMAIN")
                break;
            }

            //      FIND FROM DB 
            let currentLevel = currentItem.level
            let currentUrl = currentItem.url

            console.log(`URL: ${currentUrl} LEVEL: ${currentLevel}`)

            //      THIS STEP IS NO LONGER REQUIRED FIND ONE AND UPDATE DOES THIS
            // if (visitedUrl.has(currentUrl)) continue
            // visitedUrl.add(currentUrl)

            //      AXIOS REQUEST
            let response;
            try{
                response = await axios.get(currentUrl,{timeout:1500}) //    IF REQUIRED PLEASE ADD VALIDATE STATUS CONDTIONS
            }catch(e){
                console.log("FAILED TO FETCH, TIMEOUT OR RESPONSE ERROR")
                console.log(e.message)//    DON'T USE ENTIRE ERROR HERE TO CONSOLE
                continue;       //  SKIP CRAWLING ITERATION IF STUCK ON ERROR SAVES TIME
            }

            //      ADDS NEW CRWALED PAGE DETAILS TO THE INDEX
            let $ = cheerio.load(response.data)
            let title = $('title').text()
            let site = await Site.create({
                title: title.trim().split(/\s+/).slice(0,2).join(' '),
                level: currentLevel,
                url: currentUrl
            })
            console.log(`ADDED TO DB: ${site}`)


            let newLinks = []
            $("a").each((i, e) => {
                if (($(e).attr('href'))&&($(e).attr('href')[0] !== '#')) {
                    try {

                        let scrapedObj = new URL($(e).attr('href'), currentUrl)
                        if(scrapedObj.hostname === baseDomain){
                            let scrapedUrl = scrapedObj.href
                            // if (!visitedUrl.has(scrapedUrl))  //     NO NEED TO CHECK THIS BECAUSE THIS WILL BE DONE USING DB Queue
                            newLinks.push(scrapedUrl)
                        }
                    } catch (e) {
                        console.log("SCRAPPING URL FROM ANCHOR TAG FAILED")
                        console.log(e)
                    }
                }
            })

            //      NEED TO INSERT ALL NEW LINKS ON newLinks[] TO OUR Queue
            for (let link of newLinks){
                try{
                    await Queue.updateOne(
                    {url:link},
                    {$setOnInsert:{url:link,visited:false,level:currentLevel+1}},
                    {upsert:true}
                )
                }catch(e){
                    console.log("ADDING NEW LINK TO QUEUE IN DB FAILED")
                    console.log(e)
                }
            }

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