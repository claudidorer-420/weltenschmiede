// Übersicht nach der Anmeldung (Lobby), Kampagnen-Startseite (Dashboard), Kampagnen verwalten/wechseln.
import { html, useState, useMemo, useEffect } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import {
  app, vault, createCampaign, openCampaign, deleteCampaign, leaveCampaign, updateCampaign, joinCampaign,
  importNotes, addFolders, getIndex, myUid, enterLobby,
} from '../core/app.js';
import { openView, openNote } from '../core/workspace.js';
import { settings, updateSettings } from '../core/settings.js';
import { anyAIReady } from '../core/ai.js';
import { Icon, Btn, IconBtn, Field, Avatar, openModal, confirmDialog, promptDialog, toast, openMenu } from '../ui/components.js';
import { ViewFrame } from '../ui/frame.js';
import { useCol, useVisibleCol } from '../core/hooks.js';
import { fmtRelative, fmtDate, sortBy, colorFromString, initials } from '../lib/util.js';
import { SAMPLE_CAMPAIGN } from '../data/templates.js';
import { newNoteQuick } from '../ui/palette.js';
import { accountMenu, openSettings } from '../ui/account.js';

// ───────────────────────── Kampagnen-Aktionen ─────────────────────────
export async function seedSample() {
  await addFolders(SAMPLE_CAMPAIGN.folders);
  await importNotes(SAMPLE_CAMPAIGN.notes);
}

export async function loadSampleCampaign() {
  const cid = await createCampaign({ name: 'Beispiel: Die Nebelküste', description: 'Eine kleine Beispielwelt, um alle Funktionen auszuprobieren.' });
  await openCampaign(cid);
  await seedSample();
  toast('Beispielkampagne geladen', 'success');
}

function NewCampaignForm({ close }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [sample, setSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const cid = await createCampaign({ name: name.trim(), description: desc.trim() });
      await openCampaign(cid);
      if (sample) await seedSample();
      toast(`Kampagne „${name.trim()}“ angelegt`, 'success');
      close(cid);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };
  return html`<form onSubmit=${submit}>
    <div class="modal-body stack">
      <${Field} label="Name"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="z. B. Reiche von Arkonis" autoFocus /><//>
      <${Field} label="Kurzbeschreibung (optional)"><textarea class="textarea" value=${desc} onInput=${(e) => setDesc(e.target.value)} placeholder="Worum geht es? Ton, Setting, Gruppe …" /><//>
      <label class="check"><input type="checkbox" checked=${sample} onChange=${(e) => setSample(e.target.checked)} /> Mit Beispielnotizen starten</label>
    </div>
    <div class="modal-foot"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" type="submit" loading=${busy} icon="plus">Anlegen<//></div>
  </form>`;
}

export function newCampaignDialog() {
  return openModal(({ close }) => html`<${NewCampaignForm} close=${close} />`, { title: 'Neue Kampagne', icon: 'castle' });
}

