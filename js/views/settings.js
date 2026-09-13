// Einstellungen: KI-Anbieter & Modellzuordnung (mit Empfehlungen), Cloud & Konto, Darstellung, Spiel, Daten, Über.
import { html, useState, useEffect } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, signOut, renameLocalProfile, refreshCampaigns } from '../core/app.js';
import { db, localDb } from '../core/db.js';
import {
  settings, updateSettings, getCloudConfig, setCloudConfig, parseFirebaseConfig, modePref, hasBakedCloudConfig,
} from '../core/settings.js';
import {
  PROVIDERS, TASKS, MODELS, modelsFor, recommendedRefs, resolveModel, modelLabel, providerReady, applyRecommendations, refreshModels,
  testProvider, usageStats,
} from '../core/ai.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, IconBtn, Btn, Field, Toggle, Segmented, Select, toast, confirmDialog, promptDialog } from '../ui/components.js';
import { authErrorMessage } from '../core/db-cloud.js';
import { localSummary, migrateLocalToCloud } from './importexport.js';

const SECTIONS = [
  { value: 'ai', label: 'KI & Modelle', icon: 'sparkles' },
  { value: 'cloud', label: 'Cloud & Konto', icon: 'cloud' },
  { value: 'look', label: 'Darstellung', icon: 'palette' },
  { value: 'game', label: 'Spiel', icon: 'd20' },
  { value: 'data', label: 'Daten', icon: 'archive' },
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

function TaskRow({ task }) {
  const t = TASKS[task];
  const chosen = useStore(settings, (s) => s.ai.tasks?.[task] || '');
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
        <option value="">Automatisch (beste verfügbare Empfehlung)</option>
        ${ready.length ? html`<optgroup label="Verfügbar">${ready.slice(0, 80).map((m) => html`<option value=${m.ref}>${label(m)}</option>`)}</optgroup>` : null}
        ${notReady.length ? html`<optgroup label="Schlüssel fehlt">${notReady.map((m) => html`<option value=${m.ref} disabled>${label(m)}</option>`)}</optgroup>` : null}
      </select>
      <div class="tiny ${sel ? 'success-text' : 'danger-text'}">${sel ? `→ nutzt: ${modelLabel(sel)} (${PROVIDERS[sel.provider]?.short})` : 'Kein Modell verfügbar – Schlüssel eintragen oder Demo aktivieren.'}</div>
    </div>
  </div>`;
}

function AISection() {
  const ai = useStore(settings, (s) => s.ai);
  const mode = useStore(app, (s) => s.mode);
  const usage = usageStats();
  return html`<div class="stack lg">
    <div class="callout callout-blue"><div class="callout-title"><${Icon} name="info" size=${16} />So funktioniert der KI-Zugang</div><div class="callout-content small" style="line-height:1.6">
      Du bringst deinen eigenen Schlüssel mit – die App schickt Anfragen direkt vom Browser an den Anbieter, ohne Umweg über einen Server. Du zahlst nur, was du nutzt.<br />
      <b>Günstiger Start:</b> Google Gemini (Flash-Modelle mit Gratis-Kontingent). <b>Beste Texte:</b> Claude Opus 5. <b>Viele Modelle mit einem Schlüssel:</b> OpenRouter.
    </div></div>
    <div class="grid two">${['gemini', 'anthropic', 'openai', 'openrouter'].map((id) => html`<${ProviderCard} key=${id} id=${id} />`)}</div>
    <${ProviderCard} id="custom" />
    <div class="row">
      <${Toggle} checked=${ai.demo} onChange=${(v) => updateSettings({ ai: { demo: v } })} label="Demo-Modus (Beispieltexte ohne KI)" />
      ${mode === 'cloud' ? html`<${Toggle} checked=${ai.syncKeys} onChange=${(v) => updateSettings({ ai: { syncKeys: v } })} label="Schlüssel mit meinen Geräten synchronisieren" />` : null}
    </div>
    ${ai.syncKeys ? html`<div class="small faint">Die Schlüssel liegen dann in deinem privaten Bereich der Firestore-Datenbank (nur für dein Konto lesbar). Ohne Sync musst du sie auf jedem Gerät einmal eintragen.</div>` : null}

    <div class="card">
      <div class="card-head"><h3><${Icon} name="layers" size=${18} />Welches Modell für welche Aufgabe?</h3><span class="grow"></span><${Btn} size="sm" icon="star" onClick=${() => { const t = applyRecommendations(); toast(`${Object.keys(t).length} Empfehlungen übernommen`, 'success'); }}>Empfehlungen übernehmen<//></div>
      <div class="small muted">⭐ = Top-Empfehlung, ☆ = gute Alternative. In jedem Generator kannst du das Modell zusätzlich pro Anfrage wechseln.</div>
      ${Object.keys(TASKS).map((t) => html`<${TaskRow} key=${t} task=${t} />`)}
    </div>

    ${Object.keys(usage).length ? html`<div class="card"><div class="card-head"><h3><${Icon} name="activity" size=${18} />Nutzung auf diesem Gerät</h3><span class="grow"></span><${Btn} size="sm" kind="ghost" onClick=${() => { localStorage.removeItem('ws.usage'); toast('Zurückgesetzt'); }}>Zurücksetzen<//></div>
      <table class="xp-table">${Object.entries(usage).map(([p, u]) => html`<tr><td>${PROVIDERS[p]?.label || p}</td><td>${u.calls} Anfragen · ${(u.input || 0).toLocaleString('de-DE')} → ${(u.output || 0).toLocaleString('de-DE')} Tokens</td></tr>`)}</table>
      <div class="tiny faint">Die genauen Kosten siehst du im Dashboard des jeweiligen Anbieters.</div></div>` : null}
  </div>`;
}

// ───────────────────────── Cloud ─────────────────────────
function CloudSection() {
  const mode = useStore(app, (s) => s.mode);
  const user = useStore(app, (s) => s.user);
  const cfg = getCloudConfig();
  const [text, setText] = useState('');
  const [local, setLocal] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (mode === 'cloud') localSummary().then(setLocal); }, [mode]);

  const connect = () => {
    const c = parseFirebaseConfig(text);
    if (!c) return toast('Das sieht nicht nach einer Firebase-Konfiguration aus (apiKey und projectId fehlen).', 'error');
    setCloudConfig(c);
    modePref.set('auto');
    location.reload();
  };
  const changeSecret = async () => {
    const a = await promptDialog('Neues Geheimwort (mind. 6 Zeichen)', '', { title: 'Geheimwort ändern' });
    if (!a) return;
    if (a.length < 6) return toast('Mindestens 6 Zeichen.', 'error');
    try {
      await db.cloud.changeSecret(a);
      toast('Geheimwort geändert', 'success');
    } catch (e) {
      toast(authErrorMessage(e), 'error');
    }
  };
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

  if (mode === 'cloud') {
    return html`<div class="stack lg">
      <div class="card stack">
        <div class="row"><${Icon} name="cloud" size=${22} class="success-text" /><div class="grow"><b>Verbunden mit Firebase</b><div class="small muted">Projekt <code>${cfg?.projectId}</code> · angemeldet als <b>${user?.name}</b></div></div></div>
        <div class="small muted">Alle Kampagnen, Charaktere und dein Tagebuch synchronisieren sich zwischen deinen Geräten und funktionieren auch offline (Änderungen werden nachgereicht).</div>
        <div class="btn-row">
          <${Btn} icon="key" onClick=${changeSecret}>Geheimwort ändern<//>
          <${Btn} icon="log-out" onClick=${async () => { await signOut(); }}>Abmelden<//>
          <${Btn} kind="ghost" icon="cloud-off" onClick=${async () => { if (await confirmDialog('Auf diesem Gerät ohne Cloud weiterarbeiten? (Cloud-Daten bleiben erhalten, lokale Kampagnen sind getrennt.)', { ok: 'Lokal arbeiten' })) { modePref.set('local'); location.reload(); } }}>Nur lokal arbeiten<//>
        </div>
      </div>
      ${local?.length ? html`<div class="card stack accent-left"><b>${local.length} lokale Kampagne(n) auf diesem Gerät</b><div class="small muted">${local.map((c) => c.name).join(', ')} – aus der Zeit vor der Cloud.</div><${Btn} kind="primary" icon="upload" loading=${busy} onClick=${migrate}>In die Cloud übertragen<//></div>` : null}
    </div>`;
  }
  return html`<div class="stack lg">
    ${cfg ? html`<div class="card stack"><b>Cloud ist konfiguriert (Projekt <code>${cfg.projectId}</code>), aber dieses Gerät arbeitet lokal.</b>
      <div class="btn-row"><${Btn} kind="primary" icon="cloud" onClick=${() => { modePref.set('auto'); location.reload(); }}>Cloud verwenden<//>${!hasBakedCloudConfig() ? html`<${Btn} kind="ghost" icon="trash" onClick=${() => { setCloudConfig(null); location.reload(); }}>Konfiguration entfernen<//>` : null}</div></div>` : null}
    <div class="card stack">
      <div class="card-head" style="margin:0"><h3><${Icon} name="cloud" size=${18} />Cloud einrichten (Firebase, kostenlos)</h3></div>
      <div class="small muted">Einmalig ca. 10 Minuten. Danach: Sync zwischen Handy, Tablet und PC + Mitspieler per Einladungscode (ohne E-Mail).</div>
      <div class="step-list small" style="line-height:1.55">
        <div class="step"><div><b>Projekt anlegen:</b> <a href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a> → „Projekt hinzufügen“ (Google Analytics nicht nötig).</div></div>
        <div class="step"><div><b>Anmeldung aktivieren:</b> Build → Authentication → „Jetzt starten“ → Anmeldemethode <b>E-Mail/Passwort</b> aktivieren.</div></div>
        <div class="step"><div><b>Datenbank:</b> Build → Firestore Database → „Datenbank erstellen“ → Standort <code>europe-west3</code> (Frankfurt) → Produktionsmodus.</div></div>
        <div class="step"><div><b>Regeln:</b> Firestore → Regeln → Inhalt der Datei <code>firebase/firestore.rules</code> einfügen → Veröffentlichen.</div></div>
        <div class="step"><div><b>Web-App:</b> Projekteinstellungen (Zahnrad) → „App hinzufügen“ → Web (&lt;/&gt;) → die angezeigte <code>firebaseConfig</code> kopieren und unten einfügen.</div></div>
        <div class="step"><div><b>Domain freigeben:</b> Authentication → Einstellungen → Autorisierte Domains → deine GitHub-Pages-Adresse hinzufügen (z. B. <code>deinname.github.io</code>).</div></div>
      </div>
      <textarea class="textarea mono" style="min-height:140px;font-size:13px" value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${'const firebaseConfig = {\n  apiKey: "AIza…",\n  authDomain: "…firebaseapp.com",\n  projectId: "…",\n  appId: "1:…"\n};'}></textarea>
      <div class="btn-row"><${Btn} kind="primary" icon="cloud" onClick=${connect}>Verbinden<//></div>
      <div class="tiny faint">Tipp: Trägst du die Konfiguration zusätzlich in <code>js/config.js</code> ein, müssen Mitspieler nichts einrichten – sie öffnen nur den Einladungslink.</div>
    </div>
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

function GameSection() {
  const s = useStore(settings, (x) => x);
  const mode = useStore(app, (x) => x.mode);
  return html`<div class="stack lg">
    <${Field} label="Regelwerk" hint="Beeinflusst die Encounter-Formel (DMG 2014 mit Multiplikator bzw. 2024 mit EP-Budget) und KI-Prompts."><${Segmented} value=${s.rulesVersion} onChange=${(v) => updateSettings({ rulesVersion: v })} options=${[{ value: '2014', label: 'D&D 5e (2014)' }, { value: '2024', label: 'D&D 5e (2024)' }]} /><//>
    <${Field} label="Entfernungen"><${Segmented} value=${s.units} onChange=${(v) => updateSettings({ units: v })} options=${[{ value: 'm', label: 'Meter (dt. Regelwerk)' }, { value: 'ft', label: 'Fuß' }]} /><//>
    <${Toggle} checked=${s.shareRolls !== false} onChange=${(v) => updateSettings({ shareRolls: v })} label="Würfe automatisch im Spieltisch-Chat zeigen (Cloud)" />
    ${mode === 'local' ? html`<${Field} label="Dein Name (lokal)"><input class="input" value=${s.profileName} onInput=${(e) => { updateSettings({ profileName: e.target.value }); renameLocalProfile(e.target.value); }} /><//>` : null}
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
    if (!(await confirmDialog('ALLE lokalen Daten dieses Geräts löschen (lokale Kampagnen, Einstellungen, Schlüssel, Offline-Cache)? Cloud-Daten bleiben erhalten.', { danger: true, ok: 'Alles löschen', title: 'Lokale Daten löschen' }))) return;
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
      <div class="small muted">Obsidian-Vault importieren/exportieren, Komplett-Backups und die Übertragung lokaler Daten in die Cloud findest du unter „Import & Export“.</div>
      <${Btn} size="sm" icon="upload" onClick=${() => import('../core/workspace.js').then((m) => m.openView('import'))}>Import & Export öffnen<//>
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
    <div class="row"><img src="icons/icon.svg" width="56" height="56" alt="" /><div><b style="font-size:18px">Weltenschmiede</b><div class="small muted">D&D-5e-Kampagnen-Werkstatt · Version 1.0 (2026-09)</div></div></div>
    <div class="card"><div class="card-head"><h3><${Icon} name="command" size=${18} />Tastenkürzel</h3></div><table class="xp-table">${keys.map(([k, d]) => html`<tr><td><span class="kbd">${k}</span></td><td>${d}</td></tr>`)}</table></div>
    <div class="small faint" style="line-height:1.6">Gebaut mit Preact + htm (ohne Build-Schritt), optional Firebase für Sync. Regelzusammenfassungen in eigenen Worten; SRD-Importe: System Reference Document 5.1 von Wizards of the Coast LLC, CC-BY-4.0. „Dungeons & Dragons“ ist eine Marke von Wizards of the Coast – dies ist ein privates Fan-Werkzeug.</div>
  </div>`;
}

export function SettingsPanel({ section: initial = 'ai' }) {
  const [section, setSection] = useState(initial);
  useEffect(() => setSection(initial), [initial]);
  let body;
  if (section === 'cloud') body = html`<${CloudSection} />`;
  else if (section === 'look') body = html`<${LookSection} />`;
  else if (section === 'game') body = html`<${GameSection} />`;
  else if (section === 'data') body = html`<${DataSection} />`;
  else if (section === 'about') body = html`<${AboutSection} />`;
  else body = html`<${AISection} />`;
  return html`<div class="stack lg"><${Segmented} value=${section} onChange=${setSection} options=${SECTIONS} />${body}</div>`;
}

export function SettingsView({ params, tabId }) {
  return html`<${ViewFrame} tabId=${tabId} title="Einstellungen"><div class="page narrow"><${SettingsPanel} section=${params.section || 'ai'} /></div><//>`;
}
