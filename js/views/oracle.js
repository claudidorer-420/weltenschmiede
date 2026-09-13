// Orakel: Chat mit deiner Welt – die KI antwortet auf Basis deiner Codex-Notizen (automatisch gesucht oder ausgewählt).
import { html, useState, useEffect, useRef } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, getIndex, searchNotes, noteById, createNote } from '../core/app.js';
import { openNote } from '../core/workspace.js';
import { oracleSystemPrompt, notesContext } from '../core/prompts.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, IconBtn, Btn, Segmented, ModelPicker, NotePicker, MarkdownView, AutoTextarea, DictateButton, confirmDialog, toast, Empty } from '../ui/components.js';
import { useGeneration, appendDialog } from '../ui/aiout.js';
import { now, copyText, estimateTokens } from '../lib/util.js';

const STOP = new Set('der die das und oder aber nicht eine einer einen eines dem den des ist sind war waren wer wie was wann warum wo woher wohin welche welcher welches hat haben hatte wird werden kann könnte könnten gibt gab über unter mit ohne für von aus bei nach zum zur auch noch schon mein meine dein deine sein seine ihre ihr diese dieser dieses etwas alle alles viel viele mehr sehr gerade denn dann weil wenn damit dass also bitte jemand niemand welchem welchen gegen durch'.split(' '));
const QUICK = [
  'Welche offenen Handlungsfäden gibt es gerade?',
  'Finde Widersprüche zwischen meinen Notizen.',
  'Schlage drei überraschende Wendungen für die nächste Sitzung vor.',
  'Wer hätte ein Motiv, gegen die Gruppe zu arbeiten – und warum?',
  'Fasse die wichtigsten NPCs in einer Tabelle zusammen.',
];

function autoContext(question) {
  const q = question.toLowerCase();
  const score = new Map();
  const words = [...new Set(q.match(/[\p{L}\d]{4,}/gu) || [])].filter((w) => !STOP.has(w));
  for (const w of words) for (const r of searchNotes(w, { limit: 25 })) score.set(r.note.id, (score.get(r.note.id) || 0) + r.score);
  const idx = getIndex();
  for (const n of idx.notes) {
    if (n.title.length > 2 && q.includes(n.title.toLowerCase())) score.set(n.id, (score.get(n.id) || 0) + 200);
    for (const a of n.aliases || []) if (a.length > 2 && q.includes(a.toLowerCase())) score.set(n.id, (score.get(n.id) || 0) + 150);
  }
  const top = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id);
  const extra = new Set(top);
  for (const id of top.slice(0, 3)) for (const l of idx.outLinks.get(id) || []) if (extra.size < 16) extra.add(l);
  return [...extra];
}

