//import node modules
const express = require('express');
const https = require('https');
const http = require('http');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

//store networking variables
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

//set image size limit higher for higher resolution screens
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// eBay credentials (scary)
const client_id = 'ElyCariv-Capstone-PRD-e0ddfec83-ca98af90';
const client_secret = 'PRD-0ddfec83f99c-91e5-417c-9e0c-1e5d';

// OCR extraction function
async function tesseractExtract(imagePath) { 

    const { createWorker } = require('tesseract.js');
    //start worker
    const worker = await createWorker('eng');
    //text extractrion
    const { data: { text } } = await worker.recognize(imagePath);
    //kill worker
    await worker.terminate();
    //isolate title, price, and condition
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
    //make fetch request
    const token_response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            //include credentials
            "Authorization": `Basic ${credentials}`
        },
        //set permissions scope for token
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });
    //store as json object
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

    // Launch a headless Chromium browser instance with security flags
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Creates a new browser tab
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    // Defines search params
    const place = 'sfbay';
    const minPrice = 1;
    const maxPrice = price + 1000;

    // Construct the Craigslist search URL
    const url = `https://${place}.craigslist.org/search/sss?query=${encodeURIComponent(title)}&min_price=${minPrice}&max_price=${maxPrice}#search=1~gallery~0~0`;

    // Navigate to the search URL and wait for network activity to settle
    console.log('Navigating to search URL...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });


    // Auto-scroll to load images
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            console.log("Scrolling...")
            let totalHeight = 0; // Track total scroll distance
            const distance = 100; // Scroll 100px at a time
            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;

                // Stop scrolling after reaching 2000px
                if (totalHeight >= 2000) {
                    clearInterval(timer);
                    console.log("Finished scrolling...");
                    resolve();
                }
            }, 100);
        });
    });

    // Wait an additional 2 seconds to ensure images finish loading
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extract listing data from the page DOM
    const listings = await page.evaluate(() => {
        console.log('Extracting Craigslist listing data...');
        const results = []; // Array to store extracted listing objects

        // Try multiple selectors to find listing elements
        let listingElements = document.querySelectorAll('.cl-search-result');
        if (listingElements.length === 0) {
            listingElements = document.querySelectorAll('[class*="result"]');
        }
        if (listingElements.length === 0) {
            listingElements = document.querySelectorAll('.gallery-card');
        }

        // Limit to first 10 listings
        const firstTen = Array.from(listingElements).slice(0, 10);

        // Loop through each listing and extract relevant data
        console.log('Looping through listings...');
        firstTen.forEach(listing => {
            // Find title element using multiple possible selectors
            const titleElement = listing.querySelector('a.posting-title .label') ||
                listing.querySelector('[class*="title"]') ||
                listing.querySelector('a');
            const craigslist_title = titleElement ? titleElement.textContent.trim() : 'N/A';

            // Find price element using multiple possible selectors
            const priceElement = listing.querySelector('.priceinfo') ||
                listing.querySelector('[class*="price"]');
            const craigslist_price = priceElement ? priceElement.textContent.trim() : 'N/A';

            // Find link element to the full listing
            const linkElement = listing.querySelector('a.posting-title') ||
                listing.querySelector('a');
            const craigslist_url = linkElement ? linkElement.href : 'N/A';

            // Find image element
            const imgElement = listing.querySelector('img');
            const craigslist_image = imgElement ? imgElement.src : 'N/A';

            // Add extracted data to results array
            results.push({
                craigslist_title,
                craigslist_price,
                craigslist_image,
                craigslist_url
            });
            console.log('Pushed results...');
        });
        console.log('\nFinished Craigslist extraction!');
        return results;
    });

    await browser.close();

    // Return the array of listing objects
    return listings;
}

//main api endpoint
app.post('/api/search', async (req, res) => {

        console.log('Server recieved request');
        const { imageData } = req.body;

        // if (!imageData) {
        //     console.log('[SERVER] No image data provided');
        //     return res.status(400).json({ error: 'No image data provided' });
        // }

        //save image to temp file
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const tempPath = path.join(__dirname, 'temp_screenshot.png');
        fs.writeFileSync(tempPath, buffer);
        
        //call tesseract
        console.log('\nExtracting text...');
        const { facebook_title, facebook_price, facebook_condition } = await tesseractExtract(tempPath);

        //console logs for debugging
        console.log(`Title: ${facebook_title}`);
        console.log(`Price: ${facebook_price}`);
        console.log(`Condition: ${facebook_condition}`);

        //remove dollar signs from price
        const numericPrice = parseInt(facebook_price.replace(/\$/g, '').replace(/,/g, ''));

        //call ebaySearch
        console.log('\nSearching eBay...');
        const ebayResults = await ebaySearch(facebook_title, numericPrice, facebook_condition, 10);
        console.log(`eBay Results: ${ebayResults.json}`);

        //call craigslistSearch
        console.log('\nSearching Craigslist...');
        //const craigslistResults = await craigslistSearch(facebook_title, numericPrice);
        console.log(`Craigslist Results: ${craigslistResults.json}`);

        //delete temp image
        fs.unlinkSync(tempPath);

        //return results as json
        res.json({
            success: true,
            extracted: {
                title: facebook_title,
                price: facebook_price,
                condition: facebook_condition
            },
            results: {
                ebay: ebayResults,
                craigslist: ebayResults
            }
        });
    
});
// Separate endpoint for just OCR extraction (might be able to delete!!!!!!!!!!!!)
// app.post('/api/extract', async (req, res) => {
//     try {
//         const { imageData } = req.body;

//         if (!imageData) {
//             return res.status(400).json({ error: 'No image data provided' });
//         }

//         const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
//         const buffer = Buffer.from(base64Data, 'base64');
//         const tempPath = path.join(__dirname, 'temp_screenshot.png');
//         fs.writeFileSync(tempPath, buffer);

//         const extracted = await tesseractExtract(tempPath);
//         fs.unlinkSync(tempPath);

//         res.json({
//             success: true,
//             extracted
//         });

//     } catch (error) {
//         console.error('[SERVER] Error extracting text:', error);
//         res.status(500).json({
//             success: false,
//             error: error.message
//         });
//     }
// });

// SSL Certificate Configuration
const sslOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/www.ravenextension.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/www.ravenextension.com/fullchain.pem')
};

//start https server
https.createServer(sslOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`\nServer running on https://www.ravenextension.com:${HTTPS_PORT}`);
    console.log(`Health check: https://www.ravenextension.com:${HTTPS_PORT}/health`);
    console.log(`API: https://www.ravenextension.com:${HTTPS_PORT}/api/search`);
});