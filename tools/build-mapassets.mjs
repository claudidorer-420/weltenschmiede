// Erzeugt js/data/mapassets.js aus tools/mapassets.gen.json (Ergebnis des Stempel-Studios) und
// tools/mapassets.src.json (Reihenfolge, Kategorien). Aufruf: node tools/build-mapassets.mjs
import { readFile, writeFile } from 'node:fs/promises';

const src = JSON.parse(await readFile(new URL('./mapassets.src.json', import.meta.url), 'utf8'));
const gen = JSON.parse(await readFile(new URL('./mapassets.gen.json', import.meta.url), 'utf8'));
const order = new Map(src.models.map((m, i) => [m.id, i]));
const torder = new Map(src.textures.map((t, i) => [t.id, i]));

const stamps = Object.values(gen.stamps || {})
  .filter((s) => order.has(s.src))
  .sort((a, b) => order.get(a.src) - order.get(b.src) || a.id.localeCompare(b.id))
  .map((s) => {
    const r = { id: s.id, name: s.name, cat: s.cat, w: s.w, h: s.h };
    if (s.tags) r.tags = s.tags;
    if (s.block) r.block = 1;
    if (s.rough) r.rough = 1;
    if (s.layer) r.layer = s.layer;
    return r;
  });
const textures = Object.values(gen.textures || {})
  .filter((t) => torder.has(t.id))
  .sort((a, b) => torder.get(a.id) - torder.get(b.id))
  .map((t) => ({ id: t.id, name: t.name, cat: t.cat, m: t.m }));

const js = `// Generiert von tools/build-mapassets.mjs – nicht von Hand bearbeiten.
// Stempel: 3D-Modelle von Poly Haven (CC0, polyhaven.com), von oben gerendert (tools/stamp-studio.html).
// Texturen: Poly Haven (CC0). Dateien liegen unter assets/stamps/ und assets/tex/ (Vorschau jeweils in t/).
// w/h = Grundfläche in Feldern (1,5 m), m = Kantenlänge einer Texturkachel in Metern.
export const STAMPS = ${JSON.stringify(stamps)};
export const TEXTURES = ${JSON.stringify(textures)};
`;
await writeFile(new URL('../js/data/mapassets.js', import.meta.url), js);
console.log(`${stamps.length} Stempel, ${textures.length} Texturen → js/data/mapassets.js`);