export function OracleView({ tabId }) {
  const cid = useStore(app, (s) => s.cid);
  const key = `ws.oracle.${cid}`;
  const [msgs, setMsgs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('auto');
  const [sel, setSel] = useState([]);
  const [model, setModel] = useState(null);
  const [lastCtx, setLastCtx] = useState([]);
  const gen = useGeneration('oracle');
  const endRef = useRef();
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, gen.out.length > 0]);
  const persist = (m) => {
    setMsgs(m);
    try { localStorage.setItem(key, JSON.stringify(m.slice(-40))); } catch { /* voll */ }
  };

  const ask = async (text) => {
    const q = (text ?? input).trim();
    if (!q || gen.busy) return;
    let ids;
    if (mode === 'selected') ids = sel;
    else if (mode === 'all') ids = getIndex().notes.map((n) => n.id);
    else ids = autoContext(q);
    setLastCtx(ids);
    const ctx = notesContext(ids, { maxChars: mode === 'all' ? 350000 : 90000 });
    const history = [...msgs, { role: 'user', content: q, ts: now() }];
    persist(history);
    setInput('');
    const res = await gen.run({ system: oracleSystemPrompt(ctx), model, messages: history.slice(-12).map((m) => ({ role: m.role, content: m.content })) });
    if (res?.text) {
      persist([...history, { role: 'assistant', content: res.text, ts: now(), ctx: ids.length }]);
      gen.setOut('');
    }
  };
  const clear = async () => {
    if (await confirmDialog('Unterhaltung mit dem Orakel leeren?', { ok: 'Leeren' })) persist([]);
  };
  const saveAnswer = async (m, i) => {
    const q = msgs[i - 1]?.content || 'Orakel';
    const n = await createNote({ title: `Orakel – ${q.slice(0, 60)}`, folder: 'Orakel', body: `> [!question] ${q}\n\n${m.content}` });
    toast('Als Notiz gespeichert', 'success', { action: { label: 'Öffnen', onClick: () => openNote(n.id) } });
  };

  return html`<${ViewFrame} tabId=${tabId} title="Orakel" actions=${html`<div class="row nowrap" style="gap:4px"><${ModelPicker} task="oracle" value=${model} onChange=${setModel} /><${IconBtn} icon="trash" title="Unterhaltung leeren" onClick=${clear} /></div>`}>
    <div class="page narrow stack">
      <div class="page-head" style="margin-bottom:4px"><h1><${Icon} name="sparkles" size=${24} />Orakel</h1><span class="sub">Frag deine Welt. Das Orakel liest die passenden Codex-Notizen und antwortet mit [[Links]] – inklusive Hinweisen auf Widersprüche.</span></div>
      <div class="card stack sm">
        <${Segmented} value=${mode} onChange=${setMode} options=${[{ value: 'auto', label: 'Automatisch', icon: 'search' }, { value: 'selected', label: 'Ausgewählte Notizen', icon: 'list' }, { value: 'all', label: 'Ganzer Codex', icon: 'layers' }]} />
        ${mode === 'auto' ? html`<div class="small faint">Sucht pro Frage die relevantesten Notizen (Titel, Aliase, Inhalt) plus deren Verlinkungen.</div>` : null}
        ${mode === 'all' ? html`<div class="small faint">Schickt alle Notizen mit (~${estimateTokens(getIndex().notes.map((n) => n.body || '').join('')).toLocaleString('de-DE')} Tokens) – nur mit Modellen mit großem Kontext (Gemini Pro, Claude) sinnvoll und teurer.</div>` : null}
        ${mode === 'selected' ? html`<${NotePicker} onPick=${(n) => setSel([...new Set([...sel, n.id])])} exclude=${sel} />
          ${sel.length ? html`<div class="chips">${sel.map(noteById).filter(Boolean).map((n) => html`<span class="chip accent">${n.title}<span class="x" onClick=${() => setSel(sel.filter((x) => x !== n.id))}><${Icon} name="x" size=${12} /></span></span>`)}</div>` : null}` : null}
      </div>

      ${!msgs.length && !gen.busy ? html`<div class="card"><${Empty} icon="sparkles" title="Was möchtest du wissen?">
        <div class="chips" style="justify-content:center;margin-top:10px">${QUICK.map((q) => html`<button type="button" class="chip suggest" onClick=${() => ask(q)}>${q}</button>`)}</div>
      <//></div>` : null}

      ${msgs.map((m, i) => (m.role === 'user'
        ? html`<div class="chat-msg mine" key=${i}><div class="body" style="max-width:85%">${m.content}</div></div>`
        : html`<div class="card" key=${i}>
            <${MarkdownView} src=${m.content} />
            <div class="row small faint" style="margin-top:6px">${m.ctx != null ? html`<span>${m.ctx} Notizen als Kontext</span>` : null}<span class="grow"></span>
              <${IconBtn} icon="copy" title="Kopieren" onClick=${() => { copyText(m.content); toast('Kopiert'); }} />
              <${IconBtn} icon="save" title="Als Notiz speichern" onClick=${() => saveAnswer(m, i)} />
              <${IconBtn} icon="plus" title="An Notiz anhängen" onClick=${() => appendDialog(m.content)} />
            </div>
          </div>`))}
      ${gen.busy ? html`<div class="card"><div class="small faint" style="margin-bottom:6px">${lastCtx.length} Notizen gelesen …</div><${MarkdownView} src=${gen.out || '…'} class="streaming-caret" /></div>` : null}
      <div ref=${endRef}></div>

      <div class="card stack sm" style="position:sticky;bottom:8px">
        <div class="row nowrap" style="align-items:flex-end;gap:6px">
          <${AutoTextarea} value=${input} minRows=${1} maxHeight=${220} onInput=${(e) => setInput(e.target.value)} placeholder="Frag das Orakel … (Enter senden, Umschalt+Enter neue Zeile)"
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
          <${DictateButton} onText=${(t) => setInput(`${input}${input ? ' ' : ''}${t}`)} />
          ${gen.busy ? html`<${Btn} icon="stop" onClick=${gen.stop} />` : html`<${Btn} kind="primary" icon="send" onClick=${() => ask()} />`}
        </div>
      </div>
    </div>
  <//>`;
}
