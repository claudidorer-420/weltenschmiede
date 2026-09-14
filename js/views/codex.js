// Codex (wie Obsidian): Dateiexplorer, Suche, Tags, Lesezeichen, Notiz lesen/bearbeiten, Rückverweise, Gliederung, Papierkorb.
import { html, useState, useEffect, useRef, useMemo, useLayoutEffect } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import {
  app, vault, isGM, isRealGM, myUid, getIndex, noteById, updateNote, renameNote, moveNote, deleteNote, duplicateNote,
  createNote, createFolder, renameFolder, deleteFolder, allFolders, watchSecret, saveSecret, searchNotes, restoreNote,
  purgeNote, setNoteVisibility, col, setFolderMeta,
} from '../core/app.js';
import { ws, openNote, openView, setEditMode, forgetNote, openSearch, currentOf, isMobile } from '../core/workspace.js';
import { settings, updateSettings } from '../core/settings.js';
import {
  Icon, IconBtn, Btn, Field, MarkdownView, openMenu, confirmDialog, promptDialog, toast, Empty, VisibilityBadge, openModal,
  DictateButton, scrollToHeading, handleMarkdownClick, pickFiles, openLightbox, AutoTextarea,
} from '../ui/components.js';
import { ViewFrame } from '../ui/frame.js';
import { parseFrontmatter, extractHeadings, toggleTask, renderInline, wordCount, extractEmbeddedFiles, stripMarkdown } from '../lib/markdown.js';
import { saveFile, fileUrl, deleteFile, updateFileMeta } from '../core/files.js';
import { db } from '../core/db.js';
import { debounce, fmtRelative, sortBy, esc, copyText, download, now } from '../lib/util.js';
import { groupColor } from '../core/groups.js';
import { TEMPLATES } from '../data/templates.js';
import { newNoteQuick } from '../ui/palette.js';
import { useCol } from '../core/hooks.js';
import { campaignMenu } from './home.js';

// ───────────────────────── Aktionen ─────────────────────────
export async function toggleVisibility(n) {
  const v = n.visibility === 'players' ? 'gm' : 'players';
  await setNoteVisibility(n.id, v);
  if (v === 'players') {
    for (const name of extractEmbeddedFiles(n.body)) {
      const f = getIndex().fileByName.get(name.toLowerCase());
      if (f && f.visibility !== 'players') await updateFileMeta(app.get().cid, f.id, { visibility: 'players' }).catch(() => {});
    }
  }
  toast(v === 'players' ? `„${n.title}“ ist jetzt für Spieler sichtbar` : `„${n.title}“ ist nur noch für die Spielleitung`, 'success');
}

export async function uploadImage(file, { visibility = 'gm', folder = 'attachments', maxDim } = {}) {
  const taken = (name) => Object.values(vault.get().files).some((f) => String(f.name).toLowerCase() === name.toLowerCase());
  const name = file.name && !/^(image|bild)\.(png|jpe?g|webp)$/i.test(file.name) ? file.name : undefined;
  return saveFile(app.get().cid, file, { name, folder, visibility, createdBy: myUid(), exists: taken, maxDim });
}

function toggleBookmark(id) {
  const b = settings.get().bookmarks || [];
  updateSettings({ bookmarks: b.includes(id) ? b.filter((x) => x !== id) : [...b, id] });
}

async function renameDialog(n) {
  const t = await promptDialog('Neuer Name', n.title, { title: 'Notiz umbenennen', ok: 'Umbenennen', hint: 'Alle [[Links]] auf diese Notiz werden automatisch angepasst.' });
  if (!t) return;
  try {
    await renameNote(n.id, t);
  } catch (e) {
    toast(e.message, 'error');
  }
}

export function moveDialog(ids) {
  return openModal(({ close }) => {
    const [q, setQ] = useState('');
    const folders = ['', ...allFolders()].filter((f) => !q || f.toLowerCase().includes(q.toLowerCase()));
    const go = async (f) => {
      for (const id of ids) await moveNote(id, f);
      close(true);
      toast(`Verschoben nach „${f || 'Hauptordner'}“`, 'success');
    };
    return html`<div class="modal-body stack">
      <input class="input" placeholder="Ordner suchen oder neuen Pfad eingeben (z. B. Orte/Städte)" value=${q} onInput=${(e) => setQ(e.target.value)} autoFocus />
      <div class="list" style="max-height:50vh;overflow:auto">
        ${folders.map((f) => html`<div class="list-item" onClick=${() => go(f)}><${Icon} name=${f ? 'folder' : 'home'} size=${16} /><span class="title">${f || 'Hauptordner'}</span></div>`)}
        ${q && !allFolders().includes(q) ? html`<div class="list-item" onClick=${async () => { await createFolder(q); go(q); }}><${Icon} name="folder-plus" size=${16} /><span class="title">Neuer Ordner „${q}“</span></div>` : null}
      </div>
    </div>`;
  }, { title: 'Verschieben nach …', icon: 'folder' });
}

async function newFolderDialog(parent = '') {
  const name = await promptDialog('Ordnername', '', { title: parent ? `Neuer Unterordner in „${parent}“` : 'Neuer Ordner', ok: 'Anlegen' });
  if (!name) return;
  await createFolder(parent ? `${parent}/${name}` : name);
}

async function deleteNoteDialog(n) {
  if (!(await confirmDialog(`„${n.title}“ in den Papierkorb verschieben?`, { ok: 'In den Papierkorb', danger: true }))) return;
  await deleteNote(n.id);
  forgetNote(n.id);
  toast(`„${n.title}“ gelöscht`, 'info', { action: { label: 'Rückgängig', onClick: () => restoreNote(n.id) } });
}

async function shareAsHandout(n) {
  await db.add(col('handouts'), { title: n.title, noteId: n.id, body: n.body || '', visibility: 'players', ts: now(), by: myUid() });
  toast('Als Handout an die Spieler geschickt', 'success', { action: { label: 'Ansehen', onClick: () => openView('handouts') } });
}

export function noteMenu(e, n) {
  const gm = isGM();
  const bm = (settings.get().bookmarks || []).includes(n.id);
  openMenu(e, [
    { label: 'In neuem Tab öffnen', icon: 'plus', onClick: () => openNote(n.id, { newTab: true }) },
    gm && { label: 'Bearbeiten', icon: 'pencil', onClick: () => { setEditMode(n.id, true); openNote(n.id); } },
    gm && { divider: true },
    gm && { label: 'Umbenennen …', icon: 'edit-square', onClick: () => renameDialog(n) },
    gm && { label: 'Verschieben nach …', icon: 'folder', onClick: () => moveDialog([n.id]) },
    gm && { label: n.visibility === 'players' ? 'Vor Spielern verbergen' : 'Für Spieler freigeben', icon: n.visibility === 'players' ? 'lock' : 'users', onClick: () => toggleVisibility(n) },
    gm && { label: 'Duplizieren', icon: 'copy', onClick: async () => { const c = await duplicateNote(n.id); if (c) openNote(c.id); } },
    gm && { label: 'Als Handout an Spieler senden', icon: 'scroll', onClick: () => shareAsHandout(n) },
    { divider: true },
    { label: bm ? 'Nicht mehr anheften' : 'Oben im Explorer anheften', icon: 'bookmark', onClick: () => toggleBookmark(n.id) },
    { label: '[[Link]] kopieren', icon: 'link', onClick: () => { copyText(`[[${n.title}]]`); toast('Link kopiert'); } },
    { label: 'Im Graph zeigen', icon: 'graph', onClick: () => openView('graph', { focus: n.id }) },
    { label: 'Als Markdown herunterladen', icon: 'download', onClick: () => download(`${n.title}.md`, n.body || '', 'text/markdown;charset=utf-8') },
    { label: 'Drucken / als PDF', icon: 'printer', onClick: () => { setEditMode(n.id, false); openNote(n.id); setTimeout(() => window.print(), 400); } },
    gm && { divider: true },
    gm && { label: 'Löschen', icon: 'trash', danger: true, onClick: () => deleteNoteDialog(n) },
  ]);
}

