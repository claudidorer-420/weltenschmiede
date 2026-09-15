// Würfel in 3D ohne Bibliothek: Polyeder (W4 … W20) mit Licht, Kanten und Zahlen auf den Flächen, Wurf mit Schwerkraft,
// Abprall und Kollisionen. Am Ende dreht sich die gewürfelte Fläche zum Betrachter – wie ein echter Würfel auf dem Tisch.

// ───────────────────────── Vektoren & Quaternionen ─────────────────────────
const PHI = (1 + Math.sqrt(5)) / 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rand3 = () => [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];

const qMul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qNorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
function qAxis(ax, ang) {
  const n = norm(ax);
  const s = Math.sin(ang / 2);
  return [Math.cos(ang / 2), n[0] * s, n[1] * s, n[2] * s];
}
const qRandom = () => qNorm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
function qMat(q) {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}
const mv = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
function matToQuat(m) {
  const tr = m[0][0] + m[1][1] + m[2][2];
  let w; let x; let y; let z;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[2][1] - m[1][2]) / s; x = s / 4; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = s / 4; z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = s / 4;
  }
  return qNorm([w, x, y, z]);
}
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { bb = b.map((v) => -v); d = -d; }
  if (d > 0.9995) return qNorm(a.map((v, i) => v + (bb[i] - v) * t));
  const th = Math.acos(d);
  const s = Math.sin(th);
  return a.map((v, i) => (v * Math.sin((1 - t) * th) + bb[i] * Math.sin(t * th)) / s);
}

// ───────────────────────── Körper ─────────────────────────
function centroid(verts, f) {
  const c = [0, 0, 0];
  for (const i of f) { c[0] += verts[i][0]; c[1] += verts[i][1]; c[2] += verts[i][2]; }
  return mul(c, 1 / f.length);
}
function orderFace(verts, idx) {
  const c = centroid(verts, idx);
  const n = norm(c);
  const r = sub(verts[idx[0]], c);
  const ang = (k) => { const d = sub(verts[k], c); return Math.atan2(dot(cross(r, d), n), dot(r, d)); };
  return [...idx].sort((i, j) => ang(i) - ang(j));
}
function triFaces(verts, edge) {
  const out = [];
  const near = (a, b) => Math.abs(len(sub(verts[a], verts[b])) - edge) < 1e-3;
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      if (!near(i, j)) continue;
      for (let k = j + 1; k < verts.length; k++) if (near(i, k) && near(j, k)) out.push(orderFace(verts, [i, j, k]));
    }
  }
  return out;
}
const GEO = {};
function geometry(kind) {
  if (GEO[kind]) return GEO[kind];
  let verts;
  let faces;
  if (kind === 4) {
    verts = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    faces = triFaces(verts, Math.sqrt(8));
  } else if (kind === 6) {
    verts = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) verts.push([x, y, z]);
    faces = [];
    for (let a = 0; a < 3; a++) for (const s of [-1, 1]) faces.push(orderFace(verts, verts.map((v, i) => (v[a] === s ? i : -1)).filter((i) => i >= 0)));
  } else if (kind === 8) {
    verts = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    faces = triFaces(verts, Math.SQRT2);
  } else if (kind === 10) {
    verts = [[0, 0, 1.05], [0, 0, -1.05]];
    const zr = 0.11;
    for (let i = 0; i < 5; i++) { const a = (i * 2 * Math.PI) / 5; verts.push([Math.cos(a), Math.sin(a), zr]); }
    for (let i = 0; i < 5; i++) { const a = (i * 2 * Math.PI) / 5 + Math.PI / 5; verts.push([Math.cos(a), Math.sin(a), -zr]); }
    faces = [];
    for (let i = 0; i < 5; i++) {
      const u = 2 + i;
      const u2 = 2 + ((i + 1) % 5);
      const l = 7 + i;
      const l2 = 7 + ((i + 1) % 5);
      faces.push(orderFace(verts, [0, u, l, u2]));
      faces.push(orderFace(verts, [1, l, u2, l2]));
    }
  } else if (kind === 12) {
    const ico = geometry(20);
    verts = ico.faces.map((f) => norm(centroid(ico.verts, f)));
    faces = ico.verts.map((_, vi) => orderFace(verts, ico.faces.map((f, fi) => (f.includes(vi) ? fi : -1)).filter((i) => i >= 0)));
  } else {
    verts = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) verts.push([0, a, b * PHI], [a, b * PHI, 0], [b * PHI, 0, a]);
    faces = triFaces(verts, 2);
  }
  const r = Math.max(...verts.map(len));
  verts = verts.map((v) => mul(v, 1 / r));
  const cents = faces.map((f) => centroid(verts, f));
  const normals = cents.map(norm);
  // „Oben“ einer Zahl: zur Spitze (W10), zur Kantenmitte (W6) oder zur ersten Ecke
  const ups = faces.map((f, i) => {
    const c = cents[i];
    let u;
    if (kind === 10) u = sub(verts[normals[i][2] > 0 ? 0 : 1], c);
    else if (kind === 6) u = sub(mul(add(verts[f[0]], verts[f[1]]), 0.5), c);
    else u = sub(verts[f[0]], c);
    const n = normals[i];
    return norm(sub(u, mul(n, dot(u, n))));
  });
  const rights = ups.map((u, i) => cross(normals[i], u));
  const faceR = faces.map((f, i) => f.reduce((s, k) => s + len(sub(verts[k], cents[i])), 0) / f.length);
  // Zahlen: gegenüberliegende Flächen ergeben zusammen N+1 (wie bei echten Würfeln)
  const N = faces.length;
  let labels = new Array(N).fill(0);
  if (kind === 4) labels = labels.map((_, i) => i + 1);
  else {
    const used = new Set();
    let k = 1;
    for (let i = 0; i < N; i++) {
      if (used.has(i)) continue;
      const j = normals.findIndex((m, jj) => !used.has(jj) && jj !== i && dot(m, normals[i]) < -0.98);
      used.add(i);
      labels[i] = k;
      if (j >= 0) { used.add(j); labels[j] = N + 1 - k; }
      k++;
    }
    if (new Set(labels).size !== N) labels = labels.map((_, i) => i + 1);
  }
  GEO[kind] = { kind, verts, faces, cents, normals, ups, rights, faceR, labels };
  return GEO[kind];
}

