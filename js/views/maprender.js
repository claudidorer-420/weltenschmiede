// Kartenwerkstatt – realistische Darstellung für den Karten-Editor: Texturen (Poly Haven, CC0), Stempel
// (von oben gerenderte 3D-Modelle), eigene Assets (nur lokal importiert), prozedurale Bauteile (Türen, Treppen,
// Teppiche, Feuer …), weiche Geländeübergänge, Wasser/Lava, texturierte Wände mit Schatten, Dächer und Licht.
import { STAMPS, TEXTURES } from '../data/mapassets.js';
import { ALL_TEXTURES, TEX_MODS, splitTex, modFilter, shiftColor } from '../data/texvars.js';
import { userAssetInfo, userAssetImage, userThumb, onUserAssets } from '../core/userassets.js';

// Im MCP-Server (Cloudflare Worker) gibt es keine Modul-URL – dort werden keine Bilder geladen
const ASSETS = (() => { try { return new URL('../../assets/', import.meta.url).href; } catch { return 'assets/'; } })();
export const STAMP_BY_ID = new Map(STAMPS.map((s) => [s.id, s]));
export const TEX_BY_ID = new Map(ALL_TEXTURES.map((t) => [t.id, t]));
export const texUrl = (id, thumb = false) => `${ASSETS}tex/${thumb ? 't/' : ''}${id}.webp`;
export const stampUrl = (id, thumb = false) => `${ASSETS}stamps/${thumb ? 't/' : ''}${id}.webp`;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ───────────────────────── Laden & Benachrichtigen ─────────────────────────
let ver = 0;
let raf = 0;
const subs = new Set();
function bump() {
  ver++;
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; for (const f of subs) f(ver); });
}
onUserAssets(bump);
export const assetsVersion = () => ver;
export function onAssets(fn) { subs.add(fn); return () => subs.delete(fn); }
const varCache = new Map();
// Texturbild – bei Varianten („basis~spielart“) wird die Kachel einmal eingefärbt
export function texImage(id) {
  const [base, mod] = splitTex(id);
  const im = img(texUrl(base));
  if (!im || !mod || !TEX_MODS[mod]) return im;
  const key = `${base}~${mod}`;
  const hit = varCache.get(key);
  if (hit && hit.src === im) return hit.cv;
  const cv = document.createElement('canvas');
  cv.width = im.width;
  cv.height = im.height;
  const g = cv.getContext('2d');
  if (FILTER) g.filter = modFilter(mod);
  g.drawImage(im, 0, 0);
  varCache.set(key, { src: im, cv });
  return cv;
}
// Vorschaubild: bei Varianten als Daten-URL (einmal berechnet)
const varThumbs = new Map();
export function texThumb(id) {
  const [base, mod] = splitTex(id);
  if (!mod) return texUrl(base, true);
  const key = `${base}~${mod}`;
  if (varThumbs.has(key)) return varThumbs.get(key);
  const im = img(texUrl(base, true));
  if (!im) return texUrl(base, true);
  const cv = document.createElement('canvas');
  cv.width = im.width;
  cv.height = im.height;
  const g = cv.getContext('2d');
  if (FILTER) g.filter = modFilter(mod);
  g.drawImage(im, 0, 0);
  let url = '';
  try { url = cv.toDataURL('image/webp', 0.8); } catch { url = texUrl(base, true); }
  varThumbs.set(key, url);
  return url;
}
const imgCache = new Map();
export function img(url) {
  let e = imgCache.get(url);
  if (!e) {
    const im = new Image();
    im.decoding = 'async';
    e = { im, ok: false, err: false };
    im.onload = () => { e.ok = true; bump(); };
    im.onerror = () => { e.err = true; bump(); };
    im.src = url;
    imgCache.set(url, e);
  }
  return e.ok ? e.im : null;
}
function waitImg(url) {
  img(url);
  const e = imgCache.get(url);
  if (e.ok || e.err) return Promise.resolve();
  return new Promise((ok) => { e.im.addEventListener('load', ok, { once: true }); e.im.addEventListener('error', ok, { once: true }); });
}
const pool = new Map();
function canvasOf(name, w, h) {
  let cv = pool.get(name);
  if (!cv) { cv = document.createElement('canvas'); pool.set(name, cv); }
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } else cv.getContext('2d').clearRect(0, 0, w, h);
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.filter = 'none';
  return cv;
}
let OX = 0; // Ursprung des gerenderten Ausschnitts in Feldern
let OY = 0;
const T = (c, cs) => c.setTransform(cs, 0, 0, cs, -OX * cs, -OY * cs);
const FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
function blurred(name, src, r) {
  const d = canvasOf(name, src.width, src.height);
  const g = d.getContext('2d');
  if (FILTER && r > 0.3) g.filter = `blur(${r}px)`;
  g.drawImage(src, 0, 0);
  g.filter = 'none';
  return d;
}
// Deterministischer Zufall (gleiches Ergebnis bei jedem Rendern)
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// ───────────────────────── Texturen ─────────────────────────
// unit = Pixel pro Feld im aktuellen Koordinatensystem (1 bei Feld-Transform, cs bei Pixel-Koordinaten)
const TEX_FALLBACK = { boden: '#8b7d6b', pflaster: '#8a857b', gelaende: '#6f7a4a', wand: '#6d665d', dach: '#7a5a44' };
export function pat(ctx, id, unit, fallback) {
  const t = TEX_BY_ID.get(id);
  const im = t && texImage(id);
  if (!im) return fallback || TEX_FALLBACK[t?.cat] || '#7d7468';
  const p = ctx.createPattern(im, 'repeat');
  const tile = ((t.m || 2) / 1.5) * unit;
  try { p.setTransform(new DOMMatrix().scale(tile / im.width)); } catch { /* alte Browser */ }
  return p;
}
export const texName = (id) => TEX_BY_ID.get(id)?.name || id;

// Großflächige Helligkeitsschwankung, damit Kacheln nicht als Muster auffallen
let noiseCv = null;
function variation(ctx, w, h, a = 0.22) {
  if (!noiseCv) {
    noiseCv = document.createElement('canvas');
    noiseCv.width = noiseCv.height = 24;
    const g = noiseCv.getContext('2d');
    const r = rng(7);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) { const v = Math.round(96 + r() * 64); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1); }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = a;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(noiseCv, 0, 0, w, h);
  ctx.restore();
}

// ───────────────────────── Formen ─────────────────────────
export function tracePath(c, s) {
  const p = s.pts || [];
  c.beginPath();
  if (s.kind === 'cells') {
    for (let i = 0; i < p.length; i += 2) c.rect(p[i], p[i + 1], 1, 1);
    return;
  }
  if (s.kind === 'rect' || s.kind === 'ellipse') {
    const [x1, y1, x2, y2] = p;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    if (s.kind === 'rect') c.rect(x, y, w, h);
    else c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, TAU);
    return;
  }
  if (p.length < 2) return;
  c.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
  if (s.kind === 'poly') c.closePath();
  if ((s.kind === 'brush' || s.kind === 'path') && p.length === 2) c.lineTo(p[0] + 0.001, p[1]);
}
function paint(c, s, fill) {
  tracePath(c, s);
  if (s.kind === 'path' || s.kind === 'brush') {
    c.lineWidth = s.w || 1;
    c.lineCap = s.kind === 'path' ? 'square' : 'round';
    c.lineJoin = s.kind === 'path' ? 'miter' : 'round';
    c.strokeStyle = fill;
    c.stroke();
  } else {
    c.fillStyle = fill;
    c.fill();
  }
}
function dilate(name, src, r) {
  const d = canvasOf(name, src.width, src.height);
  const g = d.getContext('2d');
  g.drawImage(src, 0, 0);
  for (const f of r > 10 ? [1, 0.66, 0.33] : [1, 0.5]) {
    const rr = r * f;
    const steps = Math.min(28, Math.max(8, Math.ceil((TAU * rr) / 3)));
    for (let k = 0; k < steps; k++) { const a = (k / steps) * TAU; g.drawImage(src, Math.cos(a) * rr, Math.sin(a) * rr); }
  }
  return d;
}
// Innenkante abdunkeln/aufhellen (Tiefe an Wasserufern, Wänden …)
function edgeTint(dst, mask, r, color, alpha, name = 'edge') {
  const w = mask.width;
  const h = mask.height;
  const inv = canvasOf(`${name}Inv`, w, h);
  const ig = inv.getContext('2d');
  ig.fillStyle = '#000';
  ig.fillRect(0, 0, w, h);
  ig.globalCompositeOperation = 'destination-out';
  ig.drawImage(mask, 0, 0);
  const bl = blurred(`${name}Bl`, inv, r);
  const bg = bl.getContext('2d');
  bg.globalCompositeOperation = 'source-in';
  bg.fillStyle = color;
  bg.fillRect(0, 0, w, h);
  const g = dst.getContext('2d');
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = alpha;
  g.drawImage(bl, 0, 0);
  g.restore();
}

