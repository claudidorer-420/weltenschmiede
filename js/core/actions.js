// Aktionen im Kampf: was ein Kämpfer gerade tun kann (Waffen, Zauber, Klassenmerkmale, Gegenstände, Standardaktionen)
// und wie die SL-Seite eine Aktion auflöst – Angriffswurf → Reaktionen → Schadenswurf, Rettungswürfe, Zustände,
// Effekte, Zonen, Bewegung und Gelegenheitsangriffe. Gewürfelt wird beim Handelnden, entschieden bei der SL.
import { app, col, myUid, bridge } from './app.js';
import { db } from './db.js';
import { roll, rollDie, rollDetailed } from '../lib/dice.js';
import { now, uid } from '../lib/util.js';
import { charMods, findWeapon, weaponAttack, spellSlots, resourcesFor, classLevel } from '../data/chargen.js';
import { WEAPON_RANGE, weaponReach } from '../data/items.js';
import { loadSpells, damageAt, healAt, healHasMod, fmtDice, levelName, schoolName, rangeShort } from '../data/spells.js';
import { specFor } from '../data/spellfx.js';
import { DAMAGE_ART } from '../data/artmap.js';
import { normalizeMonster } from '../ui/statblock.js';
import { creatureType, monsterIconName } from '../ui/art.js';
import { parseAttacks, lineOfSight, coverBetween, cellDistance, tokenCenter, tokensInArea, templateFor, areaReaches, pointInSight, inArea, sizeCells, CELL_M } from './tactics.js';
import * as E from './engine.js';
import { loadCombat, mutateCombat, setTurnEngine, resort, combatantsFromMonsters } from './combat.js';
import { askPrompt } from './react.js';
import { loadParty } from './party.js';

const DMG_KEY = { Wucht: 'bludgeoning', Stich: 'piercing', Hieb: 'slashing' };
const fmtS = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const dmgName = (t) => DAMAGE_ART[t]?.name || t || '';
export const GI = {
  dash: 'sprint', disengage: 'exit-door', dodge: 'dodging', help: 'hand', hide: 'cloak-dagger', stand: 'body-balance', shove: 'push',
  rage: 'enrage', reckless: 'sword-wound', secondwind: 'healing', surge: 'sands-of-time', cunning: 'hood', flurry: 'punch-blast', patient: 'meditation',
  step: 'wind-slap', layonhands: 'hand-bandage', turn: 'holy-symbol', bardic: 'lyre', breath: 'dragon-breath', unarmed: 'fist', potion: 'health-potion',
  melee: 'crossed-swords', ranged: 'bow-arrow', area: 'fire-breath', magic: 'magic-swirl',
};
export const COST = { action: 'Aktion', bonus: 'Bonusaktion', reaction: 'Reaktion', free: 'frei', attack: 'Angriff', move: 'Bewegung', long: 'länger' };
const side = (c) => (c?.isPC || c?.ally ? 'pc' : 'npc');
export const cbOf = (x, id) => (x?.combatants || x?.list || []).find((c) => c.id === id) || null;
export const edNow = () => (app.get().campaign?.settings?.rulesVersion === '2024' ? '2024' : '2014');

// ───────────────────────── Kontext (Karte, Tokens, Charakterbögen) ─────────────────────────
export const battle = { tokens: [], grid: null, party: [], mapId: null };
export function setBattleContext(p) { Object.assign(battle, p); }
export function makeCtx(x, extra = {}) {
  const ed = edNow();
  const tokens = extra.tokens || battle.tokens || [];
  const list = x?.combatants || x?.list || [];
  let grid = extra.grid !== undefined ? extra.grid : battle.grid;
  // Wände aus Zaubern (Steinwand, Kraftwand, Feuerwand …) blockieren Sichtlinie und Flächen wie echte Wände
  const walls = (x?.zones || []).filter((z) => (z.barrier || z.opaque) && z.tpl);
  if (grid && walls.length) {
    const opaque = Uint8Array.from(grid.opaque || new Uint8Array(grid.w * grid.h));
    for (const z of walls) for (let y = 0; y < grid.h; y++) for (let xx = 0; xx < grid.w; xx++) if (inArea(z.tpl, xx + 0.5, y + 0.5)) opaque[y * grid.w + xx] = 1;
    grid = { ...grid, opaque };
  }
  const party = extra.party || battle.party || [];
  // override: { kämpferId: { x, y } } – z. B. Position beim Verlassen der Reichweite (Gelegenheitsangriff)
  const override = extra.override || null;
  const tokenOf = (cb) => {
    if (!cb) return null;
    const t = tokens.find((q) => (q.combatantId && q.combatantId === cb.id) || (cb.charId && q.charId === cb.charId) || (cb.tokenId && q.id === cb.tokenId)) || null;
    return t && override?.[cb.id] ? { ...t, ...override[cb.id] } : t;
  };
  const charOf = (cb) => (cb?.charId ? party.find((p) => p.char?.id === cb.charId)?.char || null : null);
  const ctx = { ed, tokens, tokenOf, charOf, grid, list };
  const blocks = new Set();
  if (grid) {
    for (const z of x?.zones || []) {
      if (!z.obscure) continue;
      const tpl = E.zoneTpl(x, z, ctx);
      for (let y = 0; y < grid.h; y++) for (let xx = 0; xx < grid.w; xx++) if (inArea(tpl, xx + 0.5, y + 0.5)) blocks.add(y * grid.w + xx);
    }
  }
  const inBlock = (t) => {
    if (!t || !blocks.size) return false;
    const n = t.size || 1;
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) if (blocks.has((t.y + dy) * grid.w + t.x + dx)) return true;
    return false;
  };
  const alive = tokens.filter((t) => { const c = list.find((o) => tokenOf(o)?.id === t.id); return !c || !E.isOut(c); });
  const near = (a, b) => !!a && !!b && cellDistance(a, b) <= 1;
  Object.assign(ctx, {
    blocks,
    los: (a, b) => lineOfSight(grid, a, b),
    obscured: (a, b) => { const ta = tokenOf(a); const tb = tokenOf(b); if (!ta || !tb || !blocks.size) return false; return inBlock(ta) || inBlock(tb) || !lineOfSight(grid, ta, tb, { blocks }); },
    cover: (ta, tb) => coverBetween(grid, ta, tb, alive),
    hostileNear: (c) => { const t = tokenOf(c); return list.some((o) => o.id !== c.id && side(o) !== side(c) && !E.isOut(o) && !E.atZero(o) && !E.incapacitated(o) && near(tokenOf(o), t)); },
    allyNear: (att, tgt) => { const t = tokenOf(tgt); return list.some((o) => o.id !== att.id && o.id !== tgt.id && side(o) === side(att) && !E.isOut(o) && !E.atZero(o) && !E.incapacitated(o) && near(tokenOf(o), t)); },
    reachOf: (c) => reachOf(c, ctx),
  });
  return ctx;
}
function reachOf(c, ctx) {
  const char = ctx.charOf(c);
  if (char) return Math.max(1.5, ...(char.weapons || []).map(findWeapon).filter((w) => w && !/a/.test(w.p)).map(weaponReach));
  if (c.statblock) return Math.max(1.5, ...parseAttacks(normalizeMonster(c.statblock)).filter((a) => a.kind === 'melee').map((a) => a.reach || 1.5));
  return 1.5;
}

// ───────────────────────── Hilfen ─────────────────────────
export function parseDmg(s, mod = 0) {
  let t = String(s || '').replace(/\s+/g, '').replace(/[Ww](?=\d)/g, 'd').replace(/−/g, '-');
  let flat = 0;
  if (/MOD/i.test(t)) { t = t.replace(/[+-]?MOD/i, ''); flat += mod; }
  const m = /^(\d*d\d+)?([+-]\d+)?$/.exec(t);
  if (!m) return { dice: t, flat };
  return { dice: m[1] || '', flat: flat + Number(m[2] || 0) };
}
const partText = (p) => `${p.dice ? fmtDice(p.dice) : ''}${p.flat ? (p.dice ? fmtS(p.flat) : String(p.flat)) : ''}${p.type ? ` ${dmgName(p.type)}` : ''}`;
export const partsText = (parts) => (parts || []).map(partText).join(' + ');
function addDice(dice, extra, times = 1) {
  if (!times || !extra) return dice;
  const a = /^(\d+)d(\d+)$/.exec(dice || '');
  const b = /^(\d+)d(\d+)$/.exec(extra);
  if (a && b && a[2] === b[2]) return `${Number(a[1]) + Number(b[1]) * times}d${a[2]}`;
  return [dice, ...Array(times).fill(extra)].filter(Boolean).join('+');
}
function attacksPerAction(char) {
  let n = 1;
  for (const x of char.classes || []) {
    if (x.cls === 'kaempfer') n = Math.max(n, x.level >= 20 ? 4 : x.level >= 11 ? 3 : x.level >= 5 ? 2 : 1);
    else if (['barbar', 'moench', 'paladin', 'waldlaeufer'].includes(x.cls) && x.level >= 5) n = Math.max(n, 2);
  }
  return n;
}
const castableEntry = (e) => e.level === 0 || e.always || e.arcanum || e.source || e.prepared || !e.book;
export function slotInfo(char) {
  const s = spellSlots(char);
  const used = char.spell?.used || {};
  const levels = {};
  for (const [g, n] of Object.entries(s.slots || {})) levels[g] = { max: n, left: Math.max(0, n - (Number(used[g]) || 0)) };
  const pact = s.pact ? { level: s.pact.level, max: s.pact.count, left: Math.max(0, s.pact.count - (Number(char.spell?.pactUsed) || 0)) } : null;
  return { levels, pact };
}
export function slotOptions(char, level) {
  if (!char) return [];
  const si = slotInfo(char);
  const out = Object.entries(si.levels).filter(([g, v]) => Number(g) >= level && v.left > 0).map(([g, v]) => ({ level: Number(g), left: v.left }));
  if (si.pact && si.pact.level >= level && si.pact.left > 0) out.push({ level: si.pact.level, pact: true, left: si.pact.left });
  return out.sort((a, b) => a.level - b.level);
}
export function monsterSlotOptions(c, a) {
  if (a.level === 0 || a.perDay) return [{ level: a.level }];
  const out = [];
  for (const g of a.casting?.groups || []) {
    if (!g.level || g.level < a.level || !g.slots) continue;
    const left = g.slots - (Number(c.mSlots?.[g.level]) || 0);
    if (left > 0) out.push({ level: g.level, left });
  }
  return out;
}
const SPELLS = {};
export async function spellsFor(ed) {
  if (!SPELLS[ed]) SPELLS[ed] = await loadSpells(ed);
  return SPELLS[ed];
}
export const spellsCached = (ed) => SPELLS[ed] || null;

