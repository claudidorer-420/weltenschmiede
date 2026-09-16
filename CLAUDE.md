# CLAUDE.md – Entwicklernotizen für die Weltenschmiede

Statische PWA ohne Build‑Schritt (GitHub Pages). UI komplett auf **Deutsch**.

## Stack & Konventionen
- **Preact + htm** über die Import‑Map in `index.html` (jsDelivr, gepinnte Versionen). Alle Module importieren aus `js/lib/preact.js` – nie direkt aus `preact`.
- htm‑Syntax: `html\`<${Comp} prop=${x}>…<//>\``, keine JSX‑Klammern, keine doppelten Attribute.
- Kein npm, keine Bundler. Externe Laufzeit‑Abhängigkeiten nur: Preact/htm (jsDelivr), Firebase (gstatic, nur im Cloud‑Modus), Anthropic‑SDK (jsDelivr `+esm`, nur wenn Claude genutzt wird).
- Code‑Stil: 2 Leerzeichen, Semikolons, einfache Anführungszeichen, kurze deutsche Kommentare nur wo nötig.

## Architektur
- `js/core/db.js` – Fassade: `db.get/list/set/update/remove/batch/watchCol/watchDoc` → `db-local.js` (IndexedDB) **oder** `db-cloud.js` (Firestore). Gleiche Pfade in beiden Modi, lokal ist die Nutzer‑ID `local`.
- `js/core/app.js` – Anmeldung, Kampagnen, Mitgliedschaft/Rollen, Notizen + Index (`getIndex()`: Titel‑/Alias‑Auflösung, Rückverweise, Tags).
- `js/core/workspace.js` – Tabs mit eigener Historie (`openView(view, params, {newTab})`), Seitenleisten, mobile Schubladen.
- `js/ui/shell.js` – Ansichten‑Registry `VIEWS` + `LOADERS` (lazy `import()`), Ribbon, Tableiste.
- `js/core/ai.js` – Anbieter (Gemini/OpenAI/OpenRouter/eigener Server per `fetch` + SSE; Claude über das **offizielle Anthropic‑SDK** mit `dangerouslyAllowBrowser`, Streaming, `fallbacks: 'default'` für Opus 5/Fable 5.1; kein `temperature` bei Claude‑5‑Modellen), Modellkatalog, `TASKS` mit Empfehlungen, `generate()`, `generateImage()`.
- Modellwahl (`resolveModel`): Auswahl pro Anfrage > eigene Auswahl der Aufgabe (`ai.tasks`) > **bevorzugtes Modell** (`ai.preferred` / `ai.preferredImage`, Einstellungen → KI oder Modell‑Knopf → „Überall als bevorzugtes Modell“) > Empfehlungen > Demo.
- `js/core/prompts.js` – alle deutschen Prompts + Codex‑Kontext.
- `js/ui/aiout.js` – `useGeneration()` (Streaming, Nachbessern, Fortsetzen) + Speicher‑Dialoge.
- `js/ui/account.js` – Konto‑Menü (Avatar im Ribbon/Übersicht), Abmelden (optional mit Gerätebereinigung), Rolle wechseln, Einstellungen als Dialog.
- Start: `views/auth.js` (Rollenwahl Spielleitung/Spieler → Name + Geheimwort) → `views/home.js` `Lobby` (ohne offene Kampagne) → Kampagne. Firebase‑Config ist in `js/config.js` fest eingebaut; `#/offline` startet den Offline‑Modus (lokal, ohne Konto).
- Würfel: `lib/dice.js` `rollDetailed()` (jeder physische Würfel + Effekte wie Vorteil, Halblingsglück, Verlässliches Talent, Großwaffen …), `core/rolls.js` `prepareRoll/commitRoll/doRoll`, `ui/dice3d.js` (3D‑Würfel ohne Bibliothek: Polyeder, Licht, Physik mit Teilschritten, Zielfläche zum Betrachter), `ui/dicetray.js` (`DiceTray` in der Würfel‑Ansicht, `DiceOverlay` = Würfel über der App + Ergebniskarten unten links).
- Regelwerk: wird beim Anlegen der Kampagne gewählt (`campaigns/{cid}.settings.rulesVersion`) und gilt für alle – `rulesEdition()` / `useEdition()` aus `core/app.js`. Spieler haben keine Regelwerk‑Einstellung.
- Charaktere: `data/chargen.js` (Völker/Spezies, Hintergründe, Klassen je Regelstand, Talente, Rüstungen, Waffen, Zaubertabellen, `charMods()`), `views/charwizard.js` (Assistent, Stufenaufstieg mit Pflicht‑Zauberwahl, `derive()`, Übernahme alter Bögen), `views/characters.js` (Bogen im D&D‑Beyond‑Aufbau: Werte fest, Spielstand änderbar; Persönlichkeit nur im Korrektur‑Modus).
- Zauber: `data/spells-2014.js` / `spells-2024.js` (generiert, SRD 5.1/5.2.1 deutsch, CC‑BY‑4.0), `data/spells.js` (Laden, Klassenlisten, `spellNeeds()` je Klasse: known/prepare/book, Anzeige‑Helfer), `views/spellbook.js` (`SpellManager`, `checkSpells()`, `openSpellManager`, `SpellDetail`). Eintrag im Bogen: `{ id, ref, name, level, cls, prepared, book, always, arcanum, source }`.
- Bilder: `data/artmap.js` (Zuordnung Zauber/Gegenstände/Kreaturen → Symbolname), `data/gameicons.js` (generiert, game-icons.net CC BY 3.0), `ui/art.js` (`SpellArt`, `ItemArt`, `MonsterArt`, `GameIcon`, `giImage` für Canvas). Gegenstände: `data/items.js` (Katalog mit Preis/Gewicht, Reichweiten), `data/magicitems-srd.js`; Monster: `data/monsters-srd.js` (317 SRD‑Monster deutsch) · `views/bestiary.js` (Kompendium + eigenes Bestiarium, KI‑Porträt).
- Karten (Typ `scrawl`): `views/mapeditor.js` (Werkzeuge, Seitenleiste, Generatoren, Spielmodus) + `views/maprender.js` (Darstellung) + `core/userassets.js` (eigene Pakete).
  - **Stil `real`** (Voreinstellung, `STYLES.real.real === true`): `renderReal()` malt Untergrund → Gelände → Böden (Textur je Form, `shape.tex`) → Wandband (Dilatation der Maske minus Boden, Textur `m.wallTex`, Bevel + Schlagschatten) → Dächer (`shape.roof`). Die klassischen Stile laufen unverändert über `renderVector()`.
  - Zwischenspeicher im Editor: **Grund** (`s.cache`, ≤ 4,2 MP), **Objekte** (`s.objCache`), **Licht** (`s.darkCv`/`s.glowCv`, grob), **Detail** (`s.detail`, nur der sichtbare Ausschnitt in Bildschirmauflösung – `renderReal(..., { rect })`). Beim Ziehen wird grob gerendert (`csStatic`), danach scharf. Das **Raster wird live** gezeichnet (`drawGrid`, mit `maskCv` auf Böden ohne Dächer begrenzt).
  - Objekte: `{ t: 'stamp', a: '<quelle>:<id>', x, y, r, s, fx?, layer?, sh? }` – Quellen `ph:` (Poly Haven, `data/mapassets.js`), `p:` (prozedurale Bauteile aus `PROC`), `u:` (eigene, nur lokal). Alte Symbole (`OBJ`) werden über `LEGACY` auf Stempel abgebildet. Ebenen: `floor` < `obj` < `top`; Schatten und Leuchten kommen aus `assetInfo()`.
  - Gelände `terrain[].mat`: Flüssigkeiten (`FLUIDS`: water, deepwater, swamp, lava, pit, blood, ice), `difficult` oder `tex:<id>`; weiche Ränder über `m.soft`.
  - `buildGrid()` = begehbare Felder, schwieriges Gelände, `opaque` (Wände blockieren Sicht), `cover` (Säulen) **und `wallE`/`wallS`** (dünne Wände zwischen zwei Feldern; Türen öffnen die Kante). `core/tactics.js` prüft diese Kanten in `reachable()` und `lineFree()`.
  - Eigene Pakete (Forgotten Adventures, Crosshead …) dürfen **nicht** mitgeliefert werden: `core/userassets.js` legt sie in einer eigenen IndexedDB ab (nie hochladen). Karten mit `u:`‑Objekten bekommen für Mitspieler ein gebackenes Bild (`map.bake.fileId`, `renderMapImage` → `core/files.js`).
  - Bausteine erzeugen: `tools/stamp-studio.html` (+ `tools/stamp-studio.mjs`, Preview „stamp-studio“) rendert Poly‑Haven‑Modelle von oben und lädt Texturen; `tools/mapassets.src.json` = Liste, `node tools/build-mapassets.mjs` → `js/data/mapassets.js`. Dateien liegen in `assets/stamps/` und `assets/tex/` (Vorschauen in `t/`) und werden vom Service Worker in `ws-assets-v1` dauerhaft zwischengespeichert (nicht in der Dateiliste von `sw.js`).
  - `views/mapgen.js` = Stile (`STYLES`), Geländematerialien (`MATS`), Streu-Sets (`SETS`) und Generatoren (`SCRAWL_GENERATORS`) ohne UI – gemeinsam mit dem MCP-Server genutzt. `mapgen.js`, `maprender.js`, `mapassets.js` dürfen beim Laden kein DOM/keine Modul-URL voraussetzen (Worker).
  - `s.clampView()` hält die Karte beim Verschieben/Zoomen im Bild – ebenso in `maps.js`.
