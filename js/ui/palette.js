// Befehlspalette (Strg+P) und Schnellwechsler (Strg+O) wie in Obsidian.
import { html, useState, useEffect, useRef, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { ws, openView, openNote, goBack, goForward, toggleLeft, toggleRight, showLeftPanel, newTab, setEditMode } from '../core/workspace.js';
import { app, getIndex, createNote, isGM } from '../core/app.js';
import { Icon } from './components.js';
import { fuzzyScore } from '../lib/util.js';
import { doRoll } from '../core/rolls.js';
import { settings, updateSettings } from '../core/settings.js';

export const openPalette = (mode) => ws.set({ palette: mode });
const closePalette = () => ws.set({ palette: null });

export async function newNoteQuick(folder = '', title = 'Unbenannt') {
  const n = await createNote({ title, folder });
  setEditMode(n.id, true);
  openNote(n.id);
  return n;
}

const THEMES = ['amoled', 'dark', 'light', 'parchment'];
function cycleTheme() {
  const cur = settings.get().theme;
  updateSettings({ theme: THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length] });
}

export const COMMANDS = [
  { label: 'Neue Notiz', icon: 'file-plus', hint: 'Strg+N', gm: true, run: () => newNoteQuick() },
  { label: 'Notiz öffnen (Schnellwechsler)', icon: 'search', hint: 'Strg+O', run: () => setTimeout(() => openPalette('switcher'), 10) },
  { label: 'Volltextsuche', icon: 'search', hint: 'Strg+⇧+F', run: () => showLeftPanel('search') },
  { label: 'Graph-Ansicht', icon: 'graph', hint: 'Strg+G', run: () => openView('graph') },
  { label: 'Startseite', icon: 'home', run: () => openView('home') },
  { label: 'Weltenschmiede (KI-Weltenbau)', icon: 'anvil', gm: true, run: () => openView('forge') },
  { label: 'NPC-Schmiede', icon: 'mask', gm: true, run: () => openView('npc') },
  { label: 'Encounter & Statblocks', icon: 'swords', gm: true, run: () => openView('encounter') },
  { label: 'Bestiarium', icon: 'ghost', gm: true, run: () => openView('bestiary') },
  { label: 'Kampf-Tracker', icon: 'sword', run: () => openView('combat') },
  { label: 'Karten', icon: 'map', run: () => openView('maps') },
  { label: 'Spieltisch', icon: 'message', run: () => openView('table') },
  { label: 'Sitzungen', icon: 'calendar', run: () => openView('sessions') },
  { label: 'Quests', icon: 'list-checks', run: () => openView('quests') },
  { label: 'Charaktere', icon: 'users', run: () => openView('characters') },
  { label: 'Mein Tagebuch', icon: 'feather', run: () => openView('journal') },
  { label: 'Würfel', icon: 'd20', run: () => openView('dice') },
  { label: 'W20 würfeln', icon: 'd20', run: () => doRoll('1d20', { label: 'W20' }) },
  { label: 'Mit Vorteil würfeln', icon: 'd20', run: () => doRoll('d20 vorteil', { label: 'Vorteil' }) },
  { label: 'Zufallsgeneratoren', icon: 'dices', gm: true, run: () => openView('generators') },
  { label: 'Orakel (Fragen an den Codex)', icon: 'sparkles', gm: true, run: () => openView('oracle') },
  { label: 'Regeln nachschlagen', icon: 'book', run: () => openView('rules') },
  { label: 'Archiv der Welten (KI-Verlauf)', icon: 'archive', gm: true, run: () => openView('archive') },
  { label: 'Mitspieler einladen', icon: 'user-plus', gm: true, run: () => openView('members') },
  { label: 'Obsidian importieren / Export', icon: 'upload', gm: true, run: () => openView('import') },
  { label: 'Papierkorb', icon: 'trash', gm: true, run: () => openView('trash') },
  { label: 'Einstellungen', icon: 'settings', run: () => openView('settings') },
  { label: 'KI-Modelle & Schlüssel', icon: 'key', run: () => openView('settings', { section: 'ai' }) },
  { label: 'Spieleransicht umschalten', icon: 'eye', gm: true, run: () => app.set({ viewAsPlayer: !app.get().viewAsPlayer }) },
  { label: 'Farbschema wechseln', icon: 'palette', run: cycleTheme },
  { label: 'Linke Seitenleiste ein/aus', icon: 'panel-left', run: toggleLeft },
  { label: 'Rechte Seitenleiste ein/aus', icon: 'panel-right', run: toggleRight },
  { label: 'Neuer Tab', icon: 'plus', run: newTab },
  { label: 'Zurück', icon: 'arrow-left', hint: 'Alt+←', run: goBack },
  { label: 'Vor', icon: 'arrow-right', hint: 'Alt+→', run: goForward },
];

