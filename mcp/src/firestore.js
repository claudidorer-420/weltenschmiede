// Firebase Auth + Firestore über REST – mit dem Konto des Nutzers, die Firestore-Regeln gelten wie in der App.
const PSEUDO_DOMAIN = 'weltenschmiede.example.com';

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const pseudoEmail = (name) => `${slugify(name) || 'held'}@${PSEUDO_DOMAIN}`;

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function newId(n = 20) {
  const a = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const b of a) s += ID_CHARS[b % 36];
  return s;
}

function headers(env, extra = {}) {
  // Falls der API-Schlüssel auf Referrer beschränkt ist, als die veröffentlichte App auftreten.
  return { 'content-type': 'application/json', referer: env.APP_URL || '', ...extra };
}

const AUTH_ERRORS = {
  INVALID_LOGIN_CREDENTIALS: 'Name oder Geheimwort falsch.',
  INVALID_PASSWORD: 'Name oder Geheimwort falsch.',
  EMAIL_NOT_FOUND: 'Name oder Geheimwort falsch.',
  USER_DISABLED: 'Dieses Konto ist gesperrt.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Zu viele Versuche – bitte kurz warten.',
};

export async function signInWithPassword(env, name, secret) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ email: pseudoEmail(name), password: secret, returnSecureToken: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = String(j?.error?.message || '').split(' ')[0];
    throw new Error(AUTH_ERRORS[code] || `Anmeldung fehlgeschlagen (${code || r.status}).`);
  }
  return { uid: j.localId, name: j.displayName || name, refreshToken: j.refreshToken, idToken: j.idToken, expiresIn: Number(j.expiresIn) };
}

// ID-Token je Isolate zwischenspeichern (gültig 1 h)
const idCache = new Map();

export async function idTokenFor(env, refreshToken) {
  const hit = idCache.get(refreshToken);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${env.FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: headers(env, { 'content-type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error('Die Anmeldung ist abgelaufen (Geheimwort geändert?). Bitte den Connector neu verbinden.');
    err.auth = true;
    throw err;
  }
  if (idCache.size > 500) idCache.clear();
  idCache.set(refreshToken, { token: j.id_token, exp: Date.now() + Number(j.expires_in || 3600) * 1000 });
  return j.id_token;
}

// ── Werte umwandeln ──
function toValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) {
    if (v.some((x) => Array.isArray(x))) throw new Error('Firestore kennt keine verschachtelten Listen – Punkte flach speichern (x1, y1, x2, y2 …).');
    return { arrayValue: { values: v.filter((x) => x !== undefined).map(toValue) } };
  }
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new Error(`Nicht speicherbarer Wert: ${typeof v}`);
}

function toFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined) f[k] = toValue(v);
  return f;
}

function fromValue(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields);
  return null;
}

function fromFields(fields) {
  const o = {};
  for (const [k, v] of Object.entries(fields || {})) o[k] = fromValue(v);
  return o;
}

