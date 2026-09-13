// Zufallstabellen & Namensgeneratoren (eigene Inhalte, offline ohne KI nutzbar).
import { pick, pickN, randInt } from '../lib/util.js';
import { roll } from '../lib/dice.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const syl = (...parts) => cap(parts.map((p) => pick(p)).join(''));

// ───────────────────────── Namen ─────────────────────────
const HUMAN_M = ['Alrik', 'Bertram', 'Conrad', 'Dietrich', 'Eberhard', 'Friedhelm', 'Gero', 'Hagen', 'Ingo', 'Jorg', 'Kilian', 'Leopold', 'Markward', 'Notker', 'Otmar', 'Rupert', 'Sigmund', 'Tassilo', 'Ulrich', 'Volker', 'Wendelin', 'Anselm', 'Bodo', 'Egbert', 'Gottfried', 'Hartmut', 'Lambert', 'Reinhold', 'Wigand', 'Arnulf'];
const HUMAN_F = ['Adelheid', 'Brunhild', 'Clara', 'Dietlind', 'Elsbeth', 'Frieda', 'Gertrud', 'Hedwig', 'Irmgard', 'Jutta', 'Kunigunde', 'Liesel', 'Mechthild', 'Notburga', 'Ottilie', 'Richardis', 'Sieglinde', 'Theda', 'Ursel', 'Walburga', 'Agnes', 'Berthe', 'Edda', 'Gisela', 'Hilde', 'Imma', 'Luitgard', 'Mathilde', 'Rosamund', 'Wiltrud'];
const HUMAN_LAST = ['Eisenfaust', 'Kesselflick', 'Morgentau', 'Salzbart', 'Tannhäuser', 'Moosbach', 'Rabenruh', 'Silberquell', 'Hammerschlag', 'Wolkenbruch', 'Steinbeißer', 'Brandt', 'Fischer', 'Kienholz', 'Vogt', 'Weidenhof', 'Schwarzmoor', 'Dornbusch', 'Grauwasser', 'Haselnuss', 'Lichtenberg', 'Nebelhorn', 'Ackermann', 'Seilmacher', 'Kupferkessel'];
const DWARF_PRE = ['Bal', 'Bor', 'Brun', 'Dor', 'Dur', 'Gim', 'Grom', 'Har', 'Kaz', 'Khar', 'Mor', 'Nor', 'Orn', 'Rur', 'Thor', 'Thra', 'Ulf', 'Vond', 'Bram', 'Gund'];
const DWARF_M = ['ak', 'dar', 'din', 'grim', 'gar', 'in', 'li', 'mar', 'nar', 'rik', 'rin', 'tuk', 'ur', 'bur', 'dok'];
const DWARF_F = ['a', 'da', 'dis', 'hild', 'ra', 'ris', 'wyn', 'grid', 'ka', 'lin'];
const DWARF_CLAN = ['Aschwald', 'Eisenbart', 'Felsenhammer', 'Glutschmied', 'Goldader', 'Hügelgrab', 'Kohlenherz', 'Steinfaust', 'Tiefgrund', 'Erzbrecher', 'Ambossklang', 'Granitschild', 'Funkenbart', 'Silberstollen'];
const ELF_PRE = ['Ae', 'Aer', 'Cae', 'Ela', 'Eri', 'Fae', 'Gal', 'Ila', 'Lae', 'Lia', 'Mae', 'Nae', 'Syl', 'Tha', 'Vae', 'Yl', 'Ser', 'Ith'];
const ELF_MID = ['ra', 'ri', 'le', 'lo', 'na', 'the', 'sa', 'va', 'lu', 'nd', ''];
const ELF_M = ['dor', 'lian', 'nor', 'ril', 'thas', 'var', 'wyn', 'ion', 'ras', 'mir'];
const ELF_F = ['lia', 'riel', 'wen', 'thia', 'ra', 'nys', 'lyn', 'dra', 'sae', 'eth'];
const ELF_LAST = ['Mondschein', 'Sternensang', 'Silberblatt', 'Morgenglanz', 'Nebelhain', 'Sturmblatt', 'Lichtungshain', 'Tauperle', 'Eichenruf', 'Nachtigall', 'Weidenwind', 'Glimmerquell'];
const HALF_PRE = ['Bel', 'Bil', 'Dun', 'Fen', 'Hob', 'Jas', 'Kip', 'Mer', 'Nib', 'Pip', 'Ros', 'Tob', 'Wil', 'Mil', 'Cor'];
const HALF_SUF_M = ['bo', 'do', 'lo', 'mo', 'ric', 'wick', 'by', 'ton'];
const HALF_SUF_F = ['la', 'lie', 'wyn', 'ra', 'sy', 'ella', 'dy', 'bee'];
const HALF_LAST = ['Brandyfuß', 'Grünfeld', 'Honigtopf', 'Kesselfell', 'Tiefbau', 'Unterzweig', 'Hochhügel', 'Teeblatt', 'Butterblume', 'Apfelgarten', 'Pilzstiel'];
const GNOME_PRE = ['Bim', 'Dim', 'Fon', 'Gim', 'Glim', 'Nim', 'Orr', 'Pip', 'Quin', 'Sin', 'Tik', 'Zook', 'Wiz', 'Fizz'];
const GNOME_SUF = ['ble', 'kin', 'nock', 'wick', 'dle', 'zel', 'bit', 'pop', 'sprock', 'tinker'];
const GNOME_LAST = ['Zahnradflick', 'Funkenzwirn', 'Tüftelbart', 'Kurbeldreh', 'Knallkorken', 'Spulenwinder', 'Glimmerspan'];
const ORC_PRE = ['Gr', 'Kr', 'Th', 'Ur', 'Dr', 'Sh', 'Mog', 'Rag', 'Zug', 'Bru', 'Gha', 'Vok'];
const ORC_MID = ['a', 'o', 'u', 'ag', 'og', 'ush', 'ak'];
const ORC_SUF = ['sh', 'k', 'g', 'z', 'th', 'rk', 'nak', 'gul', 'mash'];
const INF_PRE = ['Ak', 'Am', 'Bar', 'Dam', 'Ek', 'Ia', 'Kai', 'Leu', 'Mel', 'Mor', 'Pel', 'Ska', 'Ther', 'Zar', 'Nyx', 'Val'];
const INF_SUF = ['menos', 'non', 'akas', 'akos', 'emon', 'dos', 'ron', 'cis', 'ech', 'dai', 'thos', 'aios', 'mos', 'ai', 'ith', 'ara', 'essa', 'ia'];
const VIRTUE = ['Hoffnung', 'Stille', 'Zweifel', 'Glaube', 'Trauer', 'Sehnsucht', 'Mut', 'Reue', 'Asche', 'Ehre', 'Wahrheit', 'Geduld'];
const DRAGON_PRE = ['Ar', 'Bal', 'Dra', 'Ghe', 'Hes', 'Kri', 'Med', 'Nad', 'Pan', 'Rho', 'Sha', 'Tar', 'Tor', 'Vyr', 'Zor', 'Kav', 'Sor', 'Thav'];
const DRAGON_SUF = ['jhan', 'asar', 'rash', 'naar', 'ghesh', 'kan', 'iv', 'rash', 'arr', 'jed', 'gar', 'mash', 'inn', 'ra', 'ann', 'ira', 'uth'];
const DRAGON_CLAN = ['Kethrendar', 'Vorithax', 'Sulvyrrin', 'Dharnakor', 'Myrrhastal', 'Tzarrendil', 'Olkhaverion', 'Brennaxis'];