// ───────────────────────── Katalog ─────────────────────────
function weaponAction(char, cm, w, c, ctx, opts = {}) {
  const a = weaponAttack(char, w, cm.mods, cm.pb);
  const ranged = /a/i.test(w.p);
  const thrown = /t/.test(w.p);
  const mw = E.effs(c, 'magicWeapon')[0];
  const plus = mw ? Number(mw.data?.bonus) || 1 : 0;
  let dice = opts.versatile && w.vers ? w.vers : w.dmg;
  let abil = a.ability;
  let bonus = a.bonus + plus;
  let flat = parseDmg(a.damage).flat;
  const shil = !!E.effs(c, 'shillelagh').length && ['knueppel', 'kampfstab'].includes(w.key);
  if (shil) {
    abil = cm.spell[0]?.ability || 'wis';
    bonus = cm.pb + cm.mods[abil] + plus;
    flat = cm.mods[abil];
    dice = ctx.ed === '2024' ? (cm.level >= 17 ? '2d6' : cm.level >= 11 ? '1d12' : cm.level >= 5 ? '1d10' : '1d8') : '1d8';
  }
  if (opts.offhand && !(char.feats || []).some((f) => f.key === 'style-twf')) flat = Math.min(0, flat);
  flat += plus;
  const type = DMG_KEY[w.type] || 'bludgeoning';
  const range = ranged || thrown ? WEAPON_RANGE[w.key] || null : null;
  return {
    key: `${opts.offhand ? 'off' : 'w'}:${w.key}`, group: 'attack', kind: 'attack', name: opts.offhand ? `${w.name} (Zweitwaffe)` : w.name,
    art: { item: { name: w.name, ref: `w:${w.key}` } }, cost: opts.offhand ? 'bonus' : 'attack', hasteOk: true, offhand: !!opts.offhand,
    attack: { kind: ranged ? 'ranged' : 'melee', bonus, reach: ranged ? 1.5 : weaponReach(w), range, thrown, damage: [{ dice, flat, type }], magical: !!mw || shil, weapon: true, ability: abil, finesse: /f/.test(w.p) || ranged, strBased: abil === 'str' && !ranged },
    needs: { target: 'enemy', n: 1, sight: true },
    desc: [a.props, opts.versatile && w.vers ? 'zweihändig geführt' : '', shil ? 'Shillelagh' : '', mw ? mw.name : ''].filter(Boolean).join(' · '),
  };
}
function unarmedAction(char, cm, c, ctx) {
  const monk = classLevel(char, 'moench');
  const abil = monk && cm.mods.dex > cm.mods.str ? 'dex' : 'str';
  const die = monk ? (ctx.ed === '2024' ? (monk >= 17 ? '1d12' : monk >= 11 ? '1d10' : monk >= 5 ? '1d8' : '1d6') : monk >= 17 ? '1d10' : monk >= 11 ? '1d8' : monk >= 5 ? '1d6' : '1d4') : '';
  return {
    key: 'unarmed', group: 'attack', kind: 'attack', name: 'Waffenloser Schlag', art: { gi: GI.unarmed }, cost: 'attack', hasteOk: true,
    attack: { kind: 'melee', bonus: cm.mods[abil] + cm.pb, reach: 1.5, damage: [{ dice: die, flat: monk ? cm.mods[abil] : Math.max(1, 1 + cm.mods.str), type: 'bludgeoning' }], weapon: true, ability: abil, strBased: abil === 'str' },
    needs: { target: 'enemy', n: 1, sight: true }, desc: monk ? `Kampfkunst (${die})` : 'Faust, Tritt, Kopfstoß',
  };
}
// Zielsicherer Schlag (2024): Waffenangriff mit dem Zauberattribut, ab Stufe 5 zusätzlicher gleißender Schaden
function trueStrikeAction(char, cm, w, c, ctx, sp, st) {
  const base = weaponAction(char, cm, w, c, ctx, {});
  const mod = cm.mods[st.ability] || 0;
  const mw = E.effs(c, 'magicWeapon')[0];
  const plus = mw ? Number(mw.data?.bonus) || 1 : 0;
  const extra = cm.level >= 17 ? '3d6' : cm.level >= 11 ? '2d6' : cm.level >= 5 ? '1d6' : '';
  const d0 = base.attack.damage[0];
  return {
    ...base, key: `ts:${w.key}`, group: 'spell', kind: 'attack', name: `${sp.name}: ${w.name}`, art: { spell: sp }, cost: 'action', hasteOk: false, level: 0, sp, isSpell: true,
    attack: { ...base.attack, bonus: st.attack + plus, damage: [{ dice: d0.dice, flat: mod + plus, type: d0.type }, ...(extra ? [{ dice: extra, flat: 0, type: 'radiant' }] : [])], ability: st.ability, strBased: false, magical: true },
    desc: 'Zaubertrick (Aktion): Waffenangriff mit deinem Zauberattribut.',
  };
}
function needsOf(spec, sp) {
  const range = spec.range ?? 0;
  if (spec.use === 'move') return { target: 'cell', range: spec.tele, sight: true };
  if (spec.use === 'summon' && spec.summon) return { target: 'cell', range: range >= 900 ? 999 : range || 18, sight: true, summon: true };
  if (spec.use === 'zone' && spec.zone?.line) return { target: 'wall', len: spec.zone.len || 18, range: range >= 900 ? 999 : range || 36, sight: true };
  if (spec.t === 'self') return { target: 'self' };
  if (spec.t === 'point' || spec.use === 'zone' || (spec.area && (spec.use === 'save' || spec.use === 'special') && spec.t !== 'multi' && spec.t !== 'enemy')) return { target: 'point', area: spec.area || { shape: 'sphere', size: 1.5 }, range, rangeKind: sp.rangeKind, sight: spec.sight };
  const n = spec.t === 'multi' ? spec.n || 1 : 1;
  return { target: spec.t === 'multi' ? (spec.ally ? 'ally' : 'creature') : spec.t, n, up: spec.up || 0, range: range || 1.5, sight: spec.sight, same: spec.use === 'auto' || !!spec.rays, near: spec.near };
}
function spellAction(sp, spec, cast, c) {
  const cost = spec.use === 'reaction' || sp.action === 'reaction' ? 'reaction' : sp.action === 'bonus' ? 'bonus' : sp.action === 'action' ? 'action' : 'long';
  const attack = spec.attack && (spec.use === 'attack' || spec.use === 'summonAttack' || spec.special === 'iceKnife' || spec.special === 'acidArrow')
    ? { kind: spec.attack === 'melee' ? 'spellMelee' : 'spellRanged', bonus: cast.attack, reach: spec.attack === 'melee' ? Math.max(1.5, spec.range || 1.5) : 1.5, range: spec.attack === 'melee' ? null : [spec.range || 1.5, spec.range || 1.5], damage: [], magical: true, ignoreCover: !!spec.ignoreCover }
    : null;
  return {
    key: `${cast.monster ? 'ms' : 'sp'}:${sp.id}`, group: 'spell', kind: 'spell', name: sp.name, art: { spell: sp }, cost, level: sp.level, conc: !!sp.conc, ritual: !!sp.ritual,
    sp, spec, dc: cast.dc, spellAttack: cast.attack, castMod: cast.mod || 0, castLevel: cast.level || 1, arcanum: !!cast.arcanum, monster: !!cast.monster, casting: cast.casting || null,
    perDay: cast.perDay || null, attack, needs: needsOf(spec, sp), combat: spec.combat && cost !== 'long',
  };
}
const FEATURES = [
  { cls: 'barbar', lvl: 1, key: 'f:rage', name: 'Kampfrausch', gi: GI.rage, cost: 'bonus', res: 'rage', desc: 'Resistenz gegen Wucht, Stich und Hieb, Schadensbonus auf Stärke-Nahkampfangriffe, Vorteil auf Stärke-Rettungswürfe. Kein Zaubern. 1 Minute.' },
  { cls: 'barbar', lvl: 2, key: 'f:reckless', name: 'Tollkühner Angriff', gi: GI.reckless, cost: 'free', desc: 'Vorteil auf Stärke-Nahkampfangriffe in diesem Zug – Angriffe gegen dich haben bis zu deinem nächsten Zug ebenfalls Vorteil.' },
  { cls: 'kaempfer', lvl: 1, key: 'f:secondwind', name: 'Zweiter Wind', gi: GI.secondwind, cost: 'bonus', res: 'secondwind', desc: 'Du erhältst 1W10 + Kämpferstufe TP zurück.' },
  { cls: 'kaempfer', lvl: 2, key: 'f:surge', name: 'Tatendrang', gi: GI.surge, cost: 'free', res: 'surge', desc: 'Eine zusätzliche Aktion in diesem Zug.' },
  { cls: 'schurke', lvl: 2, key: 'f:cdash', name: 'Raffinierte Aktion: Spurt', gi: GI.dash, cost: 'bonus', desc: 'Spurt als Bonusaktion.' },
  { cls: 'schurke', lvl: 2, key: 'f:cdis', name: 'Raffinierte Aktion: Rückzug', gi: GI.disengage, cost: 'bonus', desc: 'Rückzug als Bonusaktion.' },
  { cls: 'schurke', lvl: 2, key: 'f:chide', name: 'Raffinierte Aktion: Verstecken', gi: GI.hide, cost: 'bonus', desc: 'Verstecken als Bonusaktion.' },
  { cls: 'moench', lvl: 2, key: 'f:flurry', name: 'Schlaghagel', gi: GI.flurry, cost: 'bonus', res: 'ki', desc: 'Zwei waffenlose Schläge als Bonusaktion (1 Ki/Fokus).' },
  { cls: 'moench', lvl: 2, key: 'f:patient', name: 'Geduldige Verteidigung', gi: GI.patient, cost: 'bonus', res: 'ki', desc: 'Ausweichen als Bonusaktion (1 Ki/Fokus).' },
  { cls: 'moench', lvl: 2, key: 'f:step', name: 'Schritt des Windes', gi: GI.step, cost: 'bonus', res: 'ki', desc: 'Spurt oder Rückzug als Bonusaktion (1 Ki/Fokus).' },
  { cls: 'moench', lvl: 1, key: 'f:martial', name: 'Kampfkunst: Bonusschlag', gi: GI.unarmed, cost: 'bonus', desc: 'Nach der Angriffsaktion ein waffenloser Schlag als Bonusaktion.' },
  { cls: 'paladin', lvl: 1, key: 'f:layonhands', name: 'Handauflegen', gi: GI.layonhands, cost: 'action', res: 'layonhands', pool: true, desc: 'Heile eine berührte Kreatur aus deinem TP-Vorrat.', needs: { target: 'ally', n: 1, range: 1.5 } },
  { cls: 'kleriker', lvl: 2, key: 'f:turn', name: 'Untote vertreiben', gi: GI.turn, cost: 'action', res: 'channel', desc: 'Untote in 9 m: WEI-Rettungswurf oder 1 Minute vertrieben (verängstigt, fliehen).' },
  { cls: 'barde', lvl: 1, key: 'f:bardic', name: 'Bardische Inspiration', gi: GI.bardic, cost: 'bonus', res: 'bardic', desc: 'Ein Verbündeter in 18 m erhält einen Inspirationswürfel für seinen nächsten Angriff oder Rettungswurf.', needs: { target: 'ally', n: 1, range: 18 } },
  { cls: 'druide', lvl: 2, key: 'f:wildshape', name: 'Tiergestalt', gi: 'wolf-head', cost: 'action', res: 'wildshape', desc: 'Nimm die Gestalt eines Tieres an, das du schon gesehen hast (HG-Grenze nach Druidenstufe). 2014: TP des Tieres; 2024: eigene TP plus temporäre TP in Höhe deiner Druidenstufe.' },
];
function pcCatalog(x, c, char, ctx, spells) {
  const ed = ctx.ed;
  const cm = charMods(char);
  const out = [];
  const weapons = (char.weapons || []).map(findWeapon).filter(Boolean);
  for (const w of weapons) out.push(weaponAction(char, cm, w, c, ctx, { versatile: !char.armor?.shield && weapons.length === 1 }));
  out.push(unarmedAction(char, cm, c, ctx));
  const lights = weapons.filter((w) => /l/.test(w.p) && !/a/.test(w.p));
  if (lights.length >= 2) out.push(weaponAction(char, cm, lights[1], c, ctx, { offhand: true }));
  const slots = slotInfo(char);
  if (spells) {
    const seen = new Set();
    for (const e of char.spell?.list || []) {
      if (!castableEntry(e)) continue;
      const sp = spells.find((s) => s.id === e.ref) || spells.find((s) => s.name.toLowerCase() === String(e.name || '').toLowerCase());
      if (!sp || seen.has(sp.id)) continue;
      seen.add(sp.id);
      const st = cm.spell.find((s) => s.cls === e.cls) || cm.spell[0] || { dc: 8 + cm.pb, attack: cm.pb, ability: 'int' };
      if (sp.en === 'True Strike' && ed === '2024') { for (const w of weapons) out.push(trueStrikeAction(char, cm, w, c, ctx, sp, st)); continue; }
      out.push({ ...spellAction(sp, specFor(sp, ed), { dc: st.dc, attack: st.attack, mod: cm.mods[st.ability] || 0, level: cm.level, arcanum: e.arcanum }, c), slots });
    }
  }
  const res = Object.fromEntries(resourcesFor(char).map((r) => [r.key, { ...r, left: r.max >= 99 ? 99 : Math.max(0, r.max - (Number(char.resUsed?.[r.key]) || 0)) }]));
  for (const f of FEATURES) {
    if (classLevel(char, f.cls) < f.lvl) continue;
    out.push({ ...f, ...(f.key === 'f:wildshape' && ed === '2024' ? { cost: 'bonus' } : {}), group: 'class', kind: 'feature', art: { gi: f.gi }, needs: f.needs || { target: 'none' }, uses: f.res ? res[f.res] || { left: 0, max: 0 } : null });
  }
  if (res.breath) out.push({ key: 'f:breath', group: 'class', kind: 'feature', name: 'Odemwaffe', art: { gi: GI.breath }, cost: 'action', uses: res.breath, needs: { target: 'point', area: { shape: 'cone', size: 4.5 }, range: 0, rangeKind: 'self' }, desc: 'Kegel von 4,5 m – GES-Rettungswurf, halber Schaden bei Erfolg.' });
  const POT = [[/überragend|superior/i, '8d4+8'], [/vorzüglich|supreme/i, '10d4+20'], [/groß|greater/i, '4d4+4'], [/heiltrank|healing/i, '2d4+2']];
  for (const it of char.inventory || []) {
    const m = POT.find(([re]) => re.test(it.name || ''));
    if (!m || !(Number(it.qty) > 0)) continue;
    out.push({ key: `it:${it.id}`, group: 'item', kind: 'item', name: it.name, art: { item: it }, cost: ed === '2024' ? 'bonus' : 'action', heal: m[1], uses: { left: Number(it.qty), max: Number(it.qty) }, needs: { target: 'ally', n: 1, range: 1.5, selfOk: true }, desc: `Heilt ${fmtDice(m[1])} TP.`, itemId: it.id });
  }
  return out;
}
const RECH = /\(Aufladung\s*(\d)(?:[–-]\d)?\)|\(Recharge\s*(\d)/i;
function monsterCatalog(x, c, ctx, spells14) {
  const m = normalizeMonster(c.statblock);
  const s = E.statsOf(c, ctx);
  const out = [];
  parseAttacks(m).forEach((a, i) => {
    const rech = RECH.exec(a.name);
    const key = `m:${i}`;
    const dmg = (a.damage || []).map((d) => ({ ...parseDmg(d.dice), type: d.type }));
    const base = { key, group: 'monster', name: a.name.replace(RECH, '').trim(), desc: a.text, recharge: rech ? c.recharge?.[key] !== false : undefined, rechargeOn: rech ? Number(rech[1] || rech[2]) : undefined };
    if (a.kind === 'melee' || a.kind === 'ranged') {
      out.push({ ...base, kind: 'attack', art: { gi: a.kind === 'ranged' ? GI.ranged : GI.melee }, cost: 'attack', hasteOk: true, needs: { target: 'enemy', n: 1, sight: true },
        attack: { kind: a.kind, bonus: a.bonus, reach: a.reach || 1.5, range: a.range, thrown: a.kind === 'melee' && !!a.range, damage: dmg, magical: /magisch|magical/i.test(a.text), weapon: true } });
    } else {
      out.push({ ...base, kind: 'ability', art: { gi: GI.area }, cost: 'action', save: a.save, dc: a.dc, half: a.half, damage: dmg, area: a.area,
        needs: a.area ? { target: 'point', area: a.area, range: 0, rangeKind: 'self' } : { target: 'enemy', n: 1, range: a.range?.[1] || a.reach || 1.5, sight: true } });
    }
  });
  if (spells14) {
    for (const cast of s.casting || []) {
      for (const g of cast.groups || []) {
        for (const name of g.names || []) {
          const sp = spells14.find((y) => y.name.toLowerCase() === String(name).toLowerCase());
          if (!sp || out.some((o) => o.key === `ms:${sp.id}`)) continue;
          const perDay = g.per && /(\d)\s*\/\s*Tag/i.test(g.per) ? Number(/(\d)\s*\/\s*Tag/i.exec(g.per)[1]) : null;
          const a = spellAction(sp, specFor(sp, ctx.ed), { dc: cast.dc || 8 + s.pb + (s.mods[cast.ability] || 0), attack: cast.attack ?? s.pb + (s.mods[cast.ability] || 0), mod: s.mods[cast.ability] || 0, level: 5, monster: true, casting: cast, perDay }, c);
          if (perDay) a.uses = { left: Math.max(0, perDay - (Number(c.perDay?.[sp.id]) || 0)), max: perDay };
          out.push(a);
        }
      }
    }
  }
  const tr = (m.traits || []).map((t) => `${t.name} ${t.desc}`).join(' ');
  if (/Rückzug[^.]*Bonusaktion|Bonusaktion[^.]*Rückzug/i.test(tr)) out.push({ key: 'b:disengage', group: 'monster', kind: 'std', std: 'disengage', name: 'Rückzug (Bonusaktion)', art: { gi: GI.disengage }, cost: 'bonus', needs: { target: 'none' } });
  if (/Verstecken[^.]*Bonusaktion|Bonusaktion[^.]*Verstecken/i.test(tr)) out.push({ key: 'b:hide', group: 'monster', kind: 'std', std: 'hide', name: 'Verstecken (Bonusaktion)', art: { gi: GI.hide }, cost: 'bonus', needs: { target: 'none' } });
  if (/Spurt[^.]*Bonusaktion|Bonusaktion[^.]*Spurt/i.test(tr)) out.push({ key: 'b:dash', group: 'monster', kind: 'std', std: 'dash', name: 'Spurt (Bonusaktion)', art: { gi: GI.dash }, cost: 'bonus', needs: { target: 'none' } });
  return out;
}
function stdActions(c, ctx) {
  const ed = ctx.ed;
  const list = [
    { key: 'std:dash', std: 'dash', name: 'Spurt', gi: GI.dash, cost: 'action', hasteOk: true, desc: 'Zusätzliche Bewegung in Höhe deiner Bewegungsrate.' },
    { key: 'std:disengage', std: 'disengage', name: 'Rückzug', gi: GI.disengage, cost: 'action', hasteOk: true, desc: 'Deine Bewegung provoziert in diesem Zug keine Gelegenheitsangriffe.' },
    { key: 'std:dodge', std: 'dodge', name: 'Ausweichen', gi: GI.dodge, cost: 'action', desc: 'Bis zu deinem nächsten Zug: Angriffe gegen dich im Nachteil (solange du den Angreifer siehst), GES-Rettungswürfe im Vorteil.' },
    { key: 'std:help', std: 'help', name: 'Helfen', gi: GI.help, cost: 'action', desc: 'Ein Verbündeter in 1,5 m hat Vorteil auf seinen nächsten Angriff (bis zu deinem nächsten Zug).', needs: { target: 'ally', n: 1, range: 1.5 } },
    { key: 'std:hide', std: 'hide', name: 'Verstecken', gi: GI.hide, cost: 'action', hasteOk: true, desc: ed === '2024' ? 'GES (Heimlichkeit) gegen SG 15 – bei Erfolg unsichtbar, bis du angreifst, zauberst oder entdeckt wirst.' : 'GES (Heimlichkeit) gegen die passive Wahrnehmung der Gegner – bei Erfolg versteckt.' },
    { key: 'std:shove', std: 'shove', name: 'Stoßen', gi: GI.shove, cost: 'attack', desc: ed === '2024' ? 'Statt eines Angriffs: STÄ- oder GES-Rettungswurf des Ziels (SG 8 + STÄ + ÜB) – sonst 1,5 m weg oder liegend.' : 'Statt eines Angriffs: Athletik gegen Athletik/Akrobatik – bei Erfolg 1,5 m weg oder liegend.', needs: { target: 'enemy', n: 1, range: 1.5 } },
  ];
  if (E.has(c, E.COND.prone)) list.unshift({ key: 'std:stand', std: 'stand', name: 'Aufstehen', gi: GI.stand, cost: 'move', desc: 'Kostet die Hälfte deiner Bewegung.' });
  return list.map((a) => ({ group: 'common', kind: 'std', needs: a.needs || { target: 'none' }, art: { gi: a.gi }, ...a }));
}
function grantedActions(x, c) {
  return (c.effects || []).filter((e) => e.key === 'grant' && e.data?.action).map((e) => ({
    key: `g:${e.id}`, group: 'granted', kind: 'granted', name: e.data.action.name, art: e.data.art || { gi: GI.magic }, cost: e.data.action.cost || 'action', grant: e.data.action, effId: e.id,
    dc: e.data.dc, spellAttack: e.data.attack, castMod: e.data.mod || 0, slot: e.data.slot, level: 0,
    attack: e.data.action.attack ? { kind: 'spellMelee', bonus: e.data.attack, reach: 1.5 + (e.data.action.fromZone || 0), range: null, damage: [{ ...parseDmg(e.data.action.dice), flat: e.data.action.mod ? e.data.mod || 0 : 0, type: e.data.action.type }], magical: true } : null,
    needs: e.data.action.area ? { target: 'point', area: e.data.action.area, range: e.data.action.range || 0, rangeKind: e.data.action.range ? 'dist' : 'self' } : e.data.action.moveZone && !e.data.action.attack ? { target: 'cell', range: e.data.action.moveZone, fromZone: e.data.zoneId } : { target: 'enemy', n: 1, range: e.data.action.range || 1.5 + (e.data.action.fromZone || 0), fromZone: e.data.action.fromZone ? e.data.zoneId : null },
    desc: e.name,
  }));
}
// Alle Aktionen eines Kämpfers mit Verfügbarkeit
function buildCatalog(x, c, ctx, pcSpells, monSpells) {
  // Verwandelt: nur die Angriffe der neuen Gestalt, keine Zauber
  const form = c.form?.statblock || null;
  const char = c.isPC && !form ? ctx.charOf(c) : null;
  let out = [];
  if (char) out = pcCatalog(x, c, char, ctx, pcSpells);
  else if (form) out = monsterCatalog(x, { ...c, statblock: form }, ctx, null);
  else if (c.statblock) out = monsterCatalog(x, c, ctx, monSpells);
  if (c.form?.src === 'wildshape') out.push({ key: 'f:unshape', group: 'class', kind: 'feature', name: 'Tiergestalt verlassen', art: { gi: 'wolf-head' }, cost: 'bonus', needs: { target: 'none' }, desc: 'Du nimmst wieder deine eigene Gestalt an.' });
  out.push(...grantedActions(x, c), ...stdActions(c, ctx));
  return out.map((a) => ({ ...a, state: availability(x, c, a, ctx, char) }));
}
export async function catalog(x, c, ctx) {
  return buildCatalog(x, c, ctx, await spellsFor(ctx.ed), await spellsFor('2014'));
}
export function catalogSync(x, c, ctx) {
  if (!spellsCached(ctx.ed)) spellsFor(ctx.ed);
  if (!spellsCached('2014')) spellsFor('2014');
  return buildCatalog(x, c, ctx, spellsCached(ctx.ed), spellsCached('2014'));
}
const isCurrent = (x, c) => {
  const cur = x?.combatants ? x.combatants[x.turn] : null;
  return cur ? cur.id === c.id : x?.currentId === c.id;
};
export function availability(x, c, a, ctx, char) {
  if (!x?.active) {
    // Beschwörungen (oft 1 Minute Wirkzeit) lassen sich vor Kampfbeginn wirken
    if (a.kind === 'spell' && a.spec?.summon && !E.isOut(c)) {
      const opts = a.level > 0 && !a.arcanum ? (a.monster ? monsterSlotOptions(c, a) : slotOptions(char, a.level)) : [{}];
      if (!opts.length) return { ok: false, why: 'Kein passender Zauberplatz frei', slot: true };
      return { ok: true, prep: true };
    }
    return { ok: false, why: 'Kein Kampf – starte zuerst den Kampf' };
  }
  if (a.cost === 'reaction') return { ok: false, why: 'Reaktion – wird dir angeboten, wenn sie passt', reaction: true };
  if (!isCurrent(x, c)) return { ok: false, why: 'Nicht am Zug' };
  if (E.isDead(c) || E.atZero(c)) return { ok: false, why: 'Bei 0 TP' };
  if (E.incapacitated(c)) return { ok: false, why: 'Kampfunfähig' };
  const eco = c.eco || {};
  if (a.cost === 'action' && !(eco.action > 0 || (a.hasteOk && eco.extra > 0))) return { ok: false, why: 'Aktion schon verbraucht' };
  if (a.cost === 'bonus' && !(eco.bonus > 0)) return { ok: false, why: 'Bonusaktion schon verbraucht' };
  if (a.cost === 'attack' && !(eco.attacks > 0 || eco.action > 0 || eco.extra > 0)) return { ok: false, why: 'Keine Angriffe mehr' };
  if (a.cost === 'move' && (eco.moveM - eco.movedM) < (E.statsOf(c, ctx).speedM / 2)) return { ok: false, why: 'Nicht genug Bewegung' };
  if (a.key === 'f:martial' && !eco.attacked) return { ok: false, why: 'Erst die Angriffsaktion nutzen' };
  if (a.uses && a.uses.left <= 0) return { ok: false, why: 'Aufgebraucht', uses: true };
  if (a.recharge === false) return { ok: false, why: 'Lädt noch auf (W6 zu Zugbeginn)' };
  if (a.kind === 'spell') {
    if (a.spec?.use === 'smite' && ctx.ed === '2024') return { ok: false, why: 'Wird nach einem Nahkampftreffer beim Schadenswurf angeboten', smite: true };
    if (!a.combat) return { ok: false, why: a.cost === 'long' ? (a.spec?.summon ? 'Wirkzeit 1 Minute – vor Kampfbeginn wirken' : 'Wirkzeit zu lang für den Kampf') : a.spec?.note || 'Keine Wirkung im Kampf' };
    if (E.hasEff(c, 'rage')) return { ok: false, why: 'Im Kampfrausch kannst du nicht zaubern' };
    if (E.hasEff(c, 'noCast')) return { ok: false, why: 'Kann gerade nicht zaubern' };
    if (/\bV\b/.test(a.sp?.comps || '') && inSilence(x, c, ctx)) return { ok: false, why: 'Stille – keine verbalen Zauber' };
    if (a.level > 0 && !a.arcanum) {
      const opts = a.monster ? (a.perDay ? [{ level: a.level }] : monsterSlotOptions(c, a)) : slotOptions(char, a.level);
      if (!opts.length) return { ok: false, why: 'Kein passender Zauberplatz frei', slot: true };
    }
    if (ctx.ed === '2024' && a.level > 0 && eco.slotSpell) return { ok: false, why: 'Nur ein Zauber mit Zauberplatz pro Zug' };
    if (ctx.ed === '2014' && eco.bonusSpell && a.cost === 'action' && a.level > 0) return { ok: false, why: 'Nach einem Bonusaktions-Zauber nur noch Zaubertricks' };
    if (ctx.ed === '2014' && a.cost === 'bonus' && eco.actionSpellLeveled) return { ok: false, why: 'Bonusaktions-Zauber nur zusammen mit Zaubertricks' };
  }
  return { ok: true };
}
function inSilence(x, c, ctx) {
  const t = ctx.tokenOf?.(c);
  return !!t && (x.zones || []).some((z) => z.silence && E.tokenInZone(x, z, t, ctx));
}

// ───────────────────────── Tooltips (wie BG3) ─────────────────────────
export function tipFor(a, c, ctx) {
  const lines = [];
  const facts = [];
  let sub = '';
  if (a.kind === 'spell') {
    const sp = a.sp;
    sub = `${sp.level ? levelName(sp.level) : 'Zaubertrick'} · ${schoolName(sp.school)}`;
    lines.push(String((sp.desc || [])[0] || '').slice(0, 280) + (String((sp.desc || [])[0] || '').length > 280 ? ' …' : ''));
    facts.push(['range', rangeShort(sp)], ['time', sp.duration]);
    if (sp.conc) facts.push(['conc', 'Konzentration']);
    if (a.attack) facts.push(['hit', `Zauberangriff ${fmtS(a.spellAttack)}`]);
    if (a.spec.save) facts.push(['save', `SG ${a.dc} ${E.AB_SHORT[a.spec.save]}${a.spec.half ? ' (Hälfte bei Erfolg)' : ''}`]);
    const dmg = spellDamage(a, a.level, ctx?.charOf?.(c) ? charMods(ctx.charOf(c)).level : 5, null);
    if (dmg.length) facts.push(['dmg', partsText(dmg)]);
    const h = healOf(a, a.level);
    if (h) facts.push(['heal', `Heilt ${fmtDice(h.dice)}${h.flat ? fmtS(h.flat) : ''}`]);
    if (a.spec.part) facts.push(['info', 'Teilweise automatisiert']);
    if (a.spec.note) lines.push(a.spec.note);
  } else if (a.attack) {
    sub = a.attack.kind === 'ranged' ? 'Fernkampfangriff' : a.attack.thrown ? 'Nahkampf- oder Wurfangriff' : 'Nahkampfangriff';
    facts.push(['hit', `Angriff ${fmtS(a.attack.bonus)}`], ['range', a.attack.range ? `${String(a.attack.range[0]).replace('.', ',')}/${String(a.attack.range[1]).replace('.', ',')} m` : `${String(a.attack.reach || 1.5).replace('.', ',')} m`], ['dmg', partsText(a.attack.damage)]);
    if (a.desc) lines.push(a.desc);
  } else {
    sub = a.group === 'class' ? 'Klassenmerkmal' : a.group === 'item' ? 'Gegenstand' : 'Standardaktion';
    if (a.desc) lines.push(a.desc);
    if (a.save) facts.push(['save', `SG ${a.dc} ${E.AB_SHORT[a.save]}`]);
    if (a.damage?.length) facts.push(['dmg', partsText(a.damage)]);
    if (a.uses) facts.push(['uses', a.uses.max >= 99 ? 'unbegrenzt' : `${a.uses.left}/${a.uses.max} übrig`]);
  }
  const costs = [];
  if (a.cost && a.cost !== 'long') costs.push([a.cost, a.cost === 'attack' ? 'Aktion (Angriff)' : COST[a.cost]]);
  if (a.kind === 'spell' && a.level > 0 && !a.arcanum) costs.push(['slot', `Zauberplatz ${a.level}. Grad`]);
  if (a.uses?.label || (a.res && a.uses)) costs.push(['res', a.name]);
  return { title: a.name, sub, lines: lines.filter(Boolean), facts, costs, why: a.state?.ok ? '' : a.state?.why };
}

// ───────────────────────── Schaden & Heilung eines Zaubers ─────────────────────────
export function spellDamage(a, slot, charLevel, choice) {
  const sp = a.sp;
  const spec = a.spec || {};
  const lvl = slot || sp?.level || 0;
  const up = Math.max(0, lvl - (sp?.level || 0));
  if (spec.dmgChar) {
    const n = 1 + (charLevel >= 5) + (charLevel >= 11) + (charLevel >= 17);
    const d = /d(\d+)/.exec(spec.dmgChar)[1];
    return [{ dice: `${n}d${d}`, flat: 0, type: choice || spec.choice?.[0] || 'force' }];
  }
  if (spec.dmg) {
    return spec.dmg.map(([d, t], i) => {
      const p = parseDmg(d, a.castMod);
      return { dice: i === 0 && spec.dmgUp ? addDice(p.dice, spec.dmgUp, up) : p.dice, flat: p.flat + (spec.mod ? a.castMod || 0 : 0), type: t === 'choice' ? choice || spec.choice?.[0] : t };
    });
  }
  const d = sp ? damageAt(sp, { slot: lvl, charLevel }) : null;
  if (!d) return [];
  const p = parseDmg(d.dice, a.castMod);
  return [{ ...p, flat: p.flat + (spec.mod && !/MOD/i.test(d.dice) ? a.castMod || 0 : 0), type: d.type || choice || null }];
}
export function healOf(a, slot) {
  const sp = a.sp;
  const spec = a.spec || {};
  if (spec.heal?.flat) return { dice: '', flat: spec.heal.flat + Math.max(0, (slot || sp.level) - sp.level) * (spec.heal.up || 0) };
  if (spec.heal?.dice) return { ...parseDmg(spec.heal.dice), flat: parseDmg(spec.heal.dice).flat };
  const h = sp ? healAt(sp, { slot: slot || sp.level }) : null;
  if (!h) return null;
  const p = parseDmg(h, a.castMod);
  return { dice: p.dice, flat: p.flat + (healHasMod(sp) ? a.castMod || 0 : 0) };
}
export function tempOf(a, slot) {
  const spec = a.spec || {};
  if (!spec.temp) return null;
  const p = parseDmg(spec.temp);
  return { dice: p.dice, flat: p.flat + Math.max(0, (slot || a.sp.level) - a.sp.level) * (spec.tempUp || 0) };
}

// ───────────────────────── Würfeln beim Handelnden ─────────────────────────
// Schadensteile würfeln (ein Ausdruck für die Würfelanimation, Summen je Teil für Resistenzen)
export function rollParts(parts, { crit = false, label = '', doRoll } = {}) {
  const terms = [];
  let expr = '';
  for (const [i, p] of parts.entries()) {
    const segs = [];
    if (p.dice) segs.push(p.dice);
    if (p.flat) segs.push(p.flat > 0 ? `+${p.flat}` : `${p.flat}`);
    if (!segs.length) segs.push('0');
    const piece = segs.join('').replace(/^\+/, '');
    terms.push({ i, n: p.dice ? p.dice.split('+').length : 0 });
    expr += (expr ? '+' : '') + piece;
  }
  const r = doRoll ? doRoll(expr, { label, kind: 'damage', fx: crit ? { crit: true } : {} }) : null;
  const res = r || rollDetailed(expr, { kind: 'damage', fx: crit ? { crit: true } : {} });
  const groups = new Map();
  for (const d of res.dice || []) if (!d.dropped) groups.set(d.group, (groups.get(d.group) || 0) + (d.adj ?? d.value));
  let ti = 0;
  const out = parts.map((p) => {
    let sum = 0;
    const nd = p.dice ? p.dice.split('+').length : 0;
    for (let k = 0; k < nd; k++) sum += groups.get(ti++) || 0;
    if (p.flat) ti++;
    if (!p.dice && !p.flat) ti++;
    return { amount: Math.max(0, sum + (p.flat || 0)), type: p.type || null };
  });
  const total = out.reduce((s, p) => s + p.amount, 0);
  if (Math.abs(total - res.total) > 0 && out.length === 1) out[0].amount = Math.max(0, res.total);
  return { parts: out, total: out.reduce((s, p) => s + p.amount, 0), text: res.text };
}
// Zusätzliche Schadensteile beim Treffer: Zeichen des Jägers, Verhexen, Göttliche Gunst, Kampfrausch, Hinterhältiger Angriff …
export function riderParts(x, c, a, target, ctx, opts = {}) {
  const out = [];
  const char = ctx.charOf?.(c);
  const weapon = !!a.attack?.weapon;
  for (const e of c.effects || []) {
    if ((e.key === 'mark' || e.key === 'hex') && e.data?.target === target?.id && (!e.data.weapon || weapon)) out.push({ dice: e.data.dice, flat: 0, type: e.key === 'hex' ? 'necrotic' : e.data.type || a.attack?.damage?.[0]?.type, label: e.name });
    if (e.key === 'onHit' && (!e.data?.weapon || weapon) && !e.data?.negative && (!e.data?.target || e.data.target === target?.id)) out.push({ dice: e.data.dice, flat: 0, type: e.data.type || e.data.choice || a.attack?.damage?.[0]?.type || 'force', label: e.name });
    if (e.key === 'rage' && a.attack?.strBased && a.attack.kind === 'melee') out.push({ dice: '', flat: Number(e.data?.bonus) || 2, type: a.attack.damage?.[0]?.type || null, label: 'Kampfrausch' });
    if (e.key === 'smiteNext' && weapon && a.attack?.kind === 'melee') out.push(...(e.data?.parts || []).map((p) => ({ ...p, label: e.name })));
  }
  if (char && weapon && opts.sneak) {
    const lv = classLevel(char, 'schurke');
    if (lv) out.push({ dice: `${Math.ceil(lv / 2)}d6`, flat: 0, type: a.attack.damage[0].type, label: 'Hinterhältiger Angriff' });
  }
  if (opts.smite) out.push(...[].concat(opts.smite));
  return out;
}
export function sneakEligible(x, c, a, hit, ctx) {
  const char = ctx.charOf?.(c);
  if (!char || !classLevel(char, 'schurke') || !a.attack?.weapon || !(a.attack.finesse || a.attack.kind === 'ranged')) return false;
  if ((c.eco?.sneakUsed)) return false;
  const tgt = cbOf(x, hit.id);
  return hit.mode === 'adv' || (hit.mode !== 'dis' && !!tgt && ctx.allyNear?.(c, tgt));
}
// Angriffswurf beim Handelnden: W20 (mit Vorteil/Nachteil) – die SL rechnet den Rest nach
export function rollAttack(a, plan, { label, doRoll }) {
  const bonus = a.attack?.bonus ?? 0;
  const r = doRoll(`1d20${fmtS(bonus).replace('−', '-')}`, { label, kind: 'attack', fx: plan?.mode === 'adv' ? { adv: true } : plan?.mode === 'dis' ? { dis: true } : {} });
  if (!r) return null;
  const mains = (r.dice || []).filter((d) => d.main);
  const kept = mains.find((d) => !d.dropped) || mains[0];
  return { dice: mains.map((d) => d.value), natural: kept?.value ?? null, total: r.total };
}

// ───────────────────────── Auflösung bei der SL ─────────────────────────
function reconcile(r, mode) {
  const dice = [...(r?.dice || (r?.natural != null ? [r.natural] : []))];
  if (!dice.length) dice.push(rollDie(20));
  if (mode && dice.length < 2) dice.push(rollDie(20));
  if (!mode) return { natural: dice[0], dice: [dice[0]] };
  return { natural: mode === 'adv' ? Math.max(dice[0], dice[1]) : Math.min(dice[0], dice[1]), dice: dice.slice(0, 2) };
}
function attackBonusExtras(x, c) {
  const out = [];
  for (const e of E.effs(c, 'bless')) { const d = rollDie(4); out.push([d, `Segen W4=${d}`]); void e; }
  for (const e of E.effs(c, 'bane')) { const d = rollDie(4); out.push([-d, `Fluch W4=${d}`]); void e; }
  for (const e of E.effs(c, 'inspired')) { const d = rollDie(Number(e.data?.sides) || 6); out.push([d, `Inspiration W${e.data?.sides || 6}=${d}`]); E.removeEffect(x, c, e.id); }
  return out;
}
function payCosts(x, c, a, ev, ctx, char) {
  const eco = (c.eco ||= E.freshEco(c, ctx));
  if (ev.reaction || a.cost === 'reaction') c.reaction = false;
  else if (a.cost === 'action') { if (eco.action > 0) eco.action -= 1; else if (a.hasteOk && eco.extra > 0) eco.extra -= 1; }
  else if (a.cost === 'bonus') eco.bonus = Math.max(0, eco.bonus - 1);
  else if (a.cost === 'attack') {
    if (eco.attacks > 0) eco.attacks -= 1;
    else if (eco.action > 0) { eco.action -= 1; eco.attacks = Math.max(0, (char ? attacksPerAction(char) : E.statsOf(c, ctx).multi || 1) - 1); } else if (eco.extra > 0) { eco.extra -= 1; eco.attacks = 0; }
    eco.attacked = true;
  }
  if (a.kind === 'spell') {
    if (a.level > 0) eco.slotSpell = true;
    if (a.cost === 'bonus') eco.bonusSpell = true;
    if (a.cost === 'action' && a.level > 0) eco.actionSpellLeveled = true;
    E.breakInvisibility(x, c);
    if (a.monster) {
      if (a.perDay) c.perDay = { ...(c.perDay || {}), [a.sp.id]: (Number(c.perDay?.[a.sp.id]) || 0) + 1 };
      else if (a.level > 0 && ev.slot) c.mSlots = { ...(c.mSlots || {}), [ev.slot]: (Number(c.mSlots?.[ev.slot]) || 0) + 1 };
    }
  }
  if (a.recharge !== undefined) { c.recharge = { ...(c.recharge || {}), [a.key]: false }; c.rechargeOn = { ...(c.rechargeOn || {}), [a.key]: a.rechargeOn || 5 }; }
}
const targetsOf = (x, ev) => (ev.targets || []).map((id) => cbOf(x, id)).filter(Boolean);
function areaTargets(x, c, tpl, ctx, { self = false } = {}) {
  const toks = ctx.tokens.filter((t) => { const o = x.combatants.find((cb) => ctx.tokenOf(cb)?.id === t.id); return o && !E.isDead(o) && (self || o.id !== c.id); });
  const inside = tokensInArea(tpl, toks).filter((t) => {
    if (!ctx.grid) return true;
    const n = t.size || 1;
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) if (inArea(tpl, t.x + dx + 0.5, t.y + dy + 0.5) && areaReaches(ctx.grid, tpl.x, tpl.y, t.x + dx, t.y + dy)) return true;
    return false;
  });
  return inside.map((t) => x.combatants.find((cb) => ctx.tokenOf(cb)?.id === t.id)).filter(Boolean);
}
const durOf = (dur, spec, c, tgt) => {
  if (dur === 'conc') return { rounds: spec?.rounds || 10 };
  if (typeof dur === 'number') return { rounds: dur };
  if (dur === 'long') return { rounds: spec?.rounds || 600 };
  if (dur === 'srcNextStart') return { until: { cb: c.id, at: 'start', n: c.turnNo || 0 } };
  if (dur === 'srcNextEnd') return { until: { cb: c.id, at: 'end', n: c.turnNo || 0 } };
  if (dur === 'tgtNextStart') return { until: { cb: tgt.id, at: 'start', n: tgt.turnNo || 0 } };
  if (dur === 'tgtNextEnd') return { until: { cb: tgt.id, at: 'end', n: tgt.turnNo || 0 } };
  return {};
};
// Effekte/Zustände eines Zaubers anwenden
function applyEff(x, c, tgt, eff, a, concId, ev) {
  const spec = a.spec || {};
  const data = { ...(eff.data || {}) };
  if (data.byChoice && ev.choice) { if (eff.k === 'resist') data.types = [ev.choice]; else data.choice = ev.choice; data.type = ev.choice; }
  if (eff.k === 'aid') data.hp = (data.hp || 5) + Math.max(0, (ev.slot || a.level) - a.level) * (data.hpUp || 5);
  if (eff.k === 'heroism') data.n = a.castMod || 0;
  if (eff.k === 'magicWeapon') data.bonus = (ev.slot || 2) >= 6 ? 3 : (ev.slot || 2) >= (edNow() === '2024' ? 3 : 4) ? 2 : 1;
  if (eff.k === 'mark' || eff.k === 'hex') data.target = tgt.id;
  if (eff.k === 'fireShield') data.type = ev.choice === 'cold' ? 'cold' : 'fire';
  // Zeichen des Jägers / Verhexen liegen beim Wirker und merken sich das Ziel
  const onCaster = eff.self || eff.k === 'mark' || eff.k === 'hex';
  const who = onCaster ? c : tgt;
  if (eff.targetLink) data.target = tgt.id;
  const e = E.addEffect(x, who, { key: eff.k, name: `${eff.name || a.name}${onCaster && tgt && tgt !== c ? ` → ${tgt.name}` : ''}`, src: c.id, spellId: a.sp?.id, conc: spec.conc && eff.dur === 'conc' ? concId : undefined, data, ...(eff.save ? { save: { ab: eff.save.ab, dc: a.dc, at: eff.save.at || 'end' } } : {}), silent: eff.silent, ...durOf(eff.dur, spec, c, tgt) });
  if (eff.k === 'aid') { who.maxHp = (Number(who.maxHp) || 1) + data.hp; who.hp = (Number(who.hp) || 0) + data.hp; }
  if (eff.k === 'fireShield') E.addEffect(x, who, { key: 'resist', name: 'Feuerschild (Resistenz)', src: c.id, silent: true, data: { types: [data.type === 'fire' ? 'cold' : 'fire'] }, rounds: spec.rounds || 100 });
  if (eff.k === 'rage') { /* s. Merkmal */ }
  if (!eff.silent) E.log(x, `✨ ${who.name}: ${e.name}`);
  return e;
}
function applyCond(x, c, tgt, cond, a, concId, ev, ctx) {
  const spec = a.spec || {};
  const name = cond.label && cond.n === E.COND.incap ? cond.n : ev.condChoice && spec.condChoice ? ev.condChoice : cond.n;
  const k = {
    name, src: c.id, conc: spec.conc && cond.dur === 'conc' ? concId : undefined, ...durOf(cond.dur, spec, c, tgt),
    ...(cond.save ? { save: { ab: spec.save || 'wis', dc: a.dc, at: cond.save } } : {}),
    ...(cond.endOnDamage ? { endOnDamage: true } : {}), ...(cond.saveOnDamage ? { saveOnDamage: true } : {}), ...(cond.breakOnAttack ? { breakOnAttack: true } : {}),
    ...(cond.fails != null ? { fails: 0, onFails: cond.onFails } : {}), ...(cond.label ? { label: cond.label } : {}),
  };
  if (E.addCondition(x, tgt, k, ctx)) E.log(x, `⛓ ${tgt.name}: ${name}${cond.label ? ` (${cond.label})` : ''}`);
}
function pushResultRec(x, rec) {
  return E.pushResult(x, rec);
}
const baseRec = (ev, c, a) => ({ id: ev.id, mapId: ev.mapId || null, uid: ev.uid || null, actor: c.id, actorName: c.name, title: a.name, art: a.art || null, level: ev.slot || a.level || 0, targets: [], lines: [] });

