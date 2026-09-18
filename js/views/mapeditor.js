// Kartenwerkstatt: Räume, Gänge, Höhlen und Außenkarten aufziehen – Wände, Böden und Raster entstehen automatisch.
// Der Stil „Realistisch“ malt mit echten Texturen und von oben gerenderten 3D-Objekten (Poly Haven, CC0, siehe
// js/views/maprender.js); eigene Pakete (z. B. Forgotten Adventures) lassen sich lokal importieren. Dazu Türen,
// Treppen, Licht, Gelände, Beschriftung, Generatoren, PNG-Export und ein Spielmodus mit Tokens, Nebel und Maßband.
import { html, useState, useEffect, useRef, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, vault, col, myUid, noteById } from '../core/app.js';
import { db } from '../core/db.js';
import { openNote, openView, ws, isMobile } from '../core/workspace.js';
import { setPanels, clearPanels } from '../core/panels.js';
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
import { TEX_MODS, splitTex } from '../data/texvars.js';
import {
  PROC, FLUIDS, assetInfo, assetThumb, texUrl, texThumb, fluidOf, preloadMap, onAssets, assetsVersion,
  renderReal, renderObjects, drawObjects, renderLighting, drawStampPreview, texName, REAL_INK,
} from './maprender.js';
import { STYLES, isReal, isImageMap, MATS, SETS, SCRAWL_GENERATORS, r2, rnd, pick, stampAt } from './mapgen.js';
import { userAssets, userAssetInfo, userThumb, importAssetFiles, deleteUserAssets, updateUserAsset, ensureUserImages } from '../core/userassets.js';

const PX = 40; // Bildschirm-Pixel pro Feld bei Zoom 1
const MAX_CACHE_PX = 7e6;
const REAL_CACHE_PX = 4.2e6;

export { STYLES, isReal, isImageMap, SETS, SCRAWL_GENERATORS };

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
  if (st.image) renderImageMap(target, m, cs, img, bake, opts);
  else if (st.real) renderReal(target, m, cs, { bg: img, bake, ...opts });
  else renderVector(target, m, cs, st, img);
}

