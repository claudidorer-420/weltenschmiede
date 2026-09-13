// Mini-Webserver für die lokale Nutzung/Entwicklung (ohne Abhängigkeiten).
// Start:  node tools/serve.mjs          → http://localhost:5173
//         node tools/serve.mjs 8080     → anderer Port
//         node tools/serve.mjs --lan    → auch im WLAN erreichbar (Handy/Tablet testen)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = normalize(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const lan = args.includes('--lan');
const port = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep) && file !== root) {
      res.writeHead(403).end('Verboten');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 – nicht gefunden');
  }
}).listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`\n  Weltenschmiede läuft:  http://localhost:${port}\n`);
  if (lan) {
    for (const list of Object.values(networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Im WLAN:               http://${n.address}:${port}`);
    }
    console.log('\n  Hinweis: Mikrofon, Installation als App und Service Worker brauchen HTTPS oder localhost.\n');
  }
});
