// Stempel-Studio (nur Entwicklung): rendert Poly-Haven-Modelle (CC0) von oben zu Karten-Stempeln und verkleinert
// Poly-Haven-Texturen für den Kartenersteller. Liefert tools/stamp-studio.html aus, reicht die Poly-Haven-API durch
// und speichert die Ergebnisse unter assets/ (bzw. tools/mapassets.gen.json).
// Start: node tools/stamp-studio.mjs  → http://localhost:5190/tools/stamp-studio.html
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || 5190);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css; charset=utf-8' };
const UA = { 'User-Agent': 'Weltenschmiede-StampStudio/1.0 (map asset build)' };
const inside = (file) => file.startsWith(root.endsWith(sep) ? root : root + sep);

const body = (req) => new Promise((ok, fail) => {
  const parts = [];
  req.on('data', (c) => parts.push(c));
  req.on('end', () => ok(Buffer.concat(parts)));
  req.on('error', fail);
});

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/ph-api/')) {
      const r = await fetch(`https://api.polyhaven.com/${url.pathname.slice(8)}${url.search}`, { headers: UA });
      res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/save') {
      const rel = String(url.searchParams.get('path') || '').replace(/\\/g, '/');
      if (!/^(assets\/[\w\-/.]+\.(webp|png|json)|tools\/mapassets\.gen\.json)$/.test(rel) || rel.includes('..')) {
        res.writeHead(400).end('Pfad nicht erlaubt');
        return;
      }
      const file = normalize(join(root, rel));
      if (!inside(file)) { res.writeHead(403).end('Verboten'); return; }
      await mkdir(dirname(file), { recursive: true });
      const data = await body(req);
      await writeFile(file, data);
      res.writeHead(200, { 'content-type': 'text/plain' }).end(`ok ${data.length}`);
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!inside(file)) { res.writeHead(403).end('Verboten'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`404 – ${e.message}`);
  }
}).listen(port, '127.0.0.1', () => console.log(`Stempel-Studio: http://localhost:${port}/tools/stamp-studio.html`));
