// Erzeugt js/data/spells-2014.js und js/data/spells-2024.js aus aufbereiteten SRD-Daten.
// Quellen: SRD 5.2.1 DE (Wizards of the Coast, CC-BY-4.0; Text per `pdftotext -raw`), SRD 5.1 DE (Wizards of the Coast,
// CC-BY-4.0; maschinenlesbar von openrpg.de), Metadaten wie Klassen, Schaden und Flächen von dnd5eapi.co.
// Eingaben (ein Ordner): de52-spells.json, de51-spells.json, optional extras52.json / extras51.json (fehlende Zauber, gleiche Form).
// Aufruf: node tools/build-spells.mjs <ordner>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const src = process.argv[2];
if (!src) { console.error('Aufruf: node tools/build-spells.mjs <ordner>'); process.exit(1); }
const load = (f) => (existsSync(join(src, f)) ? JSON.parse(readFileSync(join(src, f), 'utf8')) : []);

const CLS = { bard: 'barde', cleric: 'kleriker', druid: 'druide', paladin: 'paladin', ranger: 'waldlaeufer', sorcerer: 'zauberer', warlock: 'hexenmeister', wizard: 'magier' };
// Magieschmied (2014, Tashas Kessel) – nur Zauber, die im SRD vorkommen
const ARTIFICER = ['acid-splash', 'dancing-lights', 'fire-bolt', 'guidance', 'light', 'mage-hand', 'mending', 'message', 'poison-spray', 'prestidigitation', 'ray-of-frost', 'resistance', 'shocking-grasp', 'spare-the-dying', 'thorn-whip',
  'alarm', 'cure-wounds', 'detect-magic', 'disguise-self', 'expeditious-retreat', 'faerie-fire', 'false-life', 'feather-fall', 'grease', 'identify', 'jump', 'longstrider', 'purify-food-and-drink', 'sanctuary',
  'aid', 'alter-self', 'arcane-lock', 'blur', 'continual-flame', 'darkvision', 'enhance-ability', 'enlarge-reduce', 'heat-metal', 'invisibility', 'lesser-restoration', 'levitate', 'magic-mouth', 'magic-weapon', 'protection-from-poison', 'rope-trick', 'see-invisibility', 'spider-climb', 'web',
  'blink', 'create-food-and-water', 'dispel-magic', 'fly', 'glyph-of-warding', 'haste', 'protection-from-energy', 'revivify', 'water-breathing', 'water-walk',
  'arcane-eye', 'fabricate', 'freedom-of-movement', 'secret-chest', 'faithful-hound', 'private-sanctum', 'resilient-sphere', 'stone-shape', 'stoneskin',
  'animate-objects', 'arcane-hand', 'creation', 'greater-restoration', 'wall-of-stone'];
const SAVE = { 'Stärke': 'str', Geschicklichkeit: 'dex', Konstitution: 'con', Intelligenz: 'int', Weisheit: 'wis', Charisma: 'cha' };
const NUM = { eineinhalb: 1.5, drei: 3, viereinhalb: 4.5, sechs: 6, siebeneinhalb: 7.5, neun: 9, zwölf: 12, fünfzehn: 15, achtzehn: 18, einundzwanzig: 21, vierundzwanzig: 24, dreißig: 30, sechsunddreißig: 36, sechzig: 60 };
const num = (t) => (t in NUM ? NUM[t] : parseFloat(String(t).replace(',', '.')));
const N = '(\\d+(?:,\\d+)?|eineinhalb|drei|viereinhalb|sechs|siebeneinhalb|neun|zwölf|fünfzehn|achtzehn|einundzwanzig|vierundzwanzig|dreißig|sechsunddreißig|sechzig)';
const AREA_RE = [
  ['line', new RegExp(`${N} Meter lange[n]? und ${N} Meter breite[n]? Linie`)],
  ['cylinder', new RegExp(`${N} Meter hohe[n]? Zylinders? mit einem Radius von ${N} Metern`), 2],
  ['cone', new RegExp(`Kegel von ${N} Metern`)],
  ['cone', new RegExp(`${N}-Meter-Kegel`)],
  ['cube', new RegExp(`Würfel mit ${N} Metern Kantenlänge`)],
  ['sphere', new RegExp(`Kugel mit einem Radius von ${N} Metern`)],
  ['sphere', new RegExp(`Kugel mit ${N} Metern Radius`)],
  ['emanation', new RegExp(`Ausströmung von ${N} Metern`)],
  ['sphere', new RegExp(`${N}-Meter-Radius`)],
  ['sphere', new RegExp(`(?<!Licht[^.]{0,60})in einem Radius von ${N} Metern um`)],
];

