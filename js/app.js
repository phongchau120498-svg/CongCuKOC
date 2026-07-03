        // --- PAGE NAVIGATION ---
        function showPage(page) {
            document.getElementById('page-reconcile').style.display = page === 'reconcile' ? '' : 'none';
            document.getElementById('page-messaging').style.display = page === 'messaging' ? '' : 'none';
            document.getElementById('nav-reconcile').classList.toggle('active', page === 'reconcile');
            document.getElementById('nav-messaging').classList.toggle('active', page === 'messaging');
        }

        // --- THEME MANAGEMENT ---
        const themeToggle = document.getElementById('themeToggle');
        const themeIcon = document.getElementById('themeIcon');
        
        // Load saved theme or default to light
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-theme');
            updateThemeIcon(true);
        }

        // Nút theme nằm trong header đã bỏ → guard null
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const isDark = document.body.classList.toggle('dark-theme');
                localStorage.setItem('theme', isDark ? 'dark' : 'light');
                updateThemeIcon(isDark);
                showToast(isDark ? 'Đã kích hoạt chế độ Tối' : 'Đã kích hoạt chế độ Sáng', 'info');
            });
        }

        function updateThemeIcon(isDark) {
            if (!themeIcon) return;
            if (isDark) {
                themeIcon.innerHTML = `
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>
                `;
            } else {
                themeIcon.innerHTML = `
                    <circle cx="12" cy="12" r="4"></circle>
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
                `;
            }
        }

        // --- TOAST NOTIFICATIONS ---
        function showToast(message, type = 'info') {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            
            let icon = '';
            if (type === 'success') {
                icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            } else if (type === 'error') {
                icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
            } else {
                icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
            }

            toast.innerHTML = `${icon} <span>${message}</span>`;
            container.appendChild(toast);

            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(20px)';
                toast.style.transition = 'all 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        // --- ACCORDION CONFIG ---
        const configTrigger = document.getElementById('configTrigger');
        const configContent = document.getElementById('configContent');
        
        configTrigger.addEventListener('click', () => {
            configTrigger.classList.toggle('active');
            configContent.classList.toggle('active');
        });

        // --- EXCEL COLUMN LETTER CONVERTER ---
        function excelLetterToCol(letter) {
            if (!letter) return 0;
            letter = letter.toUpperCase().replace(/[^A-Z]/g, '');
            let column = 0;
            let length = letter.length;
            for (let i = 0; i < length; i++) {
                column += (letter.charCodeAt(i) - 64) * Math.pow(26, length - i - 1);
            }
            return column - 1;
        }

        function colToExcelLetter(col) {
            let letter = "";
            while (col >= 0) {
                letter = String.fromCharCode((col % 26) + 65) + letter;
                col = Math.floor(col / 26) - 1;
            }
            return letter;
        }

        // --- TIKWM API SCRAPER (thay extension cho khâu cào view) ---
        const TIKWM_MAX_RETRY = 3;
        const TIKWM_TIMEOUT_MS = 25000;

        // fetch có timeout (copy pattern từ code React tham chiếu)
        async function fetchWithTimeout(url, timeoutMs = TIKWM_TIMEOUT_MS) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                return await fetch(url, { signal: ctrl.signal });
            } finally {
                clearTimeout(timer);
            }
        }

        // Pool 3 nguồn lấy user/posts: tikwm trực tiếp → 2 proxy fallback khi bị rate-limit/chặn
        const TIKWM_POOL = [
            async (username) => {
                const res = await fetchWithTimeout(`https://tikwm.com/api/user/posts?unique_id=${encodeURIComponent(username)}&count=12`);
                return res.json();
            },
            async (username) => {
                const target = `https://tikwm.com/api/user/posts?unique_id=${username}&count=12`;
                const res = await fetchWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`);
                return res.json();
            },
            async (username) => {
                const target = `https://tikwm.com/api/user/posts?unique_id=${username}&count=12`;
                const res = await fetchWithTimeout(`https://api.allorigins.win/get?url=${encodeURIComponent(target)}`);
                const data = await res.json();
                return JSON.parse(data.contents);
            },
        ];

        // Cào view 1 KOC qua tikwm. Trả về CÙNG shape với result cũ của extension
        // để downstream (worker, render, export) không phải sửa.
        async function scrapeViaTikwm(link) {
            const username = link.split('@')[1]?.split(/[/?#]/)[0]?.toLowerCase();
            if (!username) return { success: false, error: 'BAD_LINK' };

            let rateLimited = false;
            for (let apiIdx = 0; apiIdx < TIKWM_POOL.length; apiIdx++) {
                for (let retry = 0; retry < TIKWM_MAX_RETRY; retry++) {
                    try {
                        const json = await TIKWM_POOL[apiIdx](username);
                        if (json && json.code === 0 && Array.isArray(json.data?.videos)) {
                            const videos = json.data.videos;
                            if (videos.length < 4) return { success: false, error: 'FETCH_NO_DATA' };
                            const views = videos.map(v => parseInt(v.play_count) || 0);
                            const viewSum = views.slice(3, 10).reduce((a, b) => a + b, 0); // logic cũ: bỏ 3 video ghim đầu, cộng 7 video
                            // covers + coverViews căn cùng index (chỉ video có ảnh bìa) để badge view khớp đúng ảnh
                            const withCover = videos.filter(v => v.cover).slice(0, 9);
                            const covers = withCover.map(v => v.cover);
                            const coverViews = withCover.map(v => parseInt(v.play_count) || 0);
                            const userId = videos[0]?.author?.id || null;
                            return { success: true, viewSum, views, covers, coverViews, userId, bio: '', isRejected: viewSum < 1500 };
                        }
                        // code === -1 = "Free Api Limit" → rate-limit, backoff rồi thử API kế
                        if (json && json.code === -1) {
                            rateLimited = true;
                            await new Promise(r => setTimeout(r, 1500 * (retry + 1)));
                            continue;
                        }
                        // code khác (user không tồn tại / private) → không retry API này
                        break;
                    } catch (err) {
                        await new Promise(r => setTimeout(r, 2000 * (retry + 1)));
                    }
                }
            }
            return { success: false, error: rateLimited ? 'RATE_LIMIT' : 'FETCH_NO_DATA' };
        }

        // --- CHROME EXTENSION SCRAPER INTEGRATION (chỉ còn dùng cho NHẮN TIN) ---
        let activeScrapeResolvers = {}; // index -> resolve function
        let coversCache = {}; // koc id -> [base64 covers] (cho lightbox xem 1 lần cả 9 ảnh)
        const selectedUnmatch = new Set(); // id các KOC đạt được tick để xuất riêng

        function toggleSelectUnmatch(key, checked) {
            if (checked) selectedUnmatch.add(key); else selectedUnmatch.delete(key);
            updateSelectedCount();
        }
        function updateSelectedCount() {
            const el = document.getElementById('unmatchSelCount');
            if (el) el.textContent = selectedUnmatch.size;
        }

        function isExtensionActive() {
            return document.documentElement.hasAttribute('data-koc-extension-active');
        }

        function scrapeViaExtension(link, absoluteIndex, type, workerId = 0) {
            return new Promise((resolve) => {
                activeScrapeResolvers[absoluteIndex] = resolve;
                window.postMessage({
                    type: "FROM_PAGE",
                    action: "SCRAPE_TIKTOK",
                    url: link,
                    index: absoluteIndex,
                    tabType: type,
                    workerId: workerId
                }, "*");
                // ponytail: 35s timeout bảo vệ worker khỏi treo nếu content script không inject được
                setTimeout(() => {
                    if (activeScrapeResolvers[absoluteIndex]) {
                        delete activeScrapeResolvers[absoluteIndex];
                        resolve({ success: false, error: 'TIMEOUT' });
                    }
                }, 90000);
            });
        }

        function closeScrapeTabViaExtension() {
            window.postMessage({
                type: "FROM_PAGE",
                action: "CLOSE_SCRAPE_TAB"
            }, "*");
        }


        window.addEventListener("message", (event) => {
            if (event.data && event.data.type === "TO_PAGE") {
                const result = event.data.data;
                if (result.action === "MESSAGE_FINISHED") {
                    const resolve = msgResolvers[result.index];
                    if (resolve) { delete msgResolvers[result.index]; resolve(result); }
                } else {
                    handleScrapeResultFromExtension(result);
                }
            }
        });

        function handleScrapeResultFromExtension(result) {
            const { index, tabType, success, viewSum, views, covers, error, userId, bio } = result;

            let listToSearch = [];
            if (tabType === 'unmatch') listToSearch = unmatchedTotalData;
            else if (tabType === 'match') listToSearch = matchedTotalData;
            else if (tabType === 'brand') listToSearch = missingBrandDataFiltered;

            const item = listToSearch[index];
            if (!item) return;

            if (success) {
                item.screenshotStatus = 'done';
                item.views = views;
                item.viewSum = viewSum;
                item.userId = userId || item.userId;
                item.bio = bio || item.bio;
                item.covers = (covers && covers.length) ? covers : (item.covers || []);
                item.isRejected = viewSum < 1500;
                showToast(`Trích xuất thành công: ${item.id || item.valC}`, 'success');
            } else {
                item.screenshotStatus = 'error';
                item.screenshotError = error || 'Lỗi trích xuất';
                showToast(`Lỗi: ${item.screenshotError}`, 'error');
            }

            renderTable(tabType);

            const resolve = activeScrapeResolvers[index];
            if (resolve) {
                result.isRejected = viewSum < 1500;
                delete activeScrapeResolvers[index];
                resolve(result);
            }
        }

        // --- DRAG AND DROP HANDLERS ---
        function setupDragAndDrop(dropzoneId, inputId, infoId, nameId, sizeId, clearId, fileStoreKey) {
            const dropzone = document.getElementById(dropzoneId);
            const input = document.getElementById(inputId);
            const info = document.getElementById(infoId);
            const nameEl = document.getElementById(nameId);
            const sizeEl = document.getElementById(sizeId);
            const clearBtn = document.getElementById(clearId);

            let uploadedFile = null;

            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });

            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('dragover');
            });

            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                if (e.dataTransfer.files.length) {
                    handleFile(e.dataTransfer.files[0]);
                }
            });

            input.addEventListener('change', (e) => {
                if (input.files.length) {
                    handleFile(input.files[0]);
                }
            });

            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                resetFile();
            });

            function handleFile(file) {
                const ext = file.name.split('.').pop().toLowerCase();
                if (!['xlsx', 'xls', 'csv'].includes(ext)) {
                    showToast('Định dạng file không hỗ trợ! Vui lòng chọn .xlsx, .xls, .csv', 'error');
                    return;
                }
                uploadedFile = file;
                nameEl.textContent = file.name;
                
                // Format file size
                const sizeKB = (file.size / 1024).toFixed(1);
                sizeEl.textContent = sizeKB > 1024 
                    ? `(${(sizeKB / 1024).toFixed(1)} MB)` 
                    : `(${sizeKB} KB)`;
                
                dropzone.style.display = 'none';
                info.classList.add('active');
                
                filesData[fileStoreKey] = file;
                showToast(`Đã nhận file: ${file.name}`, 'success');

                // Đủ 2 file → tự động đối chiếu (không cần bấm nút)
                if (filesData.fileA && filesData.fileB) runReconciliation();
            }

            function resetFile() {
                uploadedFile = null;
                input.value = '';
                filesData[fileStoreKey] = null;
                info.classList.remove('active');
                dropzone.style.display = 'flex';
                showToast('Đã xóa file đính kèm', 'info');
            }
        }

        const filesData = {
            fileA: null,
            fileB: null
        };

        setupDragAndDrop('dropzoneA', 'fileA', 'fileInfoA', 'fileNameA', 'fileSizeA', 'btnClearA', 'fileA');
        setupDragAndDrop('dropzoneB', 'fileB', 'fileInfoB', 'fileNameB', 'fileSizeB', 'btnClearB', 'fileB');

        // --- DOWNLOAD TEMPLATE FUNCTION ---
        function downloadTemplate(type) {
            let data, name;
            if (type === 'A') {
                data = [
                    ["Cột A", "Cột B", "KOC ID (Cột C)", "D","E","F","G","H","I","J","K","L","M","N","O","P","Q", "Link TikTok (Cột R)"],
                    ["", "", "KOC_001", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "https://www.tiktok.com/@sansalecungtiktok.cn"],
                    ["", "", "KOC_002", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "https://www.tiktok.com/@nasa"],
                    ["", "", "KOC_003", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "https://www.tiktok.com/@google"]
                ];
                name = "File_A_Mau_KOC";
            } else {
                data = [
                    ["Cột A","Cột B","Cột C","Cột D", "KOC ID (Cột E)", "F","G","H","I","J","K","L","M", "Brand (Cột N)"],
                    ["", "", "", "", "KOC_001", "", "", "", "", "", "", "", "", "L'Oreal"],
                    ["", "", "", "", "KOC_001", "", "", "", "", "", "", "", "", "Maybelline"],
                    ["", "", "", "", "KOC_002", "", "", "", "", "", "", "", "", "L'Oreal"]
                ];
                name = "File_B_Mau_Don_Hang";
            }
            const ws = XLSX.utils.aoa_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
            XLSX.writeFile(wb, `${name}.xlsx`);
            showToast(`Đã tải xuống file mẫu ${type}`, 'success');
        }

        // --- CORE RECONCILIATION DATA ---
        let unmatchedTotalData = [];
        let matchedTotalData = [];
        let missingBrandDataFiltered = []; // Matches that don't have selected brand
        
        let allBrandsSet = new Set();
        let reconciliationChartInstance = null;

        // Pagination States
        const pagination = {
            unmatch: { page: 1, limit: 30, total: 0, filtered: [], search: '' },
            brand: { page: 1, limit: 30, total: 0, filtered: [], search: '' },
            match: { page: 1, limit: 30, total: 0, filtered: [], search: '' }
        };

        // --- READ EXCEL HELPER ---
        function readExcel(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const sheet = workbook.Sheets[workbook.SheetNames[0]];
                        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
                        resolve(jsonData);
                    } catch (err) {
                        reject(err);
                    }
                };
                reader.onerror = () => reject(new Error('FileReader error'));
                reader.readAsArrayBuffer(file);
            });
        }

        // --- RUN PROCESS RECONCILIATION ---
        // Tự động chạy khi đủ 2 file (gọi từ handleFile). Bỏ nút + checkbox thủ công.
        async function runReconciliation() {
            if (!filesData.fileA || !filesData.fileB) {
                showToast('Vui lòng chọn cả 2 file (File KOC & File Đơn Hàng) trước khi tiếp tục', 'error');
                return;
            }

            const skipHeader = true; // luôn bỏ qua dòng tiêu đề (mặc định)
            
            // Read column mapping values and convert from Excel letters to 0-based index
            const indexA_Id = excelLetterToCol(document.getElementById('colAId').value);
            const indexA_Link = excelLetterToCol(document.getElementById('colATikTok').value);
            
            const indexB_Compare = excelLetterToCol(document.getElementById('colBCompare').value);
            const indexB_Brand = excelLetterToCol(document.getElementById('colBBrand').value);
            const indexB_Staff = excelLetterToCol('P'); // Cột P = Nhân sự phụ trách

            // Display loading indicator
            document.getElementById('loading').style.display = 'block';
            document.getElementById('resultArea').style.display = 'none';

            try {
                // Read files in parallel
                const [dataA, dataB] = await Promise.all([
                    readExcel(filesData.fileA),
                    readExcel(filesData.fileB)
                ]);

                const startRow = skipHeader ? 1 : 0;
                
                // 1. Process File B (Orders)
                const mapB = new Map(); // Compare Value (lowercase) -> Set of Brands
                const mapBStaff = new Map(); // Compare Value (lowercase) -> Set of Nhân sự (cột P)
                allBrandsSet = new Set();

                for (let i = startRow; i < dataB.length; i++) {
                    const row = dataB[i];
                    if (!row || row.length === 0) continue;

                    let valE = row[indexB_Compare] ? String(row[indexB_Compare]).trim().toLowerCase() : "";
                    let valN = row[indexB_Brand] ? String(row[indexB_Brand]).trim() : "";
                    let valP = row[indexB_Staff] ? String(row[indexB_Staff]).trim() : "";

                    if (valE) {
                        if (!mapB.has(valE)) {
                            mapB.set(valE, new Set());
                            mapBStaff.set(valE, new Set());
                        }
                        if (valN) {
                            mapB.get(valE).add(valN);
                            allBrandsSet.add(valN);
                        }
                        if (valP) mapBStaff.get(valE).add(valP);
                    }
                }

                // Populate Brand Select element
                const brandSelect = document.getElementById('brandSelector');
                brandSelect.innerHTML = '<option value="">-- Chọn Brand (Cột N) --</option>';
                
                // Sort brands alphabetically
                Array.from(allBrandsSet).sort().forEach(brand => {
                    const opt = document.createElement('option');
                    opt.value = brand;
                    opt.textContent = brand;
                    brandSelect.appendChild(opt);
                });

                if (document.getElementById('brandCount')) document.getElementById('brandCount').textContent = allBrandsSet.size;

                // 2. Process File A (KOCs)
                unmatchedTotalData = [];
                matchedTotalData = [];
                let totalProcessedA = 0;

                for (let i = startRow; i < dataA.length; i++) {
                    const row = dataA[i];
                    if (!row || row.length === 0) continue;

                    let valId = row[indexA_Id] ? String(row[indexA_Id]).trim() : "";
                    let valC = valId;
                    let valLink = row[indexA_Link] ? String(row[indexA_Link]).trim() : "";
                    // Bỏ dòng trống: không có KOC ID lẫn link → không đếm
                    if (!valId && !valLink) continue;

                    totalProcessedA++;
                    let valGMV = row[4] !== undefined && row[4] !== null ? row[4] : "";
                    
                    // Normalize TikTok link: fallback to KOC ID if not a full URL
                    if (valLink) {
                        if (!valLink.startsWith('http')) {
                            let cleanUser = valLink;
                            if (cleanUser.startsWith('@')) {
                                cleanUser = cleanUser.substring(1);
                            }
                            valLink = `https://www.tiktok.com/@${cleanUser}`;
                        }
                    } else if (valId) {
                        let cleanUser = valId;
                        if (cleanUser.startsWith('@')) {
                            cleanUser = cleanUser.substring(1);
                        }
                        valLink = `https://www.tiktok.com/@${cleanUser}`;
                    }
                    
                    let compareValC = valC.toLowerCase();
                    
                    if (compareValC && mapB.has(compareValC)) {
                        matchedTotalData.push({
                            id: valId,
                            valC: valC,
                            link: valLink,
                            gmv: valGMV,
                            brandsSent: mapB.get(compareValC),
                            staffSent: mapBStaff.get(compareValC),
                            screenshotStatus: 'idle',
                            screenshotError: ''
                        });
                    } else {
                        unmatchedTotalData.push({
                            id: valId,
                            valC: valC,
                            link: valLink,
                            gmv: valGMV,
                            screenshotStatus: 'idle',
                            screenshotError: ''
                        });
                    }
                }

                // Update Stats Display
                document.getElementById('totalCount').textContent = totalProcessedA;
                document.getElementById('matchCount').textContent = matchedTotalData.length;
                document.getElementById('unmatchCount').textContent = unmatchedTotalData.length;

                const matchRate = totalProcessedA > 0 ? ((matchedTotalData.length / totalProcessedA) * 100).toFixed(1) : 0;
                document.getElementById('ratePercentage').textContent = `${matchRate}%`;

                // Badge values on Tabs
                document.getElementById('unmatchBadge').textContent = unmatchedTotalData.length;
                document.getElementById('matchBadge').textContent = matchedTotalData.length;
                document.getElementById('brandBadge').textContent = 0; // Default when no brand selected

                // Set perfect matches (matched and has brands associated)
                let perfectMatchCount = matchedTotalData.filter(k => k.brandsSent && k.brandsSent.size > 0).length;
                if (document.getElementById('perfectMatchCount')) document.getElementById('perfectMatchCount').textContent = perfectMatchCount;

                // Setup pagination states
                pagination.unmatch.filtered = [...unmatchedTotalData];
                pagination.unmatch.total = unmatchedTotalData.length;
                pagination.unmatch.page = 1;

                pagination.match.filtered = [...matchedTotalData];
                pagination.match.total = matchedTotalData.length;
                pagination.match.page = 1;

                pagination.brand.filtered = [];
                pagination.brand.total = 0;
                pagination.brand.page = 1;

                // Render current active tab tables
                renderTable('unmatch');
                renderTable('match');
                resetBrandTableEmptyState();

                // Draw chart
                drawChart(unmatchedTotalData.length, matchedTotalData.length);

                // Show Results
                document.getElementById('loading').style.display = 'none';
                document.getElementById('resultArea').style.display = 'block';
                showToast('Đối chiếu hoàn tất! Dữ liệu đã sẵn sàng.', 'success');

                // Smooth scroll to results
                document.getElementById('resultArea').scrollIntoView({ behavior: 'smooth' });

                // Tự động cào view qua tikwm API ngay sau khi đối chiếu (không cần extension)
                setTimeout(() => {
                    showToast('Đang tự động cào view hàng loạt qua tikwm API cho KOC Chưa Đơn...', 'info');
                    currentBatchType = 'unmatch';
                    startBatchProcessing();
                }, 1000);

            } catch (error) {
                console.error(error);
                document.getElementById('loading').style.display = 'none';
                showToast(`Lỗi trong quá trình xử lý: ${error.message}. Kiểm tra cấu hình cột!`, 'error');
            }
        }

        // --- CHART DRAWING ---
        function drawChart(unmatchCount, matchCount) {
            const chartEl = document.getElementById('reconciliationChart');
            if (!chartEl) return;
            const ctx = chartEl.getContext('2d');
            
            // Destroy existing chart if any
            if (reconciliationChartInstance) {
                reconciliationChartInstance.destroy();
            }

            const isDark = document.body.classList.contains('dark-theme');
            const textCol = isDark ? '#cbd5e1' : '#475569';

            reconciliationChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Chưa Gửi (Không trùng)', 'Đã Gửi (Trùng đơn)'],
                    datasets: [{
                        data: [unmatchCount, matchCount],
                        backgroundColor: [
                            'rgba(239, 68, 68, 0.75)', // Red
                            'rgba(16, 185, 129, 0.75)'  // Green
                        ],
                        borderColor: [
                            'rgba(239, 68, 68, 1)',
                            'rgba(16, 185, 129, 1)'
                        ],
                        borderWidth: 1.5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: textCol,
                                font: {
                                    family: 'Plus Jakarta Sans',
                                    size: 11,
                                    weight: '600'
                                }
                            }
                        }
                    },
                    cutout: '65%'
                }
            });
        }

        // --- TAB SWITCHER ---
        function switchTab(tabId) {
            // Remove active classes
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            // Find clicked button based on target ID
            let btnIndex = 0;
            if (tabId === 'brandTab') btnIndex = 1;
            else if (tabId === 'matchTab') btnIndex = 2;

            document.querySelectorAll('.tab-btn')[btnIndex].classList.add('active');
            document.getElementById(tabId).classList.add('active');
        }

        // --- BRAND SELECTOR LISTENER ---
        document.getElementById('brandSelector').addEventListener('change', (e) => {
            const selectedBrand = e.target.value;
            const btn = document.getElementById('downloadBrandBtn');
            
            if (!selectedBrand) {
                resetBrandTableEmptyState();
                btn.disabled = true;
                btn.classList.add('disabled');
                document.getElementById('brandBadge').textContent = 0;
                return;
            }

            // Filter matched KOCs whose order records do NOT contain this selectedBrand
            missingBrandDataFiltered = [];
            matchedTotalData.forEach(koc => {
                if (!koc.brandsSent.has(selectedBrand)) {
                    missingBrandDataFiltered.push(koc);
                }
            });

            // Update state
            pagination.brand.filtered = [...missingBrandDataFiltered];
            pagination.brand.total = missingBrandDataFiltered.length;
            pagination.brand.page = 1;

            document.getElementById('brandBadge').textContent = missingBrandDataFiltered.length;

            renderTable('brand');
            
            const batchBtn = document.getElementById('brandBatchBtn');
            btn.disabled = missingBrandDataFiltered.length === 0;
            if (batchBtn) {
                batchBtn.disabled = missingBrandDataFiltered.length === 0;
                if (batchBtn.disabled) {
                    batchBtn.classList.add('disabled');
                } else {
                    batchBtn.classList.remove('disabled');
                }
            }
            if (btn.disabled) {
                btn.classList.add('disabled');
            } else {
                btn.classList.remove('disabled');
            }
        });

        function resetBrandTableEmptyState() {
            const tbody = document.querySelector('#brandTable tbody');
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                        </svg>
                        <p>Vui lòng chọn một Brand từ thanh công cụ bên trên để bắt đầu đối đối chiếu</p>
                    </td>
                </tr>
            `;
            document.getElementById('brandEmpty').style.display = 'none';
        }

        // --- TABLE RENDERING & FILTERING & PAGINATION ---
        function filterTable(type, query) {
            pagination[type].search = query.trim().toLowerCase();
            pagination[type].page = 1; // reset to first page

            const sourceData = type === 'unmatch' 
                ? unmatchedTotalData 
                : (type === 'match' ? matchedTotalData : missingBrandDataFiltered);

            if (!pagination[type].search) {
                pagination[type].filtered = [...sourceData];
            } else {
                const q = pagination[type].search;
                pagination[type].filtered = sourceData.filter(item => {
                    const idMatch = item.id && String(item.id).toLowerCase().includes(q);
                    const valCMatch = item.valC && String(item.valC).toLowerCase().includes(q);
                    return idMatch || valCMatch;
                });
            }

            pagination[type].total = pagination[type].filtered.length;
            renderTable(type);
        }

        function formatGMV(val) {
            const n = Math.round(parseFloat(val));
            if (isNaN(n)) return val;
            return n.toLocaleString('de-DE').replace(/,/g, '.') + ' VND';
        }

        function formatViewCount(num) {
            if (num === undefined || num === null) return '0';
            if (num >= 1000000) {
                return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
            }
            if (num >= 1000) {
                return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
            }
            return num.toString();
        }

        // Badge trạng thái cào view: Đang cào / Lỗi / ĐẠT / LOẠI / Chờ cào (dùng chung unmatch + brand)
        function buildStatusHtml(item) {
            if (item.screenshotStatus === 'pending') {
                return '<span class="status-dot-text"><span class="status-dot yellow"></span> Đang cào...</span>';
            }
            if (item.screenshotStatus === 'error') {
                const errMsg = item.screenshotError || 'Lỗi cào view';
                const shortErr = errMsg === 'TIMEOUT' ? 'Timeout' : errMsg.toLowerCase().includes('captcha') ? 'Captcha' : errMsg.toLowerCase().includes('video') ? 'Ít video' : 'Lỗi TikTok';
                return `<span class="status-dot-text" title="${errMsg}"><span class="status-dot red"></span> ${shortErr}</span>`;
            }
            if (item.viewSum !== undefined) {
                return item.isRejected ? '<span class="badge-reject">LOẠI</span>' : '<span class="badge-accept">ĐẠT</span>';
            }
            return '<span style="color: var(--text-muted);">Chờ cào view</span>';
        }

        function renderTable(type) {
            const allData = type === 'unmatch' ? unmatchedTotalData : (type === 'match' ? matchedTotalData : missingBrandDataFiltered);
            const datEl = document.getElementById(`${type}DatCount`);
            if (datEl) {
                datEl.textContent = allData.filter(i => i.viewSum !== undefined && !i.isRejected).length;
                document.getElementById(`${type}LoaiCount`).textContent = allData.filter(i => i.viewSum !== undefined && i.isRejected).length;
                document.getElementById(`${type}ChuaCount`).textContent = allData.filter(i => i.viewSum === undefined).length;
            }

            const state = pagination[type];
            const tbody = document.querySelector(`#${type}Table tbody`);
            const emptyEl = document.getElementById(`${type}Empty`);
            
            tbody.innerHTML = '';
            
            if (state.total === 0) {
                emptyEl.style.display = 'block';
                document.getElementById(`${type}PageInfo`).textContent = 'Đang hiển thị 0 - 0 của 0 bản ghi';
                document.getElementById(`${type}Prev`).disabled = true;
                document.getElementById(`${type}Next`).disabled = true;
                return;
            } else {
                emptyEl.style.display = 'none';
            }

            const startIdx = (state.page - 1) * state.limit;
            const endIdx = Math.min(startIdx + state.limit, state.total);
            const pagedData = state.filtered.slice(startIdx, endIdx);

            pagedData.forEach((item, index) => {
                const tr = document.createElement('tr');
                const stt = startIdx + index + 1;
                const absoluteIndex = startIdx + index;
                
                let linkHtml = '-';
                if (item.link && String(item.link).startsWith('http')) {
                    linkHtml = `<a href="${item.link}" target="_blank" class="link-tiktok">
                        Mở Link
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    </a>`;
                } else if (item.link) {
                    linkHtml = item.link;
                }

                // Lưới ảnh bìa video (đã tải base64 lúc cào) → bấm 1 cái xem cả 9 ảnh để lia nhanh
                let coverHtml = '-';
                if (item.covers && item.covers.length) {
                    const key = item.id || item.valC;
                    coversCache[key] = { urls: item.covers, views: item.coverViews || [] };
                    // ponytail: referrerpolicy no-referrer né chặn hotlink theo referer; thêm proxy chỉ nếu ảnh vẫn 403
                    const imgs = item.covers.slice(0, 9).map(u => `<img src="${u}" loading="lazy" referrerpolicy="no-referrer">`).join('');
                    coverHtml = `<div class="cover-grid" onclick="openCoversLightbox('${String(key).replace(/'/g, "\\'")}')" title="Bấm để xem ${item.covers.length} ảnh bìa">${imgs}</div>`;
                } else if (item.screenshotStatus === 'pending') {
                    coverHtml = `<span class="screenshot-loading"><span class="spinner-small"></span></span>`;
                }

                if (type === 'unmatch') {
                    const statusHtml = buildStatusHtml(item);
                    let viewSumHtml = '-';
                    if (item.viewSum !== undefined) {
                        const sumFormatted = formatViewCount(item.viewSum);
                        viewSumHtml = `<span style="font-weight:600; color:var(--text-main);" title="Chi tiết: ${item.views ? item.views.slice(0, 10).join(', ') : ''}">${sumFormatted}</span>`;
                    }
                    
                    // Ô tick chỉ cho KOC đạt (để xuất riêng nhóm được chọn)
                    const selKey = item.id || item.valC;
                    const isDat = item.viewSum !== undefined && !item.isRejected;
                    const selectHtml = isDat
                        ? `<input type="checkbox" class="row-select" ${selectedUnmatch.has(selKey) ? 'checked' : ''} onclick="toggleSelectUnmatch('${String(selKey).replace(/'/g, "\\'")}', this.checked)">`
                        : '';

                    tr.innerHTML = `
                        <td>${selectHtml}</td>
                        <td>${stt}</td>
                        <td style="font-weight: 600;">${item.id || '-'}</td>
                        <td>${linkHtml}</td>
                        <td>${item.gmv !== undefined && item.gmv !== '' ? formatGMV(item.gmv) : '-'}</td>
                        <td>${viewSumHtml}</td>
                        <td>${statusHtml}</td>
                        <td>${coverHtml}</td>
                    `;
                } else { // match & brand have brandsSent column
                    let brandsHtml = '';
                    if (item.brandsSent) {
                        Array.from(item.brandsSent).forEach(brand => {
                            brandsHtml += `<span class="badge-brand">${brand}</span>`;
                        });
                    }
                    let viewSumHtml = '-';
                    if (item.viewSum !== undefined) {
                        const sumFormatted = formatViewCount(item.viewSum);
                        viewSumHtml = `<span style="font-weight:600; color:var(--text-main);">${sumFormatted}</span>`;
                    }
                    const brandsCell = brandsHtml || '<span style="color: var(--text-muted); font-size: 0.75rem;">Trùng nhưng rỗng Brand</span>';
                    if (type === 'brand') {
                        // Bảng "Trùng nhưng thiếu Brand" có thêm cột Nhân sự (cột P file B)
                        const staffText = item.staffSent && item.staffSent.size
                            ? Array.from(item.staffSent).join(', ') : '-';
                        tr.innerHTML = `
                            <td>${stt}</td>
                            <td style="font-weight: 600;">${item.id || '-'}</td>
                            <td>${brandsCell}</td>
                            <td>${staffText}</td>
                            <td>${linkHtml}</td>
                            <td>${viewSumHtml}</td>
                            <td>${buildStatusHtml(item)}</td>
                            <td>${coverHtml}</td>
                        `;
                    } else { // match
                        tr.innerHTML = `
                            <td>${stt}</td>
                            <td style="font-weight: 600;">${item.id || '-'}</td>
                            <td>${brandsCell}</td>
                            <td>${linkHtml}</td>
                            <td>${viewSumHtml}</td>
                            <td>${coverHtml}</td>
                        `;
                    }
                }
                tbody.appendChild(tr);
            });

            // Update page info
            document.getElementById(`${type}PageInfo`).textContent = `Đang hiển thị ${startIdx + 1} - ${endIdx} của ${state.total} bản ghi`;
            document.getElementById(`${type}Prev`).disabled = state.page === 1;
            document.getElementById(`${type}Next`).disabled = endIdx >= state.total;
        }

        function changePage(type, direction) {
            const state = pagination[type];
            const maxPage = Math.ceil(state.total / state.limit);
            const targetPage = state.page + direction;

            if (targetPage >= 1 && targetPage <= maxPage) {
                state.page = targetPage;
                renderTable(type);
            }
        }

        // --- EXCEL DATA EXPORT ---
        function downloadTableData(type, mode = 'all') {
            let dataToExport = [];
            let prefix = "";

            if (type === 'unmatch') {
                if (!unmatchedTotalData.length) return;
                let src = pagination.unmatch.filtered.filter(i => i.viewSum !== undefined && !i.isRejected);
                if (mode === 'selected') {
                    src = src.filter(i => selectedUnmatch.has(i.id || i.valC));
                    if (!src.length) { showToast('Chưa tick chọn KOC đạt nào để xuất!', 'warning'); return; }
                }
                dataToExport = src.map(i => ({
                        "KOC ID": i.id,
                        "Link TikTok (Cột R)": i.link,
                        "Tổng View 7 Video": i.viewSum,
                        "User ID": i.userId || "",
                        "Bio": i.bio || ""
                    }));
                prefix = mode === 'selected' ? "KOC_Dat_Da_Chon" : "KOC_Dat_Chua_Tung_Gui_Don";
            } else if (type === 'brand') {
                const selectedBrand = document.getElementById('brandSelector').value;
                if (!selectedBrand || !missingBrandDataFiltered.length) return;
                dataToExport = pagination.brand.filtered.map(i => ({
                    "KOC ID": i.id,
                    "Các Brand Đã Có Đơn": Array.from(i.brandsSent).join(', '),
                    "Nhân sự": i.staffSent ? Array.from(i.staffSent).join(', ') : "",
                    "Link TikTok (Cột R)": i.link,
                    "Tổng View 7 Video": i.viewSum !== undefined ? i.viewSum : "",
                    "User ID": i.userId || "",
                    "Bio": i.bio || ""
                }));
                prefix = `KOC_Thieu_Brand_${selectedBrand}`;
            } else if (type === 'match') {
                if (!matchedTotalData.length) return;
                dataToExport = pagination.match.filtered.map(i => ({
                    "KOC ID": i.id,
                    "Các Brand Đã Có Đơn": Array.from(i.brandsSent).join(', '),
                    "Link TikTok (Cột R)": i.link,
                    "Tổng View 7 Video": i.viewSum !== undefined ? i.viewSum : "",
                    "User ID": i.userId || "",
                    "Bio": i.bio || ""
                }));
                prefix = "KOC_Da_Gui_Don";
            }

            if (dataToExport.length === 0) {
                showToast('Không có dữ liệu nào để xuất!', 'error');
                return;
            }

            try {
                const ws = XLSX.utils.json_to_sheet(dataToExport);
                ws['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 40 }, { wch: 45 }];
                
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
                
                const filename = `${prefix}_${new Date().getTime()}.xlsx`;
                XLSX.writeFile(wb, filename);
                showToast(`Xuất file thành công: ${filename}`, 'success');
            } catch (err) {
                showToast(`Lỗi khi xuất file: ${err.message}`, 'error');
            }
        }

        // --- SCREENSHOT AUTOMATION JAVASCRIPT ---
        let isHelperActive = false;
        let batchProcessingActive = false;
        let batchCancelRequested = false;
        let currentBatchType = '';

        function updateHelperStatusUI(active) {
            const dot = document.getElementById('helperStatusDot');
            const text = document.getElementById('helperStatusText');
            const badge = document.getElementById('helperStatusBadge');
            const msgDot = document.getElementById('msgStatusDot');
            const msgText = document.getElementById('msgStatusText');

            const on = isExtensionActive();
            if (dot && text && badge) {
                dot.className = on ? 'status-dot green' : 'status-dot red';
                text.textContent = on ? 'Extension Hoạt động' : 'Extension chưa kích hoạt';
                badge.title = on ? 'Extension KOC đang kích hoạt và sẵn sàng cào view!' : 'Vui lòng kiểm tra lại tiện ích trình duyệt';
            }
            if (msgDot && msgText) {
                msgDot.style.background = on ? 'var(--success)' : 'var(--danger)';
                msgText.textContent = on ? 'Extension Hoạt động' : 'Extension chưa kích hoạt';
            }
        }

        // Periodically check helper status
        window.addEventListener('load', () => {
            updateHelperStatusUI(isExtensionActive());
            
            // Sync checkboxes for headful/headless mode
            const globalCb = document.getElementById('globalHeadfulCheckbox');
            const batchCb = document.getElementById('batchHeadful');
            if (globalCb && batchCb) {
                globalCb.addEventListener('change', () => {
                    batchCb.checked = globalCb.checked;
                });
                batchCb.addEventListener('change', () => {
                    globalCb.checked = batchCb.checked;
                });
            }
        });

        function closeModal(modalId) {
            document.getElementById(modalId).style.display = 'none';
        }

        // Open Lightbox
        function openLightbox(url, title) {
            const modal = document.getElementById('lightboxModal');
            const img = document.getElementById('lightboxImg');
            const grid = document.getElementById('lightboxGrid');
            const caption = document.getElementById('lightboxCaption');

            grid.style.display = 'none';
            grid.innerHTML = '';
            img.style.display = 'block';
            img.src = url;
            caption.textContent = `Ảnh chụp kênh KOC: ${title}`;
            modal.style.display = 'flex';
        }

        // Bấm 1 cái → hiện cả 9 ảnh bìa dạng lưới lớn để lia nhanh 1 lần
        function openCoversLightbox(key) {
            const entry = coversCache[key];
            const urls = Array.isArray(entry) ? entry : (entry?.urls || []); // tương thích cache cũ (mảng url)
            const cViews = Array.isArray(entry) ? [] : (entry?.views || []);
            if (!urls.length) return;
            const modal = document.getElementById('lightboxModal');
            const img = document.getElementById('lightboxImg');
            const grid = document.getElementById('lightboxGrid');
            const caption = document.getElementById('lightboxCaption');

            img.style.display = 'none';
            img.src = '';
            grid.style.display = 'grid';
            grid.innerHTML = urls.map((u, i) => {
                const badge = cViews[i] !== undefined
                    ? `<span class="cover-view-badge">▶ ${formatViewCount(cViews[i])}</span>` : '';
                return `<div class="cover-cell"><img src="${u}" referrerpolicy="no-referrer">${badge}</div>`;
            }).join('');
            caption.textContent = `Ảnh bìa kênh KOC: ${key} (${urls.length} video)`;
            modal.style.display = 'flex';
        }

        function closeLightbox() {
            document.getElementById('lightboxModal').style.display = 'none';
        }

        // Cào view một link đơn (tikwm API)
        async function captureSingle(id, url, absoluteIndex, tableType) {
            let listToSearch = tableType === 'unmatch' ? unmatchedTotalData : tableType === 'match' ? matchedTotalData : missingBrandDataFiltered;
            const item = listToSearch[absoluteIndex];
            if (!item) return;
            item.screenshotStatus = 'pending';
            item.screenshotError = '';
            renderTable(tableType);
            const result = await scrapeViaTikwm(url);
            if (result.success) {
                item.screenshotStatus = 'idle';
                item.views = result.views;
                item.viewSum = result.viewSum;
                item.covers = result.covers || [];
                item.coverViews = result.coverViews || [];
                item.isRejected = result.isRejected;
                item.userId = result.userId || item.userId;
                item.bio = result.bio || item.bio;
                showToast(`Trích xuất thành công: ${item.id || item.valC}`, 'success');
            } else {
                item.screenshotStatus = 'error';
                item.screenshotError = result.error || 'Lỗi cào view';
                showToast(`Lỗi: ${item.screenshotError}`, 'error');
            }
            renderTable(tableType);
        }

        // Open Batch Capture Modal (Bypassed modal, directly starts processing)
        function openBatchCaptureModal(tableType) {
            currentBatchType = tableType;
            startBatchProcessing();
        }

        function closeBatchModal() {
            if (batchProcessingActive) {
                if (!confirm('Hệ thống đang chụp ảnh hàng loạt, bạn có chắc chắn muốn thoát? Quá trình chụp sẽ dừng lại.')) {
                    return;
                }
                stopBatchProcessing();
            } else {
                if (isExtensionActive()) {
                    closeScrapeTabViaExtension();
                }
            }
            document.getElementById('batchCaptureModal').style.display = 'none';
        }

        // Start Batch Processing Loop
        async function startBatchProcessing() {
            batchProcessingActive = true;
            batchCancelRequested = false;

            // Show main progress card on page
            const progressCard = document.getElementById('mainProgressCard');
            if (progressCard) progressCard.style.display = 'block';

            if (document.getElementById('startBatchBtn')) document.getElementById('startBatchBtn').style.display = 'none';
            if (document.getElementById('stopBatchBtn')) document.getElementById('stopBatchBtn').style.display = 'block';
            if (document.getElementById('openScreenshotsDirBtn')) document.getElementById('openScreenshotsDirBtn').style.display = 'flex';
            // Reset nút dừng về trạng thái ban đầu (có thể đang là "Tiếp tục")
            const stopMainBtn = document.getElementById('stopMainScrapeBtn');
            if (stopMainBtn) {
                stopMainBtn.textContent = 'Dừng cào';
                stopMainBtn.style.color = 'var(--danger)';
                stopMainBtn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                stopMainBtn.style.background = 'rgba(239, 68, 68, 0.1)';
                stopMainBtn.onclick = stopBatchProcessing;
            }

            const headless = document.getElementById('batchHeadful') ? !document.getElementById('batchHeadful').checked : true;
            const delayValue = document.getElementById('batchDelay') ? (parseInt(document.getElementById('batchDelay').value) * 1000 || 4000) : 4000;
            
            // ponytail: 3 luồng cho tikwm API; giới hạn theo IP nên không đẩy cao, tăng nếu bị RATE_LIMIT
            const numThreads = 3;

            // Get target list
            let sourceData = [];
            if (currentBatchType === 'unmatch') {
                sourceData = pagination.unmatch.filtered;
            } else if (currentBatchType === 'match') {
                sourceData = pagination.match.filtered;
            } else if (currentBatchType === 'brand') {
                sourceData = pagination.brand.filtered;
            }

            // Bỏ qua item đã cào thành công → hỗ trợ "Tiếp tục" sau khi dừng
            const itemsWithLinks = sourceData.filter(item => item.link && String(item.link).startsWith('http') && item.viewSum === undefined);
            let total = itemsWithLinks.length; // mutable: KOC bị chặn được re-queue vào cuối
            
            if (total === 0) {
                showToast('Không tìm thấy KOC nào có link hợp lệ để cào view!', 'warning');
                batchProcessingActive = false;
                if (progressCard) progressCard.style.display = 'none';
                return;
            }

            let successCount = 0;
            let completedCount = 0;
            let currentIndex = 0;
            // Nghỉ giải lao "giống người": dừng sau mỗi 12-20 KOC để phá nhịp burst mà Akamai bắt bài
            let nextBreakAt = 12 + Math.floor(Math.random() * 9);
            // Backoff khi bị chặn IP: cả 2 luồng cùng nghỉ tới blockPauseUntil, thời gian nghỉ tăng dần
            let blockPauseUntil = 0;
            let blockBackoff = 60000;

            const mainProgressText = document.getElementById('mainProgressText');
            if (mainProgressText) mainProgressText.textContent = `Đang khởi chạy ${numThreads} luồng cào view tự động...`;

            const runWorker = async (workerId) => {
                while (currentIndex < total && !batchCancelRequested) {
                    // Đang trong thời gian backoff vì bị chặn IP → cả 2 luồng cùng chờ
                    while (Date.now() < blockPauseUntil && !batchCancelRequested) {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    if (batchCancelRequested) break;

                    const taskIndex = currentIndex++;
                    if (taskIndex >= total) break;

                    const item = itemsWithLinks[taskIndex];
                    
                    // Update batch UI item status
                    const badge = document.getElementById(`batch-badge-${item.id || item.valC}`);
                    if (badge) {
                        badge.textContent = `LUỒNG ${workerId + 1}`;
                        badge.className = 'batch-status-badge running';
                    }
                    const itemDiv = document.getElementById(`batch-item-${item.id || item.valC}`);
                    if (itemDiv) {
                        itemDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }

                    // Update original state item status
                    item.screenshotStatus = 'pending';
                    renderTable(currentBatchType);

                    try {
                        // ponytail: throttle nhẹ cho tikwm (stagger luồng + cooldown ngắn), tăng nếu bị RATE_LIMIT
                        const staggerDelay = workerId * 300 + Math.random() * 300;
                        await new Promise(resolve => setTimeout(resolve, staggerDelay));

                        const result = await scrapeViaTikwm(item.link);

                        await new Promise(r => setTimeout(r, 300 + Math.random() * 500));

                        // tikwm rate-limit → backoff toàn cục + cào lại chính KOC này (tối đa 3 lần)
                        if (!batchCancelRequested && result && result.error === 'RATE_LIMIT') {
                            item.blockRetries = (item.blockRetries || 0) + 1;
                            if (item.blockRetries < 3) {
                                // Làn chặn mới (chưa đang nghỉ) → đặt mốc nghỉ chung, tăng thời gian nghỉ dần
                                if (Date.now() >= blockPauseUntil) {
                                    blockPauseUntil = Date.now() + blockBackoff;
                                    if (mainProgressText) mainProgressText.textContent = `Bị chặn IP — nghỉ ${Math.round(blockBackoff/1000)}s cho "nguội" rồi cào lại... ${completedCount}/${total}`;
                                    blockBackoff = Math.min(Math.round(blockBackoff * 1.5), 300000);
                                }
                                item.screenshotStatus = 'pending';
                                itemsWithLinks.push(item); // re-queue vào cuối
                                total++;
                                if (badge) { badge.textContent = 'CHỜ THỬ LẠI'; badge.className = 'batch-status-badge running'; }
                                continue; // không tính completed, không đánh dấu lỗi
                            }
                            // hết 3 lượt mà vẫn chặn → rơi xuống nhánh đánh dấu lỗi bên dưới
                        }

                        if (result.success && !batchCancelRequested) {
                            item.screenshotStatus = 'idle';
                            item.views = result.views;
                            item.viewSum = result.viewSum;
                            item.covers = result.covers || [];
                            item.coverViews = result.coverViews || [];
                            item.isRejected = result.isRejected;
                            item.userId = result.userId || item.userId;
                            item.bio = result.bio || item.bio;
                            successCount++;
                            if (badge) {
                                badge.textContent = 'THÀNH CÔNG';
                                badge.className = 'batch-status-badge success';
                            }
                        } else {
                            if (!batchCancelRequested) {
                                item.screenshotStatus = 'error';
                                item.screenshotError = result.error || 'Lỗi cào view';
                                if (badge) {
                                    badge.textContent = 'LỖI';
                                    badge.className = 'batch-status-badge error';
                                }
                            }
                        }
                    } catch (err) {
                        if (!batchCancelRequested) {
                            item.screenshotStatus = 'error';
                            item.screenshotError = err.message;
                            if (badge) {
                                badge.textContent = 'LỖI KẾT NỐI';
                                badge.className = 'batch-status-badge error';
                            }
                        }
                    }

                    completedCount++;
                    // Update progress bar
                    const percent = Math.round((completedCount / total) * 100);
                    
                    const progressBar = document.getElementById('mainProgressBar');
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    const percentText = document.getElementById('mainPercentText');
                    if (percentText) percentText.textContent = `${percent}%`;
                    if (mainProgressText) mainProgressText.textContent = `Đang xử lý ${completedCount}/${total}...`;

                    // Also update modal progress if modal exists
                    const modalProgressBar = document.getElementById('batchProgressBar');
                    if (modalProgressBar) modalProgressBar.style.width = `${percent}%`;
                    const modalPercentText = document.getElementById('batchPercentText');
                    if (modalPercentText) modalPercentText.textContent = `${percent}%`;

                    renderTable(currentBatchType);

                    // Nghỉ giải lao giống người: sau mỗi 12-20 KOC, dừng 15-30s phá nhịp burst → tránh Akamai
                    if (!batchCancelRequested && completedCount >= nextBreakAt && completedCount < total) {
                        nextBreakAt = completedCount + 12 + Math.floor(Math.random() * 9);
                        const breakMs = 15000 + Math.random() * 15000;
                        if (mainProgressText) mainProgressText.textContent = `Nghỉ giải lao ${Math.round(breakMs/1000)}s (giống người dùng)... ${completedCount}/${total}`;
                        await new Promise(r => setTimeout(r, breakMs));
                    }
                }
            };

            // Spawn workers
            const workers = [];
            for (let w = 0; w < numThreads; w++) {
                workers.push(runWorker(w));
            }
            
            // Wait for all workers to complete
            await Promise.all(workers);

            batchProcessingActive = false;
            if (document.getElementById('startBatchBtn')) document.getElementById('startBatchBtn').style.display = 'block';
            if (document.getElementById('stopBatchBtn')) document.getElementById('stopBatchBtn').style.display = 'none';
            
            if (batchCancelRequested) {
                if (mainProgressText) mainProgressText.textContent = `Đã dừng tiến trình. Thành công ${successCount}/${total}.`;
            } else {
                if (mainProgressText) mainProgressText.textContent = `Hoàn thành! Đã cào xong ${successCount}/${total} kênh.`;
                showToast(`Hoàn thành cào view hàng loạt. Thành công ${successCount}/${total}`, 'success');
                
                // Hide card after 5 seconds
                setTimeout(() => {
                    if (progressCard) progressCard.style.display = 'none';
                }, 5000);
            }

            // Close the scraping tab when batch finishes
            if (isExtensionActive()) {
                closeScrapeTabViaExtension();
            }

            // Auto-download file when batch capturing is fully done
            if (successCount > 0 && !batchCancelRequested) {
                setTimeout(() => {
                    showToast('Đang tự động tải về file Excel kết quả...', 'success');
                    downloadTableData(currentBatchType);
                }, 1500);
            }
        }

        function stopBatchProcessing() {
            batchCancelRequested = true;
            batchProcessingActive = false;
            document.getElementById('startBatchBtn').style.display = 'block';
            document.getElementById('stopBatchBtn').style.display = 'none';
            document.getElementById('batchProgressText').textContent = 'Tiến trình đã bị dừng bởi người dùng.';
            // Đổi nút "Dừng cào" → "Tiếp tục" để resume
            const stopBtn = document.getElementById('stopMainScrapeBtn');
            if (stopBtn) {
                stopBtn.textContent = 'Tiếp tục';
                stopBtn.style.color = 'var(--success)';
                stopBtn.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                stopBtn.style.background = 'rgba(16, 185, 129, 0.1)';
                stopBtn.onclick = startBatchProcessing;
            }
            if (isExtensionActive()) {
                closeScrapeTabViaExtension();
            }
        }

        // --- BULK MESSAGING ---
        let msgData = [];
        let msgFile = null;
        let msgBatchActive = false;
        let msgCancelRequested = false;
        let msgResolvers = {};

        // File drag-drop setup
        (function() {
            const dz = document.getElementById('msgDropzone');
            const input = document.getElementById('msgFileInput');
            if (!dz || !input) return;
            dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
            dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
            dz.addEventListener('drop', e => {
                e.preventDefault(); dz.classList.remove('dragover');
                if (e.dataTransfer.files[0]) handleMsgFile(e.dataTransfer.files[0]);
            });
            input.addEventListener('change', () => { if (input.files[0]) handleMsgFile(input.files[0]); });
        })();

        function handleMsgFile(file) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (!['xlsx','xls','csv'].includes(ext)) { showToast('Định dạng không hỗ trợ!', 'error'); return; }
            msgFile = file;
            document.getElementById('msgDropzone').style.display = 'none';
            document.getElementById('msgFileInfo').style.display = 'flex';
            document.getElementById('msgFileName').textContent = file.name;
            const kb = (file.size / 1024).toFixed(1);
            document.getElementById('msgFileSize').textContent = `(${kb > 1024 ? (kb/1024).toFixed(1)+' MB' : kb+' KB'})`;
            showToast(`Đã nhận file: ${file.name}`, 'success');
        }

        function clearMsgFile() {
            msgFile = null;
            document.getElementById('msgFileInput').value = '';
            document.getElementById('msgFileInfo').style.display = 'none';
            document.getElementById('msgDropzone').style.display = 'flex';
        }

        function sendMsgViaExtension(url, text, index, userId) {
            return new Promise(resolve => {
                msgResolvers[index] = resolve;
                window.postMessage({ type: "FROM_PAGE", action: "SEND_MESSAGE", url, text, index, userId }, "*");
                setTimeout(() => {
                    if (msgResolvers[index]) { delete msgResolvers[index]; resolve({ success: false, error: 'TIMEOUT' }); }
                }, 90000);
            });
        }

        function updateMsgProgress(done, total) {
            const pct = total > 0 ? Math.round(done / total * 100) : 0;
            document.getElementById('msgProgressBar').style.width = pct + '%';
            document.getElementById('msgProgressText').textContent = `Đang xử lý ${done}/${total}...`;
        }

        function renderMsgTable() {
            const tbody = document.querySelector('#msgTable tbody');
            tbody.innerHTML = '';
            let sent = 0, err = 0, pending = 0;
            msgData.forEach((item, i) => {
                if (item.msgStatus === 'sent') sent++;
                else if (item.msgStatus === 'error') err++;
                else pending++;
                const tr = document.createElement('tr');
                let statusHtml = '<span style="color:var(--text-muted);">Chờ gửi</span>';
                if (item.msgStatus === 'pending') statusHtml = '<span class="status-dot-text"><span class="status-dot yellow pulse"></span> Đang gửi...</span>';
                else if (item.msgStatus === 'sent') statusHtml = '<span class="badge-accept">ĐÃ GỬI</span>';
                else if (item.msgStatus === 'error') statusHtml = `<span class="badge-reject" title="${item.msgError || ''}">LỖI</span>`;
                const linkHtml = item.link && item.link.startsWith('http')
                    ? `<a href="${item.link}" target="_blank" class="link-tiktok">Mở Link <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>`
                    : (item.link || '-');
                tr.innerHTML = `<td>${i+1}</td><td style="font-weight:600;">${item.kocId || '-'}</td><td>${linkHtml}</td><td>${statusHtml}</td>`;
                tbody.appendChild(tr);
            });
            document.getElementById('msgSentCount').textContent = sent;
            document.getElementById('msgErrCount').textContent = err;
            document.getElementById('msgPendingCount').textContent = pending;
        }

        async function startBulkMessaging() {
            if (!isExtensionActive()) { showToast('Extension chưa hoạt động! Vui lòng kiểm tra lại.', 'error'); return; }
            if (!msgFile) { showToast('Vui lòng chọn file danh sách KOC!', 'error'); return; }
            const template = document.getElementById('msgTemplate').value.trim();
            if (!template) { showToast('Vui lòng nhập nội dung tin nhắn mẫu!', 'error'); return; }

            const skipHeader = document.getElementById('msgSkipHeader').checked;
            const colId = excelLetterToCol(document.getElementById('msgColId').value);
            const colLink = excelLetterToCol(document.getElementById('msgColLink').value);
            const delayMs = (parseInt(document.getElementById('msgDelay').value) || 5) * 1000;

            let rows;
            try { rows = await readExcel(msgFile); }
            catch(e) { showToast('Lỗi đọc file: ' + e.message, 'error'); return; }

            // Tự dò cột "User ID" trong header (file xuất từ tab quét đã có sẵn cột này)
            let colUserId = -1;
            if (skipHeader && rows[0]) {
                colUserId = rows[0].findIndex(c => /user\s*id/i.test(String(c || '')));
            }

            const startRow = skipHeader ? 1 : 0;
            msgData = [];
            for (let i = startRow; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;
                const kocId = String(row[colId] || '').trim();
                let link = String(row[colLink] || '').trim();
                if (!link && kocId) {
                    const clean = kocId.startsWith('@') ? kocId.slice(1) : kocId;
                    link = `https://www.tiktok.com/@${clean}`;
                }
                const userId = colUserId >= 0 ? String(row[colUserId] || '').trim() : '';
                if (kocId || link) msgData.push({ kocId, link, userId, msgStatus: 'idle', msgError: '' });
            }

            if (!msgData.length) { showToast('Không tìm thấy dữ liệu hợp lệ trong file!', 'error'); return; }

            msgBatchActive = true;
            msgCancelRequested = false;
            document.getElementById('startMsgBtn').style.display = 'none';
            document.getElementById('stopMsgBtn').style.display = 'flex';
            document.getElementById('msgTableWrap').style.display = 'block';
            document.getElementById('msgProgressBarWrap').style.display = 'block';
            renderMsgTable();

            const total = msgData.length;
            let done = 0;

            for (let i = 0; i < total; i++) {
                if (msgCancelRequested) break;
                const item = msgData[i];
                if (!item.link || !item.link.startsWith('http')) { done++; continue; }

                item.msgStatus = 'pending';
                renderMsgTable();
                updateMsgProgress(done, total);

                const text = template.replace(/\{KOC_ID\}/g, item.kocId);
                const result = await sendMsgViaExtension(item.link, text, i, item.userId);

                item.msgStatus = result.success ? 'sent' : 'error';
                item.msgError = result.error || '';
                done++;
                renderMsgTable();
                updateMsgProgress(done, total);

                if (!msgCancelRequested && i < total - 1) {
                    // Bị TikTok chặn → nghỉ lâu (backoff) trước khi gửi tiếp
                    if (result.error === 'TIKTOK_BLOCKED') {
                        document.getElementById('msgProgressText').textContent = `Bị TikTok chặn tạm thời, nghỉ 60s...`;
                        await new Promise(r => setTimeout(r, 60000));
                    }
                    // ±30% jitter để tránh TikTok detect pattern
                    const jitter = delayMs * 0.3 * (Math.random() * 2 - 1);
                    await new Promise(r => setTimeout(r, delayMs + jitter));
                }
            }

            msgBatchActive = false;
            document.getElementById('startMsgBtn').style.display = 'flex';
            document.getElementById('stopMsgBtn').style.display = 'none';

            const successCount = msgData.filter(d => d.msgStatus === 'sent').length;
            const msg = msgCancelRequested
                ? `Đã dừng. Gửi thành công ${successCount}/${done}.`
                : `Hoàn thành! Gửi thành công ${successCount}/${total}.`;
            document.getElementById('msgProgressText').textContent = msg;
            showToast(msg, successCount > 0 ? 'success' : 'error');

            window.postMessage({ type: "FROM_PAGE", action: "CLOSE_MESSAGE_TAB" }, "*");
        }

        function stopBulkMessaging() {
            msgCancelRequested = true;
            msgBatchActive = false;
            // Unblock bất kỳ sendMsgViaExtension nào đang chờ
            Object.keys(msgResolvers).forEach(k => {
                msgResolvers[k]({ success: false, error: 'CANCELLED' });
                delete msgResolvers[k];
            });
            document.getElementById('startMsgBtn').style.display = 'flex';
            document.getElementById('stopMsgBtn').style.display = 'none';
            const done = msgData.filter(d => d.msgStatus !== 'idle' && d.msgStatus !== 'pending').length;
            const sent = msgData.filter(d => d.msgStatus === 'sent').length;
            document.getElementById('msgProgressText').textContent = `Đã dừng. Gửi thành công ${sent}/${done}.`;
            window.postMessage({ type: "FROM_PAGE", action: "CLOSE_MESSAGE_TAB" }, "*");
        }

        // Open Screenshots Folder in OS File Manager
        async function openScreenshotsFolder() {
            if (!isHelperActive) return;
            try {
                const response = await fetch('http://localhost:3000/api/open-folder', { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    showToast('Đã mở thư mục ảnh chụp màn hình', 'success');
                } else {
                    showToast(`Không thể mở thư mục: ${result.error}`, 'error');
                }
            } catch (err) {
                showToast(`Lỗi kết nối helper: ${err.message}`, 'error');
            }
        }
