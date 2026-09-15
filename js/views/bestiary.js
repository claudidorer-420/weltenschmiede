// Bestiarium: Kompendium aller SRD-Monster (deutsch, mit Bildern) und die eigenen Statblocks der Kampagne.
// Monster lassen sich ins Bestiarium kopieren, in den Kampf schicken, als Notiz ablegen oder per KI illustrieren.
import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, col } from '../core/app.js';
import { db } from '../core/db.js';
import { openView } from '../core/workspace.js';
import { addToCombat, combatantsFromMonsters } from '../core/combat.js';
import { generateImage } from '../core/ai.js';
import { normalizeMonster } from '../ui/statblock.js';
import { useCol } from '../core/hooks.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, Btn, Statblock, toast, confirmDialog, Empty, useMedia, openModal } from '../ui/components.js';
import { MonsterArt, creatureType } from '../ui/art.js';
import { CREATURE_TYPES } from '../data/artmap.js';
import { crToNumber } from '../data/rules5e.js';
import { monsterToNote } from './encounter.js';
import { now } from '../lib/util.js';

const CR_BANDS = [['', 'Alle HG'], ['0-1', 'HG 0–1'], ['2-4', 'HG 2–4'], ['5-10', 'HG 5–10'], ['11-16', 'HG 11–16'], ['17-30', 'HG 17+']];

// KI-Bilder verkleinern (Firestore-Dokumente bleiben klein)
async function shrink(dataUrl, max = 448) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * k);
  cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/webp', 0.82);
}

