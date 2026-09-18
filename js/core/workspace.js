// Arbeitsbereich wie in Obsidian: Tabs mit eigener Vor/Zurück-Historie, Seitenleisten, Schubladen (mobil).
import { createStore } from './store.js';
import { uid, debounce } from '../lib/util.js';
import { app } from './app.js';

// Grundbreiten der Seitenleisten (CSS: --left-w/--right-w). In der Kartenwerkstatt ist links mehr Platz.
export const SB_BASE = { left: 280, right: 300, mapLeft: 364, mapRight: 330 };
const sbLoad = () => {
  const out = {};
  for (const k of Object.keys(SB_BASE)) {
    const v = Number(localStorage.getItem(`ws.sbw.${k}`));
    out[k] = v >= 120 && v <= 900 ? v : SB_BASE[k];
  }
  return out;
};

export const ws = createStore({
  tabs: [],
  active: null,
  leftOpen: localStorage.getItem('ws.leftOpen') !== '0',
  rightOpen: localStorage.getItem('ws.rightOpen') === '1',
  leftPanel: 'files',
  rightPanel: 'backlinks',
  drawer: null, // 'left' | 'right' | null (mobil)
  palette: null, // 'all' (Notizen + Befehle) | 'commands' | null
  chatUnread: false,
  searchQuery: '',
  editMode: {}, // noteId -> true
  sbw: sbLoad(),
});

// Breite einer Seitenleiste ziehen: 30 % schmaler bis 50 % breiter als die Grundbreite
export function setSidebarWidth(key, px) {
  const base = SB_BASE[key] || 280;
  const v = Math.round(Math.max(base * 0.7, Math.min(base * 1.5, px)));
  const cur = ws.get().sbw;
  if (cur[key] === v) return;
  try { localStorage.setItem(`ws.sbw.${key}`, String(v)); } catch { /* voll */ }
  ws.set({ sbw: { ...cur, [key]: v } });
}
export function resetSidebarWidth(key) {
  try { localStorage.removeItem(`ws.sbw.${key}`); } catch { /* egal */ }
  ws.set({ sbw: { ...ws.get().sbw, [key]: SB_BASE[key] } });
}

// Ansichten, die es nur einmal gibt (werden fokussiert statt neu geöffnet)
const SINGLETON = new Set(['home', 'graph', 'forge', 'encounter', 'combat', 'npc', 'maps', 'dice', 'table', 'characters', 'sessions', 'quests', 'rules', 'oracle', 'bestiary', 'generators', 'settings', 'archive', 'journal', 'import', 'trash', 'members', 'handouts', 'campaigns']);
// Ansichten, die beim Navigieren im selben Tab ersetzt werden dürfen
const REPLACEABLE = new Set(['note', 'home', 'empty', 'character', 'session', 'map', 'journal-note']);

export const isMobile = () => matchMedia('(max-width: 899px)').matches;
export const currentOf = (tab) => tab?.stack?.[tab.pos] || { view: 'empty', params: {} };
export const activeTab = () => ws.get().tabs.find((t) => t.id === ws.get().active) || null;
export const activeView = () => currentOf(activeTab());

const sameParams = (a = {}, b = {}) => JSON.stringify(a) === JSON.stringify(b);

const persist = debounce(() => {
  const cid = app.get().cid;
  if (!cid) return;
  const { tabs, active } = ws.get();
  try {
    localStorage.setItem(`ws.tabs.${cid}`, JSON.stringify({ tabs: tabs.map((t) => ({ ...t, stack: t.stack.slice(-15), pos: Math.min(t.pos, 14) })), active }));
  } catch { /* voll */ }
}, 400);

export function restoreTabs(cid) {
  try {
    const raw = localStorage.getItem(`ws.tabs.${cid}`);
    if (raw) {
      const { tabs, active } = JSON.parse(raw);
      if (Array.isArray(tabs) && tabs.length) {
        ws.set({ tabs, active: tabs.some((t) => t.id === active) ? active : tabs[0].id });
        return;
      }
    }
  } catch { /* ignore */ }
  const t = { id: uid(8), stack: [{ view: 'home', params: {} }], pos: 0 };
  ws.set({ tabs: [t], active: t.id });
}

function closeDrawerIfMobile() {
  if (isMobile() && ws.get().drawer) ws.set({ drawer: null });
}

