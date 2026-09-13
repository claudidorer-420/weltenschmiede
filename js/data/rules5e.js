// D&D-5e-Daten: Tabellen, Begriffe (dt.), Encounter-Rechner, Regel-Kurzreferenz (eigene Formulierungen).

export const ABILITIES = [
  { key: 'str', short: 'STÄ', name: 'Stärke' },
  { key: 'dex', short: 'GES', name: 'Geschicklichkeit' },
  { key: 'con', short: 'KON', name: 'Konstitution' },
  { key: 'int', short: 'INT', name: 'Intelligenz' },
  { key: 'wis', short: 'WEI', name: 'Weisheit' },
  { key: 'cha', short: 'CHA', name: 'Charisma' },
];

export const SKILLS = [
  { key: 'acrobatics', name: 'Akrobatik', ability: 'dex' },
  { key: 'arcana', name: 'Arkane Kunde', ability: 'int' },
  { key: 'athletics', name: 'Athletik', ability: 'str' },
  { key: 'performance', name: 'Auftreten', ability: 'cha' },
  { key: 'intimidation', name: 'Einschüchtern', ability: 'cha' },
  { key: 'sleight', name: 'Fingerfertigkeit', ability: 'dex' },
  { key: 'history', name: 'Geschichte', ability: 'int' },
  { key: 'medicine', name: 'Heilkunde', ability: 'wis' },
  { key: 'stealth', name: 'Heimlichkeit', ability: 'dex' },
  { key: 'animal', name: 'Mit Tieren umgehen', ability: 'wis' },
  { key: 'insight', name: 'Motiv erkennen', ability: 'wis' },
  { key: 'investigation', name: 'Nachforschungen', ability: 'int' },
  { key: 'nature', name: 'Naturkunde', ability: 'int' },
  { key: 'religion', name: 'Religion', ability: 'int' },
  { key: 'deception', name: 'Täuschen', ability: 'cha' },
  { key: 'survival', name: 'Überlebenskunst', ability: 'wis' },
  { key: 'persuasion', name: 'Überzeugen', ability: 'cha' },
  { key: 'perception', name: 'Wahrnehmung', ability: 'wis' },
];

export const CLASSES = [
  { name: 'Barbar', hd: 12, saves: ['str', 'con'], cast: null },
  { name: 'Barde', hd: 8, saves: ['dex', 'cha'], cast: 'cha' },
  { name: 'Druide', hd: 8, saves: ['int', 'wis'], cast: 'wis' },
  { name: 'Hexenmeister', hd: 8, saves: ['wis', 'cha'], cast: 'cha' },
  { name: 'Kämpfer', hd: 10, saves: ['str', 'con'], cast: null },
  { name: 'Kleriker', hd: 8, saves: ['wis', 'cha'], cast: 'wis' },
  { name: 'Magier', hd: 6, saves: ['int', 'wis'], cast: 'int' },
  { name: 'Magieschmied', hd: 8, saves: ['con', 'int'], cast: 'int' },
  { name: 'Mönch', hd: 8, saves: ['str', 'dex'], cast: null },
  { name: 'Paladin', hd: 10, saves: ['wis', 'cha'], cast: 'cha' },
  { name: 'Schurke', hd: 8, saves: ['dex', 'int'], cast: null },
  { name: 'Waldläufer', hd: 10, saves: ['str', 'dex'], cast: 'wis' },
  { name: 'Zauberer', hd: 6, saves: ['con', 'cha'], cast: 'cha' },
];

export const SPECIES = ['Mensch', 'Elf', 'Hochelf', 'Waldelf', 'Dunkelelf', 'Zwerg', 'Hügelzwerg', 'Bergzwerg', 'Halbling', 'Gnom', 'Halbelf', 'Halbork', 'Ork', 'Tiefling', 'Drachenblütiger', 'Aasimar', 'Goliath', 'Tabaxi', 'Firbolg', 'Genasi', 'Kenku', 'Echsenvolk', 'Tritone', 'Goblin', 'Kobold', 'Warforged', 'Changeling'];

