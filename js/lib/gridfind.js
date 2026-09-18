// Raster in einem Kartenbild finden: sucht die Periode der Gitterlinien (Kantenenergie je Spalte/Zeile)
// und liefert Zellgröße, Versatz und die Anzahl der Felder. Funktioniert mit jedem Bildformat,
// das der Browser laden kann (PNG, JPG, WebP, GIF, AVIF, BMP …).

const lumOf = (data, i) => data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

// Energie normieren (Mittelwert 0, Streuung 1)
function normalize(a) {
  let m = 0;
  for (const v of a) m += v;
  m /= a.length || 1;
  let sd = 0;
  for (const v of a) sd += (v - m) ** 2;
  sd = Math.sqrt(sd / (a.length || 1)) || 1;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] - m) / sd;
  return out;
}

// Beste Periode p und Versatz o: Summe der Energie auf den Linien, geteilt durch ihre Anzahl
function bestPeriod(E, minCell, maxCell) {
  const n = E.length;
  let best = { p: 0, o: 0, score: -1e9 };
  const test = (p) => {
    const lines = Math.floor((n - 1) / p);
    if (lines < 3) return;
    for (let o = 0; o < p; o += Math.max(1, p / 24)) {
      let sum = 0;
      let cnt = 0;
      for (let x = o; x < n; x += p) {
        const i = Math.round(x);
        if (i < 0 || i >= n) continue;
        // die stärkste Kante direkt daneben zählt mit (Linien sind selten exakt 1 px)
        sum += Math.max(E[i], E[Math.max(0, i - 1)], E[Math.min(n - 1, i + 1)]);
        cnt++;
      }
      if (cnt < 4) continue;
      const score = sum / cnt;
      if (score > best.score) best = { p, o, score };
    }
  };
  for (let p = minCell; p <= maxCell; p += 1) test(p);
  // Feinsuche um das gefundene Maß
  const p0 = best.p;
  for (let p = Math.max(minCell, p0 - 1.5); p <= Math.min(maxCell, p0 + 1.5); p += 0.1) test(p);
  return best;
}

// source: HTMLImageElement, ImageBitmap oder Canvas
export function detectGrid(source, { maxDim = 1400, minCells = 8, maxCells = 120 } = {}) {
  const w0 = source.naturalWidth || source.width;
  const h0 = source.naturalHeight || source.height;
  const k = Math.min(1, maxDim / Math.max(w0, h0));
  const w = Math.max(16, Math.round(w0 * k));
  const h = Math.max(16, Math.round(h0 * k));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  const colE = new Float32Array(w);
  const rowE = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 1; x < w; x++) {
      const d = Math.abs(lumOf(data, (row + x) * 4) - lumOf(data, (row + x - 1) * 4));
      colE[x] += d;
      rowE[y] += d * 0.0;
    }
  }
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < w; x++) {
      rowE[y] += Math.abs(lumOf(data, (y * w + x) * 4) - lumOf(data, ((y - 1) * w + x) * 4));
    }
  }
  const cE = normalize(colE);
  const rE = normalize(rowE);
  const minCell = Math.max(6, Math.floor(Math.min(w, h) / maxCells));
  const maxCell = Math.max(minCell + 2, Math.floor(Math.min(w, h) / minCells));
  const c = bestPeriod(cE, minCell, maxCell);
  const r = bestPeriod(rE, minCell, maxCell);
  // Quadratische Felder: die überzeugendere Achse gibt die Zellgröße vor
  const p = c.score >= r.score ? c.p : r.p;
  const fit = (E, period) => {
    let best = { o: 0, score: -1e9 };
    for (let o = 0; o < period; o += 0.1) {
      let sum = 0;
      let cnt = 0;
      for (let x = o; x < E.length; x += period) {
        const i = Math.round(x);
        sum += Math.max(E[i], E[Math.max(0, i - 1)], E[Math.min(E.length - 1, i + 1)]);
        cnt++;
      }
      if (cnt < 4) continue;
      const score = sum / cnt;
      if (score > best.score) best = { o, score };
    }
    return best;
  };
  const co = fit(cE, p);
  const ro = fit(rE, p);
  const cell = p / k;
  const ox = ((co.o / k) % cell + cell) % cell;
  const oy = ((ro.o / k) % cell + cell) % cell;
  const score = (co.score + ro.score) / 2;
  return {
    cell: Math.round(cell * 100) / 100,
    ox: Math.round(ox * 100) / 100,
    oy: Math.round(oy * 100) / 100,
    cols: Math.max(1, Math.round((w0 - ox) / cell)),
    rows: Math.max(1, Math.round((h0 - oy) / cell)),
    score: Math.round(score * 100) / 100,
    sure: score > 1.1,
    w: w0,
    h: h0,
  };
}

// Ohne erkennbares Raster: gleichmäßig aufteilen (Standard: 30 Felder auf der langen Seite)
export function evenGrid(w, h, longCells = 30) {
  const cell = Math.max(w, h) / longCells;
  return { cell: Math.round(cell * 100) / 100, ox: 0, oy: 0, cols: Math.max(1, Math.round(w / cell)), rows: Math.max(1, Math.round(h / cell)), score: 0, sure: false, w, h };
}
