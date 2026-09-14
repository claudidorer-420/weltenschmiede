// Kampagnen-Manager: Sitzungen (Vorbereitung, Live-Notizen, Rückblick mit KI), Quests (Kanban), Mitspieler & Einladungen.
import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, vault, col, getInvites, renewInvite, removeMember, setMemberField, encodeB64Url, myUid } from '../core/app.js';
import { db } from '../core/db.js';
import { openView } from '../core/workspace.js';
import { getCloudConfig, hasBakedCloudConfig } from '../core/settings.js';
import { summarySystemPrompt, prepSystemPrompt, worldContext, notesContext } from '../core/prompts.js';
import { loadParty } from '../core/party.js';
import { ViewFrame } from '../ui/frame.js';
import {
  Icon, IconBtn, Btn, Field, Select, Segmented, ModelPicker, NotePicker, MarkdownView, AutoTextarea, DictateButton,
  openModal, confirmDialog, toast, Empty, Avatar,
} from '../ui/components.js';
import { useGeneration, GenStatus, sendHandout } from '../ui/aiout.js';
import { useCol, useDoc, useVisibleCol } from '../core/hooks.js';
import { now, debounce, sortBy, fmtDate, fmtTime, copyText, shareText } from '../lib/util.js';
import { TEMPLATES } from '../data/templates.js';

const PREP_TEMPLATE = TEMPLATES.find((t) => t.id === 'sitzung').body('').replace(/^---[\s\S]*?---\n/, '');
const SESSION_TAB_HINT = {
  prep: 'Vor dem Spiel: dein Plan für den Abend – nur für dich sichtbar.',
  notes: 'Während des Spiels: kurz mitschreiben, was passiert – nur für dich sichtbar.',
  recap: 'Nach dem Spiel: „Was bisher geschah“ für die Spieler – erst sichtbar, wenn du „Rückblick teilen“ wählst.',
};

// ───────────────────────── Sitzungen ─────────────────────────
export function SessionsView({ tabId }) {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const list = useVisibleCol('sessions');
  const create = async () => {
    const num = (list || []).reduce((a, s) => Math.max(a, Number(s.number) || 0), 0) + 1;
    const id = await db.add(col('sessions'), { number: num, title: `Sitzung ${num}`, date: new Date().toISOString().slice(0, 10), status: 'planned', visibility: 'gm', recap: '', createdAt: now() });
    await db.set(col('gm'), `session-${id}`, { prep: PREP_TEMPLATE, notes: '' });
    openView('session', { id, title: `Sitzung ${num}` });
  };
  const sorted = list ? sortBy(list, (s) => Number(s.number) || 0, -1) : null;
  return html`<${ViewFrame} tabId=${tabId} title="Sitzungen">
    <div class="page narrow stack lg">
      <div class="page-head"><h1><${Icon} name="calendar" size=${24} />Sitzungen</h1><span class="grow"></span>${gm ? html`<${Btn} kind="primary" icon="plus" onClick=${create}>Neue Sitzung<//>` : null}
        <span class="sub">${gm ? 'Eine Sitzung = ein Spielabend: vorher planen, währenddessen mitschreiben, danach den Rückblick teilen.' : 'Rückblicke der bisherigen Spielabende – „Was bisher geschah“.'}</span></div>
      ${gm ? html`<details class="card how-to" open=${!(list || []).length}>
        <summary><${Icon} name="help" size=${16} />So funktionieren Sitzungen</summary>
        <div class="step-list small" style="margin-top:12px;line-height:1.55">
          <div class="step"><div><b>Vor dem Spielabend – Vorbereitung:</b> „Neue Sitzung“ anlegen. Die Checkliste (starker Einstieg, Szenen, Geheimnisse & Hinweise, Orte, NPCs, Monster, Belohnungen) füllst du selbst – oder „KI: vorbereiten“ baut sie aus dem letzten Rückblick, den offenen Quests und ausgewählten Codex-Notizen. Nur du siehst sie.</div></div>
          <div class="step"><div><b>Während des Spiels – Live-Notizen:</b> kurze Stichpunkte, was passiert (mit Zeitstempel-Knopf oder per Diktat). Ebenfalls nur für dich.</div></div>
          <div class="step"><div><b>Nach dem Spiel – Rückblick:</b> „Rückblick erzeugen“ macht aus deinen Notizen eine Zusammenfassung. Mit „Rückblick teilen“ sehen die Spieler sie hier, und die KI nutzt sie als Gedächtnis für die nächste Vorbereitung.</div></div>
        </div>
        <div class="small faint" style="margin-top:10px">Tipp: Der Status „geplant“ / „gespielt“ und das Datum erscheinen auf der Startseite unter „Nächste Sitzung“.</div>
      </details>` : null}
      ${!sorted ? html`<div class="empty"><span class="spinner" /></div>` : !sorted.length ? html`<${Empty} icon="calendar" title="Noch keine Sitzungen">${gm ? 'Lege die erste Sitzung an.' : 'Die Spielleitung hat noch keine Rückblicke geteilt.'}<//>` : html`<div class="stack sm">
        ${sorted.map((s) => html`<div class="session-item" key=${s.id} onClick=${() => openView('session', { id: s.id, title: s.title })}>
          <div class="num">#${s.number || '?'}</div>
          <div><b>${s.title}</b><div class="small muted">${s.date ? fmtDate(new Date(s.date).getTime()) : 'ohne Datum'}${s.recap ? ' · Rückblick vorhanden' : ''}</div></div>
          <div class="row nowrap">${gm ? html`<span class=${`badge ${s.visibility === 'players' ? 'players' : 'gm'}`}>${s.visibility === 'players' ? 'geteilt' : 'SL'}</span>` : null}<span class=${`badge ${s.status === 'done' ? 'accent' : ''}`}>${s.status === 'done' ? 'gespielt' : 'geplant'}</span></div>
        </div>`)}
      </div>`}
    </div>
  <//>`;
}

