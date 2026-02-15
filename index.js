const express = require('express');
const mongoose = require('mongoose');
const Site = require('./modal/Site');

const app = express();


app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const dbConnect = async (uri) => {
    try {
        await mongoose.connect(uri);
        console.log("Connected to MongoDB: N-jin Search API is ready!");
    } catch (e) {
        console.log("Database connection error:", e.message);
    }
};


app.get('/', (req, res) => {
    res.render('index', { results: null, query: "" });
});

app.get('/search', async (req, res) => {
    const searchQuery = req.query.q;
    
    // 1. Get the current page from the URL (default to 1 if it doesn't exist)
    const page = parseInt(req.query.page) || 1;
    const limit = 15; // How many results per page
    const skip = (page - 1) * limit; // Calculate how many documents to jump over

    if (!searchQuery || searchQuery.trim() === "") {
        return res.redirect('/');
    }

    try {
        // 2. Count the total number of matches in the entire database
        // We need this so the frontend knows how many "Next Page" buttons to draw
        const totalResults = await Site.countDocuments({ $text: { $search: searchQuery } });
        const totalPages = Math.ceil(totalResults / limit);

        // 3. The Paginated Search Query
        const results = await Site.find(
            { $text: { $search: searchQuery } }, 
            { relevanceScore: { $meta: "textScore" } } 
        )
        .sort({ relevanceScore: { $meta: "textScore" } })
        .skip(skip)   // THE FIX: Jump over the previous pages!
        .limit(limit); // Only grab 15 for the current page

        // 4. Send all this rich data to the EJS view
        res.render('index', { 
            results: results, 
            query: searchQuery,
            currentPage: page,
            totalPages: totalPages,
            totalResults: totalResults
        });

    } catch (error) {
        console.log("Search error:", error.message);
        res.status(500).send("Error executing search.");
    }
});


const PORT = 3000;
app.listen(PORT, async () => {
    await dbConnect("mongodb+srv://shamil:urcx5298@mysnapgram.zq2yd.mongodb.net/crawler");
    console.log(`🚀 N-jin is live at http://localhost:${PORT}`);
});