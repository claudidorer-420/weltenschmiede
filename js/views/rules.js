// Regel-Nachschlagewerk: Zustände, Kampfaktionen, Deckung, SG, Reisen, Münzen … + Regelfrage an die KI.
import { html, useState, useRef } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { isGM, createNote, useEdition } from '../core/app.js';
import { openNote } from '../core/workspace.js';
import { settings, updateSettings } from '../core/settings.js';
import { generate } from '../core/ai.js';
import { rulesSystemPrompt } from '../core/prompts.js';
import { RULES, CONDITIONS, SRD_ATTRIBUTION } from '../data/rules5e.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, Btn, MarkdownView, ModelPicker, Segmented, toast, AutoTextarea } from '../ui/components.js';

export function RulesView({ tabId }) {
  const [q, setQ] = useState('');
  const version = useEdition();
  const [open, setOpen] = useState(() => new Set(['aktionen']));
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState(null);
  const abortRef = useRef(null);
  const ql = q.toLowerCase();
  const rules = RULES.filter((r) => !ql || `${r.title} ${r.body}`.toLowerCase().includes(ql));
  const conds = CONDITIONS.filter((c) => !ql || `${c.name} ${c.en} ${c.desc}`.toLowerCase().includes(ql));

  const toggle = (id) => {
    const s = new Set(open);
    s.has(id) ? s.delete(id) : s.add(id);
    setOpen(s);
  };
  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setAnswer('');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await generate({ task: 'rules', model, system: rulesSystemPrompt(version), prompt: question, onDelta: (_, full) => setAnswer(full), signal: ac.signal });
    } catch (e) {
      if (e.code !== 'abort') toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const saveNote = async () => {
    const n = await createNote({ title: `Regel – ${question.slice(0, 60)}`, folder: 'Regeln', body: `> [!question] ${question}\n\n${answer}` });
    openNote(n.id);
  };

  return html`<${ViewFrame} tabId=${tabId} title="Regeln">
    <div class="page stack lg">
      <div class="page-head">
        <h1><${Icon} name="book" size=${24} />Regeln</h1><span class="grow"></span>
        <span class="badge" title="Regelwerk der Kampagne">D&D 5e ${version}</span>
      </div>
      <div class="search-box" style="margin:0"><${Icon} name="search" size=${16} /><input class="input" placeholder="Regel suchen (z. B. Deckung, gepackt, Sturz) …" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>

      <div class="card stack">
        <div class="card-head" style="margin:0"><h3><${Icon} name="sparkles" size=${18} />Regelfrage an die KI</h3><span class="grow"></span><${ModelPicker} task="rules" value=${model} onChange=${setModel} /></div>
        <${AutoTextarea} value=${question} onInput=${(e) => setQuestion(e.target.value)} minRows=${2} placeholder="z. B. Kann ein gepackter Zauberer noch einen Zauber mit Gestenkomponente wirken?" onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask(); }} />
        <div class="btn-row">
          <${Btn} kind="primary" icon="send" loading=${busy} onClick=${ask}>Fragen<//>
          ${busy ? html`<${Btn} kind="ghost" icon="stop" onClick=${() => abortRef.current?.abort()}>Stopp<//>` : null}
          ${answer && !busy && isGM() ? html`<${Btn} icon="save" onClick=${saveNote}>Als Notiz speichern<//>` : null}
        </div>
        ${answer ? html`<${MarkdownView} src=${answer} class=${busy ? 'streaming-caret' : ''} />` : null}
      </div>

      ${conds.length ? html`<div>
        <div class="section-title"><${Icon} name="activity" size=${14} />Zustände</div>
        <div class="grid three">${conds.map((c) => html`<div class="card tight">
          <div class="row nowrap" style="margin-bottom:6px"><${Icon} name=${c.icon} size=${18} class="accent-text" /><b>${c.name}</b><span class="faint small">${c.en}</span></div>
          <div class="small" style="line-height:1.55">${c.desc}</div>
        </div>`)}</div>
      </div>` : null}

      <div class="stack">
        ${rules.map((r) => html`<div class="card" key=${r.id}>
          <div class="card-head" style="cursor:pointer;margin-bottom:${open.has(r.id) || ql ? '12px' : '0'}" onClick=${() => toggle(r.id)}>
            <h3><${Icon} name=${r.icon} size=${18} />${r.title}</h3><span class="grow"></span><${Icon} name=${open.has(r.id) || ql ? 'chevron-up' : 'chevron-down'} size=${16} />
          </div>
          ${open.has(r.id) || ql ? html`<${MarkdownView} src=${r.body.trim()} />` : null}
        </div>`)}
      </div>
      <p class="tiny faint">${SRD_ATTRIBUTION} Zusammenfassungen in eigenen Worten.</p>
    </div>
  <//>`;
}
