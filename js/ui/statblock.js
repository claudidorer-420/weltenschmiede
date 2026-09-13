// 5e-Statblock: Normalisierung (versch. Schlüsselnamen), HTML-Darstellung, Markdown-Export.
import { esc } from '../lib/util.js';
import { renderInline, parseYaml } from '../lib/markdown.js';
import { modifier, fmtMod } from '../lib/dice.js';
import { ABILITIES, crXp, pbForCR, normCR } from '../data/rules5e.js';

const ABILITY_ALIASES = {
  str: ['str', 'STR', 'stä', 'STÄ', 'strength', 'staerke', 'stärke'],
  dex: ['dex', 'DEX', 'ges', 'GES', 'dexterity', 'geschicklichkeit'],
  con: ['con', 'CON', 'kon', 'KON', 'constitution', 'konstitution'],
  int: ['int', 'INT', 'intelligence', 'intelligenz'],
  wis: ['wis', 'WIS', 'wei', 'WEI', 'wisdom', 'weisheit'],
  cha: ['cha', 'CHA', 'charisma'],
};

function splitEntry(s) {
  const m = /^\*{0,3}([^.:*\n]{1,60})[.:]\*{0,3}\s+([\s\S]*)$/.exec(String(s));
  return m ? { name: m[1].trim(), desc: m[2].trim() } : { name: '', desc: String(s) };
}

function entries(x) {
  if (!x) return [];
  if (typeof x === 'string') return x.split(/\n+/).filter((l) => l.trim()).map(splitEntry);
  if (!Array.isArray(x)) return [];
  return x.map((e) => (typeof e === 'string' ? splitEntry(e) : { name: String(e.name || e.title || ''), desc: String(e.desc ?? e.description ?? e.text ?? e.entry ?? '') }));
}

