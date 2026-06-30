// Inject vào main world để:
// 1. Giả lập tab visible → TikTok JS khởi động đầy đủ dù tab không focused
// 2. Bắt XHR call /api/post/item_list/ của TikTok
const interceptor = document.createElement('script');
interceptor.textContent = `
(function() {
    // Trick TikTok nghĩ tab đang visible
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { get: () => false });
    document.hasFocus = () => true;
    document.dispatchEvent(new Event('visibilitychange'));

    const API_PATTERNS = ['/api/post/item_list/', '/api/user/post/'];
    const isItemListUrl = url => url && API_PATTERNS.some(p => url.includes(p));

    function dispatchItems(itemList) {
        if (Array.isArray(itemList) && itemList.length > 0) {
            console.log('[KOC] Intercepted item_list, count:', itemList.length);
            window.dispatchEvent(new CustomEvent('__koc_items__', {
                detail: JSON.stringify(itemList)
            }));
        }
    }

    // Intercept fetch
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
        const resp = await origFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
            if (isItemListUrl(url)) {
                resp.clone().json().then(d => dispatchItems(d?.itemList)).catch(() => {});
            }
        } catch(e) {}
        return resp;
    };

    // Intercept XMLHttpRequest (phòng TikTok dùng XHR thay vì fetch)
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._kocUrl = url;
        return origOpen.apply(this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.send = function(...args) {
        if (isItemListUrl(this._kocUrl)) {
            this.addEventListener('load', function() {
                try {
                    const d = JSON.parse(this.responseText);
                    dispatchItems(d?.itemList);
                } catch(e) {}
            });
        }
        return origSend.apply(this, args);
    };
})();
`;
(document.head || document.documentElement).appendChild(interceptor);
interceptor.remove();

// --- Logic xử lý kết quả ---

let resultSent = false;
// Ảnh bìa bắt được từ JSON API (không phụ thuộc render trong tab ẩn) — nguồn chắc ăn nhất
let capturedCovers = [];

// Lấy URL ảnh bìa video từ lưới DOM (URL có x-signature → background tải về được).
function getDomCoverUrls() {
    const urls = [];
    document.querySelectorAll('[data-e2e="user-post-item"], [data-e2e="user-post-item-list"] > div').forEach(item => {
        const img = item.querySelector('img');
        const src = img && (img.currentSrc || img.src || img.getAttribute('src'));
        if (src && src.startsWith('http')) { urls.push(src); return; }
        // ảnh chưa load → lấy từ <source srcset> trong <picture>
        const source = item.querySelector('picture source');
        const ss = source && source.getAttribute('srcset');
        if (ss) { const first = ss.split(',')[0].trim().split(' ')[0]; if (first.startsWith('http')) urls.push(first); }
    });
    return [...new Set(urls)].slice(0, 9);
}

async function sendResult(playCounts, coverUrls = []) {
    if (resultSent) return;
    resultSent = true;
    // Gom đủ tới 9 ảnh: ưu tiên JSON API (capturedCovers), bù bằng cuộn ép lazy-load DOM.
    // Có 9 ngay từ API thì thoát liền (nhanh); thiếu mới cuộn, chờ tối đa ~6s.
    const deadline = Date.now() + 6000;
    let y = 0;
    while (Date.now() < deadline) {
        let best = capturedCovers;
        const dom = getDomCoverUrls();
        if (dom.length > best.length) best = dom;
        if (best.length > coverUrls.length) coverUrls = best;
        if (coverUrls.length >= 9) break;
        y += 600; window.scrollTo(0, y);                  // cuộn để thumbnail vào viewport → tải thêm
        await new Promise(r => setTimeout(r, 400));
    }
    window.scrollTo(0, 0);
    console.log('[KOC] coverUrls collected:', coverUrls.length, '(xhr:', capturedCovers.length, ')');
    const viewSum = playCounts.slice(3, 10).reduce((a, b) => a + b, 0);
    const username = (() => {
        const parts = window.location.href.split('@');
        return parts.length > 1 ? parts[1].split('/')[0].split('?')[0].toLowerCase() : null;
    })();
    const info = username ? extractProfileUserInfo(username) : null;
    // Bio: ưu tiên SSR signature, fallback đọc DOM (tab đang visible)
    const bio = info?.bio || cleanBio(document.querySelector('[data-e2e="user-bio"]')?.textContent) || '';
    chrome.runtime.sendMessage({ action: "SCRAPE_RESULT", success: true, viewSum, views: playCounts, coverUrls, userId: info?.userId || null, bio });
}