export const ALIGNMENTS = ['rechtschaffen gut', 'neutral gut', 'chaotisch gut', 'rechtschaffen neutral', 'neutral', 'chaotisch neutral', 'rechtschaffen böse', 'neutral böse', 'chaotisch böse', 'gesinnungslos'];
export const SIZES = ['Winzig', 'Klein', 'Mittelgroß', 'Groß', 'Riesig', 'Gigantisch'];
export const CREATURE_TYPES = ['Aberration', 'Bestie', 'Celestisches Wesen', 'Drache', 'Elementar', 'Feenwesen', 'Unhold', 'Riese', 'Humanoide', 'Konstrukt', 'Monstrosität', 'Schlick', 'Pflanze', 'Untoter'];
export const DAMAGE_TYPES = ['Hieb', 'Stich', 'Wucht', 'Feuer', 'Kälte', 'Blitz', 'Donner', 'Gift', 'Säure', 'Nekrotisch', 'Gleißend', 'Energie', 'Psychisch'];

export const CR_LIST = ['0', '1/8', '1/4', '1/2', ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
const CR_XP = {
  '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
  11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000,
  21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000,
};

export function normCR(cr) {
  const s = String(cr ?? '').trim().replace(',', '.').replace(/^HG\s*/i, '');
  if (s === '0.125') return '1/8';
  if (s === '0.25') return '1/4';
  if (s === '0.5') return '1/2';
  const m = /^(\d+\/\d+|\d+)/.exec(s);
  return m ? m[1] : '';
}
export function crToNumber(cr) {
  const s = normCR(cr);
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    return a / b;
  }
  return Number(s) || 0;
}
export function crXp(cr) {
  const s = normCR(cr);
  return CR_XP[s] ?? CR_XP[Number(s)] ?? 0;
}
export function pbForCR(cr) {
  const n = crToNumber(cr);
  return n < 5 ? 2 : Math.min(9, 2 + Math.ceil((n - 4) / 4));
}
export function pbForLevel(level) {
  return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
}

// DMG 2014: Leicht / Mittel / Schwer / Tödlich pro Charakter
const THRESH_2014 = {
  1: [25, 50, 75, 100], 2: [50, 100, 150, 200], 3: [75, 150, 225, 400], 4: [125, 250, 375, 500], 5: [250, 500, 750, 1100],
  6: [300, 600, 900, 1400], 7: [350, 750, 1100, 1700], 8: [450, 900, 1400, 2100], 9: [550, 1100, 1600, 2400], 10: [600, 1200, 1900, 2800],
  11: [800, 1600, 2400, 3600], 12: [1000, 2000, 3000, 4500], 13: [1100, 2200, 3400, 5100], 14: [1250, 2500, 3800, 5700], 15: [1400, 2800, 4300, 6400],
  16: [1600, 3200, 4800, 7200], 17: [2000, 3900, 5900, 8800], 18: [2100, 4200, 6300, 9500], 19: [2400, 4900, 7300, 10900], 20: [2800, 5700, 8500, 12700],
};
// DMG 2024: Niedrig / Moderat / Hoch pro Charakter
const BUDGET_2024 = {
  1: [50, 75, 100], 2: [100, 150, 200], 3: [150, 225, 400], 4: [250, 375, 500], 5: [500, 750, 1100],
  6: [600, 1000, 1400], 7: [750, 1300, 1700], 8: [1000, 1700, 2100], 9: [1300, 2000, 2600], 10: [1600, 2300, 3100],
  11: [1900, 2900, 4100], 12: [2200, 3700, 4700], 13: [2600, 4200, 5400], 14: [2900, 4900, 6200], 15: [3300, 5400, 7800],
  16: [3800, 6100, 9800], 17: [4500, 7200, 11700], 18: [5000, 8700, 14200], 19: [5500, 10700, 17200], 20: [6400, 13200, 22000],
};
const MULTS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function difficultyLabel(score) {
  if (score <= 2) return 'Spaziergang';
  if (score <= 3.5) return 'Leicht';
  if (score <= 5) return 'Mittel';
  if (score <= 6.5) return 'Fordernd';
  if (score <= 8) return 'Hart';
  if (score <= 9) return 'Tödlich';
  return 'Sicherer Tod';
}

