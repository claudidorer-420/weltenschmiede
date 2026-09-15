// Erzeugt js/data/monsternames.js: Monsternamen je Welt für die Namenssuche im Encounter-Generator
// und die Unterteilung im Bestiarium.
// Quellen: D&D über die D3-API (dnddeutsch.de), die anderen Welten über die Kategorien ihrer Fan-Wikis
// (MediaWiki-API): Hexer-Wiki, Elder Scrolls Wiki (de), Dark Souls Wiki (de), Elden Ring Wiki (en),
// Ardapedia, Game-of-Thrones-Wiki (de), Das Lied von Eis und Feuer Wiki, Final Fantasy Almanach.
// Warhammer und Diablo sind von Hand gepflegt (die Wikis sperren automatische Abrufe bzw. haben keine Liste).
// Aufruf: node tools/build-monsternames.mjs [d3-monster.json]
// (D3 antwortet auf die Gesamtliste manchmal minutenlang – dann die Antwort von
//  https://www.dnddeutsch.de/tools/json.php?apiv=0.7&o=monster&q= vorher speichern und als Datei übergeben.)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' };

async function getJson(url, { timeout = 60000, tries = 4 } = {}) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
      const t = await r.text();
      if (r.ok) return JSON.parse(t.replace(/^﻿/, ''));
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.message; }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error(`Nicht erreichbar (${last}): ${url}`);
}

// Seiten einer Wiki-Kategorie, optional mit Unterkategorien
async function category(api, cat, { depth = 0, skip = [] } = {}) {
  const out = [];
  let cont = '';
  do {
    const j = await getJson(`${api}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmlimit=500&format=json${cont ? `&cmcontinue=${encodeURIComponent(cont)}` : ''}`);
    for (const m of j.query?.categorymembers || []) {
      if (m.ns === 0) out.push(m.title);
      else if (m.ns === 14 && depth > 0 && !skip.some((re) => re.test(m.title))) out.push(...await category(api, m.title, { depth: depth - 1, skip }));
    }
    cont = j.continue?.cmcontinue || '';
  } while (cont);
  return out;
}

const stripParen = (t) => t.replace(/\s*\([^)]*\)\s*$/, '').trim();
function names(list, { drop = [], dropRe = [], rename = {} } = {}) {
  const seen = new Map();
  for (const raw of list) {
    let n = stripParen(raw);
    n = rename[n] || n;
    if (!n || drop.includes(n) || dropRe.some((re) => re.test(n))) continue;
    const k = n.toLowerCase();
    if (!seen.has(k)) seen.set(k, n);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'de'));
}

// ── D&D 5e (offizielle Bücher, ohne SRD – die SRD-Monster bringt die App mit Statblock selbst mit) ──
const OFFICIAL = new Set(['MM', 'MMM', 'VGM', 'MToF', 'FToD', 'GotG', 'BoMT', 'SAS:BAM', 'PAM:MPP', 'VRGtR', 'MOoT', 'EGtW', 'GGtR', 'EBERRON', 'SCC',
  'WbtW', 'IDRotF', 'ToA', 'BGDiA', 'CotN', 'Dl:SotDQ', 'PaBTSO', 'KftGV', 'VEoR', 'DoSI', 'GoS', 'PotA', 'OotA', 'CM', 'TYP', 'WDH', 'LMoP', 'DoIP', 'AI']);
