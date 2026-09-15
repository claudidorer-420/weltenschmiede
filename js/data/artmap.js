// Bildzuordnung für Zauber, Gegenstände und Kreaturen – Symbole von game-icons.net (CC BY 3.0: Lorc, Delapouite
// und weitere, https://game-icons.net). tools/build-icons.mjs liest allIconNames() und erzeugt js/data/gameicons.js.

export const SCHOOL_ART = {
  abjuration: { name: 'Bannmagie', color: '#3f8cff', icon: 'magic-shield' },
  conjuration: { name: 'Beschwörung', color: '#f0a020', icon: 'magic-portal' },
  divination: { name: 'Erkenntnismagie', color: '#39c2d4', icon: 'crystal-ball' },
  enchantment: { name: 'Verzauberung', color: '#e0559a', icon: 'charm' },
  evocation: { name: 'Hervorrufung', color: '#ff5a36', icon: 'bolt-spell-cast' },
  illusion: { name: 'Illusion', color: '#9b6bff', icon: 'domino-mask' },
  necromancy: { name: 'Nekromantie', color: '#6fbf4a', icon: 'skull-crossed-bones' },
  transmutation: { name: 'Verwandlung', color: '#d6b13c', icon: 'crystal-growth' },
};

export const DAMAGE_ART = {
  acid: { name: 'Säure', color: '#9ad33b', icon: 'acid' },
  bludgeoning: { name: 'Wucht', color: '#b8a98f', icon: 'hammer-drop' },
  cold: { name: 'Kälte', color: '#7fd4ff', icon: 'snowflake-2' },
  fire: { name: 'Feuer', color: '#ff6a2a', icon: 'flame' },
  force: { name: 'Energie', color: '#c77dff', icon: 'magic-swirl' },
  lightning: { name: 'Blitz', color: '#5fa8ff', icon: 'lightning-arc' },
  necrotic: { name: 'Nekrotisch', color: '#79c95a', icon: 'death-skull' },
  piercing: { name: 'Stich', color: '#c9c2b5', icon: 'barbed-arrow' },
  poison: { name: 'Gift', color: '#58c46a', icon: 'poison-bottle' },
  psychic: { name: 'Psychisch', color: '#ff7ad9', icon: 'psychic-waves' },
  radiant: { name: 'Gleißend', color: '#ffd84a', icon: 'sunbeams' },
  slashing: { name: 'Hieb', color: '#dcd4c6', icon: 'claw-slashes' },
  thunder: { name: 'Schall', color: '#8fa3ff', icon: 'sonic-boom' },
};
// Deutsche Schadensbezeichnungen (Statblöcke, Waffen) → Schlüssel
export const DAMAGE_DE = {
  'säure': 'acid', wucht: 'bludgeoning', 'kälte': 'cold', feuer: 'fire', energie: 'force', kraft: 'force', blitz: 'lightning', nekrotisch: 'necrotic',
  stich: 'piercing', gift: 'poison', psychisch: 'psychic', 'gleißend': 'radiant', strahlung: 'radiant', hieb: 'slashing', schall: 'thunder', donner: 'thunder',
};

export const HEAL_ICON = 'healing';

