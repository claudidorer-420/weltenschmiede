// Bilder vor dem Speichern verkleinern/komprimieren (spart Platz in IndexedDB/Firestore).

async function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch { /* fallback unten */ }
  }
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      res(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      rej(e);
    };
    img.src = url;
  });
}

function toBlob(canvas, type, quality) {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

export async function compressImage(blob, { maxDim = 1800, quality = 0.84, keepAlpha = true } = {}) {
  if (!/^image\//.test(blob.type) || /svg|gif/.test(blob.type)) return { blob, w: 0, h: 0 };
  const bmp = await loadBitmap(blob);
  const w0 = bmp.width;
  const h0 = bmp.height;
  const scale = Math.min(1, maxDim / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  let out = await toBlob(canvas, 'image/webp', quality);
  if (!out || out.type !== 'image/webp') out = await toBlob(canvas, keepAlpha && blob.type === 'image/png' ? 'image/png' : 'image/jpeg', quality);
  // Original behalten, wenn es schon kleiner und klein genug ist
  if (scale === 1 && out && blob.size <= out.size) return { blob, w, h };
  return { blob: out || blob, w, h };
}

export async function dataUrlFromImageFile(file, opts) {
  const { blob } = await compressImage(file, opts);
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export async function imageSize(blob) {
  try {
    const b = await loadBitmap(blob);
    const s = { w: b.width, h: b.height };
    if (b.close) b.close();
    return s;
  } catch {
    return { w: 0, h: 0 };
  }
}
