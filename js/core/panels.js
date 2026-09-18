// Seitenleisten, die eine Ansicht selbst füllt (z. B. die Kartenwerkstatt: Werkzeuge links, Ebenen rechts).
// Die Ansicht meldet ihre Inhalte an, die App-Hülle zeigt sie statt Dateiexplorer/Rückverweisen.
// Wichtig: Die Zeichenfunktionen liegen außerhalb des Stores (sie ändern sich bei jedem Render der Ansicht);
// neu gezeichnet wird nur, wenn sich die Signatur `sig` ändert – sonst dreht sich die App im Kreis.
import { createStore } from './store.js';

export const panels = createStore({ owner: null, sig: '', has: 0, ver: 0 });
export const panelContent = { left: null, right: null };

export function setPanels(owner, { left = null, right = null, sig = '' } = {}) {
  panelContent.left = left;
  panelContent.right = right;
  const s = panels.get();
  const has = (left ? 1 : 0) + (right ? 2 : 0);
  if (s.owner === owner && s.sig === sig && s.has === has) return;
  panels.set({ owner, sig, has, ver: s.ver + 1 });
}

export function clearPanels(owner) {
  if (panels.get().owner !== owner) return;
  panelContent.left = null;
  panelContent.right = null;
  panels.set({ owner: null, sig: '', has: 0, ver: panels.get().ver + 1 });
}