const fromDoc = (d) => ({ id: d.name.split('/').pop(), ...fromFields(d.fields) });
const fieldPath = (k) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(k) ? k : '`' + k.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`');

export function cleanPath(p) {
  const parts = String(p || '').split('/').filter(Boolean);
  if (!parts.length || parts.some((x) => x === '.' || x === '..')) throw new Error(`Ungültiger Pfad: „${p}“`);
  return parts.join('/');
}

export class Firestore {
  constructor(env, idToken) {
    this.env = env;
    this.token = idToken;
    this.root = `projects/${env.FIREBASE_PROJECT}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
  }

  async call(url, init = {}) {
    const r = await fetch(url, { ...init, headers: headers(this.env, { authorization: `Bearer ${this.token}` }) });
    if (r.status === 404 && (init.method || 'GET') === 'GET') return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const st = j?.error?.status || r.status;
      if (st === 'PERMISSION_DENIED') throw new Error('Keine Berechtigung (Firestore-Regeln) – z. B. nur die Spielleitung darf das, oder der Inhalt ist nicht für Spieler freigegeben.');
      if (st === 'NOT_FOUND') throw new Error('Nicht gefunden.');
      throw new Error(`Firestore: ${j?.error?.message || st}`);
    }
    return j;
  }

  async get(path) {
    const j = await this.call(`${this.base}/${cleanPath(path)}`);
    return j ? fromDoc(j) : null;
  }

  // Ganze Sammlung (nur wo die Regeln Listen ohne Filter erlauben)
  async list(path, { max = 2000 } = {}) {
    const out = [];
    let token = '';
    do {
      const q = new URLSearchParams({ pageSize: '300' });
      if (token) q.set('pageToken', token);
      const j = await this.call(`${this.base}/${cleanPath(path)}?${q}`);
      for (const d of j?.documents || []) out.push(fromDoc(d));
      token = j?.nextPageToken || '';
    } while (token && out.length < max);
    return out;
  }

  // where: [[feld, op, wert]], op: == != < <= > >= array-contains in
  async query(path, { where = [], orderBy = null, limit = 0 } = {}) {
    const parts = cleanPath(path).split('/');
    const collectionId = parts.pop();
    const parent = parts.length ? `${this.base}/${parts.join('/')}` : this.base;
    const OPS = { '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', 'array-contains': 'ARRAY_CONTAINS', in: 'IN' };
    const filters = where.map(([f, op, v]) => ({ fieldFilter: { field: { fieldPath: fieldPath(f) }, op: OPS[op] || 'EQUAL', value: toValue(v) } }));
    const sq = { from: [{ collectionId }] };
    if (filters.length === 1) sq.where = filters[0];
    else if (filters.length > 1) sq.where = { compositeFilter: { op: 'AND', filters } };
    if (orderBy) sq.orderBy = [{ field: { fieldPath: fieldPath(orderBy[0]) }, direction: orderBy[1] === 'desc' ? 'DESCENDING' : 'ASCENDING' }];
    if (limit) sq.limit = limit;
    const j = await this.call(`${parent}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: sq }) });
    return (j || []).filter((x) => x.document).map((x) => fromDoc(x.document));
  }

  async set(path, data, { merge = false } = {}) {
    const q = new URLSearchParams();
    if (merge) for (const k of Object.keys(data)) if (data[k] !== undefined) q.append('updateMask.fieldPaths', fieldPath(k));
    const { id: _id, ...rest } = data;
    await this.call(`${this.base}/${cleanPath(path)}${merge ? `?${q}` : ''}`, { method: 'PATCH', body: JSON.stringify({ fields: toFields(rest) }) });
  }

  async update(path, data) {
    const q = new URLSearchParams({ 'currentDocument.exists': 'true' });
    const { id: _id, ...rest } = data;
    for (const k of Object.keys(rest)) q.append('updateMask.fieldPaths', fieldPath(k));
    await this.call(`${this.base}/${cleanPath(path)}?${q}`, { method: 'PATCH', body: JSON.stringify({ fields: toFields(rest) }) });
  }

  async add(path, data) {
    const id = newId(20);
    await this.set(`${cleanPath(path)}/${id}`, data);
    return id;
  }

  async remove(path) {
    await this.call(`${this.base}/${cleanPath(path)}`, { method: 'DELETE' });
  }

  // ops: [{ op: 'set'|'update'|'delete', path, data }]
  async batch(ops) {
    const writes = ops.map((o) => {
      const name = `${this.root}/${cleanPath(o.path)}`;
      if (o.op === 'delete') return { delete: name };
      const { id: _id, ...rest } = o.data || {};
      const w = { update: { name, fields: toFields(rest) } };
      if (o.op === 'update') {
        w.updateMask = { fieldPaths: Object.keys(rest).map(fieldPath) };
        w.currentDocument = { exists: true };
      }
      return w;
    });
    for (let i = 0; i < writes.length; i += 450) {
      await this.call(`${this.base}:commit`, { method: 'POST', body: JSON.stringify({ writes: writes.slice(i, i + 450) }) });
    }
  }
}