/** levels: [5,5,4,6]  monsters: [{cr:'1/2', qty:3}] */
export function calcEncounter({ levels = [], monsters = [], version = '2014' }) {
  const party = levels.map((l) => Math.max(1, Math.min(20, Number(l) || 1)));
  const count = monsters.reduce((a, m) => a + (Number(m.qty) || 1), 0);
  const totalXp = monsters.reduce((a, m) => a + (Number(m.xp) || crXp(m.cr)) * (Number(m.qty) || 1), 0);
  if (!party.length || !count) return null;
  if (version === '2024') {
    const b = party.reduce((acc, l) => acc.map((v, i) => v + BUDGET_2024[l][i]), [0, 0, 0]);
    const [lo, mo, hi] = b;
    const x = totalXp;
    let score;
    if (x < lo) score = lerp(1, 3, x / lo);
    else if (x < mo) score = lerp(3, 5, (x - lo) / (mo - lo));
    else if (x < hi) score = lerp(5, 7, (x - mo) / (hi - mo));
    else if (x < hi * 1.5) score = lerp(7, 8.5, (x - hi) / (hi * 0.5));
    else if (x < hi * 2.5) score = lerp(8.5, 10, (x - hi * 1.5) / hi);
    else score = 10;
    const band = x < lo ? 'unter Niedrig' : x < mo ? 'Niedrig' : x < hi ? 'Moderat' : 'Hoch' + (x > hi * 1.5 ? '+' : '');
    return { version, totalXp, adjustedXp: totalXp, count, thresholds: { Niedrig: lo, Moderat: mo, Hoch: hi }, band, score: Math.round(score * 10) / 10, label: difficultyLabel(score) };
  }
  let idx = count === 1 ? 1 : count === 2 ? 2 : count <= 6 ? 3 : count <= 10 ? 4 : count <= 14 ? 5 : 6;
  if (party.length < 3) idx++;
  else if (party.length >= 6) idx--;
  const mult = MULTS[Math.max(0, Math.min(MULTS.length - 1, idx))];
  const t = party.reduce((acc, l) => acc.map((v, i) => v + THRESH_2014[l][i]), [0, 0, 0, 0]);
  const [E, M, H, D] = t;
  const a = totalXp * mult;
  let score;
  if (a < E) score = lerp(1, 2, a / E);
  else if (a < M) score = lerp(2, 4, (a - E) / (M - E));
  else if (a < H) score = lerp(4, 6, (a - M) / (H - M));
  else if (a < D) score = lerp(6, 8, (a - H) / (D - H));
  else if (a < D * 1.5) score = lerp(8, 9, (a - D) / (D * 0.5));
  else if (a < D * 2.5) score = lerp(9, 10, (a - D * 1.5) / D);
  else score = 10;
  const band = a < E ? 'Trivial' : a < M ? 'Leicht' : a < H ? 'Mittel' : a < D ? 'Schwer' : 'Tödlich';
  return { version, totalXp, adjustedXp: Math.round(a), multiplier: mult, count, thresholds: { Leicht: E, Mittel: M, Schwer: H, Tödlich: D }, band, score: Math.round(score * 10) / 10, label: difficultyLabel(score) };
}

