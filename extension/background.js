let pendingRequests = {}; // tabId -> request details
let screenshotTabId = null; // dedicated screenshot tab

// Handles messages from content_localhost.js and content_tiktok.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SCRAPE_TIKTOK") {
        const senderTabId = sender.tab.id;
        const url = message.url;
        const index = message.index;
        const tabType = message.tabType;
        const workerId = message.workerId || 0;

        // Force a NEW background tab for each request to completely bypass Chrome's background tab suspension
        chrome.tabs.create({ url: url, active: false }, (newTab) => {
            pendingRequests[newTab.id] = {
                senderTabId: senderTabId,
                index: index,
                tabType: tabType,
                url: url,
                retryCount: 0
            };
        });
    } else if (message.action === "SCRAPE_RESULT") {
        const tabId = sender.tab.id;
        const request = pendingRequests[tabId];
        
        if (request) {
            // Self-healing retry check:
            const isCaptcha = message.error && (message.error.includes("captcha") || message.error.includes("Phát hiện captcha"));
            
            // Only retry once, and only for temporary network load errors (TIKTOK_ERROR)
            if (!message.success && request.retryCount < 1 && !isCaptcha && message.error === "TIKTOK_ERROR") {
                request.retryCount++;
                console.log(`[KOC Extension] Scraping failed for ${request.url}. Retrying (${request.retryCount}/1) in 1000ms... Error: ${message.error}`);
                
                setTimeout(() => {
                    chrome.tabs.update(tabId, { url: request.url }, () => {
                        if (chrome.runtime.lastError) {
                            console.error("[KOC Extension] Failed to reload tab for retry:", chrome.runtime.lastError.message);
                        }
                    });
                }, 1000);
                return; // Do not resolve yet
            }

            const senderTabId = request.senderTabId;
            const index = request.index;
            const tabType = request.tabType;
            const url = request.url;

            // 1. Send the views result immediately to the client page so the worker resolves instantly
            chrome.tabs.sendMessage(senderTabId, {
                action: "SCRAPE_FINISHED",
                index: index,
                tabType: tabType,
                url: url,
                success: message.success,
                viewSum: message.viewSum,
                views: message.views,
                screenshotUrl: "", // initially empty, captured separately in queue
                error: message.error
            });

            // 2. Clean up request and close the temporary scraping tab immediately
            delete pendingRequests[tabId];
            chrome.tabs.remove(tabId, () => {
                chrome.runtime.lastError; // silence closed errors
            });
        }
    } else if (message.action === "CAPTURE_SCREENSHOT_ONLY") {
        const senderTabId = sender.tab.id;
        const url = message.url;
        const index = message.index;
        const tabType = message.tabType;

        const takeScreenshot = (tabId) => {
            // Wait 3.5 seconds for the TikTok page to render fully at a relaxed pace
            setTimeout(() => {
                // Focus the screenshot tab to capture
                chrome.tabs.update(tabId, { active: true }, (focusedTab) => {
                    if (chrome.runtime.lastError || !focusedTab) {
                        chrome.tabs.sendMessage(senderTabId, {
                            action: "UPDATE_SCREENSHOT",
                            index: index,
                            tabType: tabType,
                            screenshotUrl: ""
                        });
                        return;
                    }
                    
                    // Wait 500ms for active focus paint
                    setTimeout(() => {
                        chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (dataUrl) => {
                            const error = chrome.runtime.lastError;
                            
                            // Send screenshot update to page
                            chrome.tabs.sendMessage(senderTabId, {
                                action: "UPDATE_SCREENSHOT",
                                index: index,
                                tabType: tabType,
                                screenshotUrl: error ? "" : dataUrl
                            });
                            
                            // Restore focus back to main page tab instantly
                            chrome.tabs.update(senderTabId, { active: true }, () => {
                                chrome.runtime.lastError; // silence errors if page closed
                            });
                        });
                    }, 500);
                });
            }, 3500);
        };

        if (screenshotTabId !== undefined && screenshotTabId !== null) {
            chrome.tabs.update(screenshotTabId, { url: url, active: false }, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    chrome.tabs.create({ url: url, active: false }, (newTab) => {
                        screenshotTabId = newTab.id;
                        takeScreenshot(newTab.id);
                    });
                } else {
                    takeScreenshot(screenshotTabId);
                }
            });
        } else {
            chrome.tabs.create({ url: url, active: false }, (newTab) => {
                screenshotTabId = newTab.id;
                takeScreenshot(newTab.id);
            });
        }
    } else if (message.action === "CLOSE_SCREENSHOT_TAB") {
        if (screenshotTabId) {
            chrome.tabs.remove(screenshotTabId, () => {
                chrome.runtime.lastError;
            });
            screenshotTabId = null;
        }
    } else if (message.action === "CLOSE_SCRAPE_TAB") {
        // Close all pending scraping tabs
        for (const tabIdStr in pendingRequests) {
            const tabId = parseInt(tabIdStr);
            if (!isNaN(tabId)) {
                chrome.tabs.remove(tabId, () => {
                    chrome.runtime.lastError;
                });
            }
        }
        pendingRequests = {};
        
        if (screenshotTabId) {
            chrome.tabs.remove(screenshotTabId, () => {
                chrome.runtime.lastError;
            });
            screenshotTabId = null;
        }
    }
});
