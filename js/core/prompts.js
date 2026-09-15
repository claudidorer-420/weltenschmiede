// KI-Prompts (deutsch) für alle Generatoren + Kontext aus dem Codex.
import { app, getIndex, noteById, rulesEdition } from './app.js';
import { settings } from './settings.js';

export function worldContext() {
  const c = app.get().campaign;
  const parts = [];
  if (c?.name) parts.push(`Kampagne: ${c.name}`);
  if (c?.description) parts.push(c.description);
  if (c?.world) parts.push(`Welt-Kontext der Spielleitung:\n${c.world}`);
  return parts.join('\n');
}

export function notesContext(ids = [], { maxChars = 60000 } = {}) {
  let out = '';
  for (const id of ids) {
    const n = noteById(id);
    if (!n) continue;
    const block = `### ${n.title}${n.folder ? ` (Ordner: ${n.folder})` : ''}\n${String(n.body || '').trim()}\n\n`;
    if (out.length + block.length > maxChars) {
      out += `${block.slice(0, Math.max(0, maxChars - out.length - 40))}\n(… gekürzt)\n\n`;
      break;
    }
    out += block;
  }
  return out.trim();
}

export function codexTitles(limit = 400) {
  return getIndex().notes.slice(0, limit).map((n) => n.title).join(' · ');
}

const unitsText = () => (settings.get().units === 'ft' ? 'Fuß (ft)' : 'Meter (1,5 m = 5 Fuß, wie im deutschen Regelwerk)');

export function worldSystemPrompt() {
  return `Du bist ein meisterhafter Weltenbauer für Dungeons & Dragons 5e und schreibst auf Deutsch.
Du erschaffst lebendige, sofort am Spieltisch nutzbare Inhalte für eine Spielleitung: konkret, überraschend, stimmig – mit Gelegenheiten für Erkundung, soziale Interaktion und Konflikt.

Formatregeln (Markdown im Obsidian-Stil):
- Beginne mit „# Name“ und darunter einer kursiven Einzeiler-Beschreibung.
- Nutze ## für Abschnitte, ### für Unterabschnitte, Listen, **Fettdruck** und Tabellen.
- Setze Namen von Personen, Orten, Läden, Fraktionen und besonderen Gegenständen als [[Wikilinks]]. Bereits existierende Codex-Einträge verlinkst du mit exakt ihrem Titel.
- Vorlesetexte für die Spieler als Callout: „> [!vorlesen] Titel“ mit Folgezeilen „> …“.
- Geheime Informationen für die Spielleitung als Callout: „> [!gm] Titel“.
- Preise im 5e-Münzsystem (cp, sp, gp, pp) und realistisch nach 5e-Maßstäben.
- Würfelangaben im Format 1d20+3 oder 2d6, Schwierigkeiten als „SG 13“. Entfernungen in ${unitsText()}.
- Kein HTML, kein Codeblock um die Antwort, keine Vorrede, kein Nachwort.
- Bleibe konsistent mit dem Welt-Kontext und den Codex-Auszügen; widersprich ihnen nicht und wiederhole sie nicht unnötig.`;
}

export function buildWorldPrompt(cfg) {
  const { typeLabel, blocks = [], core = '', contextIds = [], sections = [], extras = [], words = 1000, npcs = 2, freeTask = '' } = cfg;
  const lines = [];
  lines.push(freeTask ? `Aufgabe: ${freeTask}` : `Aufgabe: Erschaffe ${typeLabel}.`);
  lines.push(`Umfang: etwa ${words} Wörter.`);
  const filled = blocks.filter((b) => b.values?.length);
  const empty = blocks.filter((b) => !b.values?.length && !b.muted);
  if (filled.length) {
    lines.push('\nThemenbausteine (Gewichtung in Klammern – „zentral“ soll prägend sein, „nebensächlich“ nur anklingen):');
    for (const b of filled) lines.push(`- ${b.label} (${['nebensächlich', 'normal', 'zentral'][b.weight ?? 1]}): ${b.values.join('; ')}`);
  }
  if (empty.length) lines.push(`\nDiese Bausteine entscheidest du selbst passend: ${empty.map((b) => b.label).join(', ')}.`);
  if (core.trim()) lines.push(`\nKreativer Kern – Vorgaben der Spielleitung (unbedingt umsetzen):\n${core.trim()}`);
  if (sections.length) {
    lines.push('\nGliederung – verwende genau diese Abschnitte als ##-Überschriften in dieser Reihenfolge:');
    sections.forEach((s, i) => lines.push(`${i + 1}. ## ${s.label} – ${s.instr.replace('{npcs}', String(npcs))}`));
  }
  if (extras.length) {
    lines.push('\nZusätzlich:');
    extras.forEach((s) => lines.push(`- ${s.label}: ${s.instr}`));
  }
  const wc = worldContext();
  if (wc) lines.push(`\n---\n${wc}`);
  const ctx = notesContext(contextIds);
  if (ctx) lines.push(`\n---\nAuszüge aus dem Codex (für Konsistenz):\n${ctx}`);
  const titles = codexTitles();
  if (titles) lines.push(`\n---\nVorhandene Codex-Titel (für exakte [[Links]]): ${titles}`);
  return lines.join('\n');
}

