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

// Làm sạch bio: NFKC gập chữ/số "kiểu" (𝟎𝟗, ＰＨ, ①②) về ASCII,
// rồi xóa variation selector + combining enclosing keycap → keycap emoji "0️⃣3️⃣" thành "03"
function cleanBio(s) {
    if (typeof s !== 'string') return '';
    return s.normalize('NFKC').replace(/[︀-️⃐-⃿]/g, '').trim();
}

// Tìm user object của profile trong SSR JSON (khớp uniqueId với username) → {userId, bio}
// Ưu tiên object có bio thật; object author trong video có id nhưng thiếu signature → chỉ giữ dự phòng
function extractUserInfoFromJSON(rootObj, username) {
    let fallback = null;
    function walk(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 10) return null;
        if (typeof obj.uniqueId === 'string' && obj.uniqueId.toLowerCase() === username &&
            obj.id && /^\d{10,}$/.test(String(obj.id))) {
            const bio = cleanBio(obj.signature);
            const info = { userId: String(obj.id), bio };
            if (bio) return info;             // có bio thật → dùng ngay
            if (!fallback) fallback = info;    // chưa có bio → giữ dự phòng, tìm tiếp object đầy đủ
        }
        for (const key in obj) {
            const r = walk(obj[key], depth + 1);
            if (r) return r;
        }
        return null;
    }
    return walk(rootObj, 0) || fallback;
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

        // 403 = Akamai chặn theo IP (tab thật cùng IP cũng bị → app sẽ backoff)
        if (response.status === 403) return { success: false, error: 'TIKTOK_BLOCKED' };
        if (!response.ok) return { success: false, error: `HTTP ${response.status}` };

        const html = await response.text();
        // Trang chặn của Akamai có khi trả 200 nhưng nội dung là "Access Denied"
        if (html.includes('Access Denied') || html.includes('edgesuite.net')) {
            return { success: false, error: 'TIKTOK_BLOCKED' };
        }

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
                const info = urlUsername ? extractUserInfoFromJSON(jsonObj, urlUsername) : null;
                return { success: true, viewSum, views: playCounts, userId: info?.userId || null, bio: info?.bio || '' };
            }
        }

        return { success: false, error: 'FETCH_NO_DATA' };
    } catch (e) {
        return { success: false, error: 'FETCH_ERROR' };
    }
}

// --- MESSAGING STATE ---
let messageTabId = null;
let messageWindowId = null;
let messagingSenderTabId = null;
let messagingPendingReq = null;

function createMessageTab(url) {
    chrome.windows.create({ url, focused: true, type: 'normal', width: 1280, height: 800 }, (win) => {
        messageWindowId = win.id;
        messageTabId = win.tabs[0].id;
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== messageTabId || changeInfo.status !== 'complete' || !messagingPendingReq) return;
    const req = messagingPendingReq;
    // Random 4-7s: tránh TikTok detect pattern timing cố định
    const delay = 4000 + Math.random() * 3000;
    setTimeout(() => {
        chrome.tabs.sendMessage(messageTabId, { action: "DO_SEND_MESSAGE", text: req.text, url: req.url }, () => { chrome.runtime.lastError; });
    }, delay);
});

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Inject text vào main world để bypass TikTok page CSP
    if (message.action === "EXEC_MAIN_WORLD") {
        const tabId = sender.tab.id;
        const frameId = sender.frameId || 0;
        const text = message.text;

        // Step 1: Focus element trong đúng frame (iframe "messages")
        chrome.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            world: 'MAIN',
            func: () => {
                const el = document.querySelector('div.public-DraftEditor-content[contenteditable="true"]');
                if (el) el.focus();
            }
        }, () => {
            chrome.debugger.attach({ tabId }, '1.3', () => {
                chrome.runtime.lastError; // clear nếu đã attach trước đó

                // Step 2: Insert text via CDP
                chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text }, () => {
                    if (chrome.runtime.lastError) {
                        chrome.debugger.detach({ tabId }, () => { chrome.runtime.lastError; });
                        sendResponse({ ok: false });
                        return;
                    }

                    // Step 3: Chờ Draft.js update state, rồi gửi Enter để submit
                    setTimeout(() => {
                        const enterKey = { key: 'Enter', code: 'Enter', keyCode: 13, windowsVirtualKeyCode: 13 };
                        chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', ...enterKey }, () => {
                            chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...enterKey }, () => {
                                chrome.debugger.detach({ tabId }, () => { chrome.runtime.lastError; });
                                sendResponse({ ok: true });
                            });
                        });
                    }, 1500);
                });
            });
        });
        return true;
    }
    if (message.action === "SCRAPE_TIKTOK") {
        const senderTabId = sender.tab.id;
        const { url, index, tabType, workerId = 0 } = message;

        const goTab = () => loadInWorkerTab(workerId, url, (tabId) => {
            pendingRequests[tabId] = { senderTabId, index, tabType, url };
            startTabCycle();
        });

        scrapeViaFetch(url).then(result => {
            if (result.success) {
                chrome.tabs.sendMessage(senderTabId, {
                    action: "SCRAPE_FINISHED",
                    index, tabType, url,
                    success: true,
                    viewSum: result.viewSum,
                    views: result.views,
                    userId: result.userId,
                    bio: result.bio
                });
            } else if (result.error === 'TIKTOK_BLOCKED') {
                // Chặn theo IP → tab thật cùng IP cũng bị chặn. Báo thẳng để app backoff, đừng phí mở tab.
                chrome.tabs.sendMessage(senderTabId, {
                    action: "SCRAPE_FINISHED", index, tabType, url, success: false, error: 'TIKTOK_BLOCKED'
                });
            } else {
                // Lỗi parse/không đủ data (IP chưa bị chặn) → thử tab thật chạy JS đầy đủ
                goTab();
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
                userId: message.userId,
                bio: message.bio,
                error: message.error
            });
            delete pendingRequests[tabId];
        }
    }

    if (message.action === "SEND_MESSAGE") {
        const { text, index, userId } = message;
        // Có userId → vào thẳng hội thoại, bỏ qua trang profile (nhanh hơn, ít load hơn)
        const url = userId
            ? `https://www.tiktok.com/business-suite/messages?from=homepage&u=${userId}`
            : message.url;
        messagingSenderTabId = sender.tab.id;
        messagingPendingReq = { index, text, url };

        if (messageTabId) {
            chrome.tabs.get(messageTabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    messageTabId = null;
                    createMessageTab(url);
                    return;
                }
                chrome.windows.update(messageWindowId, { focused: true }, () => { chrome.runtime.lastError; });
                chrome.tabs.update(messageTabId, { url, active: true });
            });
        } else {
            createMessageTab(url);
        }
    }

    if (message.action === "MESSAGE_RESULT") {
        if (messagingSenderTabId) {
            chrome.tabs.sendMessage(messagingSenderTabId, {
                action: "MESSAGE_FINISHED",
                index: messagingPendingReq?.index,
                success: message.success,
                error: message.error
            }, () => { chrome.runtime.lastError; });
        }
        messagingPendingReq = null;
    }

    if (message.action === "CLOSE_MESSAGE_TAB") {
        if (messageWindowId) {
            chrome.windows.remove(messageWindowId, () => { chrome.runtime.lastError; });
            messageWindowId = null;
        }
        messageTabId = null;
        messagingSenderTabId = null;
        messagingPendingReq = null;
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
