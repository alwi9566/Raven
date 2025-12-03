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
        //console.log(`Craigslist Results: ${craigslistResults.json}`);

        //delete temp image
        fs.unlinkSync(tempPath);



        const craigslist_placeholder = [
                {
                    "ebay_title": "Nintendo Game Boy Advance GBA Backlight V5 IPS LCD System PICK YOUR COLOR",
                    "ebay_price": "219.95 USD",
                    "ebay_condition": "Excellent - Refurbished",
                    "ebay_url": "https://www.ebay.com/itm/195489317361?_skw=Game+Boy+Advance+-&hash=item2d841241f1:g:C0cAAOSwU-plNqqw&amdata=enc%3AAQAKAAAA8PeG5RIuIyokJHJy903%2F5UZbQC2K4OQMVjTkm2Ln%2B2Brdlc18e%2B8Pw4EevISFti2OJUamtQZC6s5F7y3anU0OOMpCVLRYMmec9nl0evRCc%2BCsqWpcFTPzBnkaOSNvDw0Ki%2FyWQ0wArOX5IitnIP93oIoXW0%2FAT%2Bk8FY3%2FY70g8iLDyXHaCXw4%2Bx%2FJsciGsk4VuyNgnjjFsTqrRsun5wwvgNQSUWyLEiFS6fBN9BOO0vmyBWc04XDSMX8Vt%2F3sj%2FoLcqT%2Fyspk66ccp%2FT1jcbbwMU21W7%2B5Iw3%2FmQFTx4X545TKIh1sYb16QlCNFXS013IQ%3D%3D",
                    "ebay_imageUrl": "https://i.ebayimg.com/images/g/C0cAAOSwU-plNqqw/s-l225.jpg"
                },
                {
                    "ebay_title": "Nintendo Game Boy Advance Console System Cleaned Tested New Indigo CaseRenewed p",
                    "ebay_price": "99.99 USD",
                    "ebay_condition": "Open box",
                    "ebay_url": "https://www.ebay.com/itm/267492203658?_skw=Game+Boy+Advance+-&hash=item3e47c71c8a:g:3xkAAeSwDXRpJ68a&amdata=enc%3AAQAKAAAA8PeG5RIuIyokJHJy903%2F5UarlBIEPXpipvCbwgd%2FHfLB5eiGP3Kw%2FhV0sCH5y%2FRnI7iwfvKKFebbRO5%2FEm9jpcTFNLADngpyWPYcEzWvEzq%2FKdzabBtFLe0bHWZYQf2TqRKFURg77Sjka3mxf8DbEHWc9Mn9eT%2Byf7rf%2Bbl8vxCYl%2B7TbMcAzNutepuYmGWOzhaHqin8B2G6lgN%2FNEMHgPE8Ne6EyS0RFCticodFvz9DPw5iN6LeeGYbVKeBy5l4GQ8TEGFQiC%2FPIKx01ExK90lzQrLlJnfNYHhsls97ku68nJqee2RJezYSyZIVdJqwnQ%3D%3D",
                    "ebay_imageUrl": "https://i.ebayimg.com/images/g/3xkAAeSwDXRpJ68a/s-l225.jpg"
                },
                {
                    "ebay_title": "Pokémon: Emerald Version (Game Boy Advance, 2004) GBA Game Cartridge - New",
                    "ebay_price": "59.99 USD",
                    "ebay_condition": "Brand New",
                    "ebay_url": "https://www.ebay.com/itm/177603985213?_skw=Game+Boy+Advance+-&hash=item295a05bf3d:g:cg4AAeSwXZ9pIoYc&amdata=enc%3AAQAKAAAA8PeG5RIuIyokJHJy903%2F5Ubhpxcm02qdtFTbSoD3oguCncrsFzizVgWpCdkzbW6X%2FMhnXk66BxK19GL3loqUsHMkMRPEApb0%2F%2BCDaeuOE2CDIgg0C31tRjmjfNl12B6N21FQaq0LoGsiPCtQrSY64BRJg5sM%2FVm5puqWSwmByvzdQnCYoRGQ7yKNglkiAMU4cMdzDEuE6Yx3dB%2Fo%2FTG6YOnDfyImESfiC8FvkWoRVdbQKq2ua0dFLIhtJh0aY28Of6sZZkxqlMPKyfEWENcOmeI%2BJDvn0hgs6EPUBP5KX2HI2AYIUFjpEhITG4XKrQmHmQ%3D%3D",
                    "ebay_imageUrl": "https://i.ebayimg.com/images/g/cg4AAeSwXZ9pIoYc/s-l225.jpg"
                },
                {
                    "ebay_title": "Nintendo Game Boy Advance SP 101 System GBA SP IPS LCD Backlit PICK YOUR COLOR!",
                    "ebay_price": "229.95 USD",
                    "ebay_condition": "Excellent - Refurbished",
                    "ebay_url": "https://www.ebay.com/itm/195489367990?_skw=Game+Boy+Advance+-&hash=item2d841307b6:g:6Z8AAOSwQRhlMZ9R&amdata=enc%3AAQAKAAAA8PeG5RIuIyokJHJy903%2F5UZfoX4U4%2Bs2mi97ntmVRRIU87oCUWatRJAC3zEeBS2%2FMz%2FYcWHQfRo0Z%2BMwycpSqfxwuAZ66nNdZTmXxGcS91dq0wTl2tbFyeNSf2H%2Bel47aOi%2BV8f3lq7Q83%2BuVDuPGSJdZthbVR1WvAbn%2FcOLc27pUSBojaKJobiRgneBMGWzCX8pJ02OvMLrzws1crG3GExfFKeCbTLrno1IpvtIK7OLsqMfe73zBjhrjxZLH8PJ0GWPjELPbaLtlJ%2FrB0A5TwDg2Aozb7zM96jf03cCzaW54pGgSYv9oruhx6suOyg3cw%3D%3D",
                    "ebay_imageUrl": "https://i.ebayimg.com/images/g/6Z8AAOSwQRhlMZ9R/s-l225.jpg"
                },
                {
                    "ebay_title": "Nintendo Game Boy Advance SP with Charger | AGS-101 or IPS V2 | Back-lit Screen",
                    "ebay_price": "199.95 USD",
                    "ebay_condition": "Excellent - Refurbished",
                    "ebay_url": "https://www.ebay.com/itm/203011552939?_skw=Game+Boy+Advance+-&hash=item2f446e76ab:g:L18AAOSwR5dilUtJ",
                    "ebay_imageUrl": "https://i.ebayimg.com/images/g/L18AAOSwR5dilUtJ/s-l225.jpg"
                },
                {
                    "ebay_title": "Nintendo Game Boy Advance Console System Cleaned Tested New Indigo CaseRenewed",
                    "ebay_price": "99.89 USD",
                    "ebay_condition": "Open box",
                    "ebay_url": "https://www.ebay.com/itm/257159414807?_skw=Game+Boy+Advance+-&hash=item3bdfe54417:g:c7IAAeSwROFo8L56",
                    "ebay_imageUrl": "https://i.ebayimg.com/images/g/c7IAAeSwROFo8L56/s-l225.jpg"
                },
                {
                    "ebay_title": "Nintendo GameBoy Advance (Glacier Clear AGB-001) Handheld System Authentic Works",
                    "ebay_price": "79.99 USD",
                    "ebay_condition": "Used",
                    "ebay_url": "https://www.ebay.com/itm/389322111091?_skw=Game+Boy+Advance+-&hash=item5aa567f873:g:NNUAAeSwq49pLyAw",
                    "ebay_imageUrl": "https://i.ebayimg.com/images/g/NNUAAeSwq49pLyAw/s-l225.jpg"
                },
                {
                    "ebay_title": "Nintendo Game Boy Advance GBA Authentic *Pick Your Game* Cart Only Tested",
                    "ebay_price": "29.99 USD",
                    "ebay_condition": "Good",
                    "ebay_url": "https://www.ebay.com/itm/295813495508?_skw=Game+Boy+Advance+-&hash=item44dfdbbad4:g:UL8AAOSw9atjg562",
                    "ebay_imageUrl": "https://i.ebayimg.com/images/g/UL8AAOSw9atjg562/s-l225.jpg"
                },
                {
                    "ebay_title": "Pokémon: FireRed Version (Game Boy Advance, 2003) GBA Game Cartridge - New",
                    "ebay_price": "59.99 USD",
                    "ebay_condition": "Brand New",
                    "ebay_url": "https://www.ebay.com/itm/177547948893?_skw=Game+Boy+Advance+-&hash=item2956aeb35d:g:AmkAAeSwIhJpB0uD&amdata=enc%3AAQAKAAAA8PeG5RIuIyokJHJy903%2F5UZw%2FCYTu4Q%2Ftumv6bRm1AfY2t3e68rFf2TZ24oCWKUcyTsOxyAcn2LEqNtlac%2FKrBn2fKLYl3Sn0triWhl42yzHAmeo%2FeZjgs7ejRxjfDfSSsLG6Fm302MOV1TXhWwJZZz0348GcZaCIEvwr84%2Fe7QnBw8TFrIGvxScDYYH5oQNu3HydUyBVp5uTouuUau9AX%2FeKxSo%2FTQK7BsFaARmlivyE52VYJ5cPgN5OWRjWJ84YGKcR42%2B%2FdmXlx87ibgiNlVR0SGb%2BWQknYhQwBCRO0ePrqu5aJFmflQOD7eFxJtTKg%3D%3D",
                    "ebay_imageUrl": "https://i.ebayimg.com/images/g/AmkAAeSwIhJpB0uD/s-l225.jpg"
                },
                {
                    "ebay_title": "Pokémon: LeafGreen Version (Game Boy Advance, 2004) GBA Game Cartridge - New",
                    "ebay_price": "59.99 USD",
                    "ebay_condition": "Brand New",
                    "ebay_url": "https://www.ebay.com/itm/177603994343?_skw=Game+Boy+Advance+-&hash=item295a05e2e7:g:4yoAAeSwrTlpIofl&amdata=enc%3AAQAKAAAA8PeG5RIuIyokJHJy903%2F5UZ6d3uR2BgSAajrCDjVf0F5BO8FN6LRMCwIx2E0bgSkprCXolxovVIOBXm22M2xHZ35Ru3NuHZrVn0nRZk8i7xoOQdEI25ZWO%2BqOeOJliTmbIJvA1ZoLme8Pi3pT9C%2FzEOXg5Q5RE6AfKeecTV%2B13vDS77F2gLZEzx%2FVx2C9D2AFhk3w69Iq8zVVbQo1mjhd1m5McFCVWzoG093D7R0xEH1%2Bw1ta67wrK3TRNFsFnCfHI6l8zqtl728J%2BFFvos50ee28%2BpehV7H0PSgC1AhrmYFenillyTeu0Y7HR01Aua%2B%2Bg%3D%3D",
                    "ebay_imageUrl": "https://i.ebayimg.com/images/g/4yoAAeSwrTlpIofl/s-l225.jpg"
                }]
        const test = {
            success: true,
            extracted: {
                title: facebook_title,
                price: facebook_price,
                condition: facebook_condition
            },
            results: {
                ebay: ebayResults,
                craigslist: craigslist_placeholder
            }

        }
        //console.log(JSON.stringify(test, null, 2));
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
                craigslist: craigslist_placeholder
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