const TYPE_DE = {
  Aberration: 'Aberration', Beast: 'Tier', Celestial: 'Himmlisches Wesen', Construct: 'Konstrukt', Dragon: 'Drache', Elemental: 'Elementar', Fey: 'Feenwesen',
  Fiend: 'Unhold', Giant: 'Riese', Humanoid: 'Humanoide', Monstrosity: 'Monstrosität', Ooze: 'Schlick', Plant: 'Pflanze', Undead: 'Untoter',
};
let DND = [];
try {
  const d3 = (process.argv[2]
    ? JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''))
    : await getJson('https://www.dnddeutsch.de/tools/json.php?apiv=0.7&o=monster&q=', { timeout: 180000, tries: 2 })).monster || [];
  const dnd = new Map();
  for (const m of d3) {
    const src = (m.src || []).filter((s) => OFFICIAL.has(s));
    if (!src.length || (m.src || []).includes('SRD') || !TYPE_DE[m.type]) continue;
    const de = (m.name_de_ulisses || m.name_de || '').trim();
    if (!de) continue;
    const k = de.toLowerCase();
    if (dnd.has(k)) continue;
    const alias = m.name_de && m.name_de_ulisses && m.name_de !== m.name_de_ulisses ? m.name_de : '';
    dnd.set(k, [de, m.name_en || '', String(m.cr_human ?? m.cr ?? ''), TYPE_DE[m.type], src[0], ...(alias ? [alias] : [])]);
  }
  DND = [...dnd.values()].sort((a, b) => a[0].localeCompare(b[0], 'de'));
} catch (e) {
  // D3 antwortet manchmal sehr langsam – dann bleibt die zuletzt erzeugte Liste erhalten
  console.warn(`D&D-Namen nicht abrufbar (${e.message}) – vorherige Liste bleibt.`);
  try { DND = (await import(pathToFileURL(join(root, 'js', 'data', 'monsternames.js')).href)).DND_NAMES || []; } catch { DND = []; }
}

// ── The Witcher ──
const HEX = 'https://hexer.fandom.com/api.php';
const witcher = names([
  ...await category(HEX, 'Kategorie:The_Witcher_Bestiarium'),
  ...await category(HEX, 'Kategorie:The_Witcher_2_Bestiarium'),
  ...await category(HEX, 'Kategorie:The_Witcher_3_Bestiarium', { depth: 2, skip: [/Bilder/] }),
], { dropRe: [/Bestiarium|^Monster in|^Bossmonster|Akt \d|Prolog|^The Witcher|^Drachen$/i] });

// ── Herr der Ringe (Ardapedia) ──
const ARDA = 'https://www.ardapedia.org/w/api.php';
const LOTR_SINGULAR = {
  Bären: 'Bär', Warge: 'Warg', Wölfe: 'Wolf', 'Weiße Wölfe': 'Weißer Wolf', Werwölfe: 'Werwolf', Riesen: 'Riese', Trolle: 'Troll', Bergtrolle: 'Bergtroll',
  Halbtrolle: 'Halbtroll', Höhlentrolle: 'Höhlentroll', Hügeltrolle: 'Hügeltroll', Schneetrolle: 'Schneetroll', Steintrolle: 'Steintroll', Drachen: 'Drache',
  Kaltdrachen: 'Kaltdrache', Balrogs: 'Balrog', Spinnen: 'Riesenspinne', Grabunholde: 'Grabunhold', Gespenster: 'Gespenst', Fledermäuse: 'Riesenfledermaus',
  'Geflügelte Wesen': 'Geflügeltes Wesen (Flugungeheuer)', Hummerhorns: 'Hummerhorn', Werwürmer: 'Werwurm', Mûmakil: 'Mûmak (Olifant)', Halborks: 'Halbork',
  Hobkobolde: 'Hobkobold', 'Namenlose Wesen': 'Namenloses Wesen', 'Große Orks': 'Großer Ork',
};
const lotr = names([
  ...await category(ARDA, 'Kategorie:Arten'),
  ...await category(ARDA, 'Kategorie:Tiere'),
  ...await category(ARDA, 'Kategorie:Drachen'),
  ...await category(ARDA, 'Kategorie:Trolle'),
  ...await category(ARDA, 'Kategorie:Balrogs'),
  ...await category(ARDA, 'Kategorie:Spinnen'),
  ...await category(ARDA, 'Kategorie:Riesen'),
  ...await category(ARDA, 'Kategorie:Orks'),
  'Ork', 'Uruk-hai', 'Schwarzer Uruk', 'Bilwiss', 'Wargreiter', 'Huorn', 'Ent', 'Hexenkönig von Angmar', 'Mund Saurons', 'Tote von Dunharg (Eidbrüchige)',
  'Korsar von Umbar', 'Haradrim-Krieger', 'Ostling-Krieger', 'Dunländer', 'Gollum', 'Barrow-Geist (Grabunhold)', 'Crebain-Schwarm',
], {
  rename: LOTR_SINGULAR,
  drop: ['Tom Bombadil', 'Goldbeere', 'Feen', 'Huan', 'Miaule', 'Muhlipps', 'Oikeroi', 'Schwäne von Gorbelgod', 'Umuiyan', 'Kelvar', 'Carc', 'Fang', 'Große Tiere',
    'Hirsche', 'Hunde', 'Katzen', 'Kirinki', 'Krähen', 'Ponys', 'Raben', 'Rinder von Araw', 'Roac', 'Robben', 'Schildkrötenwalfische', 'Schwäne', 'Uin', 'Wale', 'Wolf',
    'Würmer', 'Zirperkirper', 'Drachentöter', 'Bert', 'Bill Huggins', 'Tom', 'Eruhíni', 'Wasserfrau', 'Barrow-Geist'],
  dropRe: [/^Familie /],
});

