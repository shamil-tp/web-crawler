require('dotenv').config()

const express = require('express');
const mongoose = require('mongoose');
const Site = require('./modal/Site');
const Queue = require('./modal/Queue');
const Domain = require('./modal/Domain');

const app = express();

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- HELPER FUNCTION: Prevent Regex Crashes ---
// Escapes special characters like +, ?, or * if a user searches for them
const escapeRegex = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// --- DATABASE CONNECTION ---
const dbConnect = async (uri) => {
    try {
        await mongoose.connect(uri);
        console.log("Connected to MongoDB: N-jin Search API is ready!");
    } catch (e) {
        console.log("Database connection error:", e.message);
    }
};

// --- ROUTES ---

// 1. The Home Page
app.get('/', (req, res) => {
    res.render('index', { results: null, query: "" });
});

// 2. The N-jin Search Engine API
app.get('/search', async (req, res) => {
    const searchQuery = req.query.q;
    
    // Pagination Setup
    const page = parseInt(req.query.page) || 1;
    const limit = 15; // Results per page
    const skip = (page - 1) * limit; 

    if (!searchQuery || searchQuery.trim() === "") {
        return res.redirect('/');
    }

    try {
        // Count total matches for the EJS pagination UI
        const totalResults = await Site.countDocuments({ $text: { $search: searchQuery } });
        const totalPages = Math.ceil(totalResults / limit);

        // Sanitize the user's input so it doesn't break our URL/Title regex heuristics
        const safeRegexQuery = escapeRegex(searchQuery); 

        // THE MAGIC: The N-jin Aggregation Ranking Engine
        const results = await Site.aggregate([
            // A. FILTER: Grab only pages that actually contain the search keywords
            { $match: { $text: { $search: searchQuery } } },

            // B. CALCULATE: Define the raw mathematical variables
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
                    isTitleMatch: { $regexMatch: { input: "$title", regex: safeRegexQuery, options: "i" } },
                    // Replace spaces with hyphens for the URL check (e.g. "react router" -> "react-router")
                    isUrlMatch: { $regexMatch: { input: "$url", regex: safeRegexQuery.replace(/\s+/g, '-'), options: "i" } }
                }
            },

            // C. APPLY HEURISTIC MULTIPLIERS
            {
                $addFields: {
                    // If the keyword is literally in the Title, triple the score!
                    titleMultiplier: { $cond: [{ $eq: ["$isTitleMatch", true] }, 3, 1] }, 
                    // If the keyword is in the URL slug, double the score!
                    urlMultiplier: { $cond: [{ $eq: ["$isUrlMatch", true] }, 2, 1] }     
                }
            },

            // D. COMBINE: The Final N-jin Score Equation
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

            // E. SORT & PAGINATE: Highest N-jin Score wins
            { $sort: { njinScore: -1 } },
            { $skip: skip },
            { $limit: limit }
        ]);

        // Send all this rich data to the EJS view
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
app.get('/statistics', async (req, res) => {
    try {
        const totalDomains = await Domain.countDocuments();
        const completedDomains = await Domain.countDocuments({ status: "complete" });
        const totalQueues = await Queue.countDocuments();
        const visitedUrls = await Queue.countDocuments({ visited: true });
        const totalSites = await Site.countDocuments();

        res.render('statistics', {
            stats: { totalDomains, completedDomains, totalQueues, visitedUrls, totalSites }
        });

    } catch (error) {
        console.log("Stats error:", error.message);
        res.status(500).send("Error loading N-jin Control Center.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    await dbConnect(process.env.DB_URL);
    console.log(`🚀 N-jin Server is live at http://localhost:${PORT}`);
});