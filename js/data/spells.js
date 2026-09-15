// Zauberdatenbank (SRD 5.1 bzw. 5.2.1, deutsch): Laden nach Edition, Klassenlisten, Auswahlregeln, Anzeige-Helfer.
import { useState, useEffect } from '../lib/preact.js';
import { findClass, spellcasting, pactSlots } from './chargen.js';
import { SCHOOL_ART, DAMAGE_ART } from './artmap.js';

const cache = {};
export function loadSpells(ed) {
  const key = ed === '2024' ? '2024' : '2014';
  if (!cache[key]) cache[key] = (key === '2024' ? import('./spells-2024.js') : import('./spells-2014.js')).then((m) => m.SPELLS);
  return cache[key];
}

export function useSpells(ed) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let alive = true;
    loadSpells(ed).then((l) => alive && setList(l));
    return () => { alive = false; };
  }, [ed]);
  return list;
}

// ───────────────────────── Anzeige ─────────────────────────
export const levelName = (l) => (l ? `${l}. Grad` : 'Zaubertrick');
export const levelShort = (l) => (l ? `${l}.` : 'ZT');
export const schoolName = (s) => SCHOOL_ART[s]?.name || s || '';
export const damageName = (t) => DAMAGE_ART[t]?.name || t || '';
export const fmtDice = (d) => String(d || '').replace(/(\d)d(\d)/g, '$1W$2').replace(/\bMOD\b/g, 'Mod');
export const ACTION_NAMES = { action: 'Aktion', bonus: 'Bonusaktion', reaction: 'Reaktion', long: 'länger' };
export const ACTION_SHORT = { action: '1 A', bonus: '1 BA', reaction: '1 R' };

export function timeShort(sp) {
  if (ACTION_SHORT[sp.action]) return ACTION_SHORT[sp.action];
  return String(sp.time || '').replace(/ oder Ritual/i, '').replace(/Minuten?/, 'Min.').replace(/Stunden?/, 'Std.');
}
export function rangeShort(sp) {
  if (sp.rangeKind === 'self') return sp.area ? `Selbst (${areaShort(sp.area)})` : 'Selbst';
  if (sp.rangeKind === 'touch') return 'Berührung';
  if (sp.rangeKind === 'sight') return 'Sicht';
  if (sp.rangeKind === 'unl') return 'unbegrenzt';
  if (sp.rangeM != null) return sp.rangeM >= 1000 ? `${(sp.rangeM / 1000).toLocaleString('de-DE')} km` : `${sp.rangeM.toLocaleString('de-DE')} m`;
  return sp.range || '–';
}
const SHAPE_NAMES = { sphere: 'Kugel', cone: 'Kegel', cube: 'Würfel', line: 'Linie', cylinder: 'Zylinder', emanation: 'Ausströmung' };
export const shapeName = (s) => SHAPE_NAMES[s] || s;
export function areaShort(a) {
  if (!a) return '';
  const m = `${String(a.size).replace('.', ',')} m`;
  return `${m} ${shapeName(a.shape)}`;
}

// Schadenswürfel für einen Platzgrad bzw. (Zaubertricks) für die Charakterstufe
export function damageAt(sp, { slot, charLevel = 1 } = {}) {
  const d = sp.damage;
  if (!d) return null;
  if (d.char) {
    const keys = Object.keys(d.char).map(Number).sort((a, b) => a - b);
    let k = keys[0];
    for (const x of keys) if (x <= charLevel) k = x;
    return { dice: d.char[k], type: d.type };
  }
  if (d.slots) {
    const lvl = slot || sp.level;
    return { dice: d.slots[lvl] || d.slots[sp.level] || Object.values(d.slots)[0], type: d.type };
  }
  return null;
}
export function healAt(sp, { slot } = {}) {
  const h = sp.heal;
  if (!h) return null;
  if (h.slots) return String(h.slots[slot || sp.level] || Object.values(h.slots)[0]).replace(/\s*\+\s*MOD/i, '');
  if (h.dice) {
    const up = /um (\d+)W(\d+)/.exec((sp.higher || []).join(' '));
    const [n, die] = h.dice.split('d').map(Number);
    if (up && slot > sp.level && Number(up[2]) === die) return `${n + (slot - sp.level) * Number(up[1])}d${die}`;
    return h.dice;
  }
  return null;
}
export const healHasMod = (sp) => !!(sp.heal?.mod || (sp.heal?.slots && /MOD/i.test(Object.values(sp.heal.slots)[0])));

export function effectShort(sp, opts) {
  const d = damageAt(sp, opts);
  if (d) return `${fmtDice(d.dice)} ${damageName(d.type)}`;
  const h = healAt(sp, opts);
  if (h) return `Heilt ${fmtDice(h)}${healHasMod(sp) ? '+Mod' : ''}`;
  if (sp.area) return areaShort(sp.area);
  return schoolName(sp.school);
}

export function findSpell(list, ref) {
  if (!list || !ref) return null;
  const s = String(ref).trim().toLowerCase();
  return list.find((x) => x.id === ref) || list.find((x) => x.name.toLowerCase() === s || x.en?.toLowerCase() === s) || null;
}