export function npcSystemPrompt() {
  return `Du bist ein Figuren-Designer für Dungeons & Dragons 5e und schreibst auf Deutsch. Du erschaffst NPCs, die man sofort spielen kann: klare Stimme, greifbare Motivation, ein Geheimnis und ein Aussehen, das detailliert genug ist, um eine Miniatur danach zu bemalen.
Markdown im Obsidian-Stil: „# Name“ als Titel, darunter ein kursiver Einzeiler; ## Abschnitte; Namen anderer Personen/Orte als [[Wikilinks]] (bestehende Codex-Titel exakt); Geheimnisse im Callout „> [!gm] …“. Farbangaben als Hex-Codes (#RRGGBB). Kein HTML, keine Vorrede.`;
}

export function buildNpcPrompt(cfg) {
  const { fields = {}, core = '', contextIds = [], count = 1, paint = true, stats = false, words = 600 } = cfg;
  const lines = [count > 1 ? `Erschaffe ${count} unterschiedliche NPCs (jeweils mit eigener #-Überschrift, getrennt durch ---).` : 'Erschaffe einen NPC.'];
  lines.push(`Umfang pro NPC: etwa ${words} Wörter.`);
  const f = Object.entries(fields).filter(([, v]) => v && String(v).trim());
  if (f.length) {
    lines.push('\nVorgaben:');
    f.forEach(([k, v]) => lines.push(`- ${k}: ${v}`));
  }
  if (core.trim()) lines.push(`\nKreativer Kern:\n${core.trim()}`);
  lines.push(`\nAbschnitte:
## Auf einen Blick – Liste mit Volk, Beruf/Rolle, Alter, Gesinnung, Aufenthaltsort ([[Link]])
## Aussehen – detailliert (Statur, Gesicht, Haare, Kleidung, Ausrüstung, Besonderheiten)
## Stimme & Auftreten – Sprechweise, Marotten, zwei typische Zitate als Liste
## Persönlichkeit – Ideal, Bindung, Makel
## Motivation & Ziele
## Geheimnis – im „> [!gm]“-Callout
## Beziehungen – als [[Wikilinks]]
## Aufhänger – 2–3 Ideen, wie die Gruppe mit dem NPC zu tun bekommt${paint ? '\n## Bemal-Guide – Farbpalette als Liste „- Bauteil: #RRGGBB (Farbname)“ plus 2–3 Tipps (Grundierung, Akzente, Washes)' : ''}${stats ? '\n## Spielwerte – kompakt: RK, TP (mit Würfeln), Bewegungsrate, Attribute, 1–2 Aktionen mit Angriffs- und Schadenswürfen, HG' : ''}`);
  const wc = worldContext();
  if (wc) lines.push(`\n---\n${wc}`);
  const ctx = notesContext(contextIds, { maxChars: 30000 });
  if (ctx) lines.push(`\n---\nCodex-Auszüge:\n${ctx}`);
  const titles = codexTitles(250);
  if (titles) lines.push(`\n---\nVorhandene Codex-Titel: ${titles}`);
  return lines.join('\n');
}

export const MONSTER_SCHEMA = `{
  "difficulty": { "score": 1-10, "label": "kurzes Etikett", "reasoning": "2–4 Sätze Begründung" },
  "monsters": [ {
    "qty": 1, "name": "", "size": "", "type": "", "alignment": "",
    "ac": 0, "acNote": "", "hp": 0, "hpDice": "", "speed": "",
    "abilities": { "str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10 },
    "saves": "", "skills": "", "vulnerabilities": "", "resistances": "", "immunities": "", "conditionImmunities": "",
    "senses": "", "languages": "", "cr": "1/2", "xp": 100,
    "traits": [ { "name": "", "desc": "" } ], "actions": [ { "name": "", "desc": "" } ],
    "bonusActions": [], "reactions": [], "legendary": [], "lair": [],
    "description": "Aussehen & Lore in 2–3 Sätzen", "tactics": "wie diese Kreatur kämpft",
    "paint": [ { "part": "", "hex": "#RRGGBB", "name": "" } ]
  } ],
  "tactics": "wie diese Kombination zusammen kämpft",
  "terrain": [ "Geländemerkmal mit Regelwirkung" ],
  "loot": "Beute",
  "scaling": "wie man den Kampf leichter bzw. schwerer macht"
}`;