export const SPECIES_NAMES = ['Mensch', 'Zwerg', 'Elf', 'Halbling', 'Gnom', 'Ork', 'Tiefling', 'Drachenblütiger', 'Halbelf'];

export function randomName(species = 'Mensch', gender = pick(['m', 'w'])) {
  const f = gender === 'w';
  switch (species) {
    case 'Zwerg': return `${pick(DWARF_PRE)}${pick(f ? DWARF_F : DWARF_M)} ${pick(DWARF_CLAN)}`;
    case 'Elf': return `${syl(ELF_PRE, ELF_MID, f ? ELF_F : ELF_M)} ${pick(ELF_LAST)}`;
    case 'Halbelf': return `${syl(ELF_PRE, f ? ELF_F : ELF_M)} ${pick(HUMAN_LAST)}`;
    case 'Halbling': return `${syl(HALF_PRE, f ? HALF_SUF_F : HALF_SUF_M)} ${pick(HALF_LAST)}`;
    case 'Gnom': return `${syl(GNOME_PRE, GNOME_SUF)} ${pick(GNOME_LAST)}`;
    case 'Ork': return syl(ORC_PRE, ORC_MID, ORC_SUF);
    case 'Tiefling': return randInt(1, 3) === 1 ? pick(VIRTUE) : syl(INF_PRE, INF_SUF);
    case 'Drachenblütiger': return `${syl(DRAGON_PRE, DRAGON_SUF)} ${pick(DRAGON_CLAN)}`;
    default: return `${pick(f ? HUMAN_F : HUMAN_M)} ${pick(HUMAN_LAST)}`;
  }
}