// Angriffe (Waffen, Monster, Zauberangriffe, verliehene Angriffe)
function resolveAttacks(x, c, a, ev, ctx, reacts, side) {
  const rec = { ...baseRec(ev, c, a), kind: 'attack', stage: 'done', magical: !!a.attack?.magical };
  const spec = a.spec || {};
  const list = ev.targets || [];
  list.forEach((tid, i) => {
    const tgt = cbOf(x, tid);
    if (!tgt) return;
    const att = { ...a.attack };
    if (att.thrown && ctx.tokenOf(c) && ctx.tokenOf(tgt) && cellDistance(ctx.tokenOf(c), ctx.tokenOf(tgt)) * CELL_M > (att.reach || 1.5)) att.kind = 'ranged';
    if (spec.attack && att.kind?.startsWith('spell')) att.bonus = a.spellAttack;
    const plan = E.attackPlan(x, c, tgt, att, ctx);
    if (!plan.ok) { rec.targets.push({ id: tgt.id, name: tgt.name, hit: false, note: plan.problems.join(', ') }); return; }
    if (E.hasEff(tgt, 'sanctuary') && side(tgt) !== side(c)) {
      const sv = E.savingThrow(x, c, 'wis', effDc(x, tgt, 'sanctuary'), { spell: true }, ctx);
      if (!sv.ok) { rec.targets.push({ id: tgt.id, name: tgt.name, hit: false, note: 'Heiligtum – Angriff abgelenkt' }); return; }
    }
    const rr = reconcile(ev.rolls?.[i], plan.mode);
    const extras = attackBonusExtras(x, c);
    const bonus = att.bonus + extras.reduce((s, [n]) => s + n, 0);
    const total = rr.natural + bonus;
    let j = E.judge(plan, { natural: rr.natural, total });
    const re = reacts?.[i] || {};
    let ac = plan.ac;
    if (re.shield) { ac += 5; j = E.judge({ ...plan, ac }, { natural: rr.natural, total }); }
    if (re.parry) { ac += re.parry; j = E.judge({ ...plan, ac }, { natural: rr.natural, total }); }
    // Spiegelbilder
    if (j.hit && E.hasEff(tgt, 'mirror')) {
      const mi = E.effs(tgt, 'mirror')[0];
      const n = Number(mi.data?.n) || 0;
      let img = false;
      if (edNow() === '2024') img = Array.from({ length: n }, () => rollDie(6)).some((d) => d >= 3);
      else img = rollDie(20) >= (n >= 3 ? 6 : n === 2 ? 8 : 11);
      if (img) {
        mi.data = { ...mi.data, n: n - 1 };
        if (n - 1 <= 0) E.removeEffect(x, tgt, mi.id, 'alle Spiegelbilder zerstört');
        E.log(x, `🪞 ${c.name} trifft ein Spiegelbild von ${tgt.name} (noch ${n - 1})`);
        j = { ...j, hit: false, crit: false, image: true };
      }
    }
    const dieTxt = rr.dice.length > 1 ? `W20 ${plan.mode === 'adv' ? 'Vorteil' : 'Nachteil'} [${rr.dice.join(', ')}]` : `W20 [${rr.natural}]`;
    // Die RK von Monstern sieht nur die SL im Protokoll
    const head = `🎯 ${c.name} → ${tgt.name}: ${a.name} ${dieTxt} ${fmtS(att.bonus)}${extras.map(([n, t]) => ` ${fmtS(n)} (${t})`).join('')} = ${total}`;
    const tail = `${plan.adv.length || plan.dis.length ? ` · ${[...plan.adv.map((s) => `▲ ${s}`), ...plan.dis.map((s) => `▼ ${s}`)].join(', ')}` : ''} → ${j.crit ? 'KRITISCHER TREFFER' : j.hit ? 'Treffer' : j.fumble ? 'natürliche 1 – daneben' : j.image ? 'Spiegelbild' : 'verfehlt'}`;
    const acTxt = ` gegen RK ${ac}${plan.cover ? ` (inkl. Deckung +${plan.cover})` : ''}`;
    if (tgt.isPC) E.log(x, `${head}${acTxt}${tail}`);
    else E.log(x, `${head}${plan.cover ? ' (Ziel in Deckung)' : ''}${tail}`, '', `${head}${acTxt}${tail}`);
    rec.targets.push({ id: tgt.id, name: tgt.name, natural: rr.natural, dice: rr.dice, total, ac, hit: j.hit, crit: j.crit, fumble: j.fumble, mode: plan.mode, adv: plan.adv, dis: plan.dis, melee: plan.melee, shield: !!re.shield, parry: !!re.parry, image: !!j.image, halfOnMiss: !j.hit && spec.special === 'acidArrow' });
    if (j.hit) {
      for (const eff of [].concat(spec.eff || []).filter((f) => f.onHit)) applyEff(x, c, tgt, eff, a, c.concentration?.id, ev);
      for (const cond of [].concat(spec.cond || []).filter((f) => f.onHit)) applyCond(x, c, tgt, cond, a, c.concentration?.id, ev, ctx);
      if (spec.special === 'acidArrow') E.addEffect(x, tgt, { key: 'dotEnd', name: 'Säurepfeil (Nachwirkung)', src: c.id, data: { dice: addDice('2d4', '1d4', Math.max(0, (ev.slot || 2) - 2)), type: 'acid' }, until: { cb: tgt.id, at: 'end', n: tgt.turnNo || 0 } });
      if (spec.eff && [].concat(spec.eff).some((f) => f.k === 'enfeebled')) { /* Schwächestrahl: Effekt über onHit */ }
    }
    E.afterAttack(x, c, tgt);
    if (E.hasEff(c, 'reckless')) E.addEffect(x, c, { key: 'recklessTarget', name: 'Tollkühn (Angriffe gegen dich im Vorteil)', src: c.id, unique: 'any', silent: true, until: { cb: c.id, at: 'start', n: c.turnNo || 0 } });
  });
  if (spec.special === 'iceKnife') {
    const t0 = cbOf(x, list[0]);
    if (t0) {
      const tok = ctx.tokenOf(t0);
      const around = tok ? x.combatants.filter((o) => !E.isDead(o) && ctx.tokenOf(o) && cellDistance(ctx.tokenOf(o), tok) <= 1) : [t0];
      rec.explode = around.map((o) => { const sv = E.savingThrow(x, o, 'dex', a.dc, { spell: true }, ctx); return { id: o.id, name: o.name, save: { ok: sv.ok, total: sv.total, dc: a.dc } }; });
    }
  }
  const dmg = a.attack?.damage?.length ? a.attack.damage : a.kind === 'spell' ? spellDamage(a, ev.slot, a.castLevel, ev.choice) : [];
  rec.damage = dmg;
  rec.drain = spec.drain || a.grant?.drain || 0;
  rec.weapon = !!a.attack?.weapon;
  rec.strBased = !!a.attack?.strBased;
  rec.finesse = !!a.attack?.finesse;
  rec.attKind = a.attack?.kind || null;
  rec.rays = spec.rays ? list.length : 0;
  if ((rec.targets.some((t) => t.hit || t.halfOnMiss) && dmg.length) || rec.explode?.some((e) => !e.save.ok)) rec.stage = 'damage';
  return rec;
}
// Nebenwirkungen eines Niederstrecken-Zaubers auf das getroffene Ziel (Zustand, Brennen, Brandmal …)
function smiteRider(x, c, tgt, spellId, ctx) {
  const sp = spellsCached(ctx.ed)?.find((s) => s.id === spellId);
  const spec = sp && specFor(sp, ctx.ed);
  const sm = spec?.smite;
  if (!sm || !tgt) return;
  const dc = E.statsOf(c, ctx).spell?.dc || 13;
  const a = { name: sp.name, sp, spec: { ...spec, save: sm.save || spec.save }, dc, level: sp.level, castMod: 0 };
  let concId = E.concOf(c)?.spellId === sp.id ? E.concOf(c).id : null;
  if (sp.conc && !concId) concId = E.startConcentration(x, c, { name: sp.name, spellId: sp.id });
  let failed = true;
  if (sm.save) failed = !E.savingThrow(x, tgt, sm.save, dc, { spell: true }, ctx).ok;
  if (failed && sm.cond) applyCond(x, c, tgt, sm.cond, a, concId, {}, ctx);
  if (failed && sm.eff) applyEff(x, c, tgt, sm.eff, a, concId, {});
  if (sm.dotStart) E.addEffect(x, tgt, { key: 'dotStart', name: `${sp.name} (brennt)`, src: c.id, conc: concId || undefined, rounds: spec.rounds || 10, data: { dice: sm.dotStart.dice, type: sm.dotStart.type, save: sm.dotStart.save ? { ab: sm.dotStart.save, dc } : null } });
  if (sm.dot && failed) E.addEffect(x, tgt, { key: 'dotStart', name: sp.name, src: c.id, conc: concId || undefined, rounds: spec.rounds || 10, data: { dice: sm.dot.dice, type: sm.dot.type } });
}
async function reject(ev, actor, why) {
  if (!ev.uid || ev.uid === myUid()) bridge.toast(why, 'error');
  await mutateCombat((x) => {
    E.pushResult(x, { id: ev.id || uid(8), mapId: ev.mapId || null, uid: ev.uid || null, kind: 'error', stage: 'done', actor: actor?.id || null, actorName: actor?.name || '', title: 'Nicht möglich', note: why, targets: [], lines: [] });
    return x;
  });
}
function effDc(x, tgt, key) {
  const e = E.effs(tgt, key)[0];
  const src = e && cbOf(x, e.src);
  return e?.data?.dc || (src ? 13 : 13);
}

