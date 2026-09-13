// Anmeldung für den Cloud-Modus: Name + Geheimwort (keine E-Mail nötig).
import { html, useState } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, signIn, register } from '../core/app.js';
import { authErrorMessage } from '../core/db-cloud.js';
import { modePref } from '../core/settings.js';
import { Btn, Icon, Field, Segmented } from '../ui/components.js';

export function AuthScreen() {
  const joinCode = useStore(app, (s) => s.joinCode);
  const cloudError = useStore(app, (s) => s.cloudError);
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
      if (tab === 'login') await signIn(n, secret);
      else await register(n, secret);
    } catch (e2) {
      setErr(authErrorMessage(e2));
      setBusy(false);
    }
  };

  const useLocal = () => {
    modePref.set('local');
    location.reload();
  };

  return html`<div class="auth-screen">
    <form class="auth-card" onSubmit=${submit}>
      <div class="auth-logo"><img src="icons/icon.svg" width="64" height="64" alt="" /></div>
      <h1>Weltenschmiede</h1>
      <p class="lead">${tab === 'login' ? 'Willkommen zurück am Spieltisch.' : 'Leg dir in 10 Sekunden einen Zugang an.'}</p>
      ${joinCode ? html`<div class="callout callout-green" style="margin-bottom:14px"><div class="callout-title"><${Icon} name="user-plus" size=${16} />Einladung erhalten</div><div class="callout-content small">Code <b class="mono">${joinCode}</b> – melde dich an oder lege einen neuen Namen an, danach trittst du automatisch bei.</div></div>` : null}
      ${cloudError ? html`<div class="callout callout-orange small" style="margin-bottom:14px">${cloudError}</div>` : null}
      <div style="margin-bottom:16px"><${Segmented} full value=${tab} onChange=${(v) => { setTab(v); setErr(''); }} options=${[{ value: 'login', label: 'Anmelden' }, { value: 'register', label: 'Neu hier' }]} /></div>
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
        <${Btn} type="submit" kind="primary" size="lg" block loading=${busy} icon=${tab === 'login' ? 'log-in' : 'user-plus'}>${tab === 'login' ? 'Anmelden' : 'Zugang anlegen'}<//>
      </div>
      <div class="hr"></div>
      <div class="small faint center" style="line-height:1.6">
        Deine Kampagnen werden in deiner eigenen Firebase-Cloud gespeichert und zwischen Handy, Tablet und PC synchronisiert.<br />
        <a href="#" onClick=${(e) => { e.preventDefault(); useLocal(); }}>Ohne Anmeldung nur auf diesem Gerät nutzen</a>
      </div>
    </form>
  </div>`;
}
