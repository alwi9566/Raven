//import node modules
const express = require('express');
const https = require('https');
const http = require('http');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const HTTPS_PORT = 443;
const HTTP_PORT = 80;

//allows extension to access server api
app.use(cors({
    //allow all origins
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// eBay credentials
const client_id = 'ElyCariv-Capstone-PRD-e0ddfec83-ca98af90';
const client_secret = 'PRD-0ddfec83f99c-91e5-417c-9e0c-1e5d';

// OCR extraction function
async function tesseractExtract(imagePath) {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng');

    const { data: { text } } = await worker.recognize(imagePath);
    await worker.terminate();

    const facebook_title = text.match(/^[^$]*/)[0].trim();
    const facebook_price = text.match(/\$\d+\.?\d*/g)[0];
    const facebook_condition = text.split(/Condition\s*(\S+)/)[1];

    return {
        facebook_title,
        facebook_price,
        facebook_condition
    };
}

// Generate eBay OAuth token
async function generateToken() {
    const credentials = Buffer.from(`${client_id}:${client_secret}`).toString('base64');

    const token_response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${credentials}`
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });

    const token = await token_response.json();
    return token.access_token;
}

// eBay search function
async function ebaySearch(title, price, condition, limit) {
    const token = await generateToken();
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(title)}&filter=price:[${price}..${price}],conditions:${condition}&limit=${limit}`;

    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const data = await response.json();

    if (data.itemSummaries) {
        return data.itemSummaries.map((item, index) => ({
            ebay_title: item.title,
            ebay_price: item.price?.value + " " + item.price?.currency,
            ebay_condition: item.condition || 'N/A',
            ebay_url: item.itemWebUrl,
            ebay_imageUrl: item.image.imageUrl
        }));
    } else {
        return [];
    }
}

// Craigslist search function
async function craigslistSearch(title, price) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    const place = 'sfbay';
    const minPrice = 1;
    const maxPrice = price + 1000;

    const url = `https://${place}.craigslist.org/search/sss?query=${encodeURIComponent(title)}&min_price=${minPrice}&max_price=${maxPrice}#search=1~gallery~0~0`;

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Auto-scroll to load images
    console.log("scrolling ebay...");
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= 2000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    const listings = await page.evaluate(() => {
        const results = [];

        let listingElements = document.querySelectorAll('.cl-search-result');
        if (listingElements.length === 0) {
            listingElements = document.querySelectorAll('[class*="result"]');
        }
        if (listingElements.length === 0) {
            listingElements = document.querySelectorAll('.gallery-card');
        }

        const firstTen = Array.from(listingElements).slice(0, 10);

        firstTen.forEach(listing => {
            const titleElement = listing.querySelector('a.posting-title .label') ||
                listing.querySelector('[class*="title"]') ||
                listing.querySelector('a');
            const craigslist_title = titleElement ? titleElement.textContent.trim() : 'N/A';
            console.log(craigslist_title);
            const priceElement = listing.querySelector('.priceinfo') ||
                listing.querySelector('[class*="price"]');
            const craigslist_price = priceElement ? priceElement.textContent.trim() : 'N/A';
            console.log(craigslist_price);
            const linkElement = listing.querySelector('a.posting-title') ||
                listing.querySelector('a');
            const craigslist_url = linkElement ? linkElement.href : 'N/A';
            console.log(craigslist_url);
            const imgElement = listing.querySelector('img');
            const craigslist_image = imgElement ? imgElement.src : 'N/A';

            results.push({
                craigslist_title,
                craigslist_price,
                craigslist_image,
                craigslist_url
            });
        });

        return results;
    });

    await browser.close();
    return listings;
}

// API Routes

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Raven server is running' });
});

// Main search endpoint
app.post('/api/search', async (req, res) => {
    try {
        console.log('[SERVER] Received search request');
        const { imageData } = req.body;

        if (!imageData) {
            console.log('[SERVER] No image data provided');
            return res.status(400).json({ error: 'No image data provided' });
        }

        // Save base64 image to temporary file
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const tempPath = path.join(__dirname, 'temp_screenshot.png');
        fs.writeFileSync(tempPath, buffer);

        console.log('[SERVER] Extracting text from image...');
        const { facebook_title, facebook_price, facebook_condition } = await tesseractExtract(tempPath);

        console.log('[SERVER] Extracted:', { facebook_title, facebook_price, facebook_condition });

        const numericPrice = parseInt(facebook_price.replace(/\$/g, '').replace(/,/g, ''));

        console.log('[SERVER] Searching eBay...');
        const ebayResults = await ebaySearch(facebook_title, numericPrice, facebook_condition, 10);
        //console.log(ebayResults);

        console.log('[SERVER] Searching Craigslist...');
        const craigslistResults = await craigslistSearch(facebook_title, numericPrice);
        console.log(craigslistResults);

        // Clean up temp file
        fs.unlinkSync(tempPath);

        // Return results
        res.json({
            success: true,
            extracted: {
                title: facebook_title,
                price: facebook_price,
                condition: facebook_condition
            },
            results: {
                ebay: ebayResults,
                craigslist: craigslistResults
            }
        });

    } catch (error) {
        console.error('[SERVER] Error processing search:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Separate endpoint for just OCR extraction
app.post('/api/extract', async (req, res) => {
    try {
        const { imageData } = req.body;

        if (!imageData) {
            return res.status(400).json({ error: 'No image data provided' });
        }

        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const tempPath = path.join(__dirname, 'temp_screenshot.png');
        fs.writeFileSync(tempPath, buffer);

        const extracted = await tesseractExtract(tempPath);
        fs.unlinkSync(tempPath);

        res.json({
            success: true,
            extracted
        });

    } catch (error) {
        console.error('[SERVER] Error extracting text:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// SSL Certificate Configuration
const sslOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/www.ravenextension.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/www.ravenextension.com/fullchain.pem')
};

// Create HTTPS server
https.createServer(sslOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`[SERVER] HTTPS Raven server running on https://www.ravenextension.com:${HTTPS_PORT}`);
    console.log(`[SERVER] Health check: https://www.ravenextension.com:${HTTPS_PORT}/health`);
    console.log(`[SERVER] API endpoint: https://www.ravenextension.com:${HTTPS_PORT}/api/search`);
});

// Create HTTP server that redirects to HTTPS (maybe get rid of this!!!!!!!!!!!!!!!)
http.createServer((req, res) => {
    res.writeHead(301, { 
        Location: `https://${req.headers.host.replace(':80', '')}${req.url}` 
    });
    res.end();
}).listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[SERVER] HTTP server running on port ${HTTP_PORT} (redirecting to HTTPS)`);
});

// Keep the original HTTP server on port 3000 for backward compatibility (optional)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Development server still running on http://0.0.0.0:${PORT}`);
});