// ───────────────────────── Klassenregeln ─────────────────────────
const THIRD = /Mystischer Ritter|Arkaner Betrüger/;
export function listClassOf(x) {
  if (findClass(x.cls)?.cast) return x.cls;
  if (THIRD.test(x.subclass || '')) return 'magier';
  return null;
}
export function casterTypeOf(x) {
  const cast = findClass(x.cls)?.cast;
  if (cast) return cast.type;
  return THIRD.test(x.subclass || '') ? 'third' : null;
}
// Höchster Zaubergrad, den diese Klasse allein auf ihrer Stufe lernen/vorbereiten darf
export function maxSpellLevel(x, ed) {
  const l = Number(x.level) || 0;
  const t = casterTypeOf(x);
  if (!t || !l) return 0;
  if (t === 'full') return Math.min(9, Math.ceil(l / 2));
  if (t === 'half') return ed === '2014' && l < 2 ? 0 : Math.min(5, Math.ceil(l / 4));
  if (t === 'artificer') return Math.min(5, Math.ceil(l / 4));
  if (t === 'third') return l < 3 ? 0 : l < 7 ? 1 : l < 13 ? 2 : l < 19 ? 3 : 4;
  if (t === 'pact') return pactSlots(l)?.level || 1;
  return 0;
}
// Mystisches Arkanum (Hexenmeister 11/13/15/17): je ein Zauber des 6.–9. Grades
export const arcanumLevels = (x) => (x.cls === 'hexenmeister' ? [[11, 6], [13, 7], [15, 8], [17, 9]].filter(([l]) => x.level >= l).map(([, g]) => g) : []);

// known   = feste Auswahl, Tausch nur beim Stufenaufstieg (Barde, Zauberer, Hexenmeister, Mystischer Ritter, Arkaner Betrüger; Waldläufer 2014)
// prepare = aus der ganzen Klassenliste vorbereiten (Kleriker, Druide, Paladin, Magieschmied; Waldläufer 2024)
// book    = Zauberbuch + daraus vorbereiten (Magier)
export function spellKind(x, ed) {
  if (x.cls === 'magier') return 'book';
  if (['kleriker', 'druide', 'paladin', 'magieschmied'].includes(x.cls)) return 'prepare';
  if (x.cls === 'waldlaeufer') return ed === '2024' ? 'prepare' : 'known';
  return 'known';
}
export const KIND_TEXT = {
  known: 'Du kennst eine feste Auswahl. Tauschen darfst du einen Zauber, wenn du in dieser Klasse eine Stufe aufsteigst.',
  prepare: 'Du bereitest Zauber aus der gesamten Klassenliste vor und kannst die Auswahl nach einer langen Rast ändern.',
  book: 'Neue Zauber schreibst du in dein Zauberbuch (2 pro Stufe, gefundene gegen Gold). Vorbereiten kannst du nur, was im Buch steht – nach jeder langen Rast neu.',
};

// Anforderungen für einen Klasseneintrag: Anzahl Zaubertricks, Zauber (bekannt/vorbereitet), Zauberbuch-Mindestgröße, max. Grad
export function spellNeeds(x, ed, mods) {
  const sc = spellcasting(x, ed, mods);
  const listCls = listClassOf(x);
  if (!sc || !listCls) return null;
  const kind = THIRD.test(x.subclass || '') && !findClass(x.cls)?.cast ? 'known' : spellKind(x, ed);
  return {
    cls: x.cls, listCls, kind, ability: sc.ability, mode: sc.mode,
    cantrips: sc.cantrips || 0, count: sc.count || 0, spellbook: kind === 'book' ? sc.spellbook : null,
    maxLevel: maxSpellLevel(x, ed), arcanum: arcanumLevels(x),
  };
}

// Zauber, die diese Klasse wählen darf
export function classSpells(list, listCls, { maxLevel = 9, cantrips = true } = {}) {
  return (list || []).filter((s) => s.classes.includes(listCls) && (s.level === 0 ? cantrips : s.level <= maxLevel));
}

// Einträge eines Charakters für einen Klasseneintrag (Altbestand ohne cls zählt zur ersten Zauberklasse)
export function entriesFor(c, clsKey) {
  const first = (c.classes || []).find((x) => listClassOf(x))?.cls;
  return (c.spell?.list || []).filter((e) => (e.cls || first) === clsKey && e.source !== 'feat' && e.source !== 'item' && e.source !== 'species');
}

// Zählt, was ein Klasseneintrag gewählt hat
export function countFor(c, clsKey) {
  const es = entriesFor(c, clsKey);
  return {
    cantrips: es.filter((e) => e.level === 0).length,
    book: es.filter((e) => e.level > 0 && e.book).length,
    prepared: es.filter((e) => e.level > 0 && e.prepared && !e.always && !e.arcanum).length,
    known: es.filter((e) => e.level > 0 && !e.always && !e.arcanum).length,
    arcanum: es.filter((e) => e.arcanum).map((e) => e.level),
  };
}