// ───────────────────────── Flüssigkeiten & Sondermaterialien ─────────────────────────
// Klassische Materialien in der realistischen Darstellung
export const MAT_TEX = { grass: 'leafy_grass', sand: 'sand_01', rubble: 'rocks_ground_02', dirt: 'dirt', mud: 'brown_mud', snow: 'snow_02', gravel: 'gravel_ground_01' };
export const FLUIDS = {
  water: { label: 'Wasser', deep: '#173f52', shallow: '#3b7d8c', foam: 'rgba(225,240,238,1)', alpha: 0.88 },
  deepwater: { label: 'Tiefes Wasser', deep: '#0b2434', shallow: '#22596e', foam: 'rgba(210,228,234,1)', alpha: 0.94 },
  swamp: { label: 'Sumpf', deep: '#2a3318', shallow: '#4c5a2c', foam: 'rgba(170,180,110,1)', alpha: 0.88 },
  lava: { label: 'Lava', deep: '#ffb238', shallow: '#c2360c', foam: 'rgba(40,12,6,1)', glow: '#ff7a1a' },
  pit: { label: 'Grube', deep: '#030303', shallow: '#3b3128', foam: 'rgba(0,0,0,1)' },
  blood: { label: 'Blut', deep: '#3d0606', shallow: '#7a1010', foam: 'rgba(160,30,30,1)' },
  ice: { label: 'Eis', deep: '#8fc0d4', shallow: '#dceff6', foam: 'rgba(255,255,255,1)', alpha: 0.9 },
};
function waves(g, w, h, cs, color, a, seed) {
  const r = rng(seed);
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = a;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1, cs * 0.035);
  g.lineCap = 'round';
  const n = Math.round((w * h) / (cs * cs) * 1.2);
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = r() * h;
    const len = cs * (0.3 + r() * 0.6);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + len / 2, y - cs * 0.08, x + len, y);
    g.stroke();
  }
  g.restore();
}
// „water~dunkel“ & Co.: Farben rechnerisch verschieben
export function fluidOf(kind) {
  const [base, mod] = splitTex(kind);
  const f = FLUIDS[base];
  if (!f) return null;
  if (!mod || !TEX_MODS[mod]) return f;
  return { ...f, label: `${f.label} (${TEX_MODS[mod].name})`, deep: shiftColor(f.deep, mod, { fluid: true }), shallow: shiftColor(f.shallow, mod, { fluid: true }) };
}

function fluidLayer(mask, kind, cs, seed) {
  const f = fluidOf(kind) || FLUIDS.water;
  const w = mask.width;
  const h = mask.height;
  const out = canvasOf(`fluid_${kind}`, w, h);
  const g = out.getContext('2d');
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = f.deep;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  edgeTint(out, mask, cs * (kind === 'pit' ? 0.5 : 0.8), f.shallow, kind === 'pit' ? 0.95 : 0.8, 'fl1');
  if (kind === 'ice') {
    const r = rng(seed);
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.strokeStyle = 'rgba(255,255,255,.55)';
    g.lineWidth = Math.max(1, cs * 0.02);
    for (let i = 0; i < (w * h) / (cs * cs) * 0.6; i++) { let x = r() * w; let y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * cs; y += (r() - 0.5) * cs; g.lineTo(x, y); } g.stroke(); }
    g.restore();
  } else if (kind === 'lava') {
    const r = rng(seed);
    g.save();
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < (w * h) / (cs * cs) * 0.8; i++) { const x = r() * w; const y = r() * h; const rr = cs * (0.15 + r() * 0.35); const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(255,240,150,.8)'); gr.addColorStop(1, 'rgba(255,120,20,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    g.restore();
  } else if (kind !== 'pit') waves(g, w, h, cs, 'rgba(255,255,255,1)', kind === 'blood' ? 0.06 : 0.12, seed);
  edgeTint(out, mask, Math.max(1, cs * 0.09), f.foam, kind === 'pit' ? 0.9 : 0.34, 'fl2');
  return out;
}

