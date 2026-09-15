// Taktik auf der Kampfkarte (reine Logik): Bewegung nach 5e (Diagonale = 1 Feld, schwieriges Gelände doppelt,
// keine Wandecken schneiden), Entfernungen Kante zu Kante, Zauberflächen als Schablonen, Angriffe aus Statblöcken.
import { DAMAGE_DE } from '../data/artmap.js';

export const CELL_M = 1.5;
export const SIZE_CELLS = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
export const fmtMeters = (m) => `${String(Math.round((Number(m) || 0) * 10) / 10).replace('.', ',')} m`;
const num = (s) => parseFloat(String(s).replace(',', '.'));

export function sizeCells(m) {
  if (m?.sizeKey) return SIZE_CELLS[m.sizeKey] || 1;
  const t = String(m?.size || '').toLowerCase();
  if (/gigant|gargant/.test(t)) return 4;
  if (/riesig|huge/.test(t)) return 3;
  if (/groß|large/.test(t)) return 2;
  return 1;
}

// ───────────────────────── Entfernungen ─────────────────────────
const rectOf = (t) => { const n = t.size || 1; return { x: t.x, y: t.y, x2: t.x + n - 1, y2: t.y + n - 1 }; };
// Felder zwischen zwei Tokens (benachbart = 1, Kante zu Kante)
export function cellDistance(a, b) {
  const A = rectOf(a);
  const B = rectOf(b);
  return Math.max(Math.max(0, B.x - A.x2, A.x - B.x2), Math.max(0, B.y - A.y2, A.y - B.y2));
}
export const meterDistance = (a, b) => cellDistance(a, b) * CELL_M;
export function pointCellDistance(t, px, py) {
  const A = rectOf(t);
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  return Math.max(Math.max(0, cx - A.x2, A.x - cx), Math.max(0, cy - A.y2, A.y - cy));
}
export const tokenCenter = (t) => ({ x: t.x + (t.size || 1) / 2, y: t.y + (t.size || 1) / 2 });

// ───────────────────────── Bewegung ─────────────────────────
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
// Günstigste Wege ab start (linke obere Ecke des Tokens) bis maxCost Felder. grid: { w, h, walk, cost } oder null (freie Fläche)
export function reachable(grid, start, maxCost, { size = 1, blocked = null, W, H } = {}) {
  const w = grid?.w ?? W;
  const h = grid?.h ?? H;
  const dist = new Float32Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const fits = (x, y) => {
    if (x < 0 || y < 0 || x + size > w || y + size > h) return false;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const i = (y + dy) * w + x + dx;
        if (grid && !grid.walk[i]) return false;
        if (blocked && blocked.has(i)) return false;
      }
    }
    return true;
  };
  const cost = (x, y) => {
    if (!grid) return 1;
    let c = 1;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) c = Math.max(c, grid.cost[(y + dy) * w + x + dx] || 1);
    return c;
  };
  const s = start.y * w + start.x;
  if (s < 0 || s >= w * h) return { dist, prev, w, h };
  dist[s] = 0;
  const buckets = [[s]];
  for (let d = 0; d < buckets.length && d <= maxCost; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (let bi = 0; bi < b.length; bi++) {
      const i = b[bi];
      if (dist[i] !== d) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!fits(nx, ny)) continue;
        if (dx && dy && (!fits(x + dx, y) || !fits(x, y + dy))) continue;
        const nd = d + cost(nx, ny);
        if (nd > maxCost) continue;
        const ni = ny * w + nx;
        if (nd < dist[ni]) {
          dist[ni] = nd;
          prev[ni] = i;
          (buckets[nd] ||= []).push(ni);
        }
      }
    }
  }
  return { dist, prev, w, h };
}
export function pathTo(r, x, y) {
  let i = y * r.w + x;
  if (i < 0 || i >= r.dist.length || !Number.isFinite(r.dist[i])) return null;
  const out = [];
  while (i >= 0) {
    out.push([i % r.w, Math.floor(i / r.w)]);
    i = r.prev[i];
  }
  return out.reverse();
}

