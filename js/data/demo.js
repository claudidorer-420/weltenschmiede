// Beispielantworten für den Demo-Modus (ohne KI-Schlüssel).

const WORLD = `# Nebelbrück
*Ein Fischerdorf auf Pfählen, das jeden Morgen im Nebel verschwindet – und nicht immer vollständig zurückkehrt.*

> [!vorlesen] Ankunft
> Der Nebel riecht nach Salz und nassem Holz. Irgendwo unter euch gluckst das Wasser zwischen den Pfählen, während eine Glocke dreimal schlägt – langsam, als würde jemand zählen. Aus dem Grau schälen sich schiefe Hütten, Laternen in grünlichem Glas und ein Steg, der ins Nichts zu führen scheint.

## Szenerie & Atmosphäre
- **Sehen:** Laternen mit Algenöl, das grün brennt; Netze voller silbriger Fische, die noch zucken.
- **Hören:** Knarzende Planken, Möwen, das ferne Läuten der [[Nebelglocke]].
- **Riechen:** Tang, Räucherfisch, Teer.

## Das System
Nebelbrück lebt vom Fang des **Perlaals**, dessen Schuppen im Mondlicht leuchten. Bezahlt wird mit Münzen – und mit *Nebelzeichen*, kleinen Holzmarken, die die [[Fischergilde von Nebelbrück]] ausgibt.

## Wichtige Orte
- **[[Zum Ertrunkenen Anker]]** – Taverne auf dem größten Pfahlhaus.
- **Der Glockensteg** – endet mitten im Wasser. Niemand weiß, wohin er früher führte.
- **[[Tangmarkt]]** – schwimmender Markt, der täglich woanders anlegt.

## NPCs
### [[Maren Kielholt]] – Hafenmeisterin
Eine drahtige Halb-Elfe Mitte fünfzig mit salzverkrustetem Wollmantel und einem Messingfernrohr, das sie nie ablegt.
- **Stimme:** leise, knapp, beendet Sätze mit „…verstanden?“
- **Motivation:** Will beweisen, dass die Verschwundenen noch leben.
- **Bemal-Guide:** Mantel #4A5A5E, Haut #C8A27A, Fernrohr #B08D57, Haare #9EA3A8

> [!gm] Geheimnis
> Maren hat ihren eigenen Bruder an den Nebel „verkauft“, um das Dorf zu retten.

## Händler & Preise
**Grundversorgung:**
- Räucherfisch am Stock – 2 cp
- Algenbrot mit Muschelbutter – 3 cp
- Laternenöl (grün) – 5 sp

**Handwerk & Ausrüstung:**
- Pfahlschuhe gegen Glätte – 2 gp
- Wasserdichter Kartenköcher – 8 gp

## Gerüchte
| d6 | Gerücht |
|---|---|
| 1 | Wer die Glocke um Mitternacht läutet, hört die Stimmen der Verschwundenen. |
| 2 | Der Perlaal ist gar kein Fisch. |
| 3 | Die Gilde fälscht Nebelzeichen. |
| 4 | Unter dem Glockensteg liegt ein versunkener Tempel. |
| 5 | Maren war früher Piratin. |
| 6 | Im Nebel gibt es eine zweite, stille Version des Dorfes. |

## Ereignisse & Aufhänger
1. Ein Kind taucht nach drei Jahren wieder auf – keinen Tag gealtert.
2. Die Glocke schlägt ein viertes Mal. Das hat sie noch nie getan.
3. Ein Fremder bezahlt mit Münzen, die in 100 Jahren geprägt werden.

*Demo-Modus: Dies ist ein fester Beispieltext. Trage in den Einstellungen einen KI-Schlüssel ein, um echte Inhalte zu erschaffen.*`;

const NPC = `# Brannoc „Zwei-Finger“ Aschwald
*Zwergischer Pfandleiher mit einem Herz aus Gold – und einem Keller voller gestohlener Dinge.*

## Auf einen Blick
- **Volk / Beruf:** Bergzwerg, Pfandleiher
- **Gesinnung:** chaotisch gut
- **Alter:** 187 Jahre

## Aussehen
Breitschultrig, rostroter Bart in drei Zöpfen mit Kupferringen. An der linken Hand fehlen zwei Finger – er erzählt jedes Mal eine andere Geschichte dazu.

## Stimme & Auftreten
Tiefe, rollende Stimme. Klopft beim Nachdenken mit dem Ringfinger auf den Tresen. Sagt „Tja, mein Freund…“, bevor er einen Preis nennt.

## Motivation
Sammelt Geld, um den Stollen seiner Familie freizukaufen.

> [!gm] Geheimnis
> Er ist Hehler der Diebesgilde – und hasst es.

## Bemal-Guide
- Bart: #A0522D (Rostrot)
- Haut: #D9A77E
- Weste: #3E5641 (Tannengrün)
- Ringe: #B87333 (Kupfer)

## Zitate
- „Alles hat seinen Preis. Nur Freundschaft nicht – die ist unbezahlbar, also leih ich sie nicht aus.“
- „Zwei Finger weniger, aber immer noch mehr Verstand als die Stadtwache.“

*Demo-Modus – Beispieltext.*`;

