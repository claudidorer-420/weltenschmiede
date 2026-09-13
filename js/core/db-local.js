// Lokale Datenbank (IndexedDB) mit derselben API wie der Cloud-Adapter.
// Dokumente werden unter ihrem Pfad gespeichert: "campaigns/abc/notes/n1".
import { clean, deepMerge } from '../lib/util.js';

const DB_NAME = 'weltenschmiede';
const STORE = 'docs';
let dbPromise = null;
const watchers = new Set();
let bc = null;
try {
  bc = new BroadcastChannel('ws-db');
  bc.onmessage = (e) => notify(e.data?.col, false);
} catch { /* BroadcastChannel nicht verfügbar */ }

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const s = d.createObjectStore(STORE, { keyPath: 'path' });
          s.createIndex('col', 'col');
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Datenbank blockiert – bitte andere Tabs der App schließen.'));
    });
  }
  return dbPromise;
}

const req = (r) => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

function match(doc, [field, op, value]) {
  const v = field === '__id' ? doc.id : doc[field];
  switch (op) {
    case '==': return v === value;
    case '!=': return v !== value;
    case '<': return v < value;
    case '<=': return v <= value;
    case '>': return v > value;
    case '>=': return v >= value;
    case 'in': return Array.isArray(value) && value.includes(v);
    case 'not-in': return Array.isArray(value) && !value.includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(value);
    case 'array-contains-any': return Array.isArray(v) && Array.isArray(value) && value.some((x) => v.includes(x));
    default: return true;
  }
}

export function applyQuery(docs, opts = {}) {
  let out = docs;
  if (opts.where?.length) out = out.filter((d) => opts.where.every((w) => match(d, w)));
  if (opts.orderBy) {
    const [f, dir] = opts.orderBy;
    const s = dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => (a[f] > b[f] ? s : a[f] < b[f] ? -s : 0));
  }
  if (opts.limit) out = out.slice(0, opts.limit);
  return out;
}

function notify(col, broadcast = true) {
  if (!col) return;
  for (const w of watchers) if (w.col === col) schedule(w);
  if (broadcast && bc) {
    try { bc.postMessage({ col }); } catch { /* ignore */ }
  }
}

function schedule(w) {
  if (w.pending) return;
  w.pending = true;
  setTimeout(async () => {
    w.pending = false;
    if (!watchers.has(w)) return;
    try {
      if (w.id !== undefined) w.cb(await local.get(w.col, w.id));
      else w.cb(await local.list(w.col, w.opts));
    } catch (e) {
      w.onErr?.(e);
    }
  }, 0);
}

function writeOps(ops) {
  return open().then((d) => new Promise((res, rej) => {
    const t = d.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    for (const op of ops) {
      const key = `${op.col}/${op.id}`;
      if (op.op === 'delete') s.delete(key);
      else if (op.op === 'set' && !op.merge) s.put({ path: key, col: op.col, id: op.id, data: clean(op.data) });
      else {
        const g = s.get(key);
        g.onsuccess = () => {
          const prev = g.result?.data;
          if (op.op === 'update' && !prev) return; // wie Firestore: update auf fehlendes Dokument ignorieren
          const data = op.op === 'update' ? { ...prev, ...clean(op.data) } : deepMerge(prev || {}, clean(op.data));
          s.put({ path: key, col: op.col, id: op.id, data });
        };
      }
    }
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Speichern abgebrochen (Speicher voll?)'));
  })).then(() => {
    const cols = new Set(ops.map((o) => o.col));
    cols.forEach((c) => notify(c));
  });
}

export const local = {
  kind: 'local',
  async get(col, id) {
    const d = await open();
    const r = await req(d.transaction(STORE, 'readonly').objectStore(STORE).get(`${col}/${id}`));
    return r ? { id: r.id, ...r.data } : null;
  },
  async list(col, opts = {}) {
    const d = await open();
    const rows = await req(d.transaction(STORE, 'readonly').objectStore(STORE).index('col').getAll(col));
    return applyQuery(rows.map((r) => ({ id: r.id, ...r.data })), opts);
  },
  set(col, id, data, { merge = false } = {}) {
    return writeOps([{ op: 'set', col, id, data, merge }]);
  },
  update(col, id, patch) {
    return writeOps([{ op: 'update', col, id, data: patch }]);
  },
  remove(col, id) {
    return writeOps([{ op: 'delete', col, id }]);
  },
  batch(ops) {
    return ops.length ? writeOps(ops) : Promise.resolve();
  },
  watchCol(col, opts, cb, onErr) {
    const w = { col, opts: opts || {}, cb, onErr, pending: false };
    watchers.add(w);
    schedule(w);
    return () => watchers.delete(w);
  },
  watchDoc(col, id, cb, onErr) {
    const w = { col, id, cb, onErr, pending: false };
    watchers.add(w);
    schedule(w);
    return () => watchers.delete(w);
  },
  async removePrefix(prefix) {
    const d = await open();
    await new Promise((res, rej) => {
      const t = d.transaction(STORE, 'readwrite');
      const s = t.objectStore(STORE);
      const range = IDBKeyRange.bound(prefix, prefix + '￿');
      const cur = s.openCursor(range);
      const cols = new Set();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) {
          cols.add(c.value.col);
          c.delete();
          c.continue();
        }
      };
      t.oncomplete = () => {
        cols.forEach((col) => notify(col));
        res();
      };
      t.onerror = () => rej(t.error);
    });
  },
  async dumpAll() {
    const d = await open();
    return req(d.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  },
  async estimate() {
    try {
      const e = await navigator.storage?.estimate?.();
      return e || null;
    } catch {
      return null;
    }
  },
};

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) return navigator.storage.persist();
    return true;
  } catch {
    return false;
  }
}
