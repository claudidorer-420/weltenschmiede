// Datenbank-Fassade: leitet an lokal (IndexedDB) oder Cloud (Firestore) weiter.
import { local } from './db-local.js';
import { uid } from '../lib/util.js';

let impl = local;
let mode = 'local';
let cloudApi = null;

export const db = {
  get mode() { return mode; },
  get cloud() { return cloudApi; },
  get: (col, id) => impl.get(col, id),
  list: (col, opts) => impl.list(col, opts),
  set: (col, id, data, opts) => impl.set(col, id, data, opts),
  update: (col, id, patch) => impl.update(col, id, patch),
  remove: (col, id) => impl.remove(col, id),
  batch: (ops) => impl.batch(ops),
  watchCol: (col, opts, cb, onErr) => impl.watchCol(col, opts, cb, onErr),
  watchDoc: (col, id, cb, onErr) => impl.watchDoc(col, id, cb, onErr),
  async add(col, data) {
    const id = uid(20);
    await impl.set(col, id, data);
    return id;
  },
  async removeCollection(col) {
    const docs = await impl.list(col);
    if (docs.length) await impl.batch(docs.map((d) => ({ op: 'delete', col, id: d.id })));
    return docs.length;
  },
  async removePrefix(prefix) {
    if (impl.removePrefix) await impl.removePrefix(prefix);
  },
};

export async function connectCloud(config) {
  const m = await import('./db-cloud.js');
  cloudApi = await m.initCloud(config);
  impl = cloudApi;
  mode = 'cloud';
  return cloudApi;
}

export function useLocalDb() {
  impl = local;
  mode = 'local';
}

export { local as localDb };
