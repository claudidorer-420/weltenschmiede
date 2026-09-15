// Charakter-Assistent: Erschaffung Schritt für Schritt nach den 5e-Regeln (2014 oder 2024) und Stufenaufstieg.
// Werte (Attribute, Übungen, TP) entstehen nur hier – der Bogen zeigt sie danach nur noch an.
import { html, useState, useMemo, useEffect } from '../lib/preact.js';
import { SpellManager, casterNeeds, checkSpells, normalizeEntries } from './spellbook.js';
import { useSpells, spellNeeds } from '../data/spells.js';
import { app, myUid, rulesEdition } from '../core/app.js';
import { db } from '../core/db.js';
import { settings } from '../core/settings.js';
import { prepareRoll, doRoll } from '../core/rolls.js';
import { Icon, Btn, IconBtn, Field, Select, Segmented, Toggle, openModal, toast, confirmDialog } from '../ui/components.js';
import { showRollAnimated } from '../ui/dicetray.js';
import { now, colorFromString, uid } from '../lib/util.js';
import { fmtMod } from '../lib/dice.js';
import { ALIGNMENTS, XP_LEVELS } from '../data/rules5e.js';
import {
  AB, AB_NAME, AB_SHORT, abMod, profBonus, skillName, ALL_SKILLS, STANDARD_ARRAY, POINT_COST, POINT_BUDGET, fmtDist,
  SPECIES, BACKGROUNDS, ARMOR, ARMOR_TYPE, WEAPONS, LANGUAGES, CLASSES, classesFor, findClass, findSpecies, findBackground, findFeat,
  featsFor, featAsi, perEd, classSkills, classFeatures, subclassLevel, spellSlots, spellcasting, hpAverage, hpBonusPerLevel,
  charMods, totalLevel, multiclassOk, findArmor, findWeapon, edOf, classLevel,
} from '../data/chargen.js';

const CLASS_BLURB = {
  barbar: 'Wilder Nahkämpfer mit Kampfrausch – viele Trefferpunkte, kaum zu stoppen.',
  barde: 'Vielseitiger Zauberwirker und Unterstützer mit Musik, Worten und vielen Fertigkeiten.',
  kleriker: 'Göttlicher Zauberwirker: Heilung, Schutz und heilige Macht, gut gerüstet.',
  druide: 'Naturmagier, der sich in Tiere verwandelt und Elemente beschwört.',
  kaempfer: 'Meister der Waffen und Rüstungen – verlässlich, flexibel, robust.',
  moench: 'Flinker Kampfkünstler ohne Rüstung, mit Fokus-/Ki-Techniken.',
  paladin: 'Heiliger Krieger mit Eid, Schutzauren und göttlichem Niederstrecken.',
  waldlaeufer: 'Jäger und Späher der Wildnis mit Bogen, Spurensuche und Naturmagie.',
  schurke: 'Spezialist für Heimlichkeit, Fertigkeiten und hinterhältige Angriffe.',
  zauberer: 'Angeborene Magie im Blut – formt Zauber mit Metamagie.',
  hexenmeister: 'Magie aus einem Pakt mit einem mächtigen Schutzherrn.',
  magier: 'Gelehrter Zauberwirker mit dem größten Zauberrepertoire.',
  magieschmied: 'Erfinder, der Magie in Gegenstände bannt (2014, Tascha).',
};

// ───────────────────────── Berechnung ─────────────────────────
function blankDraft(campaignId) {
  const ed = rulesEdition();
  return {
    name: '', edition: ed, level: 1, campaignId: campaignId ?? (app.get().cid || ''),
    cls: '', subclass: '', style: '',
    speciesKey: '', subspeciesKey: '', speciesOption: '', size: '', backgroundKey: '',
    method: 'standard', assign: {}, rolled: null, buy: Object.fromEntries(AB.map((k) => [k, 8])),
    bgMode: '21', bgPlus2: '', bgPlus1: '', asiPicks: [], tasha: false, tashaAssign: [],
    classSkills: [], anySkills: [], speciesSkill: '', skilledPicks: [], expertise: [],
    humanFeat: '', variantFeat: '', variantFeatAb: '', asis: {},
    equipClass: 'A', equipBg: 'A', gold2014: null, armorBody: '', shield: false, weapons: [], weaponsTouched: false,
    cantrips: [], spells: [], spellList: [],
    alignment: '', languages: ['Gemeinsprache'], appearance: '', personality: { traits: '', ideals: '', bonds: '', flaws: '' }, backstory: '',
  };
}

const speciesOf = (d) => findSpecies(d.edition, d.speciesKey);
const subOf = (d) => speciesOf(d)?.subs?.find((s) => s.key === d.subspeciesKey) || null;
const optionOf = (d) => speciesOf(d)?.option?.list.find((o) => o.key === d.speciesOption) || null;
const bgOf = (d) => findBackground(d.edition, d.backgroundKey);

export function baseScores(d) {
  if (d.method === 'pointbuy') return { ...d.buy };
  const vals = d.method === 'roll' ? d.rolled || [] : STANDARD_ARRAY;
  return Object.fromEntries(AB.map((k) => [k, d.assign[k] != null && vals[d.assign[k]] != null ? vals[d.assign[k]] : null]));
}

function tashaAmounts(d) {
  const sp = speciesOf(d);
  const sub = subOf(d);
  const fixed = { ...(sp?.asi || {}) };
  for (const [k, v] of Object.entries(sub?.asi || {})) fixed[k] = (fixed[k] || 0) + v;
  const choice = sub?.asiChoice || sp?.asiChoice;
  return { fixed, choice, amounts: [...Object.values(fixed), ...Array(choice?.n || 0).fill(choice?.amount || 1)].sort((a, b) => b - a) };
}

export function originBonus(d) {
  const b = Object.fromEntries(AB.map((k) => [k, 0]));
  if (d.edition === '2024') {
    const bg = bgOf(d);
    if (bg?.abilities) {
      if (d.bgMode === '111') bg.abilities.forEach((k) => { b[k] += 1; });
      else {
        if (d.bgPlus2) b[d.bgPlus2] += 2;
        if (d.bgPlus1) b[d.bgPlus1] += 1;
      }
    }
    return b;
  }
  const { fixed, choice, amounts } = tashaAmounts(d);
  if (d.tasha && amounts.length && amounts.length < 6) {
    amounts.forEach((amt, i) => { const k = d.tashaAssign[i]; if (k) b[k] += amt; });
    return b;
  }
  Object.entries(fixed).forEach(([k, v]) => { b[k] += v; });
  if (choice) (d.asiPicks || []).slice(0, choice.n).forEach((k) => { b[k] += choice.amount; });
  return b;
}

export function asiLevels(d) {
  if (!d.cls) return [];
  return classFeatures(d.cls, d.edition, d.level).filter((f) => f.kind === 'asi' || f.kind === 'boon').map((f) => ({ level: f.level, boon: f.kind === 'boon' }));
}

function variantFeatAllowed(d) {
  return !!(d.edition === '2014' && (subOf(d)?.feat || speciesOf(d)?.feat));
}

export function finalScores(d) {
  const base = baseScores(d);
  const ob = originBonus(d);
  const out = {};
  for (const k of AB) out[k] = base[k] == null ? null : Math.min(20, base[k] + ob[k]);
  if (variantFeatAllowed(d) && d.variantFeat && d.variantFeatAb && featAsi(findFeat(d.variantFeat), d.edition) && out[d.variantFeatAb] != null) out[d.variantFeatAb] = Math.min(20, out[d.variantFeatAb] + 1);
  for (const l of asiLevels(d)) {
    const a = d.asis[l.level];
    if (!a) continue;
    const cap = l.boon ? 30 : 20;
    if (a.type === 'feat') {
      if (a.featAb && featAsi(findFeat(a.feat), d.edition) && out[a.featAb] != null) out[a.featAb] = Math.min(cap, out[a.featAb] + 1);
    } else if (a.a && out[a.a] != null) {
      if (a.b && a.b !== a.a && out[a.b] != null) {
        out[a.a] = Math.min(20, out[a.a] + 1);
        out[a.b] = Math.min(20, out[a.b] + 1);
      } else out[a.a] = Math.min(20, out[a.a] + 2);
    }
  }
  return out;
}

function draftFeats(d) {
  const out = [];
  const sp = speciesOf(d);
  if (d.edition === '2024') {
    const bg = bgOf(d);
    if (bg?.feat) out.push({ key: bg.feat, source: `Hintergrund: ${bg.name}` });
    if (sp?.originFeat && d.humanFeat) out.push({ key: d.humanFeat, source: `${sp.name}: Vielseitig` });
  } else if (variantFeatAllowed(d) && d.variantFeat) out.push({ key: d.variantFeat, source: sp?.name || 'Volk', ab: d.variantFeatAb });
  if (d.style) out.push({ key: d.style, source: 'Kampfstil' });
  for (const l of asiLevels(d)) {
    const a = d.asis[l.level];
    if (a?.type === 'feat' && a.feat) out.push({ key: a.feat, source: `Stufe ${l.level}`, ab: a.featAb });
  }
  return out.map((f) => ({ ...f, name: findFeat(f.key)?.name || f.key }));
}

function fixedSkills(d) {
  const out = [];
  for (const k of bgOf(d)?.skills || []) out.push({ key: k, src: 'Hintergrund' });
  for (const k of speciesOf(d)?.skills || []) out.push({ key: k, src: 'Volk' });
  return out;
}

function skillNeeds(d) {
  const cls = findClass(d.cls);
  const sp = speciesOf(d);
  const sub = subOf(d);
  const feats = draftFeats(d);
  const skilled = feats.reduce((a, f) => a + (findFeat(f.key)?.grantSkills || 0), 0);
  const expertise = Object.entries(cls?.expertise?.[d.edition] || {}).filter(([l]) => Number(l) <= d.level).reduce((a, [, n]) => a + n, 0)
    + feats.filter((f) => f.key === 'skill-expert').length;
  return {
    cls: cls ? classSkills(cls, d.edition) : { n: 0, list: [] },
    any: (sp?.skillAny || 0) + (sub?.skillAny || 0) + (bgOf(d)?.skillAny || 0),
    choice: sp?.skillChoice || null,
    skilled, expertise,
  };
}

function skillSet(d) {
  const s = new Set(fixedSkills(d).map((x) => x.key));
  d.classSkills.forEach((k) => s.add(k));
  d.anySkills.forEach((k) => s.add(k));
  if (d.speciesSkill) s.add(d.speciesSkill);
  d.skilledPicks.forEach((k) => s.add(k));
  return s;
}

