const mongoose = require('mongoose');
const siteSchema = new mongoose.Schema({
    title:String,
    level:Number,
    url:String,
},
{timestamps:true}
)
module.exports = mongoose.model("Site",siteSchema)