console.log('[RAVEN] Background script loaded');

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[RAVEN] Background received message:', message);
  
  if (message.action === 'captureScreenshot') {
    // Use sender.tab.id to ensure we're capturing the right tab
    handleCaptureScreenshot(sender.tab.id, sendResponse);
    return true; // Keep channel open for async response
  }
  
  return false;
});

function handleCaptureScreenshot(tabId, sendResponse) {
  if (!tabId) {
    console.error('[RAVEN] No tab ID provided');
    sendResponse({ success: false, error: 'No valid tab ID' });
    return;
  }

  console.log('[RAVEN] Attempting to capture tab:', tabId);

  // Get the tab info first to ensure we have windowId
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.error('[RAVEN] Tab get error:', chrome.runtime.lastError);
      sendResponse({ success: false, error: chrome.runtime.lastError.message });
      return;
    }

    console.log('[RAVEN] Tab info:', tab);

    // Capture the visible tab using windowId
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error('[RAVEN] Screenshot error:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else if (dataUrl) {
        console.log('[RAVEN] Screenshot captured successfully, size:', dataUrl.length, 'bytes');
        sendResponse({ success: true, screenshot: dataUrl });
      } else {
        console.error('[RAVEN] No screenshot data returned');
        sendResponse({ success: false, error: 'No screenshot data' });
      }
    });
  });
}

// Log when extension is installed
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[RAVEN] Extension installed:', details);
});