// Bildkarte: fertiges Kartenbild, am erkannten Raster ausgerichtet
export function drawMapImage(ctx, m, src) {
  const f = m.bgFit;
  if (f && f.cell > 0) ctx.drawImage(src, -f.ox / f.cell, -f.oy / f.cell, src.width / f.cell, src.height / f.cell);
  else ctx.drawImage(src, 0, 0, m.w, m.h);
}
function renderImageMap(target, m, cs, img, bake, opts) {
  const pw = Math.max(1, Math.ceil(m.w * cs));
  const ph = Math.max(1, Math.ceil(m.h * cs));
  if (target.width !== pw || target.height !== ph) { target.width = pw; target.height = ph; }
  const ctx = target.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  ctx.fillStyle = '#0a0b0d';
  ctx.fillRect(0, 0, pw, ph);
  const src = bake || img;
  if (src) {
    ctx.setTransform(cs, 0, 0, cs, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    drawMapImage(ctx, m, src);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (opts && opts.maskCv) { opts.maskCv.width = 1; opts.maskCv.height = 1; }
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
  if (st.real || st.image) drawObjects(c, m, { legacyDefs: OBJ });
  else for (const o of m.objects || []) drawObject(c, o, st);
  c.setTransform(1, 0, 0, 1, 0, 0);
  if ((st.real || st.image) && lighting) {
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
  const baseShapes = d.style === 'bild' ? [{ id: 'bg', op: 'add', kind: 'rect', pts: [0, 0, W, H] }, ...(d.shapes || [])] : (d.shapes || []);
  if (baseShapes.some((s) => s.op !== 'sub')) {
    const cv = canvasOf('gridmask', W * R, H * R);
    const g = cv.getContext('2d');
    g.setTransform(R, 0, 0, R, 0, 0);
    for (const s of baseShapes) paintShape(g, s, '#fff');
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
    if (o.hidden) continue;
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
  const [mod, setMod] = useState(() => splitTex(value || '')[1] || '');
  const withMod = (id) => (mod ? id + '~' + mod : id);
  const list = TEXTURES.filter((t) => cats.includes(t.cat) && (cat === 'alle' || t.cat === cat));
  const labels = { boden: 'Böden', pflaster: 'Pflaster & Wege', gelaende: 'Gelände', wand: 'Wände', dach: 'Dächer' };
  return html`<div class="modal-body stack">
    <div class="chips">${['alle', ...cats].map((c) => html`<button key=${c} type="button" class=${`chip${cat === c ? ' selected' : ''}`} onClick=${() => setCat(c)}>${c === 'alle' ? 'Alle' : labels[c] || c}</button>`)}</div>
    <div class="chips">${[['', 'Original'], ...Object.entries(TEX_MODS).map(([k, m2]) => [k, m2.name])].map(([k, label]) => html`<button key=${k || 'orig'} type="button" class=${'chip' + (mod === k ? ' selected' : '')} onClick=${() => setMod(k)}>${label}</button>`)}</div>
    <div class="tex-grid">${list.map((t) => html`<button key=${t.id} type="button" class=${value === withMod(t.id) ? 'active' : ''} onClick=${() => close(withMod(t.id))} title=${t.name}>
      <img src=${texThumb(withMod(t.id))} alt="" loading="lazy" /><span>${t.name}</span>
    </button>`)}</div>
    <div class="tiny faint">Texturen von Poly Haven (CC0) · Spielarten werden beim Zeichnen berechnet und kosten keinen Speicher</div>
  </div>`;
}
const pickTexture = (cats, value) => openModal(({ close }) => html`<${TexPick} close=${close} value=${value} cats=${cats} />`, { title: 'Textur wählen', icon: 'image', size: 'lg' });
function TexBtn({ label, value, cats, onPick }) {
  return html`<button type="button" class="tex-btn" onClick=${async () => { const v = await pickTexture(cats, value); if (v) onPick(v); }}>
    <span class="tex-sw" style=${value ? { backgroundImage: 'url(' + texThumb(value) + ')' } : {}}></span>
    <span class="grow"><b>${label}</b><span class="tiny faint">${value ? texName(value) : 'wählen'}</span></span>
  </button>`;
}
function snapTo(v, mode, center) {
  if (mode === 'free') return r2(v);
  if (mode === 'half') return Math.round(v * 2) / 2;
  return center ? Math.floor(v) + 0.5 : Math.round(v);
}
// ───────────────────────── Werkzeugleiste & Bausteine der Seitenleiste ─────────────────────────
const LIGHT_COLORS = [
  ['warm', 'Fackel', 'rgba(255,170,80,.5)'],
  ['kerze', 'Kerze', 'rgba(255,200,120,.38)'],
  ['kalt', 'Mondlicht', 'rgba(150,190,255,.38)'],
  ['magie', 'Magie', 'rgba(170,120,255,.45)'],
  ['gift', 'Grünes Leuchten', 'rgba(120,255,140,.4)'],
  ['glut', 'Lava', 'rgba(255,110,40,.5)'],
];
const terrainGroups = (mod = '') => {
  const v = (id) => (mod ? id + '~' + mod : id);
  return [
    { label: 'Wasser, Lava & Gruben', items: Object.keys(FLUIDS).map((k) => { const o = fluidOf(v(k)); return { key: v(k), label: o.label, color: o.shallow }; }).concat([{ key: 'difficult', label: 'Schwieriges Gelände', color: 'repeating-linear-gradient(135deg,#7a5a2a 0 3px,transparent 3px 7px)' }]) },
    { label: 'Untergrund', items: TEXTURES.filter((t) => t.cat === 'gelaende').map((t) => ({ key: 'tex:' + v(t.id), label: t.name, tex: v(t.id) })) },
    { label: 'Wege & Pflaster', items: TEXTURES.filter((t) => t.cat === 'pflaster' || t.cat === 'boden').map((t) => ({ key: 'tex:' + v(t.id), label: t.name, tex: v(t.id) })) },
  ];
};
// Spielart in einem Belag-Schlüssel austauschen (tex:gras~dunkel → tex:gras~hell)
const reMod = (key, mod) => {
  const s = String(key);
  const pre = s.startsWith('tex:') ? 'tex:' : '';
  const base = splitTex(pre ? s.slice(4) : s)[0];
  if (base === 'difficult') return s;
  return pre + (mod ? base + '~' + mod : base);
};
const matLabel = (m) => (String(m).startsWith('tex:') ? texName(String(m).slice(4)) : fluidOf(m)?.label || MATS[m]?.label || m);

const BUILD_TOOLS = [
  ['select', 'pointer', 'Auswählen, bewegen, drehen, skalieren (V)', 'v'],
  ['land', 'layout', 'Land & Räume aufziehen (R)', 'r'],
  ['terrain', 'brush', 'Belag: Wasser, Gras, Wege … (T)', 't'],
  ['wall', 'minus', 'Zwischenwand ziehen (W)', 'w'],
  ['door', 'door', 'Tür an eine Wand setzen (D)', 'd'],
  ['object', 'gem', 'Objekte platzieren (O)', 'o'],
  ['scatter', 'sparkles', 'Streuen: Pflanzen, Steine, Trümmer (S)', 's'],
  ['light', 'sun', 'Licht setzen (L)', 'l'],
  ['text', 'hash', 'Raumnummern & Text (X)', 'x'],
  ['pan', 'hand', 'Ansicht verschieben (H)', 'h'],
];
const PLAY_TOOLS_GM = [['pan', 'hand', 'Bewegen & Tokens ziehen'], ['measure', 'ruler', 'Messen'], ['reveal', 'eye', 'Nebel aufdecken'], ['hide', 'eye-off', 'Nebel verdecken'], ['token', 'user-plus', 'Token setzen']];
const PLAY_TOOLS = [['pan', 'hand', 'Bewegen & eigene Tokens ziehen'], ['measure', 'ruler', 'Messen']];
// Formen für Land- und Belag-Werkzeug
const SHAPE_MODES = [
  ['rect', 'Rechteck', 'Ziehen = Rechteck aufziehen'],
  ['ellipse', 'Ellipse', 'Ziehen = Ellipse aufziehen'],
  ['circle', 'Kreis', 'Von der Mitte nach außen ziehen'],
  ['blob', 'Unregelmäßig', 'Von der Mitte ziehen – sternförmig mit unebenen Kanten'],
  ['poly', 'Polygon', 'Punkte setzen · Doppelklick/Enter = schließen'],
  ['path', 'Gang', 'Punkte setzen · Breite einstellbar'],
  ['brush', 'Pinsel', 'Frei malen'],
  ['cells', 'Felder', 'Feld für Feld malen (rastergenau)'],
  ['fill', 'Füllen', 'In eine Fläche tippen = ganzen Bereich füllen'],
];
const HINTS = {
  select: 'Tippen = auswählen · Umschalt/Strg = mehrere · Rahmen ziehen = Mehrfachauswahl · Ecken = skalieren, Griff oben = drehen · Entf = löschen',
  land: 'Form links wählen · Alt/Rechtsklick oder „Entfernen“ = ausschneiden · Umschalt = frei zeichnen',
  terrain: 'Belag wählen und malen · „Entfernen“ radiert · „Füllen“ füllt die ganze zusammenhängende Fläche',
  wall: 'Punkte auf den Rasterlinien setzen · Doppelklick/Enter = fertig · Türen darauf machen sie passierbar',
  door: 'Nahe einer Wand antippen – die Tür rastet an der Kante ein',
  object: 'Objekt links wählen, dann auf die Karte tippen · Umschalt+Mausrad dreht',
  scatter: 'Über die Karte ziehen – Pflanzen, Steine und Trümmer werden zufällig verteilt',
  light: 'Antippen = Lichtquelle setzen · Farbe und Radius links einstellen',
  text: 'Antippen = nächste Raumnummer bzw. Text setzen',
  pan: 'Ziehen = verschieben · Mausrad/zwei Finger = zoomen',
  place: 'Antippen = Monster setzen · Esc = fertig',
  measure: 'Ziehen = Entfernung messen',
  reveal: 'Über die Karte wischen = Nebel aufdecken',
  hide: 'Über die Karte wischen = Nebel verdecken',
  token: 'Antippen = Token setzen',
};

// Kleine Bausteine für die Werkstatt-Seitenleiste
function Sec({ title, icon, open = false, children }) {
  return html`<details class="mw-sec" open=${open}>
    <summary><${Icon} name=${icon} size=${14} />${title}</summary>
    <div class="mw-sec-body">${children}</div>
  </details>`;
}
function Slider({ label, value, min, max, step = 0.05, onInput, fmt }) {
  return html`<label class="mw-slider">
    <span class="mw-lbl">${label}<b>${fmt ? fmt(value) : value}</b></span>
    <input type="range" min=${min} max=${max} step=${step} value=${value} onInput=${(e) => onInput(Number(e.target.value))} />
  </label>`;
}
function Chips({ options, value, onPick }) {
  return html`<div class="chips">${options.map(([k, label, title]) => html`<button key=${k} type="button" title=${title || label} class=${`chip${value === k ? ' selected' : ' suggest'}`} onClick=${() => onPick(k)}>${label}</button>`)}</div>`;
}
function ToolGrid({ tools, tool, onPick }) {
  return html`<div class="mw-tools">${tools.map(([id, icon, label]) => html`<button key=${id} type="button" class=${`mw-tool${tool === id ? ' active' : ''}`} title=${label} onClick=${() => onPick(id)}>
    <${Icon} name=${icon} size=${17} /><span>${label.replace(/[:,].*$/, '').replace(/ \(.\)$/, '')}</span>
  </button>`)}</div>`;
}

// ───────────────────────── Ansicht ─────────────────────────
export function DungeonMapView({ map, params, active, tabId, settingsDialog }) {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const cid = useStore(app, (s) => s.cid);
  const role = useStore(app, (s) => s.role);
  const sidebarOpen = useStore(ws, (s) => s.leftOpen && !isMobile());
  const me = myUid();
  const tokOpts = role === 'gm' ? { where: [['mapId', '==', params.id]] } : { where: [['mapId', '==', params.id], ['visibility', '==', 'players']] };
  const tokensRaw = useCol(cid ? col('tokens') : null, tokOpts);
  const tokens = (tokensRaw || []).filter((t) => gm || t.visibility === 'players');
  const [mode, setMode] = useState(gm && !params.play ? 'build' : 'play');
  const [tool, setTool] = useState(gm && !params.play ? 'land' : 'pan');
  const [shape, setShape] = useState('rect');
  const [matShape, setMatShape] = useState('brush');
  const [op, setOp] = useState('add');
  const [snap, setSnap] = useState('grid');
  const [width, setWidth] = useState(1);
  const [brushW, setBrushW] = useState(2);
  const [wallThick, setWallThick] = useState(0.3);
  const [mat, setMat] = useState('water');
  const [matCat, setMatCat] = useState(0);
  const [matMod, setMatMod] = useState('');
  const [shapeTex, setShapeTex] = useState('');
  const [doorKey, setDoorKey] = useState('p:door');
  const [objKey, setObjKey] = useState('ph:treasure_chest');
  const [objScale, setObjScale] = useState(1);
  const [objRandom, setObjRandom] = useState(false);
  const [objAlpha, setObjAlpha] = useState(1);
  const [objBlur, setObjBlur] = useState(0);
  const [objShadow, setObjShadow] = useState(true);
  const [objLayer, setObjLayer] = useState('');
  const [scatterSet, setScatterSet] = useState('gras');
  const [scatterR, setScatterR] = useState(1.5);
  const [scatterN, setScatterN] = useState(3);
  const [lightKind, setLightKind] = useState('warm');
  const [lightR, setLightR] = useState(5);
  const [textKind, setTextKind] = useState('room');
  const [fogBrush, setFogBrush] = useState(2);
  const [sel, setSel] = useState([]);
  const [showLight, setShowLight] = useState(true);
  const [layerQ, setLayerQ] = useState('');
  const [lDrag, setLDrag] = useState({ id: null, over: null, zone: null });   // Ebenenliste: Ziehen & Ablegen
  const [measureText, setMeasureText] = useState('');
  const [busy, setBusy] = useState('');
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
      geom: 0, ver: 0, img: null, bakeImg: null, undo: [], redo: [], localDirty: false, placeRot: 0, skipIds: null,
      doc: null, draft: null, fog: null,
    };
  }
  const s = S.current;
  Object.assign(s, {
    gm, me, mode, tool, shape, matShape, op, snap, width, brushW, wallThick, mat, shapeTex, doorKey, objKey,
    objScale, objRandom, objAlpha, objBlur, objShadow, objLayer, scatterSet, scatterR, scatterN, lightKind, lightR,
    textKind, fogBrush, sel, showLight, tokens,
  });

  const pickDoc = (m) => ({
    w: m.w || 36, h: m.h || 26, style: m.style || 'klassisch', gridOn: m.gridOn !== false, hatch: m.hatch ?? 1, bgAlpha: m.bgAlpha ?? 0.5,
    outdoor: !!m.outdoor, ground: m.ground || (m.outdoor ? 'leafy_grass' : 'dark_rock'), floorTex: m.floorTex || 'stone_tiles', wallTex: m.wallTex || 'castle_brick_01',
    wallW: m.wallW || 0, dark: m.dark || 0, soft: m.soft ?? 0.3, roofs: m.roofs !== false,
    shapes: m.shapes || [], terrain: m.terrain || [], objects: m.objects || [], labels: m.labels || [], lights: m.lights || [],
    ...(m.bgFit ? { bgFit: m.bgFit } : {}),
  });
  if (!s.doc) s.doc = pickDoc(map);
  s.fogOn = !!map.fog?.enabled;
  const real = isReal(s.doc);
  const imageMap = isImageMap(s.doc);
  const rich = real || imageMap;
  const grid = useMemo(() => buildGrid(s.doc), [s.geom, s.doc.w, s.doc.h]);
  const B = useBattle({ cid, mapId: params.id, gm, me, tokens, grid, gridKey: s.geom, redraw: () => { s.dirty = true; }, rerender });
  s.B = B;
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
  // Bildkarten kennen kein Land/Belag – dann auf Auswählen wechseln
  useEffect(() => {
    if (isImageMap(s.doc) && (tool === 'land' || tool === 'terrain')) setTool('select');
  }, [tool, s.geom]);
  useEffect(() => {
    if (gm || mode === 'play') return;
    setMode('play');
    setTool('pan');
    setSel([]);
    s.draft = null;
    s.dirty = true;
  }, [gm]);
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
  const jump = (from, to) => {
    if (!from.length) return;
    to.push(JSON.stringify(s.doc));
    s.doc = JSON.parse(from.pop());
    s.geom++;
    s.ver++;
    s.localDirty = true;
    s.dirty = true;
    setSel([]);
    save();
    rerender();
  };
  const undo = () => jump(s.undo, s.redo);
  const redo = () => jump(s.redo, s.undo);

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
  const focusOn = (x, y) => {
    const k = s.t.k * PX;
    s.t.x = s.w / 2 - x * k;
    s.t.y = s.h / 2 - y * k;
    s.clampView();
    s.userMoved = true;
    s.dirty = true;
  };

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

  // ── Auswahl & Verwandlung ──
  const listOf = (kind) => ({ obj: 'objects', label: 'labels', shape: 'shapes', terrain: 'terrain', light: 'lights' }[kind]);
  const itemsOf = (kind) => (s.doc[listOf(kind)] || []);
  const selOf = (kind) => sel.filter((x) => x.kind === kind).map((x) => itemsOf(kind).find((o) => o.id === x.id)).filter(Boolean);
  const selObjs = () => selOf('obj');
  const isSel = (id) => sel.some((x) => x.id === id);
  const only = sel.length === 1 ? sel[0] : null;
  const onlyItem = only ? itemsOf(only.kind).find((x) => x.id === only.id) : null;
  s.selBox = () => {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
    for (const o of selObjs()) {
      const m = objMeta(o);
      if (!m) continue;
      const a = ((o.r || 0) * Math.PI) / 180;
      const c = Math.cos(a);
      const si = Math.sin(a);
      for (const [dx, dy] of [[-m.w / 2, -m.h / 2], [m.w / 2, -m.h / 2], [m.w / 2, m.h / 2], [-m.w / 2, m.h / 2]]) add(o.x + dx * c - dy * si, o.y + dx * si + dy * c);
    }
    for (const l of selOf('light')) add(l.x, l.y);
    if (x0 > x1) return null;
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  };
  const applyTransform = (orig, t) => {
    const ids = new Set(sel.filter((x) => x.kind === 'obj').map((x) => x.id));
    const lids = new Set(sel.filter((x) => x.kind === 'light').map((x) => x.id));
    const tf = (x, y) => {
      let px = x - (t.cx || 0);
      let py = y - (t.cy || 0);
      if (t.scale) { px *= t.scale; py *= t.scale; }
      if (t.rot) {
        const a = (t.rot * Math.PI) / 180;
        const c = Math.cos(a);
        const si = Math.sin(a);
        [px, py] = [px * c - py * si, px * si + py * c];
      }
      return [r2(px + (t.cx || 0) + (t.dx || 0)), r2(py + (t.cy || 0) + (t.dy || 0))];
    };
    const objects = orig.objects.map((o) => {
      if (!ids.has(o.id)) return o;
      const [x, y] = tf(o.x, o.y);
      const n = { ...o, x, y };
      if (t.scale) n.s = r2(clamp((o.s || 1) * t.scale, 0.05, 12));
      if (t.rot) n.r = Math.round(((((o.r || 0) + t.rot) % 360) + 360) % 360);
      return n;
    });
    const lights = (orig.lights || []).map((l) => {
      if (!lids.has(l.id)) return l;
      const [x, y] = tf(l.x, l.y);
      return { ...l, x, y, ...(t.scale ? { r: r2(clamp((l.r || 4) * t.scale, 0.5, 40)) } : {}) };
    });
    const labels = (orig.labels || []).map((l) => {
      if (!sel.some((x) => x.kind === 'label' && x.id === l.id)) return l;
      const [x, y] = tf(l.x, l.y);
      return { ...l, x, y };
    });
    s.doc = { ...s.doc, objects, lights, labels };
    s.ver++;
    s.dirty = true;
  };
  const updSel = (patch, geom = false) => {
    if (!sel.length) return;
    const byKind = {};
    for (const x of sel) (byKind[x.kind] ||= new Set()).add(x.id);
    const next = {};
    for (const kind of Object.keys(byKind)) {
      const key = listOf(kind);
      next[key] = (s.doc[key] || []).map((x) => (byKind[kind].has(x.id) ? { ...x, ...patch } : x));
    }
    commit(next, { geom: geom || !!byKind.shape || !!byKind.terrain });
  };
  function deleteSel() {
    if (!s.sel.length) return;
    const byKind = {};
    for (const x of s.sel) (byKind[x.kind] ||= new Set()).add(x.id);
    const next = {};
    for (const kind of Object.keys(byKind)) {
      const key = listOf(kind);
      next[key] = (s.doc[key] || []).filter((x) => !byKind[kind].has(x.id));
    }
    commit(next, { geom: !!byKind.shape || !!byKind.terrain });
    setSel([]);
  }
  function rotateSel(deg) {
    const box = s.selBox();
    if (!box) return;
    s.undo.push(JSON.stringify(s.doc));
    s.redo = [];
    applyTransform(JSON.parse(JSON.stringify(s.doc)), { rot: deg, cx: box.cx, cy: box.cy });
    s.editSeq = (s.editSeq || 0) + 1;
    s.localDirty = true;
    save();
    rerender();
  }
  function scaleSel(f) {
    const box = s.selBox();
    if (!box) return;
    s.undo.push(JSON.stringify(s.doc));
    s.redo = [];
    applyTransform(JSON.parse(JSON.stringify(s.doc)), { scale: f, cx: box.cx, cy: box.cy });
    s.editSeq = (s.editSeq || 0) + 1;
    s.localDirty = true;
    save();
    rerender();
  }
  const flipSel = () => updSel({ fx: selObjs()[0]?.fx ? 0 : 1 });
  function duplicateSel() {
    if (!sel.length) return;
    const add = { objects: [...s.doc.objects], lights: [...(s.doc.lights || [])], labels: [...s.doc.labels], shapes: [...s.doc.shapes], terrain: [...s.doc.terrain] };
    const next = [];
    for (const x of sel) {
      const it = itemsOf(x.kind).find((o) => o.id === x.id);
      if (!it) continue;
      const copy = { ...JSON.parse(JSON.stringify(it)), id: uid(6) };
      if (copy.pts) copy.pts = copy.pts.map((v, i) => r2(v + (copy.kind === 'cells' ? (i % 2 ? 1 : 1) : 1)));
      else { copy.x = r2(copy.x + 1); copy.y = r2(copy.y + 1); }
      add[listOf(x.kind)].push(copy);
      next.push({ kind: x.kind, id: copy.id });
    }
    commit(add, { geom: sel.some((x) => x.kind === 'shape' || x.kind === 'terrain') });
    setSel(next);
  }

  // ── Zeichenschleife ──
  useEffect(() => {
    if (!active) return undefined;
    let raf;
    let settleT = 0;
    const loop = (t) => {
      const d = s.doc;
      const st = STYLES[d.style] || STYLES.klassisch;
      s.real = !!st.real;
      s.imageMap = !!st.image;
      s.rich = s.real || s.imageMap;
      s.useBake = !s.gm && !!s.bakeImg && usesOwnAssets(d);
      const aver = assetsVersion();
      const want = clamp(2 ** Math.ceil(Math.log2(Math.max(8, s.t.k * PX * s.dpr))), 12, s.real ? 96 : 64);
      const maxCs = Math.sqrt((s.real ? REAL_CACHE_PX : MAX_CACHE_PX) / Math.max(1, d.w * d.h));
      const cs = Math.max(6, Math.min(want, maxCs));
      const busyDraw = s.act && ['move', 'brush', 'drag', 'scatter', 'scale', 'rotate', 'cells'].includes(s.act.kind);
      const csStatic = busyDraw ? Math.min(cs, 26) : cs;
      const key = `${s.geom}|${csStatic}|${d.style}|${aver}|${s.useBake ? 'b' : ''}`;
      if (key !== s.cacheKey && (t - settleT > 120 || !s.cacheKey.startsWith(`${s.geom}|`)) && (!busyDraw || t - (s.lastStatic || 0) > 140)) {
        s.maskCv = s.maskCv || document.createElement('canvas');
        renderStatic(s.cache, d, csStatic, st, s.img, s.useBake ? s.bakeImg : null, { grid: false, maskCv: s.maskCv });
        s.cacheKey = key;
        s.lastStatic = t;
        s.dirty = true;
      }
      if (s.rich && !s.useBake) {
        s.live = s.t.k * PX * s.dpr > cs * 1.45;
        if (s.live && s.real && !busyDraw && t - (s.lastDetail || 0) > 120) {
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
        const skipKey = s.skipIds ? [...s.skipIds].join(',') : '';
        const ok = `${s.ver}|${cs}|${aver}|${skipKey}`;
        if (!s.live && ok !== s.objKeyC && (t - settleT > 120 || !s.objKeyC.startsWith(`${s.ver}|`)) && (!busyDraw || t - (s.lastObj || 0) > 150)) {
          renderObjects(s.objCache, d, cs, { legacyDefs: OBJ, skip: s.skipIds });
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
    for (const [off, colr] of [[lw, 'rgba(255,255,255,.16)'], [0, d.outdoor ? 'rgba(0,0,0,.32)' : 'rgba(0,0,0,.45)']]) {
      g.strokeStyle = colr;
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
    // Bildkarte: das Bild immer in voller Auflösung zeichnen (scharf in jeder Zoomstufe)
    if (s.imageMap && !s.useBake && s.img) drawMapImage(ctx, d, s.img);
    if (s.rich && !s.useBake && d.gridOn !== false) drawGrid(ctx, s, d, k);
    if (s.mode === 'build') {
      ctx.strokeStyle = 'rgba(120,120,120,.5)';
      ctx.lineWidth = 1 / k;
      ctx.setLineDash([6 / k, 5 / k]);
      ctx.strokeRect(0, 0, d.w, d.h);
      ctx.setLineDash([]);
    }
    if (s.rich && !s.useBake) {
      if (s.live) {
        const view = { x0: -s.t.x / k, y0: -s.t.y / k, x1: (s.w - s.t.x) / k, y1: (s.h - s.t.y) / k };
        drawObjects(ctx, d, { legacyDefs: OBJ, skip: s.skipIds, view });
      } else ctx.drawImage(s.objCache, 0, 0, d.w, d.h);
      if (s.skipIds) for (const o of d.objects) if (s.skipIds.has(o.id)) drawStampPreview(ctx, o, OBJ, 1);
      const lightOn = s.mode === 'play' || s.showLight;
      if (s.lightOn?.dark && lightOn) ctx.drawImage(s.darkCv, 0, 0, d.w, d.h);
      if (s.lightOn?.glow && lightOn) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(s.glowCv, 0, 0, d.w, d.h);
        ctx.globalCompositeOperation = 'source-over';
      }
    } else if (!s.useBake) {
      for (const o of d.objects) if (!o.hidden) drawObject(ctx, o, st);
    }
    for (const l of d.labels) drawLabel(ctx, l, st);
    if (s.mode === 'build' && s.rich) {
      for (const l of d.lights || []) {
        circ(ctx, l.x, l.y, 0.16, 'rgba(255,225,170,.95)', 'rgba(0,0,0,.65)', 0.04);
        if (isSel(l.id)) {
          ctx.setLineDash([0.2, 0.15]);
          circ(ctx, l.x, l.y, l.r || 4, null, '#f5c542', 0.05);
          ctx.setLineDash([]);
        }
      }
    }
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
    // Bildkarte: unsichtbare Wände beim Bauen zeigen
    if (s.imageMap && s.mode === 'build') {
      ctx.save();
      ctx.strokeStyle = 'rgba(229,72,77,.8)';
      ctx.fillStyle = 'rgba(229,72,77,.22)';
      for (const sh of d.shapes || []) {
        if (sh.op !== 'sub') continue;
        tracePath(ctx, sh);
        if (sh.kind === 'path' || sh.kind === 'brush') {
          ctx.lineWidth = sh.w || 0.3;
          ctx.lineCap = 'round';
          ctx.stroke();
        } else ctx.fill();
      }
      ctx.restore();
    }
    // Auswahl: Umrisse, Rahmen mit Griffen
    if (s.mode === 'build' && s.sel.length) {
      ctx.strokeStyle = '#8a5cf5';
      ctx.lineWidth = 2 / k;
      ctx.setLineDash([5 / k, 4 / k]);
      for (const x of s.sel) {
        const it = (d[listOf(x.kind)] || []).find((o) => o.id === x.id);
        if (!it) continue;
        if (x.kind === 'obj') {
          const m = objMeta(it);
          if (!m) continue;
          ctx.save();
          ctx.translate(it.x, it.y);
          ctx.rotate(((it.r || 0) * Math.PI) / 180);
          ctx.strokeRect(-m.w / 2 - 0.05, -m.h / 2 - 0.05, m.w + 0.1, m.h + 0.1);
          ctx.restore();
        } else if (x.kind === 'label') ctx.strokeRect(it.x - (it.size || 0.7), it.y - (it.size || 0.7) * 0.7, (it.size || 0.7) * 2, (it.size || 0.7) * 1.4);
        else if (x.kind === 'light') ctx.strokeRect(it.x - 0.3, it.y - 0.3, 0.6, 0.6);
        else {
          tracePath(ctx, it);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      const box = s.selBox();
      if (box) {
        const pad = 0.12;
        ctx.strokeStyle = 'rgba(138,92,245,.95)';
        ctx.lineWidth = 1.5 / k;
        ctx.strokeRect(box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + pad * 2, box.y1 - box.y0 + pad * 2);
        const rh = 22 / k;
        ctx.beginPath();
        ctx.moveTo(box.cx, box.y0 - pad);
        ctx.lineTo(box.cx, box.y0 - pad - rh);
        ctx.stroke();
        for (const [hx, hy] of [[box.x0 - pad, box.y0 - pad], [box.x1 + pad, box.y0 - pad], [box.x1 + pad, box.y1 + pad], [box.x0 - pad, box.y1 + pad]]) {
          circ(ctx, hx, hy, 5 / k, '#fff', '#8a5cf5', 2 / k);
        }
        circ(ctx, box.cx, box.y0 - pad - rh, 6 / k, '#8a5cf5', '#fff', 2 / k);
      }
    }
    // Vorschau des aktuellen Werkzeugs
    const dr = s.draft;
    if (dr) {
      const sub = dr.op === 'sub';
      ctx.fillStyle = sub ? 'rgba(229,72,77,.25)' : 'rgba(138,92,245,.22)';
      ctx.strokeStyle = sub ? '#e5484d' : '#8a5cf5';
      ctx.lineWidth = 2 / k;
      if (dr.kind === 'cells') {
        tracePath(ctx, dr);
        ctx.fill();
        ctx.stroke();
      } else if (dr.kind === 'rect' || dr.kind === 'ellipse') {
        tracePath(ctx, dr);
        ctx.fill();
        ctx.stroke();
        const [x1, y1, x2, y2] = dr.pts;
        utext(ctx, `${r2(Math.abs(x2 - x1))} × ${r2(Math.abs(y2 - y1))}`, (x1 + x2) / 2, Math.min(y1, y2) - 0.4, 0.45, '#8a5cf5', '#fff');
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
    if (s.marquee) {
      const { a, b } = s.marquee;
      ctx.fillStyle = 'rgba(138,92,245,.15)';
      ctx.strokeStyle = '#8a5cf5';
      ctx.lineWidth = 1.5 / k;
      ctx.setLineDash([5 / k, 4 / k]);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.setLineDash([]);
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
      const rel = k / s.t.k;
      s.t.x = p.x - (p.x - s.t.x) * rel;
      s.t.y = p.y - (p.y - s.t.y) * rel;
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
      const rr = s.objRandom ? randInt(0, 359) : s.placeRot;
      const m = snapMode(e);
      const base2 = { id: 'hover', t: 'stamp', a: key, r: rr, s: sc };
      if (s.objAlpha < 1) base2.o = r2(s.objAlpha);
      if (s.objBlur > 0) base2.b = r2(s.objBlur);
      if (!s.objShadow) base2.sh = false;
      if (s.objLayer) base2.layer = s.objLayer;
      if (m === 'free' || ow < 0.9 || oh < 0.9 || s.objRandom) return { ...base2, x: r2(w.x), y: r2(w.y) };
      const near = (v, size) => (Math.round(size) % 2 ? Math.floor(v) + 0.5 : Math.round(v));
      return { ...base2, x: near(w.x, ow), y: near(w.y, oh) };
    };
    const hitAny = (w) => {
      const d = s.doc;
      for (let i = d.labels.length - 1; i >= 0; i--) if (Math.hypot(d.labels[i].x - w.x, d.labels[i].y - w.y) < (d.labels[i].size || 0.7)) return { kind: 'label', id: d.labels[i].id };
      for (let i = (d.lights || []).length - 1; i >= 0; i--) if (Math.hypot(d.lights[i].x - w.x, d.lights[i].y - w.y) < 0.35) return { kind: 'light', id: d.lights[i].id };
      for (let i = d.objects.length - 1; i >= 0; i--) if (!d.objects[i].hidden && objHit(d.objects[i], w.x, w.y)) return { kind: 'obj', id: d.objects[i].id };
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
    const scatterPaint = (w, first) => {
      const set = SETS[s.scatterSet];
      if (!set?.keys.length) return;
      const tn = performance.now();
      if (!first && tn - (s.lastScatter || 0) < 90) return;
      if (!first && Math.hypot(w.x - (s.lastScatterAt?.x ?? -99), w.y - (s.lastScatterAt?.y ?? -99)) < s.scatterR * 0.6) return;
      s.lastScatter = tn;
      s.lastScatterAt = { x: w.x, y: w.y };
      const add = [];
      for (let i = 0; i < s.scatterN; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * s.scatterR;
        const x = w.x + Math.cos(a) * rr;
        const y = w.y + Math.sin(a) * rr;
        if (x < 0 || y < 0 || x > s.doc.w || y > s.doc.h) continue;
        const o = stampAt(pick(set.keys), x, y, { r: randInt(0, 359), s: rnd(set.s[0], set.s[1]) * s.objScale, fx: Math.random() < 0.5 });
        if (s.objAlpha < 1) o.o = r2(s.objAlpha);
        if (!s.objShadow) o.sh = false;
        add.push(o);
      }
      if (!add.length) return;
      s.doc = { ...s.doc, objects: [...s.doc.objects, ...add] };
      s.ver++;
      s.localDirty = true;
      s.dirty = true;
    };
    // Eimer: zusammenhängende Felder ab dem angetippten Feld (Wände halten auf)
    const flood = (sx, sy, want) => {
      const d = s.doc;
      const W = d.w;
      const H = d.h;
      const g = grid;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) return [];
      const at = (i) => (g.walk[i] ? 1 : 0);
      if (at(sy * W + sx) !== want) return [];
      const seen = new Uint8Array(W * H);
      const out = [];
      const st2 = [[sx, sy]];
      while (st2.length && out.length < 12000) {
        const [x, y] = st2.pop();
        const i = y * W + x;
        if (seen[i] || at(i) !== want) continue;
        seen[i] = 1;
        out.push(x, y);
        if (x > 0 && !g.wallE[y * W + x - 1]) st2.push([x - 1, y]);
        if (x < W - 1 && !g.wallE[i]) st2.push([x + 1, y]);
        if (y > 0 && !g.wallS[(y - 1) * W + x]) st2.push([x, y - 1]);
        if (y < H - 1 && !g.wallS[i]) st2.push([x, y + 1]);
      }
      return out;
    };
    const blobPts = (cx, cy, rx, ry) => {
      const out = [];
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const f = (i % 2 ? 0.7 : 1) * (0.86 + Math.random() * 0.28);
        out.push(r2(cx + Math.cos(a) * rx * f), r2(cy + Math.sin(a) * ry * f));
      }
      return out;
    };
    const finishDraft = () => {
      const dr = s.draft;
      s.draft = null;
      if (!dr) return;
      if ((dr.kind === 'poly' && dr.pts.length < 6) || ((dr.kind === 'path' || dr.kind === 'brush') && dr.pts.length < 2) || (dr.kind === 'cells' && !dr.pts.length)) { s.dirty = true; return; }
      let item;
      if (dr.mode === 'blob') {
        const [x1, y1, x2, y2] = dr.pts;
        item = { id: uid(6), op: dr.op, kind: 'poly', pts: blobPts((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2) };
      } else {
        item = { id: uid(6), op: dr.op, kind: dr.kind, pts: dr.kind === 'brush' ? simplify(dr.pts, 0.06) : dr.pts.map(r2) };
        if (dr.kind === 'path' || dr.kind === 'brush') item.w = dr.w;
      }
      if (dr.wall) item.wall = 1;
      if (dr.terrain) commit({ terrain: [...s.doc.terrain, { ...item, mat: dr.mat }] });
      else {
        if (dr.tex && dr.op !== 'sub') item.tex = dr.tex;
        commit({ shapes: [...s.doc.shapes, item] });
      }
    };
    s.finishDraft = finishDraft;

    // Griffe der Auswahl (drehen/skalieren) treffen?
    const handleHit = (w, k) => {
      const box = s.selBox();
      if (!box || !s.sel.length) return null;
      const pad = 0.12;
      const tol = 10 / k;
      const rh = 22 / k;
      if (Math.hypot(w.x - box.cx, w.y - (box.y0 - pad - rh)) < tol) return { kind: 'rotate', box };
      const corners = [[box.x0 - pad, box.y0 - pad], [box.x1 + pad, box.y0 - pad], [box.x1 + pad, box.y1 + pad], [box.x0 - pad, box.y1 + pad]];
      for (const [hx, hy] of corners) if (Math.hypot(w.x - hx, w.y - hy) < tol) return { kind: 'scale', box };
      if (s.sel.length > 1 && w.x > box.x0 - pad && w.x < box.x1 + pad && w.y > box.y0 - pad && w.y < box.y1 + pad) return { kind: 'boxmove', box };
      return null;
    };

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
      const k = s.t.k * PX;
      const tl = s.tool;
      const sub = s.op === 'sub' || e.altKey || e.button === 2;
      if (e.button === 1 || (e.button === 2 && !['land', 'terrain'].includes(tl)) || (tl === 'pan' && s.mode === 'build')) {
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
      // ── Bauen ──
      if (tl === 'select') {
        const h2 = handleHit(w, k);
        if (h2) {
          s.undo.push(JSON.stringify(s.doc));
          s.redo = [];
          const orig = JSON.parse(JSON.stringify(s.doc));
          s.skipIds = new Set(s.sel.filter((x) => x.kind === 'obj').map((x) => x.id));
          if (h2.kind === 'rotate') s.act = { kind: 'rotate', box: h2.box, orig, a0: Math.atan2(w.y - h2.box.cy, w.x - h2.box.cx), moved: false };
          else if (h2.kind === 'scale') s.act = { kind: 'scale', box: h2.box, orig, d0: Math.max(0.1, Math.hypot(w.x - h2.box.cx, w.y - h2.box.cy)), moved: false };
          else s.act = { kind: 'move', h: null, start: w, orig, moved: false };
          s.dirty = true;
          return;
        }
        const h = hitAny(w);
        const multi = e.shiftKey || e.ctrlKey || e.metaKey;
        if (h) {
          let next = s.sel;
          if (multi) next = isSel(h.id) ? s.sel.filter((x) => x.id !== h.id) : [...s.sel, h];
          else if (!isSel(h.id)) next = [h];
          setSel(next);
          s.sel = next;
          s.undo.push(JSON.stringify(s.doc));
          s.skipIds = new Set(next.filter((x) => x.kind === 'obj').map((x) => x.id));
          s.act = { kind: 'move', h, start: w, orig: JSON.parse(JSON.stringify(s.doc)), moved: false };
        } else if (multi) {
          s.act = { kind: 'marquee', a: w, add: true };
          s.marquee = { a: w, b: w };
        } else {
          s.act = { kind: 'marquee', a: w, add: false };
          s.marquee = { a: w, b: w };
        }
        s.dirty = true;
        return;
      }
      if (tl === 'land' || tl === 'terrain') {
        const terrain = tl === 'terrain';
        const sm = terrain ? s.matShape : s.shape;
        const common = { op: sub ? 'sub' : 'add', terrain, mat: s.mat, tex: s.shapeTex };
        if (sm === 'fill') {
          const cells = flood(Math.floor(w.x), Math.floor(w.y), terrain ? 1 : 0);
          if (!cells.length) { toast(terrain ? 'Hier ist kein Boden zum Füllen.' : 'Hier ist schon Land.', 'error'); return; }
          const item = { id: uid(6), op: sub ? 'sub' : 'add', kind: 'cells', pts: cells };
          if (terrain) commit({ terrain: [...s.doc.terrain, { ...item, mat: s.mat }] });
          else commit({ shapes: [...s.doc.shapes, { ...item, ...(s.shapeTex ? { tex: s.shapeTex } : {}) }] });
          return;
        }
        if (sm === 'cells') {
          s.draft = { ...common, kind: 'cells', pts: [], seen: new Set() };
          s.act = { kind: 'cells' };
          const x = Math.floor(w.x);
          const y = Math.floor(w.y);
          s.draft.seen.add(`${x},${y}`);
          s.draft.pts.push(x, y);
          s.dirty = true;
          return;
        }
        if (sm === 'rect' || sm === 'ellipse' || sm === 'circle' || sm === 'blob') {
          const m = snapMode(e);
          const x = snapTo(w.x, m);
          const y = snapTo(w.y, m);
          s.draft = { ...common, kind: sm === 'rect' ? 'rect' : 'ellipse', mode: sm, pts: [x, y, x, y], center: sm === 'circle' || sm === 'blob' };
          s.act = { kind: 'drag' };
          s.dirty = true;
          return;
        }
        if (sm === 'brush') {
          s.draft = { ...common, kind: 'brush', pts: [r2(w.x), r2(w.y)], w: s.brushW };
          s.act = { kind: 'brush' };
          s.dirty = true;
          return;
        }
        // poly / path
        const m = snapMode(e);
        const center = sm === 'path';
        const x = snapTo(w.x, m, center);
        const y = snapTo(w.y, m, center);
        const dr = s.draft;
        if (dr && dr.kind === sm) {
          const n = dr.pts.length;
          if (sm === 'poly' && n >= 6 && Math.hypot(dr.pts[0] - x, dr.pts[1] - y) < 0.3) { finishDraft(); return; }
          if (Math.hypot(dr.pts[n - 2] - x, dr.pts[n - 1] - y) < 0.05) { finishDraft(); return; }
          dr.pts.push(x, y);
        } else s.draft = { ...common, kind: sm, pts: [x, y], w: s.width };
        s.dirty = true;
        rerender();
        return;
      }
      if (tl === 'wall') {
        const m = snapMode(e);
        const x = snapTo(w.x, m);
        const y = snapTo(w.y, m);
        const dr = s.draft;
        if (dr && dr.wall) {
          const n = dr.pts.length;
          if (Math.hypot(dr.pts[n - 2] - x, dr.pts[n - 1] - y) < 0.05) { finishDraft(); return; }
          dr.pts.push(x, y);
        } else s.draft = { kind: 'path', op: 'sub', pts: [x, y], w: s.wallThick, wall: 1 };
        s.dirty = true;
        rerender();
        return;
      }
      if (tl === 'scatter') {
        s.act = { kind: 'scatter' };
        s.undo.push(JSON.stringify(s.doc));
        s.redo = [];
        scatterPaint(w, true);
        return;
      }
      if (tl === 'door') {
        commit({ objects: [...s.doc.objects, { ...placeDoor(w, s.doorKey), id: uid(6) }] }, { geom: false });
        return;
      }
      if (tl === 'object') {
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
          s.draft.hover = { x: snapTo(w.x, m, s.draft.kind === 'path'), y: snapTo(w.y, m, s.draft.kind === 'path') };
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
      if (a.kind === 'marquee') { s.marquee = { a: a.a, b: w }; s.dirty = true; return; }
      if (a.kind === 'rotate') {
        const ang = Math.atan2(w.y - a.box.cy, w.x - a.box.cx);
        let deg = ((ang - a.a0) * 180) / Math.PI;
        if (!e.shiftKey) deg = Math.round(deg / 15) * 15;
        a.moved = true;
        applyTransform(a.orig, { rot: deg, cx: a.box.cx, cy: a.box.cy });
        return;
      }
      if (a.kind === 'scale') {
        const f = clamp(Math.hypot(w.x - a.box.cx, w.y - a.box.cy) / a.d0, 0.05, 12);
        a.moved = true;
        applyTransform(a.orig, { scale: f, cx: a.box.cx, cy: a.box.cy });
        return;
      }
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
        const x = snapTo(w.x, m);
        const y = snapTo(w.y, m);
        if (s.draft.center) {
          const cx = s.draft.pts[0];
          const cy = s.draft.pts[1];
          const rr = Math.max(Math.abs(x - cx), Math.abs(y - cy));
          s.draft.pts = [r2(cx - rr), r2(cy - rr), r2(cx + rr), r2(cy + rr)];
        } else {
          s.draft.pts[2] = x;
          s.draft.pts[3] = y;
        }
        s.dirty = true;
        return;
      }
      if (a.kind === 'cells' && s.draft) {
        const x = Math.floor(w.x);
        const y = Math.floor(w.y);
        const key = `${x},${y}`;
        if (x >= 0 && y >= 0 && x < s.doc.w && y < s.doc.h && !s.draft.seen.has(key)) {
          s.draft.seen.add(key);
          s.draft.pts.push(x, y);
          s.dirty = true;
        }
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
        const objs = s.sel.filter((x) => x.kind === 'obj');
        const fine = objs.length === 1 && (objMeta(a.orig.objects.find((x) => x.id === objs[0].id) || {})?.w || 1) < 0.9;
        if (m === 'grid' && !fine) { dx = Math.round(dx); dy = Math.round(dy); } else if (m === 'half' && !fine) { dx = Math.round(dx * 2) / 2; dy = Math.round(dy * 2) / 2; }
        if (dx || dy) a.moved = true;
        const o = a.orig;
        const d = { ...s.doc };
        const ids = new Set(s.sel.map((x) => x.id));
        d.objects = o.objects.map((x) => (ids.has(x.id) ? { ...x, x: r2(x.x + dx), y: r2(x.y + dy) } : x));
        d.labels = o.labels.map((x) => (ids.has(x.id) ? { ...x, x: r2(x.x + dx), y: r2(x.y + dy) } : x));
        d.lights = (o.lights || []).map((x) => (ids.has(x.id) ? { ...x, x: r2(x.x + dx), y: r2(x.y + dy) } : x));
        for (const key of ['shapes', 'terrain']) {
          d[key] = o[key].map((x) => (ids.has(x.id) ? { ...x, pts: x.pts.map((v, i) => r2(v + (i % 2 ? dy : dx))) } : x));
        }
        if (s.sel.some((x) => x.kind === 'shape' || x.kind === 'terrain')) s.geom++;
        s.doc = d;
        s.ver++;
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
      if (a.kind === 'brush' || a.kind === 'cells') { finishDraft(); return; }
      if (a.kind === 'marquee') {
        const { a: p0, b: p1 } = s.marquee || { a: a.a, b: a.a };
        s.marquee = null;
        const x0 = Math.min(p0.x, p1.x);
        const x1 = Math.max(p0.x, p1.x);
        const y0 = Math.min(p0.y, p1.y);
        const y1 = Math.max(p0.y, p1.y);
        if (Math.abs(x1 - x0) < 0.15 && Math.abs(y1 - y0) < 0.15) {
          if (!a.add) { setSel([]); s.sel = []; }
          s.dirty = true;
          return;
        }
        const inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        const found = [];
        for (const o of s.doc.objects) if (!o.hidden && inBox(o.x, o.y)) found.push({ kind: 'obj', id: o.id });
        for (const l of s.doc.lights || []) if (inBox(l.x, l.y)) found.push({ kind: 'light', id: l.id });
        for (const l of s.doc.labels) if (inBox(l.x, l.y)) found.push({ kind: 'label', id: l.id });
        const next = a.add ? [...s.sel, ...found.filter((f) => !s.sel.some((x) => x.id === f.id))] : found;
        setSel(next);
        s.sel = next;
        s.dirty = true;
        return;
      }
      if (a.kind === 'scatter') {
        s.editSeq = (s.editSeq || 0) + 1;
        s.dirty = true;
        save();
        rerender();
        return;
      }
      if (a.kind === 'rotate' || a.kind === 'scale') {
        s.skipIds = null;
        s.objKeyC = '';
        if (a.moved) {
          s.editSeq = (s.editSeq || 0) + 1;
          s.localDirty = true;
          save();
        } else s.undo.pop();
        rerender();
        return;
      }
      if (a.kind === 'move') {
        s.skipIds = null;
        s.objKeyC = '';
        if (a.moved) {
          s.redo = [];
          s.editSeq = (s.editSeq || 0) + 1;
          s.localDirty = true;
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
  }, [grid]);

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
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); const all = s.doc.objects.filter((o) => !o.hidden).map((o) => ({ kind: 'obj', id: o.id })); setSel(all); s.sel = all; s.dirty = true; return; }
      if (e.key === 'Escape') { s.draft = null; setSel([]); s.sel = []; s.dirty = true; return; }
      if (e.key === 'Enter' && s.draft) { s.finishDraft?.(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.sel.length) { e.preventDefault(); deleteSel(); return; }
      if (mod && e.key.toLowerCase() === 'd' && s.sel.length) { e.preventDefault(); duplicateSel(); return; }
      if (e.key.toLowerCase() === 'r' && s.sel.length && !mod) { rotateSel(e.shiftKey ? 15 : 90); return; }
      if (e.key.toLowerCase() === 'f' && s.sel.length && !mod) { flipSel(); return; }
      if ((e.key === '+' || e.key === '-') && s.sel.length && !mod) { scaleSel(e.key === '+' ? 1.1 : 1 / 1.1); return; }
      if (mod || e.altKey) return;
      const t = BUILD_TOOLS.find((x) => x[3] === e.key.toLowerCase());
      if (t) { setTool(t[0]); s.draft = null; s.dirty = true; }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [active, sel]);

  // ── Aktionen ──
  const regenerate = async (k) => {
    if ((s.doc.shapes.length || s.doc.objects.length) && !(await confirmDialog(`Karte durch „${SCRAWL_GENERATORS[k].label}“ ersetzen? (Rückgängig mit Strg+Z)`, { ok: 'Ersetzen' }))) return;
    commit(SCRAWL_GENERATORS[k].fn(s.doc.w, s.doc.h));
    setSel([]);
    fit();
  };
  const resize = async () => {
    const v = await promptDialog('Neue Größe (Spalten × Zeilen)', `${s.doc.w} × ${s.doc.h}`, { title: 'Kartengröße', hint: 'Felder à 1,5 m / 5 ft. Inhalte bleiben erhalten.' });
    const m = /(\d+)\s*[x×*]\s*(\d+)/i.exec(v || '');
    if (!m) return;
    const w = clamp(Number(m[1]), 8, 200);
    const h = clamp(Number(m[2]), 8, 200);
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
  const pickTool = (id) => {
    setTool(id);
    s.draft = null;
    if (id !== 'measure') { s.measure = null; setMeasureText(''); }
    s.dirty = true;
  };
  const switchMode = (v) => {
    setMode(v);
    setTool(v === 'build' ? 'select' : 'pan');
    s.draft = null;
    s.measure = null;
    setMeasureText('');
    setSel([]);
    if (v === 'play' && gm && real && usesOwnAssets(s.doc) && (map.updatedAt || 0) > (map.bake?.at || 0)) bakeForPlayers(true);
  };
  const updOne = (kind, id, patch) => commit({ [listOf(kind)]: (s.doc[listOf(kind)] || []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }, { geom: kind === 'shape' || kind === 'terrain' });
  const delOne = (kind, id) => {
    commit({ [listOf(kind)]: (s.doc[listOf(kind)] || []).filter((x) => x.id !== id) }, { geom: kind === 'shape' || kind === 'terrain' });
    setSel(sel.filter((x) => x.id !== id));
  };
  const pickFromList = (h, e) => {
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    const next = multi ? (isSel(h.id) ? sel.filter((x) => x.id !== h.id) : [...sel, h]) : [h];
    setSel(next);
    s.sel = next;
    s.dirty = true;
  };

  const d = s.doc;
  const st = STYLES[d.style] || STYLES.klassisch;
  const tools = mode === 'build' ? (imageMap ? BUILD_TOOLS.filter((t) => !['land', 'terrain'].includes(t[0])) : BUILD_TOOLS) : gm ? PLAY_TOOLS_GM : PLAY_TOOLS;
  const shapeMode = tool === 'land' ? shape : matShape;
  const selObjList = selObjs();
  const firstMeta = selObjList.length ? objMeta(selObjList[0]) : null;

  // ── Linke Seitenleiste: alle Werkzeuge und Einstellungen ──
  const toolSection = () => {
    if (tool === 'land' || tool === 'terrain') {
      const terrain = tool === 'terrain';
      return html`<${Sec} title=${terrain ? 'Belag & Gelände' : 'Land & Räume'} icon=${terrain ? 'brush' : 'layout'} open=${true}>
        <${Segmented} value=${op} onChange=${setOp} options=${[{ value: 'add', label: 'Hinzufügen', icon: 'plus' }, { value: 'sub', label: 'Entfernen', icon: 'eraser' }]} />
        <div class="mw-lbl">Form</div>
        <${Chips} options=${SHAPE_MODES} value=${shapeMode} onPick=${terrain ? setMatShape : setShape} />
        ${!['brush', 'cells', 'fill'].includes(shapeMode) ? html`<div class="row small"><span class="muted grow">Einrasten</span><${Segmented} value=${snap} onChange=${setSnap} options=${[{ value: 'grid', label: 'Raster' }, { value: 'half', label: '½' }, { value: 'free', label: 'Frei' }]} /></div>` : null}
        ${shapeMode === 'path' ? html`<div class="row small"><span class="muted grow">Gangbreite</span><${Segmented} value=${width} onChange=${setWidth} options=${[1, 2, 3].map((n) => ({ value: n, label: `${n}` }))} /></div>` : null}
        ${shapeMode === 'brush' ? html`<${Slider} label="Pinsel" value=${brushW} min=${0.5} max=${8} step=${0.5} onInput=${setBrushW} />` : null}
        ${terrain ? html`
          <div class="mw-lbl">Belag</div>
          ${real ? html`<div class="chips">${terrainGroups().map((g, gi) => html`<button key=${g.label} type="button" class=${'chip' + (matCat === gi ? ' selected' : '')} onClick=${() => setMatCat(gi)}>${g.label}</button>`)}</div>
            <div class="chips">${[['', 'Original'], ...Object.entries(TEX_MODS).map(([k, m2]) => [k, m2.name])].map(([k, label]) => html`<button key=${k || 'orig'} type="button" class=${'chip' + (matMod === k ? ' selected' : '')} onClick=${() => { setMatMod(k); setMat(reMod(mat, k)); }}>${label}</button>`)}</div>
            <div class="tex-grid mini">${(terrainGroups(matMod)[matCat] || terrainGroups(matMod)[0]).items.map((i2) => html`<button key=${i2.key} type="button" class=${mat === i2.key ? 'active' : ''} title=${i2.label} onClick=${() => setMat(i2.key)}>
              ${i2.tex ? html`<img src=${texThumb(i2.tex)} alt="" loading="lazy" />` : html`<span class="sw" style=${{ background: i2.color }}></span>`}<span>${i2.label}</span></button>`)}</div>`
            : html`<div class="mat-pick">${Object.entries(MATS).map(([k, m2]) => html`<button key=${k} type="button" class=${mat === k ? 'active' : ''} onClick=${() => setMat(k)} title=${m2.label}><span style=${{ background: k === 'difficult' ? 'repeating-linear-gradient(135deg,#7a5a2a 0 3px,transparent 3px 7px)' : m2.color }}></span>${m2.label}</button>`)}</div>`}
          <${Slider} label="Übergang" value=${d.soft ?? 0.3} min=${0} max=${1} onInput=${(v) => commit({ soft: v }, { undo: false })} />
        ` : real ? html`<${TexBtn} label="Bodenbelag" value=${shapeTex || d.floorTex} cats=${['boden', 'pflaster']} onPick=${setShapeTex} />
          ${shapeTex ? html`<button type="button" class="ws-link tiny" onClick=${() => setShapeTex('')}>→ Standard der Karte benutzen</button>` : null}` : null}
        <div class="tiny faint">${HINTS[tool]}</div>
      <//>`;
    }
    if (tool === 'wall') {
      return html`<${Sec} title="Zwischenwand" icon="minus" open=${true}>
        <${Slider} label="Stärke" value=${wallThick} min=${0.15} max=${0.8} onInput=${setWallThick} />
        <div class="row small"><span class="muted grow">Einrasten</span><${Segmented} value=${snap} onChange=${setSnap} options=${[{ value: 'grid', label: 'Raster' }, { value: 'half', label: '½' }, { value: 'free', label: 'Frei' }]} /></div>
        <div class="tiny faint">${HINTS.wall}</div>
      <//>`;
    }
    if (tool === 'door') {
      return html`<${Sec} title="Türen" icon="door" open=${true}>
        <${AssetGrid} value=${doorKey} onPick=${setDoorKey} items=${DOOR_KEYS.map((k) => { const i2 = assetInfo(k); return { key: k, name: i2?.name || k, w: i2?.w || 1, h: i2?.h || 1 }; })} />
        <div class="tiny faint">${HINTS.door}</div>
      <//>`;
    }
    if (tool === 'object' || tool === 'scatter') {
      return html`
        ${tool === 'object' ? html`<${Sec} title="Objektbibliothek" icon="gem" open=${true}>
          <${AssetPicker} value=${objKey} onPick=${setObjKey} />
        <//>` : html`<${Sec} title="Streuen" icon="sparkles" open=${true}>
          <${Chips} options=${Object.entries(SETS).map(([k, v]) => [k, v.label])} value=${scatterSet} onPick=${setScatterSet} />
          <${Slider} label="Radius" value=${scatterR} min=${0.5} max=${8} step=${0.5} onInput=${setScatterR} />
          <${Slider} label="Dichte" value=${scatterN} min=${1} max=${14} step=${1} onInput=${setScatterN} />
        <//>`}
        <${Sec} title="Eigenschaften beim Setzen" icon="settings" open=${true}>
          <${Slider} label="Größe" value=${objScale} min=${0.1} max=${5} onInput=${setObjScale} fmt=${(v) => `${Math.round(v * 100) / 100}×`} />
          <${Slider} label="Deckkraft" value=${objAlpha} min=${0.1} max=${1} onInput=${setObjAlpha} fmt=${(v) => `${Math.round(v * 100)} %`} />
          <${Slider} label="Weichzeichnen" value=${objBlur} min=${0} max=${6} step=${0.5} onInput=${setObjBlur} fmt=${(v) => (v ? `${v} px` : 'aus')} />
          <${Toggle} checked=${objShadow} onChange=${setObjShadow} label="Schlagschatten" />
          ${tool === 'object' ? html`<${Toggle} checked=${objRandom} onChange=${setObjRandom} label="Zufällig drehen" />` : null}
          <div class="row small"><span class="muted grow">Ebene</span><${Segmented} value=${objLayer} onChange=${setObjLayer} options=${[{ value: '', label: 'Auto' }, { value: 'floor', label: 'Boden' }, { value: 'obj', label: 'Normal' }, { value: 'top', label: 'Oben' }]} /></div>
          <div class="tiny faint">${HINTS[tool]}</div>
        <//>`;
    }
    if (tool === 'light') {
      return html`<${Sec} title="Licht" icon="sun" open=${true}>
        <div class="mat-pick">${LIGHT_COLORS.map(([k, label, c]) => html`<button key=${k} type="button" class=${lightKind === k ? 'active' : ''} onClick=${() => setLightKind(k)}><span style=${{ background: c.replace(/[\d.]+\)$/, '1)') }}></span>${label}</button>`)}</div>
        <${Slider} label="Radius" value=${lightR} min=${1} max=${24} step=${0.5} onInput=${setLightR} fmt=${(v) => `${v} Felder`} />
        <div class="tiny faint">${HINTS.light}</div>
      <//>`;
    }
    if (tool === 'text') {
      return html`<${Sec} title="Beschriftung" icon="hash" open=${true}>
        <${Segmented} value=${textKind} onChange=${setTextKind} options=${[{ value: 'room', label: 'Raumnummer', icon: 'hash' }, { value: 'text', label: 'Text', icon: 'quote' }]} />
        <div class="tiny faint">${HINTS.text}</div>
      <//>`;
    }
    return html`<${Sec} title=${tool === 'select' ? 'Auswählen' : 'Ansicht'} icon=${tool === 'select' ? 'pointer' : 'hand'} open=${true}>
      <div class="tiny faint">${HINTS[tool]}</div>
      ${tool === 'select' ? html`<div class="row small"><span class="muted grow">Einrasten</span><${Segmented} value=${snap} onChange=${setSnap} options=${[{ value: 'grid', label: 'Raster' }, { value: 'half', label: '½' }, { value: 'free', label: 'Frei' }]} /></div>` : null}
    <//>`;
  };

  const selectionSection = () => {
    if (!sel.length) return null;
    const many = sel.length > 1;
    const it = onlyItem;
    const kind = only?.kind;
    return html`<${Sec} title=${many ? `Auswahl (${sel.length})` : 'Auswahl'} icon="pointer" open=${true}>
      ${many ? html`<div class="small"><b>${sel.length} Elemente</b></div>` : null}
      ${selObjList.length ? html`
        <div class="btn-row"><${Btn} size="sm" icon="refresh" onClick=${() => rotateSel(90)}>90°<//><${Btn} size="sm" kind="ghost" onClick=${() => rotateSel(15)}>15°<//><${Btn} size="sm" kind="ghost" onClick=${flipSel}>Spiegeln<//></div>
        <div class="btn-row"><${Btn} size="sm" kind="ghost" onClick=${() => scaleSel(1.1)}>Größer<//><${Btn} size="sm" kind="ghost" onClick=${() => scaleSel(1 / 1.1)}>Kleiner<//></div>
        ${!many && it ? html`<${Slider} label="Größe" value=${it.s || 1} min=${0.05} max=${6} onInput=${(v) => updSel({ s: v })} fmt=${(v) => `${Math.round(v * 100) / 100}×`} />
          <${Slider} label="Drehung" value=${it.r || 0} min=${0} max=${359} step=${1} onInput=${(v) => updSel({ r: v })} fmt=${(v) => `${Math.round(v)}°`} />` : null}
        <${Slider} label="Deckkraft" value=${(it?.o ?? 1)} min=${0.05} max=${1} onInput=${(v) => updSel({ o: v >= 1 ? null : r2(v) })} fmt=${(v) => `${Math.round(v * 100)} %`} />
        <${Slider} label="Weichzeichnen" value=${(it?.b ?? 0)} min=${0} max=${8} step=${0.5} onInput=${(v) => updSel({ b: v || null })} fmt=${(v) => (v ? `${v} px` : 'aus')} />
        <${Toggle} checked=${it ? it.sh !== false : true} onChange=${(v) => updSel({ sh: v })} label="Schlagschatten" />
        <div class="row small"><span class="muted grow">Ebene</span><${Segmented} value=${(it?.layer || firstMeta?.layer || 'obj')} onChange=${(v) => updSel({ layer: v })} options=${[{ value: 'floor', label: 'Boden' }, { value: 'obj', label: 'Normal' }, { value: 'top', label: 'Oben' }]} /></div>
        ${!many && it && String(it.a || '').startsWith('u:') ? html`<div class="tiny faint">Eigenes Objekt – gilt für alle Vorkommen:</div>
          <${Toggle} checked=${!!userAssetInfo(String(it.a).slice(2))?.block} onChange=${(v) => { updateUserAsset(String(it.a).slice(2), { block: v, ...(v ? { rough: false } : {}) }); s.geom++; }} label="Blockiert (undurchdringlich)" />
          <${Toggle} checked=${!!userAssetInfo(String(it.a).slice(2))?.rough} onChange=${(v) => { updateUserAsset(String(it.a).slice(2), { rough: v }); s.geom++; }} label="Schwieriges Gelände" />` : null}
      ` : null}
      ${!many && kind === 'light' && it ? html`
        <div class="mat-pick">${LIGHT_COLORS.map(([k, label, c]) => html`<button key=${k} type="button" class=${it.color === c ? 'active' : ''} onClick=${() => updSel({ color: c })}><span style=${{ background: c.replace(/[\d.]+\)$/, '1)') }}></span>${label}</button>`)}</div>
        <${Slider} label="Radius" value=${it.r || 4} min=${1} max=${24} step=${0.5} onInput=${(v) => updSel({ r: v })} />
        <${Slider} label="Stärke" value=${it.i ?? 1} min=${0.2} max=${1.6} onInput=${(v) => updSel({ i: v })} />` : null}
      ${!many && kind === 'label' && it ? html`
        <${Field} label="Text"><input class="input" value=${it.text} onInput=${(e) => updSel({ text: e.target.value })} /><//>
        <${Slider} label="Größe" value=${it.size || 0.7} min=${0.3} max=${3} step=${0.1} onInput=${(v) => updSel({ size: v })} />
        <${Field} label="Notiz verknüpfen (im Spielmodus antippbar)">${it.noteId && noteById(it.noteId) ? html`<span class="chip accent">${noteById(it.noteId).title}<span class="x" onClick=${() => updSel({ noteId: null })}><${Icon} name="x" size=${12} /></span></span>` : html`<${NotePicker} onPick=${(n) => updSel({ noteId: n.id })} />`}<//>` : null}
      ${!many && (kind === 'shape' || kind === 'terrain') && it ? html`
        <div class="small"><b>${kind === 'terrain' ? `Belag: ${matLabel(it.mat)}` : it.wall ? 'Zwischenwand' : { rect: 'Raum', ellipse: 'Runder Raum', poly: 'Polygon', path: 'Gang', brush: 'Pinselstrich', cells: 'Felder' }[it.kind]}</b></div>
        ${it.kind === 'path' || it.kind === 'brush' ? html`<${Slider} label="Breite" value=${it.w || 1} min=${0.15} max=${8} onInput=${(v) => updSel({ w: v }, true)} />` : null}
        ${kind === 'shape' && real && !it.wall ? html`<${TexBtn} label="Bodenbelag" value=${it.tex || d.floorTex} cats=${['boden', 'pflaster']} onPick=${(v) => updSel({ tex: v }, true)} />
          <${Toggle} checked=${!it.nowall} onChange=${(v) => updSel({ nowall: v ? 0 : 1 }, true)} label="Mit Wand umranden" />
          <${TexBtn} label=${it.roof ? 'Dach' : 'Dach hinzufügen'} value=${it.roof || 'clay_roof_tiles'} cats=${['dach']} onPick=${(v) => updSel({ roof: v }, true)} />
          ${it.roof ? html`<button type="button" class="ws-link tiny" onClick=${() => updSel({ roof: '' }, true)}>→ Dach entfernen</button>` : null}` : null}
        ${kind === 'terrain' && real ? html`<div class="tex-grid mini">${terrainGroups(matMod).flatMap((g) => g.items).map((i2) => html`<button key=${i2.key} type="button" class=${it.mat === i2.key ? 'active' : ''} title=${i2.label} onClick=${() => updSel({ mat: i2.key }, true)}>
          ${i2.tex ? html`<img src=${texThumb(i2.tex)} alt="" loading="lazy" />` : html`<span class="sw" style=${{ background: i2.color }}></span>`}<span>${i2.label}</span></button>`)}</div>` : null}` : null}
      <div class="btn-row"><${Btn} size="sm" icon="copy" onClick=${duplicateSel}>Duplizieren<//><${Btn} size="sm" kind="danger" icon="trash" onClick=${deleteSel}>Löschen<//></div>
    <//>`;
  };

  const leftPanel = () => html`<aside class="sidebar left mw">
    <div class="sidebar-head">
      <button type="button" class="panel-select" onClick=${() => openView('maps')}><${Icon} name="map" size=${17} /><span class="t">${mode === 'build' ? 'Kartenwerkstatt' : 'Spielmodus'}</span></button>
      ${isMobile() ? html`<${IconBtn} icon="x" title="Schließen" onClick=${() => ws.set({ drawer: null })} />` : null}
    </div>
    <div class="sidebar-body mw-body">
      ${gm ? html`<${Segmented} value=${mode} onChange=${switchMode} options=${[{ value: 'build', label: 'Bauen', icon: 'hammer' }, { value: 'play', label: 'Spielen', icon: 'play' }]} />` : null}
      ${mode === 'build' ? html`
        <${Sec} title="Werkzeuge" icon="wand" open=${true}><${ToolGrid} tools=${tools} tool=${tool} onPick=${pickTool} /><//>
        ${toolSection()}
        ${selectionSection()}
        ${imageMap ? html`<${Sec} title="Bild & Raster" icon="image" open=${true}>
          <div class="tiny faint">Die roten Linien des Bildes sollen auf dem Raster liegen. Feinjustieren, bis Felder und Bild zusammenpassen.</div>
          <${Slider} label="Feldgröße im Bild" value=${d.bgFit?.cell || 70} min=${8} max=${400} step=${0.5} onInput=${(v) => commit({ bgFit: { ...(d.bgFit || { ox: 0, oy: 0 }), cell: v } }, { undo: false })} fmt=${(v) => `${Math.round(v * 10) / 10} px`} />
          <${Slider} label="Versatz waagerecht" value=${d.bgFit?.ox || 0} min=${0} max=${d.bgFit?.cell || 70} step=${0.5} onInput=${(v) => commit({ bgFit: { ...(d.bgFit || { cell: 70, oy: 0 }), ox: v } }, { undo: false })} fmt=${(v) => `${Math.round(v * 10) / 10} px`} />
          <${Slider} label="Versatz senkrecht" value=${d.bgFit?.oy || 0} min=${0} max=${d.bgFit?.cell || 70} step=${0.5} onInput=${(v) => commit({ bgFit: { ...(d.bgFit || { cell: 70, ox: 0 }), oy: v } }, { undo: false })} fmt=${(v) => `${Math.round(v * 10) / 10} px`} />
          <div class="row small"><span class="muted grow">Größe: ${d.w} × ${d.h} Felder</span><${Btn} size="sm" kind="ghost" onClick=${resize}>Ändern<//></div>
          <${Btn} size="sm" icon="image" onClick=${traceImage}>Anderes Bild<//>
          <${Toggle} checked=${d.gridOn !== false} onChange=${(v) => commit({ gridOn: v })} label="Raster zeigen" />
        <//>` : null}
        <${Sec} title="Karte & Stil" icon="palette">
          <div class="style-pick">${Object.entries(STYLES).filter(([k]) => k !== 'bild' || imageMap).map(([k, sv]) => html`<button key=${k} type="button" class=${d.style === k ? 'active' : ''} onClick=${() => commit({ style: k })}>
            <span class="sw" style=${{ background: sv.real ? 'linear-gradient(135deg,#3f5a2c 0 45%,#9b8d79 45% 70%,#3a332c 70%)' : `linear-gradient(135deg, ${sv.bg} 0 45%, ${sv.floor} 45% 70%, ${sv.wall} 70%)` }}></span>${sv.label}</button>`)}</div>
          ${real ? html`
            <${Toggle} checked=${!!d.outdoor} onChange=${(v) => commit({ outdoor: v, ground: v ? 'leafy_grass' : 'dark_rock' })} label="Außenkarte (Untergrund sichtbar)" />
            <${TexBtn} label="Untergrund" value=${d.ground} cats=${['gelaende', 'pflaster', 'boden']} onPick=${(v) => commit({ ground: v })} />
            <${TexBtn} label="Standard-Boden" value=${d.floorTex} cats=${['boden', 'pflaster']} onPick=${(v) => commit({ floorTex: v })} />
            <${TexBtn} label="Wände" value=${d.wallTex} cats=${['wand']} onPick=${(v) => commit({ wallTex: v })} />
            <${Slider} label="Wandstärke" value=${d.wallW || (d.outdoor ? 0.32 : 0.42)} min=${0.15} max=${0.8} onInput=${(v) => commit({ wallW: v }, { undo: false })} />
          ` : html`<${Slider} label="Schraffur" value=${d.hatch ?? 1} min=${0} max=${2.5} step=${0.25} onInput=${(v) => commit({ hatch: v }, { undo: false })} />`}
          <${Toggle} checked=${d.gridOn !== false} onChange=${(v) => commit({ gridOn: v })} label="Raster zeigen" />
          <div class="row small"><span class="muted grow">Größe: ${d.w} × ${d.h} Felder</span><${Btn} size="sm" kind="ghost" onClick=${resize}>Ändern<//></div>
          <div class="row small"><${Btn} size="sm" icon="image" onClick=${traceImage}>${map.fileId ? 'Andere Vorlage' : 'Bild als Vorlage'}<//></div>
          ${map.fileId ? html`<${Slider} label="Vorlage sichtbar" value=${d.bgAlpha ?? 0.5} min=${0} max=${1} onInput=${(v) => commit({ bgAlpha: v }, { undo: false })} fmt=${(v) => `${Math.round(v * 100)} %`} />` : null}
        <//>
        ${real ? html`<${Sec} title="Licht & Stimmung" icon="sun">
          <${Slider} label="Dunkelheit" value=${d.dark || 0} min=${0} max=${0.9} onInput=${(v) => commit({ dark: v }, { undo: false, geom: false })} fmt=${(v) => `${Math.round(v * 100)} %`} />
          <${Toggle} checked=${showLight} onChange=${setShowLight} label="Licht beim Bauen zeigen" />
          <div class="tiny faint">Fackeln, Feuer und Zauberkreise leuchten von selbst. Im Spielmodus wird das Licht immer gezeigt.</div>
        <//>` : null}
        <${Sec} title="Generieren" icon="dices">
          <div class="chips">${Object.entries(SCRAWL_GENERATORS).map(([k, g]) => html`<button key=${k} type="button" class="chip suggest" onClick=${() => regenerate(k)}>${g.label}</button>`)}</div>
          <div class="tiny faint">Ersetzt die Karte – mit Strg+Z zurückholbar.</div>
        <//>
        <${Sec} title="Export & Spieler" icon="download">
          <div class="btn-row"><${Btn} size="sm" icon="download" loading=${busy === 'png'} onClick=${exportPng}>PNG<//>
            ${real && usesOwnAssets(d) ? html`<${Btn} size="sm" icon="users" loading=${busy === 'bake'} onClick=${() => bakeForPlayers(false)}>Für Spieler backen<//>` : null}</div>
          <div class="btn-row"><${Btn} size="sm" kind="ghost" icon="undo" disabled=${!s.undo.length} onClick=${undo}>Rückgängig<//><${Btn} size="sm" kind="ghost" icon="refresh" disabled=${!s.redo.length} onClick=${redo}>Wiederholen<//></div>
          ${real && usesOwnAssets(d) ? html`<div class="tiny faint">Diese Karte nutzt eigene Objekte. Sie liegen nur auf diesem Gerät – für die Mitspieler wird ein Kartenbild gespeichert (beim Wechsel in den Spielmodus automatisch).</div>` : null}
        <//>
      ` : html`
        <${Sec} title="Werkzeuge" icon="wand" open=${true}><${ToolGrid} tools=${tools} tool=${tool} onPick=${pickTool} /><//>
        ${gm ? html`<${Sec} title="Nebel des Krieges" icon="eye-off" open=${true}>
          <${Toggle} checked=${!!map.fog?.enabled} onChange=${(v) => db.update(col('maps'), params.id, { fog: { ...(map.fog || {}), revealed: s.fog.join(''), enabled: v } })} label="Nebel aktiv" />
          <div class="row small"><span class="muted grow">Pinsel</span><${Segmented} value=${fogBrush} onChange=${setFogBrush} options=${[{ value: 1, label: '1' }, { value: 2, label: '3' }, { value: 3, label: '5' }]} /></div>
          <div class="btn-row"><${Btn} size="sm" icon="eye" onClick=${() => fogAll('1')}>Alles aufdecken<//><${Btn} size="sm" icon="eye-off" onClick=${() => fogAll('0')}>Alles verdecken<//></div>
        <//>
        <${Sec} title="Tokens" icon="users" open=${true}>
          <div class="btn-row"><${Btn} size="sm" icon="users" onClick=${addPartyTokens}>Gruppe<//><${Btn} size="sm" icon="sword" onClick=${addCombatTokens}>Gegner aus Kampf<//></div>
          <${Toggle} checked=${!!B.showNames} onChange=${(v) => { B.showNames = v; s.dirty = true; rerender(); }} label="Namen auf der Karte zeigen" />
          <div class="tiny faint">Token antippen = Aktionen, Reichweiten & Bewegung · ziehen = bewegen · lange drücken oder Alt-Klick = Ping.</div>
        <//>
        <${Sec} title="Monster platzieren" icon="ghost">
          <${MonsterPlacer} B=${B} active=${tool === 'place'} onPick=${(m) => { B.placing = m; setTool('place'); s.dirty = true; }} onStop=${() => { B.placing = null; setTool('pan'); }} />
        <//>
        <${Sec} title="Kampf" icon="swords" open=${true}>
          <div class="btn-row">${!B.combat.active ? html`<${Btn} size="sm" kind="primary" icon="swords" onClick=${() => startCombat(B)}>Kampf starten<//>` : null}<${Btn} size="sm" kind="ghost" icon="eraser" onClick=${() => clearTemplates(B)}>Schablonen entfernen<//></div>
        <//>` : null}
      `}
    </div>
  </aside>`;

  // ── Rechte Seitenleiste: Ebenen ──
  const layersPanel = () => {
    const q = layerQ.trim().toLowerCase();
    const rows = [];
    const LAYERS = [['top', 'Oben (Kronen, Dächer)'], ['obj', 'Objekte'], ['floor', 'Boden (Teppiche, Spuren)']];
    // Anzeige in Zeichenreihenfolge, oberste Zeile = liegt ganz oben
    const stapel = (list) => [...list].sort((a, b) => (b.z || 0) - (a.z || 0) || b.y - a.y);
    // Ziehen & Ablegen: die neue Reihenfolge wird als z gespeichert und schlägt die Tiefensortierung
    const dropLayer = (lay, targetId, zone) => {
      const id = lDrag.id;
      setLDrag({ id: null, over: null, zone: null });
      if (!id || id === targetId) return;
      const grp = stapel(d.objects.filter((o) => (o.layer || objMeta(o)?.layer || 'obj') === lay));
      const von = grp.findIndex((o) => o.id === id);
      if (von < 0) return;
      const [gezogen] = grp.splice(von, 1);
      let at = grp.findIndex((o) => o.id === targetId);
      if (at < 0) at = grp.length; else if (zone === 'after') at += 1;
      grp.splice(at, 0, gezogen);
      const z = new Map(grp.map((o, i) => [o.id, grp.length - i]));   // oben in der Liste = größtes z
      commit({ objects: d.objects.map((o) => (z.has(o.id) ? { ...o, z: z.get(o.id) } : o)) }, { geom: false });
    };
    const objRow = (o, lay) => {
      const m = objMeta(o);
      const name = m?.name || 'Objekt';
      const zone = lDrag.over === o.id ? (lDrag.zone === 'after' ? ' drop-after' : ' drop-before') : '';
      return html`<div key=${o.id} class=${`mw-lrow${isSel(o.id) ? ' sel' : ''}${o.hidden ? ' off' : ''}${zone}`} title=${`${name} · ${r2(o.x)} / ${r2(o.y)} – zum Umsortieren ziehen`}
          draggable=${!q} onDragStart=${(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.id); setLDrag({ id: o.id, over: null, zone: null }); }}
          onDragEnd=${() => setLDrag({ id: null, over: null, zone: null })}
          onDragOver=${(e) => {
            if (!lDrag.id) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const zn = (e.clientY - r.top) / Math.max(1, r.height) < 0.5 ? 'before' : 'after';
            if (lDrag.over !== o.id || lDrag.zone !== zn) setLDrag({ ...lDrag, over: o.id, zone: zn });
          }}
          onDrop=${(e) => { e.preventDefault(); e.stopPropagation(); dropLayer(lay, o.id, lDrag.zone); }}
          onClick=${(e) => pickFromList({ kind: 'obj', id: o.id }, e)} onDblClick=${() => focusOn(o.x, o.y)}>
        ${o.t === 'stamp' ? html`<img src=${thumbFor(o.a)} alt="" loading="lazy" />` : html`<span class="mw-lico"><${Icon} name="gem" size=${13} /></span>`}
        <span class="grow ellipsis">${name}</span>
        <button type="button" class="mw-ico" title=${o.hidden ? 'Einblenden' : 'Ausblenden'} onClick=${(e) => { e.stopPropagation(); updOne('obj', o.id, { hidden: o.hidden ? null : 1 }); }}><${Icon} name=${o.hidden ? 'eye-off' : 'eye'} size=${13} /></button>
        <button type="button" class="mw-ico" title="Löschen" onClick=${(e) => { e.stopPropagation(); delOne('obj', o.id); }}><${Icon} name="trash" size=${13} /></button>
      </div>`;
    };
    const simpleRow = (kind, it, icon, name) => html`<div key=${it.id} class=${`mw-lrow${isSel(it.id) ? ' sel' : ''}`} onClick=${(e) => pickFromList({ kind, id: it.id }, e)} onDblClick=${() => focusOn(it.x ?? (it.pts?.[0] || 0), it.y ?? (it.pts?.[1] || 0))}>
      <span class="mw-lico"><${Icon} name=${icon} size=${13} /></span>
      <span class="grow ellipsis">${name}</span>
      <button type="button" class="mw-ico" title="Löschen" onClick=${(e) => { e.stopPropagation(); delOne(kind, it.id); }}><${Icon} name="trash" size=${13} /></button>
    </div>`;
    const match = (n) => !q || String(n).toLowerCase().includes(q);
    for (const [lay, label] of LAYERS) {
      const list = stapel(d.objects.filter((o) => (o.layer || objMeta(o)?.layer || 'obj') === lay && match(objMeta(o)?.name || '')));
      if (!list.length) continue;
      rows.push(html`<div class="mw-lgroup" key=${lay}><div class="mw-lgroup-t"><${Icon} name="layers" size=${12} />${label}<span class="badge">${list.length}</span></div>
        ${list.slice(0, 400).map((o) => objRow(o, lay))}${list.length > 400 ? html`<div class="tiny faint">… und ${list.length - 400} weitere (filtern)</div>` : null}</div>`);
    }
    const lights = (d.lights || []).filter(() => match('licht'));
    if (lights.length) rows.push(html`<div class="mw-lgroup" key="li"><div class="mw-lgroup-t"><${Icon} name="sun" size=${12} />Lichter<span class="badge">${lights.length}</span></div>${lights.map((l) => simpleRow('light', l, 'sun', `Licht ${r2(l.r || 4)} Felder`))}</div>`);
    const labels = d.labels.filter((l) => match(l.text));
    if (labels.length) rows.push(html`<div class="mw-lgroup" key="la"><div class="mw-lgroup-t"><${Icon} name="hash" size=${12} />Beschriftung<span class="badge">${labels.length}</span></div>${labels.map((l) => simpleRow('label', l, l.kind === 'room' ? 'hash' : 'quote', l.text))}</div>`);
    const terr = d.terrain.filter((x) => match(matLabel(x.mat)));
    if (terr.length) rows.push(html`<div class="mw-lgroup" key="te"><div class="mw-lgroup-t"><${Icon} name="brush" size=${12} />Belag & Gelände<span class="badge">${terr.length}</span></div>${terr.slice(0, 200).map((x) => simpleRow('terrain', x, 'brush', `${matLabel(x.mat)}${x.op === 'sub' ? ' (abgezogen)' : ''}`))}</div>`);
    const shapes = d.shapes.filter((x) => match(x.wall ? 'wand' : 'raum'));
    if (shapes.length) rows.push(html`<div class="mw-lgroup" key="sh"><div class="mw-lgroup-t"><${Icon} name="layout" size=${12} />Land & Wände<span class="badge">${shapes.length}</span></div>${shapes.slice(0, 200).map((x) => simpleRow('shape', x, x.wall ? 'minus' : 'layout', x.wall ? 'Zwischenwand' : { rect: 'Raum', ellipse: 'Runder Raum', poly: 'Polygon', path: 'Gang', brush: 'Pinselstrich', cells: 'Felder' }[x.kind] || 'Form'))}</div>`);
    return html`<aside class="sidebar right mw">
      <div class="sidebar-head"><button type="button" class="panel-select" onClick=${() => setSel([])}><${Icon} name="layers" size=${17} /><span class="t">Ebenen</span></button>
        ${isMobile() ? html`<${IconBtn} icon="x" title="Schließen" onClick=${() => ws.set({ drawer: null })} />` : null}</div>
      <div class="tree-filter"><${Icon} name="filter" size=${14} /><input class="input" value=${layerQ} onInput=${(e) => setLayerQ(e.target.value)} placeholder="Objekte filtern …" />${layerQ ? html`<${IconBtn} icon="x" size=${14} title="Filter löschen" onClick=${() => setLayerQ('')} />` : null}</div>
      <div class="sidebar-body mw-layers">
        ${sel.length ? html`<div class="mw-selinfo"><b>${sel.length}</b> ausgewählt <button type="button" class="ws-link tiny" onClick=${() => setSel([])}>aufheben</button></div>` : null}
        ${rows.length ? rows : html`<div class="tree-empty">Noch nichts auf der Karte.</div>`}
      </div>
    </aside>`;
  };

  // Seitenleisten der App mit den Werkstatt-Inhalten füllen
  // Signatur: nur wenn sich hieran etwas ändert, zeichnet die Hülle die Seitenleisten neu
  const panelSig = [
    mode, tool, shape, matShape, op, snap, width, brushW, wallThick, mat, matCat, shapeTex, doorKey, objKey,
    objScale, objRandom, objAlpha, objBlur, objShadow, objLayer, scatterSet, scatterR, scatterN, lightKind, lightR,
    textKind, fogBrush, showLight, layerQ, lDrag.id || '', lDrag.over || '', lDrag.zone || '', busy, gm, real, matMod, sidebarOpen, s.ver, s.geom, s.undo.length, s.redo.length,
    sel.map((x) => `${x.kind}:${x.id}`).join(','), map.fileId || '', map.bake?.fileId || '', map.fog?.enabled ? 1 : 0, B.combat?.active ? 1 : 0, B.showNames ? 1 : 0,
  ].join('|');
  useEffect(() => {
    if (!active) { clearPanels(tabId); return; }
    setPanels(tabId, { left: leftPanel, right: gm && mode === 'build' ? layersPanel : null, sig: panelSig });
  });
  useEffect(() => () => clearPanels(tabId), []);

  const actions = html`<div class="row nowrap" style="gap:2px">
    ${gm ? html`<${Segmented} value=${mode} onChange=${switchMode} options=${[{ value: 'build', label: 'Bauen', icon: 'hammer' }, { value: 'play', label: 'Spielen', icon: 'play' }]} />` : null}
    ${mode === 'build' ? html`<${IconBtn} icon="undo" title="Rückgängig (Strg+Z)" disabled=${!s.undo.length} onClick=${undo} />` : null}
    <${IconBtn} icon="maximize" title="Einpassen" onClick=${fit} />
    ${gm ? html`<${IconBtn} icon="settings" title="Karteneinstellungen" onClick=${settingsDialog} />` : null}
  </div>`;

  return html`<${ViewFrame} tabId=${tabId} title=${map.name} noScroll actions=${actions}>
    <div class="map-stage scrawl" ref=${wrapRef} style=${{ background: st.bg }}>
      <canvas ref=${cvRef} class=${`tool-${tool}`}></canvas>
      ${!sidebarOpen ? html`<div class="map-toolbar">
        ${tools.map(([id, icon, label]) => html`<${IconBtn} key=${id} icon=${icon} title=${label} active=${tool === id} onClick=${() => pickTool(id)} />`)}
        ${mode === 'build' && (tool === 'land' || tool === 'terrain') ? html`<div class="sep"></div>
          <${IconBtn} icon="plus" title="Hinzufügen" active=${op === 'add'} onClick=${() => setOp('add')} />
          <${IconBtn} icon="eraser" title="Entfernen / ausschneiden" active=${op === 'sub'} onClick=${() => setOp('sub')} />` : null}
      </div>` : null}
      ${(sidebarOpen && mode === 'build') || (mode === 'play' && (B.sel || B.pending)) ? null : html`<div class="map-hint">${s.draft && (s.draft.kind === 'poly' || s.draft.kind === 'path') ? html`<span>${HINTS[tool]}</span> <${Btn} size="sm" kind="primary" onClick=${() => s.finishDraft?.()}>Fertig<//> <${Btn} size="sm" kind="ghost" onClick=${() => { s.draft = null; s.dirty = true; rerender(); }}>Abbrechen<//>` : HINTS[tool]}</div>`}
      ${mode === 'play' ? html`<${BattleHud} B=${B} s=${s} editToken=${gm ? editToken : null} />` : null}
      ${measureText ? html`<div class="map-pop" style="left:60px;top:10px;width:auto"><${Icon} name="ruler" size=${14} /> <b>${measureText}</b></div>` : null}
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
