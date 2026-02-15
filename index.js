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
        // THE MAGIC: The N-jin Aggregation Ranking Engine
        const results = await Site.aggregate([
            // 1. FILTER: Grab only pages that actually contain the search keywords
            { $match: { $text: { $search: searchQuery } } },

            // 2. CALCULATE: Define the raw mathematical variables
            { 
                $addFields: {
                    // Get the base TF-IDF text score
                    baseScore: { $meta: "textScore" },
                    
                    // Depth Multiplier: Level 0 = 1.0, Level 1 = 0.5, Level 4 = 0.2
                    depthMultiplier: { $divide: [1, { $add: ["$level", 1] }] },
                    
                    // Authority Boost: External links are mathematically worth 10x more than Internal links
                    authorityBoost: { 
                        $log10: { 
                            $add: [
                                { $multiply: [{ $ifNull: ["$externalBacklinks", 0] }, 10] }, 
                                { $ifNull: ["$internalBacklinks", 0] }, 
                                10 
                            ] 
                        } 
                    },

                    // Heuristics: Did the user's exact query appear in the URL or the Title?
                    isTitleMatch: { $regexMatch: { input: "$title", regex: searchQuery, options: "i" } },
                    // Replace spaces with hyphens for the URL check (e.g. "react router" -> "react-router")
                    isUrlMatch: { $regexMatch: { input: "$url", regex: searchQuery.replace(/\s+/g, '-'), options: "i" } }
                }
            },

            // 3. APPLY HEURISTIC MULTIPLIERS
            {
                $addFields: {
                    // If the keyword is literally in the Title, triple the score!
                    titleMultiplier: { $cond: [{ $eq: ["$isTitleMatch", true] }, 3, 1] }, 
                    // If the keyword is in the URL slug, double the score!
                    urlMultiplier: { $cond: [{ $eq: ["$isUrlMatch", true] }, 2, 1] }     
                }
            },

            // 4. COMBINE: The Final Equation
            {
                $addFields: {
                    njinScore: { 
                        $multiply: [
                            "$baseScore", 
                            "$depthMultiplier", 
                            "$authorityBoost",
                            "$titleMultiplier",
                            "$urlMultiplier"
                        ] 
                    }
                }
            },

            // 5. SORT & PAGINATE: Highest N-jin Score wins
            { $sort: { njinScore: -1 } },
            { $skip: skip },
            { $limit: limit }
        ]);

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