// ───────────────────────── Prozedurale Bauteile ─────────────────────────
// Werden mit Texturen gezeichnet (128 px pro Feld) und wie Stempel behandelt.
const WOOD = 'weathered_planks';
const WOOD_D = 'dark_wooden_planks';
const STONE = 'stone_tiles';
const BRICK = 'castle_brick_01';
const MARBLE = 'marble_01';
const SANDST = 'large_sandstone_blocks_01';
const COBBLE = 'cobblestone_floor_01';
function rr(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
function bevel(g, x, y, w, h, a = 0.4) {
  const gr = g.createLinearGradient(x, y, x + w * 0.6, y + h);
  gr.addColorStop(0, `rgba(255,255,255,${a * 0.45})`);
  gr.addColorStop(0.45, 'rgba(0,0,0,0)');
  gr.addColorStop(1, `rgba(0,0,0,${a})`);
  g.fillStyle = gr;
  g.fill();
}
function outline(g, lw, color = 'rgba(0,0,0,.75)') { g.lineWidth = lw; g.strokeStyle = color; g.stroke(); }
function flame(g, x, y, r) {
  for (const [k, c] of [[1, 'rgba(255,90,10,.85)'], [0.7, 'rgba(255,170,40,.95)'], [0.4, 'rgba(255,245,190,1)']]) {
    g.beginPath();
    g.moveTo(x, y - r * k * 1.25);
    g.bezierCurveTo(x + r * k * 0.9, y - r * k * 0.3, x + r * k * 0.7, y + r * k * 0.8, x, y + r * k * 0.8);
    g.bezierCurveTo(x - r * k * 0.7, y + r * k * 0.8, x - r * k * 0.9, y - r * k * 0.3, x, y - r * k * 1.25);
    g.fillStyle = c;
    g.fill();
  }
}
function glowDot(g, x, y, r, color) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}
function stoneBlob(g, x, y, r, seed, fill) {
  const rnd = rng(seed);
  g.beginPath();
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const rr2 = r * (0.78 + rnd() * 0.3);
    if (i) g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); else g.moveTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r * 1.1);
  gr.addColorStop(0, 'rgba(255,255,255,.28)');
  gr.addColorStop(1, 'rgba(0,0,0,.45)');
  g.fillStyle = gr;
  g.fill();
  outline(g, Math.max(1, r * 0.08), 'rgba(0,0,0,.55)');
}
function jambs(g, u, W, H) {
  for (const x of [0, W - u * 0.16]) {
    rr(g, x, 0, u * 0.16, H, u * 0.02);
    g.fillStyle = pat(g, BRICK, u, '#6a645c');
    g.fill();
    bevel(g, x, 0, u * 0.16, H, 0.5);
    outline(g, u * 0.02);
  }
}
function doorLeaf(g, u, x, y, w, h, tex, iron = false) {
  rr(g, x, y, w, h, u * 0.02);
  g.fillStyle = iron ? '#5c6066' : pat(g, tex, u, '#7a5534');
  g.fill();
  bevel(g, x, y, w, h, 0.45);
  outline(g, u * 0.025);
  g.strokeStyle = 'rgba(0,0,0,.45)';
  g.lineWidth = u * 0.015;
  const n = Math.max(2, Math.round(w / (u * 0.18)));
  for (let i = 1; i < n; i++) { g.beginPath(); g.moveTo(x + (w * i) / n, y); g.lineTo(x + (w * i) / n, y + h); g.stroke(); }
  g.fillStyle = iron ? '#3b3e42' : '#2c2a28';
  for (const fx of [0.2, 0.8]) g.fillRect(x + w * fx - u * 0.03, y, u * 0.06, h);
  if (iron) { g.fillStyle = '#9aa0a6'; for (let i = 0; i < n * 2; i++) { g.beginPath(); g.arc(x + (w * (i + 0.5)) / (n * 2), y + h / 2, u * 0.018, 0, TAU); g.fill(); } }
}
export const PROC = {
  door: { name: 'Holztür', cat: 'tueren', w: 1, h: 0.3, tex: [WOOD, BRICK], door: true, draw: (g, u, W, H) => { jambs(g, u, W, H); doorLeaf(g, u, u * 0.16, H * 0.18, W - u * 0.32, H * 0.64, WOOD); } },
  door2: { name: 'Doppeltür', cat: 'tueren', w: 2, h: 0.3, tex: [WOOD, BRICK], door: true, draw: (g, u, W, H) => { jambs(g, u, W, H); const w = (W - u * 0.32) / 2; doorLeaf(g, u, u * 0.16, H * 0.18, w, H * 0.64, WOOD); doorLeaf(g, u, u * 0.16 + w, H * 0.18, w, H * 0.64, WOOD); } },
  doorIron: { name: 'Eisentür', cat: 'tueren', w: 1, h: 0.3, tex: [BRICK], door: true, draw: (g, u, W, H) => { jambs(g, u, W, H); doorLeaf(g, u, u * 0.16, H * 0.18, W - u * 0.32, H * 0.64, WOOD, true); } },
  doorDark: { name: 'Eichentür', cat: 'tueren', w: 1, h: 0.3, tex: [WOOD_D, BRICK], door: true, draw: (g, u, W, H) => { jambs(g, u, W, H); doorLeaf(g, u, u * 0.16, H * 0.18, W - u * 0.32, H * 0.64, WOOD_D); } },
  portcullis: { name: 'Fallgitter', cat: 'tueren', w: 1, h: 0.3, tex: [BRICK], door: true, draw: (g, u, W, H) => { jambs(g, u, W, H); g.fillStyle = '#2e3033'; g.fillRect(u * 0.16, H * 0.42, W - u * 0.32, H * 0.16); g.fillStyle = '#6b7075'; for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(u * 0.22 + ((W - u * 0.44) * i) / 6, H / 2, u * 0.035, 0, TAU); g.fill(); } } },
  arch: { name: 'Durchgang', cat: 'tueren', w: 1, h: 0.3, tex: [BRICK], door: true, draw: (g, u, W, H) => jambs(g, u, W, H) },
  secret: { name: 'Geheimtür', cat: 'tueren', w: 1, h: 0.3, tex: [BRICK], door: true, draw: (g, u, W, H) => { rr(g, 0, 0, W, H, u * 0.02); g.fillStyle = pat(g, BRICK, u, '#6a645c'); g.fill(); g.setLineDash([u * 0.06, u * 0.05]); outline(g, u * 0.02, 'rgba(255,230,160,.55)'); g.setLineDash([]); g.font = `700 ${u * 0.2}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,230,160,.7)'; g.fillText('S', W / 2, H / 2 + u * 0.01); } },
  stairs: {
    name: 'Steintreppe', cat: 'bau', w: 1, h: 2, tex: [STONE], rough: true,
    draw: (g, u, W, H) => { const n = 8; for (let i = 0; i < n; i++) { const y = (H * i) / n; rr(g, 0, y, W, H / n, u * 0.01); g.fillStyle = pat(g, STONE, u, '#8a8378'); g.fill(); g.fillStyle = `rgba(0,0,0,${0.05 + (i / n) * 0.55})`; g.fill(); g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, y + H / n - u * 0.03, W, u * 0.03); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, y, W, u * 0.02); } g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, u * 0.06, H); g.fillRect(W - u * 0.06, 0, u * 0.06, H); },
  },
  stairsWood: {
    name: 'Holztreppe', cat: 'bau', w: 1, h: 2, tex: [WOOD], rough: true,
    draw: (g, u, W, H) => { const n = 8; for (let i = 0; i < n; i++) { const y = (H * i) / n; rr(g, 0, y, W, H / n, 0); g.fillStyle = pat(g, WOOD, u, '#7a5534'); g.fill(); g.fillStyle = `rgba(0,0,0,${0.05 + (i / n) * 0.5})`; g.fill(); g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, y + H / n - u * 0.025, W, u * 0.025); } g.fillStyle = '#3d2a1a'; g.fillRect(0, 0, u * 0.07, H); g.fillRect(W - u * 0.07, 0, u * 0.07, H); },
  },
  pillar: {
    name: 'Säule', cat: 'bau', w: 1, h: 1, hM: 3, tex: [MARBLE], block: true,
    draw: (g, u, W, H) => { g.beginPath(); g.arc(W / 2, H / 2, W * 0.46, 0, TAU); g.fillStyle = pat(g, STONE, u, '#8b857c'); g.fill(); outline(g, u * 0.025); g.beginPath(); g.arc(W / 2, H / 2, W * 0.38, 0, TAU); g.fillStyle = pat(g, MARBLE, u, '#cfc9bf'); g.fill(); const gr = g.createRadialGradient(W * 0.38, H * 0.36, W * 0.02, W / 2, H / 2, W * 0.42); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = gr; g.fill(); outline(g, u * 0.015, 'rgba(0,0,0,.5)'); },
  },
  pillarSq: {
    name: 'Eckpfeiler', cat: 'bau', w: 1, h: 1, hM: 3, tex: [BRICK], block: true,
    draw: (g, u, W, H) => { rr(g, W * 0.08, H * 0.08, W * 0.84, H * 0.84, u * 0.03); g.fillStyle = pat(g, BRICK, u, '#6a645c'); g.fill(); bevel(g, W * 0.08, H * 0.08, W * 0.84, H * 0.84, 0.55); outline(g, u * 0.025); rr(g, W * 0.22, H * 0.22, W * 0.56, H * 0.56, u * 0.02); g.fillStyle = 'rgba(255,255,255,.08)'; g.fill(); outline(g, u * 0.012, 'rgba(0,0,0,.35)'); },
  },
  altar: {
    name: 'Altar', cat: 'bau', w: 2, h: 1, hM: 1, tex: [SANDST], block: true,
    draw: (g, u, W, H) => { rr(g, W * 0.04, H * 0.1, W * 0.92, H * 0.8, u * 0.05); g.fillStyle = pat(g, SANDST, u, '#b9ab8e'); g.fill(); bevel(g, W * 0.04, H * 0.1, W * 0.92, H * 0.8, 0.5); outline(g, u * 0.025); g.fillStyle = '#7a1414'; g.fillRect(W * 0.38, H * 0.1, W * 0.24, H * 0.8); g.fillStyle = '#d4a93a'; g.fillRect(W * 0.38, H * 0.1, W * 0.015, H * 0.8); g.fillRect(W * 0.605, H * 0.1, W * 0.015, H * 0.8); for (const x of [0.2, 0.8]) { g.beginPath(); g.arc(W * x, H / 2, u * 0.07, 0, TAU); g.fillStyle = '#efe6c8'; g.fill(); flame(g, W * x, H / 2 - u * 0.02, u * 0.05); } },
    glow: { r: 2.2, color: 'rgba(255,190,90,.35)' },
  },
  well: {
    name: 'Brunnen', cat: 'bau', w: 1, h: 1, hM: 1, tex: [COBBLE, WOOD], block: true,
    draw: (g, u, W, H) => { g.beginPath(); g.arc(W / 2, H / 2, W * 0.47, 0, TAU); g.fillStyle = pat(g, COBBLE, u, '#817a70'); g.fill(); outline(g, u * 0.03); g.beginPath(); g.arc(W / 2, H / 2, W * 0.3, 0, TAU); const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.3); gr.addColorStop(0, '#0a1a22'); gr.addColorStop(1, '#1d3a44'); g.fillStyle = gr; g.fill(); outline(g, u * 0.02); g.fillStyle = pat(g, WOOD, u, '#6b4a2c'); g.fillRect(W * 0.05, H * 0.45, W * 0.9, H * 0.1); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = u * 0.015; g.strokeRect(W * 0.05, H * 0.45, W * 0.9, H * 0.1); },
  },
  fountain: {
    name: 'Zierbrunnen', cat: 'bau', w: 2, h: 2, hM: 1.5, tex: [MARBLE, SANDST], block: true,
    draw: (g, u, W, H) => { const oct = (r) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + Math.PI / 8; const x = W / 2 + Math.cos(a) * r; const y = H / 2 + Math.sin(a) * r; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); }; oct(W * 0.48); g.fillStyle = pat(g, SANDST, u, '#b9ab8e'); g.fill(); outline(g, u * 0.03); oct(W * 0.4); const gr = g.createRadialGradient(W / 2, H / 2, W * 0.05, W / 2, H / 2, W * 0.4); gr.addColorStop(0, '#6fb5c2'); gr.addColorStop(1, '#23596b'); g.fillStyle = gr; g.fill(); outline(g, u * 0.02); for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(W / 2, H / 2, W * (0.16 + i * 0.07), 0, TAU); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = u * 0.015; g.stroke(); } g.beginPath(); g.arc(W / 2, H / 2, W * 0.1, 0, TAU); g.fillStyle = pat(g, MARBLE, u, '#d8d2c8'); g.fill(); outline(g, u * 0.02); },
  },
  trapdoor: {
    name: 'Falltür', cat: 'bau', w: 1, h: 1, tex: [WOOD], layer: 'floor',
    draw: (g, u, W, H) => { doorLeaf(g, u, W * 0.1, H * 0.1, W * 0.8, H * 0.8, WOOD); g.beginPath(); g.arc(W * 0.7, H / 2, u * 0.07, 0, TAU); g.strokeStyle = '#a9aeb3'; g.lineWidth = u * 0.025; g.stroke(); },
  },
  trap: {
    name: 'Druckplatte', cat: 'dungeon', w: 1, h: 1, tex: [STONE], layer: 'floor',
    draw: (g, u, W, H) => { rr(g, W * 0.15, H * 0.15, W * 0.7, H * 0.7, u * 0.03); g.fillStyle = pat(g, STONE, u, '#7d776e'); g.fill(); g.fillStyle = 'rgba(0,0,0,.25)'; g.fill(); outline(g, u * 0.02, 'rgba(0,0,0,.6)'); g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = u * 0.012; g.beginPath(); g.moveTo(W * 0.3, H * 0.3); g.lineTo(W * 0.45, H * 0.5); g.lineTo(W * 0.4, H * 0.7); g.stroke(); },
  },
  coffin: {
    name: 'Sarg', cat: 'dungeon', w: 1, h: 2, hM: 0.6, tex: [WOOD_D], rough: true,
    draw: (g, u, W, H) => { g.beginPath(); g.moveTo(W * 0.5, H * 0.03); g.lineTo(W * 0.86, H * 0.2); g.lineTo(W * 0.74, H * 0.97); g.lineTo(W * 0.26, H * 0.97); g.lineTo(W * 0.14, H * 0.2); g.closePath(); g.fillStyle = pat(g, WOOD_D, u, '#4a3322'); g.fill(); bevel(g, 0, 0, W, H, 0.45); outline(g, u * 0.025); g.fillStyle = '#b39150'; g.fillRect(W * 0.47, H * 0.2, W * 0.06, H * 0.45); g.fillRect(W * 0.36, H * 0.3, W * 0.28, H * 0.035); },
  },
  sarcophagus: {
    name: 'Sarkophag', cat: 'dungeon', w: 1, h: 2, hM: 1, tex: [SANDST], block: true,
    draw: (g, u, W, H) => { rr(g, W * 0.08, H * 0.03, W * 0.84, H * 0.94, u * 0.12); g.fillStyle = pat(g, SANDST, u, '#b9ab8e'); g.fill(); bevel(g, 0, 0, W, H, 0.5); outline(g, u * 0.025); g.beginPath(); g.ellipse(W / 2, H * 0.2, W * 0.14, H * 0.07, 0, 0, TAU); g.moveTo(W * 0.3, H * 0.3); g.lineTo(W * 0.7, H * 0.3); g.lineTo(W * 0.62, H * 0.88); g.lineTo(W * 0.38, H * 0.88); g.closePath(); g.fillStyle = 'rgba(0,0,0,.12)'; g.fill(); outline(g, u * 0.015, 'rgba(0,0,0,.35)'); },
  },
  throne: {
    name: 'Thron', cat: 'moebel', w: 1, h: 1, hM: 1.6, rough: true,
    draw: (g, u, W, H) => { rr(g, W * 0.08, H * 0.05, W * 0.84, H * 0.9, u * 0.08); g.fillStyle = '#c29a3c'; g.fill(); bevel(g, 0, 0, W, H, 0.5); outline(g, u * 0.025); rr(g, W * 0.22, H * 0.28, W * 0.56, H * 0.6, u * 0.06); g.fillStyle = '#8e1c1c'; g.fill(); bevel(g, W * 0.22, H * 0.28, W * 0.56, H * 0.6, 0.4); g.fillStyle = '#e7c35a'; for (const x of [0.16, 0.84]) { g.beginPath(); g.arc(W * x, H * 0.12, u * 0.07, 0, TAU); g.fill(); } },
  },
  rug: { name: 'Teppich (rot)', cat: 'deko', w: 2, h: 3, layer: 'floor', draw: (g, u, W, H) => rug(g, u, W, H, '#7c1f1f', '#d6a547', '#2d1a3a', 11) },
  rugBlue: { name: 'Teppich (blau)', cat: 'deko', w: 2, h: 3, layer: 'floor', draw: (g, u, W, H) => rug(g, u, W, H, '#1f3d6e', '#d8c07a', '#6e2a1f', 23) },
  rugGreen: { name: 'Läufer (grün)', cat: 'deko', w: 1, h: 4, layer: 'floor', draw: (g, u, W, H) => rug(g, u, W, H, '#2f5132', '#cbb46a', '#5a2a1a', 31) },
  rugRound: {
    name: 'Runder Teppich', cat: 'deko', w: 2, h: 2, layer: 'floor',
    draw: (g, u, W, H) => { const rings = ['#6b1e1e', '#d4a547', '#2d1a3a', '#8a2a2a', '#d4a547']; rings.forEach((c, i) => { g.beginPath(); g.arc(W / 2, H / 2, W * (0.48 - i * 0.08), 0, TAU); g.fillStyle = c; g.fill(); }); const rnd = rng(5); g.globalAlpha = 0.18; for (let i = 0; i < 400; i++) { g.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; g.fillRect(rnd() * W, rnd() * H, u * 0.02, u * 0.02); } g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in'; g.beginPath(); g.arc(W / 2, H / 2, W * 0.48, 0, TAU); g.fill(); g.globalCompositeOperation = 'source-over'; },
  },
  cauldron: {
    name: 'Hexenkessel', cat: 'dungeon', w: 1, h: 1, hM: 0.8, rough: true, glow: { r: 1.6, color: 'rgba(120,255,110,.3)' },
    draw: (g, u, W, H) => { g.beginPath(); g.arc(W / 2, H / 2, W * 0.42, 0, TAU); g.fillStyle = '#1e1f21'; g.fill(); outline(g, u * 0.03); g.beginPath(); g.arc(W / 2, H / 2, W * 0.32, 0, TAU); const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.32); gr.addColorStop(0, '#b9ff7a'); gr.addColorStop(1, '#2f7a24'); g.fillStyle = gr; g.fill(); const rnd = rng(3); for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(W / 2 + (rnd() - 0.5) * W * 0.4, H / 2 + (rnd() - 0.5) * H * 0.4, u * (0.02 + rnd() * 0.04), 0, TAU); g.strokeStyle = 'rgba(230,255,200,.8)'; g.lineWidth = u * 0.01; g.stroke(); } },
  },
  brazier: {
    name: 'Kohlebecken', cat: 'licht', w: 1, h: 1, hM: 1, rough: true, glow: { r: 4, color: 'rgba(255,150,60,.42)' },
    draw: (g, u, W, H) => { g.beginPath(); g.arc(W / 2, H / 2, W * 0.4, 0, TAU); g.fillStyle = '#2b2b2d'; g.fill(); outline(g, u * 0.03); g.beginPath(); g.arc(W / 2, H / 2, W * 0.3, 0, TAU); g.fillStyle = '#3a1a0c'; g.fill(); const rnd = rng(9); for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(W / 2 + (rnd() - 0.5) * W * 0.45, H / 2 + (rnd() - 0.5) * H * 0.45, u * 0.05, 0, TAU); g.fillStyle = rnd() < 0.5 ? '#ff7a1a' : '#ffb347'; g.fill(); } flame(g, W / 2, H / 2, W * 0.2); },
  },
  campfire: {
    name: 'Lagerfeuer', cat: 'licht', w: 1, h: 1, rough: true, glow: { r: 5, color: 'rgba(255,150,60,.45)' }, tex: [WOOD_D],
    draw: (g, u, W, H) => { for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; stoneBlob(g, W / 2 + Math.cos(a) * W * 0.38, H / 2 + Math.sin(a) * H * 0.38, W * 0.09, 40 + i, '#7c766c'); } g.fillStyle = '#1d1511'; g.beginPath(); g.arc(W / 2, H / 2, W * 0.28, 0, TAU); g.fill(); g.save(); g.translate(W / 2, H / 2); for (const a of [0.4, 1.9, 3.4, 4.9]) { g.save(); g.rotate(a); g.fillStyle = pat(g, WOOD_D, u, '#4a3322'); g.fillRect(-W * 0.03, -W * 0.3, W * 0.06, W * 0.3); g.restore(); } g.restore(); flame(g, W / 2, H / 2, W * 0.2); },
  },
  torch: {
    name: 'Wandfackel', cat: 'licht', w: 0.4, h: 0.4, glow: { r: 4, color: 'rgba(255,160,70,.42)' },
    draw: (g, u, W, H) => { g.fillStyle = '#3b2a1c'; g.fillRect(W * 0.42, H * 0.45, W * 0.16, H * 0.5); g.fillStyle = '#555'; g.fillRect(W * 0.3, H * 0.8, W * 0.4, H * 0.12); flame(g, W / 2, H * 0.38, W * 0.26); },
  },
  candles: {
    name: 'Kerzen', cat: 'licht', w: 0.5, h: 0.5, glow: { r: 2, color: 'rgba(255,200,110,.35)' },
    draw: (g, u, W, H) => { for (const [x, y, r] of [[0.35, 0.4, 0.13], [0.65, 0.35, 0.11], [0.5, 0.68, 0.12]]) { g.beginPath(); g.arc(W * x, H * y, W * r, 0, TAU); g.fillStyle = '#efe6cc'; g.fill(); outline(g, u * 0.01, 'rgba(0,0,0,.35)'); flame(g, W * x, H * y - W * 0.02, W * 0.06); } },
  },
  fireplace: {
    name: 'Kamin', cat: 'licht', w: 2, h: 1, hM: 1.5, block: true, tex: [BRICK, WOOD_D], glow: { r: 4.5, color: 'rgba(255,150,60,.42)' },
    draw: (g, u, W, H) => { rr(g, 0, 0, W, H * 0.9, u * 0.04); g.fillStyle = pat(g, BRICK, u, '#6a645c'); g.fill(); bevel(g, 0, 0, W, H * 0.9, 0.5); outline(g, u * 0.025); rr(g, W * 0.2, H * 0.18, W * 0.6, H * 0.72, u * 0.03); g.fillStyle = '#16100c'; g.fill(); g.save(); g.translate(W / 2, H * 0.58); for (const a of [-0.3, 0.3]) { g.save(); g.rotate(Math.PI / 2 + a); g.fillStyle = pat(g, WOOD_D, u, '#4a3322'); g.fillRect(-W * 0.03, -W * 0.2, W * 0.06, W * 0.4); g.restore(); } g.restore(); flame(g, W / 2, H * 0.55, H * 0.25); },
  },
  bones: {
    name: 'Knochen', cat: 'dungeon', w: 1, h: 1, layer: 'floor',
    draw: (g, u, W, H) => { const bone = (x1, y1, x2, y2) => { g.strokeStyle = '#ddd4bd'; g.lineWidth = u * 0.05; g.lineCap = 'round'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); for (const [x, y] of [[x1, y1], [x2, y2]]) { g.beginPath(); g.arc(x, y, u * 0.035, 0, TAU); g.fillStyle = '#e6dec8'; g.fill(); } }; bone(W * 0.15, H * 0.3, W * 0.6, H * 0.55); bone(W * 0.55, H * 0.2, W * 0.8, H * 0.7); bone(W * 0.25, H * 0.8, W * 0.5, H * 0.65); skull(g, u, W * 0.42, H * 0.4, u * 0.16); },
  },
  skull: { name: 'Schädel', cat: 'dungeon', w: 0.4, h: 0.4, layer: 'floor', draw: (g, u, W, H) => skull(g, u, W / 2, H / 2, W * 0.4) },
  web: {
    name: 'Spinnennetz', cat: 'dungeon', w: 2, h: 2, layer: 'top',
    draw: (g, u, W, H) => { g.strokeStyle = 'rgba(235,235,235,.75)'; g.lineWidth = Math.max(1, u * 0.012); for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * W * 0.98, Math.sin(a) * H * 0.98); g.stroke(); } for (let r = 0.18; r < 1; r += 0.14) { g.beginPath(); for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); const x = Math.cos(a) * W * r; const y = Math.sin(a) * H * r; if (i) g.quadraticCurveTo(Math.cos(a - 0.13) * W * r * 0.92, Math.sin(a - 0.13) * H * r * 0.92, x, y); else g.moveTo(x, y); } g.stroke(); } },
  },
  blood: {
    name: 'Blutlache', cat: 'dungeon', w: 1, h: 1, layer: 'floor',
    draw: (g, u, W, H) => { const rnd = rng(17); for (let i = 0; i < 14; i++) { const r = u * (0.03 + rnd() * (i < 3 ? 0.25 : 0.06)); const x = W / 2 + (rnd() - 0.5) * W * (i < 3 ? 0.3 : 0.8); const y = H / 2 + (rnd() - 0.5) * H * (i < 3 ? 0.3 : 0.8); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = 'rgba(90,6,6,.85)'; g.fill(); } g.globalCompositeOperation = 'source-atop'; const gr = g.createRadialGradient(W * 0.4, H * 0.4, 0, W / 2, H / 2, W / 2); gr.addColorStop(0, 'rgba(255,90,90,.25)'); gr.addColorStop(1, 'rgba(0,0,0,.2)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; },
  },
  magic: {
    name: 'Zauberkreis', cat: 'dungeon', w: 3, h: 3, layer: 'floor', glow: { r: 2.6, color: 'rgba(160,110,255,.35)' },
    draw: (g, u, W, H) => { const cx = W / 2; const cy = H / 2; g.strokeStyle = 'rgba(190,150,255,.95)'; g.shadowColor = 'rgba(170,120,255,1)'; g.shadowBlur = u * 0.15; for (const [r, lw] of [[0.47, 0.03], [0.4, 0.015], [0.24, 0.02]]) { g.lineWidth = u * lw; g.beginPath(); g.arc(cx, cy, W * r, 0, TAU); g.stroke(); } g.lineWidth = u * 0.02; g.beginPath(); for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5; const x = cx + Math.cos(a) * W * 0.4; const y = cy + Math.sin(a) * W * 0.4; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); g.font = `700 ${u * 0.16}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(220,200,255,.95)'; const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ'; for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; g.save(); g.translate(cx + Math.cos(a) * W * 0.435, cy + Math.sin(a) * W * 0.435); g.rotate(a + Math.PI / 2); g.fillText(runes[i], 0, 0); g.restore(); } g.shadowBlur = 0; },
  },
  rubble: {
    name: 'Schutt', cat: 'dungeon', w: 1, h: 1, rough: true, tex: [STONE],
    draw: (g, u, W, H) => { const rnd = rng(21); for (let i = 0; i < 11; i++) stoneBlob(g, W * (0.15 + rnd() * 0.7), H * (0.15 + rnd() * 0.7), W * (0.05 + rnd() * 0.11), 50 + i, pat(g, STONE, u, '#8a8378')); },
  },
  bookshelf: {
    name: 'Bücherregal', cat: 'moebel', w: 2, h: 0.6, hM: 2, block: true, tex: [WOOD_D],
    draw: (g, u, W, H) => { rr(g, 0, 0, W, H, u * 0.02); g.fillStyle = pat(g, WOOD_D, u, '#4a3322'); g.fill(); outline(g, u * 0.025); const cols = ['#7c1f1f', '#1f3d6e', '#2f5132', '#b58a2e', '#4b2a5e', '#6b4a2c', '#8e5a1f']; const rnd = rng(33); let x = u * 0.06; while (x < W - u * 0.12) { const w = u * (0.05 + rnd() * 0.06); g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.fillRect(x, H * 0.14, w, H * (0.58 + rnd() * 0.2)); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + w - u * 0.008, H * 0.14, u * 0.008, H * 0.7); x += w + u * 0.006; } bevel(g, 0, 0, W, H, 0.3); },
  },
  counter: {
    name: 'Theke', cat: 'moebel', w: 3, h: 0.8, hM: 1.1, block: true, tex: [WOOD_D],
    draw: (g, u, W, H) => { rr(g, 0, 0, W, H, u * 0.05); g.fillStyle = pat(g, WOOD_D, u, '#4a3322'); g.fill(); bevel(g, 0, 0, W, H, 0.5); outline(g, u * 0.025); g.strokeStyle = 'rgba(255,220,170,.18)'; g.lineWidth = u * 0.02; g.strokeRect(u * 0.06, u * 0.06, W - u * 0.12, H - u * 0.12); },
  },
  bridge: {
    name: 'Holzbrücke', cat: 'bau', w: 2, h: 4, layer: 'floor', tex: [WOOD],
    draw: (g, u, W, H) => { const n = 16; for (let i = 0; i < n; i++) { const y = (H * i) / n; rr(g, W * 0.1, y + u * 0.01, W * 0.8, H / n - u * 0.02, u * 0.01); g.fillStyle = pat(g, WOOD, u, '#7a5534'); g.fill(); g.fillStyle = `rgba(0,0,0,${0.1 + ((i * 37) % 5) * 0.04})`; g.fill(); outline(g, u * 0.01, 'rgba(0,0,0,.6)'); } for (const x of [0.06, 0.94]) { g.fillStyle = '#3d2a1a'; g.fillRect(W * x - u * 0.03, 0, u * 0.06, H); for (let k = 0; k <= 4; k++) { g.beginPath(); g.arc(W * x, (H * k) / 4 || u * 0.06, u * 0.06, 0, TAU); g.fill(); } } },
  },
  fence: {
    name: 'Holzzaun', cat: 'bau', w: 2, h: 0.25, rough: true, tex: [WOOD],
    draw: (g, u, W, H) => { g.fillStyle = pat(g, WOOD, u, '#7a5534'); g.fillRect(0, H * 0.35, W, H * 0.3); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = u * 0.012; g.strokeRect(0, H * 0.35, W, H * 0.3); for (let x = 0; x <= W + 1; x += u * 0.5) { g.beginPath(); g.arc(Math.min(W - H * 0.4, Math.max(H * 0.4, x)), H / 2, H * 0.4, 0, TAU); g.fillStyle = '#4a3322'; g.fill(); outline(g, u * 0.012); } },
  },
  tent: {
    name: 'Zelt', cat: 'bau', w: 3, h: 3, hM: 2.2, block: true,
    draw: (g, u, W, H) => { const c = [W / 2, H / 2]; const pts = [[W * 0.05, H * 0.1], [W * 0.95, H * 0.1], [W * 0.95, H * 0.9], [W * 0.05, H * 0.9]]; const cols = ['#c9b58a', '#a8946a', '#8c7a55', '#b5a176']; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(...c); g.lineTo(...pts[i]); g.lineTo(...pts[(i + 1) % 4]); g.closePath(); g.fillStyle = cols[i]; g.fill(); outline(g, u * 0.02, 'rgba(60,45,25,.8)'); } g.beginPath(); g.arc(...c, u * 0.08, 0, TAU); g.fillStyle = '#5a4128'; g.fill(); },
  },
  lever: {
    name: 'Hebel', cat: 'dungeon', w: 0.5, h: 0.5,
    draw: (g, u, W, H) => { rr(g, W * 0.25, H * 0.55, W * 0.5, H * 0.3, u * 0.02); g.fillStyle = '#55595e'; g.fill(); outline(g, u * 0.015); g.strokeStyle = '#2b2b2b'; g.lineWidth = u * 0.05; g.lineCap = 'round'; g.beginPath(); g.moveTo(W / 2, H * 0.7); g.lineTo(W * 0.75, H * 0.2); g.stroke(); g.beginPath(); g.arc(W * 0.75, H * 0.2, u * 0.06, 0, TAU); g.fillStyle = '#8e1c1c'; g.fill(); },
  },
  rowboat: {
    name: 'Ruderboot', cat: 'bau', w: 1.4, h: 3.2, hM: 0.8, rough: true, tex: [WOOD],
    draw: (g, u, W, H) => { g.beginPath(); g.moveTo(W / 2, 0); g.bezierCurveTo(W * 1.02, H * 0.2, W * 0.98, H * 0.85, W * 0.7, H); g.lineTo(W * 0.3, H); g.bezierCurveTo(W * 0.02, H * 0.85, -W * 0.02, H * 0.2, W / 2, 0); g.closePath(); g.fillStyle = '#4a3322'; g.fill(); outline(g, u * 0.03); g.save(); g.clip(); g.fillStyle = pat(g, WOOD, u, '#7a5534'); g.fillRect(W * 0.1, H * 0.08, W * 0.8, H * 0.88); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, W, H); for (const y of [0.35, 0.6, 0.82]) { g.fillStyle = pat(g, WOOD, u, '#7a5534'); g.fillRect(0, H * y, W, H * 0.06); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, H * y + H * 0.05, W, H * 0.012); } g.restore(); },
  },
};
function skull(g, u, x, y, s) {
  g.beginPath();
  g.ellipse(x, y, s * 0.42, s * 0.5, 0, 0, TAU);
  g.fillStyle = '#e9e1cc';
  g.fill();
  g.fillStyle = 'rgba(0,0,0,.25)';
  g.beginPath();
  g.ellipse(x + s * 0.1, y + s * 0.1, s * 0.3, s * 0.35, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#2a2320';
  for (const dx of [-0.15, 0.15]) { g.beginPath(); g.arc(x + s * dx, y - s * 0.05, s * 0.1, 0, TAU); g.fill(); }
}
function rug(g, u, W, H, base, trim, inner, seed) {
  rr(g, 0, u * 0.05, W, H - u * 0.1, u * 0.02);
  g.fillStyle = base;
  g.fill();
  g.strokeStyle = trim;
  g.lineWidth = u * 0.06;
  g.strokeRect(u * 0.12, u * 0.17, W - u * 0.24, H - u * 0.34);
  g.lineWidth = u * 0.02;
  g.strokeRect(u * 0.22, u * 0.27, W - u * 0.44, H - u * 0.54);
  g.beginPath();
  g.ellipse(W / 2, H / 2, W * 0.28, Math.min(H * 0.3, W * 0.4), 0, 0, TAU);
  g.fillStyle = inner;
  g.fill();
  g.lineWidth = u * 0.03;
  g.stroke();
  const rnd = rng(seed);
  g.globalAlpha = 0.14;
  for (let i = 0; i < W * H / (u * u) * 160; i++) { g.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; g.fillRect(rnd() * W, rnd() * H, u * 0.02, u * 0.02); }
  g.globalAlpha = 1;
  g.strokeStyle = '#e8dcc0';
  g.lineWidth = u * 0.01;
  for (let x = u * 0.04; x < W; x += u * 0.05) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, u * 0.05); g.moveTo(x, H - u * 0.05); g.lineTo(x, H); g.stroke(); }
}
const PPC = 128;
const procCache = new Map();
export function procCanvas(id) {
  const p = PROC[id];
  if (!p) return null;
  const c = procCache.get(id);
  if (c && (c.done || c.ver === ver)) return c.cv;
  const missing = (p.tex || []).filter((t) => !img(texUrl(t))).length;
  const cv = document.createElement('canvas');
  cv.width = Math.max(4, Math.ceil(p.w * PPC));
  cv.height = Math.max(4, Math.ceil(p.h * PPC));
  const g = cv.getContext('2d');
  g.lineJoin = 'round';
  p.draw(g, PPC, cv.width, cv.height);
  procCache.set(id, { cv, done: missing === 0, ver });
  return cv;
}

