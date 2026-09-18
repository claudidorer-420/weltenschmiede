// Kartenwerkstatt ohne Oberfläche: Stile, Geländematerialien, Stempel-Sets und Generatoren.
// Wird vom Karten-Editor und vom MCP-Server (mcp/) gemeinsam genutzt – hier darf beim Laden nichts das DOM anfassen.
import { uid, randInt, clamp } from '../lib/util.js';
import { STAMPS } from '../data/mapassets.js';
import { REAL_INK } from './maprender.js';

export const STYLES = {
  real: { label: 'Realistisch', real: true, bg: '#0a0b0d', hatch: '#000000', floor: '#8d8172', grid: 'rgba(0,0,0,.28)', wall: '#1a1714', ink: REAL_INK.ink, halo: REAL_INK.halo, hatchKind: 'none' },
  bild: { label: 'Bildkarte', image: true, bg: '#0a0b0d', hatch: '#000000', floor: '#8d8172', grid: 'rgba(0,0,0,.4)', wall: '#1a1714', ink: REAL_INK.ink, halo: REAL_INK.halo, hatchKind: 'none' },
  klassisch: { label: 'Klassisch', bg: '#f3efe6', hatch: '#3b3b3b', floor: '#ffffff', grid: 'rgba(80,70,60,.3)', wall: '#1d1d1d', ink: '#222222', halo: '#ffffff', hatchKind: 'lines' },
  pergament: { label: 'Pergament', bg: '#e6d5b1', hatch: '#6a4e2b', floor: '#f7eed8', grid: 'rgba(110,80,40,.28)', wall: '#3a2915', ink: '#3a2915', halo: '#f7eed8', hatchKind: 'cross' },
  blaupause: { label: 'Oldschool blau', bg: '#ffffff', hatch: '#2f67b1', floor: '#ffffff', grid: 'rgba(47,103,177,.4)', wall: '#2f67b1', ink: '#1f4f95', halo: '#ffffff', hatchKind: 'grid' },
  dunkel: { label: 'Dunkel (Spieltisch)', bg: '#101014', hatch: '#2b2b36', floor: '#4a433b', grid: 'rgba(255,255,255,.1)', wall: '#050506', ink: '#f1e7d0', halo: '#15120f', hatchKind: 'lines' },
};
export const isReal = (m) => !!(STYLES[m?.style] || STYLES.klassisch).real;
export const isImageMap = (m) => !!(STYLES[m?.style] || STYLES.klassisch).image;

// Klassische Gelände-Materialien (Vektorstile). Im realistischen Stil kommen Texturen und Flüssigkeiten dazu.
export const MATS = {
  water: { label: 'Wasser', color: '#77b1dc', deep: '#3f7fb4' },
  lava: { label: 'Lava', color: '#e2622f', deep: '#a8321a' },
  grass: { label: 'Gras', color: '#a8cc88', deep: '#6f9b52' },
  rubble: { label: 'Geröll', color: '#c3b8ab', deep: '#7d7166' },
  sand: { label: 'Sand', color: '#e7d6a2', deep: '#c2a664' },
  ice: { label: 'Eis', color: '#d4ebf5', deep: '#8fbfd8' },
  pit: { label: 'Grube', color: '#1a1a1a', deep: '#000000' },
  blood: { label: 'Blut/Schleim', color: '#8c1d1d', deep: '#5a0e0e' },
  difficult: { label: 'Schwieriges Gelände', color: 'rgba(0,0,0,0)', deep: '#7a5a2a' },
};

