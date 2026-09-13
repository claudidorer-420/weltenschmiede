// Gemeinsame KI-Ausgabe: Streaming-Hook, Status, Werkzeugleiste (Speichern, Anhängen, Nachbessern, Teilen …).
import { html, useState, useEffect, useRef } from '../lib/preact.js';
import { app, createNote, updateNote, noteById, resolveTitle, allFolders, col, myUid } from '../core/app.js';
import { openNote, openView } from '../core/workspace.js';
import { generate, modelLabel, PROVIDERS } from '../core/ai.js';
import { db } from '../core/db.js';
import { extractLinks } from '../lib/markdown.js';
import { copyText, download, shareText, now, estimateTokens } from '../lib/util.js';
import { Icon, IconBtn, Btn, Field, Segmented, Check, MarkdownView, NotePicker, openModal, promptDialog, toast, openMenu, Spinner } from './components.js';

const TRUNCATED = new Set(['max_tokens', 'length', 'MAX_TOKENS']);

export function useGeneration(task) {
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const last = useRef(null);
  const pending = useRef('');
  const timer = useRef(0);
  const outRef = useRef('');
  outRef.current = out;

  useEffect(() => () => {
    abortRef.current?.abort();
    clearTimeout(timer.current);
  }, []);

  const run = async ({ system = '', messages, model, json = false, append = false, prompt, images }) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const msgs = messages || [{ role: 'user', content: prompt || '', images: images || [] }];
    const base = append ? outRef.current : '';
    setBusy(true);
    setError(null);
    setMeta(null);
    if (!append) setOut('');
    pending.current = base;
    last.current = { system, model, json, messages: msgs };
    try {
      const res = await generate({
        task, system, messages: msgs, model, json, signal: ac.signal,
        onDelta: (_, full) => {
          pending.current = base + full;
          if (!timer.current) timer.current = setTimeout(() => { timer.current = 0; setOut(pending.current); }, 80);
        },
      });
      clearTimeout(timer.current);
      timer.current = 0;
      const text = base + res.text;
      setOut(text);
      setMeta(res);
      return { ...res, text };
    } catch (e) {
      clearTimeout(timer.current);
      timer.current = 0;
      setOut(pending.current);
      if (e.code !== 'abort') {
        setError(e.message);
        toast(e.message, 'error');
      }
      return null;
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();
  const refine = (instruction) => {
    if (!last.current) return null;
    return run({
      ...last.current,
      messages: [...last.current.messages, { role: 'assistant', content: outRef.current }, { role: 'user', content: `Überarbeite deine letzte Antwort: ${instruction}\nGib den vollständigen, überarbeiteten Text im gleichen Format zurück.` }],
    });
  };
  const cont = () => {
    if (!last.current) return null;
    return run({
      ...last.current,
      append: true,
      messages: [...last.current.messages, { role: 'assistant', content: outRef.current }, { role: 'user', content: 'Fahre genau an der Stelle fort, an der du aufgehört hast – ohne Wiederholung und ohne Vorrede.' }],
    });
  };
  const truncated = !!meta && TRUNCATED.has(meta.finish);
  return { out, setOut, busy, meta, error, run, stop, refine, cont, truncated };
}

export function GenStatus({ gen, label = 'Die KI schreibt …' }) {
  if (gen.busy) {
    return html`<div class="gen-status"><${Spinner} /><span>${label}</span><span class="token-meter">~${estimateTokens(gen.out).toLocaleString('de-DE')} Tokens</span><span class="grow"></span><${Btn} size="sm" kind="ghost" icon="stop" onClick=${gen.stop}>Stopp<//></div>`;
  }
  if (gen.meta) {
    const u = gen.meta.usage;
    return html`<div class="gen-status small">
      <${Icon} name="check-circle" size=${15} class="success-text" />
      <span>${modelLabel({ provider: gen.meta.provider, model: gen.meta.model })} · ${PROVIDERS[gen.meta.provider]?.short || ''} · ${(gen.meta.ms / 1000).toFixed(1)} s${u ? ` · ${(u.input || 0).toLocaleString('de-DE')} → ${(u.output || 0).toLocaleString('de-DE')} Tokens` : ''}</span>
      ${gen.truncated ? html`<span class="badge warn">abgeschnitten</span><${Btn} size="sm" icon="arrow-right" onClick=${gen.cont}>Fortsetzen<//>` : null}
    </div>`;
  }
  return null;
}

// Abschnitt (### Überschrift mit [[Name]]) aus einem Text herauslösen
export function sectionFor(text, name) {
  const lines = String(text).split('\n');
  const n = name.toLowerCase();
  const i = lines.findIndex((l) => /^#{2,4}\s/.test(l) && l.toLowerCase().includes(`[[${n}`));
  if (i < 0) return '';
  const lvl = /^(#+)/.exec(lines[i])[1].length;
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const m = /^(#+)\s/.exec(lines[j]);
    if (m && m[1].length <= lvl) break;
    out.push(lines[j]);
  }
  return out.join('\n').trim();
}

function guessFolder(text, name) {
  const lines = String(text).split('\n');
  const n = name.toLowerCase();
  let current = '';
  for (const l of lines) {
    const m = /^##\s+(.*)$/.exec(l);
    if (m) current = m[1].toLowerCase();
    if (l.toLowerCase().includes(`[[${n}`)) {
      if (/npc|bewohner|personal|inhaber|gäste|anführ|klerus|beteiligt/.test(current)) return 'NPCs';
      if (/ort|läden|laden|stadt|städte/.test(current)) return 'Orte';
      if (/fraktion|beziehung|mächte/.test(current)) return 'Fraktionen';
      return null;
    }
  }
  return null;
}

export function stripTitle(md) {
  return String(md || '').replace(/^\s*#\s+[^\n]+\n+/, '');
}

export async function saveTextAsNote({ text, title, folder = '', visibility = 'gm', createLinked = false, frontmatter = '' }) {
  const body = frontmatter + stripTitle(text);
  const note = await createNote({ title, folder, body, visibility });
  let created = 0;
  if (createLinked) {
    for (const link of extractLinks(body)) {
      if (resolveTitle(link)) continue;
      const section = sectionFor(text, link);
      const f = guessFolder(text, link) || folder;
      await createNote({ title: link, folder: f, visibility, body: `${section ? `${section}\n\n` : ''}*Erwähnt in [[${note.title}]].*\n` });
      created++;
    }
  }
  return { note, created };
}

function SaveForm({ close, text, title, folder, frontmatter }) {
  const [t, setT] = useState(title);
  const [f, setF] = useState(folder || '');
  const [vis, setVis] = useState('gm');
  const unresolved = extractLinks(text).filter((l) => !resolveTitle(l));
  const [linked, setLinked] = useState(unresolved.length > 0 && unresolved.length <= 12);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { note, created } = await saveTextAsNote({ text, title: t.trim() || title, folder: f, visibility: vis, createLinked: linked, frontmatter });
      toast(`„${note.title}“ gespeichert${created ? ` + ${created} verlinkte Notizen` : ''}`, 'success', { action: { label: 'Öffnen', onClick: () => openNote(note.id) } });
      close(note);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };
  const folders = allFolders();
  return html`<form onSubmit=${save}>
    <div class="modal-body stack">
      <${Field} label="Titel"><input class="input" value=${t} onInput=${(e) => setT(e.target.value)} autoFocus /><//>
      <${Field} label="Ordner">
        <input class="input" list="ws-folders" value=${f} onInput=${(e) => setF(e.target.value)} placeholder="Hauptordner" />
        <datalist id="ws-folders">${folders.map((x) => html`<option value=${x} />`)}</datalist>
      <//>
      <${Field} label="Sichtbarkeit"><${Segmented} value=${vis} onChange=${setVis} options=${[{ value: 'gm', label: 'Nur SL', icon: 'lock' }, { value: 'players', label: 'Für Spieler', icon: 'users' }]} /><//>
      ${unresolved.length ? html`<${Check} checked=${linked} onChange=${setLinked} label=${`${unresolved.length} neue verlinkte Namen als eigene Notizen anlegen (${unresolved.slice(0, 5).join(', ')}${unresolved.length > 5 ? ' …' : ''})`} />` : null}
    </div>
    <div class="modal-foot"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" type="submit" icon="save" loading=${busy}>Im Codex speichern<//></div>
  </form>`;
}

export function saveDialog({ text, title, folder, frontmatter = '' }) {
  return openModal(({ close }) => html`<${SaveForm} close=${close} text=${text} title=${title} folder=${folder} frontmatter=${frontmatter} />`, { title: 'In den Codex speichern', icon: 'save' });
}

export function appendDialog(text) {
  return openModal(({ close }) => html`<div class="modal-body stack">
    <p class="small muted" style="margin:0">Der Text wird unten an die gewählte Notiz angehängt.</p>
    <${NotePicker} autoFocus onPick=${async (n) => {
      const cur = noteById(n.id);
      await updateNote(n.id, { body: `${(cur?.body || '').trimEnd()}\n\n---\n\n${stripTitle(text)}` });
      toast(`An „${n.title}“ angehängt`, 'success', { action: { label: 'Öffnen', onClick: () => openNote(n.id) } });
      close(n);
    }} />
  </div>`, { title: 'An Notiz anhängen', icon: 'plus' });
}

export async function sendHandout(title, text) {
  await db.add(col('handouts'), { title, body: text, visibility: 'players', ts: now(), by: myUid() });
  toast('Als Handout an die Spieler geschickt', 'success', { action: { label: 'Ansehen', onClick: () => openView('handouts') } });
}

export function OutputToolbar({ gen, title, folder, onRegenerate, extra, frontmatter = '' }) {
  const text = gen.out;
  if (!text || gen.busy) return null;
  const more = (e) => openMenu(e, [
    { label: 'Kopieren', icon: 'copy', onClick: async () => { await copyText(text); toast('Kopiert'); } },
    { label: 'Als Markdown herunterladen', icon: 'download', onClick: () => download(`${title || 'Weltenschmiede'}.md`, text, 'text/markdown;charset=utf-8') },
    { label: 'Teilen …', icon: 'share', onClick: async () => { const r = await shareText({ title, text }); if (r === 'copied') toast('In die Zwischenablage kopiert'); } },
    { label: 'Per E-Mail senden', icon: 'mail', onClick: () => { location.href = `mailto:?subject=${encodeURIComponent(`D&D-Archiv: ${title}`)}&body=${encodeURIComponent(text.slice(0, 6000))}`; } },
    { label: 'An Spieler als Handout', icon: 'scroll', onClick: () => sendHandout(title, text), disabled: !app.get().cid },
    { label: 'Drucken / PDF', icon: 'printer', onClick: () => window.print() },
  ]);
  return html`<div class="toolbar">
    <${Btn} kind="primary" icon="save" onClick=${() => saveDialog({ text, title, folder, frontmatter })}>In Codex speichern<//>
    <${Btn} icon="plus" onClick=${() => appendDialog(text)}>An Notiz anhängen<//>
    <${Btn} icon="wand" onClick=${async () => {
      const instr = await promptDialog('Was soll geändert werden?', '', { title: 'Nachbessern', multiline: true, placeholder: 'z. B. Mach den Wirt unheimlicher, füge eine Preisliste für Waffen hinzu, kürze die Geschichte …', ok: 'Überarbeiten' });
      if (instr) gen.refine(instr);
    }}>Nachbessern<//>
    ${onRegenerate ? html`<${Btn} icon="refresh" onClick=${onRegenerate}>Neu<//>` : null}
    ${extra || null}
    <${IconBtn} icon="more-horizontal" title="Mehr" onClick=${more} />
  </div>`;
}

export function OutputView({ gen, placeholder }) {
  if (!gen.out && !gen.busy) return placeholder || null;
  return html`<${MarkdownView} src=${gen.out || ' '} class=${gen.busy ? 'streaming-caret' : ''} />`;
}
