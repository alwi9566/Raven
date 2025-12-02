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
    // Ensure content script is loaded first
    await ensureContentScriptLoaded(tab.id);

    // Capture screenshot
    console.log('[RAVEN] Capturing screenshot...');
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { 
      format: "png" 
    });

    console.log('[RAVEN] Screenshot captured, size:', screenshotDataUrl.length, 'bytes');

    // Send screenshot to content script with retry logic
    const response = await sendMessageWithRetry(tab.id, {
      action: 'processScreenshot',
      screenshot: screenshotDataUrl,
      url: tab.url
    }, 3);
    
    console.log('[RAVEN] Content script response:', response);

  } catch (error) {
    console.error('[RAVEN] Error in click handler:', error);
  }
});

/**
 * Ensures content script is loaded in the tab
 */
async function ensureContentScriptLoaded(tabId) {
  try {
    console.log('[RAVEN] Checking if content script is loaded...');
    
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    console.log('[RAVEN] Content script already loaded');
    
  } catch (error) {
    console.log('[RAVEN] Content script not loaded, injecting...');
    
    try {
      // Inject content script
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });

      // Inject CSS if you have it
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tabId },
          files: ['styles.css']
        });
      } catch (cssError) {
        console.log('[RAVEN] CSS injection skipped or failed:', cssError.message);
      }

      // Wait for script to initialize
      await new Promise(resolve => setTimeout(resolve, 200));
      console.log('[RAVEN] Content script injected successfully');
      
    } catch (injectError) {
      console.error('[RAVEN] Failed to inject content script:', injectError);
      throw new Error('Could not inject content script: ' + injectError.message);
    }
  }
}

/**
 * Sends message with retry logic
 */
async function sendMessageWithRetry(tabId, message, maxRetries = 3) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch (error) {
      console.log(`[RAVEN] Message attempt ${i + 1}/${maxRetries} failed:`, error.message);
      lastError = error;
      
      if (i < maxRetries - 1) {
        // Wait before retrying (exponential backoff: 100ms, 200ms, 400ms)
        const delay = 100 * Math.pow(2, i);
        console.log(`[RAVEN] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error(`Failed to send message after ${maxRetries} attempts: ${lastError.message}`);
}

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