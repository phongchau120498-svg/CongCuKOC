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

// Wait helper - support multi-selectors and early-exit when page finishes loading
async function waitForElements(selectors, minCount, timeout) {
    let start = Date.now();
    while (Date.now() - start < timeout) {
        let bestElements = [];
        
        for (const selector of selectors) {
            const found = document.querySelectorAll(selector);
            if (found.length >= minCount) {
                return found;
            }
            if (found.length > bestElements.length) {
                bestElements = found;
            }
        }
        
        // Check for TikTok error screen ("Đã xảy ra lỗi")
        const hasErrorScreen = document.body.innerText.includes("Đã xảy ra lỗi") || 
                               document.body.innerText.includes("Vui lòng thử lại sau.") ||
                               document.body.innerText.includes("Something went wrong");
        if (hasErrorScreen) {
            return []; // fail fast immediately to trigger reload
        }

        // If the page is fully loaded and we have at least 4 videos, return early after a small settle delay
        if (bestElements.length >= 4 && document.readyState === 'complete') {
            await new Promise(r => setTimeout(r, 1200));
            // Re-query the best selector
            for (const selector of selectors) {
                const found = document.querySelectorAll(selector);
                if (found.length >= 4) return found;
            }
            return bestElements;
        }
        
        // If captcha is detected, reset start time to prevent timeout and reloading
        const hasCaptcha = document.querySelector('.captcha_verify_container') || 
                           document.querySelector('#captcha-verify-image') ||
                           document.body.innerText.includes("Verification") ||
                           document.body.innerText.includes("captcha");
                           
        if (hasCaptcha) {
            start = Date.now(); // reset timer
        }

        await new Promise(r => setTimeout(r, 250));
    }
    
    // Return whatever elements we found as a fallback
    for (const selector of selectors) {
        const found = document.querySelectorAll(selector);
        if (found.length >= 4) return found;
    }
    return [];
}

// Traversal helper to find video view counts inside JSON Rehydration objects
function extractVideoViewsFromJSON(jsonObj) {
    const playCounts = [];
    const seenIds = new Set();
    const items = [];
    
    // Shallow traverse (max depth 3) to find array lists of item cards to avoid stack overflow
    function findItems(obj, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 3) return;
        
        if (Array.isArray(obj)) {
            // Check if this array contains video objects with views
            if (obj.length > 0 && obj[0] && typeof obj[0] === 'object' && 
                (obj[0].playCount !== undefined || (obj[0].stats && obj[0].stats.playCount !== undefined))) {
                items.push(...obj);
                return;
            }
        }
        
        // Check standard key names
        if (Array.isArray(obj.itemList)) {
            items.push(...obj.itemList);
            return;
        }
        if (Array.isArray(obj.itemStruct)) {
            items.push(...obj.itemStruct);
            return;
        }
        if (obj.ItemModule && typeof obj.ItemModule === 'object') {
            items.push(...Object.values(obj.ItemModule));
            return;
        }
        
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
        if (!isNaN(play) && id) {
            if (!seenIds.has(id)) {
                seenIds.add(id);
                playCounts.push(play);
            }
        }
    });
    
    // Fallback general traverse if list structured check was empty
    if (playCounts.length < 4) {
        seenIds.clear();
        playCounts.length = 0;
        let dummyIdCounter = 0;
        
        function generalTraverse(obj, depth = 0) {
            if (!obj || typeof obj !== 'object' || depth > 8) return; // limit depth to avoid stack limit
            
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

// Try parsing user-detail JSON from TikTok's script tags
function tryExtractViewsFromScriptTags() {
    try {
        const scripts = [
            document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__'),
            document.getElementById('SIGI_STATE')
        ];
        
        // Get expected KOC username robustly from current URL
        let urlUsername = null;
        const parts = window.location.href.split('@');
        if (parts.length > 1) {
            urlUsername = parts[1].split('/')[0].split('?')[0].toLowerCase();
        }
        
        for (const scriptEl of scripts) {
            if (scriptEl && scriptEl.textContent) {
                // 1. Fast regex check on the raw JSON string before parsing to see if it matches target KOC uniqueId
                // This avoids parsing and recursively checking stale rehydration caches or recommended user data
                if (urlUsername) {
                    const uniqueIdRegex = new RegExp('"uniqueId"\\s*:\\s*"' + urlUsername + '"', 'i');
                    if (!uniqueIdRegex.test(scriptEl.textContent)) {
                        console.warn(`[KOC Extension] JSON script does not contain target username (${urlUsername}) in uniqueId key. Skipping.`);
                        continue;
                    }
                }

                // 2. Parse and extract video views
                const jsonObj = JSON.parse(scriptEl.textContent);
                const playCounts = extractVideoViewsFromJSON(jsonObj);
                if (playCounts && playCounts.length >= 4) {
                    console.log("[KOC Extension] Successfully extracted views from validated JSON script tag:", playCounts);
                    return playCounts;
                }
            }
        }
    } catch (e) {
        console.error("[KOC Extension] Error parsing script tag JSON:", e);
    }
    return null;
}

// Scrape logic
async function scrapeTikTokViews() {
    console.log("[KOC Extension] Starting views extraction on TikTok...");
    
    // 1. Try to extract views instantly from page JSON script tags
    let jsonViews = tryExtractViewsFromScriptTags();
    if (!jsonViews) {
        // Wait 800ms to let page finish loading script tags and retry
        await new Promise(r => setTimeout(r, 800));
        jsonViews = tryExtractViewsFromScriptTags();
    }

    if (jsonViews && jsonViews.length >= 4) {
        let viewSum = 0;
        const viewsToSum = jsonViews.slice(3, 10);
        viewsToSum.forEach(v => viewSum += v);
        
        console.log("[KOC Extension] JSON parse success. View sum:", viewSum);
        
        chrome.runtime.sendMessage({
            action: "SCRAPE_RESULT",
            success: true,
            viewSum: viewSum,
            views: jsonViews
        });
        return;
    }
    
    // 2. Fallback: DOM scraping method
    console.log("[KOC Extension] JSON parse empty or failed, falling back to DOM scraping...");
    
    // Wait for the video views to load. Extended timeout (15s) for slower loaded tabs
    const targetSelectors = [
        '[data-e2e="video-views"]',
        'strong[class*="count"]',
        '.video-count',
        '[class*="video-count"]'
    ];
    const elements = await waitForElements(targetSelectors, 10, 15000);
    
    if (elements.length < 4) {
        // Check if we are stuck on a verification page or TikTok error screen
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
    
    // Scroll down 400px to trigger lazy loading of views
    window.scrollTo({ top: 400, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 1500));
    
    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 500));
    
    // Rescrape elements after scroll to get fresh view values
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
    
    console.log("[KOC Extension] Scraped views array via DOM:", views);
    
    // Skip 3, sum 7
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

// Execute immediately when script runs
scrapeTikTokViews();
