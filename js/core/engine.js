// Kampfregeln nach D&D 5e (2014 und 2024): Aktionsökonomie, Vorteil/Nachteil, Angriffe gegen die RK, Rettungswürfe,
// Schaden (Resistenz → Anfälligkeit → Immunität, immer abgerundet), temporäre TP, Konzentration, 0 TP und
// Todesrettungswürfe, Zustände, Zauber-Effekte und Zonen. Arbeitet direkt auf dem Kampfzustand (combat/gm) und
// schreibt jeden Wurf mit Rechenweg ins Protokoll.
import { rollDie, roll, modifier } from '../lib/dice.js';
import { now, uid } from '../lib/util.js';
import { charMods, findSpecies } from '../data/chargen.js';
import { normalizeMonster } from '../ui/statblock.js';
import { DAMAGE_DE, DAMAGE_ART } from '../data/artmap.js';
import { saveBonus, monsterSpeed, cellDistance, inArea, tokenCenter, CELL_M } from './tactics.js';

// ───────────────────────── Zustände ─────────────────────────
export const COND = {
  blind: 'Blind', charmed: 'Bezaubert', deaf: 'Taub', exhausted: 'Erschöpft', frightened: 'Verängstigt', grappled: 'Gepackt',
  incap: 'Kampfunfähig', invisible: 'Unsichtbar', paralyzed: 'Gelähmt', petrified: 'Versteinert', poisoned: 'Vergiftet',
  prone: 'Liegend', restrained: 'Festgesetzt', stunned: 'Betäubt', unconscious: 'Bewusstlos',
};
// Zustände aus Zaubern, die das Spiel ebenfalls auswertet
export const XCOND = { banished: 'Verbannt', ethereal: 'Ätherisch', confused: 'Verwirrt', dancing: 'Tanzend', enclosed: 'Eingeschlossen', hidden: 'Versteckt', polymorphed: 'Verwandelt' };
const INCAP = [COND.incap, COND.paralyzed, COND.petrified, COND.stunned, COND.unconscious];
const NO_MOVE = [COND.grappled, COND.restrained, COND.paralyzed, COND.petrified, COND.stunned, COND.unconscious];
const AUTO_FAIL_SD = [COND.paralyzed, COND.petrified, COND.stunned, COND.unconscious];
const ADV_AGAINST = [COND.paralyzed, COND.petrified, COND.stunned, COND.unconscious, COND.restrained];
export const PHYS = new Set(['bludgeoning', 'piercing', 'slashing']);
export const AB_SHORT = { str: 'STÄ', dex: 'GES', con: 'KON', int: 'INT', wis: 'WEI', cha: 'CHA' };
const AB = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const fmtS = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
export const fmtM = (m) => `${String(Math.round((Number(m) || 0) * 10) / 10).replace('.', ',')} m`;
export const dmgName = (t) => DAMAGE_ART[t]?.name || t || '';

export const has = (c, n) => !!c && (c.conditions || []).some((k) => k.name === n);
export const effs = (c, key) => (c?.effects || []).filter((e) => e.key === key);
export const hasEff = (c, key) => (c?.effects || []).some((e) => e.key === key);
export const isDead = (c) => !!c?.dead;
export const atZero = (c) => (Number(c?.hp) || 0) <= 0;
export const isOut = (c) => isDead(c) || (!c?.isPC && atZero(c));
export const incapacitated = (c) => !!c && (INCAP.some((n) => has(c, n)) || has(c, XCOND.banished) || hasEff(c, 'lethargic'));
export const untargetable = (c) => has(c, XCOND.banished) || has(c, XCOND.ethereal) || has(c, XCOND.enclosed);
export function exhaustionOf(c, char) {
  const k = (c?.conditions || []).find((x) => x.name === COND.exhausted);
  return Math.max(Number(k?.level) || (k ? 1 : 0), Number(char?.exhaustion) || 0);
}
export const concOf = (c) => (c?.concentration && typeof c.concentration === 'object' ? c.concentration : c?.concentration ? { id: 'alt', name: 'Konzentration' } : null);

// ───────────────────────── Protokoll & Ergebnisse ─────────────────────────
// gm: ausführlichere Zeile nur für die SL (z. B. genaue TP eines Monsters)
export function log(x, text, kind = '', gm = '') {
  (x.log ||= []).push({ ts: now(), text, ...(kind ? { kind } : {}), ...(gm ? { gm } : {}) });
}
export function pushResult(x, rec) {
  const r = { ts: now(), ...rec };
  x.results = [...(x.results || []).filter((o) => o.id !== r.id), r].slice(-14);
  return r;
}
export const resultOf = (x, id) => (x.results || []).find((r) => r.id === id) || null;

