// Farb- und Kontrastvarianten der Texturen: aus wenigen Grundtexturen entstehen viele Spielarten
// („Dunkles Gras“, „Rote Wüste“, „Verschneiter Waldboden“ …). Rein rechnerisch, ohne zusätzliche Dateien –
// die Varianten werden beim Zeichnen mit einem Canvas-Filter erzeugt und zwischengespeichert.
import { TEXTURES } from './mapassets.js';

// b = Helligkeit, s = Sättigung, c = Kontrast, h = Farbdrehung in Grad
export const TEX_MODS = {
  dunkel: { name: 'dunkel', b: 0.72, s: 0.95, c: 1.05 },
  finster: { name: 'finster', b: 0.5, s: 0.85, c: 1.12 },
  hell: { name: 'hell', b: 1.22, s: 0.95 },
  verblasst: { name: 'verblasst', b: 1.08, s: 0.5 },
  satt: { name: 'satt', b: 0.98, s: 1.4, c: 1.06 },
  warm: { name: 'rötlich', h: -14, s: 1.2, b: 1.02 },
  kalt: { name: 'bläulich', h: 20, s: 1.1, b: 0.97 },
  moosig: { name: 'moosig', h: 38, s: 1.2, b: 0.95 },
  duerr: { name: 'dürr', h: -26, s: 1.15, b: 1.08 },
  nass: { name: 'nass', b: 0.78, c: 1.22, s: 1.18 },
  verschneit: { name: 'verschneit', b: 1.5, s: 0.22, c: 0.92 },
  verbrannt: { name: 'verbrannt', b: 0.48, s: 0.3, c: 1.25 },
  giftig: { name: 'giftig', h: 62, s: 1.6, b: 0.95 },
  uralt: { name: 'uralt', b: 0.88, s: 0.6, c: 0.94 },
};

// Welche Spielarten für welche Art von Textur sinnvoll sind
const BY_CAT = {
  gelaende: ['dunkel', 'hell', 'verblasst', 'satt', 'warm', 'kalt', 'duerr', 'nass', 'verschneit', 'verbrannt'],
  boden: ['dunkel', 'hell', 'verblasst', 'warm', 'kalt', 'nass', 'uralt'],
  pflaster: ['dunkel', 'hell', 'verblasst', 'moosig', 'nass', 'verschneit', 'uralt'],
  wand: ['dunkel', 'finster', 'hell', 'moosig', 'warm', 'verbrannt', 'uralt'],
  dach: ['dunkel', 'hell', 'warm', 'kalt', 'verschneit'],
};

export const VAR_SEP = '~';
export const splitTex = (id) => {
  const i = String(id).indexOf(VAR_SEP);
  return i < 0 ? [String(id), ''] : [String(id).slice(0, i), String(id).slice(i + 1)];
};

// Alle Varianten als eigene Einträge (id: "<basis>~<spielart>")
export const TEX_VARIANTS = TEXTURES.flatMap((t) => (BY_CAT[t.cat] || []).map((k) => ({
  id: `${t.id}${VAR_SEP}${k}`,
  name: `${t.name} (${TEX_MODS[k].name})`,
  cat: t.cat,
  m: t.m,
  base: t.id,
  mod: k,
})));
export const ALL_TEXTURES = [...TEXTURES, ...TEX_VARIANTS];

// CSS-Filter für eine Spielart
export function modFilter(key) {
  const m = TEX_MODS[key];
  if (!m) return '';
  const parts = [];
  if (m.h) parts.push(`hue-rotate(${m.h}deg)`);
  if (m.s != null) parts.push(`saturate(${m.s})`);
  if (m.b != null) parts.push(`brightness(${m.b})`);
  if (m.c != null) parts.push(`contrast(${m.c})`);
  return parts.join(' ');
}

// ── Flüssigkeiten: dieselben Spielarten über eine Farbverschiebung ──
const hex = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
function rgb2hsl(r, g, b) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const mx = Math.max(R, G, B); const mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  let h = 0; let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
    else if (mx === G) h = ((B - R) / d + 2) / 6;
    else h = ((R - G) / d + 4) / 6;
  }
  return [h * 360, s, l];
}
function hsl2rgb(h, s, l) {
  const H = ((h % 360) + 360) % 360 / 360;
  if (!s) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t0) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(H + 1 / 3) * 255, f(H) * 255, f(H - 1 / 3) * 255];
}
// Für Flüssigkeiten: fester Farbton je Spielart (relative Drehung führt bei Blau zu Violett)
export const FLUID_HUE = { warm: 14, kalt: 206, moosig: 112, duerr: 44, giftig: 104, verbrannt: 18, verschneit: 200 };

export function shiftColor(color, key, { fluid = false } = {}) {
  const m = TEX_MODS[key];
  const c = hex(color);
  if (!m || !c) return color;
  const [h, s, l] = rgb2hsl(c[0], c[1], c[2]);
  const abs = fluid ? FLUID_HUE[key] : undefined;
  const hue = abs != null ? abs : h + (m.h || 0);
  const sat = Math.max(0, Math.min(1, s * (m.s ?? 1) * (abs != null ? 1.15 : 1)));
  const lum = Math.max(0.03, Math.min(0.97, l * (m.b ?? 1)));
  const [r, g, b] = hsl2rgb(hue, sat, lum);
  return toHex(r, g, b);
}
