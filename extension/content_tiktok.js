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
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const elements = document.querySelectorAll(selector);
        if (elements.length >= minCount) {
            return elements;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    return document.querySelectorAll(selector);
}

// Scrape logic
async function scrapeTikTokViews() {
    console.log("[KOC Extension] Starting views extraction on TikTok...");
    
    // Wait for the video views to load. If captcha is shown, this loop keeps running
    // giving the user time to solve it. Once solved, elements will appear and it will proceed.
    const elements = await waitForElements('[data-e2e="video-views"]', 10, 60000);
    
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
    
    console.log("[KOC Extension] Scraped views array:", views);
    
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
