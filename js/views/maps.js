// Karten-Werkstatt: Weltkarten mit Pins (auch automatisch aus „(Blau 2)“-Farbcodes) und Battlemaps
// mit Gelände-Pinsel, Generatoren, Tokens, Nebel des Krieges und Maßband. Live synchron für alle Mitspieler.
import { html, useState, useEffect, useRef, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, vault, col, myUid, getIndex, noteById, isGM, visFields } from '../core/app.js';
import { db } from '../core/db.js';
import { openView, openNote } from '../core/workspace.js';
import { settings } from '../core/settings.js';
import { fileUrl, saveDataUrl, deleteFile, updateFileMeta } from '../core/files.js';
import { generateImage } from '../core/ai.js';
import { colorCode, pinColorFor, PIN_COLORS } from '../core/groups.js';
import { loadParty } from '../core/party.js';
import { loadCombat } from '../core/combat.js';
import { CELL, TERRAIN, TERRAIN_KEYS, GENERATORS, resizeCells } from '../data/mapgen.js';
import { ViewFrame } from '../ui/frame.js';
import {
  Icon, IconBtn, Btn, Field, Select, Segmented, Toggle, MarkdownView, NotePicker, openModal, promptDialog, confirmDialog, toast, Empty,
  pickFiles, AutoTextarea, ModelPicker,
} from '../ui/components.js';
import { useCol, useDoc, useVisibleCol } from '../core/hooks.js';
import { now, debounce, initials, colorFromString, sortBy } from '../lib/util.js';
import { uploadImage } from './codex.js';
import { DungeonMapView, newScrawlMap, SCRAWL_GENERATORS, STYLES } from './mapeditor.js';
import { detectGrid, evenGrid } from '../lib/gridfind.js';

const cssVar = (n, fb) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;

// ───────────────────────── Kartenliste ─────────────────────────
function MapCard({ m, gm }) {
  const cid = useStore(app, (s) => s.cid);
  const [thumb, setThumb] = useState(m.type === 'scrawl' ? m.thumb || '' : '');
  useEffect(() => {
    if (m.type === 'scrawl') setThumb(m.thumb || '');
    else if (m.fileId) fileUrl(cid, m.fileId).then(setThumb);
  }, [m.fileId, m.thumb]);
  return html`<div class="card click" onClick=${() => openView('map', { id: m.id, title: m.name })}>
    <div class="map-card-img" style=${thumb ? { backgroundImage: `url(${thumb})` } : {}}>${thumb ? null : html`<${Icon} name=${m.type === 'battle' ? 'grid' : m.type === 'scrawl' ? 'castle' : 'map'} size=${34} />`}</div>
    <div class="row nowrap"><b class="grow ellipsis">${m.name}</b>
      <span class="badge">${m.type === 'scrawl' ? `Dungeon ${m.w}×${m.h}` : m.type === 'battle' ? `Rasterkarte ${m.cols}×${m.rows}` : 'Weltkarte'}</span>
      ${gm ? html`<span class=${`badge ${m.visibility === 'players' ? 'players' : 'gm'}`}>${m.visibility === 'players' ? 'sichtbar' : 'SL'}</span>` : null}</div>
  </div>`;
}

function NewBattleForm({ close }) {
  const [f, setF] = useState({ name: 'Neue Battlemap', cols: 30, rows: 20, gen: 'dungeon', image: null, imageName: '' });
  const pick = async () => {
    const [file] = await pickFiles({ accept: 'image/*' });
    if (file) setF({ ...f, image: file, imageName: file.name, gen: f.gen === 'dungeon' ? 'nichts' : f.gen });
  };
  return html`<form onSubmit=${(e) => { e.preventDefault(); close(f); }}><div class="modal-body stack">
    <${Field} label="Name"><input class="input" value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} autoFocus /><//>
    <div class="grid two" style="gap:8px">
      <${Field} label="Spalten (Felder à 1,5 m / 5 ft)"><input class="input" type="number" min="5" max="120" value=${f.cols} onInput=${(e) => setF({ ...f, cols: Math.max(5, Math.min(120, Number(e.target.value))) })} /><//>
      <${Field} label="Zeilen"><input class="input" type="number" min="5" max="120" value=${f.rows} onInput=${(e) => setF({ ...f, rows: Math.max(5, Math.min(120, Number(e.target.value))) })} /><//>
    </div>
    <${Field} label="Startgelände"><${Select} value=${f.gen} onChange=${(v) => setF({ ...f, gen: v })} options=${Object.entries(GENERATORS).map(([k, g]) => ({ value: k, label: g.label }))} /><//>
    <div class="row"><${Btn} icon="image" onClick=${pick}>${f.image ? 'Anderes Bild' : 'Hintergrundbild (optional)'}<//>${f.imageName ? html`<span class="small muted">${f.imageName}</span>` : null}</div>
  </div><div class="modal-foot"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" type="submit" icon="grid">Erstellen<//></div></form>`;
}

function NewScrawlForm({ close }) {
  const [f, setF] = useState({ name: 'Neue Karte', w: 36, h: 26, style: 'real', gen: 'dungeon' });
  return html`<form onSubmit=${(e) => { e.preventDefault(); close(f); }}><div class="modal-body stack">
    <${Field} label="Name"><input class="input" value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} autoFocus /><//>
    <div class="grid two" style="gap:8px">
      <${Field} label="Spalten (Felder à 1,5 m / 5 ft)"><input class="input" type="number" min="8" max="150" value=${f.w} onInput=${(e) => setF({ ...f, w: Math.max(8, Math.min(150, Number(e.target.value) || 36)) })} /><//>
      <${Field} label="Zeilen"><input class="input" type="number" min="8" max="150" value=${f.h} onInput=${(e) => setF({ ...f, h: Math.max(8, Math.min(150, Number(e.target.value) || 26)) })} /><//>
    </div>
    <${Field} label="Stil"><div class="style-pick">${Object.entries(STYLES).map(([k, sv]) => html`<button type="button" class=${f.style === k ? 'active' : ''} onClick=${() => setF({ ...f, style: k })}><span class="sw" style=${{ background: `linear-gradient(135deg, ${sv.bg} 0 45%, ${sv.floor} 45% 70%, ${sv.wall} 70%)` }}></span>${sv.label}</button>`)}</div><//>
    <${Field} label="Start" hint="Generierte Karten kannst du danach frei weiterbauen."><div class="chips">${Object.entries(SCRAWL_GENERATORS).map(([k, g]) => html`<button type="button" class=${`chip${f.gen === k ? ' selected' : ' suggest'}`} onClick=${() => setF({ ...f, gen: k })}>${g.label}</button>`)}</div><//>
  </div><div class="modal-foot"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" type="submit" icon="castle">Erstellen<//></div></form>`;
}


