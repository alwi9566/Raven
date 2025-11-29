const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({ 
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    const place = ' '
    const title = ' '
    var price = 1 + 2000;

    const url = 'https://${place}.craigslist.org/search/bia?query=${title}&min_price=10&max_price=${price}#search=1~gallery~0~0';
    console.log('Navigating to:', url);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for listings to load
    await page.waitForSelector('.cl-search-result', { timeout: 10000 });
    
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
    
    console.log(`\nExtracted ${listings.length} listings:`);
    console.log(JSON.stringify(listings, null, 2));
    
    // Save to JSON file
    fs.writeFileSync('craigslist-results.json', JSON.stringify(listings, null, 2));
    console.log('\nResults saved to craigslist-results.json');
    
    await browser.close();
})();