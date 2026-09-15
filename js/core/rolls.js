// Würfel-Protokoll (lokal) + optionales Teilen im Spieltisch-Chat bzw. geheim an die SL.
// prepareRoll würfelt nur (für die Animation), commitRoll protokolliert/teilt, doRoll macht beides.
import { createStore } from './store.js';
import { rollDetailed } from '../lib/dice.js';
import { app, vault, col, myUid, myName, gmUids, rulesEdition } from './app.js';
import { db } from './db.js';
import { settings } from './settings.js';
import { now } from '../lib/util.js';

function loadLog() {
  try {
    return JSON.parse(localStorage.getItem('ws.rolls') || '[]');
  } catch {
    return [];
  }
}

export const rolls = createStore({ log: loadLog() });

// von der UI belegt (Toast bzw. Würfelschale)
export const rollBridge = { show: () => {}, error: () => {} };

export function sharingActive() {
  return db.mode === 'cloud' && !!app.get().cid && settings.get().shareRolls !== false;
}

export function prepareRoll(expr, { label = '', kind = 'auto', fx = {}, character = '', edition } = {}) {
  try {
    const r = rollDetailed(expr, { kind, fx, label, edition: edition || rulesEdition() });
    if (character) r.character = character;
    return r;
  } catch (e) {
    rollBridge.error(e.message);
    return null;
  }
}

export function commitRoll(r, { share, secret = false } = {}) {
  if (!r) return null;
  const log = [r, ...rolls.get().log].slice(0, 150);
  rolls.set({ log });
  try {
    localStorage.setItem('ws.rolls', JSON.stringify(log.slice(0, 60).map(({ dice, ...x }) => x)));
  } catch { /* ignore */ }
  const doShare = share ?? sharingActive();
  if (doShare && db.mode === 'cloud' && app.get().cid) postRoll(r, secret).catch((e) => console.warn(e));
  return r;
}

export function doRoll(expr, opts = {}) {
  const r = prepareRoll(expr, opts);
  if (!r) return null;
  commitRoll(r, opts);
  if (!opts.silent) rollBridge.show(r);
  return r;
}

export function clearRollLog() {
  rolls.set({ log: [] });
  localStorage.removeItem('ws.rolls');
}

async function postRoll(r, secret) {
  const data = {
    uid: myUid(), name: myName(), kind: 'roll', text: r.label || '', character: r.character || '',
    roll: { input: r.input, expr: r.expr, total: r.total, text: r.text, crit: r.crit, fumble: r.fumble, label: r.label, notes: (r.notes || []).slice(0, 4) },
    ts: now(),
  };
  if (secret) {
    const participants = [...new Set([myUid(), ...gmUids()])];
    await db.add(col('whispers'), { ...data, from: myUid(), to: 'gm', participants });
  } else {
    await db.add(col('chat'), data);
  }
}

export function memberName(uid) {
  return vault.get().members[uid]?.name || 'Unbekannt';
}
