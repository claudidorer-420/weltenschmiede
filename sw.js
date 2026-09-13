// Service Worker der Weltenschmiede
// - App-Dateien: "network first" (Updates greifen sofort), offline aus dem Cache
// - CDN-Bibliotheken (versionierte URLs): "cache first"
// tools/publish.ps1 erhöht bei jeder Veröffentlichung die VERSION und aktualisiert die Dateiliste.
const VERSION = 'ws-2026-09-13-2';
const CDN_CACHE = 'ws-cdn-v1';
// @@FILES-START@@
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icons/icon.svg', './js/config.js', './js/main.js',
  './js/lib/preact.js', './js/lib/util.js', './js/lib/icons.js', './js/lib/markdown.js', './js/lib/dice.js', './js/lib/zip.js', './js/lib/image.js',
  './js/core/store.js', './js/core/db-local.js', './js/core/db-cloud.js', './js/core/db.js', './js/core/settings.js', './js/core/ai.js',
  './js/core/files.js', './js/core/app.js', './js/core/workspace.js', './js/core/rolls.js', './js/core/hooks.js', './js/core/groups.js',
  './js/core/prompts.js', './js/core/archive.js', './js/core/party.js', './js/core/combat.js',
  './js/data/rules5e.js', './js/data/demo.js', './js/data/templates.js', './js/data/blocks.js', './js/data/tables.js', './js/data/mapgen.js',
  './js/ui/components.js', './js/ui/statblock.js', './js/ui/frame.js', './js/ui/shell.js', './js/ui/palette.js', './js/ui/aiout.js',
  './js/views/auth.js', './js/views/home.js', './js/views/codex.js', './js/views/graph.js', './js/views/dice.js', './js/views/rules.js',
  './js/views/forge.js', './js/views/npc.js', './js/views/encounter.js', './js/views/combat.js', './js/views/characters.js',
  './js/views/campaign.js', './js/views/table.js', './js/views/journal.js', './js/views/generators.js', './js/views/oracle.js',
  './js/views/maps.js', './js/views/archive.js', './js/views/importexport.js', './js/views/settings.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

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