export async function joinDialog() {
  const code = await promptDialog('Einladungscode', '', { title: 'Kampagne beitreten', placeholder: 'z. B. K7QX2M', ok: 'Beitreten', hint: 'Den Code bekommst du von deiner Spielleitung (oder öffne einfach den Einladungslink).' });
  if (!code) return;
  try {
    const cid = await joinCampaign(code);
    await openCampaign(cid);
    toast('Kampagne beigetreten!', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

export function campaignMenu(e) {
  const { campaigns, cid, mode } = app.get();
  openMenu(e, [
    { label: 'Übersicht: alle Kampagnen', icon: 'home', onClick: enterLobby },
    { divider: true },
    { header: true, label: 'Kampagnen' },
    ...campaigns.map((c) => ({
      label: c.name, icon: c.id === cid ? 'check' : c.role === 'gm' ? 'crown' : 'user', hint: c.role === 'gm' ? 'SL' : 'Spieler',
      onClick: () => c.id !== cid && openCampaign(c.id),
    })),
    { divider: true },
    { label: 'Neue Kampagne …', icon: 'plus', onClick: newCampaignDialog },
    mode === 'cloud' ? { label: 'Mit Code beitreten …', icon: 'user-plus', onClick: joinDialog } : null,
    { label: 'Kampagnen verwalten', icon: 'settings', onClick: () => openView('campaigns') },
  ]);
}

// ───────────────────────── Übersicht nach der Anmeldung ─────────────────────────
const lastOpened = (id) => Number(localStorage.getItem(`ws.lastOpened.${id}`) || 0);

function CampaignCard({ c, busy, onOpen }) {
  const t = lastOpened(c.id);
  return html`<button type="button" class="camp-card" onClick=${onOpen}>
    <span class="camp-emblem" style=${{ background: colorFromString(c.name || '?') }}>${initials(c.name || '?')}</span>
    <span class="camp-body">
      <b>${c.name}</b>
      <span class="small muted">${c.role === 'gm' ? 'Spielleitung' : 'Spieler'}${t ? ` · zuletzt ${fmtRelative(t)}` : ''}</span>
    </span>
    ${busy ? html`<span class="spinner sm" />` : html`<${Icon} name="chevron-right" size=${18} class="faint" />`}
  </button>`;
}

function CharMini({ c, onOpen }) {
  return html`<button type="button" class="camp-card" onClick=${onOpen}>
    ${c.portrait ? html`<span class="avatar lg"><img src=${c.portrait} alt="" /></span>` : html`<${Avatar} name=${c.name} size="lg" color=${c.color} />`}
    <span class="camp-body"><b>${c.name}</b><span class="small muted">${[c.species, c.cls, c.level ? `Stufe ${c.level}` : ''].filter(Boolean).join(' · ')}</span></span>
    <${Icon} name="chevron-right" size=${18} class="faint" />
  </button>`;
}

function LobbyTop() {
  const user = useStore(app, (s) => s.user);
  const mode = useStore(app, (s) => s.mode);
  const gm = (user?.kind || 'gm') === 'gm';
  return html`<header class="lobby-top">
    <div class="lobby-brand"><img src="icons/icon.svg" width="30" height="30" alt="" /><span>Weltenschmiede</span></div>
    <span class="grow"></span>
    ${mode !== 'cloud' ? html`<span class="badge warn"><${Icon} name="cloud-off" size=${12} />Offline-Modus</span>` : null}
    <button type="button" class="account-chip" onClick=${accountMenu} title="Konto, Einstellungen, Abmelden">
      <${Avatar} name=${user?.name} size="sm" />
      <span class="nm">${user?.name}<small>${gm ? 'Spielleitung' : 'Spieler'}</small></span>
      <${Icon} name="chevron-down" size=${15} class="faint" />
    </button>
  </header>`;
}

function JoinCard({ busy, onJoin, compact }) {
  const [code, setCode] = useState('');
  return html`<div class=${`card stack join-card${compact ? '' : ' accent-left'}`}>
    <h3 class="row" style="margin:0"><${Icon} name="user-plus" />${compact ? 'Als Spieler beitreten' : 'Einer Kampagne beitreten'}</h3>
    <div class="small muted" style="margin:0">Den Code (oder Einladungslink) bekommst du von deiner Spielleitung.</div>
    <form class="row nowrap" onSubmit=${(e) => { e.preventDefault(); if (code.trim()) onJoin(code.trim()); }}>
      <input class="input grow" value=${code} onInput=${(e) => setCode(e.target.value.toUpperCase())} placeholder="z. B. K7QX2M" maxlength="12" autocomplete="off" spellcheck=${false} />
      <${Btn} kind="primary" type="submit" icon="log-in" loading=${busy} disabled=${!code.trim()}>Beitreten<//>
    </form>
  </div>`;
}

export function Lobby() {
  const user = useStore(app, (s) => s.user);
  const mode = useStore(app, (s) => s.mode);
  const campaigns = useStore(app, (s) => s.campaigns);
  const aiReady = useStore(settings, () => anyAIReady());
  const gm = (user?.kind || 'gm') === 'gm';
  const chars = useCol(user && !gm ? `users/${user.uid}/characters` : null);
  const [busy, setBusy] = useState('');
  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast(e.message || String(e), 'error'); } finally { setBusy(''); }
  };
  const sorted = [...campaigns].sort((a, b) => lastOpened(b.id) - lastOpened(a.id) || String(a.name).localeCompare(String(b.name), 'de'));
  const leading = sorted.filter((c) => c.role === 'gm');
  const playing = sorted.filter((c) => c.role !== 'gm');
  const last = sorted[0] && lastOpened(sorted[0].id) ? sorted[0] : null;
  const open = (c) => run(`c:${c.id}`, () => openCampaign(c.id));
  const join = (code) => run('join', async () => {
    const cid = await joinCampaign(code);
    await openCampaign(cid);
    toast('Kampagne beigetreten!', 'success');
  });
  const importObsidian = () => run('import', async () => {
    const cid = await createCampaign({ name: 'Meine Welt', description: 'Aus Obsidian importiert' });
    await openCampaign(cid);
    setTimeout(() => openView('import'), 50);
  });
  const newChar = () => import('./characters.js').then((m) => m.openCharacterWizard());
  const openChar = (c) => import('./characters.js').then((m) => m.openCharacter(c));

  const intro = gm
    ? (campaigns.length ? 'Wähle eine Kampagne oder beginne eine neue Welt.' : 'Lege deine erste Kampagne an – oder importiere deinen Obsidian-Vault.')
    : (campaigns.length ? 'Deine Kampagnen und Charaktere auf einen Blick.' : 'Tritt mit dem Code deiner Spielleitung einer Kampagne bei.');

  return html`<div class="lobby">
    <${LobbyTop} />
    <main class="lobby-main">
      <section class="lobby-hero">
        <div class="grow">
          <div class="lobby-kicker">${gm ? 'Spielleitung' : 'Spieler'}</div>
          <h1>Willkommen${campaigns.length ? ' zurück' : ''}, ${user?.name}!</h1>
          <p>${intro}</p>
        </div>
        ${last ? html`<${Btn} kind="primary" size="lg" icon="play" loading=${busy === `c:${last.id}`} onClick=${() => open(last)}>Weiter: ${last.name}<//>` : null}
      </section>

      ${gm && !aiReady ? html`<div class="card row lobby-hint">
        <${Icon} name="sparkles" size=${22} class="accent-text" />
        <div class="grow"><b>KI noch nicht eingerichtet</b><div class="small muted">Für Weltenschmiede, NPC-Schmiede und Encounter brauchst du einen API-Schlüssel (z. B. Google Gemini mit Gratis-Kontingent). Er gehört nur zu deinem Konto – Spieler sehen ihn nie.</div></div>
        <${Btn} icon="settings" onClick=${() => openSettings('ai')}>Einrichten<//>
      </div>` : null}

      ${gm ? html`
        <div class="section-title"><${Icon} name="crown" size=${14} />Deine Kampagnen</div>
        <div class="camp-grid">
          ${leading.map((c) => html`<${CampaignCard} key=${c.id} c=${c} busy=${busy === `c:${c.id}`} onOpen=${() => open(c)} />`)}
          <button type="button" class="camp-card add" onClick=${newCampaignDialog}>
            <span class="camp-emblem add"><${Icon} name="plus" size=${22} /></span>
            <span class="camp-body"><b>Neue Kampagne</b><span class="small muted">Leerer Codex – du bist die Spielleitung</span></span>
          </button>
        </div>
        ${playing.length ? html`<div class="section-title"><${Icon} name="user" size=${14} />Als Spieler dabei</div>
          <div class="camp-grid">${playing.map((c) => html`<${CampaignCard} key=${c.id} c=${c} busy=${busy === `c:${c.id}`} onOpen=${() => open(c)} />`)}</div>` : null}
        <div class="section-title"><${Icon} name="zap" size=${14} />Schnellstart</div>
        <div class="grid three">
          <div class="card stack">
            <h3 class="row" style="margin:0"><${Icon} name="upload" />Obsidian-Vault</h3>
            <p class="muted small" style="margin:0">ZIP oder Ordner deines Vaults – Ordner, [[Links]], Bilder und Eigenschaften bleiben erhalten.</p>
            <${Btn} icon="folder-open" loading=${busy === 'import'} onClick=${importObsidian}>Vault importieren<//>
          </div>
          <div class="card stack">
            <h3 class="row" style="margin:0"><${Icon} name="book-open" />Beispielkampagne</h3>
            <p class="muted small" style="margin:0">„Die Nebelküste“ – Dorf, NPCs, Quest und Statblock zum Ausprobieren.</p>
            <${Btn} icon="book-open" loading=${busy === 'sample'} onClick=${() => run('sample', loadSampleCampaign)}>Beispiel laden<//>
          </div>
          ${mode === 'cloud' ? html`<${JoinCard} compact busy=${busy === 'join'} onJoin=${join} />` : null}
        </div>`
      : html`
        ${mode === 'cloud' ? html`<${JoinCard} busy=${busy === 'join'} onJoin=${join} />` : null}
        <div class="section-title"><${Icon} name="castle" size=${14} />Deine Kampagnen</div>
        ${sorted.length
          ? html`<div class="camp-grid">${sorted.map((c) => html`<${CampaignCard} key=${c.id} c=${c} busy=${busy === `c:${c.id}`} onOpen=${() => open(c)} />`)}</div>`
          : html`<div class="small faint">Noch keine Kampagne – gib oben den Einladungscode ein.</div>`}
        <div class="section-title"><${Icon} name="users" size=${14} />Deine Charaktere</div>
        <div class="camp-grid">
          ${(chars || []).map((c) => html`<${CharMini} key=${c.id} c=${c} onOpen=${() => openChar(c)} />`)}
          <button type="button" class="camp-card add" onClick=${newChar}>
            <span class="camp-emblem add"><${Icon} name="user-plus" size=${22} /></span>
            <span class="camp-body"><b>Neuer Charakter</b><span class="small muted">Schritt für Schritt nach den 5e-Regeln</span></span>
          </button>
        </div>`}
    </main>
  </div>`;
}

// ───────────────────────── Startseite einer Kampagne ─────────────────────────
function QuickTile({ icon, label, sub, onClick }) {
  return html`<button type="button" class="card click tile" style="text-align:left" onClick=${onClick}>
    <${Icon} name=${icon} size=${22} class="accent-text" />
    <b>${label}</b>
    ${sub ? html`<span class="small faint">${sub}</span>` : null}
  </button>`;
}

function SetupChecklist() {
  const ai = useStore(settings, () => anyAIReady());
  const members = useStore(vault, (s) => Object.keys(s.members).length);
  const notes = useStore(vault, (s) => Object.keys(s.notes).length);
  const dismissed = useStore(settings, (s) => s.onboarded);
  const steps = [
    { done: ai, label: 'KI verbinden', sub: 'Gemini, Claude, OpenAI … – Schlüssel eintragen', go: () => openView('settings', { section: 'ai' }) },
    { done: notes > 3, label: 'Welt füllen', sub: 'Obsidian importieren oder erste Notizen anlegen', go: () => openView('import') },
    { done: members > 1, label: 'Mitspieler einladen', sub: 'Code oder Link teilen', go: () => openView('members') },
  ];
  if (dismissed || steps.every((s) => s.done)) return null;
  return html`<div class="card accent-left">
    <div class="card-head"><h3><${Icon} name="list-checks" size=${18} />Erste Schritte</h3><span class="grow"></span><${IconBtn} icon="x" title="Ausblenden" onClick=${() => updateSettings({ onboarded: true })} /></div>
    <div class="list">${steps.map((s) => html`<div class="list-item" onClick=${s.go}>
      <${Icon} name=${s.done ? 'check-circle' : 'target'} size=${18} class=${s.done ? 'success-text' : 'faint'} />
      <span class="title"><b style=${s.done ? 'text-decoration:line-through;opacity:.6' : ''}>${s.label}</b> <span class="small faint">– ${s.sub}</span></span>
      <${Icon} name="chevron-right" size=${16} class="faint" />
    </div>`)}</div>
  </div>`;
}

export function HomeView({ tabId }) {
  const campaign = useStore(app, (s) => s.campaign);
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const mode = useStore(app, (s) => s.mode);
  const cid = useStore(app, (s) => s.cid);
  const v = useStore(vault, (s) => s.version);
  const recent = useMemo(() => sortBy(getIndex().notes, (n) => n.updatedAt || 0, -1).slice(0, 8), [v]);
  const sessions = useVisibleCol('sessions');
  const quests = useVisibleCol('quests');
  const myChars = useCol(myUid() ? `users/${myUid()}/characters` : null);
  const handouts = useVisibleCol('handouts');
  const next = sessions ? sortBy(sessions.filter((s) => s.status !== 'done'), (s) => s.date || '9999')[0] : null;
  const lastRecap = sessions ? sortBy(sessions.filter((s) => s.recap), (s) => s.date || '', -1)[0] : null;
  const activeQuests = quests ? quests.filter((q) => q.status === 'active' || q.status === 'open').slice(0, 6) : null;
  const chars = (myChars || []).filter((c) => c.campaignId === cid);

  return html`<${ViewFrame} tabId=${tabId} title="Start">
    <div class="page stack lg">
      <div class="hero">
        <div class="row">
          <div class="grow">
            <h1>${campaign?.name || 'Kampagne'}</h1>
            <p>${campaign?.description || (gm ? 'Deine Kampagnen-Werkstatt. Beschreibung in den Kampagnen-Einstellungen ergänzen.' : 'Willkommen am Spieltisch!')}</p>
          </div>
          <div class="row">
            <span class=${`badge ${gm ? 'gm' : 'players'}`}><${Icon} name=${gm ? 'crown' : 'user'} size=${12} />${gm ? 'Spielleitung' : 'Spieler'}</span>
            <span class="badge"><${Icon} name=${mode === 'cloud' ? 'cloud' : 'save'} size=${12} />${mode === 'cloud' ? 'Cloud' : 'Offline'}</span>
            <${Btn} size="sm" kind="ghost" icon="home" onClick=${enterLobby}>Alle Kampagnen<//>
          </div>
        </div>
      </div>

      ${gm ? html`<${SetupChecklist} />` : null}

      ${gm ? html`<div class="grid four">
        <${QuickTile} icon="file-plus" label="Neue Notiz" sub="Strg+N" onClick=${() => newNoteQuick()} />
        <${QuickTile} icon="anvil" label="Weltenschmiede" sub="Orte, Läden, Reiche per KI" onClick=${() => openView('forge')} />
        <${QuickTile} icon="mask" label="NPC-Schmiede" sub="Figuren mit Stimme & Geheimnis" onClick=${() => openView('npc')} />
        <${QuickTile} icon="swords" label="Encounter" sub="Statblocks + Schwierigkeit" onClick=${() => openView('encounter')} />
        <${QuickTile} icon="sword" label="Kampf-Tracker" sub="Initiative, TP, Zustände" onClick=${() => openView('combat')} />
        <${QuickTile} icon="map" label="Karten" sub="Weltkarte & Dungeon-Editor" onClick=${() => openView('maps')} />
        <${QuickTile} icon="message" label="Spieltisch" sub="Chat, Würfel, Play-by-Post" onClick=${() => openView('table')} />
        <${QuickTile} icon="graph" label="Graph" sub="Alle Verbindungen" onClick=${() => openView('graph')} />
      </div>` : html`<div class="grid four">
        <${QuickTile} icon="message" label="Spieltisch" sub="Chat & Züge" onClick=${() => openView('table')} />
        <${QuickTile} icon="user" label="Mein Charakter" sub="Bogen & Würfe" onClick=${() => openView('characters')} />
        <${QuickTile} icon="feather" label="Tagebuch" sub="Deine Notizen – bleiben erhalten" onClick=${() => openView('journal')} />
        <${QuickTile} icon="d20" label="Würfel" onClick=${() => openView('dice')} />
      </div>`}

      <div class="grid two">
        <div class="card">
          <div class="card-head"><h3><${Icon} name="clock" size=${18} />Zuletzt bearbeitet</h3></div>
          ${recent.length ? html`<div class="list">${recent.map((n) => html`<div class="list-item" onClick=${() => openNote(n.id)}><${Icon} name="file-text" size=${15} /><span class="title">${n.title}</span><span class="meta">${fmtRelative(n.updatedAt)}</span></div>`)}</div>`
            : html`<div class="faint small">${gm ? 'Noch keine Notizen.' : 'Noch nichts freigegeben.'}</div>`}
        </div>
        <div class="stack">
          ${!gm && chars.length ? html`<div class="card">
            <div class="card-head"><h3><${Icon} name="user" size=${18} />Mein Charakter</h3></div>
            ${chars.map((c) => html`<div class="list-item" onClick=${() => openView('character', { id: c.id, owner: myUid(), title: c.name })}><b class="title">${c.name}</b><span class="meta">TP ${c.hp ?? '?'} / ${c.maxHp ?? '?'} · RK ${c.ac ?? '?'}</span></div>`)}
          </div>` : null}
          <div class="card">
            <div class="card-head"><h3><${Icon} name="calendar" size=${18} />Nächste Sitzung</h3><span class="grow"></span><${Btn} size="sm" kind="ghost" onClick=${() => openView('sessions')}>Alle<//></div>
            ${next ? html`<div class="list-item" onClick=${() => openView('session', { id: next.id, title: next.title })}><b class="title">${next.number ? `#${next.number} ` : ''}${next.title || 'Sitzung'}</b><span class="meta">${next.date ? fmtDate(new Date(next.date).getTime()) : 'ohne Datum'}</span></div>`
              : html`<div class="faint small">${gm ? 'Keine geplant.' : 'Noch kein Termin.'}</div>`}
            ${lastRecap ? html`<div class="small muted" style="margin-top:8px"><b>Zuletzt:</b> ${String(lastRecap.recap).replace(/[#*>[\]]/g, '').slice(0, 220)}…</div>` : null}
          </div>
          <div class="card">
            <div class="card-head"><h3><${Icon} name="list-checks" size=${18} />Aktive Quests</h3><span class="grow"></span><${Btn} size="sm" kind="ghost" onClick=${() => openView('quests')}>Alle<//></div>
            ${activeQuests?.length ? html`<div class="list">${activeQuests.map((q) => html`<div class="list-item" onClick=${() => openView('quests')}><${Icon} name="target" size=${15} /><span class="title">${q.title}</span></div>`)}</div>` : html`<div class="faint small">Keine offenen Quests.</div>`}
          </div>
          ${handouts?.length ? html`<div class="card">
            <div class="card-head"><h3><${Icon} name="scroll" size=${18} />Handouts</h3><span class="grow"></span><${Btn} size="sm" kind="ghost" onClick=${() => openView('handouts')}>Alle<//></div>
            <div class="list">${sortBy(handouts, (h) => h.ts || 0, -1).slice(0, 4).map((h) => html`<div class="list-item" onClick=${() => openView('handouts')}><${Icon} name="scroll" size=${15} /><span class="title">${h.title}</span><span class="meta">${fmtRelative(h.ts)}</span></div>`)}</div>
          </div>` : null}
        </div>
      </div>
    </div>
  <//>`;
}

// ───────────────────────── Kampagnen verwalten ─────────────────────────
export function CampaignsView({ tabId }) {
  const campaigns = useStore(app, (s) => s.campaigns);
  const cid = useStore(app, (s) => s.cid);
  const campaign = useStore(app, (s) => s.campaign);
  const user = useStore(app, (s) => s.user);
  const [desc, setDesc] = useState(campaign?.description || '');
  useEffect(() => setDesc(campaign?.description || ''), [campaign?.id]);
  const isOwner = campaign?.ownerUid === user?.uid;

  const rename = async () => {
    const n = await promptDialog('Neuer Name', campaign?.name, { title: 'Kampagne umbenennen' });
    if (n) await updateCampaign({ name: n.trim() });
  };
  const remove = async (c) => {
    if (!(await confirmDialog(`„${c.name}“ mit allen Notizen, Karten und Chats endgültig löschen? Das kann nicht rückgängig gemacht werden.`, { title: 'Kampagne löschen', danger: true, ok: 'Endgültig löschen' }))) return;
    const typed = await promptDialog('Zur Sicherheit den Namen eintippen', '', { title: 'Kampagne löschen', ok: 'Löschen', placeholder: c.name });
    if (typed?.trim() !== c.name) return toast('Name stimmt nicht – nichts gelöscht.', 'error');
    await openCampaign(c.id);
    await deleteCampaign(c.id);
    toast('Kampagne gelöscht', 'success');
  };
  const leave = async (c) => {
    if (await confirmDialog(`Kampagne „${c.name}“ verlassen? Dein Charakter und dein Tagebuch bleiben erhalten.`, { ok: 'Verlassen', danger: true })) await leaveCampaign(c.id);
  };

  return html`<${ViewFrame} tabId=${tabId} title="Kampagnen">
    <div class="page narrow stack lg">
      <div class="page-head"><h1><${Icon} name="castle" size=${24} />Kampagnen</h1><span class="grow"></span>
        <${Btn} icon="plus" kind="primary" onClick=${newCampaignDialog}>Neue Kampagne<//>
        ${app.get().mode === 'cloud' ? html`<${Btn} icon="user-plus" onClick=${joinDialog}>Beitreten<//>` : null}
      </div>
      ${campaign && app.get().role === 'gm' ? html`<div class="card stack">
        <div class="card-head"><h3>Aktuelle Kampagne: ${campaign.name}</h3><span class="grow"></span><${Btn} size="sm" icon="edit-square" onClick=${rename}>Umbenennen<//></div>
        <${Field} label="Beschreibung" hint="Erscheint auf der Startseite und dient der KI als Grundkontext.">
          <textarea class="textarea" value=${desc} onInput=${(e) => setDesc(e.target.value)} onBlur=${() => desc !== (campaign.description || '') && updateCampaign({ description: desc })} />
        <//>
        <${Field} label="Welt-Kontext für die KI" hint="Kurzfassung deiner Welt (Ton, Götter, Reiche, Besonderheiten). Wird bei jeder KI-Generierung mitgeschickt.">
          <textarea class="textarea" value=${campaign.world || ''} onBlur=${(e) => e.target.value !== (campaign.world || '') && updateCampaign({ world: e.target.value })} placeholder="z. B. Die Reiche von Arkonis: Frostreich im Norden, Vulkanland im Osten … Magie ist selten und gefürchtet …" />
        <//>
      </div>` : null}
      <div class="card">
        <div class="list">
          ${campaigns.map((c) => html`<div class="list-item">
            <${Icon} name=${c.role === 'gm' ? 'crown' : 'user'} size=${16} />
            <span class="title" onClick=${() => openCampaign(c.id)}>${c.name} ${c.id === cid ? html`<span class="badge accent">aktiv</span>` : null}</span>
            <span class="meta">${c.role === 'gm' ? 'Spielleitung' : 'Spieler'}</span>
            ${c.id !== cid ? html`<${Btn} size="sm" onClick=${() => openCampaign(c.id)}>Öffnen<//>` : null}
            ${c.role === 'gm' && (c.id !== cid || isOwner) ? html`<${IconBtn} icon="trash" class="danger" title="Löschen" onClick=${() => remove(c)} />` : html`<${IconBtn} icon="log-out" title="Verlassen" onClick=${() => leave(c)} />`}
          </div>`)}
        </div>
      </div>
    </div>
  <//>`;
}
