// Gegenstandskatalog (Ausrüstung nach PHB, Preise in GM, Gewichte in kg) + Symbole und Nachschlagen für das Inventar.
import { WEAPONS, ARMOR } from './chargen.js';
import { WEAPON_ART, ARMOR_ART, ITEM_RULES, MAGIC_RULES, MAGIC_DEFAULT, rarityColor } from './artmap.js';

const W = {
  knueppel: [0.1, 1], dolch: [2, 0.5], zweihandknueppel: [0.2, 5], handbeil: [5, 1], wurfspeer: [0.5, 1], leichterhammer: [2, 1], streitkolben: [5, 2], kampfstab: [0.2, 2],
  sichel: [1, 1], speer: [1, 1.5], leichtearmbrust: [25, 2.5], wurfpfeil: [0.05, 0.125], kurzbogen: [25, 1], schleuder: [0.1, 0], streitaxt: [10, 2], flegel: [10, 1],
  glefe: [20, 3], zweihandaxt: [30, 3.5], zweihandschwert: [50, 3], hellebarde: [20, 3], lanze: [10, 3], langschwert: [15, 1.5], zweihandhammer: [10, 5], morgenstern: [15, 2],
  pike: [5, 9], rapier: [25, 1], krummsaebel: [25, 1.5], kurzschwert: [10, 1], dreizack: [5, 2], kriegshammer: [15, 1], kriegspicke: [5, 1], peitsche: [2, 1.5],
  blasrohr: [10, 0.5], handarmbrust: [75, 1.5], schwerearmbrust: [50, 9], langbogen: [50, 1],
};
// Reichweiten in Metern: [normal, lang]; Nahkampfwaffen mit „Reichweite“ haben 3 m
export const WEAPON_RANGE = {
  dolch: [6, 18], handbeil: [6, 18], wurfspeer: [9, 36], leichterhammer: [6, 18], speer: [6, 18], leichtearmbrust: [24, 96], wurfpfeil: [6, 18], kurzbogen: [24, 96],
  schleuder: [9, 36], dreizack: [6, 18], blasrohr: [7.5, 30], handarmbrust: [9, 36], schwerearmbrust: [30, 120], langbogen: [45, 180],
};
export const weaponReach = (w) => (w && /r/.test(w.p) ? 3 : 1.5);
export const isRangedWeapon = (w) => !!w && /a/.test(w.p);
export const isThrownWeapon = (w) => !!w && /t/i.test(w.p);

const A = {
  gepolstert: [5, 4], leder: [10, 5], beschlagen: [45, 6.5], fell: [10, 6], kettenhemd: [50, 10], schuppen: [50, 22.5], brustplatte: [400, 10], halbplatte: [750, 20],
  ringpanzer: [30, 20], kettenpanzer: [75, 27.5], schienen: [200, 30], platte: [1500, 32.5],
};