function areaFromText(txt) {
  for (const sentence of txt.split(/(?<=\.)\s/)) {
    if (/Licht|Sensor|faustgroß|Radius von 15 Zentimetern/.test(sentence) && !/Kegel|Linie|Würfel/.test(sentence)) continue;
    for (const [shape, re, grp = 1] of AREA_RE) {
      const m = re.exec(sentence);
      if (m) return { shape, size: num(m[grp]), ...(shape === 'line' ? { width: num(m[2]) } : {}) };
    }
  }
  return null;
}
const ft = (v) => Math.round(v * 0.3 * 10) / 10;
function areaFrom(s) {
  if (s.aoe?.type && s.aoe.size) return { shape: s.aoe.type, size: ft(s.aoe.size), ...(s.aoe.type === 'line' ? { width: 1.5 } : {}) };
  return areaFromText([s.range, ...(s.desc || [])].join(' '));
}
function rangeOf(r) {
  const t = String(r || '').toLowerCase();
  if (/^selbst/.test(t)) return { kind: 'self', m: 0 };
  if (/berührung/.test(t)) return { kind: 'touch', m: 1.5 };
  if (/sicht/.test(t)) return { kind: 'sight', m: null };
  if (/unbegrenzt/.test(t)) return { kind: 'unl', m: null };
  let m = /([\d.,]+)\s*(kilometer|km)\b/.exec(t);
  if (m) return { kind: 'dist', m: Math.round(parseFloat(m[1].replace(',', '.')) * 1000) };
  m = /([\d.,]+)\s*(meter|m)\b/.exec(t);
  if (m) return { kind: 'dist', m: parseFloat(m[1].replace(/\.(?=\d{3})/, '').replace(',', '.')) };
  return { kind: 'spec', m: null };
}
function actionOf(t) {
  t = String(t || '').toLowerCase();
  if (/bonusaktion/.test(t)) return 'bonus';
  if (/reaktion/.test(t)) return 'reaction';
  if (/^(1 )?aktion/.test(t)) return 'action';
  return 'long';
}
function saveOf(s) {
  const m = /(Stärke|Geschicklichkeit|Konstitution|Intelligenz|Weisheit|Charisma)rettungswurf/.exec((s.desc || []).join(' '));
  return m ? SAVE[m[1]] : s.dc || s.dc14 || null;
}
function damageOf(s) {
  const d = s.dmg;
  if (!d) return null;
  const type = d.damage_type?.index || null;
  const out = { type };
  if (d.damage_at_slot_level) out.slots = d.damage_at_slot_level;
  if (d.damage_at_character_level) out.char = d.damage_at_character_level;
  return out.slots || out.char ? out : null;
}
// Schaden aus dem deutschen Text (2014-Daten von dnd5eapi enthalten keinen Schaden)
const DMG_DE = { 'Säure': 'acid', Wucht: 'bludgeoning', 'Kälte': 'cold', Feuer: 'fire', Energie: 'force', Kraft: 'force', Blitz: 'lightning', Stich: 'piercing', Gift: 'poison', Hieb: 'slashing', Schall: 'thunder', Donner: 'thunder', Strahlungs: 'radiant', nekrotisch: 'necrotic', psychisch: 'psychic', 'gleißend': 'radiant' };
const DMG_RE = /(\d+)W(\d+)\s+(?:(Säure|Wucht|Kälte|Feuer|Energie|Kraft|Blitz|Stich|Gift|Hieb|Schall|Donner|Strahlungs)schaden|(nekrotisch|psychisch|gleißend)(?:e[nrs]?)?\s+Schaden)/;
function damageFromText(s) {
  const m = DMG_RE.exec((s.desc || []).join(' '));
  if (!m) return null;
  const n = Number(m[1]);
  const die = m[2];
  const type = DMG_DE[m[3] || m[4]];
  if (!s.level) return { type, char: { 1: `${n}d${die}`, 5: `${2 * n}d${die}`, 11: `${3 * n}d${die}`, 17: `${4 * n}d${die}` } };
  const slots = { [s.level]: `${n}d${die}` };
  const up = /für jeden (?:Zauberplatz)?[Gg]rad über dem (\d)\.[^.]*?um (\d+)W(\d+)/.exec((s.hl || []).join(' '));
  if (up && up[3] === die) for (let l = s.level + 1; l <= 9; l++) slots[l] = `${n + (l - s.level) * Number(up[2])}d${die}`;
  return { type, slots };
}
const baseDice = (d) => (d ? (d.slots ? Object.values(d.slots)[0] : d.char?.['1'] || Object.values(d.char || {})[0]) : null);
function healOf(s, ed) {
  if (ed === '2014' && s.heal) return { slots: s.heal };
  const txt = (s.desc || []).join(' ');
  const m = /(\d+)W(\d+)(\s*(?:\+|plus)\s*(?:deinem|dein) Zauberwirken-?Attributsmodifikator)?[^.]{0,70}Trefferpunkte/.exec(txt);
  if (m && /zurück|erhält|erhalten|heil/.test(txt)) return { dice: `${m[1]}d${m[2]}`, mod: !!m[3] };
  return null;
}
const tidy = (p) => String(p).replace(/\s+/g, ' ').replace(/ ([,.;:])/g, '$1').trim();

