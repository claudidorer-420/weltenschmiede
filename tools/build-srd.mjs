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
// Zauberwirken: lesbarer Text für den Statblock + strukturierte Liste für den Kampf (SG, Angriff, Plätze, Zaubernamen)
const groupLevel = (l) => (/zaubertrick/i.test(String(l)) ? 0 : /^\d+$/.test(String(l).trim()) ? Number(l) : null);
function spellText(e, innate) {
  const text = String(e['spellcasting-text'] || e.value || e.text || e.intro || '');
  const groups = (e.spells || []).map((g) => {
    const lvl = groupLevel(g.level);
    const head = lvl === 0 ? 'Zaubertricks' : lvl ? `${lvl}. Grad` : String(g.level || '');
    const slots = g.slots ? ` (${/^\d+$/.test(String(g.slots)) ? `${g.slots} Plätze` : g.slots})` : '';
    return `${head}${slots}: ${(g.list || []).map((s) => (typeof s === 'string' ? s : s.name)).join(', ')}`;
  });
  return { name: innate ? 'Angeborenes Zauberwirken' : 'Zauberwirken', desc: [text, ...groups].filter(Boolean).join(' · ') };
}
function spellEntries(v, innate = false) {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).map((e) => (typeof e === 'string' ? { name: 'Zauberwirken', desc: e } : spellText(e, innate)));
}
function castingOf(v, innate = false) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const text = String(v['spellcasting-text'] || v.value || v.text || '');
  const dc = Number((/SG\s*(\d+)/.exec(text) || [])[1]) || null;
  const attack = Number((/([+-]\d+)\s*auf Treffer mit Zauberangriffen/.exec(text) || [])[1]) || null;
  const ability = /Intelligenz/.test(text) ? 'int' : /Weisheit/.test(text) ? 'wis' : /Charisma/.test(text) ? 'cha' : null;
  const groups = (v.spells || []).map((g) => ({
    level: groupLevel(g.level), per: groupLevel(g.level) == null ? String(g.level || '') : null,
    slots: /^\d+$/.test(String(g.slots || '')) ? Number(g.slots) : null, names: (g.list || []).map((s) => (typeof s === 'string' ? s : s.name)),
  }));
  return groups.length ? { innate, dc, attack, ability, groups } : null;
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
    traits: [...entries(m.traits), ...spellEntries(m['spellcasting-trait']), ...spellEntries(m['spellcasting-innate-trait'], true)],
    actions: entries(m.actions), reactions: entries(m.reactions), legendary, legendaryCount: legendary.length ? 3 : 0, source: 'SRD 5.1',
    casting: [castingOf(m['spellcasting-trait']), castingOf(m['spellcasting-innate-trait'], true)].filter(Boolean),
  };
  if (!out.casting.length) delete out.casting;
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
