// Battlemap-Gelände und prozedurale Generatoren (Dungeon, Höhle, Wald, Taverne).
import { randInt } from '../lib/util.js';

export const CELL = 50;

export const TERRAIN = {
  f: { label: 'Boden', color: '#6f5d45' },
  w: { label: 'Wand', color: '#23201c' },
  a: { label: 'Wasser', color: '#2f5f8a' },
  d: { label: 'Schwieriges Gelände', color: '#7a6a3a' },
  o: { label: 'Tür', color: '#a0703c' },
  p: { label: 'Säule / Möbel', color: '#4a4640' },
  t: { label: 'Baum', color: '#2d6a37' },
  g: { label: 'Gras', color: '#4b7337' },
  s: { label: 'Treppe', color: '#8d8474' },
  l: { label: 'Lava', color: '#c2461e' },
  r: { label: 'Fels', color: '#57534d' },
};
export const TERRAIN_KEYS = ['f', 'w', 'o', 'p', 'a', 'd', 'g', 't', 'r', 's', 'l'];

const at = (x, y, cols) => y * cols + x;

export function emptyCells(cols, rows, ch = ' ') {
  return ch.repeat(cols * rows);
}

export function resizeCells(cells, cols, rows, ncols, nrows, fill = ' ') {
  let out = '';
  for (let y = 0; y < nrows; y++) for (let x = 0; x < ncols; x++) out += x < cols && y < rows ? cells[at(x, y, cols)] || fill : fill;
  return out;
}

function wallsAround(a, cols, rows) {
  const out = a.slice();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (a[at(x, y, cols)] !== ' ') continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const c = a[at(nx, ny, cols)];
          if (c === 'f' || c === 'o' || c === 'p') { near = true; break; }
        }
      }
      if (near) out[at(x, y, cols)] = 'w';
    }
  }
  return out;
}

export function genDungeon(cols, rows) {
  const a = new Array(cols * rows).fill(' ');
  const rooms = [];
  const target = Math.max(4, Math.round((cols * rows) / 130));
  for (let i = 0; i < 300 && rooms.length < target; i++) {
    const w = randInt(4, 9);
    const h = randInt(3, 7);
    if (cols - w - 2 < 1 || rows - h - 2 < 1) break;
    const x = randInt(1, cols - w - 2);
    const y = randInt(1, rows - h - 2);
    if (rooms.some((r) => x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y)) continue;
    rooms.push({ x, y, w, h });
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) a[at(xx, yy, cols)] = 'f';
  }
  rooms.sort((p, q) => p.x + p.y - (q.x + q.y));
  const center = (r) => [Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2)];
  const hline = (xa, xb, y) => { for (let x = Math.min(xa, xb); x <= Math.max(xa, xb); x++) if (a[at(x, y, cols)] === ' ') a[at(x, y, cols)] = 'f'; };
  const vline = (ya, yb, x) => { for (let y = Math.min(ya, yb); y <= Math.max(ya, yb); y++) if (a[at(x, y, cols)] === ' ') a[at(x, y, cols)] = 'f'; };
  for (let i = 1; i < rooms.length; i++) {
    const [x1, y1] = center(rooms[i - 1]);
    const [x2, y2] = center(rooms[i]);
    if (Math.random() < 0.5) { hline(x1, x2, y1); vline(y1, y2, x2); } else { vline(y1, y2, x1); hline(x1, x2, y2); }
  }
  const inRoom = (x, y) => rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  for (const r of rooms) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      for (let y = r.y - 1; y <= r.y + r.h; y++) {
        const edge = x === r.x - 1 || x === r.x + r.w || y === r.y - 1 || y === r.y + r.h;
        if (!edge || x < 0 || y < 0 || x >= cols || y >= rows) continue;
        if (a[at(x, y, cols)] === 'f' && !inRoom(x, y) && Math.random() < 0.55) a[at(x, y, cols)] = 'o';
      }
    }
    if (r.w >= 7 && r.h >= 5 && Math.random() < 0.45) {
      [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.x + r.w - 2, r.y + r.h - 2]].forEach(([x, y]) => { a[at(x, y, cols)] = 'p'; });
    }
    if (Math.random() < 0.15) a[at(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2), cols)] = 'a';
  }
  if (rooms[0]) a[at(rooms[0].x, rooms[0].y, cols)] = 's';
  return wallsAround(a, cols, rows).join('');
}

