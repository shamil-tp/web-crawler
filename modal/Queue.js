const mongoose = require('mongoose');

const queueSchema = new mongoose.Schema({
    url:{
        type:String,
        required:true,
        unique:true
    },
    //      HOSTNAME ADDED TO AVOID REGEX
    hostname:{
        type:String,
        required:true,
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