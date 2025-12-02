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

    // Send screenshot to content script with proper error handling
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'processScreenshot',
        screenshot: screenshotDataUrl,
        url: tab.url
      });
      console.log('[RAVEN] Content script response:', response);
    } catch (messageError) {
      console.error('[RAVEN] Error sending message to content script:', messageError);
      console.log('[RAVEN] This usually means the content script is not injected. Trying to inject...');
      
      // Try to inject content script if it's not already there
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        
        // Wait a bit for script to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Try sending message again
        const retryResponse = await chrome.tabs.sendMessage(tab.id, {
          action: 'processScreenshot',
          screenshot: screenshotDataUrl,
          url: tab.url
        });
        console.log('[RAVEN] Content script response (retry):', retryResponse);
      } catch (injectError) {
        console.error('[RAVEN] Failed to inject content script:', injectError);
      }
    }

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