const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json());

// Ensure screenshots directory exists
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// Serve screenshots statically
app.use('/screenshots', express.static(SCREENSHOTS_DIR));

// Serve index.html and client assets from root directory
app.use(express.static(__dirname));

// Endpoint to check status of the server
app.get('/api/status', (req, res) => {
  res.json({ success: true, message: 'Screenshot helper is active.' });
});

// Endpoint to open the screenshots folder in the system file manager
app.post('/api/open-folder', (req, res) => {
  let command = '';
  if (process.platform === 'win32') {
    command = `start "" "${SCREENSHOTS_DIR}"`;
  } else if (process.platform === 'darwin') {
    command = `open "${SCREENSHOTS_DIR}"`;
  } else {
    command = `xdg-open "${SCREENSHOTS_DIR}"`;
  }

  exec(command, (err) => {
    if (err) {
      console.error('Failed to open folder:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true });
  });
});

// Helper to sanitize filename
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Endpoint to take a screenshot
app.post('/api/screenshot', async (req, res) => {
  const { id, url, headless = true, delay = 3000 } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL is required.' });
  }

  const safeId = sanitizeFilename(id || 'koc_channel');
  const filename = `${safeId}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);

  let browser = null;
  try {
    // Launch puppeteer with settings to reduce bot detection
    browser = await puppeteer.launch({
      headless: headless,
      defaultViewport: { width: 1280, height: 960 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,960'
      ]
    });

    const page = await browser.newPage();
    
    // Set custom user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Bypass webdriver check
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    console.log(`Navigating to: ${url}`);
    
    // Go to URL and wait until page loaded
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });

    // Wait for the video grid to appear (indicating page is loaded and captcha is solved)
    console.log('Waiting for video grid items to load...');
    try {
      await page.waitForSelector('[data-e2e="user-post-item"], [class*="PlayIcon"], [class*="DivPostItem"]', {
        timeout: 90000 // Give user 90 seconds to solve captcha
      });
      console.log('Video grid items detected.');
    } catch (selectorErr) {
      console.warn('Timeout waiting for video items (maybe private, empty, or captcha not solved). Proceeding...');
    }

    // Custom delay to let the page fully render dynamic views
    console.log(`Waiting for ${delay}ms...`);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Scroll down to trigger lazy loading of view counts
    console.log('Scrolling down to trigger views lazy-load...');
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Scroll back to top to align header properly
    console.log('Scrolling back to top...');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Scrape view counts
    console.log('Scraping view counts...');
    const views = await page.evaluate(() => {
      // Find all view count elements
      const elList = document.querySelectorAll('[data-e2e="video-views"]');
      if (elList.length > 0) {
        return Array.from(elList).map(el => el.textContent.trim());
      }
      
      // Fallback selector 1
      const fallbackList = document.querySelectorAll('strong[class*="VideoCount"], [class*="StrongVideoCount"]');
      if (fallbackList.length > 0) {
        return Array.from(fallbackList).map(el => el.textContent.trim());
      }
      
      // Fallback selector 2
      const postItems = document.querySelectorAll('[data-e2e="user-post-item"], [class*="DivPostItem"]');
      if (postItems.length > 0) {
        return Array.from(postItems).map(item => {
          const countEl = item.querySelector('strong, span[class*="Count"], div[class*="views"]');
          return countEl ? countEl.textContent.trim() : '0';
        });
      }
      
      return [];
    });
    console.log(`Scraped ${views.length} video views:`, views);

    // Parse views helper
    const parseTikTokView = (viewText) => {
      if (!viewText) return 0;
      let cleanText = viewText.replace(/[^\d.kmKM]/g, '').toLowerCase().trim();
      if (!cleanText) return 0;
      if (cleanText.endsWith('k')) {
        return parseFloat(cleanText.replace('k', '')) * 1000;
      }
      if (cleanText.endsWith('m')) {
        return parseFloat(cleanText.replace('m', '')) * 1000000;
      }
      return parseFloat(cleanText) || 0;
    };

    const parsedViewsList = views.map(parseTikTokView);
    
    // Sum from 4th video (index 3) to 10th video (index 9)
    const targetViews = parsedViewsList.slice(3, 10);
    const viewSum = targetViews.reduce((sum, val) => sum + val, 0);
    const isRejected = viewSum < 1500;

    // Capture screenshot
    await page.screenshot({ path: filepath });
    console.log(`Screenshot saved to: ${filepath}`);

    res.json({
      success: true,
      filename: filename,
      localPath: filepath,
      url: `http://localhost:${PORT}/screenshots/${filename}?t=${new Date().getTime()}`, // timestamp to prevent browser cache
      views: views,
      parsedViews: parsedViewsList,
      viewSum: viewSum,
      isRejected: isRejected
    });

  } catch (err) {
    console.error('Error during screenshot capture:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 ĐÃ KHỞI CHẠY TOOL ĐỐI CHIẾU KOC THÀNH CÔNG!`);
  console.log(`👉 Nhấp vào link này để mở ứng dụng: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
  console.log(`Screenshots will be saved in: ${SCREENSHOTS_DIR}`);
});
