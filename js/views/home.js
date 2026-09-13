// Startseite (Dashboard), Willkommen/Onboarding, Kampagnen-Verwaltung und -Wechsel.
import { html, useState, useMemo, useEffect } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import {
  app, vault, createCampaign, openCampaign, deleteCampaign, leaveCampaign, updateCampaign, joinCampaign,
  importNotes, addFolders, getIndex, signOut, myUid,
} from '../core/app.js';
import { openView, openNote } from '../core/workspace.js';
import { settings, updateSettings } from '../core/settings.js';
import { anyAIReady } from '../core/ai.js';
import { Icon, Btn, IconBtn, Field, openModal, confirmDialog, promptDialog, toast, openMenu, Empty } from '../ui/components.js';
import { ViewFrame } from '../ui/frame.js';
import { useCol, useVisibleCol } from '../core/hooks.js';
import { fmtRelative, fmtDate, sortBy } from '../lib/util.js';
import { SAMPLE_CAMPAIGN } from '../data/templates.js';
import { newNoteQuick } from '../ui/palette.js';

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

// ───────────────────────── Willkommen (noch keine Kampagne) ─────────────────────────
export function Welcome() {
  const user = useStore(app, (s) => s.user);
  const mode = useStore(app, (s) => s.mode);
  const campaigns = useStore(app, (s) => s.campaigns);
  const [busy, setBusy] = useState('');
  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const importObsidian = () => run('import', async () => {
    const cid = await createCampaign({ name: 'Meine Welt', description: 'Aus Obsidian importiert' });
    await openCampaign(cid);
    setTimeout(() => openView('import'), 50);
  });
  return html`<div class="auth-screen" style="place-items:start center">
    <div class="stack lg" style="width:min(820px,100%);padding:4vh 0 40px">
      <div class="hero">
        <div class="row nowrap" style="gap:16px">
          <img src="icons/icon.svg" width="64" height="64" alt="" />
          <div><h1>Willkommen, ${user?.name}!</h1><p>Deine Werkstatt für D&D 5e: Codex im Obsidian-Stil, KI-Weltenschmiede, Encounter mit Statblocks, Karten und ein Online-Spieltisch.</p></div>
        </div>
      </div>
      ${campaigns.length ? html`<div class="card"><div class="card-head"><h3><${Icon} name="castle" size=${18} />Deine Kampagnen</h3></div>
        <div class="list">${campaigns.map((c) => html`<div class="list-item" onClick=${() => openCampaign(c.id)}><${Icon} name=${c.role === 'gm' ? 'crown' : 'user'} size=${16} /><span class="title">${c.name}</span><span class="meta">${c.role === 'gm' ? 'Spielleitung' : 'Spieler'}</span></div>`)}</div></div>` : null}
      <div class="grid two">
        <div class="card stack">
          <h3 style="margin:0" class="row"><${Icon} name="plus" />Neue Kampagne</h3>
          <p class="muted small" style="margin:0">Starte mit einem leeren Codex – du bist die Spielleitung.</p>
          <${Btn} kind="primary" icon="castle" onClick=${newCampaignDialog}>Kampagne anlegen<//>
        </div>
        <div class="card stack">
          <h3 style="margin:0" class="row"><${Icon} name="upload" />Obsidian-Vault importieren</h3>
          <p class="muted small" style="margin:0">ZIP oder Ordner deines Vaults wählen – Ordner, [[Links]], Bilder und Eigenschaften bleiben erhalten.</p>
          <${Btn} icon="folder-open" loading=${busy === 'import'} onClick=${importObsidian}>Vault importieren<//>
        </div>
        <div class="card stack">
          <h3 style="margin:0" class="row"><${Icon} name="sparkles" />Beispielkampagne</h3>
          <p class="muted small" style="margin:0">„Die Nebelküste“ – ein Dorf, NPCs, eine Quest, ein Statblock. Ideal zum Ausprobieren.</p>
          <${Btn} icon="book-open" loading=${busy === 'sample'} onClick=${() => run('sample', loadSampleCampaign)}>Beispiel laden<//>
        </div>
        ${mode === 'cloud'
          ? html`<div class="card stack">
              <h3 style="margin:0" class="row"><${Icon} name="user-plus" />Als Spieler beitreten</h3>
              <p class="muted small" style="margin:0">Du hast einen Einladungscode von deiner Spielleitung?</p>
              <${Btn} icon="log-in" onClick=${joinDialog}>Code eingeben<//>
            </div>`
          : html`<div class="card stack">
              <h3 style="margin:0" class="row"><${Icon} name="cloud" />Sync & Online-Spiel</h3>
              <p class="muted small" style="margin:0">Aktuell speichert die App nur auf diesem Gerät. Mit Firebase (kostenlos) synchronisieren alle deine Geräte und Mitspieler können beitreten.</p>
              <${Btn} icon="settings" onClick=${openSettingsModal}>Einrichten<//>
            </div>`}
      </div>
      <div class="row center small faint" style="justify-content:center">
        <a href="#" onClick=${(e) => { e.preventDefault(); openSettingsModal(); }}>Einstellungen</a>
        ${mode === 'cloud' ? html`<span>·</span><a href="#" onClick=${(e) => { e.preventDefault(); signOut(); }}>Abmelden</a>` : null}
      </div>
    </div>
  </div>`;
}

export function openSettingsModal() {
  openModal(() => {
    const [Comp, setComp] = useState(null);
    useEffect(() => { import('./settings.js').then((m) => setComp(() => m.SettingsPanel)); }, []);
    return html`<div class="modal-body">${Comp ? html`<${Comp} />` : html`<div class="empty"><span class="spinner" /></div>`}</div>`;
  }, { title: 'Einstellungen', icon: 'settings', size: 'xl' });
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
  const mode = useStore(app, (s) => s.mode);
  const ai = useStore(settings, () => anyAIReady());
  const members = useStore(vault, (s) => Object.keys(s.members).length);
  const notes = useStore(vault, (s) => Object.keys(s.notes).length);
  const dismissed = useStore(settings, (s) => s.onboarded);
  const steps = [
    { done: ai, label: 'KI verbinden', sub: 'Gemini, Claude, OpenAI … – Schlüssel eintragen', go: () => openView('settings', { section: 'ai' }) },
    { done: notes > 3, label: 'Welt füllen', sub: 'Obsidian importieren oder erste Notizen anlegen', go: () => openView('import') },
    { done: mode === 'cloud', label: 'Cloud einrichten', sub: 'Sync zwischen Handy, Tablet & PC', go: () => openView('settings', { section: 'cloud' }) },
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
            <span class="badge"><${Icon} name=${mode === 'cloud' ? 'cloud' : 'save'} size=${12} />${mode === 'cloud' ? 'Cloud' : 'Lokal'}</span>
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
        <${QuickTile} icon="map" label="Karten" sub="Weltkarte & Battlemaps" onClick=${() => openView('maps')} />
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
