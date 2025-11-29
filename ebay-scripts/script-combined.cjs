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

    console.log(facebook_title);
    console.log(facebook_price);
    console.log(facebook_condition);

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

    //console.log(token_response);

    const token = await token_response.json();

    //for debugging purposes
    //console.log(token.access_token);

    //pass token to ebaySearch();
    return token.access_token;
};

//call token generation for debugging
//generateToken();

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
            const title = item.title;
            const brand = item.brand || 'N/A';
            const price = item.price?.value + " " + item.price?.currency;
            const url = item.itemWebUrl;
            const imageUrl = item.image.imageUrl;
            const condition = item.condition || 'N/A';
            
            console.log(`${index + 1}. ${title}`);
            console.log(`Brand: ${brand}`);
            console.log(`Price: ${price}`);
            console.log(`Condition: ${condition}`);
            console.log(`URL: ${url}`);
            console.log(`Image URL: ${imageUrl}`);
        });
    } else {
        console.log('No items found or error in response:', data);
    }

    //console.log(data.itemSummaries);
    return data.itemSummaries;
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
    
    // Wait for listings to load
    console.log('Page loaded. Waiting and checking for listings...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('Page loaded, extracting data...');
    
    // Extract listing data (first 10 items)
    const listings = await page.evaluate(() => {
        const results = [];
        const listingElements = document.querySelectorAll('.cl-search-result');
        
        // Get only first 10 listings
        const firstTen = Array.from(listingElements).slice(0, 10);
        
        firstTen.forEach(listing => {
            // Title
            const titleElement = listing.querySelector('a.posting-title .label');
            const title = titleElement ? titleElement.textContent.trim() : 'N/A';
            
            // Price
            const priceElement = listing.querySelector('.priceinfo');
            const price = priceElement ? priceElement.textContent.trim() : 'N/A';
            
            // URL
            const linkElement = listing.querySelector('a.posting-title');
            const url = linkElement ? linkElement.href : 'N/A';
            
            // First Image
            const imgElement = listing.querySelector('img');
            const image = imgElement ? imgElement.src : 'N/A';
            
            results.push({
                title,
                price,
                image,
                url
            });
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


//main function
async function main(){

    //define screenshot patch
    //const image_path = 'screenshot.png';

    //define eBay query limit
    const limit = 10;

    //for debugging
    console.log('Extracting text from image...');
    const text = await tesseract_extract('screenshot.png');
    //console.log(text);

    //call tesseract_extract and store responses as title, price, and condition
    const { facebook_title, facebook_price, facebook_condition } = await tesseract_extract('screenshot.png');
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

//call main (final debugging step)
main();