- `views/maps.js` (Liste, Welt‑/Rasterkarten, Weiche `MapView`).
- Kampf (Rundenspiel nach 5e, 2014 und 2024):
  - `core/engine.js` – Regeln: Aktionsökonomie (`eco`: Aktion, Bonusaktion, Bewegung, Angriffe, Hast‑Zusatzaktion), Reaktion pro Runde, Vorteil/Nachteil, Angriffe gegen RK inkl. Deckung, Rettungswürfe, Schaden Resistenz → Anfälligkeit → Immunität (abgerundet), temp. TP, 0 TP / Todesrettungswürfe / massiver Schaden, Konzentration, Zustände & Effekte mit Dauer (`until`, `rounds`, Rettungswurf am Zugende), Zonen, `beginCombat`, `advance`, `opportunityTriggers`. Jede Rechnung landet im Protokoll (`log[].gm` = Zeile nur für die SL, z. B. Monster‑TP/RK).
  - `data/spellfx.js` – Kampfwirkung **aller** SRD‑Zauber (`SPELLFX` nach englischem Namen, `specFor(sp, ed)`). Neue Zauberwirkungen hier eintragen.
  - `core/actions.js` – Katalog je Kämpfer (`catalog`/`catalogSync`: Waffen, Zauber, Klassenmerkmale, Tränke, Standardaktionen, verliehene Aktionen), `availability`, `tipFor` (BG3‑Tooltip), Würfe beim Handelnden (`rollAttack`, `rollDamage`, `consumeOnUse`) und SL‑Auflösung (`handleAct`, `handleDamage`, `handleMove`, Reaktionen Schild/Parieren/Unglaubliches Ausweichen/Höllischer Tadel/Gelegenheitsangriff/Gegenzauber). Kontext: `makeCtx(x)` (Tokens, Raster, Gruppe; `override` für Positionen), `ensureBattleContext(mapId)` lädt ihn, wenn die Karte nicht offen ist.
  - Ablauf: Handelnder würfelt den Angriff (3D) → Ereignis `act` → SL‑Seite prüft, fragt Reaktionen ab (`core/react.js` `askPrompt`, bei Spielern über `combat.prompts`), würfelt Rettungswürfe → Ergebniskarte in `combat.results` (`stage: 'damage'`) → Handelnder würfelt Schaden → `dmg` → Schaden und Zustände wirken sofort. Zauberplätze/Ressourcen bucht der Handelnde im eigenen Bogen.
  - Beschwörungen (`spec.summon` in `spellfx.js`, `summonRule`): Kreatur aus den SRD‑Monstern wählen → eigene Kämpfer mit Token (`summonOf`, `conc`, Besitzer = Wirker, Statblock in der Projektion für den Besitzer); 2014 eine Initiative je Gruppe, 2024 direkt nach dem Wirker; Konzentrationsende/0 TP → `vanish`, der Token wird nach dem Speichern entfernt. Mit 1 Minute Wirkzeit vor Kampfbeginn wirkbar (`state.prep`).
  - Verwandlung/Tiergestalt/Gestaltwandel: `engine.applyForm`/`revertForm` (`c.form`; 2014 TP der Gestalt mit Übertrag, 2024 temporäre TP), Zustand „Verwandelt“; `statsOf` und die Kampfleiste nutzen den Statblock der Gestalt.
  - Wände (`zone.line` + `barrier`/`opaque`, Länge `len` in m): Platzieren mit zwei Klicks (Anfang, Richtung); `makeCtx` trägt sie in `grid.opaque` ein (Sicht, Flächen), `moveGrid` in `walk` (Bewegung).
  - Gegenzauber: `offerCounterspell` fragt Spieler in 18 m mit Sicht, bevor ein gegnerischer Zauber wirkt (2014 Grad oder Probe, 2024 KON‑Rettungswurf des Wirkers, dessen Platz dann erhalten bleibt).
  - `normalizeMonster` verliert `casting`, `speeds`, `sizeKey` – `combatantsFromMonsters` übernimmt sie; `statsOf` liest `casting` immer direkt aus dem Statblock.
  - `core/combat.js` (Zustand, Projektion, `mutateCombat` läuft serialisiert, `advanceTurn` → Engine über `setTurnEngine`), `core/tactics.js` (Bewegung, `lineOfSight`/`pointInSight`/`areaReaches`, `coverBetween`, Schablonen, `parseAttacks()`), `core/relay.js` (Ereignisse `act|dmg|move|endTurn|endConc|init|answer|quest`, nacheinander ausgewertet; SL‑Relais in `shell.js`), `views/battle.js` (Karte: Zielen mit Reichweite, Sichtlinie und Trefferchance, Ergebniskarten, Zonen, Protokoll), `views/battlebar.js` (Kampfleiste im BG3‑Stil), `ui/prompthost.js` (Reaktions‑Rückfragen), `views/combat.js` (Tracker).
