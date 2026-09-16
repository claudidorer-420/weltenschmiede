// Eigene Karten-Assets (z. B. Pakete von Forgotten Adventures oder Crosshead Studios, die du selbst besitzt):
// Sie bleiben nur auf diesem Gerät (eigene IndexedDB) und werden nie hochgeladen. Spieler sehen Karten mit
// eigenen Assets über ein gebackenes Kartenbild (siehe mapeditor.js).
import { uid } from '../lib/util.js';

const DB_NAME = 'weltenschmiede-assets';
let dbp = null;
function open() {
  if (!dbp) {
    dbp = new Promise((ok, fail) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
  }
  return dbp;
}
async function run(stores, mode, fn) {
  const d = await open();
  return new Promise((ok, fail) => {
    const t = d.transaction(stores, mode);
    let out;
    t.oncomplete = () => ok(out);
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error || new Error('Abgebrochen'));
    out = fn(t);
  });
}
const req = (r) => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });

const metas = new Map();
const images = new Map();
const subs = new Set();
let loaded = false;
let loading = null;
let version = 0;
function emit() { version++; for (const f of subs) f(version); }
export const userAssetsVersion = () => version;
export function onUserAssets(fn) { subs.add(fn); return () => subs.delete(fn); }

export function loadUserAssets() {
  if (loaded) return Promise.resolve();
  if (!loading) {
    loading = run(['meta'], 'readonly', (t) => req(t.objectStore('meta').getAll()))
      .then(() => null)
      .catch(() => null);
    loading = (async () => {
      try {
        const d = await open();
        const all = await req(d.transaction('meta').objectStore('meta').getAll());
        for (const m of all || []) metas.set(m.id, m);
      } catch { /* kein IndexedDB (privates Fenster) */ }
      loaded = true;
      emit();
    })();
  }
  return loading;
}
if (typeof indexedDB !== 'undefined') loadUserAssets();

export const userAssets = () => [...metas.values()].sort((a, b) => (a.pack || '').localeCompare(b.pack || '') || (a.cat || '').localeCompare(b.cat || '') || a.name.localeCompare(b.name));
export function userAssetInfo(id) {
  const m = metas.get(id);
  return m ? { id: m.id, name: m.name, cat: 'eigene', sub: m.cat || m.pack || '', pack: m.pack || '', w: m.w, h: m.h, layer: m.layer || 'obj', block: !!m.block, rough: !!m.rough, hM: m.hM } : null;
}
export const userThumb = (id) => metas.get(id)?.thumb || '';
export function userAssetImage(id) {
  const e = images.get(id);
  if (e) return e.ok ? e.im : null;
  if (!metas.has(id)) return null;
  const rec = { im: new Image(), ok: false };
  images.set(id, rec);
  (async () => {
    try {
      const d = await open();
      const blob = await req(d.transaction('blobs').objectStore('blobs').get(id));
      if (!blob) return;
      rec.im.onload = () => { rec.ok = true; emit(); };
      rec.im.src = URL.createObjectURL(blob);
    } catch { /* fehlt */ }
  })();
  return null;
}
// Sind alle Bilder dieser Assets geladen? (Voraussetzung fürs Backen)
export async function ensureUserImages(ids) {
  await loadUserAssets();
  await Promise.all(ids.map((id) => {
    userAssetImage(id);
    const r = images.get(id);
    if (!r || r.ok) return null;
    return new Promise((ok) => {
      const done = () => ok();
      r.im.addEventListener('load', done, { once: true });
      r.im.addEventListener('error', done, { once: true });
      setTimeout(done, 5000);
    });
  }));
  return ids.every((id) => images.get(id)?.ok);
}

