// Kampfzustand: vollständiger SL-Zustand (combat/gm) + öffentliche Projektion für Spieler (combat/public).
// Gemeinsame Logik für Kampf-Tracker und Kampfkarte: Züge, Schaden/Heilung, Verknüpfung Token ↔ Kämpfer.
import { db } from './db.js';
import { col, bridge } from './app.js';
import { uid, now } from '../lib/util.js';
import { roll, modifier } from '../lib/dice.js';
import { normalizeMonster } from '../ui/statblock.js';

export const EMPTY_COMBAT = { active: false, round: 1, turn: 0, combatants: [], log: [], mapId: null };

export async function loadCombat() {
  return (await db.get(col('combat'), 'gm')) || { ...EMPTY_COMBAT };
}

export function hpState(c) {
  if (c.hp <= 0) return 'Kampfunfähig';
  const r = c.hp / (c.maxHp || 1);
  if (r >= 1) return 'Unverletzt';
  if (r > 0.5) return 'Angeschlagen';
  if (r > 0.25) return 'Blutig';
  return 'Kritisch';
}
export const isOut = (c) => !c.isPC && c.hp <= 0;

export function projection(state) {
  const cur = state.combatants[state.turn];
  return {
    active: !!state.active,
    round: state.round || 1,
    currentId: cur && !cur.hidden ? cur.id : null,
    mapId: state.mapId || null,
    list: state.combatants.filter((c) => !c.hidden).map((c) => ({
      id: c.id, name: c.name, init: c.init ?? null, isPC: !!c.isPC, ownerUid: c.ownerUid || null, charId: c.charId || null, tokenId: c.tokenId || null,
      conditions: c.conditions || [], hpState: hpState(c), down: c.hp <= 0, color: c.color || null, concentration: !!c.concentration,
      art: c.statblock ? { name: c.statblock.name, type: c.statblock.type, image: c.statblock.image || null } : null,
      ...(c.isPC || c.showHp ? { hp: c.hp, maxHp: c.maxHp, tempHp: c.tempHp || 0 } : {}),
      ...(c.isPC ? { ac: c.ac } : {}),
    })),
    updatedAt: now(),
  };
}

export async function saveCombat(state) {
  const s = { ...state, log: (state.log || []).slice(-100), updatedAt: now() };
  await db.batch([
    { op: 'set', col: col('combat'), id: 'gm', data: s },
    { op: 'set', col: col('combat'), id: 'public', data: projection(s) },
  ]);
  return s;
}

// Lädt, verändert und speichert den Kampf in einem Schritt (für Karte, Signale, Schnellaktionen)
export async function mutateCombat(fn) {
  const st = await loadCombat();
  const base = { ...EMPTY_COMBAT, ...st, combatants: [...(st.combatants || [])].map((c) => ({ ...c })), log: [...(st.log || [])] };
  const next = (await fn(base)) || base;
  return saveCombat(next);
}

export function makeCombatant({ name, hp = 10, maxHp, ac = 10, initBonus = 0, isPC = false, statblock = null, ownerUid = null, charId = null, hidden = false, color = null, init = null, tokenId = null }) {
  return {
    id: uid(8), name, hp: Number(hp) || 1, maxHp: Number(maxHp ?? hp) || 1, tempHp: 0, ac, initBonus: Number(initBonus) || 0, init,
    isPC, statblock, ownerUid, charId, hidden, conditions: [], deathSaves: { s: 0, f: 0 }, concentration: false, legendaryUsed: 0, notes: '', color, tokenId,
  };
}

export function combatantsFromMonsters(monsters, { rollHp = false } = {}) {
  const out = [];
  for (const raw of monsters) {
    const m = normalizeMonster(raw);
    const qty = Math.max(1, Number(raw.qty) || 1);
    for (let i = 1; i <= qty; i++) {
      let hp = Number(m.hp) || 1;
      if (rollHp && m.hpDice) {
        try { hp = Math.max(1, roll(m.hpDice).total); } catch { /* Standard-TP */ }
      }
      const { qty: _q, ...sb } = m;
      if (raw.image) sb.image = raw.image;
      out.push(makeCombatant({ name: qty > 1 ? `${m.name} ${i}` : m.name, hp, ac: parseInt(m.ac, 10) || 10, initBonus: modifier(m.abilities.dex), statblock: sb }));
    }
  }
  return out;
}