function sendError(error) {
    if (resultSent) return;
    resultSent = true;
    chrome.runtime.sendMessage({ action: "SCRAPE_RESULT", success: false, error });
}

// Path 1: XHR interception — TikTok gọi API, ta bắt response.
// KHÔNG once: API có thể bắn nhiều lần (phân trang) → luôn cập nhật ảnh bìa từ JSON (nguồn không cần render)
window.addEventListener('__koc_items__', (e) => {
    try {
        const items = JSON.parse(e.detail);
        const covers = items.map(it => it.video?.cover || it.video?.originCover || '').filter(Boolean);
        if (covers.length) capturedCovers = covers.slice(0, 9);
        const plays = items
            .map(it => parseInt(it.stats?.playCount ?? it.playCount ?? 0))
            .filter(n => n >= 0);
        if (plays.length >= 4) sendResult(plays, capturedCovers);
    } catch (_) {}
});

// Path 2: SSR JSON — một số kênh vẫn có itemList trong HTML (fast path)
function trySSRJson() {
    const urlUsername = (() => {
        const parts = window.location.href.split('@');
        return parts.length > 1 ? parts[1].split('/')[0].split('?')[0].toLowerCase() : null;
    })();

    for (const id of ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE']) {
        const el = document.getElementById(id);
        if (!el || !el.textContent) continue;
        if (urlUsername) {
            if (!new RegExp('"uniqueId"\\s*:\\s*"' + urlUsername + '"', 'i').test(el.textContent)) continue;
        }
        try {
            const { plays, covers } = extractPlays(JSON.parse(el.textContent));
            if (plays.length >= 4) { sendResult(plays, covers); return; }
        } catch (_) {}
    }
}

function extractPlays(jsonObj) {
    const items = [];
    const seen = new Set();

    function find(obj, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 6) return;
        if (Array.isArray(obj)) {
            if (obj.length > 0 && obj[0] && (obj[0].playCount !== undefined || obj[0].stats?.playCount !== undefined)) {
                items.push(...obj); return;
            }
        }
        if (Array.isArray(obj.itemList)) { items.push(...obj.itemList); return; }
        if (Array.isArray(obj.itemStruct)) { items.push(...obj.itemStruct); return; }
        if (obj.ItemModule && typeof obj.ItemModule === 'object') { items.push(...Object.values(obj.ItemModule)); return; }
        for (const key in obj) {
            if (key !== 'itemList' && key !== 'itemStruct' && key !== 'ItemModule')
                find(obj[key], depth + 1);
        }
    }

    find(jsonObj);
    const plays = [];
    const covers = [];
    items.forEach(it => {
        const id = it.id || it.video?.id;
        const n = parseInt(it.playCount ?? it.stats?.playCount);
        if (!isNaN(n) && id && !seen.has(id)) {
            seen.add(id); plays.push(n);
            covers.push(it.video?.cover || it.video?.originCover || '');
        }
    });
    return { plays, covers: covers.filter(Boolean).slice(0, 9) };
}

// Thử SSR ngay
trySSRJson();

// Fallback DOM: nếu XHR và SSR đều miss, đọc thẳng từ DOM (tab đang visible)
async function fallbackDOM() {
    const sel = '[data-e2e="video-views"]';
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        // Detect 403 block page → fail fast
        if (document.body?.innerText?.includes('was denied') || document.body?.innerText?.includes('HTTP ERROR 403')) {
            sendError('TIKTOK_BLOCKED');
            return;
        }
        // Detect TikTok error screen → reload 1 lần (sessionStorage ngăn loop vô hạn)
        if (!sessionStorage.getItem('koc_reloaded') && document.body?.innerText?.includes('Đã xảy ra lỗi')) {
            sessionStorage.setItem('koc_reloaded', '1');
            console.log('[KOC] TikTok error screen detected, reloading...');
            window.location.reload();
            return;
        }
        const els = document.querySelectorAll(sel);
        if (els.length >= 4) {
            const withText = [...els].filter(el => el.textContent.trim());
            if (withText.length >= 4) {
                await new Promise(r => setTimeout(r, 500));
                const plays = [...document.querySelectorAll(sel)]
                    .map(el => parseViewText(el.textContent.trim()))
                    .filter(n => n > 0);
                if (plays.length >= 4) { sendResult(plays); return; }
            }
        }
        await new Promise(r => setTimeout(r, 300));
    }
    sendError('FETCH_NO_DATA');
}

