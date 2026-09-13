// Cloud-Adapter (Firebase Firestore + Auth), wird nur geladen, wenn eine Firebase-Konfiguration existiert.
// Gleiche API wie db-local.js. Offline-Cache von Firestore ist aktiv (IndexedDB), d. h. die App funktioniert
// auch ohne Netz weiter und synchronisiert, sobald wieder Verbindung besteht.
import { clean, slugify } from '../lib/util.js';

const FIREBASE_VERSION = '12.19.0';
const BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const PSEUDO_DOMAIN = 'weltenschmiede.example.com';

export function pseudoEmail(name) {
  return `${slugify(name) || 'held'}@${PSEUDO_DOMAIN}`;
}

const AUTH_ERRORS = {
  'auth/email-already-in-use': 'Dieser Name ist schon vergeben. Wähle einen anderen oder melde dich an.',
  'auth/invalid-credential': 'Name oder Geheimwort falsch.',
  'auth/wrong-password': 'Name oder Geheimwort falsch.',
  'auth/user-not-found': 'Name oder Geheimwort falsch.',
  'auth/invalid-email': 'Der Name enthält keine gültigen Zeichen.',
  'auth/weak-password': 'Das Geheimwort braucht mindestens 6 Zeichen.',
  'auth/missing-password': 'Bitte ein Geheimwort eingeben.',
  'auth/operation-not-allowed': 'In Firebase ist „E-Mail/Passwort“-Anmeldung noch nicht aktiviert (README → Cloud einrichten, Schritt 3).',
  'auth/network-request-failed': 'Keine Verbindung zum Server.',
  'auth/too-many-requests': 'Zu viele Versuche – bitte kurz warten.',
  'auth/unauthorized-domain': 'Diese Adresse ist in Firebase nicht freigegeben (Authentication → Einstellungen → Autorisierte Domains).',
  'auth/requires-recent-login': 'Bitte einmal ab- und wieder anmelden und dann erneut versuchen.',
};

export function authErrorMessage(e) {
  return AUTH_ERRORS[e?.code] || e?.message || String(e);
}

export async function initCloud(config) {
  const [appM, authM, fsM] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-firestore.js`),
  ]);
  const app = appM.getApps().length ? appM.getApp() : appM.initializeApp(config);
  const auth = authM.getAuth(app);
  let fdb;
  try {
    fdb = fsM.initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }),
    });
  } catch {
    fdb = fsM.getFirestore(app);
  }

  const colRef = (path) => fsM.collection(fdb, path);
  const docRef = (path, id) => fsM.doc(fdb, path, id);
  const toDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  function buildQuery(path, opts = {}) {
    const cons = [];
    for (const [f, op, v] of opts.where || []) cons.push(fsM.where(f === '__id' ? fsM.documentId() : f, op, v));
    if (opts.orderBy) cons.push(fsM.orderBy(opts.orderBy[0], opts.orderBy[1] || 'asc'));
    if (opts.limit) cons.push(fsM.limit(opts.limit));
    return cons.length ? fsM.query(colRef(path), ...cons) : colRef(path);
  }

  const api = {
    kind: 'cloud',
    config,
    async get(col, id) {
      const s = await fsM.getDoc(docRef(col, id));
      return s.exists() ? { id: s.id, ...s.data() } : null;
    },
    async list(col, opts) {
      return toDocs(await fsM.getDocs(buildQuery(col, opts)));
    },
    async set(col, id, data, { merge = false } = {}) {
      await fsM.setDoc(docRef(col, id), clean(data), { merge });
    },
    async update(col, id, patch) {
      await fsM.updateDoc(docRef(col, id), clean(patch));
    },
    async remove(col, id) {
      await fsM.deleteDoc(docRef(col, id));
    },
    async batch(ops) {
      for (let i = 0; i < ops.length; i += 400) {
        const b = fsM.writeBatch(fdb);
        for (const op of ops.slice(i, i + 400)) {
          const ref = docRef(op.col, op.id);
          if (op.op === 'delete') b.delete(ref);
          else if (op.op === 'update') b.update(ref, clean(op.data));
          else b.set(ref, clean(op.data), { merge: !!op.merge });
        }
        await b.commit();
      }
    },
    watchCol(col, opts, cb, onErr) {
      return fsM.onSnapshot(
        buildQuery(col, opts),
        { includeMetadataChanges: false },
        (snap) => cb(toDocs(snap), snap.metadata),
        (e) => {
          console.warn('[cloud] watch', col, e);
          onErr?.(e);
        },
      );
    },
    watchDoc(col, id, cb, onErr) {
      return fsM.onSnapshot(
        docRef(col, id),
        (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null),
        (e) => {
          console.warn('[cloud] watchDoc', col, id, e);
          onErr?.(e);
        },
      );
    },
    async removePrefix() {
      // In Firestore gibt es kein Löschen per Präfix – Aufrufer löschen Sammlungen einzeln.
    },
    onSync(cb) {
      return fsM.onSnapshotsInSync(fdb, cb);
    },
    // ── Auth ──
    onAuth(cb) {
      return authM.onAuthStateChanged(auth, cb);
    },
    currentUser() {
      return auth.currentUser;
    },
    async signIn(name, secret) {
      return (await authM.signInWithEmailAndPassword(auth, pseudoEmail(name), secret)).user;
    },
    async register(name, secret) {
      const cred = await authM.createUserWithEmailAndPassword(auth, pseudoEmail(name), secret);
      await authM.updateProfile(cred.user, { displayName: name });
      return cred.user;
    },
    async signOut() {
      await authM.signOut(auth);
    },
    async changeSecret(newSecret) {
      await authM.updatePassword(auth.currentUser, newSecret);
    },
    async rename(displayName) {
      await authM.updateProfile(auth.currentUser, { displayName });
    },
  };
  return api;
}