// ───────────────────────── Flächen ─────────────────────────
// Schablone: { shape: sphere|cylinder|emanation|cube|cone|line, x, y (Anker/Ursprung), dir (Bogenmaß), size (Felder), width (Felder) }
const CONE = Math.atan(0.5);
export function inArea(tpl, px, py) {
  const dx = px - tpl.x;
  const dy = py - tpl.y;
  switch (tpl.shape) {
    case 'sphere': case 'cylinder': case 'emanation': return Math.hypot(dx, dy) <= tpl.size + 1e-6;
    case 'cube': return Math.abs(dx) <= tpl.size / 2 + 1e-6 && Math.abs(dy) <= tpl.size / 2 + 1e-6;
    case 'cone': {
      const d = Math.hypot(dx, dy);
      if (d > tpl.size + 1e-6 || d < 1e-6) return false;
      const a = Math.atan2(dy, dx) - (tpl.dir || 0);
      return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= CONE + 1e-6;
    }
    case 'line': {
      const ux = Math.cos(tpl.dir || 0);
      const uy = Math.sin(tpl.dir || 0);
      const along = dx * ux + dy * uy;
      return along >= 0 && along <= tpl.size + 1e-6 && Math.abs(-dx * uy + dy * ux) <= (tpl.width || 1) / 2 + 1e-6;
    }
    default: return false;
  }
}
export function areaCells(tpl, w, h) {
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inArea(tpl, x + 0.5, y + 0.5)) out.push(y * w + x);
  return out;
}
export function tokensInArea(tpl, tokens) {
  return tokens.filter((t) => {
    const n = t.size || 1;
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) if (inArea(tpl, t.x + dx + 0.5, t.y + dy + 0.5)) return true;
    return false;
  });
}
// Schablone aus Zauberfläche (Meter), Wirker und Zeigerposition
export function templateFor(area, caster, pt, rangeKind) {
  const size = (Number(area.size) || 1.5) / CELL_M;
  const n = caster.size || 1;
  const c = tokenCenter(caster);
  const dir = Math.atan2(pt.y - c.y, pt.x - c.x);
  if (area.shape === 'cone' || area.shape === 'line') {
    // Ursprung am Rand des Wirkers, Richtung zum Zeiger
    const ox = c.x + Math.cos(dir) * (n / 2);
    const oy = c.y + Math.sin(dir) * (n / 2);
    return { shape: area.shape, x: ox, y: oy, dir, size, width: area.shape === 'line' ? (Number(area.width) || CELL_M) / CELL_M : undefined };
  }
  if (area.shape === 'emanation' || (rangeKind === 'self' && area.shape !== 'cube')) return { shape: 'emanation', x: c.x, y: c.y, dir: 0, size: size + n / 2 };
  if (area.shape === 'cube' && rangeKind === 'self') {
    const step = n / 2 + size / 2;
    const ax = Math.abs(Math.cos(dir)) > Math.abs(Math.sin(dir));
    return { shape: 'cube', x: ax ? c.x + Math.sign(Math.cos(dir)) * step : c.x, y: ax ? c.y : c.y + Math.sign(Math.sin(dir)) * step, dir: 0, size };
  }
  const snap = (v) => (area.shape === 'cube' && Math.round(size) % 2 ? Math.floor(v) + 0.5 : Math.round(v));
  return { shape: area.shape === 'cylinder' ? 'cylinder' : area.shape, x: snap(pt.x), y: snap(pt.y), dir: 0, size };
}

// ───────────────────────── Statblöcke ─────────────────────────
const SAVE_WORDS = {
  'stärke': 'str', geschicklichkeit: 'dex', konstitution: 'con', intelligenz: 'int', weisheit: 'wis', charisma: 'cha',
  strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis',
};
const EN_DMG = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
function dmgType(txt) {
  const t = String(txt).toLowerCase();
  for (const [k, v] of Object.entries(DAMAGE_DE)) if (t.includes(k)) return v;
  return EN_DMG.find((e) => t.includes(e)) || null;
}
const SHAPE_WORDS = { kegel: 'cone', cone: 'cone', linie: 'line', line: 'line', 'würfel': 'cube', cube: 'cube', kugel: 'sphere', sphere: 'sphere', radius: 'sphere', 'ausströmung': 'emanation' };

