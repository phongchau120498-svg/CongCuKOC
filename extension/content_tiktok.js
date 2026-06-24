// Function to parse view strings (e.g. 1.2M, 45.2K, 850)
function parseViews(viewStr) {
    if (!viewStr) return 0;
    viewStr = viewStr.trim().toUpperCase();
    
    let multiplier = 1;
    if (viewStr.endsWith('K')) {
        multiplier = 1000;
        viewStr = viewStr.slice(0, -1);
    } else if (viewStr.endsWith('M')) {
        multiplier = 1000000;
        viewStr = viewStr.slice(0, -1);
    } else if (viewStr.endsWith('B')) {
        multiplier = 1000000000;
        viewStr = viewStr.slice(0, -1);
    }
    
    let num = parseFloat(viewStr.replace(/,/g, ''));
    return isNaN(num) ? 0 : Math.round(num * multiplier);
}

// Wait helper
async function waitForElements(selector, minCount, timeout) {
    let start = Date.now();
    while (Date.now() - start < timeout) {
        const elements = document.querySelectorAll(selector);
        if (elements.length >= minCount) {
            return elements;
        }
        
        // If captcha is detected, reset start time to prevent timeout and reloading
        const hasCaptcha = document.querySelector('.captcha_verify_container') || 
                           document.querySelector('#captcha-verify-image') ||
                           document.body.innerText.includes("Verification") ||
                           document.body.innerText.includes("captcha");
                           
        if (hasCaptcha) {
            start = Date.now(); // reset timer
        }

        await new Promise(r => setTimeout(r, 200));
    }
    return document.querySelectorAll(selector);
}

// Traversal helper to find video view counts inside JSON Rehydration objects
function extractVideoViewsFromJSON(jsonObj) {
    const playCounts = [];
    
    function traverse(obj) {
        if (!obj || typeof obj !== 'object') return;
        
        // If this represents a video post object containing stats
        if (obj.stats && typeof obj.stats.playCount !== 'undefined' && (obj.id || obj.desc || obj.createTime)) {
            const play = parseInt(obj.stats.playCount);
            if (!isNaN(play)) {
                playCounts.push(play);
            }
            // Avoid traversing deeper inside this specific post object to prevent duplicates
            return;
        }
        
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                traverse(obj[key]);
            }
        }
    }
    
    traverse(jsonObj);
    return playCounts;
}

// Try parsing user-detail JSON from TikTok's script tags
function tryExtractViewsFromScriptTags() {
    try {
        const scripts = [
            document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__'),
            document.getElementById('SIGI_STATE')
        ];
        
        for (const scriptEl of scripts) {
            if (scriptEl && scriptEl.textContent) {
                const jsonObj = JSON.parse(scriptEl.textContent);
                const playCounts = extractVideoViewsFromJSON(jsonObj);
                if (playCounts && playCounts.length >= 4) {
                    console.log("[KOC Extension] Successfully extracted views from JSON script tag:", playCounts);
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
    const jsonViews = tryExtractViewsFromScriptTags();
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
    
    // Wait for the video views to load. Timeout is fast (8s) if no captcha is shown.
    const elements = await waitForElements('[data-e2e="video-views"]', 10, 8000);
    
    if (elements.length < 4) {
        // Check if we are stuck on a verification page
        const hasCaptcha = document.querySelector('.captcha_verify_container') || 
                           document.body.innerText.includes("Verification") ||
                           document.body.innerText.includes("captcha");
                           
        chrome.runtime.sendMessage({
            action: "SCRAPE_RESULT",
            success: false,
            error: hasCaptcha ? "Phát hiện captcha chưa giải trên tab." : "Không tìm thấy đủ video trên kênh."
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
