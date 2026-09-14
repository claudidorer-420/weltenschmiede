// Zentraler App-Zustand: Anmeldung, Kampagnen, Mitgliedschaft/Rollen, Codex (Notizen) + Index.
import { createStore } from './store.js';
import { db, connectCloud, useLocalDb } from './db.js';
import {
  settings, getCloudConfig, setCloudConfig, modePref, setCloudSettingsSync, mergeRemoteSettings, applyTheme, ensureSettingsOwner, clearAiKeys,
} from './settings.js';
import { uid, now, inviteCode, sortBy } from '../lib/util.js';
import { parseFrontmatter, extractLinks, extractTags, renameLinkTarget } from '../lib/markdown.js';

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
    }
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

export async function createCampaign({ name, description = '', world = '' }) {
  const u = app.get().user;
  const cid = uid(20);
  await db.set('campaigns', cid, {
    name, description, world, ownerUid: u.uid, createdAt: now(), updatedAt: now(), folders: [], pbpWaiting: [],
    settings: { rulesVersion: settings.get().rulesVersion || '2014', units: settings.get().units || 'm' },
  });
  await db.set(`campaigns/${cid}/members`, u.uid, { uid: u.uid, name: u.name, role: 'gm', joinedAt: now() });
  await db.set(`users/${u.uid}/campaigns`, cid, { name, role: 'gm', joinedAt: now() });
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
  unsubs.push(db.watchCol(col('notes', cid), vis, (docs) => {
    const notes = {};
    for (const d of docs) notes[d.id] = d;
    vault.set((s) => ({ notes, version: s.version + 1, loaded: true }));
  }, onErr));
  unsubs.push(db.watchCol(col('files', cid), vis, (docs) => {
    const files = {};
    for (const d of docs) files[d.id] = d;
    vault.set((s) => ({ files, version: s.version + 1 }));
  }, onErr));
  unsubs.push(db.watchCol(col('members', cid), {}, (docs) => {
    const members = {};
    for (const d of docs) members[d.id] = d;
    vault.set({ members });
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
export async function getInvites() {
  const { cid, campaign } = app.get();
  let inv = await db.get(col('gm'), 'invites').catch(() => null);
  if (inv?.player && inv?.gm) return inv;
  const player = inviteCode(6);
  const gm = inviteCode(8);
  const base = { campaignId: cid, campaignName: campaign?.name || '', createdAt: now() };
  await db.set('invites', player, { ...base, role: 'player' });
  await db.set('invites', gm, { ...base, role: 'gm' });
  inv = { player, gm };
  await db.set(col('gm'), 'invites', inv);
  return inv;
}

export async function renewInvite(role) {
  const { cid, campaign } = app.get();
  const inv = await getInvites();
  const old = inv[role];
  const code = inviteCode(role === 'gm' ? 8 : 6);
  await db.set('invites', code, { campaignId: cid, campaignName: campaign?.name || '', role, createdAt: now() });
  await db.set(col('gm'), 'invites', { ...inv, [role]: code });
  if (old) await db.remove('invites', old).catch(() => {});
  return code;
}

export async function joinCampaign(code) {
  const c = String(code || '').trim().toUpperCase();
  if (db.mode !== 'cloud') throw new Error('Zum Beitreten muss die Cloud eingerichtet sein.');
  const inv = await db.get('invites', c);
  if (!inv) throw new Error('Diesen Einladungscode gibt es nicht (mehr).');
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

export function visibleNotes() {
  const player = playerLens();
  return Object.values(vault.get().notes).filter((n) => !player || n.visibility === 'players');
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
export const noteById = (id) => vault.get().notes[id] || null;

export function deriveNoteFields(body) {
  const { props } = parseFrontmatter(body || '');
  const al = props.aliases ?? props.alias ?? [];
  const aliases = (Array.isArray(al) ? al : String(al).split(',')).map((x) => String(x).trim()).filter(Boolean);
  const kind = String(props.typ || props.type || props.kind || '').toLowerCase() || null;
  return { tags: extractTags(body || '', props), links: extractLinks(body || ''), aliases, kind };
}

export function searchNotes(query, { limit = 60 } = {}) {
  const idx = getIndex();
  const q = String(query || '').trim();
  if (!q) return [];
  let notes = idx.notes;
  const terms = [];
  for (const part of q.match(/"[^"]+"|\S+/g) || []) {
    if (/^tag:/i.test(part)) {
      const t = part.slice(4).replace(/^#/, '').toLowerCase();
      notes = notes.filter((n) => (n.tags || []).some((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(`${t}/`)));
    } else if (/^path:/i.test(part)) {
      const p = part.slice(5).replace(/^"|"$/g, '').toLowerCase();
      notes = notes.filter((n) => (n.folder || '').toLowerCase().includes(p));
    } else if (/^typ:/i.test(part)) {
      const p = part.slice(4).toLowerCase();
      notes = notes.filter((n) => (n.kind || '') === p);
    } else terms.push(part.replace(/^"|"$/g, '').toLowerCase());
  }
  const out = [];
  for (const n of notes) {
    const title = String(n.title || '').toLowerCase();
    const body = String(n.body || '').toLowerCase();
    let score = terms.length ? 0 : 1;
    let at = -1;
    let ok = true;
    for (const t of terms) {
      const ti = title.indexOf(t);
      const bi = body.indexOf(t);
      if (ti < 0 && bi < 0) {
        ok = false;
        break;
      }
      if (ti >= 0) score += ti === 0 ? 40 : 20;
      if (bi >= 0) {
        score += 4;
        if (at < 0) at = bi;
      }
    }
    if (!ok) continue;
    out.push({ note: n, score, snippet: at >= 0 ? snippet(n.body, at, terms[0].length) : '', term: terms[0] || '' });
  }
  return out.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title, 'de')).slice(0, limit);
}

function snippet(body, at, len) {
  const s = Math.max(0, at - 60);
  const e = Math.min(body.length, at + len + 90);
  return (s > 0 ? '…' : '') + body.slice(s, e).replace(/\s+/g, ' ') + (e < body.length ? '…' : '');
}

// ───────────────────────── Codex: Notizen ─────────────────────────
export function cleanTitle(t) {
  return String(t || '').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim();
}

export function cleanPath(p) {
  return String(p || '').split('/').map((s) => s.trim().replace(/[\\:*?"<>|]/g, '-')).filter(Boolean).join('/');
}

export function uniqueTitle(title, excludeId) {
  const base = cleanTitle(title) || 'Unbenannt';
  const taken = new Set(Object.values(vault.get().notes).filter((n) => n.id !== excludeId).map((n) => String(n.title).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 1; ; i++) {
    const t = `${base} ${i}`;
    if (!taken.has(t.toLowerCase())) return t;
  }
}

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

export async function setNoteVisibility(id, visibility) {
  await updateNote(id, { visibility });
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
export function watchSecret(noteId, cb) {
  return db.watchDoc(col('secrets'), noteId, (d) => cb(d?.body || ''), () => cb(''));
}
export async function saveSecret(noteId, body) {
  if (!body?.trim()) return db.remove(col('secrets'), noteId).catch(() => {});
  return db.set(col('secrets'), noteId, { body, updatedAt: now() });
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
