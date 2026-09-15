// Herkunftswelten für Monster – dieselben Kategorien im Encounter-Generator und im Bestiarium.
// Die Namenslisten (js/data/monsternames.js, generiert) werden erst bei Bedarf geladen.
export const DND = 'Standard D&D (5e)';
export const ORIGINS = [DND, 'The Witcher', 'Herr der Ringe', 'Elder Scrolls', 'Dark Souls / Elden Ring', 'Warhammer', 'Game of Thrones', 'Diablo', 'Final Fantasy', 'Eigene Kreation', 'Sonstiges'];
export const ORIGIN_COLORS = {
  [DND]: '#e0584a', 'The Witcher': '#c9a227', 'Herr der Ringe': '#7fae5a', 'Elder Scrolls': '#8aa4c8', 'Dark Souls / Elden Ring': '#d08a3a',
  Warhammer: '#b0413e', 'Game of Thrones': '#9fb7c9', Diablo: '#c0392b', 'Final Fantasy': '#5b8def', 'Eigene Kreation': '#b07cff', Sonstiges: '#8a8f98',
};
export const originShort = (o) => (o === DND ? 'D&D 5e' : o === 'Dark Souls / Elden Ring' ? 'Souls' : o || 'Ohne Welt');
export const hasNameList = (o) => !!o && o !== 'Eigene Kreation' && o !== 'Sonstiges';

// Welt eines gespeicherten Monsters (ältere Einträge ohne Angabe: SRD-Kopien zählen zu D&D)
export const originOf = (m) => m?.origin || (m?.srdId ? DND : '');

let namesMod = null;
let srdMod = null;
const loadNames = () => (namesMod ||= import('./monsternames.js').catch(() => ({ DND_NAMES: [], WORLD_NAMES: {} })));
const loadSrd = () => (srdMod ||= import('./monsters-srd.js'));

// Vorschläge für eine Welt: [{ name, meta, alt?, srd? }]
export async function namesFor(origin) {
  if (origin === DND) {
    const [{ MONSTERS }, { DND_NAMES }] = await Promise.all([loadSrd(), loadNames()]);
    return [
      ...MONSTERS.map((m) => ({ name: m.name, meta: `HG ${m.cr} · ${m.type}`, srd: m.id })),
      ...DND_NAMES.map(([name, en, cr, type, src, alias]) => ({ name, alt: [en, alias].filter(Boolean).join(' · '), meta: `HG ${cr} · ${type} · ${src}` })),
    ];
  }
  if (!hasNameList(origin)) return [];
  const { WORLD_NAMES } = await loadNames();
  return (WORLD_NAMES[origin] || []).flatMap(([group, list]) => list.map((name) => ({ name, meta: group })));
}

// Treffer sortieren: Wortanfang vor Teiltreffer, dann alphabetisch
export function matchNames(list, q, limit = 60) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return list.slice(0, limit);
  const out = [];
  for (const it of list) {
    const n = it.name.toLowerCase();
    const alt = (it.alt || '').toLowerCase();
    const score = n.startsWith(s) ? 3 : n.split(/[\s-]/).some((w) => w.startsWith(s)) ? 2 : n.includes(s) ? 1 : alt.includes(s) ? 0.5 : 0;
    if (score) out.push([score, it]);
  }
  return out.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name, 'de')).slice(0, limit).map((x) => x[1]);
}
