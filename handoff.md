# 📋 HANDOFF: KOC TikTok View Extractor — Bàn giao cho Agent mới

> **Mục tiêu ưu tiên tuyệt đối**: Extension mở link TikTok lên → Lấy tổng số view của kênh → Trả kết quả về đúng, không lỗi, không rỗng, nhanh nhất có thể.

---

## 1. Tổng quan ứng dụng

Đây là công cụ nội bộ dành cho team Marketing để:
1. **Đối chiếu dữ liệu KOC (Key Opinion Customer)**: So khớp danh sách KOC từ File A (KOC chưa gửi đơn) với File B (KOC đã gửi đơn) qua file Excel.
2. **Cào view TikTok tự động**: Dùng browser extension để mở link TikTok của từng KOC, lấy tổng số view của 7 video gần nhất, và dán ngược kết quả vào bảng.
3. **Xuất báo cáo Excel**: Xuất kết quả đối chiếu + view đã cào ra file `.xlsx`.

**Tính năng Chụp ảnh màn hình đã bị XÓA hoàn toàn** theo yêu cầu của user. Không cần khôi phục.

---

## 2. Cấu trúc thư mục

```
CongCuKOC/
├── index.html              # Giao diện chính (Single-page app, không dùng framework)
├── css/
│   └── style.css           # Toàn bộ CSS (dark mode, glassmorphism)
├── js/
│   └── app.js              # Toàn bộ logic frontend (đọc Excel, đối chiếu, batch worker)
├── extension/
│   ├── manifest.json       # Manifest V3 Chrome Extension
│   ├── background.js       # Service worker: quản lý worker tabs, nhận kết quả từ content script
│   ├── content_localhost.js # Bridge: inject vào localhost, relay message từ app → background
│   └── content_tiktok.js   # Content script: chạy trong tab TikTok, cào view và gửi kết quả
├── server.js               # Express server phụ trợ (hiện không còn dùng cho cào view, chỉ serve static files)
└── package.json
```

---

## 3. Luồng hoạt động hiện tại (End-to-End)

```
[app.js - scrapeViaExtension()]
        │
        │ window.postMessage("FROM_PAGE", { action: "SCRAPE_TIKTOK", url, index, workerId })
        ▼
[content_localhost.js]
        │
        │ chrome.runtime.sendMessage(event.data)
        ▼
[background.js - onMessage("SCRAPE_TIKTOK")]
        │
        │ chrome.tabs.update(workerTabs[workerId], { url })   ← Dùng lại tab cũ, không tạo mới!
        │ (Hoặc chrome.tabs.create nếu tab chưa tồn tại)
        │ Lưu pendingRequests[tabId] = { senderTabId, index, tabType, url }
        ▼
[content_tiktok.js - scrapeTikTokViews()]
        │
        │ 1. Thử JSON extraction từ <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"> (ưu tiên, không cần tab visible)
        │ 2. Fallback: DOM polling cho [data-e2e="video-views"] (tối đa 25 giây)
        │
        │ chrome.runtime.sendMessage({ action: "SCRAPE_RESULT", success, viewSum, views })
        ▼
[background.js - onMessage("SCRAPE_RESULT")]
        │
        │ chrome.tabs.sendMessage(senderTabId, { action: "SCRAPE_FINISHED", ... })
        ▼
[content_localhost.js - onMessage("SCRAPE_FINISHED")]
        │
        │ window.postMessage("TO_PAGE", { data: message })
        ▼
[app.js - handleScrapeResultFromExtension()]
        │
        │ Cập nhật item.viewSum, item.views, item.isRejected
        │ Resolve Promise của worker → worker tiếp tục link tiếp theo
        │ renderTable() → Hiển thị kết quả lên bảng
```

---

## 4. Chi tiết các file quan trọng

### `extension/background.js`
- **Vai trò**: Service worker, điều phối toàn bộ việc mở tab và nhận kết quả.
- **Cơ chế tab**: Dùng pool `workerTabs = { workerId: tabId }`. Mỗi lần cào link mới, gọi `chrome.tabs.update(tabId, { url })` thay vì tạo tab mới → tiết kiệm tài nguyên.
- **Lưu ý**: Nếu tab đã bị user đóng, `chrome.tabs.update` sẽ fail → fallback tự tạo tab mới.
- **Kết quả được relay**: Sau khi nhận `SCRAPE_RESULT` từ content script, gửi `SCRAPE_FINISHED` lại cho tab localhost (senderTabId).