// ───────────────────────── Assets (Stempel) ─────────────────────────
// Schlüssel: ph:<id> (Bibliothek), p:<id> (Bauteil), u:<id> (eigene Assets)
// Alte Symbole des klassischen Editors werden in der realistischen Darstellung durch passende Stempel ersetzt
export const LEGACY = {
  door: 'p:door', door2: 'p:door2', secret: 'p:secret', portcullis: 'p:portcullis', arch: 'p:arch', stairs: 'p:stairs', pillar: 'p:pillar', statue: 'ph:gothic_statue',
  altar: 'p:altar', fountain: 'p:fountain', well: 'p:well', trapdoor: 'p:trapdoor', trap: 'p:trap', throne: 'p:throne', lever: 'p:lever', table: 'ph:painted_wooden_table',
  roundtable: 'ph:round_wooden_table_02', chair: 'ph:painted_wooden_chair_02', bench: 'ph:painted_wooden_bench', bed: 'ph:gothicbed_01', chest: 'ph:treasure_chest', barrel: 'ph:wine_barrel_01',
  crate: 'ph:wooden_crate_01', bookshelf: 'p:bookshelf', coffin: 'p:coffin', rug: 'p:rugRound', cauldron: 'p:cauldron', brazier: 'p:brazier', campfire: 'p:campfire', tree: 'ph:island_tree_03',
  bush: 'ph:shrub_02_a', rock: 'ph:namaqualand_boulder_05', rubble: 'p:rubble', bones: 'p:bones', web: 'p:web',
};
const split = (key) => { const i = String(key).indexOf(':'); return i < 0 ? ['', key] : [key.slice(0, i), key.slice(i + 1)]; };
export function assetInfo(key) {
  if (!key) return null;
  const [src, id] = split(key);
  if (src === 'ph') { const s = STAMP_BY_ID.get(id); return s ? { ...s, key, src, hM: s.hM ?? (s.block ? 2 : 0.8) } : null; }
  if (src === 'p') { const p = PROC[id]; return p ? { id, key, src, name: p.name, cat: p.cat, w: p.w, h: p.h, block: !!p.block, rough: !!p.rough, layer: p.layer || 'obj', hM: p.hM ?? 0.3, glow: p.glow || null, door: !!p.door } : null; }
  if (src === 'u') { const u = userAssetInfo(id); return u ? { ...u, key, src, hM: u.hM ?? 0.8 } : null; }
  return null;
}
export function assetImage(key) {
  const [src, id] = split(key);
  if (src === 'ph') return img(stampUrl(id));
  if (src === 'p') return procCanvas(id);
  if (src === 'u') return userAssetImage(id);
  return null;
}
export function assetThumb(key) {
  const [src, id] = split(key);
  if (src === 'ph') return stampUrl(id, true);
  if (src === 'p') { const cv = procCanvas(id); try { return cv.toDataURL('image/png'); } catch { return ''; } }
  if (src === 'u') return userThumb(id);
  return '';
}
// Objekt der Karte → { key, info, w, h } (alte Symbole werden eingepasst)
export function objAsset(o, legacyDefs) {
  if (o.t === 'stamp') {
    const info = assetInfo(o.a);
    const sc = o.s || 1;
    return info ? { key: o.a, info, w: info.w * sc, h: info.h * sc } : { key: o.a, info: null, w: sc, h: sc };
  }
  const key = LEGACY[o.t];
  const info = key && assetInfo(key);
  const def = legacyDefs?.[o.t];
  if (!info || !def) return null;
  const sc = o.s || 1;
  const k = Math.min((def.w * sc) / info.w, (def.h * sc) / info.h);
  return { key, info, w: info.w * k, h: info.h * k };
}
export async function preloadMap(m, legacyDefs) {
  const urls = new Set();
  const tex = (id) => urls.add(texUrl(splitTex(id)[0]));
  for (const s of m.shapes || []) if (s.tex) tex(s.tex);
  for (const s of m.shapes || []) if (s.roof) tex(s.roof);
  for (const t of m.terrain || []) if (String(t.mat || '').startsWith('tex:')) tex(t.mat.slice(4)); else if (MAT_TEX[t.mat]) tex(MAT_TEX[t.mat]);
  for (const id of [m.ground || (m.outdoor ? 'leafy_grass' : 'dark_rock'), m.floorTex || 'stone_tiles', m.wallTex || 'castle_brick_01']) tex(id);
  for (const o of m.objects || []) {
    const a = objAsset(o, legacyDefs);
    if (!a) continue;
    const [src, id] = split(a.key);
    if (src === 'ph') urls.add(stampUrl(id));
    if (src === 'p') for (const t of PROC[id]?.tex || []) urls.add(texUrl(t));
  }
  await Promise.all([...urls].map(waitImg));
}

