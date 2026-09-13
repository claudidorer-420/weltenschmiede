// Archiv der Welten: Verlauf aller KI-Generierungen – durchsuchen, wieder öffnen, als Notiz speichern.
import { html, useState, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, createNote } from '../core/app.js';
import { db } from '../core/db.js';
import { openView, openNote } from '../core/workspace.js';
import { modelLabel } from '../core/ai.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, IconBtn, Btn, Segmented, MarkdownView, Statblock, confirmDialog, toast, Empty } from '../ui/components.js';
import { saveDialog } from '../ui/aiout.js';
import { monsterToMarkdown } from '../ui/statblock.js';
import { useCol } from '../core/hooks.js';
import { fmtDateTime, copyText } from '../lib/util.js';

const KINDS = [
  { value: 'all', label: 'Alle' },
  { value: 'forge', label: 'Weltenschmiede', icon: 'anvil' },
  { value: 'npc', label: 'NPCs', icon: 'mask' },
  { value: 'encounter', label: 'Encounter', icon: 'swords' },
];

export function ArchiveView({ tabId }) {
  const me = useStore(app, (s) => s.user?.uid);
  const cid = useStore(app, (s) => s.cid);
  const items = useCol(me ? `users/${me}/archive` : null, { orderBy: ['ts', 'desc'], limit: 300 });
  const [kind, setKind] = useState('all');
  const [scope, setScope] = useState('here');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const list = useMemo(() => (items || []).filter((i) => (kind === 'all' || i.kind === kind) && (scope === 'all' || i.cid === cid) && (!q || `${i.title} ${i.text}`.toLowerCase().includes(q.toLowerCase()))), [items, kind, scope, q, cid]);
  const cur = (items || []).find((i) => i.id === sel);

  const encounterNote = async (it) => {
    const body = (it.data?.monsters || []).map((m) => `## ${m.qty || 1}× ${m.name}\n${monsterToMarkdown(m)}`).join('\n') + (it.data?.tactics ? `\n## Taktik\n${it.data.tactics}\n` : '');
    const n = await createNote({ title: it.title.slice(0, 90), folder: 'Encounter', body });
    openNote(n.id);
  };

  return html`<${ViewFrame} tabId=${tabId} title="Archiv der Welten">
    <div class="page wide">
      <div class="split">
        <div class="stack">
          <div class="page-head" style="margin:0"><h1><${Icon} name="archive" size=${24} />Archiv der Welten</h1><span class="sub">Jede KI-Generierung wird hier automatisch aufbewahrt – nichts geht verloren, auch wenn du es nicht gespeichert hast.</span></div>
          <${Segmented} value=${kind} onChange=${setKind} options=${KINDS} />
          <div class="row"><${Segmented} value=${scope} onChange=${setScope} options=${[{ value: 'here', label: 'Diese Kampagne' }, { value: 'all', label: 'Alle' }]} /><input class="input sm grow" placeholder="Suchen …" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
          <div class="card tight">
            ${!items ? html`<div class="empty"><span class="spinner" /></div>` : !list.length ? html`<div class="small faint" style="padding:8px">Noch nichts im Archiv.</div>`
              : html`<div class="list">${list.map((i) => html`<div class=${`list-item${i.id === sel ? ' active' : ''}`} onClick=${() => setSel(i.id)}>
                <${Icon} name=${KINDS.find((k) => k.value === i.kind)?.icon || 'sparkles'} size=${15} />
                <span class="title">${i.title}</span><span class="meta">${fmtDateTime(i.ts)}</span>
              </div>`)}</div>`}
          </div>
        </div>
        <div class="sticky stack">
          ${!cur ? html`<div class="card"><${Empty} icon="archive" title="Eintrag wählen" /></div>` : html`
            <div class="toolbar">
              ${cur.kind === 'forge' ? html`<${Btn} kind="primary" icon="anvil" onClick=${() => openView('forge', { archiveId: cur.id })}>In Weltenschmiede öffnen<//>` : null}
              ${cur.text ? html`<${Btn} icon="save" onClick=${() => saveDialog({ text: cur.text, title: cur.title, folder: cur.kind === 'npc' ? 'NPCs' : '' })}>Als Notiz<//><${IconBtn} icon="copy" title="Kopieren" onClick=${() => { copyText(cur.text); toast('Kopiert'); }} />` : null}
              ${cur.kind === 'encounter' && cur.data ? html`<${Btn} icon="file-text" onClick=${() => encounterNote(cur)}>Statblocks als Notiz<//>` : null}
              <span class="grow"></span>
              <${IconBtn} icon="trash" class="danger" title="Löschen" onClick=${async () => { if (await confirmDialog('Archiveintrag löschen?', { danger: true, ok: 'Löschen' })) { await db.remove(`users/${me}/archive`, cur.id); setSel(null); } }} />
            </div>
            <div class="small faint">${fmtDateTime(cur.ts)}${cur.campaign ? ` · ${cur.campaign}` : ''}${cur.model ? ` · ${modelLabel({ provider: cur.provider, model: cur.model })}` : ''}</div>
            ${cur.text ? html`<div class="card"><${MarkdownView} src=${cur.text} /></div>` : null}
            ${cur.kind === 'encounter' && cur.data ? html`${cur.data.difficulty ? html`<div class="card"><b>Schwierigkeit ${cur.data.difficulty.score}/10 – ${cur.data.difficulty.label}</b><div class="small muted">${cur.data.difficulty.reasoning}</div></div>` : null}
              ${(cur.data.monsters || []).map((m, i) => html`<${Statblock} key=${i} monster=${m} />`)}` : null}
          `}
        </div>
      </div>
    </div>
  <//>`;
}