// ───────────────────────── Bildkarte: fertiges Kartenbild mit erkanntem Raster ─────────────────────────
function ImageMapForm({ close }) {
  const [file, setFile] = useState(null);
  const [img, setImg] = useState(null);
  const [g, setG] = useState(null);
  const [name, setName] = useState('Neue Bildkarte');
  const [note, setNote] = useState('');
  const cvRef = useRef();
  const pick = async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      setFile(f);
      setImg(im);
      setName(f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 60) || 'Bildkarte');
      try {
        const found = detectGrid(im);
        setG(found);
        setNote(found.sure ? `Raster erkannt: ${found.cols} × ${found.rows} Felder à ${Math.round(found.cell)} px` : 'Kein klares Raster gefunden – bitte Felder selbst einstellen.');
        if (!found.sure) setG(evenGrid(im.naturalWidth, im.naturalHeight, 30));
      } catch (e) {
        setG(evenGrid(im.naturalWidth, im.naturalHeight, 30));
        setNote(`Rastersuche fehlgeschlagen (${e.message}) – bitte selbst einstellen.`);
      }
    };
    im.onerror = () => toast('Bild konnte nicht gelesen werden', 'error');
    im.src = url;
  };
  const upd = (patch) => setG((cur) => {
    const n = { ...cur, ...patch };
    if (patch.cell || patch.ox != null || patch.oy != null) {
      n.cols = Math.max(1, Math.round((n.w - n.ox) / n.cell));
      n.rows = Math.max(1, Math.round((n.h - n.oy) / n.cell));
    } else if (patch.cols) n.cell = Math.max(4, (n.w - n.ox) / patch.cols);
    else if (patch.rows) n.cell = Math.max(4, (n.h - n.oy) / patch.rows);
    if (patch.cols || patch.rows) {
      n.cols = Math.max(1, Math.round((n.w - n.ox) / n.cell));
      n.rows = Math.max(1, Math.round((n.h - n.oy) / n.cell));
    }
    n.cell = Math.round(n.cell * 100) / 100;
    return n;
  });
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv || !img || !g) return;
    const maxW = 460;
    const k = Math.min(1, maxW / img.naturalWidth);
    cv.width = Math.round(img.naturalWidth * k);
    cv.height = Math.round(img.naturalHeight * k);
    const c = cv.getContext('2d');
    c.drawImage(img, 0, 0, cv.width, cv.height);
    c.strokeStyle = 'rgba(255,60,60,.85)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = g.ox; x <= img.naturalWidth + 0.5; x += g.cell) { c.moveTo(Math.round(x * k) + 0.5, 0); c.lineTo(Math.round(x * k) + 0.5, cv.height); }
    for (let y = g.oy; y <= img.naturalHeight + 0.5; y += g.cell) { c.moveTo(0, Math.round(y * k) + 0.5); c.lineTo(cv.width, Math.round(y * k) + 0.5); }
    c.stroke();
  }, [img, g]);
  const num = (label, value, onChange, step = 1) => html`<${Field} label=${label}>
    <input class="input" type="number" step=${step} value=${value} onInput=${(e) => onChange(Number(e.target.value))} /><//>`;
  return html`<div class="modal-body stack">
    ${!img ? html`<div class="stack">
      <div class="small">Lade ein fertiges Kartenbild (z. B. von Forgotten Adventures, Crosshead, Dungeon Alchemist oder KI-gemalt). Das Raster wird automatisch gesucht – du kannst es danach anpassen. Alle gängigen Bildformate funktionieren.</div>
      <${Btn} kind="primary" icon="image" onClick=${pick}>Bild wählen<//>
    </div>` : html`
      <${Field} label="Name"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} /><//>
      <div class="row small"><span class="muted grow">${note}</span><${Btn} size="sm" kind="ghost" icon="image" onClick=${pick}>Anderes Bild<//></div>
      <canvas ref=${cvRef} style="width:100%;max-width:460px;border-radius:10px;border:1px solid var(--border);align-self:center" />
      ${g ? html`<div class="grid two" style="gap:8px">
        ${num('Spalten', g.cols, (v) => upd({ cols: Math.max(1, v) }))}
        ${num('Zeilen', g.rows, (v) => upd({ rows: Math.max(1, v) }))}
        ${num('Feldgröße (px)', g.cell, (v) => upd({ cell: Math.max(4, v) }), 0.5)}
        <${Field} label="Versatz X / Y (px)"><div class="row nowrap">
          <input class="input" type="number" step="0.5" value=${g.ox} onInput=${(e) => upd({ ox: Number(e.target.value) })} />
          <input class="input" type="number" step="0.5" value=${g.oy} onInput=${(e) => upd({ oy: Number(e.target.value) })} />
        </div><//>
      </div>
      <div class="btn-row"><${Btn} size="sm" kind="ghost" icon="target" onClick=${() => { const f = detectGrid(img); setG(f); setNote(f.sure ? `Raster erkannt: ${f.cols} × ${f.rows} Felder` : 'Kein klares Raster gefunden.'); }}>Raster erneut suchen<//>
        <${Btn} size="sm" kind="ghost" icon="grid" onClick=${() => setG(evenGrid(img.naturalWidth, img.naturalHeight, 30))}>Gleichmäßig (30 Felder)<//></div>
      <div class="tiny faint">Ein Feld = 1,5 m / 5 ft. Die roten Linien sollten auf dem Raster des Bildes liegen – sonst Feldgröße und Versatz nachstellen. Du kannst später Wände, Licht, Objekte und Nebel darüberlegen.</div>` : null}
    `}
  </div><div class="modal-foot">
    <${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//>
    <${Btn} kind="primary" icon="castle" disabled=${!img || !g} onClick=${() => close({ file, name, g })}>Karte erstellen<//>
  </div>`;
}

function AiMapForm({ close }) {
  const [p, setP] = useState('');
  const [kind, setKind] = useState('world');
  const [model, setModel] = useState(null);
  return html`<div class="modal-body stack">
    <${Segmented} value=${kind} onChange=${setKind} options=${[{ value: 'world', label: 'Welt-/Regionalkarte' }, { value: 'battle', label: 'Battlemap (Draufsicht)' }]} />
    <${AutoTextarea} value=${p} minRows=${4} onInput=${(e) => setP(e.target.value)} placeholder=${kind === 'world' ? 'z. B. Handgezeichnete Fantasy-Karte einer Küstenregion mit Pfahldorf, Leuchtturm, Salzwiesen und Klippen im Norden …' : 'z. B. Verfallene Tempelruine im Dschungel, Draufsicht, Säulen, Wasserbecken …'} />
    <div class="row"><${ModelPicker} task="image" value=${model} onChange=${setModel} /></div>
    <div class="btn-row end"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" icon="sparkles" disabled=${!p.trim()} onClick=${() => close({ p, kind, model })}>Malen lassen<//></div>
  </div>`;
}

// ───────────────────────── Kampf: direkt auf die Kampfkarte ─────────────────────────
function BattlePicker({ close }) {
  const maps = useVisibleCol('maps');
  const dungeons = sortBy((maps || []).filter((m) => m.type === 'scrawl'), (m) => m.updatedAt || m.createdAt || 0, -1);
  return html`<div class="modal-body stack">
    <div class="small muted">Wähle die Karte, auf der gekämpft wird. Dort setzt du Gruppe und Monster und startest mit „Kampf starten“ die Initiative – Bewegung, Reichweiten und Zauberflächen inklusive.</div>
    ${!maps ? html`<div class="empty"><span class="spinner" /></div>`
      : dungeons.length ? html`<div class="battle-pick">${dungeons.map((m) => html`<button type="button" class="bp-card" onClick=${() => close({ id: m.id, title: m.name })}>
          <span class="bp-img" style=${m.thumb ? { backgroundImage: `url(${m.thumb})` } : {}}>${m.thumb ? null : html`<${Icon} name="castle" size=${28} />`}</span>
          <b class="ellipsis">${m.name}</b><span class="tiny faint">${m.w}×${m.h} Felder</span></button>`)}</div>`
      : html`<div class="small faint">Noch keine Dungeon-Karte – leg eine an, dann kann es losgehen.</div>`}
    <div class="btn-row">
      <${Btn} kind="primary" icon="plus" onClick=${() => close('new')}>Neue Kampfkarte<//>
      <span class="grow"></span>
      <${Btn} kind="ghost" icon="list" onClick=${() => close('tracker')}>Ohne Karte (nur Initiative-Liste)<//>
    </div>
  </div>`;
}

// Läuft ein Kampf auf einer Karte, geht es direkt dorthin – sonst wählt die SL die Karte.
export async function openBattle() {
  const gm = isGM();
  let mapId = null;
  let active = false;
  try {
    if (gm) {
      const st = await loadCombat();
      mapId = st.mapId || null;
      active = !!st.active;
    } else {
      const pub = await db.get(col('combat'), 'public');
      mapId = pub?.mapId || null;
      active = !!pub?.active;
    }
  } catch { /* noch kein Kampf */ }
  if (mapId) {
    const m = await db.get(col('maps'), mapId).catch(() => null);
    if (m) { openView('map', { id: mapId, title: m.name, play: 1 }); return; }
  }
  if (!gm) {
    if (active) openView('combat');
    else toast('Gerade läuft kein Kampf. Sobald die Spielleitung einen startet, bringt dich „Kampf“ direkt auf die Kampfkarte.', 'info');
    return;
  }
  const r = await openModal(({ close }) => html`<${BattlePicker} close=${close} />`, { title: 'Wo wird gekämpft?', icon: 'swords', size: 'lg' });
  if (!r) return;
  if (r === 'tracker') { openView('combat'); return; }
  if (r === 'new') {
    const f = await openModal(({ close }) => html`<${NewScrawlForm} close=${close} />`, { title: 'Neue Kampfkarte', icon: 'castle' });
    if (!f) return;
    const id = await db.add(col('maps'), newScrawlMap(f));
    openView('map', { id, title: f.name });
    return;
  }
  openView('map', { id: r.id, title: r.title, play: 1 });
}