// ───────────────────────── Werte ─────────────────────────
const EMPTY_DEF = () => ({ all: [], nm: [] });
// „Hieb, Stich und Wucht durch nichtmagische Angriffe; Feuer“ → { all: [fire], nm: [slashing, piercing, bludgeoning] }
export function defenses(txt) {
  const out = { all: new Set(), nm: new Set() };
  for (const clause of String(txt || '').toLowerCase().split(/;/)) {
    const nm = /nichtmagisch|nicht magisch|nonmagical/.test(clause);
    const add = (k) => (nm && PHYS.has(k) ? out.nm : out.all).add(k);
    for (const [de, k] of Object.entries(DAMAGE_DE)) if (clause.includes(de)) add(k);
    for (const k of Object.keys(DAMAGE_ART)) if (clause.includes(k)) add(k);
  }
  return { all: [...out.all], nm: [...out.nm].filter((k) => !out.all.has(k)) };
}
const condList = (txt) => Object.values(COND).filter((n) => String(txt || '').toLowerCase().includes(n.toLowerCase()));
const NUMW = { ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, two: 2, three: 3, four: 4, five: 5 };
export function multiattackOf(m) {
  const a = (m?.actions || []).find((x) => /Mehrfachangriff|Multiattack/i.test(x.name || ''));
  if (!a) return 1;
  const t = String(a.desc ?? a.value ?? '');
  let n = 0;
  for (const mm of t.matchAll(/\b(einen|eine|ein|zwei|drei|vier|fünf|sechs|two|three|four|five)\b\s+(?:\S+\s+){0,2}?\S*(?:angriff|attack)/gi)) n += NUMW[mm[1].toLowerCase()] || 0;
  if (!n) {
    const mm = /\b(zwei|drei|vier|fünf|two|three|four)\b/i.exec(t);
    n = mm ? NUMW[mm[1].toLowerCase()] : 2;
  }
  return Math.max(1, Math.min(8, n));
}
function monsterReactions(m) {
  return (m?.reactions || []).map((r) => {
    const t = `${r.name} ${r.desc ?? r.value ?? ''}`;
    if (/Parier|Parry/i.test(t)) return { kind: 'parry', name: r.name, ac: Number((/um (\d+)|by (\d+)/i.exec(t) || [])[1] || (/um (\d+)|by (\d+)/i.exec(t) || [])[2]) || 2 };
    return { kind: 'other', name: r.name, text: String(r.desc ?? r.value ?? '') };
  });
}
const baseCache = new Map();
function monsterBase(sb) {
  const key = `${sb.name}|${sb.ac}|${sb.hp}|${(sb.actions || []).length}|${sb.resistances || ''}|${sb.immunities || ''}`;
  if (baseCache.has(key)) return baseCache.get(key);
  const m = normalizeMonster(sb);
  const mods = Object.fromEntries(AB.map((k) => [k, modifier(m.abilities[k])]));
  const traitTxt = (m.traits || []).map((t) => `${t.name} ${t.desc}`).join(' | ');
  const leg = /Legendäre Resistenz\s*\((\d+)/i.exec(traitTxt) || /Legendary Resistance\s*\((\d+)/i.exec(traitTxt);
  const v = {
    ac: parseInt(m.ac, 10) || 10, mods, dex: mods.dex, speedM: monsterSpeed(m), saves: Object.fromEntries(AB.map((k) => [k, saveBonus(m, k)])), pb: m.pb || 2,
    resist: defenses(m.resistances), vuln: defenses(m.vulnerabilities), immune: defenses(m.immunities), condImm: condList(m.conditionImmunities),
    magicRes: /Magieresistenz|Magic Resistance/i.test(traitTxt), pack: /Rudeltaktik|Pack Tactics/i.test(traitTxt), legendaryRes: leg ? Number(leg[1]) : 0,
    multi: multiattackOf(m), reactions: monsterReactions(m), casting: sb.casting || null, type: String(m.type || ''), size: sb.sizeKey || 'medium',
    blindsight: /Blindsicht|Blindsight|Wahrsicht|Truesight/i.test(String(m.senses || '')), truesight: /Wahrsicht|Truesight/i.test(String(m.senses || '')),
  };
  baseCache.set(key, v);
  return v;
}
// Resistenzen aus dem Volk (Tiefling, Zwerg, Aasimar, Drachenblütige)
function speciesResist(char, ed) {
  const sp = findSpecies(ed, char.speciesKey);
  if (!sp) return [];
  if (sp.key === 'dwarf') return ['poison'];
  if (sp.key === 'aasimar') return ['necrotic', 'radiant'];
  if (sp.key === 'tiefling') {
    if (ed === '2024') return { abyssisch: ['poison'], chthonisch: ['necrotic'], infernalisch: ['fire'] }[char.speciesOption || char.subspeciesKey] || ['fire'];
    return ['fire'];
  }
  if (sp.key === 'dragonborn') {
    const o = sp.option?.list?.find((x) => x.key === char.speciesOption);
    const t = /\(([^)]+)\)/.exec(o?.name || '')?.[1]?.toLowerCase();
    return t && DAMAGE_DE[t] ? [DAMAGE_DE[t]] : [];
  }
  if ((sp.subs || []).find((s) => s.key === char.subspeciesKey)?.key === 'robust') return ['poison'];
  return [];
}
function pcBase(char, ed) {
  const cm = charMods(char);
  const sp = cm.spell[0] || null;
  return {
    ac: Number(char.ac) || cm.ac.ac, mods: cm.mods, dex: cm.mods.dex, speedM: Math.round((Number(char.speed) || 30) * 0.3 * 10) / 10,
    saves: Object.fromEntries(Object.entries(cm.saves).map(([k, v]) => [k, v.bonus])), pb: cm.pb, level: cm.level, init: cm.init,
    spell: sp ? { dc: sp.dc, attack: sp.attack, ability: sp.ability } : null, spells: cm.spell,
    resist: { all: speciesResist(char, ed), nm: [] }, vuln: EMPTY_DEF(), immune: EMPTY_DEF(), condImm: [],
    feats: new Set((char.feats || []).map((f) => f.key)), classes: char.classes || [], body: char.armor?.body || null, shield: !!char.armor?.shield,
    size: String(char.size || '').toLowerCase().includes('klein') ? 'small' : 'medium', multi: 1, reactions: [],
  };
}
const ZERO = Object.fromEntries(AB.map((k) => [k, 0]));
// Aktuelle Werte eines Kämpfers inkl. Effekte (RK, Bewegung, Resistenzen …)
export function statsOf(c, ctx = {}) {
  // Verwandelt (Verwandlung, Tiergestalt): es gelten die Werte der neuen Gestalt
  const form = c?.form?.statblock || null;
  const char = c?.isPC && !form ? ctx.charOf?.(c) : null;
  const sb = form || c?.statblock;
  const base = char ? pcBase(char, ctx.ed || '2014') : sb ? monsterBase(sb)
    : { ac: Number(c?.ac) || 10, mods: ZERO, dex: Math.floor(((Number(c?.initBonus) || 0))), speedM: 9, saves: ZERO, pb: 2, resist: EMPTY_DEF(), vuln: EMPTY_DEF(), immune: EMPTY_DEF(), condImm: [], multi: 1, reactions: [] };
  const s = { ...base, resist: { all: [...base.resist.all], nm: [...base.resist.nm] }, immune: { all: [...base.immune.all], nm: [...base.immune.nm] }, condImm: [...(base.condImm || [])] };
  if (!char && !sb && c?.ac != null) s.ac = Number(c.ac);
  if (sb) s.casting = sb.casting || null; // nicht aus dem Zwischenspeicher – Zauberlisten können nachträglich dazukommen
  let ac = s.ac;
  for (const e of c?.effects || []) if (e.key === 'mageArmor' && !base.body) ac = Math.max(ac, 13 + s.dex + (base.shield ? 2 : 0));
  for (const e of c?.effects || []) if (e.key === 'ac') ac += Number(e.data?.bonus) || 0;
  for (const e of c?.effects || []) if (e.key === 'acMin') ac = Math.max(ac, Number(e.data?.value) || 0);
  s.ac = ac;
  for (const e of c?.effects || []) {
    if (e.key === 'resist') for (const t of e.data?.types || []) { const arr = e.data?.nonmagical ? s.resist.nm : s.resist.all; if (!arr.includes(t)) arr.push(t); }
    if (e.key === 'immuneCond') s.condImm.push(...(e.data?.names || []));
  }
  if (has(c, COND.petrified)) s.resist.all = [...new Set([...s.resist.all, ...Object.keys(DAMAGE_ART)])];
  s.speedM = speedCalc(c, s, char, ctx);
  s.exhaustion = exhaustionOf(c, char);
  return s;
}
function speedCalc(c, s, char, ctx) {
  if (isDead(c) || NO_MOVE.some((n) => has(c, n)) || hasEff(c, 'lethargic') || hasEff(c, 'speedZero') || has(c, XCOND.enclosed)) return 0;
  let v = s.speedM;
  for (const e of c.effects || []) if (e.key === 'speedAdd') v += Number(e.data?.m) || 0;
  const ex = exhaustionOf(c, char);
  if ((ctx.ed || '2014') === '2024') v -= 1.5 * ex;
  else { if (ex >= 5) return 0; if (ex >= 2) v /= 2; }
  if (hasEff(c, 'haste')) v *= 2;
  if (hasEff(c, 'slow')) v /= 2;
  return Math.max(0, Math.floor(v / CELL_M + 1e-6) * CELL_M);
}
export const acOf = (c, ctx) => statsOf(c, ctx).ac;

// ───────────────────────── Sicht ─────────────────────────
const seesInvisible = (c, ctx) => hasEff(c, 'seeInvisible') || (c?.statblock && (monsterBase(c.statblock).truesight || monsterBase(c.statblock).blindsight)) || !!ctx?.blindsight?.(c);
export function canSee(a, b, ctx = {}) {
  if (!a || !b) return true;
  if (has(a, COND.blind) && !(a.statblock && monsterBase(a.statblock).blindsight)) return false;
  if ((has(b, COND.invisible) || has(b, XCOND.hidden)) && !seesInvisible(a, ctx)) return false;
  if (ctx.obscured && ctx.obscured(a, b)) return false;
  return true;
}

// ───────────────────────── Angriffe ─────────────────────────
// Vorteil/Nachteil, RK (inkl. Deckung), Reichweite und Sichtlinie für einen Angriff
export function attackPlan(x, att, tgt, a, ctx = {}) {
  const ed = ctx.ed || '2014';
  const sT = statsOf(tgt, ctx);
  const sA = statsOf(att, ctx);
  const tA = ctx.tokenOf?.(att);
  const tT = ctx.tokenOf?.(tgt);
  const distM = tA && tT ? cellDistance(tA, tT) * CELL_M : 0;
  const melee = a.kind === 'melee' || a.kind === 'spellMelee';
  const reach = a.reach || 1.5;
  const near = melee ? reach : a.range?.[0] ?? a.rangeM ?? reach;
  const far = melee ? reach : a.range?.[1] ?? a.rangeM ?? reach;
  const problems = [];
  if (untargetable(tgt)) problems.push(`${tgt.name} ist gerade nicht erreichbar`);
  if (tA && tT && distM > far + 1e-6) problems.push(`außer Reichweite (${fmtM(distM)}, höchstens ${fmtM(far)})`);
  const los = tA && tT && ctx.los ? ctx.los(tA, tT) : true;
  if (!los) problems.push('keine Sichtlinie');
  if (has(att, COND.charmed) && (att.conditions || []).some((k) => k.name === COND.charmed && k.src === tgt.id)) problems.push('bezaubert – kann den Bezauberer nicht angreifen');
  const adv = [];
  const dis = [];
  const seesT = canSee(att, tgt, ctx);
  const seesA = canSee(tgt, att, ctx);
  if (!seesT) dis.push(has(att, COND.blind) ? 'du bist blind' : 'Ziel unsichtbar');
  if (!seesA) adv.push(has(tgt, COND.blind) ? 'Ziel ist blind' : 'Ziel sieht dich nicht');
  if (has(att, COND.poisoned)) dis.push('vergiftet');
  if (has(att, COND.prone)) dis.push('du liegst');
  if (has(att, COND.restrained)) dis.push('festgesetzt');
  if (has(att, COND.frightened)) dis.push('verängstigt');
  if (hasEff(att, 'dancing') || has(att, XCOND.dancing)) dis.push('tanzt');
  if (ed === '2014' && sA.exhaustion >= 3) dis.push(`Erschöpfung ${sA.exhaustion}`);
  if (ed === '2024' && has(att, COND.grappled) && !(att.conditions || []).some((k) => k.name === COND.grappled && k.src === tgt.id)) dis.push('gepackt');
  for (const n of ADV_AGAINST) if (has(tgt, n)) adv.push(`Ziel ${n.toLowerCase()}`);
  if (has(tgt, XCOND.dancing)) adv.push('Ziel tanzt');
  if (has(tgt, COND.prone)) { if (distM <= 1.5) adv.push('Ziel liegt (1,5 m)'); else dis.push('Ziel liegt (Fernkampf)'); }
  if (hasEff(tgt, 'dodge') && !incapacitated(tgt) && sT.speedM > 0 && seesT) dis.push('Ziel weicht aus');
  if (hasEff(tgt, 'advAgainst')) adv.push(effs(tgt, 'advAgainst').map((e) => e.name).join(', '));
  if (effs(tgt, 'guided').length) adv.push('Lenkendes Geschoss');
  if (hasEff(tgt, 'blur') && !seesInvisible(att, ctx)) dis.push('Verschwimmen');
  for (const e of effs(tgt, 'protEvil')) if (/aberration|himmlisch|celestial|elementar|fee|fey|unhold|fiend|untot|undead/i.test(att.statblock?.type || '')) dis.push(e.name);
  if (effs(att, 'helped').some((e) => !e.data?.target || e.data.target === tgt.id)) adv.push('Hilfe');
  if (effs(att, 'advNext').some((e) => !e.data?.target || e.data.target === tgt.id)) adv.push('Vorteil auf den nächsten Angriff');
  if (hasEff(att, 'disNext')) dis.push('Nachteil auf den nächsten Angriff');
  if (hasEff(att, 'reckless') && melee) adv.push('Tollkühner Angriff');
  if (hasEff(tgt, 'recklessTarget')) adv.push('Ziel greift tollkühn an');
  if (hasEff(tgt, 'foresight')) dis.push('Voraussicht');
  if (hasEff(att, 'foresight')) adv.push('Voraussicht');
  if (!melee && ctx.hostileNear?.(att)) dis.push('Gegner in 1,5 m');
  if (!melee && distM > near + 1e-6) dis.push('große Reichweite');
  if (sA.pack && ctx.allyNear?.(att, tgt)) adv.push('Rudeltaktik');
  const mode = adv.length && dis.length ? null : adv.length ? 'adv' : dis.length ? 'dis' : null;
  const cover = !melee && !a.ignoreCover && ctx.cover ? ctx.cover(tA, tT) : 0;
  const autoCrit = melee && distM <= 1.5 && (has(tgt, COND.paralyzed) || has(tgt, COND.unconscious));
  return { ok: !problems.length, problems, adv, dis, mode, ac: sT.ac + cover, baseAc: sT.ac, cover, distM, long: !melee && distM > near + 1e-6, autoCrit, melee, bonus: Number(a.bonus) || 0, critOn: a.critOn || 20 };
}
// Trefferchance wie in BG3 (für die Anzeige)
export function hitChance(bonus, ac, mode) {
  const need = ac - bonus;
  const p = Math.max(0.05, Math.min(0.95, (21 - need) / 20));
  return mode === 'adv' ? 1 - (1 - p) ** 2 : mode === 'dis' ? p * p : p;
}
export function judge(plan, r) {
  const natural = Number(r.natural);
  const fumble = natural === 1;
  let crit = natural >= (plan.critOn || 20);
  const hit = !fumble && (crit || Number(r.total) >= plan.ac);
  if (hit && plan.autoCrit) crit = true;
  return { natural, total: Number(r.total), hit, crit: hit && crit, fumble };
}
// Einmal-Effekte nach einem Angriff verbrauchen (Hilfe, Lenkendes Geschoss, Unsichtbarkeit endet …)
export function afterAttack(x, att, tgt) {
  for (const e of [...(att.effects || [])]) if (['helped', 'advNext', 'disNext'].includes(e.key) && (!e.data?.target || e.data.target === tgt?.id)) removeEffect(x, att, e.id);
  for (const e of [...(tgt?.effects || [])]) if (e.key === 'guided') removeEffect(x, tgt, e.id);
  breakInvisibility(x, att);
}
export function breakInvisibility(x, c) {
  for (const k of [...(c.conditions || [])]) if ((k.name === COND.invisible || k.name === XCOND.hidden) && k.breakOnAttack) removeCondition(x, c, k.name, 'hat angegriffen oder gezaubert');
  for (const e of [...(c.effects || [])]) if (e.key === 'sanctuary') removeEffect(x, c, e.id);
}

// ───────────────────────── Rettungswürfe ─────────────────────────
function rollD20(mode) {
  const a = rollDie(20);
  if (!mode) return { natural: a, dice: [a] };
  const b = rollDie(20);
  return { natural: mode === 'adv' ? Math.max(a, b) : Math.min(a, b), dice: [a, b] };
}
export function savingThrow(x, c, ab, dc, opts = {}, ctx = {}) {
  const ed = ctx.ed || '2014';
  const s = statsOf(c, ctx);
  const label = `${AB_SHORT[ab] || ab}-Rettungswurf`;
  if (AUTO_FAIL_SD.some((n) => has(c, n)) && (ab === 'str' || ab === 'dex')) {
    const text = `${c.name}: ${label} scheitert automatisch (${AUTO_FAIL_SD.find((n) => has(c, n))})`;
    log(x, text);
    return { ok: false, auto: true, total: 0, natural: 0, text };
  }
  if (opts.immuneTo && s.condImm.includes(opts.immuneTo)) {
    const text = `${c.name}: immun gegen „${opts.immuneTo}“`;
    log(x, text);
    return { ok: true, immune: true, total: 0, natural: 0, text };
  }
  const adv = [...(opts.adv || [])];
  const dis = [...(opts.dis || [])];
  if (ab === 'dex' && hasEff(c, 'dodge') && !incapacitated(c) && s.speedM > 0) adv.push('Ausweichen');
  if (ab === 'dex' && hasEff(c, 'haste')) adv.push('Hast');
  if (ab === 'dex' && has(c, COND.restrained)) dis.push('festgesetzt');
  if (ab === 'dex' && (has(c, XCOND.dancing) || hasEff(c, 'dancing'))) dis.push('tanzt');
  if (opts.spell && s.magicRes) adv.push('Magieresistenz');
  if (ab === 'str' && hasEff(c, 'rage')) adv.push('Kampfrausch');
  if (ab === 'wis' && hasEff(c, 'beacon')) adv.push('Leuchtfeuer der Hoffnung');
  if (hasEff(c, 'holyAura')) adv.push('Heilige Aura');
  if (hasEff(c, 'foresight')) adv.push('Voraussicht');
  if (ed === '2014' && s.exhaustion >= 3) dis.push(`Erschöpfung ${s.exhaustion}`);
  const mode = adv.length && dis.length ? null : adv.length ? 'adv' : dis.length ? 'dis' : null;
  let bonus = Number(s.saves?.[ab]) || 0;
  const parts = [`${fmtS(bonus)}`];
  const add = (n, why) => { bonus += n; parts.push(`${fmtS(n)} ${why}`); };
  for (const e of effs(c, 'bless')) { const d = rollDie(4); add(d, `Segen (W4=${d})`); void e; }
  for (const e of effs(c, 'bane')) { const d = rollDie(4); add(-d, `Fluch (W4=${d})`); void e; }
  for (const e of effs(c, 'saveDie')) { const d = rollDie(Number(e.data?.sides) || 4); add(d, `${e.name} (W${e.data?.sides || 4}=${d})`); removeEffect(x, c, e.id); }
  if (ab === 'dex' && hasEff(c, 'slow')) add(-2, 'Verlangsamen');
  for (const e of effs(c, 'wardingBond')) { add(1, e.name); }
  if (ab === 'dex' && opts.cover) add(opts.cover, 'Deckung');
  for (const e of effs(c, 'auraSave')) add(Number(e.data?.bonus) || 0, e.name);
  if (ed === '2024' && s.exhaustion) add(-2 * s.exhaustion, `Erschöpfung ${s.exhaustion}`);
  if (ab === 'con' && opts.conc && effs(c, 'warCaster').length) adv.push('Kriegszauberer');
  const r = rollD20(mode);
  const total = r.natural + bonus;
  let ok = total >= dc;
  let note = '';
  if (!ok && !c.isPC && s.legendaryRes && (c.legResUsed || 0) < s.legendaryRes && opts.allowLegendary !== false) {
    c.legResUsed = (c.legResUsed || 0) + 1;
    ok = true;
    note = ` · Legendäre Resistenz (${c.legResUsed}/${s.legendaryRes})`;
  }
  const dieTxt = r.dice.length > 1 ? `W20 ${mode === 'adv' ? 'Vorteil' : 'Nachteil'} [${r.dice.join(', ')}]` : `W20 [${r.natural}]`;
  const text = `${c.name}: ${label} ${dieTxt} ${parts.join(' ')} = ${total} gegen SG ${dc} → ${ok ? 'geschafft' : 'misslungen'}${note}`;
  log(x, text);
  return { ok, total, natural: r.natural, mode, text, adv, dis };
}

// ───────────────────────── Schaden & Heilung ─────────────────────────
// parts: [{ amount, type }] – bereits gewürfelt. opts: { crit, melee, magical, attacker, source }
export function applyDamage(x, c, parts, opts = {}, ctx = {}) {
  const out = { taken: 0, lines: [], dropped: false, died: false };
  if (!c || isDead(c)) return out;
  const s = statsOf(c, ctx);
  let total = 0;
  for (const p of parts) {
    let n = Math.max(0, Math.floor(Number(p.amount) || 0));
    const t = p.type || null;
    const phys = t && PHYS.has(t) && !opts.magical;
    const steps = [];
    if (t && (s.resist.all.includes(t) || (phys && s.resist.nm.includes(t)))) { n = Math.floor(n / 2); steps.push('Resistenz → halbiert'); }
    if (t && s.vuln.all.includes(t)) { n *= 2; steps.push('Anfälligkeit → verdoppelt'); }
    if (t && (s.immune.all.includes(t) || (phys && s.immune.nm.includes(t)))) { n = 0; steps.push('Immunität → 0'); }
    total += n;
    out.lines.push(`${p.amount} ${dmgName(t)}${steps.length ? ` (${steps.join(', ')}) = ${n}` : ''}`);
  }
  for (const e of effs(c, 'reduceDamage')) {
    const r = Math.min(total, roll(e.data?.dice || '1d4').total);
    if (r) { total -= r; out.lines.push(`${e.name}: −${r}`); }
    if (e.data?.once) removeEffect(x, c, e.id);
  }
  if (opts.halve) { total = Math.floor(total / 2); out.lines.push(`${opts.halve}: halbiert`); }
  if (c.tempHp && total > 0) {
    const t = Math.min(c.tempHp, total);
    c.tempHp -= t;
    total -= t;
    out.lines.push(`temporäre TP fangen ${t} ab`);
  }
  if (c.form?.endOnTemp && !c.tempHp) revertForm(x, c, 'keine temporären TP mehr');
  out.taken = total;
  const who = opts.attacker ? ` (von ${opts.attacker.name})` : '';
  if (total <= 0) {
    log(x, `🛡 ${c.name} erleidet keinen Schaden${who}: ${out.lines.join(' · ')}`);
    return out;
  }
  // Schutzbindung: der Wirker erleidet denselben Schaden
  for (const e of effs(c, 'wardingBond')) {
    const w = x.combatants.find((o) => o.id === e.src);
    if (w && w.id !== c.id && !isDead(w)) { log(x, `🔗 Schutzbindung: ${w.name} erleidet ebenfalls ${total}`); applyDamage(x, w, [{ amount: total, type: null }], { source: 'Schutzbindung' }, ctx); }
  }
  // Verwandelt (2014): die Gestalt fängt den Schaden ab; bei 0 TP zurück, der Rest trifft die eigene Gestalt
  let absorbed = false;
  if (c.form?.mode === 'replace' && c.hp > 0) {
    if (c.hp > total) {
      c.hp -= total;
      absorbed = true;
    } else {
      const over = total - c.hp;
      out.lines.push(`Gestalt „${c.form.name}“ bricht – ${over} gehen durch`);
      revertForm(x, c, 'Gestalt auf 0 TP');
      total = over;
    }
  }
  const mark = (x.log || []).length; // Schadenszeile gehört vor „fällt auf 0 TP“ / „besiegt“
  if (absorbed || total <= 0) {
    // die Gestalt hat alles abgefangen
  } else if (c.hp > 0) {
    c.hp -= total;
    if (c.hp <= 0) {
      const overflow = -c.hp;
      c.hp = 0;
      const ward = effs(c, 'deathWard')[0];
      if (ward) {
        c.hp = 1;
        removeEffect(x, c, ward.id);
        out.lines.push('Todesschutz: bleibt bei 1 TP');
      } else if (opts.floorOne) {
        c.hp = 1;
      } else if (c.isPC) {
        if (overflow >= (Number(c.maxHp) || 1)) die(x, c, `massiver Schaden (${overflow} ≥ ${c.maxHp} TP-Maximum)`);
        else {
          out.dropped = true;
          c.deathSaves = { s: 0, f: 0 };
          c.stable = false;
          addCondition(x, c, { name: COND.unconscious, auto: 'zeroHp' });
          addCondition(x, c, { name: COND.prone });
          log(x, `💥 ${c.name} fällt auf 0 TP – bewusstlos und liegend`);
        }
      } else die(x, c, 'auf 0 TP');
      if (isDead(c) || out.dropped) out.died = isDead(c);
    }
  } else if (c.isPC) {
    if (total >= (Number(c.maxHp) || 1)) die(x, c, `massiver Schaden bei 0 TP (${total} ≥ ${c.maxHp})`);
    else {
      const ds = (c.deathSaves ||= { s: 0, f: 0 });
      ds.f += opts.crit ? 2 : 1;
      c.stable = false;
      log(x, `💀 ${c.name} wird bei 0 TP getroffen → ${opts.crit ? 'zwei Fehlschläge (kritisch)' : 'ein Fehlschlag'} (${ds.s}✓/${ds.f}✗)`);
      if (ds.f >= 3) die(x, c, 'drei Fehlschläge');
    }
  }
  const line = `🩸 ${c.name} erleidet ${total} Schaden${who}: ${out.lines.join(' · ')}`;
  if (isDead(c)) log(x, `${line} → ${c.isPC ? 'tot' : 'besiegt'}`);
  else if (c.isPC) log(x, `${line} → ${c.hp}/${c.maxHp} TP`);
  else log(x, line, '', `${line} → ${c.hp}/${c.maxHp} TP`);
  if (x.log.length - 1 > mark) x.log.splice(mark, 0, x.log.pop());
  // Zustände, die bei Schaden enden (Hypnotisches Muster, Schlaf …) bzw. einen neuen Rettungswurf erlauben
  for (const k of [...(c.conditions || [])]) {
    if (k.endOnDamage) removeCondition(x, c, k.name, 'durch Schaden');
    else if (k.saveOnDamage && k.save) {
      const r = savingThrow(x, c, k.save.ab, k.save.dc, { spell: true, adv: ['durch Schaden'] }, ctx);
      if (r.ok) removeCondition(x, c, k.name, 'Rettungswurf nach Schaden');
    }
  }
  // Konzentration
  const conc = concOf(c);
  if (conc && !isDead(c)) {
    if (c.hp <= 0 || incapacitated(c)) endConcentration(x, c, 'kampfunfähig');
    else {
      const dc = Math.min((ctx.ed || '2014') === '2024' ? 30 : 99, Math.max(10, Math.floor(total / 2)));
      const r = savingThrow(x, c, 'con', dc, { conc: true, allowLegendary: false }, ctx);
      if (!r.ok) endConcentration(x, c, 'Konzentrationswurf misslungen');
    }
  }
  return out;
}
export function die(x, c, why) {
  c.dead = true;
  c.hp = 0;
  c.stable = false;
  if (concOf(c)) endConcentration(x, c, 'tot');
  log(x, `☠️ ${c.name} ${c.isPC ? 'stirbt' : 'ist besiegt'} – ${why}`);
  // Beschworene Kreaturen verschwinden bei 0 TP (belebte Untote bleiben liegen)
  if (c.summonOf && !c.keep && !c.vanish) {
    c.vanish = true;
    log(x, `✨ ${c.name} verschwindet`);
  }
}
export function applyHealing(x, c, amount, opts = {}) {
  if (!c) return 0;
  if (isDead(c) && !opts.revive) { log(x, `${c.name} ist tot – Heilung wirkt nicht`); return 0; }
  if (hasEff(c, 'noHeal')) { log(x, `${c.name} kann gerade keine TP zurückerhalten (${effs(c, 'noHeal')[0].name})`); return 0; }
  let n = Math.max(0, Math.floor(Number(amount) || 0));
  if (opts.revive) { c.dead = false; c.hp = 0; }
  const before = c.hp;
  c.hp = Math.min(Number(c.maxHp) || 1, Math.max(0, c.hp) + n);
  n = c.hp - Math.max(0, before);
  if (c.hp > 0 && before <= 0) {
    c.deathSaves = { s: 0, f: 0 };
    c.stable = false;
    removeCondition(x, c, COND.unconscious);
  }
  const line = `💚 ${c.name} erhält ${n} TP zurück${opts.source ? ` (${opts.source})` : ''}`;
  if (c.isPC) log(x, `${line} → ${c.hp}/${c.maxHp}`);
  else log(x, line, '', `${line} → ${c.hp}/${c.maxHp}`);
  return n;
}
export function addTempHp(x, c, n, source = '') {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v <= (c.tempHp || 0)) { log(x, `${c.name}: ${v} temporäre TP verfallen – ${c.tempHp} sind höher`); return; }
  c.tempHp = v;
  log(x, `🛡 ${c.name} erhält ${v} temporäre TP${source ? ` (${source})` : ''}`);
}
export function stabilize(x, c, source = '') {
  if (!c?.isPC || !atZero(c) || isDead(c)) return false;
  c.stable = true;
  c.deathSaves = { s: 0, f: 0 };
  log(x, `🩹 ${c.name} ist stabilisiert${source ? ` (${source})` : ''}`);
  return true;
}
export function deathSave(x, c, ctx = {}) {
  const adv = hasEff(c, 'beacon');
  const a = rollDie(20);
  const b = adv ? rollDie(20) : null;
  const n = adv ? Math.max(a, b) : a;
  const ds = (c.deathSaves ||= { s: 0, f: 0 });
  let text;
  if (n === 20) {
    c.hp = 1;
    ds.s = 0;
    ds.f = 0;
    c.stable = false;
    removeCondition(x, c, COND.unconscious);
    text = 'natürliche 20 – wacht mit 1 TP auf!';
  } else if (n === 1) { ds.f += 2; text = 'natürliche 1 – zwei Fehlschläge'; } else if (n >= 10) { ds.s += 1; text = 'Erfolg'; } else { ds.f += 1; text = 'Fehlschlag'; }
  if (ds.f >= 3) { log(x, `💀 ${c.name}: Todesrettungswurf W20 ${adv ? `Vorteil [${a}, ${b}]` : `[${n}]`} → ${text}`); die(x, c, 'drei Fehlschläge'); return { n, text, dead: true }; }
  if (ds.s >= 3) { c.stable = true; ds.s = 0; ds.f = 0; text += ' – stabilisiert (bewusstlos, keine weiteren Würfe)'; }
  log(x, `💀 ${c.name}: Todesrettungswurf W20 ${adv ? `Vorteil [${a}, ${b}]` : `[${n}]`} → ${text}${c.stable ? '' : ` (${ds.s}✓/${ds.f}✗)`}`);
  void ctx;
  return { n, text };
}