export const CONDITIONS = [
  { name: 'Blind', en: 'Blinded', icon: 'eye-off', desc: 'Sieht nichts; Proben, die Sicht erfordern, scheitern automatisch. Angriffe gegen die Kreatur haben Vorteil, ihre eigenen Angriffe Nachteil.' },
  { name: 'Bezaubert', en: 'Charmed', icon: 'heart', desc: 'Kann den Bezauberer weder angreifen noch mit schädlichen Effekten belegen. Der Bezauberer hat Vorteil bei sozialen Proben gegen sie.' },
  { name: 'Taub', en: 'Deafened', icon: 'volume', desc: 'Hört nichts; Proben, die Gehör erfordern, scheitern automatisch.' },
  { name: 'Erschöpft', en: 'Exhaustion', icon: 'hourglass', desc: '2014: 6 Stufen – 1: Nachteil auf Attributswürfe · 2: Bewegung halbiert · 3: Nachteil auf Angriffe & Rettungswürfe · 4: TP-Maximum halbiert · 5: Bewegung 0 · 6: Tod. 2024: je Stufe −2 auf alle W20-Würfe und −1,5 m Bewegung; Stufe 6 = Tod. Eine lange Rast senkt um 1 Stufe.' },
  { name: 'Verängstigt', en: 'Frightened', icon: 'alert', desc: 'Nachteil auf Attributswürfe und Angriffe, solange die Quelle der Angst sichtbar ist; kann sich nicht freiwillig auf sie zubewegen.' },
  { name: 'Gepackt', en: 'Grappled', icon: 'hand', desc: 'Bewegungsrate 0. Endet, wenn der Packende kampfunfähig wird oder die Kreatur aus seiner Reichweite gelangt. (2024 zusätzlich: Nachteil bei Angriffen gegen andere als den Packenden.)' },
  { name: 'Kampfunfähig', en: 'Incapacitated', icon: 'x', desc: 'Keine Aktionen und Reaktionen. (2024 zusätzlich: keine Bonusaktionen, Konzentration endet, kann nicht sprechen, Nachteil auf Initiative.)' },
  { name: 'Unsichtbar', en: 'Invisible', icon: 'ghost', desc: 'Ohne Magie oder besondere Sinne nicht zu sehen (stark verborgen). Angriffe gegen sie haben Nachteil, ihre Angriffe Vorteil.' },
  { name: 'Gelähmt', en: 'Paralyzed', icon: 'zap', desc: 'Kampfunfähig, kann sich nicht bewegen oder sprechen. STÄ- und GES-Rettungswürfe scheitern. Angriffe gegen sie haben Vorteil; Treffer aus 1,5 m sind kritisch.' },
  { name: 'Versteinert', en: 'Petrified', icon: 'mountain', desc: 'Samt nichtmagischer Ausrüstung zu Stein verwandelt, altert nicht. Kampfunfähig, bewegungsunfähig, nimmt nichts wahr. Angriffe gegen sie haben Vorteil, STÄ/GES-Rettungswürfe scheitern, Resistenz gegen allen Schaden, immun gegen Gift & Krankheit.' },
  { name: 'Vergiftet', en: 'Poisoned', icon: 'flame', desc: 'Nachteil auf Angriffs- und Attributswürfe.' },
  { name: 'Liegend', en: 'Prone', icon: 'arrow-down', desc: 'Kann nur kriechen oder aufstehen (kostet die Hälfte der Bewegung). Nachteil auf Angriffe. Angriffe gegen sie aus 1,5 m haben Vorteil, aus größerer Entfernung Nachteil.' },
  { name: 'Festgesetzt', en: 'Restrained', icon: 'lock', desc: 'Bewegungsrate 0. Angriffe gegen sie haben Vorteil, ihre Angriffe Nachteil; Nachteil auf GES-Rettungswürfe.' },
  { name: 'Betäubt', en: 'Stunned', icon: 'activity', desc: 'Kampfunfähig, bewegungsunfähig, spricht nur stockend. STÄ- und GES-Rettungswürfe scheitern. Angriffe gegen sie haben Vorteil.' },
  { name: 'Bewusstlos', en: 'Unconscious', icon: 'moon', desc: 'Kampfunfähig, bewegungsunfähig, nimmt nichts wahr, lässt alles fallen und fällt liegend hin. STÄ/GES-Rettungswürfe scheitern, Angriffe gegen sie haben Vorteil; Treffer aus 1,5 m sind kritisch.' },
];

export const EXTRA_MARKERS = ['Konzentration', 'Segen', 'Fluch', 'Hast', 'Verlangsamt', 'Brennend', 'Blutend', 'Versteckt', 'Markiert', 'Inspiriert'];

