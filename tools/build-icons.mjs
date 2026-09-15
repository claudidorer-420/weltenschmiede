// Erzeugt js/data/gameicons.js: nur die Symbole aus game-icons.net (CC BY 3.0), die js/data/artmap.js verwendet.
// Quelle: Iconify-Satz „game-icons“ (https://cdn.jsdelivr.net/npm/@iconify-json/game-icons/icons.json).
// Aufruf: node tools/build-icons.mjs <pfad/zu/icons.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const file = process.argv[2];
if (!file) { console.error('Aufruf: node tools/build-icons.mjs <icons.json>'); process.exit(1); }
const set = JSON.parse(readFileSync(file, 'utf8'));
const { allIconNames } = await import(pathToFileURL(join(root, 'js', 'data', 'artmap.js')).href);

// Pfaddaten auf eine Nachkommastelle runden (Ansicht 512 × 512). SVG erlaubt Zahlen ohne Trennzeichen („1.5.5“ = 1.5 und .5),
// deshalb wird jede Zahl einzeln erkannt und – wo nötig – mit Leerzeichen abgetrennt wieder geschrieben.
function roundPath(d) {
  const re = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
  let out = '';
  let last = 0;
  let prev = null;
  let m;
  while ((m = re.exec(d))) {
    const between = d.slice(last, m.index);
    out += between;
    let s = String(Math.round(parseFloat(m[0]) * 10) / 10);
    if (s === '-0') s = '0';
    s = s.replace(/^(-?)0\./, '$1.');
    if (between === '' && prev != null && !s.startsWith('-') && (!s.startsWith('.') || !prev.includes('.'))) out += ' ';
    out += s;
    prev = s;
    last = m.index + m[0].length;
  }
  return out + d.slice(last);
}

const names = allIconNames().sort();
const out = {};
const missing = [];
for (const n of names) {
  const ic = set.icons[n] || (set.aliases?.[n] && set.icons[set.aliases[n].parent]);
  if (!ic) { missing.push(n); continue; }
  const w = ic.width || set.width || 512;
  const h = ic.height || set.height || 512;
  const body = ic.body.replace(/\s+/g, ' ').replace(/fill="currentColor"/g, '').replace(/ d="([^"]+)"/g, (_, p) => ` d="${roundPath(p)}"`).trim();
  out[n] = w === 512 && h === 512 ? body : [body, w, h];
}
const js = `// Symbole von game-icons.net (CC BY 3.0 – Lorc, Delapouite und weitere, https://game-icons.net).
// Generiert von tools/build-icons.mjs aus js/data/artmap.js – nicht von Hand bearbeiten.
export const GI = ${JSON.stringify(out)};
`;
writeFileSync(join(root, 'js', 'data', 'gameicons.js'), js);
console.log(`${Object.keys(out).length} Symbole, ${(js.length / 1024).toFixed(0)} KB`);
if (missing.length) console.log('Fehlend:', missing.join(', '));
