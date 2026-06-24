let pendingRequests = {}; // tabId -> request details

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SCRAPE_TIKTOK") {
        const senderTabId = sender.tab.id;
        
        // Open a new tab and focus it
        chrome.tabs.create({ url: message.url, active: true }, (newTab) => {
            pendingRequests[newTab.id] = {
                senderTabId: senderTabId,
                index: message.index,
                tabType: message.tabType,
                url: message.url
            };
        });
    } else if (message.action === "SCRAPE_RESULT") {
        const tabId = sender.tab.id;
        const request = pendingRequests[tabId];
        
        if (request) {
            // Take visible tab screenshot (since it is active)
            chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (dataUrl) => {
                const error = chrome.runtime.lastError;
                const screenshot = error ? "" : dataUrl;
                
                // Send result back to the original localhost tab
                chrome.tabs.sendMessage(request.senderTabId, {
                    action: "SCRAPE_FINISHED",
                    index: request.index,
                    tabType: request.tabType,
                    url: request.url,
                    success: message.success,
                    viewSum: message.viewSum,
                    views: message.views,
                    screenshotUrl: screenshot,
                    error: message.error
                });
                
                // Clean up request and close the scraped tab
                delete pendingRequests[tabId];
                chrome.tabs.remove(tabId);
            });
        }
    }
});