// Rettungswurf-Zauber, Flächen, Buffs, Debuffs, Zonen …
function resolveSpellEffects(x, c, a, ev, ctx, reacts, side) {
  const spec = a.spec;
  const sp = a.sp;
  const rec = { ...baseRec(ev, c, a), kind: 'save', stage: 'done', save: spec.save, dc: a.dc, half: !!spec.half, magical: true };
  let concId = null;
  if (spec.conc && spec.use !== 'smite') concId = E.startConcentration(x, c, { name: sp.name, spellId: sp.id });
  const tpl = ev.tpl || null;
  let targets = targetsOf(x, ev);
  if (tpl && (spec.use === 'save' || spec.use === 'zone' || spec.use === 'special' || spec.use === 'heal' || spec.use === 'debuff' || spec.use === 'buff') && !targets.length) targets = areaTargets(x, c, tpl, ctx, { self: spec.use === 'heal' || spec.use === 'buff' });
  if (spec.who === 'enemies' || (spec.use === 'save' && ev.exclude?.length)) targets = targets.filter((t) => !(ev.exclude || []).includes(t.id));
  rec.tpl = tpl;
  let dmg = spellDamage(a, ev.slot, a.castLevel, ev.choice);
  // Zone anlegen
  if (spec.use === 'zone' && tpl) {
    // Zustandszonen (Netz, Schmierfett, Graupelschauer …) machen keinen Schaden – auch wenn die Beschreibung Feuer erwähnt
    const zdmg = spec.zone?.dmg ? spec.zone.dmg.map(([d, t]) => ({ dice: addDice(parseDmg(d).dice || d, spec.dmgUp || '', 0), type: t })) : spec.zone?.cond ? [] : dmg.map((p) => ({ dice: `${p.dice}${p.flat ? fmtS(p.flat).replace('−', '-') : ''}`, type: p.type }));
    const z = E.addZone(x, {
      name: sp.name, spellId: sp.id, src: c.id, conc: concId, tpl: { ...tpl, baseSize: tpl.size }, color: DAMAGE_ART[dmg[0]?.type]?.color || (spec.zone?.barrier || spec.zone?.opaque ? '#8a8f98' : '#9f7aea'), follow: spec.zone?.follow ? c.id : null,
      obscure: !!spec.zone?.obscure, difficult: spec.zone?.difficult ? (spec.zone.heavy ? 4 : 2) : 0, difficultEnemies: !!spec.zone?.difficultEnemies, silence: !!spec.zone?.silence, barrier: !!spec.zone?.barrier, opaque: !!spec.zone?.opaque,
      trigger: spec.zone?.trig || [], adjacent: !!spec.zone?.adjacent, who: spec.zone?.who || 'all',
      save: spec.zone?.save || (spec.zone?.trig?.length && spec.save) ? { ab: spec.zone?.save || spec.save, dc: a.dc, half: !!(spec.zone?.half ?? spec.half) } : null,
      dmg: spec.zone?.trig?.length ? zdmg.filter((d) => d.dice) : [], cond: spec.zone?.cond || null, perCell: spec.zone?.perCell || null, retch: !!spec.zone?.retch,
      rounds: spec.zone?.rounds || spec.rounds || 10,
    });
    rec.zone = z.id;
    E.log(x, `🌀 ${c.name} wirkt ${sp.name}${concId ? ' (Konzentration)' : ''}`);
    if (a.spec.grant) grantAction(x, c, a, ev, concId, z.id);
    // Sofortwirkung beim Erscheinen: Zustand (Netz, Verstricken …) bzw. Schaden der Zone (Schwarze Tentakel, Feuerwand)
    dmg = spec.zone?.dmg ? spec.zone.dmg.map(([d, t]) => ({ ...parseDmg(d), type: t })) : spec.half && !spec.cond ? dmg : [];
    if (!(spec.save && (spec.cond || spec.half))) { rec.kind = 'effect'; return rec; }
  }
  if (spec.use === 'buff' || spec.use === 'mark' || spec.use === 'temp' || spec.use === 'heal') return resolveSupport(x, c, a, ev, ctx, targets, concId, rec);
  // Rettungswürfe
  for (const t of targets) {
    if (spec.only && !spec.only.test(t.statblock?.type || (t.isPC ? 'Humanoide' : ''))) { rec.targets.push({ id: t.id, name: t.name, note: 'nicht betroffen (Kreaturentyp)' }); continue; }
    if (spec.use === 'special' && spec.special === 'hpPool') continue;
    const firstCond = [].concat(spec.cond || [])[0]?.n;
    const sv = spec.save ? E.savingThrow(x, t, spec.save, a.dc, { spell: true, cover: spec.ignoreCover ? 0 : ctx.cover && ctx.tokenOf(c) && ctx.tokenOf(t) ? ctx.cover(ctx.tokenOf(c), ctx.tokenOf(t)) : 0, immuneTo: firstCond }, ctx) : { ok: false, total: 0 };
    const entry = { id: t.id, name: t.name, save: spec.save ? { ok: sv.ok, total: sv.total, natural: sv.natural, auto: sv.auto, immune: sv.immune } : null };
    if (!sv.ok) {
      for (const cond of [].concat(spec.cond || []).filter((f) => !f.onHit)) applyCond(x, c, t, cond, a, concId, ev, ctx);
      for (const eff of [].concat(spec.eff || []).filter((f) => !f.onHit && (f.onFail || spec.use === 'debuff' || spec.use === 'save'))) applyEff(x, c, t, eff, a, concId, ev);
      if (spec.push) rec.push = [...(rec.push || []), { id: t.id, m: spec.push }];
      if (spec.special === 'flee') { t.reaction = false; entry.note = 'muss mit der Reaktion fliehen'; }
      if (spec.special === 'command') applyCommand(x, c, t, ev);
      if (spec.special === 'sleep24') E.addCondition(x, t, { name: E.COND.incap, src: c.id, conc: concId, until: { cb: t.id, at: 'end', n: t.turnNo || 0 }, save: { ab: 'wis', dc: a.dc, at: 'end' }, fails: 0, onFails: { n: 1, name: E.COND.unconscious } }, ctx);
      if (spec.special === 'curse') applyCurse(x, c, t, a, ev, concId);
      if (spec.special === 'enlarge') applyEnlarge(x, c, t, a, ev, concId);
    } else if (spec.onSave) applyEff(x, c, t, spec.onSave, a, concId, ev);
    rec.targets.push(entry);
  }
  if (spec.special === 'hpPool') resolveHpPool(x, c, a, ev, ctx, targets, rec);
  rec.damage = dmg;
  if (spec.special === 'disintegrate') rec.disintegrate = true;
  if (spec.floorOne) rec.floorOne = true;
  if (dmg.length && rec.targets.some((t) => !t.note && (!t.save?.ok || rec.half))) rec.stage = 'damage';
  if (spec.grant) grantAction(x, c, a, ev, concId, null);
  if (!spec.save) rec.kind = 'effect';
  return rec;
}
function resolveSupport(x, c, a, ev, ctx, targets, concId, rec) {
  const spec = a.spec;
  if (spec.t === 'self' || !targets.length) targets = [c];
  rec.kind = spec.use === 'heal' ? 'heal' : 'effect';
  for (const t of targets) {
    const entry = { id: t.id, name: t.name };
    if (spec.use === 'heal') {
      const amt = Number(ev.amounts?.[t.id] ?? ev.amount) || 0;
      entry.healed = E.applyHealing(x, t, amt, { source: a.name });
      for (const n of spec.cures || []) E.removeCondition(x, t, n, a.name);
    }
    if (spec.use === 'temp') { E.addTempHp(x, t, Number(ev.amount) || 0, a.name); entry.temp = Number(ev.amount) || 0; }
    for (const eff of [].concat(spec.eff || [])) applyEff(x, c, t, eff, a, concId, ev);
    for (const cond of [].concat(spec.cond || [])) applyCond(x, c, t, cond, a, concId, ev, ctx);
    rec.targets.push(entry);
  }
  if (spec.grant) grantAction(x, c, a, ev, concId, null);
  if (spec.special === 'dashNow') { const eco = (c.eco ||= E.freshEco(c, ctx)); eco.moveM += E.statsOf(c, ctx).speedM; }
  E.log(x, `✨ ${c.name} wirkt ${a.name}${targets.length && targets[0] !== c ? ` auf ${targets.map((t) => t.name).join(', ')}` : ''}${concId ? ' (Konzentration)' : ''}`);
  return rec;
}
function grantAction(x, c, a, ev, concId, zoneId) {
  const g = a.spec.grant;
  const up = Math.max(0, (ev.slot || a.level) - a.level);
  const dice = g.dice ? addDice(g.dice, g.upDice || '', a.sp.en === 'Flame Blade' && edNow() === '2014' ? Math.floor(up / 2) : a.sp.en === 'Spiritual Weapon' && edNow() === '2014' ? Math.floor(up / 2) : up) : null;
  E.addEffect(x, c, {
    key: 'grant', name: `${g.name} verfügbar`, src: c.id, spellId: a.sp.id, conc: concId || undefined, rounds: a.spec.rounds || 10, silent: true,
    data: { action: { ...g, dice, type: g.type === 'choice' ? ev.choice : g.type }, dc: a.dc, attack: a.spellAttack, mod: g.mod || (g.mod24 && edNow() === '2024') ? a.castMod : 0, slot: ev.slot, zoneId, art: { spell: a.sp } },
  });
}
function applyCommand(x, c, t, ev) {
  const w = ev.choice || 'grovel';
  const names = { approach: 'Befehl: Komm her', drop: 'Befehl: Lass fallen', flee: 'Befehl: Flieh', grovel: 'Befehl: Kriech', halt: 'Befehl: Halt' };
  if (w === 'grovel') E.addCondition(x, t, { name: E.COND.prone, src: c.id });
  E.addEffect(x, t, { key: w === 'halt' || w === 'grovel' ? 'lethargic' : 'command', name: names[w], src: c.id, until: { cb: t.id, at: 'end', n: t.turnNo || 0 } });
}
function applyCurse(x, c, t, a, ev, concId) {
  const w = ev.choice || 'extra';
  if (w === 'extra') E.addEffect(x, c, { key: 'onHit', name: 'Fluch (+1W8 nekrotisch gegen das Ziel)', src: c.id, conc: concId, rounds: 10, data: { dice: '1d8', type: 'necrotic', target: t.id } });
  else if (w === 'attack') E.addEffect(x, t, { key: 'disNext', name: 'Fluch (Nachteil gegen den Wirker)', src: c.id, conc: concId, rounds: 10 });
  else E.addEffect(x, t, { key: 'curse', name: 'Fluch', src: c.id, conc: concId, rounds: 10 });
}
function applyEnlarge(x, c, t, a, ev, concId) {
  const big = ev.choice !== 'reduce';
  E.addEffect(x, t, { key: 'onHit', name: big ? 'Vergrößert (+1W4 Waffenschaden)' : 'Verkleinert (−1W4 Waffenschaden)', src: c.id, conc: concId, rounds: 10, data: { dice: big ? '1d4' : '1d4', type: null, weapon: true, negative: !big } });
}
function resolveHpPool(x, c, a, ev, ctx, targets, rec) {
  const spec = a.spec;
  const up = Math.max(0, (ev.slot || a.level) - a.level);
  const r = roll(addDice(spec.pool, spec.poolUp, up));
  let pool = r.total;
  E.log(x, `💤 ${a.name}: ${r.text} = ${pool} TP Wirkung`);
  const sorted = [...targets].filter((t) => !E.isDead(t) && !E.has(t, E.COND.unconscious)).sort((p, q) => p.hp - q.hp);
  for (const t of sorted) {
    if (t.hp > pool) { rec.targets.push({ id: t.id, name: t.name, note: `zu viele TP (${t.hp})` }); break; }
    pool -= t.hp;
    const cond = [].concat(spec.cond)[0];
    applyCond(x, c, t, cond, a, null, ev, ctx);
    rec.targets.push({ id: t.id, name: t.name, note: cond.n });
  }
}
function resolveSpecial(x, c, a, ev, ctx) {
  const spec = a.spec;
  const rec = { ...baseRec(ev, c, a), kind: 'effect', stage: 'done' };
  const t = targetsOf(x, ev)[0];
  const s = spec.special;
  if (s === 'stabilize' && t) { E.stabilize(x, t, a.name) ? rec.targets.push({ id: t.id, name: t.name, note: 'stabilisiert' }) : rec.targets.push({ id: t.id, name: t.name, note: 'nicht bei 0 TP' }); }
  if (s === 'cure' && t) {
    for (const n of spec.cures || []) if (E.has(t, n)) { E.removeCondition(x, t, n, a.name); rec.targets.push({ id: t.id, name: t.name, note: `${n} beendet` }); }
    for (const eff of [].concat(spec.eff || [])) applyEff(x, c, t, eff, a, null, ev);
    if (!rec.targets.length) rec.targets.push({ id: t.id, name: t.name, note: 'kein passender Zustand' });
  }
  if (s === 'revive' && t) {
    if (t.dead) { E.applyHealing(x, t, 1, { revive: true, source: a.name }); rec.targets.push({ id: t.id, name: t.name, note: 'kehrt mit 1 TP zurück' }); } else rec.targets.push({ id: t.id, name: t.name, note: 'ist nicht tot' });
  }
  if (s === 'pwKill' && t) {
    if (t.hp <= 100) { E.die(x, t, a.name); rec.targets.push({ id: t.id, name: t.name, note: 'stirbt' }); } else if (edNow() === '2024') { rec.damage = [{ dice: '12d12', flat: 0, type: 'psychic' }]; rec.targets.push({ id: t.id, name: t.name, hit: true }); rec.kind = 'attack'; rec.stage = 'damage'; } else rec.targets.push({ id: t.id, name: t.name, note: 'mehr als 100 TP – keine Wirkung' });
  }
  if (s === 'pwStun' && t) {
    if (t.hp <= 150) { E.addCondition(x, t, { name: E.COND.stunned, src: c.id, save: { ab: 'con', dc: a.dc, at: 'end' } }, ctx); rec.targets.push({ id: t.id, name: t.name, note: 'betäubt' }); } else rec.targets.push({ id: t.id, name: t.name, note: 'mehr als 150 TP' });
  }
  if (s === 'pwHeal' && t) {
    E.applyHealing(x, t, t.maxHp, { source: a.name });
    for (const n of [E.COND.stunned, E.COND.charmed, E.COND.paralyzed, E.COND.frightened, E.COND.poisoned]) E.removeCondition(x, t, n, a.name);
    rec.targets.push({ id: t.id, name: t.name, note: 'voll geheilt' });
  }
  if (s === 'massHeal') {
    let pool = 700;
    for (const tt of targetsOf(x, ev)) { const need = Math.max(0, tt.maxHp - Math.max(0, tt.hp)); const h = Math.min(need, pool); pool -= h; E.applyHealing(x, tt, h, { source: a.name }); rec.targets.push({ id: tt.id, name: tt.name, healed: h }); }
  }
  if (s === 'dispel' && t) {
    const lvl = ev.slot || 3;
    const spells = [...(t.effects || [])].filter((e) => e.spellId);
    for (const e of spells) E.removeEffect(x, t, e.id, a.name);
    t.conditions = (t.conditions || []).filter((k) => !k.src || k.src === t.id);
    x.zones = (x.zones || []).filter((z) => !(ev.zone && z.id === ev.zone));
    rec.targets.push({ id: t.id, name: t.name, note: `${spells.length} Zauberwirkung(en) beendet (bis Grad ${lvl})` });
  }
  if (s === 'removeCurse' && t) { for (const e of [...(t.effects || [])]) if (/Fluch/.test(e.name)) E.removeEffect(x, t, e.id, a.name); rec.targets.push({ id: t.id, name: t.name, note: 'Flüche beendet' }); }
  if (s === 'heatMetal' && t) { rec.kind = 'attack'; rec.damage = spellDamage(a, ev.slot, a.castLevel); rec.targets.push({ id: t.id, name: t.name, hit: true }); rec.stage = 'damage'; grantAction(x, c, { ...a, spec: { ...spec, grant: { ...spec.grant, dice: rec.damage[0].dice } } }, ev, E.startConcentration(x, c, { name: a.name, spellId: a.sp.id }), null); }
  if (s === 'callLightning') { const concId = E.startConcentration(x, c, { name: a.name, spellId: a.sp.id }); grantAction(x, c, a, ev, concId, null); E.log(x, `⛈ ${c.name} ruft eine Sturmwolke herbei – „Blitz herabrufen“ ist jetzt jede Runde verfügbar`); }
  if (s === 'chain') {
    const list = targetsOf(x, ev);
    rec.kind = 'save'; rec.save = 'dex'; rec.dc = a.dc; rec.half = true;
    for (const tt of list) { const sv = E.savingThrow(x, tt, 'dex', a.dc, { spell: true }, ctx); rec.targets.push({ id: tt.id, name: tt.name, save: { ok: sv.ok, total: sv.total } }); }
    rec.damage = spellDamage(a, ev.slot, a.castLevel);
    rec.stage = 'damage';
  }
  if (s === 'divineWord') {
    for (const tt of targetsOf(x, ev)) {
      const sv = E.savingThrow(x, tt, 'cha', a.dc, { spell: true }, ctx);
      if (sv.ok) { rec.targets.push({ id: tt.id, name: tt.name, save: { ok: true, total: sv.total } }); continue; }
      const hp = tt.hp;
      if (hp <= 20) E.die(x, tt, a.name);
      else if (hp <= 30) { E.addCondition(x, tt, { name: E.COND.blind, src: c.id, rounds: 600 }, ctx); E.addCondition(x, tt, { name: E.COND.deaf, src: c.id, rounds: 600 }, ctx); E.addCondition(x, tt, { name: E.COND.stunned, src: c.id, rounds: 600 }, ctx); } else if (hp <= 40) { E.addCondition(x, tt, { name: E.COND.blind, src: c.id, rounds: 100 }, ctx); E.addCondition(x, tt, { name: E.COND.deaf, src: c.id, rounds: 100 }, ctx); } else if (hp <= 50) E.addCondition(x, tt, { name: E.COND.deaf, src: c.id, rounds: 10 }, ctx);
      rec.targets.push({ id: tt.id, name: tt.name, save: { ok: false, total: sv.total }, note: hp <= 20 ? 'stirbt' : hp <= 50 ? 'geschlagen' : 'unberührt (über 50 TP)' });
    }
  }
  if (s === 'prismatic') {
    const COLORS = [['Rot', 'fire'], ['Orange', 'acid'], ['Gelb', 'lightning'], ['Grün', 'poison'], ['Blau', 'cold'], ['Indigo', null], ['Violett', null]];
    rec.kind = 'effect';
    const list = ev.tpl ? areaTargets(x, c, ev.tpl, ctx) : targetsOf(x, ev);
    for (const tt of list) {
      const n = rollDie(8);
      const [name, type] = COLORS[Math.min(6, n - 1)];
      const sv = E.savingThrow(x, tt, 'dex', a.dc, { spell: true }, ctx);
      if (n === 8) { rec.targets.push({ id: tt.id, name: tt.name, note: 'zwei Strahlen – die SL würfelt nach' }); continue; }
      if (type) { const r = roll('10d6'); const amt = sv.ok ? Math.floor(r.total / 2) : r.total; E.applyDamage(x, tt, [{ amount: amt, type }], { magical: true, attacker: c }, ctx); rec.targets.push({ id: tt.id, name: tt.name, note: `${name}: ${amt} ${dmgName(type)}` }); } else if (!sv.ok) { E.addCondition(x, tt, { name: name === 'Indigo' ? E.COND.restrained : E.COND.blind, src: c.id, save: { ab: 'con', dc: a.dc, at: 'end' } }, ctx); rec.targets.push({ id: tt.id, name: tt.name, note: `${name}: ${name === 'Indigo' ? 'festgesetzt' : 'blind'}` }); }
    }
  }
  if (s === 'timeStop') { E.log(x, `⏳ ${c.name} hält die Zeit an – die SL gibt ${1 + rollDie(4)} Züge hintereinander.`); rec.note = 'Zeitstopp'; }
  if (s === 'calm') for (const tt of ev.tpl ? areaTargets(x, c, ev.tpl, ctx, { self: true }) : []) { for (const n of [E.COND.charmed, E.COND.frightened]) E.removeCondition(x, tt, n, a.name); rec.targets.push({ id: tt.id, name: tt.name, note: 'beruhigt' }); }
  // Verwandlung / Wahre Verwandlung / Gestaltwandel: Statblock der neuen Gestalt, Markierung „Verwandelt“
  if (s === 'polymorph') {
    const m = ev.form ? monsterById(ev.form.id) : null;
    const tt = spec.form?.self ? c : t;
    if (m && tt) {
      const willing = tt.id === c.id || side(tt) === side(c);
      const sv = willing || !spec.save ? { ok: false } : E.savingThrow(x, tt, spec.save, a.dc, { spell: true }, ctx);
      if (!sv.ok) {
        const concId = a.conc ? E.startConcentration(x, c, { name: a.sp.name, spellId: a.sp.id }) : null;
        E.applyForm(x, tt, formOf(m), { mode: spec.form?.temp ? 'temp' : 'replace', conc: concId, src: a.sp.id, by: c.id, endOnTemp: !!spec.form?.temp });
        rec.targets.push({ id: tt.id, name: tt.name, note: `verwandelt: ${m.name}`, ...(spec.save && !willing ? { save: { ok: false, total: sv.total } } : {}) });
      } else rec.targets.push({ id: tt.id, name: tt.name, save: { ok: true, total: sv.total } });
      if (spec.save && !willing) Object.assign(rec, { kind: 'save', save: spec.save, dc: a.dc });
    }
  }
  if (s === 'trueStrike' && t) return null;
  if (!rec.targets.length && !rec.note) E.log(x, `✨ ${c.name} wirkt ${a.name}`);
  return rec;
}
function resolveStd(x, c, a, ev, ctx) {
  const rec = { ...baseRec(ev, c, a), kind: 'effect', stage: 'done' };
  const eco = (c.eco ||= E.freshEco(c, ctx));
  const s = E.statsOf(c, ctx);
  const std = a.std || { 'f:cdash': 'dash', 'f:cdis': 'disengage', 'f:chide': 'hide', 'f:patient': 'dodge' }[a.key];
  if (std === 'dash') { eco.moveM += s.speedM; eco.dash += 1; E.log(x, `🏃 ${c.name}: Spurt (+${E.fmtM(s.speedM)})`); }
  if (std === 'disengage') { eco.disengage = true; E.log(x, `🚪 ${c.name}: Rückzug – keine Gelegenheitsangriffe in diesem Zug`); }
  if (std === 'dodge') { E.addEffect(x, c, { key: 'dodge', name: 'Ausweichen', src: c.id, unique: 'any', until: { cb: c.id, at: 'start', n: c.turnNo || 0 } }); E.log(x, `🛡 ${c.name} weicht aus`); }
  if (std === 'help') { const t = targetsOf(x, ev)[0]; if (t) { E.addEffect(x, t, { key: 'helped', name: `Hilfe von ${c.name}`, src: c.id, data: { target: ev.helpTarget || null }, until: { cb: c.id, at: 'start', n: c.turnNo || 0 } }); rec.targets.push({ id: t.id, name: t.name, note: 'Vorteil auf den nächsten Angriff' }); } }
  if (std === 'hide') {
    const char = ctx.charOf(c);
    const bonus = char ? charMods(char).skills.stealth.bonus : Number((/Heimlichkeit\s*([+-]\d+)/.exec(normalizeMonster(c.statblock || {}).skills || '') || [])[1]) || s.dex;
    const n = rollDie(20);
    const total = n + bonus;
    const dc = ctx.ed === '2024' ? 15 : Math.max(10, ...x.combatants.filter((o) => side(o) !== side(c) && !E.isOut(o)).map((o) => passivePerception(o, ctx)));
    const ok = total >= dc;
    E.log(x, `🫥 ${c.name}: Heimlichkeit W20 [${n}] ${fmtS(bonus)} = ${total} gegen ${dc} → ${ok ? 'versteckt' : 'entdeckt'}`);
    if (ok) E.addCondition(x, c, { name: ctx.ed === '2024' ? E.COND.invisible : E.XCOND.hidden, breakOnAttack: true, src: c.id }, ctx);
    rec.targets.push({ id: c.id, name: c.name, note: ok ? `versteckt (${total} ≥ ${dc})` : `entdeckt (${total} < ${dc})` });
  }
  if (std === 'stand') { eco.movedM += s.speedM / 2; E.removeCondition(x, c, E.COND.prone, 'aufgestanden'); }
  if (std === 'shove') {
    const t = targetsOf(x, ev)[0];
    if (t) {
      const char = ctx.charOf(c);
      let ok;
      if (ctx.ed === '2024') {
        const dc = 8 + s.mods.str + s.pb;
        const ab = (E.statsOf(t, ctx).saves.dex || 0) > (E.statsOf(t, ctx).saves.str || 0) ? 'dex' : 'str';
        ok = !E.savingThrow(x, t, ab, dc, {}, ctx).ok;
      } else {
        const mine = rollDie(20) + (char ? charMods(char).skills.athletics.bonus : s.mods.str);
        const ts = E.statsOf(t, ctx);
        const theirs = rollDie(20) + Math.max(ts.mods.str, ts.mods.dex);
        ok = mine >= theirs;
        E.log(x, `💪 ${c.name} stößt ${t.name}: ${mine} gegen ${theirs} → ${ok ? 'geschafft' : 'misslungen'}`);
      }
      if (ok && ev.choice === 'push') rec.push = [{ id: t.id, m: 1.5 }];
      else if (ok) E.addCondition(x, t, { name: E.COND.prone, src: c.id }, ctx);
      rec.targets.push({ id: t.id, name: t.name, note: ok ? (ev.choice === 'push' ? '1,5 m weggestoßen' : 'liegt am Boden') : 'hält stand' });
    }
  }
  return rec;
}
function passivePerception(o, ctx) {
  const char = ctx.charOf(o);
  if (char) return charMods(char).passive.perception;
  const m = /Passive Wahrnehmung\s*(\d+)/i.exec(normalizeMonster(o.statblock || {}).senses || '');
  return m ? Number(m[1]) : 10 + (E.statsOf(o, ctx).mods.wis || 0);
}
function resolveFeature(x, c, a, ev, ctx) {
  const rec = { ...baseRec(ev, c, a), kind: 'effect', stage: 'done' };
  const char = ctx.charOf(c);
  const eco = (c.eco ||= E.freshEco(c, ctx));
  const k = a.key;
  if (k === 'f:rage') {
    const lv = classLevel(char, 'barbar');
    E.addEffect(x, c, { key: 'rage', name: 'Kampfrausch', src: c.id, unique: 'any', rounds: 10, data: { bonus: lv >= 16 ? 4 : lv >= 9 ? 3 : 2 } });
    E.addEffect(x, c, { key: 'resist', name: 'Kampfrausch (Resistenz)', src: c.id, rounds: 10, silent: true, data: { types: ['bludgeoning', 'piercing', 'slashing'] } });
    if (E.concOf(c)) E.endConcentration(x, c, 'Kampfrausch');
    E.log(x, `😡 ${c.name} gerät in Kampfrausch`);
  }
  if (k === 'f:reckless') E.addEffect(x, c, { key: 'reckless', name: 'Tollkühner Angriff', src: c.id, unique: 'any', until: { cb: c.id, at: 'end', n: (c.turnNo || 0) - 1 } });
  if (k === 'f:secondwind') { const lv = classLevel(char, 'kaempfer'); E.applyHealing(x, c, Number(ev.amount) || rollDie(10) + lv, { source: 'Zweiter Wind' }); }
  if (k === 'f:surge') { eco.action += 1; E.log(x, `⚡ ${c.name}: Tatendrang – eine weitere Aktion`); }
  if (k === 'f:flurry') { eco.attacks += 2; eco.flurry = true; E.log(x, `👊 ${c.name}: Schlaghagel – zwei waffenlose Schläge`); }
  if (k === 'f:martial') { eco.attacks += 1; eco.martial = true; }
  if (k === 'f:step') { eco.disengage = true; eco.moveM += E.statsOf(c, ctx).speedM; E.log(x, `🌬 ${c.name}: Schritt des Windes (Spurt + Rückzug)`); }
  if (k === 'f:patient' || k === 'f:cdash' || k === 'f:cdis' || k === 'f:chide') return resolveStd(x, c, a, ev, ctx);
  if (k === 'f:layonhands') { const t = targetsOf(x, ev)[0] || c; E.applyHealing(x, t, Number(ev.amount) || 0, { source: 'Handauflegen' }); rec.targets.push({ id: t.id, name: t.name, healed: Number(ev.amount) || 0 }); }
  if (k === 'f:bardic') {
    const t = targetsOf(x, ev)[0];
    const lv = classLevel(char, 'barde');
    if (t) { E.addEffect(x, t, { key: 'inspired', name: 'Bardische Inspiration', src: c.id, unique: 'any', rounds: 100, data: { sides: lv >= 15 ? 12 : lv >= 10 ? 10 : lv >= 5 ? 8 : 6 } }); rec.targets.push({ id: t.id, name: t.name, note: 'inspiriert' }); }
  }
  if (k === 'f:turn') {
    const tok = ctx.tokenOf(c);
    const s = E.statsOf(c, ctx);
    const dc = s.spell?.dc || 8 + s.pb + (s.mods.wis || 0);
    for (const o of x.combatants) {
      if (!/untot|undead/i.test(o.statblock?.type || '') || E.isOut(o) || !tok || !ctx.tokenOf(o) || cellDistance(tok, ctx.tokenOf(o)) * CELL_M > 9) continue;
      const sv = E.savingThrow(x, o, 'wis', dc, {}, ctx);
      if (!sv.ok) E.addCondition(x, o, { name: E.COND.frightened, src: c.id, rounds: 10, endOnDamage: true, label: 'vertrieben' }, ctx);
      rec.targets.push({ id: o.id, name: o.name, save: { ok: sv.ok, total: sv.total }, note: sv.ok ? '' : 'vertrieben' });
    }
    rec.kind = 'save'; rec.save = 'wis'; rec.dc = dc;
  }
  if (k === 'f:wildshape') {
    const m = ev.form ? monsterById(ev.form.id) : null;
    const lv = classLevel(char, 'druide');
    if (m) E.applyForm(x, c, formOf(m), ctx.ed === '2024' ? { mode: 'temp', src: 'wildshape', temp: lv, endOnIncap: true } : { mode: 'replace', src: 'wildshape' });
    rec.targets.push({ id: c.id, name: c.name, note: m ? `Tiergestalt: ${m.name}` : 'kein Tier gewählt' });
  }
  if (k === 'f:unshape') E.revertForm(x, c, 'freiwillig');
  if (k === 'f:breath') {
    const s = E.statsOf(c, ctx);
    const lv = s.level || 1;
    const dice = ctx.ed === '2024' ? `${lv >= 17 ? 4 : lv >= 11 ? 3 : lv >= 5 ? 2 : 1}d10` : `${lv >= 16 ? 5 : lv >= 11 ? 4 : lv >= 6 ? 3 : 2}d6`;
    const type = s.resist.all.find((t) => ['acid', 'cold', 'fire', 'lightning', 'poison'].includes(t)) || 'fire';
    const dc = 8 + s.pb + (s.mods.con || 0);
    rec.kind = 'save'; rec.save = 'dex'; rec.dc = dc; rec.half = true; rec.tpl = ev.tpl;
    for (const t of ev.tpl ? areaTargets(x, c, ev.tpl, ctx) : []) { const sv = E.savingThrow(x, t, 'dex', dc, {}, ctx); rec.targets.push({ id: t.id, name: t.name, save: { ok: sv.ok, total: sv.total } }); }
    rec.damage = [{ dice, flat: 0, type }];
    if (rec.targets.length) rec.stage = 'damage';
  }
  return rec;
}
function resolveMonsterAbility(x, c, a, ev, ctx) {
  const rec = { ...baseRec(ev, c, a), kind: 'save', stage: 'done', save: a.save, dc: a.dc, half: !!a.half, tpl: ev.tpl || null };
  const targets = ev.tpl ? areaTargets(x, c, ev.tpl, ctx) : targetsOf(x, ev);
  for (const t of targets) { const sv = E.savingThrow(x, t, a.save, a.dc, {}, ctx); rec.targets.push({ id: t.id, name: t.name, save: { ok: sv.ok, total: sv.total, natural: sv.natural, auto: sv.auto } }); }
  rec.damage = a.damage || [];
  if (rec.damage.length && rec.targets.length) rec.stage = 'damage';
  return rec;
}
function resolveItem(x, c, a, ev, ctx) {
  const t = targetsOf(x, ev)[0] || c;
  const amt = Number(ev.amount) || roll(a.heal).total;
  E.applyHealing(x, t, amt, { source: a.name });
  return { ...baseRec(ev, c, a), kind: 'heal', stage: 'done', targets: [{ id: t.id, name: t.name, healed: amt }] };
}
function resolveAuto(x, c, a, ev, ctx, reacts) {
  const rec = { ...baseRec(ev, c, a), kind: 'auto', stage: 'damage', magical: true };
  const alloc = ev.alloc || {};
  for (const [id, n] of Object.entries(alloc)) {
    const t = cbOf(x, id);
    if (!t) continue;
    if (reacts?.shieldMM?.[id]) { rec.targets.push({ id, name: t.name, darts: n, note: 'Schild – keine Wirkung', hit: false, shield: true }); continue; }
    rec.targets.push({ id, name: t.name, darts: n, hit: true });
  }
  rec.damage = spellDamage(a, ev.slot, a.castLevel);
  if (!rec.targets.some((t) => t.hit)) rec.stage = 'done';
  E.log(x, `✨ ${c.name}: ${a.name} – ${rec.targets.map((t) => `${t.darts}× ${t.name}`).join(', ')}`);
  return rec;
}

