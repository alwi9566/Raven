const puppeteer = require('puppeteer');
const fs = require('fs');


async function tesseract_extract(path){
    const {createWorker} = require('tesseract.js');
    const worker = await createWorker('eng');

    const {data:{text}} = await worker.recognize(path);

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

//credentials associated with eBay developer account
const client_id = 'ElyCariv-Capstone-PRD-e0ddfec83-ca98af90';
const client_secret = 'PRD-0ddfec83f99c-91e5-417c-9e0c-1e5d';

async function generateToken (id, secret){
    const credentials = Buffer.from(`${client_id}:${client_secret}`).toString('base64');

    const oauth_url = 'https://api.ebay.com/identity/v1/oauth2/token';

    const token_response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",  
        headers:{"Content-Type": "application/x-www-form-urlencoded", "Authorization": `Basic ${credentials}`},
        body:'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });

    const token = await token_response.json();

    //pass token to ebaySearch();
    return token.access_token;
};

async function ebaySearch(title, price, condition, limit){

    //call token generation function, store token
    const token = await generateToken();

    //build API url using title, price, condition, and response limit
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(title)}&filter=price:[${price}..${price}],conditions:${condition}&limit=${limit}`;

    //fetch API response, passing token and storing as variable "response"
    const response = await fetch (url, {headers: { Authorization: `Bearer ${token}`}});

    const data = await response.json();

    if (data.itemSummaries) {
        data.itemSummaries.forEach((item, index) => {
            const ebay_title = item.title;
            const ebay_price = item.price?.value + " " + item.price?.currency;
            const ebay_url = item.itemWebUrl;
            const ebay_imageUrl = item.image.imageUrl;
            const ebay_condition = item.condition || 'N/A';
            
            console.log(`${index + 1}. ${ebay_title}`);
            console.log(`Price: ${ebay_price}`);
            console.log(`Condition: ${ebay_condition}`);
            console.log(`URL: ${ebay_url}`);
            console.log(`Image URL: ${ebay_imageUrl}`);
        });
    } else {
        console.log('No items found or error in response:', data);
    }

    return{
        ebay_title,
        ebay_price,
        ebay_condition,
        ebay_url,
        ebay_imageUrl
    }
}

async function craigslistSearch(title, price){
    const browser = await puppeteer.launch({ 
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    const place = 'sfbay';
    const minPrice = 1;
    const maxPrice = price + 1000;

    const url = `https://${place}.craigslist.org/search/sss?query=${encodeURIComponent(title)}&min_price=${minPrice}&max_price=${maxPrice}#search=1~gallery~0~0`;
    console.log('Navigating to:', url);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    console.log('Page loaded. Scrolling to load images...');
    
    // AUTO-SCROLL to trigger lazy-loaded images
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100; // Scroll 100px at a time
            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;
                
                // Stop after scrolling 1500px (enough for ~10-15 images)
                if (totalHeight >= 2000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100); // Scroll every 100ms
        });
    });
    
    // Wait for images to fully load after scrolling
    console.log('Waiting for images to load...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Try to find listings with different selectors
    const listings = await page.evaluate(() => {
        const results = [];
        
        // Try multiple possible selectors
        let listingElements = document.querySelectorAll('.cl-search-result');
        if (listingElements.length === 0) {
            listingElements = document.querySelectorAll('[class*="result"]');
        }
        if (listingElements.length === 0) {
            listingElements = document.querySelectorAll('.gallery-card');
        }
        
        console.log(`Found ${listingElements.length} listing elements`);
        
        // Get only first 10 listings
        const firstTen = Array.from(listingElements).slice(0, 10);
        
        firstTen.forEach(listing => {
            // Try to extract data flexibly
            const titleElement = listing.querySelector('a.posting-title .label') || 
                                listing.querySelector('[class*="title"]') ||
                                listing.querySelector('a');
            const craigslist_title = titleElement ? titleElement.textContent.trim() : 'N/A';
            
            const priceElement = listing.querySelector('.priceinfo') ||
                                listing.querySelector('[class*="price"]');
            const craigslist_price = priceElement ? priceElement.textContent.trim() : 'N/A';
            
            const linkElement = listing.querySelector('a.posting-title') ||
                               listing.querySelector('a');
            const craigslist_url = linkElement ? linkElement.href : 'N/A';
            
            const imgElement = listing.querySelector('img');
            const craigslist_image = imgElement ? imgElement.src : 'N/A';
            
            if (title !== 'N/A') {  // Only add if we found at least a title
                results.push({
                    craigslist_title,
                    craigslist_price,
                    craigslist_image,
                    craigslist_url
                });
            }
        });
        
        return results;
    });
    
    console.log(`\nExtracted ${listings.length} Craigslist listings:`);
    console.log(JSON.stringify(listings, null, 2));
    
    // Save to JSON file
    fs.writeFileSync('craigslist-results.json', JSON.stringify(listings, null, 2));
    console.log('\nResults saved to craigslist-results.json');
    
    await browser.close();
    
    return listings;
}

async function main(){
    console.log('Extracting text from image...');

    //call tesseract_extract and store responses as title, price, and condition
    const {facebook_title, facebook_price, facebook_condition} = await tesseract_extract('screenshot.png');
    console.log(facebook_title);
    console.log(facebook_price);
    console.log(facebook_condition);

    //for debugging
    console.log('Searching eBay...');

    //run eBay search using title, price, condition information from facebook, and query limit defined in main();
    await ebaySearch(facebook_title, facebook_price, facebook_condition, 10);

    // Convert price from "$300" to 300
    const numericPrice = parseInt(facebook_price.replace(/\$/g, '').replace(/,/g, ''));
    console.log('Numeric price:', numericPrice);

    //run Craigslist using same varibles, saves as json
    const craigslistResults = await craigslistSearch(facebook_title, numericPrice);
}

main();