// ───────────────────────── Zustände & Effekte ─────────────────────────
// Zustand: { name, src?, until?: { cb, at: 'start'|'end', n }, rounds?, save?: { ab, dc, at: 'end' }, conc?, effId?, endOnDamage?, breakOnAttack? }
export function addCondition(x, c, k, ctx = {}) {
  if (!c || isDead(c)) return false;
  const s = ctx.skipImm ? null : statsOf(c, ctx);
  if (s && s.condImm.includes(k.name)) { log(x, `${c.name} ist immun gegen „${k.name}“`); return false; }
  if (k.name === COND.frightened && hasEff(c, 'heroism')) { log(x, `${c.name} kann nicht verängstigt werden (Heldenmut)`); return false; }
  c.conditions = [...(c.conditions || []).filter((o) => !(o.name === k.name && !o.effId && !k.effId)), { ...k }];
  if (INCAP.includes(k.name) && (ctx.ed === '2024' || k.name !== COND.incap) && concOf(c)) endConcentration(x, c, `${k.name.toLowerCase()}`);
  if (k.name === COND.unconscious && !has(c, COND.prone)) c.conditions.push({ name: COND.prone });
  if (INCAP.includes(k.name) && c.form?.endOnIncap) revertForm(x, c, k.name);
  return true;
}
export function removeCondition(x, c, name, why = '') {
  const had = has(c, name);
  c.conditions = (c.conditions || []).filter((k) => k.name !== name);
  if (had) log(x, `${c.name}: „${name}“ endet${why ? ` (${why})` : ''}`);
}
export function addEffect(x, c, e) {
  const eff = { id: uid(8), ts: now(), ...e };
  c.effects = [...(c.effects || []).filter((o) => !(e.unique && o.key === e.key && (o.src === e.src || e.unique === 'any'))), eff];
  return eff;
}
export function removeEffect(x, c, id, why = '') {
  const e = (c.effects || []).find((o) => o.id === id);
  if (!e) return;
  c.effects = c.effects.filter((o) => o.id !== id);
  c.conditions = (c.conditions || []).filter((k) => k.effId !== id);
  if (e.key === 'aid') { c.maxHp = Math.max(1, (Number(c.maxHp) || 1) - (Number(e.data?.hp) || 0)); c.hp = Math.min(c.hp, c.maxHp); }
  if (e.key === 'haste' && !isDead(c)) {
    // Hast endet: bis nach dem nächsten eigenen Zug weder Bewegung noch Aktionen – auch im laufenden Zug
    addEffect(x, c, { key: 'lethargic', name: 'Lethargisch (Hast endet)', until: { cb: c.id, at: 'end', n: c.turnNo || 0 } });
    if (c.eco) Object.assign(c.eco, { action: 0, extra: 0, attacks: 0, moveM: Number(c.eco.movedM) || 0 });
  }
  if (e.name && !e.silent) log(x, `${c.name}: „${e.name}“ endet${why ? ` (${why})` : ''}`);
}
export function startConcentration(x, c, info) {
  if (concOf(c)) endConcentration(x, c, `neuer Konzentrationszauber: ${info.name}`);
  const id = uid(8);
  c.concentration = { id, name: info.name, spellId: info.spellId || null, since: now() };
  return id;
}
export function endConcentration(x, c, why = '') {
  const conc = concOf(c);
  if (!conc) return;
  c.concentration = null;
  log(x, `🔸 ${c.name}: Konzentration auf „${conc.name}“ endet${why ? ` (${why})` : ''}`);
  for (const o of x.combatants || []) {
    for (const e of [...(o.effects || [])]) if (e.conc === conc.id) removeEffect(x, o, e.id);
    if (o.form?.conc === conc.id) revertForm(x, o, 'Konzentration endet');
    const before = o.conditions || [];
    o.conditions = before.filter((k) => k.conc !== conc.id);
    if (o.conc === conc.id && o.summonOf && !o.vanish) vanish(x, o, 'Konzentration endet');
  }
  x.zones = (x.zones || []).filter((z) => z.conc !== conc.id);
}
// Verwandlung / Tiergestalt. mode 'replace' (2014): TP der neuen Gestalt, beim Zurückverwandeln geht der Rest durch;
// mode 'temp' (2024): eigene TP bleiben, dazu temporäre TP (endOnTemp: endet, wenn sie aufgebraucht sind)
export function applyForm(x, c, m, { mode = 'replace', conc = null, src = '', by = null, temp = 0, endOnTemp = false, endOnIncap = false } = {}) {
  if (c.form) revertForm(x, c, 'neue Gestalt');
  const hp = Math.max(1, Number(m.hp) || 1);
  c.form = { name: m.name, statblock: m, mode, conc, src, endOnTemp, endOnIncap, hp0: c.hp, max0: c.maxHp };
  if (mode === 'replace') {
    c.hp = hp;
    c.maxHp = hp;
  } else {
    c.tempHp = Math.max(Number(c.tempHp) || 0, temp || hp);
    c.form.tempGiven = true;
  }
  c.conditions = [...(c.conditions || []).filter((k) => k.name !== XCOND.polymorphed), { name: XCOND.polymorphed, label: m.name, ...(conc ? { conc } : {}), ...(by ? { src: by } : {}) }];
  log(x, `🔁 ${c.name} verwandelt sich in ${m.name}${mode === 'replace' ? ` (${hp} TP)` : ` (+${c.tempHp} temporäre TP)`}`);
}
export function revertForm(x, c, why = '') {
  const f = c?.form;
  if (!f) return;
  c.form = null;
  if (f.mode === 'replace') {
    c.hp = Number(f.hp0) || 0;
    c.maxHp = Number(f.max0) || c.maxHp;
  } else if (f.tempGiven) c.tempHp = 0;
  c.conditions = (c.conditions || []).filter((k) => k.name !== XCOND.polymorphed);
  log(x, `🔁 ${c.name} nimmt wieder die eigene Gestalt an${why ? ` (${why})` : ''}`);
}
// Beschworene Kreaturen verschwinden (Konzentration endet) – ihr Token wird nach dem Speichern entfernt
export function vanish(x, c, why = '') {
  c.vanish = true;
  c.dead = true;
  c.hp = 0;
  if (concOf(c)) endConcentration(x, c, 'verschwunden');
  log(x, `✨ ${c.name} verschwindet${why ? ` (${why})` : ''}`);
}
// Abläufe „bis zum Beginn/Ende des nächsten Zuges von X“
function expire(x, c, at) {
  for (const o of x.combatants) {
    for (const e of [...(o.effects || [])]) if (e.until && e.until.cb === c.id && e.until.at === at && (c.turnNo || 0) > (e.until.n || 0)) removeEffect(x, o, e.id);
    for (const k of [...(o.conditions || [])]) if (k.until && k.until.cb === c.id && k.until.at === at && (c.turnNo || 0) > (k.until.n || 0)) { o.conditions = o.conditions.filter((q) => q !== k); log(x, `${o.name}: „${k.name}“ endet`); }
  }
}
// Rundendauer: zählt zu Beginn des Zuges der Quelle herunter (Zauberdauer „1 Minute“ = 10 Runden)
function tickRounds(x, c) {
  for (const o of x.combatants) {
    for (const e of [...(o.effects || [])]) {
      if (!e.rounds || (e.src || o.id) !== c.id) continue;
      e.rounds -= 1;
      if (e.rounds <= 0) removeEffect(x, o, e.id, 'Dauer abgelaufen');
    }
  }
  c.conditions = (c.conditions || []).map((k) => (k.rounds && !k.src ? { ...k, rounds: k.rounds - 1 } : k)).filter((k) => {
    if (k.rounds === 0 && !k.src) { log(x, `${c.name}: „${k.name}“ endet`); return false; }
    return true;
  });
  for (const o of x.combatants) {
    o.conditions = (o.conditions || []).map((k) => (k.rounds && k.src === c.id ? { ...k, rounds: k.rounds - 1 } : k)).filter((k) => {
      if (k.rounds === 0 && k.src === c.id) { log(x, `${o.name}: „${k.name}“ endet`); return false; }
      return true;
    });
  }
  x.zones = (x.zones || []).map((z) => (z.rounds && z.src === c.id ? { ...z, rounds: z.rounds - 1 } : z)).filter((z) => {
    if (z.rounds === 0) { log(x, `„${z.name}“ endet`); return false; }
    return true;
  });
}

