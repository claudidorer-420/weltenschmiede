// Einstellungen: KI & Modelle (nur Spielleitung), Konto, Darstellung, Spiel, Daten, Über.
import { html, useState, useEffect } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, renameLocalProfile, refreshCampaigns, updateCampaign } from '../core/app.js';
import { settings, updateSettings } from '../core/settings.js';
import {
  PROVIDERS, TASKS, MODELS, modelsFor, recommendedRefs, resolveModel, modelLabel, providerReady, applyRecommendations, refreshModels,
  testProvider, usageStats,
} from '../core/ai.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, Btn, Field, Toggle, Segmented, Avatar, toast, confirmDialog, promptDialog } from '../ui/components.js';
import { changeSecretDialog, signOutDialog, switchKind } from '../ui/account.js';
import { localSummary, migrateLocalToCloud } from './importexport.js';

const ALL_SECTIONS = [
  { value: 'ai', label: 'KI & Modelle', icon: 'sparkles' },
  { value: 'konto', label: 'Konto', icon: 'user' },
  { value: 'look', label: 'Darstellung', icon: 'palette' },
  { value: 'game', label: 'Spiel', icon: 'd20' },
  { value: 'data', label: 'Daten', icon: 'archive', gm: true },
  { value: 'about', label: 'Über', icon: 'info' },
];