// Weicher Schlagschatten je Asset (einmal berechnet)
const shadowCache = new Map();
function shadowOf(key, im) {
  const c = shadowCache.get(key);
  if (c && c.im === im) return c;
  const max = 160;
  const k = Math.min(1, max / Math.max(im.width, im.height));
  const w = Math.max(2, Math.round(im.width * k));
  const h = Math.max(2, Math.round(im.height * k));
  const pad = Math.ceil(Math.max(w, h) * 0.08) + 4;
  const cv = document.createElement('canvas');
  cv.width = w + pad * 2;
  cv.height = h + pad * 2;
  const g = cv.getContext('2d');
  if (FILTER) g.filter = `blur(${Math.max(2, pad * 0.45)}px)`;
  g.drawImage(im, pad, pad, w, h);
  g.filter = 'none';
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#000';
  g.fillRect(0, 0, cv.width, cv.height);
  const rec = { im, cv, px: pad / w, py: pad / h };
  shadowCache.set(key, rec);
  return rec;
}
function drawAsset(ctx, o, a, { shadow = false, alpha = 1 } = {}) {
  const im = assetImage(a.key);
  ctx.save();
  ctx.translate(o.x, o.y);
  if (shadow) {
    const d = clamp((a.info?.hM ?? 0.6) * 0.07, 0.03, 0.3) * (o.s || 1) ** 0.5;
    ctx.translate(d, d * 1.25);
  }
  if (o.r) ctx.rotate((o.r * Math.PI) / 180);
  if (o.fx) ctx.scale(-1, 1);
  ctx.globalAlpha = alpha * (o.o ?? 1);
  // Weichzeichnen: Stärke wächst mit der Darstellungsgröße (o.b = Pixel bei 40 px/Feld)
  if (o.b && !shadow && FILTER) {
    const sc = ctx.getTransform ? ctx.getTransform().a : 1;
    ctx.filter = `blur(${Math.max(0.3, (o.b * Math.abs(sc)) / 40).toFixed(2)}px)`;
  }
  if (!im) {
    if (!shadow) {
      ctx.fillStyle = 'rgba(120,110,100,.35)';
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 0.04;
      ctx.fillRect(-a.w / 2, -a.h / 2, a.w, a.h);
      ctx.strokeRect(-a.w / 2, -a.h / 2, a.w, a.h);
    }
  } else if (shadow) {
    const s = shadowOf(a.key, im);
    ctx.globalAlpha = 0.5 * alpha;
    ctx.drawImage(s.cv, -a.w / 2 - a.w * s.px, -a.h / 2 - a.h * s.py, a.w * (1 + 2 * s.px), a.h * (1 + 2 * s.py));
  } else ctx.drawImage(im, -a.w / 2, -a.h / 2, a.w, a.h);
  ctx.restore();
}
export function drawStampPreview(ctx, o, legacyDefs, alpha = 0.6) {
  const a = objAsset(o, legacyDefs);
  if (a) drawAsset(ctx, o, a, { alpha });
}