// [Name, Kategorie, Preis GM, Gewicht kg]
const GEAR = [
  ['Rucksack', 'gear', 2, 2.5], ['Schlafsack', 'gear', 1, 3.5], ['Decke', 'gear', 0.5, 1.5], ['Seil (15 m, Hanf)', 'gear', 1, 2.5], ['Seil (15 m, Seide)', 'gear', 10, 2.5],
  ['Fackel', 'gear', 0.01, 0.5], ['Laterne', 'gear', 5, 1], ['Blendlaterne', 'gear', 10, 1], ['Öl (Flasche)', 'gear', 0.1, 0.5], ['Kerze', 'gear', 0.01, 0],
  ['Zunderkästchen', 'gear', 0.5, 0.5], ['Rationen (1 Tag)', 'gear', 0.5, 1], ['Wasserschlauch', 'gear', 0.2, 2.5], ['Kletterhaken', 'gear', 0.05, 0.125],
  ['Hammer', 'gear', 1, 1.5], ['Brechstange', 'gear', 2, 2.5], ['Enterhaken', 'gear', 2, 2], ['Kette (3 m)', 'gear', 5, 5], ['Handschellen', 'gear', 2, 3],
  ['Schloss', 'gear', 10, 0.5], ['Spiegel', 'gear', 5, 0.25], ['Essgeschirr', 'gear', 0.2, 0.5], ['Eisentopf', 'gear', 2, 5], ['Zelt (zwei Personen)', 'gear', 2, 10],
  ['Schaufel', 'gear', 2, 2.5], ['Spitzhacke', 'gear', 2, 5], ['Leiter (3 m)', 'gear', 0.1, 12.5], ['Eimer', 'gear', 0.05, 1], ['Fass', 'gear', 2, 35], ['Sack', 'gear', 0.01, 0.25],
  ['Beutel', 'gear', 0.5, 0.5], ['Truhe', 'gear', 5, 12.5], ['Krähenfüße (Beutel)', 'gear', 1, 1], ['Kugellager (Beutel)', 'gear', 1, 1], ['Glocke', 'gear', 1, 0],
  ['Kreide', 'gear', 0.01, 0], ['Tinte', 'gear', 10, 0], ['Tintenfeder', 'gear', 0.02, 0], ['Papier (Blatt)', 'gear', 0.2, 0], ['Pergament (Blatt)', 'gear', 0.1, 0],
  ['Buch', 'gear', 25, 2.5], ['Zauberbuch', 'gear', 50, 1.5], ['Landkarte', 'gear', 1, 0], ['Fernrohr', 'gear', 1000, 0.5], ['Lupe', 'gear', 100, 0], ['Sanduhr', 'gear', 25, 0.5],
  ['Jagdfalle', 'gear', 5, 12.5], ['Netz', 'gear', 1, 1.5], ['Seife', 'gear', 0.02, 0], ['Parfüm', 'gear', 5, 0], ['Signalpfeife', 'gear', 0.05, 0], ['Kletterausrüstung', 'gear', 25, 6],
  ['Heilerausrüstung', 'gear', 5, 1.5], ['Heiltrank', 'potion', 50, 0.25], ['Gegengift', 'potion', 50, 0], ['Alchemistenfeuer', 'potion', 50, 0.5], ['Säure (Phiole)', 'potion', 25, 0.5],
  ['Weihwasser', 'potion', 25, 0.5], ['Gift (einfach)', 'potion', 100, 0], ['Köcher', 'ammo', 1, 0.5], ['Pfeile (20)', 'ammo', 1, 0.5], ['Bolzen (20)', 'ammo', 1, 0.75],
  ['Schleuderkugeln (20)', 'ammo', 0.04, 0.75], ['Blasrohrnadeln (50)', 'ammo', 1, 0.5], ['Heiliges Symbol (Amulett)', 'focus', 5, 0.5], ['Heiliges Symbol (Emblem)', 'focus', 5, 0],
  ['Reliquiar', 'focus', 5, 1], ['Komponentenbeutel', 'focus', 25, 1], ['Arkaner Fokus (Kristall)', 'focus', 10, 0.5], ['Arkaner Fokus (Kugel)', 'focus', 20, 1.5],
  ['Arkaner Fokus (Rute)', 'focus', 10, 1], ['Arkaner Fokus (Stab)', 'focus', 5, 2], ['Arkaner Fokus (Zauberstab)', 'focus', 10, 0.5], ['Druidenfokus (Mistelzweig)', 'focus', 1, 0],
  ['Druidenfokus (Holzstab)', 'focus', 5, 2], ['Robe', 'clothes', 1, 2], ['Reisekleidung', 'clothes', 2, 2], ['Feine Kleidung', 'clothes', 15, 3], ['Gewöhnliche Kleidung', 'clothes', 0.5, 1.5],
  ['Kostüm', 'clothes', 5, 2], ['Diebeswerkzeug', 'tool', 25, 0.5], ['Kräuterkundeausrüstung', 'tool', 5, 1.5], ['Alchemistenausrüstung', 'tool', 50, 4], ['Schmiedewerkzeug', 'tool', 20, 4],
  ['Tischlerwerkzeug', 'tool', 8, 3], ['Kalligrafenwerkzeug', 'tool', 10, 2.5], ['Kartografenwerkzeug', 'tool', 15, 3], ['Navigatorwerkzeug', 'tool', 25, 1], ['Giftmischerausrüstung', 'tool', 50, 1],
  ['Verkleidungsausrüstung', 'tool', 25, 1.5], ['Fälscherausrüstung', 'tool', 15, 2.5], ['Spielset (Würfel)', 'tool', 0.1, 0], ['Spielset (Karten)', 'tool', 0.5, 0],
  ['Laute', 'instrument', 35, 1], ['Flöte', 'instrument', 2, 0.5], ['Trommel', 'instrument', 6, 1.5], ['Dudelsack', 'instrument', 30, 3], ['Horn', 'instrument', 3, 1],
  ['Leier', 'instrument', 30, 1], ['Schalmei', 'instrument', 2, 0.5], ['Panflöte', 'instrument', 12, 1], ['Viola', 'instrument', 30, 0.5],
  ['Einbrecherausrüstung', 'pack', 16, 21], ['Diplomatenausrüstung', 'pack', 39, 19.5], ['Gewölbeforscherausrüstung', 'pack', 12, 27.5], ['Unterhaltungsausrüstung', 'pack', 40, 29],
  ['Entdeckerausrüstung', 'pack', 10, 27.5], ['Priesterausrüstung', 'pack', 33, 14.5], ['Gelehrtenausrüstung', 'pack', 40, 11],
];