export function normalizeMonster(raw = {}) {
  const m = raw || {};
  const src = m.abilities || m.stats || m.attributes || {};
  const abilities = {};
  ABILITIES.forEach(({ key }, i) => {
    let v;
    if (Array.isArray(src)) v = src[i];
    else for (const k of ABILITY_ALIASES[key]) if (src[k] !== undefined) { v = src[k]; break; }
    if (v === undefined) for (const k of ABILITY_ALIASES[key]) if (m[k] !== undefined) { v = m[k]; break; }
    abilities[key] = Number(v) || 10;
  });
  const cr = normCR(m.cr ?? m.challenge ?? m.challenge_rating ?? '') || '';
  const legendary = entries(m.legendary || m.legendaryActions || m.legendary_actions);
  const paint = (Array.isArray(m.paint) ? m.paint : []).filter((p) => p && /^#[0-9a-f]{3,8}$/i.test(String(p.hex || '')));
  return {
    name: String(m.name || 'Unbenannt'),
    size: String(m.size || ''),
    type: String(m.type || ''),
    alignment: String(m.alignment || ''),
    ac: m.ac ?? m.armor_class ?? m.armorClass ?? '',
    acNote: String(m.acNote || m.ac_note || m.armor_desc || ''),
    hp: m.hp ?? m.hit_points ?? m.hitPoints ?? '',
    hpDice: String(m.hpDice || m.hit_dice || m.hitDice || m.hp_dice || ''),
    speed: typeof m.speed === 'object' && m.speed ? Object.entries(m.speed).map(([k, v]) => (k === 'walk' ? v : `${k} ${v}`)).join(', ') : String(m.speed || ''),
    abilities,
    saves: String(m.saves || m.saving_throws || ''),
    skills: typeof m.skills === 'object' && m.skills && !Array.isArray(m.skills) ? Object.entries(m.skills).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ') : String(m.skills || ''),
    vulnerabilities: String(m.vulnerabilities || m.damage_vulnerabilities || ''),
    resistances: String(m.resistances || m.damage_resistances || ''),
    immunities: String(m.immunities || m.damage_immunities || ''),
    conditionImmunities: String(m.conditionImmunities || m.condition_immunities || ''),
    senses: String(m.senses || ''),
    languages: String(m.languages || ''),
    cr,
    xp: Number(m.xp) || crXp(cr),
    pb: Number(m.pb) || pbForCR(cr),
    traits: entries(m.traits || m.special_abilities),
    actions: entries(m.actions),
    bonusActions: entries(m.bonusActions || m.bonus_actions),
    reactions: entries(m.reactions),
    legendary,
    legendaryCount: Number(m.legendaryCount) || (legendary.length ? 3 : 0),
    lair: entries(m.lair || m.lairActions || m.lair_actions),
    description: String(m.description || m.lore || ''),
    tactics: String(m.tactics || ''),
    paint,
    source: String(m.source || ''),
    qty: Math.max(1, Number(m.qty) || 1),
  };
}

export function parseStatblock(code) {
  const t = String(code || '').trim();
  try {
    return normalizeMonster(JSON.parse(t));
  } catch {
    return normalizeMonster(parseYaml(t));
  }
}

export function monsterToMarkdown(raw) {
  const m = normalizeMonster(raw);
  const { qty, ...rest } = m;
  let md = '';
  if (m.description) md += `${m.description}\n\n`;
  md += '```statblock\n' + JSON.stringify(rest, null, 2) + '\n```\n';
  if (m.tactics) md += `\n## Taktik\n${m.tactics}\n`;
  return md;
}

export function statblockHTML(raw, { twoCol = false } = {}) {
  const m = normalizeMonster(raw);
  const md = (t) => renderInline(String(t ?? ''), {});
  const line = (label, val) => (val && String(val).trim() ? `<div class="sb-line"><b>${label}</b> <span class="v">${md(val)}</span></div>` : '');
  const ab = ABILITIES.map(({ key, short }) => {
    const sc = m.abilities[key];
    const mod = modifier(sc);
    return `<div data-roll="1d20${mod >= 0 ? '+' : ''}${mod}" data-label="${esc(m.name)} · ${short}" title="Attributswurf ${short}"><b>${short}</b><span>${sc} (${fmtMod(mod)})</span></div>`;
  }).join('');
  const list = (arr) => arr.map((e) => `<div class="sb-entry">${e.name ? `<b><i>${esc(e.name)}.</i></b> ` : ''}${md(e.desc)}</div>`).join('');
  const sec = (title, arr, intro = '') => (arr.length ? `<div class="sb-sec">${title}</div>${intro ? `<div class="sb-entry">${esc(intro)}</div>` : ''}${list(arr)}` : '');
  const hp = `${esc(m.hp)}${m.hpDice ? ` (${md(m.hpDice)})` : ''}`;
  const legIntro = m.legendary.length ? `${m.name} kann ${m.legendaryCount} legendäre Aktionen ausführen – jeweils eine am Ende des Zuges einer anderen Kreatur. Verbrauchte Aktionen erneuern sich zu Beginn des eigenen Zuges.` : '';
  return `<div class="statblock${twoCol ? ' two-col' : ''}">
<h3 class="sb-name">${esc(m.name)}</h3>
<div class="sb-meta">${esc([m.size, m.type].filter(Boolean).join(' '))}${m.alignment ? `, ${esc(m.alignment)}` : ''}</div>
<div class="sb-rule"></div>
<div class="sb-line"><b>Rüstungsklasse</b> <span class="v">${esc(m.ac)}${m.acNote ? ` (${esc(m.acNote)})` : ''}</span></div>
<div class="sb-line"><b>Trefferpunkte</b> <span class="v">${hp}</span></div>
${line('Bewegungsrate', m.speed)}
<div class="sb-rule"></div>
<div class="sb-abil">${ab}</div>
<div class="sb-rule"></div>
${line('Rettungswürfe', m.saves)}${line('Fertigkeiten', m.skills)}${line('Schadensanfälligkeiten', m.vulnerabilities)}${line('Schadensresistenzen', m.resistances)}${line('Schadensimmunitäten', m.immunities)}${line('Zustandsimmunitäten', m.conditionImmunities)}${line('Sinne', m.senses)}${line('Sprachen', m.languages || '–')}
${m.cr ? `<div class="sb-line"><b>Herausforderungsgrad</b> <span class="v">${esc(m.cr)} (${(m.xp || 0).toLocaleString('de-DE')} EP)</span> &nbsp;·&nbsp; <b>Übungsbonus</b> <span class="v">+${m.pb}</span></div>` : ''}
<div class="sb-rule"></div>
<div class="sb-body">${list(m.traits)}${sec('Aktionen', m.actions)}${sec('Bonusaktionen', m.bonusActions)}${sec('Reaktionen', m.reactions)}${sec('Legendäre Aktionen', m.legendary, legIntro)}${sec('Hortaktionen', m.lair)}</div>
${m.description ? `<div class="sb-lore">${md(m.description)}</div>` : ''}
${m.paint.length ? `<div class="sb-sec">Bemal-Guide</div><div class="sb-paint">${m.paint.map((p) => `<span class="pc"><i style="background:${esc(p.hex)}"></i>${esc(p.part || '')}${p.name ? ` · ${esc(p.name)}` : ''} <code>${esc(p.hex)}</code></span>`).join('')}</div>` : ''}
</div>`;
}

export function initiativeBonus(raw) {
  return modifier(normalizeMonster(raw).abilities.dex);
}
