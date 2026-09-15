// Signale zwischen Spielern und Spielleitung: Spieler melden Aktionen (mit ihren Würfen), Schadenswürfe, Bewegung,
// Zugende, Initiative und Antworten auf Rückfragen; die SL wertet sie hier der Reihe nach aus – egal, welche Ansicht offen ist.
import { db } from './db.js';
import { app, col, myUid } from './app.js';
import { mutateCombat, loadCombat, advanceTurn, resort } from './combat.js';
import { answerPrompt, promptTarget, setRemotePrompts } from './react.js';
import { now, uid } from '../lib/util.js';

const actions = () => import('./actions.js');
let recent = [];
let chain = Promise.resolve();

// Nacheinander auswerten (ein Schadenswurf wartet, bis sein Angriff aufgelöst ist) – Antworten auf Rückfragen sofort,
// sonst würde eine wartende Reaktionsfrage die eigene Antwort blockieren.
function dispatch(from, e) {
  if (e.type === 'answer') return handleEvent(from, e);
  const run = chain.then(() => handleEvent(from, e));
  chain = run.catch((err) => console.warn('[Signal]', err));
  return run;
}

// Spieler: Ereignis an die SL senden (die letzten Ereignisse bleiben im Dokument, damit nichts verloren geht)
export async function sendEvent(ev) {
  const e = { id: uid(8), ts: now(), ...ev };
  if (db.mode !== 'cloud' || app.get().role === 'gm') {
    await dispatch(myUid(), e);
    return e;
  }
  recent = [...recent, e].slice(-8);
  await db.set(col('signals'), myUid(), { type: e.type, ts: e.ts, value: e.value ?? null, charId: e.charId ?? null, events: JSON.parse(JSON.stringify(recent)) });
  return e;
}

// Wege kommen flach an ([x1, y1, x2, y2 …]) – Firestore kennt keine verschachtelten Listen
const pairs = (p) => (Array.isArray(p) && typeof p[0] === 'number' ? Array.from({ length: Math.floor(p.length / 2) }, (_, i) => [p[i * 2], p[i * 2 + 1]]) : p || []);
async function owns(from, cbId) {
  if (from === myUid()) return true;
  const x = await loadCombat();
  const c = (x.combatants || []).find((y) => y.id === cbId);
  return !!c && !!c.ownerUid && c.ownerUid === from;
}

async function handleEvent(from, e) {
  if (e.type === 'answer') {
    const to = promptTarget(e.promptId);
    if (to === undefined || (to && to !== from && from !== myUid())) return;
    answerPrompt(e.promptId, e.choice ?? null);
  } else if (e.type === 'endTurn') {
    const A = await actions();
    const x0 = await loadCombat();
    await A.ensureBattleContext(x0.mapId);
    await mutateCombat((x) => {
      const cur = x.combatants[x.turn];
      if (x.active && cur && (from === myUid() || cur.ownerUid === from)) advanceTurn(x, A.makeCtx(x));
      return x;
    });
  } else if (e.type === 'init') {
    await mutateCombat((x) => {
      const c = x.combatants.find((cc) => (e.charId && cc.charId === e.charId) || (!e.charId && cc.ownerUid === from));
      if (c && (from === myUid() || c.ownerUid === from)) {
        c.init = e.value;
        x.log.push({ ts: now(), text: `🎲 ${c.name} meldet Initiative ${e.value}` });
        resort(x);
      }
      return x;
    });
  } else if (e.type === 'act' || e.type === 'move' || e.type === 'endConc') {
    if (!(await owns(from, e.actor))) return;
    const A = await actions();
    if (e.type === 'act') await A.handleAct({ ...e, uid: from });
    else if (e.type === 'move') await A.handleMove({ ...e, path: pairs(e.path), uid: from });
    else await A.handleEndConc(e);
  } else if (e.type === 'dmg') {
    const x = await loadCombat();
    const rec = (x.results || []).find((r) => r.id === e.resultId);
    if (!rec || !(await owns(from, rec.actor))) return;
    const A = await actions();
    await A.handleDamage({ ...e, uid: from });
  } else if (e.type === 'quest') {
    // Quest-Status, den ein Spieler verschoben hat (nur freigegebene Quests)
    if (app.get().role !== 'gm' || !e.questId || !e.status) return;
    const q = await db.get(col('quests'), e.questId).catch(() => null);
    if (q && q.visibility === 'players' && (q.status || 'open') !== e.status) await db.update(col('quests'), e.questId, { status: e.status, updatedAt: now(), movedBy: from });
  }
}

// SL: Signale der Spieler beobachten (nur im Cloud-Modus nötig) und Rückfragen an Spieler über den Kampfzustand stellen.
export function startGmRelay() {
  const { cid } = app.get();
  if (!cid || db.mode !== 'cloud') return () => {};
  setRemotePrompts(
    (p) => mutateCombat((x) => { x.prompts = [...(x.prompts || []).filter((q) => (q.expires || 0) > now()), p]; return x; }),
    (id) => mutateCombat((x) => { x.prompts = (x.prompts || []).filter((q) => q.id !== id && (q.expires || 0) > now()); return x; }),
  );
  const key = `ws.sigev.${cid}`;
  let handled;
  try { handled = new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { handled = new Set(); }
  const since = now() - 120000;
  const unsub = db.watchCol(col('signals'), {}, (docs) => {
    let changed = false;
    for (const d of docs) {
      const evs = d.events?.length ? d.events : d.type && d.ts ? [{ id: `${d.id}:${d.ts}`, type: d.type, ts: d.ts, value: d.value, charId: d.charId }] : [];
      for (const e of evs) {
        const id = e.id || `${d.id}:${e.ts}`;
        if (handled.has(id)) continue;
        handled.add(id);
        changed = true;
        if ((e.ts || 0) < since && e.type !== 'quest') continue; // alte Kampfsignale verwerfen, Quest-Verschiebungen nachholen
        dispatch(d.id, { ...e, id }).catch((err) => console.warn('[Signal]', err));
      }
    }
    if (changed) {
      try { localStorage.setItem(key, JSON.stringify([...handled].slice(-400))); } catch { /* voll */ }
    }
  }, () => {});
  return () => {
    unsub();
    setRemotePrompts(null, null);
  };
}