// ───────────────────────── Boden, Gelände, Wände ─────────────────────────
function terrainLayer(tc, m, cs) {
  const g = tc.getContext('2d');
  const rw = tc.width / cs;
  const rh = tc.height / cs;
  const groups = [];
  for (const s of m.terrain || []) {
    const kind = s.op === 'sub' ? 'sub' : s.mat;
    const last = groups[groups.length - 1];
    if (last && last.kind === kind) last.items.push(s);
    else groups.push({ kind, items: [s] });
  }
  const soft = cs * (m.soft ?? 0.3);
  groups.forEach((grp, gi) => {
    const mk = canvasOf('tmask', tc.width, tc.height);
    const mg = mk.getContext('2d');
    T(mg, cs);
    for (const s of grp.items) paint(mg, s, '#fff');
    mg.setTransform(1, 0, 0, 1, 0, 0);
    if (grp.kind === 'sub') {
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(blurred('tmaskB', mk, soft * 0.6), 0, 0);
      g.globalCompositeOperation = 'source-over';
      return;
    }
    const kind = grp.kind || 'water';
    const fluid = fluidOf(kind);
    const soft2 = fluid ? Math.min(soft, cs * 0.12) : soft;
    const m2 = soft2 > 0.5 ? blurred('tmaskS', mk, soft2) : mk;
    let layer;
    if (fluid) layer = fluidLayer(m2, kind, cs, gi * 31 + 7);
    else if (kind === 'difficult') {
      layer = canvasOf('tdiff', tc.width, tc.height);
      const lg = layer.getContext('2d');
      lg.drawImage(m2, 0, 0);
      lg.globalCompositeOperation = 'source-in';
      lg.fillStyle = 'rgba(40,30,15,.35)';
      lg.fillRect(0, 0, layer.width, layer.height);
      lg.globalCompositeOperation = 'source-atop';
      lg.strokeStyle = 'rgba(30,20,10,.55)';
      lg.lineWidth = Math.max(1, cs * 0.04);
      lg.beginPath();
      for (let i = -layer.height; i < layer.width; i += cs / 3) { lg.moveTo(i, layer.height); lg.lineTo(i + layer.height, 0); }
      lg.stroke();
    } else {
      const texId = String(kind).startsWith('tex:') ? kind.slice(4) : MAT_TEX[kind] || 'leafy_grass';
      layer = canvasOf('tlayer', tc.width, tc.height);
      const lg = layer.getContext('2d');
      lg.drawImage(m2, 0, 0);
      lg.globalCompositeOperation = 'source-in';
      lg.save();
      T(lg, cs);
      lg.fillStyle = pat(lg, texId, 1);
      lg.fillRect(OX, OY, rw, rh);
      lg.restore();
    }
    g.save();
    g.globalAlpha = fluid?.alpha ?? 1;
    g.drawImage(layer, 0, 0);
    g.restore();
    if (fluid?.glow) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.35;
      g.drawImage(blurred('tglow', m2, cs * 0.6), 0, 0);
      g.restore();
    }
  });
}
// Realistische Grundkarte: Untergrund, Böden (je Raum eigene Textur), Gelände, Raster, Wände, Dächer
export function renderReal(target, m, cs, { bg = null, bake = null, rect = null, grid = true, maskCv = null } = {}) {
  const W = m.w;
  const H = m.h;
  OX = rect ? rect.x : 0;
  OY = rect ? rect.y : 0;
  const rw = rect ? rect.w : W;
  const rh = rect ? rect.h : H;
  const pw = Math.max(1, Math.ceil(rw * cs));
  const ph = Math.max(1, Math.ceil(rh * cs));
  if (target.width !== pw || target.height !== ph) { target.width = pw; target.height = ph; }
  const ctx = target.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, pw, ph);
  if (bake) { ctx.drawImage(bake, -OX * cs, -OY * cs, W * cs, H * cs); return; }
  const outdoor = !!m.outdoor;
  // Untergrund
  ctx.save();
  T(ctx, cs);
  ctx.fillStyle = pat(ctx, m.ground || (outdoor ? 'leafy_grass' : 'dark_rock'), 1, outdoor ? '#5f6b3c' : '#2a2622');
  ctx.fillRect(OX, OY, rw, rh);
  ctx.restore();
  variation(ctx, pw, ph, 0.28);
  if (!outdoor) { ctx.fillStyle = `rgba(6,5,4,${m.voidDark ?? 0.62})`; ctx.fillRect(0, 0, pw, ph); }
  if (bg) { ctx.globalAlpha = m.bgAlpha ?? 0.5; ctx.drawImage(bg, -OX * cs, -OY * cs, W * cs, H * cs); ctx.globalAlpha = 1; }
  // Gelände direkt auf dem Untergrund (Außenkarten)
  const tc = canvasOf('terrain', pw, ph);
  if ((m.terrain || []).length) terrainLayer(tc, m, cs);
  if (outdoor && (m.terrain || []).length) ctx.drawImage(tc, 0, 0);
  // Masken: alle Böden bzw. nur ummauerte Formen
  const fmask = canvasOf('fmask', pw, ph);
  const fm = fmask.getContext('2d');
  T(fm, cs);
  const wmask = canvasOf('wmask', pw, ph);
  const wm = wmask.getContext('2d');
  T(wm, cs);
  for (const s of m.shapes || []) {
    fm.globalCompositeOperation = s.op === 'sub' ? 'destination-out' : 'source-over';
    paint(fm, s, '#fff');
    wm.globalCompositeOperation = s.op === 'sub' ? 'destination-out' : 'source-over';
    if (s.op === 'sub' || !s.nowall) paint(wm, s, '#fff');
  }
  // Böden
  const floor = canvasOf('rfloor', pw, ph);
  const fx = floor.getContext('2d');
  T(fx, cs);
  const pats = {};
  for (const s of m.shapes || []) {
    if (s.op === 'sub') { fx.globalCompositeOperation = 'destination-out'; paint(fx, s, '#000'); continue; }
    fx.globalCompositeOperation = 'source-over';
    const id = s.tex || m.floorTex || (outdoor ? 'cobblestone_floor_01' : 'stone_tiles');
    paint(fx, s, (pats[id] ||= pat(fx, id, 1)));
  }
  fx.setTransform(1, 0, 0, 1, 0, 0);
  fx.globalCompositeOperation = 'source-over';
  if ((m.shapes || []).length) variation(fx, pw, ph, 0.22);
  if (!outdoor && (m.terrain || []).length) { fx.globalCompositeOperation = 'source-atop'; fx.drawImage(tc, 0, 0); fx.globalCompositeOperation = 'source-over'; }
  // Wände
  const wallW = cs * (m.wallW || (outdoor ? 0.32 : 0.42));
  const band = dilate('band', wmask, wallW);
  const bg2 = band.getContext('2d');
  bg2.globalCompositeOperation = 'destination-out';
  bg2.drawImage(fmask, 0, 0);
  bg2.globalCompositeOperation = 'source-over';
  // Schatten der Wände auf den Boden
  if (FILTER) {
    fx.save();
    fx.globalCompositeOperation = 'source-atop';
    fx.globalAlpha = 0.55;
    fx.filter = `blur(${Math.max(2, cs * 0.28)}px)`;
    fx.drawImage(band, cs * 0.06, cs * 0.1);
    fx.restore();
  }
  ctx.drawImage(floor, 0, 0);
  // Bodenmaske für das Raster auf dem Bildschirm
  if (maskCv && !rect) {
    const mcs = 8;
    const mw = Math.max(1, Math.round(W * mcs));
    const mh = Math.max(1, Math.round(H * mcs));
    if (maskCv.width !== mw || maskCv.height !== mh) { maskCv.width = mw; maskCv.height = mh; }
    const mg2 = maskCv.getContext('2d');
    mg2.setTransform(1, 0, 0, 1, 0, 0);
    mg2.clearRect(0, 0, mw, mh);
    mg2.globalCompositeOperation = 'source-over';
    if (outdoor) { mg2.fillStyle = '#fff'; mg2.fillRect(0, 0, mw, mh); } else mg2.drawImage(fmask, 0, 0, mw, mh);
    // Unter Dächern kein Raster
    mg2.setTransform(mcs, 0, 0, mcs, 0, 0);
    mg2.globalCompositeOperation = 'destination-out';
    if (m.roofs !== false) for (const s of m.shapes || []) if (s.roof && s.op !== 'sub') paint(mg2, s, '#000');
    mg2.setTransform(1, 0, 0, 1, 0, 0);
    mg2.globalCompositeOperation = 'source-over';
  }
  // Raster
  if (grid && m.gridOn !== false) {
    const gc = canvasOf('rgrid', pw, ph);
    const gg = gc.getContext('2d');
    T(gg, cs);
    const lw = Math.max(0.7, cs / 34) / cs;
    const x0 = Math.max(0, Math.floor(OX));
    const x1 = Math.min(W, Math.ceil(OX + rw));
    const y0 = Math.max(0, Math.floor(OY));
    const y1 = Math.min(H, Math.ceil(OY + rh));
    // heller Versatz + dunkle Linie: bleibt auf hellen wie dunklen Böden sichtbar
    for (const [off, col] of [[lw, 'rgba(255,255,255,.14)'], [0, outdoor ? 'rgba(0,0,0,.3)' : 'rgba(0,0,0,.42)']]) {
      gg.strokeStyle = col;
      gg.lineWidth = lw;
      gg.beginPath();
      for (let x = x0; x <= x1; x++) { gg.moveTo(x + off, y0); gg.lineTo(x + off, y1); }
      for (let y = y0; y <= y1; y++) { gg.moveTo(x0, y + off); gg.lineTo(x1, y + off); }
      gg.stroke();
    }
    gg.setTransform(1, 0, 0, 1, 0, 0);
    if (!outdoor) { gg.globalCompositeOperation = 'destination-in'; gg.drawImage(fmask, 0, 0); }
    ctx.drawImage(gc, 0, 0);
  }
  // Schlagschatten nach außen (Außenkarten)
  if (outdoor && FILTER) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.filter = `blur(${Math.max(2, cs * 0.2)}px)`;
    ctx.drawImage(band, cs * 0.1, cs * 0.14);
    ctx.restore();
  }
  const wc = canvasOf('rwall', pw, ph);
  const wx = wc.getContext('2d');
  wx.drawImage(band, 0, 0);
  wx.globalCompositeOperation = 'source-in';
  wx.fillStyle = pat(wx, m.wallTex || 'castle_brick_01', cs, '#5d574f');
  wx.fillRect(0, 0, pw, ph);
  wx.globalCompositeOperation = 'source-over';
  edgeTint(wc, band, Math.max(1, cs * 0.08), '#000', 0.55, 'we');
  // Oberkante: Licht von oben links
  const hl = canvasOf('rwallhl', pw, ph);
  const hx = hl.getContext('2d');
  hx.drawImage(band, 0, 0);
  hx.globalCompositeOperation = 'destination-out';
  hx.drawImage(band, cs * 0.04, cs * 0.05);
  hx.globalCompositeOperation = 'source-in';
  hx.fillStyle = 'rgba(255,245,225,.35)';
  hx.fillRect(0, 0, pw, ph);
  wx.drawImage(hl, 0, 0);
  ctx.drawImage(wc, 0, 0);
  // Umriss
  const ol = canvasOf('rwallol', pw, ph);
  const ox = ol.getContext('2d');
  ox.drawImage(dilate('bandOl', band, Math.max(1, cs * 0.03)), 0, 0);
  ox.globalCompositeOperation = 'destination-out';
  ox.drawImage(band, 0, 0);
  ox.globalCompositeOperation = 'source-in';
  ox.fillStyle = 'rgba(0,0,0,.8)';
  ox.fillRect(0, 0, pw, ph);
  ctx.drawImage(ol, 0, 0);
  // Dächer (Außenkarten: Häuser von oben)
  if (m.roofs !== false) for (const s of m.shapes || []) if (s.roof && s.op !== 'sub') drawRoof(ctx, s, cs);
  freeScratch();
}
function drawRoof(ctx, s, cs) {
  const p = s.pts || [];
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  const horiz = x1 - x0 >= y1 - y0;
  ctx.save();
  T(ctx, cs);
  const ov = 0.25;
  tracePath(ctx, s);
  ctx.save();
  ctx.lineWidth = ov * 2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.stroke();
  ctx.restore();
  ctx.clip();
  const pt = pat(ctx, s.roof, 1, '#7a5a44');
  if (pt instanceof CanvasPattern && !horiz) { try { pt.setTransform(new DOMMatrix().rotate(90).scale(((TEX_BY_ID.get(s.roof)?.m || 2) / 1.5) / 1024)); } catch { /* egal */ } }
  ctx.fillStyle = pt;
  ctx.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
  const gr = horiz ? ctx.createLinearGradient(0, y0, 0, y1) : ctx.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, 'rgba(255,240,210,.22)');
  gr.addColorStop(0.49, 'rgba(255,240,210,.05)');
  gr.addColorStop(0.51, 'rgba(0,0,0,.25)');
  gr.addColorStop(1, 'rgba(0,0,0,.42)');
  ctx.fillStyle = gr;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  if (horiz) { ctx.moveTo(x0, (y0 + y1) / 2); ctx.lineTo(x1, (y0 + y1) / 2); } else { ctx.moveTo((x0 + x1) / 2, y0); ctx.lineTo((x0 + x1) / 2, y1); }
  ctx.stroke();
  ctx.restore();
}