// ── Import ──
async function toBlob(cv, type, q) { return new Promise((ok) => cv.toBlob(ok, type, q)); }
async function shrink(file, maxDim, thumbPx) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bmp.width * k));
  cv.height = Math.max(1, Math.round(bmp.height * k));
  const g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, cv.width, cv.height);
  let blob = await toBlob(cv, 'image/webp', 0.9);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(cv, 'image/png');
  if (k === 1 && file.size < blob.size) blob = file;
  const tk = Math.min(1, thumbPx / Math.max(cv.width, cv.height));
  const tc = document.createElement('canvas');
  tc.width = Math.max(1, Math.round(cv.width * tk));
  tc.height = Math.max(1, Math.round(cv.height * tk));
  tc.getContext('2d').drawImage(cv, 0, 0, tc.width, tc.height);
  let thumb = tc.toDataURL('image/webp', 0.8);
  if (!thumb.startsWith('data:image/webp')) thumb = tc.toDataURL('image/png');
  const out = { blob, thumb, w0: bmp.width, h0: bmp.height };
  if (bmp.close) bmp.close();
  return out;
}
const SIZE_RE = /[_\-\s(]+(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\)?(?=[_\-\s]|$)/i;
function prettyName(base) {
  return base.replace(SIZE_RE, ' ').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || base;
}
function guessFlags(name, path) {
  const s = `${path} ${name}`.toLowerCase();
  const f = {};
  if (/tree|baum|canopy|krone|roof|dach|chandelier|leuchter|web|netz/.test(s)) f.layer = 'top';
  else if (/rug|carpet|teppich|blood|blut|decal|stain|fleck|floor|boden|puddle|pf(ü|ue)tze|path|weg|debris/.test(s)) f.layer = 'floor';
  if (/pillar|column|s(ä|ae)ule|statue|wall|mauer|boulder|cliff|fels|shelf|regal|wardrobe|schrank|bookcase/.test(s)) f.block = true;
  else if (/table|tisch|bed|bett|barrel|fass|crate|kiste|chest|truhe|bush|busch|rubble|schutt|bench|bank/.test(s)) f.rough = true;
  return f;
}
// files: File[] (auch aus einem gewählten Ordner), ppc: Pixel pro Feld des Pakets (Dungeondraft/FA: meist 256)
export async function importAssetFiles(files, { ppc = 256, pack = '', cat = '', maxDim = 1024, onProgress } = {}) {
  const list = files.filter((f) => /^image\/(png|webp|jpe?g)$/i.test(f.type) || /\.(png|webp|jpe?g)$/i.test(f.name));
  let n = 0;
  try { await navigator.storage?.persist?.(); } catch { /* egal */ }
  for (const f of list) {
    try {
      const path = (f.webkitRelativePath || '').split('/').slice(0, -1);
      const base = f.name.replace(/\.[a-z0-9]+$/i, '');
      const { blob, thumb, w0, h0 } = await shrink(f, maxDim, 112);
      let w = w0 / ppc;
      let h = h0 / ppc;
      const m = SIZE_RE.exec(base);
      if (m) {
        const sw = Number(m[1].replace(',', '.'));
        const sh = Number(m[2].replace(',', '.'));
        const ra = w0 / h0;
        if (sw > 0 && sh > 0 && Math.abs(Math.log(ra / (sw / sh))) < 0.2) { w = sw; h = sh; } else if (sw > 0 && sh > 0 && Math.abs(Math.log(ra / (sh / sw))) < 0.2) { w = sh; h = sw; }
      }
      const rec = {
        id: uid(12), name: prettyName(base), pack: pack || path[0] || '', cat: cat || path[path.length - 1] || '',
        w: Math.round(Math.max(0.1, w) * 100) / 100, h: Math.round(Math.max(0.1, h) * 100) / 100, thumb, createdAt: Date.now(), ...guessFlags(base, path.join('/')),
      };
      await run(['meta', 'blobs'], 'readwrite', (t) => { t.objectStore('meta').put(rec); t.objectStore('blobs').put(blob, rec.id); });
      metas.set(rec.id, rec);
      n++;
    } catch { /* Datei überspringen */ }
    onProgress?.(n, list.length);
    if (n % 25 === 0) emit();
  }
  emit();
  return n;
}
export async function updateUserAsset(id, patch) {
  const m = metas.get(id);
  if (!m) return;
  const next = { ...m, ...patch };
  await run(['meta'], 'readwrite', (t) => t.objectStore('meta').put(next));
  metas.set(id, next);
  emit();
}
export async function deleteUserAssets(ids) {
  await run(['meta', 'blobs'], 'readwrite', (t) => { for (const id of ids) { t.objectStore('meta').delete(id); t.objectStore('blobs').delete(id); } });
  for (const id of ids) {
    metas.delete(id);
    const r = images.get(id);
    if (r?.im.src.startsWith('blob:')) URL.revokeObjectURL(r.im.src);
    images.delete(id);
  }
  emit();
}