// ───────────────────────── Ereignisse (laufen bei der SL) ─────────────────────────
const sideFx = [];
async function flushSideFx() {
  const list = sideFx.splice(0);
  for (const f of list) { try { await f(); } catch (e) { console.warn('[Kampf]', e); } }
}
// Reaktionen vor der Auflösung abfragen: Schild/Parieren gegen Angriffe, Schild gegen Magisches Geschoss
async function gatherReactions(x0, actor, a, ev, ctx) {
  const reacts = {};
  if (a.attack && (a.kind === 'attack' || a.kind === 'granted' || a.spec?.use === 'attack' || a.spec?.use === 'summonAttack')) {
    for (const [i, tid] of (ev.targets || []).entries()) {
      const tgt = cbOf(x0, tid);
      if (!tgt || !tgt.reaction || E.incapacitated(tgt)) continue;
      const att = { ...a.attack };
      if (a.spec?.attack && att.kind?.startsWith('spell')) att.bonus = a.spellAttack;
      const plan = E.attackPlan(x0, actor, tgt, att, ctx);
      if (!plan.ok) continue;
      const rr = reconcile(ev.rolls?.[i], plan.mode);
      const total = rr.natural + att.bonus;
      const j = E.judge(plan, { natural: rr.natural, total });
      if (!j.hit || j.crit) continue;
      if (!tgt.isPC) {
        const parry = E.statsOf(tgt, ctx).reactions?.find((r) => r.kind === 'parry');
        if (parry && plan.melee && total < plan.ac + parry.ac) { reacts[i] = { parry: parry.ac }; E.log(x0, `🛡 ${tgt.name} pariert (+${parry.ac} RK)`); }
        continue;
      }
      if (total >= plan.ac + 5 || !hasShield(tgt, ctx)) continue;
      const owner = tgt.ownerUid || null;
      const ans = await askPrompt({ to: owner, local: !owner || owner === myUid() || db.mode !== 'cloud', kind: 'shield', title: 'Schild wirken?', text: `${actor.name} trifft ${tgt.name} mit ${a.name} (${total} gegen RK ${plan.ac}). Mit Schild: RK ${plan.ac + 5} – der Angriff verfehlt.`, options: [{ id: 'yes', label: 'Schild wirken (Reaktion, 1. Grad)', kind: 'primary' }, { id: 'no', label: 'Nicht nutzen' }], cb: tgt.id });
      if (ans === 'yes') { reacts[i] = { shield: true }; sideFx.push(() => useShield(tgt, ctx)); }
    }
  }
  if (a.spec?.use === 'auto') {
    reacts.shieldMM = {};
    for (const id of Object.keys(ev.alloc || {})) {
      const tgt = cbOf(x0, id);
      if (!tgt?.isPC || !tgt.reaction || !hasShield(tgt, ctx)) continue;
      const owner = tgt.ownerUid || null;
      const ans = await askPrompt({ to: owner, local: !owner || owner === myUid() || db.mode !== 'cloud', kind: 'shield', title: 'Schild wirken?', text: `${actor.name} wirkt Magisches Geschoss auf ${tgt.name}. Schild macht dich dagegen immun (+5 RK bis zu deinem nächsten Zug).`, options: [{ id: 'yes', label: 'Schild wirken', kind: 'primary' }, { id: 'no', label: 'Nicht nutzen' }], cb: tgt.id });
      if (ans === 'yes') { reacts.shieldMM[id] = true; sideFx.push(() => useShield(tgt, ctx)); }
    }
  }
  return reacts;
}
function hasShield(c, ctx) {
  const char = ctx.charOf(c);
  if (!char) return false;
  const sp = spellsCached(ctx.ed);
  const shieldId = sp?.find((s) => s.en === 'Shield')?.id || 'shield';
  const known = (char.spell?.list || []).some((e) => (e.ref === shieldId || /^Schild$/i.test(e.name || '')) && castableEntry(e));
  return known && slotOptions(char, 1).length > 0;
}
async function useShield(tgt, ctx) {
  const char = ctx.charOf(tgt);
  if (char) await consumeSlot(tgt, char, 1);
  await mutateCombat((x) => {
    const t = cbOf(x, tgt.id);
    if (!t) return x;
    t.reaction = false;
    E.addEffect(x, t, { key: 'ac', name: 'Schild (+5 RK)', src: t.id, data: { bonus: 5 }, until: { cb: t.id, at: 'start', n: t.turnNo || 0 } });
    E.log(x, `🛡 ${t.name} wirkt Schild (+5 RK bis zum nächsten Zug)`);
    return x;
  });
}
// Zauberplatz im Charakterbogen verbrauchen (niedrigster passender Grad)
export async function consumeSlot(cb, char, level, pactPref = false) {
  const opts = slotOptions(char, level);
  const o = opts.find((y) => (pactPref ? y.pact : !y.pact) && y.level === level) || opts[0];
  if (!o) return false;
  const sp = { ...(char.spell || {}) };
  if (o.pact) sp.pactUsed = (Number(sp.pactUsed) || 0) + 1;
  else sp.used = { ...(sp.used || {}), [o.level]: (Number(sp.used?.[o.level]) || 0) + 1 };
  char.spell = sp;
  await db.update(`users/${cb.ownerUid}/characters`, char.id, { spell: sp }).catch(() => {});
  return true;
}