export function SessionView({ params, tabId }) {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const s = useDoc(col('sessions'), params.id);
  const gmDoc = useDoc(gm ? col('gm') : null, `session-${params.id}`);
  const [tab, setTab] = useState(gm ? 'prep' : 'recap');
  const [prep, setPrep] = useState(null);
  const [notes, setNotes] = useState(null);
  const [recap, setRecap] = useState(null);
  const [ctx, setCtx] = useState([]);
  const [model, setModel] = useState(null);
  const gen = useGeneration('summary');
  const saveGm = useMemo(() => debounce((patch) => db.set(col('gm'), `session-${params.id}`, patch, { merge: true }), 600), [params.id]);
  const saveS = useMemo(() => debounce((patch) => db.update(col('sessions'), params.id, patch), 600), [params.id]);
  useEffect(() => { if (gmDoc !== undefined && prep === null) { setPrep(gmDoc?.prep ?? PREP_TEMPLATE); setNotes(gmDoc?.notes ?? ''); } }, [gmDoc]);
  useEffect(() => { if (s && recap === null) setRecap(s.recap || ''); }, [s]);

  if (s === undefined) return html`<${ViewFrame} tabId=${tabId} title="Sitzung"><div class="empty"><span class="spinner lg" /></div><//>`;
  if (!s) return html`<${ViewFrame} tabId=${tabId} title="Sitzung"><${Empty} icon="calendar" title="Sitzung nicht gefunden" /><//>`;

  const setMeta = (patch) => db.update(col('sessions'), s.id, patch);
  const aiPrep = async () => {
    const sessions = await db.list(col('sessions'));
    const prev = sortBy(sessions.filter((x) => x.recap && Number(x.number) < Number(s.number)), (x) => Number(x.number), -1)[0];
    const quests = await db.list(col('quests')).catch(() => []);
    const prompt = `Bereite Sitzung #${s.number} „${s.title}“ vor.\n\nBisheriger Stand:\n${prev?.recap || '(noch kein Rückblick)'}\n\nOffene Quests:\n${quests.filter((q) => q.status !== 'done' && q.status !== 'failed').map((q) => `- ${q.title}: ${q.description || ''}`).join('\n') || '–'}\n\nMeine Stichpunkte / Wünsche:\n${prep || ''}\n\n${worldContext()}\n\nCodex-Auszüge:\n${notesContext(ctx, { maxChars: 40000 })}`;
    const res = await gen.run({ system: prepSystemPrompt(), model, prompt });
    if (res?.text) {
      setPrep(res.text);
      saveGm({ prep: res.text });
    }
  };
  const aiRecap = async () => {
    const prompt = `Sitzung #${s.number} „${s.title}“ (${s.date || ''}).\n\nLive-Notizen der Spielleitung:\n${notes || '(keine)'}\n\nVorbereitung (zur Orientierung, nur Gespieltes übernehmen):\n${(prep || '').slice(0, 6000)}\n\nCodex-Auszüge:\n${notesContext(ctx, { maxChars: 20000 })}`;
    setTab('recap');
    const res = await gen.run({ system: summarySystemPrompt(), model, prompt });
    if (res?.text) {
      setRecap(res.text);
      saveS({ recap: res.text });
    }
  };
  const stamp = () => {
    const t = `\n**${fmtTime(Date.now())}** – `;
    const v = (notes || '') + t;
    setNotes(v);
    saveGm({ notes: v });
  };

  return html`<${ViewFrame} tabId=${tabId} title=${`#${s.number} ${s.title}`}>
    <div class="page stack lg">
      <div class="page-head">
        ${gm ? html`<input class="inline-title-input" style="margin:0;max-width:600px" value=${s.title} onBlur=${(e) => e.target.value !== s.title && setMeta({ title: e.target.value })} />` : html`<h1>#${s.number} ${s.title}</h1>`}
        <span class="grow"></span>
        ${gm ? html`<input class="input sm" type="date" style="width:160px" value=${s.date || ''} onChange=${(e) => setMeta({ date: e.target.value })} />
          <${Select} class="sm" value=${s.status} onChange=${(v) => setMeta({ status: v })} options=${[{ value: 'planned', label: 'geplant' }, { value: 'done', label: 'gespielt' }]} style="width:120px" />
          <${Btn} size="sm" kind=${s.visibility === 'players' ? 'success' : ''} icon=${s.visibility === 'players' ? 'users' : 'lock'} onClick=${() => setMeta({ visibility: s.visibility === 'players' ? 'gm' : 'players' })}>${s.visibility === 'players' ? 'Rückblick geteilt' : 'Rückblick teilen'}<//>` : null}
      </div>
      ${gm ? html`<div class="row"><${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'prep', label: 'Vorbereitung', icon: 'list-checks' }, { value: 'notes', label: 'Live-Notizen', icon: 'pencil' }, { value: 'recap', label: 'Rückblick', icon: 'scroll' }]} /><span class="grow"></span><${ModelPicker} task="summary" value=${model} onChange=${setModel} /></div>
        <div class="small muted" style="margin-top:-8px">${SESSION_TAB_HINT[tab]}</div>
        <div class="card stack sm"><div class="small muted">Codex-Kontext für die KI (optional):</div><${NotePicker} onPick=${(n) => setCtx([...new Set([...ctx, n.id])])} exclude=${ctx} />
          ${ctx.length ? html`<div class="chips">${ctx.map((id) => vault.get().notes[id]).filter(Boolean).map((n) => html`<span class="chip accent">${n.title}<span class="x" onClick=${() => setCtx(ctx.filter((x) => x !== n.id))}><${Icon} name="x" size=${12} /></span></span>`)}</div>` : null}</div>` : null}
      <${GenStatus} gen=${gen} />

      ${gm && tab === 'prep' ? html`<div class="card stack">
        <div class="row"><b class="grow">Vorbereitung (nur für dich)</b><${Btn} size="sm" icon="sparkles" loading=${gen.busy} onClick=${aiPrep}>KI: vorbereiten<//></div>
        <${AutoTextarea} value=${prep ?? ''} minRows=${14} onInput=${(e) => { setPrep(e.target.value); saveGm({ prep: e.target.value }); }} class="textarea mono" />
        <details><summary class="small muted">Vorschau</summary><${MarkdownView} src=${prep || ''} /></details>
      </div>` : null}

      ${gm && tab === 'notes' ? html`<div class="card stack">
        <div class="row"><b class="grow">Live-Notizen (nur für dich)</b><${DictateButton} onText=${(t) => { const v = `${notes || ''} ${t}`; setNotes(v); saveGm({ notes: v }); }} /><${Btn} size="sm" icon="clock" onClick=${stamp}>Zeitstempel<//><${Btn} size="sm" kind="primary" icon="sparkles" loading=${gen.busy} onClick=${aiRecap}>Rückblick erzeugen<//></div>
        <${AutoTextarea} value=${notes ?? ''} minRows=${14} onInput=${(e) => { setNotes(e.target.value); saveGm({ notes: e.target.value }); }} placeholder="Stichpunkte während des Spiels – was passiert ist, wer was gesagt hat, Beute, offene Fragen … Geheimes mit „SL:“ markieren." />
      </div>` : null}

      ${tab === 'recap' || !gm ? html`<div class="card stack">
        <div class="row"><b class="grow">Rückblick – „Was bisher geschah“</b>
          ${gm ? html`<${Btn} size="sm" icon="sparkles" loading=${gen.busy} onClick=${aiRecap}>Aus Notizen erzeugen<//><${Btn} size="sm" icon="scroll" disabled=${!recap} onClick=${() => sendHandout(`Rückblick #${s.number}: ${s.title}`, recap)}>Als Handout<//>` : null}</div>
        ${gm && !gen.busy ? html`<${AutoTextarea} value=${recap ?? ''} minRows=${8} onInput=${(e) => { setRecap(e.target.value); saveS({ recap: e.target.value }); }} placeholder="Rückblick für die Spieler …" />` : null}
        <${MarkdownView} src=${gen.busy ? gen.out : recap || (gm ? '' : '*Noch kein Rückblick.*')} class=${gen.busy ? 'streaming-caret' : ''} />
      </div>` : null}
    </div>
  <//>`;
}

// ───────────────────────── Quests ─────────────────────────
const COLUMNS = [
  { id: 'open', label: 'Offen', icon: 'target' },
  { id: 'active', label: 'Aktiv', icon: 'zap' },
  { id: 'done', label: 'Erledigt', icon: 'check-circle' },
  { id: 'failed', label: 'Gescheitert', icon: 'x' },
];

function QuestForm({ close, quest }) {
  const gm = app.get().role === 'gm';
  const [q, setQ] = useState({ title: '', status: 'open', description: '', giver: '', reward: '', visibility: 'gm', ...quest });
  const secret = useDoc(quest?.id ? col('gm') : null, quest?.id ? `quest-${quest.id}` : null);
  const [gmNote, setGmNote] = useState(null);
  useEffect(() => { if (secret !== undefined && gmNote === null) setGmNote(secret?.body || ''); }, [secret]);
  const save = async (e) => {
    e.preventDefault();
    if (!q.title.trim()) return;
    const { id, ...data } = q;
    let qid = quest?.id;
    if (qid) await db.set(col('quests'), qid, { ...data, updatedAt: now() });
    else qid = await db.add(col('quests'), { ...data, createdAt: now(), updatedAt: now() });
    if (gm && gmNote !== null) await db.set(col('gm'), `quest-${qid}`, { body: gmNote || '' });
    close(true);
  };
  return html`<form onSubmit=${save}><div class="modal-body stack">
    <${Field} label="Titel"><input class="input" value=${q.title} onInput=${(e) => setQ({ ...q, title: e.target.value })} autoFocus /><//>
    <div class="grid three" style="gap:8px">
      <${Field} label="Status"><${Select} value=${q.status} onChange=${(v) => setQ({ ...q, status: v })} options=${COLUMNS.map((c) => ({ value: c.id, label: c.label }))} /><//>
      <${Field} label="Auftraggeber"><input class="input" value=${q.giver} onInput=${(e) => setQ({ ...q, giver: e.target.value })} placeholder="[[Name]] möglich" /><//>
      <${Field} label="Belohnung"><input class="input" value=${q.reward} onInput=${(e) => setQ({ ...q, reward: e.target.value })} placeholder="z. B. 150 gp" /><//>
    </div>
    <${Field} label="Beschreibung (Markdown, [[Links]])"><${AutoTextarea} value=${q.description} minRows=${4} onInput=${(e) => setQ({ ...q, description: e.target.value })} /><//>
    <${Field} label="Sichtbarkeit"><${Segmented} value=${q.visibility} onChange=${(v) => setQ({ ...q, visibility: v })} options=${[{ value: 'gm', label: 'Nur SL', icon: 'lock' }, { value: 'players', label: 'Im Quest-Log der Spieler', icon: 'users' }]} /><//>
    ${gm ? html`<${Field} label="SL-Notizen (geheim)"><${AutoTextarea} value=${gmNote ?? ''} minRows=${2} onInput=${(e) => setGmNote(e.target.value)} placeholder="Was wirklich dahintersteckt …" /><//>` : null}
  </div>
  <div class="modal-foot">
    ${quest?.id ? html`<${Btn} kind="danger" icon="trash" onClick=${async () => { if (await confirmDialog(`Quest „${q.title}“ löschen?`, { danger: true, ok: 'Löschen' })) { await db.remove(col('quests'), quest.id); await db.remove(col('gm'), `quest-${quest.id}`).catch(() => {}); close(true); } }}>Löschen<//><span class="grow"></span>` : null}
    <${Btn} kind="ghost" onClick=${() => close(false)}>Abbrechen<//><${Btn} kind="primary" type="submit" icon="save">Speichern<//>
  </div></form>`;
}

const editQuest = (quest) => openModal(({ close }) => html`<${QuestForm} close=${close} quest=${quest} />`, { title: quest?.id ? 'Quest bearbeiten' : 'Neue Quest', icon: 'list-checks', size: 'lg' });

export function QuestsView({ tabId }) {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const list = useVisibleCol('quests');
  const [drag, setDrag] = useState(null);
  const move = async (id, status) => db.update(col('quests'), id, { status, updatedAt: now() });
  return html`<${ViewFrame} tabId=${tabId} title="Quests">
    <div class="page wide stack lg">
      <div class="page-head"><h1><${Icon} name="list-checks" size=${24} />Quests</h1><span class="grow"></span>${gm ? html`<${Btn} kind="primary" icon="plus" onClick=${() => editQuest(null)}>Neue Quest<//>` : null}
        <span class="sub">${gm ? 'Ziehe Karten zwischen den Spalten. Freigegebene Quests erscheinen im Quest-Log der Spieler.' : 'Euer Quest-Log.'}</span></div>
      ${!list ? html`<div class="empty"><span class="spinner" /></div>` : html`<div class="kanban">
        ${COLUMNS.map((c) => html`<div class="kanban-col" onDragOver=${(e) => gm && e.preventDefault()} onDrop=${(e) => { e.preventDefault(); if (drag) move(drag, c.id); setDrag(null); }}>
          <h4><${Icon} name=${c.icon} size=${14} />${c.label} <span class="faint">${list.filter((q) => (q.status || 'open') === c.id).length}</span></h4>
          ${sortBy(list.filter((q) => (q.status || 'open') === c.id), (q) => q.updatedAt || 0, -1).map((q) => html`<div class="quest-card" key=${q.id} draggable=${gm} onDragStart=${() => setDrag(q.id)} onClick=${() => (gm ? editQuest(q) : openModal(() => html`<div class="modal-body"><${MarkdownView} src=${`${q.giver ? `**Auftraggeber:** ${q.giver}\n\n` : ''}${q.description || ''}${q.reward ? `\n\n**Belohnung:** ${q.reward}` : ''}`} /></div>`, { title: q.title, icon: 'list-checks' }))}>
            <div class="t">${q.title}</div>
            ${q.giver || q.reward ? html`<div class="tiny faint">${[q.giver && q.giver.replace(/\[\[|\]\]/g, ''), q.reward].filter(Boolean).join(' · ')}</div>` : null}
            ${gm ? html`<div class="row" style="margin-top:6px"><span class=${`badge ${q.visibility === 'players' ? 'players' : 'gm'}`}>${q.visibility === 'players' ? 'sichtbar' : 'SL'}</span></div>` : null}
          </div>`)}
        </div>`)}
      </div>`}
    </div>
  <//>`;
}

// ───────────────────────── Mitspieler & Einladungen ─────────────────────────
function inviteLink(code) {
  const base = `${location.origin}${location.pathname}`;
  const cfg = getCloudConfig();
  const fb = !hasBakedCloudConfig() && cfg ? `?fb=${encodeB64Url(cfg)}` : '';
  return `${base}#/join/${code}${fb}`;
}

export function MembersView({ tabId }) {
  const mode = useStore(app, (s) => s.mode);
  const campaign = useStore(app, (s) => s.campaign);
  const members = useStore(vault, (s) => s.members);
  const [inv, setInv] = useState(null);
  const [chars, setChars] = useState({});
  useEffect(() => {
    if (mode !== 'cloud') return;
    getInvites().then(setInv).catch((e) => toast(`Einladungen: ${e.message}`, 'error'));
    loadParty().then((p) => setChars(Object.fromEntries(p.map((x) => [x.owner, x.char]))));
  }, [mode, campaign?.id]);

  if (mode !== 'cloud') {
    return html`<${ViewFrame} tabId=${tabId} title="Mitspieler & Einladungen"><div class="page narrow">
      <${Empty} icon="cloud-off" title="Offline-Modus: keine Mitspieler" action=${html`<${Btn} kind="primary" icon="settings" onClick=${() => openView('settings', { section: 'konto' })}>Konto<//>`}>
        Im Offline-Modus liegt alles nur auf diesem Gerät. Beende ihn unter Konto und melde dich an – dann können Mitspieler per Code beitreten.
      <//></div><//>`;
  }
  const share = async (role) => {
    const code = inv?.[role];
    const link = inviteLink(code);
    const r = await shareText({ title: `Einladung: ${campaign?.name}`, text: `Tritt meiner D&D-Kampagne „${campaign?.name}“ bei${role === 'gm' ? ' (als Co-Spielleitung)' : ''}: Link öffnen, Namen + Geheimwort wählen. Code: ${code}`, url: link });
    if (r === 'copied') toast('Einladung kopiert', 'success');
  };
  const renew = async (role) => {
    if (!(await confirmDialog('Neuen Code erzeugen? Der alte Code funktioniert danach nicht mehr (bereits Beigetretene bleiben).', { ok: 'Erneuern' }))) return;
    const code = await renewInvite(role);
    setInv({ ...inv, [role]: code });
  };
  const list = sortBy(Object.values(members), (m) => (m.role === 'gm' ? 0 : 1));
  return html`<${ViewFrame} tabId=${tabId} title="Mitspieler & Einladungen">
    <div class="page narrow stack lg">
      <div class="page-head"><h1><${Icon} name="user-plus" size=${24} />Mitspieler</h1><span class="sub">Keine E-Mail nötig: Mitspieler öffnen den Link, wählen Namen + Geheimwort und sind drin. Sie sehen nur, was du freigibst.</span></div>
      <div class="grid two">
        ${[['player', 'Spieler einladen', 'users'], ['gm', 'Co-Spielleitung einladen', 'crown']].map(([role, label, icon]) => html`<div class="card stack">
          <div class="card-head" style="margin:0"><h3><${Icon} name=${icon} size=${18} />${label}</h3></div>
          ${inv ? html`<div class="invite-code">${inv[role]}</div>
            <div class="small muted" style="word-break:break-all">${inviteLink(inv[role])}</div>
            <div class="btn-row"><${Btn} kind="primary" icon="share" onClick=${() => share(role)}>Teilen<//><${Btn} icon="copy" onClick=${() => { copyText(inviteLink(inv[role])); toast('Link kopiert'); }}>Link kopieren<//><${IconBtn} icon="refresh" title="Code erneuern" onClick=${() => renew(role)} /></div>
            ${role === 'gm' ? html`<div class="tiny faint">Co-SL sehen alle Geheimnisse und können alles bearbeiten.</div>` : null}` : html`<div class="empty"><span class="spinner" /></div>`}
        </div>`)}
      </div>
      <div class="card">
        <div class="card-head"><h3><${Icon} name="users" size=${18} />Am Tisch (${list.length})</h3></div>
        <div class="list">${list.map((m) => html`<div class="list-item">
          <${Avatar} name=${m.name} size="sm" />
          <span class="title"><b>${m.name}</b>${chars[m.uid] ? html` <span class="small muted">spielt ${chars[m.uid].name}</span>` : m.role === 'player' ? html` <span class="small faint">– noch kein Charakter verknüpft</span>` : null}</span>
          <span class=${`badge ${m.role === 'gm' ? 'gm' : 'players'}`}>${m.role === 'gm' ? 'Spielleitung' : 'Spieler'}</span>
          ${m.uid !== myUid() ? html`
            <${IconBtn} icon=${m.role === 'gm' ? 'user' : 'crown'} title=${m.role === 'gm' ? 'Zum Spieler machen' : 'Zur Co-SL machen'} onClick=${async () => { if (await confirmDialog(`${m.name} ${m.role === 'gm' ? 'zum Spieler' : 'zur Co-Spielleitung'} machen?`)) setMemberField(m.uid, { role: m.role === 'gm' ? 'player' : 'gm' }); }} />
            <${IconBtn} icon="log-out" class="danger" title="Entfernen" onClick=${async () => { if (await confirmDialog(`${m.name} aus der Kampagne entfernen? (Der Charakter bleibt beim Spieler.)`, { danger: true, ok: 'Entfernen' })) removeMember(m.uid); }} />` : html`<span class="small faint">du</span>`}
        </div>`)}</div>
      </div>
    </div>
  <//>`;
}