// ── Ordner markieren: Farbe, Symbol und Etikett (wie die Spalten bei den Quests) ──
export const FOLDER_COLORS = [['Rot', '#ef5a5f'], ['Orange', '#ff9a3c'], ['Gelb', '#f5c542'], ['Grün', '#3dd68c'], ['Türkis', '#2ec7c9'], ['Blau', '#4d8dff'], ['Lila', '#a78bfa'], ['Pink', '#ff7ab6'], ['Gold', '#e0b24a'], ['Grau', '#9a9a9a']];
const FOLDER_ICONS = ['folder', 'castle', 'crown', 'landmark', 'map-pin', 'map', 'globe', 'mountain', 'trees', 'ship', 'store', 'beer', 'users', 'user', 'mask', 'ghost', 'skull', 'swords', 'shield', 'gem', 'coins', 'scroll', 'book', 'feather', 'calendar', 'list-checks', 'target', 'compass', 'sparkles', 'flame', 'star', 'key', 'lock', 'anvil'];
const FOLDER_LABELS = ['Aktuell', 'Wichtig', 'In Arbeit', 'Fertig', 'Idee', 'Geheim', 'Archiv'];
const KIND_ICON = {
  npc: 'user', person: 'user', charakter: 'user', ort: 'map-pin', stadt: 'castle', dorf: 'castle', region: 'globe', reich: 'crown', land: 'globe',
  laden: 'store', geschaeft: 'store', taverne: 'beer', gasthaus: 'beer', quest: 'target', auftrag: 'target', monster: 'ghost', kreatur: 'ghost',
  fraktion: 'shield', organisation: 'shield', gott: 'sparkles', gottheit: 'sparkles', gegenstand: 'gem', item: 'gem', artefakt: 'gem',
  sitzung: 'calendar', session: 'calendar', abenteuer: 'compass', handout: 'scroll', dungeon: 'skull', schiff: 'ship', ereignis: 'flame',
};

function FolderStyleForm({ close, path, cur }) {
  const [f, setF] = useState({ color: cur.color || '', icon: cur.icon || '', label: cur.label || '' });
  const name = path.split('/').pop();
  return html`<div class="modal-body stack">
    <div class="tree-row folder preview-row" style=${f.color ? { '--fc': f.color } : {}}>
      <span class="chev"><${Icon} name="chevron-right" size=${14} /></span><span class="f-icon"><${Icon} name=${f.icon || 'folder'} size=${15} /></span>
      <span class="name folder-name">${name}</span>${f.label ? html`<span class="f-label">${f.label}</span>` : null}<span class="f-count">12</span>
    </div>
    <${Field} label="Farbe"><div class="color-pick">
      <button type="button" title="Keine" class=${!f.color ? 'active' : ''} style="background:var(--bg-3)" onClick=${() => setF({ ...f, color: '' })}></button>
      ${FOLDER_COLORS.map(([n, c]) => html`<button type="button" title=${n} class=${f.color === c ? 'active' : ''} style=${{ background: c }} onClick=${() => setF({ ...f, color: c })}></button>`)}
    </div><//>
    <${Field} label="Symbol"><div class="icon-pick">${FOLDER_ICONS.map((ic) => html`<button type="button" title=${ic} class=${(f.icon || 'folder') === ic ? 'active' : ''} onClick=${() => setF({ ...f, icon: ic === 'folder' ? '' : ic })}><${Icon} name=${ic} size=${17} /></button>`)}</div><//>
    <${Field} label="Etikett (optional)" hint="Kurzer Marker wie bei den Quest-Spalten, z. B. „Aktuell“ für das Gebiet, in dem die Gruppe gerade ist.">
      <input class="input" value=${f.label} maxlength="16" onInput=${(e) => setF({ ...f, label: e.target.value })} placeholder="z. B. Aktuell" />
      <div class="chips" style="margin-top:6px">${FOLDER_LABELS.map((l) => html`<button type="button" class=${`chip${f.label === l ? ' selected' : ' suggest'}`} onClick=${() => setF({ ...f, label: f.label === l ? '' : l })}>${l}</button>`)}</div>
    <//>
  </div>
  <div class="modal-foot">
    <${Btn} kind="ghost" onClick=${() => close({ color: '', icon: '', label: '' })}>Zurücksetzen<//><span class="grow"></span>
    <${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" icon="check" onClick=${() => close(f)}>Speichern<//>
  </div>`;
}

async function folderStyleDialog(path) {
  const cur = app.get().campaign?.folderMeta?.[path] || {};
  const r = await openModal(({ close }) => html`<${FolderStyleForm} close=${close} path=${path} cur=${cur} />`, { title: `Ordner „${path.split('/').pop()}“ markieren`, icon: 'palette' });
  if (r) await setFolderMeta(path, r);
}

function folderMenu(e, path) {
  const inside = () => Object.values(vault.get().notes).filter((n) => (n.folder || '') === path || (n.folder || '').startsWith(`${path}/`));
  openMenu(e, [
    { label: 'Farbe, Symbol & Etikett …', icon: 'palette', onClick: () => folderStyleDialog(path) },
    { divider: true },
    { label: 'Neue Notiz hier', icon: 'file-plus', onClick: () => newNoteQuick(path) },
    { label: 'Aus Vorlage …', icon: 'file-text', onClick: () => templateMenu(e, path) },
    { label: 'Neuer Unterordner …', icon: 'folder-plus', onClick: () => newFolderDialog(path) },
    { divider: true },
    { label: 'Umbenennen …', icon: 'edit-square', onClick: async () => {
      const leaf = path.split('/').pop();
      const t = await promptDialog('Neuer Ordnername', leaf, { title: 'Ordner umbenennen' });
      if (t) await renameFolder(path, path.split('/').slice(0, -1).concat(t).join('/'));
    } },
    { label: 'Alles darin für Spieler freigeben', icon: 'users', onClick: async () => {
      const list = inside();
      for (const n of list) if (n.visibility !== 'players') await setNoteVisibility(n.id, 'players');
      toast(`${list.length} Notizen freigegeben`, 'success');
    } },
    { label: 'Alles darin verbergen', icon: 'lock', onClick: async () => {
      const list = inside();
      for (const n of list) if (n.visibility !== 'gm') await setNoteVisibility(n.id, 'gm');
      toast(`${list.length} Notizen verborgen`, 'success');
    } },
    { divider: true },
    { label: 'Ordner löschen', icon: 'trash', danger: true, onClick: async () => {
      const count = inside().length;
      if (!(await confirmDialog(`Ordner „${path}“${count ? ` samt ${count} Notizen (→ Papierkorb)` : ''} löschen?`, { danger: true, ok: 'Löschen' }))) return;
      await deleteFolder(path);
    } },
  ]);
}

function fileMenu(e, f) {
  const cid = app.get().cid;
  openMenu(e, [
    { label: 'Anzeigen', icon: 'image', onClick: () => fileUrl(cid, f.id).then(openLightbox) },
    { label: '![[Einbettung]] kopieren', icon: 'copy', onClick: () => { copyText(`![[${f.name}]]`); toast('Kopiert'); } },
    { label: f.visibility === 'players' ? 'Vor Spielern verbergen' : 'Für Spieler freigeben', icon: f.visibility === 'players' ? 'lock' : 'users', onClick: () => updateFileMeta(cid, f.id, { visibility: f.visibility === 'players' ? 'gm' : 'players' }) },
    { divider: true },
    { label: 'Löschen', icon: 'trash', danger: true, onClick: async () => {
      if (await confirmDialog(`Datei „${f.name}“ endgültig löschen?`, { danger: true, ok: 'Löschen' })) await deleteFile(cid, f.id);
    } },
  ]);
}

