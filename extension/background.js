let workerTabs = {}; // workerId -> tabId
let pendingRequests = {}; // tabId -> request details

// Handles messages from content_localhost.js and content_tiktok.js
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
                url: url
            };
        };

        const targetTabId = workerTabs[workerId];

        // Tối ưu bằng việc đổi URL trên tab cũ thay vì đóng mở tab mới
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
    } else if (message.action === "SCRAPE_RESULT") {
        const tabId = sender.tab.id;
        const request = pendingRequests[tabId];
        
        if (request) {
            // Đã xóa hoàn toàn cơ chế reload 3 lần gây lỗi skip link
            const senderTabId = request.senderTabId;
            const index = request.index;
            const tabType = request.tabType;
            const url = request.url;

            // Send the views result immediately to the client page
            chrome.tabs.sendMessage(senderTabId, {
                action: "SCRAPE_FINISHED",
                index: index,
                tabType: tabType,
                url: url,
                success: message.success,
                viewSum: message.viewSum,
                views: message.views,
                error: message.error
            });

            // Clean up request
            delete pendingRequests[tabId];
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
        pendingRequests = {};
    }
});
