// Rahmen einer Ansicht: Kopfzeile (Zurück/Vor, Titel, Aktionen) + scrollbarer Inhalt.
import { html } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { ws, goBack, goForward, canGoBack, canGoForward } from '../core/workspace.js';
import { IconBtn } from './components.js';

export function ViewFrame({ tabId, title, actions, children, bodyClass = '', noScroll = false, bodyRef }) {
  const tab = useStore(ws, (s) => s.tabs.find((t) => t.id === tabId));
  return html`
    <div class="view-header">
      <${IconBtn} icon="arrow-left" title="Zurück (Alt+←)" disabled=${!canGoBack(tab)} onClick=${goBack} />
      <${IconBtn} icon="arrow-right" title="Vor (Alt+→)" disabled=${!canGoForward(tab)} onClick=${goForward} />
      <div class="view-title">${title}</div>
      ${actions || html`<span style="width:64px"></span>`}
    </div>
    <div ref=${bodyRef} class=${`view-body ${bodyClass}${noScroll ? ' no-scroll' : ''}`}>${children}</div>`;
}