// ───────────────────────── Zonen ─────────────────────────
// { id, name, src, conc, tpl, follow, color, obscure, difficult, trigger: ['start','enter','end'], save, dmg, cond, who: 'all'|'enemies'|'allies' }
export function addZone(x, z) {
  const zone = { id: uid(8), hits: {}, ...z };
  x.zones = [...(x.zones || []), zone];
  return zone;
}
export function zoneTpl(x, z, ctx = {}) {
  if (!z.follow) return z.tpl;
  const f = x.combatants.find((o) => o.id === z.follow);
  const t = f && ctx.tokenOf?.(f);
  if (!t) return z.tpl;
  const c = tokenCenter(t);
  return { ...z.tpl, x: c.x, y: c.y, size: (z.tpl.baseSize ?? z.tpl.size) + (t.size || 1) / 2 - 0.5 };
}
export function tokenInZone(x, z, t, ctx) {
  const tpl = zoneTpl(x, z, ctx);
  const n = t.size || 1;
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) if (inArea(tpl, t.x + dx + 0.5, t.y + dy + 0.5)) return true;
  return false;
}
const sideOf = (c) => (c.isPC || c.ally ? 'pc' : 'npc');
function zoneApplies(x, z, c) {
  if (z.who === 'all' || !z.who) return true;
  const src = x.combatants.find((o) => o.id === z.src);
  if (!src) return true;
  return z.who === 'enemies' ? sideOf(src) !== sideOf(c) : sideOf(src) === sideOf(c);
}
// Wirkung einer Zone auf einen Kämpfer (Rettungswurf, Schaden, Zustand) – höchstens einmal pro Zug
export function zoneHit(x, z, c, why, ctx = {}) {
  if (isDead(c) || !zoneApplies(x, z, c)) return null;
  const key = `${x.round}:${x.turn}`;
  if (z.hits?.[c.id] === key) return null;
  z.hits = { ...(z.hits || {}), [c.id]: key };
  let ok = false;
  const lines = [];
  if (z.save) {
    const r = savingThrow(x, c, z.save.ab, z.save.dc, { spell: true }, ctx);
    ok = r.ok;
    lines.push(r.text);
  }
  if (z.dmg?.length && (!ok || z.save?.half)) {
    const parts = z.dmg.map((d) => {
      const r = roll(d.dice);
      return { amount: ok && z.save?.half ? Math.floor(r.total / 2) : r.total, type: d.type, text: r.text };
    });
    log(x, `🌀 ${z.name} (${why}): ${parts.map((p) => `${p.text} = ${p.amount} ${dmgName(p.type)}`).join(' + ')}`);
    applyDamage(x, c, parts, { magical: true, source: z.name }, ctx);
  }
  if (z.cond && !ok) addCondition(x, c, { name: z.cond, src: z.src, conc: z.conc || undefined, ...(z.condSave ? { save: z.condSave } : {}) }, ctx);
  if (z.heal && sideOf(c) === 'pc') applyHealing(x, c, roll(z.heal).total, { source: z.name });
  return { ok, lines };
}
function zoneTrigger(x, c, when, ctx) {
  const t = ctx.tokenOf?.(c);
  if (!t) return;
  for (const z of [...(x.zones || [])]) {
    if (!(z.trigger || []).includes(when)) continue;
    if (tokenInZone(x, z, t, ctx) || (z.adjacent && zoneAdjacent(x, z, t, ctx))) zoneHit(x, z, c, when === 'start' ? 'Zugbeginn' : 'Zugende', ctx);
  }
}
function zoneAdjacent(x, z, t, ctx) {
  const tpl = zoneTpl(x, z, ctx);
  const c = tokenCenter(t);
  return Math.max(Math.abs(c.x - tpl.x), Math.abs(c.y - tpl.y)) <= (tpl.size || 0.5) + (t.size || 1) / 2 + 1 + 1e-6;
}
// Beim Betreten (Bewegung): Zonen, die der Pfad neu berührt
export function zoneEnter(x, c, path, ctx = {}) {
  const t = ctx.tokenOf?.(c);
  if (!t || !path?.length) return;
  for (const z of [...(x.zones || [])]) {
    if (!(z.trigger || []).includes('enter')) continue;
    const startIn = tokenInZone(x, z, { ...t, x: path[0][0], y: path[0][1] }, ctx);
    const touched = path.slice(1).some(([px, py]) => tokenInZone(x, z, { ...t, x: px, y: py }, ctx));
    if (!startIn && touched) zoneHit(x, z, c, 'betreten', ctx);
  }
  // Dornenwachstum & Co.: Schaden je 1,5 m Bewegung in der Zone
  for (const z of x.zones || []) {
    if (!z.perCell) continue;
    const n = path.slice(1).filter(([px, py]) => tokenInZone(x, z, { ...t, x: px, y: py }, ctx)).length;
    if (!n) continue;
    const r = roll(`${n * (z.perCell.n || 2)}d${z.perCell.d || 4}`);
    log(x, `🌿 ${z.name}: ${n} Felder in der Zone → ${r.text} = ${r.total} ${dmgName(z.perCell.type)}`);
    applyDamage(x, c, [{ amount: r.total, type: z.perCell.type }], { magical: true, source: z.name }, ctx);
  }
}

