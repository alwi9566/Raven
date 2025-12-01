;(() => {
  let overlay = null
  let currentTab = "all"
  let currentView = "list"
  let selectedListing = null

  // Your Cloudflare Worker URL
  const WORKER_URL = 'https://raven-worker.orangecaptstone.workers.dev/'
  const TESTING_MODE = false // Set to false when ready to connect to Worker

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
        console.log('[RAVEN] Screenshot cropped successfully');
      } else {
        testScreenshots.cropped = screenshotDataUrl; // Use full screenshot for other sites
      }

      // Fetch backend data
      await fetchBackendData(pageUrl);
      
      // Show results
      showContent();

    } catch (error) {
      console.error('[RAVEN] Error processing screenshot:', error);
      showError(error.message);
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
   * Fetches backend data
   */
  async function fetchBackendData(pageUrl) {
    try {
      const isMarketplace = pageUrl.includes("facebook.com/marketplace");
      const isCraigslist = pageUrl.includes("craigslist.org");
      const isEbay = pageUrl.includes("ebay.com");
      
      console.log('[RAVEN] Fetching backend data...');
      console.log('[RAVEN] TESTING_MODE:', TESTING_MODE);

      // In testing mode, don't call Worker
      if (TESTING_MODE) {
        console.log('[RAVEN] TESTING MODE: Skipping Worker connection');
        console.log('[RAVEN] Original screenshot size:', testScreenshots.original?.length || 0, 'bytes');
        console.log('[RAVEN] Cropped screenshot size:', testScreenshots.cropped?.length || 0, 'bytes');
        
        backendData = {
          all: { count: 0, avgPrice: "$0.00", listings: [] },
          craigslist: { count: 0, avgPrice: "$0.00", listings: [] },
          ebay: { count: 0, avgPrice: "$0.00", listings: [] },
        };
        return;
      }

      // Production mode - call Worker
      let requestBody = {
        url: pageUrl,
        source: isMarketplace ? 'facebook_marketplace' : isCraigslist ? 'craigslist' : 'ebay',
        screenshot: testScreenshots.cropped
      };

      console.log('[RAVEN] Sending to Worker...');
      const response = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`Worker responded with ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Worker processing failed');
      }

      console.log('[RAVEN] Received data from Worker:', data);
      const transformedData = transformWorkerResponse(data);
      backendData = transformedData;

    } catch (error) {
      console.error("[RAVEN] Backend fetch error:", error);
      backendData = {
        all: { count: 0, avgPrice: "$0.00", listings: [] },
        craigslist: { count: 0, avgPrice: "$0.00", listings: [] },
        ebay: { count: 0, avgPrice: "$0.00", listings: [] },
      };
    }
  }

  /**
   * Transforms Worker response format to match UI expectations
   */
  function transformWorkerResponse(workerData) {
    const ebayListings = (workerData.ebay_results || []).map(item => ({
      image: item.ebay_imageUrl || 'https://via.placeholder.com/150',
      price: item.ebay_price || 'N/A',
      title: item.ebay_title || 'Untitled',
      url: item.ebay_url || '#',
      platform: 'ebay'
    }));

    const craigslistListings = (workerData.craigslist_results || []).map(item => ({
      image: 'https://via.placeholder.com/150',
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
            3. Set TESTING_MODE = false to enable Worker connection
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