// Angriffe und Rettungswurf-Fähigkeiten aus den Aktionen eines (normalisierten) Statblocks
export function parseAttacks(m) {
  const out = [];
  for (const a of [...(m?.actions || []), ...(m?.bonusActions || [])]) {
    const txt = String(a.desc ?? a.value ?? '');
    const name = a.name || 'Angriff';
    const damage = [];
    for (const mm of txt.matchAll(/\((\d+\s*[WwDd]\s*\d+(?:\s*[+−-]\s*\d+)?)\)\s*([^.,;()]{0,28}?)(?:schaden|damage)/gi)) {
      damage.push({ dice: mm[1].replace(/\s+/g, '').replace(/[Ww]/, 'd').replace('−', '-'), type: dmgType(`${mm[2]}schaden`) });
    }
    const hit = /([+−-]\s*\d+)\s*(?:auf Treffer|zum Treffen|zum Treffer|to hit)/i.exec(txt);
    let range = null;
    let reach = null;
    let r = /Reichweite\s*(\d+(?:,\d+)?)\s*\/\s*(\d+(?:,\d+)?)\s*m/i.exec(txt) || /range\s*(\d+)\s*\/\s*(\d+)\s*ft/i.exec(txt);
    if (r) range = /ft/i.test(r[0]) ? [num(r[1]) * 0.3, num(r[2]) * 0.3] : [num(r[1]), num(r[2])];
    r = /Reichweite\s*(\d+(?:,\d+)?)\s*m(?!\s*\/)/i.exec(txt) || /reach\s*(\d+)\s*ft/i.exec(txt);
    if (r && !range) reach = /ft/i.test(r[0]) ? num(r[1]) * 0.3 : num(r[1]);
    const melee = /Nahkampf|melee/i.test(txt);
    const ranged = /Fernkampf|ranged/i.test(txt);
    if (hit) {
      out.push({ name, kind: ranged && !melee ? 'ranged' : 'melee', bonus: parseInt(hit[1].replace(/\s/g, '').replace('−', '-'), 10), reach: reach ?? (ranged && !melee ? null : 1.5), range, damage, text: txt });
      continue;
    }
    const sv = /SG[\s-]*(\d+)[\s-]*(?:für\s*)?(Stärke|Geschicklichkeit|Konstitution|Intelligenz|Weisheit|Charisma)/i.exec(txt)
      || /DC\s*(\d+)\s*(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)/i.exec(txt);
    if (sv && damage.length) {
      let area = null;
      let am = /(\d+(?:,\d+)?)\s*Meter\s*lange[nr]?\s*und\s*(\d+(?:,\d+)?)\s*Meter\s*breite[nr]?\s*Linie/i.exec(txt);
      if (am) area = { shape: 'line', size: num(am[1]), width: num(am[2]) };
      if (!area) {
        am = /(\d+(?:,\d+)?)\s*(?:m|Meter)n?(?:\s|-)*(?:lange[nr]?\s*)?(Kegel|Linie|Würfel|Kugel|Radius|Ausströmung)/i.exec(txt)
          || /Radius\s*von\s*(\d+(?:,\d+)?)\s*Metern()/i.exec(txt) || /(\d+)-(?:foot|ft\.?)\s*(cone|line|cube|sphere|radius)/i.exec(txt);
        if (am) area = { shape: SHAPE_WORDS[(am[2] || 'radius').toLowerCase()] || 'sphere', size: /foot|ft/i.test(am[0]) ? num(am[1]) * 0.3 : num(am[1]), width: CELL_M };
      }
      out.push({ name, kind: area ? 'area' : 'save', save: SAVE_WORDS[sv[2].toLowerCase()], dc: Number(sv[1]), damage, area, rangeKind: area ? 'self' : null, range: reach ? [reach, reach] : range, half: /Hälfte|halb|half/i.test(txt), text: txt });
    }
  }
  return out;
}

const AB_ALIASES = { str: ['stä', 'str'], dex: ['ges', 'dex'], con: ['kon', 'con'], int: ['int'], wis: ['wei', 'wis'], cha: ['cha'] };
export function saveBonus(m, ab) {
  const s = String(m?.saves || '');
  for (const al of AB_ALIASES[ab] || []) {
    const mm = new RegExp(`(?:^|[\\s,;])${al}\\w*\\.?\\s*([+−-]\\s*\\d+)`, 'i').exec(s);
    if (mm) return parseInt(mm[1].replace(/\s/g, '').replace('−', '-'), 10);
  }
  return Math.floor(((Number(m?.abilities?.[ab]) || 10) - 10) / 2);
}
export function monsterSpeed(m) {
  if (m?.speeds?.walk != null) return Number(m.speeds.walk) || 0;
  const s = String(m?.speed || '');
  let r = /(\d+(?:,\d+)?)\s*m\b/.exec(s);
  if (r) return num(r[1]);
  r = /(\d+)\s*(?:ft|fuß|feet)/i.exec(s);
  if (r) return Math.round(num(r[1]) * 0.3 * 10) / 10;
  return 9;
}