// ───────────────────────── Generatoren ─────────────────────────
export const r2 = (v) => Math.round(v * 100) / 100;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const stampAt = (a, x, y, o = {}) => ({ id: uid(6), t: 'stamp', a, x: r2(x), y: r2(y), r: Math.round(o.r || 0), s: r2(o.s ?? 1), ...(o.fx ? { fx: 1 } : {}), ...(o.layer ? { layer: o.layer } : {}) });
export const ids = (re) => STAMPS.filter((s) => re.test(s.id)).map((s) => `ph:${s.id}`);
// Stempel-Sets für Generatoren und den Streu-Pinsel
export const SETS = {
  laubbaum: { label: 'Laubbäume', keys: ids(/^(island_tree|tree_small_02|searsia_)/), s: [0.7, 1.15] },
  nadelbaum: { label: 'Nadelbäume', keys: ids(/^(fir_tree_01|pine_tree_01)/), s: [0.6, 1] },
  jungbaum: { label: 'Junge Bäume', keys: ids(/^(fir_sapling_medium|pine_sapling_medium|quiver_tree)/), s: [0.7, 1.1] },
  busch: { label: 'Büsche', keys: ids(/^(shrub_0[124]|wild_rooibos_bush|didelta_spinosa)/), s: [0.8, 1.6] },
  farn: { label: 'Farne & Kraut', keys: ids(/^(fern_02|othonna_cerarioides|weed_plant)/), s: [1, 2.2] },
  gras: { label: 'Grasbüschel', keys: ids(/^grass_medium/), s: [1.4, 3] },
  blume: { label: 'Blumen', keys: ids(/^(flower_|dandelion_01|celandine_01|periwinkle_plant)/), s: [1.2, 2.4] },
  fels: { label: 'Steine', keys: ids(/^(rock_moss_set_02|namaqualand_boulder|boulder_01)/), s: [0.7, 1.4] },
  felsen: { label: 'Felsen', keys: ids(/^(rock_moss_set_01|coast_rocks_05|rock_face_0|sand_rocks_small)/), s: [0.6, 1.1] },
  wurzel: { label: 'Stümpfe & Wurzeln', keys: ids(/^(tree_stump|dead_tree_trunk|root_cluster|pine_roots)/), s: [0.8, 1.3] },
  reisig: { label: 'Äste & Rinde', keys: ids(/^(dry_branches|bark_debris)/), s: [1.2, 2.6] },
  truemmer: { label: 'Trümmer & Knochen', keys: ['p:rubble', 'p:bones', 'p:skull', ...ids(/^namaqualand_boulders_01/)], s: [0.7, 1.3] },
};
export const FASS = ids(/^(wine_barrel_01|wooden_barrels_01_[a-e])/);
export const KISTE = ids(/^(wooden_crate_0|wooden_military_crate|old_military_crate)/);
export const STUHL = ids(/^(woodenchair_01|painted_wooden_chair_02|gallinera_chair|wooden_stool_01|folding_wooden_stool)/);
export const TISCH = ids(/^(round_wooden_table_0|woodentable_0|wooden_table_02)/);
export const KRAM = ids(/^(wooden_bucket|wicker_basket|ceramic_pot|jug_01|brass_pot|wooden_bowl_01|tea_set_01|carved_wooden_plate)/);

function doorOnEntry(room, from, to) {
  const inside = (x, y) => x > room.x && x < room.x + room.w && y > room.y && y < room.y + room.h;
  const dx = Math.sign(to[0] - from[0]);
  const dy = Math.sign(to[1] - from[1]);
  let [x, y] = from;
  if (inside(x, y)) return null;
  for (let i = 0; i < 200; i++) {
    const nx = x + dx;
    const ny = y + dy;
    if (inside(nx, ny)) return { x: (x + nx) / 2, y: (y + ny) / 2, r: dx ? 90 : 0 };
    if (nx === to[0] && ny === to[1]) return null;
    x = nx;
    y = ny;
  }
  return null;
}
// Grundgerüst: jeder Generator setzt alle Karteneigenschaften, damit beim Wechsel nichts hängen bleibt
export const base = (o) => ({ shapes: [], terrain: [], objects: [], labels: [], lights: [], outdoor: false, ground: 'dark_rock', floorTex: 'stone_tiles', wallTex: 'castle_brick_01', dark: 0, ...o });
// Zufällig streuen
export function scatter(out, set, n, fn) {
  const S = SETS[set];
  if (!S?.keys.length) return;
  for (let i = 0; i < n; i++) {
    const p = fn(i);
    if (!p) continue;
    out.push(stampAt(pick(S.keys), p.x, p.y, { r: randInt(0, 359), s: rnd(S.s[0], S.s[1]) * (p.s || 1), fx: Math.random() < 0.5 }));
  }
}

