let workerTabs = {}; // workerId -> tabId
let pendingRequests = {}; // tabId -> request details
let screenshotInProgress = {}; // tabId -> boolean
let screenshotTabId = null; // dedicated screenshot tab

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
        const workerId = message.workerId || 0;

        const startScraping = (tabId) => {
            pendingRequests[tabId] = {
                senderTabId: senderTabId,
                index: index,
                tabType: tabType,
                url: url,
                retryCount: 0 // Initialize retry count
            };
        };

        const targetTabId = workerTabs[workerId];

        const executeUpdate = () => {
            // active: false to keep focus on the main application page
            if (targetTabId !== undefined && targetTabId !== null) {
                chrome.tabs.update(targetTabId, { url: url, active: false }, (tab) => {
                    if (chrome.runtime.lastError || !tab) {
                        chrome.tabs.create({ url: url, active: false }, (newTab) => {
                            workerTabs[workerId] = newTab.id;
                            startScraping(newTab.id);
                        });
                    } else {
                        startScraping(targetTabId);
                    }
                });
            } else {
                chrome.tabs.create({ url: url, active: false }, (newTab) => {
                    workerTabs[workerId] = newTab.id;
                    startScraping(newTab.id);
                });
            }
        };

        // Delay loading the next URL if this tab is currently in a cooldown state
        if (targetTabId && screenshotInProgress[targetTabId]) {
            setTimeout(executeUpdate, 500);
        } else {
            executeUpdate();
        }
    } else if (message.action === "SCRAPE_RESULT") {
        const tabId = sender.tab.id;
        const request = pendingRequests[tabId];
        
        if (request) {
            // Self-healing retry check:
            const isCaptcha = message.error && (message.error.includes("captcha") || message.error.includes("Phát hiện captcha"));
            if (!message.success && request.retryCount < 3 && !isCaptcha) {
                request.retryCount++;
                const isTiktokError = message.error === "TIKTOK_ERROR";
                const delay = isTiktokError ? 500 : 2500;
                
                console.log(`[KOC Extension] Scraping failed for ${request.url}. Retrying (${request.retryCount}/3) in ${delay}ms... Error: ${message.error}`);
                
                setTimeout(() => {
                    chrome.tabs.update(tabId, { url: request.url }, () => {
                        if (chrome.runtime.lastError) {
                            console.error("[KOC Extension] Failed to reload tab for retry:", chrome.runtime.lastError.message);
                        }
                    });
                }, delay);
                return; // Do not send finished message yet!
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

            // Clean up request from pending queue
            delete pendingRequests[tabId];

            // 2. Set screenshotInProgress to true to enforce a cooldown delay on this scraping tab (1.2s)
            screenshotInProgress[tabId] = true;
            setTimeout(() => {
                screenshotInProgress[tabId] = false;
            }, 1200);
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
        for (const workerId in workerTabs) {
            const tabId = workerTabs[workerId];
            if (tabId) {
                chrome.tabs.remove(tabId, () => {
                    chrome.runtime.lastError;
                });
            }
        }
        workerTabs = {};
        screenshotInProgress = {};
        
        if (screenshotTabId) {
            chrome.tabs.remove(screenshotTabId, () => {
                chrome.runtime.lastError;
            });
            screenshotTabId = null;
        }
    }
});