// ───────────────────────── Tavernen & Läden ─────────────────────────
const TAV_ADJ = ['Tanzenden', 'Goldenen', 'Schiefen', 'Betrunkenen', 'Ertrunkenen', 'Singenden', 'Einäugigen', 'Silbernen', 'Rostigen', 'Schlafenden', 'Lachenden', 'Grinsenden', 'Grünen', 'Verlorenen', 'Brüllenden', 'Hinkenden', 'Blauen', 'Letzten', 'Frechen', 'Müden'];
const TAV_NOUN_M = ['Troll', 'Keiler', 'Drachen', 'Anker', 'Humpen', 'Hirsch', 'Greif', 'Ritter', 'Kessel', 'Mond', 'Barden', 'Oger', 'Krug', 'Hahn'];
const TAV_NOUN_F = ['Nixe', 'Laterne', 'Krone', 'Eule', 'Harfe', 'Axt', 'Sau', 'Möwe', 'Katze', 'Kerze', 'Hexe'];
const TAV_NOUN_N = ['Einhorn', 'Fass', 'Pony', 'Horn', 'Rad', 'Schwein', 'Schiff', 'Ferkel'];
export function tavernName() {
  const r = randInt(1, 3);
  if (r === 1) return `Zum ${pick(TAV_ADJ)} ${pick(TAV_NOUN_M)}`;
  if (r === 2) return `Zur ${pick(TAV_ADJ)} ${pick(TAV_NOUN_F)}`;
  return `Zum ${pick(TAV_ADJ)} ${pick(TAV_NOUN_N)}`;
}

const TAV_SPECIALS = ['Pilzeintopf mit Schwarzbier', 'Honigmet nach Geheimrezept', 'gegrillter Riesenkäfer', 'Pfeffer-Aal in Salzkruste', 'Zwergenstout, das man kauen kann', 'Elfenwein, der nach Regen schmeckt', 'Drachenpfefferwurst (brennt zweimal)', 'Kartoffelsuppe „wie bei Mutter“'];
export function tavern() {
  return {
    name: tavernName(),
    host: randomName(pick(SPECIES_NAMES)),
    special: pick(TAV_SPECIALS),
    mood: pick(['überfüllt und laut', 'fast leer, verdächtig still', 'mitten in einer Hochzeitsfeier', 'voller müder Söldner', 'ein Barde spielt schief, aber leidenschaftlich', 'Kartenspiel mit hohen Einsätzen im Hinterzimmer']),
    event: pick(TAVERN_EVENTS),
  };
}

export const SHOP_GROUPS = {
  'Grundversorgung': [
    ['Bäckerstand', 'Brot, Fladen, süße Teilchen', '1 cp', '5 sp'],
    ['Obst- und Gemüsehändler', 'saisonale Ware, getrocknete Rationen', '1 cp', '3 sp'],
    ['Metzger / Räucherwaren', 'Trockenfleisch, Würste, Reiseproviant', '5 sp', '2 gp'],
    ['Käserei', 'Hartkäse, Ziegenkäse, Butter', '3 cp', '1 gp'],
    ['Brauerei-Ausschank', 'Bier im Krug oder Fass', '4 cp', '2 gp'],
    ['Kräuterfrau', 'Heilkräuter, Tees, Salben', '2 sp', '5 gp'],
    ['Tabakhändler', 'Tabak, Pfeifen, Kautabak', '5 sp', '5 gp'],
    ['Fischstand', 'Frischfisch, Stockfisch, Muscheln', '2 cp', '6 sp'],
  ],
  'Handwerk & Ausrüstung': [
    ['Ledermacher', 'Gürtel, Taschen, Köcher, Stiefel', '2 sp', '10 gp'],
    ['Schmied', 'Nägel, Werkzeug, Hufeisen, einfache Waffen', '1 sp', '25 gp'],
    ['Seiler', 'Hanfseile, Netze, Taue', '1 sp', '2 gp'],
    ['Kerzenzieher', 'Kerzen, Lampenöl, Laternen', '1 cp', '10 gp'],
    ['Töpfer', 'Krüge, Schalen, Tintenfässer', '2 cp', '2 gp'],
    ['Bogner', 'Bögen, Pfeile, Sehnen', '1 gp', '50 gp'],
    ['Rüstmacher', 'Leder-, Ketten- und Schuppenpanzer', '10 gp', '750 gp'],
    ['Zeltmacher', 'Zelte, Schlafrollen, Planen', '1 sp', '2 gp'],
  ],
  'Luxus & Besonderes': [
    ['Juwelier', 'Ringe, Broschen, geschliffene Steine', '10 gp', '500 gp'],
    ['Parfümeur', 'Duftöle, Seifen, Puder', '5 sp', '25 gp'],
    ['Buchbinder', 'Bücher, Pergament, Siegelwachs', '1 sp', '50 gp'],
    ['Kartenmacher', 'regionale und Weltkarten, blanko & beschriftet', '30 gp', '240 gp'],
    ['Glasbläser', 'Phiolen, Linsen, Zierglas', '1 sp', '30 gp'],
    ['Weinhändler', 'Landwein bis Jahrgangswein', '2 sp', '10 gp'],
    ['Alchemist', 'Heiltränke, Säure, Alchemistenfeuer', '25 gp', '150 gp'],
  ],
  'Dienstleistungen': [
    ['Barbier & Bader', 'Rasur, Zahnziehen, Aderlass', '2 cp', '5 sp'],
    ['Schreiber', 'Briefe, Verträge, Abschriften', '2 sp', '5 gp'],
    ['Stallmeister', 'Unterstellen, Futter, Beschlagen', '5 cp', '2 gp'],
    ['Bote', 'Nachricht in die Nachbarstadt', '2 cp', '1 gp'],
    ['Heiler des Tempels', 'Wunden versorgen, Segen', '1 sp', '25 gp'],
  ],
};

