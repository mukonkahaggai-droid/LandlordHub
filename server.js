// Tiny server for Landlord Hub on your laptop: `node server.js`, then open http://localhost:5173
// It serves the app and keeps short invite links (e.g. http://192.168.1.177:5173/j/7KQ2MD)
// in data/invites.json, so a tenant's phone on the same Wi-Fi can open them.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const port = process.env.PORT || 5173;
const dataDir = path.join(root, 'data');
const invitesFile = path.join(dataDir, 'invites.json');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.apk': 'application/vnd.android.package-archive' };
const isText = (t) => /^(text\/|application\/(json|manifest)|image\/svg)/.test(t);

/* ---------- Short invite links ---------- */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, so codes are easy to read out
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
function readInvites() { try { return JSON.parse(fs.readFileSync(invitesFile, 'utf8')); } catch (e) { return {}; } }
function writeInvites(all) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(invitesFile, JSON.stringify(all, null, 1)); }
function newCode(all) {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
    if (!all[code]) return code;
  }
}
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  // Create (or reuse) a short code for an invite: POST /api/invites  { key, data }
  if (urlPath === '/api/invites' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      let msg; try { msg = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: 'Bad request' }); }
      if (!msg || typeof msg.data !== 'object') return sendJson(res, 400, { error: 'Bad request' });
      const all = readInvites();
      // The same tenant keeps the same code; their details are refreshed.
      let code = Object.keys(all).find((k) => msg.key && all[k].key === msg.key);
      if (!code) code = newCode(all);
      all[code] = { key: String(msg.key || ''), data: msg.data, at: new Date().toISOString() };
      writeInvites(all);
      sendJson(res, 200, { code });
    });
    return;
  }
  // Read an invite: GET /api/invites/7KQ2MD
  const m = urlPath.match(/^\/api\/invites\/([^/]+)$/);
  if (m && req.method === 'GET') {
    const code = m[1].toUpperCase();
    const inv = CODE_RE.test(code) && readInvites()[code];
    return inv ? sendJson(res, 200, { code, data: inv.data }) : sendJson(res, 404, { error: 'Invite not found' });
  }
  // The short link itself: /j/7KQ2MD opens the app's join screen.
  const j = urlPath.match(/^\/j\/([A-Za-z0-9]{6})$/);
  if (j) { res.writeHead(302, { Location: `/#/j/${j[1].toUpperCase()}` }); return res.end(); }

  // Never serve saved data or the server's own files.
  if (/^\/(data|node_modules|android|www|scripts)\//.test(urlPath) || urlPath === '/server.js') { res.writeHead(404); return res.end('Not found'); }

  const file = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const type = types[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': isText(type) ? type + '; charset=utf-8' : type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, '0.0.0.0', () => {
  console.log(`Landlord Hub running at http://localhost:${port}`);
  // Show the address a phone on the same Wi-Fi can open.
  for (const list of Object.values(require('os').networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`On your phone: http://${a.address}:${port}`);
  }
});
