// Wählt weitere CC0-Assets von Poly Haven aus (Texturen & Modelle), die zu Fantasy-Karten passen,
// und trägt sie in tools/mapassets.src.json ein. Danach im Stempel-Studio rendern und
// `node tools/build-mapassets.mjs` laufen lassen.
// Aufruf: node tools/pick-polyhaven.mjs [--apply]
import { readFile, writeFile } from 'node:fs/promises';

const SRC = new URL('./mapassets.src.json', import.meta.url);

// ── Was passt auf eine Fantasy-Karte? ──
const TEX_OK = /grass|dirt|mud|soil|sand|snow|ice|rock|stone|cobble|brick|wood|plank|timber|floor|roof|thatch|straw|hay|gravel|forest|leaf|leaves|moss|clay|marble|slate|sandstone|ground|terrain|rubble|pavement|path|bark|tile|mosaic|carpet|rug|fabric|beach|cliff|coast|ash|lava|earth|field|meadow|desert|dune|mountain|granite|limestone|basalt|brownstone|stucco|plaster|wall/i;
const TEX_NO = /bark_|veneer|bamboo|snips|playground|court|lane|asphalt|veneer|solar|plastic|anti[ _-]?skid|anti[ _-]?slip|baseball|playground|parking|road[ _-]?mark|manhole|metal|steel|aluminium|rust|corrugat|container|pipe|cable|circuit|fence[ _-]?wire|tarp|vinyl|linoleum|laminate|wallpaper|acoustic|foam|sport|tennis|basket|garage|factory|scaffold|shipping|hazard|paint[ _-]?peel|graffiti|chipboard|osb|plywood|mdf|drywall|gypsum|cardboard|carbon|denim|leather[ _-]?car|synthetic/i;
const MOD_OK = /barrel|crate|box|chest|basket|pot|jar|jug|vase|bottle|bowl|plate|cup|mug|bread|cheese|fruit|apple|pear|banana|vegetable|carrot|pumpkin|meat|fish|book|candle|lantern|lamp|chandelier|torch|chair|stool|bench|sofa|table|desk|cabinet|shelf|bookshelf|bed|rug|carpet|statue|bust|sculpture|sword|katana|axe|shield|bow|dagger|spear|hammer|anvil|forge|wheel|cart|wagon|rope|sack|bag|log|stump|branch|root|rock|boulder|stone|plant|tree|bush|shrub|flower|fern|grass|moss|mushroom|well|bucket|broom|ladder|cauldron|kettle|pan|skull|bone|coin|treasure|gem|scroll|map|quill|ink|chest|trunk|clock|mirror|curtain|banner|flag|bell|horn|drum|lute|harp|cage|chain|lock|key|shovel|pickaxe|saw|scythe|sickle|plow|fork|knife|spoon|tray|barrow|crock|amphora|urn|brazier|firewood|stack|hay|straw|sign|post|fence|gate|door|window|column|pillar|arch|stairs|bridge|boat|oar|net|anchor|lamp[ _-]?post/i;
const MOD_NO = /clipboard|compost|dartboard|cat[ _-]?statue|stove|litter|trash|bin|recycl|mailbox|parcel|pizza|burger|donut|cereal|milk|yogurt|ketchup|mustard|sauce|jam|pickle|spice|salt[ _-]?shaker|pepper[ _-]?mill|coffee|tea[ _-]?bag|kettle_electric|boombox|cardboard|cement|circuit|ammo|coffee|vice|caged|sneaker|shoe|modern|electric|electronic|plastic|barbecue|grill|cooler|thermos|lighter|soda|hydrant|pallet|forklift|toolbox|jerrycan|tyre|tire|fan|heater|lamp[ _-]?desk|desk[ _-]?lamp|floor[ _-]?lamp|street[ _-]?light|neon|led|solar|shark|whale|ray[ _-]?statue|dolphin|surf|ski|golf|gym|dumbbell|trolley|suitcase|backpack|handbag|wallet|glasses|watch|camera|tripod|microphone|piano|keyboard|mouse|monitor|projector|scanner|copier|camera|television|tv|computer|laptop|phone|printer|fridge|microwave|toaster|washing|vacuum|drill|wrench|screwdriver|pliers|bolt[ _-]?cutter|blowtorch|bunsen|megaphone|cash[ _-]?register|barber|school|office|traffic|wet[ _-]?floor|fire[ _-]?extinguisher|extension|socket|plug|battery|speaker|headphone|guitar|ukulele|football|baseball|basketball|tennis|golf|skate|bicycle|motorcycle|car[ _-]|truck|scooter|helmet|respirator|syringe|pill|medical|cleaner|bleach|detergent|spray|aerosol|shampoo|toilet|sink|shower|radiator|thermostat|alarm[ _-]?clock|calculator|binder|notebook|stapler|tape[ _-]?dispenser|usb|cable|charger|router|console|gamepad|drone|gas[ _-]?can|jerry|propane|welding|angle[ _-]?grinder|paint[ _-]?roller|caulk|silicone|plastic/i;

