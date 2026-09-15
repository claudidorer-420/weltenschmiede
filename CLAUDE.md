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
- `js/core/prompts.js` – alle deutschen Prompts + Codex‑Kontext.
- `js/ui/aiout.js` – `useGeneration()` (Streaming, Nachbessern, Fortsetzen) + Speicher‑Dialoge.
- `js/ui/account.js` – Konto‑Menü (Avatar im Ribbon/Übersicht), Abmelden (optional mit Gerätebereinigung), Rolle wechseln, Einstellungen als Dialog.
- Start: `views/auth.js` (Rollenwahl Spielleitung/Spieler → Name + Geheimwort) → `views/home.js` `Lobby` (ohne offene Kampagne) → Kampagne. Firebase‑Config ist in `js/config.js` fest eingebaut; `#/offline` startet den Offline‑Modus (lokal, ohne Konto).
- Würfel: `lib/dice.js` `rollDetailed()` (jeder physische Würfel + Effekte wie Vorteil, Halblingsglück, Verlässliches Talent, Großwaffen …), `core/rolls.js` `prepareRoll/commitRoll/doRoll`, `ui/dice3d.js` (3D‑Würfel ohne Bibliothek: Polyeder, Licht, Physik mit Teilschritten, Zielfläche zum Betrachter), `ui/dicetray.js` (`DiceTray` in der Würfel‑Ansicht, `DiceOverlay` = Würfel über der App + Ergebniskarten unten links).
- Regelwerk: wird beim Anlegen der Kampagne gewählt (`campaigns/{cid}.settings.rulesVersion`) und gilt für alle – `rulesEdition()` / `useEdition()` aus `core/app.js`. Spieler haben keine Regelwerk‑Einstellung.
- Charaktere: `data/chargen.js` (Völker/Spezies, Hintergründe, Klassen je Regelstand, Talente, Rüstungen, Waffen, Zaubertabellen, `charMods()`), `views/charwizard.js` (Assistent, Stufenaufstieg mit Pflicht‑Zauberwahl, `derive()`, Übernahme alter Bögen), `views/characters.js` (Bogen im D&D‑Beyond‑Aufbau: Werte fest, Spielstand änderbar; Persönlichkeit nur im Korrektur‑Modus).
- Zauber: `data/spells-2014.js` / `spells-2024.js` (generiert, SRD 5.1/5.2.1 deutsch, CC‑BY‑4.0), `data/spells.js` (Laden, Klassenlisten, `spellNeeds()` je Klasse: known/prepare/book, Anzeige‑Helfer), `views/spellbook.js` (`SpellManager`, `checkSpells()`, `openSpellManager`, `SpellDetail`). Eintrag im Bogen: `{ id, ref, name, level, cls, prepared, book, always, arcanum, source }`.
- Bilder: `data/artmap.js` (Zuordnung Zauber/Gegenstände/Kreaturen → Symbolname), `data/gameicons.js` (generiert, game-icons.net CC BY 3.0), `ui/art.js` (`SpellArt`, `ItemArt`, `MonsterArt`, `GameIcon`, `giImage` für Canvas). Gegenstände: `data/items.js` (Katalog mit Preis/Gewicht, Reichweiten), `data/magicitems-srd.js`; Monster: `data/monsters-srd.js` (317 SRD‑Monster deutsch) · `views/bestiary.js` (Kompendium + eigenes Bestiarium, KI‑Porträt).
- Karten: `views/mapeditor.js` (Dungeon‑Editor, Typ `scrawl`: Formen → Maske → Wände/Schraffur per Dilatation, Objekte als Vektorzeichnungen, Generatoren, Export, Spielmodus; `buildGrid()` = begehbare Felder/schwieriges Gelände) · `views/maps.js` (Liste, Welt‑/Rasterkarten, Weiche `MapView`).
- Kampf: `core/combat.js` (Zustand, `advanceTurn`, `applyHp`, `mutateCombat`, `combatantForToken`), `core/tactics.js` (Bewegung nach 5e, Entfernungen, Flächen‑Schablonen, `parseAttacks()` aus Statblöcken), `core/relay.js` (Spieler → SL: `sendEvent`, SL‑Relais `startGmRelay` läuft in `shell.js`), `views/battle.js` (Kampf‑Ebene der Karte: Initiativeleiste, Token‑Bilder/TP/Zustände, Bewegungsreichweite, Zielen, Schablonen, Pings, Monster platzieren) · `views/combat.js` (Tracker).
- Datenwerkzeuge: `tools/build-spells.mjs`, `tools/build-icons.mjs`, `tools/build-srd.mjs` erzeugen die `data/*`‑Dateien aus heruntergeladenen Quellen (Aufruf im Dateikopf).

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
campaigns/{cid}/maps/{id}      type world|battle|scrawl – scrawl: { w, h, style, shapes[], terrain[], objects[], labels[], fog, thumb } (Punkte flach: pts:[x1,y1,x2,y2,…], Firestore kennt keine verschachtelten Arrays)
campaigns/{cid}/members/{uid}  { role: gm|player, characterId }
campaigns/{cid}/notes|sessions|quests|maps|pins|tokens|handouts|files   (visibility: gm|players)
campaigns/{cid}/secrets|gm|trash|monsters|encounters                    (nur SL)
campaigns/{cid}/combat/{gm|public}  chat  whispers  posts  signals  party
campaigns/{cid}/tokens/{id}    { mapId, x, y, size, label, color, ownerUid, visibility, charId?, combatantId?, mref:{src:srd|bst,id}?, art:{icon,color}? }
campaigns/{cid}/party/{id}     geteilte Kartenebene: { kind: tpl (Zauberfläche) | ping, mapId, … } – alle Mitglieder dürfen schreiben
campaigns/{cid}/signals/{uid}  { type, ts, events:[{id,type,…}] } Spieler → SL (Zugende, Initiative, Angriff, Fläche)
```
- Kampf: `combat/gm` enthält `mapId`, Kämpfer mit `tokenId`; `combat/public` projiziert NSC ohne Werte (nur `hpState`, `art`).
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

## Veröffentlichen
`powershell -ExecutionPolicy Bypass -File tools\publish.ps1 -Message "…"` – aktualisiert Dateiliste + `VERSION` in `sw.js`, committet, pusht.
