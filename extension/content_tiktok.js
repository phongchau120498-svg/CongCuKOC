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

// Wait helper - optimized to resolve smaller channels instantly when page completes loading
async function waitForElements(selector, minCount, timeout) {
    let start = Date.now();
    while (Date.now() - start < timeout) {
        const elements = document.querySelectorAll(selector);
        
        // If we found the target count, return immediately
        if (elements.length >= minCount) {
            return elements;
        }
        
        // Check for TikTok error screen ("Đã xảy ra lỗi")
        const hasErrorScreen = document.body.innerText.includes("Đã xảy ra lỗi") || 
                               document.body.innerText.includes("Vui lòng thử lại sau.") ||
                               document.body.innerText.includes("Something went wrong");
        if (hasErrorScreen) {
            return []; // fail fast immediately to trigger reload
        }

        // If the page is fully loaded and we have at least 4 videos, return early after a small settle delay
        if (elements.length >= 4 && document.readyState === 'complete') {
            await new Promise(r => setTimeout(r, 1200));
            return document.querySelectorAll(selector);
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
    return document.querySelectorAll(selector);
}

// Traversal helper to find video view counts inside JSON Rehydration objects
function extractVideoViewsFromJSON(jsonObj) {
    const playCounts = [];
    const seenIds = new Set();
    
    // 1. Try to find the structured lists of item cards (which are cleaner and pre-ordered)
    const items = [];
    function findItemLists(obj) {
        if (!obj || typeof obj !== 'object') return;
        
        if (Array.isArray(obj.itemList)) {
            items.push(...obj.itemList);
        }
        if (Array.isArray(obj.itemStruct)) {
            items.push(...obj.itemStruct);
        }
        if (Array.isArray(obj.itemModule)) {
            items.push(...obj.itemModule);
        }
        
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                if (key !== 'itemList' && key !== 'itemStruct' && key !== 'itemModule') {
                    findItemLists(obj[key]);
                }
            }
        }
    }
    
    findItemLists(jsonObj);
    
    if (items.length > 0) {
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
    }
    
    // 2. Fallback general traversal if list structured check was empty
    if (playCounts.length < 4) {
        seenIds.clear();
        playCounts.length = 0;
        let dummyIdCounter = 0;
        
        function generalTraverse(obj) {
            if (!obj || typeof obj !== 'object') return;
            
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
                    generalTraverse(obj[key]);
                }
            }
        }
        
        generalTraverse(jsonObj);
    }
    
    return playCounts;
}

// Check if target username exists inside the JSON to prevent parsing wrong page data
function hasUniqueIdInJSON(jsonObj, targetUsername) {
    let found = false;
    function traverse(obj) {
        if (found) return;
        if (!obj || typeof obj !== 'object') return;
        if (typeof obj.uniqueId === 'string' && obj.uniqueId.toLowerCase() === targetUsername) {
            found = true;
            return;
        }
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                traverse(obj[key]);
            }
        }
    }
    traverse(jsonObj);
    return found;
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
                const jsonObj = JSON.parse(scriptEl.textContent);
                
                // Validate that the JSON object contains user data for our target KOC username
                if (urlUsername && !hasUniqueIdInJSON(jsonObj, urlUsername)) {
                    console.warn(`[KOC Extension] JSON does not contain target username (${urlUsername}). Ignoring stale or recommended user JSON.`);
                    continue;
                }

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
    const elements = await waitForElements('[data-e2e="video-views"]', 10, 15000);
    
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
    const finalElements = document.querySelectorAll('[data-e2e="video-views"]');
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