const COIN_VAL = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
function toCp(s) {
  const m = /([\d.,]+)\s*(cp|sp|ep|gp|pp)/.exec(s);
  return m ? parseFloat(m[1].replace(',', '.')) * COIN_VAL[m[2]] : 0;
}
function fromCp(cp) {
  const v = Math.max(1, Math.round(cp));
  if (v >= 100 && v % 100 === 0) return `${v / 100} gp`;
  if (v >= 100) return `${Math.round(v / 10) / 10 >= 10 ? Math.round(v / 100) : Math.round(v / 10) / 10} gp`.replace('.', ',');
  if (v >= 10) return `${Math.round(v / 10)} sp`;
  return `${v} cp`;
}

export function marketList({ size = 'Stadt', factor = 1, groups = Object.keys(SHOP_GROUPS) } = {}) {
  const n = size === 'Dorf' ? 2 : size === 'Metropole' ? 6 : 4;
  let out = '';
  for (const g of groups) {
    const list = pickN(SHOP_GROUPS[g], Math.min(n, SHOP_GROUPS[g].length));
    out += `**${g}:**\n`;
    for (const [who, what, lo, hi] of list) out += `- ${who} – ${what} ${factor === 1 ? lo : fromCp(toCp(lo) * factor)} – ${factor === 1 ? hi : fromCp(toCp(hi) * factor)}\n`;
    out += '\n';
  }
  if (factor !== 1) out += `*Preise ${factor > 1 ? `${Math.round((factor - 1) * 100)} % teurer` : `${Math.round((1 - factor) * 100)} % günstiger`} als üblich.*\n`;
  return out.trim();
}

// ───────────────────────── Listen ─────────────────────────
export const RUMORS = [
  'Die Stadtwache sucht heimlich nach einem entflohenen Adligen.', 'Im alten Brunnen am Markt hört man nachts jemanden singen.', 'Der Bäcker mischt etwas ins Brot, das Träume bunter macht.', 'Eine Karawane ist spurlos verschwunden – mit einer Truhe voller Drachenschuppen.',
  'Der Tempel verkauft gefälschte Reliquien.', 'Auf dem Friedhof wurden frische Spuren gefunden – von innen nach außen.', 'Ein Zwerg zahlt ein Vermögen für jede Karte der alten Minen.', 'Die Hafenmeisterin war früher Piratin.',
  'Wer am Neumond das Stadttor passiert, kommt als jemand anderes zurück.', 'Im Wald wurden Bäume gesehen, die sich bewegen.', 'Die Gilde der Kerzenzieher plant einen Aufstand.', 'Ein Magier sucht Freiwillige für ein „harmloses“ Experiment.',
  'Die Tochter des Bürgermeisters trifft sich nachts mit einem Tiefling.', 'In den Kellern der Taverne liegt ein vergessener Tunnel.', 'Ein Kopfgeld auf einen Werwolf – aber niemand weiß, wer es ist.', 'Die Glocke im Turm läutet seit Tagen um die falsche Stunde.',
  'Ein alter Söldner verkauft angeblich eine Karte zum Hort eines Drachen.', 'Die Brunnen sind vergiftet – sagen die Fremden. Die Einheimischen sagen, die Fremden waren es.', 'Eine Hexe im Moor tauscht Wünsche gegen Erinnerungen.', 'Der Fluss hat letzte Woche rückwärts geflossen.',
];

