// Kartenwerkstatt: Räume, Gänge, Höhlen und Außenkarten aufziehen – Wände, Böden und Raster entstehen automatisch.
// Der Stil „Realistisch“ malt mit echten Texturen und von oben gerenderten 3D-Objekten (Poly Haven, CC0, siehe
// js/views/maprender.js); eigene Pakete (z. B. Forgotten Adventures) lassen sich lokal importieren. Dazu Türen,
// Treppen, Licht, Gelände, Beschriftung, Generatoren, PNG-Export und ein Spielmodus mit Tokens, Nebel und Maßband.
import { html, useState, useEffect, useRef, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, vault, col, myUid, noteById } from '../core/app.js';
import { db } from '../core/db.js';
import { openNote } from '../core/workspace.js';
import { settings } from '../core/settings.js';
import { fileUrl, saveFile, deleteFile } from '../core/files.js';
import { loadParty } from '../core/party.js';
import { loadCombat, mutateCombat } from '../core/combat.js';
import { sizeCells } from '../core/tactics.js';
import { monsterIconName, creatureType } from '../ui/art.js';
import {
  useBattle, drawBattle, BattleHud, MonsterPlacer, onDown as battleDown, onTokenDrop, selectToken, arm, ping, animating, startCombat, clearTemplates, placeMonster,
} from './battle.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, IconBtn, Btn, Field, Select, Segmented, Toggle, NotePicker, openModal, promptDialog, confirmDialog, toast, pickFiles } from '../ui/components.js';
import { useCol } from '../core/hooks.js';
import { now, debounce, uid, colorFromString, download, randInt, clamp } from '../lib/util.js';
import { uploadImage } from './codex.js';
import { STAMPS, TEXTURES } from '../data/mapassets.js';
import {
  PROC, FLUIDS, assetInfo, assetThumb, texUrl, preloadMap, onAssets, assetsVersion,
  renderReal, renderObjects, drawObjects, renderLighting, drawStampPreview, texName, REAL_INK,
} from './maprender.js';
import { STYLES, isReal, MATS, SETS, SCRAWL_GENERATORS, r2, rnd, pick, stampAt } from './mapgen.js';
import { userAssets, userAssetInfo, userThumb, importAssetFiles, deleteUserAssets, updateUserAsset, ensureUserImages } from '../core/userassets.js';

const PX = 40; // Bildschirm-Pixel pro Feld bei Zoom 1
const MAX_CACHE_PX = 7e6;
const REAL_CACHE_PX = 4.2e6;

export { STYLES, isReal, SETS, SCRAWL_GENERATORS };

// ───────────────────────── Objekte (Vektorzeichnungen in Feld-Einheiten) ─────────────────────────
const WOOD = '#9a6b3f';
const WOOD2 = '#6e4a28';
const STONE = '#aaa59c';
const STONE2 = '#6f6a62';
const METAL = '#767b82';
const LEAF = '#5a9442';
const LEAF2 = '#3a6a2c';