export function openView(view, params = {}, opts = {}) {
  const s = ws.get();
  const newTab = !!opts.newTab;
  if (!newTab && SINGLETON.has(view)) {
    const ex = s.tabs.find((t) => currentOf(t).view === view);
    if (ex) {
      const cur = currentOf(ex);
      if (!sameParams(cur.params, params) && Object.keys(params).length) {
        const stack = [...ex.stack.slice(0, ex.pos), { view, params: { ...cur.params, ...params } }];
        ws.set({ tabs: s.tabs.map((t) => (t.id === ex.id ? { ...t, stack, pos: stack.length - 1 } : t)), active: ex.id });
      } else ws.set({ active: ex.id });
      closeDrawerIfMobile();
      persist();
      return ex.id;
    }
  }
  const at = activeTab();
  let id;
  if (!newTab && at && (REPLACEABLE.has(currentOf(at).view) || opts.replace)) {
    const cur = currentOf(at);
    if (cur.view === view && sameParams(cur.params, params)) {
      closeDrawerIfMobile();
      return at.id;
    }
    const stack = [...at.stack.slice(0, at.pos + 1), { view, params }].slice(-40);
    ws.set({ tabs: s.tabs.map((t) => (t.id === at.id ? { ...t, stack, pos: stack.length - 1 } : t)), active: at.id });
    id = at.id;
  } else {
    const tab = { id: uid(8), stack: [{ view, params }], pos: 0 };
    const tabs = [...s.tabs];
    const i = at ? tabs.indexOf(at) + 1 : tabs.length;
    tabs.splice(i, 0, tab);
    ws.set({ tabs, active: tab.id });
    id = tab.id;
  }
  closeDrawerIfMobile();
  persist();
  return id;
}

export function openNote(id, opts = {}) {
  return openView('note', opts.heading ? { id, heading: opts.heading } : { id }, opts);
}

export function newTab() {
  return openView('home', {}, { newTab: true });
}

export function setActive(id) {
  ws.set({ active: id });
  persist();
}

export function closeTab(id) {
  const s = ws.get();
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const tabs = s.tabs.filter((t) => t.id !== id);
  if (!tabs.length) {
    const t = { id: uid(8), stack: [{ view: 'home', params: {} }], pos: 0 };
    ws.set({ tabs: [t], active: t.id });
  } else {
    ws.set({ tabs, active: s.active === id ? tabs[Math.max(0, i - 1)].id : s.active });
  }
  persist();
}

export function closeOtherTabs(id) {
  const s = ws.get();
  ws.set({ tabs: s.tabs.filter((t) => t.id === id), active: id });
  persist();
}

export function moveTab(id, dir) {
  const tabs = [...ws.get().tabs];
  const i = tabs.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= tabs.length) return;
  [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
  ws.set({ tabs });
  persist();
}

function shift(delta) {
  const at = activeTab();
  if (!at) return;
  const pos = Math.max(0, Math.min(at.stack.length - 1, at.pos + delta));
  if (pos === at.pos) return;
  ws.set({ tabs: ws.get().tabs.map((t) => (t.id === at.id ? { ...t, pos } : t)) });
  persist();
}
export const goBack = () => shift(-1);
export const goForward = () => shift(1);
export const canGoBack = (tab) => !!tab && tab.pos > 0;
export const canGoForward = (tab) => !!tab && tab.pos < tab.stack.length - 1;

export function updateParams(patch) {
  const at = activeTab();
  if (!at) return;
  const stack = [...at.stack];
  stack[at.pos] = { ...stack[at.pos], params: { ...stack[at.pos].params, ...patch } };
  ws.set({ tabs: ws.get().tabs.map((t) => (t.id === at.id ? { ...t, stack } : t)) });
  persist();
}

// Nach dem Löschen einer Notiz: betroffene Tabs zurücknavigieren oder schließen
export const forgetNote = (noteId) => forgetView('note', noteId);

// Dasselbe für andere Ansichten mit Kennung (Sitzung, Quest …)
export function forgetView(view, id) {
  const s = ws.get();
  const tabs = [];
  for (const t of s.tabs) {
    const stack = t.stack.filter((e) => !(e.view === view && e.params.id === id));
    if (!stack.length) continue;
    tabs.push({ ...t, stack, pos: Math.min(t.pos, stack.length - 1) });
  }
  if (!tabs.length) {
    const t = { id: uid(8), stack: [{ view: 'home', params: {} }], pos: 0 };
    ws.set({ tabs: [t], active: t.id });
  } else ws.set({ tabs, active: tabs.some((t) => t.id === s.active) ? s.active : tabs[0].id });
  persist();
}

export function toggleLeft() {
  if (isMobile()) return ws.set({ drawer: ws.get().drawer === 'left' ? null : 'left' });
  const v = !ws.get().leftOpen;
  localStorage.setItem('ws.leftOpen', v ? '1' : '0');
  ws.set({ leftOpen: v });
}

export function toggleRight() {
  if (isMobile()) return ws.set({ drawer: ws.get().drawer === 'right' ? null : 'right' });
  const v = !ws.get().rightOpen;
  localStorage.setItem('ws.rightOpen', v ? '1' : '0');
  ws.set({ rightOpen: v });
}

export function showLeftPanel(panel) {
  ws.set({ leftPanel: panel });
  if (isMobile()) ws.set({ drawer: 'left' });
  else if (!ws.get().leftOpen) toggleLeft();
}

export function showRightPanel(panel) {
  ws.set({ rightPanel: panel });
  if (isMobile()) ws.set({ drawer: 'right' });
  else if (!ws.get().rightOpen) toggleRight();
}

export function openSearch(query = '') {
  ws.set({ searchQuery: query });
  showLeftPanel('search');
}

export function setEditMode(noteId, on) {
  ws.set({ editMode: { ...ws.get().editMode, [noteId]: on } });
}