export const HOOKS = [
  'Ein sterbender Bote drückt einem Helden einen versiegelten Brief in die Hand – adressiert an jemanden, der seit 50 Jahren tot ist.', 'Ein Kind bietet all seine Ersparnisse (3 cp), damit jemand seine Katze aus dem Keller des Magierturms holt.',
  'Die Gruppe wacht in einer Zelle auf – mit einem Schuldschein über 1.000 gp, den keiner unterschrieben haben will.', 'Ein Adliger lädt zum Maskenball – und jeder Gast erhält eine Maske, die einem der Helden verdächtig ähnlich sieht.',
  'Bei einer Beerdigung öffnet sich der Sarg. Der Tote bittet höflich um ein Glas Wasser.', 'Eine Karawane sucht dringend Wachen: Die letzten drei Trupps sind nicht zurückgekehrt.',
  'Ein Tempel bittet um Hilfe: Die Statue ihres Gottes weint seit gestern Blut.', 'Auf dem Markt taucht ein Händler auf, der mit Gegenständen aus der Zukunft handelt.',
  'Der örtliche Braumeister ist verschwunden – und mit ihm das Rezept, von dem das ganze Dorf lebt.', 'Ein Drache schickt einen Brief: Er möchte seinen Hort versichern lassen.',
  'Die Stadtwache rekrutiert Hilfskräfte, weil die halbe Wache an einer seltsamen Schlafkrankheit leidet.', 'Ein Geist bittet die Gruppe, seine Ermordung aufzuklären – er erinnert sich nur an einen Geruch.',
];

export const TAVERN_EVENTS = [
  'Ein Armdrück-Turnier – der Champion ist eine zierliche Gnomin.', 'Ein Barde singt ein Spottlied über einen der Helden – woher kennt er die Geschichte?', 'Eine Schlägerei bricht aus, weil jemand beim Würfeln betrügt.', 'Ein Fremder bezahlt die Runde für alle – mit Münzen aus einem untergegangenen Reich.',
  'Der Wirt bittet leise um Hilfe: Etwas frisst seine Vorräte im Keller.', 'Eine Wahrsagerin bietet kostenlose Lesungen an – alle sehr beunruhigend.', 'Stadtwachen durchsuchen den Schankraum nach einem Flüchtigen.', 'Ein Hund bringt einem Helden einen abgetrennten Finger mit Siegelring.',
  'Ein Wettbewerb: Wer das „Drachenfeuer“-Chili aufisst, trinkt einen Monat gratis.', 'Zwei Gäste duellieren sich um die Ehre einer abwesenden Dame – mit Gedichten.',
];

export const TRINKETS = [
  'eine Glaskugel mit einem winzigen, ewig fallenden Schneesturm', 'ein Zahn, der leise summt, wenn Gold in der Nähe ist', 'ein Schlüssel ohne Bart', 'ein Brief in einer Sprache, die niemand spricht, mit einem Kussmund-Siegel', 'eine Eichel aus Bronze',
  'ein Kompass, dessen Nadel auf den Träger zeigt', 'ein Fläschchen mit Mondlicht', 'eine Holzfigur eines der Helden – erschreckend detailliert', 'eine Muschel, in der man Streitgespräche hört', 'ein Handschuh, der immer warm ist',
  'ein Würfel, der nur Sechsen zeigt – außer wenn es wichtig ist', 'ein getrocknetes Vierblatt in Harz gegossen', 'eine Münze mit zwei Köpfen', 'ein Knopf von der Uniform eines toten Generals', 'ein Löffel mit eingraviertem Totenkopf',
  'eine Spieluhr, die ein Wiegenlied aus der Kindheit des Trägers spielt', 'eine Feder, die nie nass wird', 'ein Stück Kreide, das auf jedem Untergrund schreibt', 'ein Glasauge', 'ein Brotlaib, der nicht schimmelt – seit hundert Jahren',
  'eine Karte, die nur den Weg zurück zeigt', 'eine Kerze, deren Flamme sich gegen den Wind neigt', 'ein Ring aus geflochtenem Haar', 'eine Pfeife, die von selbst raucht', 'ein kleiner Spiegel, der eine Sekunde zu spät reagiert',
  'ein Säckchen Sand von einem Strand, den es nicht gibt', 'eine Fingerpuppe eines Beholders', 'ein Stein mit einem Loch, durch das man Geister sieht (vielleicht)', 'ein Liebesbrief ohne Adressaten', 'ein Zahnrad aus unbekanntem Metall',
];