// Zielausrichtung: Fläche f zeigt zum Betrachter, Zahl steht aufrecht
function targetQuat(g, f) {
  const n = g.normals[f];
  const a = g.ups[f];
  const b = g.rights[f];
  const ta = [0, -1, 0];
  const tb = [1, 0, 0];
  const tn = [0, 0, 1];
  const m = [0, 1, 2].map((i) => [0, 1, 2].map((j) => ta[i] * a[j] + tb[i] * b[j] + tn[i] * n[j]));
  return matToQuat(m);
}

// Für Tests (tools/…): Geometrie und Zielausrichtung prüfen
export const diceMath = { geometry, targetQuat, qMat, mv };

// ───────────────────────── Aussehen ─────────────────────────
export const DICE_COLORS = {
  4: ['#35d0d2', '#0c5f64'], 6: ['#f0666b', '#7d151c'], 8: ['#48d993', '#0f5c38'], 10: ['#ffa24d', '#8a3f02'],
  12: ['#5b97ff', '#173a86'], 20: ['#9c72ff', '#35178a'], 100: ['#e8bc55', '#6e500d'], F: ['#a3a3a3', '#3d3d3d'],
};
const BONUS = ['#ffd45c', '#8a6a00'];
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const LIGHT = norm([-0.45, -0.75, 1]);
const HALF = norm(add(LIGHT, [0, 0, 1]));
function shade(rgb, n) {
  const diff = Math.max(0, dot(n, LIGHT));
  const spec = Math.max(0, dot(n, HALF)) ** 30;
  const f = 0.42 + 0.62 * diff;
  const c = (v) => Math.min(255, Math.round(v * f + 255 * spec * 0.5));
  return `rgb(${c(rgb[0])},${c(rgb[1])},${c(rgb[2])})`;
}
const shapeOf = (s) => (s === 'F' ? 6 : s === 100 ? 10 : [4, 6, 8, 10, 12, 20].includes(s) ? s : s <= 4 ? 4 : s <= 6 ? 6 : s <= 8 ? 8 : s <= 10 ? 10 : s <= 12 ? 12 : 20);

