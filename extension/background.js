let singleScrapeTabId = null;
let pendingRequests = {}; // tabId -> request details

// Setup dynamic rules to block heavy assets on TikTok
function setupTikTokBlockingRules() {
    if (!chrome.declarativeNetRequest) {
        console.warn("[KOC Extension] declarativeNetRequest API not available.");
        return;
    }
    
    const rules = [
        {
            id: 1001,
            priority: 1,
            action: { type: "block" },
            condition: {
                urlFilter: "*",
                initiatorDomains: ["tiktok.com"],
                resourceTypes: ["image", "media", "font"]
            }
        },
        {
            id: 1002,
            priority: 1,
            action: { type: "block" },
            condition: {
                urlFilter: "*analytics*",
                initiatorDomains: ["tiktok.com"]
            }
        },
        {
            id: 1003,
            priority: 1,
            action: { type: "block" },
            condition: {
                urlFilter: "*doubleclick*",
                initiatorDomains: ["tiktok.com"]
            }
        },
        {
            id: 1004,
            priority: 1,
            action: { type: "block" },
            condition: {
                urlFilter: "*facebook*",
                initiatorDomains: ["tiktok.com"]
            }
        }
    ];

    chrome.declarativeNetRequest.updateDynamicRules({
        addRules: rules,
        removeRuleIds: [1001, 1002, 1003, 1004]
    }, () => {
        if (chrome.runtime.lastError) {
            console.error("[KOC Extension] Failed to set dynamic rules:", chrome.runtime.lastError.message);
        } else {
            console.log("[KOC Extension] TikTok blocking rules registered successfully.");
        }
    });
}

// Run rules setup on install and startup
chrome.runtime.onInstalled.addListener(() => {
    setupTikTokBlockingRules();
});
chrome.runtime.onStartup.addListener(() => {
    setupTikTokBlockingRules();
});
// Also execute immediately in case of service worker reload
setupTikTokBlockingRules();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SCRAPE_TIKTOK") {
        const senderTabId = sender.tab.id;
        const url = message.url;
        const index = message.index;
        const tabType = message.tabType;

        const startScraping = (tabId) => {
            pendingRequests[tabId] = {
                senderTabId: senderTabId,
                index: index,
                tabType: tabType,
                url: url
            };
        };

        if (singleScrapeTabId !== null) {
            // Try updating the existing tab
            chrome.tabs.update(singleScrapeTabId, { url: url, active: true }, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    // Tab was probably closed by user, create a new one
                    chrome.tabs.create({ url: url, active: true }, (newTab) => {
                        singleScrapeTabId = newTab.id;
                        startScraping(newTab.id);
                    });
                } else {
                    startScraping(singleScrapeTabId);
                }
            });
        } else {
            // Create a new tab
            chrome.tabs.create({ url: url, active: true }, (newTab) => {
                singleScrapeTabId = newTab.id;
                startScraping(newTab.id);
            });
        }
    } else if (message.action === "SCRAPE_RESULT") {
        const tabId = sender.tab.id;
        const request = pendingRequests[tabId];
        
        if (request) {
            // Capture the screenshot of the active tab
            chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (dataUrl) => {
                const error = chrome.runtime.lastError;
                const screenshot = error ? "" : dataUrl;
                
                // Send result back to localhost tab
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
                
                // Clean up request but keep the tab open for next URL
                delete pendingRequests[tabId];
            });
        }
    } else if (message.action === "CLOSE_SCRAPE_TAB") {
        if (singleScrapeTabId !== null) {
            chrome.tabs.remove(singleScrapeTabId, () => {
                chrome.runtime.lastError; // silence potential errors if tab was already closed
            });
            singleScrapeTabId = null;
        }
    }
});
