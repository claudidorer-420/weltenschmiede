// Kampf auf der Karte (angelehnt an Roll20): Initiativeleiste, Tokens mit Bild, TP und Zuständen, Bewegungsreichweite
// (Wände, schwieriges Gelände, Gegner blockieren), Reichweiten beim Zielen, Angriff per Klick aufs Ziel gegen die RK,
// Zauberflächen als Schablonen mit automatischen Rettungswürfen der NSC, Pings und Monster aus dem Kompendium.
import { html, useState, useEffect, useRef } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { col, myName } from '../core/app.js';
import { openView } from '../core/workspace.js';
import { db } from '../core/db.js';
import { useCol, useDoc } from '../core/hooks.js';
import { watchParty } from '../core/party.js';
import { doRoll } from '../core/rolls.js';
import { roll } from '../lib/dice.js';
import {
  mutateCombat, advanceTurn, applyHp, combatantForToken, combatantFromCharacter, combatantsFromMonsters, makeCombatant, sortByInit, resort, initRoll, hpState,
} from '../core/combat.js';
import { inbox, dropInbox, sendEvent } from '../core/relay.js';
import { normalizeMonster } from '../ui/statblock.js';
import { CONDITIONS } from '../data/rules5e.js';
import { charMods, findWeapon, weaponAttack, edOf } from '../data/chargen.js';
import { loadSpells, damageAt, fmtDice, damageName, shapeName } from '../data/spells.js';
import { WEAPON_RANGE, weaponReach } from '../data/items.js';
import { DAMAGE_ART } from '../data/artmap.js';
import {
  CELL_M, sizeCells, cellDistance, pointCellDistance, tokenCenter, reachable, pathTo, templateFor, inArea, tokensInArea, parseAttacks, saveBonus, monsterSpeed, fmtMeters,
} from '../core/tactics.js';
import { MonsterArt, SpellArt, ItemArt, GameIcon, giImage, creatureType, monsterIconName } from '../ui/art.js';
import { Icon, IconBtn, Btn, Statblock, toast, openModal, openMenu, promptDialog, confirmDialog } from '../ui/components.js';
import { now, uid, initials, clamp } from '../lib/util.js';

const TAU = Math.PI * 2;
const AB3 = { str: 'STÄ', dex: 'GES', con: 'KON', int: 'INT', wis: 'WEI', cha: 'CHA' };
const DMG_KEY = { Wucht: 'bludgeoning', Stich: 'piercing', Hieb: 'slashing' };
const moveUsed = new Map(); // `${karte}|${zug}|${token}` → verbrauchte Felder in diesem Zug
const dashOn = new Map();
const imgCache = new Map();