- Karten & Kampf: Ribbon „Karten“ fragt „Karten oder Kampf?“; `maps.js` `openBattle()` springt zur laufenden Kampfkarte (`combat.mapId`), sonst wählt die SL eine Dungeon‑Karte. `params.play` öffnet den Dungeon‑Editor direkt im Spielmodus. Der Kampf‑Tracker (`combat`) hat keinen Ribbon‑Eintrag mehr (Kampfkarte → Liste, Befehle).
- Suche: `ui/palette.js` – eine Palette für Notizen **und** Befehle (`>` am Anfang = nur Befehle; Strg+K/O, Strg+P startet mit `>`).
- Chat: `views/table.js` `ChatPanel` wohnt in der rechten Seitenleiste (`codex.js` `RightSidebar`, Reiter `chat`, lazy geladen); Ungelesen‑Punkt über `ws.chatUnread` (`shell.js` `useChatUnread`). Der Spieltisch zeigt nur noch Szene, Initiative, Gruppe, Play‑by‑Post, Handouts.
- Graph: `views/graph.js` (2D; `clampView()` hält immer einen Knoten im Bild) und `views/graph3d.js` (dieselben Knoten als drehbare Kugelwolke, eigenes 3D‑Kräftelayout mit Startpositionen aus `layout2d`; umschaltbar über `settings.graph.dim`).
- Monsterwelten: `data/origins.js` (`ORIGINS`, `namesFor()`, `matchNames()`, `originOf()`), `data/monsternames.js` (generiert), Namensfeld mit Suchliste im Encounter‑Generator (`MonsterNameInput`), Bestiarium mit Welt‑Chips und „noch nicht im Bestiarium“ → `openView('encounter', { preset: { name, origin, ts } })`.
- KI‑Schlüssel: auch Spieler dürfen eigene Schlüssel eintragen (Einstellungen → KI, Aufgaben nur `rules`). Schlüssel liegen nur in `users/{uid}/private/settings` bzw. im Gerätespeicher und werden bei Kontowechsel (`ensureSettingsOwner`, auch offline) und Abmelden gelöscht – nie in Kampagnen‑Dokumente schreiben.
- Datenwerkzeuge: `tools/build-spells.mjs`, `tools/build-icons.mjs`, `tools/build-srd.mjs`, `tools/build-monsternames.mjs` erzeugen die `data/*`‑Dateien aus heruntergeladenen Quellen (Aufruf im Dateikopf).
- **CSS‑Klassen global eindeutig halten** – `.sm` (Zauberverwaltung) kollidierte mit `.stack.sm`/`size="sm"`, `.qr` (Würfelknöpfe) mit dem QR‑Code; beides hat Layouts zerlegt. Neue Bereiche mit eigenem Präfix benennen.

