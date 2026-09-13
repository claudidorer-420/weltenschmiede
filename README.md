# ⚒️ Weltenschmiede

**Deine D&D‑5e‑Kampagnen‑Werkstatt** – ein Codex im Obsidian‑Stil, KI‑Weltenbau mit frei wählbaren Modellen, Encounter mit echten Statblocks, Karten, Charakterbögen und ein Online‑Spieltisch. Läuft als App auf Handy, Tablet und PC, ohne Build‑Schritt, gehostet über GitHub Pages.

---

## Was die App kann

| Bereich | Highlights |
|---|---|
| **Codex** (wie Obsidian) | Dateiexplorer mit Ordnern, Tabs mit Vor/Zurück, Lesen/Bearbeiten, `[[Wikilinks]]` mit Autovervollständigung, Rückverweise & unverlinkte Erwähnungen, Gliederung, Eigenschaften (Frontmatter), `#Tags`, Callouts, Aufgabenlisten, Bilder per Einfügen/Ziehen, Papierkorb, Vorlagen |
| **Graph‑Ansicht** | Kraftlayout wie in Obsidian, Zoom/Pinch, Farbgruppen – deine Farbcodes wie „Hügelgrab (**Blau 2**)“ werden automatisch eingefärbt, lokaler Graph pro Notiz |
| **Weltenschmiede (KI)** | 12 Generator‑Typen (Ort, Taverne, Laden & Markt, Reich, Dungeon, Fraktion, Gottheit, Quest, Gegenstand, Fest, Legende, freie Anfrage), **kombinierbare Themenblöcke** mit Gewichtung, eigene Blöcke, Rezepte, Codex‑Notizen als Kontext, Diktat, Inspirationsbilder, Preislisten im cp/sp/gp‑Stil, Bemal‑Guide für Miniaturen, Streaming, „Nachbessern“, „Fortsetzen“, Bild generieren |
| **Speichern** | In den Codex (legt verlinkte NPCs/Orte automatisch als eigene Notizen an), an Notiz anhängen, Handout an Spieler, Markdown, Teilen, E‑Mail, Drucken/PDF – und alles automatisch im **Archiv der Welten** |
| **NPC‑Schmiede** | Blitz‑NPCs offline (Namen, Aussehen, Marotte, Motiv, Geheimnis) + KI‑Dossiers mit Stimme, Zitaten, Bemal‑Guide, **Porträt** und **Statblock** |
| **Encounter** | Monster aus jeder Welt (Witcher, Herr der Ringe …) lore‑getreu in 5e, **Schwierigkeit 1–10 von der KI *und* nach DMG‑Formel** (2014 oder 2024), Taktik, Gelände, Beute, Bestiarium, SRD‑Import |
| **Kampf‑Tracker** | Initiative, Runden, TP/Temp‑TP, Zustände mit Dauer, Konzentrations‑Hinweis, Todesrettungswürfe, legendäre Aktionen, Statblocks mit klickbaren Würfen; Spieler sehen die Reihenfolge und beenden ihren Zug selbst |
| **Karten** | Weltkarte mit Pins (Farbcode‑Notizen per Antippen platzieren), Maßstab & Maßband; Battlemaps mit Gelände‑Pinsel, Generatoren (Dungeon, Höhle, Wald, Taverne), Tokens, **Nebel des Krieges**, KI‑gemalte Karten |
| **Spieltisch** | Live‑Chat mit Würfeln (`/r 1d20+5`), Flüstern an die SL, Szenen mit Bild, Gruppenübersicht, Initiative; **Play‑by‑Post** mit „Wer ist dran?“ für asynchrones Spielen; Handouts |
| **Kampagnen‑Manager** | Sitzungen (Lazy‑DM‑Vorbereitung, Live‑Notizen, KI‑Rückblick „Was bisher geschah“), Quests als Kanban, Mitspieler & Einladungen |
| **Charaktere & Tagebuch** | 5e‑Charakterbogen mit klickbaren Würfen; Charaktere und Spieler‑Notizen gehören dem Spieler und **bleiben für die nächste Kampagne erhalten** |
| **Werkzeuge** | Würfel (Pool, Vorteil, Makros), Zufallsgeneratoren (Namen, Tavernen, Märkte mit Preisfaktor, Gerüchte, Wetter, Beute …), Regel‑Nachschlagewerk + KI‑Regelfragen, **Orakel** (Chat mit deinem Codex, findet Widersprüche) |
| **KI flexibel** | Google Gemini, Anthropic Claude, OpenAI, OpenRouter, eigener Server (Ollama/LM Studio) – Modell pro Aufgabe wählbar, mit Empfehlungen |