function rect(c, x, y, w, h, fill, stroke, lw = 0.05, r = 0) {
  c.beginPath();
  if (r && c.roundRect) c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
}
function circ(c, x, y, r, fill, stroke, lw = 0.05) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
}
function lines(c, pts, stroke, lw = 0.05) {
  c.beginPath();
  for (let i = 0; i < pts.length; i += 4) { c.moveTo(pts[i], pts[i + 1]); c.lineTo(pts[i + 2], pts[i + 3]); }
  c.lineWidth = lw;
  c.strokeStyle = stroke;
  c.lineCap = 'round';
  c.stroke();
}
function poly(c, pts, fill, stroke, lw = 0.05) {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
}
// Text in Feld-Einheiten (über Zwischenskalierung, damit auch winzige Größen sauber gerendert werden)
function utext(c, str, x, y, size, fill, halo, weight = 700, family = 'system-ui, sans-serif') {
  c.save();
  c.scale(0.01, 0.01);
  c.font = `${weight} ${size * 100}px ${family}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (halo) {
    c.lineWidth = size * 22;
    c.lineJoin = 'round';
    c.strokeStyle = halo;
    c.strokeText(str, x * 100, y * 100);
  }
  c.fillStyle = fill;
  c.fillText(str, x * 100, y * 100);
  c.restore();
}
const jambs = (c, w, st) => lines(c, [-w / 2, -0.3, -w / 2, 0.3, w / 2, -0.3, w / 2, 0.3], st.wall, 0.12);

export const OBJ = {
  door: { label: 'Tür', group: 'tueren', w: 1, h: 0.4, draw: (c, st) => { rect(c, -0.5, -0.22, 1, 0.44, st.floor); rect(c, -0.38, -0.12, 0.76, 0.24, st.floor, st.wall, 0.06); jambs(c, 1, st); } },
  door2: { label: 'Doppeltür', group: 'tueren', w: 2, h: 0.4, draw: (c, st) => { rect(c, -1, -0.22, 2, 0.44, st.floor); rect(c, -0.88, -0.12, 1.76, 0.24, st.floor, st.wall, 0.06); lines(c, [0, -0.12, 0, 0.12], st.wall, 0.06); jambs(c, 2, st); } },
  secret: { label: 'Geheimtür', group: 'tueren', w: 1, h: 0.4, draw: (c, st) => utext(c, 'S', 0, 0.02, 0.62, st.ink, st.halo, 800, 'Georgia, serif') },
  portcullis: { label: 'Fallgitter', group: 'tueren', w: 1, h: 0.4, draw: (c, st) => { rect(c, -0.5, -0.22, 1, 0.44, st.floor); lines(c, [-0.42, 0, 0.42, 0], st.wall, 0.04); for (let i = -3; i <= 3; i++) circ(c, i * 0.12, 0, 0.045, st.wall); jambs(c, 1, st); } },
  arch: { label: 'Durchgang', group: 'tueren', w: 1, h: 0.4, draw: (c, st) => { rect(c, -0.5, -0.22, 1, 0.44, st.floor); jambs(c, 1, st); } },
  stairs: { label: 'Treppe', group: 'aufbau', w: 1, h: 2, draw: (c, st) => { rect(c, -0.5, -1, 1, 2, st.floor, st.ink, 0.05); for (let i = 0; i < 8; i++) { const y = -1 + (i + 0.5) * 0.25; const ww = 0.92 - i * 0.07; lines(c, [-ww / 2, y, ww / 2, y], st.ink, 0.04); } } },
  pillar: { label: 'Säule', group: 'aufbau', w: 1, h: 1, draw: (c, st) => { circ(c, 0, 0, 0.36, STONE, st.ink, 0.06); circ(c, -0.1, -0.1, 0.1, 'rgba(255,255,255,.4)'); } },
  statue: { label: 'Statue', group: 'aufbau', w: 1, h: 1, draw: (c, st) => { rect(c, -0.42, -0.42, 0.84, 0.84, STONE2, st.ink, 0.05); const s = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const r = i % 2 ? 0.14 : 0.32; s.push(Math.cos(a) * r, Math.sin(a) * r); } poly(c, s, STONE, st.ink, 0.04); } },
  altar: { label: 'Altar', group: 'aufbau', w: 2, h: 1, draw: (c, st) => { rect(c, -0.9, -0.4, 1.8, 0.8, STONE, st.ink, 0.06, 0.06); rect(c, -0.7, -0.22, 1.4, 0.44, null, st.ink, 0.03); circ(c, 0, 0, 0.1, '#c0392b'); } },
  fountain: { label: 'Brunnen (Zier)', group: 'aufbau', w: 2, h: 2, draw: (c, st) => { circ(c, 0, 0, 0.9, STONE, st.ink, 0.06); circ(c, 0, 0, 0.72, '#77b1dc', st.ink, 0.03); circ(c, 0, 0, 0.18, STONE, st.ink, 0.04); } },
  well: { label: 'Brunnen', group: 'aufbau', w: 1, h: 1, draw: (c, st) => { circ(c, 0, 0, 0.42, STONE, st.ink, 0.06); circ(c, 0, 0, 0.26, '#1c2a33'); } },
  trapdoor: { label: 'Falltür', group: 'aufbau', w: 1, h: 1, draw: (c, st) => { rect(c, -0.4, -0.4, 0.8, 0.8, WOOD, st.ink, 0.05); lines(c, [-0.4, -0.13, 0.4, -0.13, -0.4, 0.13, 0.4, 0.13], WOOD2, 0.03); circ(c, 0.25, 0, 0.05, METAL); } },
  trap: { label: 'Falle', group: 'aufbau', w: 1, h: 1, draw: (c, st) => { rect(c, -0.4, -0.4, 0.8, 0.8, null, '#c0392b', 0.05); lines(c, [-0.3, -0.3, 0.3, 0.3, 0.3, -0.3, -0.3, 0.3], '#c0392b', 0.05); utext(c, 'F', 0, 0, 0.3, '#c0392b', st.halo); } },
  throne: { label: 'Thron', group: 'aufbau', w: 1, h: 1, draw: (c, st) => { rect(c, -0.4, -0.45, 0.8, 0.3, '#8e2d2d', st.ink, 0.04); rect(c, -0.32, -0.15, 0.64, 0.55, '#b83c3c', st.ink, 0.04, 0.05); circ(c, -0.3, -0.45, 0.07, '#e0b24a'); circ(c, 0.3, -0.45, 0.07, '#e0b24a'); } },
  lever: { label: 'Hebel', group: 'aufbau', w: 1, h: 1, draw: (c, st) => { rect(c, -0.15, 0.05, 0.3, 0.2, METAL, st.ink, 0.03); lines(c, [0, 0.1, 0.22, -0.3], st.ink, 0.06); circ(c, 0.22, -0.3, 0.07, '#c0392b'); } },
  table: { label: 'Tisch', group: 'moebel', w: 2, h: 1, draw: (c, st) => { rect(c, -0.9, -0.4, 1.8, 0.8, WOOD, st.ink, 0.05, 0.05); lines(c, [-0.9, -0.13, 0.9, -0.13, -0.9, 0.13, 0.9, 0.13], WOOD2, 0.02); } },
  roundtable: { label: 'Runder Tisch', group: 'moebel', w: 1, h: 1, draw: (c, st) => { circ(c, 0, 0, 0.4, WOOD, st.ink, 0.05); circ(c, 0, 0, 0.28, null, WOOD2, 0.02); } },
  chair: { label: 'Stuhl', group: 'moebel', w: 1, h: 1, draw: (c, st) => { rect(c, -0.22, -0.18, 0.44, 0.4, WOOD, st.ink, 0.04, 0.04); rect(c, -0.24, -0.3, 0.48, 0.1, WOOD2, st.ink, 0.03); } },
  bench: { label: 'Bank', group: 'moebel', w: 2, h: 1, draw: (c, st) => rect(c, -0.9, -0.16, 1.8, 0.32, WOOD, st.ink, 0.04, 0.04) },
  bed: { label: 'Bett', group: 'moebel', w: 1, h: 2, draw: (c, st) => { rect(c, -0.42, -0.9, 0.84, 1.8, '#c9b18a', st.ink, 0.05, 0.06); rect(c, -0.32, -0.8, 0.64, 0.3, '#f2eee6', st.ink, 0.03, 0.06); rect(c, -0.42, -0.35, 0.84, 1.25, '#7d5a9e', st.ink, 0.04, 0.04); } },
  chest: { label: 'Truhe', group: 'moebel', w: 1, h: 1, draw: (c, st) => { rect(c, -0.36, -0.24, 0.72, 0.48, WOOD, st.ink, 0.05, 0.04); lines(c, [-0.36, -0.06, 0.36, -0.06], WOOD2, 0.04); rect(c, -0.06, -0.1, 0.12, 0.14, '#e0b24a', st.ink, 0.02); } },
  barrel: { label: 'Fass', group: 'moebel', w: 1, h: 1, draw: (c, st) => { circ(c, 0, 0, 0.36, WOOD, st.ink, 0.05); circ(c, 0, 0, 0.26, null, METAL, 0.04); circ(c, 0, 0, 0.1, null, WOOD2, 0.03); } },
  crate: { label: 'Kiste', group: 'moebel', w: 1, h: 1, draw: (c, st) => { rect(c, -0.38, -0.38, 0.76, 0.76, '#b58b57', st.ink, 0.05); lines(c, [-0.38, -0.38, 0.38, 0.38, 0.38, -0.38, -0.38, 0.38], WOOD2, 0.04); } },
  bookshelf: { label: 'Bücherregal', group: 'moebel', w: 2, h: 1, draw: (c, st) => { rect(c, -0.95, -0.3, 1.9, 0.6, WOOD2, st.ink, 0.05); const cols = ['#8e2d2d', '#2d5e8e', '#3d7a3a', '#c9a13b', '#6a3d8e']; for (let i = 0; i < 9; i++) rect(c, -0.85 + i * 0.19, -0.22, 0.14, 0.44, cols[i % cols.length]); } },
  coffin: { label: 'Sarg', group: 'moebel', w: 1, h: 2, draw: (c, st) => poly(c, [0, -0.9, 0.34, -0.55, 0.26, 0.9, -0.26, 0.9, -0.34, -0.55], '#5b3d24', st.ink, 0.05) },
  rug: { label: 'Teppich', group: 'moebel', w: 2, h: 2, draw: (c, st) => { rect(c, -0.9, -0.9, 1.8, 1.8, '#9c3b3b', '#5e1f1f', 0.06); rect(c, -0.7, -0.7, 1.4, 1.4, null, '#e0b24a', 0.04); circ(c, 0, 0, 0.3, null, '#e0b24a', 0.04); } },
  cauldron: { label: 'Kessel', group: 'moebel', w: 1, h: 1, draw: (c, st) => { circ(c, 0, 0, 0.38, '#2b2b2b', st.ink, 0.05); circ(c, 0, 0, 0.27, '#5aa84a'); circ(c, 0.08, -0.06, 0.06, '#9be38a'); } },
  brazier: { label: 'Kohlebecken', group: 'moebel', w: 1, h: 1, draw: (c, st) => { circ(c, 0, 0, 0.34, METAL, st.ink, 0.05); circ(c, 0, 0, 0.22, '#f39c12'); circ(c, 0, 0, 0.1, '#ffe08a'); } },
  campfire: { label: 'Lagerfeuer', group: 'natur', w: 1, h: 1, draw: (c, st) => { for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; circ(c, Math.cos(a) * 0.34, Math.sin(a) * 0.34, 0.08, STONE, st.ink, 0.02); } poly(c, [0, -0.25, 0.16, 0.12, -0.16, 0.12], '#f39c12'); poly(c, [0, -0.1, 0.08, 0.1, -0.08, 0.1], '#ffe08a'); } },
  tree: { label: 'Baum', group: 'natur', w: 2, h: 2, draw: (c, st) => { for (const [x, y, r] of [[-0.35, -0.2, 0.55], [0.35, -0.25, 0.5], [0, 0.3, 0.55], [0.1, -0.05, 0.5]]) circ(c, x, y, r, LEAF, LEAF2, 0.05); circ(c, 0.05, 0, 0.12, WOOD2); } },
  bush: { label: 'Busch', group: 'natur', w: 1, h: 1, draw: (c) => { for (const [x, y, r] of [[-0.15, -0.08, 0.26], [0.15, -0.1, 0.24], [0, 0.14, 0.26]]) circ(c, x, y, r, '#6aa64f', LEAF2, 0.04); } },
  rock: { label: 'Fels', group: 'natur', w: 1, h: 1, draw: (c, st) => { poly(c, [-0.38, 0.1, -0.22, -0.3, 0.14, -0.38, 0.38, -0.08, 0.3, 0.3, -0.12, 0.38], STONE, st.ink, 0.05); lines(c, [-0.1, -0.1, 0.12, 0.08], STONE2, 0.03); } },
  rubble: { label: 'Schutt', group: 'natur', w: 1, h: 1, draw: (c, st) => { for (const [x, y, r] of [[-0.25, -0.15, 0.13], [0.1, -0.25, 0.1], [0.25, 0.1, 0.14], [-0.1, 0.22, 0.1], [0.02, 0.02, 0.08]]) circ(c, x, y, r, STONE, st.ink, 0.03); } },
  bones: { label: 'Knochen', group: 'natur', w: 1, h: 1, draw: (c, st) => { lines(c, [-0.3, -0.2, 0.25, 0.22, 0.25, -0.25, -0.2, 0.25], '#ece5d3', 0.08); circ(c, 0.05, -0.05, 0.13, '#ece5d3', st.ink, 0.03); } },
  web: { label: 'Spinnennetz', group: 'natur', w: 2, h: 2, draw: (c) => { const col = 'rgba(200,200,200,.8)'; for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; lines(c, [0, 0, Math.cos(a) * 0.95, Math.sin(a) * 0.95], col, 0.025); } for (const r of [0.3, 0.55, 0.8]) circ(c, 0, 0, r, null, col, 0.025); } },
  marker: { label: 'Markierung', group: 'natur', w: 1, h: 1, draw: (c) => lines(c, [-0.3, -0.3, 0.3, 0.3, 0.3, -0.3, -0.3, 0.3], '#c0392b', 0.1) },
};
const OBJ_GROUPS = [['aufbau', 'Aufbau'], ['moebel', 'Einrichtung'], ['natur', 'Natur & Sonstiges']];
const DOORS = ['door', 'door2', 'secret', 'portcullis', 'arch'];

function drawObject(c, o, st) {
  if (o.t === 'stamp') { drawStampPreview(c, o, OBJ, 1); return; }
  const def = OBJ[o.t];
  if (!def) return;
  c.save();
  c.translate(o.x, o.y);
  if (o.r) c.rotate((o.r * Math.PI) / 180);
  if (o.s && o.s !== 1) c.scale(o.s, o.s);
  def.draw(c, st);
  c.restore();
}

function drawLabel(c, l, st) {
  const size = l.size || 0.7;
  if (l.kind === 'room') {
    circ(c, l.x, l.y, size * 0.62, st.halo, st.ink, 0.05);
    utext(c, String(l.text), l.x, l.y + 0.02, size * 0.7, st.ink, null, 800);
  } else utext(c, String(l.text), l.x, l.y, size, st.ink, st.halo, 700, 'Georgia, "Palatino Linotype", serif');
  if (l.noteId) circ(c, l.x + size * 0.55, l.y - size * 0.5, 0.09, '#4d8dff');
}
// ───────────────────────── Geometrie & Rendering ─────────────────────────
function tracePath(c, s) {
  const p = s.pts || [];
  c.beginPath();
  if (s.kind === 'rect' || s.kind === 'ellipse') {
    const [x1, y1, x2, y2] = p;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    if (s.kind === 'rect') c.rect(x, y, w, h);
    else c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    return;
  }
  if (p.length < 2) return;
  c.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
  if (s.kind === 'poly') c.closePath();
  if ((s.kind === 'brush' || s.kind === 'path') && p.length === 2) c.lineTo(p[0] + 0.001, p[1]);
}

function paintShape(c, s, fill) {
  c.globalCompositeOperation = s.op === 'sub' ? 'destination-out' : 'source-over';
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
  c.globalCompositeOperation = 'source-over';
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

function tile(size, fn) {
  const t = document.createElement('canvas');
  t.width = t.height = size;
  fn(t.getContext('2d'), size);
  return t;
}

function hatchPattern(ctx, st, cs) {
  const s = Math.max(8, Math.round(cs));
  const t = tile(s, (g) => {
    g.strokeStyle = st.hatch;
    g.lineWidth = Math.max(1, s / 20);
    if (st.hatchKind === 'grid') {
      g.globalAlpha = 0.85;
      g.strokeRect(0.5, 0.5, s, s);
      return;
    }
    const step = s / 4;
    g.globalAlpha = st.hatchKind === 'cross' ? 0.5 : 0.6;
    g.beginPath();
    for (let i = -s; i <= s * 2; i += step) { g.moveTo(i, 0); g.lineTo(i + s, s); }
    g.stroke();
    if (st.hatchKind === 'cross') {
      g.globalAlpha = 0.35;
      g.beginPath();
      for (let i = -s; i <= s * 2; i += step) { g.moveTo(i, s); g.lineTo(i + s, 0); }
      g.stroke();
    }
  });
  return ctx.createPattern(t, 'repeat');
}

function matPattern(ctx, key, cs) {
  const m = MATS[key] || MATS.water;
  const s = Math.max(8, Math.round(cs));
  const t = tile(s, (g) => {
    g.fillStyle = m.color;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = m.deep;
    g.fillStyle = m.deep;
    g.lineWidth = Math.max(1, s / 22);
    if (key === 'water' || key === 'ice') {
      g.globalAlpha = key === 'ice' ? 0.5 : 0.55;
      for (const y of [0.3, 0.75]) {
        g.beginPath();
        g.moveTo(0, y * s);
        g.bezierCurveTo(s * 0.25, y * s - s * 0.1, s * 0.25, y * s + s * 0.1, s * 0.5, y * s);
        g.bezierCurveTo(s * 0.75, y * s - s * 0.1, s * 0.75, y * s + s * 0.1, s, y * s);
        g.stroke();
      }
    } else if (key === 'lava') {
      g.globalAlpha = 0.8;
      g.beginPath(); g.moveTo(0, s * 0.2); g.lineTo(s * 0.4, s * 0.45); g.lineTo(s * 0.3, s); g.moveTo(s * 0.4, s * 0.45); g.lineTo(s, s * 0.6); g.stroke();
      g.fillStyle = '#ffd35c'; g.globalAlpha = 0.6; g.beginPath(); g.arc(s * 0.7, s * 0.25, s * 0.07, 0, Math.PI * 2); g.fill();
    } else if (key === 'grass') {
      g.globalAlpha = 0.7;
      for (const [x, y] of [[0.2, 0.3], [0.65, 0.2], [0.45, 0.7], [0.85, 0.8]]) { g.beginPath(); g.moveTo(x * s - s * 0.06, y * s + s * 0.06); g.lineTo(x * s, y * s - s * 0.08); g.lineTo(x * s + s * 0.06, y * s + s * 0.06); g.stroke(); }
    } else if (key === 'rubble' || key === 'sand') {
      g.globalAlpha = 0.6;
      for (const [x, y, r] of [[0.2, 0.25, 0.05], [0.7, 0.3, 0.04], [0.45, 0.65, 0.06], [0.85, 0.8, 0.03], [0.15, 0.8, 0.035]]) { g.beginPath(); g.arc(x * s, y * s, r * s, 0, Math.PI * 2); g.fill(); }
    } else if (key === 'difficult') {
      g.clearRect(0, 0, s, s);
      g.globalAlpha = 0.55;
      g.beginPath();
      for (let i = -s; i <= s * 2; i += s / 3) { g.moveTo(i, s); g.lineTo(i + s, 0); }
      g.stroke();
    }
  });
  const p = ctx.createPattern(t, 'repeat');
  try { p.setTransform(new DOMMatrix([1 / s, 0, 0, 1 / s, 0, 0])); } catch { /* alte Browser */ }
  return p;
}

function dilate(name, src, r) {
  const d = canvasOf(name, src.width, src.height);
  const g = d.getContext('2d');
  g.drawImage(src, 0, 0);
  for (const f of r > 10 ? [1, 0.66, 0.33] : [1, 0.5]) {
    const rr = r * f;
    const steps = Math.min(24, Math.max(8, Math.ceil((2 * Math.PI * rr) / 3)));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      g.drawImage(src, Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
  return d;
}
// Statische Karte (Hintergrund, Schraffur, Boden, Gelände, Raster, Wände) als Rasterbild in Feld-Auflösung cs
function renderVector(target, m, cs, st, img) {
  const W = m.w;
  const H = m.h;
  const pw = Math.max(1, Math.ceil(W * cs));
  const ph = Math.max(1, Math.ceil(H * cs));
  if (target.width !== pw || target.height !== ph) { target.width = pw; target.height = ph; }
  const mask = canvasOf('mask', pw, ph);
  const mc = mask.getContext('2d');
  mc.setTransform(cs, 0, 0, cs, 0, 0);
  for (const s of m.shapes || []) paintShape(mc, s, '#fff');
  mc.setTransform(1, 0, 0, 1, 0, 0);

  const ctx = target.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = st.bg;
  ctx.fillRect(0, 0, pw, ph);
  if (img) {
    ctx.globalAlpha = m.bgAlpha ?? 0.5;
    ctx.drawImage(img, 0, 0, pw, ph);
    ctx.globalAlpha = 1;
  }
  const wallR = Math.max(1.5, cs * 0.17);
  const wall = dilate('wall', mask, wallR);
  if (st.hatchKind !== 'none' && (m.hatch ?? 1) > 0) {
    const band = dilate('band', mask, cs * (m.hatch ?? 1));
    const hc = canvasOf('hatch', pw, ph);
    const hx = hc.getContext('2d');
    hx.drawImage(band, 0, 0);
    hx.globalCompositeOperation = 'source-in';
    hx.fillStyle = hatchPattern(hx, st, cs);
    hx.fillRect(0, 0, pw, ph);
    ctx.drawImage(hc, 0, 0);
  }
  // Boden
  const fc = canvasOf('floor', pw, ph);
  const fx = fc.getContext('2d');
  fx.drawImage(mask, 0, 0);
  fx.globalCompositeOperation = 'source-in';
  fx.fillStyle = st.floor;
  fx.fillRect(0, 0, pw, ph);
  // Gelände auf eigener Ebene, dann nur innerhalb des Bodens
  if ((m.terrain || []).length) {
    const tc = canvasOf('terrain', pw, ph);
    const tx = tc.getContext('2d');
    tx.setTransform(cs, 0, 0, cs, 0, 0);
    const pats = {};
    for (const s of m.terrain) paintShape(tx, s, s.op === 'sub' ? '#000' : (pats[s.mat] ||= matPattern(tx, s.mat, cs)));
    fx.globalCompositeOperation = 'source-atop';
    fx.drawImage(tc, 0, 0);
  }
  // Raster nur im Boden
  if (m.gridOn !== false) {
    fx.globalCompositeOperation = 'source-atop';
    fx.setTransform(cs, 0, 0, cs, 0, 0);
    fx.strokeStyle = st.grid;
    fx.lineWidth = Math.max(0.6, cs / 34) / cs;
    fx.beginPath();
    for (let x = 0; x <= W; x++) { fx.moveTo(x, 0); fx.lineTo(x, H); }
    for (let y = 0; y <= H; y++) { fx.moveTo(0, y); fx.lineTo(W, y); }
    fx.stroke();
    fx.setTransform(1, 0, 0, 1, 0, 0);
  }
  // Schatten an den Wänden (wo der Browser Filter kann)
  const wc = canvasOf('wallonly', pw, ph);
  const wx = wc.getContext('2d');
  wx.drawImage(wall, 0, 0);
  wx.globalCompositeOperation = 'destination-out';
  wx.drawImage(mask, 0, 0);
  wx.globalCompositeOperation = 'source-in';
  wx.fillStyle = st.wall;
  wx.fillRect(0, 0, pw, ph);
  if ('filter' in fx) {
    fx.globalCompositeOperation = 'source-atop';
    fx.globalAlpha = 0.35;
    fx.filter = `blur(${Math.max(1, cs * 0.12)}px)`;
    fx.drawImage(wc, 0, 0);
    fx.filter = 'none';
    fx.globalAlpha = 1;
  }
  ctx.drawImage(fc, 0, 0);
  ctx.drawImage(wc, 0, 0);
}

// Realistische Karte: Untergrund + Böden + Wände aus maprender.js
function renderStatic(target, m, cs, st, img, bake, opts) {
  if (st.real) renderReal(target, m, cs, { bg: img, bake, ...opts });
  else renderVector(target, m, cs, st, img);
}


export function newScrawlMap({ name, w = 36, h = 26, style = 'real', gen = 'dungeon' }) {
  const g = (SCRAWL_GENERATORS[gen] || SCRAWL_GENERATORS.leer).fn(w, h);
  const doc = { name, type: 'scrawl', w, h, style, gridOn: true, hatch: 1, ...g, fog: { enabled: false, revealed: '0'.repeat(w * h) }, visibility: 'gm', createdAt: now() };
  doc.thumb = thumbOf(doc);
  return doc;
}

// Vorschaubild für die Kartenliste, den PNG-Export und das Spielerbild
export function renderMapImage(m, cs, img, { lighting = true, bake = null } = {}) {
  const st = STYLES[m.style] || STYLES.klassisch;
  const cv = document.createElement('canvas');
  renderStatic(cv, m, cs, st, img, bake);
  if (bake) return cv;
  const c = cv.getContext('2d');
  c.setTransform(cs, 0, 0, cs, 0, 0);
  if (st.real) drawObjects(c, m, { legacyDefs: OBJ });
  else for (const o of m.objects || []) drawObject(c, o, st);
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (st.real && lighting) {
    const dk = document.createElement('canvas');
    const gl = document.createElement('canvas');
    const on = renderLighting(dk, gl, m, Math.max(6, Math.min(24, cs)), { legacyDefs: OBJ });
    if (on.dark) c.drawImage(dk, 0, 0, cv.width, cv.height);
    if (on.glow) { c.globalCompositeOperation = 'lighter'; c.drawImage(gl, 0, 0, cv.width, cv.height); c.globalCompositeOperation = 'source-over'; }
  }
  c.setTransform(cs, 0, 0, cs, 0, 0);
  for (const l of m.labels || []) drawLabel(c, l, st);
  c.setTransform(1, 0, 0, 1, 0, 0);
  return cv;
}

function thumbOf(m) {
  try {
    const cs = clamp(Math.floor(420 / Math.max(m.w, m.h)), 4, 14);
    const cv = renderMapImage(m, cs);
    const url = cv.toDataURL('image/webp', 0.72);
    return url.startsWith('data:image/webp') ? url : cv.toDataURL('image/jpeg', 0.75);
  } catch {
    return '';
  }
}

// ───────────────────────── Werkzeuge ─────────────────────────
const BUILD_TOOLS = [
  ['select', 'pointer', 'Auswählen & verschieben (V)', 'v'],
  ['room', 'layout', 'Raum aufziehen (R)', 'r'],
  ['ellipse', 'target', 'Runder Raum (E)', 'e'],
  ['poly', 'pencil', 'Polygon – Punkte setzen (P)', 'p'],
  ['path', 'footprints', 'Gang – Punkte setzen (C)', 'c'],
  ['brush', 'brush', 'Pinsel für Höhlen (B)', 'b'],
  ['wall', 'minus', 'Wand ziehen (W)', 'w'],
  ['terrain', 'trees', 'Gelände & Wasser malen (T)', 't'],
  ['door', 'door', 'Tür an eine Wand setzen (D)', 'd'],
  ['object', 'gem', 'Objekte platzieren (O)', 'o'],
  ['scatter', 'sparkles', 'Streuen: Bäume, Gras, Steine (S)', 's'],
  ['light', 'sun', 'Licht setzen (L)', 'l'],
  ['text', 'hash', 'Raumnummern & Text (X)', 'x'],
  ['pan', 'hand', 'Ansicht verschieben (H)', 'h'],
];
const PLAY_TOOLS_GM = [['pan', 'hand', 'Bewegen & Tokens ziehen'], ['measure', 'ruler', 'Messen'], ['reveal', 'eye', 'Nebel aufdecken'], ['hide', 'eye-off', 'Nebel verdecken'], ['token', 'user-plus', 'Token setzen']];
const PLAY_TOOLS = [['pan', 'hand', 'Bewegen & eigene Tokens ziehen'], ['measure', 'ruler', 'Messen']];
const HINTS = {
  select: 'Antippen = auswählen · ziehen = verschieben · Entf = löschen · R = drehen · F = spiegeln',
  room: 'Ziehen = Raum aufziehen · Alt/Rechtsklick oder „Entfernen“ = ausschneiden · Umschalt = frei',
  ellipse: 'Ziehen = runder Raum · „Entfernen“ schneidet aus',
  poly: 'Punkte setzen · Doppelklick, Enter oder ersten Punkt antippen = schließen · Esc = abbrechen',
  path: 'Punkte setzen (Feldmitten) · Doppelklick/Enter = fertig · Breite rechts einstellen',
  brush: 'Frei malen für Höhlen und Ruinen · „Entfernen“ radiert',
  wall: 'Punkte auf den Rasterlinien setzen = Zwischenwand · Doppelklick/Enter = fertig · Türen setzt du danach darauf',
  terrain: 'Wasser, Lava, Gras, Wege … über den Boden malen · „Entfernen“ radiert · Strg+Ziehen = Rechteck',
  door: 'Nahe einer Wand antippen – die Tür rastet an der Kante ein',
  object: 'Objekt rechts wählen, dann auf die Karte tippen · Umschalt+Mausrad dreht das Objekt',
  scatter: 'Über die Karte ziehen – Pflanzen, Steine und Trümmer werden zufällig verteilt',
  light: 'Antippen = Lichtquelle setzen · danach rechts Farbe und Radius einstellen',
  text: 'Antippen = nächste Raumnummer bzw. Text setzen',
  pan: 'Ziehen = verschieben · Mausrad/zwei Finger = zoomen · im Spiel: Token antippen = Aktionen, lange drücken = Ping',
  place: 'Antippen = Monster setzen · Esc = fertig',
  measure: 'Ziehen = Entfernung messen',
  reveal: 'Über die Karte wischen = Nebel aufdecken',
  hide: 'Über die Karte wischen = Nebel verdecken',
  token: 'Antippen = Token setzen',
};
function simplify(pts, eps) {
  if (pts.length <= 4) return pts;
  const P = [];
  for (let i = 0; i < pts.length; i += 2) P.push([pts[i], pts[i + 1]]);
  const keep = new Array(P.length).fill(false);
  keep[0] = keep[P.length - 1] = true;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let dmax = 0;
    let idx = -1;
    const [x1, y1] = P[a];
    const [x2, y2] = P[b];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1e-6;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((y2 - y1) * P[i][0] - (x2 - x1) * P[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps && idx > 0) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
  }
  return P.filter((_, i) => keep[i]).flatMap(([x, y]) => [r2(x), r2(y)]);
}

const hitCtx = document.createElement('canvas').getContext('2d');
function shapeHit(s, x, y) {
  tracePath(hitCtx, s);
  if (s.kind === 'path' || s.kind === 'brush') {
    hitCtx.lineWidth = s.w || 1;
    hitCtx.lineCap = 'round';
    hitCtx.lineJoin = 'round';
    return hitCtx.isPointInStroke(x, y);
  }
  return hitCtx.isPointInPath(x, y);
}

// ───────────────────────── Objekte messen & Raster bauen ─────────────────────────
const BLOCK_OBJ = new Set(['pillar', 'statue', 'altar', 'fountain', 'well', 'bookshelf', 'tree', 'rock', 'throne']);
const ROUGH_OBJ = new Set(['rubble', 'web', 'bush', 'bones', 'table', 'roundtable', 'bed', 'barrel', 'crate', 'coffin', 'cauldron', 'brazier', 'bench']);
const ROUGH_MAT = new Set(['difficult', 'rubble', 'water', 'deepwater', 'swamp', 'ice', 'blood', 'lava', 'mud']);
const ROUGH_TEX = new Set(['brown_mud', 'mud_forest', 'muddy_tracks', 'snow_02', 'snow_03', 'rocks_ground_02', 'river_small_rocks', 'gravel_ground_01', 'rubble', 'forest_leaves_02', 'burned_ground_01', 'mud_cracked_dry_03', 'farm_soil']);
const roughMat = (mat) => (String(mat).startsWith('tex:') ? ROUGH_TEX.has(String(mat).slice(4)) : ROUGH_MAT.has(mat));

// Maße und Regelwirkung eines Kartenobjekts (Stempel oder klassisches Symbol)
export function objMeta(o) {
  if (o.t === 'stamp') {
    const i = assetInfo(o.a);
    const s = o.s || 1;
    if (!i) return { w: s, h: s, block: false, rough: false, door: false, layer: 'obj', name: 'Objekt' };
    return { w: i.w * s, h: i.h * s, block: !!i.block, rough: !!i.rough, door: !!i.door, layer: o.layer || i.layer || 'obj', name: i.name, glow: !!i.glow };
  }
  const def = OBJ[o.t];
  if (!def) return null;
  const s = o.s || 1;
  return { w: def.w * s, h: def.h * s, block: BLOCK_OBJ.has(o.t), rough: ROUGH_OBJ.has(o.t), door: DOORS.includes(o.t), layer: 'obj', name: def.label };
}
function objHit(o, x, y) {
  const m = objMeta(o);
  if (!m) return false;
  const a = (-(o.r || 0) * Math.PI) / 180;
  const dx = x - o.x;
  const dy = y - o.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= m.w / 2 + 0.08 && Math.abs(ly) <= m.h / 2 + 0.08;
}
const inObj = (o, m, x, y, pad = 0) => {
  const a = (-(o.r || 0) * Math.PI) / 180;
  const dx = x - o.x;
  const dy = y - o.y;
  return Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= m.w / 2 + pad && Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= m.h / 2 + pad;
};

// Begehbare Felder für die Kampfbewegung: Boden aus den Formen, dünne Zwischenwände als Kanten,
// Gelände (schwierig bzw. Grube), Objekte (Säulen blockieren, Möbel kosten extra).
export function buildGrid(d) {
  const W = d.w || 36;
  const H = d.h || 26;
  const R = 6;
  const half = R / 2;
  const walk = new Uint8Array(W * H).fill(1);
  const cost = new Uint8Array(W * H).fill(1);
  const opaque = new Uint8Array(W * H); // Wand/Fels: blockiert Sicht und Flächen
  const cover = new Uint8Array(W * H); // Säulen, Statuen …: halbe Deckung
  const wallE = new Uint8Array(W * H); // dünne Wand zwischen (x,y) und (x+1,y)
  const wallS = new Uint8Array(W * H); // dünne Wand zwischen (x,y) und (x,y+1)
  if ((d.shapes || []).some((s) => s.op !== 'sub')) {
    const cv = canvasOf('gridmask', W * R, H * R);
    const g = cv.getContext('2d');
    g.setTransform(R, 0, 0, R, 0, 0);
    for (const s of d.shapes) paintShape(g, s, '#fff');
    const data = g.getImageData(0, 0, W * R, H * R).data;
    const at = (px, py) => data[(py * W * R + px) * 4 + 3] > 127;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) walk[y * W + x] = at(x * R + half, y * R + half) ? 1 : 0;
    for (let i = 0; i < walk.length; i++) opaque[i] = walk[i] ? 0 : 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!walk[i]) continue;
        if (x < W - 1 && walk[i + 1]) { for (let k = 1; k < R; k++) if (!at(x * R + half + k, y * R + half)) { wallE[i] = 1; break; } }
        if (y < H - 1 && walk[i + W]) { for (let k = 1; k < R; k++) if (!at(x * R + half, y * R + half + k)) { wallS[i] = 1; break; } }
      }
    }
  }
  const cells = (x0, y0, x1, y1, fn) => {
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) fn(x, y);
  };
  const mat = new Array(W * H).fill(null);
  for (const s of d.terrain || []) {
    const p = s.pts || [];
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    const m = (s.w || 0) / 2 + 1;
    cells(x0 - m, y0 - m, x1 + m, y1 + m, (x, y) => { if (shapeHit(s, x + 0.5, y + 0.5)) mat[y * W + x] = s.op === 'sub' ? null : s.mat; });
  }
  for (let i = 0; i < mat.length; i++) { if (mat[i] === 'pit') walk[i] = 0; else if (roughMat(mat[i])) cost[i] = 2; }
  for (const o of d.objects || []) {
    const m = objMeta(o);
    if (!m) continue;
    if (m.door) {
      // Türen öffnen dünne Wände
      cells(o.x - 1.5, o.y - 1.5, o.x + 1.5, o.y + 1.5, (x, y) => {
        if (x < W - 1 && inObj(o, m, x + 1, y + 0.5, 0.25)) wallE[y * W + x] = 0;
        if (y < H - 1 && inObj(o, m, x + 0.5, y + 1, 0.25)) wallS[y * W + x] = 0;
      });
      continue;
    }
    if (!m.block && !m.rough) continue;
    if (m.block && m.layer === 'top') { // Baumkronen: nur der Stamm blockiert
      const x = Math.floor(o.x);
      const y = Math.floor(o.y);
      if (x >= 0 && y >= 0 && x < W && y < H) { walk[y * W + x] = 0; cover[y * W + x] = 1; }
      continue;
    }
    const ext = Math.max(m.w, m.h) / 2 + 1;
    cells(o.x - ext, o.y - ext, o.x + ext, o.y + ext, (x, y) => {
      if (!objHit(o, x + 0.5, y + 0.5)) return;
      const i = y * W + x;
      if (m.block) { walk[i] = 0; cover[i] = 1; } else cost[i] = Math.max(cost[i], 2);
    });
  }
  return { w: W, h: H, walk, cost, opaque, cover, wallE, wallS };
}

// ───────────────────────── Objektbibliothek (Seitenleiste) ─────────────────────────
const CAT_LABELS = { alle: 'Alle', tueren: 'Türen', bau: 'Bauwerk', dungeon: 'Dungeon', moebel: 'Möbel', behaelter: 'Behälter', licht: 'Licht & Feuer', kueche: 'Küche', deko: 'Deko', werkzeug: 'Werkzeug', natur: 'Pflanzen', fels: 'Felsen', eigene: 'Eigene' };
const CAT_ORDER = ['alle', 'tueren', 'bau', 'dungeon', 'moebel', 'behaelter', 'licht', 'natur', 'fels', 'kueche', 'deko', 'werkzeug', 'eigene'];
const CATALOG = [
  ...Object.entries(PROC).map(([id, p]) => ({ key: `p:${id}`, name: p.name, cat: p.cat, w: p.w, h: p.h, q: `${p.name} ${id}`.toLowerCase() })),
  ...STAMPS.map((s) => ({ key: `ph:${s.id}`, name: s.name, cat: s.cat, w: s.w, h: s.h, q: `${s.name} ${s.id} ${s.tags || ''}`.toLowerCase() })),
];
export const DOOR_KEYS = Object.entries(PROC).filter(([, p]) => p.door).map(([id]) => `p:${id}`);
const thumbCache = new Map();
let thumbVer = -1;
function thumbFor(key) {
  if (thumbVer !== assetsVersion()) { thumbCache.clear(); thumbVer = assetsVersion(); }
  if (key.startsWith('u:')) return userThumb(key.slice(2));
  if (!thumbCache.has(key)) thumbCache.set(key, assetThumb(key));
  return thumbCache.get(key);
}
function useAssetVersion() {
  const [v, setV] = useState(assetsVersion());
  useEffect(() => onAssets(setV), []);
  return v;
}
function AssetGrid({ value, onPick, items }) {
  return html`<div class="asset-grid">${items.map((it) => html`<button key=${it.key} type="button" class=${value === it.key ? 'active' : ''} title=${`${it.name} · ${Math.round(it.w * 10) / 10} × ${Math.round(it.h * 10) / 10} Felder`} onClick=${() => onPick(it.key)}>
    <img src=${thumbFor(it.key)} alt="" loading="lazy" /><span>${it.name}</span>
  </button>`)}</div>`;
}
function AssetPicker({ value, onPick }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('alle');
  const ver = useAssetVersion();
  const items = useMemo(() => {
    const mine = userAssets().map((m) => ({ key: `u:${m.id}`, name: m.name, cat: 'eigene', w: m.w, h: m.h, q: `${m.name} ${m.cat} ${m.pack}`.toLowerCase() }));
    const all = cat === 'eigene' ? mine : cat === 'alle' ? [...CATALOG, ...mine] : CATALOG.filter((x) => x.cat === cat);
    const s = q.trim().toLowerCase();
    return (s ? all.filter((x) => x.q.includes(s)) : all).slice(0, 700);
  }, [q, cat, ver]);
  return html`<div class="stack sm">
    <div class="row nowrap">
      <input class="input" placeholder="Objekt suchen …" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <${IconBtn} icon="upload" title="Eigene Objekte importieren (z. B. Forgotten Adventures)" onClick=${() => openModal(({ close }) => html`<${ImportAssets} close=${close} />`, { title: 'Eigene Objekte', icon: 'upload', size: 'lg' })} />
    </div>
    <div class="chips asset-cats">${CAT_ORDER.map((c) => html`<button key=${c} type="button" class=${`chip${cat === c ? ' selected' : ''}`} onClick=${() => setCat(c)}>${CAT_LABELS[c]}</button>`)}</div>
    <${AssetGrid} value=${value} onPick=${onPick} items=${items} />
    <div class="tiny faint">${items.length} Objekte · Bibliothek: Poly Haven (CC0) · eigene Pakete bleiben auf diesem Gerät</div>
  </div>`;
}
// Eigene Assets importieren (Dateien oder ganzer Ordner)
function ImportAssets({ close }) {
  const ver = useAssetVersion();
  const [ppc, setPpc] = useState(() => Number(localStorage.getItem('ws.assetPpc')) || 256);
  const [pack, setPack] = useState('');
  const [prog, setProg] = useState(null);
  const packs = useMemo(() => {
    const m = new Map();
    for (const a of userAssets()) m.set(a.pack || 'Ohne Paket', (m.get(a.pack || 'Ohne Paket') || 0) + 1);
    return [...m.entries()];
  }, [ver]);
  const run = async (directory) => {
    const files = await pickFiles({ accept: 'image/*', multiple: true, directory });
    if (!files.length) return;
    try { localStorage.setItem('ws.assetPpc', String(ppc)); } catch { /* egal */ }
    setProg({ n: 0, t: files.length });
    const n = await importAssetFiles(files, { ppc, pack: pack.trim(), onProgress: (a, b) => setProg({ n: a, t: b }) });
    setProg(null);
    toast(n ? `${n} Objekte importiert` : 'Keine Bilder gefunden', n ? 'success' : 'error');
  };
  const drop = async (p) => {
    const list = userAssets().filter((a) => (a.pack || 'Ohne Paket') === p);
    if (!(await confirmDialog(`„${p}“ mit ${list.length} Objekten von diesem Gerät entfernen?`, { ok: 'Entfernen', danger: true }))) return;
    await deleteUserAssets(list.map((a) => a.id));
  };
  return html`<div class="modal-body stack">
    <div class="small">Lade Objekte aus Paketen, die du selbst besitzt – etwa von <b>Forgotten Adventures</b> oder <b>Crosshead Studios</b>. Die Bilder bleiben <b>nur auf diesem Gerät</b> (nichts wird hochgeladen). Für Mitspieler backst du die fertige Karte zu einem Bild („Für Spieler backen“).</div>
    <div class="grid two" style="gap:8px">
      <${Field} label="Pixel pro Feld" hint="Dungeondraft-/FA-Pakete: meist 256"><input class="input" type="number" min="16" max="1024" value=${ppc} onInput=${(e) => setPpc(Math.max(16, Math.min(1024, Number(e.target.value) || 256)))} /><//>
      <${Field} label="Paketname (optional)" hint="Sonst der Ordnername"><input class="input" value=${pack} onInput=${(e) => setPack(e.target.value)} placeholder="z. B. FA Dungeon" /><//>
    </div>
    <div class="btn-row"><${Btn} icon="image" onClick=${() => run(false)} disabled=${!!prog}>Dateien wählen<//><${Btn} icon="folder" onClick=${() => run(true)} disabled=${!!prog}>Ordner wählen<//></div>
    ${prog ? html`<div class="small">Importiere … ${prog.n} / ${prog.t}<div class="ws-bar"><span style=${{ width: `${Math.round((prog.n / Math.max(1, prog.t)) * 100)}%` }}></span></div></div>` : null}
    ${packs.length ? html`<b class="small">Auf diesem Gerät</b><div class="stack sm">${packs.map(([p, n]) => html`<div class="row nowrap" key=${p}><span class="grow ellipsis">${p}</span><span class="badge">${n}</span><${IconBtn} icon="trash" title="Entfernen" onClick=${() => drop(p)} /></div>`)}</div>` : html`<div class="tiny faint">Noch keine eigenen Objekte.</div>`}
    <div class="tiny faint">Dateinamen mit Größenangabe (z. B. „Table_2x3“) werden erkannt, sonst zählt die Bildgröße. Größe und Verhalten (blockiert / schwieriges Gelände) lassen sich später je Objekt anpassen.</div>
  </div><div class="modal-foot"><${Btn} kind="primary" onClick=${() => close(null)}>Fertig<//></div>`;
}
// Texturwahl
function TexPick({ close, value, cats }) {
  const [cat, setCat] = useState('alle');
  const list = TEXTURES.filter((t) => cats.includes(t.cat) && (cat === 'alle' || t.cat === cat));
  const labels = { boden: 'Böden', pflaster: 'Pflaster & Wege', gelaende: 'Gelände', wand: 'Wände', dach: 'Dächer' };
  return html`<div class="modal-body stack">
    <div class="chips">${['alle', ...cats].map((c) => html`<button key=${c} type="button" class=${`chip${cat === c ? ' selected' : ''}`} onClick=${() => setCat(c)}>${c === 'alle' ? 'Alle' : labels[c] || c}</button>`)}</div>
    <div class="tex-grid">${list.map((t) => html`<button key=${t.id} type="button" class=${value === t.id ? 'active' : ''} onClick=${() => close(t.id)} title=${t.name}>
      <img src=${texUrl(t.id, true)} alt="" loading="lazy" /><span>${t.name}</span>
    </button>`)}</div>
    <div class="tiny faint">Texturen von Poly Haven (CC0)</div>
  </div>`;
}
const pickTexture = (cats, value) => openModal(({ close }) => html`<${TexPick} close=${close} value=${value} cats=${cats} />`, { title: 'Textur wählen', icon: 'image', size: 'lg' });
function TexBtn({ label, value, cats, onPick }) {
  return html`<button type="button" class="tex-btn" onClick=${async () => { const v = await pickTexture(cats, value); if (v) onPick(v); }}>
    <span class="tex-sw" style=${value ? { backgroundImage: `url(${texUrl(value, true)})` } : {}}></span>
    <span class="grow"><b>${label}</b><span class="tiny faint">${value ? texName(value) : 'wählen'}</span></span>
  </button>`;
}
function snapTo(v, mode, center) {
  if (mode === 'free') return r2(v);
  if (mode === 'half') return Math.round(v * 2) / 2;
  return center ? Math.floor(v) + 0.5 : Math.round(v);
}