export function templateMenu(e, folder = '') {
  openMenu(e, [
    { header: true, label: 'Neue Notiz aus Vorlage' },
    ...TEMPLATES.map((t) => ({
      label: t.label, icon: t.icon,
      onClick: async () => {
        const title = await promptDialog('Name', '', { title: `Neu: ${t.label}`, ok: 'Anlegen', placeholder: t.placeholder || '' });
        if (!title) return;
        const n = await createNote({ title, folder: folder || t.folder || '', body: t.body(title) });
        setEditMode(n.id, true);
        openNote(n.id);
      },
    })),
  ]);
}

// ───────────────────────── Linke Seitenleiste ─────────────────────────
const PANELS = [
  { id: 'files', label: 'Dateiexplorer', icon: 'folder' },
  { id: 'search', label: 'Suche', icon: 'search' },
  { id: 'tags', label: 'Tags', icon: 'tag' },
  { id: 'bookmarks', label: 'Lesezeichen', icon: 'bookmark' },
];

export function LeftSidebar() {
  const panel = useStore(ws, (s) => s.leftPanel);
  const p = PANELS.find((x) => x.id === panel) || PANELS[0];
  const pick = (e) => openMenu(e, PANELS.map((x) => ({ label: x.label, icon: x.id === panel ? 'check' : x.icon, onClick: () => ws.set({ leftPanel: x.id }) })));
  let body;
  if (panel === 'search') body = html`<${SearchPanel} />`;
  else if (panel === 'tags') body = html`<div class="sidebar-body"><${TagsPanel} /></div>`;
  else if (panel === 'bookmarks') body = html`<div class="sidebar-body"><${BookmarksPanel} /></div>`;
  else body = html`<${FileExplorer} />`;
  return html`<aside class="sidebar left">
    <div class="sidebar-head">
      <button type="button" class="panel-select" onClick=${pick}><${Icon} name=${p.icon} size=${17} /><span class="t">${p.label}</span><${Icon} name="chevrons-up-down" size=${15} /></button>
      ${isMobile() ? html`<${IconBtn} icon="x" title="Schließen" onClick=${() => ws.set({ drawer: null })} />` : null}
    </div>
    ${body}
    <${VaultFooter} />
  </aside>`;
}

function VaultFooter() {
  const campaign = useStore(app, (s) => s.campaign);
  const role = useStore(app, (s) => s.role);
  const count = useStore(vault, (s) => Object.keys(s.notes).length);
  const v = useStore(vault, (s) => s.version);
  const folders = useMemo(() => allFolders().length, [v, campaign?.folders]);
  return html`<div class="sidebar-foot">
    <button type="button" class="vault-switch" onClick=${campaignMenu}>
      <span class="vault-name"><span>${campaign?.name || '…'}</span><${Icon} name="chevron-down" size=${15} /></span>
      <span class="vault-meta">${count} Notizen, ${folders} Ordner · ${role === 'gm' ? 'Spielleitung' : 'Spieler'}</span>
    </button>
    <${IconBtn} icon="settings" title="Einstellungen" onClick=${() => openView('settings')} />
  </div>`;
}

function buildTree(notes, files, folders) {
  const root = { name: '', path: '', folders: new Map(), notes: [], files: [], count: 0 };
  const ensure = (path) => {
    if (!path) return root;
    let node = root;
    let p = '';
    for (const part of path.split('/')) {
      p = p ? `${p}/${part}` : part;
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path: p, folders: new Map(), notes: [], files: [], count: 0 });
      node = node.folders.get(part);
    }
    return node;
  };
  folders.forEach(ensure);
  notes.forEach((n) => ensure(n.folder || '').notes.push(n));
  files.forEach((f) => ensure(f.folder || '').files.push(f));
  const tally = (node) => {
    node.count = node.notes.length + [...node.folders.values()].reduce((a, c) => a + tally(c), 0);
    return node.count;
  };
  tally(root);
  return root;
}