// Zauber (Schlüssel = englische SRD-Kennung)
export const SPELL_ART = {
  'acid-splash': 'acid', 'acid-arrow': 'chemical-arrow', aid: 'heart-plus', alarm: 'ringing-bell', 'alter-self': 'duality-mask',
  'animal-friendship': 'paw-heart', 'animal-messenger': 'raven', 'animal-shapes': 'wolf-howl', 'animate-dead': 'raise-skeleton', 'animate-objects': 'magic-broom',
  'antilife-shell': 'bubble-field', 'antimagic-field': 'shield-disabled', 'antipathy-sympathy': 'opposite-hearts', 'arcane-eye': 'all-seeing-eye', 'arcane-hand': 'hand-of-god',
  'arcane-lock': 'padlock', 'arcane-sword': 'winged-sword', 'astral-projection': 'soul', augury: 'rolling-dices', bane: 'cursed-star', banishment: 'vortex',
  barkskin: 'oak-leaf', 'beacon-of-hope': 'sunbeams', 'bestow-curse': 'cursed-star', 'black-tentacles': 'thorny-tentacle', 'blade-barrier': 'sword-array',
  bless: 'spiked-halo', blight: 'death-juice', 'blindness-deafness': 'bleeding-eye', blink: 'teleport', blur: 'shadow-follower', 'burning-hands': 'fire-breath',
  'call-lightning': 'lightning-storm', 'calm-emotions': 'sleepy', 'chain-lightning': 'chain-lightning', 'charm-person': 'charm', 'charm-monster': 'charm',
  'chill-touch': 'skeletal-hand', 'chromatic-orb': 'unstable-orb', 'circle-of-death': 'death-zone', clairvoyance: 'all-seeing-eye', clone: 'two-shadows',
  cloudkill: 'poison-cloud', 'color-spray': 'rainbow-star', command: 'lightning-shout', commune: 'prayer', 'commune-with-nature': 'leaf-swirl',
  'comprehend-languages': 'open-book', compulsion: 'brain-tentacle', 'cone-of-cold': 'icicles-aura', confusion: 'brainstorm', 'conjure-animals': 'wolf-howl',
  'conjure-celestial': 'angel-wings', 'conjure-elemental': 'fire-silhouette', 'conjure-fey': 'fairy-wings', 'conjure-minor-elementals': 'spark-spirit',
  'conjure-woodland-beings': 'tree-face', 'contact-other-plane': 'third-eye', contagion: 'skull-with-syringe', contingency: 'hourglass', 'continual-flame': 'candle-light',
  'control-water': 'wave-crest', 'control-weather': 'tornado', counterspell: 'silenced', 'create-food-and-water': 'bowl-of-rice', 'create-or-destroy-water': 'water-splash',
  'create-undead': 'raise-zombie', creation: 'crystal-growth', 'cure-wounds': 'healing', 'dancing-lights': 'sparkles', darkness: 'evil-moon', darkvision: 'semi-closed-eye',
  daylight: 'sun', 'death-ward': 'heart-shield', 'delayed-blast-fireball': 'fire-bomb', demiplane: 'magic-gate', 'detect-evil-and-good': 'templar-eye',
  'detect-magic': 'crystal-eye', 'detect-poison-and-disease': 'poison-bottle', 'detect-thoughts': 'thought-bubble', 'dimension-door': 'magic-portal',
  'disguise-self': 'domino-mask', disintegrate: 'disintegrate', 'dispel-evil-and-good': 'templar-shield', 'dispel-magic': 'breaking-chain', divination: 'crystal-ball',
  'divine-favor': 'holy-symbol', 'divine-word': 'lightning-shout', 'dominate-beast': 'brain-tentacle', 'dominate-monster': 'brain-tentacle', 'dominate-person': 'brain-tentacle',
  dream: 'night-sleep', druidcraft: 'leaf-swirl', earthquake: 'earth-crack', 'eldritch-blast': 'warlock-eye', 'enhance-ability': 'biceps', 'enlarge-reduce': 'biceps',
  entangle: 'curling-vines', enthrall: 'drama-masks', etherealness: 'invisible-face', 'expeditious-retreat': 'sonic-shoes', eyebite: 'evil-eyes', fabricate: 'anvil',
  'faerie-fire': 'fairy-wings', 'faithful-hound': 'wolf-head', 'false-life': 'soul-vessel', fear: 'worried-eyes', 'feather-fall': 'feather', feeblemind: 'brain-leak',
  'find-familiar': 'owl', 'find-steed': 'horse-head', 'find-the-path': 'compass', 'find-traps': 'eye-target', 'finger-of-death': 'death-skull', 'fire-bolt': 'fire-ray',
  'fire-shield': 'fire-shield', 'fire-storm': 'wildfires', fireball: 'fireball', 'flame-blade': 'sparkling-sabre', 'flame-strike': 'fire-zone', 'flaming-sphere': 'fire-ring',
  'flesh-to-stone': 'stone-bust', 'floating-disk': 'metal-disc', fly: 'feathered-wing', 'fog-cloud': 'fog', forbiddance: 'templar-shield', forcecage: 'crystal-bars',
  foresight: 'third-eye', 'freedom-of-movement': 'winged-leg', 'gaseous-form': 'dust-cloud', gate: 'star-gate', geas: 'crossed-chains', 'gentle-repose': 'tombstone',
  'giant-insect': 'flying-beetle', glibness: 'chat-bubble', 'globe-of-invulnerability': 'bubble-field', 'glyph-of-warding': 'rune-stone', goodberry: 'berries-bowl',
  grease: 'oily-spiral', 'greater-invisibility': 'invisible-face', 'greater-restoration': 'health-increase', 'guardian-of-faith': 'angel-outfit',
  'guards-and-wards': 'locked-fortress', guidance: 'north-star-shuriken', 'guiding-bolt': 'sun-spear', 'gust-of-wind': 'wind-slap', hallow: 'holy-water',
  'hallucinatory-terrain': 'mirror-mirror', harm: 'broken-heart', haste: 'winged-leg', heal: 'heart-bottle', 'healing-word': 'heart-plus', 'heat-metal': 'melting-metal',
  'hellish-rebuke': 'fire-punch', 'heroes-feast': 'jeweled-chalice', heroism: 'crowned-heart', 'hideous-laughter': 'drama-masks', 'hold-monster': 'imprisoned',
  'hold-person': 'imprisoned', 'holy-aura': 'spiked-halo', 'hunters-mark': 'hunter-eyes', 'hypnotic-pattern': 'swirl-ring', 'ice-knife': 'ice-spear', 'ice-storm': 'snowing',
  identify: 'book-aura', 'illusory-script': 'scroll-quill', imprisonment: 'imprisoned', 'incendiary-cloud': 'fire-wave', 'inflict-wounds': 'bleeding-heart',
  'insect-plague': 'bee', invisibility: 'invisible', jump: 'jump-across', knock: 'unlocking', 'legend-lore': 'book-aura', 'lesser-restoration': 'health-normal',
  levitate: 'fluffy-wing', light: 'light-bulb', 'lightning-bolt': 'lightning-arc', 'locate-animals-or-plants': 'paw-heart', 'locate-creature': 'eye-target',
  'locate-object': 'compass', longstrider: 'wingfoot', 'mage-armor': 'layered-armor', 'mage-hand': 'magic-palm', 'magic-circle': 'cloud-ring', 'magic-jar': 'skull-in-jar',
  'magic-missile': 'missile-swarm', 'magic-mouth': 'sharp-lips', 'magic-weapon': 'shining-sword', 'major-image': 'mirror-mirror', 'mass-cure-wounds': 'health-increase',
  'mass-heal': 'heart-bottle', 'mass-healing-word': 'heart-plus', 'mass-suggestion': 'thought-bubble', maze: 'magic-gate', 'meld-into-stone': 'stone-block',
  mending: 'sewing-needle', message: 'chat-bubble', 'meteor-swarm': 'meteor-impact', 'mind-blank': 'brain-freeze', 'minor-illusion': 'magick-trick',
  'mirage-arcane': 'mirror-mirror', 'mirror-image': 'two-shadows', mislead: 'duality-mask', 'misty-step': 'fluffy-swirl', 'modify-memory': 'brain-dump', moonbeam: 'moon',
  'move-earth': 'earth-spit', nondetection: 'eye-shield', 'pass-without-trace': 'boot-prints', passwall: 'secret-door', 'phantasmal-killer': 'dread-skull',
  'phantom-steed': 'horse-head', 'planar-ally': 'angel-wings', 'planar-binding': 'crossed-chains', 'plane-shift': 'portal', 'plant-growth': 'growth',
  'poison-spray': 'poison-gas', polymorph: 'frog-prince', 'power-word-heal': 'healing-shield', 'power-word-kill': 'skull-crack', 'power-word-stun': 'knocked-out-stars',
  'prayer-of-healing': 'prayer', prestidigitation: 'magic-hat', 'prismatic-spray': 'rainbow-star', 'prismatic-wall': 'rainbow-star', 'private-sanctum': 'locked-fortress',
  'produce-flame': 'fluffy-flame', 'programmed-illusion': 'drama-masks', 'project-image': 'double-face-mask', 'protection-from-energy': 'energy-shield',
  'protection-from-evil-and-good': 'templar-shield', 'protection-from-poison': 'drink-me', 'purify-food-and-drink': 'water-flask', 'raise-dead': 'angel-wings',
  'ray-of-enfeeblement': 'sunken-eye', 'ray-of-frost': 'ice-bolt', 'ray-of-sickness': 'death-juice', regenerate: 'regeneration', reincarnate: 'butterfly',
  'remove-curse': 'breaking-chain', 'resilient-sphere': 'bubble-field', resistance: 'shield-reflect', resurrection: 'angel-wings', 'reverse-gravity': 'anticlockwise-rotation',
  revivify: 'heart-beats', 'rope-trick': 'rope-coil', 'sacred-flame': 'sun-priest', sanctuary: 'slumbering-sanctuary', 'scorching-ray': 'fire-dash', scrying: 'crystal-ball',
  'secret-chest': 'locked-chest', 'see-invisibility': 'sheikah-eye', seeming: 'duality-mask', sending: 'chat-bubble', sequester: 'locked-box', shapechange: 'frog-prince',
  shatter: 'shatter', shield: 'magic-shield', 'shield-of-faith': 'checked-shield', shillelagh: 'wood-club', 'shocking-grasp': 'lightning-helix', silence: 'silence',
  'silent-image': 'mirror-mirror', simulacrum: 'ice-golem', sleep: 'night-sleep', 'sleet-storm': 'snowing', slow: 'slow-blob', 'spare-the-dying': 'heart-inside',
  'speak-with-animals': 'paw-heart', 'speak-with-dead': 'tombstone', 'speak-with-plants': 'leaf-swirl', 'spider-climb': 'spider-web', 'spike-growth': 'thorny-vine',
  'spirit-guardians': 'ghost-ally', 'spiritual-weapon': 'winged-sword', 'stinking-cloud': 'poison-cloud', 'stone-shape': 'stone-crafting', stoneskin: 'stone-sphere',
  'storm-of-vengeance': 'lightning-storm', suggestion: 'thought-bubble', sunbeam: 'sunbeams', sunburst: 'sun', symbol: 'rune-stone', telekinesis: 'glowing-hands',
  'telepathic-bond': 'psychic-waves', teleport: 'teleport', 'teleportation-circle': 'magic-portal', thaumaturgy: 'star-swirl', thunderwave: 'sonic-boom',
  thunderclap: 'sonic-shout', 'time-stop': 'hourglass', 'tiny-hut': 'camping-tent', tongues: 'chat-bubble', 'transport-via-plants': 'tree-door', 'tree-stride': 'tree-door',
  'true-polymorph': 'frog-prince', 'true-resurrection': 'angel-wings', 'true-seeing': 'eye-target', 'true-strike': 'bullseye', tsunami: 'big-wave',
  'unseen-servant': 'invisible', 'vampiric-touch': 'evil-hand', 'vicious-mockery': 'sonic-screech', 'wall-of-fire': 'firewall', 'wall-of-force': 'energy-shield',
  'wall-of-ice': 'frozen-block', 'wall-of-stone': 'stone-wall', 'wall-of-thorns': 'thorn-helix', 'warding-bond': 'chained-heart', 'water-breathing': 'bubbles',
  'water-walk': 'wave-surfer', web: 'spider-web', weird: 'dread-skull', 'wind-walk': 'whirlwind', 'wind-wall': 'whirlwind', wish: 'magic-lamp', 'word-of-recall': 'magic-portal',
  'zone-of-truth': 'justice-star', elementalism: 'frostfire', 'sorcerous-burst': 'burst-blob', 'starry-wisp': 'falling-star', 'dragons-breath': 'fire-breath',
  'divine-smite': 'sword-slice', 'searing-smite': 'fire-punch', 'thunderous-smite': 'thunder-struck', 'wrathful-smite': 'worried-eyes', 'shining-smite': 'sun-spear',
  'blinding-smite': 'bleeding-eye', 'staggering-smite': 'knocked-out-stars', 'banishing-smite': 'vortex', 'arcane-vigor': 'heart-plus', 'aura-of-life': 'heart-beats',
  'aura-of-vitality': 'healing', 'aura-of-purity': 'holy-water', 'cordon-of-arrows': 'arrow-cluster', 'hail-of-thorns': 'thorn-helix', 'ensnaring-strike': 'curling-vines',
  'lightning-arrow': 'lightning-bow', 'conjure-barrage': 'arrow-cluster', 'conjure-volley': 'arrow-cluster', 'swift-quiver': 'quiver', 'hex': 'cursed-star',
  'armor-of-agathys': 'ice-shield', 'arms-of-hadar': 'thorny-tentacle', 'hunger-of-hadar': 'evil-moon', 'witch-bolt': 'lightning-tree', 'mind-sliver': 'brain',
  'toll-the-dead': 'ringing-bell', 'word-of-radiance': 'sunbeams', 'thorn-whip': 'vine-whip', 'friends': 'shaking-hands', 'blade-ward': 'shield-reflect',
  'summon-beast': 'wolf-howl', 'summon-fey': 'fairy-wings', 'summon-undead': 'raise-skeleton', 'summon-elemental': 'fire-silhouette', 'summon-celestial': 'angel-wings',
  'summon-construct': 'golem-head', 'summon-fiend': 'devil-mask', 'summon-dragon': 'dragon-head', 'summon-aberration': 'tentacles-skull', 'summon-draconic-spirit': 'dragon-head',
  'conjure-minor-elemental': 'spark-spirit', 'fount-of-moonlight': 'moon', 'power-word-fortify': 'heart-shield', 'jallarzis-storm-of-radiance': 'sunbeams',
  'tashas-bubbling-cauldron': 'cauldron', 'yolandes-regal-presence': 'crown', 'mordenkainens-sword': 'winged-sword', 'otilukes-freezing-sphere': 'frozen-orb',
  'freezing-sphere': 'frozen-orb', 'irresistible-dance': 'drama-masks', 'magnificent-mansion': 'locked-fortress', 'telepathy': 'psychic-waves', 'instant-summons': 'magic-portal',
  'grasping-vine': 'curling-vines', 'hallucinatory-terrain-2': 'mirror-mirror', 'dimensional-shackles': 'crossed-chains',
};