### `extension/content_tiktok.js` ← **FILE QUAN TRỌNG NHẤT**
- **Chạy tại**: `document_end` của mọi trang `https://*.tiktok.com/*`
- **Hàm chính**: `scrapeTikTokViews()`

#### Cơ chế lấy view (2 tầng):

**Tầng 1 – JSON Extraction (Ưu tiên)**
```
tryExtractViewsFromScriptTags()
  → Đọc <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"> hoặc <script id="SIGI_STATE">
  → Parse JSON → tìm mảng itemList/itemStruct/ItemModule chứa { stats: { playCount } }
  → Xác thực: uniqueId trong JSON phải khớp với username trong URL
  → Trả về mảng playCount[] nếu có ≥ 4 video
```
**Ưu điểm**: Không cần tab visible, không bị IntersectionObserver block → Nhanh nhất.
**Nhược điểm**: TikTok đôi khi không embed JSON (trang lỗi, kênh riêng tư, hoặc đã thay đổi cấu trúc).

**Tầng 2 – DOM Extraction (Fallback)**
```
instantWaitForElements(['[data-e2e="video-views"]', ...], minCount=10, timeout=25000)
  → Poll DOM mỗi 300ms
  → Khi tìm thấy ≥ 10 phần tử có text → chờ thêm 1.5s để settle → lấy giá trị
  → Nếu phát hiện trang lỗi ("Đã xảy ra lỗi") → tự reload trang (tối đa 2 lần)
  → Nếu phát hiện captcha → reset timer để đợi user giải
```

#### Công thức tính `viewSum`:
```javascript
const viewsToSum = playCounts.slice(3, 10); // Bỏ qua 3 video đầu, lấy video 4→10
viewSum = viewsToSum.reduce((a, b) => a + b, 0);
```
> ⚠️ **Tại sao slice(3, 10)?** – Yêu cầu nghiệp vụ: bỏ qua 3 video "viral nhất" (pinned), lấy tổng 7 video tiếp theo để đánh giá hiệu suất thực tế của kênh.

### `extension/content_localhost.js`
- Script đơn giản, chỉ 25 dòng.
- Inject vào trang localhost → đánh dấu `data-koc-extension-active="true"` trên `<html>`.
- Relay message 2 chiều giữa `app.js` (window.postMessage) và `background.js` (chrome.runtime).

### `js/app.js` — Logic Frontend
- **`scrapeViaExtension(link, absoluteIndex, type, workerId)`**: Tạo Promise, lưu resolver vào `activeScrapeResolvers[absoluteIndex]`, gửi message đến extension.
- **`handleScrapeResultFromExtension(result)`**: Nhận kết quả từ extension, tìm item đúng theo `index + tabType`, cập nhật state, resolve Promise.
- **`startBatchProcessing()`**: Tạo 5 worker (`runWorker(0..4)`) chạy song song. Mỗi worker lấy link tiếp theo từ queue và gọi `scrapeViaExtension`.
- **Stagger delay**: Mỗi worker có độ trễ `1500 + (workerId * 800)ms` trước khi bắt đầu để tránh rate-limit của TikTok.

---

## 5. Vấn đề đã biết & Trạng thái hiện tại

### ✅ Đã giải quyết
| Vấn đề | Giải pháp |
|---|---|
| Tab ngầm không render view (IntersectionObserver) | Dùng JSON extraction làm tầng ưu tiên |
| Rate-limit từ TikTok | Stagger delay giữa các worker |
| Tab bị đóng → lỗi | Fallback tạo tab mới nếu `chrome.tabs.update` fail |
| Trang lỗi không tự hồi phục | In-page reload tối đa 2 lần via `sessionStorage` |
| Lấy view quá sớm (DOM chưa settle) | Kiểm tra text content ≠ rỗng + chờ 1.5s |
| Retry loop gây skip link | Xóa bỏ hoàn toàn cơ chế retry trong background.js |

### ❌ Vấn đề chưa giải quyết (ưu tiên xử lý tiếp)

1. **Extension dừng hoạt động sau khi xóa tính năng chụp ảnh**: Có thể còn một số reference đến hàm `showHelperInstructions()` bị orphan trong `app.js` (dòng 956 và 1000) gây lỗi runtime khi bấm nút. **Cần kiểm tra và xóa nốt**.

2. **JSON extraction miss khi TikTok thay đổi cấu trúc**: Hàm `findItems()` chỉ đọc sâu tối đa 3 cấp. Nếu TikTok cập nhật cấu trúc JSON, cần update path. Nên thêm fallback general traverse đã có sẵn trong lịch sử commit.

