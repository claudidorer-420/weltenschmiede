// Kampfwirkung aller Zauber (SRD 5.1 / 5.2.1): wie ein Zauber im Kampf gewirkt wird, was er bewirkt und wie weit er
// automatisiert ist. Angriff, Rettungswurf, Schaden, Fläche und Heilung kommen aus der Zauberdatenbank; hier stehen
// Ergänzungen (Ziele, Strahlen, Zustände, Effekte, Zonen, Reaktionen) und alles ohne Kampfwirkung.
// Schlüssel = englischer Name; e14/e24 überschreiben je Regelwerk.
//
// use:  attack | save | auto | heal | temp | buff | debuff | mark | smite | zone | move | reaction | special | summon | none
// t:    enemy | ally | creature | self | multi | point      n/up: Anzahl Ziele (+ je Grad über dem Zaubergrad)
// cond: Zustand bei misslungenem Rettungswurf bzw. Treffer  { n, dur, save: 'end', endOnDamage, saveOnDamage }
// eff:  Effekt(e) auf Ziel(e) { k, name, data, dur, self }   dur: 'conc' | Runden | 'srcNextStart' | 'srcNextEnd' | 'tgtNextStart' | 'tgtNextEnd'
// zone: bleibende Fläche { trig: ['start','enter','end'], obscure, difficult, follow, who, perCell, adjacent }
// grant: Aktion, die der Zauber für seine Dauer verleiht (Waffe des Glaubens, Mondstrahl bewegen …)

const N = (note = '') => ({ use: 'none', note });
const SUM = (note = '') => ({ use: 'summon', part: true, note: note || 'Beschwörung: Setze die Kreatur über „Monster platzieren“ auf die Karte – sie wird wie ein Kämpfer geführt.' });
const ALL_DMG = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];

