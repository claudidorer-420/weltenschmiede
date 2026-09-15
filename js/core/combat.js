// Kampfzustand: vollständiger SL-Zustand (combat/gm) + öffentliche Projektion für Spieler (combat/public).
// Gemeinsame Logik für Kampf-Tracker und Kampfkarte; die Regeln (Zugwechsel, Schaden, Zustände) stehen in engine.js.
import { db } from './db.js';
import { col, bridge } from './app.js';
import { uid, now } from '../lib/util.js';
import { roll, modifier } from '../lib/dice.js';
import { normalizeMonster } from '../ui/statblock.js';

export const EMPTY_COMBAT = { active: false, round: 1, turn: 0, combatants: [], log: [], mapId: null, zones: [], results: [], prompts: [] };

export async function loadCombat() {
  return (await db.get(col('combat'), 'gm')) || { ...EMPTY_COMBAT };
}

export function hpState(c) {
  if (c.dead) return 'Tot';
  if (c.hp <= 0) return 'Kampfunfähig';
  const r = c.hp / (c.maxHp || 1);
  if (r >= 1) return 'Unverletzt';
  if (r > 0.5) return 'Angeschlagen';
  if (r > 0.25) return 'Blutig';
  return 'Kritisch';
}
export const isOut = (c) => !!c.dead || (!c.isPC && c.hp <= 0);

const concPub = (c) => (c.concentration && typeof c.concentration === 'object' ? { name: c.concentration.name, spellId: c.concentration.spellId || null } : c.concentration ? { name: 'Konzentration' } : null);
const effPub = (e) => ({ id: e.id, key: e.key, name: e.name || '', src: e.src || null, rounds: e.rounds || 0, ...(e.silent ? { silent: true } : {}), ...(e.data ? { data: e.data } : {}), ...(e.until ? { until: e.until } : {}) });
const condPub = (k) => ({ name: k.name, rounds: k.rounds || 0, ...(k.src ? { src: k.src } : {}), ...(k.label ? { label: k.label } : {}), ...(k.level ? { level: k.level } : {}), ...(k.until ? { until: k.until } : {}) });

export function projection(state) {
  const cur = state.combatants[state.turn];
  const t = now();
  return {
    active: !!state.active,
    round: state.round || 1,
    currentId: state.active && cur && !cur.hidden ? cur.id : null,
    mapId: state.mapId || null,
    list: state.combatants.filter((c) => !c.hidden && !c.vanish).map((c) => ({
      id: c.id, name: c.name, init: c.init ?? null, initBonus: c.initBonus || 0, isPC: !!c.isPC, ally: !!c.ally, ownerUid: c.ownerUid || null, charId: c.charId || null, tokenId: c.tokenId || null,
      summonOf: c.summonOf || null,
      // eigene Beschwörungen brauchen den Statblock für die Kampfleiste, Verwandelte ihre neue Gestalt
      ...(c.ownerUid && !c.isPC && c.statblock ? { statblock: c.statblock } : {}),
      form: c.form ? { name: c.form.name, mode: c.form.mode, src: c.form.src || null, ...(c.isPC || c.ownerUid ? { statblock: c.form.statblock } : {}) } : null,
      conditions: (c.conditions || []).map(condPub), effects: (c.effects || []).map(effPub), concentration: concPub(c),
      hpState: hpState(c), down: c.hp <= 0, dead: !!c.dead, stable: !!c.stable, surprised: !!c.surprised, color: c.color || null,
      eco: c.eco || null, reaction: c.reaction !== false, turnNo: c.turnNo || 0,
      art: c.statblock ? { name: c.statblock.name, type: c.statblock.type || '', image: c.statblock.image || null, cr: c.statblock.cr ?? null } : null,
      ...(c.isPC || c.showHp ? { hp: c.hp, maxHp: c.maxHp, tempHp: c.tempHp || 0 } : {}),
      ...(c.isPC ? { ac: c.ac, deathSaves: c.deathSaves || { s: 0, f: 0 } } : {}),
    })),
    zones: (state.zones || []).map((z) => ({ id: z.id, name: z.name, src: z.src || null, tpl: z.tpl, follow: z.follow || null, color: z.color || null, obscure: !!z.obscure, difficult: z.difficult || 0, silence: !!z.silence, barrier: !!z.barrier, opaque: !!z.opaque })),
    results: (state.results || []).slice(-10),
    prompts: (state.prompts || []).filter((p) => (p.expires || 0) > t),
    log: (state.log || []).slice(-80).map((l) => ({ ts: l.ts, text: l.text, ...(l.kind ? { kind: l.kind } : {}) })),
    updatedAt: t,
  };
}

// Firestore kennt kein undefined – JSON räumt es weg (und kopiert dabei tief)
const clean = (o) => JSON.parse(JSON.stringify(o));

export async function saveCombat(state) {
  const s = clean({ ...state, log: (state.log || []).slice(-150), results: (state.results || []).slice(-14), updatedAt: now() });
  await db.batch([
    { op: 'set', col: col('combat'), id: 'gm', data: s },
    { op: 'set', col: col('combat'), id: 'public', data: projection(s) },
  ]);
  return s;
}