3. **`screenshotStatus` vẫn còn trong data model** (dòng 469, 478 trong app.js): Các object item vẫn có các field `screenshotStatus`, `screenshotUrl`, `screenshotError`. Không gây lỗi nhưng cần dọn dẹp cho sạch.

4. **`captureSingle()` function ở app.js bị rewrite dở** (khoảng dòng 1000+): Bị hỏng trong lần refactor xóa screenshot. Nếu không dùng nữa thì xóa hẳn.

---

## 6. Cách cài đặt & chạy

### Chạy web app
```bash
cd "/home/thanh-phong/CTP DESKTOP/CongCuKOC"
npm run dev
# → Mở http://localhost:3000
```

### Load extension
1. Mở Chrome → `chrome://extensions/`
2. Bật "Developer mode"
3. "Load unpacked" → chọn thư mục `extension/`
4. Sau mỗi lần sửa code extension → nhấn nút ↺ **Reload**

### Kiểm tra extension hoạt động
- Mở `http://localhost:3000`
- Kiểm tra: `document.documentElement.hasAttribute('data-koc-extension-active')` phải trả về `true` trong DevTools Console
- Nếu `false` → Extension chưa load hoặc cần Reload

---

## 7. Yêu cầu kỹ thuật để agent mới tối ưu

### Mục tiêu
Extension mở link TikTok → lấy tổng số view (viewSum) → **không lỗi, không rỗng, nhanh nhất**.

### Định nghĩa "Thành công"
```javascript
{
  success: true,
  viewSum: 15400000,   // Tổng view video 4→10 (số nguyên)
  views: [5200000, 4100000, ...] // Mảng view của từng video (theo thứ tự trên trang)
}
```

### Định nghĩa "Thất bại có thể retry"
- `error: "TIKTOK_ERROR"` → TikTok trả về trang lỗi tạm thời → **nên retry sau 2-3 giây**

### Định nghĩa "Thất bại vĩnh viễn (không retry)"
- `error: "Phát hiện captcha"` → Cần user giải thủ công
- `error: "Không tìm thấy đủ video"` → Kênh riêng tư hoặc ít hơn 4 video

### Các điều kiện cần đảm bảo trong `content_tiktok.js`
1. Phải verify JSON username khớp với URL trước khi parse (tránh lấy data của kênh khác khi URL chuyển hướng)
2. Nếu `viewSum = 0` dù `success = true` → **không nên trả về thành công**, phải kiểm tra thêm
3. Selector `[data-e2e="video-views"]` là chính xác nhất, các selector fallback có thể lấy sai element

### Điều kiện "Đạt Loại" (nghiệp vụ)
```javascript
item.isRejected = viewSum < 1500; // Dưới 1500 view tổng → LOẠI
```

---

## 8. Các file không cần đụng đến

- `server.js`: Chỉ là Express server serve file tĩnh. Không còn logic cào view nữa.
- `css/style.css`: Giao diện đã hoàn thiện.
- `generate-mock.js`: Script test sinh dữ liệu giả.
- `fileA.xlsx`, `fileB.xlsx`: File Excel mẫu để test.

---

## 9. Git history tóm tắt (gần nhất)

```
45a8fe6 refactor: completely remove screenshot feature and related UI/backend logic
f730704 fix: implement smart in-page reload for TikTok error screens and content validation delay
17bf4f4 feat: restore fixed worker tabs, remove retry loops, and implement instant grab logic
e835690 fix: restore JSON extraction for background tabs and stagger requests to prevent TikTok rate limits
```

---

## 10. Tóm tắt việc cần làm ngay cho agent mới

1. **[BUG KHẨN]** Fix `showHelperInstructions()` còn bị gọi tại dòng ~956 và ~1000 trong `app.js` → Xóa hoặc thay thế bằng `showToast(...)`.
2. **[BUG KHẨN]** Kiểm tra `captureSingle()` function bị viết dở (khoảng dòng 985-1033 trong app.js) → Xóa hẳn nếu không dùng.
3. **[CLEANUP]** Xóa các field `screenshotStatus/Url/Error` khỏi data model trong `app.js`.
4. **[OPTIMIZE]** Nếu `views` và `viewSum` đều là 0 sau JSON parse → cần cơ chế detect và retry lấy lại data.
5. **[OPTIONAL]** Sau khi cào xong hết, gọi `closeScrapeTabViaExtension()` để đóng sạch 5 worker tabs.
