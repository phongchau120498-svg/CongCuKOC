        // --- THEME MANAGEMENT ---
        const themeToggle = document.getElementById('themeToggle');
        const themeIcon = document.getElementById('themeIcon');
        
        // Load saved theme or default to light
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-theme');
            updateThemeIcon(true);
        }

        themeToggle.addEventListener('click', () => {
            const isDark = document.body.classList.toggle('dark-theme');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            updateThemeIcon(isDark);
            showToast(isDark ? 'Đã kích hoạt chế độ Tối' : 'Đã kích hoạt chế độ Sáng', 'info');
        });

        function updateThemeIcon(isDark) {
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

        // --- CHROME EXTENSION SCRAPER INTEGRATION ---
        let activeScrapeResolver = null;

        function scrapeViaExtension(link, absoluteIndex, type) {
            return new Promise((resolve) => {
                activeScrapeResolver = {
                    index: absoluteIndex,
                    tabType: type,
                    resolve: resolve
                };
                
                window.postMessage({
                    type: "FROM_PAGE",
                    action: "SCRAPE_TIKTOK",
                    url: link,
                    index: absoluteIndex,
                    tabType: type
                }, "*");
            });
        }

        window.addEventListener("message", (event) => {
            if (event.data && event.data.type === "TO_PAGE") {
                const result = event.data.data;
                handleScrapeResultFromExtension(result);
            }
        });

        function handleScrapeResultFromExtension(result) {
            const { index, tabType, success, viewSum, views, screenshotUrl, error } = result;
            
            let listToSearch = [];
            if (tabType === 'unmatch') {
                listToSearch = unmatchedTotalData;
            } else if (tabType === 'match') {
                listToSearch = matchedTotalData;
            } else if (tabType === 'brand') {
                listToSearch = missingBrandDataFiltered;
            }
            
            const item = listToSearch[index];
            if (!item) return;
            
            if (success) {
                item.screenshotStatus = 'done';
                item.screenshotUrl = screenshotUrl; // Base64 data URL
                item.views = views;
                item.viewSum = viewSum;
                item.isRejected = viewSum < 1500;
                showToast(`Trích xuất thành công: ${item.id || item.valC}`, 'success');
            } else {
                item.screenshotStatus = 'error';
                item.screenshotError = error || 'Lỗi trích xuất';
                showToast(`Lỗi: ${item.screenshotError}`, 'error');
            }
            
            renderTable(tabType);
            
            // Resolve promise for batch loop or single action
            if (activeScrapeResolver && activeScrapeResolver.index === index && activeScrapeResolver.tabType === tabType) {
                result.url = screenshotUrl;
                result.isRejected = viewSum < 1500;
                activeScrapeResolver.resolve(result);
                activeScrapeResolver = null;
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
            unmatch: { page: 1, limit: 10, total: 0, filtered: [], search: '' },
            brand: { page: 1, limit: 10, total: 0, filtered: [], search: '' },
            match: { page: 1, limit: 10, total: 0, filtered: [], search: '' }
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
        document.getElementById('processBtn').addEventListener('click', async () => {
            if (!filesData.fileA || !filesData.fileB) {
                showToast('Vui lòng chọn cả 2 file (File KOC & File Đơn Hàng) trước khi tiếp tục', 'error');
                return;
            }

            const skipHeader = document.getElementById('skipHeader').checked;
            
            // Read column mapping values and convert from Excel letters to 0-based index
            const indexA_Id = excelLetterToCol(document.getElementById('colAId').value);
            const indexA_Link = excelLetterToCol(document.getElementById('colATikTok').value);
            
            const indexB_Compare = excelLetterToCol(document.getElementById('colBCompare').value);
            const indexB_Brand = excelLetterToCol(document.getElementById('colBBrand').value);

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
                allBrandsSet = new Set();

                for (let i = startRow; i < dataB.length; i++) {
                    const row = dataB[i];
                    if (!row || row.length === 0) continue;
                    
                    let valE = row[indexB_Compare] ? String(row[indexB_Compare]).trim().toLowerCase() : "";
                    let valN = row[indexB_Brand] ? String(row[indexB_Brand]).trim() : "";
                    
                    if (valE) {
                        if (!mapB.has(valE)) {
                            mapB.set(valE, new Set());
                        }
                        if (valN) {
                            mapB.get(valE).add(valN);
                            allBrandsSet.add(valN);
                        }
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

                document.getElementById('brandCount').textContent = allBrandsSet.size;

                // 2. Process File A (KOCs)
                unmatchedTotalData = [];
                matchedTotalData = [];
                let totalProcessedA = 0;

                for (let i = startRow; i < dataA.length; i++) {
                    const row = dataA[i];
                    if (!row || row.length === 0) continue;
                    
                    totalProcessedA++;
                    let valId = row[indexA_Id] ? String(row[indexA_Id]).trim() : "";
                    let valC = valId;
                    let valLink = row[indexA_Link] ? String(row[indexA_Link]).trim() : "";
                    
                    let compareValC = valC.toLowerCase();
                    
                    if (compareValC && mapB.has(compareValC)) {
                        matchedTotalData.push({
                            id: valId,
                            valC: valC,
                            link: valLink,
                            brandsSent: mapB.get(compareValC),
                            screenshotStatus: 'idle',
                            screenshotUrl: '',
                            screenshotError: ''
                        });
                    } else {
                        unmatchedTotalData.push({
                            id: valId,
                            valC: valC,
                            link: valLink,
                            screenshotStatus: 'idle',
                            screenshotUrl: '',
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
                document.getElementById('perfectMatchCount').textContent = perfectMatchCount;

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

                // Proactive extension scraping auto-trigger
                if (window.__KOC_EXTENSION_ACTIVE__) {
                    setTimeout(() => {
                        showToast('Đang tự động khởi chạy Extension để cào view hàng loạt cho KOC Chưa Đơn...', 'info');
                        openBatchCaptureModal('unmatch');
                        setTimeout(() => {
                            startBatchProcessing();
                        }, 1000);
                    }, 1000);
                }

            } catch (error) {
                console.error(error);
                document.getElementById('loading').style.display = 'none';
                showToast(`Lỗi trong quá trình xử lý: ${error.message}. Kiểm tra cấu hình cột!`, 'error');
            }
        });

        // --- CHART DRAWING ---
        function drawChart(unmatchCount, matchCount) {
            const ctx = document.getElementById('reconciliationChart').getContext('2d');
            
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
                    <td colspan="6" class="empty-state">
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

        function renderTable(type) {
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

                // Render screenshot cell based on status
                let screenshotHtml = '-';
                if (item.link && String(item.link).startsWith('http')) {
                    if (item.screenshotStatus === 'pending') {
                        screenshotHtml = `<span class="screenshot-loading"><span class="spinner-small"></span> Đang chụp...</span>`;
                    } else if (item.screenshotStatus === 'done' && item.screenshotUrl) {
                        screenshotHtml = `
                            <div class="screenshot-cell">
                                <img src="${item.screenshotUrl}" class="screenshot-thumb" onclick="openLightbox('${item.screenshotUrl}', '${item.id || item.valC}')" alt="Screenshot">
                                <button class="btn-action-small" onclick="captureSingle('${item.id || item.valC}', '${item.link}', ${absoluteIndex}, '${type}')" title="Chụp lại">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6M21.94 13a10 10 0 1 1-1.95-6.95L23 10"/></svg>
                                </button>
                            </div>
                        `;
                    } else if (item.screenshotStatus === 'error') {
                        screenshotHtml = `
                            <div class="screenshot-cell">
                                <span class="badge-error" title="${item.screenshotError || 'Lỗi không xác định'}">Lỗi</span>
                                <button class="btn-action-small" onclick="captureSingle('${item.id || item.valC}', '${item.link}', ${absoluteIndex}, '${type}')" title="Thử lại">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6M21.94 13a10 10 0 1 1-1.95-6.95L23 10"/></svg>
                                </button>
                            </div>
                        `;
                    } else {
                        // idle
                        screenshotHtml = `
                            <button class="btn-capture-row" onclick="captureSingle('${item.id || item.valC}', '${item.link}', ${absoluteIndex}, '${type}')">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                                Chụp
                            </button>
                        `;
                    }
                }

                if (type === 'unmatch') {
                    let statusHtml = '<span style="color: var(--text-muted);">Chờ cào view</span>';
                    let viewSumHtml = '-';
                    
                    if (item.screenshotStatus === 'pending') {
                        statusHtml = '<span class="status-dot-text"><span class="status-dot yellow"></span> Đang cào...</span>';
                    } else if (item.screenshotStatus === 'error') {
                        statusHtml = `<span class="status-dot-text" title="${item.screenshotError || 'Lỗi cào view'}"><span class="status-dot red"></span> Lỗi</span>`;
                    } else if (item.viewSum !== undefined) {
                        const sumFormatted = formatViewCount(item.viewSum);
                        viewSumHtml = `<span style="font-weight:600; color:var(--text-main);" title="Chi tiết: ${item.views ? item.views.slice(0, 10).join(', ') : ''}">${sumFormatted}</span>`;
                        if (item.isRejected) {
                            statusHtml = `<span class="badge-reject">LOẠI</span>`;
                        } else {
                            statusHtml = `<span class="badge-accept">ĐẠT</span>`;
                        }
                    }
                    
                    tr.innerHTML = `
                        <td>${stt}</td>
                        <td style="font-weight: 600;">${item.id || '-'}</td>
                        <td>${linkHtml}</td>
                        <td>${viewSumHtml}</td>
                        <td>${statusHtml}</td>
                        <td>${screenshotHtml}</td>
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
                    tr.innerHTML = `
                        <td>${stt}</td>
                        <td style="font-weight: 600;">${item.id || '-'}</td>
                        <td>${brandsHtml || '<span style="color: var(--text-muted); font-size: 0.75rem;">Trùng nhưng rỗng Brand</span>'}</td>
                        <td>${linkHtml}</td>
                        <td>${viewSumHtml}</td>
                        <td>${screenshotHtml}</td>
                    `;
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
        function downloadTableData(type) {
            let dataToExport = [];
            let prefix = "";

            if (type === 'unmatch') {
                if (!unmatchedTotalData.length) return;
                dataToExport = pagination.unmatch.filtered.map(i => ({
                    "KOC ID": i.id,
                    "Link TikTok (Cột R)": i.link,
                    "Tổng View 7 Video": i.viewSum !== undefined ? i.viewSum : "",
                    "Trạng thái": i.viewSum !== undefined ? (i.isRejected ? "LOẠI" : "ĐẠT") : "Chưa cào view",
                    "Link Ảnh Chụp Kênh": i.screenshotUrl || ""
                }));
                prefix = "KOC_Chua_Tung_Gui_Don";
            } else if (type === 'brand') {
                const selectedBrand = document.getElementById('brandSelector').value;
                if (!selectedBrand || !missingBrandDataFiltered.length) return;
                dataToExport = pagination.brand.filtered.map(i => ({
                    "KOC ID": i.id,
                    "Các Brand Đã Có Đơn": Array.from(i.brandsSent).join(', '),
                    "Link TikTok (Cột R)": i.link,
                    "Tổng View 7 Video": i.viewSum !== undefined ? i.viewSum : "",
                    "Link Ảnh Chụp Kênh": i.screenshotUrl || ""
                }));
                prefix = `KOC_Thieu_Brand_${selectedBrand}`;
            } else if (type === 'match') {
                if (!matchedTotalData.length) return;
                dataToExport = pagination.match.filtered.map(i => ({
                    "KOC ID": i.id,
                    "Các Brand Đã Có Đơn": Array.from(i.brandsSent).join(', '),
                    "Link TikTok (Cột R)": i.link,
                    "Tổng View 7 Video": i.viewSum !== undefined ? i.viewSum : "",
                    "Link Ảnh Chụp Kênh": i.screenshotUrl || ""
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

        // Check if helper server is active
        async function checkHelperStatus() {
            if (window.__KOC_EXTENSION_ACTIVE__) {
                updateHelperStatusUI(true);
                return;
            }
            try {
                const res = await fetch('http://localhost:3000/api/status');
                const data = await res.json();
                if (data.success) {
                    isHelperActive = true;
                    updateHelperStatusUI(true);
                } else {
                    isHelperActive = false;
                    updateHelperStatusUI(false);
                }
            } catch (err) {
                isHelperActive = false;
                updateHelperStatusUI(false);
            }
        }

        function updateHelperStatusUI(active) {
            const dot = document.getElementById('helperStatusDot');
            const text = document.getElementById('helperStatusText');
            const badge = document.getElementById('helperStatusBadge');
            
            if (dot && text && badge) {
                if (window.__KOC_EXTENSION_ACTIVE__) {
                    dot.className = 'status-dot green';
                    text.textContent = 'Extension Hoạt động';
                    badge.title = 'Extension KOC đang kích hoạt và sẵn sàng cào view!';
                } else if (active) {
                    dot.className = 'status-dot green';
                    text.textContent = 'Helper đang chạy';
                    badge.title = 'Screenshot helper đang hoạt động trên port 3000';
                } else {
                    dot.className = 'status-dot red';
                    text.textContent = 'Chưa chạy helper';
                    badge.title = 'Click để xem hướng dẫn chạy helper chụp ảnh';
                }
            }
        }

        // Periodically check helper status
        setInterval(checkHelperStatus, 5000);
        window.addEventListener('load', () => {
            checkHelperStatus();
            
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

        // Show helper setup instructions modal
        function showHelperInstructions() {
            if (isHelperActive) {
                showToast('Helper đang hoạt động tốt trên port 3000!', 'success');
                return;
            }
            document.getElementById('helperInstructionsModal').style.display = 'flex';
        }

        function closeModal(modalId) {
            document.getElementById(modalId).style.display = 'none';
        }

        // Open Lightbox
        function openLightbox(url, title) {
            const modal = document.getElementById('lightboxModal');
            const img = document.getElementById('lightboxImg');
            const caption = document.getElementById('lightboxCaption');
            
            img.src = url;
            caption.textContent = `Ảnh chụp kênh KOC: ${title}`;
            modal.style.display = 'flex';
        }

        function closeLightbox() {
            document.getElementById('lightboxModal').style.display = 'none';
        }

        // Capture a single row's link
        async function captureSingle(id, url, absoluteIndex, tableType) {
            // Get target item in source data arrays
            let item;
            let listToSearch = [];
            if (tableType === 'unmatch') {
                listToSearch = unmatchedTotalData;
            } else if (tableType === 'match') {
                listToSearch = matchedTotalData;
            } else if (tableType === 'brand') {
                listToSearch = missingBrandDataFiltered;
            }

            item = listToSearch[absoluteIndex];
            if (!item) return;

            item.screenshotStatus = 'pending';
            item.screenshotError = '';
            renderTable(tableType);

            // Extension Scrape Path
            if (window.__KOC_EXTENSION_ACTIVE__) {
                await scrapeViaExtension(url, absoluteIndex, tableType);
                return;
            }

            // Local Helper Server Path
            if (!isHelperActive) {
                showHelperInstructions();
                item.screenshotStatus = 'idle';
                renderTable(tableType);
                return;
            }

            try {
                const delayValue = document.getElementById('batchDelay') ? parseInt(document.getElementById('batchDelay').value) * 1000 : 4000;
                const response = await fetch('http://localhost:3000/api/screenshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: item.id || item.valC,
                        url: url,
                        headless: !document.getElementById('globalHeadfulCheckbox').checked,
                        delay: delayValue
                    })
                });

                const result = await response.json();
                if (result.success) {
                    item.screenshotStatus = 'done';
                    item.screenshotUrl = result.url;
                    item.views = result.views;
                    item.parsedViews = result.parsedViews;
                    item.viewSum = result.viewSum;
                    item.isRejected = result.isRejected;
                    showToast(`Chụp thành công: ${item.id || item.valC}`, 'success');
                } else {
                    item.screenshotStatus = 'error';
                    item.screenshotError = result.error || 'Lỗi chụp ảnh';
                    showToast(`Lỗi chụp: ${item.id || item.valC}`, 'error');
                }
            } catch (err) {
                item.screenshotStatus = 'error';
                item.screenshotError = err.message || 'Lỗi kết nối helper';
                showToast(`Lỗi kết nối helper: ${err.message}`, 'error');
            }
            renderTable(tableType);
        }

        // Open Batch Capture Modal
        function openBatchCaptureModal(tableType) {
            if (!isHelperActive && !window.__KOC_EXTENSION_ACTIVE__) {
                showHelperInstructions();
                return;
            }

            currentBatchType = tableType;
            const modal = document.getElementById('batchCaptureModal');
            modal.style.display = 'flex';

            // Get list of KOCs with links
            let sourceData = [];
            if (tableType === 'unmatch') {
                sourceData = pagination.unmatch.filtered;
            } else if (tableType === 'match') {
                sourceData = pagination.match.filtered;
            } else if (tableType === 'brand') {
                sourceData = pagination.brand.filtered;
            }

            const itemsWithLinks = sourceData.filter(item => item.link && String(item.link).startsWith('http'));
            
            // Render list inside modal
            const container = document.getElementById('batchListContainer');
            container.innerHTML = '';

            if (itemsWithLinks.length === 0) {
                container.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">Không tìm thấy KOC nào có chứa link hợp lệ trong bảng hiện tại!</div>`;
                document.getElementById('startBatchBtn').disabled = true;
                document.getElementById('startBatchBtn').style.opacity = '0.5';
                return;
            }

            document.getElementById('startBatchBtn').disabled = false;
            document.getElementById('startBatchBtn').style.opacity = '1';

            itemsWithLinks.forEach(item => {
                const div = document.createElement('div');
                div.className = 'batch-item';
                div.id = `batch-item-${item.id || item.valC}`;
                
                let statusLabel = 'Chờ chụp';
                let badgeClass = 'wait';
                if (item.screenshotStatus === 'done') {
                    statusLabel = 'Đã có ảnh';
                    badgeClass = 'success';
                }

                div.innerHTML = `
                    <div class="batch-item-info">
                        <span style="font-weight:600;">${item.id || '-'}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap: 0.5rem;">
                        <span class="batch-status-badge ${badgeClass}" id="batch-badge-${item.id || item.valC}">${statusLabel}</span>
                    </div>
                `;
                container.appendChild(div);
            });

            // Reset progress bar
            document.getElementById('batchProgressBar').style.width = '0%';
            document.getElementById('batchProgressText').textContent = `Tìm thấy ${itemsWithLinks.length} KOC có link cần chụp.`;
            document.getElementById('batchPercentText').textContent = '0%';
            
            document.getElementById('startBatchBtn').style.display = 'block';
            document.getElementById('stopBatchBtn').style.display = 'none';
        }

        function closeBatchModal() {
            if (batchProcessingActive) {
                if (!confirm('Hệ thống đang chụp ảnh hàng loạt, bạn có chắc chắn muốn thoát? Quá trình chụp sẽ dừng lại.')) {
                    return;
                }
                stopBatchProcessing();
            }
            document.getElementById('batchCaptureModal').style.display = 'none';
        }

        // Start Batch Processing Loop
        async function startBatchProcessing() {
            if (!isHelperActive && !window.__KOC_EXTENSION_ACTIVE__) {
                showHelperInstructions();
                return;
            }

            batchProcessingActive = true;
            batchCancelRequested = false;

            document.getElementById('startBatchBtn').style.display = 'none';
            document.getElementById('stopBatchBtn').style.display = 'block';
            document.getElementById('openScreenshotsDirBtn').style.display = 'flex';

            const headless = !document.getElementById('batchHeadful').checked;
            const delayValue = parseInt(document.getElementById('batchDelay').value) * 1000 || 4000;

            // Get target list
            let sourceData = [];
            if (currentBatchType === 'unmatch') {
                sourceData = pagination.unmatch.filtered;
            } else if (currentBatchType === 'match') {
                sourceData = pagination.match.filtered;
            } else if (currentBatchType === 'brand') {
                sourceData = pagination.brand.filtered;
            }

            const itemsWithLinks = sourceData.filter(item => item.link && String(item.link).startsWith('http'));
            const total = itemsWithLinks.length;
            let successCount = 0;

            for (let i = 0; i < total; i++) {
                if (batchCancelRequested) {
                    showToast('Đã dừng tiến trình chụp ảnh hàng loạt', 'info');
                    break;
                }

                const item = itemsWithLinks[i];
                document.getElementById('batchProgressText').textContent = `Đang xử lý ${i + 1}/${total}: ${item.id || item.valC}...`;
                
                // Update batch UI item status
                const badge = document.getElementById(`batch-badge-${item.id || item.valC}`);
                if (badge) {
                    badge.textContent = 'ĐANG CHỤP';
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
                    let result;
                    if (window.__KOC_EXTENSION_ACTIVE__) {
                        const absoluteIndex = sourceData.indexOf(item);
                        result = await scrapeViaExtension(item.link, absoluteIndex, currentBatchType);
                    } else {
                        const response = await fetch('http://localhost:3000/api/screenshot', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: item.id || item.valC,
                                url: item.link,
                                headless: headless,
                                delay: delayValue
                            })
                        });
                        result = await response.json();
                    }

                    if (result.success && !batchCancelRequested) {
                        item.screenshotStatus = 'done';
                        item.screenshotUrl = result.url || result.screenshotUrl;
                        item.views = result.views;
                        item.parsedViews = result.parsedViews;
                        item.viewSum = result.viewSum;
                        item.isRejected = result.isRejected;
                        successCount++;
                        if (badge) {
                            badge.textContent = 'THÀNH CÔNG';
                            badge.className = 'batch-status-badge success';
                        }
                    } else {
                        if (!batchCancelRequested) {
                            item.screenshotStatus = 'error';
                            item.screenshotError = result.error || 'Lỗi chụp ảnh';
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

                // Update progress bar
                const percent = Math.round(((i + 1) / total) * 100);
                document.getElementById('batchProgressBar').style.width = `${percent}%`;
                document.getElementById('batchPercentText').textContent = `${percent}%`;

                renderTable(currentBatchType);
            }

            batchProcessingActive = false;
            document.getElementById('startBatchBtn').style.display = 'block';
            document.getElementById('stopBatchBtn').style.display = 'none';
            document.getElementById('batchProgressText').textContent = `Hoàn thành! Đã chụp ${successCount}/${total} link thành công.`;
            showToast(`Hoàn thành chụp hàng loạt. Thành công ${successCount}/${total}`, 'success');

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