## Datenmodell (Firestore‑Pfade = IndexedDB‑Pfade)
```
users/{uid}                    Profil { name, kind: gm|player }
users/{uid}/campaigns/{cid}    Kampagnen-Index des Nutzers
users/{uid}/characters/{id}    Charakterbögen (campaignId verknüpft)
users/{uid}/notes/{id}         Tagebuch (bleibt über Kampagnen erhalten)
users/{uid}/archive/{id}       KI-Verlauf
users/{uid}/private/settings   synchronisierte Einstellungen
invites/{code}                 { campaignId, role }
campaigns/{cid}                { name, ownerUid, folders[], folderMeta{pfad:{color,icon,label}}, world, scene, pbpWaiting[] }
campaigns/{cid}/maps/{id}      type world|battle|scrawl – scrawl: { w, h, style, outdoor, ground, floorTex, wallTex, wallW, dark, soft, shapes[], terrain[], objects[], lights[], labels[], fog, bake?, thumb } (Punkte flach: pts:[x1,y1,x2,y2,…], Firestore kennt keine verschachtelten Arrays)
campaigns/{cid}/members/{uid}  { role: gm|player, characterId }
campaigns/{cid}/notes|sessions|quests|maps|pins|tokens|handouts|files   (visibility: gm|players)
campaigns/{cid}/secrets|gm|trash|monsters|encounters                    (nur SL)
campaigns/{cid}/combat/{gm|public}  chat  whispers  posts  signals  party
campaigns/{cid}/tokens/{id}    { mapId, x, y, size, label, color, ownerUid, visibility, charId?, combatantId?, mref:{src:srd|bst,id}?, art:{icon,color}? }
campaigns/{cid}/party/{id}     geteilte Kartenebene: { kind: tpl (Zauberfläche) | ping, mapId, … } – alle Mitglieder dürfen schreiben
campaigns/{cid}/signals/{uid}  { type, ts, events:[{id,type,…}] } Spieler → SL (act, dmg, move, endTurn, endConc, init, answer, quest)
```
- Kampf: `combat/gm` enthält `mapId`, `zones`, `results` (Ergebniskarten), `prompts` (Rückfragen an Spieler), Kämpfer mit `tokenId`, `eco`, `effects`, `conditions`, `reaction`, `turnNo`, `dead`/`stable`/`surprised`, `concentration: { id, name, spellId }`; `combat/public` projiziert NSC ohne TP/RK (nur `hpState`, `art`) und das Protokoll ohne SL‑Zeilen. Firestore kennt kein `undefined` und keine verschachtelten Listen → `saveCombat` räumt per JSON auf, Bewegungswege gehen flach (`path: [x1, y1, x2, y2 …]`).
- Bestiarium: `monsters/{id}.origin` = Welt aus `ORIGINS` (ältere SRD‑Kopien: `srdId` ⇒ D&D).
- Quests: Spieler dürfen bei freigegebenen Quests nur `status`, `updatedAt`, `movedBy` ändern (Regeln); scheitert das (Regeln noch nicht veröffentlicht), geht ein `quest`‑Signal an das SL‑Relais.
- Spieler dürfen an Tokens nur `x`/`y` ändern (Regeln) – Bewegungsverbrauch zählt deshalb lokal pro Zug.
- Spieler‑Abfragen **müssen** `where visibility == 'players'` enthalten (Regeln sind keine Filter) → `useVisibleCol()`.
- Bilder: `core/files.js` speichert Data‑URLs in ≤ 900‑KB‑Stücken (`files/{id}/chunks/{n}`) – kein Firebase Storage nötig.
- **Neue Sammlung?** → `firebase/firestore.rules` ergänzen, ggf. `SUBCOLLECTIONS` in `app.js` (Löschen) und `COLLS` in `views/importexport.js` (Backup/Migration).