// ───────────────────────── Monster: Beschwörung, Verwandlung ─────────────────────────
let MONSTERS = null;
async function loadMonsters() {
  if (!MONSTERS) MONSTERS = (await import('../data/monsters-srd.js')).MONSTERS;
  return MONSTERS;
}
const monsterById = (id) => (MONSTERS || []).find((m) => m.id === id) || null;
const formOf = (m) => ({ ...normalizeMonster(m), id: m.id, ...(m.speeds ? { speeds: m.speeds } : {}), ...(m.sizeKey ? { sizeKey: m.sizeKey } : {}) });
export function crNum(cr) {
  const s = String(cr ?? '0');
  if (s.includes('/')) {
    const [p, q] = s.split('/').map(Number);
    return q ? p / q : 0;
  }
  return Number(s) || 0;
}
// Welche und wie viele Kreaturen ruft ein Beschwörungszauber? → { types | ids, maxCr, count(monster), hint }
export function summonRule(a, slot) {
  const sm = a.spec?.summon;
  if (!sm) return null;
  const lvl = slot || a.level || 0;
  const up = Math.max(0, lvl - (a.level || 0));
  if (sm.table) {
    const factor = Math.max(1, ...Object.entries(sm.up || {}).filter(([l]) => lvl >= Number(l)).map(([, f]) => f));
    return {
      types: sm.types, maxCr: 2, count: (m) => (crNum(m.cr) <= 0.25 ? 8 : crNum(m.cr) <= 0.5 ? 4 : crNum(m.cr) <= 1 ? 2 : 1) * factor,
      hint: `1 Kreatur mit HG 2, 2 mit HG 1, 4 mit HG ½ oder 8 mit HG ¼${factor > 1 ? ` – durch den höheren Grad ×${factor}` : ''}.`,
    };
  }
  if (sm.ids) return { ids: sm.ids, maxCr: 99, count: () => (sm.n || 1) + up * (sm.nUp || 0), hint: '' };
  const at = Object.entries(sm.crAt || {}).filter(([l]) => lvl >= Number(l)).map(([, v]) => v);
  const maxCr = at.length ? Math.max(...at) : (sm.cr || 1) + up * (sm.crUp || 0);
  return { types: sm.types, maxCr, count: () => sm.n || 1, hint: `Eine Kreatur bis HG ${maxCr}.` };
}
// Beschworene Kreaturen als eigene Kämpfer: 2014 eine Initiative je Gruppe, 2024 direkt nach dem Wirker
function resolveSummon(x, c, a, ev, ctx, summoned) {
  const rec = { ...baseRec(ev, c, a), kind: 'effect', stage: 'done' };
  const m = monsterById(ev.summon.id);
  const rule = summonRule(a, ev.slot);
  if (!m || !rule) return rec;
  const n = Math.max(1, Math.min(Number(ev.summon.n) || 1, rule.count(m)));
  const keep = !!a.spec.summon.keep;
  const concId = a.conc ? E.startConcentration(x, c, { name: a.sp.name, spellId: a.sp.id }) : null;
  const list = combatantsFromMonsters([{ ...m, qty: n }]);
  const groupInit = x.active && ctx.ed === '2014' ? rollDie(20) + (list[0]?.initBonus || 0) : null;
  const group = ev.id || uid(6);
  list.forEach((cb, i) => {
    Object.assign(cb, {
      name: `${n > 1 ? `${m.name} ${i + 1}` : m.name} (${c.name})`, ownerUid: c.ownerUid || null, ally: side(c) === 'pc', showHp: !!c.ownerUid,
      summonOf: c.id, summonGroup: group, keep, hidden: !!c.hidden, ...(concId ? { conc: concId } : {}),
    });
    if (x.active) cb.init = ctx.ed === '2024' ? (Number(c.init) || 0) - 0.01 * (i + 1) : groupInit;
    x.combatants.push(cb);
    summoned.push({ id: cb.id, monster: m });
  });
  if (x.active) resort(x);
  E.log(x, `🐾 ${c.name} wirkt ${a.name}: ${n}× ${m.name}${x.active ? (ctx.ed === '2024' ? ' – handeln direkt nach dem Wirker' : ` – Initiative ${groupInit}`) : ''}`);
  rec.targets.push({ id: c.id, name: `${n}× ${m.name}`, note: keep ? 'dienen dir' : 'erscheinen' });
  return rec;
}
// Tokens der Beschwörung um das Zielfeld verteilen (freie, begehbare Felder)
async function placeSummonTokens(list, dest, caster) {
  const x = await loadCombat();
  const ctx = makeCtx(x);
  const g = ctx.grid;
  const casterTok = ctx.tokenOf(cbOf(x, caster.id));
  const mapId = x.mapId || battle.mapId;
  if (!mapId) return;
  const placed = [];
  const free = (px, py, n) => {
    if (px < 0 || py < 0 || (g && (px + n > g.w || py + n > g.h))) return false;
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) if (g && !g.walk[(py + dy) * g.w + px + dx]) return false;
    const over = (o) => px < o.x + (o.size || 1) && o.x < px + n && py < o.y + (o.size || 1) && o.y < py + n;
    return !ctx.tokens.some(over) && !placed.some(over);
  };
  const start = dest || (casterTok ? { x: casterTok.x + 1, y: casterTok.y } : { x: 0, y: 0 });
  const links = [];
  for (const s of list) {
    const n = sizeCells(s.monster);
    let spot = null;
    for (let r = 0; r <= 8 && !spot; r++) {
      for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && free(start.x + dx, start.y + dy, n)) spot = { x: start.x + dx, y: start.y + dy };
    }
    spot ||= { x: start.x, y: start.y };
    placed.push({ ...spot, size: n });
    const ty = creatureType(s.monster.type);
    const cb = cbOf(x, s.id);
    const tok = {
      mapId, x: spot.x, y: spot.y, size: n, label: cb?.name || s.monster.name, color: ty.color, art: { icon: monsterIconName(s.monster), color: ty.color },
      mref: { src: 'srd', id: s.monster.id }, ownerUid: caster.ownerUid || null, visibility: casterTok?.visibility || 'players', combatantId: s.id, createdAt: now(),
    };
    const tid = await db.add(col('tokens'), tok).catch(() => null);
    if (tid) links.push([s.id, tid]);
  }
  if (links.length) await mutateCombat((xx) => { for (const [cid, tid] of links) { const k = cbOf(xx, cid); if (k) k.tokenId = tid; } return xx; });
}
// Gegenzauber: Spieler in 18 m mit Sicht auf den Wirker werden gefragt (Reaktion + Zauberplatz ab Grad 3)
async function offerCounterspell(x0, actor, a, ev, ctx) {
  if (side(actor) === 'pc') return null;
  const sp = (spellsCached(ctx.ed) || []).find((s) => s.en === 'Counterspell');
  if (!sp) return null;
  const lvl = ev.slot || a.level || 0;
  const tA = ctx.tokenOf(actor);
  for (const pc of x0.combatants) {
    if (!pc.isPC || E.isOut(pc) || E.atZero(pc) || pc.reaction === false || E.incapacitated(pc) || pc.form) continue;
    const char = ctx.charOf(pc);
    if (!char || !(char.spell?.list || []).some((e) => (e.ref === sp.id || e.name === sp.name) && castableEntry(e))) continue;
    const opts = slotOptions(char, 3);
    if (!opts.length) continue;
    const tP = ctx.tokenOf(pc);
    if (tA && tP && (cellDistance(tA, tP) * CELL_M > 18 || !ctx.los(tP, tA))) continue;
    if (!E.canSee(pc, actor, ctx)) continue;
    const list = ctx.ed === '2024' ? opts.slice(0, 1) : opts;
    const options = list.map((o) => ({ id: `${o.level}${o.pact ? 'p' : ''}`, label: `Gegenzauber (${o.level}. Grad${o.pact ? ', Pakt' : ''})${ctx.ed === '2014' && o.level < lvl ? ' – mit Probe' : ''}`, kind: ctx.ed === '2024' || o.level >= lvl ? 'primary' : '' }));
    options.push({ id: 'no', label: 'Nicht nutzen' });
    const owner = pc.ownerUid || null;
    const text = `${actor.name} wirkt ${a.name}${lvl ? ` (${lvl}. Grad)` : ' (Zaubertrick)'}. Mit deiner Reaktion kannst du den Zauber aufheben${ctx.ed === '2024' ? ' – der Wirker legt dann einen KON-Rettungswurf ab.' : '.'}`;
    const ans = await askPrompt({ to: owner, local: !owner || owner === myUid() || db.mode !== 'cloud', kind: 'counter', title: 'Gegenzauber?', text, options, cb: pc.id });
    if (!ans || ans === 'no') continue;
    const level = parseInt(ans, 10) || 3;
    await consumeSlot(pc, char, level, ans.endsWith('p'));
    return { by: pc.id, name: pc.name, level, char };
  }
  return null;
}
function resolveCounter(x, c, a, ev, ctx, cs) {
  const lvl = ev.slot || a.level || 0;
  const cm = charMods(cs.char);
  const st = cm.spell[0] || { dc: 8 + cm.pb, ability: 'int' };
  let countered;
  if (ctx.ed === '2024') countered = !E.savingThrow(x, c, 'con', st.dc, { spell: true }, ctx).ok;
  else if (cs.level >= lvl) {
    countered = true;
    E.log(x, `✋ ${cs.name}: Gegenzauber (${cs.level}. Grad) – Grad reicht, automatisch aufgehoben`);
  } else {
    const mod = cm.mods[st.ability] || 0;
    const d = rollDie(20);
    countered = d + mod >= 10 + lvl;
    E.log(x, `✋ ${cs.name}: Gegenzauber-Probe W20 [${d}] ${fmtS(mod)} = ${d + mod} gegen SG ${10 + lvl} → ${countered ? 'geschafft' : 'misslungen'}`);
  }
  E.log(x, countered ? `🚫 ${a.name} von ${c.name} wird aufgehoben (Gegenzauber von ${cs.name})` : `${a.name} von ${c.name} wirkt trotz Gegenzauber`);
  return countered;
}