export function MapsView({ tabId }) {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const cid = useStore(app, (s) => s.cid);
  const maps = useVisibleCol('maps');
  const [busy, setBusy] = useState('');

  const createWorld = async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    setBusy('world');
    try {
      const meta = await uploadImage(f, { folder: 'Karten', visibility: 'gm', maxDim: 3400 });
      const id = await db.add(col('maps'), { name: f.name.replace(/\.[^.]+$/, ''), type: 'world', fileId: meta.id, w: meta.w, h: meta.h, visibility: 'gm', scale: null, createdAt: now() });
      openView('map', { id, title: f.name });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };
  const createBattle = async () => {
    const r = await openModal(({ close }) => html`<${NewBattleForm} close=${close} />`, { title: 'Neue Battlemap', icon: 'grid' });
    if (!r) return;
    let fileId = null;
    if (r.image) fileId = (await uploadImage(r.image, { folder: 'Karten', visibility: 'gm', maxDim: 3400 })).id;
    const cells = GENERATORS[r.gen].fn(r.cols, r.rows);
    const id = await db.add(col('maps'), { name: r.name, type: 'battle', cols: r.cols, rows: r.rows, cells, fog: { enabled: false, revealed: '0'.repeat(r.cols * r.rows) }, grid: true, fileId, terrainAlpha: fileId ? 0.55 : 1, visibility: 'gm', createdAt: now() });
    openView('map', { id, title: r.name });
  };
  const createScrawl = async () => {
    const r = await openModal(({ close }) => html`<${NewScrawlForm} close=${close} />`, { title: 'Neue Karte', icon: 'castle' });
    if (!r) return;
    const id = await db.add(col('maps'), newScrawlMap(r));
    openView('map', { id, title: r.name });
  };
  // Bildkarte: Bild hochladen, Raster erkennen, als bespielbare Karte anlegen
  const createImageMap = async () => {
    const r = await openModal(({ close }) => html`<${ImageMapForm} close=${close} />`, { title: 'Karte aus Bild', icon: 'image', size: 'lg' });
    if (!r) return;
    setBusy('img');
    try {
      const meta = await uploadImage(r.file, { folder: 'Karten', visibility: 'gm', maxDim: 4600 });
      const k = meta.w && r.g.w ? meta.w / r.g.w : 1;   // beim Hochladen evtl. verkleinert
      const doc = newScrawlMap({ name: r.name, w: r.g.cols, h: r.g.rows, style: 'bild', gen: 'leer' });
      doc.fileId = meta.id;
      doc.bgFit = { cell: Math.round(r.g.cell * k * 100) / 100, ox: Math.round(r.g.ox * k * 100) / 100, oy: Math.round(r.g.oy * k * 100) / 100 };
      doc.bgAlpha = 1;
      const id = await db.add(col('maps'), doc);
      openView('map', { id, title: r.name });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };
  const createAi = async () => {
    const r = await openModal(({ close }) => html`<${AiMapForm} close=${close} />`, { title: 'Karte per KI malen', icon: 'sparkles' });
    if (!r) return;
    setBusy('ai');
    try {
      const style = r.kind === 'world' ? 'Fantasy-Landkarte, Pergament-Stil, handgezeichnet, Draufsicht, ohne Beschriftung' : 'Top-down Battlemap für Tabletop-Rollenspiele, Draufsicht, 5-Fuß-Raster-tauglich, ohne Text';
      const img = await generateImage({ prompt: `${style}. ${r.p}`, model: r.model, aspect: '16:9' });
      const meta = await saveDataUrl(cid, img.dataUrl, { folder: 'Karten', visibility: 'gm', maxDim: 3400, createdBy: myUid() });
      const data = r.kind === 'world'
        ? { name: r.p.slice(0, 40), type: 'world', fileId: meta.id, w: meta.w, h: meta.h, visibility: 'gm', createdAt: now() }
        : { name: r.p.slice(0, 40), type: 'battle', cols: 32, rows: 18, cells: ' '.repeat(32 * 18), fog: { enabled: false, revealed: '0'.repeat(32 * 18) }, grid: true, fileId: meta.id, terrainAlpha: 0.55, visibility: 'gm', createdAt: now() };
      const id = await db.add(col('maps'), data);
      openView('map', { id, title: data.name });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  return html`<${ViewFrame} tabId=${tabId} title="Karten">
    <div class="page wide stack lg">
      <div class="page-head"><h1><${Icon} name="map" size=${24} />Karten</h1><span class="grow"></span>
        ${gm ? html`<${Btn} kind="primary" icon="castle" onClick=${createScrawl}>Kartenwerkstatt<//><${Btn} icon="image" loading=${busy === 'img'} onClick=${createImageMap}>Karte aus Bild<//><${Btn} icon="map" loading=${busy === 'world'} onClick=${createWorld}>Weltkarte hochladen<//><${Btn} icon="sparkles" loading=${busy === 'ai'} onClick=${createAi}>Per KI malen<//><${Btn} kind="ghost" icon="grid" onClick=${createBattle}>Einfache Rasterkarte<//>` : null}
        <span class="sub">${gm ? 'Kartenwerkstatt: Räume, Gänge und Gelände aufziehen – texturierte Böden, Wände und Licht entstehen automatisch, dazu über 300 Objekte, Streu-Pinsel, Tokens und Nebel. Weltkarten mit verlinkten Pins (Farbcodes wie „(Blau 2)“ werden erkannt). Spieler sehen nur, was du freigibst.' : 'Karten, die die Spielleitung freigegeben hat.'}</span></div>
      ${!maps ? html`<div class="empty"><span class="spinner" /></div>` : !maps.length ? html`<${Empty} icon="map" title="Noch keine Karten">${gm ? 'Lade deine Weltkarte hoch oder erstelle eine Battlemap.' : 'Die Spielleitung hat noch keine Karte freigegeben.'}<//>`
        : html`<div class="grid cards">${sortBy(maps, (m) => m.createdAt || 0, -1).map((m) => html`<${MapCard} key=${m.id} m=${m} gm=${gm} />`)}</div>`}
    </div>
  <//>`;
}

// ───────────────────────── Einzelne Karte ─────────────────────────
function PinForm({ close, pin }) {
  const [f, setF] = useState({ label: '', noteId: null, color: PIN_COLORS.Rot, visibility: 'gm', ...pin });
  const note = f.noteId ? noteById(f.noteId) : null;
  return html`<form onSubmit=${(e) => { e.preventDefault(); close(f); }}><div class="modal-body stack">
    <${Field} label="Notiz verknüpfen">
      ${note ? html`<span class="chip accent">${note.title}<span class="x" onClick=${() => setF({ ...f, noteId: null })}><${Icon} name="x" size=${12} /></span></span>`
        : html`<${NotePicker} allowCreate onPick=${(n) => { const cc = colorCode(n.title); setF({ ...f, noteId: n.id, label: f.label || n.title, color: cc ? pinColorFor(cc.color) || f.color : f.color }); }} />`}
    <//>
    <${Field} label="Beschriftung"><input class="input" value=${f.label} onInput=${(e) => setF({ ...f, label: e.target.value })} /><//>
    <${Field} label="Farbe"><div class="color-pick">${Object.entries(PIN_COLORS).map(([n, c]) => html`<button type="button" title=${n} class=${f.color === c ? 'active' : ''} style=${{ background: c }} onClick=${() => setF({ ...f, color: c })}></button>`)}</div><//>
    <${Field} label="Sichtbarkeit"><${Segmented} value=${f.visibility} onChange=${(v) => setF({ ...f, visibility: v })} options=${[{ value: 'gm', label: 'Nur SL', icon: 'lock' }, { value: 'players', label: 'Für Spieler', icon: 'users' }]} /><//>
  </div><div class="modal-foot"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" type="submit" icon="map-pin">Speichern<//></div></form>`;
}

function TokenForm({ close, token, members }) {
  const [f, setF] = useState({ label: '', color: '#e0b24a', size: 1, ownerUid: '', visibility: 'players', ...token });
  return html`<form onSubmit=${(e) => { e.preventDefault(); if (f.label.trim()) close(f); }}><div class="modal-body stack">
    <${Field} label="Name"><input class="input" value=${f.label} onInput=${(e) => setF({ ...f, label: e.target.value, color: token?.color || colorFromString(e.target.value) })} autoFocus /><//>
    <div class="grid two" style="gap:8px">
      <${Field} label="Größe"><${Select} value=${String(f.size)} onChange=${(v) => setF({ ...f, size: Number(v) })} options=${[{ value: '0.5', label: 'Winzig/Klein' }, { value: '1', label: 'Mittelgroß (1 Feld)' }, { value: '2', label: 'Groß (2×2)' }, { value: '3', label: 'Riesig (3×3)' }, { value: '4', label: 'Gigantisch (4×4)' }]} /><//>
      <${Field} label="Darf bewegen"><${Select} value=${f.ownerUid || ''} onChange=${(v) => setF({ ...f, ownerUid: v })} options=${[{ value: '', label: 'Nur SL' }, ...members.map((m) => ({ value: m.uid, label: m.name }))]} /><//>
    </div>
    <${Field} label="Farbe"><div class="color-pick">${Object.values(PIN_COLORS).map((c) => html`<button type="button" class=${f.color === c ? 'active' : ''} style=${{ background: c }} onClick=${() => setF({ ...f, color: c })}></button>`)}</div><//>
    <${Toggle} checked=${f.visibility !== 'players'} onChange=${(v) => setF({ ...f, visibility: v ? 'gm' : 'players' })} label="Vor Spielern verborgen" />
  </div><div class="modal-foot">${token?.id ? html`<${Btn} kind="danger" icon="trash" onClick=${() => close({ _delete: true })}>Entfernen<//><span class="grow"></span>` : null}<${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" type="submit">Speichern<//></div></form>`;
}

function MapSettingsForm({ close, map }) {
  const members = Object.values(vault.get().members || {}).filter((x) => x.role !== 'gm');
  const [f, setF] = useState({ name: map.name, visibility: map.visibility, only: map.only || [], grid: map.grid !== false, cols: map.cols, rows: map.rows, terrainAlpha: map.terrainAlpha ?? 1, scaleText: map.scale ? `${map.scale.value} ${map.scale.unit}` : '' });
  return html`<div class="modal-body stack">
    <${Field} label="Name"><input class="input" value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /><//>
    <${Field} label="Sichtbarkeit"><${Segmented} value=${f.visibility} onChange=${(v) => setF({ ...f, visibility: v, only: v === 'gm' ? [] : f.only })} options=${[{ value: 'gm', label: 'Nur SL', icon: 'lock' }, { value: 'players', label: 'Spieler sehen die Karte', icon: 'users' }]} /><//>
    ${f.visibility === 'players' && members.length ? html`<${Field} label="Nur für bestimmte Mitspieler (leer = alle)">
      <div class="stack sm">${members.map((p) => html`<label key=${p.uid || p.id} class="row nowrap share-row">
        <input type="checkbox" checked=${f.only.includes(p.uid || p.id)} onChange=${() => { const id = p.uid || p.id; setF({ ...f, only: f.only.includes(id) ? f.only.filter((x) => x !== id) : [...f.only, id] }); }} />
        <span class="grow">${p.name || 'Mitspieler'}</span></label>`)}</div><//>` : null}
    ${map.type === 'battle' ? html`
      <div class="grid two" style="gap:8px">
        <${Field} label="Spalten"><input class="input" type="number" min="5" max="120" value=${f.cols} onInput=${(e) => setF({ ...f, cols: Number(e.target.value) })} /><//>
        <${Field} label="Zeilen"><input class="input" type="number" min="5" max="120" value=${f.rows} onInput=${(e) => setF({ ...f, rows: Number(e.target.value) })} /><//>
      </div>
      <${Toggle} checked=${f.grid} onChange=${(v) => setF({ ...f, grid: v })} label="Raster anzeigen" />
      ${map.fileId ? html`<div class="row small"><span class="muted" style="width:130px">Gelände-Deckkraft</span><input type="range" min="0" max="1" step="0.05" value=${f.terrainAlpha} style="flex:1;accent-color:var(--accent)" onInput=${(e) => setF({ ...f, terrainAlpha: Number(e.target.value) })} /></div>` : null}` : map.type === 'world' ? html`
      <div class="small muted">Maßstab: mit dem Maßband eine bekannte Strecke messen und hier eintragen, z. B. „50 km“.</div>` : null}
    <div class="btn-row"><${Btn} kind="danger" icon="trash" onClick=${() => close({ _delete: true })}>Karte löschen<//><span class="grow"></span><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" onClick=${() => close(f)}>Übernehmen<//></div>
  </div>`;
}

const TOOLS_GM_BATTLE = [
  ['pan', 'hand', 'Bewegen / verschieben'], ['paint', 'brush', 'Gelände malen'], ['erase', 'eraser', 'Radieren'],
  ['reveal', 'eye', 'Nebel aufdecken'], ['hide', 'eye-off', 'Nebel verdecken'], ['token', 'user-plus', 'Token setzen'], ['measure', 'ruler', 'Messen'],
];
const TOOLS_GM_WORLD = [['pan', 'hand', 'Bewegen'], ['pin', 'map-pin', 'Pin setzen'], ['measure', 'ruler', 'Messen']];
const TOOLS_PLAYER = [['pan', 'hand', 'Bewegen'], ['measure', 'ruler', 'Messen']];

// Dungeon-Karten (neuer Editor) bzw. Welt- und Rasterkarten
function ScrawlHost(props) {
  const { map } = props;
  const cid = useStore(app, (s) => s.cid);
  const settingsDialog = async () => {
    const r = await openModal(({ close }) => html`<${MapSettingsForm} close=${close} map=${map} />`, { title: 'Karteneinstellungen', icon: 'settings' });
    if (!r) return;
    if (r._delete) {
      if (!(await confirmDialog(`Karte „${map.name}“ mit allen Tokens löschen?`, { danger: true, ok: 'Löschen' }))) return;
      const toks = await db.list(col('tokens'), { where: [['mapId', '==', map.id]] }).catch(() => []);
      for (const t of toks) await db.remove(col('tokens'), t.id);
      if (map.fileId) await deleteFile(cid, map.fileId).catch(() => {});
      await db.remove(col('maps'), map.id);
      openView('maps', {}, { replace: true });
      return;
    }
    await db.update(col('maps'), map.id, { name: r.name, ...visFields(r.visibility, r.only || []) });
    if (map.fileId && r.visibility !== map.visibility) await updateFileMeta(cid, map.fileId, { visibility: r.visibility }).catch(() => {});
  };
  return html`<${DungeonMapView} ...${props} settingsDialog=${settingsDialog} />`;
}

export function MapView(props) {
  const cid = useStore(app, (s) => s.cid);
  const map = useDoc(cid ? col('maps') : null, props.params.id);
  if (map?.type === 'scrawl') return html`<${ScrawlHost} key=${map.id} ...${props} map=${map} />`;
  return html`<${LegacyMapView} ...${props} />`;
}

function LegacyMapView({ params, active, tabId }) {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  const cid = useStore(app, (s) => s.cid);
  const members = useStore(vault, (s) => s.members);
  const me = myUid();
  const map = useDoc(cid ? col('maps') : null, params.id);
  const role = useStore(app, (s) => s.role);
  const pinOpts = role === 'gm' ? { where: [['mapId', '==', params.id]] } : { where: [['mapId', '==', params.id], ['visibility', '==', 'players']] };
  const pinsRaw = useCol(cid ? col('pins') : null, pinOpts);
  const tokensRaw = useCol(cid ? col('tokens') : null, pinOpts);
  const pins = (pinsRaw || []).filter((p) => gm || p.visibility === 'players');
  const tokens = (tokensRaw || []).filter((t) => gm || t.visibility === 'players');
  const [tool, setTool] = useState('pan');
  const [brush, setBrush] = useState('w');
  const [brushSize, setBrushSize] = useState(1);
  const [pop, setPop] = useState(null);
  const [placing, setPlacing] = useState(null);
  const [side, setSide] = useState(false);
  const [measureText, setMeasureText] = useState('');
  const wrapRef = useRef();
  const cvRef = useRef();
  const S = useRef({ t: { x: 0, y: 0, k: 1 }, w: 0, h: 0, dpr: 1, userMoved: false, pointers: new Map(), dirty: true, fitted: false, img: null, cells: null, fog: null });
  const s = S.current;
  s.map = map;
  s.pins = pins;
  s.tokens = tokens;
  s.gm = gm;
  s.tool = tool;
  s.brush = brush;
  s.brushSize = brushSize;
  s.placing = placing;
  s.me = me;

  const battle = map?.type === 'battle';
  const W = battle ? (map?.cols || 1) * CELL : map?.w || s.img?.naturalWidth || 1000;
  const H = battle ? (map?.rows || 1) * CELL : map?.h || s.img?.naturalHeight || 700;
  s.W = W;
  s.H = H;

  // Zellen/Nebel aus dem Dokument übernehmen (außer während eigener Änderungen)
  useEffect(() => {
    if (!map || !battle) return;
    if (!s.localEdit) {
      s.cells = (map.cells || '').padEnd(map.cols * map.rows, ' ').split('');
      s.fog = (map.fog?.revealed || '').padEnd(map.cols * map.rows, '0').split('');
    }
    s.dirty = true;
  }, [map?.cells, map?.fog?.revealed, map?.cols, map?.rows]);
  useEffect(() => { s.dirty = true; }, [pinsRaw, tokensRaw, gm, map?.grid, map?.fog?.enabled, map?.terrainAlpha]);

  // Hintergrundbild
  useEffect(() => {
    s.img = null;
    s.dirty = true;
    if (!map?.fileId) return;
    fileUrl(cid, map.fileId).then((u) => {
      if (!u) return;
      const img = new Image();
      img.onload = () => {
        s.img = img;
        s.fitted = false;
        s.dirty = true;
      };
      img.src = u;
    });
  }, [map?.fileId]);

  const saveMap = useMemo(() => debounce(async () => {
    if (!s.cells) return;
    await db.update(col('maps'), params.id, { cells: s.cells.join(''), fog: { ...(s.map?.fog || {}), revealed: s.fog.join('') } }).catch((e) => toast(e.message, 'error'));
    s.localEdit = false;
  }, 500), [params.id]);

  // Die Karte bleibt immer teilweise im Bild: nur so weit verschieben, dass noch Karte zu sehen ist
  s.clampView = () => {
    if (!s.W || !s.H || s.w < 10) return;
    const mw = s.W * s.t.k;
    const mh = s.H * s.t.k;
    const kx = Math.min(mw, Math.max(80, s.w * 0.3));
    const ky = Math.min(mh, Math.max(80, s.h * 0.3));
    s.t.x = Math.min(s.w - kx, Math.max(kx - mw, s.t.x));
    s.t.y = Math.min(s.h - ky, Math.max(ky - mh, s.t.y));
  };
  const fit = () => {
    if (s.w < 10) return;
    const k = Math.min((s.w - 40) / s.W, (s.h - 40) / s.H);
    s.t.k = Math.max(0.05, Math.min(4, k));
    s.t.x = (s.w - s.W * s.t.k) / 2;
    s.t.y = (s.h - s.H * s.t.k) / 2;
    s.fitted = true;
    s.userMoved = false;
    s.dirty = true;
  };

  useEffect(() => {
    const el = wrapRef.current;
    const cv = cvRef.current;
    if (!el || !cv) return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      s.w = r.width;
      s.h = r.height;
      s.dpr = dpr;
      if (!s.fitted || !s.userMoved) fit();
      s.dirty = true;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!map]);

  // Zeichnen
  useEffect(() => {
    if (!active || !map) return undefined;
    let raf;
    const loop = () => {
      if (!s.fitted && s.w > 10 && (!map.fileId || s.img || battle)) fit();
      if (s.dirty) {
        draw();
        s.dirty = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, !!map]);

  function draw() {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const { k, x: tx, y: ty } = s.t;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, s.w, s.h);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(k, k);
    const m = s.map;
    if (s.img) ctx.drawImage(s.img, 0, 0, s.W, s.H);
    else if (!battle) {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, s.W, s.H);
    }
    if (battle && s.cells) {
      const cols = m.cols;
      ctx.globalAlpha = s.img ? m.terrainAlpha ?? 0.55 : 1;
      for (let i = 0; i < s.cells.length; i++) {
        const c = s.cells[i];
        if (c === ' ' || !TERRAIN[c]) continue;
        const x = (i % cols) * CELL;
        const y = Math.floor(i / cols) * CELL;
        ctx.fillStyle = TERRAIN[c].color;
        ctx.fillRect(x, y, CELL + 0.5, CELL + 0.5);
        if (c === 't') {
          ctx.fillStyle = '#1f4d27';
          ctx.beginPath(); ctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.38, 0, Math.PI * 2); ctx.fill();
        } else if (c === 'o') {
          ctx.fillStyle = '#5a3a1c';
          ctx.fillRect(x + CELL * 0.2, y + CELL * 0.35, CELL * 0.6, CELL * 0.3);
        } else if (c === 'p') {
          ctx.fillStyle = '#6a655c';
          ctx.fillRect(x + CELL * 0.18, y + CELL * 0.18, CELL * 0.64, CELL * 0.64);
        } else if (c === 's') {
          ctx.strokeStyle = '#5b5446'; ctx.lineWidth = 3;
          for (let j = 1; j < 5; j++) { ctx.beginPath(); ctx.moveTo(x + 6, y + (j * CELL) / 5); ctx.lineTo(x + CELL - 6, y + (j * CELL) / 5); ctx.stroke(); }
        } else if (c === 'd') {
          ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y); ctx.moveTo(x, y + CELL / 2); ctx.lineTo(x + CELL / 2, y); ctx.moveTo(x + CELL / 2, y + CELL); ctx.lineTo(x + CELL, y + CELL / 2); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      if (m.grid !== false) {
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
        ctx.lineWidth = 1 / k;
        ctx.beginPath();
        for (let x = 0; x <= m.cols; x++) { ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, s.H); }
        for (let y = 0; y <= m.rows; y++) { ctx.moveTo(0, y * CELL); ctx.lineTo(s.W, y * CELL); }
        ctx.stroke();
      }
    }
    // Tokens
    if (battle) {
      for (const t of s.tokens) {
        if (!s.gm && m.fog?.enabled && s.fog && s.fog[Math.floor(t.y) * m.cols + Math.floor(t.x)] !== '1') continue;
        const size = t.size || 1;
        const cx = (t.dragX ?? t.x) * CELL + (CELL * size) / 2;
        const cy = (t.dragY ?? t.y) * CELL + (CELL * size) / 2;
        const r = (CELL * size) / 2 - 4;
        ctx.globalAlpha = t.visibility === 'players' ? 1 : 0.6;
        ctx.fillStyle = t.color || '#e0b24a';
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = t.ownerUid === s.me ? '#fff' : 'rgba(0,0,0,.6)'; ctx.stroke();
        ctx.fillStyle = '#111';
        ctx.font = `700 ${Math.max(12, r * 0.8)}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(initials(t.label).slice(0, 2), cx, cy + 1);
        ctx.globalAlpha = 1;
      }
    }
    // Nebel
    if (battle && m.fog?.enabled && s.fog) {
      ctx.fillStyle = s.gm ? 'rgba(0,0,0,.5)' : '#000';
      for (let i = 0; i < s.fog.length; i++) {
        if (s.fog[i] === '1') continue;
        ctx.fillRect((i % m.cols) * CELL - 0.5, Math.floor(i / m.cols) * CELL - 0.5, CELL + 1, CELL + 1);
      }
    }
    // Pins
    if (!battle) {
      const r = 9 / k;
      ctx.font = `600 ${13 / k}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const p of s.pins) {
        const x = p.dragX ?? p.x;
        const y = p.dragY ?? p.y;
        ctx.globalAlpha = p.visibility === 'players' || !s.gm ? 1 : 0.75;
        ctx.fillStyle = p.color || '#ff5a5a';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 2.5 / k; ctx.strokeStyle = '#fff'; ctx.stroke();
        if (k > 0.35 || s.hoverPin === p.id) {
          const label = p.label || '';
          ctx.lineWidth = 3.5 / k; ctx.strokeStyle = 'rgba(0,0,0,.75)';
          ctx.strokeText(label, x, y + r + 3 / k);
          ctx.fillStyle = '#fff';
          ctx.fillText(label, x, y + r + 3 / k);
        }
      }
      ctx.globalAlpha = 1;
    }
    // Maßband
    if (s.measure) {
      const { a, b } = s.measure;
      ctx.strokeStyle = cssVar('--gold', '#e0b24a');
      ctx.lineWidth = 3 / k;
      ctx.setLineDash([10 / k, 6 / k]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // Eingabe
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv || !map) return undefined;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const toWorld = (p) => ({ x: (p.x - s.t.x) / s.t.k, y: (p.y - s.t.y) / s.t.k });
    const cellAt = (w) => {
      const m = s.map;
      const cx = Math.floor(w.x / CELL);
      const cy = Math.floor(w.y / CELL);
      return cx >= 0 && cy >= 0 && cx < m.cols && cy < m.rows ? [cx, cy] : null;
    };
    const hitPin = (w) => s.pins.find((p) => Math.hypot(p.x - w.x, p.y - w.y) < 14 / s.t.k);
    const hitToken = (w) => [...s.tokens].reverse().find((t) => w.x >= t.x * CELL && w.x < (t.x + (t.size || 1)) * CELL && w.y >= t.y * CELL && w.y < (t.y + (t.size || 1)) * CELL);
    const canMove = (t) => s.gm || t.ownerUid === s.me;
    const zoomAt = (p, f) => {
      const k = Math.min(8, Math.max(0.03, s.t.k * f));
      const real = k / s.t.k;
      s.t.x = p.x - (p.x - s.t.x) * real;
      s.t.y = p.y - (p.y - s.t.y) * real;
      s.t.k = k;
      s.clampView();
      s.userMoved = true;
      s.dirty = true;
    };
    const paintCell = (w) => {
      const c = cellAt(w);
      if (!c || !s.cells) return;
      const m = s.map;
      const r = s.brushSize - 1;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = c[0] + dx;
          const y = c[1] + dy;
          if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) continue;
          const i = y * m.cols + x;
          if (s.tool === 'paint') s.cells[i] = s.brush;
          else if (s.tool === 'erase') s.cells[i] = ' ';
          else if (s.tool === 'reveal') s.fog[i] = '1';
          else if (s.tool === 'hide') s.fog[i] = '0';
        }
      }
      s.localEdit = true;
      s.dirty = true;
      saveMap();
    };
    const distText = (a, b) => {
      const m = s.map;
      if (m.type === 'battle') {
        const cells = Math.max(Math.abs(Math.floor(b.x / CELL) - Math.floor(a.x / CELL)), Math.abs(Math.floor(b.y / CELL) - Math.floor(a.y / CELL)));
        return settings.get().units === 'ft' ? `${cells * 5} ft (${cells} Felder)` : `${(cells * 1.5).toLocaleString('de-DE')} m (${cells} Felder)`;
      }
      const px = Math.hypot(b.x - a.x, b.y - a.y);
      if (m.scale?.px) return `${((px / m.scale.px) * m.scale.value).toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${m.scale.unit}`;
      return `${Math.round(px)} px – Maßstab in den Karteneinstellungen festlegen`;
    };

    const down = (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e);
      s.pointers.set(e.pointerId, p);
      setPop(null);
      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        s.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: s.t.k };
        s.act = null;
        return;
      }
      const w = toWorld(p);
      const tl = s.tool;
      if (e.button === 1 || e.button === 2) {
        s.act = { kind: 'pan', sx: p.x, sy: p.y, tx: s.t.x, ty: s.t.y, moved: false };
        return;
      }
      if (tl === 'measure') { s.measure = { a: w, b: w }; s.act = { kind: 'measure' }; s.dirty = true; return; }
      if (s.map.type === 'battle' && ['paint', 'erase', 'reveal', 'hide'].includes(tl) && s.gm) { s.act = { kind: 'paint' }; paintCell(w); return; }
      if (s.map.type === 'battle') {
        const t = hitToken(w);
        if (t && canMove(t) && tl === 'pan') { s.act = { kind: 'token', t, off: { x: w.x / CELL - t.x, y: w.y / CELL - t.y }, moved: false, sx: p.x, sy: p.y }; return; }
      } else {
        const pin = hitPin(w);
        if (pin && tl === 'pan') { s.act = { kind: 'pin', pin, moved: false, sx: p.x, sy: p.y }; return; }
      }
      s.act = { kind: 'pan', sx: p.x, sy: p.y, tx: s.t.x, ty: s.t.y, moved: false, w };
    };
    const move = (e) => {
      const p = pos(e);
      if (s.pointers.has(e.pointerId)) s.pointers.set(e.pointerId, p);
      if (s.pinch && s.pointers.size >= 2) {
        const [a, b] = [...s.pointers.values()];
        zoomAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, (s.pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / s.pinch.d)) / s.t.k);
        return;
      }
      const a = s.act;
      const w = toWorld(p);
      if (!a) {
        if (s.map.type !== 'battle' && e.pointerType === 'mouse') {
          const hp = hitPin(w);
          if ((hp?.id || null) !== (s.hoverPin || null)) { s.hoverPin = hp?.id || null; s.dirty = true; cv.style.cursor = hp ? 'pointer' : ''; }
        }
        return;
      }
      if (a.kind === 'measure') { s.measure.b = w; setMeasureText(distText(s.measure.a, w)); s.dirty = true; return; }
      if (a.kind === 'paint') { paintCell(w); return; }
      if (a.kind === 'token') {
        if (Math.hypot(p.x - a.sx, p.y - a.sy) > 4) a.moved = true;
        a.t.dragX = w.x / CELL - a.off.x;
        a.t.dragY = w.y / CELL - a.off.y;
        s.dirty = true;
        return;
      }
      if (a.kind === 'pin') {
        if (Math.hypot(p.x - a.sx, p.y - a.sy) > 5 && s.gm) a.moved = true;
        if (a.moved) { a.pin.dragX = w.x; a.pin.dragY = w.y; s.dirty = true; }
        return;
      }
      if (a.kind === 'pan') {
        const dx = p.x - a.sx;
        const dy = p.y - a.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) a.moved = true;
        s.t.x = a.tx + dx;
        s.t.y = a.ty + dy;
        s.clampView();
        s.userMoved = true;
        s.dirty = true;
      }
    };
    const up = async (e) => {
      const p = pos(e);
      s.pointers.delete(e.pointerId);
      if (s.pinch) { if (s.pointers.size < 2) s.pinch = null; return; }
      const a = s.act;
      s.act = null;
      if (!a) return;
      const w = toWorld(p);
      if (a.kind === 'token') {
        const t = a.t;
        if (a.moved) {
          const nx = Math.max(0, Math.min(s.map.cols - (t.size || 1), Math.round(t.dragX)));
          const ny = Math.max(0, Math.min(s.map.rows - (t.size || 1), Math.round(t.dragY)));
          delete t.dragX; delete t.dragY;
          t.x = nx; t.y = ny;
          s.dirty = true;
          await db.update(col('tokens'), t.id, { x: nx, y: ny }).catch((err) => toast(err.message, 'error'));
        } else if (s.gm) {
          editToken(t);
        }
        return;
      }
      if (a.kind === 'pin') {
        const pin = a.pin;
        if (a.moved) {
          const nx = pin.dragX; const ny = pin.dragY;
          delete pin.dragX; delete pin.dragY;
          pin.x = nx; pin.y = ny;
          await db.update(col('pins'), pin.id, { x: nx, y: ny });
        } else setPop({ pin, x: p.x, y: p.y });
        s.dirty = true;
        return;
      }
      if (a.kind === 'pan' && !a.moved) {
        if (s.placing && s.map.type !== 'battle') {
          const n = noteById(s.placing);
          const cc = colorCode(n?.title);
          await db.add(col('pins'), { mapId: params.id, x: w.x, y: w.y, label: n?.title || 'Pin', noteId: s.placing, color: pinColorFor(cc?.color) || PIN_COLORS.Rot, visibility: n?.visibility === 'players' ? 'players' : 'gm', createdAt: now() });
          setPlacing(null);
          return;
        }
        if (s.tool === 'pin' && s.gm && s.map.type !== 'battle') {
          const r = await openModal(({ close }) => html`<${PinForm} close=${close} />`, { title: 'Neuer Pin', icon: 'map-pin' });
          if (r) await db.add(col('pins'), { mapId: params.id, x: w.x, y: w.y, label: r.label || noteById(r.noteId)?.title || 'Pin', noteId: r.noteId || null, color: r.color, visibility: r.visibility, createdAt: now() });
          return;
        }
        if (s.tool === 'token' && s.gm && s.map.type === 'battle') {
          const c = cellAt(w);
          if (!c) return;
          const r = await openModal(({ close }) => html`<${TokenForm} close=${close} members=${Object.values(vault.get().members)} />`, { title: 'Token setzen', icon: 'user-plus' });
          if (r && !r._delete) await db.add(col('tokens'), { mapId: params.id, x: c[0], y: c[1], label: r.label, color: r.color, size: r.size, ownerUid: r.ownerUid || null, visibility: r.visibility, createdAt: now() });
        }
      }
    };
    const wheel = (e) => {
      e.preventDefault();
      zoomAt(pos(e), Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    const ctxmenu = (e) => e.preventDefault();
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('contextmenu', ctxmenu);
    return () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('wheel', wheel);
      cv.removeEventListener('contextmenu', ctxmenu);
    };
  }, [!!map, params.id]);

  const editToken = async (t) => {
    const r = await openModal(({ close }) => html`<${TokenForm} close=${close} token=${t} members=${Object.values(vault.get().members)} />`, { title: t.label, icon: 'user' });
    if (!r) return;
    if (r._delete) await db.remove(col('tokens'), t.id);
    else await db.update(col('tokens'), t.id, { label: r.label, color: r.color, size: r.size, ownerUid: r.ownerUid || null, visibility: r.visibility });
  };

  if (map === undefined) return html`<${ViewFrame} tabId=${tabId} title="Karte"><div class="empty"><span class="spinner lg" /></div><//>`;
  if (!map) return html`<${ViewFrame} tabId=${tabId} title="Karte"><${Empty} icon="map" title="Karte nicht gefunden" /><//>`;

  const settingsDialog = async () => {
    const r = await openModal(({ close }) => html`<${MapSettingsForm} close=${close} map=${map} />`, { title: 'Karteneinstellungen', icon: 'settings' });
    if (!r) return;
    if (r._delete) {
      if (!(await confirmDialog(`Karte „${map.name}“ mit allen Pins und Tokens löschen?`, { danger: true, ok: 'Löschen' }))) return;
      for (const p of pinsRaw || []) await db.remove(col('pins'), p.id);
      for (const t of tokensRaw || []) await db.remove(col('tokens'), t.id);
      if (map.fileId) await deleteFile(cid, map.fileId).catch(() => {});
      await db.remove(col('maps'), map.id);
      openView('maps', {}, { replace: true });
      return;
    }
    const patch = { name: r.name, ...visFields(r.visibility, r.only || []) };
    if (battle) {
      patch.grid = r.grid;
      patch.terrainAlpha = r.terrainAlpha;
      if (r.cols !== map.cols || r.rows !== map.rows) {
        patch.cols = Math.max(5, Math.min(120, r.cols));
        patch.rows = Math.max(5, Math.min(120, r.rows));
        patch.cells = resizeCells(s.cells.join(''), map.cols, map.rows, patch.cols, patch.rows, ' ');
        patch.fog = { ...(map.fog || {}), revealed: resizeCells(s.fog.join(''), map.cols, map.rows, patch.cols, patch.rows, '0') };
        s.fitted = false;
      }
    }
    await db.update(col('maps'), map.id, patch);
    if (map.fileId && r.visibility !== map.visibility) await updateFileMeta(cid, map.fileId, { visibility: r.visibility }).catch(() => {});
  };
  const setScale = async () => {
    if (!s.measure) return toast('Erst mit dem Maßband eine bekannte Strecke messen.', 'error');
    const px = Math.hypot(s.measure.b.x - s.measure.a.x, s.measure.b.y - s.measure.a.y);
    const v = await promptDialog('Wie lang ist die gemessene Strecke?', '', { title: 'Maßstab festlegen', placeholder: 'z. B. 50 km oder 3 Tagesreisen' });
    const m = /([\d.,]+)\s*(.*)/.exec(v || '');
    if (!m) return;
    await db.update(col('maps'), map.id, { scale: { px, value: parseFloat(m[1].replace(',', '.')), unit: m[2].trim() || 'km' } });
    toast('Maßstab gespeichert', 'success');
  };
  const regenerate = async (key) => {
    if (!(await confirmDialog(`Gelände durch „${GENERATORS[key].label}“ ersetzen?`, { ok: 'Ersetzen' }))) return;
    s.cells = GENERATORS[key].fn(map.cols, map.rows).split('');
    s.localEdit = true;
    s.dirty = true;
    saveMap();
  };
  const fogAll = (v) => {
    s.fog = new Array(map.cols * map.rows).fill(v);
    s.localEdit = true;
    s.dirty = true;
    saveMap();
  };
  const addPartyTokens = async () => {
    const party = await loadParty();
    let i = 0;
    for (const p of party) {
      if ((tokensRaw || []).some((t) => t.charId === p.char.id)) continue;
      await db.add(col('tokens'), { mapId: map.id, x: 1 + (i % 4), y: 1 + Math.floor(i / 4), label: p.char.name, color: p.char.color || colorFromString(p.char.name), size: 1, ownerUid: p.owner, charId: p.char.id, visibility: 'players', createdAt: now() });
      i++;
    }
    toast(i ? `${i} Tokens gesetzt` : 'Keine (neuen) Charaktere gefunden', i ? 'success' : 'error');
  };
  const addCombatTokens = async () => {
    const st = await loadCombat();
    let i = 0;
    for (const c of st.combatants) {
      if (c.isPC || (tokensRaw || []).some((t) => t.combatantId === c.id)) continue;
      await db.add(col('tokens'), { mapId: map.id, x: map.cols - 2 - (i % 5), y: 1 + Math.floor(i / 5), label: c.name, color: '#ef5a5f', size: 1, ownerUid: null, combatantId: c.id, visibility: c.hidden ? 'gm' : 'players', createdAt: now() });
      i++;
    }
    toast(i ? `${i} Gegner-Tokens gesetzt` : 'Keine Gegner im Kampf-Tracker', i ? 'success' : 'error');
  };

  const tools = gm ? (battle ? TOOLS_GM_BATTLE : TOOLS_GM_WORLD) : TOOLS_PLAYER;
  const tray = !battle && gm ? getIndex().notes.filter((n) => colorCode(n.title) && !pins.some((p) => p.noteId === n.id)) : [];
  const popNote = pop?.pin?.noteId ? noteById(pop.pin.noteId) : null;

  return html`<${ViewFrame} tabId=${tabId} title=${map.name} noScroll actions=${html`<div class="row nowrap" style="gap:2px">
      ${gm ? html`<button type="button" title="Sichtbarkeit" onClick=${settingsDialog}><span class=${`badge ${map.visibility === 'players' ? 'players' : 'gm'}`}>${map.visibility === 'players' ? 'Spieler sehen sie' : 'Nur SL'}</span></button>` : null}
      <${IconBtn} icon="maximize" title="Einpassen" onClick=${fit} />
      ${gm ? html`<${IconBtn} icon="panel-right" title="Werkzeuge" active=${side} onClick=${() => setSide(!side)} /><${IconBtn} icon="settings" title="Einstellungen" onClick=${settingsDialog} />` : null}
    </div>`}>
    <div class="map-stage" ref=${wrapRef}>
      <canvas ref=${cvRef}></canvas>
      <div class="map-toolbar">
        ${tools.map(([id, icon, label]) => html`<${IconBtn} icon=${icon} title=${label} active=${tool === id} onClick=${() => { setTool(id); setPlacing(null); if (id !== 'measure') { s.measure = null; setMeasureText(''); s.dirty = true; } }} />`)}
        <div class="sep"></div>
        <${IconBtn} icon="zoom-in" title="Hineinzoomen" onClick=${() => { const c = { x: s.w / 2, y: s.h / 2 }; const k = Math.min(8, s.t.k * 1.3); s.t.x = c.x - (c.x - s.t.x) * (k / s.t.k); s.t.y = c.y - (c.y - s.t.y) * (k / s.t.k); s.t.k = k; s.clampView(); s.userMoved = true; s.dirty = true; }} />
        <${IconBtn} icon="zoom-out" title="Herauszoomen" onClick=${() => { const c = { x: s.w / 2, y: s.h / 2 }; const k = Math.max(0.03, s.t.k / 1.3); s.t.x = c.x - (c.x - s.t.x) * (k / s.t.k); s.t.y = c.y - (c.y - s.t.y) * (k / s.t.k); s.t.k = k; s.clampView(); s.userMoved = true; s.dirty = true; }} />
      </div>
      ${measureText ? html`<div class="map-pop" style="left:60px;top:10px;width:auto"><${Icon} name="ruler" size=${14} /> <b>${measureText}</b>${!battle && gm ? html` <${Btn} size="sm" kind="ghost" onClick=${setScale}>Als Maßstab<//>` : null}</div>` : null}
      ${placing ? html`<div class="map-pop" style="left:50%;top:10px;transform:translateX(-50%);width:auto">Tippe auf die Karte, um „${noteById(placing)?.title}“ zu platzieren · <a href="#" onClick=${(e) => { e.preventDefault(); setPlacing(null); }}>Abbrechen</a></div>` : null}
      ${pop ? html`<div class="map-pop" style=${{ left: `${Math.min(pop.x + 12, s.w - 310)}px`, top: `${Math.min(pop.y + 12, s.h - 260)}px` }}>
        <div class="row nowrap"><span class="pin-dot" style=${{ background: pop.pin.color }}></span><b class="grow ellipsis">${pop.pin.label}</b><${IconBtn} icon="x" size=${14} class="sm" onClick=${() => setPop(null)} /></div>
        ${popNote ? html`<${MarkdownView} src=${(popNote.body || '').replace(/^---[\s\S]*?---\n/, '').slice(0, 700)} />` : html`<div class="small faint">Keine verknüpfte Notiz.</div>`}
        <div class="btn-row" style="margin-top:8px">
          ${popNote ? html`<${Btn} size="sm" kind="primary" icon="file-text" onClick=${() => openNote(popNote.id, { newTab: true })}>Öffnen<//>` : null}
          ${gm ? html`<${Btn} size="sm" icon="pencil" onClick=${async () => { const r = await openModal(({ close }) => html`<${PinForm} close=${close} pin=${pop.pin} />`, { title: 'Pin bearbeiten', icon: 'map-pin' }); setPop(null); if (r) await db.update(col('pins'), pop.pin.id, { label: r.label, noteId: r.noteId || null, color: r.color, visibility: r.visibility }); }}>Bearbeiten<//>
            <${IconBtn} icon="trash" class="danger" title="Pin löschen" onClick=${async () => { await db.remove(col('pins'), pop.pin.id); setPop(null); }} />` : null}
        </div>
      </div>` : null}
      ${side && gm ? html`<div class="map-side stack">
        ${battle ? html`
          <b>Gelände</b>
          <div class="color-pick">${TERRAIN_KEYS.map((k) => html`<button type="button" title=${TERRAIN[k].label} class=${brush === k ? 'active' : ''} style=${{ background: TERRAIN[k].color, borderRadius: '6px' }} onClick=${() => { setBrush(k); setTool('paint'); }}></button>`)}</div>
          <div class="small muted">${TERRAIN[brush]?.label}</div>
          <div class="row small"><span class="muted">Pinsel</span><${Segmented} value=${brushSize} onChange=${setBrushSize} options=${[{ value: 1, label: '1' }, { value: 2, label: '3' }, { value: 3, label: '5' }]} /></div>
          <b>Generieren</b>
          <div class="chips">${Object.entries(GENERATORS).map(([k, g]) => html`<button type="button" class="chip suggest" onClick=${() => regenerate(k)}>${g.label}</button>`)}</div>
          <b>Nebel des Krieges</b>
          <${Toggle} checked=${!!map.fog?.enabled} onChange=${(v) => db.update(col('maps'), map.id, { fog: { ...(map.fog || {}), revealed: s.fog.join(''), enabled: v } })} label="Nebel aktiv" />
          <div class="btn-row"><${Btn} size="sm" icon="eye" onClick=${() => fogAll('1')}>Alles aufdecken<//><${Btn} size="sm" icon="eye-off" onClick=${() => fogAll('0')}>Alles verdecken<//></div>
          <b>Tokens</b>
          <div class="btn-row"><${Btn} size="sm" icon="users" onClick=${addPartyTokens}>Gruppe<//><${Btn} size="sm" icon="sword" onClick=${addCombatTokens}>Gegner aus Kampf<//></div>
          <div class="tiny faint">Token antippen = bearbeiten · ziehen = bewegen. Spieler dürfen ihre eigenen Tokens bewegen.</div>
        ` : html`
          <b>Pins aus Farbcodes</b>
          <div class="small muted">Notizen wie „Hügelgrab (Blau 2)“ ohne Pin auf dieser Karte. Antippen und dann auf die Karte tippen.</div>
          ${tray.length ? html`<div class="chips">${tray.map((n) => html`<button type="button" class=${`chip${placing === n.id ? ' selected' : ''}`} onClick=${() => { setPlacing(n.id); setTool('pan'); }}><span class="pin-dot" style=${{ background: pinColorFor(colorCode(n.title).color) || '#ccc', width: '10px', height: '10px' }}></span>${n.title}</button>`)}</div>` : html`<div class="tiny faint">Alle Farbcode-Notizen sind platziert.</div>`}
          <b>Pins (${pins.length})</b>
          <div class="list">${sortBy(pins, 'label').map((p) => html`<div class="list-item" onClick=${() => { s.t.x = s.w / 2 - p.x * s.t.k; s.t.y = s.h / 2 - p.y * s.t.k; s.dirty = true; setPop({ pin: p, x: s.w / 2, y: s.h / 2 }); }}><span class="pin-dot" style=${{ background: p.color, width: '10px', height: '10px' }}></span><span class="title">${p.label}</span>${p.visibility === 'players' ? html`<${Icon} name="users" size=${12} />` : null}</div>`)}</div>
        `}
      </div>` : null}
    </div>
  <//>`;
}
