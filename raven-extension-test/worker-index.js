/**
 * Raven Worker - Updated for Chrome Extension Integration
 * Receives cropped screenshots from extension and processes them
 */

// eBay API credentials
const client_id = 'ElyCariv-Capstone-PRD-e0ddfec83-ca98af90';
const client_secret = 'PRD-0ddfec83f99c-91e5-417c-9e0c-1e5d';

/**
 * Extracts text from base64 image using Tesseract OCR
 */
async function tesseract_extract(imageDataURL) {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng');

    const { data: { text } } = await worker.recognize(imageDataURL);
    await worker.terminate();

    console.log('Raw OCR text:', text);

    // Extract title, price, and condition using regex
    const facebook_title = text.match(/^[^$]*/)?.[0]?.trim() || 'Not found';
    const facebook_price = text.match(/\$\d+\.?\d*/g)?.[0] || 'Not found';
    const facebook_condition = text.split(/Condition\s*(\S+)/)?.[1] || 'Not found';

    console.log('Extracted - Title:', facebook_title);
    console.log('Extracted - Price:', facebook_price);
    console.log('Extracted - Condition:', facebook_condition);

    return {
        facebook_title,
        facebook_price,
        facebook_condition
    };
}

/**
 * Generates eBay OAuth token
 */
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

/**
 * Searches eBay for similar items
 */
async function ebaySearch(title, price, condition, limit = 10) {
    const token = await generateToken();

    // Clean up price for API
    const numericPrice = parseInt(price.replace(/\$/g, '').replace(/,/g, ''));
    const priceRange = Math.max(1, numericPrice - 100); // Search within $100 range

    // Build API URL
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(title)}&filter=price:[${priceRange}..${numericPrice + 100}]&limit=${limit}`;

    console.log('eBay search URL:', url);

    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const data = await response.json();

    if (data.itemSummaries) {
        const results = data.itemSummaries.map(item => ({
            ebay_title: item.title,
            brand: item.brand || 'N/A',
            ebay_price: `${item.price?.value} ${item.price?.currency}`,
            ebay_url: item.itemWebUrl,
            ebay_imageUrl: item.image?.imageUrl || 'N/A',
            ebay_condition: item.condition || 'N/A'
        }));

        console.log(`Found ${results.length} eBay results`);
        return results;
    } else {
        console.log('No eBay items found or error:', data);
        return [];
    }
}

/**
 * Searches Craigslist using RSS feeds (Worker-compatible)
 */
async function craigslistSearchRSS(title, price, location = 'sfbay') {
    try {
        const numericPrice = parseInt(price.replace(/\$/g, '').replace(/,/g, ''));
        const minPrice = 1;
        const maxPrice = numericPrice + 1000;

        const url = `https://${location}.craigslist.org/search/sss?query=${encodeURIComponent(title)}&min_price=${minPrice}&max_price=${maxPrice}&format=rss`;

        console.log('Craigslist RSS URL:', url);

        const response = await fetch(url);
        const xmlText = await response.text();

        // Basic XML parsing for RSS
        const itemMatches = xmlText.matchAll(/<item>(.*?)<\/item>/gs);
        const results = [];

        for (const match of itemMatches) {
            const itemXml = match[1];

            const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
            const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);
            const descMatch = itemXml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);

            if (titleMatch && linkMatch) {
                results.push({
                    craigslist_title: titleMatch[1].trim(),
                    craigslist_price: titleMatch[1].match(/\$\d+/)?.[0] || 'N/A',
                    craigslist_url: linkMatch[1].trim(),
                    craigslist_description: descMatch ? descMatch[1].substring(0, 100) : 'N/A'
                });
            }

            // Limit to 10 results
            if (results.length >= 10) break;
        }

        console.log(`Found ${results.length} Craigslist results`);
        return results;

    } catch (error) {
        console.error('Craigslist search error:', error);
        return [];
    }
}

/**
 * Main Worker fetch handler
 */
export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                }
            });
        }

        try {
            // Only accept POST requests
            if (request.method !== 'POST') {
                return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                    status: 405,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Parse request body
            const body = await request.json();
            const { screenshot, source } = body;

            if (!screenshot) {
                return new Response(JSON.stringify({ error: 'No screenshot provided' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            console.log('Received screenshot from:', source);
            console.log('Screenshot size:', screenshot.length, 'bytes');

            // Step 1: Extract data from screenshot using OCR
            console.log('Starting OCR extraction...');
            const { facebook_title, facebook_price, facebook_condition } = await tesseract_extract(screenshot);

            // Step 2: Search eBay
            console.log('Searching eBay...');
            const ebayResults = await ebaySearch(facebook_title, facebook_price, facebook_condition, 10);

            // Step 3: Search Craigslist (RSS)
            console.log('Searching Craigslist...');
            const craigslistResults = await craigslistSearchRSS(facebook_title, facebook_price);

            // Step 4: Return results
            const results = {
                success: true,
                facebook_title,
                facebook_price,
                facebook_condition,
                ebay_results: ebayResults,
                craigslist_results: craigslistResults
            };

            return new Response(JSON.stringify(results), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });

        } catch (error) {
            console.error('Worker error:', error);

            return new Response(JSON.stringify({
                success: false,
                error: error.message,
                stack: error.stack
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    }
};