export const QUIRKS = [
  'spricht von sich in der dritten Person', 'summt ständig dieselbe Melodie', 'zählt alles – Stufen, Münzen, Worte', 'misstraut jedem mit Hut', 'verwechselt ständig Namen', 'sammelt Knöpfe', 'lacht an unpassenden Stellen',
  'flüstert, wenn es wichtig wird', 'isst nur gelbe Speisen', 'zitiert erfundene Sprichwörter', 'fürchtet sich vor Tauben', 'riecht immer nach Zimt', 'trägt stets zwei verschiedene Stiefel', 'beendet Sätze mit einer Frage, oder?',
  'klopft vor jeder Tür dreimal', 'hat eine sprechende Ratte als Berater', 'duzt jeden, auch Könige', 'wettet auf alles', 'kann kein Blut sehen', 'erzählt ungefragt von der Ex-Frau',
];

export const LOOKS = [
  'eine Narbe quer über die Lippe', 'feuerrotes, zu Zöpfen geflochtenes Haar', 'ein goldener Eckzahn', 'Tätowierungen, die sich langsam bewegen', 'ein Auge milchig weiß', 'viel zu große, geflickte Kleidung', 'ein Monokel an einer Silberkette',
  'Hände voller Tintenflecke', 'ein prächtiger, gewachster Schnurrbart', 'Sommersprossen wie Sternbilder', 'eine Adlerfeder hinter dem Ohr', 'ein schwerer Pelzmantel trotz Hitze', 'sehr kleine, sehr wache Augen', 'glatzköpfig mit kunstvollem Bart',
];

export const MOTIVES = ['will die eigene Familie freikaufen', 'sucht Rache für einen alten Verrat', 'will berühmt werden', 'versteckt sich vor der Vergangenheit', 'will beweisen, dass alle sich irren', 'sammelt Wissen um jeden Preis', 'schuldet der Diebesgilde Geld', 'sucht ein verschwundenes Geschwister', 'will die Stadt verlassen, kann aber nicht', 'dient heimlich einem Unhold'];

export const SECRETS = ['ist in Wahrheit adelig', 'hat einen Mord beobachtet', 'ist ein Doppelgänger', 'bestiehlt den eigenen Arbeitgeber', 'kennt den Weg in die alte Gruft', 'ist mit dem Schurken verwandt', 'hat einen Pakt geschlossen', 'ist schon lange tot – und weiß es nicht', 'fälscht Dokumente für den Rat', 'hat den Brunnen vergiftet – aus Versehen'];

