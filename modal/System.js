// modal/System.js
const mongoose = require('mongoose');

const systemSchema = new mongoose.Schema({
    // We only ever need one document in this collection
    configId: { type: String, default: 'master', unique: true },
    crawlerPaused: { type: Boolean, default: false }
});

module.exports = mongoose.model('System', systemSchema);