function genDungeon(W, H) {
  const shapes = [];
  const objects = [];
  const labels = [];
  const lights = [];
  const rooms = [];
  const target = Math.max(5, Math.round((W * H) / 110));
  for (let i = 0; i < 500 && rooms.length < target; i++) {
    const w = randInt(3, 8);
    const h = randInt(3, 7);
    if (W - w - 2 < 1 || H - h - 2 < 1) break;
    const x = randInt(1, W - w - 2);
    const y = randInt(1, H - h - 2);
    if (rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
    rooms.push({ x, y, w, h });
  }
  if (!rooms.length) return base({});
  const cx = (r) => Math.floor(r.x + r.w / 2) + 0.5;
  const cy = (r) => Math.floor(r.y + r.h / 2) + 0.5;
  const conns = [];
  const done = [rooms[0]];
  const rest = rooms.slice(1);
  while (rest.length) {
    let best = null;
    for (const a of done) for (const b of rest) { const d = Math.abs(cx(a) - cx(b)) + Math.abs(cy(a) - cy(b)); if (!best || d < best.d) best = { a, b, d }; }
    conns.push(best);
    done.push(best.b);
    rest.splice(rest.indexOf(best.b), 1);
  }
  if (rooms.length > 5) conns.push({ a: rooms[1], b: rooms[rooms.length - 1] });
  const floors = ['stone_tiles', 'slab_tiles', 'monastery_stone_floor', 'worn_brick_floor', 'rock_tile_floor'];
  rooms.forEach((r, i) => {
    shapes.push({ id: uid(6), op: 'add', kind: r.w >= 5 && r.h >= 5 && Math.random() < 0.15 ? 'ellipse' : 'rect', pts: [r.x, r.y, r.x + r.w, r.y + r.h], ...(Math.random() < 0.35 ? { tex: pick(floors) } : {}) });
    labels.push({ id: uid(6), kind: 'room', text: String(i + 1), x: r.x + 0.75, y: r.y + 0.75, size: 0.65 });
  });
  for (const { a, b } of conns) {
    const p1 = [cx(a), cy(a)];
    const p2 = [cx(b), cy(b)];
    const mid = Math.random() < 0.5 ? [p2[0], p1[1]] : [p1[0], p2[1]];
    shapes.push({ id: uid(6), op: 'add', kind: 'path', w: 1, pts: [...p1, ...mid, ...p2] });
    for (const [room, from, to] of [[a, mid, p1], [b, mid, p2]]) {
      const d = doorOnEntry(room, from, to);
      if (d && Math.random() < 0.75) objects.push(stampAt(Math.random() < 0.08 ? 'p:secret' : pick(['p:door', 'p:door', 'p:doorDark', 'p:doorIron']), d.x, d.y, { r: d.r }));
    }
  }
  rooms.forEach((r, i) => {
    if (i === 0) objects.push(stampAt('p:stairs', r.x + r.w - 0.5, r.y + 1));
    if (r.w >= 6 && r.h >= 5 && Math.random() < 0.5) {
      for (const [x, y] of [[r.x + 1.5, r.y + 1.5], [r.x + r.w - 1.5, r.y + 1.5], [r.x + 1.5, r.y + r.h - 1.5], [r.x + r.w - 1.5, r.y + r.h - 1.5]]) objects.push(stampAt('p:pillar', x, y));
    }
    if (Math.random() < 0.55) {
      const bx = r.x + 0.5 + randInt(0, r.w - 1);
      const by = r.y + 0.5 + randInt(0, r.h - 1);
      objects.push(stampAt('p:brazier', bx, by));
    }
    const deco = ['ph:treasure_chest', pick(FASS), pick(KISTE), 'ph:gothic_statue', 'p:rubble', 'p:bones', 'p:web', 'p:trap', 'p:coffin', 'p:altar', 'ph:wooden_bookshelf_worn'];
    for (let k = 0, n = randInt(1, 3); k < n; k++) {
      objects.push(stampAt(pick(deco), r.x + 0.5 + randInt(0, r.w - 1), r.y + 0.5 + randInt(0, r.h - 1), { r: randInt(0, 3) * 90, s: 1.2 }));
    }
  });
  return base({ shapes, objects, labels, lights, dark: 0.32, floorTex: 'stone_tiles', wallTex: 'castle_brick_01' });
}

function genCave(W, H) {
  const shapes = [];
  const terrain = [];
  const objects = [];
  const labels = [];
  const chambers = [];
  const n = clamp(Math.round((W * H) / 180), 3, 8);
  for (let i = 0; i < n; i++) chambers.push({ x: randInt(4, Math.max(5, W - 5)), y: randInt(4, Math.max(5, H - 5)), rx: randInt(2, 4), ry: randInt(2, 3) });
  chambers.forEach((c, i) => {
    shapes.push({ id: uid(6), op: 'add', kind: 'ellipse', pts: [c.x - c.rx, c.y - c.ry, c.x + c.rx, c.y + c.ry] });
    labels.push({ id: uid(6), kind: 'room', text: String(i + 1), x: c.x, y: c.y - c.ry + 0.9, size: 0.6 });
  });
  for (let i = 1; i < chambers.length; i++) {
    const a = chambers[i - 1];
    const b = chambers[i];
    const pts = [a.x, a.y];
    const steps = Math.max(4, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 1.3));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      pts.push(r2(a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 2.2), r2(a.y + (b.y - a.y) * t + (Math.random() - 0.5) * 2.2));
    }
    pts.push(b.x, b.y);
    shapes.push({ id: uid(6), op: 'add', kind: 'brush', w: r2(1.6 + Math.random() * 1.4), pts });
  }
  const pool = chambers[randInt(0, chambers.length - 1)];
  terrain.push({ id: uid(6), op: 'add', kind: 'ellipse', mat: 'water', pts: [pool.x - 1.4, pool.y - 0.4, pool.x + 1.6, pool.y + 1.6] });
  for (const c of chambers) {
    scatter(objects, Math.random() < 0.5 ? 'felsen' : 'fels', randInt(1, 3), () => ({ x: c.x + (Math.random() - 0.5) * c.rx * 1.5, y: c.y + (Math.random() - 0.5) * c.ry * 1.5 }));
    scatter(objects, 'truemmer', randInt(0, 2), () => ({ x: c.x + (Math.random() - 0.5) * c.rx * 1.6, y: c.y + (Math.random() - 0.5) * c.ry * 1.6 }));
  }
  const last = chambers[chambers.length - 1];
  objects.push(stampAt('p:web', last.x, last.y, { s: 1.2 }));
  return base({ shapes, terrain, objects, labels, dark: 0.45, ground: 'dark_rock', floorTex: 'rock_ground', wallTex: 'rock_wall_08' });
}