// Physische Würfel eines Wurfs (W100 = Zehner- + Einer-W10, Fudge = W6 mit +/−)
export function expandDice(dice) {
  const out = [];
  for (const d of dice || []) {
    if (d.sides === 100) {
      const v = d.value;
      out.push({ ...d, shape: 10, color: 100, text: (L) => `${(L % 10) * 10}`.padStart(2, '0'), final: v === 100 ? '00' : `${Math.floor(v / 10) * 10}`.padStart(2, '0') });
      out.push({ ...d, shape: 10, color: 100, text: (L) => String(L % 10), final: String(v % 10) });
    } else if (d.sides === 'F') {
      out.push({ ...d, shape: 6, color: 'F', text: (L) => ['+', '−', ' ', ' ', '−', '+'][L - 1], final: d.value > 0 ? '+' : d.value < 0 ? '−' : ' ' });
    } else {
      const k = shapeOf(d.sides);
      const t = (L) => (k >= 8 && (L === 6 || L === 9) ? `${L}.` : String(L));
      out.push({ ...d, shape: k, color: DICE_COLORS[d.sides] ? d.sides : k, text: t, final: t(d.value) });
    }
  }
  return out;
}

function drawDie(ctx, d, alpha) {
  const g = d.geo;
  const R = qMat(d.q);
  const s = d.size / 2;
  const cx = d.x;
  const cy = d.y - d.z * 0.45;
  const P = g.verts.map((v) => { const p = mv(R, v); return [cx + p[0] * s, cy + p[1] * s, p[2]]; });
  const vis = [];
  g.faces.forEach((f, i) => {
    const n = mv(R, g.normals[i]);
    if (n[2] > 0.015) vis.push({ i, n, z: f.reduce((a, k) => a + P[k][2], 0) / f.length });
  });
  vis.sort((a, b) => a.z - b.z);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  for (const { i, n } of vis) {
    const f = g.faces[i];
    ctx.beginPath();
    f.forEach((k, j) => (j ? ctx.lineTo(P[k][0], P[k][1]) : ctx.moveTo(P[k][0], P[k][1])));
    ctx.closePath();
    ctx.fillStyle = shade(d.rgb, n);
    ctx.fill();
    ctx.strokeStyle = d.edge;
    ctx.lineWidth = Math.max(1, d.size / 55);
    ctx.stroke();
    if (n[2] < 0.3) continue;
    const label = d.text(g.labels[i]);
    if (!label.trim()) continue;
    const c = mv(R, g.cents[i]);
    const ux = mv(R, g.rights[i]);
    const uy = mv(R, mul(g.ups[i], -1));
    const k = s / 100;
    const fs = g.faceR[i] * (g.kind === 4 ? 0.62 : g.kind === 10 ? 0.52 : g.kind === 20 ? 0.56 : 0.66) * (label.replace('.', '').length > 1 ? 0.78 : 1) * 100;
    ctx.save();
    ctx.translate(cx + c[0] * s, cy + c[1] * s);
    ctx.transform(ux[0] * k, ux[1] * k, uy[0] * k, uy[1] * k, 0, 0);
    ctx.globalAlpha = alpha * Math.min(1, (n[2] - 0.3) / 0.3);
    ctx.font = `800 ${fs}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = fs * 0.14;
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.strokeText(label, 0, fs * 0.04);
    ctx.fillStyle = d.ink;
    ctx.fillText(label, 0, fs * 0.04);
    ctx.restore();
  }
  ctx.restore();
}
function drawShadow(ctx, d, alpha) {
  const s = d.size;
  const k = Math.max(0.45, 1 - d.z / 420);
  ctx.save();
  ctx.globalAlpha = 0.3 * alpha * k;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(d.x + s * 0.08, d.y + s * 0.32, s * 0.46 * k, s * 0.19 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function drawGlow(ctx, d, color, alpha) {
  const r = d.size * 0.85;
  const g = ctx.createRadialGradient(d.x, d.y, r * 0.2, d.x, d.y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ───────────────────────── Szene ─────────────────────────
// mode 'overlay': Würfel fliegen von rechts unten über die App und verblassen; 'tray': Schale, Würfel bleiben liegen
export function createDiceScene(canvas, { mode = 'overlay' } = {}) {
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  const groups = [];
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    const pw = Math.max(1, Math.round(W * dpr));
    const ph = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; if (!raf) render(performance.now()); }
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  function makeDie(d, S, i) {
    const geo = geometry(d.shape);
    const [c1, c2] = d.bonus ? BONUS : DICE_COLORS[d.color] || DICE_COLORS[20];
    let face = geo.labels.findIndex((L) => d.text(L) === d.final);
    if (face < 0) face = 0;
    const die = {
      geo, size: S, rgb: hexRgb(c1), edge: `${c2}cc`, ink: d.bonus ? '#3b2a00' : '#ffffff', text: d.text, final: d.final, face,
      dropped: !!d.dropped, main: !!d.main, value: d.value, sides: d.sides, tag: d.adj != null ? `→${d.adj}` : d.from || d.note === 'Glück' ? '↻' : d.exploded ? '!' : '',
      z: 20 + Math.random() * 60, vz: 420 + Math.random() * 260, q: qRandom(), w: mul(norm(rand3()), 15 + Math.random() * 10),
      state: 'fly', delay: i * 55, age: 0, bounces: 0, entered: false,
    };
    if (mode === 'overlay') {
      die.x = W + S + Math.random() * 80;
      die.y = H * (0.55 + Math.random() * 0.35);
      const tx = W * (0.3 + Math.random() * 0.36);
      const ty = H * (0.28 + Math.random() * 0.32);
      const T = 0.62 + Math.random() * 0.2;
      die.vx = (tx - die.x) / T;
      die.vy = (ty - die.y) / T;
    } else {
      die.x = -S - Math.random() * 30;
      die.y = S / 2 + Math.random() * Math.max(1, H - S);
      die.vx = (0.9 + Math.random() * 0.6) * Math.max(520, W * 1.3);
      die.vy = (Math.random() - 0.5) * 500;
    }
    return die;
  }
  function restAt(die, x, y) {
    Object.assign(die, { x, y, z: 0, vx: 0, vy: 0, vz: 0, q: targetQuat(die.geo, die.face), state: 'rest', delay: 0, entered: true });
  }
  function startSettle(d) {
    d.state = 'settle';
    d.st = 0;
    d.q0 = d.q;
    d.qT = targetQuat(d.geo, d.face);
  }
  function physics(d, dt) {
    d.age += dt;
    const m = d.size * 0.5;
    if (d.state === 'fly') {
      d.vz -= 2600 * dt;
      d.z += d.vz * dt;
      const drag = Math.max(0, 1 - (d.bounces ? 2.4 : 0.5) * dt);
      d.vx *= drag;
      d.vy *= drag;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.z <= 0) {
        d.z = 0;
        if (Math.abs(d.vz) > 140) {
          d.vz = -d.vz * 0.42;
          d.bounces++;
          d.vx *= 0.78;
          d.vy *= 0.78;
          d.w = add(mul(d.w, 0.72), mul(norm(rand3()), 3));
        } else d.vz = 0;
      }
      if (mode === 'overlay' ? d.x < W - m : d.x > m) d.entered = true;
      if (d.entered) {
        if (d.x > W - m) { d.x = W - m; d.vx = -Math.abs(d.vx) * 0.6; }
        if (d.x < m) { d.x = m; d.vx = Math.abs(d.vx) * 0.6; }
      }
      if (d.y < m) { d.y = m; d.vy = Math.abs(d.vy) * 0.6; }
      if (d.y > H - m) { d.y = H - m; d.vy = -Math.abs(d.vy) * 0.6; }
      const wl = len(d.w);
      if (wl > 0.01) d.q = qNorm(qMul(qAxis(d.w, wl * dt), d.q));
      d.w = mul(d.w, Math.max(0, 1 - (d.z > 0 ? 0.3 : 2.6) * dt));
      const sp = Math.hypot(d.vx, d.vy);
      if ((d.bounces >= 2 && d.z === 0 && sp < 70 && len(d.w) < 6) || d.age > 2) startSettle(d);
    } else if (d.state === 'settle') {
      d.st += dt / 0.34;
      const t = Math.min(1, d.st);
      d.q = slerp(d.q0, d.qT, 1 - (1 - t) ** 3);
      d.vx *= 0.82;
      d.vy *= 0.82;
      d.x = Math.max(m, Math.min(W - m, d.x + d.vx * dt));
      d.y = Math.max(m, Math.min(H - m, d.y + d.vy * dt));
      d.z = Math.max(0, d.z - 500 * dt);
      if (t >= 1) { d.state = 'rest'; d.z = 0; }
    }
  }
  function collide(dice) {
    for (let i = 0; i < dice.length; i++) {
      const a = dice[i];
      if (a.delay > 0) continue;
      for (let j = i + 1; j < dice.length; j++) {
        const b = dice[j];
        if (b.delay > 0 || (a.state === 'rest' && b.state === 'rest')) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const min = (a.size + b.size) * 0.42;
        if (dist >= min) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const push = min - dist;
        const aFix = a.state === 'rest';
        const bFix = b.state === 'rest';
        if (aFix) { b.x += nx * push; b.y += ny * push; } else if (bFix) { a.x -= nx * push; a.y -= ny * push; } else {
          a.x -= (nx * push) / 2; a.y -= (ny * push) / 2; b.x += (nx * push) / 2; b.y += (ny * push) / 2;
        }
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = -rel * 0.8;
          if (!aFix) { a.vx -= nx * imp / (bFix ? 1 : 2); a.vy -= ny * imp / (bFix ? 1 : 2); }
          if (!bFix) { b.vx += nx * imp / (aFix ? 1 : 2); b.vy += ny * imp / (aFix ? 1 : 2); }
        }
      }
    }
  }
  const fadeOf = (g, now) => (g.persist || !g.done ? 1 : Math.max(0, 1 - Math.max(0, now - g.doneAt - 1400) / 1000));
  function render(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const all = [];
    for (const g of groups) for (const d of g.dice) if (d.delay <= 0) all.push({ d, a: fadeOf(g, now) });
    for (const { d, a } of all) drawShadow(ctx, d, a);
    all.sort((p, q) => p.d.y - q.d.y);
    for (const { d, a } of all) {
      if (d.state === 'rest' && d.main && !d.dropped && d.sides === 20 && (d.value === 20 || d.value === 1)) drawGlow(ctx, d, d.value === 20 ? 'rgba(80,255,150,.55)' : 'rgba(255,70,70,.55)', a);
      drawDie(ctx, d, a * (d.dropped && d.state === 'rest' ? 0.42 : 1));
      if (d.state === 'rest' && d.tag) {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.font = `800 ${Math.round(d.size * 0.26)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.7)';
        ctx.strokeText(d.tag, d.x + d.size * 0.42, d.y - d.size * 0.42);
        ctx.fillStyle = '#ffd45c';
        ctx.fillText(d.tag, d.x + d.size * 0.42, d.y - d.size * 0.42);
        ctx.restore();
      }
    }
  }
  function step(now) {
    raf = 0;
    // In Teilschritten rechnen: auch wenn der Browser Bilder auslässt (Hintergrund, schwaches Gerät), läuft der Wurf in Echtzeit
    let rest = Math.min(0.3, Math.max(0, (now - last) / 1000));
    last = now;
    while (rest > 0) {
      const dt = Math.min(0.016, rest);
      rest -= dt;
      for (const g of groups) {
        for (const d of g.dice) {
          if (d.delay > 0) { d.delay -= dt * 1000; continue; }
          if (d.state !== 'rest') physics(d, dt);
        }
        collide(g.dice);
      }
    }
    for (const g of groups) {
      const active = g.dice.some((d) => d.delay > 0 || d.state !== 'rest');
      if (!active && !g.done) {
        g.done = true;
        g.doneAt = now;
        try { g.onDone?.(g.roll); } catch (e) { console.warn(e); }
      }
    }
    render(now);
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (g.done && !g.persist && now - g.doneAt > 2500) groups.splice(i, 1);
    }
    if (groups.some((g) => !g.done || (!g.persist && now - g.doneAt <= 2500))) raf = requestAnimationFrame(step);
    else if (!groups.length) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); }
  }
  function start() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(step);
  }

  return {
    throwRoll(roll, { onDone, persist = false, animate = true } = {}) {
      resize();
      const list = expandDice(roll?.dice).slice(0, 30);
      if (!list.length || !W || !H) { onDone?.(roll); return; }
      const n = list.length;
      const S = Math.round(Math.max(30, Math.min(mode === 'overlay' ? 84 : 70, W / (1.3 + n * 0.55), H / 1.7, Math.sqrt(W * H) / (1.25 + Math.sqrt(n)))));
      const dice = list.map((d, i) => makeDie(d, S, i));
      const g = { roll, dice, onDone, persist, done: false };
      groups.push(g);
      if (!animate) {
        const cols = Math.max(1, Math.floor(W / (S * 1.15)));
        dice.forEach((d, i) => restAt(d, S * 0.65 + (i % cols) * S * 1.15, S * 0.65 + Math.floor(i / cols) * S * 1.15));
        g.done = true;
        g.doneAt = performance.now();
        render(g.doneAt);
        onDone?.(roll);
        return;
      }
      start();
    },
    clear() {
      groups.length = 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
    },
    busy: () => groups.some((g) => !g.done),
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      groups.length = 0;
    },
  };
}
