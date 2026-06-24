// Tái sử dụng logic từ content_tiktok.js (không có DOM ở service worker)
function extractVideoViewsFromJSON(jsonObj) {
    const items = [];
    const seenIds = new Set();

    function findItems(obj, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 6) return;

        if (Array.isArray(obj)) {
            if (obj.length > 0 && obj[0] && typeof obj[0] === 'object' &&
                (obj[0].playCount !== undefined || (obj[0].stats && obj[0].stats.playCount !== undefined))) {
                items.push(...obj);
                return;
            }
        }

        if (Array.isArray(obj.itemList)) { items.push(...obj.itemList); return; }
        if (Array.isArray(obj.itemStruct)) { items.push(...obj.itemStruct); return; }
        if (obj.ItemModule && typeof obj.ItemModule === 'object') { items.push(...Object.values(obj.ItemModule)); return; }

        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                if (key !== 'itemList' && key !== 'itemStruct' && key !== 'ItemModule') {
                    findItems(obj[key], depth + 1);
                }
            }
        }
    }

    findItems(jsonObj);

    const playCounts = [];
    items.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const id = item.id || (item.video && item.video.id);
        const play = parseInt(item.playCount || (item.stats && item.stats.playCount));
        if (!isNaN(play) && id && !seenIds.has(id)) {
            seenIds.add(id);
            playCounts.push(play);
        }
    });

    return playCounts;
}

// Fast path: fetch HTML trực tiếp, không cần mở tab
async function scrapeViaFetch(url) {
    try {
        const response = await fetch(url, {
            credentials: 'include',
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
                'Cache-Control': 'no-cache',
            }
        });

        if (!response.ok) return { success: false, error: `HTTP ${response.status}` };

        const html = await response.text();

        const urlUsername = (() => {
            const parts = url.split('@');
            return parts.length > 1 ? parts[1].split('/')[0].split('?')[0].toLowerCase() : null;
        })();

        const scriptPatterns = [
            /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
            /<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/
        ];

        for (const pattern of scriptPatterns) {
            const match = html.match(pattern);
            if (!match) continue;

            const jsonText = match[1];
            if (urlUsername) {
                const uniqueIdRegex = new RegExp('"uniqueId"\\s*:\\s*"' + urlUsername + '"', 'i');
                if (!uniqueIdRegex.test(jsonText)) continue;
            }

            const jsonObj = JSON.parse(jsonText);
            const playCounts = extractVideoViewsFromJSON(jsonObj);
            if (playCounts && playCounts.length >= 4) {
                const viewSum = playCounts.slice(3, 10).reduce((a, b) => a + b, 0);
                return { success: true, viewSum, views: playCounts };
            }
        }

        return { success: false, error: 'FETCH_NO_DATA' };
    } catch (e) {
        return { success: false, error: 'FETCH_ERROR' };
    }
}

// 1 shared popup window, các worker tab trong đó
// Dùng promise để tránh race condition khi nhiều worker khởi tạo đồng thời
let sharedWindowId = null;
let windowReadyPromise = null;
let workerTabs = {};
let pendingRequests = {};
let tabCycleTimer = null;

function ensureWorkerWindow() {
    if (windowReadyPromise) return windowReadyPromise;
    windowReadyPromise = new Promise(resolve => {
        if (sharedWindowId) {
            chrome.windows.get(sharedWindowId, (win) => {
                if (!chrome.runtime.lastError && win) { resolve(sharedWindowId); return; }
                sharedWindowId = null;
                windowReadyPromise = null;
                ensureWorkerWindow().then(resolve);
            });
            return;
        }
        // Window nhỏ góc trái, không focused → không cướp focus user
        // type: 'normal' để có thể mở nhiều tab bên trong
        chrome.windows.create({ url: 'about:blank', focused: false, type: 'normal', width: 480, height: 320, left: 0, top: 0 }, (win) => {
            sharedWindowId = win.id;
            resolve(win.id);
        });
    });
    return windowReadyPromise;
}

// Cycle activate từng tab mỗi 2s → giả lập user nhấp qua lại giữa các tab
function startTabCycle() {
    if (tabCycleTimer) return;
    let idx = 0;
    tabCycleTimer = setInterval(() => {
        const ids = Object.values(workerTabs).filter(Boolean);
        if (!ids.length) return;
        const tabId = ids[idx % ids.length];
        idx++;
        chrome.tabs.update(tabId, { active: true }, () => { chrome.runtime.lastError; });
    }, 2000);
}

function stopTabCycle() {
    if (tabCycleTimer) { clearInterval(tabCycleTimer); tabCycleTimer = null; }
}

function loadInWorkerTab(workerId, url, callback) {
    ensureWorkerWindow().then(windowId => {
        const existingTabId = workerTabs[workerId];
        if (existingTabId) {
            chrome.tabs.get(existingTabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    delete workerTabs[workerId];
                    loadInWorkerTab(workerId, url, callback);
                    return;
                }
                chrome.tabs.update(existingTabId, { url }, () => callback(existingTabId));
            });
        } else {
            chrome.tabs.create({ windowId, url, active: false }, (tab) => {
                workerTabs[workerId] = tab.id;
                callback(tab.id);
            });
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.action === "SCRAPE_TIKTOK") {
        const senderTabId = sender.tab.id;
        const { url, index, tabType, workerId = 0 } = message;

        scrapeViaFetch(url).then(result => {
            if (result.success) {
                chrome.tabs.sendMessage(senderTabId, {
                    action: "SCRAPE_FINISHED",
                    index, tabType, url,
                    success: true,
                    viewSum: result.viewSum,
                    views: result.views
                });
            } else {
                loadInWorkerTab(workerId, url, (tabId) => {
                    pendingRequests[tabId] = { senderTabId, index, tabType, url };
                    startTabCycle();
                });
            }
        });
    }

    if (message.action === "SCRAPE_RESULT") {
        const tabId = sender.tab.id;
        const request = pendingRequests[tabId];
        if (request) {
            chrome.tabs.sendMessage(request.senderTabId, {
                action: "SCRAPE_FINISHED",
                index: request.index,
                tabType: request.tabType,
                url: request.url,
                success: message.success,
                viewSum: message.viewSum,
                views: message.views,
                error: message.error
            });
            delete pendingRequests[tabId];
        }
    }

    if (message.action === "CLOSE_SCRAPE_TAB") {
        stopTabCycle();
        if (sharedWindowId) {
            chrome.windows.remove(sharedWindowId, () => { chrome.runtime.lastError; });
            sharedWindowId = null;
            windowReadyPromise = null;
        }
        workerTabs = {};
        pendingRequests = {};
    }
});