// ───────────────────────── Gelände-Auswahl ─────────────────────────
const LIGHT_COLORS = [
  ['warm', 'Fackel', 'rgba(255,170,80,.5)'],
  ['kerze', 'Kerze', 'rgba(255,200,120,.38)'],
  ['kalt', 'Mondlicht', 'rgba(150,190,255,.38)'],
  ['magie', 'Magie', 'rgba(170,120,255,.45)'],
  ['gift', 'Grünes Leuchten', 'rgba(120,255,140,.4)'],
  ['glut', 'Lava', 'rgba(255,110,40,.5)'],
];
const terrainGroups = () => [
  { label: 'Wasser, Lava & Gruben', items: Object.entries(FLUIDS).map(([k, f]) => ({ key: k, label: f.label, color: f.shallow })).concat([{ key: 'difficult', label: 'Schwieriges Gelände', color: 'repeating-linear-gradient(135deg,#7a5a2a 0 3px,transparent 3px 7px)' }]) },
  { label: 'Untergrund', items: TEXTURES.filter((t) => t.cat === 'gelaende').map((t) => ({ key: `tex:${t.id}`, label: t.name, tex: t.id })) },
  { label: 'Wege & Pflaster', items: TEXTURES.filter((t) => t.cat === 'pflaster' || t.cat === 'boden').map((t) => ({ key: `tex:${t.id}`, label: t.name, tex: t.id })) },
];
const matLabel = (m) => (String(m).startsWith('tex:') ? texName(String(m).slice(4)) : FLUIDS[m]?.label || MATS[m]?.label || m);