function FileExplorer() {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const cid = useStore(app, (s) => s.cid);
  const campaign = useStore(app, (s) => s.campaign);
  const v = useStore(vault, (s) => s.version);
  const activeId = useStore(ws, (s) => {
    const c = currentOf(s.tabs.find((t) => t.id === s.active));
    return c.view === 'note' ? c.params.id : null;
  });
  const groups = useStore(settings, (s) => s.graph.groups);
  const [sort, setSort] = useState(() => localStorage.getItem('ws.sort') || 'az');
  const [expanded, setExpanded] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`ws.expanded.${cid}`) || '{}'); } catch { return {}; }
  });
  const [dragOver, setDragOver] = useState(null);
  const [q, setQ] = useState('');
  const bookmarks = useStore(settings, (s) => s.bookmarks || []);
  const meta = campaign?.folderMeta || {};
  const query = q.trim().toLowerCase();
  const persistExp = (next) => {
    setExpanded(next);
    localStorage.setItem(`ws.expanded.${cid}`, JSON.stringify(next));
  };
  const tree = useMemo(() => {
    const idx = getIndex();
    let notes = idx.notes;
    let files = idx.files;
    let folders = gm ? allFolders() : [];
    if (query) {
      const hit = (s) => String(s || '').toLowerCase().includes(query);
      notes = notes.filter((n) => hit(n.title) || (n.aliases || []).some(hit) || hit(n.folder));
      files = files.filter((f) => hit(f.name));
      folders = folders.filter(hit);
    }
    return buildTree(notes, files, folders);
  }, [v, campaign?.folders, gm, query]);
  const pinned = useMemo(() => bookmarks.map((id) => getIndex().byId.get(id)).filter(Boolean), [bookmarks, v]);
  const allPaths = () => {
    const out = {};
    const walk = (n) => n.folders.forEach((c) => { out[c.path] = true; walk(c); });
    walk(tree);
    return out;
  };

  useEffect(() => {
    const n = activeId && vault.get().notes[activeId];
    if (!n?.folder) return;
    const next = { ...expanded };
    let p = '';
    let changed = false;
    for (const part of n.folder.split('/')) {
      p = p ? `${p}/${part}` : part;
      if (!next[p]) { next[p] = true; changed = true; }
    }
    if (changed) persistExp(next);
  }, [activeId]);
  useEffect(() => {
    if (!activeId) return undefined;
    const t = setTimeout(() => document.querySelector('.sidebar .tree-row.active')?.scrollIntoView({ block: 'nearest' }), 80);
    return () => clearTimeout(t);
  }, [activeId]);

  const sortNotes = (arr) => {
    if (sort === 'za') return sortBy(arr, 'title', -1);
    if (sort === 'new') return sortBy(arr, (n) => n.updatedAt || 0, -1);
    if (sort === 'old') return sortBy(arr, (n) => n.createdAt || 0, 1);
    return sortBy(arr, 'title');
  };
  const sortMenu = (e) => openMenu(e, [
    ['az', 'Name (A–Z)'], ['za', 'Name (Z–A)'], ['new', 'Zuletzt bearbeitet'], ['old', 'Erstellt (älteste zuerst)'],
  ].map(([k, l]) => ({ label: l, icon: sort === k ? 'check' : 'sort', onClick: () => { setSort(k); localStorage.setItem('ws.sort', k); } })));

  const dropOn = async (e, path) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    if (!gm) return;
    const id = e.dataTransfer.getData('text/x-note');
    if (id) {
      await moveNote(id, path);
      return;
    }
    const filesDropped = [...(e.dataTransfer.files || [])];
    for (const f of filesDropped) {
      if (/\.(md|txt)$/i.test(f.name)) await createNote({ title: f.name.replace(/\.(md|txt)$/i, ''), folder: path, body: await f.text() });
      else if (f.type.startsWith('image/')) await uploadImage(f, { folder: path || 'attachments' });
    }
    if (filesDropped.length) toast(`${filesDropped.length} Datei(en) importiert`, 'success');
  };

  const children = (node) => html`
    ${[...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')).map(folderRow)}
    ${sortNotes(node.notes).map(noteRow)}
    ${node.files.map(fileRow)}`;

  const folderRow = (f) => {
    const open = query ? true : !!expanded[f.path];
    const m = meta[f.path] || {};
    return html`<div key=${`f:${f.path}`}>
      <div class=${`tree-row folder${dragOver === f.path ? ' drop' : ''}`} style=${m.color ? { '--fc': m.color } : null} title=${f.path}
        onClick=${() => !query && persistExp({ ...expanded, [f.path]: !open })}
        onContextMenu=${(e) => gm && folderMenu(e, f.path)}
        onDragOver=${(e) => { if (gm) { e.preventDefault(); setDragOver(f.path); } }} onDragLeave=${() => setDragOver(null)} onDrop=${(e) => dropOn(e, f.path)}>
        <span class=${`chev${open ? ' open' : ''}`}><${Icon} name="chevron-right" size=${14} /></span>
        <span class="f-icon"><${Icon} name=${m.icon || (open ? 'folder-open' : 'folder')} size=${15} /></span>
        <span class="name folder-name">${f.name}</span>
        ${m.label ? html`<span class="f-label">${m.label}</span>` : null}
        ${f.count ? html`<span class="f-count">${f.count}</span>` : null}
        ${gm ? html`<button type="button" class="f-more" title="Ordner markieren & Aktionen" onClick=${(e) => { e.stopPropagation(); folderMenu(e, f.path); }}><${Icon} name="more-horizontal" size=${15} /></button>` : null}
      </div>
      ${open ? html`<div class="tree-children" style=${m.color ? { borderLeftColor: `color-mix(in srgb, ${m.color} 50%, transparent)` } : null}>${children(f)}</div>` : null}
    </div>`;
  };
  const noteRow = (n) => {
    const color = groupColor(n, groups);
    const kindIcon = KIND_ICON[n.kind];
    return html`<div key=${n.id} class=${`tree-row${n.id === activeId ? ' active' : ''}`} title=${n.folder ? `${n.folder}/${n.title}` : n.title} draggable=${gm}
        onDragStart=${(e) => e.dataTransfer.setData('text/x-note', n.id)}
        onClick=${(e) => openNote(n.id, { newTab: e.ctrlKey || e.metaKey })}
        onAuxClick=${(e) => e.button === 1 && openNote(n.id, { newTab: true })}
        onContextMenu=${(e) => noteMenu(e, n)}>
      <span class="chev"></span>
      ${color ? html`<span class="dot" style=${{ background: color }}></span>` : kindIcon ? html`<span class="k-icon"><${Icon} name=${kindIcon} size=${13} /></span>` : null}
      <span class="name">${n.title}</span>
      ${gm && n.visibility === 'players' ? html`<span class="lock" title="Für Spieler sichtbar"><${Icon} name="users" size=${12} /></span>` : null}
    </div>`;
  };
  const fileRow = (f) => html`<div key=${`file:${f.id}`} class="tree-row" title=${f.name} onClick=${() => fileUrl(cid, f.id).then((u) => u && openLightbox(u))} onContextMenu=${(e) => gm && fileMenu(e, f)}>
    <span class="chev"></span><${Icon} name="image" size=${14} /><span class="name">${f.name}</span>
  </div>`;

  const empty = !tree.notes.length && !tree.folders.size && !tree.files.length;
  return html`
    ${gm ? html`<div class="sidebar-actions">
      <${IconBtn} icon="edit-square" title="Neue Notiz (Strg+N)" onClick=${() => newNoteQuick()} />
      <${IconBtn} icon="folder-plus" title="Neuer Ordner" onClick=${() => newFolderDialog('')} />
      <${IconBtn} icon="sort" title="Sortierung" onClick=${sortMenu} />
      <${IconBtn} icon="file-text" title="Neue Notiz aus Vorlage" onClick=${(e) => templateMenu(e, '')} />
      <${IconBtn} icon="chevrons-up-down" title="Alle ausklappen" onClick=${() => persistExp(allPaths())} />
      <${IconBtn} icon="chevrons-down-up" title="Alle einklappen" onClick=${() => persistExp({})} />
    </div>` : null}
    <div class="tree-filter">
      <${Icon} name="filter" size=${14} />
      <input class="input" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Notizen & Ordner filtern …" />
      ${q ? html`<${IconBtn} icon="x" size=${14} title="Filter löschen" onClick=${() => setQ('')} />` : null}
    </div>
    <div class=${`sidebar-body tree${dragOver === '' ? ' drop' : ''}`} onDragOver=${(e) => { if (gm) e.preventDefault(); }} onDrop=${(e) => dropOn(e, '')}>
      ${pinned.length && !query ? html`<div class="tree-section"><div class="tree-sec-title"><${Icon} name="bookmark" size=${12} />Angeheftet</div>${pinned.map(noteRow)}</div>` : null}
      ${children(tree)}
      ${query && empty ? html`<div class="tree-empty">Nichts gefunden für „${q}“.</div>` : null}
      ${!query && empty ? html`<div class="tree-empty">${gm ? html`Noch keine Notizen.<br /><br /><${Btn} size="sm" icon="file-plus" onClick=${() => newNoteQuick()}>Erste Notiz<//> <${Btn} size="sm" icon="upload" onClick=${() => openView('import')}>Obsidian importieren<//>` : 'Die Spielleitung hat noch nichts für dich freigegeben.'}</div>` : null}
      ${gm && !query && !empty && !Object.keys(meta).length ? html`<div class="tree-hint"><${Icon} name="palette" size=${13} /> Tipp: Ordner über ⋯ farbig markieren, mit Symbol und Etikett.</div>` : null}
    </div>`;
}

