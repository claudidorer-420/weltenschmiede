// Codex (wie Obsidian): Dateiexplorer, Suche, Tags, Lesezeichen, Notiz lesen/bearbeiten, Rückverweise, Gliederung, Papierkorb.
import { html, useState, useEffect, useRef, useMemo, useLayoutEffect } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import {
  app, vault, isGM, isRealGM, myUid, getIndex, noteById, updateNote, renameNote, moveNote, deleteNote, duplicateNote,
  createNote, createFolder, renameFolder, deleteFolder, allFolders, watchSecret, saveSecret, searchNotes, restoreNote,
  purgeNote, setNoteVisibility, setSecretVisibility, nurTitelFuerMich, col, setFolderMeta,
} from '../core/app.js';
import { ws, openNote, openView, setEditMode, forgetNote, openSearch, currentOf, isMobile } from '../core/workspace.js';
import { settings, updateSettings } from '../core/settings.js';
import {
  Icon, IconBtn, Btn, Field, MarkdownView, openMenu, confirmDialog, promptDialog, toast, Empty, VisibilityBadge, openModal,
  DictateButton, scrollToHeading, handleMarkdownClick, pickFiles, openLightbox, AutoTextarea, Segmented, Avatar,
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

// Freigabe: für alle Spieler oder nur für bestimmte Mitspieler
export function shareDialog(doc) {
  const members = Object.values(vault.get().members || {}).filter((m) => m.role !== 'gm');
  return openModal(({ close }) => {
    const [only, setOnly] = useState(() => new Set(doc.only || []));
    const [nurTitel, setNurTitel] = useState(() => new Set(doc.teaserOnly || []));
    const [mode, setMode] = useState(doc.visibility === 'players' ? ((doc.only || []).length ? 'some' : 'all') : 'gm');
    const [future, setFuture] = useState(doc.future !== false);
    const [teaser, setTeaser] = useState(!!doc.teaser);
    const toggle = (uid) => {
      const n = new Set(only);
      if (n.has(uid)) n.delete(uid); else n.add(uid);
      setOnly(n);
      setMode(n.size ? 'some' : 'all');
    };
    // Je Spieler: ganzer Inhalt oder nur die Überschrift
    const toggleTitel = (uid) => {
      const n = new Set(nurTitel);
      if (n.has(uid)) n.delete(uid); else n.add(uid);
      setNurTitel(n);
    };
    const ok = () => close(mode === 'gm'
      ? { visibility: 'gm', only: [], future: false, teaser: false, teaserOnly: [] }
      : {
        visibility: 'players',
        only: mode === 'some' ? [...only] : [],
        future: mode === 'all' ? true : future,
        teaser: mode === 'all' ? teaser : false,
        teaserOnly: mode === 'some' ? [...nurTitel].filter((u) => only.has(u)) : [],
      });
    return html`<div class="modal-body stack">
      <${Segmented} value=${mode} onChange=${(v) => { setMode(v); if (v !== 'some') setOnly(new Set()); }} options=${[
        { value: 'gm', label: 'Nur SL', icon: 'lock' },
        { value: 'all', label: 'Alle Spieler', icon: 'users' },
        { value: 'some', label: 'Bestimmte', icon: 'user' },
      ]} />
      ${mode === 'some' ? (members.length ? html`<div class="stack sm">
        <div class="tiny faint">Nur die angehakten Mitspieler sehen dieses Dokument. Alle anderen finden es nicht – auch nicht über die Suche oder Links. Rechts stellst du je Spieler ein, ob er den ganzen Inhalt oder nur die Überschrift sieht.</div>
        ${members.map((m) => {
          const uid = m.uid || m.id;
          const an = only.has(uid);
          const nur = nurTitel.has(uid);
          return html`<div key=${uid} class="share-line">
            <label class="row nowrap share-row grow">
              <input type="checkbox" checked=${an} onChange=${() => toggle(uid)} />
              <${Avatar} name=${m.name} size="sm" /><span class="grow ellipsis">${m.name || 'Mitspieler'}</span>
            </label>
            <button type="button" class=${`share-teaser${nur ? ' on' : ''}`} disabled=${!an}
              title=${nur ? 'Sieht nur die Überschrift' : 'Sieht den ganzen Inhalt'} onClick=${() => toggleTitel(uid)}>
              <${Icon} name=${nur ? 'eye-off' : 'eye'} size=${13} />${nur ? 'nur Überschrift' : 'ganzer Inhalt'}
            </button>
          </div>`;
        })}
      </div>` : html`<div class="tiny faint">Noch keine Mitspieler in dieser Kampagne – lade zuerst jemanden ein.</div>`) : null}
      ${mode === 'all' ? html`<div class="tiny faint">Alle Mitspieler dieser Kampagne sehen das Dokument.</div>` : null}
      ${mode === 'gm' ? html`<div class="tiny faint">Nur du als Spielleitung siehst es.</div>` : null}
      ${mode !== 'gm' ? html`<div class="stack sm share-opts">
        <label class="row nowrap share-row">
          <input type="checkbox" checked=${mode === 'all' || future} disabled=${mode === 'all'} onChange=${(e) => setFuture(e.target.checked)} />
          <span class="grow">und zukünftige Spieler</span>
        </label>
        <div class="tiny faint">${mode === 'all' ? 'Bei „Alle Spieler“ gilt das immer – auch für alle, die später dazukommen.' : 'Wer der Kampagne später beitritt, wird automatisch mit freigegeben.'}</div>
        ${mode === 'all' ? html`<label class="row nowrap share-row">
            <input type="checkbox" checked=${teaser} onChange=${(e) => setTeaser(e.target.checked)} />
            <span class="grow">Ohne Inhalt – nur die Überschrift</span>
          </label>
          <div class="tiny faint">Alle sehen den Titel im Explorer, in der Suche und in Rückverweisen, der Text bleibt verborgen.</div>`
        : html`<div class="tiny faint">„Ohne Inhalt“ stellst du oben je Spieler ein – ${nurTitel.size ? `${nurTitel.size} ${nurTitel.size === 1 ? 'Spieler sieht' : 'Spieler sehen'} nur die Überschrift.` : 'aktuell sehen alle Angehakten den ganzen Inhalt.'}</div>`}
      </div>` : null}
    </div><div class="modal-foot">
      <${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//>
      <${Btn} kind="primary" icon="check" disabled=${mode === 'some' && !only.size} onClick=${ok}>Übernehmen<//>
    </div>`;
  }, { title: 'Für wen sichtbar?', icon: 'users' });
}

export async function shareNoteDialog(n) {
  const r = await shareDialog(n);
  if (!r) return;
  await setNoteVisibility(n.id, r.visibility, r.only, r);
  // Bilder aus der Notiz nur mitfreigeben, wenn der Text überhaupt zu sehen ist
  if (r.visibility === 'players' && !r.teaser) {
    for (const name of extractEmbeddedFiles(n.body)) {
      const f = getIndex().fileByName.get(name.toLowerCase());
      if (f && f.visibility !== 'players') await updateFileMeta(app.get().cid, f.id, { visibility: 'players', only: r.only, onlyN: r.only.length, future: !!r.future }).catch(() => {});
    }
  }
  toast(shareToast(r), 'success');
}

// Kurzer Hinweis, was die Freigabe bedeutet
export function shareToast(r) {
  if (r.visibility === 'gm') return 'Nur für die Spielleitung';
  const wer = r.only.length ? `für ${r.only.length} Mitspieler` : 'für alle Spieler';
  const nur = (r.teaserOnly || []).length;
  return `${r.teaser ? 'Überschrift' : 'Freigegeben'} ${wer}${nur ? `, davon ${nur}× nur die Überschrift` : ''}${r.future && r.only.length ? ' (auch für spätere)' : ''}`;
}

// Freigabe für mehrere Notizen auf einmal (Ordner oder Mehrfachauswahl)
async function shareManyDialog(list, wo = '') {
  if (!list.length) return;
  const erste = list[0];
  const r = await shareDialog({ visibility: erste.visibility, only: erste.only, future: erste.future, teaser: erste.teaser });
  if (!r) return;
  for (const n of list) await setNoteVisibility(n.id, r.visibility, r.only, r);
  toast(`${list.length} Notizen${wo ? ` in „${wo}“` : ''}: ${shareToast(r)}`, 'success');
}

async function deleteManyDialog(list) {
  if (!list.length) return;
  if (!(await confirmDialog(`${list.length} Notizen in den Papierkorb verschieben?`, { ok: 'In den Papierkorb', danger: true }))) return;
  for (const n of list) {
    await deleteNote(n.id);
    forgetNote(n.id);
  }
  toast(`${list.length} Notizen gelöscht`, 'info');
}

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
    const inp = useRef();
    useEffect(() => {
      const t = setTimeout(() => { inp.current?.focus(); inp.current?.select(); }, 40);
      return () => clearTimeout(t);
    }, []);
    return html`<div class="modal-body stack">
      <input ref=${inp} class="input" placeholder="Ordner suchen oder neuen Pfad eingeben (z. B. Orte/Städte)" value=${q} onInput=${(e) => setQ(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); const f = folders[0] ?? q.trim(); if (allFolders().includes(f) || !q.trim()) go(f); else createFolder(q.trim()).then(() => go(q.trim())); } }} autoFocus />
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

// Kurzform der aktuellen Freigabe für Menüeinträge
export function shareHint(n) {
  if (n.visibility !== 'players') return 'Nur SL';
  const wer = (n.only || []).length ? `${n.only.length} Mitspieler` : 'Alle';
  if (n.teaser) return `${wer} · ohne Inhalt`;
  const nur = (n.teaserOnly || []).length;
  return nur ? `${wer} · ${nur}× nur Titel` : wer;
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
    gm && { label: 'Freigabe für Spieler …', icon: n.visibility === 'players' ? ((n.only || []).length ? 'user' : 'users') : 'lock', hint: shareHint(n), onClick: () => shareNoteDialog(n) },
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
    { label: 'Freigabe für Spieler …', icon: 'users', hint: `${inside().length} Notizen`, onClick: () => shareManyDialog(inside(), path) },
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

function findNode(root, path) {
  if (!path) return root;
  let n = root;
  for (const part of path.split('/')) {
    n = n?.folders.get(part);
    if (!n) return null;
  }
  return n;
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
  const [drag, setDrag] = useState({ id: null, kind: null, over: null, zone: null });
  const [sel, setSel] = useState([]);          // markierte Zeilen (Schlüssel) – Strg/Umschalt wie im Ordner
  const anchor = useRef(null);
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

  const sortNotes = (arr, path) => {
    if (sort === 'custom') return applyOrder(arr, path, 'note');
    if (sort === 'za') return sortBy(arr, 'title', -1);
    if (sort === 'new') return sortBy(arr, (n) => n.updatedAt || 0, -1);
    if (sort === 'old') return sortBy(arr, (n) => n.createdAt || 0, 1);
    return sortBy(arr, 'title');
  };
  const sortMenu = (e) => openMenu(e, [
    ['custom', 'Eigene Reihenfolge (Ziehen & Ablegen)'], ['az', 'Name (A–Z)'], ['za', 'Name (Z–A)'], ['new', 'Zuletzt bearbeitet'], ['old', 'Erstellt (älteste zuerst)'],
  ].map(([k, l]) => ({ label: l, icon: sort === k ? 'check' : k === 'custom' ? 'layers' : 'sort', onClick: () => { setSort(k); localStorage.setItem('ws.sort', k); } })));
  // ── Eigene Reihenfolge (pro Nutzer gespeichert) & Ziehen/Ablegen ──
  const orders = useStore(settings, (x) => x.explorerOrder?.[cid] || {});
  const keyOf = (it, kind) => (kind === 'folder' ? `f:${it.path}` : kind === 'file' ? `x:${it.id}` : it.id);
  const applyOrder = (items, path, kind) => {
    const list = orders[path || ''] || [];
    if (!list.length) return items;
    const idx = (it) => {
      const i = list.indexOf(keyOf(it, kind));
      return i < 0 ? 1e6 : i;
    };
    return [...items].sort((a, b) => idx(a) - idx(b));
  };
  const saveOrder = (path, keys) => updateSettings({ explorerOrder: { ...(settings.get().explorerOrder || {}), [cid]: { ...orders, [path || '']: keys } } });
  // Reihenfolge eines Ordners so, wie sie gerade angezeigt wird
  const visibleKeys = (path) => {
    const node = findNode(tree, path);
    if (!node) return [];
    return [
      ...applyOrder([...node.folders.values()], path, 'folder').map((f) => `f:${f.path}`),
      ...sortNotes(node.notes, path).map((n) => n.id),
      ...applyOrder(node.files, path, 'file').map((f) => `x:${f.id}`),
    ];
  };
  // ── Mehrfachauswahl mit Strg und Umschalt (wie im Dateimanager) ──
  // Alle sichtbaren Zeilen in Anzeigereihenfolge – Grundlage für die Umschalt-Auswahl
  const flatRows = () => {
    const out = [];
    const walk = (node) => {
      applyOrder([...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')), node.path, 'folder').forEach((f) => {
        out.push({ key: `f:${f.path}`, kind: 'folder', item: f });
        if (query || expanded[f.path]) walk(f);
      });
      sortNotes(node.notes, node.path).forEach((n) => out.push({ key: n.id, kind: 'note', item: n }));
      applyOrder(node.files, node.path, 'file').forEach((f) => out.push({ key: `x:${f.id}`, kind: 'file', item: f }));
    };
    walk(tree);
    return out;
  };
  const selItems = () => {
    const map = new Map(flatRows().map((r) => [r.key, r]));
    return sel.map((k) => map.get(k)).filter(Boolean);
  };
  const rowClick = (e, item, kind, open) => {
    const key = keyOf(item, kind);
    if (e.shiftKey && anchor.current) {
      e.preventDefault();
      const keys = flatRows().map((r) => r.key);
      const a = keys.indexOf(anchor.current);
      const b = keys.indexOf(key);
      if (a >= 0 && b >= 0) {
        setSel(keys.slice(Math.min(a, b), Math.max(a, b) + 1));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      anchor.current = key;
      setSel(sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key]);
      return;
    }
    anchor.current = key;
    if (sel.length) setSel([]);
    open?.();
  };
  const selCls = (item, kind) => (sel.includes(keyOf(item, kind)) ? ' sel' : '');
  const multiMenu = (e) => {
    const items = selItems();
    const notes = items.filter((r) => r.kind === 'note').map((r) => r.item);
    openMenu(e, [
      { header: true, label: `${items.length} Einträge markiert` },
      gm && notes.length && { label: 'Verschieben nach …', icon: 'folder', onClick: () => moveDialog(notes.map((n) => n.id)) },
      gm && notes.length && { label: 'Freigabe für Spieler …', icon: 'users', onClick: () => shareManyDialog(notes) },
      { label: 'In neuen Tabs öffnen', icon: 'plus', onClick: () => notes.forEach((n) => openNote(n.id, { newTab: true })) },
      { divider: true },
      { label: 'Auswahl aufheben', icon: 'x', onClick: () => setSel([]) },
      gm && notes.length && { divider: true },
      gm && notes.length && { label: `${notes.length} Notizen löschen`, icon: 'trash', danger: true, onClick: () => deleteManyDialog(notes) },
    ].filter(Boolean));
  };
  // Rechtsklick auf eine markierte Zeile betrifft die ganze Auswahl
  const rowMenu = (e, item, kind, single) => {
    if (sel.length > 1 && sel.includes(keyOf(item, kind))) {
      e.preventDefault();
      e.stopPropagation();
      multiMenu(e);
      return;
    }
    single(e);
  };
  const dropZone = (e, el, canInto) => {
    const r = el.getBoundingClientRect();
    const rel = (e.clientY - r.top) / Math.max(1, r.height);
    if (canInto && rel > 0.28 && rel < 0.72) return 'into';
    return rel < 0.5 ? 'before' : 'after';
  };
  const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
  const moveItem = async (drag, folder) => {
    if (drag.kind === 'note') return moveNote(drag.id, folder);
    if (drag.kind === 'folder') {
      const name = drag.id.split('/').pop();
      const target = folder ? `${folder}/${name}` : name;
      if (target === drag.id || target.startsWith(`${drag.id}/`)) return null;
      return renameFolder(drag.id, target);
    }
    return null;
  };
  // Ablegen auf einer Zeile: hinein verschieben oder davor/danach einsortieren
  const dropOnRow = async (e, target, kind) => {
    e.preventDefault();
    e.stopPropagation();
    const zone = drag.zone;
    setDrag({ id: null, kind: null, over: null, zone: null });
    if (!gm || !drag.id) return;
    const dragged = { kind: drag.kind, id: drag.id };
    if (dragged.kind === 'folder' && kind === 'folder' && (target.path === dragged.id || target.path.startsWith(`${dragged.id}/`))) return;
    const dragKey = dragged.kind === 'folder' ? `f:${dragged.id}` : dragged.kind === 'file' ? `x:${dragged.id}` : dragged.id;
    // Ist die gezogene Zeile Teil einer Mehrfachauswahl, wandert die ganze Auswahl mit
    const mehr = sel.length > 1 && sel.includes(dragKey) ? selItems() : null;
    if (mehr?.length) {
      const ziel = zone === 'into' && kind === 'folder' ? target.path : (kind === 'folder' ? parentOf(target.path) : (target.folder || ''));
      // Ordner nicht in sich selbst oder einen eigenen Unterordner schieben
      const gueltig = mehr.filter((r) => !(r.kind === 'folder' && (ziel === r.item.path || ziel.startsWith(`${r.item.path}/`))));
      const neueKeys = [];
      for (const r of gueltig) {
        if (r.kind === 'note') {
          if ((r.item.folder || '') !== ziel) await moveNote(r.item.id, ziel);
          neueKeys.push(r.item.id);
        } else if (r.kind === 'folder') {
          const name = r.item.path.split('/').pop();
          const neu = ziel ? `${ziel}/${name}` : name;
          if (neu !== r.item.path) await renameFolder(r.item.path, neu).catch(() => {});
          neueKeys.push(`f:${neu}`);
        } else {
          if ((r.item.folder || '') !== ziel) await updateFileMeta(cid, r.item.id, { folder: ziel }).catch(() => {});
          neueKeys.push(`x:${r.item.id}`);
        }
      }
      if (zone !== 'into' || kind !== 'folder') {
        const targetKey = kind === 'folder' ? `f:${target.path}` : kind === 'file' ? `x:${target.id}` : target.id;
        const keys = visibleKeys(ziel).filter((k) => !neueKeys.includes(k) && !sel.includes(k));
        const at = keys.indexOf(targetKey);
        keys.splice(at < 0 ? keys.length : at + (zone === 'after' ? 1 : 0), 0, ...neueKeys);
        saveOrder(ziel, keys);
        if (sort !== 'custom') { setSort('custom'); localStorage.setItem('ws.sort', 'custom'); }
      }
      setSel([]);
      toast(`${gueltig.length} ${gueltig.length === 1 ? 'Eintrag' : 'Einträge'} nach „${ziel || 'Hauptordner'}“`, 'success');
      return;
    }
    if (zone === 'into' && kind === 'folder') {
      await moveItem(dragged, target.path);
      return;
    }
    const path = kind === 'folder' ? parentOf(target.path) : (target.folder || '');
    const targetKey = kind === 'folder' ? `f:${target.path}` : kind === 'file' ? `x:${target.id}` : target.id;
    let moved = dragged;
    if (dragged.kind === 'folder') {
      const name = dragged.id.split('/').pop();
      const nt = path ? `${path}/${name}` : name;
      if (nt !== dragged.id) { await moveItem(dragged, path); moved = { kind: 'folder', id: nt }; }
    } else if (dragged.kind === 'note') {
      const n = vault.get().notes[dragged.id];
      if ((n?.folder || '') !== path) await moveNote(dragged.id, path);
    }
    const movedKey = moved.kind === 'folder' ? `f:${moved.id}` : dragKey;
    const keys = visibleKeys(path).filter((k) => k !== dragKey && k !== movedKey);
    const at = keys.indexOf(targetKey);
    const i = at < 0 ? keys.length : at + (zone === 'after' ? 1 : 0);
    keys.splice(i, 0, movedKey);
    saveOrder(path, keys);
    if (sort !== 'custom') { setSort('custom'); localStorage.setItem('ws.sort', 'custom'); }
  };
  const dragProps = (item, kind) => ({
    draggable: gm,
    onDragStart: (e) => {
      const id = kind === 'folder' ? item.path : item.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(kind === 'note' ? 'text/x-note' : kind === 'folder' ? 'text/x-folder' : 'text/x-file', id);
      if (sel.length && !sel.includes(keyOf(item, kind))) setSel([]);   // außerhalb der Auswahl gezogen
      else if (sel.length > 1) {
        // Beim Ziehen einer Mehrfachauswahl das Schattenbild beschriften
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = `${sel.length} Einträge`;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 12, 12);
        setTimeout(() => ghost.remove(), 0);
      }
      setDrag({ id, kind, over: null, zone: null });
    },
    onDragEnd: () => setDrag({ id: null, kind: null, over: null, zone: null }),
    onDragOver: (e) => {
      if (!gm || !drag.id) return;
      e.preventDefault();
      e.stopPropagation();
      const zone = dropZone(e, e.currentTarget, kind === 'folder');
      const key = kind === 'folder' ? `f:${item.path}` : item.id;
      if (drag.over !== key || drag.zone !== zone) setDrag({ ...drag, over: key, zone });
    },
    onDrop: (e) => dropOnRow(e, item, kind),
  });
  const dragCls = (item, kind) => {
    const key = kind === 'folder' ? `f:${item.path}` : item.id;
    if (drag.over !== key) return '';
    return drag.zone === 'into' ? ' drop' : drag.zone === 'before' ? ' drop-before' : ' drop-after';
  };
  // Beim Ziehen an den Rand: die Liste scrollt mit. Los geht es in den oberen und unteren 15 %
  // der Liste; je weiter außen der Zeiger ist, desto schneller – höchstens SCROLL_MAX je Bild.
  const SCROLL_ZONE = 0.15;
  const SCROLL_MAX = 4.6;
  useEffect(() => {
    if (!drag.id) return undefined;
    let raf = 0;
    let dy = 0;
    const el = () => document.querySelector('.sidebar .sidebar-body.tree');
    const onOver = (e) => {
      const box = el()?.getBoundingClientRect();
      if (!box) { dy = 0; return; }
      const zone = Math.max(28, box.height * SCROLL_ZONE);
      const oben = (box.top + zone - e.clientY) / zone;
      const unten = (e.clientY - (box.bottom - zone)) / zone;
      const t = oben > 0 ? -Math.min(1, oben) : unten > 0 ? Math.min(1, unten) : 0;
      dy = Math.sign(t) * SCROLL_MAX * t * t;   // quadratisch: außen schneller, innen sanft
    };
    const stop = () => { dy = 0; };
    const step = () => {
      if (dy) el()?.scrollBy(0, dy);
      raf = requestAnimationFrame(step);
    };
    // In der Abfangphase lauschen: die Zeilen stoppen das Ereignis, sonst käme es hier nie an
    // und das Scrollen hörte nicht mehr auf, sobald der Zeiger wieder über einer Zeile ist.
    document.addEventListener('dragover', onOver, true);
    document.addEventListener('drop', stop, true);
    document.addEventListener('dragend', stop, true);
    raf = requestAnimationFrame(step);
    return () => {
      document.removeEventListener('dragover', onOver, true);
      document.removeEventListener('drop', stop, true);
      document.removeEventListener('dragend', stop, true);
      cancelAnimationFrame(raf);
    };
  }, [drag.id]);


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
    ${applyOrder([...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')), node.path, 'folder').map(folderRow)}
    ${sortNotes(node.notes, node.path).map(noteRow)}
    ${applyOrder(node.files, node.path, 'file').map(fileRow)}`;

  const folderRow = (f) => {
    const open = query ? true : !!expanded[f.path];
    const m = meta[f.path] || {};
    return html`<div key=${`f:${f.path}`}>
      <div class=${`tree-row folder${dragOver === f.path ? ' drop' : ''}${dragCls(f, 'folder')}${selCls(f, 'folder')}`} style=${m.color ? { '--fc': m.color } : null} title=${f.path}
        onClick=${(e) => rowClick(e, f, 'folder', () => !query && persistExp({ ...expanded, [f.path]: !open }))}
        onContextMenu=${(e) => gm && rowMenu(e, f, 'folder', () => folderMenu(e, f.path))}
        ...${dragProps(f, 'folder')}
        onDragLeave=${() => setDragOver(null)}>
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
    return html`<div key=${n.id} class=${`tree-row${n.id === activeId ? ' active' : ''}${dragCls(n, 'note')}${selCls(n, 'note')}`} title=${n.folder ? `${n.folder}/${n.title}` : n.title}
        ...${dragProps(n, 'note')}
        onClick=${(e) => (e.altKey ? openNote(n.id, { newTab: true }) : rowClick(e, n, 'note', () => openNote(n.id)))}
        onAuxClick=${(e) => e.button === 1 && openNote(n.id, { newTab: true })}
        onContextMenu=${(e) => rowMenu(e, n, 'note', () => noteMenu(e, n))}>
      <span class="chev"></span>
      ${color ? html`<span class="dot" style=${{ background: color }}></span>` : kindIcon ? html`<span class="k-icon"><${Icon} name=${kindIcon} size=${13} /></span>` : null}
      <span class="name">${n.title}</span>
      ${gm && n.visibility === 'players' ? html`<span class="lock" title=${(n.only || []).length ? `Nur für ${n.only.length} Mitspieler sichtbar` : 'Für alle Spieler sichtbar'}><${Icon} name=${(n.only || []).length ? 'user' : 'users'} size=${12} /></span>` : null}
    </div>`;
  };
  const fileRow = (f) => html`<div key=${`file:${f.id}`} class=${`tree-row${dragCls(f, 'file')}${selCls(f, 'file')}`} title=${f.name}
    ...${dragProps(f, 'file')}
    onClick=${(e) => rowClick(e, f, 'file', () => fileUrl(cid, f.id).then((u) => u && openLightbox(u)))}
    onContextMenu=${(e) => gm && rowMenu(e, f, 'file', () => fileMenu(e, f))}>
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
    <div class=${`sidebar-body tree${dragOver === '' ? ' drop' : ''}`} onDragOver=${(e) => { if (gm) e.preventDefault(); }} onDrop=${(e) => dropOn(e, '')}
      onClick=${(e) => { if (e.target === e.currentTarget && sel.length) setSel([]); }}>
      ${sel.length > 1 ? html`<div class="tree-sel-bar">
        <span class="grow">${sel.length} markiert</span>
        <${IconBtn} icon="more-horizontal" size=${15} title="Aktionen für die Auswahl" onClick=${multiMenu} />
        <${IconBtn} icon="x" size=${15} title="Auswahl aufheben" onClick=${() => setSel([])} />
      </div>` : null}
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
  ['chat', 'message', 'Chat & Würfel'],
  ['backlinks', 'link', 'Rückverweise'],
  ['outgoing', 'arrow-right', 'Ausgehende Links'],
  ['outline', 'list', 'Gliederung'],
  ['local', 'graph', 'Lokaler Graph'],
  ['tags', 'tag', 'Tags'],
];

// Chat lädt das Spieltisch-Modul erst, wenn er gebraucht wird
let chatMod = null;
function LazyChat() {
  const [Comp, setComp] = useState(() => chatMod?.ChatPanel || null);
  useEffect(() => {
    if (!Comp) import('./table.js').then((m) => { chatMod = m; setComp(() => m.ChatPanel); });
  }, []);
  return Comp ? html`<${Comp} />` : html`<div class="empty" style="flex:1"><span class="spinner" /></div>`;
}

export function RightSidebar() {
  const panel = useStore(ws, (s) => s.rightPanel);
  const unread = useStore(ws, (s) => s.chatUnread);
  const noteId = useStore(ws, (s) => {
    const c = currentOf(s.tabs.find((t) => t.id === s.active));
    return c.view === 'note' ? c.params.id : null;
  });
  const note = useStore(vault, (s) => (noteId ? s.notes[noteId] : null));
  const tabs = html`<div class="right-tabs">
      ${RIGHT_TABS.map(([id, icon, title]) => html`<${IconBtn} key=${id} icon=${icon} title=${title} active=${panel === id} class=${id === 'chat' && unread && panel !== 'chat' ? 'has-dot' : ''} onClick=${() => ws.set({ rightPanel: id })} />`)}
      <span class="grow"></span>
      ${isMobile() ? html`<${IconBtn} icon="x" title="Schließen" onClick=${() => ws.set({ drawer: null })} />` : null}
    </div>`;
  if (panel === 'chat') return html`<aside class="sidebar right">${tabs}<${LazyChat} /></aside>`;
  let body;
  if (panel === 'tags') body = html`<${TagsPanel} />`;
  else if (!note) body = html`<div class="tree-empty">Öffne eine Notiz, um hier ${RIGHT_TABS.find((t) => t[0] === panel)?.[2] || 'Details'} zu sehen.</div>`;
  else if (panel === 'outgoing') body = html`<${OutgoingPanel} note=${note} />`;
  else if (panel === 'outline') body = html`<${OutlinePanel} note=${note} />`;
  else if (panel === 'local') body = html`<${LocalGraphPanel} note=${note} />`;
  else body = html`<${BacklinksPanel} note=${note} />`;
  return html`<aside class="sidebar right">
    ${tabs}
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
      ${(gm && isRealGM()) || !gm ? html`<${GmSecret} note=${note} key=${`s:${note.id}`} />` : null}
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
    ${!gm && note.teaser
      ? html`<p class="faint" style="font-style:italic">Die Spielleitung hat von dieser Notiz nur die Überschrift freigegeben.</p>`
      : empty
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
    ${list.map((n) => html`<div class="backlink-item" key=${n.id} onClick=${(e) => openNote(n.id, { newTab: e.ctrlKey || e.metaKey })}><div class="t">${n.title}</div>
      <div class="s">${n.teaser && !isGM() ? 'Nur die Überschrift freigegeben' : linkContext(n.body, titles)}</div></div>`)}
  </div>`;
}

function GmSecret({ note }) {
  const [doc, setDoc] = useState(undefined);
  const [body, setBody] = useState(null);
  const [edit, setEdit] = useState(false);
  const gm = isGM();
  useEffect(() => watchSecret(note.id, (d) => {
    setDoc(d);
    setBody((cur) => (edit && cur !== null ? cur : (d?.body || '')));
  }), [note.id]);
  const save = useMemo(() => debounce((val) => saveSecret(note.id, val), 700), [note.id]);
  useEffect(() => () => save.cancel?.(), []);
  if (doc === undefined || body === null) return null;
  const frei = doc?.visibility === 'players';
  if (!gm && (!frei || !body)) return null;   // Spieler sehen nur eigens freigegebene Geheimnisse
  // Die Freigabe gilt immer nur für dieses eine Geheimnis, nie für ein ganzes Dokument
  const share = async (e) => {
    e.preventDefault();
    const r = await shareDialog(doc || {});
    if (!r) return;
    await setSecretVisibility(note.id, r.visibility, r.only, r);
    toast(`Geheimnis zu „${note.title}“: ${shareToast(r)}`, 'success');
  };
  return html`<details class=${`gm-secret${frei ? ' shared' : ''}`} open=${!!body || edit}>
    <summary><${Icon} name=${frei ? 'users' : 'lock'} size=${16} /> ${gm ? 'SL-Geheimnisse' : 'Von der Spielleitung freigegeben'} ${body ? null : html`<span class="small faint">(leer)</span>`}
      <span class="grow"></span>
      ${gm ? html`<button type="button" class="icon-btn sm" title=${`Freigabe für Spieler – ${shareHint(doc || {})}`} onClick=${share}><${Icon} name=${frei ? ((doc.only || []).length ? 'user' : 'users') : 'lock'} size=${14} /></button>` : null}
      ${gm ? html`<button type="button" class="icon-btn sm" title=${edit ? 'Fertig' : 'Bearbeiten'} onClick=${(e) => { e.preventDefault(); if (edit) save.flush?.(body); setEdit(!edit); }}><${Icon} name=${edit ? 'check' : 'pencil'} size=${14} /></button>` : null}
    </summary>
    <div class="inner">
      ${!gm && nurTitelFuerMich(doc) ? html`<div class="small faint">Hier gibt es etwas – die Spielleitung hat den Text aber noch nicht freigegeben.</div>`
        : edit
        ? html`<${AutoTextarea} value=${body} onInput=${(e) => { setBody(e.target.value); save(e.target.value); }} placeholder="Nur du siehst das – wahre Motive, Fallen, Wendungen … (Markdown & [[Links]] funktionieren)" />`
        : body ? html`<${MarkdownView} src=${body} />` : html`<div class="small faint">Geheimnisse, die Spieler nie sehen – außer du gibst genau dieses hier über das Personen-Symbol frei (liegt technisch getrennt, geschützt durch die Firestore-Regeln).</div>`}
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
