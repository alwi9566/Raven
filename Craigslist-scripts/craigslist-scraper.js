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
    
    // Save HTML for debugging
    const html = await page.content();
    fs.writeFileSync('craigslist-debug.html', html);
    console.log('HTML saved to craigslist-debug.html');
    
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
            const title = titleElement ? titleElement.textContent.trim() : 'N/A';
            
            const priceElement = listing.querySelector('.priceinfo') ||
                                listing.querySelector('[class*="price"]');
            const price = priceElement ? priceElement.textContent.trim() : 'N/A';
            
            const linkElement = listing.querySelector('a.posting-title') ||
                               listing.querySelector('a');
            const url = linkElement ? linkElement.href : 'N/A';
            
            const imgElement = listing.querySelector('img');
            const image = imgElement ? imgElement.src : 'N/A';
            
            if (title !== 'N/A') {  // Only add if we found at least a title
                results.push({
                    title,
                    price,
                    image,
                    url
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
