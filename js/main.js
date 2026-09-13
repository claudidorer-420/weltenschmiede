// Einstiegspunkt der Weltenschmiede.
import { html, render } from './lib/preact.js';
import { boot } from './core/app.js';
import { requestPersistentStorage } from './core/db-local.js';
import { App } from './ui/shell.js';

window.__WS_BOOTED = true;
const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);

boot().catch((e) => {
  console.error(e);
  const box = document.createElement('div');
  box.className = 'boot';
  box.innerHTML = '<div class="boot-title">Fehler beim Start</div><div class="boot-sub"></div>';
  box.querySelector('.boot-sub').textContent = String(e?.message || e);
  document.body.appendChild(box);
});

requestPersistentStorage();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