// ───────────────────────── Objekte, Licht, Beschriftung ─────────────────────────
const LAYERS = { floor: 0, obj: 1, top: 2 };
// Objekte in Feld-Koordinaten zeichnen (ctx ist bereits auf Felder transformiert).
// view = { x0, y0, x1, y1 } blendet alles außerhalb aus (beim Hineinzoomen).
export function drawObjects(ctx, m, { legacyDefs, skip = null, view = null } = {}) {
  const items = [];
  const skipped = (id) => !!skip && (skip.has ? skip.has(id) : skip === id);
  for (const o of m.objects || []) {
    if (o.hidden || skipped(o.id)) continue;
    const a = objAsset(o, legacyDefs);
    if (!a) continue;
    if (view) {
      const r = Math.max(a.w, a.h) * 0.75 + 0.5;
      if (o.x + r < view.x0 || o.x - r > view.x1 || o.y + r < view.y0 || o.y - r > view.y1) continue;
    }
    items.push({ o, a, z: LAYERS[o.layer || a.info?.layer || 'obj'] ?? 1 });
  }
  items.sort((p, q) => p.z - q.z || p.o.y - q.o.y);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (let z = 0; z <= 2; z++) {
    const lay = items.filter((it) => it.z === z);
    if (!lay.length) continue;
    if (z > 0) for (const it of lay) if (it.o.sh !== false) drawAsset(ctx, it.o, it.a, { shadow: true });
    for (const it of lay) drawAsset(ctx, it.o, it.a);
  }
  return items.length;
}
// Objekt-Ebene als eigenes Rasterbild (Zwischenspeicher für das flüssige Verschieben)
export function renderObjects(target, m, cs, { legacyDefs, skip = null } = {}) {
  const pw = Math.max(1, Math.ceil(m.w * cs));
  const ph = Math.max(1, Math.ceil(m.h * cs));
  if (target.width !== pw || target.height !== ph) { target.width = pw; target.height = ph; }
  const ctx = target.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  ctx.setTransform(cs, 0, 0, cs, 0, 0);
  drawObjects(ctx, m, { legacyDefs, skip });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
// Lichter: Fackeln, Feuer und Zauberkreise leuchten von selbst, dazu gesetzte Lichtquellen
// rgba-Farbe mit anderer Deckkraft (ohne reguläre Ausdrücke, damit Farbwerte unangetastet bleiben)
function fade(c, a) {
  const i = String(c).lastIndexOf(',');
  return i > 0 && String(c).startsWith('rgba') ? `${String(c).slice(0, i)},${a})` : c;
}
export function collectGlows(m, legacyDefs) {
  const out = [];
  for (const o of m.objects || []) {
    if (o.glow === false || o.hidden) continue;
    const a = objAsset(o, legacyDefs);
    const g = a?.info?.glow;
    if (g) out.push({ x: o.x, y: o.y, r: g.r * Math.sqrt(o.s || 1), color: g.color, i: 1 });
  }
  for (const l of m.lights || []) out.push({ x: l.x, y: l.y, r: l.r || 4, color: l.color || 'rgba(255,190,110,.45)', i: l.i ?? 1 });
  return out;
}
// Dunkelheit (mit Löchern) und Lichtschein getrennt – beides grob aufgelöst, das reicht für weiche Verläufe
export function renderLighting(dark, glow, m, cs, { legacyDefs } = {}) {
  const pw = Math.max(1, Math.ceil(m.w * cs));
  const ph = Math.max(1, Math.ceil(m.h * cs));
  for (const cv of [dark, glow]) if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  const glows = collectGlows(m, legacyDefs);
  const dk = clamp(Number(m.dark) || 0, 0, 0.95);
  const dg = dark.getContext('2d');
  dg.setTransform(1, 0, 0, 1, 0, 0);
  dg.globalCompositeOperation = 'source-over';
  dg.clearRect(0, 0, pw, ph);
  if (dk > 0) {
    dg.fillStyle = `rgba(4,6,14,${dk})`;
    dg.fillRect(0, 0, pw, ph);
    dg.globalCompositeOperation = 'destination-out';
    dg.setTransform(cs, 0, 0, cs, 0, 0);
    for (const l of glows) {
      const gr = dg.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      gr.addColorStop(0, `rgba(0,0,0,${0.96 * (l.i ?? 1)})`);
      gr.addColorStop(0.5, `rgba(0,0,0,${0.62 * (l.i ?? 1)})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      dg.fillStyle = gr;
      dg.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    dg.setTransform(1, 0, 0, 1, 0, 0);
    dg.globalCompositeOperation = 'source-over';
  }
  const gg = glow.getContext('2d');
  gg.setTransform(1, 0, 0, 1, 0, 0);
  gg.globalCompositeOperation = 'source-over';
  gg.clearRect(0, 0, pw, ph);
  gg.setTransform(cs, 0, 0, cs, 0, 0);
  gg.globalCompositeOperation = 'lighter';
  for (const l of glows) {
    const gr = gg.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    gr.addColorStop(0, l.color);
    gr.addColorStop(0.35, fade(l.color, 0.22));
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    gg.fillStyle = gr;
    gg.globalAlpha = 0.32 * (l.i ?? 1);
    gg.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  gg.setTransform(1, 0, 0, 1, 0, 0);
  gg.globalCompositeOperation = 'source-over';
  return { dark: dk > 0, glow: glows.length > 0 };
}
// Zwischen-Leinwände nach dem Rendern freigeben (die großen Karten kosten sonst viel Speicher)
export function freeScratch() {
  for (const cv of pool.values()) { cv.width = 1; cv.height = 1; }
}
export const REAL_INK = { bg: '#0b0c0e', ink: '#f3ead6', halo: 'rgba(12,10,8,.9)', wall: '#141414', floor: '#8a7f70', grid: 'rgba(0,0,0,.28)' };
export { hash, clamp };
