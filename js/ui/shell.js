// App-Hülle: Anmeldung/Start, Ribbon, Seitenleisten, Tabs, Ansichten (lazy geladen), Statusleiste.
import { html, useState, useEffect, useLayoutEffect, useRef } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, vault, noteById, col } from '../core/app.js';
import { settings, updateSettings } from '../core/settings.js';
import {
  ws, currentOf, openView, closeTab, setActive, newTab, toggleLeft, toggleRight, restoreTabs,
  showLeftPanel, closeOtherTabs, moveTab, isMobile, setSidebarWidth, resetSidebarWidth,
} from '../core/workspace.js';
import { panels, panelContent } from '../core/panels.js';
import { useCol } from '../core/hooks.js';
import { Icon, IconBtn, OverlayHost, ErrorBoundary, openMenu, useMedia, Spinner, Empty, Avatar } from './components.js';
import { ViewFrame } from './frame.js';
import { Palette, registerShortcuts, openPalette } from './palette.js';
import { LeftSidebar, RightSidebar } from '../views/codex.js';
import { AuthScreen } from '../views/auth.js';
import { Lobby } from '../views/home.js';
import { accountMenu } from './account.js';
import { DiceOverlay } from './dicetray.js';
import { startGmRelay } from '../core/relay.js';
import { PromptHost } from './prompthost.js';

const LOADERS = {
  home: () => import('../views/home.js'),
  codex: () => import('../views/codex.js'),
  graph: () => import('../views/graph.js'),
  forge: () => import('../views/forge.js'),
  npc: () => import('../views/npc.js'),
  encounter: () => import('../views/encounter.js'),
  bestiary: () => import('../views/bestiary.js'),
  combat: () => import('../views/combat.js'),
  maps: () => import('../views/maps.js'),
  table: () => import('../views/table.js'),
  dice: () => import('../views/dice.js'),
  characters: () => import('../views/characters.js'),
  campaign: () => import('../views/campaign.js'),
  journal: () => import('../views/journal.js'),
  generators: () => import('../views/generators.js'),
  rules: () => import('../views/rules.js'),
  oracle: () => import('../views/oracle.js'),
  archive: () => import('../views/archive.js'),
  importexport: () => import('../views/importexport.js'),
  settings: () => import('../views/settings.js'),
};

export const VIEWS = {
  home: { title: 'Start', icon: 'home', mod: 'home', comp: 'HomeView' },
  campaigns: { title: 'Kampagnen', icon: 'castle', mod: 'home', comp: 'CampaignsView' },
  note: { title: (p) => noteById(p.id)?.title || 'Notiz', icon: 'file-text', mod: 'codex', comp: 'NoteView' },
  trash: { title: 'Papierkorb', icon: 'trash', gm: true, mod: 'codex', comp: 'TrashView' },
  graph: { title: 'Graph-Ansicht', icon: 'graph', mod: 'graph', comp: 'GraphView' },
  forge: { title: 'Weltenschmiede', icon: 'anvil', gm: true, mod: 'forge', comp: 'ForgeView' },
  archive: { title: 'Archiv der Welten', icon: 'archive', gm: true, mod: 'archive', comp: 'ArchiveView' },
  npc: { title: 'NPC-Schmiede', icon: 'mask', gm: true, mod: 'npc', comp: 'NpcView' },
  encounter: { title: 'Encounter', icon: 'swords', gm: true, mod: 'encounter', comp: 'EncounterView' },
  bestiary: { title: 'Bestiarium', icon: 'ghost', gm: true, mod: 'bestiary', comp: 'BestiaryView' },
  combat: { title: 'Kampf', icon: 'sword', mod: 'combat', comp: 'CombatView' },
  maps: { title: 'Karten', icon: 'map', mod: 'maps', comp: 'MapsView' },
  map: { title: 'Karte', icon: 'map', mod: 'maps', comp: 'MapView' },
  table: { title: 'Spieltisch', icon: 'message', mod: 'table', comp: 'TableView' },
  handouts: { title: 'Handouts', icon: 'scroll', mod: 'table', comp: 'HandoutsView' },
  dice: { title: 'Würfel', icon: 'd20', mod: 'dice', comp: 'DiceView' },
  characters: { title: 'Charaktere', icon: 'users', mod: 'characters', comp: 'CharactersView' },
  character: { title: 'Charakterbogen', icon: 'user', mod: 'characters', comp: 'CharacterView' },
  sessions: { title: 'Sitzungen', icon: 'calendar', mod: 'campaign', comp: 'SessionsView' },
  session: { title: 'Sitzung', icon: 'calendar', mod: 'campaign', comp: 'SessionView' },
  quests: { title: 'Quests', icon: 'list-checks', mod: 'campaign', comp: 'QuestsView' },
  members: { title: 'Mitspieler & Einladungen', icon: 'user-plus', gm: true, mod: 'campaign', comp: 'MembersView' },
  journal: { title: 'Mein Tagebuch', icon: 'feather', mod: 'journal', comp: 'JournalView' },
  generators: { title: 'Zufallsgeneratoren', icon: 'dices', gm: true, mod: 'generators', comp: 'GeneratorsView' },
  rules: { title: 'Regeln', icon: 'book', mod: 'rules', comp: 'RulesView' },
  oracle: { title: 'Orakel', icon: 'sparkles', gm: true, mod: 'oracle', comp: 'OracleView' },
  import: { title: 'Import & Export', icon: 'upload', gm: true, mod: 'importexport', comp: 'ImportView' },
  settings: { title: 'Einstellungen', icon: 'settings', mod: 'settings', comp: 'SettingsView' },
};