function genTavern(W, H) {
  const w = Math.min(18, W - 4);
  const h = Math.min(13, H - 4);
  const x0 = Math.floor((W - w) / 2);
  const y0 = Math.floor((H - h) / 2);
  const kx = x0 + w - 5;
  const shapes = [
    { id: uid(6), op: 'add', kind: 'rect', pts: [x0, y0, x0 + w, y0 + h], tex: 'old_wood_floor' },
    { id: uid(6), op: 'add', kind: 'rect', pts: [kx, y0, x0 + w, y0 + h], tex: 'terracotta_floor_tiles' },
    { id: uid(6), op: 'sub', kind: 'path', w: 0.3, wall: 1, pts: [kx, y0, kx, y0 + 4] },
    { id: uid(6), op: 'sub', kind: 'path', w: 0.3, wall: 1, pts: [kx, y0 + 5, kx, y0 + h] },
  ];
  const objects = [
    stampAt('p:door2', x0 + Math.floor(w / 2) - 2, y0 + h),
    stampAt('p:door', kx, y0 + 4.5, { r: 90 }),
    stampAt('p:stairsWood', x0 + 0.5, y0 + 1),
    stampAt('p:fireplace', x0 + 3.5, y0 + 0.5),
    stampAt('p:counter', kx - 2.5, y0 + 1.5, { r: 90 }),
    stampAt('p:rug', x0 + 2.5, y0 + h - 3.5),
  ];
  const lights = [];
  for (let row = 0; row < 2; row++) {
    for (let t = 0; t < 3; t++) {
      const x = x0 + 3 + t * 3.5;
      const y = y0 + 5.5 + row * 3.5;
      if (x > kx - 1.5) continue;
      objects.push(stampAt(pick(TISCH), x, y, { s: 1.5, r: randInt(0, 359) }));
      objects.push(stampAt('p:candles', x, y, { s: 0.7 }));
      for (const [dx, dy, r] of [[0, -1, 180], [0, 1, 0], [-1, 0, 90], [1, 0, 270]]) if (Math.random() < 0.8) objects.push(stampAt(pick(STUHL), x + dx, y + dy, { s: 1.5, r }));
    }
  }
  for (let i = 0; i < 4; i++) objects.push(stampAt(pick(FASS), x0 + w - 0.5, y0 + 0.5 + i, { s: 1.4 }));
  objects.push(stampAt('ph:wooden_bookshelf_worn', kx + 2.5, y0 + h - 0.5, { s: 1.6, r: 180 }));
  objects.push(stampAt('p:cauldron', kx + 2.5, y0 + 2.5), stampAt(pick(KISTE), kx + 0.5, y0 + h - 0.5, { s: 1.4 }));
  for (let i = 0; i < 6; i++) objects.push(stampAt(pick(KRAM), rnd(kx + 0.4, x0 + w - 0.4), rnd(y0 + 0.4, y0 + h - 0.4), { s: rnd(1.2, 1.8), r: randInt(0, 359) }));
  const labels = [{ id: uid(6), kind: 'text', text: 'Schankraum', x: x0 + (kx - x0) / 2, y: y0 + h - 1.2, size: 0.7 }, { id: uid(6), kind: 'text', text: 'Küche', x: kx + 2.5, y: y0 + h - 1.8, size: 0.6 }];
  return base({ shapes, objects, labels, lights, dark: 0.22, floorTex: 'old_wood_floor', wallTex: 'wood_plank_wall', ground: 'dirt' });
}

