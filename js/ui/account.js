// Konto: Avatar-Menü, Abmelden (optional mit Gerätebereinigung), Rolle wechseln, Geheimwort, Einstellungen als Dialog.
import { html, useState, useEffect } from '../lib/preact.js';
import { app, enterLobby, signOut, setAccountKind, isGmAccount } from '../core/app.js';
import { db } from '../core/db.js';
import { openView } from '../core/workspace.js';
import { authErrorMessage } from '../core/db-cloud.js';
import { openMenu, openModal, confirmDialog, promptDialog, toast } from './components.js';

export function openSettingsModal(section) {
  openModal(() => {
    const [Comp, setComp] = useState(null);
    useEffect(() => { import('../views/settings.js').then((m) => setComp(() => m.SettingsPanel)); }, []);
    return html`<div class="modal-body">${Comp ? html`<${Comp} section=${section} />` : html`<div class="empty"><span class="spinner" /></div>`}</div>`;
  }, { title: 'Einstellungen', icon: 'settings', size: 'xl' });
}

// In einer Kampagne als Tab, in der Übersicht als Dialog
export function openSettings(section) {
  if (app.get().cid) openView('settings', section ? { section } : {});
  else openSettingsModal(section);
}

export async function changeSecretDialog() {
  const a = await promptDialog('Neues Geheimwort (mind. 6 Zeichen)', '', { title: 'Geheimwort ändern' });
  if (!a) return;
  if (a.length < 6) return toast('Mindestens 6 Zeichen.', 'error');
  try {
    await db.cloud.changeSecret(a);
    toast('Geheimwort geändert', 'success');
  } catch (e) {
    toast(authErrorMessage(e), 'error');
  }
}

export async function switchKind(kind) {
  await setAccountKind(kind);
  enterLobby();
  toast(kind === 'gm' ? 'Du arbeitest jetzt als Spielleitung.' : 'Du spielst jetzt als Spieler.', 'success');
}

export async function signOutDialog(wipe = false) {
  if (app.get().mode !== 'cloud') {
    await signOut();
    return;
  }
  const ok = wipe
    ? await confirmDialog('Abmelden und alle Daten der Weltenschmiede von diesem Gerät entfernen – Offline-Kopie, Einstellungen, KI-Schlüssel und Würfelverlauf? Deine Kampagnen bleiben sicher in der Cloud; du kannst dich jederzeit wieder anmelden.', { title: 'Gerät bereinigen', ok: 'Abmelden & bereinigen', danger: true })
    : await confirmDialog('Von diesem Gerät abmelden? Deine Kampagnen bleiben in der Cloud, deine KI-Schlüssel werden von diesem Gerät entfernt.', { title: 'Abmelden', ok: 'Abmelden' });
  if (!ok) return;
  await signOut({ wipe });
  if (!wipe) toast('Abgemeldet', 'success');
}

export function accountMenu(e) {
  const { user, cid, mode } = app.get();
  const gm = isGmAccount();
  const cloud = mode === 'cloud';
  openMenu(e, [
    { header: true, label: `${user?.name || 'Konto'} · ${gm ? 'Spielleitung' : 'Spieler'}` },
    cid ? { label: 'Übersicht: alle Kampagnen', icon: 'home', onClick: enterLobby } : null,
    { label: 'Einstellungen', icon: 'settings', onClick: () => openSettings() },
    cloud ? { label: gm ? 'Als Spieler weiterspielen' : 'Als Spielleitung arbeiten', icon: gm ? 'user' : 'crown', onClick: () => switchKind(gm ? 'player' : 'gm') } : null,
    cloud ? { label: 'Geheimwort ändern …', icon: 'key', onClick: changeSecretDialog } : null,
    { divider: true },
    { label: cloud ? 'Abmelden' : 'Offline-Modus beenden', icon: 'log-out', onClick: () => signOutDialog(false) },
    cloud ? { label: 'Abmelden & Gerät bereinigen …', icon: 'trash', danger: true, onClick: () => signOutDialog(true) } : null,
  ]);
}