// Poly-Haven-Kategorien → unsere Gruppen
const TEX_CAT = [
  [/roof|thatch|shingle|tile[ _-]?roof/i, 'dach'],
  [/floor|parquet|planks|tiles|mosaic|carpet|rug/i, 'boden'],
  [/wall|brick|plaster|stucco|sandstone[ _-]?wall/i, 'wand'],
  [/cobble|pavement|path|road|pavers|street/i, 'pflaster'],
  [/grass|dirt|mud|soil|sand|snow|ice|forest|leaf|leaves|moss|terrain|ground|earth|field|meadow|desert|dune|gravel|rubble|beach|cliff|coast|rock/i, 'gelaende'],
];
const MOD_CAT = [
  [/tree|bush|shrub|fern|flower|plant|grass|moss|mushroom|log|stump|branch|root|leaf|ivy|vine/i, 'natur'],
  [/rock|boulder|stone|cliff|pebble/i, 'fels'],
  [/candle|lantern|lamp|chandelier|torch|brazier|fire|light|sconce/i, 'licht'],
  [/barrel|crate|box|chest|basket|sack|bag|jar|pot|urn|amphora|bucket|container|trunk/i, 'behaelter'],
  [/plate|bowl|cup|mug|jug|kettle|pan|tray|cutlery|knife|spoon|fork|bread|cheese|fruit|apple|pear|banana|vegetable|carrot|pumpkin|meat|fish|food|wine|bottle/i, 'kueche'],
  [/chair|stool|bench|sofa|table|desk|cabinet|shelf|bookshelf|bed|wardrobe|commode|nightstand|couch|seat/i, 'moebel'],
  [/statue|bust|sculpture|vase|mirror|clock|curtain|banner|flag|bell|painting|frame|book|scroll|chess|decor|ornament/i, 'deko'],
  [/sword|katana|axe|shield|bow|dagger|spear|hammer|anvil|shovel|pickaxe|saw|scythe|sickle|plow|tool|rope|chain|lock|key|ladder|broom|barrow|wheel|cart|wagon|net|anchor|oar/i, 'werkzeug'],
  [/well|fence|gate|door|window|column|pillar|arch|stair|bridge|post|sign|pier|boat/i, 'bau'],
];

