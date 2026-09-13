// Würfel-Protokoll (lokal) + optionales Teilen im Spieltisch-Chat bzw. geheim an die SL.
import { createStore } from './store.js';
import { roll } from '../lib/dice.js';
import { app, vault, col, myUid, myName, gmUids } from './app.js';
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

// von der UI belegt (Toast-Anzeige)
export const rollBridge = { show: () => {}, error: () => {} };

export function sharingActive() {
  return db.mode === 'cloud' && !!app.get().cid && settings.get().shareRolls !== false;
}

export function doRoll(expr, { label = '', share, secret = false, silent = false, character = '' } = {}) {
  let r;
  try {
    r = roll(expr, label);
  } catch (e) {
    rollBridge.error(e.message);
    return null;
  }
  if (character) r.character = character;
  const log = [r, ...rolls.get().log].slice(0, 150);
  rolls.set({ log });
  try { localStorage.setItem('ws.rolls', JSON.stringify(log.slice(0, 60))); } catch { /* ignore */ }
  if (!silent) rollBridge.show(r);
  const doShare = share ?? sharingActive();
  if (doShare && db.mode === 'cloud' && app.get().cid) postRoll(r, secret).catch((e) => console.warn(e));
  return r;
}

export function clearRollLog() {
  rolls.set({ log: [] });
  localStorage.removeItem('ws.rolls');
}

async function postRoll(r, secret) {
  const data = {
    uid: myUid(), name: myName(), kind: 'roll', text: r.label || '', character: r.character || '',
    roll: { input: r.input, expr: r.expr, total: r.total, text: r.text, crit: r.crit, fumble: r.fumble, label: r.label },
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