export function encounterSystemPrompt({ version = rulesEdition(), paint = false } = {}) {
  return `Du bist ein erfahrener D&D-5e-Encounter-Designer. Du erstellst lore-getreue Statblocks für vorgegebene Kreaturen – auch aus anderen Welten (The Witcher, Herr der Ringe, Elder Scrolls, Dark Souls …), die du stimmig in 5e-Regeln überträgst – und bewertest, wie schwer der Kampf für die Gruppe wird.

Regeln:
- Regelwerk: D&D 5e (${version}). Entfernungen in ${unitsText()}.
- Wähle den Herausforderungsgrad so, wie er für die Kreatur in ihrer Lore am logischsten ist (ein Leshen ist immer gefährlich, ein Goblin meist schwach) – NICHT passend zur Gruppe.
- Werte konsistent zum HG nach den 5e-Richtlinien (RK, TP, Angriffsbonus, Schaden pro Runde, Rettungswurf-SG).
- Alle Texte auf Deutsch. Aktionen mit präzisen Werten, z. B. „Nahkampfwaffenangriff: +5 zum Treffen, Reichweite 1,5 m, ein Ziel. Treffer: 7 (1d8+3) Hiebschaden.“ Rettungswürfe als „SG 13 Konstitution“.
- Besondere Eigenschaften und Aktionen spiegeln die Lore wider (Schwächen, Resistenzen, Rituale, Signaturfähigkeiten).
- difficulty.score: 1 = Spaziergang, 5 = mittlere Herausforderung mit Ressourcenverbrauch, 10 = sicherer Tod/TPK. Begründe mit Action Economy, Schadensausstoß gegenüber den TP der Gruppe, Kontrolleffekten und Gelände.
- ${paint ? 'Fülle "paint" mit 3–6 Farben für die Miniaturbemalung.' : 'Lass "paint" leer ([]).'}

Antworte ausschließlich mit JSON in genau diesem Schema (ohne Kommentare):
${MONSTER_SCHEMA}`;
}

export function buildEncounterPrompt({ levels = [], monsters = [], environment = '', goal = '', extra = '' }) {
  const lines = [`Gruppe: ${levels.length} Charaktere, Stufen ${levels.join(', ')}.`];
  lines.push('Vorgegebene Kreaturen:');
  for (const m of monsters) lines.push(`- ${m.qty}× ${m.name} (Ursprung: ${m.origin || 'Sonstiges'})${m.note ? ` – Hinweis: ${m.note}` : ''}`);
  if (environment) lines.push(`Umgebung: ${environment}`);
  if (goal) lines.push(`Situation / Ziel: ${goal}`);
  if (extra) lines.push(`Zusatzwünsche: ${extra}`);
  const wc = worldContext();
  if (wc) lines.push(`\nWelt-Kontext (für Flair): ${wc.slice(0, 1500)}`);
  return lines.join('\n');
}

export function summarySystemPrompt() {
  return `Du bist Chronist einer D&D-Kampagne und schreibst auf Deutsch. Aus den Stichpunkten der Spielleitung erstellst du einen lebendigen Rückblick „Was bisher geschah“ für die Spieler (erzählend, 150–400 Wörter), danach „## Offene Fäden“ als Liste.
Verlinke Namen als [[Wikilinks]] (bestehende Codex-Titel exakt). Was in den Stichpunkten als geheim/SL markiert ist, gehört ausschließlich in ein „> [!gm]“-Callout am Ende. Markdown, keine Vorrede.`;
}

export function prepSystemPrompt() {
  return `Du bist erfahrene Co-Spielleitung für D&D 5e und schreibst auf Deutsch. Du bereitest Sitzungen nach der Methode „Return of the Lazy Dungeon Master“ vor: Figuren prüfen, starker Einstieg, mögliche Szenen, 10 Geheimnisse & Hinweise, fantastische Orte, wichtige NPCs, passende Gegner, Belohnungen.
Nutze die Codex-Notizen für Konsistenz, verlinke mit [[Titel]], Geheimnisse als Aufgabenliste „- [ ] …“. Markdown, keine Vorrede.`;
}

export function oracleSystemPrompt(context) {
  const c = app.get().campaign;
  return `Du bist das Orakel – der Assistent der Spielleitung für die Kampagne „${c?.name || 'ohne Namen'}“. Du antwortest auf Deutsch in Markdown, knapp und nützlich.
- Stütze dich auf den Welt-Kontext und die Codex-Notizen unten. Zitiere keine langen Passagen.
- Steht etwas nicht in den Notizen, sag das klar und mach einen als **Vorschlag** gekennzeichneten, stimmigen Vorschlag.
- Weise aktiv auf Widersprüche zwischen Notizen hin.
- Verlinke Notizen als [[Titel]] (exakt).

${worldContext()}

--- Codex ---
${context || '(keine Notizen ausgewählt)'}`;
}

export function rulesSystemPrompt(version = rulesEdition()) {
  return `Du bist ein präziser Regelexperte für D&D 5e (${version}) und antwortest auf Deutsch. Erkläre die Regel knapp, nenne den relevanten Mechanismus (Aktion, Rettungswurf, Vorteil …), gib ein kurzes Beispiel und – falls strittig – gängige Auslegungen plus eine Empfehlung für die Spielleitung. Keine langen wörtlichen Zitate aus Regelwerken. Entfernungen in ${unitsText()}. Markdown.`;
}

export function imagePromptFrom(text, style = 'Fantasy-Illustration, detailreich, stimmungsvolles Licht') {
  return `${style}. ${String(text || '').replace(/[#>*[\]_`]/g, ' ').replace(/\s+/g, ' ').slice(0, 900)}`;
}
