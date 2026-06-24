// Inject a variable into the page context to declare the extension is active
const injectScript = () => {
    try {
        const script = document.createElement('script');
        script.textContent = 'window.__KOC_EXTENSION_ACTIVE__ = true;';
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    } catch (e) {
        console.error("[KOC Extension] Failed to inject active flag:", e);
    }
};
injectScript();

// Listen to messages from the web page (js/app.js)
window.addEventListener("message", (event) => {
    if (event.source === window && event.data && event.data.type === "FROM_PAGE") {
        chrome.runtime.sendMessage(event.data);
    }
});

// Listen to messages from the extension background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "SCRAPE_FINISHED") {
        // Forward message to the web page
        window.postMessage({
            type: "TO_PAGE",
            data: message
        }, "*");
    }
});
