# BACKUP — Phương án chống chặn IP: Chuyển cào view sang TAB THẬT

> ⚠️ **CẬP NHẬT 2026-06-26**: Thực tế bị chặn ở ~60-70 KOC = chặn theo VOLUME/IP, KHÔNG phải fingerprint.
> → Fallback sang tab thật VÔ DỤNG cho chặn IP (tab cùng IP cũng bị "Access Denied").
> Đã BỎ `forceTabMode`. Thay bằng **BACKOFF + RE-QUEUE** trong `js/app.js`:
>   - background `scrapeViaFetch` trả `error:'TIKTOK_BLOCKED'` khi 403/Access Denied → báo thẳng app (không mở tab).
>   - app `runWorker`: gặp TIKTOK_BLOCKED → cả 2 luồng nghỉ chung `blockPauseUntil` (60s→×1.5→tối đa 300s),
>     re-queue KOC đó vào cuối (`itemsWithLinks.push`, `total++`), tối đa 3 lần rồi mới đánh dấu lỗi.
> Tab thật (`loadInWorkerTab`) vẫn giữ làm fallback CHO LỖI PARSE (FETCH_NO_DATA), không cho lỗi chặn.
> Phương án B (chuyển hẳn tab thật) bên dưới giờ KHÔNG khuyến nghị cho chặn IP — chỉ hữu ích nếu bị chặn fingerprint.

> File này tự chứa đủ thông tin để thực hiện mà KHÔNG cần đọc lại context.
> Khi cần, mở file này và bảo Claude: "Thực hiện phương án trong backup.md".

## Bối cảnh / Khi nào dùng
- App cào view TikTok của KOC. Hiện đang bị Akamai (`errors.edgesuite.net`) trả **"Access Denied"** chặn theo IP khi cào nhiều.
- Đã giảm nhịp (2 luồng + cooldown 3-5s) nhưng gốc rủi ro là `scrapeViaFetch()` dùng `fetch()` thẳng — dễ bị fingerprint.
- **Dùng file này KHI: vẫn bị "Access Denied" dù đã giảm nhịp.**

## Cơ chế hiện tại (trước khi đổi)
Trong `extension/background.js`, handler `SCRAPE_TIKTOK`:
```
1. scrapeViaFetch(url)  ← fetch() thẳng tới tiktok.com (nhanh ~1s, DỄ bị chặn)
   ├─ success → trả views/userId/bio
   └─ fail    → loadInWorkerTab(url)  ← mở TAB THẬT (chậm ~3-5s, an toàn)
```
Đường tab thật (`loadInWorkerTab`) ĐÃ CÓ và chạy tốt — chỉ đang là fallback.
Tab thật: mở cửa sổ ẩn góc trái, 2 tab (=2 luồng), điều hướng tới `tiktok.com/@username`
như người thật → content_tiktok.js lấy data qua SSR JSON / chặn XHR / đọc DOM.
Tab được tái dùng + cycle active mỗi 2s để TikTok nghĩ tab đang xem.

---

## PHƯƠNG ÁN A — Auto-fallback (KHUYẾN NGHỊ)
Giữ fetch nhanh lúc bình thường; khi gặp "Access Denied" thì TỰ chuyển sang tab thật
cho toàn bộ KOC còn lại của phiên đó. Nhanh khi ổn, chậm chỉ khi cần.

### Cách làm trong `extension/background.js`:
1. Thêm cờ toàn cục đầu file: `let forceTabMode = false;`
2. Trong `scrapeViaFetch`, khi response báo bị chặn, set cờ. Tìm đoạn:
   ```js
   if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
   const html = await response.text();
   ```
   Sửa thành (bắt cả 403 lẫn trang "Access Denied"):
   ```js
   if (!response.ok || response.status === 403) {
       if (response.status === 403) forceTabMode = true;
       return { success: false, error: `HTTP ${response.status}` };
   }
   const html = await response.text();
   if (html.includes('Access Denied') || html.includes('edgesuite.net')) {
       forceTabMode = true;
       return { success: false, error: 'TIKTOK_BLOCKED' };
   }
   ```
3. Trong handler `SCRAPE_TIKTOK`, bọc fast-path bằng cờ. Tìm:
   ```js
   if (message.action === "SCRAPE_TIKTOK") {
       const senderTabId = sender.tab.id;
       const { url, index, tabType, workerId = 0 } = message;
       scrapeViaFetch(url).then(result => {
           if (result.success) { ...SCRAPE_FINISHED... }
           else { loadInWorkerTab(workerId, url, (tabId) => {
               pendingRequests[tabId] = { senderTabId, index, tabType, url };
               startTabCycle();
           }); }
       });
   }
   ```
   Sửa: nếu `forceTabMode` true thì BỎ QUA scrapeViaFetch, đi thẳng loadInWorkerTab:
   ```js
   if (message.action === "SCRAPE_TIKTOK") {
       const senderTabId = sender.tab.id;
       const { url, index, tabType, workerId = 0 } = message;
       const goTab = () => loadInWorkerTab(workerId, url, (tabId) => {
           pendingRequests[tabId] = { senderTabId, index, tabType, url };
           startTabCycle();
       });
       if (forceTabMode) { goTab(); return true; }
       scrapeViaFetch(url).then(result => {
           if (result.success) {
               chrome.tabs.sendMessage(senderTabId, {
                   action: "SCRAPE_FINISHED", index, tabType, url,
                   success: true, viewSum: result.viewSum, views: result.views,
                   userId: result.userId, bio: result.bio
               });
           } else { goTab(); }
       });
   }
   ```
4. Reset cờ khi đóng phiên cào — trong handler `CLOSE_SCRAPE_TAB` thêm: `forceTabMode = false;`

---

## PHƯƠNG ÁN B — Chuyển hẳn sang tab thật (luôn luôn)
Đơn giản nhất, chậm nhất. Trong handler `SCRAPE_TIKTOK` của `extension/background.js`,
BỎ HẲN `scrapeViaFetch`, luôn gọi `loadInWorkerTab`:
```js
if (message.action === "SCRAPE_TIKTOK") {
    const senderTabId = sender.tab.id;
    const { url, index, tabType, workerId = 0 } = message;
    loadInWorkerTab(workerId, url, (tabId) => {
        pendingRequests[tabId] = { senderTabId, index, tabType, url };
        startTabCycle();
    });
}
```
(Có thể giữ luôn hàm `scrapeViaFetch` trong file, không xóa, để dễ quay lại.)

---

## Sau khi đổi (cả A và B)
- **Tốc độ**: tab thật chậm ~3-5x. 100 KOC: fetch ~2 phút → tab thật ~6-8 phút.
- **Vẫn phải giữ giới hạn nhịp** (2 luồng + cooldown 3-5s ở `js/app.js`) — tab thật giảm
  rủi ro *fingerprint*, KHÔNG xóa rủi ro *rate* vì vẫn cùng 1 IP.
- Reload extension + refresh trang web để áp dụng.
- Kiểm tra: `node --check extension/background.js`.

## Nếu tab thật VẪN bị chặn
Lúc đó vấn đề là IP-rate, không phải fingerprint. Hạ tiếp:
- 2 luồng → 1 luồng (`js/app.js`: `const numThreads = isExtensionActive() ? 1 : 1;`)
- Tăng cooldown 3-5s → 6-10s.
- Hoặc đổi IP (4G/VPN/restart modem).
