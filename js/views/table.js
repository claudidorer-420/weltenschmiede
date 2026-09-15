// Spieltisch: Live (Szene, Gruppe, Initiative, Chat mit Würfeln & Flüstern), Play-by-Post (asynchrone Züge), Handouts.
import { html, useState, useEffect, useRef, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, vault, col, myUid, myName, gmUids, updateCampaign, isRealGM } from '../core/app.js';
import { db } from '../core/db.js';
import { showRightPanel, isMobile } from '../core/workspace.js';
import { sendEvent } from '../core/relay.js';
import { watchParty } from '../core/party.js';
import { doRoll } from '../core/rolls.js';
import { fileUrl } from '../core/files.js';
import { ViewFrame } from '../ui/frame.js';
import {
  Icon, IconBtn, Btn, Field, Segmented, Toggle, Select, MarkdownView, NotePicker, AutoTextarea, DictateButton, openModal, openMenu,
  confirmDialog, toast, Empty, Avatar, pickFiles, openLightbox,
} from '../ui/components.js';
import { useCol, useDoc, useVisibleCol } from '../core/hooks.js';
import { now, fmtTime, fmtRelative, sortBy, esc } from '../lib/util.js';
import { uploadImage } from './codex.js';

function rollHtml(text) {
  return esc(text || '').replace(/~(\d+)~/g, '<s>$1</s>');
}

function useMyChar() {
  const me = myUid();
  const cid = useStore(app, (s) => s.cid);
  const chars = useCol(me ? `users/${me}/characters` : null);
  return (chars || []).find((c) => c.campaignId === cid) || null;
}

function useUnreadTitle(count, activeTab) {
  useEffect(() => {
    const base = 'Weltenschmiede';
    if (count > 0 && (document.hidden || !activeTab)) document.title = `(${count}) ${base}`;
    else document.title = base;
  }, [count, activeTab]);
}

// ───────────────────────── Szene ─────────────────────────
function SceneForm({ close, scene }) {
  const [title, setTitle] = useState(scene?.title || '');
  const [body, setBody] = useState(scene?.body || '');
  const [fileId, setFileId] = useState(scene?.fileId || null);
  const [busy, setBusy] = useState(false);
  const pickImage = async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    setBusy(true);
    try {
      const meta = await uploadImage(f, { visibility: 'players', folder: 'Szenen', maxDim: 2000 });
      setFileId(meta.id);
    } finally {
      setBusy(false);
    }
  };
  return html`<div class="modal-body stack">
    <${Field} label="Aus Notiz übernehmen (optional)"><${NotePicker} onPick=${(n) => { setTitle(n.title); setBody(n.body || ''); }} /><//>
    <${Field} label="Titel"><input class="input" value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="z. B. Ankunft in Nebelbrück" /><//>
    <${Field} label="Text für die Spieler (Markdown)"><${AutoTextarea} value=${body} minRows=${5} onInput=${(e) => setBody(e.target.value)} placeholder="Vorlesetext, Beschreibung, Stimmung …" /><//>
    <div class="row"><${Btn} icon="image" loading=${busy} onClick=${pickImage}>${fileId ? 'Bild ersetzen' : 'Bild hinzufügen'}<//>${fileId ? html`<span class="badge players">Bild gesetzt</span><${IconBtn} icon="x" onClick=${() => setFileId(null)} />` : null}</div>
    <div class="btn-row end">
      <${Btn} kind="ghost" onClick=${() => close({ clear: true })}>Szene leeren<//>
      <${Btn} kind="primary" icon="send" onClick=${() => close({ title, body, fileId })}>Allen zeigen<//>
    </div>
  </div>`;
}

function SceneCard({ scene, gm }) {
  const [img, setImg] = useState('');
  const cid = useStore(app, (s) => s.cid);
  useEffect(() => {
    setImg('');
    if (scene?.fileId) fileUrl(cid, scene.fileId).then(setImg);
  }, [scene?.fileId]);
  const edit = async () => {
    const r = await openModal(({ close }) => html`<${SceneForm} close=${close} scene=${scene} />`, { title: 'Szene setzen', icon: 'image', size: 'lg' });
    if (!r) return;
    await updateCampaign({ scene: r.clear ? null : { ...r, ts: now() } });
  };
  if (!scene) {
    return gm ? html`<div class="card"><${Empty} icon="image" title="Keine Szene gesetzt" action=${html`<${Btn} icon="image" onClick=${edit}>Szene setzen<//>`}>Zeig deinen Spielern ein Bild und einen Vorlesetext – live auf allen Geräten.<//></div>` : null;
  }
  return html`<div class="scene-card">
    ${img ? html`<img class="scene-img" src=${img} alt="" onClick=${() => openLightbox(img)} style="cursor:zoom-in" />` : null}
    <div class="scene-body">
      <div class="row"><h2 class="serif" style="margin:0">${scene.title || 'Szene'}</h2><span class="grow"></span>${gm ? html`<${IconBtn} icon="pencil" title="Szene ändern" onClick=${edit} />` : null}</div>
      ${scene.body ? html`<${MarkdownView} src=${scene.body} />` : null}
    </div>
  </div>`;
}

