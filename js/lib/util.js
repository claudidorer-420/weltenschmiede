// Kleine, abhängigkeitsfreie Helfer.

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function uid(n = 16) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += ID_CHARS[b % 36];
  return s;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function inviteCode(n = 6) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}

export const now = () => Date.now();
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function randInt(min, max) {
  const range = max - min + 1;
  const a = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / range) * range;
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return min + (a[0] % range);
}
export const pick = (arr) => (arr && arr.length ? arr[randInt(0, arr.length - 1)] : undefined);
export function pickN(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) out.push(copy.splice(randInt(0, copy.length - 1), 1)[0]);
  return out;
}
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function debounce(fn, ms = 300) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function throttle(fn, ms = 100) {
  let last = 0;
  let t;
  return (...args) => {
    const n = Date.now();
    const run = () => {
      last = Date.now();
      fn(...args);
    };
    clearTimeout(t);
    if (n - last >= ms) run();
    else t = setTimeout(run, ms - (n - last));
  };
}

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function fmtDate(ts, opts = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('de-DE', opts);
}
export function fmtDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function fmtTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
}
export function fmtRelative(ts) {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  if (d < 45) return 'gerade eben';
  if (d < 3600) return `vor ${Math.round(d / 60)} Min.`;
  if (d < 86400) return `vor ${Math.round(d / 3600)} Std.`;
  if (d < 86400 * 7) return `vor ${Math.round(d / 86400)} Tg.`;
  return fmtDate(ts);
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 3.6);
}

export function download(filename, data, mime = 'text/plain;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

export async function shareText({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'aborted';
    }
  }
  await copyText([title, text, url].filter(Boolean).join('\n\n'));
  return 'copied';
}

export function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}
export function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(file);
  });
}
export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
export function dataURLToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

export function sortBy(arr, fn, dir = 1) {
  const get = typeof fn === 'function' ? fn : (x) => x[fn];
  return [...arr].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (typeof va === 'string' || typeof vb === 'string') return dir * String(va ?? '').localeCompare(String(vb ?? ''), 'de', { numeric: true, sensitivity: 'base' });
    return dir * ((va ?? 0) - (vb ?? 0));
  });
}

export function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) {
    const k = fn(x);
    (out[k] ||= []).push(x);
  }
  return out;
}

export function deepMerge(target, src) {
  if (Array.isArray(src) || typeof src !== 'object' || src === null) return src;
  const out = { ...(typeof target === 'object' && target && !Array.isArray(target) ? target : {}) };
  for (const [k, v] of Object.entries(src)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}

export function clean(obj) {
  return JSON.parse(JSON.stringify(obj ?? null));
}

export function fuzzyScore(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = String(text || '').toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const idx = t.indexOf(q);
  if (idx >= 0) return 60 - Math.min(idx, 30);
  // Buchstabenfolge
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const f = t.indexOf(ch, ti);
    if (f < 0) return 0;
    score += f === ti ? 3 : 1;
    ti = f + 1;
  }
  return Math.min(40, score);
}

export function titleFromFilename(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}

export function basename(path) {
  return String(path || '').split('/').pop();
}

export function dirname(path) {
  const p = String(path || '').split('/');
  p.pop();
  return p.join('/');
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function colorFromString(s) {
  const h = hashString(String(s)) % 360;
  return `hsl(${h} 55% 55%)`;
}

export function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

export const isTouch = () => matchMedia('(pointer: coarse)').matches;
