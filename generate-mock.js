const XLSX = require('xlsx');

// Create File A: KOCs
const dataA = [
    ['KOC ID', 'Tên gợi nhớ / So khớp', 'Link TikTok'],
    ['KOC_001', 'google_official', 'https://www.tiktok.com/@google'],
    ['KOC_002', 'tiktok_official', 'https://www.tiktok.com/@tiktok'],
    ['KOC_003', 'nasa_official', 'https://www.tiktok.com/@nasa'],
    ['KOC_004', 'not_found_koc', 'https://www.tiktok.com/@notfound129381203']
];

const wbA = XLSX.utils.book_new();
const wsA = XLSX.utils.aoa_to_sheet(dataA);
XLSX.utils.book_append_sheet(wbA, wsA, 'KOCs');
XLSX.writeFile(wbA, 'fileA.xlsx');
console.log('Generated fileA.xlsx');

// Create File B: Orders
const dataB = [
    ['So khớp', 'Brand'],
    ['google_official', 'Google Store'],
    ['tiktok_official', 'TikTok Shop'],
    ['nasa_official', 'NASA Shop']
];

const wbB = XLSX.utils.book_new();
const wsB = XLSX.utils.aoa_to_sheet(dataB);
XLSX.utils.book_append_sheet(wbB, wsB, 'Orders');
XLSX.writeFile(wbB, 'fileB.xlsx');
console.log('Generated fileB.xlsx');