function genTemple(W, H) {
  const w = Math.min(20, W - 4);
  const h = Math.min(16, H - 4);
  const x0 = Math.floor((W - w) / 2);
  const y0 = Math.floor((H - h) / 2);
  const shapes = [
    { id: uid(6), op: 'add', kind: 'rect', pts: [x0, y0, x0 + w, y0 + h], tex: 'marble_01' },
    { id: uid(6), op: 'add', kind: 'rect', pts: [x0 + Math.floor(w / 2) - 2, y0 + h, x0 + Math.floor(w / 2) + 2, y0 + h + 2], tex: 'large_sandstone_blocks_01' },
  ];
  const objects = [stampAt('p:door2', x0 + Math.floor(w / 2), y0 + h + 2), stampAt('p:altar', x0 + w / 2, y0 + 1.5), stampAt('p:magic', x0 + w / 2, y0 + h / 2, { s: 0.9 })];
  const lights = [];
  for (let i = 0; i < Math.floor((h - 4) / 3); i++) {
    const y = y0 + 3.5 + i * 3;
    for (const x of [x0 + 2.5, x0 + w - 2.5]) {
      objects.push(stampAt('p:pillar', x, y));
      if (i % 2 === 0) {
        objects.push(stampAt('p:brazier', x + (x < x0 + w / 2 ? 1.5 : -1.5), y));
      }
    }
  }
  for (let i = 0; i < 4; i++) objects.push(stampAt(Math.random() < 0.6 ? 'p:sarcophagus' : 'p:coffin', x0 + (i % 2 ? w - 4.5 : 4.5), y0 + 4.5 + Math.floor(i / 2) * 5));
  objects.push(stampAt('p:rugGreen', x0 + w / 2, y0 + h / 2 + 1, { s: 1.1 }), stampAt('p:web', x0 + 1.5, y0 + 1.5), stampAt('p:bones', x0 + w - 2.5, y0 + h - 2.5));
  const labels = [{ id: uid(6), kind: 'text', text: 'Krypta', x: x0 + w / 2, y: y0 + h - 1, size: 0.8 }];
  return base({ shapes, objects, labels, lights, dark: 0.4, floorTex: 'marble_01', wallTex: 'large_sandstone_blocks', ground: 'dark_rock' });
}

