// Kampfzustand: vollständiger SL-Zustand (combat/gm) + öffentliche Projektion für Spieler (combat/public).
import { db } from './db.js';
import { col } from './app.js';
import { uid, now } from '../lib/util.js';
import { roll, modifier } from '../lib/dice.js';
import { normalizeMonster } from '../ui/statblock.js';

export const EMPTY_COMBAT = { active: false, round: 1, turn: 0, combatants: [], log: [] };

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

export function projection(state) {
  const cur = state.combatants[state.turn];
  return {
    active: !!state.active,
    round: state.round || 1,
    currentId: cur && !cur.hidden ? cur.id : null,
    list: state.combatants.filter((c) => !c.hidden).map((c) => ({
      id: c.id, name: c.name, init: c.init ?? null, isPC: !!c.isPC, ownerUid: c.ownerUid || null, charId: c.charId || null,
      conditions: c.conditions || [], hpState: hpState(c), down: c.hp <= 0, color: c.color || null,
      ...(c.isPC || c.showHp ? { hp: c.hp, maxHp: c.maxHp, tempHp: c.tempHp || 0 } : {}),
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

export function makeCombatant({ name, hp = 10, maxHp, ac = 10, initBonus = 0, isPC = false, statblock = null, ownerUid = null, charId = null, hidden = false, color = null, init = null }) {
  return {
    id: uid(8), name, hp: Number(hp) || 1, maxHp: Number(maxHp ?? hp) || 1, tempHp: 0, ac, initBonus: Number(initBonus) || 0, init,
    isPC, statblock, ownerUid, charId, hidden, conditions: [], deathSaves: { s: 0, f: 0 }, concentration: false, legendaryUsed: 0, notes: '', color,
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
