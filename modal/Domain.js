const mongoose = require('mongoose');

const domainSchema = new mongoose.Schema({
    hostname: { type: String, required: true, unique: true },
    status: { type: String, default: "pending" },
    lastCrawledAt: { type: Date, default: new Date(0) } 
});

module.exports = mongoose.model('Domain', domainSchema);