// Kleines Wörterbuch für die Anzeigenamen
const WORDS = {
  wooden: 'Holz', wood: 'Holz', old: 'Alt', antique: 'Antik', vintage: 'Alt', rustic: 'Rustikal', small: 'Klein', large: 'Groß', big: 'Groß', round: 'Rund', square: 'Eckig', broken: 'Zerbrochen', empty: 'Leer',
  barrel: 'Fass', barrels: 'Fässer', crate: 'Kiste', crates: 'Kisten', box: 'Kasten', chest: 'Truhe', basket: 'Korb', bucket: 'Eimer', sack: 'Sack', bag: 'Beutel', jar: 'Krug', pot: 'Topf', urn: 'Urne', amphora: 'Amphore', vase: 'Vase', bottle: 'Flasche', jug: 'Kanne',
  chair: 'Stuhl', stool: 'Hocker', bench: 'Bank', sofa: 'Sofa', table: 'Tisch', desk: 'Schreibtisch', cabinet: 'Schrank', shelf: 'Regal', shelves: 'Regale', bookshelf: 'Bücherregal', bed: 'Bett', wardrobe: 'Kleiderschrank', nightstand: 'Nachttisch', commode: 'Kommode',
  candle: 'Kerze', candles: 'Kerzen', lantern: 'Laterne', lamp: 'Lampe', chandelier: 'Kronleuchter', torch: 'Fackel', brazier: 'Kohlebecken', sconce: 'Wandleuchter', fire: 'Feuer', firewood: 'Brennholz', campfire: 'Lagerfeuer',
  plate: 'Teller', bowl: 'Schale', cup: 'Becher', mug: 'Krug', kettle: 'Kessel', pan: 'Pfanne', tray: 'Tablett', knife: 'Messer', spoon: 'Löffel', fork: 'Gabel', bread: 'Brot', cheese: 'Käse', fruit: 'Obst', apple: 'Apfel', pear: 'Birne', banana: 'Banane', carrot: 'Karotte', pumpkin: 'Kürbis', meat: 'Fleisch', fish: 'Fisch', wine: 'Wein', beer: 'Bier',
  statue: 'Statue', bust: 'Büste', sculpture: 'Skulptur', mirror: 'Spiegel', clock: 'Uhr', curtain: 'Vorhang', banner: 'Banner', flag: 'Fahne', bell: 'Glocke', book: 'Buch', books: 'Bücher', scroll: 'Schriftrolle', chess: 'Schach', painting: 'Gemälde',
  sword: 'Schwert', katana: 'Katana', axe: 'Axt', shield: 'Schild', bow: 'Bogen', dagger: 'Dolch', spear: 'Speer', hammer: 'Hammer', anvil: 'Amboss', shovel: 'Schaufel', pickaxe: 'Spitzhacke', saw: 'Säge', scythe: 'Sense', sickle: 'Sichel', rope: 'Seil', chain: 'Kette', lock: 'Schloss', key: 'Schlüssel', ladder: 'Leiter', broom: 'Besen', barrow: 'Schubkarre', wheel: 'Rad', cart: 'Karren', wagon: 'Wagen', net: 'Netz', anchor: 'Anker', oar: 'Ruder', boat: 'Boot',
  tree: 'Baum', trees: 'Bäume', bush: 'Busch', shrub: 'Strauch', fern: 'Farn', flower: 'Blume', flowers: 'Blumen', plant: 'Pflanze', grass: 'Gras', moss: 'Moos', mushroom: 'Pilz', log: 'Baumstamm', stump: 'Baumstumpf', branch: 'Ast', root: 'Wurzel', roots: 'Wurzeln', ivy: 'Efeu', vine: 'Ranke', leaf: 'Blatt', leaves: 'Laub',
  rock: 'Fels', rocks: 'Felsen', boulder: 'Findling', stone: 'Stein', stones: 'Steine', pebble: 'Kiesel', cliff: 'Klippe',
  well: 'Brunnen', fence: 'Zaun', gate: 'Tor', door: 'Tür', window: 'Fenster', column: 'Säule', pillar: 'Säule', arch: 'Bogen', stairs: 'Treppe', bridge: 'Brücke', post: 'Pfosten', sign: 'Schild', pier: 'Steg',
  brass: 'Messing', bronze: 'Bronze', ceramic: 'Keramik', copper: 'Kupfer', iron: 'Eisen', steel: 'Stahl', silver: 'Silber', gold: 'Gold', golden: 'Golden', glass: 'Glas', leather: 'Leder', cloth: 'Tuch', wicker: 'Weiden', metal: 'Metall', rusty: 'Rostig',
  // Texturen
  floor: 'Boden', wall: 'Wand', roof: 'Dach', brick: 'Ziegel', bricks: 'Ziegel', cobblestone: 'Kopfstein', pavement: 'Pflaster', path: 'Weg', road: 'Straße', tiles: 'Fliesen', tile: 'Fliese', mosaic: 'Mosaik', marble: 'Marmor', slate: 'Schiefer', sandstone: 'Sandstein', granite: 'Granit', limestone: 'Kalkstein', basalt: 'Basalt', concrete: 'Beton', plaster: 'Putz', stucco: 'Putz', planks: 'Dielen', plank: 'Diele', timber: 'Balken', bark: 'Rinde', dirt: 'Erde', mud: 'Schlamm', soil: 'Boden', sand: 'Sand', snow: 'Schnee', ice: 'Eis', gravel: 'Kies', rubble: 'Schutt', forest: 'Wald', ground: 'Boden', terrain: 'Gelände', earth: 'Erde', field: 'Feld', meadow: 'Wiese', desert: 'Wüste', dune: 'Düne', beach: 'Strand', coast: 'Küste', mountain: 'Berg', thatch: 'Reet', straw: 'Stroh', hay: 'Heu', carpet: 'Teppich', rug: 'Teppich', fabric: 'Stoff', clay: 'Lehm', ash: 'Asche', lava: 'Lava', aerial: 'Luftbild', mossy: 'Moosig', rocky: 'Felsig', sandy: 'Sandig', muddy: 'Schlammig', dry: 'Trocken', wet: 'Nass', dark: 'Dunkel', light: 'Hell', red: 'Rot', brown: 'Braun', green: 'Grün', grey: 'Grau', gray: 'Grau', white: 'Weiß', black: 'Schwarz', beige: 'Beige', yellow: 'Gelb', blue: 'Blau', worn: 'Abgenutzt', rough: 'Rau', smooth: 'Glatt', cracked: 'Rissig', patterned: 'Gemustert', painted: 'Bemalt', medieval: 'Mittelalterlich', castle: 'Burg', church: 'Kirche', gothic: 'Gotisch', ornate: 'Verziert',
};