---

## Schnellstart

### Variante A – sofort am PC ausprobieren
```powershell
node tools/serve.mjs
```
Dann <http://localhost:5173> öffnen → „Beispiel laden“. Daten bleiben im Browser dieses PCs.

### Variante B – auf allen Geräten (GitHub Pages)
```powershell
powershell -ExecutionPolicy Bypass -File tools\setup-github.ps1
```
Das Skript installiert bei Bedarf die GitHub CLI, meldet dich im Browser an, legt das Repository an, lädt alles hoch und schaltet GitHub Pages ein. Danach ist die App unter `https://<dein-name>.github.io/weltenschmiede/` erreichbar.

> Kostenlose GitHub Pages brauchen ein **öffentliches** Repository. Der Code enthält keine Geheimnisse: KI‑Schlüssel bleiben in deinem Browser, deine Kampagnen in deiner eigenen Firebase‑Datenbank (bzw. lokal).

**Als App installieren:** Adresse auf dem Gerät öffnen → Chrome/Edge: Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ · iPad/iPhone (Safari): Teilen → „Zum Home‑Bildschirm“.

### Variante C – Sync zwischen Geräten + Mitspieler (Firebase, kostenlos)
Siehe [Cloud einrichten](#cloud-einrichten-firebase). Ohne Cloud funktioniert alles lokal pro Gerät.

---

## KI‑Schlüssel & Modelle

In der App: **Einstellungen → KI & Modelle**. Schlüssel eintragen, „Testen“, dann „Empfehlungen übernehmen“.

| Anbieter | Schlüssel holen | Hinweis |
|---|---|---|
| Google Gemini | <https://aistudio.google.com/apikey> | Flash‑Modelle mit Gratis‑Kontingent – bester Einstieg |
| Anthropic Claude | <https://console.anthropic.com/settings/keys> | Beste Texte (Opus 5), sehr gute Statblocks (Sonnet 5) |
| OpenAI | <https://platform.openai.com/api-keys> | GPT‑5, Bilder mit GPT Image 1 |
| OpenRouter | <https://openrouter.ai/keys> | Ein Schlüssel für hunderte Modelle, auch kostenlose |
| Eigener Server | z. B. Ollama `http://localhost:11434/v1` | Läuft nur auf dem Gerät mit dem Server (`OLLAMA_ORIGINS="*"` setzen) |

**Empfehlungen pro Aufgabe** (die App wählt automatisch das beste verfügbare Modell):

| Aufgabe | Top‑Empfehlung | Alternativen | Warum |
|---|---|---|---|
| Weltenschmiede | Claude Opus 5 | Gemini Pro, GPT‑5, Gemini Flash (günstig) | Kreativität & lange, stimmige Texte |
| Encounter & Statblocks | Claude Sonnet 5 | Opus 5, Gemini Pro, GPT‑5 | Regelgenau + sauberes JSON |
| NPC‑Schmiede | Claude Sonnet 5 | Gemini Flash, Opus 5 | Mittlere Länge, viel Persönlichkeit |
| Schnelle Helfer | Gemini Flash‑Lite | Claude Haiku 4.5, Gemini Flash | Kurz & günstig |
| Sitzungs‑Rückblick | Gemini Flash | Sonnet 5, GPT‑5 mini | Viel Eingabe, niedrige Kosten |
| Orakel (Codex‑Chat) | Claude Sonnet 5 | Gemini Pro (riesiger Kontext), Opus 5 | Viel Kontext, widerspruchsfrei |
| Bilder | Gemini 2.5 Flash Image | GPT Image 1 | Porträts, Szenen, Karten |

Unter jedem Generator kannst du das Modell pro Anfrage wechseln („Modell‑Chip“). „Modelle laden“ holt die aktuelle Liste direkt vom Anbieter. Der **Demo‑Modus** liefert Beispieltexte ohne Schlüssel.

Bei Claude Opus 5 / Fable 5.1 ist der serverseitige Fallback aktiv: Lehnt das Modell eine Anfrage aus Sicherheitsgründen ab, beantwortet sie automatisch ein anderes Claude‑Modell.

---

## Cloud einrichten (Firebase)

Einmalig ca. 10 Minuten. Danach synchronisieren Handy, Tablet und PC, und Mitspieler können per Code beitreten – **ohne E‑Mail**, nur mit Name + Geheimwort.

1. <https://console.firebase.google.com> → **Projekt hinzufügen** (Google Analytics nicht nötig).
2. **Build → Authentication → Jetzt starten** → Anmeldemethode **E‑Mail/Passwort** aktivieren.
   *(Die App erzeugt intern Pseudo‑Adressen aus dem Namen – es werden nie E‑Mails verschickt.)*
3. **Build → Firestore Database → Datenbank erstellen** → Standort `europe-west3` (Frankfurt) → Produktionsmodus.
4. **Firestore → Regeln** → den kompletten Inhalt von [`firebase/firestore.rules`](firebase/firestore.rules) einfügen → **Veröffentlichen**.
5. **Projekteinstellungen (Zahnrad) → Allgemein → App hinzufügen → Web (`</>`)** → die `firebaseConfig` kopieren.
6. Die Konfiguration in [`js/config.js`](js/config.js) eintragen (empfohlen – dann müssen Mitspieler nichts einrichten) **oder** in der App unter Einstellungen → Cloud einfügen.
7. **Authentication → Einstellungen → Autorisierte Domains** → `<dein-name>.github.io` hinzufügen.
8. Änderungen veröffentlichen: `powershell -ExecutionPolicy Bypass -File tools\publish.ps1 -Message "Firebase"`.

Beim ersten Öffnen legst du einen Zugang an (Name + Geheimwort, mind. 6 Zeichen). Mit denselben Daten meldest du dich auf allen Geräten an. Lokale Kampagnen überträgst du unter **Einstellungen → Cloud** mit einem Klick.

**Kosten:** Der kostenlose Spark‑Tarif reicht für private Runden locker (1 GB Speicher, 50.000 Lesezugriffe/Tag). Bilder werden komprimiert in Firestore gespeichert – Firebase Storage (kostenpflichtig) wird nicht benötigt.

---

## Obsidian‑Vault importieren

**Import & Export** (Ribbon unten oder Befehlspalette):

- **Tablet/Handy:** Den Vault‑Ordner in der Dateien‑App als ZIP komprimieren (Samsung „Eigene Dateien“: lange drücken → Komprimieren) → „ZIP wählen“.
- **PC:** „Ordner wählen“ oder ZIP.

Erhalten bleiben: Ordnerstruktur, `[[Links|Aliase]]`, `![[Bilder.png]]`, Frontmatter/Eigenschaften, `#Tags`, Callouts, Tabellen. `.obsidian` und `.trash` werden übersprungen. Notizen mit `sichtbarkeit: spieler` im Frontmatter werden direkt für Spieler freigegeben.

**Farbcodes:** Notizen wie „Hügelgrab (Blau 2)“ werden im Graph und im Dateiexplorer eingefärbt und erscheinen auf Weltkarten im Bereich „Pins aus Farbcodes“ – antippen, auf die Karte tippen, fertig.

Zurück nach Obsidian geht es jederzeit mit **„Als Obsidian‑Vault (ZIP)“**.

---

## Mitspieler

**Mitspieler & Einladungen** (Quests/Kampagnen‑Menü): Code oder Link teilen. Mitspieler öffnen den Link, wählen Name + Geheimwort und sind drin.

- **Spieler** sehen nur, was du freigibst (Schloss‑/Personen‑Symbol an jeder Notiz, Karte, Quest, Sitzung). Geheime Callouts `> [!gm]` werden ausgeblendet; echte Geheimnisse gehören in das Feld **SL‑Geheimnisse** unter jeder Notiz (technisch getrennt gespeichert).
- **Co‑SL** sehen und bearbeiten alles.
- Charakterbögen und das **Tagebuch** gehören den Spielern selbst und bleiben über Kampagnen hinweg erhalten.
- Mit **Spieleransicht** (Statusleiste unten rechts) siehst du die App mit den Augen deiner Spieler.

---

## Aktualisieren

Nach Änderungen am Code:
```powershell
powershell -ExecutionPolicy Bypass -File tools\publish.ps1 -Message "Was sich geändert hat"
```
Das Skript prüft alle Module, erhöht die Cache‑Version (alle Geräte laden die neue Version) und lädt zu GitHub hoch.

Lokales Testen im WLAN (z. B. am Tablet): `node tools/serve.mjs --lan` – Mikrofon, Installation und Offline‑Modus funktionieren allerdings nur über HTTPS (also die GitHub‑Pages‑Adresse) oder `localhost`.

---

## Datenschutz & Sicherheit

- **KI‑Schlüssel** liegen nur im Browser des jeweiligen Geräts (optional verschlüsselt übertragen in deinen privaten Firestore‑Bereich). Anfragen gehen direkt vom Browser an den Anbieter.
- **Die Firebase‑Konfiguration ist nicht geheim** – geschützt wird über Anmeldung + `firestore.rules`.
- **Backups:** Import & Export → „Komplett‑Backup (JSON)“ bzw. „Als Obsidian‑Vault“. Lokal gespeicherte Daten können vom Browser gelöscht werden, wenn der Speicher knapp wird – Einstellungen → Daten → „Dauerhaft speichern“ anfragen oder die Cloud nutzen.

---

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| „Kein KI‑Modell eingerichtet“ | Einstellungen → KI & Modelle → Schlüssel eintragen (oder Demo‑Modus) |
| Claude: „Schlüssel ungültig“ | Schlüssel in der Anthropic‑Konsole prüfen, Guthaben aufladen |
| Gemini 429 / Limit | Gratis‑Kontingent erschöpft → kurz warten oder Flash‑Lite/anderes Modell |
| Anmeldung: „nicht aktiviert“ | Firebase → Authentication → E‑Mail/Passwort aktivieren |
| Anmeldung: „Domain nicht freigegeben“ | Firebase → Authentication → Einstellungen → Autorisierte Domains |
| „Keine Berechtigung“ | `firebase/firestore.rules` vollständig in Firestore → Regeln veröffentlichen |
| Alte Version wird angezeigt | Seite neu laden (der Service Worker aktualisiert beim nächsten Start); ggf. `publish.ps1` erneut |
| Ollama nicht erreichbar | Ollama mit `OLLAMA_ORIGINS="*"` starten; funktioniert nur auf dem Gerät, auf dem Ollama läuft |

---

## Projektstruktur

```
index.html · sw.js · manifest.webmanifest · css/app.css
js/main.js            Einstieg
js/config.js          Firebase-Konfiguration (optional)
js/lib/               Preact/htm, Markdown, Würfel, ZIP, Bilder, Icons, Helfer
js/core/              Zustand, Datenbank (IndexedDB/Firestore), KI, Prompts, Kampf, Gruppe …
js/data/              5e-Regeldaten, Themenblöcke, Zufallstabellen, Vorlagen, Kartengeneratoren
js/ui/                Hülle (Tabs/Seitenleisten), Komponenten, Statblock, Befehlspalette
js/views/             Alle Module (Codex, Graph, Weltenschmiede, Encounter, Karten, Spieltisch …)
firebase/             Sicherheitsregeln
tools/                serve.mjs (lokal), setup-github.ps1, publish.ps1, check-imports.mjs
```

## Ideen für später

Geräusch‑/Musik‑Kulisse per WebAudio · Reiseplaner mit Tagesetappen auf der Weltkarte · In‑Game‑Kalender & Zeitleiste · Push‑Benachrichtigungen für Play‑by‑Post (Firebase Cloud Messaging) · Versionsverlauf pro Notiz · QR‑Code für Einladungen · Zauber‑Datenbank (SRD).

---

*Enthält Material aus dem System Reference Document 5.1 („SRD 5.1“) von Wizards of the Coast LLC (CC‑BY‑4.0). „Dungeons & Dragons“ ist eine Marke von Wizards of the Coast – dies ist ein privates Fan‑Werkzeug ohne Verbindung zu Wizards of the Coast.*