// ───────────────────────── Ansicht ─────────────────────────
export function DungeonMapView({ map, params, active, tabId, settingsDialog }) {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const cid = useStore(app, (s) => s.cid);
  const role = useStore(app, (s) => s.role);
  const me = myUid();
  const tokOpts = role === 'gm' ? { where: [['mapId', '==', params.id]] } : { where: [['mapId', '==', params.id], ['visibility', '==', 'players']] };
  const tokensRaw = useCol(cid ? col('tokens') : null, tokOpts);
  const tokens = (tokensRaw || []).filter((t) => gm || t.visibility === 'players');
  const [mode, setMode] = useState(gm && !params.play ? 'build' : 'play');
  const [tool, setTool] = useState(gm && !params.play ? 'room' : 'pan');
  const [op, setOp] = useState('add');
  const [snap, setSnap] = useState('grid');
  const [width, setWidth] = useState(1);
  const [brushW, setBrushW] = useState(2);
  const [wallThick, setWallThick] = useState(0.3);
  const [mat, setMat] = useState('water');
  const [shapeTex, setShapeTex] = useState('');
  const [doorKey, setDoorKey] = useState('p:door');
  const [objKey, setObjKey] = useState('ph:treasure_chest');
  const [objScale, setObjScale] = useState(1);
  const [objRandom, setObjRandom] = useState(false);
  const [scatterSet, setScatterSet] = useState('gras');
  const [scatterR, setScatterR] = useState(1.5);
  const [scatterN, setScatterN] = useState(3);
  const [lightKind, setLightKind] = useState('warm');
  const [lightR, setLightR] = useState(5);
  const [textKind, setTextKind] = useState('room');
  const [matCat, setMatCat] = useState(0);
  const [fogBrush, setFogBrush] = useState(2);
  const [sel, setSel] = useState(null);
  const [side, setSide] = useState(() => !matchMedia('(max-width: 899px)').matches);
  const [measureText, setMeasureText] = useState('');
  const [busy, setBusy] = useState('');
  const [showLight, setShowLight] = useState(true);
  const [, setTick] = useState(0);
  const rerender = () => setTick((x) => x + 1);
  const wrapRef = useRef();
  const cvRef = useRef();
  const S = useRef(null);
  if (!S.current) {
    S.current = {
      t: { x: 0, y: 0, k: 1 }, w: 0, h: 0, dpr: 1, pointers: new Map(), fitted: false, userMoved: false, dirty: true,
      cache: document.createElement('canvas'), cacheKey: '', objCache: document.createElement('canvas'), objKeyC: '',
      darkCv: document.createElement('canvas'), glowCv: document.createElement('canvas'), lightKey: '', lightOn: null,
      geom: 0, ver: 0, img: null, bakeImg: null, undo: [], redo: [], localDirty: false, placeRot: 0,
      doc: null, draft: null, fog: null,
    };
  }
  const s = S.current;
  s.gm = gm;
  s.me = me;
  s.mode = mode;
  s.tool = tool;
  s.op = op;
  s.snap = snap;
  s.width = width;
  s.brushW = brushW;
  s.wallThick = wallThick;
  s.mat = mat;
  s.shapeTex = shapeTex;
  s.doorKey = doorKey;
  s.objKey = objKey;
  s.objScale = objScale;
  s.objRandom = objRandom;
  s.scatterSet = scatterSet;
  s.scatterR = scatterR;
  s.scatterN = scatterN;
  s.lightKind = lightKind;
  s.lightR = lightR;
  s.textKind = textKind;
  s.fogBrush = fogBrush;
  s.showLight = showLight;
  s.sel = sel;
  s.tokens = tokens;

  const pickDoc = (m) => ({
    w: m.w || 36, h: m.h || 26, style: m.style || 'klassisch', gridOn: m.gridOn !== false, hatch: m.hatch ?? 1, bgAlpha: m.bgAlpha ?? 0.5,
    outdoor: !!m.outdoor, ground: m.ground || (m.outdoor ? 'leafy_grass' : 'dark_rock'), floorTex: m.floorTex || 'stone_tiles', wallTex: m.wallTex || 'castle_brick_01',
    wallW: m.wallW || 0, dark: m.dark || 0, soft: m.soft ?? 0.3, roofs: m.roofs !== false,
    shapes: m.shapes || [], terrain: m.terrain || [], objects: m.objects || [], labels: m.labels || [], lights: m.lights || [],
  });
  if (!s.doc) s.doc = pickDoc(map);
  s.fogOn = !!map.fog?.enabled;
  const real = isReal(s.doc);
  const grid = useMemo(() => buildGrid(s.doc), [s.geom, s.doc.w, s.doc.h]);
  const B = useBattle({ cid, mapId: params.id, gm, me, tokens, grid, gridKey: s.geom, redraw: () => { s.dirty = true; }, rerender });
  s.B = B;
  // Änderungen anderer übernehmen, solange hier nichts ungespeichert ist
  useEffect(() => {
    if (!s.localDirty) {
      s.doc = pickDoc(map);
      s.geom++;
      s.ver++;
      s.dirty = true;
      rerender();
    }
    if (!s.localFog) s.fog = (map.fog?.revealed || '').padEnd((map.w || 36) * (map.h || 26), '0').split('');
    s.dirty = true;
  }, [map]);
  useEffect(() => { s.dirty = true; }, [tokensRaw, gm, mode, sel]);
  // Spieleransicht: nie im Baumodus bleiben
  useEffect(() => {
    if (gm || mode === 'play') return;
    setMode('play');
    setTool('pan');
    setSel(null);
    s.draft = null;
    s.dirty = true;
  }, [gm]);
  // Texturen und Stempel dieser Karte laden, dann neu zeichnen
  useEffect(() => {
    if (!real) return undefined;
    let stop = false;
    preloadMap(s.doc, OBJ).then(() => { if (!stop) s.dirty = true; });
    return () => { stop = true; };
  }, [s.geom, s.ver, real]);
  useEffect(() => onAssets(() => { s.dirty = true; }), []);

  useEffect(() => {
    s.img = null;
    s.geom++;
    s.dirty = true;
    if (!map.fileId) return;
    fileUrl(cid, map.fileId).then((u) => {
      if (!u) return;
      const im = new Image();
      im.onload = () => { s.img = im; s.geom++; s.dirty = true; };
      im.src = u;
    });
  }, [map.fileId]);
  // Spielerbild (gebackene Karte mit eigenen Objekten)
  useEffect(() => {
    s.bakeImg = null;
    s.geom++;
    s.dirty = true;
    if (gm || !map.bake?.fileId) return;
    fileUrl(cid, map.bake.fileId).then((u) => {
      if (!u) return;
      const im = new Image();
      im.onload = () => { s.bakeImg = im; s.geom++; s.dirty = true; };
      im.src = u;
    });
  }, [map.bake?.fileId, gm]);

  const save = useRef(debounce(async () => {
    const d = s.doc;
    const seq = s.editSeq || 0;
    const patch = { ...d, thumb: thumbOf(d), updatedAt: now() };
    try {
      await db.update(col('maps'), params.id, patch);
    } catch (e) {
      toast(`Speichern fehlgeschlagen: ${e.message}`, 'error');
    }
    if ((s.editSeq || 0) === seq) s.localDirty = false;
  }, 900)).current;
  const saveFog = useRef(debounce(async () => {
    await db.update(col('maps'), params.id, { fog: { ...(map.fog || {}), revealed: s.fog.join('') } }).catch((e) => toast(e.message, 'error'));
    s.localFog = false;
  }, 500)).current;
  useEffect(() => () => { if (s.localDirty) save.flush(); }, []);

  const commit = (patch, { geom = true, undo = true } = {}) => {
    s.editSeq = (s.editSeq || 0) + 1;
    if (undo) {
      s.undo.push(JSON.stringify(s.doc));
      if (s.undo.length > 80) s.undo.shift();
      s.redo = [];
    }
    s.doc = { ...s.doc, ...patch };
    if (geom) s.geom++;
    s.ver++;
    s.localDirty = true;
    s.dirty = true;
    save();
    rerender();
  };
  const undo = () => {
    if (!s.undo.length) return;
    s.redo.push(JSON.stringify(s.doc));
    s.doc = JSON.parse(s.undo.pop());
    s.geom++;
    s.ver++;
    s.localDirty = true;
    s.dirty = true;
    setSel(null);
    save();
    rerender();
  };
  const redo = () => {
    if (!s.redo.length) return;
    s.undo.push(JSON.stringify(s.doc));
    s.doc = JSON.parse(s.redo.pop());
    s.geom++;
    s.ver++;
    s.localDirty = true;
    s.dirty = true;
    save();
    rerender();
  };

  const fit = () => {
    if (s.w < 10) return;
    const d = s.doc;
    const k = Math.min((s.w - 40) / (d.w * PX), (s.h - 40) / (d.h * PX));
    s.t.k = clamp(k, 0.05, 6);
    s.t.x = (s.w - d.w * PX * s.t.k) / 2;
    s.t.y = (s.h - d.h * PX * s.t.k) / 2;
    s.fitted = true;
    s.userMoved = false;
    s.dirty = true;
  };

  // Die Karte bleibt immer teilweise im Bild: nur so weit verschieben, dass noch Karte zu sehen ist
  s.clampView = () => {
    const d = s.doc;
    if (!d || s.w < 10) return;
    const mw = d.w * PX * s.t.k;
    const mh = d.h * PX * s.t.k;
    const kx = Math.min(mw, Math.max(80, s.w * 0.3));
    const ky = Math.min(mh, Math.max(80, s.h * 0.3));
    s.t.x = clamp(s.t.x, kx - mw, s.w - kx);
    s.t.y = clamp(s.t.y, ky - mh, s.h - ky);
  };

  // Ansicht auf einen Token schwenken (nur falls er außerhalb liegt, wenn onlyIfHidden)
  s.focusToken = (t, onlyIfHidden) => {
    const n = t.size || 1;
    const k = s.t.k * PX;
    const px = s.t.x + (t.x + n / 2) * k;
    const py = s.t.y + (t.y + n / 2) * k;
    if (onlyIfHidden && px > 80 && px < s.w - 80 && py > 90 && py < s.h - 170) return;
    s.t.x = s.w / 2 - (t.x + n / 2) * k;
    s.t.y = s.h / 2 - (t.y + n / 2) * k;
    s.clampView();
    s.userMoved = true;
    s.dirty = true;
  };

  // Größe
  useEffect(() => {
    const el = wrapRef.current;
    const cv = cvRef.current;
    if (!el || !cv) return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      s.w = r.width;
      s.h = r.height;
      s.dpr = dpr;
      if (!s.fitted || !s.userMoved) fit();
      else s.clampView();
      s.dirty = true;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Zeichenschleife
  useEffect(() => {
    if (!active) return undefined;
    let raf;
    let settleT = 0;
    const loop = (t) => {
      const d = s.doc;
      const st = STYLES[d.style] || STYLES.klassisch;
      s.real = !!st.real;
      s.useBake = !s.gm && !!s.bakeImg && usesOwnAssets(d);
      const aver = assetsVersion();
      const want = clamp(2 ** Math.ceil(Math.log2(Math.max(8, s.t.k * PX * s.dpr))), 12, s.real ? 96 : 64);
      const maxCs = Math.sqrt((s.real ? REAL_CACHE_PX : MAX_CACHE_PX) / Math.max(1, d.w * d.h));
      const cs = Math.max(6, Math.min(want, maxCs));
      const busyDraw = s.act && (s.act.kind === 'move' || s.act.kind === 'brush' || s.act.kind === 'drag' || s.act.kind === 'scatter');
      // Beim Ziehen grob rendern (flüssig), nach dem Loslassen wieder scharf
      const csStatic = busyDraw ? Math.min(cs, 26) : cs;
      const key = `${s.geom}|${csStatic}|${d.style}|${aver}|${s.useBake ? 'b' : ''}`;
      if (key !== s.cacheKey && (t - settleT > 120 || !s.cacheKey.startsWith(`${s.geom}|`)) && (!busyDraw || t - (s.lastStatic || 0) > 140)) {
        s.maskCv = s.maskCv || document.createElement('canvas');
        renderStatic(s.cache, d, csStatic, st, s.img, s.useBake ? s.bakeImg : null, { grid: false, maskCv: s.maskCv });
        s.cacheKey = key;
        s.lastStatic = t;
        s.dirty = true;
      }
      if (s.real && !s.useBake) {
        s.live = s.t.k * PX * s.dpr > cs * 1.45;
        // Beim Hineinzoomen den sichtbaren Ausschnitt scharf nachzeichnen
        if (s.live && !busyDraw && t - (s.lastDetail || 0) > 120) {
          const kpx = s.t.k * PX;
          const vw = Math.min(d.w, s.w / kpx);
          const vh = Math.min(d.h, s.h / kpx);
          const vx = clamp(-s.t.x / kpx, 0, Math.max(0, d.w - vw));
          const vy = clamp(-s.t.y / kpx, 0, Math.max(0, d.h - vh));
          const rx = clamp(vx - vw * 0.2, 0, d.w);
          const ry = clamp(vy - vh * 0.2, 0, d.h);
          const rw = Math.min(d.w - rx, vw * 1.4);
          const rh = Math.min(d.h - ry, vh * 1.4);
          const dcs = Math.min(Math.ceil(kpx * s.dpr), Math.sqrt(6e6 / Math.max(1, rw * rh)));
          const dd = s.detail;
          const stale = !dd || dd.geom !== s.geom || dd.aver !== aver || dd.cs < dcs * 0.8
            || vx < dd.x - 1e-6 || vy < dd.y - 1e-6 || vx + vw > dd.x + dd.w + 1e-6 || vy + vh > dd.y + dd.h + 1e-6;
          if (stale && dcs > cs * 1.1) {
            s.detailCv = s.detailCv || document.createElement('canvas');
            renderReal(s.detailCv, d, dcs, { bg: s.img, rect: { x: rx, y: ry, w: rw, h: rh }, grid: false });
            s.detail = { cv: s.detailCv, x: rx, y: ry, w: rw, h: rh, cs: dcs, geom: s.geom, aver };
            s.lastDetail = t;
            s.dirty = true;
          }
        } else if (!s.live && s.detail) {
          s.detail = null;
          if (s.detailCv) { s.detailCv.width = 1; s.detailCv.height = 1; }
          s.dirty = true;
        }
        const ok = `${s.ver}|${cs}|${aver}|${s.skipObj || ''}`;
        if (!s.live && ok !== s.objKeyC && (t - settleT > 120 || !s.objKeyC.startsWith(`${s.ver}|`)) && (!busyDraw || t - (s.lastObj || 0) > 150)) {
          renderObjects(s.objCache, d, cs, { legacyDefs: OBJ, skip: s.skipObj });
          s.objKeyC = ok;
          s.lastObj = t;
          s.dirty = true;
        }
        const lk = `${s.ver}|${aver}|${d.dark}`;
        if (lk !== s.lightKey) {
          s.lightOn = renderLighting(s.darkCv, s.glowCv, d, 14, { legacyDefs: OBJ });
          s.lightKey = lk;
          s.dirty = true;
        }
      }
      if (s.zooming) settleT = t;
      s.zooming = false;
      if (s.mode === 'play' && animating(s.B) && t - (s.lastAnim || 0) > 33) { s.dirty = true; s.lastAnim = t; }
      if (s.dirty) {
        draw();
        s.dirty = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  function draw() {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const d = s.doc;
    const st = STYLES[d.style] || STYLES.klassisch;
    const k = s.t.k * PX;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, s.w, s.h);
    ctx.save();
    ctx.translate(s.t.x, s.t.y);
    ctx.scale(k, k);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(s.cache, 0, 0, d.w, d.h);
    if (s.real && s.live && s.detail) ctx.drawImage(s.detail.cv, s.detail.x, s.detail.y, s.detail.w, s.detail.h);
    if (s.real && !s.useBake && d.gridOn !== false) drawGrid(ctx, s, d, k);
    if (s.mode === 'build') {
      ctx.strokeStyle = 'rgba(120,120,120,.5)';
      ctx.lineWidth = 1 / k;
      ctx.setLineDash([6 / k, 5 / k]);
      ctx.strokeRect(0, 0, d.w, d.h);
      ctx.setLineDash([]);
    }
    if (s.real && !s.useBake) {
      if (s.live) {
        const view = { x0: -s.t.x / k, y0: -s.t.y / k, x1: (s.w - s.t.x) / k, y1: (s.h - s.t.y) / k };
        drawObjects(ctx, d, { legacyDefs: OBJ, skip: s.skipObj, view });
      } else ctx.drawImage(s.objCache, 0, 0, d.w, d.h);
      if (s.skipObj) {
        const o = d.objects.find((x) => x.id === s.skipObj);
        if (o) drawStampPreview(ctx, o, OBJ, 1);
      }
      const lightOn = s.mode === 'play' || s.showLight;
      if (s.lightOn?.dark && lightOn) ctx.drawImage(s.darkCv, 0, 0, d.w, d.h);
      if (s.lightOn?.glow && lightOn) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(s.glowCv, 0, 0, d.w, d.h);
        ctx.globalCompositeOperation = 'source-over';
      }
    } else if (!s.useBake) {
      for (const o of d.objects) drawObject(ctx, o, st);
    }
    for (const l of d.labels) drawLabel(ctx, l, st);
    // Lichter im Baumodus als kleine Marken
    if (s.mode === 'build' && s.real) {
      for (const l of d.lights || []) {
        circ(ctx, l.x, l.y, 0.16, 'rgba(255,225,170,.95)', 'rgba(0,0,0,.65)', 0.04);
        if (s.sel?.kind === 'light' && s.sel.id === l.id) {
          ctx.setLineDash([0.2, 0.15]);
          circ(ctx, l.x, l.y, l.r || 4, null, '#f5c542', 0.05);
          ctx.setLineDash([]);
        }
      }
    }
    // Kampf-Ebene: Schablonen, Bewegung, Reichweiten, Tokens, Pings
    if (s.mode === 'play') {
      drawBattle(ctx, s, k);
      if (map.fog?.enabled && s.fog) {
        ctx.fillStyle = s.gm ? 'rgba(0,0,0,.5)' : '#000';
        for (let i = 0; i < s.fog.length; i++) {
          if (s.fog[i] === '1') continue;
          ctx.fillRect((i % d.w) - 0.01, Math.floor(i / d.w) - 0.01, 1.02, 1.02);
        }
      }
    }
    // Auswahl
    const sl = s.sel;
    if (sl && s.mode === 'build') {
      ctx.strokeStyle = '#8a5cf5';
      ctx.lineWidth = 2.5 / k;
      ctx.setLineDash([5 / k, 4 / k]);
      if (sl.kind === 'obj') {
        const o = d.objects.find((x) => x.id === sl.id);
        const m = o && objMeta(o);
        if (m) {
          ctx.save();
          ctx.translate(o.x, o.y);
          ctx.rotate(((o.r || 0) * Math.PI) / 180);
          ctx.strokeRect(-m.w / 2 - 0.08, -m.h / 2 - 0.08, m.w + 0.16, m.h + 0.16);
          ctx.restore();
        }
      } else if (sl.kind === 'label') {
        const l = d.labels.find((x) => x.id === sl.id);
        if (l) ctx.strokeRect(l.x - (l.size || 0.7), l.y - (l.size || 0.7) * 0.7, (l.size || 0.7) * 2, (l.size || 0.7) * 1.4);
      } else if (sl.kind === 'light') {
        const l = (d.lights || []).find((x) => x.id === sl.id);
        if (l) ctx.strokeRect(l.x - 0.3, l.y - 0.3, 0.6, 0.6);
      } else if (sl.kind === 'shape' || sl.kind === 'terrain') {
        const sh = (sl.kind === 'shape' ? d.shapes : d.terrain).find((x) => x.id === sl.id);
        if (sh) {
          tracePath(ctx, sh);
          if (sh.kind === 'path' || sh.kind === 'brush') ctx.lineWidth = 2.5 / k;
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
    // Vorschau des aktuellen Werkzeugs
    const dr = s.draft;
    if (dr) {
      const sub = dr.op === 'sub';
      ctx.fillStyle = sub ? 'rgba(229,72,77,.25)' : 'rgba(138,92,245,.22)';
      ctx.strokeStyle = sub ? '#e5484d' : '#8a5cf5';
      ctx.lineWidth = 2 / k;
      if (dr.kind === 'rect' || dr.kind === 'ellipse') {
        tracePath(ctx, dr);
        ctx.fill();
        ctx.stroke();
        const [x1, y1, x2, y2] = dr.pts;
        utext(ctx, `${Math.abs(x2 - x1)} × ${Math.abs(y2 - y1)}`, (x1 + x2) / 2, Math.min(y1, y2) - 0.4, 0.45, '#8a5cf5', '#fff');
      } else if (dr.kind === 'poly' || dr.kind === 'path' || dr.kind === 'brush') {
        const pts = dr.hover ? [...dr.pts, dr.hover.x, dr.hover.y] : dr.pts;
        tracePath(ctx, { kind: dr.kind === 'poly' ? 'line' : dr.kind, pts });
        if (dr.kind === 'poly') ctx.stroke();
        else {
          ctx.lineWidth = dr.w;
          ctx.lineCap = dr.kind === 'path' ? 'square' : 'round';
          ctx.lineJoin = dr.kind === 'path' ? 'miter' : 'round';
          ctx.strokeStyle = sub ? 'rgba(229,72,77,.45)' : 'rgba(138,92,245,.35)';
          ctx.stroke();
        }
        for (let i = 0; i < dr.pts.length; i += 2) circ(ctx, dr.pts[i], dr.pts[i + 1], 0.09, '#8a5cf5');
      }
    }
    if (s.hover && s.mode === 'build' && (s.tool === 'door' || s.tool === 'object')) {
      if (s.real || s.hover.t === 'stamp') drawStampPreview(ctx, s.hover, OBJ, 0.6);
      else {
        ctx.globalAlpha = 0.55;
        drawObject(ctx, s.hover, st);
        ctx.globalAlpha = 1;
      }
    }
    if (s.mode === 'build' && s.tool === 'scatter' && s.hoverPt) {
      ctx.setLineDash([0.2, 0.15]);
      circ(ctx, s.hoverPt.x, s.hoverPt.y, s.scatterR, 'rgba(138,92,245,.1)', '#8a5cf5', 0.04);
      ctx.setLineDash([]);
    }
    if (s.measure) {
      const { a, b } = s.measure;
      ctx.strokeStyle = '#e0b24a';
      ctx.lineWidth = 3 / k;
      ctx.setLineDash([10 / k, 6 / k]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // Raster in Bildschirmauflösung, innerhalb der Räume (außen nur bei Außenkarten)
  function drawGrid(ctx, st2, d, k) {
    const gw = Math.max(1, Math.round(st2.w * st2.dpr));
    const gh = Math.max(1, Math.round(st2.h * st2.dpr));
    const cv = st2.gridCv || (st2.gridCv = document.createElement('canvas'));
    if (cv.width !== gw || cv.height !== gh) { cv.width = gw; cv.height = gh; }
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, gw, gh);
    g.setTransform(st2.dpr, 0, 0, st2.dpr, 0, 0);
    g.translate(st2.t.x, st2.t.y);
    g.scale(k, k);
    const x0 = Math.max(0, Math.floor(-st2.t.x / k));
    const x1 = Math.min(d.w, Math.ceil((st2.w - st2.t.x) / k));
    const y0 = Math.max(0, Math.floor(-st2.t.y / k));
    const y1 = Math.min(d.h, Math.ceil((st2.h - st2.t.y) / k));
    if (x1 <= x0 || y1 <= y0) return;
    const lw = Math.max(0.9, k / 36) / k;
    for (const [off, col] of [[lw, 'rgba(255,255,255,.16)'], [0, d.outdoor ? 'rgba(0,0,0,.32)' : 'rgba(0,0,0,.45)']]) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      for (let x = x0; x <= x1; x++) { g.moveTo(x + off, y0); g.lineTo(x + off, y1); }
      for (let y = y0; y <= y1; y++) { g.moveTo(x0, y + off); g.lineTo(x1, y + off); }
      g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (st2.maskCv && st2.maskCv.width > 1) {
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(st2.maskCv, st2.t.x * st2.dpr, st2.t.y * st2.dpr, d.w * k * st2.dpr, d.h * k * st2.dpr);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cv, 0, 0);
    ctx.restore();
  }

  // ── Eingabe ──
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return undefined;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const toW = (p) => ({ x: (p.x - s.t.x) / (s.t.k * PX), y: (p.y - s.t.y) / (s.t.k * PX) });
    const zoomAt = (p, f) => {
      const k = clamp(s.t.k * f, 0.05, 8);
      const real2 = k / s.t.k;
      s.t.x = p.x - (p.x - s.t.x) * real2;
      s.t.y = p.y - (p.y - s.t.y) * real2;
      s.t.k = k;
      s.clampView();
      s.userMoved = true;
      s.zooming = true;
      s.dirty = true;
    };
    const snapMode = (e) => (e.shiftKey ? 'free' : s.snap);
    const sizeOf = (key, sc = 1) => {
      const i = assetInfo(key);
      return { w: (i?.w || 1) * sc, h: (i?.h || 1) * sc };
    };
    const placeDoor = (w, key) => {
      const { w: dw } = sizeOf(key);
      const fx = w.x - Math.floor(w.x);
      const fy = w.y - Math.floor(w.y);
      const dV = Math.min(fx, 1 - fx);
      const dH = Math.min(fy, 1 - fy);
      const odd = Math.round(dw) % 2;
      if (dV < dH) return { id: 'hover', t: 'stamp', a: key, x: Math.round(w.x), y: odd ? Math.floor(w.y) + 0.5 : Math.round(w.y), r: 90, s: 1 };
      return { id: 'hover', t: 'stamp', a: key, x: odd ? Math.floor(w.x) + 0.5 : Math.round(w.x), y: Math.round(w.y), r: 0, s: 1 };
    };
    const placeObj = (w, key, e) => {
      const sc = s.objScale;
      const { w: ow, h: oh } = sizeOf(key, sc);
      const r = s.objRandom ? randInt(0, 359) : s.placeRot;
      const m = snapMode(e);
      if (m === 'free' || ow < 0.9 || oh < 0.9 || s.objRandom) return { id: 'hover', t: 'stamp', a: key, x: r2(w.x), y: r2(w.y), r, s: sc };
      const near = (v, size) => (Math.round(size) % 2 ? Math.floor(v) + 0.5 : Math.round(v));
      return { id: 'hover', t: 'stamp', a: key, x: near(w.x, ow), y: near(w.y, oh), r, s: sc };
    };
    const hitAny = (w) => {
      const d = s.doc;
      for (let i = d.labels.length - 1; i >= 0; i--) if (Math.hypot(d.labels[i].x - w.x, d.labels[i].y - w.y) < (d.labels[i].size || 0.7)) return { kind: 'label', id: d.labels[i].id };
      for (let i = (d.lights || []).length - 1; i >= 0; i--) if (Math.hypot(d.lights[i].x - w.x, d.lights[i].y - w.y) < 0.35) return { kind: 'light', id: d.lights[i].id };
      for (let i = d.objects.length - 1; i >= 0; i--) if (objHit(d.objects[i], w.x, w.y)) return { kind: 'obj', id: d.objects[i].id };
      for (let i = d.terrain.length - 1; i >= 0; i--) if (d.terrain[i].op !== 'sub' && shapeHit(d.terrain[i], w.x, w.y)) return { kind: 'terrain', id: d.terrain[i].id };
      for (let i = d.shapes.length - 1; i >= 0; i--) if (d.shapes[i].op !== 'sub' && shapeHit(d.shapes[i], w.x, w.y)) return { kind: 'shape', id: d.shapes[i].id };
      return null;
    };
    const fogPaint = (w) => {
      const d = s.doc;
      const r = s.fogBrush - 1;
      const cx = Math.floor(w.x);
      const cy = Math.floor(w.y);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= d.w || y >= d.h) continue;
          s.fog[y * d.w + x] = s.tool === 'reveal' ? '1' : '0';
        }
      }
      s.localFog = true;
      s.dirty = true;
      saveFog();
    };
    // Streu-Pinsel: zufällige Stempel im Kreis
    const scatterPaint = (w, first) => {
      const set = SETS[s.scatterSet];
      if (!set?.keys.length) return;
      const now2 = performance.now();
      if (!first && now2 - (s.lastScatter || 0) < 90) return;
      if (!first && Math.hypot(w.x - (s.lastScatterAt?.x ?? -99), w.y - (s.lastScatterAt?.y ?? -99)) < s.scatterR * 0.6) return;
      s.lastScatter = now2;
      s.lastScatterAt = { x: w.x, y: w.y };
      const add = [];
      for (let i = 0; i < s.scatterN; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * s.scatterR;
        const x = w.x + Math.cos(a) * rr;
        const y = w.y + Math.sin(a) * rr;
        if (x < 0 || y < 0 || x > s.doc.w || y > s.doc.h) continue;
        add.push(stampAt(pick(set.keys), x, y, { r: randInt(0, 359), s: rnd(set.s[0], set.s[1]) * s.objScale, fx: Math.random() < 0.5 }));
      }
      if (!add.length) return;
      s.doc = { ...s.doc, objects: [...s.doc.objects, ...add] };
      s.ver++;
      s.localDirty = true;
      s.dirty = true;
    };
    const finishDraft = () => {
      const dr = s.draft;
      s.draft = null;
      if (!dr) return;
      if ((dr.kind === 'poly' && dr.pts.length < 6) || ((dr.kind === 'path' || dr.kind === 'brush') && dr.pts.length < 2)) { s.dirty = true; return; }
      const item = { id: uid(6), op: dr.op, kind: dr.kind, pts: dr.kind === 'brush' ? simplify(dr.pts, 0.06) : dr.pts.map(r2) };
      if (dr.kind === 'path' || dr.kind === 'brush') item.w = dr.w;
      if (dr.wall) item.wall = 1;
      if (dr.terrain) commit({ terrain: [...s.doc.terrain, { ...item, mat: dr.mat }] });
      else {
        if (dr.tex && dr.op !== 'sub') item.tex = dr.tex;
        commit({ shapes: [...s.doc.shapes, item] });
      }
    };
    s.finishDraft = finishDraft;

    const down = async (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e);
      s.pointers.set(e.pointerId, p);
      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        s.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: s.t.k };
        if (s.act?.kind === 'brush' || s.act?.kind === 'drag') s.draft = null;
        s.act = null;
        return;
      }
      const w = toW(p);
      const tl = s.tool;
      const sub = s.op === 'sub' || e.altKey || e.button === 2;
      if (e.button === 1 || (e.button === 2 && !['room', 'ellipse', 'brush', 'terrain'].includes(tl)) || (tl === 'pan' && s.mode === 'build')) {
        s.act = { kind: 'pan', sx: p.x, sy: p.y, tx: s.t.x, ty: s.t.y };
        return;
      }
      if (s.mode === 'play') {
        if (e.altKey && e.button === 0) { ping(s.B, w); return; }
        if (s.B && battleDown(s.B, w, s.doc.w, s.doc.h)) return;
        if (tl === 'place' && s.gm) { await placeMonster(s.B, w, s.doc.w, s.doc.h); return; }
        if (tl === 'measure') { s.measure = { a: w, b: w }; s.act = { kind: 'measure' }; s.dirty = true; return; }
        if ((tl === 'reveal' || tl === 'hide') && s.gm) { s.act = { kind: 'fog' }; fogPaint(w); return; }
        if (tl === 'token' && s.gm) {
          const r = await openModal(({ close }) => html`<${TokenForm} close=${close} members=${Object.values(vault.get().members)} />`, { title: 'Token setzen', icon: 'user-plus' });
          if (r && !r._delete) await db.add(col('tokens'), { mapId: params.id, x: Math.floor(w.x), y: Math.floor(w.y), label: r.label, color: r.color, size: r.size, ownerUid: r.ownerUid || null, visibility: r.visibility, createdAt: now() });
          return;
        }
        const t = [...s.tokens].reverse().find((x) => w.x >= x.x && w.x < x.x + (x.size || 1) && w.y >= x.y && w.y < x.y + (x.size || 1));
        if (t) {
          if (s.gm || t.ownerUid === s.me) s.act = { kind: 'token', t, off: { x: w.x - t.x, y: w.y - t.y }, moved: false, sx: p.x, sy: p.y };
          else selectToken(s.B, t.id);
          return;
        }
        const lab = s.doc.labels.find((l) => l.noteId && Math.hypot(l.x - w.x, l.y - w.y) < (l.size || 0.7));
        if (lab) { const n = noteById(lab.noteId); if (n) openNote(n.id, { newTab: true }); return; }
        s.act = { kind: 'pan', sx: p.x, sy: p.y, tx: s.t.x, ty: s.t.y, play: true };
        clearTimeout(s.lp);
        s.lp = setTimeout(() => { if (s.act?.kind === 'pan' && s.act.play && !s.act.far && s.pointers.size === 1) { ping(s.B, w); s.act = null; } }, 650);
        return;
      }
      // Bauen
      if (tl === 'select') {
        const h = hitAny(w);
        setSel(h);
        s.sel = h;
        if (h) {
          s.undo.push(JSON.stringify(s.doc));
          if (h.kind === 'obj') s.skipObj = h.id;
          s.act = { kind: 'move', h, start: w, orig: JSON.parse(JSON.stringify(s.doc)), moved: false };
        } else s.act = { kind: 'pan', sx: p.x, sy: p.y, tx: s.t.x, ty: s.t.y };
        s.dirty = true;
        return;
      }
      if (tl === 'room' || tl === 'ellipse' || (tl === 'terrain' && e.ctrlKey)) {
        const m = snapMode(e);
        const x = snapTo(w.x, m);
        const y = snapTo(w.y, m);
        s.draft = { kind: tl === 'ellipse' ? 'ellipse' : 'rect', op: sub ? 'sub' : 'add', pts: [x, y, x, y], terrain: tl === 'terrain', mat: s.mat, tex: s.shapeTex };
        s.act = { kind: 'drag' };
        s.dirty = true;
        return;
      }
      if (tl === 'brush' || tl === 'terrain') {
        s.draft = { kind: 'brush', op: sub ? 'sub' : 'add', pts: [r2(w.x), r2(w.y)], w: s.brushW, terrain: tl === 'terrain', mat: s.mat, tex: s.shapeTex };
        s.act = { kind: 'brush' };
        s.dirty = true;
        return;
      }
      if (tl === 'scatter') {
        s.act = { kind: 'scatter' };
        s.undo.push(JSON.stringify(s.doc));
        s.redo = [];
        scatterPaint(w, true);
        return;
      }
      if (tl === 'poly' || tl === 'path' || tl === 'wall') {
        const m = snapMode(e);
        const center = tl === 'path';
        const x = snapTo(w.x, m, center);
        const y = snapTo(w.y, m, center);
        const dr = s.draft;
        if (dr && dr.kind === (tl === 'poly' ? 'poly' : 'path') && !!dr.wall === (tl === 'wall')) {
          const n = dr.pts.length;
          if (tl === 'poly' && n >= 6 && Math.hypot(dr.pts[0] - x, dr.pts[1] - y) < 0.3) { finishDraft(); return; }
          if (Math.hypot(dr.pts[n - 2] - x, dr.pts[n - 1] - y) < 0.05) { finishDraft(); return; }
          dr.pts.push(x, y);
        } else if (tl === 'wall') s.draft = { kind: 'path', op: 'sub', pts: [x, y], w: s.wallThick, wall: 1 };
        else s.draft = { kind: tl, op: sub ? 'sub' : 'add', pts: [x, y], w: s.width, tex: s.shapeTex };
        s.dirty = true;
        rerender();
        return;
      }
      if (tl === 'door') {
        commit({ objects: [...s.doc.objects, { ...placeDoor(w, s.doorKey), id: uid(6) }] }, { geom: false });
        return;
      }
      if (tl === 'object') {
        const h = hitAny(w);
        if (h?.kind === 'obj' && e.detail > 1) return;
        commit({ objects: [...s.doc.objects, { ...placeObj(w, s.objKey, e), id: uid(6) }] }, { geom: false });
        return;
      }
      if (tl === 'light') {
        const color = (LIGHT_COLORS.find((c) => c[0] === s.lightKind) || LIGHT_COLORS[0])[2];
        commit({ lights: [...(s.doc.lights || []), { id: uid(6), x: r2(w.x), y: r2(w.y), r: s.lightR, color }] }, { geom: false });
        return;
      }
      if (tl === 'text') {
        if (s.textKind === 'room') {
          const nums = s.doc.labels.filter((l) => l.kind === 'room').map((l) => parseInt(l.text, 10)).filter((n) => !Number.isNaN(n));
          const next = (nums.length ? Math.max(...nums) : 0) + 1;
          commit({ labels: [...s.doc.labels, { id: uid(6), kind: 'room', text: String(next), x: r2(w.x), y: r2(w.y), size: 0.65 }] }, { geom: false });
        } else {
          const t = await promptDialog('Beschriftung', '', { title: 'Text setzen', placeholder: 'z. B. Krypta der Nebelkönige' });
          if (t) commit({ labels: [...s.doc.labels, { id: uid(6), kind: 'text', text: t, x: r2(w.x), y: r2(w.y), size: 0.7 }] }, { geom: false });
        }
      }
    };
    const move = (e) => {
      const p = pos(e);
      if (s.pointers.has(e.pointerId)) s.pointers.set(e.pointerId, p);
      if (s.pinch && s.pointers.size >= 2) {
        const [a, b] = [...s.pointers.values()];
        zoomAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, (s.pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / s.pinch.d)) / s.t.k);
        return;
      }
      const w = toW(p);
      const a = s.act;
      if (!a) {
        if (s.mode === 'play' && s.B) { s.B.hover = w; if (s.B.pending) s.dirty = true; }
        if (s.mode === 'build' && (s.tool === 'door' || s.tool === 'object') && e.pointerType !== 'touch') {
          s.hover = s.tool === 'door' ? placeDoor(w, s.doorKey) : placeObj(w, s.objKey, e);
          s.dirty = true;
        } else if (s.hover) { s.hover = null; s.dirty = true; }
        if (s.mode === 'build' && s.tool === 'scatter') { s.hoverPt = w; s.dirty = true; } else if (s.hoverPt) { s.hoverPt = null; s.dirty = true; }
        if (s.draft && (s.draft.kind === 'poly' || s.draft.kind === 'path')) {
          const m = snapMode(e);
          s.draft.hover = { x: snapTo(w.x, m, s.tool === 'path'), y: snapTo(w.y, m, s.tool === 'path') };
          s.dirty = true;
        }
        return;
      }
      if (a.kind === 'pan') {
        if (Math.hypot(p.x - a.sx, p.y - a.sy) > 6) { a.far = true; clearTimeout(s.lp); }
        s.t.x = a.tx + p.x - a.sx;
        s.t.y = a.ty + p.y - a.sy;
        s.clampView();
        s.userMoved = true;
        s.dirty = true;
        return;
      }
      if (a.kind === 'measure') {
        s.measure.b = w;
        const cells = Math.max(Math.abs(Math.floor(w.x) - Math.floor(s.measure.a.x)), Math.abs(Math.floor(w.y) - Math.floor(s.measure.a.y)));
        setMeasureText(settings.get().units === 'ft' ? `${cells * 5} ft (${cells} Felder)` : `${(cells * 1.5).toLocaleString('de-DE')} m (${cells} Felder)`);
        s.dirty = true;
        return;
      }
      if (a.kind === 'fog') { fogPaint(w); return; }
      if (a.kind === 'scatter') { s.hoverPt = w; scatterPaint(w, false); return; }
      if (a.kind === 'token') {
        if (Math.hypot(p.x - a.sx, p.y - a.sy) > 4) a.moved = true;
        a.t.dragX = w.x - a.off.x;
        a.t.dragY = w.y - a.off.y;
        const n = a.t.size || 1;
        if (s.B && a.moved) s.B.drag = { t: a.t, x: clamp(Math.round(a.t.dragX), 0, s.doc.w - n), y: clamp(Math.round(a.t.dragY), 0, s.doc.h - n) };
        s.dirty = true;
        return;
      }
      if (a.kind === 'drag' && s.draft) {
        const m = snapMode(e);
        s.draft.pts[2] = snapTo(w.x, m);
        s.draft.pts[3] = snapTo(w.y, m);
        s.dirty = true;
        return;
      }
      if (a.kind === 'brush' && s.draft) {
        const pts = s.draft.pts;
        if (Math.hypot(pts[pts.length - 2] - w.x, pts[pts.length - 1] - w.y) > 0.12) pts.push(r2(w.x), r2(w.y));
        s.dirty = true;
        return;
      }
      if (a.kind === 'move') {
        const m = snapMode(e);
        let dx = w.x - a.start.x;
        let dy = w.y - a.start.y;
        const fine = a.h.kind === 'obj' && (objMeta(s.doc.objects.find((x) => x.id === a.h.id) || {})?.w || 1) < 0.9;
        if (m === 'grid' && !fine) { dx = Math.round(dx); dy = Math.round(dy); } else if (m === 'half' && !fine) { dx = Math.round(dx * 2) / 2; dy = Math.round(dy * 2) / 2; }
        if (dx || dy) a.moved = true;
        const o = a.orig;
        const d = { ...s.doc };
        if (a.h.kind === 'obj') d.objects = o.objects.map((x) => (x.id === a.h.id ? { ...x, x: r2(x.x + dx), y: r2(x.y + dy) } : x));
        if (a.h.kind === 'label') d.labels = o.labels.map((x) => (x.id === a.h.id ? { ...x, x: r2(x.x + dx), y: r2(x.y + dy) } : x));
        if (a.h.kind === 'light') d.lights = (o.lights || []).map((x) => (x.id === a.h.id ? { ...x, x: r2(x.x + dx), y: r2(x.y + dy) } : x));
        if (a.h.kind === 'shape' || a.h.kind === 'terrain') {
          const key = a.h.kind === 'shape' ? 'shapes' : 'terrain';
          d[key] = o[key].map((x) => (x.id === a.h.id ? { ...x, pts: x.pts.map((v, i) => r2(v + (i % 2 ? dy : dx))) } : x));
          s.geom++;
        }
        s.doc = d;
        if (a.h.kind === 'light') s.ver++;
        s.dirty = true;
      }
    };
    const up = async (e) => {
      const p = pos(e);
      s.pointers.delete(e.pointerId);
      clearTimeout(s.lp);
      if (s.pinch) { if (s.pointers.size < 2) s.pinch = null; return; }
      const a = s.act;
      s.act = null;
      if (!a) return;
      if (a.kind === 'pan' && a.play && !a.far && s.B?.sel && !s.B.pending) { selectToken(s.B, null); return; }
      if (a.kind === 'drag') {
        const dr = s.draft;
        if (dr && (dr.pts[0] === dr.pts[2] || dr.pts[1] === dr.pts[3])) { s.draft = null; s.dirty = true; return; }
        finishDraft();
        return;
      }
      if (a.kind === 'brush') { finishDraft(); return; }
      if (a.kind === 'scatter') {
        s.editSeq = (s.editSeq || 0) + 1;
        s.ver++;
        s.dirty = true;
        save();
        rerender();
        return;
      }
      if (a.kind === 'move') {
        s.skipObj = null;
        s.objKeyC = '';
        if (a.moved) {
          s.redo = [];
          s.editSeq = (s.editSeq || 0) + 1;
          s.localDirty = true;
          s.ver++;
          if (a.h.kind === 'shape' || a.h.kind === 'terrain') s.geom++;
          save();
        } else s.undo.pop();
        rerender();
        return;
      }
      if (a.kind === 'token') {
        const t = a.t;
        const d = s.doc;
        if (s.B) s.B.drag = null;
        if (a.moved) {
          const nx = clamp(Math.round(t.dragX), 0, d.w - (t.size || 1));
          const ny = clamp(Math.round(t.dragY), 0, d.h - (t.size || 1));
          delete t.dragX;
          delete t.dragY;
          s.dirty = true;
          if (nx === t.x && ny === t.y) return;
          if (s.B && !onTokenDrop(s.B, t, nx, ny, d.w, d.h)) return;
          t.x = nx;
          t.y = ny;
          await db.update(col('tokens'), t.id, { x: nx, y: ny }).catch((err) => toast(err.message, 'error'));
        } else if (s.B) selectToken(s.B, t.id);
        void p;
      }
    };
    const dbl = () => {
      if (s.draft && (s.draft.kind === 'poly' || s.draft.kind === 'path')) finishDraft();
    };
    const wheel = (e) => {
      e.preventDefault();
      // Umschalt + Mausrad dreht das Objekt unter dem Zeiger
      if (e.shiftKey && s.mode === 'build' && (s.tool === 'object' || s.tool === 'door')) {
        s.placeRot = (((s.placeRot + (e.deltaY < 0 ? 15 : -15)) % 360) + 360) % 360;
        if (s.hover) { s.hover = { ...s.hover, r: s.placeRot }; s.dirty = true; }
        return;
      }
      zoomAt(pos(e), Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    const ctxmenu = (e) => e.preventDefault();
    const leave = () => { if (s.hover || s.hoverPt) { s.hover = null; s.hoverPt = null; s.dirty = true; } };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', leave);
    cv.addEventListener('dblclick', dbl);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('contextmenu', ctxmenu);
    return () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('pointerleave', leave);
      cv.removeEventListener('dblclick', dbl);
      cv.removeEventListener('wheel', wheel);
      cv.removeEventListener('contextmenu', ctxmenu);
    };
  }, []);

  // Tastenkürzel
  useEffect(() => {
    if (!active) return undefined;
    const key = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.querySelector('.modal-backdrop')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (s.mode === 'play' && e.key === 'Escape') {
        if (s.B?.pending) arm(s.B, null);
        else if (s.tool === 'place') { s.B.placing = null; setTool('pan'); } else if (s.B?.sel) selectToken(s.B, null);
        s.dirty = true;
        return;
      }
      if (s.mode !== 'build' || !s.gm) return;
      if (e.key === 'Escape') { s.draft = null; setSel(null); s.dirty = true; return; }
      if (e.key === 'Enter' && s.draft) { s.finishDraft?.(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.sel) { e.preventDefault(); deleteSel(); return; }
      if (e.key.toLowerCase() === 'r' && s.sel?.kind === 'obj' && !mod) { rotateSel(e.shiftKey ? 15 : 90); return; }
      if (e.key.toLowerCase() === 'f' && s.sel?.kind === 'obj' && !mod) { flipSel(); return; }
      if ((e.key === '+' || e.key === '-') && s.sel?.kind === 'obj' && !mod) { scaleSel(e.key === '+' ? 1.1 : 1 / 1.1); return; }
      if (mod && e.key.toLowerCase() === 'd' && s.sel) { e.preventDefault(); duplicateSel(); return; }
      if (mod || e.altKey) return;
      const t = BUILD_TOOLS.find((x) => x[3] === e.key.toLowerCase());
      if (t) { setTool(t[0]); s.draft = null; s.dirty = true; }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [active]);

  const selItem = () => {
    if (!sel) return null;
    const d = s.doc;
    if (sel.kind === 'obj') return d.objects.find((x) => x.id === sel.id);
    if (sel.kind === 'label') return d.labels.find((x) => x.id === sel.id);
    if (sel.kind === 'light') return (d.lights || []).find((x) => x.id === sel.id);
    if (sel.kind === 'shape') return d.shapes.find((x) => x.id === sel.id);
    if (sel.kind === 'terrain') return d.terrain.find((x) => x.id === sel.id);
    return null;
  };
  const listKey = (k) => ({ obj: 'objects', label: 'labels', shape: 'shapes', terrain: 'terrain', light: 'lights' }[k]);
  const updSel = (patch, geom = false) => {
    if (!sel) return;
    const key = listKey(sel.kind);
    commit({ [key]: (s.doc[key] || []).map((x) => (x.id === sel.id ? { ...x, ...patch } : x)) }, { geom: geom || sel.kind === 'shape' || sel.kind === 'terrain' });
  };
  function deleteSel() {
    if (!s.sel) return;
    const key = listKey(s.sel.kind);
    commit({ [key]: (s.doc[key] || []).filter((x) => x.id !== s.sel.id) }, { geom: s.sel.kind === 'shape' || s.sel.kind === 'terrain' });
    setSel(null);
  }
  function rotateSel(deg) {
    const o = s.doc.objects.find((x) => x.id === s.sel?.id);
    if (o) commit({ objects: s.doc.objects.map((x) => (x.id === o.id ? { ...x, r: ((((x.r || 0) + deg) % 360) + 360) % 360 } : x)) }, { geom: false });
  }
  function flipSel() {
    const o = s.doc.objects.find((x) => x.id === s.sel?.id);
    if (o) commit({ objects: s.doc.objects.map((x) => (x.id === o.id ? { ...x, fx: x.fx ? 0 : 1 } : x)) }, { geom: false });
  }
  function scaleSel(f) {
    const o = s.doc.objects.find((x) => x.id === s.sel?.id);
    if (o) commit({ objects: s.doc.objects.map((x) => (x.id === o.id ? { ...x, s: r2(clamp((x.s || 1) * f, 0.1, 8)) } : x)) }, { geom: false });
  }
  function duplicateSel() {
    const it = selItem();
    if (!it) return;
    const key = listKey(s.sel.kind);
    const copy = { ...JSON.parse(JSON.stringify(it)), id: uid(6) };
    if (copy.pts) copy.pts = copy.pts.map((v) => r2(v + 1));
    else { copy.x = r2(copy.x + 1); copy.y = r2(copy.y + 1); }
    commit({ [key]: [...s.doc[key], copy] }, { geom: !!copy.pts });
    setSel({ kind: s.sel.kind, id: copy.id });
  }

  const regenerate = async (k) => {
    if ((s.doc.shapes.length || s.doc.objects.length) && !(await confirmDialog(`Karte durch „${SCRAWL_GENERATORS[k].label}“ ersetzen? (Rückgängig mit Strg+Z)`, { ok: 'Ersetzen' }))) return;
    const g = SCRAWL_GENERATORS[k].fn(s.doc.w, s.doc.h);
    commit(g);
    setSel(null);
    fit();
  };
  const resize = async () => {
    const v = await promptDialog('Neue Größe (Spalten × Zeilen)', `${s.doc.w} × ${s.doc.h}`, { title: 'Kartengröße', hint: 'Felder à 1,5 m / 5 ft. Inhalte bleiben erhalten.' });
    const m = /(\d+)\s*[x×*]\s*(\d+)/i.exec(v || '');
    if (!m) return;
    const w = clamp(Number(m[1]), 8, 150);
    const h = clamp(Number(m[2]), 8, 150);
    commit({ w, h });
    s.fog = '0'.repeat(w * h).split('');
    await db.update(col('maps'), params.id, { fog: { ...(map.fog || {}), revealed: s.fog.join('') } }).catch(() => {});
    fit();
  };
  const exportPng = async () => {
    const d = s.doc;
    setBusy('png');
    await preloadMap(d, OBJ).catch(() => {});
    const cs = Math.max(16, Math.min(80, Math.floor(8000 / Math.max(d.w, d.h))));
    const cv = renderMapImage(d, cs, s.img);
    cv.toBlob((b) => { if (b) download(`${map.name || 'Karte'}.png`, b, 'image/png'); setBusy(''); }, 'image/png');
  };
  // Karte mit eigenen Objekten als Bild für die Mitspieler ablegen
  const bakeForPlayers = async (quiet) => {
    const d = s.doc;
    const own = [...new Set(d.objects.filter((o) => o.t === 'stamp' && String(o.a).startsWith('u:')).map((o) => String(o.a).slice(2)))];
    if (!own.length) {
      if (!quiet) toast('Diese Karte nutzt nur die eingebaute Bibliothek – Spieler sehen sie direkt.', 'success');
      return;
    }
    setBusy('bake');
    try {
      await ensureUserImages(own);
      await preloadMap(d, OBJ);
      const cs = clamp(Math.floor(3600 / Math.max(d.w, d.h)), 14, 64);
      const cv = renderMapImage(d, cs, s.img);
      const blob = await new Promise((ok) => cv.toBlob(ok, 'image/webp', 0.86)) || await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.85));
      const meta = await saveFile(cid, blob, { name: `${map.name || 'Karte'} (Spielerbild)`, folder: 'Karten', visibility: 'players', maxDim: 4200, kind: 'map', createdBy: me });
      const old = map.bake?.fileId;
      await db.update(col('maps'), params.id, { bake: { fileId: meta.id, at: now() } });
      if (old && old !== meta.id) deleteFile(cid, old).catch(() => {});
      if (!quiet) toast('Spielerbild gespeichert', 'success');
    } catch (e) {
      toast(`Spielerbild fehlgeschlagen: ${e.message}`, 'error');
    }
    setBusy('');
  };
  const traceImage = async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    const meta = await uploadImage(f, { folder: 'Karten', visibility: 'gm', maxDim: 3000 });
    await db.update(col('maps'), params.id, { fileId: meta.id });
    toast('Vorlage geladen – zeichne die Räume nach.', 'success');
  };
  const fogAll = (v) => {
    s.fog = new Array(s.doc.w * s.doc.h).fill(v);
    s.localFog = true;
    s.dirty = true;
    saveFog();
  };
  const addPartyTokens = async () => {
    const party = await loadParty();
    let i = 0;
    for (const p of party) {
      if ((tokensRaw || []).some((t) => t.charId === p.char.id)) continue;
      await db.add(col('tokens'), { mapId: params.id, x: 1 + (i % 4), y: 1 + Math.floor(i / 4), label: p.char.name, color: p.char.color || colorFromString(p.char.name), size: 1, ownerUid: p.owner, charId: p.char.id, visibility: 'players', createdAt: now() });
      i++;
    }
    toast(i ? `${i} Tokens gesetzt` : 'Keine (neuen) Charaktere gefunden', i ? 'success' : 'error');
  };
  const addCombatTokens = async () => {
    const stc = await loadCombat();
    let i = 0;
    for (const c of stc.combatants) {
      if (c.isPC || (tokensRaw || []).some((t) => t.combatantId === c.id)) continue;
      const n = c.statblock ? sizeCells(c.statblock) : 1;
      const art = c.statblock ? { icon: monsterIconName(c.statblock), color: creatureType(c.statblock.type).color } : null;
      await db.add(col('tokens'), { mapId: params.id, x: Math.max(0, s.doc.w - 1 - n - (i % 5)), y: 1 + Math.floor(i / 5) * n, label: c.name, color: art?.color || '#ef5a5f', size: n, ...(art ? { art } : {}), ownerUid: null, combatantId: c.id, visibility: c.hidden ? 'gm' : 'players', createdAt: now() });
      i++;
    }
    if (i) await mutateCombat((x) => { x.mapId = params.id; return x; }).catch(() => {});
    toast(i ? `${i} Gegner-Tokens gesetzt` : 'Keine Gegner im Kampf-Tracker', i ? 'success' : 'error');
  };
  const editToken = async (t) => {
    const r = await openModal(({ close }) => html`<${TokenForm} close=${close} token=${t} members=${Object.values(vault.get().members)} />`, { title: t.label, icon: 'user' });
    if (r?._delete) { await db.remove(col('tokens'), t.id); selectToken(B, null); } else if (r) await db.update(col('tokens'), t.id, { label: r.label, color: r.color, size: r.size, ownerUid: r.ownerUid || null, visibility: r.visibility });
  };
  const switchMode = (v) => {
    setMode(v);
    setTool(v === 'build' ? 'room' : 'pan');
    s.draft = null;
    s.measure = null;
    setMeasureText('');
    setSel(null);
    if (v === 'play' && gm && real && usesOwnAssets(s.doc) && (map.updatedAt || 0) > (map.bake?.at || 0)) bakeForPlayers(true);
  };

  const d = s.doc;
  const st = STYLES[d.style] || STYLES.klassisch;
  const tools = mode === 'build' ? BUILD_TOOLS : gm ? PLAY_TOOLS_GM : PLAY_TOOLS;
  const it = selItem();
  const itMeta = it && sel?.kind === 'obj' ? objMeta(it) : null;
  const drawTool = ['room', 'ellipse', 'poly', 'path', 'brush', 'terrain'].includes(tool);
  const actions = html`<div class="row nowrap" style="gap:2px">
    ${gm ? html`<${Segmented} value=${mode} onChange=${switchMode} options=${[{ value: 'build', label: 'Bauen', icon: 'hammer' }, { value: 'play', label: 'Spielen', icon: 'play' }]} />` : null}
    ${mode === 'build' ? html`<${IconBtn} icon="undo" title="Rückgängig (Strg+Z)" disabled=${!s.undo.length} onClick=${undo} />` : null}
    <${IconBtn} icon="maximize" title="Einpassen" onClick=${fit} />
    ${gm ? html`<${IconBtn} icon="panel-right" title="Seitenleiste" active=${side} onClick=${() => setSide(!side)} /><${IconBtn} icon="settings" title="Karteneinstellungen" onClick=${settingsDialog} />` : null}
  </div>`;

  return html`<${ViewFrame} tabId=${tabId} title=${map.name} noScroll actions=${actions}>
    <div class="map-stage scrawl" ref=${wrapRef} style=${{ background: st.bg }}>
      <canvas ref=${cvRef} class=${`tool-${tool}`}></canvas>
      <div class="map-toolbar">
        ${tools.map(([id, icon, label]) => html`<${IconBtn} key=${id} icon=${icon} title=${label} active=${tool === id} onClick=${() => { setTool(id); s.draft = null; if (id !== 'measure') { s.measure = null; setMeasureText(''); } s.dirty = true; }} />`)}
        ${mode === 'build' && drawTool ? html`<div class="sep"></div>
          <${IconBtn} icon="plus" title="Hinzufügen" active=${op === 'add'} onClick=${() => setOp('add')} />
          <${IconBtn} icon="eraser" title="Entfernen / ausschneiden" active=${op === 'sub'} onClick=${() => setOp('sub')} />` : null}
      </div>
      ${mode === 'play' && (B.sel || B.pending) ? null : html`<div class="map-hint">${s.draft && (s.draft.kind === 'poly' || s.draft.kind === 'path') ? html`<span>${HINTS[tool]}</span> <${Btn} size="sm" kind="primary" onClick=${() => s.finishDraft?.()}>Fertig<//> <${Btn} size="sm" kind="ghost" onClick=${() => { s.draft = null; s.dirty = true; rerender(); }}>Abbrechen<//>` : HINTS[tool]}</div>`}
      ${mode === 'play' ? html`<${BattleHud} B=${B} s=${s} editToken=${gm ? editToken : null} />` : null}
      ${measureText ? html`<div class="map-pop" style="left:60px;top:10px;width:auto"><${Icon} name="ruler" size=${14} /> <b>${measureText}</b></div>` : null}
      ${side && gm ? html`<div class="map-side stack scrawl-side">
        ${mode === 'build' ? html`
          ${drawTool ? html`<div class="stack sm">
            <b>${BUILD_TOOLS.find((x) => x[0] === tool)?.[2].replace(/ \(.\)$/, '')}</b>
            <${Segmented} value=${op} onChange=${setOp} options=${[{ value: 'add', label: 'Hinzufügen', icon: 'plus' }, { value: 'sub', label: 'Entfernen', icon: 'eraser' }]} />
            ${tool !== 'brush' && tool !== 'terrain' ? html`<div class="row small"><span class="muted">Einrasten</span><${Segmented} value=${snap} onChange=${setSnap} options=${[{ value: 'grid', label: 'Raster' }, { value: 'half', label: '½' }, { value: 'free', label: 'Frei' }]} /></div>` : null}
            ${tool === 'path' ? html`<div class="row small"><span class="muted">Gangbreite</span><${Segmented} value=${width} onChange=${setWidth} options=${[1, 2, 3].map((n) => ({ value: n, label: `${n}` }))} /></div>` : null}
            ${tool === 'brush' || tool === 'terrain' ? html`<div class="row small"><span class="muted" style="width:80px">Pinsel ${brushW}</span><input type="range" min="0.5" max="6" step="0.5" value=${brushW} style="flex:1;accent-color:var(--accent)" onInput=${(e) => setBrushW(Number(e.target.value))} /></div>` : null}
            ${real && tool !== 'terrain' ? html`<${TexBtn} label="Bodenbelag" value=${shapeTex || d.floorTex} cats=${['boden', 'pflaster']} onPick=${(v) => setShapeTex(v)} />
              ${shapeTex ? html`<button type="button" class="ws-link tiny" onClick=${() => setShapeTex('')}>→ Standard der Karte benutzen</button>` : null}` : null}
            ${tool === 'terrain' ? (real ? html`<div class="stack sm">
              <div class="chips">${terrainGroups().map((g, gi) => html`<button key=${g.label} type="button" class=${`chip${matCat === gi ? ' selected' : ''}`} onClick=${() => setMatCat(gi)}>${g.label}</button>`)}</div>
              <div class="tex-grid mini">${(terrainGroups()[matCat] || terrainGroups()[0]).items.map((i2) => html`<button key=${i2.key} type="button" class=${mat === i2.key ? 'active' : ''} title=${i2.label} onClick=${() => setMat(i2.key)}>
                ${i2.tex ? html`<img src=${texUrl(i2.tex, true)} alt="" loading="lazy" />` : html`<span class="sw" style=${{ background: i2.color }}></span>`}<span>${i2.label}</span></button>`)}</div></div>`
              : html`<div class="mat-pick">${Object.entries(MATS).map(([k, m2]) => html`<button type="button" class=${mat === k ? 'active' : ''} onClick=${() => setMat(k)} title=${m2.label}><span style=${{ background: k === 'difficult' ? 'repeating-linear-gradient(135deg,#7a5a2a 0 3px,transparent 3px 7px)' : m2.color }}></span>${m2.label}</button>`)}</div>`) : null}
            ${tool === 'terrain' ? html`<div class="row small"><span class="muted" style="width:80px">Übergang</span><input type="range" min="0" max="1" step="0.05" value=${d.soft ?? 0.3} style="flex:1;accent-color:var(--accent)" onInput=${(e) => commit({ soft: Number(e.target.value) }, { undo: false })} /></div>
              <div class="tiny faint">Tipp: Mit Strg ziehen = rechteckige Fläche.</div>` : null}
          </div>` : null}
          ${tool === 'wall' ? html`<div class="stack sm"><b>Zwischenwand</b>
            <div class="row small"><span class="muted" style="width:80px">Stärke</span><input type="range" min="0.15" max="0.8" step="0.05" value=${wallThick} style="flex:1;accent-color:var(--accent)" onInput=${(e) => setWallThick(Number(e.target.value))} /></div>
            <div class="tiny faint">Wände laufen auf den Rasterlinien und halten Bewegung, Sicht und Zauberflächen auf. Türen darauf setzen macht sie passierbar.</div>
          </div>` : null}
          ${tool === 'door' ? html`<div class="stack sm"><b>Türen</b><${AssetGrid} value=${doorKey} onPick=${setDoorKey} items=${DOOR_KEYS.map((k) => { const i2 = assetInfo(k); return { key: k, name: i2?.name || k, w: i2?.w || 1, h: i2?.h || 1 }; })} /></div>` : null}
          ${tool === 'object' ? html`<div class="stack sm">
            <${AssetPicker} value=${objKey} onPick=${setObjKey} />
            <div class="row small"><span class="muted" style="width:80px">Größe ${Math.round(objScale * 100) / 100}×</span><input type="range" min="0.2" max="4" step="0.05" value=${objScale} style="flex:1;accent-color:var(--accent)" onInput=${(e) => setObjScale(Number(e.target.value))} /></div>
            <${Toggle} checked=${objRandom} onChange=${setObjRandom} label="Zufällig drehen" />
          </div>` : null}
          ${tool === 'scatter' ? html`<div class="stack sm"><b>Streuen</b>
            <div class="chips">${Object.entries(SETS).map(([k, v]) => html`<button key=${k} type="button" class=${`chip${scatterSet === k ? ' selected' : ' suggest'}`} onClick=${() => setScatterSet(k)}>${v.label}</button>`)}</div>
            <div class="row small"><span class="muted" style="width:80px">Radius ${scatterR}</span><input type="range" min="0.5" max="6" step="0.5" value=${scatterR} style="flex:1;accent-color:var(--accent)" onInput=${(e) => setScatterR(Number(e.target.value))} /></div>
            <div class="row small"><span class="muted" style="width:80px">Dichte ${scatterN}</span><input type="range" min="1" max="12" step="1" value=${scatterN} style="flex:1;accent-color:var(--accent)" onInput=${(e) => setScatterN(Number(e.target.value))} /></div>
            <div class="row small"><span class="muted" style="width:80px">Größe ${Math.round(objScale * 100) / 100}×</span><input type="range" min="0.3" max="3" step="0.05" value=${objScale} style="flex:1;accent-color:var(--accent)" onInput=${(e) => setObjScale(Number(e.target.value))} /></div>
          </div>` : null}
          ${tool === 'light' ? html`<div class="stack sm"><b>Licht</b>
            <div class="mat-pick">${LIGHT_COLORS.map(([k, label, c]) => html`<button key=${k} type="button" class=${lightKind === k ? 'active' : ''} onClick=${() => setLightKind(k)}><span style=${{ background: c.replace(/[\d.]+\)$/, '1)') }}></span>${label}</button>`)}</div>
            <div class="row small"><span class="muted" style="width:80px">Radius ${lightR}</span><input type="range" min="1" max="20" step="0.5" value=${lightR} style="flex:1;accent-color:var(--accent)" onInput=${(e) => setLightR(Number(e.target.value))} /></div>
            <div class="row small"><span class="muted" style="width:80px">Dunkelheit</span><input type="range" min="0" max="0.9" step="0.05" value=${d.dark || 0} style="flex:1;accent-color:var(--accent)" onInput=${(e) => commit({ dark: Number(e.target.value) }, { undo: false, geom: false })} /></div>
            <${Toggle} checked=${showLight} onChange=${setShowLight} label="Licht beim Bauen zeigen" />
            <div class="tiny faint">Fackeln, Feuer und Zauberkreise leuchten von selbst. Im Spielmodus wird das Licht immer gezeigt.</div>
          </div>` : null}
          ${tool === 'text' ? html`<div class="stack sm"><b>Beschriftung</b><${Segmented} value=${textKind} onChange=${setTextKind} options=${[{ value: 'room', label: 'Raumnummer', icon: 'hash' }, { value: 'text', label: 'Text', icon: 'quote' }]} /></div>` : null}
          ${tool === 'select' ? html`<div class="stack sm">
            <b>Auswahl</b>
            ${!it ? html`<div class="small faint">Tippe ein Objekt, ein Licht, einen Text oder einen Raum an.</div>` : null}
            ${it && sel.kind === 'obj' ? html`<div class="small"><b>${itMeta?.name || 'Objekt'}</b> <span class="faint">${Math.round((itMeta?.w || 1) * 10) / 10} × ${Math.round((itMeta?.h || 1) * 10) / 10} Felder</span></div>
              <div class="btn-row"><${Btn} size="sm" icon="refresh" onClick=${() => rotateSel(90)}>90°<//><${Btn} size="sm" kind="ghost" onClick=${() => rotateSel(15)}>15°<//><${Btn} size="sm" kind="ghost" onClick=${flipSel}>Spiegeln<//></div>
              <div class="row small"><span class="muted" style="width:70px">Größe ${Math.round((it.s || 1) * 100) / 100}×</span><input type="range" min="0.1" max="4" step="0.05" value=${it.s || 1} style="flex:1;accent-color:var(--accent)" onInput=${(e) => updSel({ s: Number(e.target.value) })} /></div>
              <div class="row small"><span class="muted">Ebene</span><${Segmented} value=${it.layer || itMeta?.layer || 'obj'} onChange=${(v) => updSel({ layer: v })} options=${[{ value: 'floor', label: 'Boden' }, { value: 'obj', label: 'Normal' }, { value: 'top', label: 'Oben' }]} /></div>
              <${Toggle} checked=${it.sh !== false} onChange=${(v) => updSel({ sh: v })} label="Schlagschatten" />
              ${String(it.a || '').startsWith('u:') ? html`<div class="tiny faint">Eigenes Objekt – gilt für alle Vorkommen:</div>
                <${Toggle} checked=${!!userAssetInfo(String(it.a).slice(2))?.block} onChange=${(v) => { updateUserAsset(String(it.a).slice(2), { block: v, ...(v ? { rough: false } : {}) }); s.geom++; }} label="Blockiert (undurchdringlich)" />
                <${Toggle} checked=${!!userAssetInfo(String(it.a).slice(2))?.rough} onChange=${(v) => { updateUserAsset(String(it.a).slice(2), { rough: v }); s.geom++; }} label="Schwieriges Gelände" />` : null}` : null}
            ${it && sel.kind === 'light' ? html`<div class="small"><b>Lichtquelle</b></div>
              <div class="mat-pick">${LIGHT_COLORS.map(([k, label, c]) => html`<button key=${k} type="button" class=${it.color === c ? 'active' : ''} onClick=${() => updSel({ color: c })}><span style=${{ background: c.replace(/[\d.]+\)$/, '1)') }}></span>${label}</button>`)}</div>
              <div class="row small"><span class="muted" style="width:70px">Radius ${it.r || 4}</span><input type="range" min="1" max="20" step="0.5" value=${it.r || 4} style="flex:1;accent-color:var(--accent)" onInput=${(e) => updSel({ r: Number(e.target.value) })} /></div>
              <div class="row small"><span class="muted" style="width:70px">Stärke</span><input type="range" min="0.2" max="1.6" step="0.05" value=${it.i ?? 1} style="flex:1;accent-color:var(--accent)" onInput=${(e) => updSel({ i: Number(e.target.value) })} /></div>` : null}
            ${it && sel.kind === 'label' ? html`<${Field} label="Text"><input class="input" value=${it.text} onInput=${(e) => updSel({ text: e.target.value })} /><//>
              <div class="row small"><span class="muted" style="width:70px">Größe</span><input type="range" min="0.3" max="3" step="0.1" value=${it.size || 0.7} style="flex:1;accent-color:var(--accent)" onInput=${(e) => updSel({ size: Number(e.target.value) })} /></div>
              <${Field} label="Notiz verknüpfen (im Spielmodus antippbar)">${it.noteId && noteById(it.noteId) ? html`<span class="chip accent">${noteById(it.noteId).title}<span class="x" onClick=${() => updSel({ noteId: null })}><${Icon} name="x" size=${12} /></span></span>` : html`<${NotePicker} onPick=${(n) => updSel({ noteId: n.id })} />`}<//>` : null}
            ${it && (sel.kind === 'shape' || sel.kind === 'terrain') ? html`<div class="small"><b>${sel.kind === 'terrain' ? `Gelände: ${matLabel(it.mat)}` : it.wall ? 'Zwischenwand' : { rect: 'Raum', ellipse: 'Runder Raum', poly: 'Polygon', path: 'Gang', brush: 'Pinselstrich' }[it.kind]}</b></div>
              ${it.kind === 'path' || it.kind === 'brush' ? html`<div class="row small"><span class="muted" style="width:70px">Breite ${it.w}</span><input type="range" min="0.15" max="6" step="0.05" value=${it.w || 1} style="flex:1;accent-color:var(--accent)" onInput=${(e) => updSel({ w: Number(e.target.value) }, true)} /></div>` : null}
              ${sel.kind === 'shape' && real && !it.wall ? html`<${TexBtn} label="Bodenbelag" value=${it.tex || d.floorTex} cats=${['boden', 'pflaster']} onPick=${(v) => updSel({ tex: v }, true)} />
                <${Toggle} checked=${!it.nowall} onChange=${(v) => updSel({ nowall: v ? 0 : 1 }, true)} label="Mit Wand umranden" />
                <${TexBtn} label=${it.roof ? 'Dach' : 'Dach hinzufügen'} value=${it.roof || 'clay_roof_tiles'} cats=${['dach']} onPick=${(v) => updSel({ roof: v }, true)} />
                ${it.roof ? html`<button type="button" class="ws-link tiny" onClick=${() => updSel({ roof: '' }, true)}>→ Dach entfernen</button>` : null}` : null}
              ${sel.kind === 'terrain' ? (real ? html`<div class="tex-grid mini">${terrainGroups().flatMap((g) => g.items).map((i2) => html`<button key=${i2.key} type="button" class=${it.mat === i2.key ? 'active' : ''} title=${i2.label} onClick=${() => updSel({ mat: i2.key }, true)}>
                  ${i2.tex ? html`<img src=${texUrl(i2.tex, true)} alt="" loading="lazy" />` : html`<span class="sw" style=${{ background: i2.color }}></span>`}<span>${i2.label}</span></button>`)}</div>`
                : html`<${Select} value=${it.mat} onChange=${(v) => updSel({ mat: v }, true)} options=${Object.entries(MATS).map(([k, m2]) => ({ value: k, label: m2.label }))} />`) : null}` : null}
            ${it ? html`<div class="btn-row"><${Btn} size="sm" icon="copy" onClick=${duplicateSel}>Duplizieren<//><${Btn} size="sm" kind="danger" icon="trash" onClick=${deleteSel}>Löschen<//></div>` : null}
          </div>` : null}
          <details class="scrawl-sec" open=${tool === 'pan' || tool === 'select'}>
            <summary>Karte & Stil</summary>
            <div class="style-pick">${Object.entries(STYLES).map(([k, sv]) => html`<button type="button" class=${d.style === k ? 'active' : ''} onClick=${() => commit({ style: k })}>
              <span class="sw" style=${{ background: sv.real ? 'linear-gradient(135deg,#3f5a2c 0 45%,#9b8d79 45% 70%,#3a332c 70%)' : `linear-gradient(135deg, ${sv.bg} 0 45%, ${sv.floor} 45% 70%, ${sv.wall} 70%)` }}></span>${sv.label}</button>`)}</div>
            ${real ? html`
              <${Toggle} checked=${!!d.outdoor} onChange=${(v) => commit({ outdoor: v, ground: v ? 'leafy_grass' : 'dark_rock' })} label="Außenkarte (Untergrund sichtbar)" />
              <${TexBtn} label="Untergrund" value=${d.ground} cats=${['gelaende', 'pflaster', 'boden']} onPick=${(v) => commit({ ground: v })} />
              <${TexBtn} label="Standard-Boden" value=${d.floorTex} cats=${['boden', 'pflaster']} onPick=${(v) => commit({ floorTex: v })} />
              <${TexBtn} label="Wände" value=${d.wallTex} cats=${['wand']} onPick=${(v) => commit({ wallTex: v })} />
              <div class="row small"><span class="muted" style="width:90px">Wandstärke</span><input type="range" min="0.15" max="0.8" step="0.05" value=${d.wallW || (d.outdoor ? 0.32 : 0.42)} style="flex:1;accent-color:var(--accent)" onInput=${(e) => commit({ wallW: Number(e.target.value) }, { undo: false })} /></div>
              <div class="row small"><span class="muted" style="width:90px">Dunkelheit</span><input type="range" min="0" max="0.9" step="0.05" value=${d.dark || 0} style="flex:1;accent-color:var(--accent)" onInput=${(e) => commit({ dark: Number(e.target.value) }, { undo: false, geom: false })} /></div>
            ` : html`<div class="row small"><span class="muted" style="width:90px">Schraffur</span><input type="range" min="0" max="2.5" step="0.25" value=${d.hatch ?? 1} style="flex:1;accent-color:var(--accent)" onInput=${(e) => commit({ hatch: Number(e.target.value) }, { undo: false })} /></div>`}
            <${Toggle} checked=${d.gridOn !== false} onChange=${(v) => commit({ gridOn: v })} label="Raster zeigen" />
            <div class="row small"><span class="muted grow">Größe: ${d.w} × ${d.h} Felder</span><${Btn} size="sm" kind="ghost" onClick=${resize}>Ändern<//></div>
            <div class="row small"><${Btn} size="sm" icon="image" onClick=${traceImage}>${map.fileId ? 'Andere Vorlage' : 'Bild als Vorlage'}<//>
              ${map.fileId ? html`<input type="range" min="0" max="1" step="0.05" value=${d.bgAlpha ?? 0.5} title="Deckkraft der Vorlage" style="flex:1;accent-color:var(--accent)" onInput=${(e) => commit({ bgAlpha: Number(e.target.value) }, { undo: false })} />` : null}</div>
          </details>
          <details class="scrawl-sec">
            <summary>Generieren</summary>
            <div class="chips">${Object.entries(SCRAWL_GENERATORS).map(([k, g]) => html`<button type="button" class="chip suggest" onClick=${() => regenerate(k)}>${g.label}</button>`)}</div>
            <div class="tiny faint">Ersetzt die Karte – mit Strg+Z zurückholbar. Danach frei weiterbauen.</div>
          </details>
          <div class="btn-row"><${Btn} size="sm" icon="download" loading=${busy === 'png'} onClick=${exportPng}>PNG<//>
            ${real && usesOwnAssets(d) ? html`<${Btn} size="sm" icon="users" loading=${busy === 'bake'} onClick=${() => bakeForPlayers(false)}>Für Spieler backen<//>` : null}
            <${Btn} size="sm" kind="ghost" icon="undo" disabled=${!s.redo.length} onClick=${redo}>Wiederholen<//></div>
          ${real && usesOwnAssets(d) ? html`<div class="tiny faint">Diese Karte nutzt eigene Objekte. Sie liegen nur auf diesem Gerät – für die Mitspieler wird ein Kartenbild gespeichert (beim Wechsel in den Spielmodus automatisch).</div>` : null}
        ` : html`
          <b>Nebel des Krieges</b>
          <${Toggle} checked=${!!map.fog?.enabled} onChange=${(v) => db.update(col('maps'), params.id, { fog: { ...(map.fog || {}), revealed: s.fog.join(''), enabled: v } })} label="Nebel aktiv" />
          <div class="row small"><span class="muted">Pinsel</span><${Segmented} value=${fogBrush} onChange=${setFogBrush} options=${[{ value: 1, label: '1' }, { value: 2, label: '3' }, { value: 3, label: '5' }]} /></div>
          <div class="btn-row"><${Btn} size="sm" icon="eye" onClick=${() => fogAll('1')}>Alles aufdecken<//><${Btn} size="sm" icon="eye-off" onClick=${() => fogAll('0')}>Alles verdecken<//></div>
          <b>Tokens</b>
          <div class="btn-row"><${Btn} size="sm" icon="users" onClick=${addPartyTokens}>Gruppe<//><${Btn} size="sm" icon="sword" onClick=${addCombatTokens}>Gegner aus Kampf<//></div>
          <div class="tiny faint">Token antippen = Aktionen, Reichweiten & Bewegung · ziehen = bewegen · lange drücken oder Alt-Klick = Ping. Spieler bewegen ihre eigenen Tokens.</div>
          <${MonsterPlacer} B=${B} active=${tool === 'place'} onPick=${(m) => { B.placing = m; setTool('place'); s.dirty = true; }} onStop=${() => { B.placing = null; setTool('pan'); }} />
          <b>Kampf</b>
          <div class="btn-row">${!B.combat.active ? html`<${Btn} size="sm" kind="primary" icon="swords" onClick=${() => startCombat(B)}>Kampf starten<//>` : null}<${Btn} size="sm" kind="ghost" icon="eraser" onClick=${() => clearTemplates(B)}>Schablonen entfernen<//></div>
          <${Toggle} checked=${!!B.showNames} onChange=${(v) => { B.showNames = v; s.dirty = true; rerender(); }} label="Namen auf der Karte zeigen" />
        `}
      </div>` : null}
    </div>
  <//>`;
}
const usesOwnAssets = (d) => (d.objects || []).some((o) => o.t === 'stamp' && String(o.a).startsWith('u:'));