const ENCOUNTER = {
  difficulty: { score: 6, label: 'Fordernd', reasoning: 'Vier Stufe-3-Helden gegen vier Goblins und einen Worg: Die Action Economy liegt bei den Gegnern (5 gegen 4), der Worg kann Ziele umwerfen. Kein TPK-Risiko, aber spürbarer Ressourcenverbrauch.' },
  monsters: [
    {
      qty: 4, name: 'Goblin-Plünderer', size: 'Klein', type: 'Humanoide (Goblinoide)', alignment: 'neutral böse', ac: 15, acNote: 'Lederrüstung, Schild', hp: 7, hpDice: '2d6', speed: '9 m',
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 }, skills: 'Heimlichkeit +6', senses: 'Dunkelsicht 18 m, passive Wahrnehmung 9', languages: 'Gemeinsprache, Goblinisch', cr: '1/4', xp: 50,
      traits: [{ name: 'Flinke Flucht', desc: 'Der Goblin kann in jedem seiner Züge die Aktion Rückzug oder Verstecken als Bonusaktion ausführen.' }],
      actions: [
        { name: 'Krummsäbel', desc: 'Nahkampfwaffenangriff: +4 zum Treffen, Reichweite 1,5 m, ein Ziel. Treffer: 5 (1d6+2) Hiebschaden.' },
        { name: 'Kurzbogen', desc: 'Fernkampfwaffenangriff: +4 zum Treffen, Reichweite 24/96 m, ein Ziel. Treffer: 5 (1d6+2) Stichschaden.' },
      ],
      description: 'Magere Gestalten mit gelben Augen und Zähnen aus Draht – sie tragen erbeutete Wappen wie Trophäen.',
    },
    {
      qty: 1, name: 'Worg', size: 'Groß', type: 'Monstrosität', alignment: 'neutral böse', ac: 13, acNote: 'natürliche Rüstung', hp: 26, hpDice: '4d10+4', speed: '15 m',
      abilities: { str: 16, dex: 13, con: 13, int: 7, wis: 11, cha: 8 }, skills: 'Wahrnehmung +4', senses: 'Dunkelsicht 18 m, passive Wahrnehmung 14', languages: 'Goblinisch, Worgisch', cr: '1/2', xp: 100,
      traits: [{ name: 'Scharfes Gehör und Geruchssinn', desc: 'Vorteil auf Wahrnehmungswürfe, die auf Gehör oder Geruch beruhen.' }],
      actions: [{ name: 'Biss', desc: 'Nahkampfwaffenangriff: +5 zum Treffen, Reichweite 1,5 m, ein Ziel. Treffer: 10 (2d6+3) Stichschaden. Ist das Ziel eine Kreatur, muss es einen SG-13-Stärke-Rettungswurf bestehen oder wird umgestoßen.' }],
      description: 'Ein wolfsartiges Ungetüm mit ranzigem, grauem Fell und klugen, gierigen Augen.',
    },
  ],
  tactics: 'Die Goblins eröffnen aus der Deckung mit Bögen, ziehen sich dann per Flinke Flucht zurück. Der Worg stürmt auf den am schwächsten gerüsteten Helden zu und wirft ihn um – die Goblins konzentrieren anschließend ihr Feuer auf das liegende Ziel.',
  terrain: ['Umgestürzter Wagen: halbe Deckung', 'Dornengestrüpp: schwieriges Gelände', 'Ein Hang gibt den Goblins erhöhte Position'],
  loot: '23 sp, ein zerbeulter Silberkelch (25 gp), eine Karte mit einem gekritzelten Totenkopf.',
};

const SUMMARY = `## Was bisher geschah
Die Gruppe erreichte **Nebelbrück**, als die Glocke zum vierten Mal schlug. Hafenmeisterin [[Maren Kielholt]] bat um Hilfe: Seit Wochen verschwinden Fischer im Morgennebel.

- Im [[Zum Ertrunkenen Anker]] hörten die Helden vom versunkenen Tempel unter dem Glockensteg.
- Ein Hinterhalt von Goblins am Tangmarkt endete mit einer rätselhaften Karte.
- Offene Frage: Warum altert das zurückgekehrte Kind nicht?

> [!gm] Für die nächste Sitzung
> Maren wird nervös, sobald jemand ihren Bruder erwähnt.

*Demo-Modus – Beispieltext.*`;

const ORACLE = `Nach deinen Notizen ist das die stimmigste Antwort:

**Kurz:** Ja – das passt zur Lage von [[Nebelbrück]].

- Die [[Fischergilde von Nebelbrück]] hätte ein Motiv.
- Ein Widerspruch: In einer Notiz ist die Glocke aus Bronze, in einer anderen aus Eisen.

*Demo-Modus – Beispieltext. Mit einem echten Modell antwortet das Orakel auf Basis deiner Codex-Notizen.*`;

const QUICK = `- Hilde Morgentau
- Jorvik Salzbart
- Elaria von Schilfgrund
- Tamo Kesselflick
- Brunhild Eisenhand
- Faelan Sturmblatt
- Quirin Moosbach
- Ysolde Rabenruh

*Demo-Modus*`;

export function demoResponse(task, opts = {}) {
  if (opts.json || task === 'encounter') return JSON.stringify(ENCOUNTER, null, 2);
  switch (task) {
    case 'npc': return NPC;
    case 'summary': return SUMMARY;
    case 'oracle':
    case 'rules': return ORACLE;
    case 'quick': return QUICK;
    default: return WORLD;
  }
}

export function demoImage(prompt = '') {
  const hue = [...prompt].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="g" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="hsl(${hue} 60% 55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 50% 12%)"/></radialGradient></defs><rect width="512" height="512" fill="url(#g)"/><g fill="none" stroke="rgba(255,255,255,.55)" stroke-width="10" stroke-linejoin="round"><path d="M256 120 360 180v120L256 360 152 300V180z"/><path d="M256 120 196 270h120z"/></g><text x="256" y="440" text-anchor="middle" font-family="Georgia,serif" font-size="30" fill="rgba(255,255,255,.8)">Demo-Bild</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