function genClearing(W, H) {
  const cx = W / 2;
  const cy = H / 2;
  const rx = Math.max(5, W / 2 - 4);
  const ry = Math.max(4, H / 2 - 3);
  const terrain = [
    { id: uid(6), op: 'add', kind: 'ellipse', mat: 'tex:leafy_grass', pts: [r2(cx - rx), r2(cy - ry), r2(cx + rx), r2(cy + ry)] },
    { id: uid(6), op: 'add', kind: 'ellipse', mat: 'tex:sparse_grass', pts: [r2(cx - rx * 0.5), r2(cy - ry * 0.45), r2(cx + rx * 0.35), r2(cy + ry * 0.55)] },
    { id: uid(6), op: 'add', kind: 'ellipse', mat: 'water', pts: [r2(cx + rx * 0.2), r2(cy - ry * 0.6), r2(cx + rx * 0.65), r2(cy - ry * 0.1)] },
  ];
  const objects = [stampAt('p:campfire', Math.floor(cx) + 0.5, Math.floor(cy) + 0.5)];
  const lights = [];
  const ring = (f) => () => {
    const a = Math.random() * Math.PI * 2;
    const k = f + Math.random() * 0.25;
    return { x: clamp(cx + Math.cos(a) * rx * k, 0.6, W - 0.6), y: clamp(cy + Math.sin(a) * ry * k, 0.6, H - 0.6) };
  };
  const any = () => ({ x: rnd(0.5, W - 0.5), y: rnd(0.5, H - 0.5) });
  scatter(objects, 'laubbaum', 22, ring(1.02));
  scatter(objects, 'nadelbaum', 16, ring(1.12));
  scatter(objects, 'jungbaum', 10, ring(0.96));
  scatter(objects, 'busch', 18, ring(0.86));
  scatter(objects, 'fels', 8, any);
  scatter(objects, 'gras', 60, any);
  scatter(objects, 'blume', 25, any);
  scatter(objects, 'wurzel', 5, any);
  return base({ terrain, objects, lights, outdoor: true, ground: 'forest_floor', dark: 0.14, floorTex: 'forest_floor' });
}

function genForest(W, H) {
  const objects = [];
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push(r2((W * i) / 8), r2(H / 2 + Math.sin(i * 0.9) * H * 0.18));
  const terrain = [{ id: uid(6), op: 'add', kind: 'brush', w: 2.4, mat: 'tex:muddy_tracks', pts }];
  const onPath = (x, y) => { for (let i = 0; i < pts.length; i += 2) if (Math.hypot(pts[i] - x, pts[i + 1] - y) < 2.4) return true; return false; };
  const free = () => { for (let k = 0; k < 12; k++) { const x = rnd(0.5, W - 0.5); const y = rnd(0.5, H - 0.5); if (!onPath(x, y)) return { x, y }; } return null; };
  scatter(objects, 'nadelbaum', Math.round((W * H) / 26), free);
  scatter(objects, 'laubbaum', Math.round((W * H) / 40), free);
  scatter(objects, 'jungbaum', Math.round((W * H) / 45), free);
  scatter(objects, 'busch', Math.round((W * H) / 22), free);
  scatter(objects, 'farn', Math.round((W * H) / 14), free);
  scatter(objects, 'wurzel', 10, free);
  scatter(objects, 'reisig', 20, () => ({ x: rnd(0.5, W - 0.5), y: rnd(0.5, H - 0.5) }));
  scatter(objects, 'fels', 8, free);
  return base({ terrain, objects, outdoor: true, ground: 'forest_floor', dark: 0.26, floorTex: 'forest_floor' });
}

