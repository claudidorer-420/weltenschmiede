// Farbgruppen (wie Obsidian-Graph-Gruppen) – auch für Punkte im Dateiexplorer und Karten-Pins.
import { settings } from './settings.js';

export function matchGroup(note, query) {
  const q = String(query || '').trim();
  if (!q) return false;
  if (q.startsWith('path:')) return (note.folder || '').toLowerCase().includes(q.slice(5).toLowerCase());
  if (q.startsWith('tag:')) {
    const t = q.slice(4).replace(/^#/, '').toLowerCase();
    return (note.tags || []).some((x) => x.toLowerCase() === t);
  }
  if (q.startsWith('typ:')) return (note.kind || '') === q.slice(4).toLowerCase();
  return String(note.title || '').toLowerCase().includes(q.toLowerCase());
}

export function groupColor(note, groups = settings.get().graph.groups) {
  for (const g of groups || []) if (g.color && matchGroup(note, g.query)) return g.color;
  return null;
}

// „Hügelgrab (Blau 2)“ → { color: 'Blau', num: 2 }
export function colorCode(title) {
  const m = /\((Blau|Lila|Rot|Grün|Gruen|Gelb|Orange|Weiß|Weiss|Schwarz|Braun|Pink|Türkis)\s*(\d+)\)\s*$/i.exec(String(title || ''));
  return m ? { color: m[1], num: Number(m[2]) } : null;
}

export const PIN_COLORS = {
  Blau: '#4d8dff', Lila: '#b07cff', Rot: '#ff5a5a', Grün: '#4cc38a', Gelb: '#f5c542', Orange: '#ff9a3c',
  Weiß: '#f1f1f1', Schwarz: '#2b2b2b', Braun: '#a0703c', Pink: '#ff7ab6', Türkis: '#2ec7c9',
};

export function pinColorFor(name) {
  const k = Object.keys(PIN_COLORS).find((c) => c.toLowerCase() === String(name || '').toLowerCase().replace('gruen', 'grün').replace('weiss', 'weiß'));
  return k ? PIN_COLORS[k] : null;
}