function saveList(d) {
  const s = new Set(findClass(d.cls)?.saves || []);
  for (const f of draftFeats(d)) if (f.key === 'resilient' && f.ab) s.add(f.ab);
  return [...s];
}

function speciesStats(d) {
  const sp = speciesOf(d);
  const sub = subOf(d);
  const opt = optionOf(d);
  const sizeOpts = String(sp?.size || 'Mittelgroß').split(' oder ');
  return {
    speed: opt?.speed || sub?.speed || sp?.speed || 30,
    dark: opt?.dark ?? sub?.dark ?? sp?.dark ?? 0,
    size: sizeOpts.includes(d.size) ? d.size : sizeOpts[0],
    sizeOpts,
    name: (sub?.name || sp?.name || '') + (opt ? ` (${opt.name})` : ''),
  };
}

function classEquipOptions(d) {
  const cls = findClass(d.cls);
  if (!cls) return [];
  const text = cls.equip?.[d.edition] || cls.equip?.[2014] || '';
  const opts = [];
  if (text.includes(' · ')) {
    text.split(' · ').forEach((part) => {
      const m = /^([A-C]):\s*(.*)$/.exec(part);
      if (m) opts.push({ key: m[1], label: `Paket ${m[1]}`, text: m[2] });
    });
  } else opts.push({ key: 'A', label: 'Startausrüstung', text });
  const g = cls.gold?.[d.edition];
  opts.push({ key: 'gold', label: d.edition === '2024' ? `Stattdessen ${g} GM` : `Startgold würfeln (${g} GM)`, text: '', gold: typeof g === 'number' ? g : null });
  return opts;
}

function parseItems(text) {
  const items = [];
  let gold = 0;
  for (const raw of String(text || '').split(/,\s*/)) {
    const t = raw.trim();
    if (!t) continue;
    const g = /^(\d+)\s*GM$/i.exec(t);
    if (g) { gold += Number(g[1]); continue; }
    const q = /^(\d+)\s+(.+)$/.exec(t);
    items.push(q ? { name: q[2], qty: Number(q[1]) } : { name: t, qty: 1 });
  }
  return { items, gold };
}

function packageText(d) {
  const co = classEquipOptions(d).find((o) => o.key === d.equipClass);
  const bg = bgOf(d);
  const bgText = d.edition === '2024' ? (d.equipBg === 'A' ? bg?.equip || '' : '50 GM') : bg?.equip || '';
  return { cls: co?.key === 'gold' ? '' : co?.text || '', clsGold: co?.key === 'gold' ? (co.gold ?? d.gold2014 ?? 0) : 0, bg: bgText };
}

function detectGear(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const has = (name) => new RegExp(`(^|[\\s,(])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(e|en|n|s)?([\\s,)]|$)`).test(t);
  return {
    weapons: WEAPONS.filter((w) => has(w.name)).map((w) => w.key),
    armor: [...ARMOR].reverse().find((a) => has(a.name))?.key || '',
    shield: /schild/.test(t),
  };
}

function armorAllowed(d, type) {
  const cls = findClass(d.cls);
  const list = perEd(cls?.armor, d.edition) || [];
  const feats = draftFeats(d).map((f) => findFeat(f.key)?.armor).filter(Boolean);
  const sub = subOf(d);
  const extra = sub?.key === 'bergzwerg' ? ['light', 'medium'] : [];
  return list.includes(type) || feats.includes(type) || extra.includes(type);
}

export function computeMaxHp(c) {
  const con = abMod(c.abilities?.con);
  const ed = edOf(c);
  let sum = 0;
  for (const b of c.hpBase || []) sum += Math.max(1, Number(b) + con);
  const lvl = (c.hpBase || []).length;
  sum += lvl * hpBonusPerLevel(c);
  const sorc = (c.classes || []).find((x) => x.cls === 'zauberer' && /Drachenblut|Drakonisch/.test(x.subclass || ''));
  if (sorc) sum += ed === '2014' ? sorc.level : sorc.level >= 3 ? sorc.level : 0;
  return Math.max(1, sum + (Number(c.hpAdjust) || 0));
}

// abgeleitete Felder (für Kampf-Tracker, Spieltisch, Karten) aktualisieren
export function derive(c, { fullHp = false } = {}) {
  const x = { ...c };
  x.level = totalLevel(x);
  x.cls = (x.classes || []).map((k) => findClass(k.cls)?.name || k.cls).join(' / ') || x.cls || '';
  x.subclass = x.classes?.[0]?.subclass || '';
  const oldMax = c.maxHp;
  x.maxHp = computeMaxHp(x);
  const cm = charMods(x);
  x.ac = cm.ac.ac;
  x.initBonus = cm.init - cm.mods.dex;
  if (fullHp || x.hp == null) x.hp = x.maxHp;
  else x.hp = Math.max(0, Math.min(x.maxHp, Number(x.hp) + (oldMax != null ? x.maxHp - oldMax : 0)));
  return x;
}

export function buildCharacter(d) {
  const ed = d.edition;
  const abilities = finalScores(d);
  const skills = {};
  for (const k of skillSet(d)) skills[k] = 1;
  for (const k of d.expertise) if (skills[k]) skills[k] = 2;
  const st = speciesStats(d);
  const bg = bgOf(d);
  const pk = packageText(d);
  const ci = parseItems(pk.cls);
  const bi = parseItems(pk.bg);
  const cls = findClass(d.cls);
  const c = {
    name: d.name.trim(), edition: ed, portrait: '', color: colorFromString(d.name.trim()),
    campaignId: d.campaignId || null,
    speciesKey: d.speciesKey, subspeciesKey: d.subspeciesKey || '', speciesOption: d.speciesOption || '',
    species: st.name, size: st.size, darkvision: st.dark, speed: st.speed,
    backgroundKey: d.backgroundKey, background: bg?.name || '',
    classes: [{ cls: d.cls, level: d.level, subclass: d.subclass || '' }],
    baseAbilities: baseScores(d), originBonus: originBonus(d), abilities,
    asi: asiLevels(d).map((l) => ({ level: l.level, cls: d.cls, ...(d.asis[l.level] || {}) })),
    saves: saveList(d), skills, feats: draftFeats(d),
    tools: [cls?.tools, bg?.tool].filter(Boolean).join(' · '),
    hpBase: Array.from({ length: d.level }, (_, i) => (i === 0 ? cls.hd : hpAverage(cls.hd))), hpAdjust: 0, tempHp: 0, hdUsed: 0,
    armor: { body: d.armorBody || '', shield: !!d.shield }, weapons: [...d.weapons], acBonus: 0, attacks: [],
    languages: d.languages, alignment: d.alignment, appearance: d.appearance, personality: d.personality, backstory: d.backstory, notes: '',
    spell: {
      used: {}, pactUsed: 0,
      list: d.spellList?.length
        ? d.spellList.map((e) => ({ ...e }))
        : [...d.cantrips.map((n) => ({ id: uid(5), name: n, level: 0, prepared: true })), ...d.spells.map((n) => ({ id: uid(5), name: n, level: 1, prepared: true }))],
    },
    resUsed: {}, conditions: [], exhaustion: 0, inspiration: false, deathSaves: { s: 0, f: 0 }, xp: XP_LEVELS[d.level - 1] || 0,
    inventory: [...ci.items, ...bi.items].map((it) => ({ id: uid(5), name: it.name, qty: it.qty, notes: '' })),
    currency: { cp: 0, sp: 0, ep: 0, gp: ci.gold + bi.gold + (pk.clsGold || 0), pp: 0 },
    customFeatures: '', levelLog: [{ level: d.level, cls: d.cls, ts: now() }],
    createdAt: now(), updatedAt: now(),
  };
  return derive(c, { fullHp: true });
}

// ───────────────────────── Prüfungen je Schritt ─────────────────────────
function problems(d, step) {
  const p = [];
  const cls = findClass(d.cls);
  const sp = speciesOf(d);
  if (step === 'basis' && d.name.trim().length < 2) p.push('Gib deinem Charakter einen Namen.');
  if (step === 'klasse') {
    if (!cls) p.push('Wähle eine Klasse.');
    else {
      if (d.level >= subclassLevel(d.cls, d.edition) && !d.subclass) p.push(`Wähle ${cls.subLabel === 'Eid' ? 'einen' : 'eine'} ${cls.subLabel}.`);
      if (cls.style && d.level >= cls.style && !d.style) p.push('Wähle einen Kampfstil.');
    }
  }
  if (step === 'herkunft') {
    if (!sp) p.push(d.edition === '2024' ? 'Wähle eine Spezies.' : 'Wähle ein Volk.');
    else {
      if (sp.subs?.length && !subOf(d)) p.push('Wähle eine Unterart.');
      if (sp.option && !optionOf(d)) p.push(`Wähle: ${sp.option.label}.`);
    }
    if (!bgOf(d)) p.push('Wähle einen Hintergrund.');
  }
  if (step === 'attribute') {
    const base = baseScores(d);
    if (d.method === 'roll' && !d.rolled) p.push('Würfle zuerst die Attributswerte aus.');
    else if (AB.some((k) => base[k] == null)) p.push('Verteile alle sechs Werte.');
    if (d.method === 'pointbuy') {
      const used = AB.reduce((a, k) => a + POINT_COST[d.buy[k]], 0);
      if (used > POINT_BUDGET) p.push('Zu viele Punkte ausgegeben.');
    }
    if (d.edition === '2024' && bgOf(d)?.abilities && d.bgMode === '21' && (!d.bgPlus2 || !d.bgPlus1 || d.bgPlus2 === d.bgPlus1)) p.push('Verteile +2 und +1 des Hintergrunds auf zwei verschiedene Attribute.');
    if (d.edition === '2014' && sp) {
      const { choice, amounts } = tashaAmounts(d);
      if (d.tasha && amounts.length && amounts.length < 6) {
        const picks = amounts.map((_, i) => d.tashaAssign[i]);
        if (picks.some((x) => !x) || new Set(picks).size !== picks.length) p.push('Verteile die Volksboni auf verschiedene Attribute.');
      } else if (choice && (d.asiPicks || []).length !== choice.n) p.push(`Wähle ${choice.n} Attribut(e) für +${choice.amount}.`);
    }
  }
  if (step === 'fertigkeiten' && cls) {
    const n = skillNeeds(d);
    if (d.classSkills.length !== n.cls.n) p.push(`Wähle ${n.cls.n} Klassenfertigkeiten (${d.classSkills.length} gewählt).`);
    if (d.anySkills.length !== n.any) p.push(`Wähle ${n.any} freie Fertigkeit(en).`);
    if (n.choice && !d.speciesSkill) p.push(`${n.choice.label}: eine Fertigkeit wählen.`);
    if (d.skilledPicks.length !== n.skilled) p.push(`Talent „Begabt“: ${n.skilled} Fertigkeiten wählen.`);
    if (d.expertise.length !== n.expertise) p.push(`Expertise: ${n.expertise} geübte Fertigkeiten wählen.`);
  }
  if (step === 'talente') {
    if (d.edition === '2024' && sp?.originFeat && !d.humanFeat) p.push('Wähle das zusätzliche Herkunftstalent.');
    if (variantFeatAllowed(d) && !d.variantFeat) p.push('Wähle ein Talent.');
    if (variantFeatAllowed(d) && d.variantFeat && featAsi(findFeat(d.variantFeat), d.edition) && !d.variantFeatAb) p.push('Wähle das Attribut für das Talent.');
    for (const l of asiLevels(d)) {
      const a = d.asis[l.level];
      if (!a || (a.type === 'feat' ? !a.feat : !a.a)) p.push(`Stufe ${l.level}: Attributswerterhöhung oder Talent wählen.`);
      else if (a.type === 'feat' && featAsi(findFeat(a.feat), d.edition) && !a.featAb) p.push(`Stufe ${l.level}: Attribut für das Talent wählen.`);
    }
  }
  if (step === 'zauber') p.push(...checkSpells(d.spellList || [], casterNeeds(buildPreview(d)), { mode: 'create' }));
  return p;
}

