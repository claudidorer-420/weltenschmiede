// Befehlspalette (Strg+P) und Schnellwechsler (Strg+O) wie in Obsidian.
import { html, useState, useEffect, useRef, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { ws, openView, openNote, goBack, goForward, toggleLeft, toggleRight, showLeftPanel, showRightPanel, newTab, setEditMode } from '../core/workspace.js';
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
  { label: 'Volltextsuche in allen Notizen', icon: 'search', hint: 'Strg+⇧+F', run: () => showLeftPanel('search') },
  { label: 'Graph-Ansicht', icon: 'graph', hint: 'Strg+G', run: () => openView('graph') },
  { label: 'Startseite', icon: 'home', run: () => openView('home') },
  { label: 'Weltenschmiede (KI-Weltenbau)', icon: 'anvil', gm: true, run: () => openView('forge') },
  { label: 'NPC-Schmiede', icon: 'mask', gm: true, run: () => openView('npc') },
  { label: 'Encounter & Statblocks', icon: 'swords', gm: true, run: () => openView('encounter') },
  { label: 'Bestiarium', icon: 'ghost', gm: true, run: () => openView('bestiary') },
  { label: 'Kampf (Kampfkarte)', icon: 'swords', run: () => import('../views/maps.js').then((m) => m.openBattle()) },
  { label: 'Kampf-Tracker (Liste)', icon: 'sword', run: () => openView('combat') },
  { label: 'Karten', icon: 'map', run: () => openView('maps') },
  { label: 'Chat & Würfel', icon: 'message', run: () => showRightPanel('chat') },
  { label: 'Spieltisch (Szene, Play-by-Post)', icon: 'image', run: () => openView('table') },
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

// Eine Suche für alles: Notizen und Befehle zusammen; mit „>“ am Anfang nur Befehle.
function PaletteInner({ mode }) {
  const [q, setQ] = useState(mode === 'commands' ? '> ' : '');
  const [act, setAct] = useState(0);
  const inp = useRef();
  const listRef = useRef();
  useEffect(() => {
    const t = setTimeout(() => {
      const el = inp.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 20);
    return () => clearTimeout(t);
  }, []);
  const cmdOnly = q.trimStart().startsWith('>');
  const query = (cmdOnly ? q.trimStart().slice(1) : q).trim();
  const { rows, picks } = useMemo(() => {
    const gm = isGM();
    const cmds = COMMANDS.filter((c) => !c.gm || gm)
      .map((c) => ({ ...c, type: 'cmd', key: `c:${c.label}`, s: query ? fuzzyScore(query, c.label) : 1 }))
      .filter((c) => c.s > 0)
      .sort((a, b) => b.s - a.s);
    if (cmdOnly) {
      const list = cmds.slice(0, 40);
      return { rows: [{ header: 'Befehle' }, ...list], picks: list };
    }
    const notes = [];
    for (const n of getIndex().notes) {
      const s = query ? Math.max(fuzzyScore(query, n.title), ...(n.aliases || []).map((a) => fuzzyScore(query, a) - 5)) : 1;
      if (s > 0) notes.push({ type: 'note', key: `n:${n.id}`, id: n.id, label: n.title, sub: n.folder, icon: 'file-text', s, t: n.updatedAt || 0 });
    }
    notes.sort((a, b) => (query ? b.s - a.s || a.label.localeCompare(b.label) : b.t - a.t));
    const N = notes.slice(0, query ? 40 : 10);
    const C = cmds.slice(0, query ? 10 : 8);
    const out = [];
    if (N.length) out.push({ header: query ? 'Notizen' : 'Zuletzt bearbeitet' }, ...N);
    if (C.length) out.push({ header: 'Befehle' }, ...C);
    return { rows: out, picks: [...N, ...C] };
  }, [q]);
  useEffect(() => { listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' }); }, [act]);

  const run = (it, e) => {
    closePalette();
    if (it.type === 'cmd') it.run();
    else openNote(it.id, { newTab: e?.ctrlKey || e?.metaKey });
  };
  const onKey = async (e) => {
    if (e.key === 'Escape') closePalette();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAct((a) => Math.min(picks.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAct((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!cmdOnly && isGM() && query && (e.shiftKey || !picks.length)) {
        closePalette();
        const n = await createNote({ title: query });
        openNote(n.id);
      } else if (picks[act]) run(picks[act], e);
    }
  };
  let pi = -1;
  return html`<div class="palette-backdrop" onPointerDown=${(e) => e.target === e.currentTarget && closePalette()}>
    <div class="palette" role="dialog">
      <input ref=${inp} value=${q} onInput=${(e) => { setQ(e.target.value); setAct(0); }} onKeyDown=${onKey}
        placeholder="Notizen & Befehle suchen …  („>“ = nur Befehle)" />
      <div class="palette-list" ref=${listRef}>
        ${rows.map((it) => {
          if (it.header) return html`<div class="palette-group" key=${`h:${it.header}`}>${it.header}</div>`;
          pi += 1;
          const i = pi;
          return html`<div key=${it.key} class=${`palette-item${i === act ? ' active' : ''}`} onMouseEnter=${() => setAct(i)} onClick=${(e) => run(it, e)}>
            <${Icon} name=${it.icon} size=${16} /><span class="ellipsis">${it.label}</span>${it.sub || it.hint ? html`<span class="sub">${it.sub || it.hint}</span>` : null}
          </div>`;
        })}
        ${!picks.length ? html`<div class="palette-item faint">${!cmdOnly && query && isGM() ? `↵ „${query}“ als neue Notiz anlegen` : 'Nichts gefunden'}</div>` : null}
      </div>
      <div class="palette-foot">
        <span><span class="kbd">↑↓</span> wählen</span><span><span class="kbd">↵</span> öffnen</span><span><span class="kbd">Strg ↵</span> neuer Tab</span>
        ${isGM() ? html`<span><span class="kbd">⇧ ↵</span> als Notiz anlegen</span>` : null}
        <span><span class="kbd">></span> nur Befehle</span><span><span class="kbd">Esc</span> schließen</span>
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
      openPalette('all');
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
