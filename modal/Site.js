const mongoose = require('mongoose');

// modal/Site.js
const siteSchema = new mongoose.Schema({
    url: { type: String, required: true, unique: true },
    level: { type: Number },
    title: { type: String },
    description: { type: String },
    h1: { type: String },
    content: { type: String },
    favicon: { type: String } // NEW FIELD
});

siteSchema.index(
    { 
        title: 'text', 
        description: 'text', 
        h1: 'text', 
        content: 'text' 
    },
    { 
        // Assigning points for matches!
        weights: { 
            title: 10,       // A match in the title is worth 10 points
            h1: 5,           // A match in the H1 tag is worth 5 points
            description: 2,  // A match in the description is worth 2 points
            content: 1       // A match deep in the paragraph text is worth 1 point
        },
        name: "TextIndex"
    }
);

module.exports = mongoose.model('Site', siteSchema);