export function viewTitle(cur) {
  const def = VIEWS[cur?.view];
  if (!def) return 'Neuer Tab';
  if (cur.params?.title) return cur.params.title;
  return typeof def.title === 'function' ? def.title(cur.params || {}) : def.title;
}

// „Karten“ fragt erst: Karten ansehen oder zum Kampf (Kampfkarte)?
function mapsOrBattle(e) {
  openMenu(e, [
    { header: true, label: 'Was möchtest du öffnen?' },
    { label: 'Karten', icon: 'map', hint: 'Welt & Dungeons', onClick: () => openView('maps') },
    { label: 'Kampf', icon: 'swords', hint: 'Kampfkarte', onClick: () => import('../views/maps.js').then((m) => m.openBattle()) },
  ]);
}
const SEARCH = { action: () => openPalette('all'), icon: 'search', title: 'Suche & Befehle (Strg+K)', label: 'Suche' };
const MAPS = { action: mapsOrBattle, icon: 'map', title: 'Karten oder Kampf', label: 'Karten', views: ['maps', 'map', 'combat'] };

const RIBBON_GM = [
  { view: 'home', icon: 'home', title: 'Start', label: 'Start' },
  SEARCH,
  { view: 'graph', icon: 'graph', title: 'Graph-Ansicht (Strg+G)', label: 'Graph' },
  '|',
  { view: 'forge', icon: 'anvil', title: 'Weltenschmiede (KI)', label: 'Schmiede' },
  { view: 'npc', icon: 'mask', title: 'NPC-Schmiede', label: 'NPCs' },
  { view: 'encounter', icon: 'swords', title: 'Encounter & Statblocks', label: 'Encounter' },
  { view: 'bestiary', icon: 'ghost', title: 'Bestiarium (SRD + eigene Monster)', label: 'Bestiarium' },
  MAPS,
  '|',
  { view: 'table', icon: 'image', title: 'Spieltisch: Szene, Gruppe, Play-by-Post', label: 'Spieltisch' },
  { view: 'sessions', icon: 'calendar', title: 'Sitzungen', label: 'Sitzungen' },
  { view: 'quests', icon: 'list-checks', title: 'Quests', label: 'Quests' },
  { view: 'characters', icon: 'users', title: 'Charaktere', label: 'Charaktere' },
  '|',
  { view: 'dice', icon: 'd20', title: 'Würfel', label: 'Würfel' },
  { view: 'generators', icon: 'dices', title: 'Zufallsgeneratoren', label: 'Zufall' },
  { view: 'oracle', icon: 'sparkles', title: 'Orakel (Codex-KI)', label: 'Orakel' },
  { view: 'rules', icon: 'book', title: 'Regeln & Zauber', label: 'Regeln' },
  { view: 'archive', icon: 'archive', title: 'Archiv der Welten', label: 'Archiv' },
  '~',
  { view: 'import', icon: 'upload', title: 'Import & Export', label: 'Import' },
  { view: 'settings', icon: 'settings', title: 'Einstellungen', label: 'Optionen' },
];

