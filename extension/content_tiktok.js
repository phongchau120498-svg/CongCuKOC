// Function to parse view strings (e.g. 1.2M, 45.2K, 850)
function parseViews(viewStr) {
    if (!viewStr) return 0;
    viewStr = viewStr.trim().toUpperCase();
    
    // Normalize decimal separator for localized browser languages (e.g. Vietnamese "1,2Tr" -> "1.2Tr")
    let cleanStr = viewStr.replace(/,/g, '.');
    
    let multiplier = 1;
    if (cleanStr.endsWith('K') || cleanStr.endsWith('N')) {
        multiplier = 1000;
        cleanStr = cleanStr.slice(0, -1);
    } else if (cleanStr.endsWith('M') || cleanStr.endsWith('TR') || cleanStr.endsWith('T.R')) {
        multiplier = 1000000;
        if (cleanStr.endsWith('TR')) {
            cleanStr = cleanStr.slice(0, -2);
        } else {
            cleanStr = cleanStr.slice(0, -1);
        }
    } else if (cleanStr.endsWith('B') || cleanStr.endsWith('TY') || cleanStr.endsWith('T')) {
        multiplier = 1000000000;
        if (cleanStr.endsWith('TY')) {
            cleanStr = cleanStr.slice(0, -2);
        } else {
            cleanStr = cleanStr.slice(0, -1);
        }
    }
    
    // Remove any remaining non-numeric characters except dots
    cleanStr = cleanStr.replace(/[^0-9.]/g, '');
    
    let num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : Math.round(num * multiplier);
}

// Wait helper
async function waitForElements(selectors, minCount, timeout) {
    let start = Date.now();
    while (Date.now() - start < timeout) {
        let bestElements = [];
        
        for (const selector of selectors) {
            const found = document.querySelectorAll(selector);
            if (found.length >= minCount) return found;
            if (found.length > bestElements.length) bestElements = found;
        }
        
        const hasErrorScreen = document.body.innerText.includes("Đã xảy ra lỗi") || 
                               document.body.innerText.includes("Vui lòng thử lại sau.") ||
                               document.body.innerText.includes("Something went wrong");
        if (hasErrorScreen) return [];

        if (bestElements.length >= 4 && document.readyState === 'complete') {
            await new Promise(r => setTimeout(r, 1200));
            for (const selector of selectors) {
                const found = document.querySelectorAll(selector);
                if (found.length >= 4) return found;
            }
            return bestElements;
        }
        
        const hasCaptcha = document.querySelector('.captcha_verify_container') || 
                           document.querySelector('#captcha-verify-image') ||
                           document.body.innerText.includes("Verification") ||
                           document.body.innerText.includes("captcha");
                           
        if (hasCaptcha) start = Date.now();

        await new Promise(r => setTimeout(r, 250));
    }
    return [];
}

// JSON Extractor
function extractVideoViewsFromJSON(jsonObj) {
    const playCounts = [];
    const seenIds = new Set();
    const items = [];
    
    // Shallow traverse (max depth 3) to find array lists of item cards
    function findItems(obj, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 3) return;
        
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
    
    items.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const id = item.id || (item.video && item.video.id);
        const play = parseInt(item.playCount || (item.stats && item.stats.playCount));
        if (!isNaN(play) && id && !seenIds.has(id)) {
            seenIds.add(id);
            playCounts.push(play);
        }
    });
    
    // Fallback general traverse if list structured check was empty
    if (playCounts.length < 4) {
        seenIds.clear();
        playCounts.length = 0;
        let dummyIdCounter = 0;
        
        function generalTraverse(obj, depth = 0) {
            if (!obj || typeof obj !== 'object' || depth > 8) return;
            
            if (obj.stats && typeof obj.stats.playCount !== 'undefined') {
                const play = parseInt(obj.stats.playCount);
                if (!isNaN(play)) {
                    const id = obj.id || (obj.video && obj.video.id) || `dummy_${dummyIdCounter++}`;
                    if (!seenIds.has(id)) {
                        seenIds.add(id);
                        playCounts.push(play);
                    }
                }
                return;
            }
            
            if (typeof obj.playCount !== 'undefined' && obj.id) {
                const play = parseInt(obj.playCount);
                if (!isNaN(play)) {
                    if (!seenIds.has(obj.id)) {
                        seenIds.add(obj.id);
                        playCounts.push(play);
                    }
                }
                return;
            }
            
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    generalTraverse(obj[key], depth + 1);
                }
            }
        }
        
        generalTraverse(jsonObj);
    }
    
    return playCounts;
}

