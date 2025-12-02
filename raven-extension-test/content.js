;(() => {
  let overlay = null
  let currentTab = "all"
  let currentView = "list"
  let selectedListing = null

  // Express server URL (update this to match your server location)
  const SERVER_URL = 'https://ravenextension.com/api/search'
  const TESTING_MODE = false // Set to true for testing screenshots only

  // Facebook Marketplace crop coordinates
  const FACEBOOK_CROP = {
    yStart: 0,
    yEnd: 75,
    xStart: 79,
    xEnd: 100
  }

  let backendData = {
    all: { count: 0, avgPrice: "$0.00", listings: [] },
    craigslist: { count: 0, avgPrice: "$0.00", listings: [] },
    ebay: { count: 0, avgPrice: "$0.00", listings: [] },
  }

  let testScreenshots = {
    original: null,
    cropped: null
  }

  /**
   * Listen for messages from background script
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[RAVEN] Content script received message:', message);
    
    // Respond to ping (health check)
    if (message.action === 'ping') {
      sendResponse({ success: true, loaded: true });
      return true;
    }
    
    // Handle screenshot processing
    if (message.action === 'processScreenshot') {
      handleScreenshotFromBackground(message.screenshot, message.url);
      sendResponse({ success: true });
    }
    
    return true;
  });

  /**
   * Handle screenshot received from background script
   */
  async function handleScreenshotFromBackground(screenshotDataUrl, pageUrl) {
    console.log('[RAVEN] Received screenshot from background, processing...');
    console.log('[RAVEN] Screenshot size:', screenshotDataUrl?.length || 0, 'bytes');
    console.log('[RAVEN] Page URL:', pageUrl);
    
    // Show loading overlay
    if (overlay) {
      overlay.remove();
    }
    
    overlay = document.createElement("div");
    overlay.id = "raven-extension-overlay";
    document.body.appendChild(overlay);
    
    showLoadingScreen();

    try {
      // Store original screenshot
      testScreenshots.original = screenshotDataUrl;

      // Crop if Facebook Marketplace
      if (pageUrl.includes("facebook.com/marketplace")) {
        console.log('[RAVEN] Facebook Marketplace detected, cropping...');
        const croppedScreenshot = await cropScreenshot(screenshotDataUrl);
        testScreenshots.cropped = croppedScreenshot;
        console.log('[RAVEN] Screenshot cropped successfully, size:', croppedScreenshot?.length || 0, 'bytes');
      } else {
        testScreenshots.cropped = screenshotDataUrl; // Use full screenshot for other sites
        console.log('[RAVEN] Using full screenshot (not Facebook Marketplace)');
      }

      // Fetch backend data
      console.log('[RAVEN] Starting backend data fetch...');
      await fetchBackendData(pageUrl);
      console.log('[RAVEN] Backend data fetch completed');
      
      // Show results
      showContent();

    } catch (error) {
      console.error('[RAVEN] Error processing screenshot:', error);
      console.error('[RAVEN] Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      // Error already shown by fetchBackendData, just log here
      // Don't call showError again to avoid duplicate error displays
    }
  }

  /**
   * Crops a region from a canvas based on percentage coordinates
   */
  function cropRegion(canvas, yStart, yEnd, xStart, xEnd) {
    const y1 = Math.floor((yStart / 100) * canvas.height);
    const y2 = Math.floor((yEnd / 100) * canvas.height);
    const x1 = Math.floor((xStart / 100) * canvas.width);
    const x2 = Math.floor((xEnd / 100) * canvas.width);
    
    const cropped = document.createElement('canvas');
    cropped.width = x2 - x1;
    cropped.height = y2 - y1;
    
    const ctx = cropped.getContext('2d');
    ctx.drawImage(canvas, x1, y1, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    
    return cropped;
  }

  /**
   * Converts screenshot data URL to cropped image
   */
  async function cropScreenshot(screenshotDataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);
          
          console.log('[RAVEN] Original canvas size:', canvas.width, 'x', canvas.height);
          
          const croppedCanvas = cropRegion(
            canvas,
            FACEBOOK_CROP.yStart,
            FACEBOOK_CROP.yEnd,
            FACEBOOK_CROP.xStart,
            FACEBOOK_CROP.xEnd
          );
          
          console.log('[RAVEN] Cropped canvas size:', croppedCanvas.width, 'x', croppedCanvas.height);
          
          const croppedDataURL = croppedCanvas.toDataURL('image/png');
          resolve(croppedDataURL);
        } catch (error) {
          console.error('[RAVEN] Cropping error:', error);
          reject(error);
        }
      };
      
      img.onerror = () => reject(new Error('Failed to load screenshot image'));
      img.src = screenshotDataURL;
    });
  }

  /**
   * Fetches backend data from Express server
   */
  async function fetchBackendData(pageUrl) {
    try {
      console.log('[RAVEN] Fetching backend data...');
      console.log('[RAVEN] TESTING_MODE:', TESTING_MODE);
      console.log('[RAVEN] SERVER_URL:', SERVER_URL);
      console.log('[RAVEN] Page URL:', pageUrl);

      // In testing mode, don't call server
      if (TESTING_MODE) {
        console.log('[RAVEN] TESTING MODE: Skipping server connection');
        console.log('[RAVEN] Original screenshot size:', testScreenshots.original?.length || 0, 'bytes');
        console.log('[RAVEN] Cropped screenshot size:', testScreenshots.cropped?.length || 0, 'bytes');
        
        backendData = {
          all: { count: 0, avgPrice: "$0.00", listings: [] },
          craigslist: { count: 0, avgPrice: "$0.00", listings: [] },
          ebay: { count: 0, avgPrice: "$0.00", listings: [] },
        };
        return;
      }

      // Check if screenshot exists
      if (!testScreenshots.cropped) {
        throw new Error('No screenshot data available');
      }

      // Production mode - call Express server
      const requestBody = {
        imageData: testScreenshots.cropped
      };

      console.log('[RAVEN] Request body size:', JSON.stringify(requestBody).length, 'bytes');
      console.log('[RAVEN] Screenshot data starts with:', testScreenshots.cropped.substring(0, 50));
      console.log('[RAVEN] Sending POST request to:', SERVER_URL);

      // Add timeout to fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error('[RAVEN] Request timeout after 60 seconds');
        controller.abort();
      }, 60000); // 60 second timeout

      let response;
      try {
        console.log('[RAVEN] Initiating fetch...');
        response = await fetch(SERVER_URL, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        console.log('[RAVEN] Fetch completed');

      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        console.error('[RAVEN] Fetch failed:', fetchError);
        console.error('[RAVEN] Error type:', fetchError.constructor.name);
        console.error('[RAVEN] Error name:', fetchError.name);
        
        if (fetchError.name === 'AbortError') {
          throw new Error('Request timed out after 60 seconds. Server may be processing or unreachable.');
        }
        
        if (fetchError.message.includes('Failed to fetch')) {
          throw new Error('Cannot connect to server at ' + SERVER_URL + '. Check if server is running and accessible.');
        }
        
        throw fetchError;
      }

      console.log('[RAVEN] Server response status:', response.status);
      console.log('[RAVEN] Server response ok:', response.ok);
      console.log('[RAVEN] Server response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[RAVEN] Server error response:', errorText);
        throw new Error(`Server responded with ${response.status}: ${errorText}`);
      }

      console.log('[RAVEN] Parsing JSON response...');
      const data = await response.json();
      console.log('[RAVEN] Server response data:', data);
      
      if (!data.success) {
        throw new Error(data.error || 'Server processing failed');
      }

      console.log('[RAVEN] Received data from server successfully');
      console.log('[RAVEN] eBay results:', data.results?.ebay?.length || 0);
      console.log('[RAVEN] Craigslist results:', data.results?.craigslist?.length || 0);
      
      const transformedData = transformServerResponse(data);
      backendData = transformedData;

    } catch (error) {
      console.error("[RAVEN] Backend fetch error:", error);
      console.error("[RAVEN] Error name:", error.name);
      console.error("[RAVEN] Error message:", error.message);
      console.error("[RAVEN] Error stack:", error.stack);
      
      // Show error to user with helpful message
      let errorMessage = error.message;
      if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Cannot connect to server. Please check:\n1. Server is running at ' + SERVER_URL + '\n2. Server firewall allows connections\n3. Network connection is stable';
      }
      
      showError(errorMessage);
      
      backendData = {
        all: { count: 0, avgPrice: "$0.00", listings: [] },
        craigslist: { count: 0, avgPrice: "$0.00", listings: [] },
        ebay: { count: 0, avgPrice: "$0.00", listings: [] },
      };
      
      throw error; // Re-throw so handleScreenshotFromBackground can catch it
    }
  }

  /**
   * Transforms server response format to match UI expectations
   */
  function transformServerResponse(serverData) {
    // Extract eBay listings
    const ebayListings = (serverData.results?.ebay || []).map(item => ({
      image: item.ebay_imageUrl || 'https://via.placeholder.com/150',
      price: item.ebay_price || 'N/A',
      title: item.ebay_title || 'Untitled',
      url: item.ebay_url || '#',
      platform: 'ebay'
    }));

    // Extract Craigslist listings
    const craigslistListings = (serverData.results?.craigslist || []).map(item => ({
      image: item.craigslist_image || 'https://via.placeholder.com/150',
      price: item.craigslist_price || 'N/A',
      title: item.craigslist_title || 'Untitled',
      url: item.craigslist_url || '#',
      platform: 'craigslist'
    }));

    const allListings = [...ebayListings, ...craigslistListings];

    const calculateAvgPrice = (listings) => {
      if (listings.length === 0) return "$0.00";
      
      const prices = listings.map(l => {
        const match = l.price.match(/[\d,]+\.?\d*/);
        return match ? parseFloat(match[0].replace(/,/g, '')) : 0;
      }).filter(p => p > 0);
      
      if (prices.length === 0) return "$0.00";
      
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      return `$${avg.toFixed(2)}`;
    };

    return {
      all: {
        count: allListings.length,
        avgPrice: calculateAvgPrice(allListings),
        listings: allListings
      },
      craigslist: {
        count: craigslistListings.length,
        avgPrice: calculateAvgPrice(craigslistListings),
        listings: craigslistListings
      },
      ebay: {
        count: ebayListings.length,
        avgPrice: calculateAvgPrice(ebayListings),
        listings: ebayListings
      }
    };
  }

  function showLoadingScreen() {
    const pageTitle = document.title || "listings";

    overlay.innerHTML = `
      <div class="raven-loading-screen">
        <div class="raven-header">
          <img src="${chrome.runtime.getURL("images/raven-logo.png")}" alt="RAVEN" class="raven-logo-img">
          <button class="raven-close" id="raven-loading-close-btn">×</button>
        </div>
        <div class="raven-loading-content">
          <div class="raven-loading-bird-container">
            <img src="${chrome.runtime.getURL("images/flying-bird.gif")}" alt="Flying Bird" class="raven-loading-bird-gif">
            <div class="raven-loading-gradient"></div>
          </div>
          <div class="raven-loading-text">
            <div class="raven-loading-label">${TESTING_MODE ? 'Testing Screenshot Capture' : 'Searching for'}</div>
            <div class="raven-loading-title">${pageTitle}</div>
          </div>
        </div>
      </div>
    `;

    document.getElementById("raven-loading-close-btn").addEventListener("click", () => {
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
    });
  }

  function showContent() {
    if (TESTING_MODE && testScreenshots.cropped) {
      showTestingView();
    } else {
      renderListView();
    }
  }

  function showError(errorMessage) {
    overlay.innerHTML = `
      <div class="raven-header">
        <img src="${chrome.runtime.getURL("images/raven-logo.png")}" alt="RAVEN" class="raven-logo-img">
        <button class="raven-close" id="raven-close-btn">×</button>
      </div>
      <div style="padding: 20px; text-align: center; color: #ff6b6b;">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 10px;">Error</div>
        <div style="font-size: 13px;">${errorMessage}</div>
      </div>
    `;
    
    document.getElementById("raven-close-btn").addEventListener("click", () => {
      overlay.remove();
    });
  }

  function showTestingView() {
    overlay.innerHTML = `
      <div class="raven-header">
        <img src="${chrome.runtime.getURL("images/raven-logo.png")}" alt="RAVEN" class="raven-logo-img">
        <button class="raven-close" id="raven-close-btn">×</button>
      </div>

      <div style="padding: 10px; overflow-y: auto; max-height: 460px;">
        <div style="background: #272727; border-radius: 12px; padding: 15px; margin-bottom: 15px;">
          <div style="color: #fffd71; font-weight: 700; font-size: 16px; margin-bottom: 10px;">✓ Screenshot Test Successful!</div>
          <div style="color: #cccccc; font-size: 13px; line-height: 1.5;">
            Screenshot captured and cropped successfully. Check console for details.
          </div>
        </div>

        <div style="background: #272727; border-radius: 12px; padding: 15px; margin-bottom: 15px;">
          <div style="color: #ffffff; font-weight: 600; font-size: 14px; margin-bottom: 10px;">Original Screenshot</div>
          <img src="${testScreenshots.original}" style="width: 100%; border-radius: 8px; margin-bottom: 8px;">
          <div style="color: #cccccc; font-size: 11px;">Full page capture</div>
        </div>

        <div style="background: #272727; border-radius: 12px; padding: 15px; margin-bottom: 15px;">
          <div style="color: #ffffff; font-weight: 600; font-size: 14px; margin-bottom: 10px;">Cropped Region (For OCR)</div>
          <img src="${testScreenshots.cropped}" style="width: 100%; border-radius: 8px; margin-bottom: 8px;">
          <div style="color: #cccccc; font-size: 11px;">
            Coordinates: Y(${FACEBOOK_CROP.yStart}%-${FACEBOOK_CROP.yEnd}%), X(${FACEBOOK_CROP.xStart}%-${FACEBOOK_CROP.xEnd}%)
          </div>
        </div>

        <div style="background: #7216c7; border-radius: 12px; padding: 15px;">
          <div style="color: #ffffff; font-weight: 600; font-size: 13px; margin-bottom: 8px;">Next Steps:</div>
          <div style="color: #ffffff; font-size: 12px; line-height: 1.6;">
            1. Verify the cropped region captures title, price, and condition<br>
            2. Adjust coordinates in content.js if needed<br>
            3. Set TESTING_MODE = false to enable server connection
          </div>
        </div>
      </div>
    `;

    document.getElementById("raven-close-btn").addEventListener("click", () => {
      overlay.remove();
    });
  }

  function renderListView() {
    overlay.innerHTML = `
      <div class="raven-header">
        <img src="${chrome.runtime.getURL("images/raven-logo.png")}" alt="RAVEN" class="raven-logo-img">
        <button class="raven-close" id="raven-close-btn">×</button>
      </div>

      <div class="raven-tabs">
        <button class="raven-tab ${currentTab === "all" ? "active" : ""}" data-tab="all">All</button>
        <button class="raven-tab ${currentTab === "craigslist" ? "active" : ""}" data-tab="craigslist">Craigslist</button>
        <button class="raven-tab ${currentTab === "ebay" ? "active" : ""}" data-tab="ebay">Ebay</button>
      </div>

      <div class="raven-stats">
        <div class="raven-stat-card">
          <div class="raven-stat-value" id="stat-count">${backendData[currentTab].count}</div>
          <div class="raven-stat-label">Listings Found</div>
        </div>
        <div class="raven-stat-card">
          <div class="raven-stat-value" id="stat-price">${backendData[currentTab].avgPrice}</div>
          <div class="raven-stat-label">Average Price</div>
        </div>
      </div>

      <div class="raven-section-header">
        <div class="raven-section-title">Top Listings</div>
        <button class="raven-view-all">View All Listings</button>
      </div>

      <div class="raven-listings" id="raven-listings">
        ${backendData[currentTab].listings.length === 0 ? 
          '<div style="color: #cccccc; text-align: center; padding: 20px;">No listings available</div>' :
          backendData[currentTab].listings
            .map((listing, index) => `
          <div class="raven-listing-item" data-index="${index}">
            <img src="${listing.image}" alt="${listing.title}" class="raven-listing-image" crossorigin="anonymous">
            ${listing.platform ? `<div class="raven-platform-badge raven-platform-${listing.platform}">${listing.platform === "ebay" ? "eBay" : listing.platform === "craigslist" ? "CL" : "FB"}</div>` : ""}
            <div class="raven-listing-info">
              <div class="raven-listing-price">${listing.price}</div>
              <div class="raven-listing-title">${listing.title}</div>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    attachListViewEventListeners();
  }

  function attachListViewEventListeners() {
    document.getElementById("raven-close-btn").addEventListener("click", () => {
      overlay.remove();
    });

    const tabs = overlay.querySelectorAll(".raven-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        currentTab = tab.getAttribute("data-tab");
        renderListView();
      });
    });

    const listingItems = overlay.querySelectorAll(".raven-listing-item");
    listingItems.forEach((item) => {
      item.addEventListener("click", () => {
        const index = Number.parseInt(item.getAttribute("data-index"));
        selectedListing = backendData[currentTab].listings[index];
        currentView = "detail";
        renderDetailView(selectedListing);
      });
    });

    overlay.querySelector(".raven-view-all").addEventListener("click", () => {
      console.log("[RAVEN] View all listings clicked");
    });
  }

  function renderDetailView(listing) {
    overlay.innerHTML = `
      <div class="raven-header">
        <img src="${chrome.runtime.getURL("images/raven-logo.png")}" alt="RAVEN" class="raven-logo-img">
        <button class="raven-close" id="raven-close-btn">×</button>
      </div>

      <div class="raven-detail-view">
        <button class="raven-back-btn" id="raven-back-btn">
          <span>←</span> ${currentTab.charAt(0).toUpperCase() + currentTab.slice(1)}
        </button>
        
        <div class="raven-detail-image-container">
          <img src="${listing.image}" alt="${listing.title}" class="raven-detail-image" crossorigin="anonymous">
        </div>

        <div class="raven-detail-info">
          <div class="raven-detail-price">${listing.price}</div>
          <div class="raven-detail-title">${listing.title}</div>
          <button class="raven-listing-page-btn" id="raven-listing-page-btn">Listing Page</button>
        </div>

        <div class="raven-stats">
          <div class="raven-stat-card">
            <div class="raven-stat-value">${backendData[currentTab].count}</div>
            <div class="raven-stat-label">Listings Found</div>
          </div>
          <div class="raven-stat-card">
            <div class="raven-stat-value">${backendData[currentTab].avgPrice}</div>
            <div class="raven-stat-label">Average Price</div>
          </div>
        </div>
      </div>
    `;
    attachDetailViewEventListeners(listing);
  }

  function attachDetailViewEventListeners(listing) {
    document.getElementById("raven-close-btn").addEventListener("click", () => {
      overlay.remove();
    });

    document.getElementById("raven-back-btn").addEventListener("click", () => {
      currentView = "list";
      renderListView();
    });

    document.getElementById("raven-listing-page-btn").addEventListener("click", () => {
      window.open(listing.url, "_blank");
    });
  }

  console.log('[RAVEN] Content script loaded and ready for button clicks');
})()