export async function handleAct(ev) {
  const x0 = await loadCombat();
  await ensureBattleContext(x0.mapId);
  const posOpt = ev.pos ? { override: ev.pos } : {};
  const ctx0 = makeCtx(x0, posOpt);
  const actor = cbOf(x0, ev.actor);
  if (!actor) return;
  const acts = await catalog(x0, actor, ctx0);
  const a = acts.find((y) => y.key === ev.key);
  if (!a) { await reject(ev, actor, 'Diese Aktion ist nicht (mehr) verfügbar.'); return; }
  if (!x0.active && !a.state?.prep) return;
  // Zauberplätze und Ladungen verbucht der Spieler schon im eigenen Bogen – bei Charakteren prüft die SL sie nicht noch einmal
  const clientPaid = actor.isPC && (a.state.slot || a.state.uses);
  if (ev.reaction && actor.reaction === false) { await reject(ev, actor, `${actor.name} hat keine Reaktion mehr.`); return; }
  if (!a.state.ok && !clientPaid && !(ev.reaction && (a.state.reaction || a.kind === 'attack'))) { await reject(ev, actor, a.state.why || 'Gerade nicht möglich'); return; }
  if (ev.summon || ev.form) await loadMonsters();
  // Gegenzauber: Spieler dürfen gegnerische Zauber aufheben (vor allen anderen Reaktionen)
  if (a.kind === 'spell' && x0.active) {
    const cs = await offerCounterspell(x0, actor, a, ev, ctx0);
    if (cs) {
      let countered = false;
      await mutateCombat((x) => {
        const ctx = makeCtx(x, posOpt);
        const c = cbOf(x, actor.id);
        if (!c) return x;
        const k = cbOf(x, cs.by);
        if (k) k.reaction = false;
        countered = resolveCounter(x, c, a, ev, ctx, cs);
        if (countered) {
          // 2024: der Zauberplatz des Wirkers bleibt erhalten
          payCosts(x, c, a, ctx.ed === '2024' ? { ...ev, slot: null } : ev, ctx, ctx.charOf(c));
          E.pushResult(x, { ...baseRec(ev, c, a), kind: 'effect', stage: 'done', targets: [{ id: c.id, name: c.name, note: `aufgehoben (Gegenzauber von ${cs.name})` }] });
        }
        return x;
      });
      if (countered) return;
    }
  }
  const reacts = await gatherReactions(x0, actor, a, ev, ctx0);
  let pushes = [];
  let moveTo = null;
  const summoned = [];
  await mutateCombat((x) => {
    const ctx = makeCtx(x, posOpt);
    const c = cbOf(x, actor.id);
    if (!c) return x;
    const char = ctx.charOf(c);
    payCosts(x, c, a, ev, ctx, char);
    let rec = null;
    const use = a.spec?.use;
    if (a.kind === 'std') rec = resolveStd(x, c, a, ev, ctx);
    else if (a.kind === 'feature') rec = resolveFeature(x, c, a, ev, ctx);
    else if (a.kind === 'item') rec = resolveItem(x, c, a, ev, ctx);
    else if (a.kind === 'ability') rec = resolveMonsterAbility(x, c, a, ev, ctx);
    else if (a.kind === 'granted') {
      if (a.grant?.area) rec = resolveMonsterAbility(x, c, { ...a, save: a.grant.save, dc: a.dc, half: a.grant.half, damage: [{ ...parseDmg(a.grant.dice), type: a.grant.type }] }, ev, ctx);
      else if (a.attack) rec = resolveAttacks(x, c, a, ev, ctx, reacts, side);
      else if (a.grant?.moveZone && ev.dest) { const z = (x.zones || []).find((q) => q.id === a.grant.zoneId || q.src === c.id); if (z) { z.tpl = { ...z.tpl, x: ev.dest.x + 0.5, y: ev.dest.y + 0.5 }; E.log(x, `🌀 ${c.name} bewegt ${z.name}`); } rec = { ...baseRec(ev, c, a), kind: 'effect', stage: 'done' }; }
      else if (a.grant?.condChoice) { const t = targetsOf(x, ev)[0]; if (t) { const sv = E.savingThrow(x, t, a.grant.save, a.dc, { spell: true }, ctx); if (!sv.ok) E.addCondition(x, t, { name: ev.choice || a.grant.condChoice[0], src: c.id, rounds: 10 }, ctx); rec = { ...baseRec(ev, c, a), kind: 'save', stage: 'done', save: a.grant.save, dc: a.dc, targets: [{ id: t.id, name: t.name, save: { ok: sv.ok, total: sv.total } }] }; } }
    } else if (a.kind === 'attack') rec = resolveAttacks(x, c, a, ev, ctx, reacts, side);
    else if (a.kind === 'spell') {
      if (use === 'attack' || use === 'summonAttack' || a.spec.special === 'acidArrow' || a.spec.special === 'iceKnife') {
        if (a.spec.conc) E.startConcentration(x, c, { name: a.sp.name, spellId: a.sp.id });
        rec = resolveAttacks(x, c, a, ev, ctx, reacts, side);
        if (a.spec.grant) grantAction(x, c, a, ev, E.concOf(c)?.id || null, null);
      } else if (use === 'auto') rec = resolveAuto(x, c, a, ev, ctx, reacts);
      else if (use === 'move') {
        if (ev.dest) moveTo = { id: c.id, x: ev.dest.x, y: ev.dest.y };
        rec = { ...baseRec(ev, c, a), kind: 'effect', stage: 'done', lines: [`teleportiert sich`] };
        E.log(x, `✨ ${c.name}: ${a.name} – teleportiert`);
      } else if (use === 'special' && !['hpPool', 'sleep24'].includes(a.spec.special)) rec = resolveSpecial(x, c, a, ev, ctx);
      else if (use === 'smite') {
        // 2014: Niederstrecken-Zauber wirken vorab und entladen sich beim nächsten Nahkampftreffer
        const concId = a.conc ? E.startConcentration(x, c, { name: a.sp.name, spellId: a.sp.id }) : null;
        E.addEffect(x, c, { key: 'smiteNext', name: `${a.name} (nächster Nahkampftreffer)`, src: c.id, spellId: a.sp.id, conc: concId || undefined, rounds: a.spec.rounds || 10, data: { spellId: a.sp.id, slot: ev.slot || a.level, parts: spellDamage(a, ev.slot, a.castLevel, ev.choice) } });
        E.log(x, `✨ ${c.name} wirkt ${a.name} – entlädt sich beim nächsten Nahkampftreffer`);
        rec = { ...baseRec(ev, c, a), kind: 'effect', stage: 'done' };
      }
      else if (use === 'summon') {
        if (a.spec.summon && ev.summon) rec = resolveSummon(x, c, a, ev, ctx, summoned);
        else {
          rec = { ...baseRec(ev, c, a), kind: 'effect', stage: 'done' };
          E.log(x, `🐾 ${c.name} wirkt ${a.name} – ${a.spec.note}`);
        }
      }
      else rec = resolveSpellEffects(x, c, a, ev, ctx, reacts, side);
    }
    if (rec) {
      if (rec.push) pushes = rec.push;
      E.pushResult(x, rec);
    }
    return x;
  });
  if (moveTo) await moveTokenOf(moveTo.id, moveTo.x, moveTo.y);
  if (summoned.length) await placeSummonTokens(summoned, ev.dest, actor);
  for (const p of pushes) await pushAway(ev.actor, p.id, p.m);
  await flushSideFx();
}

// Schadenswurf (vom Handelnden gewürfelt) auf die getroffenen Ziele anwenden
export async function handleDamage(ev) {
  const x0 = await loadCombat();
  const rec0 = E.resultOf(x0, ev.resultId);
  if (!rec0 || rec0.stage !== 'damage') return;
  await ensureBattleContext(x0.mapId);
  const ctx0 = makeCtx(x0);
  // Unglaubliches Ausweichen (Schurke ab 5): halber Schaden
  const halve = {};
  for (const t of rec0.targets) {
    const tgt = cbOf(x0, t.id);
    const char = tgt && ctx0.charOf(tgt);
    if (!char || !tgt.reaction || E.incapacitated(tgt) || classLevel(char, 'schurke') < 5 || rec0.kind !== 'attack' || !t.hit) continue;
    const owner = tgt.ownerUid || null;
    const ans = await askPrompt({ to: owner, local: !owner || owner === myUid() || db.mode !== 'cloud', kind: 'uncanny', title: 'Unglaubliches Ausweichen?', text: `${rec0.actorName} trifft ${tgt.name} – mit deiner Reaktion halbierst du den Schaden.`, options: [{ id: 'yes', label: 'Schaden halbieren (Reaktion)', kind: 'primary' }, { id: 'no', label: 'Nicht nutzen' }], cb: tgt.id });
    if (ans === 'yes') halve[t.id] = true;
  }
  const rebukes = [];
  await mutateCombat((x) => {
    const ctx = makeCtx(x);
    const rec = E.resultOf(x, ev.resultId);
    if (!rec || rec.stage !== 'damage') return x;
    const actor = cbOf(x, rec.actor);
    const rolls = ev.rolls || [];
    const pick = (i) => rolls.find((r) => r.i === i) || rolls.find((r) => r.i === 'all') || rolls[0];
    let drained = 0;
    rec.targets.forEach((t, i) => {
      const tgt = cbOf(x, t.id);
      if (!tgt || t.note) return;
      let hitOk;
      if (rec.kind === 'attack') hitOk = t.hit || t.halfOnMiss;
      else if (rec.kind === 'auto') hitOk = t.hit;
      else hitOk = !t.save?.ok || rec.half;
      if (!hitOk) return;
      const r = pick(i);
      if (!r) return;
      const factor = (rec.kind !== 'attack' && rec.kind !== 'auto' && t.save?.ok && rec.half) || (t.halfOnMiss && !t.hit) ? 0.5 : 1;
      const times = rec.kind === 'auto' ? Number(t.darts) || 1 : 1;
      for (let k = 0; k < times; k++) {
        const parts = r.parts.map((p) => ({ amount: Math.floor(p.amount * factor), type: p.type }));
        if (rec.disintegrate) parts.forEach((p) => { p.type = 'force'; });
        const res = E.applyDamage(x, tgt, parts, { crit: t.crit, melee: t.melee, magical: rec.magical || !!ev.magical, attacker: actor, floorOne: rec.floorOne, halve: halve[t.id] ? 'Unglaubliches Ausweichen' : null }, ctx);
        t.applied = (t.applied || 0) + res.taken;
        drained += res.taken;
        if (rec.disintegrate && tgt.hp <= 0) { E.die(x, tgt, 'zu Staub zerfallen'); t.note = 'zu Staub zerfallen'; }
      }
      if (halve[t.id]) tgt.reaction = false;
      t.hpState = tgt.isPC ? `${tgt.hp}/${tgt.maxHp}` : E.isDead(tgt) ? 'besiegt' : null;
      // Feuerschild: Nahkampfangreifer erleidet 2W8
      if (rec.kind === 'attack' && t.melee && actor) for (const fs of E.effs(tgt, 'fireShield')) { const rr = roll('2d8'); E.log(x, `🔥 Feuerschild von ${tgt.name}: ${rr.text} = ${rr.total}`); E.applyDamage(x, actor, [{ amount: rr.total, type: fs.data?.type || 'fire' }], { magical: true, attacker: tgt }, ctx); }
      if (tgt.isPC && tgt.reaction && t.applied > 0 && actor && !E.isOut(tgt)) rebukes.push({ tgt: tgt.id, actor: actor.id });
    });
    // Niederstrecken: vorab gewirkt (2014) oder nach dem Treffer gewählt (2024 / Paladin 2014)
    const firstHit = rec.targets.find((t) => t.hit && !t.note);
    if (actor && firstHit && rec.weapon && rec.attKind === 'melee') {
      const tgt = cbOf(x, firstHit.id);
      const sn = E.effs(actor, 'smiteNext')[0];
      if (sn) {
        smiteRider(x, actor, tgt, sn.data?.spellId, ctx);
        E.removeEffect(x, actor, sn.id);
      }
      if (ev.smite) {
        if (ev.smite.spellId) {
          const eco = (actor.eco ||= E.freshEco(actor, ctx));
          eco.bonus = Math.max(0, (eco.bonus || 0) - 1);
          eco.slotSpell = true;
          eco.bonusSpell = true;
          smiteRider(x, actor, tgt, ev.smite.spellId, ctx);
        }
        E.log(x, `⚡ ${actor.name}: ${ev.smite.label || 'Niederstrecken'}`);
      }
    }
    for (const e of rec.explode || []) {
      if (e.save.ok) continue;
      const tgt = cbOf(x, e.id);
      const r = pick('explode') || { parts: [{ amount: roll('2d6').total, type: 'cold' }] };
      if (tgt) E.applyDamage(x, tgt, r.parts.map((p) => ({ ...p, type: 'cold' })), { magical: true, attacker: actor }, ctx);
    }
    if (rec.drain && actor && drained) E.applyHealing(x, actor, Math.floor(drained * rec.drain), { source: 'Lebensentzug' });
    if (actor && ev.sneak) actor.eco = { ...(actor.eco || {}), sneakUsed: true };
    rec.stage = 'done';
    rec.rolled = rolls.map((r) => r.total);
    E.pushResult(x, rec);
    return x;
  });
  // Höllischer Tadel (Reaktion nach erlittenem Schaden)
  for (const rb of rebukes) await offerRebuke(rb, ctx0);
}
async function offerRebuke(rb, ctx0) {
  const x = await loadCombat();
  const ctx = makeCtx(x);
  const tgt = cbOf(x, rb.tgt);
  const att = cbOf(x, rb.actor);
  const char = tgt && ctx.charOf(tgt);
  if (!char || !tgt.reaction || !att || E.isOut(att)) return;
  const sp = spellsCached(ctx.ed)?.find((s) => s.en === 'Hellish Rebuke');
  if (!sp || !(char.spell?.list || []).some((e) => e.ref === sp.id && castableEntry(e)) || !slotOptions(char, 1).length) return;
  const owner = tgt.ownerUid || null;
  const ans = await askPrompt({ to: owner, local: !owner || owner === myUid() || db.mode !== 'cloud', kind: 'rebuke', title: 'Höllischer Tadel?', text: `${att.name} hat dir geschadet. Als Reaktion: ${att.name} muss einen GES-Rettungswurf ablegen oder erleidet 2W10 Feuerschaden (Hälfte bei Erfolg).`, options: [{ id: 'yes', label: 'Höllischer Tadel (Reaktion, 1. Grad)', kind: 'primary' }, { id: 'no', label: 'Nicht nutzen' }], cb: tgt.id });
  if (ans !== 'yes') return;
  await consumeSlot(tgt, char, 1);
  await mutateCombat((xx) => {
    const cx = makeCtx(xx);
    const t = cbOf(xx, tgt.id);
    const a = cbOf(xx, att.id);
    if (!t || !a) return xx;
    t.reaction = false;
    const dc = charMods(char).spell[0]?.dc || 13;
    const sv = E.savingThrow(xx, a, 'dex', dc, { spell: true }, cx);
    const r = roll('2d10');
    const amt = sv.ok ? Math.floor(r.total / 2) : r.total;
    E.log(xx, `🔥 ${t.name}: Höllischer Tadel – ${r.text} = ${r.total}${sv.ok ? ' (halbiert)' : ''}`);
    E.applyDamage(xx, a, [{ amount: amt, type: 'fire' }], { magical: true, attacker: t }, cx);
    E.pushResult(xx, { id: uid(8), kind: 'save', stage: 'done', actor: t.id, actorName: t.name, title: 'Höllischer Tadel', save: 'dex', dc, targets: [{ id: a.id, name: a.name, save: { ok: sv.ok, total: sv.total }, applied: amt }] });
    return xx;
  });
  void ctx0;
}

