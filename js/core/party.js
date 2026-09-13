// Gruppe (Charaktere der Kampagne) laden bzw. live beobachten.
import { db } from './db.js';
import { app, vault, myUid, userCol } from './app.js';

export async function loadParty() {
  const { cid } = app.get();
  if (!cid) return [];
  if (db.mode === 'local') {
    const chars = await db.list(userCol('characters'));
    return chars.filter((c) => c.campaignId === cid).map((c) => ({ owner: myUid(), char: c }));
  }
  const out = [];
  for (const m of Object.values(vault.get().members)) {
    if (!m.characterId) continue;
    try {
      const c = await db.get(`users/${m.uid}/characters`, m.characterId);
      if (c && c.campaignId === cid) out.push({ owner: m.uid, char: c, member: m });
    } catch { /* keine Berechtigung */ }
  }
  return out;
}

// Ruft cb([{owner, char}]) bei jeder Änderung auf. Gibt eine Abmeldefunktion zurück.
export function watchParty(cb) {
  const { cid } = app.get();
  if (!cid) return () => {};
  if (db.mode === 'local') {
    return db.watchCol(userCol('characters'), {}, (chars) => cb(chars.filter((c) => c.campaignId === cid).map((c) => ({ owner: myUid(), char: c }))));
  }
  const state = new Map();
  let unsubs = [];
  const emit = () => cb([...state.values()].filter((x) => x.char && x.char.campaignId === cid));
  const subscribe = (members) => {
    unsubs.forEach((u) => u());
    unsubs = [];
    state.clear();
    for (const m of Object.values(members)) {
      if (!m.characterId) continue;
      unsubs.push(db.watchDoc(`users/${m.uid}/characters`, m.characterId, (c) => {
        state.set(m.uid, { owner: m.uid, char: c, member: m });
        emit();
      }, () => {}));
    }
    emit();
  };
  subscribe(vault.get().members);
  let lastKey = '';
  const unsubVault = vault.subscribe((s) => {
    const key = Object.values(s.members).map((m) => `${m.uid}:${m.characterId || ''}`).sort().join('|');
    if (key !== lastKey) {
      lastKey = key;
      subscribe(s.members);
    }
  });
  return () => {
    unsubVault();
    unsubs.forEach((u) => u());
  };
}
