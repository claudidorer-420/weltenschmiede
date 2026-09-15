// 3D-Graph: exakt dieselben Knoten, Links und Farben wie die 2D-Ansicht – als drehbare, leuchtende Kugelwolke.
// Eigenes Kräftelayout in 3D (Startpositionen aus der 2D-Ansicht), gezeichnet auf Canvas ohne Bibliothek.
import { html, useState, useEffect, useRef } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, vault, isGM, createNote } from '../core/app.js';
import { openNote, openSearch } from '../core/workspace.js';
import { settings, updateSettings } from '../core/settings.js';
import { groupColor } from '../core/groups.js';
import { Icon, Btn } from '../ui/components.js';
import { buildData, layout2d } from './graph.js';

const TAU = Math.PI * 2;
const cssVar = (name, fb) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;

// ── Farben ──
let probe = null;
function rgbOf(color) {
  if (!probe) probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#888888';
  probe.fillStyle = color || '#888888';
  const v = probe.fillStyle;
  if (v.startsWith('#')) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  const m = v.match(/[\d.]+/g) || [136, 136, 136];
  return m.slice(0, 3).map(Number);
}
const mix = (a, b, t) => {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
};
const alpha = (c, a) => `rgba(${rgbOf(c).join(',')},${a})`;
const luminance = (c) => {
  const [r, g, b] = rgbOf(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

// Vorgerenderte Kugel mit Glanzlicht + weicher Schein je Farbe
const sprites = new Map();
function spriteFor(color) {
  let sp = sprites.get(color);
  if (sp) return sp;
  const S = 96;
  const r = S / 2;
  const ball = document.createElement('canvas');
  ball.width = S;
  ball.height = S;
  const c = ball.getContext('2d');
  const g = c.createRadialGradient(r * 0.7, r * 0.6, r * 0.06, r, r, r);
  g.addColorStop(0, mix(color, '#ffffff', 0.75));
  g.addColorStop(0.3, mix(color, '#ffffff', 0.2));
  g.addColorStop(0.78, color);
  g.addColorStop(1, mix(color, '#000000', 0.6));
  c.fillStyle = g;
  c.beginPath();
  c.arc(r, r, r - 1, 0, TAU);
  c.fill();
  const glow = document.createElement('canvas');
  glow.width = S;
  glow.height = S;
  const gc = glow.getContext('2d');
  const gg = gc.createRadialGradient(r, r, 0, r, r, r);
  gg.addColorStop(0, alpha(color, 0.6));
  gg.addColorStop(0.35, alpha(color, 0.2));
  gg.addColorStop(1, alpha(color, 0));
  gc.fillStyle = gg;
  gc.fillRect(0, 0, S, S);
  sp = { ball, glow };
  sprites.set(color, sp);
  return sp;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
const radius3d = (n, gs) => (3 + Math.sqrt(n.deg || 0) * 1.6) * (gs.nodeSize || 1) * 1.5;
const lim = (v) => Math.max(-40, Math.min(40, v));

// ── Kräfte in 3D (wie die 2D-Ansicht, plus z) ──
function step3d(s, gs) {
  if (s.alpha < 0.004 && !s.drag) return false;
  const N = s.nodes;
  const n = N.length;
  const a0 = s.alpha;
  const repel = 800 * (gs.repel || 1);
  const dist = 70 * (gs.linkDistance || 1);
  const center = 0.012 * (gs.centerForce || 1);
  const cutoff = 650 * 650;
  for (let i = 0; i < n; i++) {
    const a = N[i];
    for (let j = i + 1; j < n; j++) {
      const b = N[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dz = b.z - a.z;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > cutoff) continue;
      if (d2 < 0.01) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        dz = Math.random() - 0.5;
        d2 = dx * dx + dy * dy + dz * dz;
      }
      const d = Math.sqrt(d2);
      const f = (repel * a0) / Math.max(d2, 30);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      const fz = (dz / d) * f;
      a.vx -= fx; a.vy -= fy; a.vz -= fz;
      b.vx += fx; b.vy += fy; b.vz += fz;
    }
  }
  for (const l of s.links) {
    const a = l.a;
    const b = l.b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const w = 1 / Math.min(a.deg || 1, b.deg || 1);
    const k = ((d - dist) / d) * 0.12 * a0 * Math.max(0.25, w);
    a.vx += dx * k; a.vy += dy * k; a.vz += dz * k;
    b.vx -= dx * k; b.vy -= dy * k; b.vz -= dz * k;
  }
  for (const a of N) {
    a.vx -= a.x * center * a0;
    a.vy -= a.y * center * a0;
    a.vz -= a.z * center * a0;
    a.vx *= 0.55; a.vy *= 0.55; a.vz *= 0.55;
    a.x += lim(a.vx); a.y += lim(a.vy); a.z += lim(a.vz);
  }
  s.alpha *= 0.986;
  return true;
}

// Mittelpunkt und Ausdehnung der Wolke (Ausreißer zählen nicht)
function bounds(s) {
  const N = s.nodes;
  if (!N.length) return { c: [0, 0, 0], R: 200 };
  let cx = 0; let cy = 0; let cz = 0;
  for (const n of N) { cx += n.x; cy += n.y; cz += n.z; }
  cx /= N.length; cy /= N.length; cz /= N.length;
  const ds = N.map((n) => Math.hypot(n.x - cx, n.y - cy, n.z - cz)).sort((a, b) => a - b);
  return { c: [cx, cy, cz], R: Math.max(120, ds[Math.floor(ds.length * 0.92)] || 120) };
}

function fitCam(s, first) {
  const b = bounds(s);
  s.b = b;
  [s.cam.tx, s.cam.ty, s.cam.tz] = b.c;
  s.cam.dist = b.R * 2.5;
  if (first) { s.cam.yaw = 0.55; s.cam.pitch = -0.32; }
  s.fitted = true;
  s.dirty = true;
}
const clampDist = (s, d) => Math.max(Math.max(60, s.b.R * 0.25), Math.min(s.b.R * 8, d));

// Zielpunkt nie aus der Wolke herausschieben – so bleibt immer ein Teil des Graphen im Bild
function clampTarget(s) {
  const { c, R } = s.b;
  const dx = s.cam.tx - c[0];
  const dy = s.cam.ty - c[1];
  const dz = s.cam.tz - c[2];
  const d = Math.hypot(dx, dy, dz);
  const max = R * 0.9;
  if (d > max) {
    const k = max / d;
    s.cam.tx = c[0] + dx * k;
    s.cam.ty = c[1] + dy * k;
    s.cam.tz = c[2] + dz * k;
  }
}

// Verschieben in der Bildebene der Kamera
function panBy(s, dx, dy) {
  const k = s.cam.dist / s.focal;
  const cy = Math.cos(s.cam.yaw);
  const sy = Math.sin(s.cam.yaw);
  const cp = Math.cos(s.cam.pitch);
  const sp = Math.sin(s.cam.pitch);
  s.cam.tx -= (cy * dx - sy * sp * dy) * k;
  s.cam.ty -= cp * dy * k;
  s.cam.tz -= (-sy * dx - cy * sp * dy) * k;
  clampTarget(s);
}

function draw(s, cv, gs) {
  if (!cv || !s.w) return;
  const ctx = cv.getContext('2d');
  const dpr = s.dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { w, h } = s;
  const C = s.colors;
  const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
  bg.addColorStop(0, C.bg1);
  bg.addColorStop(1, C.bg0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const cy = Math.cos(s.cam.yaw);
  const sy = Math.sin(s.cam.yaw);
  const cp = Math.cos(s.cam.pitch);
  const sp = Math.sin(s.cam.pitch);
  const focal = s.focal;
  const pf0 = focal / s.cam.dist;
  let near = Infinity;
  let far = -Infinity;
  for (const n of s.nodes) {
    const x = n.x - s.cam.tx;
    const y = n.y - s.cam.ty;
    const z = n.z - s.cam.tz;
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const y1 = y * cp - z1 * sp;
    const depth = y * sp + z1 * cp + s.cam.dist;
    n.pd = depth;
    n.pv = depth > 8;
    if (!n.pv) continue;
    const f = focal / depth;
    n.px = w / 2 + x1 * f;
    n.py = h / 2 + y1 * f;
    n.pf = f / pf0;
    n.pr = Math.max(1.2, radius3d(n, gs) * f);
    if (depth < near) near = depth;
    if (depth > far) far = depth;
  }
  const range = Math.max(1, far - near);
  const fog = (d) => 1 - 0.7 * Math.min(1, Math.max(0, (d - near) / range));
  const hov = s.hover || (s.focus ? s.byId.get(s.focus) : null);
  const nb = hov ? s.adj.get(hov.id) || new Set() : null;
  const q = s.query;
  const matches = (n) => !q || n.label.toLowerCase().includes(q);

  // Verbindungen
  ctx.lineCap = 'round';
  for (const l of s.links) {
    const a = l.a;
    const b = l.b;
    if (!a.pv || !b.pv) continue;
    const hi = hov && (a === hov || b === hov);
    const dim = (hov && !hi) || (q && !(matches(a) || matches(b)));
    ctx.globalAlpha = hi ? 0.9 : dim ? 0.04 : 0.3 * fog((a.pd + b.pd) / 2);
    ctx.strokeStyle = hi ? C.accent : a.color || b.color || C.line;
    ctx.lineWidth = Math.max(0.35, (hi ? 1.6 : 0.8) * (gs.linkWidth || 1) * Math.min(2, (a.pf + b.pf) / 2));
    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    ctx.stroke();
  }

  // Kugeln von hinten nach vorn
  const vis = s.nodes.filter((n) => n.pv && n.px > -60 && n.py > -60 && n.px < w + 60 && n.py < h + 60).sort((a, b) => b.pd - a.pd);
  for (const n of vis) {
    const r = n.pr;
    const important = n === hov || nb?.has(n.id);
    const dim = (hov && !important) || (q && !matches(n));
    const col = n.id === s.focus && !s.hover ? C.accent : n.color || (n.kind === 'unresolved' ? C.faint : C.node);
    const spr = spriteFor(col);
    const a = dim ? 0.1 : Math.max(0.32, fog(n.pd));
    if (!dim && s.dark && (n.deg >= 2 || important)) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (important ? 0.85 : 0.4) * a;
      const g = r * (important ? 4.4 : 3.2);
      ctx.drawImage(spr.glow, n.px - g, n.py - g, g * 2, g * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = a;
    ctx.drawImage(spr.ball, n.px - r, n.py - r, r * 2, r * 2);
    if (n === hov) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.accent;
      ctx.beginPath();
      ctx.arc(n.px, n.py, r + 3, 0, TAU);
      ctx.stroke();
    }
  }

  // Beschriftungen: nahe, große und wichtige Knoten (begrenzt)
  const fade = gs.textFade || 1;
  const labels = vis.filter((n) => n === hov || nb?.has(n.id) || n.id === s.focus || (q && matches(n)) || n.pr > 7 / fade || n.deg >= s.bigDeg)
    .sort((a, b) => a.pd - b.pd).slice(0, 70);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const n of labels) {
    const important = n === hov || nb?.has(n.id) || n.id === s.focus;
    if ((hov && !important) || (q && !matches(n))) continue;
    const fs = Math.round(Math.max(10, Math.min(17, 8.5 + n.pf * 3.5)));
    ctx.font = `${important ? 650 : 500} ${fs}px ui-sans-serif, system-ui, sans-serif`;
    ctx.globalAlpha = important ? 1 : Math.max(0.35, fog(n.pd));
    const label = n.label.length > 36 ? `${n.label.slice(0, 34)}…` : n.label;
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.halo;
    ctx.strokeText(label, n.px, n.py + n.pr + 3);
    ctx.fillStyle = important ? C.strong : C.text;
    ctx.fillText(label, n.px, n.py + n.pr + 3);
  }
  ctx.globalAlpha = 1;
}

export function Graph3D({ active, focus, query = '' }) {
  const wrapRef = useRef();
  const canvasRef = useRef();
  const S = useRef(null);
  if (!S.current) {
    S.current = {
      nodes: [], byId: new Map(), links: [], adj: new Map(), alpha: 1, hover: null, drag: null, pinch: null, pointers: new Map(),
      cam: { yaw: 0.55, pitch: -0.32, dist: 800, tx: 0, ty: 0, tz: 0 }, b: { c: [0, 0, 0], R: 300 }, w: 0, h: 0, focal: 600,
      fitted: false, dirty: true, colors: {}, idleAt: 0, bigDeg: 4, frame: 0,
    };
  }
  const version = useStore(vault, (s) => s.version);
  const gs = useStore(settings, (s) => s.graph);
  const theme = useStore(settings, (s) => `${s.theme}${s.accent}`);
  const lens = useStore(app, (s) => `${s.role}:${s.viewAsPlayer}`);
  const [count, setCount] = useState(0);
  const spin = gs.spin !== false;

  useEffect(() => {
    const s = S.current;
    const bgc = cssVar('--bg', '#0b0b0f');
    s.dark = luminance(bgc) < 0.45;
    s.colors = {
      node: cssVar('--text-2', '#bbb'), faint: cssVar('--text-3', '#666'), line: cssVar('--border-2', '#555'), text: cssVar('--text-2', '#bbb'),
      strong: cssVar('--text', '#eee'), accent: cssVar('--accent', '#8a5cf5'),
      bg0: s.dark ? mix(bgc, '#000000', 0.55) : mix(bgc, '#d8d4c8', 0.35), bg1: s.dark ? mix(bgc, '#1b2030', 0.55) : mix(bgc, '#ffffff', 0.6),
      halo: s.dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.85)',
    };
    s.dirty = true;
  }, [theme]);

  // Dieselben Daten wie die 2D-Ansicht; neue Knoten starten an ihrer 2D-Position
  useEffect(() => {
    const s = S.current;
    const data = buildData({ gs });
    const old = s.byId;
    const seed = layout2d.byId;
    const spread = Math.sqrt(data.nodes.length) * 22;
    const byId = new Map();
    let fresh = 0;
    for (const n of data.nodes) {
      const prev = old.get(n.id);
      let node;
      if (prev) node = Object.assign(prev, { label: n.label, kind: n.kind, note: n.note, deg: n.deg });
      else {
        const p2 = seed?.get(n.id);
        node = {
          ...n,
          x: p2 ? p2.x : (hash(n.id) - 0.5) * spread * 2,
          y: p2 ? p2.y : (hash(`${n.id}:y`) - 0.5) * spread * 2,
          z: (hash(`${n.id}:z`) - 0.5) * spread * 1.6,
          vx: 0, vy: 0, vz: 0,
        };
        fresh++;
      }
      node.color = n.kind === 'note' ? groupColor(n.note, gs.groups) : n.kind === 'tag' ? '#4cc38a' : null;
      byId.set(n.id, node);
    }
    s.nodes = [...byId.values()];
    s.byId = byId;
    s.adj = data.adj;
    s.links = data.links.map(([a, b]) => ({ a: byId.get(a), b: byId.get(b) })).filter((l) => l.a && l.b);
    const degs = s.nodes.map((n) => n.deg || 0).sort((a, b) => b - a);
    s.bigDeg = Math.max(3, degs[Math.floor(degs.length * 0.06)] || 3);
    s.alpha = Math.max(s.alpha, fresh ? 1 : 0.3);
    if (fresh > 5) {
      for (let i = 0; i < 160; i++) step3d(s, gs);
      s.fitted = false;
    }
    s.dirty = true;
    setCount(s.nodes.length);
  }, [version, gs.showOrphans, gs.showUnresolved, gs.showTags, gs.groups, lens]);

  useEffect(() => { S.current.focus = focus || null; S.current.dirty = true; }, [focus]);
  useEffect(() => { S.current.query = query.toLowerCase(); S.current.dirty = true; }, [query]);
  useEffect(() => { S.current.alpha = Math.max(S.current.alpha, 0.3); S.current.dirty = true; }, [gs.repel, gs.linkDistance, gs.centerForce, gs.nodeSize, gs.linkWidth, gs.textFade]);

  useEffect(() => {
    const el = wrapRef.current;
    const cv = canvasRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      const s = S.current;
      s.w = r.width;
      s.h = r.height;
      s.dpr = dpr;
      s.focal = Math.min(r.width, r.height) * 0.95;
      s.dirty = true;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let raf;
    const loop = () => {
      const s = S.current;
      const g = settings.get().graph;
      const moved = step3d(s, g);
      if (!s.fitted && s.w > 10 && s.nodes.length) fitCam(s, !s.everFitted), (s.everFitted = true);
      else if (moved && ++s.frame % 12 === 0) { s.b = bounds(s); clampTarget(s); }
      if (g.spin !== false && !s.drag && !s.pinch && performance.now() - s.idleAt > 2500) {
        s.cam.yaw += 0.0022;
        s.dirty = true;
      }
      if (moved || s.dirty) {
        draw(s, canvasRef.current, g);
        s.dirty = false;
      }
      raf = requestAnimationFrame(loop);
    };
    S.current.dirty = true;
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  useEffect(() => {
    const cv = canvasRef.current;
    const s = S.current;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const hit = (x, y) => {
      let best = null;
      let bd = Infinity;
      for (const n of s.nodes) {
        if (!n.pv) continue;
        const r = Math.max(5, n.pr) + 5;
        const d = (n.px - x) ** 2 + (n.py - y) ** 2;
        if (d < r * r && n.pd < bd) { bd = n.pd; best = n; }
      }
      return best;
    };
    const activate = async (n, e) => {
      const newTab = e.ctrlKey || e.metaKey;
      if (n.kind === 'note') openNote(n.id, { newTab });
      else if (n.kind === 'tag') openSearch(`tag:${n.label}`);
      else if (n.kind === 'unresolved' && isGM()) {
        const created = await createNote({ title: n.label });
        openNote(created.id, { newTab });
      }
    };
    const down = (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e);
      s.pointers.set(e.pointerId, p);
      s.idleAt = performance.now();
      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        s.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: s.cam.dist, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        s.drag = null;
        return;
      }
      const pan = e.button === 1 || e.button === 2 || e.shiftKey;
      s.drag = { sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false, node: pan ? null : hit(p.x, p.y), mode: pan ? 'pan' : 'rotate' };
      cv.classList.add('dragging');
    };
    const move = (e) => {
      const p = pos(e);
      if (s.pointers.has(e.pointerId)) s.pointers.set(e.pointerId, p);
      if (s.pinch && s.pointers.size >= 2) {
        const [a, b] = [...s.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        s.cam.dist = clampDist(s, s.pinch.dist * (s.pinch.d / Math.max(10, d)));
        panBy(s, mid.x - s.pinch.mid.x, mid.y - s.pinch.mid.y);
        s.pinch.mid = mid;
        s.idleAt = performance.now();
        s.dirty = true;
        return;
      }
      if (s.drag) {
        const dx = p.x - s.drag.lx;
        const dy = p.y - s.drag.ly;
        s.drag.lx = p.x;
        s.drag.ly = p.y;
        if (Math.hypot(p.x - s.drag.sx, p.y - s.drag.sy) > 4) s.drag.moved = true;
        if (!s.drag.moved) return;
        if (s.drag.mode === 'pan') panBy(s, dx, dy);
        else {
          s.cam.yaw += dx * 0.006;
          s.cam.pitch = Math.max(-1.45, Math.min(1.45, s.cam.pitch + dy * 0.006));
        }
        s.idleAt = performance.now();
        s.dirty = true;
        return;
      }
      if (e.pointerType === 'mouse') {
        const hv = hit(p.x, p.y);
        if (hv !== s.hover) {
          s.hover = hv;
          cv.style.cursor = hv ? 'pointer' : 'grab';
          s.dirty = true;
        }
      }
    };
    const up = (e) => {
      s.pointers.delete(e.pointerId);
      cv.classList.remove('dragging');
      if (s.pinch) {
        if (s.pointers.size < 2) s.pinch = null;
        return;
      }
      const d = s.drag;
      s.drag = null;
      if (d && !d.moved && d.node) activate(d.node, e);
      else if (d && !d.moved && e.pointerType !== 'mouse') { s.hover = null; s.dirty = true; }
    };
    const wheel = (e) => {
      e.preventDefault();
      s.cam.dist = clampDist(s, s.cam.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)));
      s.idleAt = performance.now();
      s.dirty = true;
    };
    const dbl = (e) => {
      const p = pos(e);
      if (!hit(p.x, p.y)) fitCam(s, false);
    };
    const leave = () => { s.hover = null; s.dirty = true; };
    const ctx = (e) => e.preventDefault();
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('dblclick', dbl);
    cv.addEventListener('pointerleave', leave);
    cv.addEventListener('contextmenu', ctx);
    return () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('wheel', wheel);
      cv.removeEventListener('dblclick', dbl);
      cv.removeEventListener('pointerleave', leave);
      cv.removeEventListener('contextmenu', ctx);
    };
  }, []);

  const reheat = () => { S.current.alpha = 1; S.current.fitted = false; };
  return html`<div class="graph-wrap" ref=${wrapRef}>
    <canvas ref=${canvasRef}></canvas>
    ${!count ? html`<div class="empty" style="position:absolute;inset:0;justify-content:center;pointer-events:none"><${Icon} name="graph" size=${40} /><p>Noch keine verknüpften Notizen. Verlinke Notizen mit [[…]], dann entsteht hier dein Netz.</p></div>` : null}
    <div class="g3-hint">${count} Knoten · Ziehen dreht · Rechtsklick, ⇧ oder zwei Finger verschieben · Mausrad/Pinch zoomt · Doppelklick zentriert</div>
    <div class="g3-tools">
      <${Btn} size="sm" icon=${spin ? 'pause' : 'play'} onClick=${() => { updateSettings({ graph: { spin: !spin } }); S.current.idleAt = 0; }}>${spin ? 'Drehung aus' : 'Drehen'}<//>
      <${Btn} size="sm" icon="maximize" onClick=${() => fitCam(S.current, false)}>Zentrieren<//>
      <${Btn} size="sm" icon="refresh" onClick=${reheat}>Neu anordnen<//>
    </div>
  </div>`;
}