const RIBBON_PLAYER = [
  { view: 'home', icon: 'home', title: 'Start', label: 'Start' },
  SEARCH,
  { view: 'graph', icon: 'graph', title: 'Graph-Ansicht', label: 'Graph' },
  '|',
  { view: 'table', icon: 'image', title: 'Spieltisch: Szene, Gruppe, Play-by-Post', label: 'Spieltisch' },
  { view: 'characters', icon: 'user', title: 'Mein Charakter', label: 'Charakter' },
  { view: 'journal', icon: 'feather', title: 'Mein Tagebuch', label: 'Tagebuch' },
  MAPS,
  { view: 'quests', icon: 'list-checks', title: 'Quests', label: 'Quests' },
  { view: 'sessions', icon: 'calendar', title: 'Sitzungen', label: 'Sitzungen' },
  { view: 'handouts', icon: 'scroll', title: 'Handouts', label: 'Handouts' },
  '|',
  { view: 'dice', icon: 'd20', title: 'Würfel', label: 'Würfel' },
  { view: 'rules', icon: 'book', title: 'Regeln & Zauber', label: 'Regeln' },
  '~',
  { view: 'settings', icon: 'settings', title: 'Einstellungen', label: 'Optionen' },
];

// ───────────────────────── Wurzel ─────────────────────────
export function App() {
  const phase = useStore(app, (s) => s.phase);
  const user = useStore(app, (s) => s.user);
  let body;
  if (phase === 'boot' || phase === 'loading') body = html`<${BootScreen} />`;
  else if (!user) body = html`<${AuthScreen} />`;
  else body = html`<${Workspace} />`;
  return html`${body}<${OverlayHost} /><${DiceOverlay} /><${Palette} /><${PromptHost} />`;
}

function BootScreen() {
  return html`<div class="boot"><img src="icons/icon.svg" width="72" height="72" alt="" /><div class="boot-title">Weltenschmiede</div><div class="boot-sub">Die Esse wird angeheizt …</div></div>`;
}

function Workspace() {
  const cid = useStore(app, (s) => s.cid);
  const mobile = useMedia('(max-width: 899px)');
  const s = useStore(ws, (x) => ({ tabs: x.tabs, active: x.active, leftOpen: x.leftOpen, rightOpen: x.rightOpen, drawer: x.drawer }));
  const [restored, setRestored] = useState(null);
  useLayoutEffect(() => {
    if (cid && restored !== cid) {
      restoreTabs(cid);
      setRestored(cid);
    }
  }, [cid]);
  useEffect(() => registerShortcuts(), []);
  // SL: Signale der Spieler (Zugende, Initiative, Angriffe) verarbeiten – unabhängig von der offenen Ansicht
  const role = useStore(app, (x) => x.role);
  useEffect(() => (cid && role === 'gm' ? startGmRelay() : undefined), [cid, role]);
  useChatUnread(cid);
  useEffect(() => {
    const h = location.hash;
    const m = /#\/(dice|table)$/.exec(h);
    if (m && cid) openView(m[1]);
  }, [cid]);
  const mp = useStore(panels, (x) => `${x.owner || ''}|${x.has}|${x.ver}`);
  const pOwner = panels.get().owner;
  const sbw = useStore(ws, (x) => x.sbw);
  const own = !!mp && pOwner === s.active;
  const leftKey = own && panelContent.left ? 'mapLeft' : 'left';
  const rightKey = own && panelContent.right ? 'mapRight' : 'right';
  const leftBody = own && panelContent.left ? panelContent.left() : html`<${LeftSidebar} />`;
  const rightBody = own && panelContent.right ? panelContent.right() : html`<${RightSidebar} />`;
  if (!cid) return html`<${Lobby} />`;
  const views = s.tabs.map((t) => html`<${ViewHost} key=${t.id} tab=${t} active=${t.id === s.active} />`);
  const main = html`<main class="main">
    ${mobile ? html`<${MobileHeader} tabs=${s.tabs} active=${s.active} />` : html`<${TabBar} tabs=${s.tabs} active=${s.active} leftOpen=${s.leftOpen} rightOpen=${s.rightOpen} />`}
    ${views}
    ${!mobile ? html`<${StatusBar} />` : null}
  </main>`;
  const style = { '--left-w': `${sbw[leftKey]}px`, '--right-w': `${sbw[rightKey]}px` };
  if (mobile) return html`<div class="app" style=${style}>${main}<${MobileDrawers} drawer=${s.drawer} left=${leftBody} right=${rightBody} /></div>`;
  return html`<div class="app" style=${style}><${Ribbon} />
    ${s.leftOpen ? html`<div class="sb-host left">${leftBody}<${SbResize} side="left" wkey=${leftKey} /></div>` : null}
    ${main}
    ${s.rightOpen ? html`<div class="sb-host right">${rightBody}<${SbResize} side="right" wkey=${rightKey} /></div>` : null}
  </div>`;
}

