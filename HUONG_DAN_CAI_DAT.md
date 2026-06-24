# Hướng Dẫn Sử Dụng Công Cụ KOC Toàn Diện Pro

---

## HƯỚNG DẪN SỬ DỤNG NHANH

### Bước 1 — Cài Extension

> Extension giúp công cụ tự động mở TikTok và lấy số view kênh.

1. Tải thư mục **`extension`** về máy
2. Mở Chrome, nhập vào thanh địa chỉ:
   ```
   chrome://extensions
   ```
3. Bật **Developer mode** (góc trên bên phải)
4. Bấm **Load unpacked** → chọn thư mục `extension` vừa tải
5. Extension **KOC TikTok View Extractor** xuất hiện trong danh sách → cài thành công
6. **Đăng nhập TikTok** trên Chrome (bắt buộc để lấy view)

---

### Bước 2 — Tải File Data KOC từ Kalodata (File A)

1. Vào **Kalodata** → xuất danh sách KOC ra file Excel
2. Mở công cụ tại:
   ```
   https://phongchau120498-svg.github.io/CongCuKOC
   ```
3. Kéo thả hoặc bấm chọn file vào ô **File A — File Data KOC**

> File A cần có: **KOC ID (cột C)**, **Link TikTok (cột R)**, **GMV (cột E)**

---

### Bước 3 — Tải File Đơn Hàng từ Web Công Ty (File B)

1. Vào web quản lý đơn hàng nội bộ → xuất danh sách đơn hàng ra file Excel
2. Kéo thả hoặc bấm chọn file vào ô **File B — File Đơn Hàng**

> File B cần có: **KOC ID (cột để đối chiếu)** và **Brand (tên thương hiệu)**

---

### Bước 4 — Chạy & Tải Kết Quả

1. Bấm **Tiến Hành Đối Chiếu Dữ Liệu** → hệ thống so sánh File A và File B
2. Xem kết quả ở tab **KOC Chưa Từng Gửi Đơn**
3. Bấm **Tự Động Cào View Kênh** → công cụ tự động mở TikTok và lấy số view từng kênh
4. Sau khi hoàn thành, bấm **Xuất Excel** để tải về danh sách các kênh **ĐẠT** (tổng view ≥ 1.500)

> Có thể bấm **Dừng cào** bất kỳ lúc nào và **Tiếp tục** sau — công cụ sẽ bỏ qua các kênh đã cào xong.

---

## CHI TIẾT CÀI ĐẶT EXTENSION

### Yêu cầu
- Trình duyệt **Google Chrome** (hoặc Edge/Brave dựa trên Chromium)
- Đã **đăng nhập TikTok** trên trình duyệt

### Các bước cài đặt

**1.** Tải thư mục `extension` về máy (gồm: `manifest.json`, `background.js`, `content_tiktok.js`, `content_localhost.js`)

**2.** Mở Chrome → nhập `chrome://extensions` → Enter

**3.** Bật **Developer mode** (góc trên phải)

**4.** Bấm **Load unpacked** → chọn thư mục `extension` → **Select Folder**

**5.** Extension xuất hiện trong danh sách là cài thành công ✅

### Kiểm tra hoạt động

Mở công cụ → nếu thấy nút **"Tự Động Cào View Kênh"** có thể bấm được là extension đang hoạt động.

---

## LƯU Ý

- Phải **đăng nhập TikTok** trên Chrome trước khi cào view
- Không đóng trình duyệt trong khi đang cào
- Nếu extension báo lỗi → vào `chrome://extensions` → bấm 🔄 reload extension → F5 lại trang công cụ
- Kênh **ĐẠT** = tổng view 7 video gần nhất (bỏ qua 3 video đầu) **≥ 1.500 view**

---

## CẬP NHẬT EXTENSION

1. Tải thư mục `extension` mới → ghi đè vào thư mục cũ
2. Vào `chrome://extensions` → bấm 🔄 trên **KOC TikTok View Extractor**
3. F5 lại trang công cụ