export const ENCOUNTERS = {
  Wald: ['Ein verletzter Hirsch mit einem Pfeil in der Flanke – die Jäger sind nah.', 'Ein Kreis aus Pilzen; wer hineintritt, hört Feenmusik.', 'Wölfe (1d4+2) folgen der Gruppe in sicherem Abstand.', 'Ein Eremit bietet Tee gegen eine Geschichte.', 'Ein Baum mit einer Tür darin.', 'Banditen (1d6) haben die Straße mit einem Baumstamm blockiert.', 'Eine Eule, die Gemeinsprache spricht, stellt ein Rätsel.', 'Ein Owlbear-Nest mit Eiern.'],
  Gebirge: ['Steinschlag! GES-Rettungswurf SG 13 oder 2d10 Wuchtschaden.', 'Eine zwergische Patrouille verlangt Wegzoll.', 'Ein Adler kreist – er trägt einen Beutel in den Klauen.', 'Ein Bergtroll schläft in einer Höhle.', 'Ein Schneesturm zieht auf (Sicht 5 m).', 'Verlassene Kletterausrüstung und ein Tagebuch.', 'Ziegenhirten mit Neuigkeiten aus dem Tal.', 'Ein Riese, der Steine sortiert.'],
  Küste: ['Ein gestrandeter Wal – und darin etwas, das sich bewegt.', 'Schmuggler löschen gerade ihre Laternen.', 'Eine Sirene singt von einem Felsen.', 'Treibgut mit einem versiegelten Fass.', 'Krabbenschwärme bei Ebbe.', 'Ein Fischerboot ohne Besatzung treibt vorbei.', 'Ein Leuchtturmwärter bittet um Gesellschaft.', 'Sahuagin-Späher im Seegras.'],
  Sumpf: ['Irrlichter locken vom Pfad.', 'Ein Krokodil, das eine Krone trägt.', 'Eine Hexe tauscht Kräuter gegen Haare.', 'Blutegel! KON-Rettungswurf SG 11 oder vergiftet.', 'Ein versunkener Tempel ragt aus dem Wasser.', 'Echsenvolk-Jäger mit einem Gefangenen.', 'Fauliges Gas steigt auf – Feuer verboten!', 'Ein Frosch, der „Hilfe“ quakt.'],
  Straße: ['Ein Händler mit gebrochenem Wagenrad.', 'Pilger auf dem Weg zu einem Wunder.', 'Ein Galgen mit frischem Aushang: ein Kopfgeld.', 'Eine Kutsche rast vorbei – Verfolger folgen.', 'Ein Gaukler bietet eine Vorstellung.', 'Zöllner verlangen einen „Sonderzoll“.', 'Ein Bote bittet um Geleitschutz.', 'Goblins (2d4) im Hinterhalt.'],
  Wüste: ['Eine Oase – vielleicht eine Fata Morgana.', 'Ein Sandsturm (Sicht 2 m, Erschöpfungsgefahr).', 'Nomaden bieten Wasser gegen Neuigkeiten.', 'Ein halb begrabener Obelisk.', 'Riesige Skorpione jagen bei Dämmerung.', 'Ein Karawanenwrack mit Schatzkarte.', 'Ein Dschinn in einer zerbrochenen Flasche.', 'Glühende Hitze: KON-Rettungswurf SG 10.'],
  Unterreich: ['Pilzwälder mit Sporen (WEI-Rettungswurf SG 12 oder verwirrt).', 'Duergar-Händler mit Sklaven.', 'Ein unterirdischer See ohne Grund.', 'Echos, die antworten.', 'Ein Drow-Spähtrupp.', 'Kristalle, die Gedanken verstärken.', 'Ein Gelatinewürfel im Gang.', 'Eine Myconiden-Kolonie lädt zum Rausch.'],
};

export const DUNGEON = {
  Geräusche: ['fernes Tropfen', 'Kratzen hinter der Wand', 'leises Weinen', 'Kettenrasseln', 'ein Gong in der Tiefe', 'Flügelschlagen', 'Stille – zu still', 'Singsang in fremder Sprache'],
  Gerüche: ['Moder und nasse Erde', 'verbranntes Haar', 'süßliche Verwesung', 'Weihrauch', 'Schwefel', 'Ozon wie nach einem Blitz', 'frisches Brot (!)', 'Kupfer – Blut'],
  Details: ['eine Wand mit Kratzspuren, die Striche zählen', 'ein zerbrochenes Götzenbild', 'Knochen, sorgfältig sortiert', 'ein Mosaik, das sich verändert, wenn man wegsieht', 'eine verschlossene Tür mit Mund', 'Wurzeln, die durch die Decke brechen', 'eine umgestürzte Rüstung voller Pilze', 'Kinderzeichnungen an der Wand'],
};

const GEMS = { 10: ['Achat', 'Azurit', 'Blauquarz', 'Hämatit', 'Malachit', 'Obsidian', 'Türkis'], 50: ['Bergkristall', 'Chalcedon', 'Jaspis', 'Mondstein', 'Onyx', 'Karneol', 'Zirkon'], 100: ['Bernstein', 'Amethyst', 'Granat', 'Jade', 'Perle', 'Turmalin'], 500: ['Alexandrit', 'Aquamarin', 'Schwarze Perle', 'Topas'], 1000: ['Smaragd', 'Feueropal', 'Saphir', 'Rubin'] };
const ART = { 25: ['Silberkelch', 'geschnitzte Knochenstatuette', 'kleines Goldarmband', 'Seidentaschentuch mit Wappen'], 250: ['Goldring mit Blutsteinen', 'Elfenbeinstatue', 'Wandteppich mit Jagdszene', 'Messingmaske mit Jade'], 750: ['Silberkrone mit Mondsteinen', 'goldene Götzenfigur', 'Gemälde eines alten Meisters'], 2500: ['Juwelenbesetzte Goldkrone', 'Platinarmreif mit Saphir'] };
const CONSUMABLES = ['Heiltrank (2d4+2)', 'Großer Heiltrank (4d4+4)', 'Schriftrolle: Magisches Geschoss', 'Schriftrolle: Schild', 'Trank der Kletterei', 'Gegengift', 'Alchemistenfeuer', 'Trank des Wasseratmens', 'Schriftrolle: Identifizieren', 'Trank der Unsichtbarkeit (selten)'];

