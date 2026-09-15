// Signale zwischen Spielern und Spielleitung: Spieler melden Zugende, Initiative, Angriffe und Zauberflächen;
// die SL verarbeitet sie hier – egal, welche Ansicht gerade offen ist (Kampf-Tracker, Karte, Codex …).
import { createStore } from './store.js';
import { db } from './db.js';
import { app, col, myUid, bridge } from './app.js';
import { mutateCombat, advanceTurn, resort } from './combat.js';
import { now, uid } from '../lib/util.js';

// Meldungen der Spieler für die SL (Angriffe/Flächen) – die Kampfkarte zeigt sie als Karten mit „Anwenden“
export const inbox = createStore({ items: [] });
export function dropInbox(id) {
  inbox.set({ items: inbox.get().items.filter((x) => x.id !== id) });
}

let recent = [];
// Spieler: Ereignis an die SL senden (die letzten Ereignisse bleiben im Dokument, damit nichts verloren geht)
export async function sendEvent(ev) {
  const e = { id: uid(8), ts: now(), ...ev };
  if (db.mode !== 'cloud' || app.get().role === 'gm') {
    await handleEvent(myUid(), e);
    return e;
  }
  recent = [...recent, e].slice(-6);
  await db.set(col('signals'), myUid(), { type: e.type, ts: e.ts, value: e.value ?? null, charId: e.charId ?? null, events: recent });
  return e;
}

async function handleEvent(from, e) {
  if (e.type === 'endTurn') {
    await mutateCombat((x) => {
      const cur = x.combatants[x.turn];
      if (x.active && cur && (cur.ownerUid === from || app.get().role === 'gm')) advanceTurn(x);
      return x;
    });
  } else if (e.type === 'init') {
    await mutateCombat((x) => {
      const c = x.combatants.find((cc) => (e.charId && cc.charId === e.charId) || (!e.charId && cc.ownerUid === from));
      if (c) {
        c.init = e.value;
        x.log.push({ ts: now(), text: `${c.name} meldet Initiative ${e.value}` });
        resort(x);
      }
      return x;
    });
  } else if (e.type === 'attack' || e.type === 'area') {
    if (app.get().role !== 'gm') return;
    inbox.set({ items: [...inbox.get().items.filter((x) => x.id !== e.id), { ...e, from }].slice(-20) });
    bridge.toast(`${e.byName || 'Spieler'}: ${e.summary || (e.type === 'attack' ? 'Angriff' : 'Zauberfläche')}`, 'info', { duration: 8000 });
  } else if (e.type === 'quest') {
    // Quest-Status, den ein Spieler verschoben hat (nur freigegebene Quests)
    if (app.get().role !== 'gm' || !e.questId || !e.status) return;
    const q = await db.get(col('quests'), e.questId).catch(() => null);
    if (q && q.visibility === 'players' && (q.status || 'open') !== e.status) await db.update(col('quests'), e.questId, { status: e.status, updatedAt: now(), movedBy: from });
  }
}

// SL: Signale der Spieler beobachten (nur im Cloud-Modus nötig). Gibt eine Abmeldefunktion zurück.
export function startGmRelay() {
  const { cid } = app.get();
  if (!cid || db.mode !== 'cloud') return () => {};
  const key = `ws.sigev.${cid}`;
  let handled;
  try { handled = new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { handled = new Set(); }
  const since = now() - 120000;
  return db.watchCol(col('signals'), {}, (docs) => {
    let changed = false;
    for (const d of docs) {
      const evs = d.events?.length ? d.events : d.type && d.ts ? [{ id: `${d.id}:${d.ts}`, type: d.type, ts: d.ts, value: d.value, charId: d.charId }] : [];
      for (const e of evs) {
        const id = e.id || `${d.id}:${e.ts}`;
        if (handled.has(id)) continue;
        handled.add(id);
        changed = true;
        if ((e.ts || 0) < since && e.type !== 'quest') continue; // alte Kampfsignale verwerfen, Quest-Verschiebungen nachholen
        handleEvent(d.id, { ...e, id }).catch((err) => console.warn('[Signal]', err));
      }
    }
    if (changed) {
      try { localStorage.setItem(key, JSON.stringify([...handled].slice(-300))); } catch { /* voll */ }
    }
  }, () => {});
}
