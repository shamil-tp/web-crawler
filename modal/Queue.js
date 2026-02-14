const mongoose = require('mongoose');

const queueSchema = new mongoose.Schema({
    url:{
        type:String,
        required:true,
        unique:true
    },
    visited:{
        type:Boolean,
        default:false,
    },
    level:{
        type:Number,
        default:0
    }
    
},
    {timestamps:true}
)

module.exports = mongoose.model('Queue',queueSchema)