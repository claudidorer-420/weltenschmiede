// Hooks für Live-Daten aus der Datenbank.
import { useState, useEffect } from '../lib/preact.js';
import { db } from './db.js';
import { app, playerLens, visQueries } from './app.js';
import { useStore } from './store.js';

export function useCol(path, opts) {
  const [docs, setDocs] = useState(null);
  const key = path ? `${path}|${JSON.stringify(opts || {})}` : '';
  useEffect(() => {
    if (!path) {
      setDocs(null);
      return undefined;
    }
    setDocs(null);
    return db.watchCol(path, opts || {}, (d) => setDocs(d), (e) => {
      console.warn('[useCol]', path, e);
      setDocs([]);
    });
  }, [key]);
  return docs;
}

export function useDoc(path, id) {
  const [doc, setDoc] = useState(undefined);
  useEffect(() => {
    if (!path || !id) {
      setDoc(null);
      return undefined;
    }
    setDoc(undefined);
    return db.watchDoc(path, id, (d) => setDoc(d), () => setDoc(null));
  }, [path, id]);
  return doc;
}

// Sammlung mit Sichtbarkeitsfeld: Spieler erhalten nur „players“-Dokumente (auch in der SL-Vorschau).
export function useVisibleCol(name) {
  const cid = useStore(app, (s) => s.cid);
  const role = useStore(app, (s) => s.role);
  const preview = useStore(app, (s) => s.viewAsPlayer);
  const uid = useStore(app, (s) => s.user?.uid || '');
  const gm = role === 'gm';
  const qs = gm ? [{}, null] : visQueries(uid);
  const path = cid ? `campaigns/${cid}/${name}` : null;
  // Spieler: alles für alle Freigegebene + alles nur für sie Freigegebene
  const a = useCol(path, qs[0] || {});
  const b = useCol(gm ? null : path, qs[1] || {});
  if (!a) return a;
  const docs = gm ? a : [...a, ...(b || []).filter((d) => !a.some((x) => x.id === d.id))];
  return preview ? docs.filter((d) => d.visibility === 'players' && (!d.onlyN || (d.only || []).includes(uid))) : docs;
}

export function visibilityOpts() {
  return playerLens() && app.get().role !== 'gm' ? { where: [['visibility', '==', 'players']] } : {};
}