// ───────────────────────── Bausteine ─────────────────────────
function Pick({ active, onClick, title, sub, children, disabled, badge }) {
  return html`<button type="button" class=${`pick-card${active ? ' active' : ''}`} disabled=${disabled} onClick=${onClick}>
    <span class="row nowrap" style="gap:6px"><b class="grow">${title}</b>${badge ? html`<span class="badge">${badge}</span>` : null}${active ? html`<${Icon} name="check-circle" size=${16} class="accent-text" />` : null}</span>
    ${sub ? html`<span class="small muted">${sub}</span>` : null}
    ${children || null}
  </button>`;
}

function SkillGrid({ list, picked, max, onChange, locked = {}, only }) {
  const toggle = (k) => {
    if (picked.includes(k)) onChange(picked.filter((x) => x !== k));
    else if (picked.length < max) onChange([...picked, k]);
  };
  const keys = only || list;
  return html`<div class="skill-pick">${keys.map((k) => {
    const lock = locked[k];
    const on = picked.includes(k);
    return html`<label class=${`sp-item${on ? ' on' : ''}${lock ? ' locked' : ''}`}>
      <input type="checkbox" checked=${on || !!lock} disabled=${!!lock || (!on && picked.length >= max)} onChange=${() => toggle(k)} />
      <span>${skillName(k)}</span>${lock ? html`<small>${lock}</small>` : null}
    </label>`;
  })}</div>`;
}

function ChipInput({ values, onChange, placeholder }) {
  const [t, setT] = useState('');
  const add = () => {
    const v = t.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setT('');
  };
  return html`<div class="stack sm">
    <div class="chips">${values.map((v) => html`<span class="chip accent">${v}<span class="x" onClick=${() => onChange(values.filter((x) => x !== v))}><${Icon} name="x" size=${12} /></span></span>`)}</div>
    <div class="input-group"><input class="input" value=${t} placeholder=${placeholder} onInput=${(e) => setT(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /><${Btn} icon="plus" onClick=${add}>Hinzufügen<//></div>
  </div>`;
}

function AbilityTable({ d, base, bonus, final }) {
  return html`<table class="ab-table">
    <thead><tr><th>Attribut</th><th>Basis</th><th>Bonus</th><th>Gesamt</th><th>Mod</th></tr></thead>
    <tbody>${AB.map((k) => html`<tr>
      <td><b>${AB_NAME[k]}</b></td><td>${base[k] ?? '–'}</td><td class=${bonus[k] ? 'accent-text' : 'faint'}>${bonus[k] ? `+${bonus[k]}` : '–'}</td>
      <td><b>${final[k] ?? '–'}</b></td><td>${final[k] != null ? fmtMod(abMod(final[k])) : '–'}</td>
    </tr>`)}</tbody>
  </table>`;
}