export const CATEGORIES = {
  weapon: 'Waffen', armor: 'Rüstungen', shield: 'Schilde', gear: 'Abenteuerausrüstung', potion: 'Tränke & Alchemie', ammo: 'Munition', focus: 'Fokusse & Symbole',
  clothes: 'Kleidung', tool: 'Werkzeuge', instrument: 'Instrumente', pack: 'Ausrüstungspakete', magic: 'Magische Gegenstände', other: 'Sonstiges',
};

export const CATALOG = [
  ...WEAPONS.map((w) => ({ key: `w:${w.key}`, ref: w.key, name: w.name, cat: 'weapon', cost: W[w.key]?.[0] ?? 0, weight: W[w.key]?.[1] ?? 0, icon: WEAPON_ART[w.key], sub: `${w.dmg.replace('d', 'W')} ${w.type}` })),
  ...ARMOR.map((a) => ({ key: `a:${a.key}`, ref: a.key, name: a.name, cat: 'armor', cost: A[a.key]?.[0] ?? 0, weight: A[a.key]?.[1] ?? 0, icon: ARMOR_ART[a.key], sub: `RK ${a.ac}${a.type === 'light' ? ' + GES' : a.type === 'medium' ? ' + GES (max. 2)' : ''}` })),
  { key: 'a:schild', ref: 'schild', name: 'Schild', cat: 'shield', cost: 10, weight: 3, icon: ARMOR_ART.schild, sub: 'RK +2' },
  ...GEAR.map(([name, cat, cost, weight]) => ({ key: `g:${name}`, name, cat, cost, weight })),
];
const byName = new Map(CATALOG.map((x) => [x.name.toLowerCase(), x]));
export const catalogItem = (key) => CATALOG.find((x) => x.key === key) || null;
export function catalogByName(name) {
  const n = String(name || '').trim().toLowerCase().replace(/^\d+\s*[×x]?\s*/, '');
  const base = n.replace(/\s+mit\s+.*$/, '').replace(/\s*\(.*\)$/, '');
  return byName.get(n) || byName.get(base) || CATALOG.find((x) => x.name.toLowerCase().startsWith(`${base} (`)) || null;
}

export function iconForName(name) {
  for (const [re, ic] of ITEM_RULES) if (re.test(name)) return ic;
  return 'swap-bag';
}
export function magicIcon(item) {
  const hay = `${item.type || ''} ${item.name || ''}`;
  for (const [re, ic] of MAGIC_RULES) if (re.test(hay)) return ic;
  return MAGIC_DEFAULT;
}
// Symbol + Rahmenfarbe für einen Inventareintrag
export function itemLook(it) {
  if (it.magic || it.rarity) return { icon: it.icon || magicIcon(it), color: rarityColor(it.rarity) };
  const cat = it.ref ? catalogItem(it.ref) : catalogByName(it.name);
  return { icon: it.icon || cat?.icon || iconForName(it.name || ''), color: null };
}

// Preis in GM → „2 GM“, „5 SM“, „1 KM“
export function fmtCost(gp) {
  const v = Number(gp) || 0;
  if (!v) return '–';
  if (v >= 1) return `${v.toLocaleString('de-DE')} GM`;
  if (v >= 0.1) return `${Math.round(v * 10)} SM`;
  return `${Math.round(v * 100)} KM`;
}
export const fmtWeight = (kg) => (kg ? `${String(Math.round(kg * 100) / 100).replace('.', ',')} kg` : '–');

// Traglast: Stärkewert × 7,5 kg (Größe klein/mittel)
export const carryCapacity = (str) => (Number(str) || 10) * 7.5;
