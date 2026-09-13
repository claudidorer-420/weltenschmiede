// Notizvorlagen + Beispielkampagne „Die Nebelküste“.

const fm = (obj) => `---\n${Object.entries(obj).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join('\n')}\n---\n`;

export const TEMPLATES = [
  {
    id: 'npc', label: 'NPC', icon: 'user', folder: 'NPCs', placeholder: 'z. B. Brannoc Aschwald',
    body: () => `${fm({ typ: 'npc', volk: '', beruf: '', ort: '', tags: ['npc'] })}## Auf einen Blick
- **Rolle:**
- **Gesinnung:**
- **Zu finden in:** [[ ]]

## Aussehen


## Stimme & Auftreten
- **Sprechweise:**
- **Marotte:**

## Motivation


> [!gm] Geheimnis
>

## Beziehungen
-

## Bemal-Guide
- Haut: #C8A27A
- Kleidung: #4A5A5E
`,
  },
  {
    id: 'ort', label: 'Ort / Stadt', icon: 'castle', folder: 'Orte', placeholder: 'z. B. Hügelgrab (Blau 2)',
    body: () => `${fm({ typ: 'ort', region: '', bevoelkerung: '', tags: ['ort'] })}> [!vorlesen]
>

## Überblick


## Wichtige Orte
-

## Bewohner & NPCs
- [[ ]]

## Händler & Preise
**Grundversorgung:**
- Bäckerstand – Brot, Fladen 1 cp – 5 sp

**Handwerk & Ausrüstung:**
-

## Gerüchte
| d6 | Gerücht |
|---|---|
| 1 |  |
| 2 |  |
| 3 |  |
| 4 |  |
| 5 |  |
| 6 |  |

> [!gm] Geheimnisse
>
`,
  },
  {
    id: 'laden', label: 'Laden / Händler', icon: 'store', folder: 'Läden', placeholder: 'z. B. Zwergenschmiede 2',
    body: () => `${fm({ typ: 'laden', ort: '', inhaber: '', tags: ['laden'] })}Der Laden in [[ ]] …

## Inhaber
[[ ]] –

## Sortiment
| Ware | Preis | Vorrat |
|---|---|---|
|  |  gp |  |

## Besonderheiten
- Feilschen: Überzeugen SG 15 → 10 % Rabatt
`,
  },
  {
    id: 'taverne', label: 'Taverne', icon: 'beer', folder: 'Orte',
    body: () => `${fm({ typ: 'taverne', ort: '', wirt: '', tags: ['taverne'] })}> [!vorlesen]
>

## Wirt & Personal
- [[ ]] –

## Karte
- Krug Bier – 4 cp
- Eintopf des Tages – 3 sp
- Zimmer (einfach) – 5 sp

## Stammgäste
-

## Was heute Abend passiert
| d6 | Ereignis |
|---|---|
| 1 |  |
| 2 |  |
| 3 |  |
| 4 |  |
| 5 |  |
| 6 |  |
`,
  },
  {
    id: 'quest', label: 'Quest', icon: 'list-checks', folder: 'Abenteuer',
    body: () => `${fm({ typ: 'quest', status: 'offen', auftraggeber: '', belohnung: '', tags: ['quest'] })}## Aufhänger


## Ziel
- [ ]

## Beteiligte
- [[ ]]

## Hinweise & Spuren
-

> [!gm] Was wirklich los ist
>

## Belohnung
`,
  },
  {
    id: 'sitzung', label: 'Sitzungsvorbereitung', icon: 'calendar', folder: 'Sitzungen',
    body: () => `${fm({ typ: 'sitzung', datum: new Date().toISOString().slice(0, 10), tags: ['sitzung'] })}## Starker Einstieg


## Mögliche Szenen
-

## Geheimnisse & Hinweise
- [ ]
- [ ]
- [ ]

## Orte
- [[ ]]

## NPCs
- [[ ]]

## Gegner
-

## Belohnungen
-

## Notizen während der Sitzung

`,
  },
  {
    id: 'fraktion', label: 'Fraktion', icon: 'shield', folder: 'Fraktionen',
    body: () => `${fm({ typ: 'fraktion', sitz: '', anfuehrer: '', tags: ['fraktion'] })}## Ziele


## Methoden


## Anführung & Mitglieder
- [[ ]]

## Verbündete & Feinde
-

## Ressourcen


> [!gm] Verborgene Agenda
>
`,
  },
  {
    id: 'gottheit', label: 'Gottheit / Kult', icon: 'sun', folder: 'Religion',
    body: () => `${fm({ typ: 'gottheit', domaenen: '', symbol: '', tags: ['religion'] })}## Lehre


## Riten & Feste


## Klerus


## Heilige Orte
- [[ ]]
`,
  },
  {
    id: 'gegenstand', label: 'Magischer Gegenstand', icon: 'gem', folder: 'Gegenstände',
    body: () => `${fm({ typ: 'gegenstand', seltenheit: 'ungewöhnlich', einstimmung: 'nein', tags: ['gegenstand'] })}*Wundersamer Gegenstand, ungewöhnlich*

## Beschreibung


## Eigenschaften
-

## Herkunft

`,
  },
  {
    id: 'reich', label: 'Reich / Region', icon: 'globe', folder: 'Reiche',
    body: () => `${fm({ typ: 'reich', hauptstadt: '', herrschaft: '', tags: ['reich'] })}## Überblick


## Landschaft & Klima


## Städte & Orte
- [[ ]]

## Herrschaft & Politik


## Konflikte
-
`,
  },
  {
    id: 'dungeon', label: 'Dungeon', icon: 'door', folder: 'Orte',
    body: () => `${fm({ typ: 'dungeon', stufe: '', tags: ['dungeon'] })}> [!vorlesen] Eingang
>

## Räume
### 1.
### 2.
### 3.

## Fallen
-

## Schatz
> [!loot]
>
`,
  },
  {
    id: 'monster', label: 'Monster (Statblock)', icon: 'ghost', folder: 'Monster',
    body: (t) => `${fm({ typ: 'monster', tags: ['monster'] })}\`\`\`statblock
{
  "name": "${String(t || 'Kreatur').replace(/"/g, "'")}",
  "size": "Mittelgroß", "type": "Monstrosität", "alignment": "neutral",
  "ac": 13, "acNote": "natürliche Rüstung", "hp": 22, "hpDice": "4d8+4", "speed": "9 m",
  "abilities": { "str": 14, "dex": 12, "con": 12, "int": 6, "wis": 10, "cha": 6 },
  "senses": "Dunkelsicht 18 m, passive Wahrnehmung 10", "languages": "–", "cr": "1",
  "traits": [ { "name": "Besonderheit", "desc": "…" } ],
  "actions": [ { "name": "Biss", "desc": "Nahkampfwaffenangriff: +4 zum Treffen, Reichweite 1,5 m, ein Ziel. Treffer: 6 (1d8+2) Stichschaden." } ]
}
\`\`\`
`,
  },
];