const pretty = (name) => {
  const words = String(name).replace(/[_-]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    if (/^\d+$/.test(w)) { out.push(w.replace(/^0+(?=\d)/, '')); continue; }
    const k = w.toLowerCase().replace(/[^a-z]/g, '');
    out.push(WORDS[k] || w.charAt(0).toUpperCase() + w.slice(1));
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
};
const catOf = (name, table, fallback) => {
  for (const [re, cat] of table) if (re.test(name)) return cat;
  return fallback;
};

const limit = (arr, n) => arr.slice(0, n);

const [tex, mod] = await Promise.all([
  fetch('https://api.polyhaven.com/assets?t=textures').then((r) => r.json()),
  fetch('https://api.polyhaven.com/assets?t=models').then((r) => r.json()),
]);
const src = JSON.parse(await readFile(SRC, 'utf8'));
const haveT = new Set(src.textures.map((t) => t.id));
const haveM = new Set(src.models.map((m) => m.id));

const newTex = limit(Object.entries(tex)
  .filter(([id, a]) => !haveT.has(id) && TEX_OK.test(`${id} ${a.name}`) && !TEX_NO.test(`${id} ${a.name}`))
  .map(([id, a]) => ({ id, name: pretty(a.name), cat: catOf(`${id} ${a.name}`, TEX_CAT, 'gelaende') })), 200);

const blockObj = /tree|bush|shrub|fern|flower|plant|grass|moss|log|stump|branch|root/i;
const newMod = limit(Object.entries(mod)
  .filter(([id, a]) => !haveM.has(id) && MOD_OK.test(`${id} ${a.name}`) && !MOD_NO.test(`${id} ${a.name}`))
  .map(([id, a]) => {
    const key = `${id} ${a.name}`;
    const cat = catOf(key, MOD_CAT, 'deko');
    const e = { id, name: pretty(a.name), cat };
    if (/tree|canopy/i.test(key)) e.layer = 'top';
    if (/rug|carpet/i.test(key)) e.layer = 'floor';
    if (/statue|pillar|column|cabinet|wardrobe|shelf|bookshelf|boulder|rock|well|anvil|fence|gate/i.test(key)) e.block = 1;
    else if (/table|chair|bench|stool|bed|barrel|crate|chest|basket|sofa|desk|cart|wagon|log|stump/i.test(key)) e.rough = 1;
    if (/candle|lantern|lamp|chandelier|torch|brazier|fire/i.test(key)) e.tags = 'licht';
    if (blockObj.test(key) && !e.layer) e.split = 1;
    return e;
  }), 170);

console.log(`Neue Texturen: ${newTex.length}`);
console.log(newTex.map((t) => `${t.cat}: ${t.name} (${t.id})`).slice(0, 25).join('\n'));
console.log(`\nNeue Modelle: ${newMod.length}`);
console.log(newMod.map((m) => `${m.cat}: ${m.name} (${m.id})`).slice(0, 25).join('\n'));

if (process.argv.includes('--apply')) {
  src.textures.push(...newTex);
  src.models.push(...newMod);
  await writeFile(SRC, `${JSON.stringify(src, null, 2)}\n`);
  console.log(`\n→ tools/mapassets.src.json: jetzt ${src.textures.length} Texturen, ${src.models.length} Modelle`);
}