function genVillage(W, H) {
  const shapes = [];
  const objects = [];
  const labels = [];
  const lights = [];
  const terrain = [
    { id: uid(6), op: 'add', kind: 'ellipse', mat: 'tex:sparse_grass', pts: [r2(W * 0.1), r2(H * 0.12), r2(W * 0.9), r2(H * 0.88)] },
    { id: uid(6), op: 'add', kind: 'ellipse', mat: 'tex:mossy_cobblestone', pts: [r2(W / 2 - W * 0.28), r2(H / 2 - H * 0.3), r2(W / 2 + W * 0.28), r2(H / 2 + H * 0.3)] },
  ];
  const roofs = ['thatch_roof_angled', 'clay_roof_tiles', 'roof_slates_02', 'reed_roof_03'];
  const spots = [[2, 2, 6, 5], [W - 9, 2, 7, 5], [2, H - 8, 6, 6], [W - 8, H - 7, 6, 5]];
  spots.forEach(([x, y, w, h], i) => {
    if (x < 1 || y < 1 || x + w > W - 1 || y + h > H - 1) return;
    shapes.push({ id: uid(6), op: 'add', kind: 'rect', pts: [x, y, x + w, y + h], tex: 'old_wood_floor', roof: roofs[i % roofs.length] });
    const dx = x + Math.floor(w / 2) + 0.5;
    const dy = y + h;
    objects.push(stampAt('p:door', dx, dy));
    objects.push(stampAt('p:torch', dx + 1.4, dy - 0.1, { s: 1.6 }));
    labels.push({ id: uid(6), kind: 'room', text: String(i + 1), x: x + 0.8, y: y + 0.8, size: 0.6 });
    // Trampelpfad von der Tür zum Platz
    terrain.push({ id: uid(6), op: 'add', kind: 'brush', w: 1.4, mat: 'tex:stone_pathway', pts: [r2(dx), r2(dy + 0.4), r2((dx + W / 2) / 2), r2((dy + H / 2) / 2), r2(W / 2), r2(H / 2)] });
    for (let k = 0; k < 3; k++) objects.push(stampAt(pick([...FASS, ...KISTE]), rnd(x, x + w), dy + rnd(0.5, 1.6), { s: 1.4, r: randInt(0, 359) }));
  });
  objects.push(stampAt('p:well', Math.floor(W / 2) + 0.5, Math.floor(H / 2) + 0.5, { s: 1.4 }));
  for (let i = 0; i < 6; i++) objects.push(stampAt(pick(FASS), rnd(2, W - 2), rnd(2, H - 2), { s: 1.4, r: randInt(0, 359) }));
  for (let i = 0; i < 7; i++) objects.push(stampAt('p:fence', 2.5 + i * 2, H - 1.2, { s: 1.3 }));
  objects.push(stampAt('p:well', W / 2 - 3.5, H / 2 + 2.5, { s: 1 }), stampAt(pick(TISCH), W / 2 + 3, H / 2 - 1.5, { s: 1.6, r: randInt(0, 359) }));
  for (let i = 0; i < 4; i++) objects.push(stampAt(pick(STUHL), W / 2 + 3 + Math.cos(i * 1.6) * 1.1, H / 2 - 1.5 + Math.sin(i * 1.6) * 1.1, { s: 1.5, r: randInt(0, 359) }));
  for (let i = 0; i < 8; i++) objects.push(stampAt(pick(KRAM), rnd(2, W - 2), rnd(2, H - 2), { s: rnd(1.2, 1.8), r: randInt(0, 359) }));
  const any = () => ({ x: rnd(0.5, W - 0.5), y: rnd(0.5, H - 0.5) });
  scatter(objects, 'laubbaum', 8, () => ({ x: rnd(1, W - 1), y: rnd(1, H - 1) }));
  scatter(objects, 'busch', 10, any);
  scatter(objects, 'gras', 80, any);
  scatter(objects, 'blume', 30, any);
  scatter(objects, 'fels', 6, any);
  return base({ shapes, terrain, objects, labels, lights, outdoor: true, ground: 'sparse_grass', floorTex: 'old_wood_floor', wallTex: 'wood_plank_wall', dark: 0.12 });
}

export const SCRAWL_GENERATORS = {
  leer: { label: 'Leer', fn: () => base({}) },
  dungeon: { label: 'Dungeon (Räume & Gänge)', fn: genDungeon },
  hoehle: { label: 'Höhle', fn: genCave },
  taverne: { label: 'Taverne', fn: genTavern },
  tempel: { label: 'Tempel & Krypta', fn: genTemple },
  lichtung: { label: 'Waldlichtung', fn: genClearing },
  wald: { label: 'Dichter Wald', fn: genForest },
  dorf: { label: 'Dorfplatz', fn: genVillage },
};
