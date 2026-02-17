# 🕷️ Web Crawler

A lightweight and efficient **Node.js Web Crawler** that crawls websites starting from a base URL, extracts internal links, and recursively processes pages.

This project demonstrates how search engines and indexing systems work at a fundamental level using JavaScript.

---

## 🚀 Features

- 🔎 Crawl a website starting from a base URL  
- 🔗 Extract internal links from HTML pages  
- 🌐 Normalize URLs (avoid duplicates)  
- 📊 Track number of times each page is found  
- ⚡ Built with pure Node.js (Beginner Friendly)  
- 🧠 Easy to extend into a search engine or SEO analyzer  

---

## 🛠️ Tech Stack

- **Node.js**
- **JavaScript (ES6+)**
- (Optional) Express.js if UI exists
- HTML Parser (if using libraries like jsdom or cheerio)

---

## 📁 Project Structure

```
web-crawler/
│
├── index.js        # Entry point of the application
├── crawl.js        # Crawling logic
├── report.js       # Reporting logic (if exists)
├── package.json    # Dependencies and scripts
├── package-lock.json
├── .gitignore
└── README.md
```



*(Adjust this structure if your actual repo differs.)*

---

## ⚙️ Installation

Make sure you have **Node.js v14+** installed.

```bash
# Clone the repository
git clone https://github.com/shamil-tp/web-crawler.git

# Navigate into project
cd web-crawler

# Install dependencies
npm install
