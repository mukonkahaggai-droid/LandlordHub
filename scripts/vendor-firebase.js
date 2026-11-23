// Copies the Firebase browser files the app uses from node_modules into vendor/firebase/,
// so the app loads them from its own site (works offline, no build step).
// After `npm install` of a new Firebase version, run: npm run vendor:firebase
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'firebase');
const out = path.join(root, 'vendor', 'firebase');
const files = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];
const version = require(path.join(src, 'package.json')).version;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of files) {
  // Drop the source-map line: the .map files aren't copied, so browsers would ask for them and get 404s.
  const text = fs.readFileSync(path.join(src, f), 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
  fs.writeFileSync(path.join(out, f), text);
}
fs.writeFileSync(path.join(out, 'VERSION'), version + '\n');
console.log(`Copied Firebase ${version} (${files.join(', ')}) into vendor/firebase/`);