export const SPELLFX = {
  // ── Zaubertricks ──
  'Acid Splash': { e14: { use: 'save', t: 'multi', n: 2, near: 1.5 } },
  'Chill Touch': { eff: { k: 'noHeal', name: 'Kalte Hand: keine Heilung', dur: 'srcNextEnd', onHit: true }, e14: { eff: { k: 'noHeal', name: 'Kalte Hand: keine Heilung', dur: 'srcNextStart', onHit: true } } },
  'Dancing Lights': N(), Druidcraft: N(), Elementalism: N(), Light: N(), 'Mage Hand': N(), Mending: N(), Message: N(), Prestidigitation: N(), Thaumaturgy: N(),
  'Minor Illusion': N('Illusion – die SL entscheidet, wie sie im Kampf wirkt.'),
  Guidance: N('+W4 auf einen Attributswurf – wirkt auf Proben, nicht auf Angriffe oder Rettungswürfe.'),
  'Eldritch Blast': { use: 'attack', attack: 'ranged', rays: 'eb', dmg: [['1d10', 'force']] },
  'Ray of Frost': { eff: { k: 'speedAdd', name: 'Frostige Kälte (−3 m)', data: { m: -3 }, dur: 'srcNextStart', onHit: true } },
  'Produce Flame': { use: 'attack', attack: 'ranged', range: 18, e14: { range: 9 } },
  Resistance: {
    use: 'buff', t: 'ally',
    e14: { eff: { k: 'saveDie', name: 'Widerstand (+W4 auf einen Rettungswurf)', data: { sides: 4 }, dur: 'conc' } },
    e24: { choice: ['acid', 'bludgeoning', 'cold', 'fire', 'lightning', 'necrotic', 'piercing', 'poison', 'radiant', 'slashing', 'thunder'], eff: { k: 'reduceDamage', name: 'Widerstand (−W4 Schaden)', data: { dice: '1d4', byChoice: true }, dur: 'conc' } },
  },
  'Sacred Flame': { ignoreCover: true },
  Shillelagh: { use: 'buff', t: 'self', eff: { k: 'shillelagh', name: 'Shillelagh', dur: 10 } },
  'Shocking Grasp': { eff: { k: 'noReactions', name: 'Schockgriff: keine Reaktionen', dur: 'tgtNextStart', onHit: true } },
  'Sorcerous Burst': { use: 'attack', attack: 'ranged', choice: ['acid', 'cold', 'fire', 'lightning', 'poison', 'psychic', 'thunder'], dmgChar: '1d8' },
  'Spare the Dying': { use: 'special', t: 'creature', special: 'stabilize' },
  'Starry Wisp': { eff: { k: 'noInvis', name: 'Sternenfunke', dur: 'srcNextEnd', onHit: true } },
  'True Strike': {
    e14: { use: 'buff', t: 'enemy', eff: { k: 'advNext', self: true, name: 'Zielsicherer Schlag', dur: 'srcNextEnd', targetLink: true } },
    e24: { use: 'special', t: 'enemy', special: 'trueStrike', note: 'Waffenangriff mit deinem Zauberattribut; ab Stufe 5 zusätzlicher gleißender Schaden.' },
  },
  'Vicious Mockery': { eff: { k: 'disNext', name: 'Bösartiger Spott', dur: 'tgtNextEnd', onFail: true } },

  // ── 1. Grad ──
  Alarm: N(), 'Comprehend Languages': N(), 'Create or Destroy Water': N(), 'Detect Evil and Good': N(), 'Detect Magic': N(), 'Detect Poison and Disease': N(),
  'Disguise Self': N(), 'Find Familiar': N('Ritual mit 1 Stunde Wirkzeit.'), 'Floating Disk': N(), Goodberry: N('Beeren vorab erschaffen – Essen (Bonusaktion) heilt 1 TP.'),
  Identify: N(), 'Illusory Script': N(), Jump: N('Sprungweite – auf dem Raster ohne Wirkung.'), 'Purify Food and Drink': N(), 'Speak with Animals': N(), 'Unseen Servant': N(),
  'Feather Fall': N('Reaktion beim Fallen – auf der Kampfkarte ohne Wirkung.'), 'Silent Image': N('Illusion – die SL entscheidet, wie sie im Kampf wirkt.'),
  'Animal Friendship': { use: 'debuff', t: 'enemy', up: 1, save: 'wis', cond: { n: 'Bezaubert', dur: 'long' }, only: /tier|beast/i, note: 'Nur Tiere (INT 3 oder weniger).' },
  Bane: { use: 'debuff', t: 'multi', n: 3, up: 1, save: 'cha', eff: { k: 'bane', name: 'Fluch (−W4)', dur: 'conc' } },
  Bless: { use: 'buff', t: 'multi', n: 3, up: 1, ally: true, eff: { k: 'bless', name: 'Segen (+W4)', dur: 'conc' } },
  'Charm Person': { use: 'debuff', t: 'multi', n: 1, up: 1, save: 'wis', cond: { n: 'Bezaubert', dur: 'long', endOnDamage: true, bySrc: true }, only: /humanoid/i, note: 'Nur Humanoide; endet, wenn du oder Verbündete dem Ziel schaden.' },
  'Chromatic Orb': { use: 'attack', attack: 'ranged', choice: ['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder'], dmg: [['3d8', 'choice']], dmgUp: '1d8' },
  'Color Spray': {
    e14: { use: 'special', special: 'hpPool', pool: '6d10', poolUp: '2d10', cond: { n: 'Blind', dur: 'srcNextEnd' } },
    e24: { use: 'save', save: 'con', cond: { n: 'Blind', dur: 'srcNextEnd' } },
  },
  Command: { use: 'debuff', t: 'multi', n: 1, up: 1, save: 'wis', special: 'command' },
  'Dissonant Whispers': { use: 'save', t: 'enemy', save: 'wis', half: true, dmg: [['3d6', 'psychic']], dmgUp: '1d6', special: 'flee' },
  'Divine Favor': { use: 'buff', t: 'self', eff: { k: 'onHit', name: 'Göttliche Gunst (+1W4 gleißend)', data: { dice: '1d4', type: 'radiant', weapon: true }, dur: 10 } },
  'Divine Smite': { use: 'smite', dmg: [['2d8', 'radiant']], dmgUp: '1d8', extraVs: 'unhold|fiend|untot|undead', extraDice: '1d8' },
  'Ensnaring Strike': { use: 'smite', smite: { save: 'str', cond: { n: 'Festgesetzt', dur: 'conc' }, dot: { dice: '1d6', type: 'piercing' } } },
  Entangle: { use: 'zone', save: 'str', cond: { n: 'Festgesetzt', dur: 'conc' }, zone: { difficult: true } },
  'Expeditious Retreat': { use: 'buff', t: 'self', eff: { k: 'bonusDash', name: 'Rückzug beschleunigen', dur: 'conc' }, special: 'dashNow' },
  'Faerie Fire': { eff: { k: 'advAgainst', name: 'Feenfeuer', dur: 'conc', onFail: true } },
  'False Life': { use: 'temp', t: 'self', temp: '2d4+4', tempUp: 5, e14: { temp: '1d4+4' } },
  'Fog Cloud': { use: 'zone', zone: { obscure: true, grow: 6 } },
  Grease: { use: 'zone', save: 'dex', cond: { n: 'Liegend' }, zone: { difficult: true, trig: ['enter', 'end'], save: 'dex', cond: 'Liegend', rounds: 10 } },
  'Guiding Bolt': { eff: { k: 'guided', name: 'Lenkendes Geschoss (Vorteil)', dur: 'srcNextEnd', onHit: true } },
  'Hellish Rebuke': { use: 'reaction', trigger: 'damaged', t: 'enemy', save: 'dex', half: true },
  Heroism: { use: 'buff', t: 'multi', n: 1, up: 1, ally: true, eff: { k: 'heroism', name: 'Heldenmut', data: { mod: true }, dur: 'conc' } },
  Hex: { use: 'mark', t: 'enemy', eff: { k: 'hex', name: 'Verhexen', data: { dice: '1d6', type: 'necrotic' }, dur: 'conc' } },
  'Hideous Laughter': { use: 'debuff', t: 'enemy', save: 'wis', cond: [{ n: 'Liegend' }, { n: 'Kampfunfähig', dur: 'conc', save: 'end', saveOnDamage: true }] },
  "Hunter's Mark": { use: 'mark', t: 'enemy', eff: { k: 'mark', name: 'Zeichen des Jägers', data: { dice: '1d6', type: 'force' }, dur: 'conc' }, e14: { eff: { k: 'mark', name: 'Zeichen des Jägers', data: { dice: '1d6', weapon: true }, dur: 'conc' } } },
  'Ice Knife': { use: 'attack', attack: 'ranged', dmg: [['1d10', 'piercing']], special: 'iceKnife' },
  'Inflict Wounds': { e24: { use: 'save', t: 'enemy', save: 'con', half: true, dmg: [['2d10', 'necrotic']], dmgUp: '1d10' } },
  Longstrider: { use: 'buff', t: 'multi', n: 1, up: 1, ally: true, eff: { k: 'speedAdd', name: 'Lange Schritte (+3 m)', data: { m: 3 }, dur: 600 } },
  'Mage Armor': { use: 'buff', t: 'ally', eff: { k: 'mageArmor', name: 'Magierrüstung', dur: 4800 } },
  'Magic Missile': { use: 'auto', darts: 3, dartUp: 1, dmg: [['1d4+1', 'force']] },
  'Protection from Evil and Good': { use: 'buff', t: 'ally', eff: { k: 'protEvil', name: 'Schutz vor Gut und Böse', dur: 'conc' } },
  'Ray of Sickness': { cond: { n: 'Vergiftet', dur: 'srcNextEnd', onHit: true } },
  Sanctuary: { use: 'buff', t: 'ally', eff: { k: 'sanctuary', name: 'Heiligtum', dur: 10 } },
  'Searing Smite': { use: 'smite', dmg: [['1d6', 'fire']], dmgUp: '1d6', smite: { dotStart: { dice: '1d6', type: 'fire', save: 'con' } }, e14: { use: 'none', note: '2014 nicht im SRD.' } },
  Shield: { use: 'reaction', trigger: 'hit', t: 'self' },
  'Shield of Faith': { use: 'buff', t: 'ally', eff: { k: 'ac', name: 'Schild des Glaubens (+2 RK)', data: { bonus: 2 }, dur: 'conc' } },
  Sleep: {
    e14: { use: 'special', special: 'hpPool', pool: '5d8', poolUp: '2d8', cond: { n: 'Bewusstlos', dur: 10, endOnDamage: true } },
    e24: { use: 'save', save: 'wis', special: 'sleep24' },
  },
  Thunderwave: { push: 3 },

  // ── 2. Grad ──
  'Alter Self': N('Gestaltwandel – natürliche Waffen trägt die SL als Angriff ein.'), 'Animal Messenger': N(), 'Arcane Lock': N(), "Arcanist's Magic Aura": N(), Augury: N(),
  'Continual Flame': N(), Darkvision: N(), 'Detect Thoughts': N(), Enthrall: N(), 'Find Steed': N(), 'Find Traps': N(), 'Gentle Repose': N(), Knock: N(),
  'Locate Animals or Plants': N(), 'Locate Object': N(), 'Magic Mouth': N(), 'Pass without Trace': N(), 'Pass Without Trace': N(), 'Prayer of Healing': N('10 Minuten Wirkzeit – außerhalb des Kampfes.'),
  'Rope Trick': N(), 'Spider Climb': N('Klettern – auf dem Raster ohne Wirkung.'), 'Zone of Truth': N(),
  'Acid Arrow': { special: 'acidArrow', dot: { dice: '2d4', type: 'acid' } },
  Aid: { use: 'buff', t: 'multi', n: 3, ally: true, eff: { k: 'aid', name: 'Beistand', data: { hp: 5, hpUp: 5 }, dur: 4800 } },
  Barkskin: { use: 'buff', t: 'ally', eff: { k: 'acMin', name: 'Rindenhaut (RK 17)', data: { value: 17 }, dur: 600 }, e14: { eff: { k: 'acMin', name: 'Rindenhaut (RK 16)', data: { value: 16 }, dur: 'conc' } } },
  'Blindness/Deafness': { use: 'debuff', t: 'multi', n: 1, up: 1, save: 'con', condChoice: ['Blind', 'Taub'], cond: { n: 'Blind', dur: 10, save: 'end' } },
  Blur: { use: 'buff', t: 'self', eff: { k: 'blur', name: 'Verschwimmen', dur: 'conc' } },
  'Branding Smite': { use: 'smite', dmg: [['2d6', 'radiant']], dmgUp: '1d6', smite: { eff: { k: 'noInvis', name: 'Brandmal', dur: 'conc' } } },
  'Calm Emotions': { use: 'special', t: 'point', special: 'calm', part: true, note: 'Beendet „Bezaubert“ und „Verängstigt“ bei Kreaturen im Bereich (Rettungswurf für Unwillige).' },
  Darkness: { use: 'zone', zone: { obscure: true } },
  "Dragon's Breath": { use: 'buff', t: 'ally', choice: ['acid', 'cold', 'fire', 'lightning', 'poison'], grant: { name: 'Drachenodem', cost: 'action', area: { shape: 'cone', size: 4.5 }, save: 'dex', half: true, dice: '3d6', upDice: '1d6', type: 'choice' } },
  'Enhance Ability': { e14: { use: 'temp', t: 'ally', temp: '2d6', note: 'Bärenausdauer: 2W6 temporäre TP (andere Optionen wirken auf Proben).' }, e24: N('Vorteil auf Attributswürfe – wirkt auf Proben.') },
  'Enlarge/Reduce': { use: 'debuff', t: 'creature', save: 'con', special: 'enlarge' },
  'Flame Blade': { use: 'buff', t: 'self', grant: { name: 'Flammenklinge', cost: 'action', attack: 'melee', dice: '3d6', type: 'fire', upDice: '1d6', mod24: true } },
  'Flaming Sphere': { use: 'zone', zone: { size: 1.5, trig: ['end'], adjacent: true, save: 'dex', half: true, dmg: [['2d6', 'fire']], who: 'all' }, grant: { name: 'Flammenkugel rammen', cost: 'bonus', moveZone: 9 } },
  'Gust of Wind': { use: 'save', save: 'str', push: 4.5, part: true, note: 'Stößt Kreaturen in der Linie 4,5 m weg; die Windwirkung in späteren Runden bleibt der SL.' },
  'Heat Metal': { use: 'special', t: 'enemy', special: 'heatMetal', dmg: [['2d8', 'fire']], dmgUp: '1d8', grant: { name: 'Glühendes Metall', cost: 'bonus', dice: '2d8', type: 'fire', repeat: true } },
  'Hold Person': { use: 'debuff', t: 'multi', n: 1, up: 1, save: 'wis', cond: { n: 'Gelähmt', dur: 'conc', save: 'end' }, only: /humanoid/i },
  Invisibility: { use: 'buff', t: 'multi', n: 1, up: 1, ally: true, cond: { n: 'Unsichtbar', dur: 'conc', breakOnAttack: true } },
  'Lesser Restoration': { use: 'special', t: 'ally', special: 'cure', cures: ['Blind', 'Taub', 'Gelähmt', 'Vergiftet'] },
  Levitate: { use: 'debuff', t: 'creature', save: 'con', eff: { k: 'speedZero', name: 'Schweben (keine Bewegung)', dur: 'conc' }, part: true },
  'Magic Weapon': { use: 'buff', t: 'self', eff: { k: 'magicWeapon', name: 'Magische Waffe', data: { bonus: 1 }, dur: 600 }, e14: { eff: { k: 'magicWeapon', name: 'Magische Waffe', data: { bonus: 1 }, dur: 'conc' } } },
  'Mind Spike': { use: 'save', t: 'enemy', save: 'wis', half: true, dmg: [['3d8', 'psychic']], dmgUp: '1d8', eff: { k: 'noInvis', name: 'Gedankendorn', dur: 'conc', onFail: true } },
  'Mirror Image': { use: 'buff', t: 'self', eff: { k: 'mirror', name: 'Spiegelbilder (3)', data: { n: 3 }, dur: 10 } },
  'Misty Step': { use: 'move', tele: 9 },
  Moonbeam: { use: 'zone', zone: { trig: ['start', 'enter'], save: 'con', half: true }, grant: { name: 'Mondstrahl bewegen', cost: 'action', moveZone: 18 } },
  'Phantasmal Force': { use: 'debuff', t: 'enemy', save: 'int', eff: { k: 'phantasm', name: 'Trugbild (1W8 psychisch je Runde)', data: { dice: '1d8', type: 'psychic' }, dur: 'conc' }, part: true },
  'Protection from Poison': { use: 'special', t: 'ally', special: 'cure', cures: ['Vergiftet'], eff: { k: 'resist', name: 'Schutz vor Gift', data: { types: ['poison'] }, dur: 600 } },
  'Ray of Enfeeblement': {
    e14: { use: 'attack', attack: 'ranged', eff: { k: 'enfeebled', name: 'Schwächestrahl (halber Stärkeschaden)', dur: 'conc', onHit: true, save: { ab: 'con', at: 'end' } } },
    e24: { use: 'debuff', t: 'enemy', save: 'con', eff: { k: 'enfeebled', name: 'Schwächestrahl (Nachteil auf Stärke-Würfe)', dur: 'conc', onFail: true, save: { ab: 'con', at: 'end' } }, onSave: { k: 'disNext', name: 'Schwächestrahl (Nachteil auf den nächsten Angriff)', dur: 'srcNextStart' } },
  },
  'Scorching Ray': { use: 'attack', attack: 'ranged', rays: 3, raysUp: 1, dmg: [['2d6', 'fire']] },
  'See Invisibility': { use: 'buff', t: 'self', eff: { k: 'seeInvisible', name: 'Unsichtbares sehen', dur: 600 } },
  'Shining Smite': { use: 'smite', dmg: [['2d6', 'radiant']], dmgUp: '1d6', smite: { eff: { k: 'advAgainst', name: 'Strahlendes Niederstrecken', dur: 'conc' } } },
  Silence: { use: 'zone', zone: { silence: true } },
  'Spike Growth': { use: 'zone', zone: { difficult: true, perCell: { n: 2, d: 4, type: 'piercing' } } },
  'Spiritual Weapon': { use: 'summonAttack', attack: 'melee', dmg: [['1d8', 'force']], mod: true, grant: { name: 'Waffe des Glaubens', cost: 'bonus', attack: 'melee', dice: '1d8', type: 'force', mod: true, fromZone: 6 } },
  Suggestion: { use: 'debuff', t: 'enemy', save: 'wis', cond: { n: 'Bezaubert', dur: 'conc', endOnDamage: true }, part: true, note: 'Das Ziel folgt der Einflüsterung – die SL spielt sie aus.' },
  'Warding Bond': { use: 'buff', t: 'ally', eff: [{ k: 'wardingBond', name: 'Schutzbindung', dur: 600 }, { k: 'ac', name: 'Schutzbindung (+1 RK)', data: { bonus: 1 }, dur: 600, silent: true }, { k: 'resist', name: 'Schutzbindung (Resistenz)', data: { types: ALL_DMG }, dur: 600, silent: true }] },
  Web: { use: 'zone', save: 'dex', cond: { n: 'Festgesetzt', dur: 'conc' }, zone: { difficult: true, trig: ['enter', 'start'], save: 'dex', cond: 'Festgesetzt' } },

  // ── 3. Grad ──
  'Animate Dead': { use: 'summon', summon: { ids: ['skelett', 'zombie'], n: 1, nUp: 2, keep: true }, note: '1 Minute Wirkzeit – vor Kampfbeginn wirken.' }, Clairvoyance: N(), 'Create Food and Water': N(), Daylight: N('Hebt magische Dunkelheit bis Grad 3 auf (SL).'),
  'Glyph of Warding': N('1 Stunde Wirkzeit.'), 'Magic Circle': N('1 Minute Wirkzeit.'), 'Major Image': N('Illusion – die SL entscheidet, wie sie im Kampf wirkt.'),
  'Meld into Stone': N(), 'Meld Into Stone': N(), Nondetection: N(), 'Phantom Steed': N(), Sending: N(), 'Speak with Dead': N(), 'Speak with Plants': N(), 'Tiny Hut': N(),
  Tongues: N(), 'Water Breathing': N(), 'Water Walk': N(),
  'Beacon of Hope': { use: 'buff', t: 'multi', n: 6, ally: true, eff: { k: 'beacon', name: 'Leuchtfeuer der Hoffnung', dur: 'conc' } },
  'Bestow Curse': { use: 'debuff', t: 'enemy', save: 'wis', special: 'curse' },
  Blink: { use: 'buff', t: 'self', eff: { k: 'blink', name: 'Blinzeln', dur: 10 } },
  'Call Lightning': { use: 'special', t: 'point', special: 'callLightning', grant: { name: 'Blitz herabrufen', cost: 'action', area: { shape: 'cylinder', size: 1.5 }, save: 'dex', half: true, dice: '3d10', upDice: '1d10', type: 'lightning', range: 36 } },
  'Conjure Animals': { e14: { use: 'summon', summon: { types: ['Tier'], table: true, up: { 5: 2, 7: 3, 9: 4 } } }, e24: { use: 'zone', zone: { size: 3, shape: 'cube', trig: ['enter', 'end'], adjacent: true, save: 'dex', half: false, dmg: [['3d10', 'slashing']], who: 'enemies' }, part: true, note: 'Geisterrudel als Zone: Gegner in 3 m würfeln GES gegen 3W10 Hieb.' } },
  Counterspell: { use: 'reaction', trigger: 'cast', t: 'enemy' },
  'Dispel Magic': { use: 'special', t: 'creature', special: 'dispel' },
  Fear: { cond: { n: 'Verängstigt', dur: 'conc', save: 'end' } },
  Fly: { use: 'buff', t: 'multi', n: 1, up: 1, ally: true, eff: { k: 'fly', name: 'Fliegen', dur: 'conc' } },
  'Gaseous Form': { use: 'buff', t: 'ally', eff: [{ k: 'resist', name: 'Gasförmige Gestalt', data: { types: ['bludgeoning', 'piercing', 'slashing'], nonmagical: true }, dur: 'conc' }], part: true, note: 'Kann nicht angreifen oder zaubern (die SL achtet darauf).' },
  Haste: { use: 'buff', t: 'ally', eff: [{ k: 'haste', name: 'Hast', dur: 'conc' }, { k: 'ac', name: 'Hast (+2 RK)', data: { bonus: 2 }, dur: 'conc', silent: true }] },
  'Hypnotic Pattern': { cond: [{ n: 'Bezaubert', dur: 'conc', endOnDamage: true }, { n: 'Kampfunfähig', dur: 'conc', endOnDamage: true }], eff: { k: 'speedZero', name: 'Hypnotisiert', dur: 'conc', onFail: true, silent: true } },
  'Mass Healing Word': { use: 'heal', t: 'multi', n: 6, ally: true },
  'Plant Growth': { use: 'zone', zone: { difficult: true, heavy: true }, part: true, note: 'Nur die Wirkung „Überwucherung“ (Bewegung kostet vierfach).' },
  'Protection from Energy': { use: 'buff', t: 'ally', choice: ['acid', 'cold', 'fire', 'lightning', 'thunder'], eff: { k: 'resist', name: 'Schutz vor Energie', data: { byChoice: true }, dur: 'conc' } },
  'Protection From Energy': { use: 'buff', t: 'ally', choice: ['acid', 'cold', 'fire', 'lightning', 'thunder'], eff: { k: 'resist', name: 'Schutz vor Energie', data: { byChoice: true }, dur: 'conc' } },
  'Remove Curse': { use: 'special', t: 'ally', special: 'removeCurse' },
  Revivify: { use: 'special', t: 'creature', special: 'revive' },
  'Sleet Storm': { use: 'zone', zone: { obscure: true, difficult: true, trig: ['start', 'enter'], save: 'dex', cond: 'Liegend' } },
  Slow: { use: 'save', t: 'multi', n: 6, save: 'wis', eff: [{ k: 'slow', name: 'Verlangsamt', dur: 'conc', onFail: true, save: { ab: 'wis', at: 'end' } }, { k: 'ac', name: 'Verlangsamt (−2 RK)', data: { bonus: -2 }, dur: 'conc', onFail: true, silent: true }] },
  'Spirit Guardians': { use: 'zone', zone: { follow: true, who: 'enemies', trig: ['start', 'enter'], save: 'wis', half: true, difficultEnemies: true } },
  'Stinking Cloud': { use: 'zone', zone: { obscure: true, trig: ['start'], save: 'con', retch: true } },
  'Vampiric Touch': { use: 'attack', attack: 'melee', drain: 0.5, grant: { name: 'Vampirgriff', cost: 'action', attack: 'melee', dice: '3d6', upDice: '1d6', type: 'necrotic', drain: 0.5 } },
  'Wind Wall': { use: 'zone', zone: { line: true, len: 15 }, part: true, note: 'Stärke-Rettungswurf beim Erscheinen; dass Pfeile abgelenkt werden, entscheidet die SL.' },

  // ── 4. Grad ──
  'Arcane Eye': N(), 'Control Water': N(), Divination: N(), Fabricate: N(), 'Hallucinatory Terrain': N(), 'Locate Creature': N(), 'Private Sanctum': N(), 'Secret Chest': N(), 'Stone Shape': N(),
  'Aura of Life': { use: 'zone', zone: { follow: true, who: 'allies', auraResist: ['necrotic'], reviveAtStart: true }, part: true },
  Banishment: { use: 'debuff', t: 'multi', n: 1, up: 1, save: 'cha', cond: { n: 'Verbannt', dur: 'conc' } },
  'Black Tentacles': { use: 'zone', save: 'str', cond: { n: 'Festgesetzt', dur: 'conc' }, zone: { difficult: true, trig: ['start', 'enter'], save: 'str', cond: 'Festgesetzt', dmg: [['3d6', 'bludgeoning']] }, e14: { save: 'dex', zone: { difficult: true, trig: ['start', 'enter'], save: 'dex', cond: 'Festgesetzt', dmg: [['3d6', 'bludgeoning']] } } },
  'Charm Monster': { use: 'debuff', t: 'multi', n: 1, up: 1, save: 'wis', cond: { n: 'Bezaubert', dur: 600, endOnDamage: true, bySrc: true } },
  Compulsion: { cond: { n: 'Bezaubert', dur: 'conc' }, part: true, note: 'Betroffene bewegen sich in die Richtung, die du vorgibst (SL).' },
  Confusion: { cond: { n: 'Verwirrt', dur: 'conc', save: 'end' } },
  'Conjure Minor Elementals': { e14: { use: 'summon', summon: { types: ['Elementar'], table: true, up: { 6: 2, 8: 3 } } }, e24: { use: 'buff', t: 'self', choice: ['acid', 'cold', 'fire', 'lightning'], eff: { k: 'onHit', name: 'Schwache Elementare (+2W8)', data: { dice: '2d8', byChoice: true, within: 4.5 }, dur: 'conc' } } },
  'Conjure Woodland Beings': { e14: { use: 'summon', summon: { types: ['Feenwesen'], table: true, up: { 6: 2, 8: 3 } } }, e24: { use: 'zone', zone: { follow: true, size: 3, who: 'enemies', trig: ['enter', 'end'], save: 'wis', half: true, dmg: [['5d8', 'force']] } } },
  'Death Ward': { use: 'buff', t: 'ally', eff: { k: 'deathWard', name: 'Todesschutz', dur: 4800 } },
  'Dimension Door': { use: 'move', tele: 150 },
  'Dominate Beast': { use: 'debuff', t: 'enemy', save: 'wis', cond: { n: 'Bezaubert', dur: 'conc', saveOnDamage: true }, part: true, note: 'Beherrscht – die SL übergibt dir die Kreatur.' },
  'Faithful Hound': SUM('Wachhund: beißt Feinde in 1,5 m (4W8 Stich) – die SL führt ihn.'),
  'Fire Shield': { use: 'buff', t: 'self', choice: ['fire', 'cold'], eff: { k: 'fireShield', name: 'Feuerschild', data: { byChoice: true }, dur: 100 } },
  'Freedom of Movement': { use: 'buff', t: 'ally', eff: { k: 'immuneCond', name: 'Bewegungsfreiheit', data: { names: ['Festgesetzt', 'Gelähmt'] }, dur: 600 } },
  'Giant Insect': SUM(),
  'Greater Invisibility': { use: 'buff', t: 'ally', cond: { n: 'Unsichtbar', dur: 'conc' } },
  'Guardian of Faith': { use: 'zone', zone: { size: 3, who: 'enemies', trig: ['enter', 'start'], save: 'dex', half: true, dmg: [['20', 'radiant']] } },
  'Ice Storm': { dmg: [['2d8', 'bludgeoning'], ['4d6', 'cold']], dmgUp: '1d8' },
  'Phantasmal Killer': {
    e14: { use: 'debuff', t: 'enemy', save: 'wis', cond: { n: 'Verängstigt', dur: 'conc' }, eff: { k: 'nightmare', name: 'Tödliches Phantom', data: { dice: '4d10', type: 'psychic', upDice: '1d10' }, dur: 'conc', onFail: true, save: { ab: 'wis', at: 'end', dmgOnFail: true } } },
    e24: { use: 'save', t: 'enemy', save: 'wis', half: true, dmg: [['4d10', 'psychic']], dmgUp: '1d10', eff: { k: 'nightmare', name: 'Tödliches Phantom', data: { dice: '4d10', type: 'psychic', dis: true }, dur: 'conc', onFail: true, save: { ab: 'wis', at: 'end', dmgOnFail: true } } },
  },
  Polymorph: { use: 'special', t: 'creature', save: 'wis', special: 'polymorph', form: { types: ['Tier'] }, e24: { form: { types: ['Tier'], temp: true } } },
  'Resilient Sphere': { use: 'debuff', t: 'creature', save: 'dex', cond: { n: 'Eingeschlossen', dur: 'conc' } },
  Stoneskin: { use: 'buff', t: 'ally', eff: { k: 'resist', name: 'Steinhaut', data: { types: ['bludgeoning', 'piercing', 'slashing'] }, dur: 'conc' }, e14: { eff: { k: 'resist', name: 'Steinhaut', data: { types: ['bludgeoning', 'piercing', 'slashing'], nonmagical: true }, dur: 'conc' } } },
  'Vitriolic Sphere': { use: 'save', save: 'dex', half: true, area: { shape: 'sphere', size: 6 }, dmg: [['10d4', 'acid']], dmgUp: '2d4', eff: { k: 'dotEnd', name: 'Ätzkugel (Nachwirkung)', data: { dice: '5d4', type: 'acid' }, dur: 'tgtNextEnd', onFail: true } },
  'Wall of Fire': { use: 'zone', zone: { trig: ['end'], adjacent: true, dmg: [['5d8', 'fire']], line: true, len: 18, opaque: true }, save: 'dex', half: true, note: 'Undurchsichtige Linie; Schaden beim Erscheinen und am Zugende neben der Wand.' },

  // ── 5. Grad ──
  'Animate Objects': SUM(), Awaken: N(), Commune: N(), 'Commune with Nature': N(), 'Commune With Nature': N(), 'Contact Other Plane': N(), Creation: N(), Dream: N(), Geas: N(),
  Hallow: N(), 'Legend Lore': N(), 'Modify Memory': N(), Passwall: N(), 'Planar Binding': N(), 'Raise Dead': N(), Reincarnate: N(), Scrying: N(), Seeming: N(),
  'Telepathic Bond': N(), 'Teleportation Circle': N(), 'Tree Stride': N(),
  'Antilife Shell': { use: 'zone', zone: { follow: true, barrier: true }, part: true, note: 'Lebende Kreaturen kommen nicht hindurch – die SL achtet auf die Grenze.' },
  'Arcane Hand': { use: 'summonAttack', attack: 'melee', dmg: [['4d8', 'force']], grant: { name: 'Geballte Faust', cost: 'bonus', attack: 'melee', dice: '4d8', type: 'force', upDice: '2d8', fromZone: 18 }, part: true },
  Cloudkill: { use: 'zone', zone: { obscure: true, trig: ['start', 'enter'], save: 'con', half: true } },
  'Conjure Elemental': { e14: { use: 'summon', summon: { types: ['Elementar'], cr: 5, crUp: 1 } }, e24: SUM('2024: Elementargeist – die SL führt ihn.') },
  Contagion: {
    e14: { use: 'attack', attack: 'melee', cond: { n: 'Vergiftet', dur: 'long', onHit: true }, part: true },
    e24: { use: 'save', t: 'enemy', save: 'con', dmg: [['11d8', 'necrotic']], cond: { n: 'Vergiftet', dur: 'long' } },
  },
  'Dispel Evil and Good': { use: 'buff', t: 'self', eff: { k: 'protEvil', name: 'Böses und Gutes bannen', dur: 'conc' }, part: true },
  'Dominate Person': { use: 'debuff', t: 'enemy', save: 'wis', cond: { n: 'Bezaubert', dur: 'conc', saveOnDamage: true }, part: true, note: 'Beherrscht – die SL übergibt dir die Kreatur.' },
  'Greater Restoration': { use: 'special', t: 'ally', special: 'cure', cures: ['Bezaubert', 'Versteinert', 'Erschöpft'] },
  'Hold Monster': { use: 'debuff', t: 'multi', n: 1, up: 1, save: 'wis', cond: { n: 'Gelähmt', dur: 'conc', save: 'end' } },
  'Insect Plague': { use: 'zone', zone: { difficult: true, trig: ['start', 'enter'], save: 'con', half: true } },
  'Mass Cure Wounds': { use: 'heal', t: 'multi', n: 6, ally: true },
  Mislead: { use: 'buff', t: 'self', cond: { n: 'Unsichtbar', dur: 'conc' }, part: true },
  'Summon Dragon': SUM(),
  Telekinesis: { use: 'debuff', t: 'creature', save: 'str', cond: { n: 'Festgesetzt', dur: 'srcNextEnd' }, part: true, note: 'Verschieben um bis zu 9 m macht die SL (Token ziehen).' },
  'Wall of Force': { use: 'zone', zone: { barrier: true, line: true, len: 30 } }, 'Wall of Stone': { use: 'zone', zone: { barrier: true, opaque: true, line: true, len: 30 } },

  // ── 6. Grad ──
  'Blade Barrier': { use: 'zone', zone: { line: true, len: 30, trig: ['enter', 'start'], save: 'dex', half: true, difficult: true } },
  'Chain Lightning': { use: 'special', t: 'multi', n: 4, special: 'chain', save: 'dex', half: true },
  'Conjure Fey': { e14: { use: 'summon', summon: { types: ['Feenwesen', 'Tier'], cr: 6, crUp: 1 } }, e24: SUM('2024: Feengeist – die SL führt ihn.') }, Contingency: N(),
  'Create Undead': { use: 'summon', summon: { ids: ['ghul'], n: 3, nUp: 1, keep: true }, note: '1 Minute Wirkzeit – vor Kampfbeginn wirken.' }, 'Find the Path': N(), Forbiddance: N(), 'Guards and Wards': N(), 'Instant Summons': N(), 'Magic Jar': N(),
  'Mass Suggestion': { use: 'debuff', t: 'multi', n: 12, save: 'wis', cond: { n: 'Bezaubert', dur: 'long' }, part: true }, 'Move Earth': N(), 'Planar Ally': N(), 'Programmed Illusion': N(),
  'Transport via Plants': N(), 'True Seeing': { use: 'buff', t: 'ally', eff: { k: 'seeInvisible', name: 'Wahrer Blick', dur: 600 } }, 'Wind Walk': N(), 'Word of Recall': N(),
  Disintegrate: { use: 'save', t: 'enemy', save: 'dex', half: false, area: null, dmg: [['10d6+40', 'force']], dmgUp: '3d6', special: 'disintegrate' },
  Eyebite: { use: 'buff', t: 'self', grant: { name: 'Bannblick', cost: 'action', save: 'wis', condChoice: ['Bewusstlos', 'Verängstigt', 'Vergiftet'], range: 18 } },
  'Flesh to Stone': { use: 'debuff', t: 'enemy', save: 'con', cond: { n: 'Festgesetzt', dur: 'conc', save: 'end', fails: 0, onFails: { n: 3, name: 'Versteinert' } } },
  'Globe of Invulnerability': { use: 'zone', zone: { follow: true, globe: 5 }, part: true },
  Harm: { e14: { floorOne: true } },
  Heal: { use: 'heal', heal: { flat: 70, up: 10 }, cures: ['Blind', 'Taub'], e24: { cures: ['Blind', 'Taub', 'Vergiftet'] } },
  "Heroes' Feast": N('10 Minuten Wirkzeit.'),
  'Irresistible Dance': { use: 'debuff', t: 'enemy', cond: { n: 'Tanzend', dur: 'conc', save: 'end' }, e24: { save: 'wis' } },
  Sunbeam: { cond: { n: 'Blind', dur: 'tgtNextEnd' }, grant: { name: 'Sonnenstrahl', cost: 'action', area: { shape: 'line', size: 18, width: 1.5 }, save: 'con', half: true, dice: '6d8', type: 'radiant', cond: 'Blind' } },
  'Wall of Ice': { use: 'zone', zone: { line: true, barrier: true, len: 30 }, save: 'dex', half: true },
  'Wall of Thorns': { use: 'zone', half: true, zone: { line: true, len: 18, opaque: true, heavy: true, trig: ['enter', 'start'], save: 'dex', half: true, difficult: true } },

  // ── 7. Grad ──
  'Arcane Sword': { use: 'summonAttack', attack: 'melee', dmg: [['4d12', 'force']], mod: true, grant: { name: 'Arkanes Schwert', cost: 'bonus', attack: 'melee', dice: '4d12', type: 'force', mod: true, fromZone: 6 }, e14: { dmg: [['3d10', 'force']], grant: { name: 'Arkanes Schwert', cost: 'bonus', attack: 'melee', dice: '3d10', type: 'force', fromZone: 6 } } },
  'Conjure Celestial': { e14: { use: 'summon', summon: { types: ['celestisch'], cr: 4, crAt: { 9: 5 } } }, e24: { use: 'zone', zone: { trig: ['start', 'enter'], save: 'dex', half: true, dmg: [['6d12', 'radiant']], who: 'enemies' }, part: true, note: 'Nur das „Sengende Licht“; heilendes Licht wirkt die SL.' } },
  'Delayed Blast Fireball': { part: true, note: 'Explodiert sofort – das Aufladen über mehrere Runden simuliert die App nicht.' },
  'Divine Word': { use: 'special', t: 'multi', n: 12, special: 'divineWord', save: 'cha' },
  Etherealness: N(), 'Magnificent Mansion': N(), 'Mirage Arcane': N(), 'Project Image': N(), Resurrection: N(), Sequester: N(), Simulacrum: N(), Symbol: N(), Teleport: N(),
  'Finger of Death': { use: 'save', t: 'enemy', save: 'con', half: true, dmg: [['7d8+30', 'necrotic']] },
  'Fire Storm': { part: true, note: 'Eine zusammenhängende Fläche statt zehn einzelner Würfel.' },
  Forcecage: { use: 'debuff', t: 'creature', cond: { n: 'Eingeschlossen', dur: 'conc' }, part: true },
  'Plane Shift': { use: 'debuff', t: 'enemy', save: 'cha', cond: { n: 'Verbannt', dur: 'long' }, part: true },
  'Prismatic Spray': { use: 'special', special: 'prismatic' },
  Regenerate: { use: 'heal', t: 'ally', heal: { dice: '4d8+15' }, eff: { k: 'regen', name: 'Regeneration (+1 TP je Runde)', dur: 600 } },
  'Reverse Gravity': { use: 'zone', part: true, note: 'Die SL handelt Fallen und Festhalten ab.' },

  // ── 8. und 9. Grad ──
  'Animal Shapes': N(), 'Antimagic Field': { use: 'zone', zone: { follow: true, antimagic: true }, part: true }, 'Antipathy/Sympathy': N(), Clone: N(), 'Control Weather': N(), Demiplane: N(),
  Glibness: N(), 'Mind Blank': N(), Maze: { use: 'debuff', t: 'creature', cond: { n: 'Verbannt', dur: 'conc' }, part: true },
  Befuddlement: { eff: { k: 'noCast', name: 'Wirrnis (kann nicht zaubern)', dur: 'long', onFail: true } },
  Feeblemind: { eff: { k: 'noCast', name: 'Schwachsinn (kann nicht zaubern)', dur: 'long', onFail: true } },
  'Dominate Monster': { use: 'debuff', t: 'enemy', save: 'wis', cond: { n: 'Bezaubert', dur: 'conc', saveOnDamage: true }, part: true },
  Earthquake: { use: 'zone', zone: { difficult: true, trig: ['start'], save: 'dex', cond: 'Liegend' }, part: true },
  'Holy Aura': { use: 'buff', t: 'multi', n: 12, ally: true, eff: { k: 'holyAura', name: 'Heilige Aura', dur: 'conc' } },
  'Incendiary Cloud': { use: 'zone', zone: { obscure: true, trig: ['start', 'enter'], save: 'dex', half: true } },
  'Power Word Stun': { use: 'special', t: 'enemy', special: 'pwStun' },
  Sunburst: { cond: { n: 'Blind', dur: 10, save: 'end' } },
  Tsunami: { use: 'zone', part: true },
  'Astral Projection': N(), Foresight: { use: 'buff', t: 'ally', eff: { k: 'foresight', name: 'Voraussicht', dur: 4800 } }, Gate: N(), Imprisonment: N('1 Minute Wirkzeit.'),
  'Mass Heal': { use: 'special', t: 'multi', n: 12, special: 'massHeal' },
  'Meteor Swarm': { use: 'save', dmg: [['20d6', 'fire'], ['20d6', 'bludgeoning']], part: true, note: 'Eine Kugel pro Wirken – für vier Einschläge Fläche viermal setzen (nur ein Platz).' },
  'Power Word Heal': { use: 'special', t: 'ally', special: 'pwHeal' },
  'Power Word Kill': { use: 'special', t: 'enemy', special: 'pwKill' },
  'Prismatic Wall': { use: 'zone', zone: { barrier: true, opaque: true, line: true, len: 27 }, part: true },
  Shapechange: { use: 'special', t: 'self', special: 'polymorph', form: { self: true, not: 'Konstrukt|Untot' }, e24: { form: { self: true, not: 'Konstrukt|Untot', temp: true } } }, 'Storm of Vengeance': { use: 'zone', part: true },
  'Time Stop': { use: 'special', t: 'self', special: 'timeStop', part: true }, 'True Polymorph': { use: 'special', t: 'creature', save: 'wis', special: 'polymorph', form: {}, e24: { form: { temp: true } } }, 'True Resurrection': N(),
  Weird: { cond: { n: 'Verängstigt', dur: 'conc' }, eff: { k: 'nightmare', name: 'Unheimliches Schicksal', data: { dice: '4d10', type: 'psychic' }, dur: 'conc', onFail: true, save: { ab: 'wis', at: 'end', dmgOnFail: true } }, e24: { half: true } },
  Wish: N('Kann jeden Zauber bis zum 8. Grad nachahmen – über die SL.'),
};

