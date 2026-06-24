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

function sendResult(playCounts) {
    if (resultSent) return;
    resultSent = true;
    const viewSum = playCounts.slice(3, 10).reduce((a, b) => a + b, 0);
    chrome.runtime.sendMessage({ action: "SCRAPE_RESULT", success: true, viewSum, views: playCounts });
}

function sendError(error) {
    if (resultSent) return;
    resultSent = true;
    chrome.runtime.sendMessage({ action: "SCRAPE_RESULT", success: false, error });
}

// Path 1: XHR interception — TikTok gọi API, ta bắt response
window.addEventListener('__koc_items__', (e) => {
    try {
        const items = JSON.parse(e.detail);
        const plays = items
            .map(it => parseInt(it.stats?.playCount ?? it.playCount ?? 0))
            .filter(n => n >= 0);
        if (plays.length >= 4) sendResult(plays);
    } catch (_) {}
}, { once: true });

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
            const plays = extractPlays(JSON.parse(el.textContent));
            if (plays.length >= 4) { sendResult(plays); return; }
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
    items.forEach(it => {
        const id = it.id || it.video?.id;
        const n = parseInt(it.playCount ?? it.stats?.playCount);
        if (!isNaN(n) && id && !seen.has(id)) { seen.add(id); plays.push(n); }
    });
    return plays;
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
