// Versiegelte Token (AES-GCM mit dem Worker-Geheimnis) – der Server braucht dadurch keinen Speicher.
const enc = new TextEncoder();
const dec = new TextDecoder();
const keys = new Map();

async function keyFor(secret) {
  if (!secret || secret.length < 32) throw new Error('SEAL_SECRET fehlt oder ist zu kurz (mind. 32 Zeichen).');
  if (!keys.has(secret)) {
    const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
    keys.set(secret, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
  }
  return keys.get(secret);
}

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function seal(secret, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(secret), enc.encode(JSON.stringify(obj)));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return b64url(out);
}

// Liefert null bei jedem Fehler (manipuliert, falsches Geheimnis, falscher Typ, abgelaufen).
export async function unseal(secret, token, typ) {
  try {
    const raw = unb64url(String(token || ''));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await keyFor(secret), raw.slice(12));
    const obj = JSON.parse(dec.decode(pt));
    if (typ && obj.typ !== typ) return null;
    if (obj.exp && obj.exp < Date.now()) return null;
    return obj;
  } catch {
    return null;
  }
}

export async function sha256b64url(text) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}