// Token-Formular (auch von maps.js genutzt)
export function TokenForm({ close, token, members }) {
  const COLORS = ['#e0b24a', '#ef5a5f', '#4d8dff', '#3dd68c', '#a78bfa', '#ff9a3c', '#2ec7c9', '#ff7ab6', '#9a9a9a'];
  const [f, setF] = useState({ label: '', color: '#e0b24a', size: 1, ownerUid: '', visibility: 'players', ...token });
  return html`<form onSubmit=${(e) => { e.preventDefault(); if (f.label.trim()) close(f); }}><div class="modal-body stack">
    <${Field} label="Name"><input class="input" value=${f.label} onInput=${(e) => setF({ ...f, label: e.target.value, color: token?.color || colorFromString(e.target.value) })} autoFocus /><//>
    <div class="grid two" style="gap:8px">
      <${Field} label="Größe"><${Select} value=${String(f.size)} onChange=${(v) => setF({ ...f, size: Number(v) })} options=${[{ value: '1', label: 'Klein/Mittelgroß (1 Feld)' }, { value: '2', label: 'Groß (2×2)' }, { value: '3', label: 'Riesig (3×3)' }, { value: '4', label: 'Gigantisch (4×4)' }]} /><//>
      <${Field} label="Darf bewegen"><${Select} value=${f.ownerUid || ''} onChange=${(v) => setF({ ...f, ownerUid: v })} options=${[{ value: '', label: 'Nur SL' }, ...members.map((m) => ({ value: m.uid, label: m.name }))]} /><//>
    </div>
    <${Field} label="Farbe"><div class="color-pick">${COLORS.map((c) => html`<button type="button" class=${f.color === c ? 'active' : ''} style=${{ background: c }} onClick=${() => setF({ ...f, color: c })}></button>`)}</div><//>
    <${Toggle} checked=${f.visibility !== 'players'} onChange=${(v) => setF({ ...f, visibility: v ? 'gm' : 'players' })} label="Vor Spielern verborgen" />
  </div><div class="modal-foot">${token?.id ? html`<${Btn} kind="danger" icon="trash" onClick=${() => close({ _delete: true })}>Entfernen<//><span class="grow"></span>` : null}<${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" type="submit">Speichern<//></div></form>`;
}