// ───────────────────────── Züge ─────────────────────────
export function freshEco(c, ctx = {}) {
  const s = statsOf(c, ctx);
  const inc = incapacitated(c);
  const noBonus = inc;
  return {
    action: inc || hasEff(c, 'lethargic') ? 0 : 1, bonus: noBonus || hasEff(c, 'lethargic') ? 0 : 1, moveM: s.speedM, movedM: 0, dash: 0, disengage: false,
    attacks: 0, extra: hasEff(c, 'haste') && !inc ? 1 : 0, slotSpell: false, bonusSpell: false, actionSpell: false, free: 1, standUp: false, turn: c.turnNo || 0,
  };
}
export function beginTurn(x, c, ctx = {}) {
  c.turnNo = (c.turnNo || 0) + 1;
  expire(x, c, 'start');
  tickRounds(x, c);
  c.legendaryUsed = 0;
  // Aufladung (Odemwaffen u. Ä.): W6 zu Beginn des Zuges
  for (const [k, ready] of Object.entries(c.recharge || {})) {
    if (ready) continue;
    const need = Number(c.rechargeOn?.[k]) || 5;
    const d = rollDie(6);
    if (d >= need) c.recharge[k] = true;
    log(x, `🔄 ${c.name}: Aufladung ${k.split(':').pop()} – W6 = ${d} → ${d >= need ? 'wieder bereit' : 'noch nicht'}`);
  }
  for (const e of effs(c, 'regen')) if (!isDead(c) && c.hp > 0) applyHealing(x, c, 1, { source: e.name });
  for (const o of x.combatants) for (const e of effs(o, 'phantasm')) if (e.src === c.id && !isDead(o)) {
    const r = roll(e.data?.dice || '1d8');
    log(x, `👁 ${e.name}: ${r.text} = ${r.total} psychisch`);
    applyDamage(x, o, [{ amount: r.total, type: 'psychic' }], { magical: true, source: e.name }, ctx);
  }
  c.reaction = !hasEff(c, 'noReactions') && !hasEff(c, 'slow');
  c.eco = freshEco(c, ctx);
  if (hasEff(c, 'slow')) c.eco.slowed = true;
  for (const e of effs(c, 'heroism')) addTempHp(x, c, Number(e.data?.n) || 0, e.name);
  for (const e of effs(c, 'dotStart')) {
    const r = roll(e.data?.dice || '1d6');
    log(x, `🔥 ${e.name}: ${r.text} = ${r.total} ${dmgName(e.data?.type)}`);
    applyDamage(x, c, [{ amount: r.total, type: e.data?.type }], { magical: true, source: e.name }, ctx);
    if (e.data?.save) { const sv = savingThrow(x, c, e.data.save.ab, e.data.save.dc, { spell: true }, ctx); if (sv.ok) removeEffect(x, c, e.id, 'Rettungswurf geschafft'); }
  }
  if (c.isPC && atZero(c) && !isDead(c) && !c.stable) deathSave(x, c, ctx);
  zoneTrigger(x, c, 'start', ctx);
  if (has(c, XCOND.confused) && !incapacitated(c)) {
    const n = rollDie(10);
    const txt = n === 1 ? 'bewegt sich in eine zufällige Richtung, keine Aktion' : n <= 6 ? 'bewegt sich nicht und handelt nicht' : n <= 8 ? 'greift eine zufällige Kreatur in Reichweite an' : 'handelt normal';
    log(x, `🌀 ${c.name} ist verwirrt – W10 = ${n}: ${txt}`);
    if (n <= 6) { c.eco.action = 0; c.eco.bonus = 0; if (n > 1) c.eco.moveM = 0; }
    c.reaction = false;
  }
  // Kampfunfähig: keine Reaktion, solange der Zustand anhält – die Reaktion selbst bleibt für später erhalten
  // Todesrettungswurf, Zonen oder Schaden können den Kämpfer gerade ausgeschaltet haben
  if (isDead(c) || atZero(c)) { c.eco.action = 0; c.eco.bonus = 0; c.eco.moveM = 0; }
}
export function finishTurn(x, c, ctx = {}) {
  if (!c) return;
  for (const k of [...(c.conditions || [])]) {
    if (!k.save || (k.save.at || 'end') !== 'end' || isDead(c)) continue;
    const r = savingThrow(x, c, k.save.ab, k.save.dc, { spell: true }, ctx);
    if (r.ok) {
      c.conditions = c.conditions.filter((q) => q !== k);
      log(x, `${c.name}: „${k.name}“ endet (Rettungswurf geschafft)`);
      if (k.effId) removeEffect(x, c, k.effId);
    } else if (k.fails != null) {
      k.fails += 1;
      if (k.onFails && k.fails >= k.onFails.n) { addCondition(x, c, { name: k.onFails.name, src: k.src }, ctx); c.conditions = c.conditions.filter((q) => q !== k); }
    }
  }
  for (const e of [...(c.effects || [])]) {
    if (e.save && (e.save.at || 'end') === 'end' && !isDead(c)) {
      const r = savingThrow(x, c, e.save.ab, e.save.dc, { spell: true }, ctx);
      if (r.ok) removeEffect(x, c, e.id, 'Rettungswurf geschafft');
    }
    if (e.key === 'dotEnd') {
      const r = roll(e.data?.dice || '2d4');
      log(x, `🧪 ${e.name}: ${r.text} = ${r.total} ${dmgName(e.data?.type)}`);
      applyDamage(x, c, [{ amount: r.total, type: e.data?.type }], { magical: true, source: e.name }, ctx);
      removeEffect(x, c, e.id);
    }
    if (e.key === 'blink' && !incapacitated(c)) {
      const n = rollDie(20);
      if (n >= 11) {
        addCondition(x, c, { name: XCOND.ethereal, until: { cb: c.id, at: 'start', n: c.turnNo || 0 }, effId: e.id }, ctx);
        log(x, `✨ ${c.name} blinzelt in die Ätherebene (W20 = ${n})`);
      } else log(x, `✨ ${c.name} bleibt (Blinzeln W20 = ${n})`);
    }
  }
  zoneTrigger(x, c, 'end', ctx);
  expire(x, c, 'end');
  c.surprised = false;
}
function skipTurn(x, c, ctx) {
  if (isDead(c)) return true;
  if (!c.isPC && atZero(c)) return true;
  if (c.surprised && (x.round || 1) === 1 && (ctx.ed || '2014') === '2014') {
    log(x, `😵 ${c.name} ist überrascht und setzt in Runde 1 aus`);
    c.turnNo = (c.turnNo || 0) + 1;
    c.surprised = false;
    c.reaction = true;
    return true;
  }
  return false;
}
// Nächster Zug: Zugende auswerten, Runde weiterzählen, Besiegte überspringen, Zugbeginn auswerten
export function advance(x, ctx = {}) {
  const n = (x.combatants || []).length;
  if (!n) return x;
  x.log = x.log || [];
  const cur = x.combatants[x.turn];
  if (x.active && cur) finishTurn(x, cur, ctx);
  let t = x.turn;
  let guard = 0;
  do {
    t++;
    if (t >= n) {
      t = 0;
      x.round = (x.round || 1) + 1;
      log(x, `— Runde ${x.round} —`, 'round');
    }
    guard++;
  } while (guard < n * 2 && skipTurn(x, x.combatants[t], ctx));
  x.turn = t;
  const next = x.combatants[t];
  beginTurn(x, next, ctx);
  log(x, `▶ ${next.name} ist am Zug`, 'turn');
  return x;
}
// Kampfbeginn: Runde 1, Züge zurücksetzen, der erste handlungsfähige Kämpfer beginnt (Überraschte setzen 2014 aus)
export function beginCombat(x, ctx = {}) {
  const ed = ctx.ed || '2014';
  x.active = true;
  x.round = 1;
  x.log = x.log || [];
  for (const c of x.combatants) {
    c.turnNo = 0;
    c.eco = null;
    c.legResUsed = 0;
    c.reaction = !(c.surprised && ed === '2014');
  }
  log(x, '⚔️ Kampf beginnt – Runde 1', 'round');
  const n = x.combatants.length;
  let t = 0;
  let guard = 0;
  while (n && guard++ < n * 2 && skipTurn(x, x.combatants[t], ctx)) {
    t++;
    if (t >= n) {
      t = 0;
      x.round += 1;
      log(x, `— Runde ${x.round} —`, 'round');
    }
  }
  x.turn = n ? t : 0;
  const c = x.combatants[x.turn];
  if (c) {
    beginTurn(x, c, ctx);
    log(x, `▶ ${c.name} ist am Zug`, 'turn');
  }
  return x;
}
// Initiative: W20 + Geschicklichkeitsmodifikator (bei Charakteren inkl. Talente wie „Aufmerksam“)
export function rollInitiative(x, c, ctx = {}) {
  const s = statsOf(c, ctx);
  const bonus = c.isPC ? s.init ?? s.dex : s.dex;
  const dis = (ctx.ed || '2014') === '2024' && c.surprised;
  const adv = (ctx.ed || '2014') === '2024' && has(c, COND.invisible);
  const mode = adv && dis ? null : dis ? 'dis' : adv ? 'adv' : null;
  const r = rollD20(mode);
  c.init = r.natural + bonus;
  c.initBonus = bonus;
  log(x, `🎲 Initiative ${c.name}: W20 ${r.dice.length > 1 ? `${mode === 'adv' ? 'Vorteil' : 'Nachteil'} [${r.dice.join(', ')}]` : `[${r.natural}]`} ${fmtS(bonus)} = ${c.init}`);
  return c.init;
}
export function sortInitiative(list) {
  return [...list].sort((a, b) => (b.init ?? -99) - (a.init ?? -99) || (b.initBonus || 0) - (a.initBonus || 0) || (a.isPC === b.isPC ? 0 : a.isPC ? -1 : 1));
}

