// Zentraler App-Zustand: Anmeldung, Kampagnen, Mitgliedschaft/Rollen, Codex (Notizen) + Index.
import { createStore, useStore } from './store.js';
import { db, connectCloud, useLocalDb } from './db.js';
import {
  settings, getCloudConfig, setCloudConfig, modePref, setCloudSettingsSync, mergeRemoteSettings, applyTheme, ensureSettingsOwner, clearAiKeys,
  hasBakedCloudConfig,
} from './settings.js';
import { uid, now, inviteCode, sortBy } from '../lib/util.js';
import { renameLinkTarget } from '../lib/markdown.js';
import { deriveNoteFields as deriveFields, searchNoteList, cleanTitle, cleanPath, uniqueTitleIn } from '../lib/notes.js';

// UI-Brücke (wird von ui/components.js belegt), damit der Kern keine UI importiert
export const bridge = {
  toast: (msg) => console.log('[toast]', msg),
};

export const app = createStore({
  phase: 'boot', // boot | login | loading | ready
  mode: 'local', // local | cloud
  user: null, // { uid, name }
  campaigns: [], // [{ id, name, role }]
  cid: null,
  campaign: null,
  role: 'gm',
  viewAsPlayer: false,
  sync: 'local',
  joinCode: null,
  cloudError: null,
});

export const vault = createStore({ notes: {}, files: {}, members: {}, version: 0, loaded: false });

export const myUid = () => app.get().user?.uid;
export const myName = () => app.get().user?.name || 'Unbekannt';
export const isRealGM = () => app.get().role === 'gm';
export const isGM = () => app.get().role === 'gm' && !app.get().viewAsPlayer;
export const col = (name, cid = app.get().cid) => `campaigns/${cid}/${name}`;
export const userCol = (name) => `users/${myUid()}/${name}`;