// ── Elder Scrolls ──
const TES = 'https://elderscrolls.fandom.com/de/api.php';
// benannte Einzelwesen (Werwolf-Gefährten, Haustiere …) und harmlose Tiere bleiben draußen
const TES_SKIP = [/mit Namen/];
const tes = names([
  ...await category(TES, 'Kategorie:Skyrim:_Kreaturen', { depth: 1, skip: TES_SKIP }),
  ...await category(TES, 'Kategorie:Oblivion:_Kreaturen', { depth: 1, skip: TES_SKIP }),
  ...await category(TES, 'Kategorie:Morrowind:_Kreaturen', { depth: 1, skip: TES_SKIP }),
], { dropRe: [/^Kreaturen|Pferd$|^Pferde|^Hund$|^Huhn|^Kuh$|^Ziege$|^Fuchs$|^Hase$|^Reh$|^Hirsch|^Elch$|fisch|barsch|Spatenschwanz|Pfeilfeder|Biene|Schmetterling|Motte|Libelle|Glühwürmchen|^Blüte$/i] });

// ── Dark Souls / Elden Ring ──
const DS = 'https://darksouls.fandom.com/de/api.php';
const ER = 'https://eldenring.fandom.com/api.php';
const souls = names([
  ...await category(DS, 'Kategorie:Gegner', { depth: 1 }),
  ...await category(DS, 'Kategorie:Boss (Dark Souls)'),
  ...await category(DS, 'Kategorie:Boss (Dark Souls II)'),
  ...await category(DS, 'Kategorie:Bosse (Dark Souls III)'),
], { drop: ['Gegner', 'Boss'], dropRe: [/^Bosse?:/, /Rüstung$/] });
const elden = names([
  ...await category(ER, 'Category:Enemies'),
  ...await category(ER, 'Category:Bosses'),
], { dropRe: [/^Bestiary|^Enemies|^Bosses|^Commoner$|^Nomadic Merchants|^Mule$|^Steed$|^Catapult$|^Ballista$|^Heavy Ballista$/] });

