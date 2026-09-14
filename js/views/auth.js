// Start: erst Rolle wählen (Spielleitung oder Spieler), dann mit Name + Geheimwort anmelden – keine E-Mail nötig.
import { html, useState } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, signIn, register } from '../core/app.js';
import { authErrorMessage } from '../core/db-cloud.js';
import { Btn, Icon, Field, Segmented } from '../ui/components.js';

const ROLES = {
  gm: {
    label: 'Spielleitung', icon: 'crown',
    text: 'Welten bauen, Kampagnen leiten und die Runde vorbereiten.',
    points: ['Codex im Obsidian-Stil', 'KI-Weltenschmiede, NPCs & Encounter', 'Karten, Kampf-Tracker, Mitspieler einladen'],
  },
  player: {
    label: 'Spieler', icon: 'sword',
    text: 'Einer Kampagne beitreten und deinen Helden spielen.',
    points: ['Charakter nach den 5e-Regeln', 'Würfel, Spieltisch & Handouts', 'Eigenes Tagebuch, das bleibt'],
  },
};

export function AuthScreen() {
  const joinCode = useStore(app, (s) => s.joinCode);
  const cloudError = useStore(app, (s) => s.cloudError);
  const [role, setRole] = useState(joinCode ? 'player' : null);
  const last = localStorage.getItem('ws.lastRole');
  return html`<div class="auth-screen">
    <div class="auth-shell">
      <div class="auth-brand">
        <img src="icons/icon.svg" width="76" height="76" alt="" />
        <h1>Weltenschmiede</h1>
        <p>Die Werkstatt für eure D&D-Welt</p>
      </div>
      ${cloudError ? html`<div class="callout callout-orange small">${cloudError}</div>` : null}
      ${role
        ? html`<${LoginForm} key=${role} role=${role} joinCode=${joinCode} onBack=${joinCode ? null : () => setRole(null)} />`
        : html`<div class="auth-q">Wie möchtest du dich anmelden?</div>
          <div class="role-grid">
            ${Object.entries(ROLES).map(([k, r]) => html`<button type="button" class=${`role-card ${k}`} onClick=${() => setRole(k)}>
              <span class="role-icon"><${Icon} name=${r.icon} size=${30} /></span>
              <b>${r.label}</b>
              <span class="role-text">${r.text}</span>
              <ul>${r.points.map((p) => html`<li>${p}</li>`)}</ul>
              <span class="role-go">${last === k ? 'Zuletzt gewählt · ' : ''}Weiter <${Icon} name="arrow-right" size=${15} /></span>
            </button>`)}
          </div>
          <p class="auth-foot">Anmeldung nur mit Name und Geheimwort – keine E-Mail nötig. Deine Kampagnen liegen in der Cloud und sind auf Handy, Tablet und PC gleich.</p>`}
    </div>
  </div>`;
}

function LoginForm({ role, joinCode, onBack }) {
  const r = ROLES[role];
  const [tab, setTab] = useState(joinCode ? 'register' : 'login');
  const [name, setName] = useState(localStorage.getItem('ws.lastName') || '');
  const [secret, setSecret] = useState('');
  const [secret2, setSecret2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const n = name.trim();
    if (n.length < 2) return setErr('Bitte einen Namen mit mindestens 2 Zeichen eingeben.');
    if (secret.length < 6) return setErr('Das Geheimwort braucht mindestens 6 Zeichen.');
    if (tab === 'register' && secret !== secret2) return setErr('Die beiden Geheimwörter stimmen nicht überein.');
    setBusy(true);
    try {
      localStorage.setItem('ws.lastName', n);
      localStorage.setItem('ws.lastRole', role);
      if (tab === 'login') await signIn(n, secret, role);
      else await register(n, secret, role);
    } catch (e2) {
      setErr(authErrorMessage(e2));
      setBusy(false);
    }
  };

  return html`<form class=${`auth-card role-${role}`} onSubmit=${submit}>
    <div class="auth-card-head">
      ${onBack ? html`<button type="button" class="auth-back" onClick=${onBack}><${Icon} name="arrow-left" size=${16} />Andere Rolle</button>` : html`<span></span>`}
      <span class=${`badge ${role === 'gm' ? 'gold' : 'players'}`}><${Icon} name=${r.icon} size=${12} />${r.label}</span>
    </div>
    <h2>${tab === 'login' ? `Anmelden als ${r.label}` : 'Neues Konto anlegen'}</h2>
    ${joinCode ? html`<div class="callout callout-green"><div class="callout-title"><${Icon} name="user-plus" size=${16} />Einladung erhalten</div><div class="callout-content small">Code <b class="mono">${joinCode}</b> – melde dich an oder lege ein Konto an, danach trittst du automatisch bei.</div></div>` : null}
    <${Segmented} full value=${tab} onChange=${(v) => { setTab(v); setErr(''); }} options=${[{ value: 'login', label: 'Anmelden' }, { value: 'register', label: 'Neues Konto' }]} />
    <div class="stack">
      <${Field} label="Name" hint=${tab === 'register' ? 'So sehen dich deine Mitspieler. Mit diesem Namen meldest du dich auch auf anderen Geräten an.' : ''}>
        <input class="input" value=${name} onInput=${(e) => setName(e.target.value)} autocomplete="username" placeholder="z. B. Claudio" autoFocus />
      <//>
      <${Field} label="Geheimwort" hint=${tab === 'register' ? 'Mindestens 6 Zeichen. Gut merken – es gibt keine E-Mail zum Zurücksetzen.' : ''}>
        <div class="input-group">
          <input class="input" type=${show ? 'text' : 'password'} value=${secret} onInput=${(e) => setSecret(e.target.value)} autocomplete=${tab === 'login' ? 'current-password' : 'new-password'} />
          <${Btn} kind="ghost" icon=${show ? 'eye-off' : 'eye'} title="Anzeigen" onClick=${() => setShow(!show)} />
        </div>
      <//>
      ${tab === 'register' ? html`<${Field} label="Geheimwort wiederholen"><input class="input" type=${show ? 'text' : 'password'} value=${secret2} onInput=${(e) => setSecret2(e.target.value)} autocomplete="new-password" /><//>` : null}
      ${err ? html`<div class="callout callout-red small" style="margin:0">${err}</div>` : null}
      <${Btn} type="submit" kind="primary" size="lg" class="block" loading=${busy} icon=${tab === 'login' ? 'log-in' : 'user-plus'}>${tab === 'login' ? 'Anmelden' : 'Konto anlegen'}<//>
    </div>
    <div class="small faint center" style="margin-top:14px;line-height:1.5">${role === 'gm'
      ? 'Als Spielleitung legst du Kampagnen an und lädst Mitspieler per Code ein.'
      : 'Den Einladungscode bekommst du von deiner Spielleitung – du gibst ihn nach der Anmeldung ein.'}</div>
  </form>`;
}