// ───────────────────────── Schritte ─────────────────────────
function StepBasis({ d, set, setEdition }) {
  const campaigns = app.get().campaigns;
  return html`<div class="stack lg">
    <p class="muted" style="margin:0">Der Assistent führt dich durch die Regeln des Spielerhandbuchs. Werte wie Attribute, Übungen und Trefferpunkte entstehen hier – im Charakterbogen änderst du sie später nur beim Stufenaufstieg.</p>
    <${Field} label="Name"><input class="input" value=${d.name} onInput=${(e) => set({ name: e.target.value })} placeholder="z. B. Thorin Eisenfaust" autoFocus /><//>
    <${Field} label="Regelwerk" hint=${d.edition === '2024' ? 'Spielerhandbuch 2024: Attributsboni und ein Herkunftstalent kommen vom Hintergrund, die Spezies gibt Merkmale.' : 'Spielerhandbuch 2014: Attributsboni kommen vom Volk, der Hintergrund gibt Fertigkeiten, Werkzeuge und ein Merkmal.'}>
      ${app.get().cid
        ? html`<div class="row"><span class="badge accent">D&D 5e (${d.edition})</span><span class="small muted">vorgegeben durch die Kampagne „${app.get().campaign?.name || ''}“</span></div>`
        : html`<${Segmented} value=${d.edition} onChange=${setEdition} options=${[{ value: '2014', label: 'D&D 5e (2014)' }, { value: '2024', label: 'D&D 5e (2024)' }]} />`}
    <//>
    <div class="grid two">
      <${Field} label="Startstufe" hint="Normal ist Stufe 1. Bei höheren Stufen gibt es Trefferpunkte nach Durchschnitt, und du triffst die Aufstiegs-Entscheidungen im Schritt „Talente & Stufen“.">
        <div class="row nowrap"><${IconBtn} icon="minus" onClick=${() => set({ level: Math.max(1, d.level - 1), asis: {} })} /><b style="min-width:40px;text-align:center;font-size:20px">${d.level}</b><${IconBtn} icon="plus" onClick=${() => set({ level: Math.min(20, d.level + 1), asis: {} })} /></div>
      <//>
      ${campaigns.length ? html`<${Field} label="Kampagne" hint="Der Charakter gehört dir und kann später in eine andere Kampagne wechseln.">
        <${Select} value=${d.campaignId} onChange=${(v) => set({ campaignId: v })} options=${[{ value: '', label: '– noch keine –' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]} />
      <//>` : null}
    </div>
  </div>`;
}

function StepKlasse({ d, set }) {
  const cls = findClass(d.cls);
  const subLvl = cls ? subclassLevel(cls.key, d.edition) : 3;
  const feats = cls ? classFeatures(cls.key, d.edition, Math.max(1, d.level)).filter((f) => f.level <= d.level) : [];
  return html`<div class="stack lg">
    <div class="pick-grid">${classesFor(d.edition).map((c) => html`<${Pick} key=${c.key} active=${d.cls === c.key}
      onClick=${() => set({ cls: c.key, subclass: '', style: '', classSkills: [], expertise: [], asis: {}, weapons: [], weaponsTouched: false, armorBody: '', shield: false, equipClass: 'A' })}
      title=${c.name} badge=${`W${c.hd}`} sub=${CLASS_BLURB[c.key]}>
      <span class="tiny faint">${c.primary.map((k) => AB_NAME[k]).join(' / ')} · Rettung ${c.saves.map((k) => AB_SHORT[k]).join(' & ')}</span>
    <//>`)}</div>
    ${cls ? html`<div class="card stack">
      <div class="card-head" style="margin:0"><h3><${Icon} name="shield" size=${18} />${cls.name}</h3></div>
      <div class="grid two small" style="gap:6px 18px">
        <div><b>Trefferwürfel:</b> W${cls.hd} (Stufe 1: ${cls.hd} + KON)</div>
        <div><b>Rettungswürfe:</b> ${cls.saves.map((k) => AB_NAME[k]).join(', ')}</div>
        <div><b>Rüstung:</b> ${(perEd(cls.armor, d.edition) || []).map((a) => (a === 'shield' ? 'Schilde' : ARMOR_TYPE[a])).join(', ') || 'keine'}</div>
        <div><b>Waffen:</b> ${(perEd(cls.weapons, d.edition) || []).map((w) => (w === 'simple' ? 'einfache' : w === 'martial' ? 'Kriegswaffen' : w === 'martial-light' ? 'leichte Kriegswaffen' : w === 'martial-finesse' ? 'Kriegswaffen mit Finesse/leicht' : findWeapon(w)?.name || w)).join(', ')}</div>
        ${cls.tools ? html`<div><b>Werkzeuge:</b> ${cls.tools}</div>` : null}
        <div><b>Fertigkeiten:</b> ${classSkills(cls, d.edition).n} aus ${classSkills(cls, d.edition).list.length === ALL_SKILLS.length ? 'allen' : classSkills(cls, d.edition).list.map(skillName).join(', ')}</div>
      </div>
      ${d.level >= subLvl ? html`<${Field} label=${`${cls.subLabel} (ab Stufe ${subLvl})`}>
        <${Select} value=${d.subclass} onChange=${(v) => set({ subclass: v })} options=${[{ value: '', label: 'Bitte wählen …' }, ...(cls.subclasses[d.edition] || cls.subclasses[2014]).map((s) => ({ value: s, label: s }))]} />
      <//>` : html`<div class="small faint">${cls.subLabel} wählst du auf Stufe ${subLvl}.</div>`}
      ${cls.style && d.level >= cls.style ? html`<${Field} label="Kampfstil">
        <${Select} value=${d.style} onChange=${(v) => set({ style: v })} options=${[{ value: '', label: 'Bitte wählen …' }, ...featsFor(d.edition, ['style']).filter((f) => d.edition === '2024' || !['style-blind', 'style-interception', 'style-thrown', 'style-unarmed'].includes(f.key) || cls.key === 'kaempfer').map((f) => ({ value: f.key, label: f.name.replace('Kampfstil: ', '') }))]} />
        ${d.style ? html`<div class="hint">${findFeat(d.style)?.desc}</div>` : null}
      <//>` : null}
      <details><summary class="small muted">Klassenmerkmale bis Stufe ${d.level}</summary>
        <div class="feat-list">${feats.map((f) => html`<div><b>St. ${f.level} · ${f.name}</b>${f.desc ? html` <span class="small muted">– ${f.desc}</span>` : null}</div>`)}</div>
      </details>
    </div>` : null}
  </div>`;
}

function StepHerkunft({ d, set }) {
  const sp = speciesOf(d);
  const bg = bgOf(d);
  const st = speciesStats(d);
  const units = settings.get().units || 'm';
  return html`<div class="stack lg">
    <div class="section-title" style="margin-top:0">${d.edition === '2024' ? 'Spezies' : 'Volk'}</div>
    <div class="pick-grid">${SPECIES[d.edition].map((s) => html`<${Pick} key=${s.key} active=${d.speciesKey === s.key}
      onClick=${() => set({ speciesKey: s.key, subspeciesKey: '', speciesOption: '', size: '', asiPicks: [], tashaAssign: [], speciesSkill: '', anySkills: [], humanFeat: '', variantFeat: '', variantFeatAb: '' })}
      title=${s.name} sub=${`${s.size} · ${fmtDist(s.speed, units)}${s.dark ? ` · Dunkelsicht ${fmtDist(s.dark, units)}` : ''}`}>
      ${d.edition === '2014' && s.asi ? html`<span class="tiny accent-text">${Object.entries(s.asi).map(([k, v]) => `${AB_SHORT[k]} +${v}`).join(' · ')}</span>` : null}
    <//>`)}</div>
    ${sp ? html`<div class="card stack">
      <div class="card-head" style="margin:0"><h3><${Icon} name="globe" size=${18} />${sp.name}</h3></div>
      ${sp.subs ? html`<${Field} label="Unterart"><div class="pick-grid">${sp.subs.map((s) => html`<${Pick} key=${s.key} active=${d.subspeciesKey === s.key} onClick=${() => set({ subspeciesKey: s.key, asiPicks: [], tashaAssign: [], anySkills: [], variantFeat: '', variantFeatAb: '' })} title=${s.name} sub=${s.asi ? Object.entries(s.asi).map(([k, v]) => `${AB_SHORT[k]} +${v}`).join(' · ') : ''} />`)}</div><//>` : null}
      ${sp.option ? html`<${Field} label=${sp.option.label}><${Select} value=${d.speciesOption} onChange=${(v) => set({ speciesOption: v })} options=${[{ value: '', label: 'Bitte wählen …' }, ...sp.option.list.map((o) => ({ value: o.key, label: o.name }))]} />${optionOf(d)?.note ? html`<div class="hint">${optionOf(d).note}</div>` : null}<//>` : null}
      ${st.sizeOpts.length > 1 ? html`<${Field} label="Größe"><${Segmented} value=${st.size} onChange=${(v) => set({ size: v })} options=${st.sizeOpts} /><//>` : null}
      <div class="feat-list">${[...(sp.traits || []), ...(subOf(d)?.traits || [])].map(([n, t]) => html`<div><b>${n}</b> <span class="small muted">– ${t}</span></div>`)}</div>
    </div>` : null}

    <div class="section-title">Hintergrund</div>
    <div class="pick-grid">${BACKGROUNDS[d.edition].map((b) => html`<${Pick} key=${b.key} active=${d.backgroundKey === b.key}
      onClick=${() => set({ backgroundKey: b.key, bgPlus2: '', bgPlus1: '', classSkills: d.classSkills.filter((k) => !(b.skills || []).includes(k)), anySkills: [], skilledPicks: [] })}
      title=${b.name} sub=${(b.skills || []).map(skillName).join(', ') || 'Fertigkeiten frei'}>
      ${d.edition === '2024' && b.abilities ? html`<span class="tiny accent-text">${b.abilities.map((k) => AB_SHORT[k]).join(' · ')} · ${findFeat(b.feat)?.name}</span>` : null}
    <//>`)}</div>
    ${bg ? html`<div class="card stack sm small">
      <div><b>Fertigkeiten:</b> ${(bg.skills || []).map(skillName).join(', ') || `${bg.skillAny} nach Wahl`}</div>
      ${bg.tool ? html`<div><b>Werkzeug:</b> ${bg.tool}</div>` : null}
      ${bg.abilities ? html`<div><b>Attribute:</b> ${bg.abilities.map((k) => AB_NAME[k]).join(', ')} (+2/+1 oder +1/+1/+1)</div>` : null}
      ${bg.feat ? html`<div><b>Herkunftstalent:</b> ${findFeat(bg.feat)?.name} – <span class="muted">${findFeat(bg.feat)?.desc}</span></div>` : null}
      ${bg.feature ? html`<div><b>Merkmal:</b> ${bg.feature}</div>` : null}
      ${bg.languages ? html`<div><b>Sprachen:</b> ${bg.languages} nach Wahl</div>` : null}
      ${bg.equip ? html`<div><b>Ausrüstung:</b> ${bg.equip}</div>` : null}
    </div>` : null}
  </div>`;
}

function recommendAssign(d) {
  const cls = findClass(d.cls);
  const order = [...(cls?.primary || []), 'con', 'dex', 'wis', 'str', 'cha', 'int'];
  const uniq = [...new Set(order)].filter((k) => AB.includes(k));
  const vals = (d.method === 'roll' ? d.rolled || [] : STANDARD_ARRAY).map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const assign = {};
  uniq.forEach((k, n) => { if (vals[n]) assign[k] = vals[n].i; });
  return assign;
}

function StepAttribute({ d, set }) {
  const base = baseScores(d);
  const bonus = originBonus(d);
  const fin = finalScores(d);
  const cls = findClass(d.cls);
  const bg = bgOf(d);
  const sp = speciesOf(d);
  const vals = d.method === 'roll' ? d.rolled || [] : STANDARD_ARRAY;
  const usedIdx = new Set(Object.values(d.assign).filter((x) => x != null));
  const spent = AB.reduce((a, k) => a + POINT_COST[d.buy[k]], 0);
  const rollIt = () => {
    const sets = Array.from({ length: 6 }, () => prepareRoll('4d6dl1', { kind: 'free' })).filter(Boolean);
    showRollAnimated({ dice: sets.flatMap((s) => s.dice), total: sets.reduce((a, s) => a + s.total, 0), label: 'Attributswerte', text: sets.map((s) => s.total).join(' · '), notes: [], ts: Date.now(), input: '6 × 4W6' });
    set({ rolled: sets.map((s) => s.total).sort((a, b) => b - a), assign: {} });
  };
  const ts = tashaAmounts(d);
  return html`<div class="stack lg">
    <${Segmented} value=${d.method} onChange=${(v) => set({ method: v, assign: {} })} options=${[{ value: 'standard', label: 'Standardwerte' }, { value: 'pointbuy', label: 'Punktekauf (27)' }, { value: 'roll', label: 'Auswürfeln (4W6)' }]} />
    <div class="small muted">${d.method === 'standard' ? 'Verteile 15, 14, 13, 12, 10 und 8 auf die Attribute.' : d.method === 'pointbuy' ? 'Jedes Attribut startet bei 8. Werte bis 15 kosten Punkte (14 = 7, 15 = 9).' : 'Würfle sechsmal 4W6 und streiche jeweils den niedrigsten Würfel – dann verteilen.'}
      ${cls ? html` Tipp für ${cls.name}: zuerst ${cls.primary.map((k) => AB_NAME[k]).join(' und ')}, dann Konstitution.` : null}</div>

    ${d.method === 'roll' ? html`<div class="row"><${Btn} icon="dices" onClick=${rollIt}>${d.rolled ? 'Neu würfeln' : '6 × 4W6 würfeln'}<//>${d.rolled ? html`<span class="row" style="gap:6px">${d.rolled.map((v) => html`<span class="badge accent" style="font-size:15px;padding:3px 10px">${v}</span>`)}</span>` : null}</div>` : null}

    ${d.method === 'pointbuy' ? html`<div class="stack sm">
      <div class=${`small ${spent > POINT_BUDGET ? 'danger-text' : 'muted'}`}>Punkte: ${spent} / ${POINT_BUDGET} ausgegeben</div>
      <div class="buy-grid">${AB.map((k) => html`<div class="buy-item"><b>${AB_NAME[k]}</b>
        <div class="row nowrap"><${IconBtn} icon="minus" disabled=${d.buy[k] <= 8} onClick=${() => set({ buy: { ...d.buy, [k]: d.buy[k] - 1 } })} /><b class="val">${d.buy[k]}</b><${IconBtn} icon="plus" disabled=${d.buy[k] >= 15 || spent - POINT_COST[d.buy[k]] + POINT_COST[d.buy[k] + 1] > POINT_BUDGET} onClick=${() => set({ buy: { ...d.buy, [k]: d.buy[k] + 1 } })} /></div>
        <span class="tiny faint">${POINT_COST[d.buy[k]]} Pkt.</span></div>`)}</div>
    </div>` : (d.method === 'standard' || d.rolled) ? html`<div class="stack sm">
      <div class="buy-grid">${AB.map((k) => html`<div class="buy-item"><b>${AB_NAME[k]}</b>
        <select class="select" value=${d.assign[k] ?? ''} onChange=${(e) => set({ assign: { ...d.assign, [k]: e.target.value === '' ? null : Number(e.target.value) } })}>
          <option value="">–</option>
          ${vals.map((v, i) => html`<option value=${i} disabled=${usedIdx.has(i) && d.assign[k] !== i}>${v}</option>`)}
        </select></div>`)}</div>
      ${cls ? html`<div><${Btn} size="sm" kind="ghost" icon="sparkles" onClick=${() => set({ assign: recommendAssign(d) })}>Empfohlen für ${cls.name} verteilen<//></div>` : null}
    </div>` : null}

    ${d.edition === '2024' && bg?.abilities ? html`<div class="card stack sm">
      <b>Attributswerterhöhung durch den Hintergrund „${bg.name}“</b>
      <${Segmented} value=${d.bgMode} onChange=${(v) => set({ bgMode: v })} options=${[{ value: '21', label: '+2 und +1' }, { value: '111', label: '+1 auf alle drei' }]} />
      ${d.bgMode === '21' ? html`<div class="row">
        <label class="small">+2 auf <${Select} class="sm" value=${d.bgPlus2} onChange=${(v) => set({ bgPlus2: v })} options=${[{ value: '', label: '–' }, ...bg.abilities.map((k) => ({ value: k, label: AB_NAME[k] }))]} /></label>
        <label class="small">+1 auf <${Select} class="sm" value=${d.bgPlus1} onChange=${(v) => set({ bgPlus1: v })} options=${[{ value: '', label: '–' }, ...bg.abilities.filter((k) => k !== d.bgPlus2).map((k) => ({ value: k, label: AB_NAME[k] }))]} /></label>
      </div>` : html`<div class="small muted">${bg.abilities.map((k) => AB_NAME[k]).join(', ')} je +1.</div>`}
    </div>` : null}

    ${d.edition === '2014' && sp ? html`<div class="card stack sm">
      <b>Attributswerterhöhung durch das Volk</b>
      ${ts.amounts.length && ts.amounts.length < 6 ? html`<${Toggle} checked=${d.tasha} onChange=${(v) => set({ tasha: v, tashaAssign: [], asiPicks: [] })} label="Boni frei verteilen (Optionale Regel aus Taschas Kessel)" />` : null}
      ${d.tasha && ts.amounts.length < 6 ? html`<div class="row">${ts.amounts.map((amt, i) => html`<label class="small">+${amt} auf <${Select} class="sm" value=${d.tashaAssign[i] || ''} onChange=${(v) => { const a = [...d.tashaAssign]; a[i] = v; set({ tashaAssign: a }); }} options=${[{ value: '', label: '–' }, ...AB.map((k) => ({ value: k, label: AB_NAME[k] }))]} /></label>`)}</div>`
        : html`<div class="small muted">${Object.entries(ts.fixed).map(([k, v]) => `${AB_NAME[k]} +${v}`).join(', ') || '–'}</div>
          ${ts.choice ? html`<div class="stack sm"><span class="small">Wähle ${ts.choice.n} × +${ts.choice.amount}:</span><div class="chips">${AB.filter((k) => !(ts.choice.exclude || []).includes(k)).map((k) => {
            const on = d.asiPicks.includes(k);
            return html`<button type="button" class=${`chip${on ? ' selected' : ' suggest'}`} onClick=${() => set({ asiPicks: on ? d.asiPicks.filter((x) => x !== k) : d.asiPicks.length < ts.choice.n ? [...d.asiPicks, k] : d.asiPicks })}>${AB_NAME[k]}</button>`;
          })}</div></div>` : null}`}
    </div>` : null}

    <${AbilityTable} d=${d} base=${base} bonus=${bonus} final=${fin} />
    ${asiLevels(d).length ? html`<div class="small faint">Attributswerterhöhungen ab Stufe 4 wählst du im Schritt „Talente & Stufen“.</div>` : null}
  </div>`;
}

function StepFertigkeiten({ d, set }) {
  const n = skillNeeds(d);
  const fixed = fixedSkills(d);
  const locked = Object.fromEntries(fixed.map((x) => [x.key, x.src]));
  const lockedWith = (extra) => ({ ...locked, ...extra });
  const clsLocks = Object.fromEntries([...d.anySkills, ...d.skilledPicks, d.speciesSkill].filter(Boolean).map((k) => [k, 'andere Quelle']));
  const all = skillSet(d);
  return html`<div class="stack lg">
    ${fixed.length ? html`<div class="small muted">Bereits geübt: ${fixed.map((x) => `${skillName(x.key)} (${x.src})`).join(', ')}. Überschneidet sich eine Wahl, darfst du stattdessen eine andere Fertigkeit nehmen.</div>` : null}
    <div class="card stack sm">
      <div class="row"><b class="grow">Klassenfertigkeiten</b><span class="small muted">${d.classSkills.length} / ${n.cls.n}</span></div>
      <${SkillGrid} list=${n.cls.list} picked=${d.classSkills} max=${n.cls.n} onChange=${(v) => set({ classSkills: v, expertise: d.expertise.filter((k) => v.includes(k) || locked[k]) })} locked=${lockedWith(clsLocks)} />
    </div>
    ${n.choice ? html`<div class="card stack sm">
      <b>${n.choice.label}</b>
      <div class="chips">${n.choice.list.map((k) => html`<button type="button" class=${`chip${d.speciesSkill === k ? ' selected' : ' suggest'}`} disabled=${all.has(k) && d.speciesSkill !== k} onClick=${() => set({ speciesSkill: d.speciesSkill === k ? '' : k })}>${skillName(k)}</button>`)}</div>
    </div>` : null}
    ${n.any ? html`<div class="card stack sm">
      <div class="row"><b class="grow">Freie Fertigkeiten (Volk/Hintergrund)</b><span class="small muted">${d.anySkills.length} / ${n.any}</span></div>
      <${SkillGrid} list=${ALL_SKILLS} picked=${d.anySkills} max=${n.any} onChange=${(v) => set({ anySkills: v })} locked=${lockedWith(Object.fromEntries([...d.classSkills, ...d.skilledPicks, d.speciesSkill].filter(Boolean).map((k) => [k, 'schon gewählt'])))} />
    </div>` : null}
    ${n.skilled ? html`<div class="card stack sm">
      <div class="row"><b class="grow">Talent „Begabt“ / Fertigkeitsexperte</b><span class="small muted">${d.skilledPicks.length} / ${n.skilled}</span></div>
      <${SkillGrid} list=${ALL_SKILLS} picked=${d.skilledPicks} max=${n.skilled} onChange=${(v) => set({ skilledPicks: v })} locked=${lockedWith(Object.fromEntries([...d.classSkills, ...d.anySkills, d.speciesSkill].filter(Boolean).map((k) => [k, 'schon gewählt'])))} />
      <div class="tiny faint">Statt Fertigkeiten sind auch Werkzeuge erlaubt – trage sie dann im Bogen unter Merkmale ein.</div>
    </div>` : null}
    ${n.expertise ? html`<div class="card stack sm">
      <div class="row"><b class="grow">Expertise (doppelter Übungsbonus)</b><span class="small muted">${d.expertise.length} / ${n.expertise}</span></div>
      <${SkillGrid} list=${[...all]} picked=${d.expertise} max=${n.expertise} onChange=${(v) => set({ expertise: v })} />
    </div>` : null}
    <div class="small muted"><b>Geübt:</b> ${[...all].map(skillName).join(', ') || '–'}</div>
  </div>`;
}

function FeatSelect({ d, value, onChange, cats, ab, onAb, exclude = [] }) {
  const list = featsFor(d.edition, cats).filter((f) => !exclude.includes(f.key) || f.key === value);
  const f = findFeat(value);
  const asi = featAsi(f, d.edition);
  return html`<div class="stack sm">
    <${Select} value=${value || ''} onChange=${onChange} options=${[{ value: '', label: 'Talent wählen …' }, ...list.map((x) => ({ value: x.key, label: `${x.name}${featAsi(x, d.edition) ? ' (+1)' : ''}` }))]} />
    ${f ? html`<div class="hint">${f.desc}${f.req ? ` Voraussetzung: ${f.req}.` : ''}</div>` : null}
    ${asi ? html`<label class="small">+1 auf <${Select} class="sm" value=${ab || ''} onChange=${onAb} options=${[{ value: '', label: '–' }, ...asi.map((k) => ({ value: k, label: AB_NAME[k] }))]} /></label>` : null}
  </div>`;
}

function StepTalente({ d, set }) {
  const sp = speciesOf(d);
  const bg = bgOf(d);
  const levels = asiLevels(d);
  const fin = finalScores(d);
  const setAsi = (lvl, patch) => set({ asis: { ...d.asis, [lvl]: { type: 'asi', ...(d.asis[lvl] || {}), ...patch } } });
  const taken = draftFeats(d).map((f) => f.key).filter((k) => !['skilled', 'magic-initiate-cleric', 'magic-initiate-druid', 'magic-initiate-wizard'].includes(k));
  return html`<div class="stack lg">
    ${d.edition === '2024' && bg?.feat ? html`<div class="card stack sm"><b><${Icon} name="star" size=${15} /> Herkunftstalent: ${findFeat(bg.feat)?.name}</b><div class="small muted">${findFeat(bg.feat)?.desc}</div><div class="tiny faint">Kommt vom Hintergrund „${bg.name}“.</div></div>` : null}
    ${d.edition === '2024' && sp?.originFeat ? html`<div class="card stack sm"><b>${sp.name}: zusätzliches Herkunftstalent (Vielseitig)</b>
      <${FeatSelect} d=${d} cats=${['origin']} value=${d.humanFeat} onChange=${(v) => set({ humanFeat: v })} exclude=${taken} /></div>` : null}
    ${variantFeatAllowed(d) ? html`<div class="card stack sm"><b>Talent (${subOf(d)?.name || sp?.name})</b>
      <${FeatSelect} d=${d} cats=${['origin', 'general']} value=${d.variantFeat} onChange=${(v) => set({ variantFeat: v, variantFeatAb: '' })} ab=${d.variantFeatAb} onAb=${(v) => set({ variantFeatAb: v })} exclude=${taken} /></div>` : null}
    ${levels.length ? levels.map((l) => {
      const a = d.asis[l.level] || { type: 'asi' };
      return html`<div class="card stack sm" key=${l.level}>
        <div class="row"><b class="grow">Stufe ${l.level}: ${l.boon ? 'Epische Gabe' : 'Attributswerterhöhung'}</b>
          <${Segmented} value=${a.type} onChange=${(v) => set({ asis: { ...d.asis, [l.level]: { type: v } } })} options=${[{ value: 'asi', label: l.boon ? '+1 Attribut (bis 30)' : '+2 / +1+1' }, { value: 'feat', label: 'Talent' }]} /></div>
        ${a.type === 'feat'
          ? html`<${FeatSelect} d=${d} cats=${l.boon ? ['epic', 'general'] : ['general', ...(d.edition === '2014' ? ['origin'] : [])]} value=${a.feat} onChange=${(v) => setAsi(l.level, { type: 'feat', feat: v, featAb: '' })} ab=${a.featAb} onAb=${(v) => setAsi(l.level, { featAb: v })} exclude=${taken} />`
          : html`<div class="row">
            <label class="small">${a.b && a.b !== a.a ? '+1' : '+2'} auf <${Select} class="sm" value=${a.a || ''} onChange=${(v) => setAsi(l.level, { a: v })} options=${[{ value: '', label: '–' }, ...AB.map((k) => ({ value: k, label: `${AB_NAME[k]} (${fin[k] ?? '–'})` }))]} /></label>
            <label class="small">und +1 auf <${Select} class="sm" value=${a.b || ''} onChange=${(v) => setAsi(l.level, { b: v })} options=${[{ value: '', label: '– (dann +2 auf das erste)' }, ...AB.filter((k) => k !== a.a).map((k) => ({ value: k, label: AB_NAME[k] }))]} /></label>
          </div>`}
      </div>`;
    }) : html`<div class="small faint">Auf Stufe ${d.level} gibt es noch keine Attributswerterhöhung (die erste kommt auf Stufe 4).</div>`}
    <div class="small muted"><b>Attribute jetzt:</b> ${AB.map((k) => `${AB_SHORT[k]} ${fin[k] ?? '–'}`).join(' · ')}</div>
  </div>`;
}

function StepAusruestung({ d, set }) {
  const opts = classEquipOptions(d);
  const bg = bgOf(d);
  const pk = packageText(d);
  const auto = detectGear(`${pk.cls}, ${pk.bg}`);
  const weapons = d.weaponsTouched ? d.weapons : auto.weapons;
  const armorBody = d.weaponsTouched ? d.armorBody : auto.armor;
  const shield = d.weaponsTouched ? d.shield : auto.shield;
  const touch = (patch) => set({ weaponsTouched: true, weapons, armorBody, shield, ...patch });
  const preview = { ...buildPreview({ ...d, weaponsTouched: true, weapons, armorBody, shield }), armor: { body: armorBody, shield } };
  const cm = charMods(preview);
  return html`<div class="stack lg">
    <div class="card stack sm">
      <b>Klassenausrüstung</b>
      <div class="stack sm">${opts.map((o) => html`<label class="radio-card"><input type="radio" name="eqc" checked=${d.equipClass === o.key} onChange=${() => set({ equipClass: o.key, weaponsTouched: false })} /><span><b>${o.label}</b>${o.text ? html`<br /><span class="small muted">${o.text}</span>` : null}</span></label>`)}</div>
      ${d.edition === '2014' && d.equipClass === 'gold' ? html`<div class="row"><${Btn} size="sm" icon="dices" onClick=${() => { const g = String(findClass(d.cls)?.gold?.[2014] || '4d4×10'); const m = /(\d+)d(\d+)(?:×(\d+))?/.exec(g); const r = doRoll(`${m[1]}d${m[2]}`, { label: 'Startgold', share: false }); if (r) set({ gold2014: r.total * (Number(m[3]) || 1) }); }}>Gold würfeln<//>${d.gold2014 != null ? html`<b>${d.gold2014} GM</b>` : null}</div>` : null}
    </div>
    ${d.edition === '2024' && bg ? html`<div class="card stack sm">
      <b>Hintergrundausrüstung</b>
      <label class="radio-card"><input type="radio" name="eqb" checked=${d.equipBg === 'A'} onChange=${() => set({ equipBg: 'A', weaponsTouched: false })} /><span><b>Paket</b><br /><span class="small muted">${bg.equip}</span></span></label>
      <label class="radio-card"><input type="radio" name="eqb" checked=${d.equipBg === 'B'} onChange=${() => set({ equipBg: 'B', weaponsTouched: false })} /><span><b>Stattdessen 50 GM</b></span></label>
    </div>` : null}
    <div class="card stack sm">
      <div class="row"><b class="grow">Getragene Rüstung</b><span class="badge accent">RK ${cm.ac.ac}</span></div>
      <div class="row">
        <${Select} value=${armorBody || ''} onChange=${(v) => touch({ armorBody: v })} options=${[{ value: '', label: 'Keine Rüstung' }, ...ARMOR.map((a) => ({ value: a.key, label: `${a.name} (${ARMOR_TYPE[a.type]}, RK ${a.ac}${a.type === 'light' ? ' + GES' : a.type === 'medium' ? ' + GES max. 2' : ''})${armorAllowed(d, a.type) ? '' : ' – ungeübt!'}` }))]} style="max-width:420px" />
        <${Toggle} checked=${shield} onChange=${(v) => touch({ shield: v })} label=${`Schild (+2)${armorAllowed(d, 'shield') ? '' : ' – ungeübt!'}`} />
      </div>
      <div class="tiny faint">${cm.ac.parts.join(' · ')}${cm.ac.stealthDis ? ' · Nachteil auf Heimlichkeit' : ''}</div>
    </div>
    <div class="card stack sm">
      <b>Waffen</b>
      <div class="chips">${WEAPONS.map((w) => {
        const on = weapons.includes(w.key);
        return html`<button type="button" class=${`chip${on ? ' selected' : ' suggest'}`} onClick=${() => touch({ weapons: on ? weapons.filter((x) => x !== w.key) : [...weapons, w.key] })}>${w.name} <small class="faint">${w.dmg}</small></button>`;
      })}</div>
      <div class="tiny faint">Aus dem Ausrüstungspaket erkannt – anpassbar. Angriffs- und Schadensboni rechnet der Bogen selbst aus.</div>
    </div>
  </div>`;
}

// Automatisch erkannte Rüstung/Waffen übernehmen, solange nichts von Hand gewählt wurde
function withGear(d) {
  if (d.weaponsTouched) return d;
  const pk = packageText(d);
  const auto = detectGear(`${pk.cls}, ${pk.bg}`);
  return { ...d, weapons: auto.weapons, armorBody: auto.armor, shield: auto.shield };
}

function buildPreview(d) {
  try {
    return buildCharacter(withGear({ ...d, name: d.name || 'Vorschau' }));
  } catch {
    return { abilities: finalScores(d), classes: [], feats: [] };
  }
}

function StepZauber({ d, set }) {
  const prev = buildPreview(d);
  const cm = charMods(prev);
  const sc = cm.spell[0];
  const slots = spellSlots(prev);
  const needs = casterNeeds(prev);
  const extra = draftFeats(d).filter((f) => f.key.startsWith('magic-initiate'));
  return html`<div class="stack lg">
    ${sc ? html`<div class="row small muted" style="gap:8px">
      <span class="badge">SG ${sc.dc} · Zauberangriff ${fmtMod(sc.attack)}</span>
      <span>Plätze: ${Object.entries(slots.slots).map(([g, n]) => `${g}. Grad × ${n}`).join(' · ') || '–'}${slots.pact ? ` · Pakt: ${slots.pact.count} × ${slots.pact.level}. Grad` : ''}</span>
    </div>` : null}
    ${needs.length
      ? html`<${SpellManager} c=${prev} entries=${d.spellList || []} onChange=${(v) => set({ spellList: v })} mode="create" needs=${needs} />`
      : html`<div class="small muted">Deine Klasse wirkt auf dieser Stufe noch keine Zauber.</div>`}
    ${extra.length ? html`<div class="small muted"><${Icon} name="info" size=${14} /> Zauber aus ${extra.map((f) => f.name).join(', ')} trägst du nach dem Erstellen im Bogen unter „Zauber verwalten → Talente & Gegenstände“ ein.</div>` : null}
  </div>`;
}

function StepDetails({ d, set }) {
  const p = d.personality;
  return html`<div class="stack lg">
    <div class="grid two">
      <${Field} label="Gesinnung"><${Select} value=${d.alignment} onChange=${(v) => set({ alignment: v })} options=${[{ value: '', label: '–' }, ...ALIGNMENTS]} /><//>
      <${Field} label="Aussehen"><input class="input" value=${d.appearance} onInput=${(e) => set({ appearance: e.target.value })} placeholder="Alter, Größe, Haare, Narben …" /><//>
    </div>
    <${Field} label="Sprachen" hint=${d.edition === '2024' ? 'Gemeinsprache und zwei weitere Standardsprachen.' : 'Gemeinsprache, die Sprache deines Volkes und ggf. weitere durch den Hintergrund.'}>
      <div class="chips">${LANGUAGES.map((l) => {
        const on = d.languages.includes(l);
        return html`<button type="button" class=${`chip${on ? ' selected' : ' suggest'}`} onClick=${() => set({ languages: on ? d.languages.filter((x) => x !== l) : [...d.languages, l] })}>${l}</button>`;
      })}</div>
    <//>
    <div class="grid two">
      ${[['traits', 'Persönlichkeitsmerkmale'], ['ideals', 'Ideale'], ['bonds', 'Bindungen'], ['flaws', 'Makel']].map(([k, l]) => html`<${Field} label=${l}><textarea class="textarea" value=${p[k]} onInput=${(e) => set({ personality: { ...p, [k]: e.target.value } })} /><//>`)}
    </div>
    <${Field} label="Hintergrundgeschichte"><textarea class="textarea" style="min-height:120px" value=${d.backstory} onInput=${(e) => set({ backstory: e.target.value })} /><//>
  </div>`;
}

function StepFertig({ d }) {
  const c = buildPreview(d);
  const cm = charMods(c);
  const units = settings.get().units || 'm';
  return html`<div class="stack lg">
    <div class="summary-head">
      <div><h2 style="margin:0;font-family:var(--font-serif)">${c.name}</h2>
        <div class="muted">${c.species} · ${findClass(d.cls)?.name}${d.subclass ? ` (${d.subclass})` : ''} ${d.level} · ${c.background}</div></div>
    </div>
    <div class="stat-grid">${AB.map((k) => html`<div class="stat-box"><span class="lbl">${AB_SHORT[k]}</span><span class="mod">${fmtMod(cm.mods[k])}</span><span class="small">${c.abilities[k]}</span></div>`)}</div>
    <div class="vitals">
      <div class="vital"><div class="lbl">Trefferpunkte</div><div class="val">${c.maxHp}</div></div>
      <div class="vital"><div class="lbl">Rüstungsklasse</div><div class="val">${cm.ac.ac}</div></div>
      <div class="vital"><div class="lbl">Initiative</div><div class="val">${fmtMod(cm.init)}</div></div>
      <div class="vital"><div class="lbl">Bewegung</div><div class="val">${fmtDist(c.speed, units)}</div></div>
      <div class="vital"><div class="lbl">Übungsbonus</div><div class="val">+${cm.pb}</div></div>
      <div class="vital"><div class="lbl">Passive Wahrn.</div><div class="val">${cm.passive.perception}</div></div>
    </div>
    <div class="grid two small">
      <div class="card"><b>Rettungswürfe</b><div>${AB.filter((k) => cm.saves[k].prof).map((k) => `${AB_NAME[k]} ${fmtMod(cm.saves[k].bonus)}`).join(', ')}</div></div>
      <div class="card"><b>Fertigkeiten</b><div>${ALL_SKILLS.filter((k) => cm.skills[k].prof).map((k) => `${skillName(k)}${cm.skills[k].prof === 2 ? ' (Expertise)' : ''} ${fmtMod(cm.skills[k].bonus)}`).join(', ') || '–'}</div></div>
      <div class="card"><b>Talente</b><div>${c.feats.map((f) => f.name).join(', ') || '–'}</div></div>
      <div class="card"><b>Ausrüstung</b><div>${c.inventory.map((i) => `${i.qty > 1 ? `${i.qty} ` : ''}${i.name}`).join(', ') || '–'} · ${c.currency.gp} GM</div></div>
    </div>
    <div class="small muted">Nach dem Erstellen sind die Werte fest. Ändern kannst du sie beim Stufenaufstieg – oder in Ausnahmefällen über den Korrektur-Modus des Bogens.</div>
  </div>`;
}

const STEPS = [
  { key: 'basis', label: 'Grundlagen', comp: StepBasis },
  { key: 'klasse', label: 'Klasse', comp: StepKlasse },
  { key: 'herkunft', label: 'Herkunft', comp: StepHerkunft },
  { key: 'attribute', label: 'Attribute', comp: StepAttribute },
  { key: 'fertigkeiten', label: 'Fertigkeiten', comp: StepFertigkeiten },
  { key: 'talente', label: 'Talente & Stufen', comp: StepTalente },
  { key: 'ausruestung', label: 'Ausrüstung', comp: StepAusruestung },
  { key: 'zauber', label: 'Zauber', comp: StepZauber, when: (d) => !!findClass(d.cls)?.cast || /Mystischer Ritter|Arkaner Betrüger/.test(d.subclass) || draftFeats(d).some((f) => f.key.startsWith('magic-initiate')) },
  { key: 'details', label: 'Persönlichkeit', comp: StepDetails },
  { key: 'fertig', label: 'Übersicht', comp: StepFertig },
];

function CharWizard({ close, campaignId }) {
  const [d, setD] = useState(() => blankDraft(campaignId));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const setEdition = (ed) => setD((x) => ({ ...blankDraft(x.campaignId), name: x.name, level: x.level, edition: ed }));
  const steps = STEPS.filter((s) => !s.when || s.when(d));
  const idx = Math.min(step, steps.length - 1);
  const cur = steps[idx];
  const probs = problems(d, cur.key);
  const allProbs = steps.flatMap((s) => problems(d, s.key).map((p) => ({ i: steps.indexOf(s), p })));
  const create = async () => {
    setBusy(true);
    try {
      const c = buildCharacter(withGear(d));
      const me = myUid();
      const id = await db.add(`users/${me}/characters`, c);
      if (c.campaignId) await db.update(`campaigns/${c.campaignId}/members`, me, { characterId: id }).catch(() => {});
      toast(`${c.name} ist bereit!`, 'success');
      close({ id, ...c });
    } catch (e) {
      toast(`Konnte nicht gespeichert werden: ${e.message}`, 'error');
      setBusy(false);
    }
  };
  const cancel = async () => {
    if ((!d.name && !d.cls) || await confirmDialog('Assistent schließen? Deine Eingaben gehen verloren.', { ok: 'Schließen', danger: true })) close(null);
  };
  const Comp = cur.comp;
  return html`<div class="wiz">
    <div class="wiz-head">
      <h2><${Icon} name="user-plus" />Neuer Charakter${d.name ? html`<span class="faint">: ${d.name}</span>` : null}</h2>
      <span class="badge">${d.edition}</span>
      <${IconBtn} icon="x" title="Schließen" onClick=${cancel} />
    </div>
    <div class="wiz-body">
      <nav class="wiz-steps">${steps.map((s, i) => {
        const bad = problems(d, s.key).length;
        return html`<button type="button" class=${`wiz-step${i === idx ? ' active' : ''}${i < idx && !bad ? ' done' : ''}${i < idx && bad ? ' bad' : ''}`} onClick=${() => setStep(i)}>
          <span class="n">${i < idx && !bad ? '✓' : i + 1}</span><span>${s.label}</span></button>`;
      })}</nav>
      <div class="wiz-main"><${Comp} d=${d} set=${set} setEdition=${setEdition} /></div>
    </div>
    <div class="wiz-foot">
      ${probs.length ? html`<span class="small warn-text"><${Icon} name="info" size=${14} /> ${probs[0]}</span>` : cur.key === 'fertig' && allProbs.length ? html`<span class="small warn-text">Noch offen in „${steps[allProbs[0].i].label}“: ${allProbs[0].p}</span>` : html`<span class="small faint">Schritt ${idx + 1} von ${steps.length}</span>`}
      <span class="grow"></span>
      <${Btn} kind="ghost" disabled=${idx === 0} onClick=${() => setStep(idx - 1)}>Zurück<//>
      ${cur.key === 'fertig'
        ? html`<${Btn} kind="primary" icon="check" loading=${busy} disabled=${allProbs.length > 0} onClick=${create}>Charakter erstellen<//>`
        : html`<${Btn} kind="primary" disabled=${probs.length > 0} onClick=${() => setStep(idx + 1)}>Weiter<//>`}
    </div>
  </div>`;
}

export function openCharacterWizard({ campaignId } = {}) {
  return openModal(({ close }) => html`<${CharWizard} close=${close} campaignId=${campaignId} />`, { size: 'xl', dismissable: false });
}

// ───────────────────────── Stufenaufstieg ─────────────────────────
export function applyLevelUp(c, lu) {
  const x = structuredClone(c);
  const ed = edOf(x);
  x.classes = x.classes || [];
  let entry = x.classes.find((k) => k.cls === lu.cls);
  if (!entry) {
    entry = { cls: lu.cls, level: 0, subclass: '' };
    x.classes.push(entry);
  }
  entry.level += 1;
  if (lu.subclass) entry.subclass = lu.subclass;
  x.hpBase = [...(x.hpBase || []), lu.hp];
  x.feats = [...(x.feats || [])];
  x.abilities = { ...x.abilities };
  if (lu.asi) {
    const cap = lu.asi.boon ? 30 : 20;
    if (lu.asi.type === 'feat' && lu.asi.feat) {
      x.feats.push({ key: lu.asi.feat, name: findFeat(lu.asi.feat)?.name || lu.asi.feat, source: `${findClass(lu.cls)?.name} ${entry.level}`, ab: lu.asi.featAb });
      if (lu.asi.featAb && featAsi(findFeat(lu.asi.feat), ed)) x.abilities[lu.asi.featAb] = Math.min(cap, (x.abilities[lu.asi.featAb] || 10) + 1);
      if (lu.asi.feat === 'resilient' && lu.asi.featAb) x.saves = [...new Set([...(x.saves || []), lu.asi.featAb])];
    } else if (lu.asi.a) {
      if (lu.asi.boon) x.abilities[lu.asi.a] = Math.min(30, (x.abilities[lu.asi.a] || 10) + 1);
      else if (lu.asi.b && lu.asi.b !== lu.asi.a) {
        x.abilities[lu.asi.a] = Math.min(20, (x.abilities[lu.asi.a] || 10) + 1);
        x.abilities[lu.asi.b] = Math.min(20, (x.abilities[lu.asi.b] || 10) + 1);
      } else x.abilities[lu.asi.a] = Math.min(20, (x.abilities[lu.asi.a] || 10) + 2);
    }
    x.asi = [...(x.asi || []), { level: entry.level, cls: lu.cls, ...lu.asi }];
  }
  if (lu.style) x.feats.push({ key: lu.style, name: findFeat(lu.style)?.name || lu.style, source: 'Kampfstil' });
  x.skills = { ...(x.skills || {}) };
  for (const k of lu.skills || []) if (!x.skills[k]) x.skills[k] = 1;
  for (const k of lu.expertise || []) if (x.skills[k]) x.skills[k] = 2;
  if (lu.spellList) x.spell = { ...(x.spell || {}), list: lu.spellList.map((e) => ({ ...e })) };
  else if (lu.spells?.length) x.spell = { ...(x.spell || {}), list: [...(x.spell?.list || []), ...lu.spells.map((n) => ({ id: uid(5), name: n, level: 1, prepared: true }))] };
  x.levelLog = [...(x.levelLog || []), { level: totalLevel(x), cls: lu.cls, hp: lu.hp, ts: now() }];
  const d = derive(x);
  d.xp = Math.max(Number(d.xp) || 0, XP_LEVELS[d.level - 1] || 0);
  d.updatedAt = now();
  return d;
}

function LevelUp({ c, close }) {
  const ed = edOf(c);
  const total = totalLevel(c);
  const [clsKey, setClsKey] = useState(c.classes?.[0]?.cls || '');
  const [hp, setHp] = useState(null);
  const [hpMode, setHpMode] = useState('');
  const [sub, setSub] = useState('');
  const [asi, setAsi] = useState({ type: 'asi' });
  const [style, setStyle] = useState('');
  const [skills, setSkills] = useState([]);
  const [expertise, setExpertise] = useState([]);
  const allSpells = useSpells(ed);
  const baseline = useMemo(() => (allSpells ? normalizeEntries(c.spell?.list, allSpells, c) : null), [allSpells]);
  const [spellList, setSpellList] = useState(null);
  useEffect(() => { if (baseline) setSpellList(baseline); }, [baseline, clsKey]);
  const cls = findClass(clsKey);
  const entry = c.classes?.find((x) => x.cls === clsKey);
  const newLvl = (entry?.level || 0) + 1;
  const isNew = !entry;
  const feats = cls ? classFeatures(clsKey, ed, newLvl, newLvl) : [];
  const needSub = cls && newLvl === subclassLevel(clsKey, ed) && !entry?.subclass;
  const asiF = feats.find((f) => f.kind === 'asi' || f.kind === 'boon');
  const needStyle = cls?.style && newLvl === cls.style && !(c.feats || []).some((f) => f.key.startsWith('style-'));
  const expN = cls?.expertise?.[ed]?.[newLvl] || 0;
  const mcSkill = isNew && ['barde', 'waldlaeufer', 'schurke'].includes(clsKey) ? 1 : 0;
  const cm = charMods(c);
  const con = cm.mods.con;
  const prevX = cls ? spellcasting({ cls: clsKey, level: newLvl - 1, subclass: entry?.subclass || sub }, ed, cm.mods) : null;
  const nextX = cls ? spellcasting({ cls: clsKey, level: newLvl, subclass: entry?.subclass || sub }, ed, cm.mods) : null;
  const mc = isNew && cls ? multiclassOk(c, clsKey) : { ok: true };
  const mcHome = isNew && c.classes?.[0] ? multiclassOk(c, c.classes[0].cls) : { ok: true };
  const bonusHp = hpBonusPerLevel(c);
  const probs = [];
  if (!cls) probs.push('Klasse wählen.');
  if (isNew && (!mc.ok || !mcHome.ok)) probs.push(`Mehrklassen-Voraussetzung nicht erfüllt: ${mc.why || mcHome.why}`);
  if (hp == null) probs.push('Trefferpunkte würfeln oder den Durchschnitt nehmen.');
  if (needSub && !sub) probs.push(`${cls.subLabel} wählen.`);
  if (asiF && (asi.type === 'feat' ? !asi.feat : !asi.a)) probs.push('Attributswerterhöhung oder Talent wählen.');
  if (asiF && asi.type === 'feat' && featAsi(findFeat(asi.feat), ed) && !asi.featAb) probs.push('Attribut für das Talent wählen.');
  if (needStyle && !style) probs.push('Kampfstil wählen.');
  if (expertise.length !== expN) probs.push(`${expN} Fertigkeiten für Expertise wählen.`);
  if (skills.length !== mcSkill) probs.push('Eine Fertigkeit für die neue Klasse wählen.');
  const nextNeeds = cls ? spellNeeds({ cls: clsKey, level: newLvl, subclass: entry?.subclass || sub }, ed, cm.mods) : null;
  if (nextNeeds && !spellList) probs.push('Zauberliste wird geladen …');
  if (nextNeeds && spellList) probs.push(...checkSpells(spellList, [nextNeeds], { mode: 'levelup', baseline }));

  const rollHp = () => {
    const r = doRoll(`1d${cls.hd}`, { label: `${c.name}: Trefferpunkte (W${cls.hd})`, kind: 'free', share: false });
    if (r) { setHp(r.total); setHpMode('roll'); }
  };
  const apply = async () => {
    const next = applyLevelUp(c, { cls: clsKey, hp, subclass: needSub ? sub : '', asi: asiF ? { ...asi, boon: asiF.kind === 'boon' } : null, style: needStyle ? style : '', skills, expertise, spellList: nextNeeds ? spellList : null });
    close(next);
  };
  const profSkills = ALL_SKILLS.filter((k) => c.skills?.[k] === 1);
  return html`<div class="modal-body stack lg">
    <div class="small muted">${c.name} steigt von Stufe ${total} auf <b>Stufe ${total + 1}</b>. Übungsbonus danach: +${profBonus(total + 1)}.</div>
    <div class="card stack sm">
      <b>1. Klasse</b>
      <div class="chips">
        ${(c.classes || []).map((x) => html`<button type="button" class=${`chip${clsKey === x.cls ? ' selected' : ' suggest'}`} onClick=${() => { setClsKey(x.cls); setHp(null); }}>${findClass(x.cls)?.name} ${x.level} → ${x.level + 1}</button>`)}
        <select class="chip fx-select" value=${isNew ? clsKey : ''} onChange=${(e) => { if (e.target.value) { setClsKey(e.target.value); setHp(null); } }}>
          <option value="">Neue Klasse (Mehrklassen) …</option>
          ${classesFor(ed).filter((k) => !c.classes?.some((x) => x.cls === k.key)).map((k) => html`<option value=${k.key}>${k.name}${multiclassOk(c, k.key).ok ? '' : ' (Voraussetzung fehlt)'}</option>`)}
        </select>
      </div>
      ${isNew && cls ? html`<div class=${`small ${mc.ok && mcHome.ok ? 'muted' : 'danger-text'}`}>${mc.ok && mcHome.ok ? `Mehrklassen: Du erhältst ${cls.mc.gain}.` : mc.why || mcHome.why}</div>` : null}
    </div>
    ${cls ? html`
      <div class="card stack sm">
        <b>2. Trefferpunkte</b>
        <div class="row">
          <${Btn} icon="d20" onClick=${rollHp}>W${cls.hd} würfeln<//>
          <${Btn} kind=${hpMode === 'avg' ? 'primary' : ''} onClick=${() => { setHp(hpAverage(cls.hd)); setHpMode('avg'); }}>Durchschnitt nehmen (${hpAverage(cls.hd)})<//>
          ${hp != null ? html`<span><b>+${Math.max(1, hp + con) + bonusHp} TP</b> <span class="small muted">(${hp} ${fmtMod(con)} KON${bonusHp ? ` + ${bonusHp}` : ''})</span></span>` : null}
        </div>
      </div>
      <div class="card stack sm">
        <b>3. Neu auf ${cls.name}-Stufe ${newLvl}</b>
        ${feats.filter((f) => f.kind === 'feature').length ? html`<div class="feat-list">${feats.filter((f) => f.kind === 'feature').map((f) => html`<div><b>${f.name}</b>${f.desc ? html` <span class="small muted">– ${f.desc}</span>` : null}</div>`)}</div>` : null}
        ${nextX && (nextX.count !== prevX?.count || nextX.cantrips !== prevX?.cantrips) ? html`<div class="small accent-text">Zauber: ${nextX.cantrips} Zaubertricks, ${nextX.count} Zauber ${nextX.mode}${prevX ? ` (vorher ${prevX.cantrips} / ${prevX.count})` : ''}</div>` : null}
        ${needSub ? html`<${Field} label=${cls.subLabel}><${Select} value=${sub} onChange=${setSub} options=${[{ value: '', label: 'Bitte wählen …' }, ...(cls.subclasses[ed] || cls.subclasses[2014]).map((s) => ({ value: s, label: s }))]} /><//>` : null}
        ${feats.some((f) => f.kind === 'sub') && !needSub ? html`<div class="small muted">Neues Merkmal deiner Unterklasse ${entry?.subclass ? `(${entry.subclass})` : ''} – Details im Spielerhandbuch.</div>` : null}
        ${needStyle ? html`<${Field} label="Kampfstil"><${Select} value=${style} onChange=${setStyle} options=${[{ value: '', label: 'Bitte wählen …' }, ...featsFor(ed, ['style']).map((f) => ({ value: f.key, label: f.name.replace('Kampfstil: ', '') }))]} /><//>` : null}
        ${asiF ? html`<div class="stack sm">
          <div class="row"><b class="grow">${asiF.kind === 'boon' ? 'Epische Gabe' : 'Attributswerterhöhung'}</b>
            <${Segmented} value=${asi.type} onChange=${(v) => setAsi({ type: v })} options=${[{ value: 'asi', label: asiF.kind === 'boon' ? '+1 (bis 30)' : '+2 / +1+1' }, { value: 'feat', label: 'Talent' }]} /></div>
          ${asi.type === 'feat'
            ? html`<${FeatSelect} d=${{ edition: ed }} cats=${asiF.kind === 'boon' ? ['epic', 'general'] : ['general', ...(ed === '2014' ? ['origin'] : [])]} value=${asi.feat} onChange=${(v) => setAsi({ type: 'feat', feat: v })} ab=${asi.featAb} onAb=${(v) => setAsi({ ...asi, featAb: v })} exclude=${(c.feats || []).map((f) => f.key)} />`
            : html`<div class="row">
              <label class="small">${asiF.kind === 'boon' ? '+1' : asi.b && asi.b !== asi.a ? '+1' : '+2'} auf <${Select} class="sm" value=${asi.a || ''} onChange=${(v) => setAsi({ ...asi, a: v })} options=${[{ value: '', label: '–' }, ...AB.map((k) => ({ value: k, label: `${AB_NAME[k]} (${c.abilities?.[k] ?? 10})` }))]} /></label>
              ${asiF.kind !== 'boon' ? html`<label class="small">und +1 auf <${Select} class="sm" value=${asi.b || ''} onChange=${(v) => setAsi({ ...asi, b: v })} options=${[{ value: '', label: '– (dann +2)' }, ...AB.filter((k) => k !== asi.a).map((k) => ({ value: k, label: AB_NAME[k] }))]} /></label>` : null}
            </div>`}
        </div>` : null}
        ${expN ? html`<div class="stack sm"><b>Expertise: ${expN} Fertigkeiten</b><${SkillGrid} list=${profSkills} picked=${expertise} max=${expN} onChange=${setExpertise} /></div>` : null}
        ${mcSkill ? html`<div class="stack sm"><b>Fertigkeit der neuen Klasse</b><${SkillGrid} list=${classSkills(cls, ed).list.filter((k) => !c.skills?.[k])} picked=${skills} max=${1} onChange=${setSkills} /></div>` : null}
        ${!feats.length && !needSub ? html`<div class="small faint">Auf dieser Stufe gibt es kein neues Klassenmerkmal – nur mehr Trefferpunkte${nextX ? ' und ggf. Zauber' : ''}.</div>` : null}
      </div>
      ${nextNeeds ? html`<div class="card stack sm"><b>4. Zauber (Pflicht)</b>
        <div class="small muted">Wähle, was deine Klasse auf Stufe ${newLvl} neu dazubekommt. Die Zähler zeigen, was noch fehlt – erst dann geht der Aufstieg.</div>
        ${spellList ? html`<${SpellManager} c=${c} entries=${spellList} onChange=${setSpellList} mode="levelup" baseline=${baseline} needs=${[nextNeeds]} />` : html`<div class="empty"><span class="spinner" /></div>`}
      </div>` : null}
    ` : null}
    ${probs.length ? html`<div class="small warn-text"><${Icon} name="info" size=${14} /> ${probs[0]}</div>` : null}
    <div class="modal-foot" style="margin:0 -16px -16px">
      <${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//>
      <${Btn} kind="primary" icon="arrow-up" disabled=${probs.length > 0} onClick=${apply}>Auf Stufe ${total + 1} aufsteigen<//>
    </div>
  </div>`;
}

export function openLevelUp(c) {
  return openModal(({ close }) => html`<${LevelUp} c=${c} close=${close} />`, { title: `Stufenaufstieg: ${c.name}`, icon: 'arrow-up', size: 'xl' });
}

// ───────────────────────── Alte Bögen übernehmen ─────────────────────────
export function migrateLegacy(c, ed) {
  const cls = findClass(c.cls) || findClass('kaempfer');
  const all = SPECIES[ed];
  let sp = all.find((s) => s.name === c.species);
  let subKey = '';
  if (!sp) {
    for (const s of all) {
      const sub = (s.subs || []).find((x) => x.name === c.species || c.species?.includes(x.name.split(' ')[0]));
      if (sub) { sp = s; subKey = sub.key; break; }
    }
  }
  if (!sp) sp = all.find((s) => c.species && s.name.startsWith(String(c.species).slice(0, 4))) || all.find((s) => s.key === 'custom');
  const lvl = Math.max(1, Math.min(20, Number(c.level) || 1));
  const x = {
    ...c, edition: ed,
    classes: [{ cls: cls.key, level: lvl, subclass: c.subclass || '' }],
    speciesKey: sp.key, subspeciesKey: subKey, speciesOption: '', backgroundKey: '', background: c.background || '',
    feats: c.feats || [], hpBase: [cls.hd, ...Array(lvl - 1).fill(hpAverage(cls.hd))], hpAdjust: 0,
    weapons: [], armor: { body: '', shield: false }, acBonus: 0, hdUsed: 0, resUsed: {},
    speed: sp.speed || 30,
    spell: { used: {}, pactUsed: 0, list: (c.spell?.spells || []).map((s) => ({ id: s.id || uid(5), name: s.name, level: Number(s.level) || 0, prepared: s.prepared !== false })) },
    customFeatures: c.features || '', skills: c.skills || {}, saves: c.saves?.length ? c.saves : cls.saves,
  };
  let dd = derive(x);
  if (c.maxHp) x.hpAdjust = Number(c.maxHp) - dd.maxHp;
  dd = derive(x);
  if (c.ac) x.acBonus = Number(c.ac) - dd.ac;
  dd = derive({ ...x, hp: c.hp });
  return dd;
}
