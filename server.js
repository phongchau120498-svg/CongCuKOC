const express = require('express');
const cors = require('cors');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/status', (req, res) => {
  res.json({ success: true, message: 'Server is active.' });
});

app.post('/api/open-folder', (req, res) => {
  const dir = path.join(__dirname, 'screenshots');
  let command = process.platform === 'win32' ? `start "" "${dir}"`
    : process.platform === 'darwin' ? `open "${dir}"`
    : `xdg-open "${dir}"`;

  exec(command, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true });
  });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 ĐÃ KHỞI CHẠY TOOL ĐỐI CHIẾU KOC THÀNH CÔNG!`);
  console.log(`👉 Nhấp vào link này để mở ứng dụng: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
