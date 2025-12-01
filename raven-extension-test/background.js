console.log('[RAVEN] Background script loaded');

// Listen for extension icon clicks
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[RAVEN] Extension icon clicked on tab:', tab.id);
  
  // Check if we're on a supported page
  if (!tab.url) {
    console.log('[RAVEN] No URL available');
    return;
  }

  const isMarketplace = tab.url.includes("facebook.com/marketplace");
  const isCraigslist = tab.url.includes("craigslist.org");
  const isEbay = tab.url.includes("ebay.com");

  if (!isMarketplace && !isCraigslist && !isEbay) {
    console.log('[RAVEN] Not on a supported marketplace page');
    return;
  }

  try {
    // Capture screenshot
    console.log('[RAVEN] Capturing screenshot...');
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { 
      format: "png" 
    });

    console.log('[RAVEN] Screenshot captured, size:', screenshotDataUrl.length, 'bytes');

    // Send screenshot to content script to process
    chrome.tabs.sendMessage(tab.id, {
      action: 'processScreenshot',
      screenshot: screenshotDataUrl,
      url: tab.url
    });

  } catch (error) {
    console.error('[RAVEN] Error capturing screenshot:', error);
  }
});

// Listen for messages from content script (if needed)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[RAVEN] Background received message:', message);
  
  if (message.action === 'openTab') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ success: true });
  }
  
  return true;
});

// Log when extension is installed
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[RAVEN] Extension installed:', details);
});