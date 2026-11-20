// Copies the web app into www/ for the Android app (Capacitor). The web version keeps running
// from the project folder as before; www/ is only what goes inside the phone app.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const files = ['index.html', 'styles.css', 'core.js', 'app.js', 'native.js', 'firebase-config.js', 'cloud.js', 'manifest.webmanifest'];
const dirs = ['icons', 'vendor'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const d of dirs) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });
// No service worker inside the phone app: the files are already on the phone.
console.log(`Copied ${files.length} files and ${dirs.length} folder into www/`);
