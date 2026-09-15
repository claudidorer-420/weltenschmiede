// Erzeugt js/data/monsters-srd.js und js/data/magicitems-srd.js aus dem deutschen SRD 5.1
// (Wizards of the Coast, CC-BY-4.0; maschinenlesbar von openrpg.de, https://openrpg.de/srd/5e/de/api/).
// Eingaben (ein Ordner): de51-monster.json, de51-magicitem.json (Detail-JSON der API, als Liste).
// Aufruf: node tools/build-srd.mjs <ordner>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const src = process.argv[2];
if (!src) { console.error('Aufruf: node tools/build-srd.mjs <ordner>'); process.exit(1); }
const load = (f) => JSON.parse(readFileSync(join(src, f), 'utf8'));
const slug = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dice = (s) => String(s || '').replace(/(\d)W(\d)/g, '$1d$2');
const list = (v) => (Array.isArray(v) ? v.join(', ') : String(v || ''));
const HEAD = (what) => `// ${what} aus dem System Reference Document 5.1 (deutsche Fassung) von Wizards of the Coast LLC,
// lizenziert unter Creative Commons Namensnennung 4.0 (https://creativecommons.org/licenses/by/4.0/legalcode.de).
// Maschinenlesbare Aufbereitung: openrpg.de. Generiert von tools/build-srd.mjs – nicht von Hand bearbeiten.
`;

const SIZE = { winzig: 'tiny', klein: 'small', 'mittelgroß': 'medium', 'groß': 'large', riesig: 'huge', gigantisch: 'gargantuan' };
const SPEED_DE = { walk: '', burrow: 'Graben', climb: 'Klettern', fly: 'Fliegen', swim: 'Schwimmen', hover: 'Schweben' };
function entries(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((e) => (typeof e === 'string' ? { name: '', desc: e } : { name: String(e.name || e.title || ''), desc: String(e.value ?? e.text ?? e.desc ?? '') })).filter((e) => e.name || e.desc);
}
function spellEntries(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((e) => {
    if (typeof e === 'string') return { name: 'Zauberwirken', desc: e };
    const parts = [e.value || e.text || e.intro || ''];
    for (const [k, x] of Object.entries(e)) if (!['name', 'value', 'text', 'intro'].includes(k)) parts.push(typeof x === 'string' ? x : Array.isArray(x) ? x.map((y) => (typeof y === 'string' ? y : Object.values(y).join(': '))).join(' · ') : '');
    return { name: String(e.name || 'Zauberwirken'), desc: parts.filter(Boolean).join(' ') };
  });
}

let sample = null;
const monsters = load('de51-monster.json').filter((m) => m && m.name).map((m) => {
  const ab = {};
  for (const a of m.attributes || []) ab[a.class] = Number(a.value) || 10;
  const speeds = {};
  for (const [k, v] of Object.entries(m.speeds || {})) { const n = parseFloat(String(v).replace(',', '.')); if (!Number.isNaN(n)) speeds[k] = n; }
  const speed = Object.entries(m.speeds || {}).map(([k, v]) => (SPEED_DE[k] ? `${SPEED_DE[k]} ${v}` : v)).join(', ');
  if (!sample && (m['spellcasting-trait'] || m['spellcasting-innate-trait'])) sample = m['spellcasting-trait'] || m['spellcasting-innate-trait'];
  const legendary = entries(m['legendary-actions']);
  const out = {
    id: slug(m.name), name: m.name, size: m.size, sizeKey: SIZE[String(m.size).toLowerCase()] || 'medium', type: m.type, alignment: m.alignment,
    ac: Number(m['armor-class']?.value) || 10, acNote: String(m['armor-class']?.info || '').replace(/^\(|\)$/g, ''),
    hp: Number(m['hit-points']?.value) || 1, hpDice: dice(m['hit-points']?.formula), speed, speeds, abilities: ab,
    saves: list(m['saving-throws']), skills: list(m.skills), vulnerabilities: list(m['damage-vulnerabilitys']), resistances: list(m['damage-resistances']),
    immunities: list(m['damage-immunitys']), conditionImmunities: list(m['condition-immunitys']), senses: list(m.senses), languages: list(m.languages).replace(/^-$/, '–'),
    cr: String(m.challenge || ''), xp: Number(String(m.xp || '0').replace(/\./g, '')) || 0,
    traits: [...entries(m.traits), ...spellEntries(m['spellcasting-trait']), ...spellEntries(m['spellcasting-innate-trait'])],
    actions: entries(m.actions), reactions: entries(m.reactions), legendary, legendaryCount: legendary.length ? 3 : 0, source: 'SRD 5.1',
  };
  for (const k of ['saves', 'skills', 'vulnerabilities', 'resistances', 'immunities', 'conditionImmunities', 'acNote']) if (!out[k]) delete out[k];
  for (const k of ['reactions', 'legendary']) if (!out[k].length) delete out[k];
  if (!out.legendaryCount) delete out.legendaryCount;
  return out;
}).sort((a, b) => a.name.localeCompare(b.name, 'de'));
if (sample) console.log('Zauberwirken-Beispiel:', JSON.stringify(sample).slice(0, 400));

const paras = (html) => [...String(html || '').matchAll(/<p>([\s\S]*?)<\/p>/g)]
  .map((m) => m[1].replace(/<span class='trait-name'>(.*?)<\/span>/g, '$1').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
const items = load('de51-magicitem.json').filter((x) => x && x.name).map((x) => {
  const desc = paras(x.description?.html);
  const at = String(x.attunement || '').trim();
  const out = { id: slug(x.name), name: x.name, type: x.type, rarity: String(x.rarity || '').replace(/^[a-z ]+\),\s*/i, ''), desc: desc.length ? desc : [String(x.description?.text || '').trim()] };
  if (at && !/^nein|^-/.test(at)) out.attune = at.replace(/^\(|\)$/g, '');
  return out;
}).sort((a, b) => a.name.localeCompare(b.name, 'de'));

const write = (file, name, arr, what) => {
  const js = `${HEAD(what)}export const ${name} = [\n${arr.map((x) => `  ${JSON.stringify(x)},`).join('\n')}\n];\n`;
  writeFileSync(join(root, 'js', 'data', file), js);
  console.log(`${file}: ${arr.length} Einträge, ${(js.length / 1024).toFixed(0)} KB`);
};
write('monsters-srd.js', 'MONSTERS', monsters, 'Monster');
write('magicitems-srd.js', 'MAGIC_ITEMS', items, 'Magische Gegenstände');
