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

// Scrape logic - 100% DOM-based, simple and transparent!
async function scrapeTikTokViews() {
    console.log("[KOC Extension] Starting DOM-based views extraction...");
    
    const selector = '[data-e2e="video-views"]';
    let start = Date.now();
    let elements = [];
    const timeout = 15000; // 15 seconds maximum wait
    
    while (Date.now() - start < timeout) {
        // Check for captcha page
        const hasCaptcha = document.querySelector('.captcha_verify_container') || 
                           document.querySelector('#captcha-verify-image') ||
                           document.body.innerText.includes("Verification") ||
                           document.body.innerText.includes("captcha");
        if (hasCaptcha) {
            start = Date.now(); // reset timer while captcha is active
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        // Check for TikTok error screen
        const hasErrorScreen = document.body.innerText.includes("Đã xảy ra lỗi") || 
                               document.body.innerText.includes("Vui lòng thử lại sau.") ||
                               document.body.innerText.includes("Something went wrong");
        if (hasErrorScreen) {
            console.error("[KOC Extension] TikTok error screen detected.");
            chrome.runtime.sendMessage({
                action: "SCRAPE_RESULT",
                success: false,
                error: "TIKTOK_ERROR"
            });
            return;
        }

        elements = document.querySelectorAll(selector);
        
        // If we found 10 or more elements, the page is fully ready
        if (elements.length >= 10) {
            break;
        }
        
        // If the page is fully loaded and we have at least 4 elements, proceed (smaller channels)
        if (elements.length >= 4 && document.readyState === 'complete') {
            break;
        }
        
        await new Promise(r => setTimeout(r, 250));
    }
    
    // If we still don't have at least 4 elements, report failure
    if (elements.length < 4) {
        chrome.runtime.sendMessage({
            action: "SCRAPE_RESULT",
            success: false,
            error: "Không tìm thấy đủ video trên kênh."
        });
        return;
    }
    
    // Scroll down 400px to trigger lazy loading of views
    window.scrollTo({ top: 400, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 1200));
    
    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 300));
    
    // Rescrape elements after scroll to get fresh view values
    const finalElements = document.querySelectorAll(selector);
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
