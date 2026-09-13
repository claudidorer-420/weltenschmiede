// Mein Tagebuch: persönliche Notizen (users/{uid}/notes) – gehören dir, bleiben über alle Kampagnen hinweg erhalten.
import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, myUid } from '../core/app.js';
import { db } from '../core/db.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, IconBtn, Btn, Segmented, MarkdownView, AutoTextarea, DictateButton, confirmDialog, toast, Empty } from '../ui/components.js';
import { useCol } from '../core/hooks.js';
import { now, debounce, sortBy, fmtDate, fmtRelative, download } from '../lib/util.js';

function Editor({ note, path }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body || '');
  const [edit, setEdit] = useState(!note.body);
  const save = useMemo(() => debounce((patch) => db.update(path, note.id, { ...patch, updatedAt: now() }), 600), [note.id]);
  useEffect(() => () => save.flush?.(), []);
  return html`<div class="stack">
    <div class="row nowrap">
      <input class="inline-title-input" style="margin:0" value=${title} onInput=${(e) => { setTitle(e.target.value); save({ title: e.target.value }); }} />
      <${IconBtn} icon=${edit ? 'book-open' : 'pencil'} title=${edit ? 'Lesen' : 'Bearbeiten'} onClick=${() => setEdit(!edit)} />
      <${IconBtn} icon="download" title="Als Markdown" onClick=${() => download(`${title}.md`, body, 'text/markdown;charset=utf-8')} />
      <${IconBtn} icon="trash" class="danger" title="Löschen" onClick=${async () => { if (await confirmDialog(`„${title}“ löschen?`, { danger: true, ok: 'Löschen' })) db.remove(path, note.id); }} />
    </div>
    <div class="small faint">${note.campaignName ? `Kampagne: ${note.campaignName} · ` : ''}angelegt ${fmtDate(note.createdAt)} · ${fmtRelative(note.updatedAt)}</div>
    ${edit ? html`<div class="row"><span class="grow small muted">Markdown, [[Links]] auf freigegebene Codex-Notizen, 1d20 wird klickbar.</span><${DictateButton} onText=${(t) => { const v = `${body}${body ? ' ' : ''}${t}`; setBody(v); save({ body: v }); }} /></div>
      <${AutoTextarea} value=${body} minRows=${14} onInput=${(e) => { setBody(e.target.value); save({ body: e.target.value }); }} placeholder="Was ist passiert? Wem trauen wir nicht? Welche Hinweise haben wir?" />`
      : body ? html`<${MarkdownView} src=${body} />` : html`<div class="faint">Leer – tippe auf den Stift.</div>`}
  </div>`;
}

export function JournalView({ tabId }) {
  const me = useStore(app, (s) => s.user?.uid);
  const cid = useStore(app, (s) => s.cid);
  const campaign = useStore(app, (s) => s.campaign);
  const path = me ? `users/${me}/notes` : null;
  const notes = useCol(path);
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState('here');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    let l = notes || [];
    if (filter === 'here') l = l.filter((n) => n.campaignId === cid);
    if (q) l = l.filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(q.toLowerCase()));
    return sortBy(l, (n) => n.updatedAt || 0, -1);
  }, [notes, filter, q, cid]);
  const current = (notes || []).find((n) => n.id === sel);
  const create = async () => {
    const id = await db.add(path, { title: `Eintrag vom ${fmtDate(now())}`, body: '', campaignId: cid || null, campaignName: campaign?.name || '', createdAt: now(), updatedAt: now() });
    setSel(id);
  };
  return html`<${ViewFrame} tabId=${tabId} title="Mein Tagebuch">
    <div class="page wide">
      <div class="split">
        <div class="stack">
          <div class="page-head" style="margin:0"><h1><${Icon} name="feather" size=${24} />Tagebuch</h1><span class="grow"></span><${Btn} kind="primary" icon="plus" onClick=${create}>Eintrag<//>
            <span class="sub">Nur du siehst diese Notizen – sie gehören zu deinem Konto und bleiben auch für die nächste Kampagne erhalten.</span></div>
          <div class="row"><${Segmented} value=${filter} onChange=${setFilter} options=${[{ value: 'here', label: 'Diese Kampagne' }, { value: 'all', label: 'Alle' }]} /><input class="input sm grow" placeholder="Suchen …" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
          <div class="card tight">
            ${!notes ? html`<div class="empty"><span class="spinner" /></div>` : !list.length ? html`<div class="small faint" style="padding:8px">Noch keine Einträge.</div>`
              : html`<div class="list">${list.map((n) => html`<div class=${`list-item${n.id === sel ? ' active' : ''}`} onClick=${() => setSel(n.id)}><${Icon} name="feather" size=${15} /><span class="title">${n.title}</span><span class="meta">${filter === 'all' && n.campaignName ? `${n.campaignName} · ` : ''}${fmtRelative(n.updatedAt)}</span></div>`)}</div>`}
          </div>
        </div>
        <div class="card">${current ? html`<${Editor} key=${current.id} note=${current} path=${path} />` : html`<${Empty} icon="feather" title="Eintrag wählen oder anlegen" />`}</div>
      </div>
    </div>
  <//>`;
}