function parseViewText(str) {
    if (!str) return 0;
    str = str.trim().toUpperCase().replace(/,/g, '.');
    let mul = 1;
    if (str.endsWith('K') || str.endsWith('N')) { mul = 1000; str = str.slice(0, -1); }
    else if (str.endsWith('TR')) { mul = 1e6; str = str.slice(0, -2); }
    else if (str.endsWith('M') || str.endsWith('T')) { mul = 1e6; str = str.slice(0, -1); }
    else if (str.endsWith('TY') || str.endsWith('B')) { mul = 1e9; str = str.slice(0, -2); }
    const n = parseFloat(str.replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : Math.round(n * mul);
}

// Thử SSR + XHR 3s, sau đó DOM fallback chạy song song
setTimeout(() => { if (!resultSent) fallbackDOM(); }, 3000);

// --- MESSAGING ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "DO_SEND_MESSAGE") {
        sendResponse({ ok: true });
        doSendMessage(message.text);
    }
});

async function waitForEl(selectors, timeout = 15000) {
    const list = selectors.split(',').map(s => s.trim());
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const sel of list) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        await new Promise(r => setTimeout(r, 400));
    }
    return null;
}

// Đọc SSR JSON, tìm user object của profile đang xem → {userId, bio}
function extractProfileUserInfo(username) {
    for (const ssrId of ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE']) {
        const el = document.getElementById(ssrId);
        if (!el) continue;
        try {
            const info = findUserInObj(JSON.parse(el.textContent), username);
            if (info) return info;
        } catch(_) {}
    }
    return null;
}
// Làm sạch bio: NFKC gập chữ/số "kiểu" (𝟎𝟗, ＰＨ, ①②) về ASCII,
// rồi xóa variation selector + combining enclosing keycap → keycap emoji "0️⃣3️⃣" thành "03"
function cleanBio(s) {
    if (typeof s !== 'string') return '';
    return s.normalize('NFKC').replace(/[︀-️⃐-⃿]/g, '').trim();
}

// Ưu tiên object có bio thật; object author trong video có id nhưng thiếu signature → chỉ giữ dự phòng
function findUserInObj(rootObj, username) {
    let fallback = null;
    function walk(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 10) return null;
        if (typeof obj.uniqueId === 'string' && obj.uniqueId.toLowerCase() === username &&
            obj.id && /^\d{10,}$/.test(String(obj.id))) {
            const bio = cleanBio(obj.signature);
            const info = { userId: String(obj.id), bio };
            if (bio) return info;
            if (!fallback) fallback = info;
        }
        for (const key in obj) {
            const r = walk(obj[key], depth + 1);
            if (r) return r;
        }
        return null;
    }
    return walk(rootObj, 0) || fallback;
}

async function doSendMessage(text) {
    try {
        // Trang bị TikTok chặn (403) → báo backoff, đừng đâm tiếp
        const bodyText = document.body?.innerText || '';
        if (bodyText.includes('was denied') || bodyText.includes('HTTP ERROR 403')) {
            chrome.runtime.sendMessage({ action: 'MESSAGE_RESULT', success: false, error: 'TIKTOK_BLOCKED' });
            return;
        }

        // Case 1: Tìm ô nhập trong document này (có thể là iframe messages)
        const input = await waitForEl(
            'div.public-DraftEditor-content[contenteditable="true"], [data-e2e="im-chat-input"]',
            5000
        );
        if (input) {
            await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
            // background.js handle: focus → insertText (CDP) → chờ 1.5s → Enter, trả về {ok}
            const exec = await new Promise(resolve => {
                chrome.runtime.sendMessage({ action: 'EXEC_MAIN_WORLD', text }, (resp) => { chrome.runtime.lastError; resolve(resp); });
            });
            await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
            const ok = !!(exec && exec.ok);
            chrome.runtime.sendMessage({ action: 'MESSAGE_RESULT', success: ok, error: ok ? '' : 'SEND_FAILED' });
            return;
        }

        // Case 2: Không có ô nhập → đây là trang profile → extract userId và navigate
        const msgBtn = document.querySelector('[data-e2e="message-button"], [data-e2e="message-icon"]');
        if (msgBtn) {
            const username = window.location.pathname.split('@')[1]?.split(/[/?#]/)[0]?.toLowerCase();
            const userId = username ? extractProfileUserInfo(username)?.userId : null;
            if (userId) {
                window.location.href = `https://www.tiktok.com/business-suite/messages?from=homepage&u=${userId}`;
            } else {
                msgBtn.click();
            }
            return; // background.js onUpdated sẽ gửi lại DO_SEND_MESSAGE
        }

        // Case 3: Frame không liên quan → im lặng, frame đúng sẽ tự xử lý

    } catch(e) {
        chrome.runtime.sendMessage({ action: 'MESSAGE_RESULT', success: false, error: e.message });
    }
}
