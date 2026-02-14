const mongoose = require('mongoose');
const siteSchema = new mongoose.Schema({
    title:String,
    level:Number,
    url:String,
})
module.exports = mongoose.model("Site",siteSchema)