function tryExtractViewsFromScriptTags() {
    try {
        const scripts = [
            document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__'),
            document.getElementById('SIGI_STATE')
        ];
        
        let urlUsername = null;
        const parts = window.location.href.split('@');
        if (parts.length > 1) {
            urlUsername = parts[1].split('/')[0].split('?')[0].toLowerCase();
        }
        
        for (const scriptEl of scripts) {
            if (scriptEl && scriptEl.textContent) {
                // Validate that the script actually contains the data for our KOC
                if (urlUsername) {
                    const uniqueIdRegex = new RegExp('"uniqueId"\\s*:\\s*"' + urlUsername + '"', 'i');
                    if (!uniqueIdRegex.test(scriptEl.textContent)) continue;
                }

                const jsonObj = JSON.parse(scriptEl.textContent);
                const playCounts = extractVideoViewsFromJSON(jsonObj);
                if (playCounts && playCounts.length >= 4) {
                    return playCounts;
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
    return null;
}

// Scrape logic
async function scrapeTikTokViews() {
    console.log("[KOC Extension] Starting views extraction...");
    
    // JSON EXTRACTOR: Does NOT require the tab to be visible on screen!
    let jsonViews = tryExtractViewsFromScriptTags();
    if (!jsonViews) {
        await new Promise(r => setTimeout(r, 1500));
        jsonViews = tryExtractViewsFromScriptTags();
    }

    if (jsonViews && jsonViews.length >= 4) {
        let viewSum = 0;
        const viewsToSum = jsonViews.slice(3, 10);
        viewsToSum.forEach(v => viewSum += v);
        
        chrome.runtime.sendMessage({
            action: "SCRAPE_RESULT",
            success: true,
            viewSum: viewSum,
            views: jsonViews
        });
        return;
    }
    
    // DOM EXTRACTOR: Fallback. (Note: May fail in background tabs due to IntersectionObserver suspension)
    console.log("[KOC Extension] JSON parse empty or failed, falling back to DOM scraping...");
    
    const targetSelectors = [
        '[data-e2e="video-views"]',
        'strong[class*="count"]',
        '.video-count',
        '[class*="video-count"]'
    ];
    const elements = await waitForElements(targetSelectors, 10, 15000);
    
    if (elements.length < 4) {
        const hasCaptcha = document.querySelector('.captcha_verify_container') || 
                           document.querySelector('#captcha-verify-image') ||
                           document.body.innerText.includes("Verification") ||
                           document.body.innerText.includes("captcha");
                           
        const hasError = document.body.innerText.includes("Đã xảy ra lỗi") || 
                         document.body.innerText.includes("Vui lòng thử lại sau.") ||
                         document.body.innerText.includes("Something went wrong");
                           
        chrome.runtime.sendMessage({
            action: "SCRAPE_RESULT",
            success: false,
            error: hasError ? "TIKTOK_ERROR" : (hasCaptcha ? "Phát hiện captcha chưa giải trên tab." : "Không tìm thấy đủ video trên kênh.")
        });
        return;
    }
    
    // Scroll down to trigger lazy loading if any
    window.scrollTo({ top: 400, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 1200));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 300));
    
    let finalElements = [];
    for (const selector of targetSelectors) {
        const found = document.querySelectorAll(selector);
        if (found.length >= 4) {
            finalElements = found;
            break;
        }
    }
    
    const views = [];
    finalElements.forEach(el => {
        const text = el.textContent.trim();
        views.push(parseViews(text));
    });
    
    let viewSum = 0;
    const viewsToSum = views.slice(3, 10);
    viewsToSum.forEach(v => viewSum += v);
    
    chrome.runtime.sendMessage({
        action: "SCRAPE_RESULT",
        success: true,
        viewSum: viewSum,
        views: views
    });
}

scrapeTikTokViews();