function highlight(text, term) {
  const e = esc(text);
  if (!term) return e;
  const re = new RegExp(esc(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return e.replace(re, (m) => `<mark>${m}</mark>`);
}

function SearchPanel() {
  const q = useStore(ws, (s) => s.searchQuery);
  const v = useStore(vault, (s) => s.version);
  const results = useMemo(() => searchNotes(q), [q, v]);
  const inp = useRef();
  useEffect(() => {
    const t = setTimeout(() => inp.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);
  return html`<div class="sidebar-body">
    <div class="search-box"><${Icon} name="search" size=${16} /><input ref=${inp} class="input" value=${q} onInput=${(e) => ws.set({ searchQuery: e.target.value })} placeholder="Suchen …" /></div>
    ${q ? html`<div class="small faint" style="padding:0 8px 6px">${results.length} Treffer</div>` : html`<div class="tree-empty">Durchsucht Titel und Inhalt aller Notizen.<br />Filter: <code>tag:#npc</code> · <code>path:Orte</code> · <code>typ:laden</code> · <code>"genaue Phrase"</code></div>`}
    ${results.map((r) => html`<div class="search-result" key=${r.note.id} onClick=${(e) => openNote(r.note.id, { newTab: e.ctrlKey || e.metaKey })}>
      <div class="t">${r.note.title}</div>
      ${r.snippet ? html`<div class="s" dangerouslySetInnerHTML=${{ __html: highlight(r.snippet, r.term) }} />` : r.note.folder ? html`<div class="s">${r.note.folder}</div>` : null}
    </div>`)}
  </div>`;
}

export function TagsPanel() {
  const v = useStore(vault, (s) => s.version);
  const tags = useMemo(() => [...getIndex().tags.entries()].map(([t, s]) => [t, s.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')), [v]);
  if (!tags.length) return html`<div class="tree-empty">Noch keine #Tags. Schreibe z. B. <code>#npc</code> in eine Notiz oder <code>tags: [ort, stadt]</code> in die Eigenschaften.</div>`;
  return html`<div class="list">${tags.map(([t, c]) => html`<div class="list-item" key=${t} onClick=${() => openSearch(`tag:#${t}`)}><${Icon} name="hash" size=${14} /><span class="title">${t}</span><span class="meta">${c}</span></div>`)}</div>`;
}

function BookmarksPanel() {
  const bms = useStore(settings, (s) => s.bookmarks || []);
  const v = useStore(vault, (s) => s.version);
  const notes = useMemo(() => bms.map((id) => getIndex().byId.get(id)).filter(Boolean), [bms, v]);
  if (!notes.length) return html`<div class="tree-empty">Noch keine Lesezeichen. Setze sie über das ⋮-Menü einer Notiz.</div>`;
  return html`<div class="list">${notes.map((n) => html`<div class="list-item" key=${n.id} onClick=${() => openNote(n.id)} onContextMenu=${(e) => noteMenu(e, n)}><${Icon} name="bookmark" size=${14} /><span class="title">${n.title}</span></div>`)}</div>`;
}

// ───────────────────────── Rechte Seitenleiste ─────────────────────────
const RIGHT_TABS = [
  ['backlinks', 'link', 'Rückverweise'],
  ['outgoing', 'arrow-right', 'Ausgehende Links'],
  ['outline', 'list', 'Gliederung'],
  ['local', 'graph', 'Lokaler Graph'],
  ['tags', 'tag', 'Tags'],
];

export function RightSidebar() {
  const panel = useStore(ws, (s) => s.rightPanel);
  const noteId = useStore(ws, (s) => {
    const c = currentOf(s.tabs.find((t) => t.id === s.active));
    return c.view === 'note' ? c.params.id : null;
  });
  const note = useStore(vault, (s) => (noteId ? s.notes[noteId] : null));
  let body;
  if (panel === 'tags') body = html`<${TagsPanel} />`;
  else if (!note) body = html`<div class="tree-empty">Öffne eine Notiz, um hier ${RIGHT_TABS.find((t) => t[0] === panel)?.[2] || 'Details'} zu sehen.</div>`;
  else if (panel === 'outgoing') body = html`<${OutgoingPanel} note=${note} />`;
  else if (panel === 'outline') body = html`<${OutlinePanel} note=${note} />`;
  else if (panel === 'local') body = html`<${LocalGraphPanel} note=${note} />`;
  else body = html`<${BacklinksPanel} note=${note} />`;
  return html`<aside class="sidebar right">
    <div class="right-tabs">
      ${RIGHT_TABS.map(([id, icon, title]) => html`<${IconBtn} key=${id} icon=${icon} title=${title} active=${panel === id} onClick=${() => ws.set({ rightPanel: id })} />`)}
      <span class="grow"></span>
      ${isMobile() ? html`<${IconBtn} icon="x" title="Schließen" onClick=${() => ws.set({ drawer: null })} />` : null}
    </div>
    <div class="sidebar-body">${body}</div>
  </aside>`;
}

function linkContext(body, titles) {
  const lines = String(body || '').split('\n');
  const ts = titles.map((t) => t.toLowerCase());
  const l = lines.find((x) => ts.some((t) => x.toLowerCase().includes(`[[${t}`))) || lines.find((x) => ts.some((t) => x.toLowerCase().includes(t))) || '';
  return stripMarkdown(l).slice(0, 180);
}

function findUnlinked(note) {
  const idx = getIndex();
  const titles = [note.title, ...(note.aliases || [])].filter((t) => t.length >= 3);
  const linked = idx.backlinks.get(note.id) || new Set();
  const out = [];
  for (const n of idx.notes) {
    if (n.id === note.id || linked.has(n.id)) continue;
    const body = String(n.body || '').toLowerCase();
    const t = titles.find((x) => body.includes(x.toLowerCase()));
    if (t) out.push({ n, t });
  }
  return out.slice(0, 50);
}

async function linkMention(n, title) {
  const body = n.body || '';
  const lower = body.toLowerCase();
  const tl = title.toLowerCase();
  let from = 0;
  while (from < body.length) {
    const i = lower.indexOf(tl, from);
    if (i < 0) break;
    const open = body.lastIndexOf('[[', i);
    const close = body.lastIndexOf(']]', i);
    if (open <= close) {
      const orig = body.slice(i, i + title.length);
      const repl = orig === title ? `[[${title}]]` : `[[${title}|${orig}]]`;
      await updateNote(n.id, { body: body.slice(0, i) + repl + body.slice(i + title.length) });
      toast(`In „${n.title}“ verlinkt`, 'success');
      return;
    }
    from = i + tl.length;
  }
}

function BacklinksPanel({ note }) {
  const v = useStore(vault, (s) => s.version);
  const gm = isGM();
  const { linked, unlinked } = useMemo(() => {
    const idx = getIndex();
    const ids = [...(idx.backlinks.get(note.id) || [])];
    return { linked: ids.map((id) => idx.byId.get(id)).filter(Boolean), unlinked: findUnlinked(note) };
  }, [v, note.id]);
  const titles = [note.title, ...(note.aliases || [])];
  return html`
    <div class="section-title" style="margin-top:4px">Verlinkte Erwähnungen · ${linked.length}</div>
    ${linked.length ? linked.map((n) => html`<div class="backlink-item" key=${n.id} onClick=${(e) => openNote(n.id, { newTab: e.ctrlKey || e.metaKey })}><div class="t">${n.title}</div><div class="s">${linkContext(n.body, titles)}</div></div>`) : html`<div class="tree-empty">Keine Notiz verlinkt hierher.</div>`}
    <div class="section-title">Unverlinkte Erwähnungen · ${unlinked.length}</div>
    ${unlinked.map(({ n, t }) => html`<div class="backlink-item" key=${n.id}>
      <div class="row nowrap"><div class="t grow ellipsis" onClick=${() => openNote(n.id)}>${n.title}</div>${gm ? html`<${Btn} size="sm" kind="ghost" onClick=${() => linkMention(n, note.title)}>Verlinken<//>` : null}</div>
      <div class="s">${linkContext(n.body, [t])}</div>
    </div>`)}`;
}

function OutgoingPanel({ note }) {
  const v = useStore(vault, (s) => s.version);
  const { out, unresolved } = useMemo(() => {
    const idx = getIndex();
    const o = (idx.outLinks.get(note.id) || []).map((id) => idx.byId.get(id)).filter(Boolean);
    const u = (note.links || []).filter((t) => !idx.resolve(t));
    return { out: o, unresolved: u };
  }, [v, note.id]);
  return html`
    <div class="section-title" style="margin-top:4px">Links · ${out.length}</div>
    ${out.map((n) => html`<div class="list-item" key=${n.id} onClick=${() => openNote(n.id)}><${Icon} name="file-text" size=${14} /><span class="title">${n.title}</span></div>`)}
    ${unresolved.length ? html`<div class="section-title">Noch nicht angelegt · ${unresolved.length}</div>
      ${unresolved.map((t) => html`<div class="list-item" key=${t} onClick=${async () => { if (!isGM()) return; const n = await createNote({ title: t }); openNote(n.id); }}><${Icon} name="file-plus" size=${14} /><span class="title faint">${t}</span></div>`)}` : null}`;
}

function OutlinePanel({ note }) {
  const heads = useMemo(() => extractHeadings(note.body || ''), [note.body]);
  if (!heads.length) return html`<div class="tree-empty">Keine Überschriften.</div>`;
  const min = Math.min(...heads.map((h) => h.level));
  return html`<div>${heads.map((h, i) => html`<div class="outline-item" key=${i} style=${{ paddingLeft: `${8 + (h.level - min) * 14}px` }}
    onClick=${() => scrollToHeading(document.querySelector('.view:not([hidden]) .view-body'), h.text)}>${h.text.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)}</div>`)}</div>`;
}

function LocalGraphPanel({ note }) {
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    import('./graph.js').then((m) => setComp(() => m.LocalGraph)).catch(() => {});
  }, []);
  if (!Comp) return html`<div class="empty"><span class="spinner" /></div>`;
  return html`<div style="height:340px;position:relative;border:1px solid var(--border);border-radius:12px;overflow:hidden"><${Comp} noteId=${note.id} /></div>
    <div class="small faint" style="padding:8px 4px">Zeigt direkte Verbindungen. Tippe einen Knoten, um die Notiz zu öffnen.</div>`;
}

// ───────────────────────── Notiz-Ansicht ─────────────────────────
export function NoteView({ params, active, tabId }) {
  const note = useStore(vault, (s) => s.notes[params.id]);
  const loaded = useStore(vault, (s) => s.loaded);
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const editFlag = useStore(ws, (s) => s.editMode[params.id]);
  const defaultEdit = useStore(settings, (s) => s.editor.defaultMode === 'edit');
  const editing = gm && (editFlag ?? defaultEdit);

  useEffect(() => {
    if (!active || !gm) return undefined;
    const f = () => setEditMode(params.id, !editing);
    addEventListener('ws:toggle-edit', f);
    return () => removeEventListener('ws:toggle-edit', f);
  }, [active, editing, gm]);

  if (!note) {
    return html`<${ViewFrame} tabId=${tabId} title="Notiz">${loaded ? html`<${Empty} icon="file" title="Notiz nicht gefunden">Sie wurde gelöscht oder ist für dich nicht sichtbar.<//>` : html`<div class="empty"><span class="spinner lg" /></div>`}<//>`;
  }
  const actions = html`<div class="row nowrap" style="gap:2px">
    ${gm ? html`<button type="button" style="margin-right:4px" title="Sichtbarkeit umschalten" onClick=${() => toggleVisibility(note)}><${VisibilityBadge} v=${note.visibility} /></button>` : null}
    ${gm ? html`<${IconBtn} icon=${editing ? 'book-open' : 'pencil'} title=${editing ? 'Lesemodus (Strg+E)' : 'Bearbeiten (Strg+E)'} onClick=${() => setEditMode(note.id, !editing)} />` : null}
    <${IconBtn} icon="more-vertical" title="Mehr" onClick=${(e) => noteMenu(e, note)} />
  </div>`;
  return html`<${ViewFrame} tabId=${tabId} title=${note.title} actions=${actions}>
    <div class="note-wrap">
      ${editing ? html`<${NoteEditor} note=${note} key=${`e:${note.id}`} />` : html`<${NoteReader} note=${note} heading=${params.heading} active=${active} />`}
      ${gm && isRealGM() ? html`<${GmSecret} note=${note} key=${`s:${note.id}`} />` : null}
      <${BacklinksBottom} note=${note} />
    </div>
  <//>`;
}

function NoteMeta({ note }) {
  const words = useMemo(() => wordCount(note.body || ''), [note.body]);
  return html`<div class="note-meta">
    ${note.folder ? html`<span class="badge"><${Icon} name="folder" size=${12} />${note.folder}</span>` : null}
    ${(note.tags || []).slice(0, 8).map((t) => html`<a class="tag" href="#" onClick=${(e) => { e.preventDefault(); openSearch(`tag:#${t}`); }}>#${t}</a>`)}
    <span class="small faint">${words} Wörter · ${fmtRelative(note.updatedAt)}</span>
  </div>`;
}

function Properties({ props }) {
  const entries = Object.entries(props).filter(([k]) => !['tags', 'tag'].includes(k));
  if (!entries.length) return null;
  const val = (v) => {
    if (Array.isArray(v)) return html`<span class="chips">${v.map((x) => html`<span class="chip" dangerouslySetInnerHTML=${{ __html: renderInline(String(x), mdLinks()) }} />`)}</span>`;
    return html`<span dangerouslySetInnerHTML=${{ __html: renderInline(String(v), mdLinks()) }} />`;
  };
  return html`<details class="properties" open onClick=${(e) => handleMarkdownClick(e, {})}>
    <summary>Eigenschaften</summary>
    ${entries.map(([k, v]) => html`<div class="prop-row"><span class="k"><${Icon} name="tag" size=${13} />${k}</span><span class="v">${val(v)}</span></div>`)}
  </details>`;
}

function mdLinks() {
  const player = !isGM();
  return { resolveLink: (t) => getIndex().resolve(t), noCreate: player };
}

function NoteReader({ note, heading, active }) {
  const { props } = useMemo(() => parseFrontmatter(note.body || ''), [note.body]);
  const ref = useRef();
  const gm = isGM();
  useEffect(() => {
    if (heading && active) {
      const t = setTimeout(() => scrollToHeading(ref.current?.closest('.view-body'), heading), 80);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [heading]);
  const empty = !stripMarkdown(note.body || '').trim();
  return html`<div ref=${ref}>
    <h1 class="inline-title" onDblClick=${() => gm && setEditMode(note.id, true)}>${note.title}</h1>
    <${NoteMeta} note=${note} />
    <${Properties} props=${props} />
    ${empty
      ? html`<p class="faint" style="font-style:italic">Diese Notiz ist noch leer.${gm ? html` <a href="#" onClick=${(e) => { e.preventDefault(); setEditMode(note.id, true); }}>Jetzt schreiben</a>` : ''}</p>`
      : html`<${MarkdownView} src=${note.body} onToggleTask=${gm ? (line) => updateNote(note.id, { body: toggleTask(note.body, line) }) : null} />`}
  </div>`;
}

function BacklinksBottom({ note }) {
  const v = useStore(vault, (s) => s.version);
  const list = useMemo(() => {
    const idx = getIndex();
    return [...(idx.backlinks.get(note.id) || [])].map((id) => idx.byId.get(id)).filter(Boolean);
  }, [v, note.id]);
  if (!list.length) return null;
  const titles = [note.title, ...(note.aliases || [])];
  return html`<div class="backlinks-section">
    <div class="section-title" style="margin-top:0"><${Icon} name="link" size=${14} /> ${list.length} ${list.length === 1 ? 'Rückverweis' : 'Rückverweise'}</div>
    ${list.map((n) => html`<div class="backlink-item" key=${n.id} onClick=${(e) => openNote(n.id, { newTab: e.ctrlKey || e.metaKey })}><div class="t">${n.title}</div><div class="s">${linkContext(n.body, titles)}</div></div>`)}
  </div>`;
}

function GmSecret({ note }) {
  const [body, setBody] = useState(null);
  const [edit, setEdit] = useState(false);
  useEffect(() => watchSecret(note.id, (b) => setBody((cur) => (edit && cur !== null ? cur : b))), [note.id]);
  const save = useMemo(() => debounce((val) => saveSecret(note.id, val), 700), [note.id]);
  useEffect(() => () => save.cancel?.(), []);
  if (body === null) return null;
  return html`<details class="gm-secret" open=${!!body || edit}>
    <summary><${Icon} name="lock" size=${16} /> SL-Geheimnisse ${body ? null : html`<span class="small faint">(leer)</span>`}
      <span class="grow"></span>
      <button type="button" class="icon-btn sm" title=${edit ? 'Fertig' : 'Bearbeiten'} onClick=${(e) => { e.preventDefault(); if (edit) save.flush?.(body); setEdit(!edit); }}><${Icon} name=${edit ? 'check' : 'pencil'} size=${14} /></button>
    </summary>
    <div class="inner">
      ${edit
        ? html`<${AutoTextarea} value=${body} onInput=${(e) => { setBody(e.target.value); save(e.target.value); }} placeholder="Nur du siehst das – wahre Motive, Fallen, Wendungen … (Markdown & [[Links]] funktionieren)" />`
        : body ? html`<${MarkdownView} src=${body} />` : html`<div class="small faint">Geheimnisse, die Spieler nie sehen – selbst wenn die Notiz freigegeben ist (liegt technisch getrennt, geschützt durch die Firestore-Regeln).</div>`}
    </div>
  </details>`;
}

// ───────────────────────── Editor ─────────────────────────
const MIRROR_PROPS = ['direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize'];

function caretXY(el, pos) {
  const div = document.createElement('div');
  const cs = getComputedStyle(el);
  MIRROR_PROPS.forEach((p) => { div.style[p] = cs[p]; });
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', top: '0', left: '-9999px', height: 'auto' });
  div.textContent = el.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = el.value.slice(pos) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const r = { top: span.offsetTop - el.scrollTop, left: span.offsetLeft - el.scrollLeft, height: parseFloat(cs.lineHeight) || 24 };
  div.remove();
  return r;
}

function insertAt(ta, text) {
  ta.focus();
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function wrapSel(ta, before, after = before, placeholder = '') {
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || placeholder;
  insertAt(ta, before + sel + after);
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
}

function prefixLines(ta, prefix) {
  const v = ta.value;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', e);
  if (le < 0) le = v.length;
  const out = v.slice(ls, le).split('\n').map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l)).join('\n');
  ta.setSelectionRange(ls, le);
  insertAt(ta, out);
}

function cycleHeading(ta) {
  const v = ta.value;
  const s = ta.selectionStart;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', s);
  if (le < 0) le = v.length;
  const line = v.slice(ls, le);
  const m = /^(#{1,6})\s/.exec(line);
  const lvl = m ? m[1].length : 0;
  const next = lvl >= 3 ? line.replace(/^#{1,6}\s/, '') : `${'#'.repeat(lvl + 1)} ${line.replace(/^#{1,6}\s/, '')}`;
  ta.setSelectionRange(ls, le);
  insertAt(ta, next);
}

const CALLOUT_CHOICES = [
  ['vorlesen', 'Vorlesetext', 'scroll'], ['gm', 'Nur SL (in Spieleransicht verborgen)', 'lock'], ['npc', 'NPC', 'user'], ['loot', 'Beute', 'gem'],
  ['info', 'Info', 'info'], ['tip', 'Tipp', 'flame'], ['warning', 'Warnung', 'alert'], ['danger', 'Gefahr', 'zap'], ['kampf', 'Kampf', 'swords'], ['quote', 'Zitat', 'quote'],
];

function NoteEditor({ note }) {
  const [title, setTitle] = useState(note.title);
  const [text, setText] = useState(note.body || '');
  const [state, setState] = useState('saved');
  const [sug, setSug] = useState(null);
  const taRef = useRef();
  const titleRef = useRef();
  const pending = useRef(false);
  const lastSaved = useRef(note.body || '');
  const textRef = useRef(text);
  textRef.current = text;

  const save = useMemo(() => debounce(async (val) => {
    setState('saving');
    try {
      await updateNote(note.id, { body: val });
      lastSaved.current = val;
      if (textRef.current === val) pending.current = false;
      setState(textRef.current === val ? 'saved' : 'dirty');
    } catch (e) {
      setState('dirty');
      toast(`Speichern fehlgeschlagen: ${e.message}`, 'error');
    }
  }, 650), [note.id]);

  useEffect(() => () => { if (pending.current) save.flush(textRef.current); }, []);
  useEffect(() => {
    if (!pending.current && (note.body || '') !== lastSaved.current && (note.body || '') !== textRef.current) {
      setText(note.body || '');
      lastSaved.current = note.body || '';
    }
  }, [note.body]);
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTitle(note.title);
  }, [note.title]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (/^Unbenannt/.test(note.title) && !note.body) {
        titleRef.current?.focus();
        titleRef.current?.select();
      } else taRef.current?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(t);
  }, []);
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const sc = el.closest('.view-body');
    const keep = sc ? sc.scrollTop : 0;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight + 4, 320)}px`;
    if (sc) sc.scrollTop = keep;
  }, [text]);

  const updateSuggest = (ta) => {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return setSug(null);
    const before = ta.value.slice(Math.max(0, pos - 150), pos);
    const m = /(!?)\[\[([^\]\n|#]*)$/.exec(before);
    if (!m) return setSug(null);
    const q = m[2].toLowerCase();
    const idx = getIndex();
    let items = [];
    if (m[1]) items = idx.files.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 12).map((f) => ({ label: f.name, icon: 'image', value: f.name }));
    items = items.concat(idx.notes.filter((n) => n.id !== note.id && (!q || n.title.toLowerCase().includes(q) || (n.aliases || []).some((a) => a.toLowerCase().includes(q))))
      .sort((a, b) => (a.title.toLowerCase().startsWith(q) ? 0 : 1) - (b.title.toLowerCase().startsWith(q) ? 0 : 1) || a.title.localeCompare(b.title, 'de'))
      .slice(0, 20).map((n) => ({ label: n.title, sub: n.folder, icon: 'file-text', value: n.title })));
    const xy = caretXY(ta, pos);
    const wrapW = ta.parentElement.clientWidth;
    setSug({ start: pos - m[2].length, q: m[2], items, act: 0, top: ta.offsetTop + xy.top + xy.height + 4, left: Math.max(0, Math.min(ta.offsetLeft + xy.left, wrapW - 280)) });
  };

  const pick = (value) => {
    const ta = taRef.current;
    const pos = ta.selectionStart;
    const hasClose = ta.value.slice(pos, pos + 2) === ']]';
    ta.setSelectionRange(sug.start, pos);
    insertAt(ta, value + (hasClose ? '' : ']]'));
    if (hasClose) ta.setSelectionRange(ta.selectionStart + 2, ta.selectionStart + 2);
    setSug(null);
  };

  const onInput = (e) => {
    const v = e.target.value;
    setText(v);
    pending.current = true;
    setState('dirty');
    save(v);
    updateSuggest(e.target);
  };

  const onKeyDown = (e) => {
    const ta = e.target;
    if (sug && sug.items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSug({ ...sug, act: Math.min(sug.items.length - 1, sug.act + 1) }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSug({ ...sug, act: Math.max(0, sug.act - 1) }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(sug.items[sug.act].value); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSug(null); return; }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrapSel(ta, '**', '**', 'fett'); return; }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrapSel(ta, '*', '*', 'kursiv'); return; }
    if (e.key === 'Tab') {
      const v = ta.value;
      const ls = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      const line = v.slice(ls, v.indexOf('\n', ta.selectionStart) < 0 ? v.length : v.indexOf('\n', ta.selectionStart));
      if (/^\s*([-*+]|\d+[.)])\s/.test(line) || ta.selectionStart !== ta.selectionEnd) {
        e.preventDefault();
        if (e.shiftKey) {
          const s = ta.selectionStart;
          if (line.startsWith('\t') || line.startsWith('    ')) {
            const cut = line.startsWith('\t') ? 1 : 4;
            ta.setSelectionRange(ls, ls + cut);
            insertAt(ta, '');
            ta.setSelectionRange(Math.max(ls, s - cut), Math.max(ls, s - cut));
          }
        } else {
          const s = ta.selectionStart;
          ta.setSelectionRange(ls, ls);
          insertAt(ta, '\t');
          ta.setSelectionRange(s + 1, s + 1);
        }
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      const v = ta.value;
      const s = ta.selectionStart;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(ls, s);
      const m = /^(\s*)([-*+]|\d+[.)]|>)(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line);
      if (m) {
        e.preventDefault();
        if (!m[5].trim()) {
          ta.setSelectionRange(ls, s);
          insertAt(ta, '');
          insertAt(ta, '\n');
          return;
        }
        let bullet = m[2];
        if (/^\d/.test(bullet)) bullet = `${parseInt(bullet, 10) + 1}${bullet.slice(-1)}`;
        insertAt(ta, `\n${m[1]}${bullet}${m[3]}${m[4] ? '[ ] ' : ''}`);
      }
    }
  };

  const uploadAndInsert = async (file) => {
    const t = toast('Bild wird gespeichert …');
    try {
      const meta = await uploadImage(file, { visibility: note.visibility });
      insertAt(taRef.current, `![[${meta.name}]]`);
    } catch (err) {
      toast(`Bild konnte nicht gespeichert werden: ${err.message}`, 'error');
    }
    return t;
  };
  const onPaste = async (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) await uploadAndInsert(f);
  };
  const onDrop = async (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) {
      if (f.type.startsWith('image/')) await uploadAndInsert(f);
      else if (/\.(md|txt)$/i.test(f.name)) insertAt(taRef.current, await f.text());
    }
  };
  const pickImage = async () => {
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    for (const f of files) await uploadAndInsert(f);
  };

  const commitTitle = async () => {
    const t = title.trim();
    if (!t || t === note.title) {
      setTitle(note.title);
      return;
    }
    try {
      setTitle(await renameNote(note.id, t));
    } catch (err) {
      toast(err.message, 'error');
      setTitle(note.title);
    }
  };

  const ta = () => taRef.current;
  const TB = (icon, label, fn) => html`<${IconBtn} icon=${icon} title=${label} onMouseDown=${(e) => e.preventDefault()} onClick=${fn} />`;
  const calloutMenu = (e) => openMenu(e, CALLOUT_CHOICES.map(([k, l, i]) => ({ label: l, icon: i, onClick: () => insertAt(ta(), `\n> [!${k}] ${k === 'vorlesen' ? '' : l}\n> `) })));
  const diceMenu = (e) => openMenu(e, [
    { label: 'Würfelwurf (1d20)', icon: 'd20', onClick: () => insertAt(ta(), '1d20') },
    { label: 'Würfel-Block (Angriff/Schaden)', icon: 'swords', onClick: () => insertAt(ta(), '\n```dice\nAngriff: 1d20+5\nSchaden: 1d8+3\n```\n') },
    { label: 'Zufallstabelle (W6)', icon: 'table', onClick: () => insertAt(ta(), '\n| d6 | Ergebnis |\n|---|---|\n| 1 |  |\n| 2 |  |\n| 3 |  |\n| 4 |  |\n| 5 |  |\n| 6 |  |\n') },
    { label: 'Statblock-Block', icon: 'ghost', onClick: () => insertAt(ta(), '\n```statblock\n{ "name": "Name", "size": "Mittelgroß", "type": "Humanoide", "ac": 12, "hp": 11, "hpDice": "2d8+2", "speed": "9 m", "abilities": { "str": 10, "dex": 12, "con": 12, "int": 10, "wis": 10, "cha": 10 }, "cr": "1/4", "actions": [ { "name": "Knüppel", "desc": "Nahkampfwaffenangriff: +2 zum Treffen, Reichweite 1,5 m. Treffer: 3 (1d4+1) Wuchtschaden." } ] }\n```\n') },
  ]);
  const templateInsert = (e) => openMenu(e, TEMPLATES.map((t) => ({ label: t.label, icon: t.icon, onClick: () => insertAt(ta(), `\n${t.body(note.title)}`) })));

  return html`<div style="position:relative">
    <input ref=${titleRef} class="inline-title-input" value=${title} placeholder="Titel"
      onInput=${(e) => setTitle(e.target.value)} onBlur=${commitTitle}
      onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); taRef.current?.focus(); } }} />
    ${settings.get().editor.toolbar !== false ? html`<div class="md-toolbar">
      ${TB('heading', 'Überschrift', () => cycleHeading(ta()))}
      ${TB('bold', 'Fett (Strg+B)', () => wrapSel(ta(), '**', '**', 'fett'))}
      ${TB('italic', 'Kursiv (Strg+I)', () => wrapSel(ta(), '*', '*', 'kursiv'))}
      ${TB('list', 'Liste', () => prefixLines(ta(), '- '))}
      ${TB('square-check', 'Aufgabe', () => prefixLines(ta(), '- [ ] '))}
      <span class="sep"></span>
      ${TB('link', 'Notiz verlinken [[ ]]', () => { wrapSel(ta(), '[[', ']]', ''); updateSuggest(ta()); })}
      ${TB('quote', 'Callout (Vorlesetext, SL-Info …)', calloutMenu)}
      ${TB('table', 'Tabelle', () => insertAt(ta(), '\n| Spalte | Spalte |\n|---|---|\n|  |  |\n'))}
      ${TB('d20', 'Würfel & Zufallstabellen', diceMenu)}
      ${TB('image', 'Bild einfügen', pickImage)}
      <span class="sep"></span>
      <${DictateButton} onText=${(t) => insertAt(ta(), (/\S$/.test(ta().value.slice(0, ta().selectionStart)) ? ' ' : '') + t)} />
      ${TB('file-text', 'Vorlage einfügen', templateInsert)}
      ${TB('undo', 'Rückgängig', () => { ta().focus(); document.execCommand('undo'); })}
      <span class="grow"></span>
      <span class="save-state">${state === 'saved' ? html`<${Icon} name="check" size=${13} /> Gespeichert` : state === 'saving' ? 'Speichert …' : 'Ungespeichert'}</span>
    </div>` : null}
    <textarea ref=${taRef} class="editor-area" value=${text} spellcheck=${settings.get().editor.spellcheck !== false}
      onInput=${onInput} onKeyDown=${onKeyDown} onPaste=${onPaste} onDrop=${onDrop}
      onClick=${(e) => updateSuggest(e.target)}
      onBlur=${() => { if (pending.current) save.flush(textRef.current); setTimeout(() => setSug(null), 180); }}
      placeholder="Schreibe los … [[ verlinkt Notizen · #tag · 1d20 wird klickbar · > [!vorlesen] für Vorlesetexte" />
    ${sug && sug.items.length ? html`<div class="ac-pop" style=${{ top: `${sug.top}px`, left: `${sug.left}px` }}>
      ${sug.items.map((it, i) => html`<div class=${`suggest-item${i === sug.act ? ' active' : ''}`} onMouseDown=${(e) => { e.preventDefault(); pick(it.value); }}>
        <${Icon} name=${it.icon} size=${15} /><span class="ellipsis">${it.label}</span>${it.sub ? html`<span class="path">${it.sub}</span>` : null}
      </div>`)}
    </div>` : null}
  </div>`;
}

// ───────────────────────── Papierkorb ─────────────────────────
export function TrashView({ tabId }) {
  const items = useCol(col('trash'));
  const list = items ? sortBy(items, (x) => x.deletedAt || 0, -1) : null;
  const emptyAll = async () => {
    if (!(await confirmDialog('Papierkorb endgültig leeren? Das kann nicht rückgängig gemacht werden.', { danger: true, ok: 'Leeren' }))) return;
    for (const n of list) await purgeNote(n.id);
    toast('Papierkorb geleert', 'success');
  };
  return html`<${ViewFrame} tabId=${tabId} title="Papierkorb" actions=${list?.length ? html`<${Btn} size="sm" kind="danger" icon="trash" onClick=${emptyAll}>Leeren<//>` : null}>
    <div class="page narrow">
      ${!list ? html`<div class="empty"><span class="spinner" /></div>` : !list.length ? html`<${Empty} icon="trash" title="Der Papierkorb ist leer" />` : html`<div class="list">
        ${list.map((n) => html`<div class="list-item" key=${n.id}>
          <${Icon} name="file-text" size=${16} /><span class="title">${n.title}</span><span class="meta">${fmtRelative(n.deletedAt)}</span>
          <${Btn} size="sm" icon="undo" onClick=${async () => { await restoreNote(n.id); toast('Wiederhergestellt', 'success'); }}>Wiederherstellen<//>
          <${IconBtn} icon="trash" class="danger" title="Endgültig löschen" onClick=${async () => { if (await confirmDialog(`„${n.title}“ endgültig löschen?`, { danger: true, ok: 'Löschen' })) await purgeNote(n.id); }} />
        </div>`)}
      </div>`}
    </div>
  <//>`;
}
