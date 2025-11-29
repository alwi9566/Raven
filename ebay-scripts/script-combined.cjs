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
}

//call main (final debugging step)
main();