const axios = require('axios');
const cheerio = require('cheerio');

const htmlParser = async(url)=>{
    const link = []
    try{
        const response = await axios.get(url)
        const $ = cheerio.load(response.data)
        $('a').each((i,e)=>{
            link.push($(e).attr('href'))
        })
    }catch(e){
        console.log(e)
    }finally{
        link.forEach((i,index)=>{
            if(i[0]!== '#'){
                try{
                    const absouluteUrl = new URL(i,url).href
                    console.log(absouluteUrl)
                }catch(e){
                    console.log(e)
                }
            }
        })
    }
    console.log(link.length)
}

htmlParser("https://github.com/")