// ───────────────────────── Beispielkampagne ─────────────────────────
export const SAMPLE_CAMPAIGN = {
  folders: ['Orte', 'NPCs', 'Reiche', 'Fraktionen', 'Abenteuer', 'Monster', 'Sitzungen'],
  notes: [
    {
      title: 'Willkommen', folder: '', visibility: 'players',
      body: `${fm({ tags: ['anleitung'] })}Diese Beispielkampagne zeigt, was der Codex kann. Alles ist bearbeitbar – oder lösche die Kampagne später einfach wieder (Kampagnen-Menü unten links).

## Verlinken wie in Obsidian
Tippe \`[[\` im Editor und wähle eine Notiz: [[Nebelbrück (Blau 1)]], [[Maren Kielholt]], [[Die Nebelküste]]. Links auf Notizen, die es noch nicht gibt, sind gestrichelt – ein Klick legt sie an: [[Der Leuchtturmwärter]].

## Würfel, Münzen & Farben
- Klick auf einen Würfel würfelt: 1d20+5, 2d6, 4d6dl1, W20.
- Preise werden hervorgehoben: 5 cp, 2 sp, 15 gp.
- Farbcodes für Miniaturen: #A0522D Rostrot, #3E5641 Tannengrün.

## Callouts
> [!vorlesen] Vorlesetext
> Nebel kriecht über die Planken, als die Glocke dreimal schlägt …

> [!gm] Nur für die Spielleitung
> Dieser Kasten ist in der Spieleransicht unsichtbar. Für echte Geheimnisse nutze das Feld **SL-Geheimnisse** unter jeder Notiz – das liegt technisch getrennt.

## Zufallstabellen
Klick auf den Würfel im Tabellenkopf:

| d6 | Wetter an der Küste |
|---|---|
| 1 | Dichter Nebel, Sicht 10 m |
| 2 | Nieselregen |
| 3 | Böiger Seewind |
| 4 | Klarer Himmel, eisig |
| 5 | Ein Sturm zieht auf |
| 6 | Unheimliche Windstille |

## Aufgaben
- [x] Beispielkampagne öffnen
- [ ] Graph-Ansicht ansehen (Strg+G)
- [ ] KI-Schlüssel in den Einstellungen hinterlegen
- [ ] In der Weltenschmiede einen Ort erschaffen
`,
    },
    {
      title: 'Die Nebelküste', folder: 'Reiche', visibility: 'players',
      body: `${fm({ typ: 'reich', hauptstadt: '[[Nebelbrück (Blau 1)]]', tags: ['reich', 'küste'] })}Ein schmaler Landstrich aus Klippen, Salzwiesen und Pfahldörfern, über dem an neun von zehn Tagen der Nebel liegt.

## Orte
- [[Nebelbrück (Blau 1)]] – Fischerdorf auf Pfählen
- [[Glockensteg (Lila 1)]] – ein Steg, der ins Nichts führt
- [[Tangmarkt (Blau 3)]] – der schwimmende Markt

## Mächte
- [[Fischergilde von Nebelbrück]]

## Klima
Kalt, feucht, windig. Im Winter frieren die Salzwiesen zu glitzernden Spiegeln.
`,
    },
    {
      title: 'Nebelbrück (Blau 1)', folder: 'Orte', visibility: 'players',
      body: `${fm({ typ: 'ort', region: '[[Die Nebelküste]]', bevoelkerung: 'ca. 600', tags: ['ort', 'dorf'] })}> [!vorlesen]
> Der Nebel riecht nach Salz und nassem Holz. Aus dem Grau schälen sich schiefe Hütten auf Pfählen, Laternen in grünlichem Glas – und ein Steg, der ins Nichts zu führen scheint.

Nebelbrück ist ein Fischerdorf, das vom Fang des leuchtenden **Perlaals** lebt. Hafenmeisterin [[Maren Kielholt]] hält die Gemeinschaft zusammen, doch seit Wochen verschwinden Fischer im Morgennebel.

## Wichtige Orte
- [[Zum Ertrunkenen Anker (Blau 2)]] – Taverne auf dem größten Pfahlhaus
- [[Tangmarkt (Blau 3)]] – legt jeden Tag an einer anderen Stelle an
- [[Glockensteg (Lila 1)]] – endet mitten im Wasser

## Mächte
Die [[Fischergilde von Nebelbrück]] gibt *Nebelzeichen* aus – Holzmarken, die hier wie Münzen gelten.

> [!gm] Was wirklich los ist
> Der Nebel ist die Grenze zu einem Spiegeldorf der Feywild. Wer darin verloren geht, lebt dort weiter – ohne zu altern.
`,
    },
    {
      title: 'Zum Ertrunkenen Anker (Blau 2)', folder: 'Orte', visibility: 'players',
      body: `${fm({ typ: 'taverne', ort: '[[Nebelbrück (Blau 1)]]', wirt: 'Olf Tauwerk', tags: ['taverne'] })}Die Taverne thront auf dem größten Pfahlhaus des Dorfes. Bei Flut schwappt das Wasser durch die Bodenritzen – die Gäste heben dann einfach die Füße.

Es sind Händler in der Stadt, die ihre Stände entlang des Hauptstegs aufgebaut haben.

**Grundversorgung:**
- Räucherfisch am Stock – 2 cp
- Algenbrot mit Muschelbutter – 3 cp
- Krug Salzbier – 4 cp
- Zimmer mit Hängematte – 5 sp

**Spezialität des Hauses:**
- Perlaal-Suppe (leuchtet im Dunkeln) – 1 gp

## Was heute Abend passiert
| d4 | Ereignis |
|---|---|
| 1 | Ein Fischer schwört, im Nebel seine tote Frau gesehen zu haben. |
| 2 | Armdrücken um eine Seekarte. |
| 3 | Die Glocke schlägt – alle verstummen. |
| 4 | Ein Barde singt ein Lied, das niemand kennt, aber alle mitsingen können. |
`,
    },
    {
      title: 'Tangmarkt (Blau 3)', folder: 'Orte', visibility: 'players',
      body: `${fm({ typ: 'markt', ort: '[[Nebelbrück (Blau 1)]]', tags: ['markt', 'laden'] })}Ein Floß aus zwei Dutzend zusammengebundenen Booten. Wo er anlegt, entscheidet morgens die Gilde.

**Handwerk & Ausrüstung:**
- Pfahlschuhe gegen Glätte – 2 gp
- Wasserdichter Kartenköcher – 8 gp
- Laternenöl (grün brennend) – 5 sp
- Fischernetz – 1 gp

**Kurioses:**
- Glasfläschchen mit Nebel darin – 3 gp
- Kompass, der nach „zu Hause“ zeigt – 25 gp
`,
    },
    {
      title: 'Glockensteg (Lila 1)', folder: 'Orte', visibility: 'gm',
      body: `${fm({ typ: 'ort', tags: ['ort', 'geheimnis'] })}Ein alter Steg aus schwarzem Holz, der dreißig Schritte ins Meer führt und dann einfach endet. An seinem Ende hängt die **Nebelglocke**.

> [!vorlesen]
> Das Holz ist warm, obwohl der Wind eisig pfeift. Die Glocke bewegt sich, doch kein Laut ist zu hören – bis ihr stehen bleibt.

## Regeln der Glocke
- Wer um Mitternacht läutet, hört die Stimmen der Verschwundenen (Weisheit-Rettungswurf SG 13 oder 1d6 psychischer Schaden).
- Schlägt sie viermal, öffnet sich der Weg ins Spiegeldorf.

## Beute
> [!loot]
> Unter der letzten Planke: 34 sp, ein Ehering mit der Gravur „M. & J.“
`,
    },
    {
      title: 'Maren Kielholt', folder: 'NPCs', visibility: 'players',
      body: `${fm({ typ: 'npc', volk: 'Halbelfe', beruf: 'Hafenmeisterin', ort: '[[Nebelbrück (Blau 1)]]', tags: ['npc'] })}Eine drahtige Halb-Elfe Mitte fünfzig mit salzverkrustetem Wollmantel und einem Messingfernrohr, das sie nie ablegt.

## Stimme & Auftreten
- Leise, knapp, beendet Sätze mit „… verstanden?“
- Zählt beim Nachdenken die Glockenschläge mit den Fingern.

## Motivation
Will beweisen, dass die Verschwundenen noch leben.

## Bemal-Guide
- Mantel: #4A5A5E
- Haut: #C8A27A
- Fernrohr: #B08D57
- Haar: #9EA3A8

## Beziehungen
- Misstraut der [[Fischergilde von Nebelbrück]]
- Kennt jeden Winkel des [[Glockensteg (Lila 1)|Glockenstegs]]
`,
    },
    {
      title: 'Fischergilde von Nebelbrück', folder: 'Fraktionen', visibility: 'gm',
      body: `${fm({ typ: 'fraktion', sitz: '[[Nebelbrück (Blau 1)]]', tags: ['fraktion'] })}## Ziele
Kontrolle über den Perlaal-Handel und über die Nebelzeichen.

## Methoden
Schuldscheine, Fangrechte, gelegentlich ein „Unfall“ im Nebel.

> [!gm] Verborgene Agenda
> Die Gildenmeisterin hat einen Pakt mit einem Feenwesen geschlossen: Jeder Verschwundene verlängert ihr Leben um ein Jahr.
`,
    },
    {
      title: 'Die vierte Glocke', folder: 'Abenteuer', visibility: 'gm',
      body: `${fm({ typ: 'quest', status: 'aktiv', auftraggeber: '[[Maren Kielholt]]', belohnung: '150 gp', tags: ['quest'] })}## Aufhänger
Die Glocke schlägt zum ersten Mal seit hundert Jahren ein viertes Mal. Am nächsten Morgen fehlt ein halbes Dutzend Boote.

## Ziel
- [ ] Mit [[Maren Kielholt]] sprechen
- [ ] Den [[Glockensteg (Lila 1)]] bei Mitternacht untersuchen
- [ ] Das Geheimnis der [[Fischergilde von Nebelbrück]] aufdecken

## Gegner
- 4 × [[Goblin-Plünderer]] am Tangmarkt
`,
    },
    {
      title: 'Goblin-Plünderer', folder: 'Monster', visibility: 'gm',
      body: `${fm({ typ: 'monster', tags: ['monster', 'goblin'] })}Magere Gestalten mit gelben Augen, die erbeutete Wappen wie Trophäen tragen.

\`\`\`statblock
{
  "name": "Goblin-Plünderer", "size": "Klein", "type": "Humanoide (Goblinoide)", "alignment": "neutral böse",
  "ac": 15, "acNote": "Lederrüstung, Schild", "hp": 7, "hpDice": "2d6", "speed": "9 m",
  "abilities": { "str": 8, "dex": 14, "con": 10, "int": 10, "wis": 8, "cha": 8 },
  "skills": "Heimlichkeit +6", "senses": "Dunkelsicht 18 m, passive Wahrnehmung 9", "languages": "Gemeinsprache, Goblinisch", "cr": "1/4",
  "traits": [ { "name": "Flinke Flucht", "desc": "Kann in jedem seiner Züge Rückzug oder Verstecken als Bonusaktion ausführen." } ],
  "actions": [
    { "name": "Krummsäbel", "desc": "Nahkampfwaffenangriff: +4 zum Treffen, Reichweite 1,5 m, ein Ziel. Treffer: 5 (1d6+2) Hiebschaden." },
    { "name": "Kurzbogen", "desc": "Fernkampfwaffenangriff: +4 zum Treffen, Reichweite 24/96 m, ein Ziel. Treffer: 5 (1d6+2) Stichschaden." }
  ],
  "paint": [ { "part": "Haut", "hex": "#6B8E23", "name": "Olivgrün" }, { "part": "Leder", "hex": "#5C4033", "name": "Dunkelbraun" } ]
}
\`\`\`
`,
    },
    {
      title: 'Sitzung 1 – Ankunft im Nebel', folder: 'Sitzungen', visibility: 'gm',
      body: `${fm({ typ: 'sitzung', datum: new Date().toISOString().slice(0, 10), tags: ['sitzung'] })}## Starker Einstieg
Die Gruppe erreicht [[Nebelbrück (Blau 1)]] im Boot eines schweigsamen Fährmanns – genau als die Glocke zum vierten Mal schlägt.

## Mögliche Szenen
- Empfang durch [[Maren Kielholt]] am Hafen
- Abend im [[Zum Ertrunkenen Anker (Blau 2)]]
- Hinterhalt am [[Tangmarkt (Blau 3)]]

## Geheimnisse & Hinweise
- [ ] Der Fährmann hat keinen Schatten.
- [ ] Die Gildenmeisterin ist seit 40 Jahren nicht gealtert.
- [ ] Der Ehering unter dem Steg gehört Marens Bruder.
`,
    },
  ],
};