// ───────────────────────── Gruppe & Initiative ─────────────────────────
function PartyStrip() {
  const cid = useStore(app, (s) => s.cid);
  const [party, setParty] = useState([]);
  useEffect(() => watchParty(setParty), [cid]);
  if (!party.length) return null;
  return html`<div class="party-strip">${party.map(({ owner, char: c }) => {
    const pct = Math.max(0, Math.min(100, ((c.hp ?? 0) / (c.maxHp || 1)) * 100));
    return html`<div class="party-card" key=${c.id} onClick=${() => openView('character', { id: c.id, owner, title: c.name })}>
      ${c.portrait ? html`<span class="avatar"><img src=${c.portrait} alt="" /></span>` : html`<${Avatar} name=${c.name} color=${c.color} />`}
      <div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${c.name}</b>
        <div class="hpbar"><div class=${pct > 50 ? '' : pct > 25 ? 'mid' : 'low'} style=${{ width: `${pct}%` }}></div></div>
        <div class="tiny faint">TP ${c.hp}/${c.maxHp} · RK ${c.ac}</div></div>
    </div>`;
  })}</div>`;
}

function InitiativeStrip() {
  const cid = useStore(app, (s) => s.cid);
  const pub = useDoc(cid ? col('combat') : null, 'public');
  const me = myUid();
  if (!pub?.active || !pub.list?.length) return null;
  const cur = pub.list.find((c) => c.id === pub.currentId);
  const mine = cur?.ownerUid === me;
  return html`<div class="card tight stack sm">
    <div class="row"><span class="round-badge">Runde ${pub.round}</span><b>Kampf</b><span class="grow"></span>
      ${mine ? html`<${Btn} kind="primary" size="sm" icon="check" onClick=${() => sendEvent({ type: 'endTurn' }).then(() => toast('Zug beendet', 'success'))}>Mein Zug ist fertig<//>` : null}
      <${Btn} size="sm" kind="ghost" icon="swords" onClick=${() => import('./maps.js').then((m) => m.openBattle())}>Zum Kampf<//></div>
    <div class="turn-strip">${pub.list.map((c) => html`<span class=${`turn-pill${c.id === pub.currentId ? ' current' : ''}${c.down ? ' down' : ''}`}>${c.init ?? '–'} · ${c.name}${c.hp != null ? ` (${c.hp})` : ''}</span>`)}</div>
  </div>`;
}

// ───────────────────────── Chat (rechte Seitenleiste) ─────────────────────────
export function ChatPanel({ active = true }) {
  const me = myUid();
  const gm = useStore(app, (s) => s.role === 'gm');
  const members = useStore(vault, (s) => s.members);
  const myChar = useMyChar();
  const msgs = useCol(col('chat'), { orderBy: ['ts', 'desc'], limit: 150 });
  const whispers = useCol(col('whispers'), gm ? { orderBy: ['ts', 'desc'], limit: 100 } : { where: [['participants', 'array-contains', me]] });
  const [text, setText] = useState('');
  const [to, setTo] = useState('');
  const [asChar, setAsChar] = useState(true);
  const logRef = useRef();
  const seen = useRef(0);
  const [unread, setUnread] = useState(0);
  const all = useMemo(() => sortBy([...(msgs || []).map((m) => ({ ...m, _w: false })), ...(whispers || []).map((m) => ({ ...m, _w: true }))], (m) => m.ts || 0), [msgs, whispers]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    const last = all[all.length - 1]?.ts || 0;
    if (!seen.current) seen.current = last;
    else if (last > seen.current && (document.hidden || !active)) setUnread((u) => u + 1);
  }, [all.length]);
  useEffect(() => {
    if (active) { setUnread(0); seen.current = all[all.length - 1]?.ts || seen.current; }
  }, [active]);
  useUnreadTitle(unread, active);

  const others = Object.values(members).filter((m) => m.uid !== me);
  const who = asChar && myChar ? myChar.name : '';
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    let kind = 'text';
    let rollData = null;
    let body = t;
    const m = /^\/(r|w|würfel)\s+(.+)$/i.exec(t);
    if (m) {
      const [expr, ...label] = m[2].split(/\s+(?=[^\d+\-dDwW%!khl])/);
      const r = doRoll(expr, { label: label.join(' '), share: false, silent: true, character: who });
      if (!r) return;
      kind = 'roll';
      body = label.join(' ');
      rollData = { input: r.input, expr: r.expr, total: r.total, text: r.text, crit: r.crit, fumble: r.fumble, label: r.label };
    }
    const base = { uid: me, name: myName(), character: who, kind, text: body, roll: rollData, ts: now() };
    const target = gm ? to : to || '';
    try {
      if (target) {
        const participants = [...new Set([me, ...(target === 'gm' ? gmUids() : [target])])];
        await db.add(col('whispers'), { ...base, from: me, to: target, participants });
      } else await db.add(col('chat'), base);
      setText('');
    } catch (e) {
      toast(`Senden fehlgeschlagen: ${e.message}`, 'error');
    }
  };
  const clearChat = async () => {
    if (!(await confirmDialog('Den gesamten Chat-Verlauf löschen?', { danger: true, ok: 'Löschen' }))) return;
    await db.removeCollection(col('chat'));
    await db.removeCollection(col('whispers'));
  };
  const nameOf = (uid) => members[uid]?.name || 'Unbekannt';

  return html`<div class="chat-panel">
    <div class="row" style="padding:8px 12px;border-bottom:1px solid var(--border)"><b class="grow"><${Icon} name="message" size=${16} /> Chat & Würfel</b>
      ${gm ? html`<${IconBtn} icon="trash" title="Chat leeren" onClick=${clearChat} />` : null}</div>
    <div class="chat-log" ref=${logRef}>
      ${!all.length ? html`<div class="small faint center" style="margin:auto">Noch nichts los. Tipp: <code>/r 1d20+5 Angriff</code> würfelt für alle sichtbar.</div>` : null}
      ${all.map((m) => {
        const mine = m.uid === me;
        if (m.kind === 'system') return html`<div class="chat-msg system" key=${m.id}>${m.text}</div>`;
        return html`<div class=${`chat-msg${mine ? ' mine' : ''}${m._w ? ' whisper' : ''}`} key=${m.id}>
          <${Avatar} name=${m.character || m.name} size="sm" />
          <div class="body">
            <div class="who">${m.character ? `${m.character} (${m.name})` : m.name}<span class="when">${fmtTime(m.ts)}</span>${m._w ? html`<span class="badge accent">🤫 ${m.to === 'gm' ? 'an SL' : mine ? `an ${nameOf(m.to)}` : 'geflüstert'}</span>` : null}</div>
            ${m.kind === 'roll' && m.roll ? html`<div class="chat-roll"><span class=${`roll-total${m.roll.crit ? ' crit' : m.roll.fumble ? ' fumble' : ''}`}>${m.roll.total}</span><span class="small"><b>${m.roll.label || m.text || m.roll.input}</b><br /><span class="mono faint" dangerouslySetInnerHTML=${{ __html: rollHtml(m.roll.text) }} /></span></div>` : html`<${MarkdownView} src=${m.text} />`}
          </div>
        </div>`;
      })}
    </div>
    <div class="chat-input" style="flex-direction:column;align-items:stretch">
      <div class="row small" style="gap:6px">
        ${gm ? html`<${Select} class="sm" value=${to} onChange=${setTo} options=${[{ value: '', label: 'An alle' }, ...others.map((o) => ({ value: o.uid, label: `🤫 an ${o.name}` }))]} style="width:170px" />`
          : html`<${Toggle} checked=${to === 'gm'} onChange=${(v) => setTo(v ? 'gm' : '')} label="🤫 nur an SL" />`}
        ${myChar ? html`<${Toggle} checked=${asChar} onChange=${setAsChar} label=${`als ${myChar.name}`} />` : null}
        <span class="grow"></span>
        <${IconBtn} icon="d20" title="W20 würfeln" onClick=${() => setText('/r 1d20 ')} />
      </div>
      <div class="row nowrap" style="gap:6px;align-items:flex-end">
        <textarea class="textarea" rows="1" value=${text} placeholder="Nachricht … (/r 2d6+3 für Würfe)" onInput=${(e) => setText(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
        <${DictateButton} onText=${(t) => setText(`${text}${text ? ' ' : ''}${t}`)} />
        <${Btn} kind="primary" icon="send" onClick=${send} />
      </div>
    </div>
  </div>`;
}

// ───────────────────────── Play-by-Post ─────────────────────────
function PlayByPost({ active }) {
  const cid = useStore(app, (s) => s.cid);
  const campaign = useStore(app, (s) => s.campaign);
  const members = useStore(vault, (s) => s.members);
  const gm = useStore(app, (s) => s.role === 'gm');
  const me = myUid();
  const myChar = useMyChar();
  const posts = useCol(col('posts'), { orderBy: ['ts', 'asc'], limit: 400 });
  const [kind, setKind] = useState(gm ? 'narration' : 'action');
  const [text, setText] = useState('');
  const [asName, setAsName] = useState('');
  const [rollExpr, setRollExpr] = useState('');
  const [editId, setEditId] = useState(null);
  const endRef = useRef();
  const waiting = campaign?.pbpWaiting || [];
  const players = Object.values(members).filter((m) => m.role === 'player');
  const myTurn = waiting.includes(me);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [posts?.length]);
  const lastSeen = useRef(0);
  useEffect(() => {
    if (!posts?.length) return;
    const last = posts[posts.length - 1];
    if (lastSeen.current && last.ts > lastSeen.current && last.uid !== me && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Weltenschmiede – neuer Beitrag', { body: `${last.as || last.name}: ${String(last.text).slice(0, 120)}`, icon: 'icons/icon.svg' }); } catch { /* ignore */ }
    }
    lastSeen.current = last.ts;
  }, [posts?.length]);

  const setWaiting = (uids) => updateCampaign({ pbpWaiting: uids });
  const post = async () => {
    if (!text.trim() && !rollExpr.trim()) return;
    let r = null;
    if (rollExpr.trim()) {
      r = doRoll(rollExpr.trim(), { label: 'Play-by-Post', share: false, silent: true });
      if (!r) return;
    }
    const data = {
      uid: me, name: myName(), as: asName.trim() || (kind === 'action' && myChar ? myChar.name : ''), kind, text: text.trim(),
      roll: r ? { input: r.input, total: r.total, text: r.text, crit: r.crit, fumble: r.fumble } : null, ts: now(),
    };
    try {
      if (editId) {
        await db.update(col('posts'), editId, { text: data.text, as: data.as, edited: now() });
        setEditId(null);
      } else await db.add(col('posts'), data);
      if (!gm && myTurn && !editId) await db.update('campaigns', cid, { pbpWaiting: waiting.filter((x) => x !== me) });
      setText('');
      setRollExpr('');
    } catch (e) {
      toast(`Konnte nicht posten: ${e.message}`, 'error');
    }
  };
  const postMenu = (e, p) => openMenu(e, [
    { label: 'Bearbeiten', icon: 'pencil', onClick: () => { setEditId(p.id); setText(p.text); setAsName(p.as || ''); setKind(p.kind); } },
    { label: 'Löschen', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog('Beitrag löschen?', { danger: true, ok: 'Löschen' })) db.remove(col('posts'), p.id); } },
  ]);
  const notify = async () => {
    if (!('Notification' in window)) return toast('Dein Browser unterstützt keine Benachrichtigungen.', 'error');
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Benachrichtigungen aktiv (solange die App offen ist)' : 'Benachrichtigungen abgelehnt', p === 'granted' ? 'success' : 'error');
  };

  return html`<div class="page narrow stack">
    <div class=${`waiting-for${myTurn ? ' me' : ''}`}>
      <${Icon} name="hourglass" size=${16} />
      ${waiting.length ? html`<span>Warte auf: ${waiting.map((u) => html`<b style="margin-right:6px">${members[u]?.name || '?'}</b>`)}</span>` : html`<span>Niemand ist gerade am Zug – freies Spiel.</span>`}
      ${myTurn ? html`<span class="badge players">Du bist dran!</span>` : null}
      <span class="grow"></span>
      <${IconBtn} icon="info" title="Benachrichtigungen aktivieren" onClick=${notify} />
    </div>
    ${gm ? html`<div class="row small"><span class="muted">Wer ist dran?</span>
      ${players.map((p) => html`<button type="button" class=${`chip${waiting.includes(p.uid) ? ' selected' : ' suggest'}`} onClick=${() => setWaiting(waiting.includes(p.uid) ? waiting.filter((x) => x !== p.uid) : [...waiting, p.uid])}>${p.name}</button>`)}
      <${Btn} size="sm" kind="ghost" onClick=${() => setWaiting(players.map((p) => p.uid))}>Alle<//><${Btn} size="sm" kind="ghost" onClick=${() => setWaiting([])}>Niemand<//></div>` : null}

    ${!posts ? html`<div class="empty"><span class="spinner" /></div>` : !posts.length ? html`<${Empty} icon="feather" title="Die Geschichte beginnt …">${gm ? 'Schreibe die erste Erzählung und wähle, wer als Nächstes dran ist.' : 'Warte auf die erste Erzählung der Spielleitung.'}<//>` : null}
    ${(posts || []).map((p) => html`<div class=${`post ${p.kind}`} key=${p.id}>
      <div class="post-head">
        ${p.kind === 'narration' ? html`<${Icon} name="scroll" size=${15} /><b>Erzählung</b>` : html`<${Avatar} name=${p.as || p.name} size="sm" /><b>${p.as || p.name}</b>${p.as ? html`<span class="faint">(${p.name})</span>` : null}${p.kind === 'ooc' ? html`<span class="badge">OOC</span>` : null}`}
        <span class="faint">${fmtRelative(p.ts)}${p.edited ? ' · bearbeitet' : ''}</span>
        <span class="grow"></span>
        ${p.uid === me || gm ? html`<${IconBtn} icon="more-horizontal" size=${15} class="sm" onClick=${(e) => postMenu(e, p)} />` : null}
      </div>
      ${p.text ? html`<${MarkdownView} src=${p.text} />` : null}
      ${p.roll ? html`<div class="chat-roll"><span class=${`roll-total${p.roll.crit ? ' crit' : p.roll.fumble ? ' fumble' : ''}`}>${p.roll.total}</span><span class="mono small faint" dangerouslySetInnerHTML=${{ __html: rollHtml(p.roll.text) }} /></div>` : null}
    </div>`)}
    <div ref=${endRef}></div>

    <div class="card stack">
      <div class="row">
        <${Segmented} value=${kind} onChange=${setKind} options=${gm ? [{ value: 'narration', label: 'Erzählung', icon: 'scroll' }, { value: 'action', label: 'NPC spricht', icon: 'mask' }, { value: 'ooc', label: 'OOC' }] : [{ value: 'action', label: 'Aktion', icon: 'user' }, { value: 'ooc', label: 'OOC' }]} />
        ${kind === 'action' ? html`<input class="input sm" style="width:180px" value=${asName} onInput=${(e) => setAsName(e.target.value)} placeholder=${gm ? 'NPC-Name' : myChar?.name || 'als …'} />` : null}
      </div>
      <${AutoTextarea} value=${text} minRows=${3} onInput=${(e) => setText(e.target.value)} placeholder=${kind === 'narration' ? 'Was geschieht? (Markdown, [[Links]], > [!vorlesen] …)' : 'Was tust du? Was sagst du?'} />
      <div class="row">
        <input class="input sm mono" style="width:170px" value=${rollExpr} onInput=${(e) => setRollExpr(e.target.value)} placeholder="Wurf, z. B. 1d20+4" />
        <${DictateButton} onText=${(t) => setText(`${text}${text ? ' ' : ''}${t}`)} />
        <span class="grow"></span>
        ${editId ? html`<${Btn} kind="ghost" onClick=${() => { setEditId(null); setText(''); }}>Abbrechen<//>` : null}
        <${Btn} kind="primary" icon="send" onClick=${post}>${editId ? 'Speichern' : myTurn ? 'Posten & Zug beenden' : 'Posten'}<//>
      </div>
    </div>
  </div>`;
}

// ───────────────────────── Handouts ─────────────────────────
function HandoutForm({ close }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [fileId, setFileId] = useState(null);
  const [busy, setBusy] = useState(false);
  return html`<div class="modal-body stack">
    <${Field} label="Aus Notiz (optional)"><${NotePicker} onPick=${(n) => { setTitle(n.title); setBody(n.body || ''); }} /><//>
    <${Field} label="Titel"><input class="input" value=${title} onInput=${(e) => setTitle(e.target.value)} /><//>
    <${Field} label="Inhalt"><${AutoTextarea} value=${body} minRows=${5} onInput=${(e) => setBody(e.target.value)} /><//>
    <div class="row"><${Btn} icon="image" loading=${busy} onClick=${async () => { const [f] = await pickFiles({ accept: 'image/*' }); if (!f) return; setBusy(true); try { setFileId((await uploadImage(f, { visibility: 'players', folder: 'Handouts', maxDim: 2400 })).id); } finally { setBusy(false); } }}>${fileId ? 'Bild ersetzen' : 'Bild (Karte, Brief …)'}<//>${fileId ? html`<span class="badge players">Bild angehängt</span>` : null}</div>
    <div class="btn-row end"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" icon="send" disabled=${!title.trim()} onClick=${() => close({ title, body, fileId })}>An Spieler senden<//></div>
  </div>`;
}

function HandoutCard({ h, gm }) {
  const cid = useStore(app, (s) => s.cid);
  const [img, setImg] = useState('');
  useEffect(() => { if (h.fileId) fileUrl(cid, h.fileId).then(setImg); }, [h.fileId]);
  return html`<div class="card stack">
    <div class="row"><${Icon} name="scroll" size=${18} class="accent-text" /><b class="grow">${h.title}</b><span class="small faint">${fmtRelative(h.ts)}</span>
      ${gm ? html`<${IconBtn} icon="trash" class="danger" title="Löschen" onClick=${async () => { if (await confirmDialog(`Handout „${h.title}“ löschen?`, { danger: true, ok: 'Löschen' })) db.remove(col('handouts'), h.id); }} />` : null}</div>
    ${img ? html`<img src=${img} alt="" style="border-radius:10px;cursor:zoom-in;max-height:420px;object-fit:contain" onClick=${() => openLightbox(img)} />` : null}
    ${h.body ? html`<${MarkdownView} src=${h.body} />` : null}
  </div>`;
}

function Handouts() {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const list = useVisibleCol('handouts');
  const create = async () => {
    const r = await openModal(({ close }) => html`<${HandoutForm} close=${close} />`, { title: 'Neues Handout', icon: 'scroll', size: 'lg' });
    if (r) await db.add(col('handouts'), { ...r, visibility: 'players', ts: now(), by: myUid() });
  };
  return html`<div class="page narrow stack">
    ${gm ? html`<div class="row"><span class="grow small muted">Handouts sehen alle Spieler sofort – Briefe, Karten, Rückblicke.</span><${Btn} kind="primary" icon="plus" onClick=${create}>Neues Handout<//></div>` : null}
    ${!list ? html`<div class="empty"><span class="spinner" /></div>` : !list.length ? html`<${Empty} icon="scroll" title="Noch keine Handouts" />` : sortBy(list, (h) => h.ts || 0, -1).map((h) => html`<${HandoutCard} key=${h.id} h=${h} gm=${gm} />`)}
  </div>`;
}

export function HandoutsView({ tabId }) {
  return html`<${ViewFrame} tabId=${tabId} title="Handouts"><${Handouts} /><//>`;
}

// ───────────────────────── Ansicht ─────────────────────────
export function TableView({ tabId, active }) {
  const mode = useStore(app, (s) => s.mode);
  const campaign = useStore(app, (s) => s.campaign);
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const [tab, setTab] = useState('live');
  // Der Chat wohnt in der rechten Seitenleiste – am Spieltisch (PC/Tablet) direkt aufklappen
  useEffect(() => { if (active && tab === 'live' && !isMobile()) showRightPanel('chat'); }, [active]);
  return html`<${ViewFrame} tabId=${tabId} title="Spieltisch"
    actions=${html`<${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'live', label: 'Szene', icon: 'image' }, { value: 'pbp', label: 'Play-by-Post', icon: 'feather' }, { value: 'handouts', label: 'Handouts', icon: 'scroll' }]} />`}>
    ${mode !== 'cloud' ? html`<div class="callout callout-orange small" style="margin:10px 16px">Nur auf diesem Gerät – damit Mitspieler mitmachen können, richte die Cloud ein (Einstellungen → Cloud).</div>` : null}
    ${tab === 'live' ? html`<div class="page stack">
      <div class="card row chat-hint"><${Icon} name="message" size=${18} class="accent-text" /><span class="grow small muted">Chat & Würfe sind jetzt in der rechten Seitenleiste – so hast du sie auf jeder Seite der App dabei (Karte, Bogen, Codex …).</span><${Btn} size="sm" icon="message" onClick=${() => showRightPanel('chat')}>Chat öffnen<//></div>
      <${SceneCard} scene=${campaign?.scene} gm=${gm} />
      <${InitiativeStrip} />
      <${PartyStrip} />
    </div>` : tab === 'pbp' ? html`<${PlayByPost} active=${active} />` : html`<${Handouts} />`}
  <//>`;
}