export function Palette() {
  const mode = useStore(ws, (s) => s.palette);
  if (!mode) return null;
  return html`<${PaletteInner} key=${mode} mode=${mode} />`;
}

function PaletteInner({ mode }) {
  const [q, setQ] = useState('');
  const [act, setAct] = useState(0);
  const inp = useRef();
  useEffect(() => {
    const t = setTimeout(() => inp.current?.focus(), 20);
    return () => clearTimeout(t);
  }, []);
  const items = useMemo(() => {
    if (mode === 'commands') {
      const gm = isGM();
      return COMMANDS.filter((c) => !c.gm || gm)
        .map((c) => ({ ...c, s: fuzzyScore(q, c.label) }))
        .filter((c) => c.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 40);
    }
    const out = [];
    for (const n of getIndex().notes) {
      const s = Math.max(fuzzyScore(q, n.title), ...(n.aliases || []).map((a) => fuzzyScore(q, a) - 5));
      if (s > 0) out.push({ id: n.id, label: n.title, sub: n.folder, icon: 'file-text', s, t: n.updatedAt || 0 });
    }
    out.sort((a, b) => (q ? b.s - a.s || a.label.localeCompare(b.label) : b.t - a.t));
    return out.slice(0, 60);
  }, [q, mode]);

  const run = async (it, e) => {
    closePalette();
    if (mode === 'commands') it.run();
    else openNote(it.id, { newTab: e?.ctrlKey || e?.metaKey });
  };
  const onKey = async (e) => {
    if (e.key === 'Escape') closePalette();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAct((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAct((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'switcher' && isGM() && q.trim() && (e.shiftKey || !items.length)) {
        closePalette();
        const n = await createNote({ title: q.trim() });
        openNote(n.id);
      } else if (items[act]) run(items[act], e);
    }
  };
  return html`<div class="palette-backdrop" onPointerDown=${(e) => e.target === e.currentTarget && closePalette()}>
    <div class="palette" role="dialog">
      <input ref=${inp} value=${q} onInput=${(e) => { setQ(e.target.value); setAct(0); }} onKeyDown=${onKey}
        placeholder=${mode === 'commands' ? 'Befehl suchen …' : 'Notiz suchen – oder neuen Namen eingeben …'} />
      <div class="palette-list">
        ${items.map((it, i) => html`<div key=${it.id || it.label} class=${`palette-item${i === act ? ' active' : ''}`} onMouseEnter=${() => setAct(i)} onClick=${(e) => run(it, e)}>
          <${Icon} name=${it.icon} size=${16} /><span class="ellipsis">${it.label}</span>${it.sub || it.hint ? html`<span class="sub">${it.sub || it.hint}</span>` : null}
        </div>`)}
        ${!items.length ? html`<div class="palette-item faint">${mode === 'switcher' && q && isGM() ? `↵ „${q}“ als neue Notiz anlegen` : 'Nichts gefunden'}</div>` : null}
      </div>
      <div class="palette-foot">
        <span><span class="kbd">↑↓</span> wählen</span><span><span class="kbd">↵</span> öffnen</span>
        ${mode === 'switcher' ? html`<span><span class="kbd">Strg ↵</span> neuer Tab</span><span><span class="kbd">⇧ ↵</span> anlegen</span>` : null}
        <span><span class="kbd">Esc</span> schließen</span>
      </div>
    </div>
  </div>`;
}

export function registerShortcuts() {
  const onKey = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = (e.key || '').toLowerCase();
    if (mod && !e.shiftKey && (k === 'o' || k === 'k')) {
      e.preventDefault();
      openPalette('switcher');
    } else if (mod && !e.shiftKey && k === 'p') {
      e.preventDefault();
      openPalette('commands');
    } else if (mod && !e.shiftKey && !e.altKey && k === 'n') {
      if (isGM()) {
        e.preventDefault();
        newNoteQuick();
      }
    } else if (mod && e.shiftKey && k === 'f') {
      e.preventDefault();
      showLeftPanel('search');
    } else if (mod && !e.shiftKey && k === 'g') {
      e.preventDefault();
      openView('graph');
    } else if (mod && !e.shiftKey && k === 'e') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('ws:toggle-edit'));
    } else if (e.altKey && k === 'arrowleft') {
      e.preventDefault();
      goBack();
    } else if (e.altKey && k === 'arrowright') {
      e.preventDefault();
      goForward();
    }
  };
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}