export function encodeB64Url(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeB64Url(s) {
  return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
}

// ───────────────────────── Start & Anmeldung ─────────────────────────
let explicitLogin = false; // true = gerade eben angemeldet → Übersicht statt letzter Kampagne
let pendingKind = null; // gewählte Rolle beim Anmelden ('gm' | 'player')
let pendingName = '';

export async function boot() {
  applyTheme();
  const h = location.hash || '';
  if (/#\/offline\b/.test(h)) {
    modePref.set('local');
    history.replaceState(null, '', location.pathname + location.search);
  }
  const jm = /#\/join\/([A-Za-z0-9]{4,12})/.exec(h);
  if (jm) {
    app.set({ joinCode: jm[1].toUpperCase() });
    if (modePref.get() === 'local') modePref.set('auto');
  }
  const fm = /[?&]fb=([A-Za-z0-9_-]+)/.exec(h);
  if (fm) {
    try {
      const cfg = decodeB64Url(fm[1]);
      if (cfg.apiKey && cfg.projectId && !getCloudConfig()) setCloudConfig(cfg);
    } catch { /* ungültiger Link */ }
  }
  const cfg = getCloudConfig();
  if (cfg && modePref.get() !== 'local') {
    try {
      const cloud = await connectCloud(cfg);
      app.set({ mode: 'cloud', sync: navigator.onLine ? 'synced' : 'offline' });
      cloud.onAuth(async (fu) => {
        if (fu) {
          const explicit = explicitLogin;
          explicitLogin = false;
          await onSignedIn({ uid: fu.uid, name: fu.displayName || pendingName || 'Held' }, { explicit });
        } else {
          stopCampaign();
          app.set({ user: null, campaigns: [], cid: null, campaign: null, phase: 'login' });
        }
      });
      cloud.onSync(() => app.set({ sync: navigator.onLine ? 'synced' : 'offline' }));
      addEventListener('online', () => app.set({ sync: 'synced' }));
      addEventListener('offline', () => app.set({ sync: 'offline' }));
      return;
    } catch (e) {
      console.error(e);
      useLocalDb();
      app.set({ mode: 'local', cloudError: `Cloud nicht erreichbar – lokaler Modus. (${e.message || e})` });
    }
  }
  await onSignedIn({ uid: 'local', name: settings.get().profileName || 'Spielleitung', kind: 'gm' });
}

async function onSignedIn(baseUser, { explicit = false } = {}) {
  let user = { kind: 'gm', ...baseUser };
  app.set({ user, mode: db.mode, phase: 'loading' });
  try {
    if (db.mode === 'cloud') {
      ensureSettingsOwner(user.uid);
      let profile = null;
      try { profile = await db.get('users', user.uid); } catch { /* offline */ }
      const kind = pendingKind || profile?.kind || 'gm';
      pendingKind = null;
      user = { ...user, name: user.name === 'Held' && profile?.name ? profile.name : user.name, kind };
      app.set({ user });
      db.set('users', user.uid, { name: user.name, kind, lastSeen: now() }, { merge: true }).catch(() => {});
      try {
        const remote = await db.get(`users/${user.uid}/private`, 'settings');
        if (remote?.data) mergeRemoteSettings(remote.data);
      } catch { /* offline */ }
      setCloudSettingsSync((data) => db.set(`users/${user.uid}/private`, 'settings', { data, updatedAt: now() }).catch(() => {}));
    } else ensureSettingsOwner(user.uid); // KI-Schlüssel eines anderen Kontos nie im Offline-Modus weiterverwenden
    await refreshCampaigns();
    let target = null;
    const code = app.get().joinCode;
    if (code) {
      try {
        target = await joinCampaign(code);
        bridge.toast('Willkommen in der Kampagne!', 'success');
      } catch (e) {
        bridge.toast(e.message || String(e), 'error');
      }
      app.set({ joinCode: null });
      history.replaceState(null, '', location.pathname + location.search);
    }
    // Frisch angemeldet → Übersicht. App nur wieder geöffnet → zurück in die zuletzt offene Kampagne.
    if (!target && !explicit && localStorage.getItem(`ws.inCampaign.${user.uid}`) === '1') {
      const last = localStorage.getItem(`ws.lastCampaign.${user.uid}`);
      target = app.get().campaigns.find((c) => c.id === last)?.id || null;
    }
    if (target) await openCampaign(target);
  } catch (e) {
    console.error(e);
    bridge.toast(`Fehler beim Laden: ${e.message || e}`, 'error');
  }
  app.set({ phase: 'ready' });
}

export async function signIn(name, secret, kind) {
  explicitLogin = true;
  pendingKind = kind || null;
  pendingName = name;
  try {
    return await db.cloud.signIn(name, secret);
  } catch (e) {
    explicitLogin = false;
    pendingKind = null;
    throw e;
  }
}

export async function register(name, secret, kind = 'gm') {
  explicitLogin = true;
  pendingKind = kind;
  pendingName = name;
  try {
    const u = await db.cloud.register(name, secret);
    await db.set('users', u.uid, { name, kind, createdAt: now() }, { merge: true }).catch(() => {});
    return u;
  } catch (e) {
    explicitLogin = false;
    pendingKind = null;
    throw e;
  }
}

// Abmelden: KI-Schlüssel verlassen das Gerät; mit wipe zusätzlich Offline-Kopie + lokale Daten löschen
export async function signOut({ wipe = false } = {}) {
  if (db.mode !== 'cloud') {
    modePref.set('auto');
    location.reload();
    return;
  }
  stopCampaign();
  setCloudSettingsSync(null);
  clearAiKeys();
  await db.cloud.signOut();
  if (wipe) {
    Object.keys(localStorage).filter((k) => k.startsWith('ws.')).forEach((k) => localStorage.removeItem(k));
    await db.cloud.wipeLocal();
    await new Promise((res) => {
      const r = indexedDB.deleteDatabase('weltenschmiede');
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
    location.reload();
  }
}

export function enterLobby() {
  const u = app.get().user;
  stopCampaign();
  app.set({ cid: null, campaign: null, viewAsPlayer: false });
  if (u) localStorage.setItem(`ws.inCampaign.${u.uid}`, '0');
}

export async function setAccountKind(kind) {
  const u = app.get().user;
  if (!u) return;
  app.set({ user: { ...u, kind } });
  if (db.mode === 'cloud') await db.set('users', u.uid, { kind }, { merge: true }).catch(() => {});
}

export const isGmAccount = () => (app.get().user?.kind || 'gm') === 'gm';

// Regelwerk: wird beim Anlegen der Kampagne festgelegt und gilt für alle Mitglieder.
// Ohne offene Kampagne (Übersicht) zählt die zuletzt gewählte Voreinstellung des Geräts.
const edNorm = (v) => (v === '2024' ? '2024' : '2014');
export const rulesEdition = () => edNorm(app.get().campaign?.settings?.rulesVersion || settings.get().rulesVersion);
export function useEdition() {
  const camp = useStore(app, (s) => s.campaign?.settings?.rulesVersion || null);
  const dev = useStore(settings, (s) => s.rulesVersion || '2014');
  return edNorm(camp || dev);
}

export function renameLocalProfile(name) {
  if (app.get().mode !== 'local') return;
  app.set({ user: { ...app.get().user, name } });
}

// ───────────────────────── Kampagnen ─────────────────────────
export async function refreshCampaigns() {
  const u = app.get().user;
  if (!u) return [];
  const list = sortBy(await db.list(`users/${u.uid}/campaigns`), 'name');
  app.set({ campaigns: list });
  return list;
}

export async function createCampaign({ name, description = '', world = '', edition = settings.get().rulesVersion || '2014' }) {
  const u = app.get().user;
  const cid = uid(20);
  const ed = edition === '2024' ? '2024' : '2014';
  await db.set('campaigns', cid, {
    name, description, world, ownerUid: u.uid, createdAt: now(), updatedAt: now(), folders: [], pbpWaiting: [],
    settings: { rulesVersion: ed, units: settings.get().units || 'm' },
  });
  await db.set(`campaigns/${cid}/members`, u.uid, { uid: u.uid, name: u.name, role: 'gm', joinedAt: now() });
  await db.set(`users/${u.uid}/campaigns`, cid, { name, role: 'gm', joinedAt: now(), edition: ed });
  await refreshCampaigns();
  return cid;
}

export async function updateCampaign(patch) {
  const { cid } = app.get();
  await db.update('campaigns', cid, { ...patch, updatedAt: now() });
  if (patch.name) {
    await db.update(`users/${myUid()}/campaigns`, cid, { name: patch.name }).catch(() => {});
    await refreshCampaigns();
  }
}

let unsubs = [];
let indexCache = null;

export function stopCampaign() {
  unsubs.forEach((f) => { try { f(); } catch { /* ignore */ } });
  unsubs = [];
  indexCache = null;
  vault.replace({ notes: {}, files: {}, members: {}, version: 0, loaded: false });
}

export async function openCampaign(cid) {
  const u = app.get().user;
  if (!u) return false;
  stopCampaign();
  let member = null;
  try {
    member = await db.get(`campaigns/${cid}/members`, u.uid);
  } catch { member = null; }
  if (!member) {
    await db.remove(`users/${u.uid}/campaigns`, cid).catch(() => {});
    await refreshCampaigns();
    bridge.toast('Kein Zugriff (mehr) auf diese Kampagne.', 'error');
    app.set({ cid: null, campaign: null });
    return false;
  }
  app.set({ cid, role: member.role, campaign: null, viewAsPlayer: false });
  localStorage.setItem(`ws.lastCampaign.${u.uid}`, cid);
  localStorage.setItem(`ws.inCampaign.${u.uid}`, '1');
  localStorage.setItem(`ws.lastOpened.${cid}`, String(now()));
  const gm = member.role === 'gm';
  const vis = gm ? {} : { where: [['visibility', '==', 'players']] };
  const onErr = (e) => {
    if (e?.code === 'permission-denied') bridge.toast('Keine Berechtigung – sind die Firestore-Regeln aus firebase/firestore.rules veröffentlicht?', 'error');
  };
  unsubs.push(db.watchDoc('campaigns', cid, (c) => {
    app.set({ campaign: c });
    const entry = app.get().campaigns.find((x) => x.id === cid);
    if (c && entry && entry.name !== c.name) {
      db.update(`users/${u.uid}/campaigns`, cid, { name: c.name }).then(refreshCampaigns).catch(() => {});
    }
  }, onErr));
  // Spieler bekommen zwei Abfragen: für alle freigegeben und nur für sie freigegeben
  const watchShared = (name, apply) => {
    const parts = gm ? [{}] : visQueries(u.uid);
    const buckets = parts.map(() => []);
    parts.forEach((q, i) => unsubs.push(db.watchCol(col(name, cid), q, (docs) => {
      buckets[i] = docs;
      const out = {};
      for (const b of buckets) for (const d of b) out[d.id] = d;
      apply(out);
    }, onErr)));
  };
  watchShared('notes', (notes) => vault.set((s) => ({ notes, version: s.version + 1, loaded: true })));
  watchShared('files', (files) => vault.set((s) => ({ files, version: s.version + 1 })));
  let mitglieder = '';
  unsubs.push(db.watchCol(col('members', cid), {}, (docs) => {
    const members = {};
    for (const d of docs) members[d.id] = d;
    vault.set({ members });
    // Bei jeder Änderung der Mitspieler: Altbestand nachrüsten und „und zukünftige Spieler“ ergänzen
    const key = docs.map((d) => d.id).sort().join(',');
    if (gm && key !== mitglieder) {
      mitglieder = key;
      ensureVisibilityFields(cid).catch(() => {});
    }
  }, onErr));
  return true;
}

const SUBCOLLECTIONS = ['notes', 'secrets', 'trash', 'sessions', 'quests', 'maps', 'pins', 'tokens', 'handouts', 'monsters', 'encounters', 'combat', 'chat', 'whispers', 'posts', 'signals', 'party', 'journal', 'gm'];

export async function deleteCampaign(cid) {
  const u = app.get().user;
  if (db.mode === 'local') {
    await db.removePrefix(`campaigns/${cid}/`);
    await db.remove('campaigns', cid);
  } else {
    const inv = await db.get(`campaigns/${cid}/gm`, 'invites').catch(() => null);
    const files = await db.list(`campaigns/${cid}/files`).catch(() => []);
    for (const f of files) await db.removeCollection(`campaigns/${cid}/files/${f.id}/chunks`).catch(() => {});
    await db.removeCollection(`campaigns/${cid}/files`).catch(() => {});
    for (const sc of SUBCOLLECTIONS) await db.removeCollection(`campaigns/${cid}/${sc}`).catch(() => {});
    for (const code of [inv?.player, inv?.gm].filter(Boolean)) await db.remove('invites', code).catch(() => {});
    await db.removeCollection(`campaigns/${cid}/members`).catch(() => {});
    await db.remove('campaigns', cid);
  }
  await db.remove(`users/${u.uid}/campaigns`, cid).catch(() => {});
  if (app.get().cid === cid) {
    stopCampaign();
    app.set({ cid: null, campaign: null });
  }
  await refreshCampaigns();
}

// ───────────────────────── Einladungen & Mitglieder ─────────────────────────
// Einladungen gelten 48 Stunden, danach muss ein neuer Code erzeugt werden
export const INVITE_TTL = 48 * 60 * 60 * 1000;
const CODE_LEN = { player: 12, gm: 16 };

// Jeder Code wird einmalig vergeben: bei einem (extrem unwahrscheinlichen) Treffer neu würfeln
async function freshCode(len) {
  for (let i = 0; i < 6; i += 1) {
    const c = inviteCode(len);
    const da = await db.get('invites', c).catch(() => null);
    if (!da) return c;
  }
  return inviteCode(len + 4);
}

async function makeInvite(cid, name, role) {
  const code = await freshCode(CODE_LEN[role] || 12);
  await db.set('invites', code, { campaignId: cid, campaignName: name, role, createdAt: now(), expiresAt: now() + INVITE_TTL });
  return code;
}

export const inviteExpired = (d) => !!d?.expiresAt && d.expiresAt <= now();

// Einladungscodes einer Kampagne (nur SL) – beim ersten Aufruf und nach Ablauf neu erzeugt
export async function getInvitesFor(cid, name = '') {
  const inv = await db.get(`campaigns/${cid}/gm`, 'invites').catch(() => null);
  const doc = async (code) => (code ? db.get('invites', code).catch(() => null) : null);
  const [p, g] = await Promise.all([doc(inv?.player), doc(inv?.gm)]);
  const pOk = !!p && !inviteExpired(p);
  const gOk = !!g && !inviteExpired(g);
  if (pOk && gOk) return { ...inv, playerUntil: p.expiresAt || 0, gmUntil: g.expiresAt || 0 };
  const player = pOk ? inv.player : await makeInvite(cid, name, 'player');
  const gm = gOk ? inv.gm : await makeInvite(cid, name, 'gm');
  if (!pOk && inv?.player) await db.remove('invites', inv.player).catch(() => {});
  if (!gOk && inv?.gm) await db.remove('invites', inv.gm).catch(() => {});
  const next = { player, gm, updatedAt: now() };
  await db.set(`campaigns/${cid}/gm`, 'invites', next);
  return { ...next, playerUntil: pOk ? p.expiresAt : now() + INVITE_TTL, gmUntil: gOk ? g.expiresAt : now() + INVITE_TTL };
}

export function getInvites() {
  const { cid, campaign } = app.get();
  return getInvitesFor(cid, campaign?.name || '');
}

export function inviteLink(code) {
  const base = `${location.origin}${location.pathname}`;
  const cfg = getCloudConfig();
  const fb = !hasBakedCloudConfig() && cfg ? `?fb=${encodeB64Url(cfg)}` : '';
  return `${base}#/join/${code}${fb}`;
}

export async function renewInvite(role) {
  const { cid, campaign } = app.get();
  const inv = await getInvites();
  const old = inv[role];
  const code = await makeInvite(cid, campaign?.name || '', role);
  await db.set(col('gm'), 'invites', { player: inv.player, gm: inv.gm, [role]: code, updatedAt: now() });
  if (old) await db.remove('invites', old).catch(() => {});
  return { code, until: now() + INVITE_TTL };
}

export async function joinCampaign(code) {
  const c = String(code || '').trim().toUpperCase();
  if (db.mode !== 'cloud') throw new Error('Zum Beitreten muss die Cloud eingerichtet sein.');
  const inv = await db.get('invites', c);
  if (!inv) throw new Error('Diesen Einladungscode gibt es nicht (mehr).');
  if (inviteExpired(inv)) throw new Error('Dieser Einladungslink ist abgelaufen (48 Stunden). Lass dir bitte einen neuen schicken.');
  const u = app.get().user;
  const existing = await db.get(`campaigns/${inv.campaignId}/members`, u.uid).catch(() => null);
  if (!existing) {
    await db.set(`campaigns/${inv.campaignId}/members`, u.uid, { uid: u.uid, name: u.name, role: inv.role, inviteCode: c, joinedAt: now() });
  }
  await db.set(`users/${u.uid}/campaigns`, inv.campaignId, { name: inv.campaignName || 'Kampagne', role: existing?.role || inv.role, joinedAt: now() });
  await refreshCampaigns();
  return inv.campaignId;
}

export async function leaveCampaign(cid) {
  const u = app.get().user;
  await db.remove(`campaigns/${cid}/members`, u.uid).catch(() => {});
  await db.remove(`users/${u.uid}/campaigns`, cid).catch(() => {});
  if (app.get().cid === cid) {
    stopCampaign();
    app.set({ cid: null, campaign: null });
  }
  await refreshCampaigns();
}

export async function removeMember(memberUid) {
  await db.remove(col('members'), memberUid);
}

export async function setMemberField(memberUid, patch) {
  await db.update(col('members'), memberUid, patch);
}

export function gmUids() {
  return Object.values(vault.get().members).filter((m) => m.role === 'gm').map((m) => m.uid);
}

// ───────────────────────── Codex: Index & Suche ─────────────────────────
export function playerLens() {
  const a = app.get();
  return a.role !== 'gm' || a.viewAsPlayer;
}

// Freigabe „ohne Inhalt“: Spieler bekommen nur die Überschrift – der Text wird hier entfernt,
// damit er auch in Suche, Rückverweisen, Graph und Tags nicht auftaucht.
export function stripTeaser(n) {
  return n && n.teaser && playerLens() ? { ...n, body: '', links: [], tags: [], props: {} } : n;
}

export function visibleNotes() {
  const player = playerLens();
  return Object.values(vault.get().notes).filter((n) => !player || n.visibility === 'players').map(stripTeaser);
}

export function getIndex() {
  const v = vault.get();
  const a = app.get();
  if (indexCache && indexCache.version === v.version && indexCache.lens === `${a.role}:${a.viewAsPlayer}`) return indexCache;
  const notes = sortBy(visibleNotes(), 'title');
  const byId = new Map();
  const byTitle = new Map();
  const byAlias = new Map();
  for (const n of notes) {
    byId.set(n.id, n);
    const k = String(n.title || '').toLowerCase();
    if (!byTitle.has(k)) byTitle.set(k, n);
    for (const al of n.aliases || []) {
      const ak = String(al).toLowerCase();
      if (!byAlias.has(ak)) byAlias.set(ak, n);
    }
  }
  const resolve = (t) => {
    const k = String(t || '').toLowerCase().trim().replace(/\.md$/, '');
    if (!k) return null;
    return byTitle.get(k) || byAlias.get(k) || (k.includes('/') ? byTitle.get(k.split('/').pop()) : null) || null;
  };
  const outLinks = new Map();
  const backlinks = new Map();
  const unresolved = new Map();
  const tags = new Map();
  for (const n of notes) {
    const res = new Set();
    for (const t of n.links || []) {
      const target = resolve(t);
      if (target) {
        if (target.id === n.id) continue;
        res.add(target.id);
        if (!backlinks.has(target.id)) backlinks.set(target.id, new Set());
        backlinks.get(target.id).add(n.id);
      } else {
        const k = t.trim();
        if (!unresolved.has(k)) unresolved.set(k, new Set());
        unresolved.get(k).add(n.id);
      }
    }
    outLinks.set(n.id, [...res]);
    for (const tg of n.tags || []) {
      if (!tags.has(tg)) tags.set(tg, new Set());
      tags.get(tg).add(n.id);
    }
  }
  const player = playerLens();
  const files = Object.values(v.files).filter((f) => !player || f.visibility === 'players');
  const fileByName = new Map();
  for (const f of files) fileByName.set(String(f.name).toLowerCase(), f);
  indexCache = { version: v.version, lens: `${a.role}:${a.viewAsPlayer}`, notes, byId, resolve, outLinks, backlinks, unresolved, tags, files, fileByName };
  return indexCache;
}

export const resolveTitle = (t) => getIndex().resolve(t);
export const noteById = (id) => stripTeaser(vault.get().notes[id]) || null;

export const deriveNoteFields = (body) => deriveFields(body);
export const searchNotes = (query, opts) => searchNoteList(getIndex().notes, query, opts);

// ───────────────────────── Codex: Notizen ─────────────────────────
export { cleanTitle, cleanPath };
export const uniqueTitle = (title, excludeId) => uniqueTitleIn(Object.values(vault.get().notes), title, excludeId);

export async function createNote({ title = 'Unbenannt', folder = '', body = '', visibility = 'gm' } = {}) {
  const { cid } = app.get();
  const id = uid(20);
  const doc = {
    title: uniqueTitle(title), folder: cleanPath(folder), body, visibility,
    ...deriveNoteFields(body), createdAt: now(), updatedAt: now(), createdBy: myUid(), updatedBy: myUid(),
  };
  vault.set((s) => ({ notes: { ...s.notes, [id]: { id, ...doc } }, version: s.version + 1 }));
  await db.set(col('notes', cid), id, doc);
  return { id, ...doc };
}

export async function updateNote(id, patch) {
  const n = vault.get().notes[id];
  if (!n) return;
  const p = { ...patch, updatedAt: now(), updatedBy: myUid() };
  if ('body' in patch) Object.assign(p, deriveNoteFields(patch.body));
  vault.set((s) => ({ notes: { ...s.notes, [id]: { ...n, ...p } }, version: s.version + 1 }));
  await db.update(col('notes'), id, p);
}

export async function renameNote(id, newTitle) {
  const notes = vault.get().notes;
  const n = notes[id];
  const t = cleanTitle(newTitle);
  if (!n || !t || t === n.title) return n?.title;
  if (Object.values(notes).some((x) => x.id !== id && x.title.toLowerCase() === t.toLowerCase())) throw new Error('Eine Notiz mit diesem Namen gibt es schon.');
  const old = n.title;
  const ops = [{ op: 'update', col: col('notes'), id, data: { title: t, updatedAt: now() } }];
  for (const other of Object.values(notes)) {
    if (other.id === id && !(other.links || []).some((l) => l.toLowerCase() === old.toLowerCase())) continue;
    if (!(other.links || []).some((l) => l.toLowerCase() === old.toLowerCase())) continue;
    const body = renameLinkTarget(other.body, old, t);
    if (body !== other.body) {
      const data = { body, ...deriveNoteFields(body), updatedAt: now() };
      if (other.id === id) Object.assign(ops[0].data, data);
      else ops.push({ op: 'update', col: col('notes'), id: other.id, data });
    }
  }
  await db.batch(ops);
  return t;
}

export async function moveNote(id, folder) {
  await updateNote(id, { folder: cleanPath(folder) });
}

// visibility: 'gm' (nur SL) oder 'players'; only = Liste von Spieler-Kennungen (leer = alle Spieler)
export async function setNoteVisibility(id, visibility, only = [], opts = {}) {
  await updateNote(id, visFields(visibility, only, opts));
}

// Felder für die Sichtbarkeit eines Dokuments – onlyN wird für die Abfrage der Spieler gebraucht
// future: neue Mitspieler werden später automatisch ergänzt · teaser: Spieler sehen nur die Überschrift
export function visFields(visibility, only = [], opts = {}) {
  const list = visibility === 'players' ? [...new Set(only.filter(Boolean))] : [];
  return { visibility, only: list, onlyN: list.length, future: !!opts.future, teaser: visibility === 'players' && !!opts.teaser };
}

// Abfragen, mit denen ein Spieler seine sichtbaren Dokumente bekommt (für alle + nur für ihn)
export function visQueries(uid) {
  return [
    { where: [['visibility', '==', 'players'], ['onlyN', '==', 0]] },
    { where: [['visibility', '==', 'players'], ['only', 'array-contains', uid]] },
  ];
}

// Ältere Dokumente nachrüsten (onlyN fehlt) und Freigaben „und zukünftige Spieler“ ergänzen –
// läuft bei der SL beim Öffnen der Kampagne
export async function ensureVisibilityFields(cid) {
  const cols = ['notes', 'maps', 'quests', 'sessions', 'handouts', 'files', 'pins'];
  const players = Object.values(vault.get().members || {}).filter((m) => m.role !== 'gm').map((m) => m.uid || m.id).filter(Boolean);
  const ops = [];
  for (const name of cols) {
    const docs = await db.list(col(name, cid), { where: [['visibility', '==', 'players']] }).catch(() => []);
    for (const d of docs) {
      if (d.onlyN === undefined) ops.push({ op: 'update', col: col(name, cid), id: d.id, data: { only: [], onlyN: 0 } });
      else if (d.future && d.onlyN > 0) {
        const fehlt = players.filter((u) => !(d.only || []).includes(u));
        if (fehlt.length) {
          const only = [...(d.only || []), ...fehlt];
          ops.push({ op: 'update', col: col(name, cid), id: d.id, data: { only, onlyN: only.length } });
        }
      }
    }
  }
  if (ops.length) await db.batch(ops).catch(() => {});
  return ops.length;
}

export async function duplicateNote(id) {
  const n = noteById(id);
  if (!n) return null;
  return createNote({ title: `${n.title} Kopie`, folder: n.folder, body: n.body, visibility: n.visibility });
}

export async function deleteNote(id) {
  const n = noteById(id);
  if (!n) return;
  const { id: _omit, ...data } = n;
  vault.set((s) => {
    const notes = { ...s.notes };
    delete notes[id];
    return { notes, version: s.version + 1 };
  });
  await db.batch([
    { op: 'set', col: col('trash'), id, data: { ...data, deletedAt: now() } },
    { op: 'delete', col: col('notes'), id },
  ]);
}

export async function restoreNote(id) {
  const t = await db.get(col('trash'), id);
  if (!t) return;
  const { id: _i, deletedAt, ...data } = t;
  data.title = uniqueTitle(data.title);
  await db.batch([{ op: 'set', col: col('notes'), id, data }, { op: 'delete', col: col('trash'), id }]);
}

export async function purgeNote(id) {
  await db.remove(col('trash'), id);
  await db.remove(col('secrets'), id).catch(() => {});
}

// ── Ordner ──
export function allFolders() {
  const set = new Set(app.get().campaign?.folders || []);
  const add = (f) => {
    let p = f;
    while (p) {
      set.add(p);
      const i = p.lastIndexOf('/');
      p = i > 0 ? p.slice(0, i) : '';
    }
  };
  for (const n of visibleNotes()) add(n.folder || '');
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'));
}

export async function createFolder(path) {
  const p = cleanPath(path);
  if (!p) return;
  const folders = [...new Set([...(app.get().campaign?.folders || []), p])];
  await db.update('campaigns', app.get().cid, { folders });
  return p;
}

export async function renameFolder(oldPath, newPath) {
  const np = cleanPath(newPath);
  if (!np || np === oldPath) return;
  const ops = [];
  for (const n of Object.values(vault.get().notes)) {
    const f = n.folder || '';
    if (f === oldPath || f.startsWith(`${oldPath}/`)) ops.push({ op: 'update', col: col('notes'), id: n.id, data: { folder: np + f.slice(oldPath.length), updatedAt: now() } });
  }
  const folders = (app.get().campaign?.folders || []).map((f) => (f === oldPath || f.startsWith(`${oldPath}/`) ? np + f.slice(oldPath.length) : f));
  if (!folders.includes(np)) folders.push(np);
  const folderMeta = { ...(app.get().campaign?.folderMeta || {}) };
  for (const k of Object.keys(folderMeta)) {
    if (k === oldPath || k.startsWith(`${oldPath}/`)) {
      folderMeta[np + k.slice(oldPath.length)] = folderMeta[k];
      delete folderMeta[k];
    }
  }
  ops.push({ op: 'update', col: 'campaigns', id: app.get().cid, data: { folders, folderMeta } });
  await db.batch(ops);
}

// Ordner markieren (Farbe, Symbol, Etikett) – liegt am Kampagnen-Dokument
export async function setFolderMeta(path, meta) {
  const cur = { ...(app.get().campaign?.folderMeta || {}) };
  if (!meta || (!meta.color && !meta.icon && !meta.label)) delete cur[path];
  else cur[path] = { color: meta.color || '', icon: meta.icon || '', label: meta.label || '' };
  await db.update('campaigns', app.get().cid, { folderMeta: cur });
}

export async function deleteFolder(path) {
  const inside = Object.values(vault.get().notes).filter((n) => (n.folder || '') === path || (n.folder || '').startsWith(`${path}/`));
  for (const n of inside) await deleteNote(n.id);
  const folders = (app.get().campaign?.folders || []).filter((f) => f !== path && !f.startsWith(`${path}/`));
  const folderMeta = Object.fromEntries(Object.entries(app.get().campaign?.folderMeta || {}).filter(([k]) => k !== path && !k.startsWith(`${path}/`)));
  await db.update('campaigns', app.get().cid, { folders, folderMeta });
  return inside.length;
}

// ── GM-Geheimnisse (eigene Sammlung, für Spieler unlesbar) ──
// SL-Geheimnis je Notiz. Standard: nur die Spielleitung – einzeln freigebbar (visibility/only).
export function watchSecret(noteId, cb) {
  return db.watchDoc(col('secrets'), noteId, (d) => cb(d || null), () => cb(null));
}
export async function saveSecret(noteId, body) {
  if (!body?.trim()) {
    const alt = await db.get(col('secrets'), noteId).catch(() => null);
    if (alt?.visibility === 'players') return db.set(col('secrets'), noteId, { ...alt, body: '', updatedAt: now() });
    return db.remove(col('secrets'), noteId).catch(() => {});
  }
  const alt = await db.get(col('secrets'), noteId).catch(() => null);
  return db.set(col('secrets'), noteId, { ...visFields('gm'), ...(alt || {}), body, updatedAt: now() });
}
export async function setSecretVisibility(noteId, visibility, only = [], opts = {}) {
  const alt = await db.get(col('secrets'), noteId).catch(() => null);
  return db.set(col('secrets'), noteId, { body: '', ...(alt || {}), ...visFields(visibility, only, opts), updatedAt: now() });
}

// ── Massenimport (Obsidian, Beispielkampagne, Backup) ──
export async function importNotes(notes, { conflict = 'rename', onProgress } = {}) {
  const { cid } = app.get();
  const existing = new Map(Object.values(vault.get().notes).map((n) => [String(n.title).toLowerCase(), n]));
  const ops = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const taken = new Set(existing.keys());
  for (const n of notes) {
    const title = cleanTitle(n.title) || 'Unbenannt';
    const key = title.toLowerCase();
    const data = {
      title, folder: cleanPath(n.folder || ''), body: n.body || '', visibility: n.visibility || 'gm',
      ...deriveNoteFields(n.body || ''), createdAt: n.createdAt || now(), updatedAt: now(), createdBy: myUid(), updatedBy: myUid(),
    };
    const ex = existing.get(key);
    if (ex && conflict === 'skip') { skipped++; continue; }
    if (ex && conflict === 'overwrite') {
      ops.push({ op: 'set', col: col('notes', cid), id: ex.id, data: { ...data, createdAt: ex.createdAt || data.createdAt } });
      updated++;
      continue;
    }
    if (taken.has(key)) {
      let i = 1;
      while (taken.has(`${key} ${i}`)) i++;
      data.title = `${title} ${i}`;
    }
    taken.add(data.title.toLowerCase());
    ops.push({ op: 'set', col: col('notes', cid), id: n.id || uid(20), data });
    created++;
  }
  for (let i = 0; i < ops.length; i += 150) {
    await db.batch(ops.slice(i, i + 150));
    onProgress?.(Math.min(ops.length, i + 150), ops.length);
  }
  return { created, updated, skipped };
}

export async function addFolders(paths) {
  const set = new Set(app.get().campaign?.folders || []);
  paths.map(cleanPath).filter(Boolean).forEach((p) => set.add(p));
  await db.update('campaigns', app.get().cid, { folders: [...set] });
}