function MonsterDetail({ m, src, busy, onCopy, onCombat, onNote, onPaint, onDelete }) {
  const t = creatureType(m.type);
  return html`<div class="best-detail stack">
    <div class="best-hero" style=${{ '--mc': t.color }}>
      <${MonsterArt} m=${m} size=${132} cr=${true} round=${false} />
      <div class="stack sm" style="min-width:0">
        <h2>${m.name}</h2>
        <div class="muted small">${[m.size, m.type].filter(Boolean).join(' ')}${m.alignment ? `, ${m.alignment}` : ''}</div>
        <div class="chips"><span class="badge gold">HG ${m.cr || '?'}</span><span class="badge">RK ${m.ac}</span><span class="badge">TP ${m.hp}</span>${m.speed ? html`<span class="badge">${m.speed}</span>` : null}</div>
        <div class="btn-row">
          <${Btn} size="sm" kind="primary" icon="sword" onClick=${onCombat}>In den Kampf<//>
          ${src === 'srd' ? html`<${Btn} size="sm" icon="plus" onClick=${onCopy}>Ins Bestiarium<//>` : null}
          <${Btn} size="sm" icon="file-text" onClick=${onNote}>Als Notiz<//>
          <${Btn} size="sm" icon="image" loading=${busy === 'img'} onClick=${onPaint} title="Porträt im D&D-Stil mit dem eingerichteten Bildmodell erzeugen">KI-Porträt<//>
          ${src === 'own' ? html`<${Btn} size="sm" kind="ghost" icon="trash" onClick=${onDelete}>Löschen<//>` : null}
        </div>
      </div>
    </div>
    <${Statblock} monster=${m} />
    ${src === 'srd' ? html`<div class="tiny faint">Aus dem System Reference Document 5.1 (deutsch) von Wizards of the Coast, CC-BY-4.0.</div>` : null}
  </div>`;
}

export function BestiaryView({ tabId }) {
  const cid = useStore(app, (s) => s.cid);
  const own = useCol(cid ? col('monsters') : null);
  const [srd, setSrd] = useState(null);
  const [src, setSrcRaw] = useState(() => localStorage.getItem('ws.bestSrc') || 'srd');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [cr, setCr] = useState('');
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState('');
  const wide = useMedia('(min-width: 1000px)');
  useEffect(() => { import('../data/monsters-srd.js').then((m) => setSrd(m.MONSTERS)); }, []);
  const setSrc = (v) => { setSrcRaw(v); localStorage.setItem('ws.bestSrc', v); };
  const list = src === 'srd' ? srd : own;
  const filtered = useMemo(() => (list || []).filter((m) => {
    if (q && !`${m.name} ${m.type || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (type && !CREATURE_TYPES.find((t) => t.name === type)?.re.test(m.type || '')) return false;
    if (cr) {
      const [a, b] = cr.split('-').map(Number);
      const v = crToNumber(m.cr);
      if (v < a || v > b) return false;
    }
    return true;
  }).sort((a, b) => crToNumber(a.cr) - crToNumber(b.cr) || a.name.localeCompare(b.name, 'de')), [list, q, type, cr]);
  const current = sel ? (list || []).find((m) => m.id === sel) : null;

  const copyToOwn = async (m) => {
    const { qty, ...rest } = normalizeMonster(m);
    const id = await db.add(col('monsters'), { ...rest, ...(m.image ? { image: m.image } : {}), srdId: m.id, createdAt: now() });
    toast(`„${m.name}“ ist jetzt in deinem Bestiarium`, 'success');
    return id;
  };
  const toCombat = async (m) => {
    await addToCombat(combatantsFromMonsters([m]));
    toast('Im Kampf-Tracker', 'success', { action: { label: 'Öffnen', onClick: () => openView('combat') } });
  };
  const paint = async (m) => {
    setBusy('img');
    try {
      const t = creatureType(m.type);
      const lore = m.description ? `. ${String(m.description).replace(/\s+/g, ' ').slice(0, 300)}` : '';
      const prompt = `Fantasy-Monsterporträt im Stil klassischer D&D-Illustrationen (Monster-Handbuch), gemalt, dramatisches Licht, dunkler stimmungsvoller Hintergrund, Kopf-und-Schulter-Ansicht, keine Schrift, kein Rahmen. Kreatur: ${m.name} (${[m.size, m.type || t.name].filter(Boolean).join(' ')})${lore}`;
      const r = await generateImage({ prompt, aspect: '1:1' });
      const image = await shrink(r.dataUrl);
      let id = m.id;
      if (src === 'srd') {
        id = await copyToOwn(m);
        setSrc('own');
      }
      await db.update(col('monsters'), id, { image });
      setSel(id);
      toast('Porträt erstellt', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };
  const remove = async (m) => {
    if (!(await confirmDialog(`„${m.name}“ aus dem Bestiarium löschen?`, { danger: true, ok: 'Löschen' }))) return;
    await db.remove(col('monsters'), m.id);
    setSel(null);
  };
  const detail = (m) => html`<${MonsterDetail} m=${m} src=${src} busy=${busy} onCopy=${() => copyToOwn(m).then((id) => { setSrc('own'); setSel(id); })}
    onCombat=${() => toCombat(m)} onNote=${() => monsterToNote(m)} onPaint=${() => paint(m)} onDelete=${() => remove(m)} />`;
  const select = (m) => {
    setSel(m.id);
    if (!wide) openModal(() => html`<div class="modal-body">${detail(m)}</div>`, { title: m.name, icon: 'ghost', size: 'lg' });
  };

  return html`<${ViewFrame} tabId=${tabId} title="Bestiarium">
    <div class="page wide">
      <div class="page-head"><h1><${Icon} name="ghost" size=${24} />Bestiarium</h1>
        <span class="sub">Alle Monster des SRD auf Deutsch plus deine eigenen Statblocks – mit Bild, bereit für Kampf-Tracker und Kampfkarte.</span></div>
      <div class=${`best-layout${current && wide ? ' with-detail' : ''}`}>
        <div class="stack">
          <div class="sm-tabs">
            <button type="button" class=${`sm-tab${src === 'srd' ? ' active' : ''}`} onClick=${() => { setSrc('srd'); setSel(null); }}>Kompendium (SRD) <span class="faint">${srd?.length || ''}</span></button>
            <button type="button" class=${`sm-tab${src === 'own' ? ' active' : ''}`} onClick=${() => { setSrc('own'); setSel(null); }}>Mein Bestiarium <span class="faint">${own?.length || 0}</span></button>
          </div>
          <div class="row">
            <div class="search-box grow" style="margin:0"><${Icon} name="search" size=${15} /><input class="input" placeholder="Suchen: Goblin, Drache, Untoter …" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
            <select class="select sm" style="width:auto" value=${type} onChange=${(e) => setType(e.target.value)}>
              <option value="">Alle Typen</option>${CREATURE_TYPES.map((t) => html`<option value=${t.name}>${t.name}</option>`)}
            </select>
            <select class="select sm" style="width:auto" value=${cr} onChange=${(e) => setCr(e.target.value)}>${CR_BANDS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
          </div>
          ${!list ? html`<div class="empty"><span class="spinner lg" /></div>`
            : !filtered.length ? html`<${Empty} icon="ghost" title=${src === 'own' ? 'Noch leer' : 'Nichts gefunden'}>${src === 'own' ? 'Kopiere Monster aus dem Kompendium oder speichere Statblocks aus dem Encounter-Generator.' : 'Andere Suche oder Filter probieren.'}<//>`
            : html`<div class="best-grid">${filtered.slice(0, 240).map((m) => html`<button type="button" key=${m.id} class=${`best-card${m.id === sel ? ' on' : ''}`} onClick=${() => select(m)}>
                <${MonsterArt} m=${m} size=${54} cr=${true} />
                <span class="bc-main"><b>${m.name}</b><small>${[m.size, m.type].filter(Boolean).join(' ')}</small><small>RK ${m.ac} · TP ${m.hp}</small></span>
              </button>`)}</div>`}
          ${filtered.length > 240 ? html`<div class="small faint">${filtered.length - 240} weitere – Suche oder Filter nutzen.</div>` : null}
          <div class="tiny faint">Monster: SRD 5.1 (deutsch) © Wizards of the Coast, CC-BY-4.0 · Symbole: game-icons.net (CC BY 3.0)</div>
        </div>
        ${current && wide ? html`<aside class="best-side">${detail(current)}</aside>` : null}
      </div>
    </div>
  <//>`;
}
