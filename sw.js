// Service Worker der Weltenschmiede
// - App-Dateien: "network first" (Updates greifen sofort), offline aus dem Cache
// - CDN-Bibliotheken (versionierte URLs): "cache first"
// tools/publish.ps1 erhöht bei jeder Veröffentlichung die VERSION und aktualisiert die Dateiliste.
const VERSION = 'ws-2026-09-19-0618';
const CDN_CACHE = 'ws-cdn-v1';
// Kartenbausteine (Texturen, Stempel) sind unveränderlich und überleben Updates
const ASSET_CACHE = 'ws-assets-v1';
// @@FILES-START@@
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './js/config.js',
  './js/core/actions.js',
  './js/core/ai.js',
  './js/core/app.js',
  './js/core/archive.js',
  './js/core/combat.js',
  './js/core/db.js',
  './js/core/db-cloud.js',
  './js/core/db-local.js',
  './js/core/engine.js',
  './js/core/files.js',
  './js/core/groups.js',
  './js/core/hooks.js',
  './js/core/panels.js',
  './js/core/party.js',
  './js/core/prompts.js',
  './js/core/react.js',
  './js/core/relay.js',
  './js/core/rolls.js',
  './js/core/settings.js',
  './js/core/store.js',
  './js/core/tactics.js',
  './js/core/userassets.js',
  './js/core/workspace.js',
  './js/data/artmap.js',
  './js/data/blocks.js',
  './js/data/chargen.js',
  './js/data/demo.js',
  './js/data/gameicons.js',
  './js/data/items.js',
  './js/data/magicitems-srd.js',
  './js/data/mapassets.js',
  './js/data/mapgen.js',
  './js/data/monsternames.js',
  './js/data/monsters-srd.js',
  './js/data/origins.js',
  './js/data/rules5e.js',
  './js/data/spellfx.js',
  './js/data/spells.js',
  './js/data/spells-2014.js',
  './js/data/spells-2024.js',
  './js/data/tables.js',
  './js/data/templates.js',
  './js/data/texvars.js',
  './js/lib/dice.js',
  './js/lib/gridfind.js',
  './js/lib/icons.js',
  './js/lib/image.js',
  './js/lib/markdown.js',
  './js/lib/notes.js',
  './js/lib/preact.js',
  './js/lib/util.js',
  './js/lib/zip.js',
  './js/main.js',
  './js/ui/account.js',
  './js/ui/aiout.js',
  './js/ui/art.js',
  './js/ui/components.js',
  './js/ui/dice3d.js',
  './js/ui/dicetray.js',
  './js/ui/frame.js',
  './js/ui/palette.js',
  './js/ui/prompthost.js',
  './js/ui/shell.js',
  './js/ui/statblock.js',
  './js/views/archive.js',
  './js/views/auth.js',
  './js/views/battle.js',
  './js/views/battlebar.js',
  './js/views/bestiary.js',
  './js/views/campaign.js',
  './js/views/characters.js',
  './js/views/charwizard.js',
  './js/views/codex.js',
  './js/views/combat.js',
  './js/views/dice.js',
  './js/views/encounter.js',
  './js/views/forge.js',
  './js/views/generators.js',
  './js/views/graph.js',
  './js/views/graph3d.js',
  './js/views/home.js',
  './js/views/importexport.js',
  './js/views/journal.js',
  './js/views/mapeditor.js',
  './js/views/mapgen.js',
  './js/views/maprender.js',
  './js/views/maps.js',
  './js/views/npc.js',
  './js/views/oracle.js',
  './js/views/rules.js',
  './js/views/settings.js',
  './js/views/spellbook.js',
  './js/views/table.js',
];
// @@FILES-END@@

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== CDN_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin && url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req, { ignoreSearch: true });
          if (hit) return hit;
          // Nur Seitenaufrufe bekommen die App-Hülle – nie JS/CSS (sonst MIME-Fehler statt klarer Meldung)
          if (req.mode === 'navigate') return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
          return Response.error();
        })
    );
    return;
  }

  const isCdn = url.hostname === 'cdn.jsdelivr.net' || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
  if (isCdn) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
  }
});
