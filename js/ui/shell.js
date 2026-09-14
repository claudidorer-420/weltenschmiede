// App-Hülle: Anmeldung/Start, Ribbon, Seitenleisten, Tabs, Ansichten (lazy geladen), Statusleiste.
import { html, useState, useEffect, useLayoutEffect } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, vault, noteById } from '../core/app.js';
import {
  ws, currentOf, openView, closeTab, setActive, newTab, toggleLeft, toggleRight, restoreTabs,
  showLeftPanel, closeOtherTabs, moveTab,
} from '../core/workspace.js';
import { Icon, IconBtn, OverlayHost, ErrorBoundary, openMenu, useMedia, Spinner, Empty, Avatar } from './components.js';
import { ViewFrame } from './frame.js';
import { Palette, registerShortcuts, openPalette } from './palette.js';
import { LeftSidebar, RightSidebar } from '../views/codex.js';
import { AuthScreen } from '../views/auth.js';
import { Lobby } from '../views/home.js';
import { accountMenu } from './account.js';
import { DiceOverlay } from './dicetray.js';

const LOADERS = {
  home: () => import('../views/home.js'),
  codex: () => import('../views/codex.js'),
  graph: () => import('../views/graph.js'),
  forge: () => import('../views/forge.js'),
  npc: () => import('../views/npc.js'),
  encounter: () => import('../views/encounter.js'),
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
  bestiary: { title: 'Bestiarium', icon: 'ghost', gm: true, mod: 'encounter', comp: 'BestiaryView' },
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

const RIBBON_GM = [
  { view: 'home', icon: 'home', title: 'Start' },
  { action: () => openPalette('switcher'), icon: 'search', title: 'Schnellwechsler (Strg+O)' },
  { view: 'graph', icon: 'graph', title: 'Graph-Ansicht (Strg+G)' },
  '|',
  { view: 'forge', icon: 'anvil', title: 'Weltenschmiede (KI)' },
  { view: 'npc', icon: 'mask', title: 'NPC-Schmiede' },
  { view: 'encounter', icon: 'swords', title: 'Encounter & Statblocks' },
  { view: 'combat', icon: 'sword', title: 'Kampf-Tracker' },
  { view: 'maps', icon: 'map', title: 'Karten' },
  '|',
  { view: 'table', icon: 'message', title: 'Spieltisch (online)' },
  { view: 'sessions', icon: 'calendar', title: 'Sitzungen' },
  { view: 'quests', icon: 'list-checks', title: 'Quests' },
  { view: 'characters', icon: 'users', title: 'Charaktere' },
  '|',
  { view: 'dice', icon: 'd20', title: 'Würfel' },
  { view: 'generators', icon: 'dices', title: 'Zufallsgeneratoren' },
  { view: 'oracle', icon: 'sparkles', title: 'Orakel (Codex-KI)' },
  { view: 'rules', icon: 'book', title: 'Regeln' },
  { view: 'archive', icon: 'archive', title: 'Archiv der Welten' },
  '~',
  { action: () => openPalette('commands'), icon: 'command', title: 'Befehle (Strg+P)' },
  { view: 'import', icon: 'upload', title: 'Import & Export' },
  { view: 'settings', icon: 'settings', title: 'Einstellungen' },
];

const RIBBON_PLAYER = [
  { view: 'home', icon: 'home', title: 'Start' },
  { action: () => openPalette('switcher'), icon: 'search', title: 'Schnellwechsler (Strg+O)' },
  { view: 'graph', icon: 'graph', title: 'Graph-Ansicht' },
  '|',
  { view: 'table', icon: 'message', title: 'Spieltisch' },
  { view: 'characters', icon: 'user', title: 'Mein Charakter' },
  { view: 'journal', icon: 'feather', title: 'Mein Tagebuch' },
  { view: 'combat', icon: 'sword', title: 'Kampf' },
  { view: 'maps', icon: 'map', title: 'Karten' },
  { view: 'quests', icon: 'list-checks', title: 'Quests' },
  { view: 'sessions', icon: 'calendar', title: 'Sitzungen' },
  { view: 'handouts', icon: 'scroll', title: 'Handouts' },
  '|',
  { view: 'dice', icon: 'd20', title: 'Würfel' },
  { view: 'rules', icon: 'book', title: 'Regeln' },
  '~',
  { view: 'settings', icon: 'settings', title: 'Einstellungen' },
];

// ───────────────────────── Wurzel ─────────────────────────
export function App() {
  const phase = useStore(app, (s) => s.phase);
  const user = useStore(app, (s) => s.user);
  let body;
  if (phase === 'boot' || phase === 'loading') body = html`<${BootScreen} />`;
  else if (!user) body = html`<${AuthScreen} />`;
  else body = html`<${Workspace} />`;
  return html`${body}<${OverlayHost} /><${DiceOverlay} /><${Palette} />`;
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
  useEffect(() => {
    const h = location.hash;
    const m = /#\/(dice|table)$/.exec(h);
    if (m && cid) openView(m[1]);
  }, [cid]);
  if (!cid) return html`<${Lobby} />`;
  const views = s.tabs.map((t) => html`<${ViewHost} key=${t.id} tab=${t} active=${t.id === s.active} />`);
  const main = html`<main class="main">
    ${mobile ? html`<${MobileHeader} tabs=${s.tabs} active=${s.active} />` : html`<${TabBar} tabs=${s.tabs} active=${s.active} leftOpen=${s.leftOpen} rightOpen=${s.rightOpen} />`}
    ${views}
    ${!mobile ? html`<${StatusBar} />` : null}
  </main>`;
  if (mobile) {
    return html`<div class="app">
      ${main}
      ${s.drawer ? html`<div class="drawer-backdrop" onClick=${() => ws.set({ drawer: null })} />` : null}
      <div class=${`drawer left${s.drawer === 'left' ? ' open' : ''}`}><${Ribbon} /><${LeftSidebar} /></div>
      <div class=${`drawer right${s.drawer === 'right' ? ' open' : ''}`}><${RightSidebar} /></div>
    </div>`;
  }
  return html`<div class="app"><${Ribbon} />${s.leftOpen ? html`<${LeftSidebar} />` : null}${main}${s.rightOpen ? html`<${RightSidebar} />` : null}</div>`;
}

function Ribbon() {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const user = useStore(app, (s) => s.user);
  const current = useStore(ws, (s) => currentOf(s.tabs.find((t) => t.id === s.active)).view);
  const items = gm ? RIBBON_GM : RIBBON_PLAYER;
  return html`<nav class="ribbon" aria-label="Module">
    ${items.map((it, i) => {
      if (it === '|') return html`<div class="ribbon-sep" key=${`s${i}`} />`;
      if (it === '~') return html`<div class="grow" key=${`g${i}`} />`;
      return html`<button key=${it.title} type="button" class=${`ribbon-btn${it.view && current === it.view ? ' active' : ''}`} title=${it.title} aria-label=${it.title}
        onClick=${(e) => (it.action ? it.action() : openView(it.view, {}, { newTab: e.ctrlKey || e.metaKey }))}><${Icon} name=${it.icon} size=${19} /></button>`;
    })}
    <button type="button" class="ribbon-btn ribbon-avatar" title=${`${user?.name || 'Konto'} – Konto, Übersicht, Abmelden`} aria-label="Konto" onClick=${accountMenu}><${Avatar} name=${user?.name} size="sm" /></button>
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

function TabBar({ tabs, active, leftOpen, rightOpen }) {
  useStore(vault, (s) => s.version);
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
      <${IconBtn} icon="panel-right" title=${rightOpen ? 'Rechte Seitenleiste ausblenden' : 'Rechte Seitenleiste'} onClick=${toggleRight} />
    </div>
  </div>`;
}

function MobileHeader({ tabs, active }) {
  useStore(vault, (s) => s.version);
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
    <${IconBtn} icon="panel-right" title="Rechte Seitenleiste" onClick=${toggleRight} size=${20} />
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