export function genCave(cols, rows) {
  let a = Array.from({ length: cols * rows }, (_, i) => {
    const x = i % cols;
    const y = Math.floor(i / cols);
    return x === 0 || y === 0 || x === cols - 1 || y === rows - 1 || Math.random() < 0.44 ? 1 : 0;
  });
  for (let it = 0; it < 5; it++) {
    const b = a.slice();
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) n += a[at(x + dx, y + dy, cols)];
        b[at(x, y, cols)] = n >= 5 ? 1 : n <= 3 ? 0 : a[at(x, y, cols)];
      }
    }
    a = b;
  }
  const out = a.map((v) => (v ? 'r' : 'f'));
  for (let i = 0; i < (cols * rows) / 280; i++) {
    const cx = randInt(2, cols - 3);
    const cy = randInt(2, rows - 3);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) if (out[at(cx + dx, cy + dy, cols)] === 'f' && Math.random() < 0.8) out[at(cx + dx, cy + dy, cols)] = 'a';
  }
  for (let i = 0; i < out.length; i++) if (out[i] === 'f' && Math.random() < 0.04) out[i] = 'd';
  return out.join('');
}

export function genForest(cols, rows) {
  const out = new Array(cols * rows).fill('g');
  let y = randInt(2, Math.max(2, rows - 3));
  for (let x = 0; x < cols; x++) {
    out[at(x, y, cols)] = 'f';
    if (y + 1 < rows) out[at(x, y + 1, cols)] = 'f';
    if (Math.random() < 0.3) y = Math.max(1, Math.min(rows - 3, y + (Math.random() < 0.5 ? -1 : 1)));
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== 'g') continue;
    const r = Math.random();
    if (r < 0.14) out[i] = 't';
    else if (r < 0.19) out[i] = 'd';
  }
  const px = randInt(2, Math.max(2, cols - 6));
  const py = randInt(2, Math.max(2, rows - 5));
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 4; dx++) if (out[at(px + dx, py + dy, cols)] && out[at(px + dx, py + dy, cols)] !== 'f') out[at(px + dx, py + dy, cols)] = 'a';
  return out.join('');
}

export function genTavern(cols, rows) {
  const out = new Array(cols * rows).fill(' ');
  const x0 = 1;
  const y0 = 1;
  const x1 = cols - 2;
  const y1 = rows - 2;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out[at(x, y, cols)] = x === x0 || x === x1 || y === y0 || y === y1 ? 'w' : 'f';
  out[at(Math.floor((x0 + x1) / 2), y1, cols)] = 'o';
  for (let x = x0 + 2; x < Math.min(x1 - 1, x0 + 11); x++) out[at(x, y0 + 2, cols)] = 'p';
  for (let y = y0 + 5; y < y1 - 1; y += 3) for (let x = x0 + 2; x < x1 - 1; x += 4) out[at(x, y, cols)] = 'p';
  out[at(x1 - 1, y0 + 1, cols)] = 's';
  out[at(x1 - 2, y0 + 1, cols)] = 's';
  return out.join('');
}

export const GENERATORS = {
  leer: { label: 'Leer', fn: (c, r) => emptyCells(c, r, 'f') },
  dungeon: { label: 'Dungeon (Räume & Gänge)', fn: genDungeon },
  hoehle: { label: 'Höhle', fn: genCave },
  wald: { label: 'Waldlichtung', fn: genForest },
  taverne: { label: 'Taverne', fn: genTavern },
  nichts: { label: 'Nur Hintergrundbild', fn: (c, r) => emptyCells(c, r, ' ') },
};