function build(list, ed, other = new Map()) {
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (!s.dmg && s.id) {
      const t = damageFromText(s);
      const o = other.get(s.id);
      s.dmgResolved = o?.dmg && t && baseDice(damageOf(o)) === baseDice(t) ? damageOf(o) : t;
    }
    if (!s.id || seen.has(s.id)) { console.log(`  ! übersprungen (${ed}):`, s.de, s.id || '(ohne Zuordnung)'); continue; }
    seen.add(s.id);
    const r = rangeOf(s.range);
    const classes = [...new Set((s.classes || []).map((c) => CLS[c]).filter(Boolean))];
    if (ed === '2014' && ARTIFICER.includes(s.id)) classes.push('magieschmied');
    const sp = {
      id: s.id, name: s.de, en: s.en, level: s.level, school: s.school, classes,
      time: s.time, action: actionOf(s.time), range: s.range, rangeKind: r.kind, rangeM: r.m,
      comps: (s.comps || []).join(', '), material: s.material || '', duration: s.duration, conc: !!s.conc, ritual: !!s.ritual,
      attack: s.atk || null, save: saveOf(s), damage: damageOf(s) || s.dmgResolved || null, heal: healOf(s, ed), area: areaFrom(s),
      desc: (s.desc || []).map(tidy).filter(Boolean), higher: (s.hl || []).map(tidy).filter(Boolean),
    };
    for (const k of ['material', 'attack', 'save', 'damage', 'heal', 'area']) if (!sp[k]) delete sp[k];
    if (!sp.higher.length) delete sp.higher;
    out.push(sp);
  }
  out.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'de'));
  return out;
}

const HEAD = (ed, doc) => `// Zauber nach den Regeln ${ed} – generiert von tools/build-spells.mjs, nicht von Hand bearbeiten.
// Enthält Material aus dem ${doc} von Wizards of the Coast LLC (deutsche Fassung), lizenziert unter
// Creative Commons Namensnennung 4.0 (https://creativecommons.org/licenses/by/4.0/legalcode.de).
// Metadaten (Klassen, Schaden, Flächen) ergänzt mit Hilfe von dnd5eapi.co.
`;
const raw52 = [...load('de52-spells.json'), ...load('extras52.json')];
const by52 = new Map(raw52.filter((s) => s.id).map((s) => [s.id, s]));
for (const [ed, file, doc, extra] of [['2024', 'de52-spells.json', 'System Reference Document 5.2.1', 'extras52.json'], ['2014', 'de51-spells.json', 'System Reference Document 5.1', 'extras51.json']]) {
  const list = build([...load(file), ...load(extra)], ed, ed === '2014' ? by52 : new Map());
  const body = list.map((s) => `  ${JSON.stringify(s)},`).join('\n');
  const js = `${HEAD(ed, doc)}export const SPELLS = [\n${body}\n];\n`;
  writeFileSync(join(root, 'js', 'data', `spells-${ed}.js`), js);
  const perCls = {};
  for (const s of list) for (const c of s.classes) perCls[c] = (perCls[c] || 0) + 1;
  console.log(`${ed}: ${list.length} Zauber, ${(js.length / 1024).toFixed(0)} KB · Flächen: ${list.filter((s) => s.area).length} · Schaden: ${list.filter((s) => s.damage).length} · Heilung: ${list.filter((s) => s.heal).length} · Rettungswurf: ${list.filter((s) => s.save).length}`);
  console.log('   pro Klasse:', JSON.stringify(perCls));
}