export const RULES = [
  {
    id: 'aktionen', title: 'Aktionen im Kampf', icon: 'swords', body: `
- **Angriff** – ein Waffen- oder waffenloser Angriff (mehr mit „Extra-Angriff“).
- **Zauber wirken** – Zauber mit Zeitaufwand „1 Aktion“ (2024: Aktion **Magie**, auch für magische Gegenstände).
- **Spurt** – zusätzliche Bewegung in Höhe der Bewegungsrate.
- **Rückzug** – Bewegung provoziert in diesem Zug keine Gelegenheitsangriffe.
- **Ausweichen** – Angriffe gegen dich haben Nachteil, Vorteil auf GES-Rettungswürfe (bis zum nächsten Zug).
- **Helfen** – ein Verbündeter erhält Vorteil auf seine nächste Probe oder seinen nächsten Angriff.
- **Verstecken** – Heimlichkeitsprobe (2024: SG 15, danach „Unsichtbar“, solange du verborgen bleibst).
- **Vorbereiten** – eine Aktion mit Auslöser festlegen, wird als Reaktion ausgeführt.
- **Suchen / Studieren** – Wahrnehmung, Nachforschungen, Wissensproben.
- **Gegenstand benutzen / Beeinflussen** – Objekt einsetzen bzw. (2024) soziale Einflussnahme.

**Außerdem pro Zug:** Bewegung (aufteilbar), eine **Bonusaktion** (nur wenn eine Fähigkeit sie gewährt), eine freie Objekt-Interaktion, eine **Reaktion** pro Runde (z. B. Gelegenheitsangriff).` },
  {
    id: 'deckung', title: 'Deckung', icon: 'shield', body: `
| Deckung | Wirkung |
|---|---|
| Halbe Deckung | +2 auf RK und GES-Rettungswürfe |
| Dreiviertel-Deckung | +5 auf RK und GES-Rettungswürfe |
| Volle Deckung | Kann nicht direkt als Ziel gewählt werden |` },
  {
    id: 'sg', title: 'Schwierigkeitsgrade (SG)', icon: 'target', body: `
| Aufgabe | SG |
|---|---|
| Sehr leicht | 5 |
| Leicht | 10 |
| Mittel | 15 |
| Schwer | 20 |
| Sehr schwer | 25 |
| Nahezu unmöglich | 30 |

**Passive Werte:** 10 + alle Modifikatoren (+5 bei Vorteil, −5 bei Nachteil).` },
  {
    id: 'rast', title: 'Rasten', icon: 'moon', body: `
- **Kurze Rast** (mind. 1 Stunde): Trefferwürfel ausgeben – je Würfel W + KON-Modifikator TP zurück.
- **Lange Rast** (8 Stunden, max. 2 Std. leichte Tätigkeit): alle TP zurück, Trefferwürfel bis zur Hälfte des Maximums zurück (2024: alle). Nur eine lange Rast pro 24 Stunden.` },
  {
    id: 'tod', title: 'Todesrettungswürfe', icon: 'skull', body: `
- Bei **0 TP** zu Beginn jedes eigenen Zuges: W20, **SG 10**.
- **3 Erfolge** → stabil · **3 Fehlschläge** → tot.
- **Natürliche 20** → sofort 1 TP · **Natürliche 1** → zählt als 2 Fehlschläge.
- Schaden bei 0 TP = 1 Fehlschlag (kritischer Treffer = 2).
- Übersteigt der Restschaden das TP-Maximum → **sofortiger Tod**.
- Stabilisieren: Heilkunde SG 10 oder Heilerausrüstung.` },
  {
    id: 'konzentration', title: 'Konzentration', icon: 'target', body: `
- Nur **ein** Konzentrationszauber gleichzeitig.
- Bei Schaden: **KON-Rettungswurf**, SG 10 oder halber Schaden (der höhere Wert; 2024: max. SG 30).
- Endet bei Kampfunfähigkeit, Tod oder wenn du sie freiwillig beendest.` },
  {
    id: 'reise', title: 'Reisetempo', icon: 'footprints', body: `
| Tempo | pro Minute | pro Stunde | pro Tag | Effekt |
|---|---|---|---|---|
| Schnell | 120 m | 6 km | 45 km | −5 auf passive Wahrnehmung |
| Normal | 90 m | 4,5 km | 36 km | – |
| Langsam | 60 m | 3 km | 27 km | Heimlich reisen möglich |

Gewaltmarsch: nach 8 Stunden je weitere Stunde KON-Rettungswurf (SG 10 + 1 pro Stunde), sonst 1 Stufe Erschöpfung.` },
  {
    id: 'sicht', title: 'Licht & Sicht', icon: 'sun', body: `
- **Hell** – normale Sicht.
- **Dämmrig / leicht verschleiert** – Nachteil auf Wahrnehmung (Sicht).
- **Dunkel / stark verschleiert** – effektiv *blind*.
- **Dunkelsicht** – Dunkelheit zählt wie Dämmerlicht (nur Graustufen).
- **Blindsicht / Wahrer Blick** – nehmen Umgebung ohne Sicht wahr bzw. sehen durch Illusionen.` },
  {
    id: 'umwelt', title: 'Stürze, Ersticken & Schaden', icon: 'mountain', body: `
- **Sturz:** 1W6 Wuchtschaden pro 3 m, max. 20W6; man landet liegend.
- **Luft anhalten:** 1 + KON-Mod Minuten (mind. 30 Sek.); danach KON-Mod Runden (mind. 1), dann 0 TP.
- **Improvisierter Schaden:** 1W10 (Kratzer an Feuerfalle) · 2W10 (Steinschlag) · 4W10 (Einsturz, Säurebecken) · 10W10 (Lava, zermalmende Wände) · 18W10 (untertauchen in Lava) · 24W10 (Kern eines Vulkans).` },
  {
    id: 'muenzen', title: 'Münzen & Lebensstil', icon: 'coins', body: `
| Münze | Wert |
|---|---|
| 1 Platin (pp / PM) | 10 gp |
| 1 Gold (gp / GM) | 10 sp = 100 cp |
| 1 Elektrum (ep / EM) | 5 sp |
| 1 Silber (sp / SM) | 10 cp |
| 1 Kupfer (cp / KM) | – |

| Lebensstil / Tag | Kosten |
|---|---|
| Elend | – |
| Ärmlich | 1 sp |
| Arm | 2 sp |
| Bescheiden | 1 gp |
| Komfortabel | 2 gp |
| Wohlhabend | 4 gp |
| Aristokratisch | ab 10 gp |

**Gasthaus (pro Nacht):** ärmlich 1 sp · bescheiden 5 sp · komfortabel 8 sp · wohlhabend 2 gp. **Krug Bier** 4 cp · **Krug Wein** 2 sp · **Mahlzeit** 6 cp – 8 sp.` },
  {
    id: 'preise', title: 'Ausrüstung (Richtpreise)', icon: 'backpack', body: `
| Gegenstand | Preis |
|---|---|
| Fackel | 1 cp |
| Rationen (1 Tag) | 5 sp |
| Hanfseil (15 m) | 1 gp |
| Brecheisen | 2 gp |
| Zelt (2 Personen) | 2 gp |
| Heilerausrüstung | 5 gp |
| Laterne (Blendlaterne) | 10 gp |
| Kletterausrüstung | 25 gp |
| Diebeswerkzeug | 25 gp |
| Heiltrank (2W4+2) | 50 gp |
| Reitpferd | 75 gp |
| Dolch / Kurzschwert / Langschwert | 2 / 10 / 15 gp |
| Langbogen / 20 Pfeile | 50 gp / 1 gp |
| Kettenhemd / Plattenrüstung / Schild | 50 / 1.500 / 10 gp |

**Magische Gegenstände (Richtwert):** gewöhnlich 50–100 gp · ungewöhnlich 101–500 gp · selten 501–5.000 gp · sehr selten 5.001–50.000 gp · legendär ab 50.001 gp.` },
  {
    id: 'erfahrung', title: 'Stufenaufstieg (EP)', icon: 'star', body: `
| Stufe | EP | Übungsbonus |
|---|---|---|
| 1 | 0 | +2 |
| 2 | 300 | +2 |
| 3 | 900 | +2 |
| 4 | 2.700 | +2 |
| 5 | 6.500 | +3 |
| 6 | 14.000 | +3 |
| 7 | 23.000 | +3 |
| 8 | 34.000 | +3 |
| 9 | 48.000 | +4 |
| 10 | 64.000 | +4 |
| 11 | 85.000 | +4 |
| 12 | 100.000 | +4 |
| 13 | 120.000 | +5 |
| 14 | 140.000 | +5 |
| 15 | 165.000 | +5 |
| 16 | 195.000 | +5 |
| 17 | 225.000 | +6 |
| 18 | 265.000 | +6 |
| 19 | 305.000 | +6 |
| 20 | 355.000 | +6 |` },
];

export const XP_LEVELS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

export const SRD_ATTRIBUTION = 'Enthält Material aus dem System Reference Document 5.1 („SRD 5.1“) von Wizards of the Coast LLC, lizenziert unter CC-BY-4.0 (creativecommons.org/licenses/by/4.0).';