// Lädt, verändert und speichert den Kampf in einem Schritt. Aufrufe laufen nacheinander, damit sich
// gleichzeitige Änderungen (Relais, Rückfragen, Karte) nicht gegenseitig überschreiben.
let lock = Promise.resolve();
const goneTokens = new Set();
const sheetKey = (c) => `${c.hp}|${c.tempHp || 0}|${c.deathSaves?.s || 0}|${c.deathSaves?.f || 0}|${c.concentration?.name || ''}`;
export function mutateCombat(fn) {
  const run = lock.then(async () => {
    const st = await loadCombat();
    const base = { ...EMPTY_COMBAT, ...clean(st) };
    const before = new Map((st.combatants || []).map((c) => [c.id, sheetKey(c)]));
    const next = (await fn(base)) || base;
    const saved = await saveCombat(next);
    for (const c of saved.combatants || []) if (c.isPC && before.has(c.id) && before.get(c.id) !== sheetKey(c)) pushCharHp(c);
    // Verschwundene Beschwörungen: Token von der Karte nehmen
    for (const c of saved.combatants || []) {
      if (!c.vanish || !c.tokenId || goneTokens.has(c.tokenId)) continue;
      goneTokens.add(c.tokenId);
      db.remove(col('tokens'), c.tokenId).catch(() => {});
    }
    return saved;
  });
  lock = run.catch(() => {});
  return run;
}

export function makeCombatant({ name, hp = 10, maxHp, ac = 10, initBonus = 0, isPC = false, statblock = null, ownerUid = null, charId = null, hidden = false, color = null, init = null, tokenId = null }) {
  return {
    id: uid(8), name, hp: Number(hp) || 1, maxHp: Number(maxHp ?? hp) || 1, tempHp: 0, ac, initBonus: Number(initBonus) || 0, init,
    isPC, statblock, ownerUid, charId, hidden, conditions: [], effects: [], deathSaves: { s: 0, f: 0 }, concentration: null, legendaryUsed: 0, notes: '', color, tokenId,
    reaction: true, turnNo: 0, dead: false, stable: false, surprised: false, eco: null, mSlots: {}, perDay: {}, recharge: {}, rechargeOn: {},
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
      // normalizeMonster kennt diese Felder nicht – für Zauber, Bewegung und Größe im Kampf behalten
      for (const k of ['casting', 'speeds', 'sizeKey', 'id']) if (raw[k] != null) sb[k] = raw[k];
      out.push(makeCombatant({ name: qty > 1 ? `${m.name} ${i}` : m.name, hp, ac: parseInt(m.ac, 10) || 10, initBonus: modifier(m.abilities.dex), statblock: sb }));
    }
  }
  return out;
}

export function combatantFromCharacter({ owner, char }) {
  const dex = modifier(char.abilities?.dex ?? 10);
  const c = makeCombatant({
    name: char.name || 'Held', hp: char.hp ?? char.maxHp ?? 10, maxHp: char.maxHp ?? 10, ac: char.ac ?? 10,
    initBonus: (Number(char.initBonus) || 0) + dex, isPC: true, ownerUid: owner, charId: char.id, color: char.color || null,
  });
  c.tempHp = Number(char.tempHp) || 0;
  if (char.hp <= 0) c.deathSaves = char.deathSaves || { s: 0, f: 0 };
  return c;
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

// Zugwechsel: die Regel-Engine (engine.advance) meldet sich über actions.js an. Ohne sie einfacher Wechsel.
let turnEngine = null;
export function setTurnEngine(fn) { turnEngine = fn; }
export function advanceTurn(x, ctx) {
  const n = (x.combatants || []).length;
  if (!n) return x;
  if (turnEngine) return turnEngine(x, ctx);
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

// Trefferpunkte, Todesrettungswürfe und Konzentration in den Charakterbogen zurückschreiben
export function pushCharHp(c) {
  if (!c.isPC || !c.charId || !c.ownerUid) return;
  const conc = c.concentration && typeof c.concentration === 'object' ? { name: c.concentration.name, id: c.concentration.spellId || null } : null;
  // Verwandelt (2014): im Bogen bleiben die echten TP stehen
  const hp = c.form?.mode === 'replace' ? Number(c.form.hp0) || 0 : c.hp;
  db.update(`users/${c.ownerUid}/characters`, c.charId, { hp, tempHp: c.tempHp || 0, deathSaves: c.deathSaves || { s: 0, f: 0 }, concentration: conc }).catch(() => {});
}

// Schaden (delta < 0) oder Heilung (delta > 0) inkl. temporärer TP, Todesrettungswürfe, Konzentrationshinweis (Kampf-Tracker)
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
    x.log.push({ ts: now(), text: `${c.name} erleidet ${-delta} Schaden → ${c.isPC ? `${c.hp}/${c.maxHp}` : hpState(c)}${c.hp === 0 ? (c.isPC ? ' – bewusstlos!' : ' – besiegt!') : ''}` });
  } else {
    c.hp = Math.min(c.maxHp, c.hp + delta);
    if (c.hp > 0) c.deathSaves = { s: 0, f: 0 };
    x.log.push({ ts: now(), text: `${c.name} heilt ${delta} → ${c.isPC ? `${c.hp}/${c.maxHp}` : hpState(c)}` });
  }
  pushCharHp(c);
  return c;
}

export function combatantForToken(t, list) {
  if (!t || !list) return null;
  return list.find((c) => (t.combatantId && c.id === t.combatantId) || (t.charId && c.charId === t.charId) || (c.tokenId && c.tokenId === t.id)) || null;
}