// ───────────────────────── KI ─────────────────────────
function ProviderCard({ id }) {
  const p = PROVIDERS[id];
  const cfg = useStore(settings, (s) => s.ai.providers[id] || {});
  const loaded = useStore(settings, (s) => s.ai.loaded?.[id]?.length || 0);
  const ready = providerReady(id);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState('');
  const set = (patch) => updateSettings({ ai: { providers: { [id]: patch } } });
  const test = async () => {
    setBusy('test');
    try { toast(`${p.short}: ${await testProvider(id)}`, 'success'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const load = async () => {
    setBusy('load');
    try { toast(`${(await refreshModels(id)).length} Modelle von ${p.short} geladen`, 'success'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  return html`<div class=${`provider-card stack sm${ready ? ' ready' : ''}`}>
    <div class="row"><b class="grow">${p.label}</b>${ready ? html`<span class="badge players"><${Icon} name="check" size=${12} />bereit</span>` : html`<span class="badge">nicht eingerichtet</span>`}</div>
    <div class="small muted">${p.keyHint}</div>
    ${id === 'custom' ? html`<div class="grid two" style="gap:8px">
      <${Field} label="Server-Adresse"><input class="input" value=${cfg.baseUrl || ''} onInput=${(e) => set({ baseUrl: e.target.value })} placeholder="http://localhost:11434/v1" /><//>
      <${Field} label="Modellname"><input class="input" list="ws-custom-models" value=${cfg.model || ''} onInput=${(e) => set({ model: e.target.value })} placeholder="z. B. llama3.1:8b" /><datalist id="ws-custom-models">${(settings.get().ai.loaded?.custom || []).map((m) => html`<option value=${m.id} />`)}</datalist><//>
    </div>` : null}
    <div class="input-group">
      <input class="input mono" type=${show ? 'text' : 'password'} value=${cfg.key || ''} autocomplete="off" spellcheck=${false} placeholder=${id === 'custom' ? 'API-Schlüssel (meist leer)' : 'API-Schlüssel einfügen'} onInput=${(e) => set({ key: e.target.value.trim() })} />
      <${Btn} kind="ghost" icon=${show ? 'eye-off' : 'eye'} title="Anzeigen" onClick=${() => setShow(!show)} />
    </div>
    <div class="btn-row">
      ${p.keyUrl ? html`<a class="btn sm ghost" href=${p.keyUrl} target="_blank" rel="noopener"><${Icon} name="external-link" size=${14} /><span>${id === 'custom' ? 'Ollama' : 'Schlüssel holen'}</span></a>` : null}
      <${Btn} size="sm" icon="check-circle" loading=${busy === 'test'} disabled=${!ready && id !== 'custom'} onClick=${test}>Testen<//>
      <${Btn} size="sm" icon="refresh" loading=${busy === 'load'} disabled=${!ready && id !== 'openrouter' && id !== 'custom'} onClick=${load}>Modelle laden${loaded ? ` (${loaded})` : ''}<//>
    </div>
  </div>`;
}

// Ein Modell für alles: wird in allen Generatoren vorausgewählt (pro Anfrage trotzdem umschaltbar)
function PreferredCard({ tasks }) {
  const ai = useStore(settings, (s) => s.ai);
  const text = modelsFor('world').filter((m) => m.ready);
  const img = modelsFor('image').filter((m) => m.ready);
  const own = tasks.filter((t) => !TASKS[t].image && ai.tasks?.[t]);
  const groups = (list) => Object.entries(list.reduce((acc, m) => ((acc[m.provider] ||= []).push(m), acc), {}));
  const opts = (list) => groups(list).map(([p, ms]) => html`<optgroup label=${PROVIDERS[p]?.label || p}>${ms.slice(0, 150).map((m) => html`<option value=${m.ref}>${m.label}${m.free ? ' (gratis)' : ''}</option>`)}</optgroup>`);
  const set = (patch) => updateSettings({ ai: patch });
  const useEverywhere = () => {
    set({ tasks: Object.fromEntries(own.map((t) => [t, ''])) });
    toast('Alle Aufgaben nutzen jetzt das bevorzugte Modell', 'success');
  };
  return html`<div class="card stack accent-left">
    <div class="card-head" style="margin:0"><h3><${Icon} name="star" size=${18} />Bevorzugtes Modell</h3></div>
    ${!text.length ? html`<div class="small muted">Trag oben einen Schlüssel ein – danach wählst du hier dein Lieblingsmodell, das überall vorausgewählt wird.</div>` : html`
      <div class="small muted">Wird in allen Generatoren vorausgewählt. Pro Anfrage kannst du trotzdem jederzeit über den Modell-Knopf wechseln.</div>
      <div class="grid two" style="gap:10px">
        <${Field} label="Für Texte (Weltenschmiede, NPCs, Encounter, Regeln …)">
          <select class="select" value=${ai.preferred || ''} onChange=${(e) => set({ preferred: e.target.value })}>
            <option value="">Automatisch – beste Empfehlung je Aufgabe</option>${opts(text)}
          </select><//>
        ${tasks.includes('image') ? html`<${Field} label="Für Bilder (Porträts, Karten, Szenen)">
          <select class="select" value=${ai.preferredImage || ''} disabled=${!img.length} onChange=${(e) => set({ preferredImage: e.target.value })}>
            <option value="">${img.length ? 'Automatisch – beste Empfehlung' : 'Kein Bildmodell verfügbar'}</option>${opts(img)}
          </select><//>` : null}
      </div>
      ${ai.preferred && own.length ? html`<div class="row small"><${Icon} name="info" size=${15} class="accent-text" />
        <span class="grow muted">${own.length === 1 ? 'Eine Aufgabe hat' : `${own.length} Aufgaben haben`} unten eine eigene Auswahl (${own.map((t) => TASKS[t].label).join(', ')}) und ${own.length === 1 ? 'nutzt' : 'nutzen'} deshalb nicht das bevorzugte Modell.</span>
        <${Btn} size="sm" icon="star" onClick=${useEverywhere}>Überall bevorzugtes Modell<//></div>` : null}`}
  </div>`;
}

function TaskRow({ task }) {
  const t = TASKS[task];
  const chosen = useStore(settings, (s) => s.ai.tasks?.[task] || '');
  const pref = useStore(settings, (s) => (t.image ? s.ai.preferredImage : s.ai.preferred) || '');
  useStore(settings, (s) => s.ai.providers);
  const recs = recommendedRefs(task);
  const models = modelsFor(task);
  const ready = models.filter((m) => m.ready).sort((a, b) => ((recs.indexOf(a.ref) + 1 || 99) - (recs.indexOf(b.ref) + 1 || 99)));
  const notReady = models.filter((m) => !m.ready && MODELS.some((x) => `${x.provider}:${x.id}` === m.ref));
  const sel = resolveModel(task);
  const label = (m) => `${recs[0] === m.ref ? '⭐ ' : recs.includes(m.ref) ? '☆ ' : ''}${m.label} – ${PROVIDERS[m.provider]?.short}${m.free ? ' (gratis)' : ''}`;
  return html`<div class="task-row">
    <div>
      <div class="row nowrap"><${Icon} name=${t.icon} size=${16} class="accent-text" /><b>${t.label}</b></div>
      <div class="small muted">${t.desc}</div>
      <div class="tiny faint" style="margin-top:3px">💡 ${t.why}</div>
      <div class="rec-list">${recs.slice(0, 4).map((r, i) => {
        const m = models.find((x) => x.ref === r);
        return m ? html`<span class=${`badge${i === 0 ? ' gold' : ''}`}>${i === 0 ? '⭐ ' : ''}${m.label}</span>` : null;
      })}</div>
    </div>
    <div class="stack sm">
      <select class="select" value=${chosen} onChange=${(e) => updateSettings({ ai: { tasks: { [task]: e.target.value } } })}>
        <option value="">${pref ? 'Automatisch → bevorzugtes Modell' : 'Automatisch (beste verfügbare Empfehlung)'}</option>
        ${ready.length ? html`<optgroup label="Verfügbar">${ready.slice(0, 80).map((m) => html`<option value=${m.ref}>${label(m)}</option>`)}</optgroup>` : null}
        ${notReady.length ? html`<optgroup label="Schlüssel fehlt">${notReady.map((m) => html`<option value=${m.ref} disabled>${label(m)}</option>`)}</optgroup>` : null}
      </select>
      <div class="tiny ${sel ? 'success-text' : 'danger-text'}">${sel ? `→ nutzt: ${modelLabel(sel)} (${PROVIDERS[sel.provider]?.short})` : 'Kein Modell verfügbar – Schlüssel eintragen oder Demo aktivieren.'}</div>
    </div>
  </div>`;
}

// Aufgaben, für die Spieler die KI nutzen (Regelfragen im Regelteil)
const PLAYER_TASKS = ['rules'];

function AISection() {
  const ai = useStore(settings, (s) => s.ai);
  const mode = useStore(app, (s) => s.mode);
  const gm = useStore(app, (s) => s.role === 'gm');
  const usage = usageStats();
  const tasks = Object.keys(TASKS).filter((t) => gm || PLAYER_TASKS.includes(t));
  return html`<div class="stack lg">
    <div class="callout callout-blue"><div class="callout-title"><${Icon} name="info" size=${16} />So funktioniert der KI-Zugang</div><div class="callout-content small" style="line-height:1.6">
      Du bringst deinen eigenen Schlüssel mit – die App schickt Anfragen direkt vom Browser an den Anbieter, ohne Umweg über einen Server. Du zahlst nur, was du nutzt.<br />
      <b>Günstiger Start:</b> Google Gemini (Flash-Modelle mit Gratis-Kontingent). <b>Beste Texte:</b> Claude Opus 5. <b>Viele Modelle mit einem Schlüssel:</b> OpenRouter.
    </div></div>
    <div class="card row nowrap" style="gap:12px">
      <${Icon} name="lock" size=${20} class="accent-text" />
      <div class="small muted" style="line-height:1.55">${mode === 'cloud'
        ? `Deine Schlüssel gehören nur zu deinem Konto: Sie liegen im privaten Bereich deines Kontos – nur du kannst sie lesen, ${gm ? 'deine Spieler' : 'weder die Spielleitung noch deine Mitspieler'} sehen sie nie. Sie stehen auf all deinen Geräten bereit und werden beim Abmelden von diesem Gerät entfernt; meldet sich jemand anderes an, sind sie weg.`
        : 'Offline-Modus: Die Schlüssel liegen nur auf diesem Gerät und gehören zum Offline-Profil.'}</div>
    </div>
    ${gm ? null : html`<div class="small muted">Als Spieler nutzt du die KI für Regelfragen (Regeln → „Regelfrage an die KI“). Die Anfragen laufen über deinen eigenen Schlüssel – die Spielleitung zahlt nichts dafür und sieht nichts davon.</div>`}
    <div class="grid two">${['gemini', 'anthropic', 'openai', 'openrouter'].map((id) => html`<${ProviderCard} key=${id} id=${id} />`)}</div>
    <${ProviderCard} id="custom" />
    <${PreferredCard} tasks=${tasks} />
    <${Toggle} checked=${ai.demo} onChange=${(v) => updateSettings({ ai: { demo: v } })} label="Demo-Modus (Beispieltexte ohne KI)" />

    <div class="card">
      <div class="card-head"><h3><${Icon} name="layers" size=${18} />Welches Modell für welche Aufgabe?</h3><span class="grow"></span><${Btn} size="sm" icon="star" onClick=${() => { const t = applyRecommendations(); toast(`${Object.keys(t).length} Empfehlungen übernommen`, 'success'); }}>Empfehlungen übernehmen<//></div>
      <div class="small muted">⭐ = Top-Empfehlung, ☆ = gute Alternative. In jedem Generator kannst du das Modell zusätzlich pro Anfrage wechseln.</div>
      ${tasks.map((t) => html`<${TaskRow} key=${t} task=${t} />`)}
    </div>

    ${Object.keys(usage).length ? html`<div class="card"><div class="card-head"><h3><${Icon} name="activity" size=${18} />Nutzung auf diesem Gerät</h3><span class="grow"></span><${Btn} size="sm" kind="ghost" onClick=${() => { localStorage.removeItem('ws.usage'); toast('Zurückgesetzt'); }}>Zurücksetzen<//></div>
      <table class="xp-table">${Object.entries(usage).map(([p, u]) => html`<tr><td>${PROVIDERS[p]?.label || p}</td><td>${u.calls} Anfragen · ${(u.input || 0).toLocaleString('de-DE')} → ${(u.output || 0).toLocaleString('de-DE')} Tokens</td></tr>`)}</table>
      <div class="tiny faint">Die genauen Kosten siehst du im Dashboard des jeweiligen Anbieters.</div></div>` : null}
  </div>`;
}

// ───────────────────────── Konto ─────────────────────────
function KontoSection() {
  const mode = useStore(app, (s) => s.mode);
  const user = useStore(app, (s) => s.user);
  const sync = useStore(app, (s) => s.sync);
  const gm = (user?.kind || 'gm') === 'gm';
  const cloud = mode === 'cloud';
  const [local, setLocal] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (cloud && gm) localSummary().then(setLocal).catch(() => setLocal([])); }, [cloud, gm]);
  const migrate = async () => {
    setBusy(true);
    try {
      const n = await migrateLocalToCloud((m) => toast(m));
      toast(`${n} Kampagne(n) übertragen`, 'success');
      setLocal([]);
      await refreshCampaigns();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const status = cloud ? (sync === 'offline' ? 'offline – Änderungen werden nachgereicht' : 'mit der Cloud synchronisiert') : 'Offline-Modus (nur dieses Gerät)';
  return html`<div class="stack lg">
    <div class="card stack">
      <div class="row nowrap"><${Avatar} name=${user?.name} size="lg" /><div class="grow"><b style="font-size:18px">${user?.name}</b><div class="small muted">${gm ? 'Spielleitung' : 'Spieler'} · ${status}</div></div></div>
      ${cloud ? html`<div class="small muted">Kampagnen, Charaktere und Tagebuch${gm ? ' sowie deine KI-Schlüssel' : ''} liegen in deinem Konto und sind auf Handy, Tablet und PC gleich – auch offline nutzbar.</div>` : null}
      ${cloud ? html`<div class="btn-row">
        <${Btn} icon="key" onClick=${changeSecretDialog}>Geheimwort ändern<//>
        <${Btn} icon=${gm ? 'user' : 'crown'} onClick=${() => switchKind(gm ? 'player' : 'gm')}>${gm ? 'Als Spieler weiterspielen' : 'Als Spielleitung arbeiten'}<//>
      </div>` : null}
    </div>
    <div class="card stack">
      <b><${Icon} name="log-out" size=${16} /> Abmelden</b>
      <div class="small muted" style="line-height:1.55">${cloud
        ? 'Beim Abmelden werden deine KI-Schlüssel von diesem Gerät entfernt. „Gerät bereinigen“ löscht zusätzlich die Offline-Kopie und alle Einstellungen – sinnvoll auf fremden oder geteilten Geräten.'
        : 'Beendet den Offline-Modus und zeigt wieder die Anmeldung.'}</div>
      <div class="btn-row">
        <${Btn} icon="log-out" onClick=${() => signOutDialog(false)}>${cloud ? 'Abmelden' : 'Offline-Modus beenden'}<//>
        ${cloud ? html`<${Btn} kind="danger" icon="trash" onClick=${() => signOutDialog(true)}>Abmelden & Gerät bereinigen<//>` : null}
      </div>
    </div>
    ${local?.length ? html`<div class="card stack accent-left"><b>${local.length} lokale Kampagne(n) auf diesem Gerät</b><div class="small muted">${local.map((c) => c.name).join(', ')} – aus der Zeit ohne Konto.</div><${Btn} kind="primary" icon="upload" loading=${busy} onClick=${migrate}>In dein Konto übertragen<//></div>` : null}
  </div>`;
}

// ───────────────────────── Darstellung / Spiel / Daten / Über ─────────────────────────
const THEMES = [
  { value: 'amoled', label: 'Schwarz (AMOLED)' },
  { value: 'dark', label: 'Obsidian dunkel' },
  { value: 'light', label: 'Hell' },
  { value: 'parchment', label: 'Pergament' },
];
const ACCENTS = ['#8a5cf5', '#4d8dff', '#2ec7c9', '#3dd68c', '#e0b24a', '#ff9a3c', '#ef5a5f', '#ff7ab6'];

function LookSection() {
  const s = useStore(settings, (x) => x);
  return html`<div class="stack lg">
    <${Field} label="Farbschema"><${Segmented} value=${s.theme} onChange=${(v) => updateSettings({ theme: v })} options=${THEMES} /><//>
    <${Field} label="Akzentfarbe"><div class="color-pick">${ACCENTS.map((c) => html`<button type="button" class=${s.accent === c ? 'active' : ''} style=${{ background: c }} onClick=${() => updateSettings({ accent: c })}></button>`)}<input type="color" value=${s.accent} onInput=${(e) => updateSettings({ accent: e.target.value })} style="width:30px;height:30px;border:0;background:none;padding:0" /></div><//>
    <${Field} label=${`Schriftgröße (${s.fontSize}px)`}><input type="range" min="13" max="21" value=${s.fontSize} style="accent-color:var(--accent)" onInput=${(e) => updateSettings({ fontSize: Number(e.target.value) })} /><//>
    <${Toggle} checked=${s.readableWidth} onChange=${(v) => updateSettings({ readableWidth: v })} label="Lesbare Zeilenlänge (wie in Obsidian)" />
    <${Field} label="Notizen öffnen im"><${Segmented} value=${s.editor.defaultMode} onChange=${(v) => updateSettings({ editor: { defaultMode: v } })} options=${[{ value: 'read', label: 'Lesemodus' }, { value: 'edit', label: 'Bearbeitungsmodus' }]} /><//>
    <${Toggle} checked=${s.editor.toolbar !== false} onChange=${(v) => updateSettings({ editor: { toolbar: v } })} label="Werkzeugleiste im Editor" />
    <${Toggle} checked=${s.editor.spellcheck !== false} onChange=${(v) => updateSettings({ editor: { spellcheck: v } })} label="Rechtschreibprüfung" />
  </div>`;
}

// Regelwerk wechseln (nur SL) – wirkt sofort für alle Mitglieder der Kampagne
async function changeEdition(v, camp, ed) {
  if (v === ed) return;
  const ok = await confirmDialog(`Regelwerk von „${camp.name}“ auf D&D 5e (${v}) umstellen? Das gilt für alle Mitspieler – Charakterbögen bleiben erhalten, Zauberlisten und Klassenmerkmale richten sich danach.`, { ok: 'Umstellen' });
  if (!ok) return;
  try {
    await updateCampaign({ settings: { ...(camp.settings || {}), rulesVersion: v } });
    toast(`Regelwerk auf D&D 5e (${v}) umgestellt`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function GameSection() {
  const s = useStore(settings, (x) => x);
  const mode = useStore(app, (x) => x.mode);
  const role = useStore(app, (x) => x.role);
  const camp = useStore(app, (x) => x.campaign);
  const ed = camp?.settings?.rulesVersion === '2024' ? '2024' : '2014';
  return html`<div class="stack lg">
    ${role === 'gm' && camp ? html`<${Field} label="Regelwerk dieser Kampagne" hint="Gilt für alle Mitglieder: Charaktere, Zauber, Würfel, Encounter und KI. Bestehende Bögen bleiben erhalten – prüfe nach dem Wechsel Zauber und Klassenmerkmale.">
      <${Segmented} value=${ed} onChange=${(v) => changeEdition(v, camp, ed)} options=${[{ value: '2014', label: 'D&D 5e (2014)' }, { value: '2024', label: 'D&D 5e (2024)' }]} /><//>` : null}
    <${Field} label="Entfernungen"><${Segmented} value=${s.units} onChange=${(v) => updateSettings({ units: v })} options=${[{ value: 'm', label: 'Meter (dt. Regelwerk)' }, { value: 'ft', label: 'Fuß' }]} /><//>
    <${Toggle} checked=${s.diceAnim !== false} onChange=${(v) => updateSettings({ diceAnim: v })} label="Würfel-Animation (Würfel rollen über den Tisch)" />
    <${Toggle} checked=${s.shareRolls !== false} onChange=${(v) => updateSettings({ shareRolls: v })} label="Würfe automatisch im Spieltisch-Chat zeigen" />
    ${mode === 'local' ? html`<${Field} label="Dein Name (offline)"><input class="input" value=${s.profileName} onInput=${(e) => { updateSettings({ profileName: e.target.value }); renameLocalProfile(e.target.value); }} /><//>` : null}
  </div>`;
}

function DataSection() {
  const [est, setEst] = useState(null);
  const [persisted, setPersisted] = useState(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then(setEst).catch(() => {});
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
  }, []);
  const mb = (b) => `${(b / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
  const wipe = async () => {
    if (!(await confirmDialog('ALLE lokalen Daten dieses Geräts löschen (Offline-Kopie, Einstellungen, Schlüssel)? Deine Kampagnen in der Cloud bleiben erhalten.', { danger: true, ok: 'Alles löschen', title: 'Lokale Daten löschen' }))) return;
    const typed = await promptDialog('Zur Bestätigung LÖSCHEN eintippen', '', { title: 'Wirklich?' });
    if (typed !== 'LÖSCHEN') return toast('Abgebrochen.', 'info');
    Object.keys(localStorage).filter((k) => k.startsWith('ws.')).forEach((k) => localStorage.removeItem(k));
    await new Promise((res) => { const r = indexedDB.deleteDatabase('weltenschmiede'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    location.reload();
  };
  return html`<div class="stack lg">
    <div class="card stack sm">
      <b><${Icon} name="save" size=${16} /> Speicher auf diesem Gerät</b>
      ${est ? html`<div class="small muted">Belegt: ${mb(est.usage || 0)} von ca. ${mb(est.quota || 0)}</div>` : null}
      <div class="small muted">Dauerhafter Speicher: ${persisted ? 'aktiv – der Browser löscht die Daten nicht automatisch' : 'nicht bestätigt'}</div>
      ${!persisted ? html`<${Btn} size="sm" icon="lock" onClick=${async () => setPersisted(await navigator.storage?.persist?.())}>Dauerhaft speichern anfragen<//>` : null}
    </div>
    <div class="card stack sm">
      <b><${Icon} name="upload" size=${16} /> Import, Export & Backup</b>
      <div class="small muted">Obsidian-Vault importieren/exportieren und Komplett-Backups findest du unter „Import & Export“ (innerhalb einer Kampagne).</div>
      ${app.get().cid ? html`<${Btn} size="sm" icon="upload" onClick=${() => import('../core/workspace.js').then((m) => m.openView('import'))}>Import & Export öffnen<//>` : null}
    </div>
    <div class="card stack sm">
      <b class="danger-text"><${Icon} name="alert" size=${16} /> Gefahrenzone</b>
      <${Btn} kind="danger" icon="trash" onClick=${wipe}>Lokale Daten dieses Geräts löschen<//>
    </div>
  </div>`;
}

function AboutSection() {
  const keys = [['Strg + O', 'Schnellwechsler (Notiz öffnen/anlegen)'], ['Strg + P', 'Befehlspalette'], ['Strg + N', 'Neue Notiz'], ['Strg + E', 'Lesen ↔ Bearbeiten'], ['Strg + G', 'Graph'], ['Strg + ⇧ + F', 'Volltextsuche'], ['Alt + ← / →', 'Zurück / Vor'], ['[[', 'Notiz verlinken (Autovervollständigung)']];
  return html`<div class="stack lg">
    <div class="row"><img src="icons/icon.svg" width="56" height="56" alt="" /><div><b style="font-size:18px">Weltenschmiede</b><div class="small muted">D&D-5e-Kampagnen-Werkstatt · Version 1.2 (2026-09)</div></div></div>
    <div class="card"><div class="card-head"><h3><${Icon} name="command" size=${18} />Tastenkürzel</h3></div><table class="xp-table">${keys.map(([k, d]) => html`<tr><td><span class="kbd">${k}</span></td><td>${d}</td></tr>`)}</table></div>
    <div class="card stack sm small" style="line-height:1.6">
      <b>Quellen & Lizenzen</b>
      <div>Zauber, Monster und magische Gegenstände: System Reference Document 5.1 und 5.2.1 (deutsche Fassungen) von Wizards of the Coast LLC, lizenziert unter <a href="https://creativecommons.org/licenses/by/4.0/legalcode.de" target="_blank" rel="noopener">CC-BY-4.0</a>. Maschinenlesbare Aufbereitung des SRD 5.1: openrpg.de; ergänzende Metadaten (Klassen, Schaden, Flächen): dnd5eapi.co.</div>
      <div>Symbole für Zauber, Gegenstände und Monster: <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a> (Lorc, Delapouite u. a.), lizenziert unter CC BY 3.0.</div>
      <div class="faint">Gebaut mit Preact + htm (ohne Build-Schritt), Firebase für Konten & Sync. Regelzusammenfassungen in eigenen Worten. „Dungeons & Dragons“ ist eine Marke von Wizards of the Coast – dies ist ein privates Fan-Werkzeug.</div>
    </div>
  </div>`;
}

export function SettingsPanel({ section: initial }) {
  const gm = useStore(app, (s) => (s.user?.kind || 'gm') === 'gm');
  const sections = ALL_SECTIONS.filter((x) => gm || !x.gm);
  const pick = (v) => {
    const w = v === 'cloud' ? 'konto' : v;
    return sections.some((x) => x.value === w) ? w : sections[0].value;
  };
  const [section, setSection] = useState(() => pick(initial));
  useEffect(() => setSection(pick(initial)), [initial, gm]);
  let body;
  if (section === 'konto') body = html`<${KontoSection} />`;
  else if (section === 'look') body = html`<${LookSection} />`;
  else if (section === 'game') body = html`<${GameSection} />`;
  else if (section === 'data') body = html`<${DataSection} />`;
  else if (section === 'about') body = html`<${AboutSection} />`;
  else body = html`<${AISection} />`;
  return html`<div class="stack lg"><${Segmented} value=${section} onChange=${setSection} options=${sections} />${body}</div>`;
}

export function SettingsView({ params, tabId }) {
  return html`<${ViewFrame} tabId=${tabId} title="Einstellungen"><div class="page narrow"><${SettingsPanel} section=${params.section} /></div><//>`;
}