export function lootFor(cr) {
  const n = Number(cr) || 0;
  const lines = [];
  if (n <= 4) {
    lines.push(`${roll('5d6').total} cp`, `${roll('4d6').total} sp`, `${roll('3d6').total} gp`);
  } else if (n <= 10) {
    lines.push(`${roll('4d6').total * 10} sp`, `${roll('2d6').total * 10} gp`, `${roll('1d6').total} pp`);
  } else if (n <= 16) {
    lines.push(`${roll('4d6').total * 10} gp`, `${roll('1d6').total * 10} pp`);
  } else {
    lines.push(`${roll('2d6').total * 100} gp`, `${roll('2d6').total * 10} pp`);
  }
  const tier = n <= 4 ? [10, 50] : n <= 10 ? [50, 100] : n <= 16 ? [100, 500] : [500, 1000];
  const g = pick(tier);
  const gc = randInt(1, n <= 4 ? 3 : 6);
  lines.push(`${gc} × ${pick(GEMS[g])} (je ${g} gp)`);
  if (randInt(1, 2) === 1) {
    const a = n <= 4 ? 25 : n <= 10 ? 250 : n <= 16 ? 750 : 2500;
    lines.push(`${pick(ART[a])} (${a} gp)`);
  }
  if (randInt(1, 3) > 1) lines.push(pick(CONSUMABLES));
  return lines;
}

export function weather(climate = 'gemäßigt', season = 'Frühling') {
  const temps = {
    gemäßigt: { Frühling: ['kühl', 'mild', 'frisch'], Sommer: ['warm', 'heiß', 'schwül'], Herbst: ['kühl', 'neblig-kalt', 'mild'], Winter: ['eisig', 'frostig', 'kalt'] },
    nordisch: { Frühling: ['kalt', 'frostig', 'kühl'], Sommer: ['mild', 'kühl', 'warm'], Herbst: ['kalt', 'eisig', 'frostig'], Winter: ['bitterkalt', 'klirrend kalt', 'eisig'] },
    tropisch: { Frühling: ['heiß', 'schwül', 'warm'], Sommer: ['drückend heiß', 'schwül', 'heiß'], Herbst: ['warm', 'schwül', 'heiß'], Winter: ['warm', 'mild', 'schwül'] },
    wüste: { Frühling: ['heiß', 'warm'], Sommer: ['glühend heiß', 'sengend'], Herbst: ['heiß', 'warm'], Winter: ['tagsüber warm, nachts eisig'] },
  };
  const t = pick((temps[climate] || temps.gemäßigt)[season] || ['mild']);
  const sky = pick(['wolkenlos', 'leicht bewölkt', 'bedeckt', 'dunstig', 'bleigrau', 'wechselhaft']);
  const wind = pick(['windstill', 'leichte Brise', 'böig', 'kräftiger Wind', 'Sturmböen']);
  const precip = climate === 'wüste' ? pick(['trocken', 'trocken', 'Staubwirbel']) : season === 'Winter' && climate !== 'tropisch' ? pick(['trocken', 'leichter Schneefall', 'dichter Schneefall', 'Graupel']) : pick(['trocken', 'trocken', 'Nieselregen', 'Regenschauer', 'Gewitter', 'Nebel am Morgen']);
  const special = randInt(1, 8) === 1 ? pick(['Polarlichter in der Nacht', 'ein seltsamer Farbschimmer am Horizont', 'Sternschnuppenregen', 'unnatürliche Stille', 'warmer Wind aus dem Nichts']) : null;
  return `${cap(t)}, ${sky}, ${wind}, ${precip}${special ? ` – ${special}` : ''}.`;
}

export function npcQuick(species = pick(SPECIES_NAMES), gender = pick(['m', 'w'])) {
  return {
    name: randomName(species, gender),
    species,
    gender,
    job: pick(['Schmied', 'Wirtin', 'Stadtwache', 'Händler', 'Priesterin', 'Bettler', 'Adliger', 'Schreiber', 'Fischer', 'Kräuterfrau', 'Söldner', 'Barde', 'Alchemistin', 'Stallknecht', 'Kartenmacher', 'Diebin']),
    look: pick(LOOKS),
    quirk: pick(QUIRKS),
    motive: pick(MOTIVES),
    secret: pick(SECRETS),
  };
}
