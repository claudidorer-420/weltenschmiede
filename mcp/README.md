# Weltenschmiede – MCP-Server

Damit bedienst du die Weltenschmiede direkt aus Claude (claude.ai, Desktop-App, Handy): Codex durchsuchen und schreiben,
Quests und Sitzungen pflegen, Handouts und Szenen zeigen, im Chat schreiben und würfeln, Charaktere und den Kampf ansehen,
Monster und Zauber nachschlagen. Änderungen erscheinen **sofort live** in der App bei allen Mitspielern.

GitHub Pages kann nur statische Dateien ausliefern, deshalb läuft der Server als kostenloser **Cloudflare Worker**.
Er speichert nichts: Du meldest dich einmal mit **Name + Geheimwort** an (wie in der App), alle Zugriffe laufen mit deinem
Konto durch die Firestore-Regeln – Spieler-Konten sehen also auch hier nur Freigegebenes.

## Einrichten (einmalig, ca. 5 Minuten)

1. Kostenloses Konto auf <https://dash.cloudflare.com/sign-up> anlegen.
2. Im Projektordner ausführen:
   ```
   powershell -ExecutionPolicy Bypass -File mcp\deploy.ps1
   ```
   Beim ersten Mal öffnet sich der Browser zur Cloudflare-Anmeldung. Am Ende steht die Adresse,
   z. B. `https://weltenschmiede-mcp.<dein-name>.workers.dev/mcp`.
3. In Claude: **Einstellungen → Connectors → Benutzerdefinierten Connector hinzufügen**
   - Name: `Weltenschmiede`
   - MCP-Server-URL: die Adresse aus Schritt 2 (mit `/mcp`)
4. **Verbinden** → Anmeldeseite der Weltenschmiede → Name + Geheimwort → „Zugriff erlauben“.

Danach im Chat z. B.: „Zeig mir alle offenen Quests in Reiche von Arkonis“, „Leg eine NSC-Notiz für den Schmied
Borin im Ordner Personen an und verlinke ihn mit [[Eisenfurt]]“, „Würfel 4d6kh3 sechsmal und poste es in den Chat“.

## Werkzeuge

| Bereich | Werkzeuge |
|---|---|
| Konto | `kampagnen`, `kampagne`, `kampagne_aendern` |
| Codex | `notizen_suchen`, `notiz_lesen`, `notiz_erstellen`, `notiz_bearbeiten` (ersetzen, anhängen, umbenennen mit Link-Anpassung, SL-Geheimnis), `notiz_loeschen` (Papierkorb), `ordner` |
| Kampagne | `sitzungen`, `sitzung_speichern`, `quests`, `quest_speichern` |
| Spieltisch | `handouts`, `handout_teilen`, `szene_setzen`, `chat_lesen`, `chat_senden` (Chat, Flüstern, Play-by-Post), `wuerfeln` |
| Regeln | `charaktere`, `charakter_lesen`, `charakter_aendern`, `monster_suchen`, `monster_speichern`, `zauber_suchen`, `kampf_status` |
| Karten | `karten`, `karten_katalog` (alle Stempel, Bauteile, Texturen, Gelände, Generatoren, Streu-Sets, Stile + Formate), `karte_lesen` (Elemente mit IDs + Textvorschau), `karte_erstellen` (neu oder ändern: Generator, Einstellungen, Größe/Verschieben, hinzufügen/ändern/entfernen, streuen) |
| Experte | `daten_lesen`, `daten_schreiben`, `daten_loeschen` (beliebige Firestore-Pfade, Regeln gelten) |

## Entwickeln

- Code: `src/index.js` (OAuth + MCP-Protokoll), `src/tools.js` (Werkzeuge), `src/firestore.js` (Firebase REST), `src/seal.js`.
  Nutzt `js/lib/markdown.js`, `js/lib/dice.js`, SRD-Monster/-Zauber direkt aus der App (Wrangler bündelt sie).
- Lokal: `.dev.vars` mit `SEAL_SECRET=<mind. 32 Zeichen>` anlegen, dann `npx wrangler@4 dev` → <http://127.0.0.1:8787>.
- Karten: `src/maps.js` liest Katalog, Stile, Generatoren und Streu-Sets direkt aus `js/data/mapassets.js`, `js/views/maprender.js` und `js/views/mapgen.js` – neue Objekte/Texturen/Generatoren sind nach dem nächsten Push automatisch im Connector. Unbekannte Felder an Elementen und Einstellungen werden durchgereicht.
- Neues Werkzeug: in `src/tools.js` mit `tool(name, titel, beschreibung, schema, hinweise, handler)` eintragen, dann `deploy.ps1`.
- Sicherheit: Token sind mit `SEAL_SECRET` (AES-GCM) versiegelt. Neues Geheimnis setzen
  (`npx wrangler@4 secret put SEAL_SECRET`) meldet alle Verbindungen ab. Das Geheimwort in der App ändern tut das ebenfalls.
  Rücksprung-Adressen nach der Anmeldung sind auf `ALLOWED_REDIRECT_HOSTS` (wrangler.toml) beschränkt.