// ── Game of Thrones ──
const GOT = 'https://gameofthrones.fandom.com/de/api.php';
const LEF = 'https://eisundfeuer.fandom.com/de/api.php';
const got = names([
  ...await category(GOT, 'Kategorie:Kreaturen'),
  ...await category(GOT, 'Kategorie:Tiere'),
  ...await category(LEF, 'Kategorie:Tiere'),
  'Drache', 'Schattenwolf', 'Weißer Wanderer', 'Wiedergänger', 'Nachtkönig', 'Riese', 'Wiedergänger-Riese', 'Eisspinne', 'Wildling-Krieger', 'Lindwurm', 'Wolf',
], {
  drop: ['Tiere', 'Tiere und Pflanzen', 'Ser Pfote', 'Casso', 'Raben', 'Drachenei', 'Schatten', 'Lindwürme', 'Löwenechsen', 'Hübsche', 'Kleiner Valyrer', 'Rotohren',
    'Plusterfisch', 'Flachrücken', 'Weißer Hirsch', 'Affen', 'Blutfliege'],
  dropRe: [/Pferd|Hund|Katze|Seehund/],
});

// ── Final Fantasy ──
const FF = 'https://finalfantasy.fandom.com/de/api.php';
const ff = names([
  ...await category(FF, 'Kategorie:Wiederkehrender Gegner'),
  ...await category(FF, 'Kategorie:Wiederkehrende Kreatur'),
]);

// ── Warhammer Fantasy (von Hand, deutsche Bezeichnungen) ──
const warhammer = names([
  'Ork', 'Schwarzork', 'Wildork', 'Goblin', 'Nachtgoblin', 'Waldgoblin', 'Goblin-Wolfsreiter', 'Squig', 'Höhlensquig', 'Riesensquig', 'Troll', 'Steintroll',
  'Flusstroll', 'Chaostroll', 'Gallentroll', 'Riese', 'Riesenspinne', 'Arachnarok', 'Oger', 'Ogerbulle', 'Ogerfresser', 'Gnoblar', 'Säbelzahn', 'Donnerhorn',
  'Steinhorn', 'Yhetee', 'Frostgeist', 'Tiermensch', 'Gor', 'Ungor', 'Bestigor', 'Zentigor', 'Minotaurus', 'Razorgor', 'Chaoshund', 'Chaosbrut', 'Drachenoger',
  'Shaggoth', 'Jabberslythe', 'Cygor', 'Ghorgon', 'Chaoskrieger', 'Chaosritter', 'Chaosbarbar', 'Mutant', 'Blutdämon', 'Zerfleischer des Khorne',
  'Fleischhund des Khorne', 'Großer Verpester', 'Seuchenhüter', 'Nurgling', 'Seuchendrohne', 'Herrscher des Wandels', 'Horror des Tzeentch', 'Kreischer des Tzeentch',
  'Feuerdämon des Tzeentch', 'Hüter der Geheimnisse', 'Dämonette', 'Bestie des Slaanesh', 'Klanratte', 'Sturmratte', 'Skaven-Assassine', 'Rattenschwarm',
  'Rattenoger', 'Höllengrubenbrut', 'Seuchenmönch', 'Warlocktechniker', 'Skelettkrieger', 'Zombie', 'Ghul', 'Kryptghul', 'Vargheist', 'Varghulf', 'Fluchgeist',
  'Todesfee', 'Grabwächter', 'Verfluchte Seele', 'Vampir', 'Fledermausschwarm', 'Riesenfledermaus', 'Terrorgheist', 'Zombiedrache', 'Grabskorpion', 'Uschabti',
  'Nekrosphinx', 'Kriegssphinx', 'Knochenriese', 'Grabschwarm', 'Mumie', 'Liche', 'Echsenmensch', 'Saurus', 'Skink', 'Kroxigor', 'Stegadon', 'Carnosaurus',
  'Kaltblüter', 'Terradon', 'Salamander', 'Drache', 'Sonnendrache', 'Mondddrache', 'Sterndrache', 'Chaosdrache', 'Wyvern', 'Mantikor', 'Hydra', 'Kriegshydra',
  'Chimäre', 'Greif', 'Halbgreif', 'Hippogreif', 'Pegasus', 'Basilisk', 'Kokatrix', 'Gorgone', 'Harpyie', 'Kharibdyss', 'Baummensch', 'Dryade', 'Waldgeist',
  'Werwolf', 'Riesenwolf', 'Fenbestie', 'Riesenratte', 'Riesenskorpion', 'Riesenegel', 'Sumpfkrake', 'Kraken', 'Seeschlange', 'Fimir', 'Zwergenslayer',
  'Dunkelelf-Hexenkriegerin', 'Kalte Echse',
], { drop: ['Kalte Echse', 'Mondddrache', 'Zwergenslayer'] }).concat(['Monddrache']).sort((a, b) => a.localeCompare(b, 'de'));

