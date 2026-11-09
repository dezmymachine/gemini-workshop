// Prepares the folder Cloudflare publishes. Only the public page goes in dist/, so server code
// (api/, supabase/, .env) is never served as a file.
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, '..', 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'index.html'), path.join(out, 'index.html'));
console.log('dist/ ready');