export function combatantFromCharacter({ owner, char }) {
  const dex = modifier(char.abilities?.dex ?? 10);
  return makeCombatant({
    name: char.name || 'Held', hp: char.hp ?? char.maxHp ?? 10, maxHp: char.maxHp ?? 10, ac: char.ac ?? 10,
    initBonus: (Number(char.initBonus) || 0) + dex, isPC: true, ownerUid: owner, charId: char.id, color: char.color || null,
  });
}

export async function addToCombat(list, text) {
  const st = await loadCombat();
  st.combatants = [...st.combatants, ...list];
  st.log = [...(st.log || []), { ts: now(), text: text || `${list.length} Kämpfer hinzugefügt` }];
  return saveCombat(st);
}

export function sortByInit(list) {
  return [...list].sort((a, b) => (b.init ?? -99) - (a.init ?? -99) || (b.initBonus || 0) - (a.initBonus || 0) || (a.isPC === b.isPC ? 0 : a.isPC ? -1 : 1));
}
// Neu sortieren, ohne dass der aktuelle Kämpfer wechselt
export function resort(x) {
  const curId = x.combatants[x.turn]?.id;
  x.combatants = sortByInit(x.combatants);
  x.turn = Math.max(0, x.combatants.findIndex((c) => c.id === curId));
  return x;
}
export const initRoll = (c) => roll(`1d20${(c.initBonus || 0) >= 0 ? '+' : ''}${c.initBonus || 0}`).total;

// Nächster Zug: Runde weiterzählen, Besiegte überspringen, Zustände mit Dauer herunterzählen
export function advanceTurn(x) {
  const n = x.combatants.length;
  if (!n) return x;
  x.log = x.log || [];
  let t = x.turn;
  let guard = 0;
  do {
    t++;
    if (t >= n) {
      t = 0;
      x.round = (x.round || 1) + 1;
      x.log.push({ ts: now(), text: `— Runde ${x.round} —` });
    }
    guard++;
  } while (guard < n && isOut(x.combatants[t]));
  x.turn = t;
  const c = x.combatants[t];
  c.legendaryUsed = 0;
  c.conditions = (c.conditions || []).map((k) => (k.rounds ? { ...k, rounds: k.rounds - 1 } : k)).filter((k) => {
    if (k.rounds === 0) {
      x.log.push({ ts: now(), text: `${c.name}: „${k.name}“ endet` });
      return false;
    }
    return true;
  });
  x.log.push({ ts: now(), text: `${c.name} ist am Zug` });
  return x;
}

export function pushCharHp(c) {
  if (!c.isPC || !c.charId || !c.ownerUid) return;
  db.update(`users/${c.ownerUid}/characters`, c.charId, { hp: c.hp, tempHp: c.tempHp || 0 }).catch(() => {});
}

// Schaden (delta < 0) oder Heilung (delta > 0) inkl. temporärer TP, Todesrettungswürfe, Konzentrationshinweis
export function applyHp(x, id, delta) {
  const c = x.combatants.find((cc) => cc.id === id);
  if (!c || !delta) return c || null;
  x.log = x.log || [];
  if (delta < 0) {
    let dmg = -delta;
    if (c.tempHp) {
      const t = Math.min(c.tempHp, dmg);
      c.tempHp -= t;
      dmg -= t;
    }
    const before = c.hp;
    c.hp = Math.max(0, c.hp - dmg);
    if (c.isPC && before === 0 && dmg > 0) c.deathSaves = { ...(c.deathSaves || { s: 0, f: 0 }), f: Math.min(3, (c.deathSaves?.f || 0) + 1) };
    if (c.concentration) bridge.toast(`${c.name}: Konzentration prüfen – KON-Rettungswurf SG ${Math.max(10, Math.floor(-delta / 2))}`, 'info', { duration: 7000 });
    x.log.push({ ts: now(), text: `${c.name} erleidet ${-delta} Schaden → ${c.hp}/${c.maxHp}${c.hp === 0 ? (c.isPC ? ' – bewusstlos!' : ' – besiegt!') : ''}` });
  } else {
    c.hp = Math.min(c.maxHp, c.hp + delta);
    if (c.hp > 0) c.deathSaves = { s: 0, f: 0 };
    x.log.push({ ts: now(), text: `${c.name} heilt ${delta} → ${c.hp}/${c.maxHp}` });
  }
  pushCharHp(c);
  return c;
}

export function combatantForToken(t, list) {
  if (!t || !list) return null;
  return list.find((c) => (t.combatantId && c.id === t.combatantId) || (t.charId && c.charId === t.charId) || (c.tokenId && c.tokenId === t.id)) || null;
}