const ROUNDS = [[/(\d+)\s*Runde/i, 1], [/(\d+)\s*Minute/i, 10], [/(\d+)\s*Stunde/i, 600], [/(\d+)\s*Tag/i, 14400]];
export function durationRounds(sp) {
  const d = String(sp?.duration || '');
  for (const [re, f] of ROUNDS) { const m = re.exec(d); if (m) return Number(m[1]) * f; }
  return /Minute/.test(d) ? 10 : /Stunde/.test(d) ? 600 : 0;
}

// Kampfwirkung eines Zaubers für ein Regelwerk (Daten + Ergänzungen)
export function specFor(sp, ed = '2014') {
  if (!sp) return null;
  const raw = SPELLFX[sp.en] || {};
  const e = ed === '2024' ? raw.e24 : raw.e14;
  const x = { ...raw, ...(e || {}) };
  delete x.e14;
  delete x.e24;
  let use = x.use;
  if (!use) {
    if (sp.attack) use = 'attack';
    else if (sp.save && (sp.damage || sp.area)) use = 'save';
    else if (sp.heal) use = 'heal';
    else if (sp.damage) use = sp.area ? 'save' : 'special';
    else use = 'none';
  }
  const area = x.area === null ? null : x.area || (use === 'zone' || use === 'save' || use === 'special' || use === 'heal' ? sp.area || null : null);
  const t = x.t || (sp.rangeKind === 'self' && !area ? 'self' : area && use !== 'heal' ? 'point' : use === 'heal' || use === 'buff' || use === 'temp' ? 'ally' : 'enemy');
  return {
    ...x, use, t, area, save: x.save || sp.save || null, attack: x.attack || (sp.attack === 'melee' ? 'melee' : sp.attack ? 'ranged' : null),
    half: x.half ?? (use === 'save' && /Hälfte|halb so viel|halben Schaden/i.test((sp.desc || []).join(' '))),
    conc: !!sp.conc, rounds: durationRounds(sp) || (sp.conc ? 10 : 0), range: x.range ?? (sp.rangeKind === 'touch' ? 1.5 : sp.rangeKind === 'self' ? 0 : sp.rangeKind === 'sight' || sp.rangeKind === 'unl' ? 999 : sp.rangeM || 0),
    sight: x.sight ?? (sp.rangeKind !== 'self' && sp.rangeKind !== 'touch'), cost: sp.action === 'long' ? 'long' : sp.action || 'action', combat: use !== 'none' && sp.action !== 'long',
  };
}