// Gegenstände: Waffen- und Rüstungsschlüssel aus chargen.js, sonst Stichwort-Regeln
export const WEAPON_ART = {
  knueppel: 'wood-club', dolch: 'plain-dagger', zweihandknueppel: 'spiked-bat', handbeil: 'hatchet', wurfspeer: 'thrown-spear', leichterhammer: 'flat-hammer',
  streitkolben: 'flanged-mace', kampfstab: 'crescent-staff', sichel: 'sickle', speer: 'barbed-spear', leichtearmbrust: 'crossbow', wurfpfeil: 'dart', kurzbogen: 'pocket-bow',
  schleuder: 'sling', streitaxt: 'battle-axe', flegel: 'flail', glefe: 'glaive', zweihandaxt: 'sharp-axe', zweihandschwert: 'two-handed-sword', hellebarde: 'halberd',
  lanze: 'spears', langschwert: 'broadsword', zweihandhammer: 'thor-hammer', morgenstern: 'spiked-mace', pike: 'sharp-halberd', rapier: 'piercing-sword',
  krummsaebel: 'croc-sword', kurzschwert: 'pointy-sword', dreizack: 'trident', kriegshammer: 'warhammer', kriegspicke: 'war-pick', peitsche: 'whip', blasrohr: 'dart',
  handarmbrust: 'crossbow', schwerearmbrust: 'crossbow', langbogen: 'bow-arrow', unbewaffnet: 'fist',
};
export const ARMOR_ART = {
  gepolstert: 'leather-armor', leder: 'leather-armor', beschlagen: 'leather-armor', fell: 'animal-hide', kettenhemd: 'chain-mail', schuppen: 'scale-mail',
  brustplatte: 'breastplate', halbplatte: 'chest-armor', ringpanzer: 'chain-mail', kettenpanzer: 'chain-mail', schienen: 'layered-armor', platte: 'black-knight-helm',
  schild: 'round-shield',
};
// [Muster, Symbol] – erstes Muster, das auf den Namen passt, gewinnt
export const ITEM_RULES = [
  [/heiltrank|trank der heilung|trank des heilens/i, 'health-potion'], [/zauberbuch/i, 'spell-book'], [/schriftrolle/i, 'scroll-unfurled'],
  [/alchemistenfeuer/i, 'fire-bottle'], [/weihwasser/i, 'holy-water'], [/gegengift/i, 'drink-me'], [/säure/i, 'acid-tube'], [/gift/i, 'poison-bottle'],
  [/trank|elixier|phiole|fläschchen|flasche/i, 'standing-potion'], [/rucksack/i, 'backpack'], [/seil/i, 'rope-coil'], [/fackel/i, 'torch'],
  [/blendlaterne|laterne/i, 'lantern'], [/lampe/i, 'old-lantern'], [/kerze/i, 'candle-light'], [/schlafsack|bettzeug|decke/i, 'sleeping-bag'], [/zelt/i, 'camping-tent'],
  [/ration|proviant|verpflegung/i, 'ham-shank'], [/brot/i, 'bread'], [/wasserschlauch|trinkschlauch/i, 'waterskin'], [/zunder/i, 'flint-spark'], [/öl\b|ölflasche/i, 'oil-can'],
  [/diebeswerkzeug|dietrich/i, 'lockpicks'], [/heilerausrüstung|verband/i, 'first-aid-kit'], [/kräuterkunde/i, 'bubbling-flask'], [/alchemist/i, 'fizzing-flask'],
  [/giftmischer/i, 'poison-bottle'], [/schmiede/i, 'anvil'], [/werkzeug|ausrüstung \(|kit\b/i, 'toolbox'],
  [/laute|harfe|leier|viola|dulcimer/i, 'harp'], [/flöte|schalmei/i, 'flute'], [/trommel/i, 'drum'], [/dudelsack/i, 'bagpipes'], [/horn/i, 'hunting-horn'],
  [/brechstange/i, 'crowbar'], [/enterhaken/i, 'harpoon-chain'], [/kletterhaken/i, 'coiled-nail'], [/hammer/i, 'claw-hammer'], [/krähenfüße/i, 'caltrops'],
  [/kugellager/i, 'spikeball'], [/handschellen|fesseln/i, 'handcuffs'], [/kette\b|ketten\b/i, 'crossed-chains'], [/spiegel/i, 'mirror-mirror'],
  [/kochgeschirr|essgeschirr|topf/i, 'cooking-pot'], [/truhe|kiste/i, 'chest'], [/schloss/i, 'padlock'], [/schlüssel/i, 'key'],
  [/heiliges symbol|reliquiar|amulett|emblem/i, 'holy-symbol'], [/komponentenbeutel/i, 'pouch-with-beads'], [/arkaner fokus \(kristall\)|kristall/i, 'crystal-wand'],
  [/arkaner fokus \(kugel\)|kugel/i, 'extraction-orb'], [/zauberstab|rute/i, 'fairy-wand'], [/druidenfokus|mistelzweig|totem/i, 'curled-leaf'], [/stab\b|stab\)/i, 'wizard-staff'],
  [/münze|goldstück/i, 'coins'], [/edelstein|juwel|diamant|rubin|smaragd|saphir|perle/i, 'gems'], [/ring\b/i, 'ring'], [/halskette|kette \(schmuck\)/i, 'necklace'],
  [/umhang|mantel|cape/i, 'cloak'], [/stiefel/i, 'boots'], [/panzerhandschuh/i, 'gauntlet'], [/handschuh/i, 'gloves'], [/helm/i, 'visored-helm'], [/gürtel/i, 'belt'],
  [/armschiene/i, 'bracers'], [/robe|gewand|kleidung|kostüm/i, 'robe'], [/hut\b/i, 'pointy-hat'], [/krone|diadem/i, 'crown'], [/tinte|feder/i, 'quill-ink'],
  [/papier|pergament/i, 'papers'], [/karte\b|landkarte/i, 'treasure-map'], [/kompass/i, 'compass'], [/fernrohr|lupe/i, 'telescope'], [/sanduhr/i, 'hourglass'],
  [/glocke|pfeife/i, 'ringing-bell'], [/seife/i, 'soap'], [/parfüm/i, 'perfume-bottle'], [/netz\b/i, 'fishing-net'], [/spitzhacke|schaufel/i, 'war-pick'],
  [/eimer/i, 'full-wood-bucket-handle'], [/fass/i, 'barrel'], [/köcher/i, 'quiver'], [/pfeile|pfeil\b/i, 'arrow-cluster'], [/bolzen|nadeln|kugeln/i, 'arrowhead'],
  [/sack|beutel/i, 'knapsack'], [/würfel/i, 'rolling-dices'], [/karten/i, 'card-random'], [/wein/i, 'wine-bottle'], [/bier|met\b/i, 'beer-stein'], [/buch|tagebuch/i, 'open-book'],
  [/pferd|pony|maultier|streitross/i, 'horse-head'], [/ausrüstung$/i, 'backpack'], [/schild/i, 'round-shield'],
];
// Magische Gegenstände: Typ bzw. Name
export const MAGIC_RULES = [
  [/^Zauberstab/i, 'fairy-wand'], [/^Stab/i, 'wizard-staff'], [/^Zepter/i, 'winged-scepter'], [/^Ring/i, 'power-ring'], [/^Trank/i, 'magic-potion'],
  [/^Schriftrolle/i, 'scroll-quill'], [/^Rüstung \(Schild/i, 'dragon-shield'], [/^Rüstung/i, 'heart-armor'], [/Pfeil|Geschoss/i, 'energy-arrow'],
  [/Bogen/i, 'lightning-bow'], [/Axt/i, 'magic-axe'], [/Hammer/i, 'thor-hammer'], [/Dreizack/i, 'magic-trident'], [/^Waffe/i, 'shining-sword'],
  [/Umhang|Mantel/i, 'wing-cloak'], [/Stiefel|Schuhe/i, 'leather-boot'], [/Handschuh/i, 'gauntlet'], [/Gürtel/i, 'belt'], [/Amulett|Talisman|Medaillon|Brosche|Skarabäus/i, 'gem-pendant'],
  [/Beutel|Tasche|Sack|Loch/i, 'swap-bag'], [/Helm|Stirnreif|Diadem|Krone/i, 'tiara'], [/Horn/i, 'hunting-horn'], [/Kugel|Ioun/i, 'extraction-orb'], [/Stein/i, 'rune-stone'],
  [/Figur|Statuette/i, 'stone-bust'], [/Lampe|Laterne/i, 'magic-lamp'], [/Besen|Teppich/i, 'magic-broom'], [/Spiegel/i, 'mirror-mirror'], [/Buch|Handbuch|Foliant/i, 'book-aura'],
  [/Kerze/i, 'candle-light'], [/Armschienen/i, 'bracers'], [/Karten/i, 'card-random'], [/Flasche|Karaffe|Krug/i, 'round-bottom-flask'], [/Brille|Linsen|Augen/i, 'crystal-eye'],
  [/Seil/i, 'rope-coil'], [/Fessel|Kette/i, 'crossed-chains'], [/Instrument|Harfe|Laute|Flöte|Pfeife/i, 'harp'],
];
export const MAGIC_DEFAULT = 'glowing-artifact';
export const RARITY_COLORS = {
  gewöhnlich: '#9aa0a6', ungewöhnlich: '#3fb950', selten: '#4d8dff', 'sehr selten': '#a371f7', legendär: '#f0883e', artefakt: '#e5534b',
};
export function rarityColor(r) {
  const t = String(r || '').toLowerCase();
  for (const k of ['artefakt', 'legendär', 'sehr selten', 'selten', 'ungewöhnlich', 'gewöhnlich']) if (t.includes(k) && !(k === 'selten' && t.includes('sehr selten'))) return RARITY_COLORS[k];
  return RARITY_COLORS.gewöhnlich;
}

// Kreaturen (deutsche Namen) – erstes Muster gewinnt
export const MONSTER_RULES = [
  [/wyvern/i, 'wyvern'], [/pseudodrache/i, 'dragonfly'], [/drachenschildkröte/i, 'sea-dragon'], [/drache|drachennestling|drachenveteran/i, 'dragon-head'],
  [/tarraske/i, 'spiked-dragon-head'], [/hobgoblin|goblin/i, 'goblin-head'], [/grottenschrat/i, 'troll'], [/^ork|\bork\b/i, 'orc-head'], [/oger|oni/i, 'ogre'], [/troll/i, 'troll'],
  [/ettin|zyklop/i, 'cyclops'], [/riese\b|riese$/i, 'giant'], [/skelett/i, 'skeleton'], [/zombie/i, 'shambling-zombie'], [/ghul|grul/i, 'raise-zombie'], [/mumie/i, 'mummy-head'],
  [/lich/i, 'crowned-skull'], [/vampir/i, 'vampire-dracula'], [/lamia|sukkubus|inkubus/i, 'female-vampire'],
  [/schreckgespenst|todesalb|schatten|gruftschrecken|^geist$|geisternaga/i, 'floating-ghost'], [/werwolf|wertiger|werbär|werratte|wereber/i, 'werewolf'],
  [/schreckenswolf|winterwolf|worg/i, 'direwolf'], [/wolf|dogge|hund/i, 'wolf-head'], [/eulenbär/i, 'bear-face'], [/eisbär/i, 'polar-bear'], [/bär/i, 'bear-head'],
  [/spinne|atterkopp|drinne/i, 'spider-alt'], [/naga|schlange/i, 'snake'], [/fledermaus/i, 'evil-bat'], [/ratte/i, 'rat'],
  [/teufelchen/i, 'imp'], [/quasit|dretch|lemure/i, 'imp-laugh'], [/balor|vrock|glabrezu|hezrou|marilith|nalfeshnee|dämon/i, 'horned-skull'], [/teufel|erinnye/i, 'devil-mask'],
  [/deva|planetar|solar|couatl/i, 'angel-wings'], [/erdelementar|xorn|steingolem/i, 'rock-golem'], [/feuerelementar|salamander|magmin|ifriti|azer|magma-mephit/i, 'fire-silhouette'],
  [/wasserelementar/i, 'water-splash'], [/luftelementar|unsichtbarer pirscher/i, 'whirlwind'], [/mephit/i, 'imp'], [/eisengolem/i, 'metal-golem-head'],
  [/golem|homunkulus|schildwächter/i, 'golem-head'], [/gallertwürfel/i, 'transparent-slime'], [/schlick|blob|gallerte/i, 'slime'], [/mimik/i, 'mimic-chest'],
  [/kraken|oktopus/i, 'giant-squid'], [/einhorn/i, 'unicorn'], [/pegasus/i, 'pegasus'], [/greif/i, 'griffin-symbol'], [/pferd|pony|streitross|maultier|nachtmahr/i, 'horse-head'],
  [/roch|adler|falke/i, 'eagle-head'], [/eule/i, 'owl'], [/rabe/i, 'raven'], [/geier/i, 'vulture'], [/hydra/i, 'hydra'], [/minotaurus/i, 'minotaur'], [/zentaur/i, 'centaur'],
  [/harpyie/i, 'harpy'], [/medusa|gorgone/i, 'medusa-head'], [/gargyl/i, 'gargoyle'], [/basilisk|eidechse|echsenmensch|behir|krokodil/i, 'lizardman'],
  [/hai\b|hai$|killerwal/i, 'shark-jaws'], [/sahuagin|quipper/i, 'shark-fin'], [/seepferdchen/i, 'seahorse'], [/skorpion/i, 'scorpion'], [/käfer/i, 'scarab-beetle'],
  [/tausendfüßler/i, 'centipede'], [/pilz|kreischer/i, 'mushrooms'], [/baumhirte|erwachter baum|erwachter busch/i, 'ent-mouth'], [/dryade|drow/i, 'woman-elf-face'],
  [/sphinx/i, 'egyptian-sphinx'], [/chimäre|mantikor|löwe|rakshasa/i, 'lion'], [/kobold/i, 'bad-gnome'], [/gnoll|hyäne|schakal/i, 'wolf-howl'], [/frosch|kröte/i, 'frog'],
  [/eber/i, 'boar'], [/tiger|panther|katze/i, 'tiger-head'], [/affe|pavian/i, 'gorilla'], [/elefant|mammut/i, 'elephant-head'], [/nashorn|triceratops/i, 'triceratops-head'],
  [/tyrannosaurus|plesiosaurier/i, 't-rex-skull'], [/reh|elch|hirsch|ziege/i, 'deer-head'], [/krabbe/i, 'crab'], [/vettel/i, 'witch-face'],
  [/kultist|kultfanatiker|akolyth|priester/i, 'cultist'], [/bandit|schläger|spion/i, 'bandit'], [/berserker|stammeskrieger/i, 'barbarian'], [/wache/i, 'guards'],
  [/assassine/i, 'hooded-assassin'], [/erzmagier|magier|druide/i, 'wizard-face'], [/ritter|veteran|gladiator|belebte rüstung/i, 'black-knight-helm'],
  [/dschinni/i, 'djinn'], [/purpurwurm|remorhaz|ankheg|landhai/i, 'worm-mouth'], [/schwarm|wespe|blutmücke/i, 'bee'], [/meervolk/i, 'mermaid'],
  [/modernder schlurfer/i, 'shambling-mound'], [/otyugh|grick|aboleth|chuul|hundertmaul|seiler/i, 'tentacle-strike'], [/rostmonster/i, 'spiked-snail'],
  [/mantler|düstermantel|teppich/i, 'cape'], [/irrlicht/i, 'spark-spirit'], [/fliegendes schwert/i, 'winged-sword'], [/gnom|zwerg|duergar/i, 'dwarf-face'],
  [/adeliger|gemeiner|späher/i, 'cowled'], [/grimlock|troglodyt/i, 'troglodyte'], [/schreckhahn|axtschnabel/i, 'egyptian-bird'], [/satyr|feengeist/i, 'fairy-wings'],
];
// Kreaturentypen (deutsch und englisch) → Farbe und Standardsymbol
export const CREATURE_TYPES = [
  { re: /aberr/i, name: 'Aberration', color: '#8a4fff', icon: 'tentacles-skull' },
  { re: /schwarm|swarm/i, name: 'Schwarm', color: '#b08968', icon: 'bee' },
  { re: /tier|beast/i, name: 'Tier', color: '#7d9b3c', icon: 'wolf-head' },
  { re: /celest|himml/i, name: 'Celestisches Wesen', color: '#f2c14e', icon: 'angel-wings' },
  { re: /konstrukt|construct/i, name: 'Konstrukt', color: '#8d99ae', icon: 'golem-head' },
  { re: /drache|dragon/i, name: 'Drache', color: '#d7263d', icon: 'dragon-head' },
  { re: /element/i, name: 'Elementar', color: '#ff7b25', icon: 'fire-silhouette' },
  { re: /feen|fey/i, name: 'Feenwesen', color: '#3fbf8f', icon: 'fairy-wings' },
  { re: /unhold|fiend|dämon|teufel/i, name: 'Unhold', color: '#c0392b', icon: 'devil-mask' },
  { re: /riese|giant/i, name: 'Riese', color: '#a1887f', icon: 'giant' },
  { re: /humanoid/i, name: 'Humanoide', color: '#5d8aa8', icon: 'cowled' },
  { re: /monstros/i, name: 'Monstrosität', color: '#e76f51', icon: 'hydra' },
  { re: /schlick|ooze/i, name: 'Schlick', color: '#90be6d', icon: 'slime' },
  { re: /pflanze|plant/i, name: 'Pflanze', color: '#43aa8b', icon: 'carnivorous-plant' },
  { re: /untot|undead/i, name: 'Untoter', color: '#7f8c8d', icon: 'skull-crossed-bones' },
];
export const CREATURE_DEFAULT = { name: 'Kreatur', color: '#9b7b56', icon: 'beast-eye' };

// UI-Symbole, die zusätzlich gebraucht werden (Aktionen, Kampf, Inventar)
export const UI_ART = [
  'fist', 'running-shoe', 'dodging', 'shield-bash', 'hand', 'trade', 'hidden', 'magnifying-glass', 'hourglass', 'sprint', 'backup', 'overhead',
  'crossed-swords', 'bow-arrow', 'fire-spell-cast', 'coins', 'weight', 'swap-bag', 'strong', 'person', 'target-arrows', 'broken-shield', 'heart-plus',
  'skull-crossed-bones', 'crowned-skull', 'magic-swirl', 'star-swirl', 'shield', 'round-shield', 'walking-boot', 'wingfoot', 'backpack', 'knapsack',
];

export function allIconNames() {
  const out = new Set(UI_ART);
  for (const o of [SCHOOL_ART, DAMAGE_ART]) for (const v of Object.values(o)) out.add(v.icon);
  for (const o of [SPELL_ART, WEAPON_ART, ARMOR_ART]) for (const v of Object.values(o)) out.add(v);
  for (const list of [ITEM_RULES, MAGIC_RULES, MONSTER_RULES]) for (const [, v] of list) out.add(v);
  for (const t of CREATURE_TYPES) out.add(t.icon);
  out.add(HEAL_ICON);
  out.add(MAGIC_DEFAULT);
  out.add(CREATURE_DEFAULT.icon);
  return [...out];
}