// Breite der Seitenleiste ziehen (Doppelklick = Grundbreite)
function SbResize({ side, wkey }) {
  const down = (e) => {
    e.preventDefault();
    const host = e.currentTarget.parentElement;
    const rect = host.getBoundingClientRect();
    const move = (ev) => setSidebarWidth(wkey, side === 'left' ? ev.clientX - rect.left : rect.right - ev.clientX);
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  return html`<div class=${`sb-resize ${side}`} title="Breite ziehen · Doppelklick = Standard" onPointerDown=${down} onDblClick=${() => resetSidebarWidth(wkey)} />`;
}

// Neue Chatnachrichten melden, solange der Chat nicht sichtbar ist (Punkt an Ribbon, Seitenleisten-Knopf und Chat-Reiter)
function useChatUnread(cid) {
  const me = useStore(app, (s) => s.user?.uid);
  const last = useCol(cid ? col('chat') : null, { orderBy: ['ts', 'desc'], limit: 1 });
  const visible = useStore(ws, (s) => s.rightPanel === 'chat' && (isMobile() ? s.drawer === 'right' : s.rightOpen));
  const m = last?.[0];
  useEffect(() => {
    if (!cid) return;
    const key = `ws.chatSeen.${cid}`;
    const seen = Number(localStorage.getItem(key) || 0);
    if (!m) { ws.set({ chatUnread: false }); return; }
    if (!seen || visible || m.uid === me) {
      if ((m.ts || 0) > seen) localStorage.setItem(key, String(m.ts || 0));
      ws.set({ chatUnread: false });
    } else ws.set({ chatUnread: (m.ts || 0) > seen });
  }, [cid, m?.id, m?.ts, visible]);
}

// Schubladen (Handy): zum Schließen wegwischen, vom Bildschirmrand hereinziehen zum Öffnen
function MobileDrawers({ drawer, left, right }) {
  const leftEl = useRef(null);
  const rightEl = useRef(null);
  const back = useRef(null);
  useEffect(() => {
    let st = null;
    const els = () => ({ left: leftEl.current, right: rightEl.current });
    // Kann ein Element unter dem Finger selbst waagerecht scrollen? Dann nicht die Schublade ziehen.
    const scrollsX = (node, mx) => {
      for (let n = node; n && n !== document.body; n = n.parentElement) {
        if (n.classList?.contains('drawer')) break;
        if (n.scrollWidth > n.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(n).overflowX)) {
          if (mx < 0 && n.scrollLeft + n.clientWidth < n.scrollWidth - 1) return true;
          if (mx > 0 && n.scrollLeft > 0) return true;
        }
      }
      return false;
    };
    const onStart = (e) => {
      st = null;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const open = ws.get().drawer;
      const W = window.innerWidth;
      if (open) {
        const el = els()[open];
        if (!el || (!el.contains(e.target) && e.target !== back.current)) return;
        st = { mode: 'close', side: open, el, x: t.clientX, y: t.clientY, t: performance.now(), dx: 0, target: e.target };
      } else if (t.clientX < 20 || t.clientX > W - 20) {
        const side = t.clientX < 20 ? 'left' : 'right';
        st = { mode: 'open', side, el: els()[side], x: t.clientX, y: t.clientY, t: performance.now(), dx: 0 };
      }
    };
    const onMove = (e) => {
      if (!st) return;
      const t = e.touches[0];
      const mx = t.clientX - st.x;
      const my = t.clientY - st.y;
      if (!st.active) {
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        const horizontal = Math.abs(mx) > Math.abs(my) * 1.3;
        const dirOk = st.mode === 'close' ? (st.side === 'left' ? mx < 0 : mx > 0) : (st.side === 'left' ? mx > 0 : mx < 0);
        if (!horizontal || !dirOk || !st.el || (st.mode === 'close' && scrollsX(st.target, mx))) { st = null; return; }
        st.active = true;
        st.w = st.el.offsetWidth || 320;
        st.el.style.transition = 'none';
        if (back.current) { back.current.style.transition = 'none'; back.current.classList.add('show'); }
      }
      e.preventDefault();
      const { w } = st;
      const off = st.mode === 'close'
        ? (st.side === 'left' ? Math.min(0, mx) : Math.max(0, mx))
        : (st.side === 'left' ? Math.min(0, -w + mx) : Math.max(0, w + mx));
      st.dx = off;
      st.el.style.transform = `translateX(${off}px)`;
      if (back.current) back.current.style.opacity = String(Math.max(0, 1 - Math.abs(off) / w));
    };
    const onEnd = () => {
      if (!st?.active) { st = null; return; }
      const { el, w, dx, mode, side } = st;
      const moved = mode === 'close' ? Math.abs(dx) : w - Math.abs(dx);
      const v = moved / Math.max(1, performance.now() - st.t);
      el.style.transition = '';
      el.style.transform = '';
      if (back.current) { back.current.style.transition = ''; back.current.style.opacity = ''; back.current.classList.remove('show'); }
      if (mode === 'close') ws.set({ drawer: moved > w * 0.28 || v > 0.5 ? null : side });
      else ws.set({ drawer: moved > w * 0.3 || v > 0.5 ? side : null });
      st = null;
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);
  return html`
    <div ref=${back} class=${`drawer-backdrop${drawer ? ' show' : ''}`} onClick=${() => ws.set({ drawer: null })} />
    <div ref=${leftEl} class=${`drawer left${drawer === 'left' ? ' open' : ''}`}><${Ribbon} />${left}</div>
    <div ref=${rightEl} class=${`drawer right${drawer === 'right' ? ' open' : ''}`}>${right}</div>`;
}

function Ribbon() {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const user = useStore(app, (s) => s.user);
  const labels = useStore(settings, (s) => s.layout?.ribbonLabels !== false);
  const current = useStore(ws, (s) => currentOf(s.tabs.find((t) => t.id === s.active)).view);
  const unread = useStore(ws, (s) => s.chatUnread);
  const items = gm ? RIBBON_GM : RIBBON_PLAYER;
  return html`<nav class=${`ribbon${labels ? ' labeled' : ''}`} aria-label="Module">
    ${items.map((it, i) => {
      if (it === '|') return html`<div class="ribbon-sep" key=${`s${i}`} />`;
      if (it === '~') return html`<div class="grow" key=${`g${i}`} />`;
      const on = (it.view && current === it.view) || it.views?.includes(current);
      return html`<button key=${it.title} type="button" class=${`ribbon-btn${on ? ' active' : ''}`} title=${it.title} aria-label=${it.title}
        onClick=${(e) => (it.action ? it.action(e) : openView(it.view, {}, { newTab: e.ctrlKey || e.metaKey }))}><${Icon} name=${it.icon} size=${labels ? 18 : 19} />${labels ? html`<span class="rb-label">${it.label}</span>` : null}${it.chat && unread ? html`<span class="dot" />` : null}</button>`;
    })}
    <button type="button" class="ribbon-btn ribbon-toggle" title=${labels ? 'Beschriftung ausblenden (schmale Leiste)' : 'Beschriftung einblenden'} onClick=${() => updateSettings({ layout: { ribbonLabels: !labels } })}>
      <${Icon} name=${labels ? 'chevron-left' : 'chevron-right'} size=${14} /></button>
    <button type="button" class="ribbon-btn ribbon-avatar" title=${`${user?.name || 'Konto'} – Konto, Übersicht, Abmelden`} aria-label="Konto" onClick=${accountMenu}><${Avatar} name=${user?.name} size="sm" />${labels ? html`<span class="rb-label">Konto</span>` : null}</button>
  </nav>`;
}

const modCache = new Map();

function ViewHost({ tab, active }) {
  const cur = currentOf(tab);
  const def = VIEWS[cur.view] || VIEWS.home;
  const [mod, setMod] = useState(() => modCache.get(def.mod) || null);
  const [err, setErr] = useState(null);
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  useEffect(() => {
    let alive = true;
    const cached = modCache.get(def.mod);
    if (cached) {
      setMod(cached);
      return undefined;
    }
    setMod(null);
    setErr(null);
    LOADERS[def.mod]().then((m) => {
      modCache.set(def.mod, m);
      if (alive) setMod(m);
    }).catch((e) => alive && setErr(e));
    return () => { alive = false; };
  }, [def.mod]);
  const Comp = mod?.[def.comp];
  let content;
  if (def.gm && !gm) {
    content = html`<${ViewFrame} tabId=${tab.id} title=${viewTitle(cur)}><${Empty} icon="lock" title="Nur für die Spielleitung">Dieser Bereich ist der Spielleitung vorbehalten.<//><//>`;
  } else if (err) {
    content = html`<${ViewFrame} tabId=${tab.id} title=${viewTitle(cur)}><${Empty} icon="alert" title="Modul konnte nicht geladen werden">${String(err.message || err)} – Internetverbindung prüfen und neu laden.<//><//>`;
  } else if (!Comp) {
    content = html`<div class="empty" style="margin:auto"><${Spinner} size="lg" /></div>`;
  } else {
    content = html`<${ErrorBoundary}><${Comp} key=${`${cur.view}:${cur.params?.id || ''}`} params=${cur.params || {}} active=${active} tabId=${tab.id} /><//>`;
  }
  return html`<section class="view" hidden=${!active}>${content}</section>`;
}

function tabMenu(e, t) {
  openMenu(e, [
    { label: 'Tab schließen', icon: 'x', onClick: () => closeTab(t.id) },
    { label: 'Andere Tabs schließen', icon: 'x', onClick: () => closeOtherTabs(t.id) },
    { divider: true },
    { label: 'Nach links', icon: 'arrow-left', onClick: () => moveTab(t.id, -1) },
    { label: 'Nach rechts', icon: 'arrow-right', onClick: () => moveTab(t.id, 1) },
  ]);
}

function tabListMenu(e, tabs) {
  openMenu(e, [
    { header: true, label: `${tabs.length} offene Tabs` },
    ...tabs.map((t) => {
      const cur = currentOf(t);
      return { label: viewTitle(cur), icon: VIEWS[cur.view]?.icon || 'file', onClick: () => setActive(t.id) };
    }),
    { divider: true },
    { label: 'Neuer Tab', icon: 'plus', onClick: newTab },
  ]);
}

const useChatDot = () => useStore(ws, (s) => s.chatUnread && !(s.rightPanel === 'chat' && (isMobile() ? s.drawer === 'right' : s.rightOpen)));

function TabBar({ tabs, active, leftOpen, rightOpen }) {
  useStore(vault, (s) => s.version);
  const dot = useChatDot();
  return html`<div class="tabbar">
    <div class="tb-tools">${!leftOpen ? html`<${IconBtn} icon="panel-left" title="Linke Seitenleiste" onClick=${toggleLeft} />` : html`<${IconBtn} icon="panel-left" title="Linke Seitenleiste ausblenden" onClick=${toggleLeft} />`}</div>
    ${tabs.map((t) => {
      const cur = currentOf(t);
      const title = viewTitle(cur);
      return html`<div key=${t.id} class=${`tab${t.id === active ? ' active' : ''}`} title=${title}
          onClick=${() => setActive(t.id)} onAuxClick=${(e) => e.button === 1 && closeTab(t.id)} onContextMenu=${(e) => tabMenu(e, t)}>
        <${Icon} name=${VIEWS[cur.view]?.icon || 'file'} size=${14} />
        <span class="tab-title">${title}</span>
        <button type="button" class="tab-close" title="Schließen" onClick=${(e) => { e.stopPropagation(); closeTab(t.id); }}><${Icon} name="x" size=${14} /></button>
      </div>`;
    })}
    <div class="tb-tools"><${IconBtn} icon="plus" title="Neuer Tab" onClick=${newTab} /></div>
    <div class="tb-tools tb-end">
      <${IconBtn} icon="chevron-down" title="Alle Tabs" onClick=${(e) => tabListMenu(e, tabs)} />
      <${IconBtn} icon="panel-right" class=${dot ? 'has-dot' : ''} title=${rightOpen ? 'Rechte Seitenleiste ausblenden' : 'Rechte Seitenleiste (Chat, Rückverweise …)'} onClick=${toggleRight} />
    </div>
  </div>`;
}

function MobileHeader({ tabs, active }) {
  useStore(vault, (s) => s.version);
  const dot = useChatDot();
  const at = tabs.find((t) => t.id === active);
  return html`<div class="m-header">
    <${IconBtn} icon="panel-left" title="Seitenleiste" onClick=${toggleLeft} size=${20} />
    <div class="m-title">${viewTitle(currentOf(at))}</div>
    <div class="tabbar">
      ${tabs.map((t) => {
        const cur = currentOf(t);
        return html`<div key=${t.id} class=${`tab${t.id === active ? ' active' : ''}`} onClick=${() => setActive(t.id)}>
          <span class="tab-title">${viewTitle(cur)}</span>
          ${t.id === active ? html`<button type="button" class="tab-close" onClick=${(e) => { e.stopPropagation(); closeTab(t.id); }}><${Icon} name="x" size=${14} /></button>` : null}
        </div>`;
      })}
    </div>
    <${IconBtn} icon="plus" title="Neuer Tab" onClick=${newTab} />
    <button type="button" class="tab-count only-phone" title="Tabs" onClick=${(e) => tabListMenu(e, tabs)}>${tabs.length}</button>
    <${IconBtn} icon="chevron-down" class="only-tablet" title="Tabs" onClick=${(e) => tabListMenu(e, tabs)} />
    <${IconBtn} icon="panel-right" class=${dot ? 'has-dot' : ''} title="Rechte Seitenleiste (Chat …)" onClick=${toggleRight} size=${20} />
  </div>`;
}

function StatusBar() {
  const s = useStore(app, (x) => ({ mode: x.mode, sync: x.sync, viewAsPlayer: x.viewAsPlayer, role: x.role }));
  const count = useStore(vault, (x) => Object.keys(x.notes).length);
  const cloudOk = s.mode === 'cloud' && s.sync !== 'offline';
  return html`<div class="statusbar">
    ${s.role === 'gm'
      ? html`<button type="button" class=${s.viewAsPlayer ? 'warn' : ''} title="Zeigt die App so, wie Spieler sie sehen" onClick=${() => app.set({ viewAsPlayer: !s.viewAsPlayer })}>
          <${Icon} name=${s.viewAsPlayer ? 'eye' : 'eye-off'} size=${13} />${s.viewAsPlayer ? 'Spieleransicht aktiv' : 'Spieleransicht'}</button>`
      : html`<span><${Icon} name="user" size=${13} /> Spieler</span>`}
    <span>${count} Notizen</span>
    <button type="button" class=${cloudOk ? 'ok' : s.sync === 'offline' ? 'warn' : ''} onClick=${() => openView('settings', { section: 'konto' })} title="Konto & Sync">
      <${Icon} name=${s.mode === 'cloud' ? (s.sync === 'offline' ? 'cloud-off' : 'cloud') : 'save'} size=${13} />
      ${s.mode === 'cloud' ? (s.sync === 'offline' ? 'Offline – synchronisiert später' : 'Synchronisiert') : 'Nur auf diesem Gerät'}
    </button>
  </div>`;
}

export function openSearchPanel() {
  showLeftPanel('search');
}
