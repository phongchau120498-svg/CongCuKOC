// Declare the extension is active by setting a DOM attribute on <html>
try {
    document.documentElement.setAttribute('data-koc-extension-active', 'true');
} catch (e) {
    console.error("[KOC Extension] Failed to set active attribute:", e);
}

// Listen to messages from the web page (js/app.js)
window.addEventListener("message", (event) => {
    if (event.source === window && event.data && event.data.type === "FROM_PAGE") {
        try {
            chrome.runtime.sendMessage(event.data);
        } catch (e) {
            // Extension reloaded mid-session — nhắc user refresh trang
            console.warn("[KOC] Extension context invalidated. Hãy refresh trang (F5).");
        }
    }
});

// Listen to messages from the extension background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SCRAPE_FINISHED" || message.action === "UPDATE_SCREENSHOT") {
        // Forward message to the web page
        window.postMessage({
            type: "TO_PAGE",
            data: message
        }, "*");
    }
});