// ── Diablo (von Hand, deutsche Bezeichnungen; Übel aus dem Diablo-Wiki) ──
const diablo = names([
  ...await category('https://diablo.fandom.com/de/api.php', 'Kategorie:Dämon'),
  'Gefallener', 'Gefallener Schamane', 'Khazra (Ziegenmensch)', 'Sukkubus', 'Skelett', 'Skelettbogenschütze', 'Skelettmagier', 'Skelettkönig Leoric',
  'Der Schlächter', 'Zombie', 'Ghul', 'Wiedergänger', 'Knochengolem', 'Blutgolem', 'Vampir', 'Werwolf', 'Ertrunkener', 'Kannibale', 'Kultist',
  'Blutmagierin', 'Schattendämon', 'Höllenhund', 'Unhold', 'Morlu', 'Schatzgoblin', 'Sandmade', 'Riesenspinne', 'Spinnenkönigin', 'Schlangenmensch',
  'Wüstenkrieger', 'Grabräuber', 'Knochenbrecher', 'Seelenfresser', 'Gargantua', 'Dunkler Wanderer', 'Mutter der Maden', 'Engel', 'Todeswächter',
  'Pestbringer', 'Aasfresser',
], { drop: ['Dämon', 'Brennende Höllen', 'Niedere Übel'] });

const NAMES = {
  'The Witcher': [['Hexer-Wiki', witcher]],
  'Herr der Ringe': [['Ardapedia', lotr]],
  'Elder Scrolls': [['Elder Scrolls Wiki', tes]],
  'Dark Souls / Elden Ring': [['Dark Souls', souls], ['Elden Ring · engl. Namen', elden]],
  Warhammer: [['Warhammer Fantasy', warhammer]],
  'Game of Thrones': [['Eis und Feuer / GoT-Wiki', got]],
  Diablo: [['Diablo', diablo]],
  'Final Fantasy': [['Final Fantasy Almanach', ff]],
};

const js = `// Monsternamen je Welt für die Namenssuche im Encounter-Generator und die Unterteilung im Bestiarium.
// Generiert von tools/build-monsternames.mjs – nicht von Hand bearbeiten.
// Quellen: D3 (dnddeutsch.de), Hexer-Wiki, Ardapedia, Elder Scrolls Wiki, Dark Souls Wiki, Elden Ring Wiki, Game-of-Thrones-Wiki,
// Das Lied von Eis und Feuer Wiki, Diablo-Wiki, Final Fantasy Almanach (jeweils Fandom/MediaWiki). Nur Namen, keine Texte.
// D&D-Einträge: [Name, englischer Name, HG, Typ, Quelle, Alternativname?] – Bücher außerhalb des SRD.
export const DND_NAMES = ${JSON.stringify(DND)};
export const WORLD_NAMES = ${JSON.stringify(NAMES)};
`;
writeFileSync(join(root, 'js', 'data', 'monsternames.js'), js);
console.log(`D&D ${DND.length} · Witcher ${witcher.length} · HdR ${lotr.length} · TES ${tes.length} · Souls ${souls.length}+${elden.length} · Warhammer ${warhammer.length} · GoT ${got.length} · Diablo ${diablo.length} · FF ${ff.length} · ${(js.length / 1024).toFixed(0)} KB`);