// ───────────────────────── Gelegenheitsangriffe ─────────────────────────
// Welche Gegner lässt der Pfad (Liste von [x, y]) aus ihrer Reichweite? → [{ cb, at: Index }]
export function opportunityTriggers(x, mover, path, ctx = {}) {
  if (!path || path.length < 2 || mover?.eco?.disengage || hasEff(mover, 'disengage')) return [];
  const tM = ctx.tokenOf?.(mover);
  if (!tM) return [];
  const out = [];
  for (const h of x.combatants) {
    if (h.id === mover.id || isDead(h) || atZero(h) || sideOf(h) === sideOf(mover) || !h.reaction || incapacitated(h)) continue;
    if (!canSee(h, mover, ctx)) continue;
    const tH = ctx.tokenOf?.(h);
    if (!tH) continue;
    const reachCells = Math.max(1, Math.round((ctx.reachOf?.(h) || 1.5) / CELL_M));
    for (let i = 0; i < path.length - 1; i++) {
      const a = { ...tM, x: path[i][0], y: path[i][1] };
      const b = { ...tM, x: path[i + 1][0], y: path[i + 1][1] };
      if (cellDistance(a, tH) <= reachCells && cellDistance(b, tH) > reachCells) { out.push({ cb: h, at: i }); break; }
    }
  }
  return out;
}