## Neue Ansicht hinzufügen
1. `js/views/xyz.js` mit `export function XyzView({ params, active, tabId })`, Rahmen über `ViewFrame`.
2. In `js/ui/shell.js`: `LOADERS.xyz` + Eintrag in `VIEWS` (`gm: true` für SL‑only), optional Ribbon + `COMMANDS` in `ui/palette.js`.
3. `node tools/check-imports.mjs` – prüft alle benannten Importe und die VIEWS‑Registry.

## Testen
- `node tools/serve.mjs` → http://localhost:5173 (bzw. Preview „weltenschmiede“ aus `.claude/launch.json`).
- Syntax: `node --check` pro Datei; Importe: `node tools/check-imports.mjs`.
- Demo‑Modus (Einstellungen → KI) liefert feste Antworten → Generatoren ohne Schlüssel testen.
- Ohne Konto testen: `http://localhost:5173/#/offline` (lokale IndexedDB, Nutzer `local`, Rolle Spielleitung). Zurück zur Anmeldung: Konto‑Menü → „Offline‑Modus beenden“.
- Im Browser Ansichten per `(await import('/js/core/workspace.js')).openView('forge')` öffnen.

## MCP-Server (`mcp/`)
Cloudflare Worker, damit Claude die App als Connector bedienen kann (`mcp/README.md`). OAuth‑Anmeldung mit Name + Geheimwort → Firebase‑Refresh‑Token versiegelt im Token (`SEAL_SECRET`, zustandslos), Zugriffe per Firestore‑REST mit dem Nutzerkonto (Regeln gelten). Werkzeuge in `mcp/src/tools.js`, Kartenwerkstatt in `mcp/src/maps.js` (`karten_katalog`, `karte_lesen`, `karte_erstellen`; Katalog/Generatoren kommen automatisch aus der App, neue Elementlisten der Karte ggf. in `LISTS` eintragen) – bei neuen Sammlungen/Feldern mitpflegen. Bündelt `js/lib/markdown.js`, `js/lib/dice.js`, `js/ui/statblock.js` und SRD‑Daten (diese Module dürfen beim Laden kein DOM anfassen). Veröffentlichen: `powershell -ExecutionPolicy Bypass -File mcp\deploy.ps1`.

## Veröffentlichen
`powershell -ExecutionPolicy Bypass -File tools\publish.ps1 -Message "…"` – aktualisiert Dateiliste + `VERSION` in `sw.js`, committet, pusht. `.ps1`‑Dateien als UTF‑8 **mit BOM** speichern (Windows PowerShell 5.1 liest sie sonst als ANSI).
Geänderte `firebase/firestore.rules` veröffentlicht die SL selbst (Firebase‑Konsole → Firestore → Regeln → einfügen → Veröffentlichen).