function imageFor(src, onload) {
  if (!src) return null;
  let im = imgCache.get(src);
  if (!im) {
    im = new Image();
    im.onload = () => onload?.();
    im.src = src;
    imgCache.set(src, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

// ───────────────────────── Zustand ─────────────────────────
function normCombat(raw, gm) {
  if (!raw) return { active: false, round: 1, list: [], curId: null, turnKey: '' };
  if (gm) {
    const list = (raw.combatants || []).map((c) => ({ ...c, hpState: hpState(c) }));
    const cur = raw.active ? list[raw.turn] : null;
    return { active: !!raw.active, round: raw.round || 1, list, curId: cur?.id || null, turnKey: `${raw.round || 1}:${cur?.id || ''}`, mapId: raw.mapId || null };
  }
  return { active: !!raw.active, round: raw.round || 1, list: raw.list || [], curId: raw.currentId || null, turnKey: `${raw.round || 1}:${raw.currentId || ''}`, mapId: raw.mapId || null };
}

export function useBattle({ cid, mapId, gm, me, tokens, grid, gridKey, redraw, rerender }) {
  const ref = useRef(null);
  if (!ref.current) ref.current = { sel: null, pending: null, hover: null, drag: null, results: [], spells: {}, placing: null, placeHidden: false, showNames: false };
  const B = ref.current;
  const raw = useDoc(cid ? col('combat') : null, gm ? 'gm' : 'public');
  const overlays = useCol(cid ? col('party') : null, { where: [['mapId', '==', mapId]] });
  const bestiary = useCol(cid && gm ? col('monsters') : null);
  const [party, setParty] = useState([]);
  const [srd, setSrd] = useState(null);
  useEffect(() => (cid ? watchParty(setParty) : undefined), [cid]);
  const needSrd = gm && tokens.some((t) => t.mref?.src === 'srd');
  useEffect(() => { if (needSrd && !srd) import('../data/monsters-srd.js').then((m) => setSrd(m.MONSTERS)); }, [needSrd]);
  Object.assign(B, { cid, mapId, gm, me, tokens, grid, gridKey, redraw, rerender, party, srd, overlays: overlays || [], bestiary: bestiary || [], combat: normCombat(raw, gm) });
  return B;
}

const charOf = (B, t) => (t?.charId ? B.party.find((p) => p.char?.id === t.charId) || null : null);
export function statFor(B, t) {
  const cb = combatantForToken(t, B.combat.list);
  if (cb?.statblock) return cb.statblock;
  if (t?.mref?.src === 'srd') return B.srd?.find((m) => m.id === t.mref.id) || null;
  if (t?.mref?.src === 'bst') return B.bestiary.find((m) => m.id === t.mref.id) || null;
  return null;
}
const sideOf = (B, t) => (t.charId || combatantForToken(t, B.combat.list)?.isPC ? 'pc' : 'npc');
const canControl = (B, t) => !!t && (B.gm || (t.ownerUid && t.ownerUid === B.me));
const isTurnOf = (B, t) => !!(B.combat.active && B.combat.curId && combatantForToken(t, B.combat.list)?.id === B.combat.curId);
const tokenOfCb = (B, cb) => B.tokens.find((t) => (t.combatantId && t.combatantId === cb.id) || (cb.charId && t.charId === cb.charId) || (cb.tokenId && cb.tokenId === t.id)) || null;
const moveKey = (B, t) => `${B.mapId}|${B.combat.turnKey}|${t.id}`;
function speedOf(B, t) {
  const pe = charOf(B, t);
  if (pe) return (Number(pe.char.speed) || 30) * 0.3;
  if (!canControl(B, t)) return null;
  const sb = statFor(B, t);
  return sb ? monsterSpeed(sb) : 9;
}
function blockedFor(B, t, W) {
  const side = sideOf(B, t);
  const set = new Set();
  for (const o of B.tokens) {
    if (o.id === t.id || sideOf(B, o) === side) continue;
    const cb = combatantForToken(o, B.combat.list);
    if (cb && (cb.hp != null ? cb.hp <= 0 : cb.down)) continue;
    const n = o.size || 1;
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) set.add((o.y + dy) * W + o.x + dx);
  }
  return set;
}
export function moveInfo(B, t, W, H) {
  const speedM = speedOf(B, t);
  if (!speedM) return null;
  const turn = isTurnOf(B, t);
  const k = moveKey(B, t);
  const dash = !!dashOn.get(k);
  const maxCells = Math.floor(speedM / CELL_M + 1e-6) * (dash ? 2 : 1);
  const used = turn ? moveUsed.get(k) || 0 : 0;
  const remaining = Math.max(0, maxCells - used);
  const key = `${t.id}|${t.x}|${t.y}|${t.size || 1}|${B.gridKey}|${remaining}|${B.combat.turnKey}|${B.tokens.map((o) => `${o.x},${o.y}`).join(';')}`;
  if (B._reach?.key === key) return B._reach;
  const r = reachable(B.grid, { x: t.x, y: t.y }, remaining, { size: t.size || 1, blocked: blockedFor(B, t, W), W, H });
  B._reach = { key, r, remaining, maxCells, used, speedM, turn, dash };
  return B._reach;
}
// Nach dem Ziehen: Bewegung prüfen und verbuchen. false = zurück an den Start
export function onTokenDrop(B, t, nx, ny, W, H) {
  if (!B.combat.active) return true;
  const info = moveInfo(B, t, W, H);
  if (!info) return true;
  if (!info.turn) {
    if (B.gm) return true;
    toast('Du bist gerade nicht am Zug.', 'error');
    return false;
  }
  const cost = info.r.dist[ny * W + nx];
  if (!Number.isFinite(cost)) {
    if (B.gm) { toast('Außerhalb der Bewegungsreichweite – als SL trotzdem versetzt.', 'info'); return true; }
    toast(`Zu weit – noch ${fmtMeters(info.remaining * CELL_M)} Bewegung.`, 'error');
    return false;
  }
  moveUsed.set(moveKey(B, t), info.used + cost);
  B._reach = null;
  return true;
}

// ───────────────────────── Aktionen ─────────────────────────
function pcActions(B, c) {
  const cm = charMods(c);
  const out = [];
  for (const k of c.weapons || []) {
    const w = findWeapon(k);
    if (!w) continue;
    const a = weaponAttack(c, w, cm.mods, cm.pb);
    const ranged = /a/.test(w.p);
    out.push({ name: a.name, kind: ranged ? 'ranged' : 'melee', bonus: a.bonus, reach: ranged ? null : weaponReach(w), range: WEAPON_RANGE[w.key] || null, damage: [{ dice: a.damage, type: DMG_KEY[w.type] }], art: { item: { name: w.name, ref: `w:${w.key}` } } });
  }
  out.push({ name: 'Waffenloser Schlag', kind: 'melee', bonus: cm.mods.str + cm.pb, reach: 1.5, damage: [{ dice: String(Math.max(1, 1 + cm.mods.str)), type: 'bludgeoning' }], art: { item: { name: 'Faust', icon: 'fist' } } });
  const ed = edOf(c);
  const spells = B.spells[ed];
  if (!spells) {
    loadSpells(ed).then((l) => { B.spells[ed] = l; B.rerender(); });
    return out;
  }
  for (const e of c.spell?.list || []) {
    if (!(e.level === 0 || e.prepared || e.always || e.arcanum || e.source)) continue;
    const sp = spells.find((s) => s.id === e.ref);
    const st = cm.spell.find((x) => x.cls === e.cls) || cm.spell[0];
    if (!sp || !st) continue;
    const d = damageAt(sp, { charLevel: cm.level });
    const damage = d ? [{ dice: d.dice, type: d.type }] : [];
    const base = { name: sp.name, level: sp.level, art: { spell: sp }, half: /Hälfte|halb so viel/i.test((sp.desc || []).join(' ')) };
    if (sp.area && (sp.save || d)) out.push({ ...base, kind: 'area', save: sp.save, dc: st.dc, damage, area: sp.area, rangeKind: sp.rangeKind, rangeM: sp.rangeM });
    else if (sp.attack && d) out.push({ ...base, kind: sp.attack === 'melee' ? 'melee' : 'ranged', bonus: st.attack, reach: sp.rangeKind === 'touch' || sp.rangeKind === 'self' ? 1.5 : null, range: sp.rangeM ? [sp.rangeM, sp.rangeM] : null, damage });
    else if (sp.save && d) out.push({ ...base, kind: 'save', save: sp.save, dc: st.dc, damage, range: sp.rangeM ? [sp.rangeM, sp.rangeM] : [1.5, 1.5] });
  }
  return out;
}
export function actionsFor(B, t) {
  if (!canControl(B, t)) return [];
  const pe = charOf(B, t);
  if (pe) return pcActions(B, pe.char);
  const sb = statFor(B, t);
  return sb ? parseAttacks(normalizeMonster(sb)) : [];
}
const normRange = (a) => (a.kind === 'melee' ? a.reach || 1.5 : a.range ? a.range[0] : a.reach || a.rangeM || 1.5);
const maxRange = (a) => (a.kind === 'melee' ? a.reach || 1.5 : a.range ? a.range[1] : a.reach || a.rangeM || 1.5);
function actSub(a) {
  const dmg = (a.damage || []).map((d) => fmtDice(d.dice)).join(' + ');
  const m = (v) => String(v).replace('.', ',');
  if (a.kind === 'area') return `SG ${a.dc} ${AB3[a.save] || ''}${a.area ? ` · ${m(a.area.size)} m ${shapeName(a.area.shape)}` : ''}${dmg ? ` · ${dmg}` : ''}`;
  if (a.kind === 'save') return `SG ${a.dc} ${AB3[a.save] || ''} · ${fmtMeters(maxRange(a))}${dmg ? ` · ${dmg}` : ''}`;
  return `${a.bonus >= 0 ? '+' : ''}${a.bonus} · ${a.range ? `${a.range.map(m).join('/')} m` : fmtMeters(a.reach || 1.5)}${dmg ? ` · ${dmg}` : ''}`;
}

export function arm(B, t, a, i) {
  B.pending = t && a ? { t: t.id, att: a, i } : null;
  B.rerender();
  B.redraw();
}
export function selectToken(B, id) {
  B.sel = id;
  B.pending = null;
  B.rerender();
  B.redraw();
}

function acOf(B, t, cb) {
  if (!t) return null;
  if (B.gm) {
    if (cb?.ac != null) return Number(cb.ac);
    const sb = statFor(B, t);
    return sb ? parseInt(normalizeMonster(sb).ac, 10) || null : null;
  }
  const pe = charOf(B, t);
  if (pe) return pe.char.ac ?? null;
  return cb?.ac ?? null;
}
function targetEntry(B, t, att) {
  const cb = combatantForToken(t, B.combat.list);
  const pc = !!(t.charId || cb?.isPC);
  let save = null;
  if (B.gm && att.save && !pc) {
    const sb = statFor(B, t);
    const bonus = sb ? saveBonus(normalizeMonster(sb), att.save) : 0;
    const total = roll(`1d20${bonus >= 0 ? '+' : ''}${bonus}`).total;
    save = { total, ok: total >= att.dc };
  }
  return { tokId: t.id, cbId: cb?.id || null, name: t.label, pc, save, mult: save ? (save.ok ? (att.half ? 0.5 : 0) : 1) : 1 };
}
function pushResult(B, res) {
  B.results = [...B.results, res].slice(-6);
}
function report(B, res, a) {
  if (B.gm) return;
  const dmg = res.dmg != null ? ` · ${res.dmg} ${damageName(res.dmgType)}` : '';
  const summary = res.kind === 'attack'
    ? `${a.label} → ${res.target}: ${res.att} ${res.total}${res.long ? ' (Nachteil)' : ''}${dmg}`
    : `${a.label}: ${res.att}${dmg}${res.dc ? ` · SG ${res.dc} ${AB3[res.save] || ''}` : ''}`;
  const { targets, ...rest } = res;
  sendEvent({ ...rest, type: res.kind, byName: myName(), summary, targetIds: (targets || []).map((x) => x.tokId) }).catch(() => {});
}

async function resolveTarget(B, target) {
  const p = B.pending;
  const a = B.tokens.find((x) => x.id === p.t);
  if (!a) return;
  const att = p.att;
  if (target.id === a.id) { toast('Wähle ein anderes Ziel.', 'info'); return; }
  const distM = cellDistance(a, target) * CELL_M;
  if (distM > maxRange(att) + 1e-6) { toast(`Außer Reichweite: ${fmtMeters(distM)} (höchstens ${fmtMeters(maxRange(att))})`, 'error'); return; }
  const long = att.kind === 'ranged' && att.range && distM > att.range[0] + 1e-6;
  const cbT = combatantForToken(target, B.combat.list);
  const res = { id: uid(8), mapId: B.mapId, by: a.label, target: target.label, tokId: target.id, cbId: cbT?.id || null, att: att.name, uid: B.me, ts: now() };
  if (att.kind === 'save') {
    const dmg = att.damage?.length ? doRoll(att.damage.map((d) => d.dice).join('+'), { label: `${a.label}: ${att.name} → ${target.label}`, kind: 'damage' }) : null;
    Object.assign(res, { kind: 'area', save: att.save, dc: att.dc, half: att.half, dmg: dmg?.total ?? null, dmgType: att.damage?.[0]?.type || null, targets: [targetEntry(B, target, att)] });
  } else {
    const ac = acOf(B, target, cbT);
    const r = doRoll(`1d20${att.bonus >= 0 ? '+' : ''}${att.bonus}`, { label: `${a.label} → ${target.label}: ${att.name}${long ? ' (lange Reichweite)' : ''}`, kind: 'attack', fx: long ? { dis: true } : {} });
    if (!r) return;
    const hit = r.crit ? true : r.fumble ? false : ac != null ? r.total >= ac : null;
    let dmg = null;
    if (hit !== false && att.damage?.length) dmg = doRoll(att.damage.map((d) => d.dice).join('+'), { label: `${att.name} – Schaden${r.crit ? ' (kritisch)' : ''}`, kind: 'damage', fx: r.crit ? { crit: true } : {} });
    Object.assign(res, { kind: 'attack', total: r.total, crit: !!r.crit, fumble: !!r.fumble, ac, hit, long: !!long, dmg: dmg?.total ?? null, dmgType: att.damage?.[0]?.type || null });
  }
  pushResult(B, res);
  report(B, res, a);
  B.pending = null;
  B.rerender();
  B.redraw();
}

const roundTpl = (t) => ({ shape: t.shape, x: Math.round(t.x * 100) / 100, y: Math.round(t.y * 100) / 100, dir: Math.round((t.dir || 0) * 1000) / 1000, size: Math.round(t.size * 100) / 100, ...(t.width ? { width: t.width } : {}) });
async function placeArea(B, w, W, H) {
  const p = B.pending;
  const a = B.tokens.find((x) => x.id === p.t);
  if (!a) return;
  const att = p.att;
  const tpl = templateFor(att.area, a, w, att.rangeKind);
  if (att.rangeKind === 'dist' && att.rangeM) {
    const d = pointCellDistance(a, tpl.x, tpl.y) * CELL_M;
    if (d > att.rangeM + 1e-6) { toast(`Außer Reichweite: ${fmtMeters(d)} (höchstens ${fmtMeters(att.rangeM)})`, 'error'); return; }
  }
  const hit = tokensInArea(tpl, B.tokens.filter((t) => !(tpl.shape === 'emanation' && t.id === a.id)));
  const dmg = att.damage?.length ? doRoll(att.damage.map((d) => d.dice).join('+'), { label: `${a.label}: ${att.name}`, kind: 'damage' }) : null;
  const color = DAMAGE_ART[att.damage?.[0]?.type]?.color || '#b07cff';
  let tplId = null;
  try { tplId = await db.add(col('party'), { kind: 'tpl', mapId: B.mapId, ...roundTpl(tpl), color, label: att.name, uid: B.me, ts: now() }); } catch { /* ohne Schablone weiter */ }
  const res = { id: uid(8), kind: 'area', mapId: B.mapId, by: a.label, att: att.name, save: att.save || null, dc: att.dc || null, half: !!att.half, dmg: dmg?.total ?? null, dmgType: att.damage?.[0]?.type || null, tpl: roundTpl(tpl), tplId, uid: B.me, targets: hit.map((t) => targetEntry(B, t, att)), ts: now() };
  pushResult(B, res);
  report(B, res, a);
  B.pending = null;
  B.rerender();
  B.redraw();
}

// Klick auf die Karte während des Zielens. true = verarbeitet
export function onDown(B, w, W, H) {
  if (!B?.pending) return false;
  if (B.pending.att.kind === 'area') { placeArea(B, w, W, H); return true; }
  const t = [...B.tokens].reverse().find((x) => w.x >= x.x && w.x < x.x + (x.size || 1) && w.y >= x.y && w.y < x.y + (x.size || 1));
  if (t) resolveTarget(B, t);
  else toast('Tippe auf einen Token als Ziel – oder „Abbrechen“.', 'info');
  return true;
}

async function applyAttack(B, r, mult) {
  if (r.dmg == null) return;
  const t = B.tokens.find((x) => x.id === r.tokId);
  const id = r.cbId || combatantForToken(t, B.combat.list)?.id;
  if (!id) { toast('Das Ziel ist nicht im Kampf – erst „Kampf starten“ oder „In den Kampf“.', 'error'); return; }
  const amount = Math.floor(r.dmg * mult);
  await mutateCombat((x) => { applyHp(x, id, -amount); return x; });
  toast(`${r.target}: −${amount} TP`, 'success');
  closeResult(B, r);
}
async function applyArea(B, r) {
  await mutateCombat((x) => {
    for (const tg of r.targets || []) {
      const id = tg.cbId || combatantForToken(B.tokens.find((t) => t.id === tg.tokId), x.combatants)?.id;
      if (id && r.dmg) applyHp(x, id, -Math.floor(r.dmg * tg.mult));
    }
    return x;
  });
  toast('Schaden verteilt', 'success');
  closeResult(B, r);
}
function closeResult(B, r) {
  B.results = B.results.filter((x) => x.id !== r.id);
  dropInbox(r.id);
  B.rerender();
}
export async function clearTemplates(B, { mine = false } = {}) {
  for (const o of B.overlays.filter((x) => x.kind === 'tpl' && (!mine || x.uid === B.me))) await db.remove(col('party'), o.id).catch(() => {});
}

export async function ping(B, w) {
  if (!B) return;
  const doc = { kind: 'ping', mapId: B.mapId, x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100, name: myName(), color: B.gm ? '#e0b24a' : '#4d8dff', ts: now() };
  B.localPing = doc;
  B.redraw();
  try { await db.set(col('party'), `ping-${B.me}`, doc); } catch { /* egal */ }
}
export const animating = (B) => !!B && (B.combat.active || [B.localPing, ...B.overlays.filter((o) => o.kind === 'ping')].some((p) => p && now() - p.ts < 2800));

// ───────────────────────── Kampf verwalten (SL) ─────────────────────────
export async function startCombat(B) {
  const toks = B.tokens.filter((t) => t.charId || t.mref || t.combatantId);
  if (!toks.length) { toast('Setze zuerst Tokens: „Gruppe“ oder Monster aus dem Kompendium.', 'error'); return; }
  if (toks.some((t) => t.mref?.src === 'srd') && !B.srd) B.srd = (await import('../data/monsters-srd.js')).MONSTERS;
  const links = [];
  await mutateCombat((x) => {
    x.mapId = B.mapId;
    for (const t of toks) {
      if (combatantForToken(t, x.combatants)) continue;
      let c = null;
      if (t.charId) { const pe = charOf(B, t); if (pe) c = combatantFromCharacter(pe); } else {
        const sb = statFor(B, t);
        c = sb ? combatantsFromMonsters([{ ...sb, name: t.label, qty: 1 }])[0] : makeCombatant({ name: t.label });
      }
      if (!c) continue;
      c.tokenId = t.id;
      c.hidden = t.visibility === 'gm';
      x.combatants.push(c);
      if (!t.charId) links.push([t.id, c.id]);
    }
    for (const c of x.combatants) if (c.init == null) c.init = initRoll(c);
    x.combatants = sortByInit(x.combatants);
    x.active = true;
    x.round = 1;
    x.turn = 0;
    x.log.push({ ts: now(), text: '⚔️ Kampf beginnt' });
    if (x.combatants[0]) x.log.push({ ts: now(), text: `${x.combatants[0].name} ist am Zug` });
    return x;
  });
  for (const [tid, c2] of links) await db.update(col('tokens'), tid, { combatantId: c2 }).catch(() => {});
  toast('Kampf gestartet – Initiative ist gewürfelt.', 'success');
}
export async function addTokenToCombat(B, t, sbIn = null) {
  const sb = sbIn || statFor(B, t);
  let newId = null;
  await mutateCombat((x) => {
    if (combatantForToken(t, x.combatants)) return x;
    let c;
    if (t.charId) { const pe = charOf(B, t); if (!pe) return x; c = combatantFromCharacter(pe); } else c = sb ? combatantsFromMonsters([{ ...sb, name: t.label, qty: 1 }])[0] : makeCombatant({ name: t.label });
    c.tokenId = t.id;
    c.hidden = t.visibility === 'gm';
    if (x.active) c.init = initRoll(c);
    x.combatants.push(c);
    newId = c.id;
    if (x.active) resort(x);
    x.log.push({ ts: now(), text: `${c.name} betritt den Kampf` });
    return x;
  });
  if (newId && !t.charId) await db.update(col('tokens'), t.id, { combatantId: newId }).catch(() => {});
}
export async function placeMonster(B, w, W, H) {
  const m = B.placing;
  if (!m) return;
  const n = sizeCells(m);
  const same = B.tokens.filter((t) => t.mref?.id === m.id).length;
  const ty = creatureType(m.type);
  const tok = {
    mapId: B.mapId, x: clamp(Math.floor(w.x - (n - 1) / 2), 0, W - n), y: clamp(Math.floor(w.y - (n - 1) / 2), 0, H - n), label: same ? `${m.name} ${same + 1}` : m.name, size: n,
    color: ty.color, art: { icon: monsterIconName(m), color: ty.color }, mref: { src: m.src, id: m.id }, ownerUid: null, visibility: B.placeHidden ? 'gm' : 'players', createdAt: now(),
  };
  const id = await db.add(col('tokens'), tok);
  if (B.combat.active) await addTokenToCombat(B, { ...tok, id }, m);
}
const nextTurn = () => mutateCombat((x) => advanceTurn(x));
const prevTurn = () => mutateCombat((x) => {
  if (!x.combatants.length) return x;
  x.turn--;
  if (x.turn < 0) { x.turn = x.combatants.length - 1; x.round = Math.max(1, (x.round || 1) - 1); }
  return x;
});
async function endCombat() {
  if (!(await confirmDialog('Kampf beenden? Die Kämpferliste bleibt im Kampf-Tracker erhalten.', { ok: 'Beenden' }))) return;
  await mutateCombat((x) => { x.active = false; x.turn = 0; x.log.push({ ts: now(), text: 'Kampf beendet' }); return x; });
}
async function hpQuick(t, cb) {
  if (!cb) { toast('Erst in den Kampf aufnehmen.', 'error'); return; }
  const v = await promptDialog(`Trefferpunkte von ${t.label} ändern`, '', { title: 'Trefferpunkte', hint: 'z. B. -7 für Schaden oder +5 für Heilung', ok: 'Anwenden' });
  const n = parseInt(String(v || '').replace('−', '-'), 10);
  if (n) await mutateCombat((x) => { applyHp(x, cb.id, n); return x; });
}
function condMenu(cb, e) {
  if (!cb) return;
  openMenu(e, CONDITIONS.map((k) => {
    const on = (cb.conditions || []).some((c) => c.name === k.name);
    return {
      label: k.name, icon: on ? 'check' : k.icon || 'activity',
      onClick: () => mutateCombat((x) => {
        const c = x.combatants.find((y) => y.id === cb.id);
        if (c) c.conditions = on ? (c.conditions || []).filter((y) => y.name !== k.name) : [...(c.conditions || []), { name: k.name, rounds: 0 }];
        return x;
      }),
    };
  }));
}

// ───────────────────────── Zeichnen ─────────────────────────
function disk(c, x, y, r, fill, stroke, lw) {
  c.beginPath();
  c.arc(x, y, Math.max(0.01, r), 0, TAU);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
}
function wtext(c, str, x, y, size, fill, halo, weight = 700) {
  c.save();
  c.scale(0.01, 0.01);
  c.font = `${weight} ${size * 100}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (halo) { c.lineWidth = size * 20; c.lineJoin = 'round'; c.strokeStyle = halo; c.strokeText(str, x * 100, y * 100); }
  c.fillStyle = fill;
  c.fillText(str, x * 100, y * 100);
  c.restore();
}
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
}
function lighten(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex || '#888';
  const n = parseInt(m[1], 16);
  const mix = (v) => Math.round(v + (255 - v) * 0.25);
  return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}
function tplPath(c, t) {
  c.beginPath();
  if (t.shape === 'cube') c.rect(t.x - t.size / 2, t.y - t.size / 2, t.size, t.size);
  else if (t.shape === 'cone') {
    const a = Math.atan(0.5);
    c.moveTo(t.x, t.y);
    c.arc(t.x, t.y, t.size, (t.dir || 0) - a, (t.dir || 0) + a);
    c.closePath();
  } else if (t.shape === 'line') {
    const ux = Math.cos(t.dir || 0);
    const uy = Math.sin(t.dir || 0);
    const px = -uy * (t.width || 1) / 2;
    const py = ux * (t.width || 1) / 2;
    c.moveTo(t.x + px, t.y + py);
    c.lineTo(t.x + ux * t.size + px, t.y + uy * t.size + py);
    c.lineTo(t.x + ux * t.size - px, t.y + uy * t.size - py);
    c.lineTo(t.x - px, t.y - py);
    c.closePath();
  } else c.arc(t.x, t.y, t.size, 0, TAU);
}
function drawTpl(ctx, t, color, W, H, k, label) {
  // betroffene Felder leicht einfärben (so zählt das Raster), darüber die genaue Form
  ctx.fillStyle = `${color}33`;
  const x0 = Math.max(0, Math.floor(t.x - t.size - 1));
  const x1 = Math.min(W - 1, Math.ceil(t.x + t.size + 1));
  const y0 = Math.max(0, Math.floor(t.y - t.size - 1));
  const y1 = Math.min(H - 1, Math.ceil(t.y + t.size + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inArea(t, x + 0.5, y + 0.5)) ctx.fillRect(x, y, 1, 1);
  tplPath(ctx, t);
  ctx.fillStyle = `${color}22`;
  ctx.fill();
  ctx.lineWidth = 2.5 / k;
  ctx.strokeStyle = color;
  ctx.stroke();
  if (label) wtext(ctx, label, t.x, t.y - 0.1, 0.36, '#fff', 'rgba(0,0,0,.7)');
}
function drawToken(ctx, B, t, k, tm, selected) {
  const n = t.size || 1;
  const x = t.dragX ?? t.x;
  const y = t.dragY ?? t.y;
  const cx = x + n / 2;
  const cy = y + n / 2;
  const r = n / 2 - 0.07;
  const cb = combatantForToken(t, B.combat.list);
  const pe = charOf(B, t);
  const pc = !!(pe || cb?.isPC || t.charId);
  const down = cb ? (cb.hp != null ? cb.hp <= 0 : !!cb.down) : false;
  const ring = pc ? '#4d8dff' : t.art || t.mref || cb ? '#d64541' : t.color || '#e0b24a';
  ctx.globalAlpha = t.visibility === 'players' ? 1 : 0.6;
  if (cb && cb.id === B.combat.curId) {
    const pulse = 0.5 + 0.5 * Math.sin(tm / 260);
    disk(ctx, cx, cy, r + 0.12 + pulse * 0.08, 'rgba(224,178,74,.22)', '#e0b24a', (2 + pulse * 2) / k);
  }
  disk(ctx, cx + 0.03, cy + 0.06, r, 'rgba(0,0,0,.35)');
  const img = pe?.char?.portrait ? imageFor(pe.char.portrait, B.redraw) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  else if (t.art?.icon) {
    const g = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, lighten(t.art.color));
    g.addColorStop(1, '#120e0a');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const ic = giImage(t.art.icon, '#f6e8c9', B.redraw);
    if (ic?.complete && ic.naturalWidth) ctx.drawImage(ic, cx - r * 0.7, cy - r * 0.7, r * 1.4, r * 1.4);
  } else {
    ctx.fillStyle = t.color || '#e0b24a';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    wtext(ctx, initials(t.label).slice(0, 2), cx, cy + 0.02, Math.max(0.28, r * 0.8), '#111');
  }
  if (down) { ctx.fillStyle = 'rgba(20,20,20,.6)'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
  ctx.restore();
  disk(ctx, cx, cy, r, null, t.ownerUid && t.ownerUid === B.me ? '#ffffff' : ring, 0.08);
  if (down) wtext(ctx, '☠', cx, cy + 0.03, r * 1.1, '#f1f1f1', 'rgba(0,0,0,.6)');
  if (cb?.concentration) { ctx.setLineDash([0.12, 0.1]); disk(ctx, cx, cy, r + 0.1, null, '#f5c542', 0.05); ctx.setLineDash([]); }
  if (cb && (cb.hp != null || cb.hpState)) {
    const frac = cb.hp != null && cb.maxHp ? Math.max(0, Math.min(1, cb.hp / cb.maxHp)) : ({ Unverletzt: 1, Angeschlagen: 0.7, Blutig: 0.4, Kritisch: 0.15, Kampfunfähig: 0 })[cb.hpState] ?? 1;
    const bw = n * 0.84;
    const bx = cx - bw / 2;
    const by = y + n - 0.04;
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(bx, by, bw, 0.14);
    ctx.fillStyle = frac > 0.5 ? '#3dd68c' : frac > 0.25 ? '#f5c542' : '#ef5a5f';
    ctx.fillRect(bx + 0.02, by + 0.025, (bw - 0.04) * frac, 0.09);
  }
  (cb?.conditions || []).slice(0, 4).forEach((cd, i) => {
    const a = -Math.PI / 4 - i * 0.6;
    const px = cx + Math.cos(a) * (r + 0.02);
    const py = cy + Math.sin(a) * (r + 0.02);
    disk(ctx, px, py, 0.13, '#8a5cf5', '#fff', 0.03);
    wtext(ctx, String(cd.name || cd).slice(0, 1), px, py + 0.01, 0.15, '#fff');
  });
  if (selected) { ctx.setLineDash([0.15, 0.1]); disk(ctx, cx, cy, r + 0.2, null, '#8a5cf5', 0.07); ctx.setLineDash([]); }
  if (selected || B.showNames) wtext(ctx, t.label, cx, y - 0.24, 0.32, '#fff', 'rgba(0,0,0,.75)');
  ctx.globalAlpha = 1;
}

// Alles, was der Kampf auf die Karte zeichnet (in Feld-Koordinaten)
export function drawBattle(ctx, s, k) {
  const B = s.B;
  if (!B) return;
  const W = s.doc.w;
  const H = s.doc.h;
  const tm = performance.now();
  const hidden = (t) => !B.gm && s.fogOn && s.fog && s.fog[Math.floor(t.y) * W + Math.floor(t.x)] !== '1';
  const vis = B.tokens.filter((t) => !hidden(t));
  for (const o of B.overlays) if (o.kind === 'tpl') drawTpl(ctx, o, o.color || '#b07cff', W, H, k, o.label);
  const selT = B.sel ? B.tokens.find((t) => t.id === B.sel) : null;
  if (selT && !B.pending && canControl(B, selT) && !B.drag) {
    const info = moveInfo(B, selT, W, H);
    if (info) {
      ctx.fillStyle = info.turn ? 'rgba(61,214,140,.18)' : 'rgba(77,141,255,.12)';
      const { dist } = info.r;
      for (let i = 0; i < dist.length; i++) if (dist[i] <= info.remaining) ctx.fillRect(i % W, Math.floor(i / W), 1, 1);
    }
  }
  if (B.pending && selT) {
    const att = B.pending.att;
    const n = selT.size || 1;
    if (att.kind !== 'area' || att.rangeKind === 'dist') {
      const rN = (att.kind === 'area' ? att.rangeM : normRange(att)) / CELL_M;
      const rL = (att.kind === 'area' ? att.rangeM : maxRange(att)) / CELL_M;
      rrect(ctx, selT.x - rN, selT.y - rN, n + rN * 2, n + rN * 2, 0.4);
      ctx.fillStyle = 'rgba(77,141,255,.08)';
      ctx.fill();
      ctx.lineWidth = 2.5 / k;
      ctx.strokeStyle = '#4d8dff';
      ctx.stroke();
      if (rL > rN + 0.01) {
        ctx.setLineDash([8 / k, 6 / k]);
        rrect(ctx, selT.x - rL, selT.y - rL, n + rL * 2, n + rL * 2, 0.4);
        ctx.lineWidth = 2 / k;
        ctx.strokeStyle = '#f5c542';
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (att.kind !== 'area') {
      for (const t of vis) {
        if (t.id === selT.id) continue;
        const dM = cellDistance(selT, t) * CELL_M;
        const cc = tokenCenter(t);
        const colr = dM <= normRange(att) + 1e-6 ? '#3dd68c' : dM <= maxRange(att) + 1e-6 ? '#f5c542' : null;
        if (colr) disk(ctx, cc.x, cc.y, (t.size || 1) / 2 + 0.08, null, colr, 3.5 / k);
      }
    }
  }
  for (const t of vis) drawToken(ctx, B, t, k, tm, t.id === B.sel);
  if (B.drag) {
    const { t, x, y } = B.drag;
    const info = moveInfo(B, t, W, H);
    const n = t.size || 1;
    const path = info && pathTo(info.r, x, y);
    if (path && path.length > 1) {
      ctx.strokeStyle = info.turn ? '#3dd68c' : '#4d8dff';
      ctx.lineWidth = 4 / k;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      path.forEach(([px, py], i) => { if (i) ctx.lineTo(px + n / 2, py + n / 2); else ctx.moveTo(px + n / 2, py + n / 2); });
      ctx.stroke();
      const cost = info.r.dist[y * W + x];
      wtext(ctx, info.turn ? `${fmtMeters(cost * CELL_M)} · noch ${fmtMeters((info.remaining - cost) * CELL_M)}` : fmtMeters(cost * CELL_M), x + n / 2, y - 0.4, 0.36, '#fff', 'rgba(0,0,0,.8)');
    } else if (info && B.combat.active && info.turn && (x !== t.x || y !== t.y)) wtext(ctx, 'zu weit', x + n / 2, y - 0.4, 0.36, '#ef5a5f', 'rgba(0,0,0,.8)');
  }
  if (B.pending?.att.kind === 'area' && selT && B.hover) {
    const att = B.pending.att;
    const tpl = templateFor(att.area, selT, B.hover, att.rangeKind);
    const colr = DAMAGE_ART[att.damage?.[0]?.type]?.color || '#b07cff';
    drawTpl(ctx, tpl, colr, W, H, k);
    for (const t of tokensInArea(tpl, vis)) {
      if (tpl.shape === 'emanation' && t.id === selT.id) continue;
      const cc = tokenCenter(t);
      disk(ctx, cc.x, cc.y, (t.size || 1) / 2 + 0.08, null, '#ff5a5a', 3.5 / k);
    }
  }
  for (const p of [...B.overlays.filter((o) => o.kind === 'ping'), B.localPing]) {
    if (!p) continue;
    const age = (now() - p.ts) / 1000;
    if (age < -1 || age > 2.6) continue;
    for (let i = 0; i < 3; i++) {
      const a = (Math.max(0, age) * 1.2 + i * 0.33) % 1;
      ctx.globalAlpha = (1 - a) * 0.9;
      disk(ctx, p.x, p.y, 0.3 + a * 2.2, null, p.color || '#e0b24a', 3.5 / k);
    }
    ctx.globalAlpha = 1;
    if (age < 2) wtext(ctx, p.name || '', p.x, p.y - 0.9, 0.4, '#fff', 'rgba(0,0,0,.7)');
  }
}

// ───────────────────────── Oberfläche ─────────────────────────
function TokenArt({ B, t, cb, size = 32 }) {
  const pe = t ? charOf(B, t) : null;
  if (pe?.char?.portrait) return html`<span class="bt-art" style=${{ width: `${size}px`, height: `${size}px`, backgroundImage: `url(${pe.char.portrait})` }}></span>`;
  const sb = B.gm && t ? statFor(B, t) : null;
  if (sb) return html`<${MonsterArt} m=${sb} size=${size} />`;
  if (cb?.statblock) return html`<${MonsterArt} m=${cb.statblock} size=${size} />`;
  if (cb?.art) return html`<${MonsterArt} m=${cb.art} size=${size} />`;
  if (t?.art) return html`<${MonsterArt} m=${{ name: t.label, icon: t.art.icon, color: t.art.color }} size=${size} />`;
  return html`<span class="bt-art ini" style=${{ width: `${size}px`, height: `${size}px`, background: t?.color || cb?.color || '#7a7a7a' }}>${initials(t?.label || cb?.name || '?').slice(0, 2)}</span>`;
}

function TurnStrip({ B, s }) {
  const c = B.combat;
  const list = c.list.filter((x) => B.gm || !x.hidden);
  const cur = list.find((x) => x.id === c.curId);
  const mine = cur && cur.ownerUid && cur.ownerUid === B.me;
  const myCb = list.find((x) => x.isPC && x.ownerUid === B.me);
  const rollMyInit = () => {
    const pe = B.party.find((p) => p.char?.id === myCb.charId);
    const bonus = pe ? charMods(pe.char).init : 0;
    const r = doRoll(`1d20${bonus >= 0 ? '+' : ''}${bonus}`, { label: 'Initiative', character: myCb.name, kind: 'init' });
    if (r) sendEvent({ type: 'init', value: r.total, charId: myCb.charId || null });
  };
  return html`<div class="bt-strip">
    <span class=${`bt-round${c.active ? '' : ' idle'}`}>${c.active ? `Runde ${c.round}` : 'Vorbereitung'}</span>
    <div class="bt-order">${list.map((x) => {
      const t = tokenOfCb(B, x);
      const frac = x.hp != null && x.maxHp ? Math.max(0, Math.min(1, x.hp / x.maxHp)) : ({ Unverletzt: 1, Angeschlagen: 0.7, Blutig: 0.4, Kritisch: 0.15, Kampfunfähig: 0 })[x.hpState] ?? 1;
      const down = x.hp != null ? x.hp <= 0 : x.down;
      return html`<button type="button" key=${x.id} class=${`bt-chip${x.id === c.curId ? ' cur' : ''}${down ? ' down' : ''}${x.isPC ? ' pc' : ' npc'}${x.hidden ? ' hid' : ''}`}
        title=${`${x.name} · Initiative ${x.init ?? '–'}${t ? ' – antippen zum Anzeigen' : ' (kein Token auf dieser Karte)'}`} onClick=${() => { if (t) { s.focusToken?.(t); selectToken(B, t.id); } }}>
        <${TokenArt} B=${B} t=${t} cb=${x} size=${34} />
        <b class="ini">${x.init ?? '–'}</b>
        <span class="nm">${x.name}</span>
        <i class="hp"><i style=${{ width: `${frac * 100}%`, background: frac > 0.5 ? '#3dd68c' : frac > 0.25 ? '#f5c542' : '#ef5a5f' }}></i></i>
      </button>`;
    })}</div>
    <div class="bt-ctl">
      ${B.gm && c.active ? html`<${IconBtn} icon="skip-back" title="Vorheriger Zug" onClick=${prevTurn} /><${Btn} size="sm" kind="primary" icon="skip-forward" onClick=${nextTurn}>Nächster Zug<//><${IconBtn} icon="stop" title="Kampf beenden" onClick=${endCombat} /><${IconBtn} icon="list" title="Kampf-Tracker (Liste mit allen Werten)" onClick=${() => openView('combat')} />` : null}
      ${B.gm && !c.active ? html`<${Btn} size="sm" kind="primary" icon="swords" onClick=${() => startCombat(B)}>Kampf starten<//>` : null}
      ${!B.gm && c.active && mine ? html`<${Btn} size="sm" kind="primary" icon="check" onClick=${() => sendEvent({ type: 'endTurn' })}>Zug beenden<//>` : null}
      ${!B.gm && c.active && myCb && myCb.init == null ? html`<${Btn} size="sm" icon="d20" onClick=${rollMyInit}>Initiative<//>` : null}
    </div>
  </div>`;
}

function TokenPanel({ B, t, s, editToken }) {
  const cb = combatantForToken(t, B.combat.list);
  const pe = charOf(B, t);
  const ctl = canControl(B, t);
  const acts = actionsFor(B, t);
  const info = ctl ? moveInfo(B, t, s.doc.w, s.doc.h) : null;
  const sb = B.gm ? statFor(B, t) : null;
  const hpTxt = cb && cb.hp != null ? `${cb.hp}/${cb.maxHp}${cb.tempHp ? ` +${cb.tempHp}` : ''}` : cb?.hpState || (pe ? `${pe.char.hp}/${pe.char.maxHp}` : null);
  const ac = acOf(B, t, cb);
  const mk = moveKey(B, t);
  const close = () => { B.sel = null; B.pending = null; B.rerender(); B.redraw(); };
  return html`<div class="bt-panel">
    <div class="bt-head">
      <${TokenArt} B=${B} t=${t} cb=${cb} size=${42} />
      <div class="grow" style="min-width:0"><b>${t.label}</b>
        <div class="tiny muted">${pe ? `${pe.char.species || ''} · ${pe.char.cls || ''} ${pe.char.level || ''}` : sb ? `${sb.size || ''} ${sb.type || ''} · HG ${sb.cr || '?'}` : cb ? (cb.isPC ? 'Spielercharakter' : 'Kreatur') : 'Token'}</div></div>
      ${hpTxt ? html`<span class="bt-pill"><${Icon} name="heart" size=${13} />${hpTxt}</span>` : null}
      ${ac != null ? html`<span class="bt-pill"><${Icon} name="shield" size=${13} />${ac}</span>` : null}
      <${IconBtn} icon="x" title="Schließen" onClick=${close} />
    </div>
    ${cb?.conditions?.length ? html`<div class="chips">${cb.conditions.map((k) => html`<span class="cond-chip">${k.name}${k.rounds ? ` (${k.rounds})` : ''}</span>`)}</div>` : null}
    ${info ? html`<div class="bt-move"><${Icon} name="footprints" size=${14} /> Bewegung <b>${fmtMeters(info.remaining * CELL_M)}</b>
      <span class="faint">von ${fmtMeters(info.maxCells * CELL_M)}${B.combat.active && !info.turn ? ' – nicht am Zug' : ''}</span>
      ${info.turn ? html`<label class="check small"><input type="checkbox" checked=${info.dash} onChange=${(e) => { dashOn.set(mk, e.target.checked); B._reach = null; B.redraw(); B.rerender(); }} /> Spurt</label>` : null}</div>` : null}
    ${acts.length ? html`<div class="bt-acts">${acts.map((a, i) => html`<button type="button" key=${`${a.name}${i}`} class=${`bt-act${B.pending?.i === i && B.pending?.t === t.id ? ' on' : ''}`} onClick=${() => (B.pending?.i === i && B.pending?.t === t.id ? arm(B, null) : arm(B, t, a, i))}>
        ${a.art?.spell ? html`<${SpellArt} sp=${a.art.spell} size=${30} level=${false} />` : a.art?.item ? html`<${ItemArt} item=${a.art.item} size=${30} />`
          : html`<span class="bt-ico"><${GameIcon} name=${a.kind === 'area' || a.kind === 'save' ? 'fire-breath' : a.kind === 'ranged' ? 'bow-arrow' : 'crossed-swords'} size=${20} /></span>`}
        <span class="bt-at"><b>${a.name}</b><small>${actSub(a)}</small></span></button>`)}</div>` : ctl ? html`<div class="tiny faint">Keine Angriffe gefunden.</div>` : null}
    ${B.pending?.t === t.id ? html`<div class="bt-hint"><${Icon} name="target" size=${14} /> ${B.pending.att.kind === 'area' ? 'Fläche platzieren: auf die Karte tippen' : 'Ziel-Token antippen'}
      <span class="grow"></span><${Btn} size="sm" kind="ghost" onClick=${() => arm(B, null)}>Abbrechen<//></div>` : null}
    ${B.gm ? html`<div class="btn-row">
      <${Btn} size="sm" icon="heart" disabled=${!cb} onClick=${() => hpQuick(t, cb)}>TP ±<//>
      <${Btn} size="sm" icon="activity" disabled=${!cb} onClick=${(e) => condMenu(cb, e)}>Zustand<//>
      ${sb ? html`<${Btn} size="sm" icon="scroll" onClick=${() => openModal(() => html`<div class="modal-body"><${Statblock} monster=${sb} /></div>`, { title: t.label, icon: 'ghost', size: 'lg' })}>Statblock<//>` : null}
      ${!cb && (t.charId || t.mref) ? html`<${Btn} size="sm" icon="plus" onClick=${() => addTokenToCombat(B, t)}>In den Kampf<//>` : null}
      ${editToken ? html`<${Btn} size="sm" kind="ghost" icon="pencil" onClick=${() => editToken(t)}>Bearbeiten<//>` : null}
    </div>` : null}
  </div>`;
}

function ResultCard({ r, B }) {
  const [, force] = useState(0);
  if (r.kind === 'area' && !r.targets && B.gm) r.targets = (r.targetIds || []).map((id) => B.tokens.find((t) => t.id === id)).filter(Boolean).map((t) => targetEntry(B, t, r));
  const close = () => closeResult(B, r);
  if (r.kind === 'attack') {
    const tok = B.tokens.find((t) => t.id === r.tokId);
    const ac = r.ac ?? (B.gm ? acOf(B, tok, combatantForToken(tok, B.combat.list)) : null);
    const hit = r.crit ? true : r.fumble ? false : ac != null ? r.total >= ac : null;
    return html`<div class=${`bt-res ${hit === true ? 'hit' : hit === false ? 'miss' : ''}`}>
      <div class="row nowrap"><b class="grow">${r.by} → ${r.target}</b><${IconBtn} icon="x" size=${14} title="Schließen" onClick=${close} /></div>
      <div class="small">${r.att}: <b>${r.total}</b>${r.long ? ' (Nachteil)' : ''}${ac != null ? ` gegen RK ${ac}` : ''} – <b>${r.crit ? 'Kritischer Treffer!' : r.fumble ? 'Patzer' : hit === true ? 'Treffer' : hit === false ? 'Verfehlt' : 'SL entscheidet'}</b></div>
      ${r.dmg != null && hit !== false ? html`<div class="small">Schaden: <b>${r.dmg}</b> ${damageName(r.dmgType)}</div>` : null}
      ${B.gm && r.dmg != null && hit !== false ? html`<div class="btn-row"><${Btn} size="sm" kind="danger" onClick=${() => applyAttack(B, r, 1)}>−${r.dmg} TP anwenden<//><${Btn} size="sm" onClick=${() => applyAttack(B, r, 0.5)}>Halb<//></div>` : null}
    </div>`;
  }
  const targets = r.targets || [];
  return html`<div class="bt-res area">
    <div class="row nowrap"><b class="grow">${r.by}: ${r.att}</b><${IconBtn} icon="x" size=${14} title="Schließen" onClick=${close} /></div>
    <div class="small">${r.dmg != null ? html`<b>${r.dmg}</b> ${damageName(r.dmgType)}` : null}${r.save ? ` · SG ${r.dc} ${AB3[r.save] || ''}` : ''}</div>
    ${targets.length ? html`<div class="bt-targets">${targets.map((tg) => html`<div class="row nowrap small" key=${tg.tokId}>
      <span class="grow">${tg.name}</span>
      ${tg.save ? html`<span class=${tg.save.ok ? 'success-text' : 'danger-text'}>${tg.save.total} ${tg.save.ok ? '✓' : '✗'}</span>` : tg.pc && r.save ? html`<span class="faint">würfelt selbst</span>` : null}
      ${B.gm && r.dmg ? html`<select class="select sm" style="width:auto" value=${String(tg.mult)} onChange=${(e) => { tg.mult = Number(e.target.value); force((n) => n + 1); }}>
        <option value="1">voll</option><option value="0.5">halb</option><option value="0">nichts</option></select>` : null}
    </div>`)}</div>` : html`<div class="tiny faint">Keine Tokens in der Fläche.</div>`}
    <div class="btn-row">
      ${B.gm && r.dmg && targets.length ? html`<${Btn} size="sm" kind="danger" onClick=${() => applyArea(B, r)}>Schaden anwenden<//>` : null}
      ${r.tplId && (B.gm || r.uid === B.me) ? html`<${Btn} size="sm" kind="ghost" onClick=${() => db.remove(col('party'), r.tplId).catch(() => {})}>Schablone weg<//>` : null}
    </div>
  </div>`;
}

function ResultStack({ B }) {
  const items = useStore(inbox, (x) => x.items);
  const all = [...B.results, ...(B.gm ? items.filter((x) => x.mapId === B.mapId && !B.results.some((y) => y.id === x.id)) : [])].slice(-6);
  if (!all.length) return null;
  return html`<div class="bt-results">${all.map((r) => html`<${ResultCard} key=${r.id} r=${r} B=${B} />`)}</div>`;
}

export function BattleHud({ B, s, editToken }) {
  const c = B.combat;
  const selT = B.sel ? B.tokens.find((t) => t.id === B.sel) : null;
  // Wer am Zug ist und von mir gesteuert wird, ist automatisch ausgewählt
  useEffect(() => {
    if (!c.active || !c.curId) return;
    const cb = c.list.find((x) => x.id === c.curId);
    const t = cb && tokenOfCb(B, cb);
    if (t && canControl(B, t)) {
      B.sel = t.id;
      B.pending = null;
      s.focusToken?.(t, true);
      B.rerender();
      B.redraw();
    }
  }, [c.turnKey]);
  const showStrip = c.active || (B.gm && (c.list.length || B.tokens.some((t) => t.charId || t.mref)));
  return html`${showStrip ? html`<${TurnStrip} B=${B} s=${s} />` : null}
    ${selT ? html`<${TokenPanel} B=${B} t=${selT} s=${s} editToken=${editToken} />` : null}
    <${ResultStack} B=${B} />`;
}

// Kompendium in der Seitenleiste (SL): SRD-Monster (deutsch) und eigenes Bestiarium auf die Karte setzen
export function MonsterPlacer({ B, active, onPick, onStop }) {
  const [q, setQ] = useState('');
  const [srd, setSrd] = useState(null);
  const [hidden, setHidden] = useState(!!B.placeHidden);
  useEffect(() => { import('../data/monsters-srd.js').then((m) => setSrd(m.MONSTERS)); }, []);
  const ql = q.trim().toLowerCase();
  const list = [...(B.bestiary || []).map((m) => ({ ...m, src: 'bst' })), ...(srd || []).map((m) => ({ ...m, src: 'srd' }))]
    .filter((m) => !ql || m.name.toLowerCase().includes(ql) || String(m.type || '').toLowerCase().includes(ql)).slice(0, 40);
  return html`<div class="stack sm">
    <b>Monster platzieren</b>
    <input class="input sm" placeholder="Suchen: Goblin, Drache, Untoter …" value=${q} onInput=${(e) => setQ(e.target.value)} />
    <div class="bt-mlist">
      ${!srd ? html`<div class="empty"><span class="spinner" /></div>` : null}
      ${list.map((m) => html`<button type="button" key=${`${m.src}:${m.id}`} class=${`bt-mrow${active && B.placing?.id === m.id ? ' on' : ''}`} onClick=${() => onPick({ ...m })}>
        <${MonsterArt} m=${m} size=${30} />
        <span class="grow" style="min-width:0"><b>${m.name}</b><small>HG ${m.cr || '?'} · ${m.src === 'srd' ? 'SRD' : 'Bestiarium'}</small></span>
      </button>`)}
    </div>
    <label class="check small"><input type="checkbox" checked=${hidden} onChange=${(e) => { B.placeHidden = e.target.checked; setHidden(e.target.checked); }} /> Verborgen platzieren (nur SL sieht sie)</label>
    ${active ? html`<div class="row small"><span class="accent-text grow">Antippen = „${B.placing?.name}“ setzen</span><${Btn} size="sm" onClick=${onStop}>Fertig<//></div>` : null}
  </div>`;
}