// Bewegung eines Tokens: verbrauchte Meter, Zonen und Gelegenheitsangriffe
export async function handleMove(ev) {
  const x0 = await loadCombat();
  if (!x0.active) return;
  await ensureBattleContext(x0.mapId);
  const ctx0 = makeCtx(x0);
  const mover0 = cbOf(x0, ev.actor);
  if (!mover0) return;
  const triggers = E.opportunityTriggers(x0, mover0, ev.path, ctx0);
  await mutateCombat((x) => {
    const ctx = makeCtx(x);
    const c = cbOf(x, ev.actor);
    if (!c) return x;
    const eco = (c.eco ||= E.freshEco(c, ctx));
    const cur = x.combatants[x.turn];
    if (cur?.id === c.id) eco.movedM = Math.round(((eco.movedM || 0) + (Number(ev.costM) || 0)) * 10) / 10;
    E.zoneEnter(x, c, ev.path, { ...ctx, tokenOf: (cb) => (cb.id === c.id ? { ...ctx.tokenOf(cb), x: ev.path[0][0], y: ev.path[0][1] } : ctx.tokenOf(cb)) });
    return x;
  });
  for (const tr of triggers) {
    const h = tr.cb;
    // Der Angriff trifft den Fliehenden dort, wo er die Reichweite verlässt
    const pos = { [mover0.id]: { x: ev.path[tr.at][0], y: ev.path[tr.at][1] } };
    if (h.isPC) {
      const owner = h.ownerUid || null;
      askPrompt({ to: owner, local: !owner || owner === myUid() || db.mode !== 'cloud', kind: 'oa', wait: false, title: 'Gelegenheitsangriff?', text: `${mover0.name} verlässt deine Reichweite. Mit deiner Reaktion kannst du einen Nahkampfangriff ausführen.`, options: [{ id: 'yes', label: 'Angreifen (Reaktion)', kind: 'primary' }, { id: 'no', label: 'Nicht nutzen' }], cb: h.id, target: mover0.id, pos });
    } else await monsterOpportunity(h.id, mover0.id, pos);
  }
}
// Monster nehmen Gelegenheitsangriffe automatisch wahr (bester Nahkampfangriff)
async function monsterOpportunity(hid, tid, pos = null) {
  const x0 = await loadCombat();
  const ctx = makeCtx(x0, pos ? { override: pos } : {});
  const h = cbOf(x0, hid);
  const t = cbOf(x0, tid);
  if (!h || !t || !h.reaction) return;
  const acts = await catalog(x0, h, ctx);
  const a = acts.filter((y) => y.kind === 'attack' && y.attack?.kind === 'melee').sort((p, q) => (q.attack.bonus || 0) - (p.attack.bonus || 0))[0];
  if (!a) return;
  const plan = E.attackPlan(x0, h, t, a.attack, ctx);
  if (!plan.ok) return;
  const d1 = rollDie(20);
  const d2 = plan.mode ? rollDie(20) : null;
  const ev = { id: uid(8), type: 'act', actor: h.id, key: a.key, targets: [t.id], rolls: [{ dice: d2 ? [d1, d2] : [d1] }], reaction: true, mapId: x0.mapId || battle.mapId, uid: myUid(), ...(pos ? { pos } : {}) };
  await handleAct(ev);
  const x1 = await loadCombat();
  const rec = E.resultOf(x1, ev.id);
  if (rec?.stage === 'damage') {
    const hit = rec.targets[0];
    const rolled = rollParts(rec.damage, { crit: hit?.crit, label: `${h.name}: Gelegenheitsangriff` });
    await handleDamage({ resultId: ev.id, rolls: [{ i: 'all', parts: rolled.parts, total: rolled.total }] });
  }
}
async function moveTokenOf(cbId, nx, ny) {
  const x = await loadCombat();
  const ctx = makeCtx(x);
  const t = ctx.tokenOf(cbOf(x, cbId));
  if (t) await db.update(col('tokens'), t.id, { x: nx, y: ny }).catch(() => {});
}
// Wegstoßen (Donnerwoge, Stoßen …): Feld für Feld vom Verursacher weg, bis eine Wand kommt
async function pushAway(fromId, cbId, m) {
  const x = await loadCombat();
  const ctx = makeCtx(x);
  const a = ctx.tokenOf(cbOf(x, fromId));
  const t = ctx.tokenOf(cbOf(x, cbId));
  if (!a || !t) return;
  const ca = tokenCenter(a);
  const ct = tokenCenter(t);
  const dx = Math.sign(Math.round(ct.x - ca.x));
  const dy = Math.sign(Math.round(ct.y - ca.y));
  if (!dx && !dy) return;
  let nx = t.x;
  let ny = t.y;
  const n = t.size || 1;
  const g = ctx.grid;
  for (let i = 0; i < Math.round(m / CELL_M); i++) {
    const px = nx + dx;
    const py = ny + dy;
    let ok = !g || (px >= 0 && py >= 0 && px + n <= g.w && py + n <= g.h);
    for (let yy = 0; ok && yy < n; yy++) for (let xx = 0; ok && xx < n; xx++) if (g && !g.walk[(py + yy) * g.w + px + xx]) ok = false;
    if (ok && ctx.tokens.some((o) => o.id !== t.id && px < o.x + (o.size || 1) && o.x < px + n && py < o.y + (o.size || 1) && o.y < py + n)) ok = false;
    if (!ok) break;
    nx = px;
    ny = py;
  }
  if (nx !== t.x || ny !== t.y) await db.update(col('tokens'), t.id, { x: nx, y: ny }).catch(() => {});
}

// ───────────────────────── Beim Handelnden: Verbrauch im Charakterbogen ─────────────────────────
export async function consumeOnUse(cb, char, a, ev) {
  if (!char) return;
  const patch = {};
  if (a.kind === 'spell' && a.level > 0 && !a.arcanum && ev.slot) {
    const sp = { ...(char.spell || {}) };
    if (ev.pact) sp.pactUsed = (Number(sp.pactUsed) || 0) + 1;
    else sp.used = { ...(sp.used || {}), [ev.slot]: (Number(sp.used?.[ev.slot]) || 0) + 1 };
    patch.spell = sp;
  }
  if (a.kind === 'spell' && a.conc) patch.concentration = { name: a.sp.name, id: a.sp.id };
  const resKey = a.res;
  if (resKey) {
    const n = a.key === 'f:layonhands' ? Number(ev.amount) || 0 : 1;
    patch.resUsed = { ...(char.resUsed || {}), [resKey]: (Number(char.resUsed?.[resKey]) || 0) + n };
  }
  if (a.itemId) patch.inventory = (char.inventory || []).map((it) => (it.id === a.itemId ? { ...it, qty: Math.max(0, (Number(it.qty) || 0) - 1) } : it));
  if (a.key === 'f:breath') patch.resUsed = { ...(char.resUsed || {}), breath: (Number(char.resUsed?.breath) || 0) + 1 };
  if (Object.keys(patch).length) await db.update(`users/${cb.ownerUid}/characters`, char.id, patch).catch((e) => bridge.toast(`Bogen nicht aktualisiert: ${e.message}`, 'error'));
}
// ───────────────────────── Kontext ohne offene Kampfkarte (SL-Relais, Reaktionen) ─────────────────────────
let gridCache = { mapId: null, grid: null };
export async function ensureBattleContext(mapId) {
  if (!mapId || (battle.live && battle.mapId === mapId)) return;
  const gm = app.get().role === 'gm';
  const where = gm ? [['mapId', '==', mapId]] : [['mapId', '==', mapId], ['visibility', '==', 'players']];
  const [tokens, party, map] = await Promise.all([
    db.list(col('tokens'), { where }).catch(() => []),
    loadParty().catch(() => []),
    gridCache.mapId === mapId ? null : db.get(col('maps'), mapId).catch(() => null),
  ]);
  if (gridCache.mapId !== mapId) {
    let grid = null;
    if (map?.type === 'scrawl') {
      try {
        const { buildGrid } = await import('../views/mapeditor.js');
        grid = buildGrid({ w: map.w || 36, h: map.h || 26, shapes: map.shapes || [], terrain: map.terrain || [], objects: map.objects || [], labels: [] });
      } catch { grid = null; }
    }
    gridCache = { mapId, grid };
  }
  if (battle.live && battle.mapId === mapId) return;
  Object.assign(battle, { tokens: tokens || [], party: party || [], grid: gridCache.grid, mapId, live: false });
}

// ───────────────────────── Beim Handelnden: Zielanzahl, Schaden, Niederstrecken, Reaktionen ─────────────────────────
export function targetCount(a, slot, charLevel = 1) {
  const spec = a.spec || {};
  const up = Math.max(0, (slot || a.level || 0) - (a.level || 0));
  if (spec.use === 'auto') return (spec.darts || 3) + up * (spec.dartUp || 1);
  if (spec.rays === 'eb') return 1 + (charLevel >= 5) + (charLevel >= 11) + (charLevel >= 17);
  if (spec.rays) return spec.rays + up * (spec.raysUp || 0);
  return (a.needs?.n || 1) + up * (a.needs?.up || 0);
}
// Niederstrecken nach einem Nahkampftreffer: 2024 als Bonusaktions-Zauber, 2014 als Paladin-Merkmal
export function smiteOptions(x, c, rec, ctx) {
  const char = ctx.charOf?.(c);
  if (!char || rec?.kind !== 'attack' || !rec.weapon || rec.attKind !== 'melee' || !rec.targets.some((t) => t.hit && t.melee)) return [];
  const out = [];
  if (ctx.ed === '2024') {
    if (!(c.eco?.bonus > 0) || c.eco?.slotSpell) return [];
    for (const e of char.spell?.list || []) {
      if (!castableEntry(e)) continue;
      const sp = (spellsCached(ctx.ed) || []).find((s) => s.id === e.ref);
      const spec = sp && specFor(sp, ctx.ed);
      if (!spec || spec.use !== 'smite' || out.some((o) => o.sp?.id === sp.id)) continue;
      for (const o of slotOptions(char, sp.level)) out.push({ sp, spec, slot: o.level, pact: !!o.pact, label: `${sp.name} · ${o.level}. Grad${o.pact ? ' (Pakt)' : ''}` });
    }
  } else if (classLevel(char, 'paladin') >= 2) {
    for (const o of slotOptions(char, 1)) out.push({ feature: true, slot: o.level, pact: !!o.pact, label: `Göttliches Niederstrecken · ${o.level}. Grad${o.pact ? ' (Pakt)' : ''}` });
  }
  return out;
}
export function smiteParts(opt, tgt) {
  const type = String(tgt?.statblock?.type || tgt?.art?.type || '');
  const evil = /unhold|fiend|untot|undead/i.test(type);
  if (opt.feature) return [{ dice: `${Math.min(5, 1 + opt.slot) + (evil ? 1 : 0)}d8`, flat: 0, type: 'radiant', label: 'Göttliches Niederstrecken' }];
  const spec = opt.spec || {};
  const up = Math.max(0, opt.slot - opt.sp.level);
  const parts = (spec.dmg || []).map(([d, t], i) => ({ dice: i === 0 && spec.dmgUp ? addDice(parseDmg(d).dice, spec.dmgUp, up) : parseDmg(d).dice, flat: 0, type: t, label: opt.sp.name }));
  if (spec.extraVs && spec.extraDice && new RegExp(spec.extraVs, 'i').test(type)) parts.push({ dice: spec.extraDice, flat: 0, type: parts[0]?.type || 'radiant', label: opt.sp.name });
  return parts;
}
// Welche Würfel für den Schadenswurf eines Ergebnisses? Kritisch verdoppelt nur die Würfel des jeweiligen Ziels.
export function damagePlan(x, c, rec, ctx, { sneak = true, smite = null } = {}) {
  const out = [];
  const base = (rec.damage || []).filter((p) => p.dice || p.flat);
  const pseudo = { attack: { weapon: rec.weapon, strBased: rec.strBased, finesse: rec.finesse, kind: rec.attKind || 'melee', damage: rec.damage || [] } };
  if (rec.kind === 'attack') {
    let sneakLeft = !!sneak && !c.eco?.sneakUsed;
    let smiteLeft = smite;
    rec.targets.forEach((t, i) => {
      if (t.note || !(t.hit || t.halfOnMiss)) return;
      const tgt = cbOf(x, t.id);
      const useSneak = sneakLeft && t.hit && sneakEligible(x, c, pseudo, t, ctx);
      const sm = smiteLeft && t.hit && t.melee ? smiteParts(smiteLeft, tgt) : null;
      const riders = t.hit ? riderParts(x, c, pseudo, tgt, ctx, { sneak: useSneak, smite: sm }) : [];
      if (useSneak) sneakLeft = false;
      if (sm) smiteLeft = null;
      out.push({ i, label: `${rec.title} → ${t.name}${t.crit ? ' (kritisch)' : ''}`, parts: [...base, ...riders], crit: !!t.crit, sneak: useSneak, target: t.name });
    });
  } else if (base.length) out.push({ i: 'all', label: `${rec.title} – Schaden`, parts: base, crit: false });
  if (rec.explode?.some((e) => !e.save.ok)) out.push({ i: 'explode', label: `${rec.title} – Splitter`, parts: [{ dice: addDice('2d6', '1d6', Math.max(0, (rec.level || 1) - 1)), flat: 0, type: 'cold' }], crit: false });
  return out;
}
// Schaden würfeln (3D-Würfel beim Handelnden) → Ereignis für die SL
export function rollDamage(x, c, rec, ctx, { sneak = true, smite = null, doRoll } = {}) {
  const plan = damagePlan(x, c, rec, ctx, { sneak, smite });
  const rolls = plan.map((p) => {
    const r = rollParts(p.parts, { crit: p.crit, label: p.label, doRoll });
    return { i: p.i, parts: r.parts, total: r.total };
  });
  return {
    type: 'dmg', resultId: rec.id, rolls, sneak: plan.some((p) => p.sneak), mapId: rec.mapId || null,
    smite: smite ? { spellId: smite.sp?.id || null, slot: smite.slot, pact: !!smite.pact, feature: !!smite.feature, label: smite.label } : null,
  };
}
// Gelegenheitsangriff eines Charakters (nach „Ja“ in der Rückfrage): bester Nahkampfangriff gegen den Fliehenden
export async function reactionAttack(cbId, targetId, pos = null) {
  const gm = app.get().role === 'gm';
  const raw = gm ? await loadCombat() : await db.get(col('combat'), 'public');
  if (!raw) return;
  const x = raw.combatants ? raw : { ...raw, combatants: raw.list || [], turn: -1 };
  await ensureBattleContext(x.mapId);
  const ctx = makeCtx(x, pos ? { override: pos } : {});
  const c = cbOf(x, cbId);
  const t = cbOf(x, targetId);
  if (!c || !t) return;
  const acts = await catalog(x, c, ctx);
  const a = acts.filter((y) => y.kind === 'attack' && y.attack?.kind === 'melee' && !y.offhand).sort((p, q) => (q.attack.bonus || 0) - (p.attack.bonus || 0))[0];
  if (!a) { bridge.toast('Kein Nahkampfangriff verfügbar.', 'error'); return; }
  const plan = E.attackPlan(x, c, t, a.attack, ctx);
  const { doRoll } = await import('./rolls.js');
  const r = rollAttack(a, plan, { label: `${c.name}: Gelegenheitsangriff → ${t.name}`, doRoll });
  if (!r) return;
  const { sendEvent } = await import('./relay.js');
  await sendEvent({ type: 'act', actor: c.id, key: a.key, targets: [t.id], rolls: [r], reaction: true, mapId: x.mapId || null, ...(pos ? { pos } : {}) });
}
export async function handleEndConc(ev) {
  await mutateCombat((x) => {
    const c = cbOf(x, ev.actor);
    if (c) E.endConcentration(x, c, 'freiwillig beendet');
    return x;
  });
}
// Zugwechsel mit allen Regeln (Zugende-Rettungswürfe, Zonen, Todesrettungswürfe …) auch für den Kampf-Tracker
setTurnEngine((x, ctx) => E.advance(x, ctx || makeCtx(x)));

export const newEventId = () => uid(10);
export { now };