// ───────────────────────── Sichtlinie & Deckung ─────────────────────────
// Alle Felder, die eine Strecke berührt (Amanatides & Woo)
export function cellsOnLine(x0, y0, x1, y1) {
  const out = [];
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const tdx = dx ? Math.abs(1 / dx) : Infinity;
  const tdy = dy ? Math.abs(1 / dy) : Infinity;
  let tx = dx ? (sx > 0 ? cx + 1 - x0 : x0 - cx) * tdx : Infinity;
  let ty = dy ? (sy > 0 ? cy + 1 - y0 : y0 - cy) * tdy : Infinity;
  out.push([cx, cy]);
  let guard = 0;
  while ((cx !== ex || cy !== ey) && guard++ < 600) {
    if (Math.abs(tx - ty) < 1e-9) { tx += tdx; ty += tdy; cx += sx; cy += sy; } else if (tx < ty) { tx += tdx; cx += sx; } else { ty += tdy; cy += sy; }
    out.push([cx, cy]);
  }
  return out;
}
function lineFree(grid, ax, ay, bx, by, opaque) {
  const cells = cellsOnLine(ax, ay, bx, by);
  for (let i = 1; i < cells.length - 1; i++) {
    const [x, y] = cells[i];
    if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return false;
    if (opaque(y * grid.w + x)) return false;
  }
  return true;
}
const samplePts = (t) => {
  const n = t.size || 1;
  const o = [[t.x + n / 2, t.y + n / 2]];
  for (const fx of [0.12, 0.88]) for (const fy of [0.12, 0.88]) o.push([t.x + fx * n, t.y + fy * n]);
  return o;
};
// Sichtlinie zwischen zwei Tokens: frei, wenn irgendeine Linie zwischen Punkten ihrer Felder nicht durch Wand
// (bzw. einen stark verschleierten Bereich in `blocks`) führt
export function lineOfSight(grid, a, b, { blocks = null } = {}) {
  if (!grid || !a || !b) return true;
  const opaque = (i) => !!grid.opaque?.[i] || !!blocks?.has(i);
  for (const [ax, ay] of samplePts(a)) for (const [bx, by] of samplePts(b)) if (lineFree(grid, ax, ay, bx, by, opaque)) return true;
  return false;
}
// Sicht von einem Token auf einen Punkt (Ursprung einer Fläche)
export function pointInSight(grid, a, px, py, { blocks = null } = {}) {
  if (!grid || !a) return true;
  const opaque = (i) => !!grid.opaque?.[i] || !!blocks?.has(i);
  return samplePts(a).some(([ax, ay]) => lineFree(grid, ax, ay, px, py, opaque));
}
// Wirkt eine Fläche vom Ursprung aus auf dieses Feld? (Wände halten Flächen auf)
export function areaReaches(grid, ox, oy, cx, cy) {
  if (!grid) return true;
  return lineFree(grid, ox, oy, cx + 0.5, cy + 0.5, (i) => !!grid.opaque?.[i]) || (Math.floor(ox) === cx && Math.floor(oy) === cy);
}
// Halbe Deckung (+2 RK / GES-Rettungswurf): andere Kreaturen oder Säulen/Statuen zwischen Angreifer und Ziel
export function coverBetween(grid, a, b, others = []) {
  if (!a || !b) return 0;
  const [ax, ay] = samplePts(a)[0];
  const [bx, by] = samplePts(b)[0];
  const occ = new Set();
  for (const o of others) {
    if (o.id === a.id || o.id === b.id) continue;
    const n = o.size || 1;
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) occ.add(`${o.x + dx},${o.y + dy}`);
  }
  const own = (t, x, y) => x >= t.x && y >= t.y && x < t.x + (t.size || 1) && y < t.y + (t.size || 1);
  for (const [x, y] of cellsOnLine(ax, ay, bx, by)) {
    if (own(a, x, y) || own(b, x, y)) continue;
    if (occ.has(`${x},${y}`) || (grid && grid.cover?.[y * grid.w + x])) return 2;
  }
  return 0;
}
