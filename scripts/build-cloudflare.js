// Prepares the folder Cloudflare Pages publishes. Only the public page goes in dist/, so server code
// (api/, supabase/, .env) is never served as a file. Pages Functions come from /functions.
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, '..', 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'index.html'), path.join(out, 'index.html'));
// Same page for every screen address (the page decides what to show). 200 = rewrite, not redirect.
fs.writeFileSync(path.join(out, '_redirects'), ['/staff', '/register', '/login', '/forgot-password', '/reset-password'].map((p) => p + ' / 200').join('\n') + '\n');
console.log('dist/ ready');
