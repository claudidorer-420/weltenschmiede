// Anhänge (Bilder, Karten, Porträts). Gespeichert als Data-URL in Stücken (≤ 900 KB),
// damit es identisch in IndexedDB und Firestore (1-MB-Grenze pro Dokument) funktioniert –
// Firebase Storage (kostenpflichtig) wird so nicht benötigt.
import { db } from './db.js';
import { uid, now, blobToDataURL, dataURLToBlob } from '../lib/util.js';
import { compressImage } from '../lib/image.js';

const CHUNK = 900_000;
const urlCache = new Map();

export function filesCol(cid) {
  return `campaigns/${cid}/files`;
}

export async function saveFile(cid, blob, { name, folder = 'attachments', visibility = 'gm', maxDim = 1800, createdBy = '', kind = 'attachment', exists } = {}) {
  let data = blob;
  let w = 0;
  let h = 0;
  if (/^image\/(png|jpe?g|webp|bmp)/.test(blob.type)) {
    const r = await compressImage(blob, { maxDim });
    data = r.blob;
    w = r.w;
    h = r.h;
  }
  const dataUrl = await blobToDataURL(data);
  const id = uid(20);
  const parts = [];
  for (let i = 0; i < dataUrl.length; i += CHUNK) parts.push(dataUrl.slice(i, i + CHUNK));
  const ext = (data.type.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  let fname = name || `Bild-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${ext}`;
  if (!/\.[a-z0-9]{2,5}$/i.test(fname)) fname += `.${ext}`;
  else if (data !== blob && !fname.toLowerCase().endsWith(`.${ext}`)) fname = fname.replace(/\.[a-z0-9]+$/i, `.${ext}`);
  if (exists) {
    const m = /^(.*?)(\.[a-z0-9]+)$/i.exec(fname);
    const base = m ? m[1] : fname;
    const dot = m ? m[2] : '';
    for (let i = 1; exists(fname) && i < 500; i++) fname = `${base} ${i}${dot}`;
  }
  const meta = { name: fname, mime: data.type, size: data.size, w, h, folder, visibility, kind, chunks: parts.length, createdAt: now(), createdBy };
  const col = filesCol(cid);
  await db.batch([
    ...parts.map((d, i) => ({ op: 'set', col: `${col}/${id}/chunks`, id: String(i), data: { d } })),
    { op: 'set', col, id, data: meta },
  ]);
  urlCache.set(id, Promise.resolve(URL.createObjectURL(data)));
  return { id, ...meta };
}

export function saveDataUrl(cid, dataUrl, opts) {
  return saveFile(cid, dataURLToBlob(dataUrl), opts);
}

export async function fileDataUrl(cid, fid) {
  const chunks = await db.list(`${filesCol(cid)}/${fid}/chunks`);
  chunks.sort((a, b) => Number(a.id) - Number(b.id));
  return chunks.map((c) => c.d).join('');
}

export function fileUrl(cid, fid) {
  if (!fid) return Promise.resolve('');
  if (urlCache.has(fid)) return urlCache.get(fid);
  const p = fileDataUrl(cid, fid)
    .then((d) => (d ? URL.createObjectURL(dataURLToBlob(d)) : ''))
    .catch(() => '');
  urlCache.set(fid, p);
  p.then((u) => { if (!u) urlCache.delete(fid); });
  return p;
}

export async function deleteFile(cid, fid) {
  const col = filesCol(cid);
  const chunks = await db.list(`${col}/${fid}/chunks`);
  await db.batch([...chunks.map((c) => ({ op: 'delete', col: `${col}/${fid}/chunks`, id: c.id })), { op: 'delete', col, id: fid }]);
  urlCache.delete(fid);
}

export async function updateFileMeta(cid, fid, patch) {
  await db.update(filesCol(cid), fid, patch);
}
