// Bestiarium: Kompendium aller SRD-Monster (deutsch, mit Bildern) und die eigenen Statblocks der Kampagne,
// unterteilt nach den Welten des Encounter-Generators (D&D, The Witcher, Herr der Ringe …).
// Monster lassen sich ins Bestiarium kopieren, in den Kampf schicken, als Notiz ablegen oder per KI illustrieren;
// fehlende Monster einer Welt erstellt der Encounter-Generator per KI.
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
import { ORIGINS, DND, ORIGIN_COLORS, originOf, originShort, namesFor, matchNames, hasNameList } from '../data/origins.js';
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

function MonsterDetail({ m, src, busy, onCopy, onCombat, onNote, onPaint, onDelete, onOrigin }) {
  const t = creatureType(m.type);
  return html`<div class="best-detail stack">
    <div class="best-hero" style=${{ '--mc': t.color }}>
      <${MonsterArt} m=${m} size=${132} cr=${true} round=${false} />
      <div class="stack sm" style="min-width:0">
        <h2>${m.name}</h2>
        <div class="muted small">${[m.size, m.type].filter(Boolean).join(' ')}${m.alignment ? `, ${m.alignment}` : ''}</div>
        <div class="chips"><span class="badge gold">HG ${m.cr || '?'}</span><span class="badge">RK ${m.ac}</span><span class="badge">TP ${m.hp}</span>${m.speed ? html`<span class="badge">${m.speed}</span>` : null}</div>
        ${src === 'own' ? html`<label class="row small nowrap" style="gap:6px"><span class="muted">Welt</span>
          <select class="select sm" style="width:auto;max-width:100%" value=${originOf(m)} onChange=${(e) => onOrigin(e.target.value)}>
            <option value="">– ohne –</option>${ORIGINS.map((o) => html`<option value=${o}>${o}</option>`)}
          </select></label>` : null}
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
  const [world, setWorldRaw] = useState(() => localStorage.getItem('ws.bestWorld') || '');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [cr, setCr] = useState('');
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState('');
  const [names, setNames] = useState(null);
  const wide = useMedia('(min-width: 1000px)');
  useEffect(() => { import('../data/monsters-srd.js').then((m) => setSrd(m.MONSTERS)); }, []);
  const setSrc = (v) => { setSrcRaw(v); localStorage.setItem('ws.bestSrc', v); };
  const setWorld = (v) => { setWorldRaw(v); localStorage.setItem('ws.bestWorld', v); setSel(null); };
  // Namensliste der gewählten Welt (für „noch nicht im Bestiarium“)
  useEffect(() => {
    let alive = true;
    setNames(null);
    if (src === 'own' && hasNameList(world)) namesFor(world).then((l) => alive && setNames(l)).catch(() => alive && setNames([]));
    return () => { alive = false; };
  }, [src, world]);
  const counts = useMemo(() => {
    const c = {};
    for (const m of own || []) {
      const o = originOf(m) || '';
      c[o] = (c[o] || 0) + 1;
    }
    return c;
  }, [own]);
  const list = src === 'srd' ? srd : own ? own.filter((m) => !world || (originOf(m) || '-') === world) : null;
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
  const missing = useMemo(() => {
    if (src !== 'own' || !names) return [];
    const have = new Set((own || []).map((m) => m.name.toLowerCase()));
    return matchNames(names.filter((n) => !have.has(n.name.toLowerCase())), q, 90);
  }, [names, own, q, src]);
  const current = sel ? (list || []).find((m) => m.id === sel) || null : null;

  const copyToOwn = async (m) => {
    const { qty, ...rest } = normalizeMonster(m);
    const id = await db.add(col('monsters'), { ...rest, ...(m.image ? { image: m.image } : {}), srdId: m.id, origin: DND, createdAt: now() });
    toast(`„${m.name}“ ist jetzt in deinem Bestiarium`, 'success');
    return id;
  };
  const toCombat = async (m) => {
    await addToCombat(combatantsFromMonsters([m]));
    toast('Im Kampf-Tracker', 'success', { action: { label: 'Zur Kampfkarte', onClick: () => import('./maps.js').then((x) => x.openBattle()) } });
  };
  const paint = async (m, from) => {
    setBusy('img');
    try {
      const t = creatureType(m.type);
      const lore = m.description ? `. ${String(m.description).replace(/\s+/g, ' ').slice(0, 300)}` : '';
      const world2 = originOf(m) && originOf(m) !== DND ? ` aus der Welt von ${originOf(m)}` : '';
      const prompt = `Fantasy-Monsterporträt im Stil klassischer D&D-Illustrationen (Monster-Handbuch), gemalt, dramatisches Licht, dunkler stimmungsvoller Hintergrund, Kopf-und-Schulter-Ansicht, keine Schrift, kein Rahmen. Kreatur: ${m.name}${world2} (${[m.size, m.type || t.name].filter(Boolean).join(' ')})${lore}`;
      const r = await generateImage({ prompt, aspect: '1:1' });
      const image = await shrink(r.dataUrl);
      let id = m.id;
      if (from === 'srd') {
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
  const detail = (m, from = src) => html`<${MonsterDetail} m=${m} src=${from} busy=${busy} onCopy=${() => copyToOwn(m).then((id) => { setSrc('own'); setSel(id); })}
    onCombat=${() => toCombat(m)} onNote=${() => monsterToNote(m)} onPaint=${() => paint(m, from)} onDelete=${() => remove(m)}
    onOrigin=${(o) => db.update(col('monsters'), m.id, { origin: o }).then(() => toast(o ? `Jetzt unter „${originShort(o)}“` : 'Ohne Welt', 'success'))} />`;
  const select = (m, from = src) => {
    setSel(m.id);
    if (!wide) openModal(() => html`<div class="modal-body">${detail(m, from)}</div>`, { title: m.name, icon: 'ghost', size: 'lg' });
  };
  // Fehlendes Monster: SRD-Statblock öffnen oder im Encounter-Generator per KI erstellen
  const fromName = (n) => {
    if (n.srd) {
      const m = (srd || []).find((x) => x.id === n.srd);
      setSrc('srd');
      if (m) select(m, 'srd');
      return;
    }
    openView('encounter', { preset: { name: n.name, origin: world, ts: Date.now() } });
  };

  return html`<${ViewFrame} tabId=${tabId} title="Bestiarium">
    <div class="page wide">
      <div class="page-head"><h1><${Icon} name="ghost" size=${24} />Bestiarium</h1>
        <span class="sub">Alle Monster des SRD auf Deutsch plus deine eigenen Statblocks – sortiert nach Welten wie im Encounter-Generator, mit Bild, bereit für Kampf-Tracker und Kampfkarte.</span></div>
      <div class=${`best-layout${current && wide ? ' with-detail' : ''}`}>
        <div class="stack">
          <div class="sm-tabs">
            <button type="button" class=${`sm-tab${src === 'srd' ? ' active' : ''}`} onClick=${() => { setSrc('srd'); setSel(null); }}>Kompendium (SRD) <span class="faint">${srd?.length || ''}</span></button>
            <button type="button" class=${`sm-tab${src === 'own' ? ' active' : ''}`} onClick=${() => { setSrc('own'); setSel(null); }}>Mein Bestiarium <span class="faint">${own?.length || 0}</span></button>
          </div>
          ${src === 'own' ? html`<div class="world-chips">
            <button type="button" class=${`world-chip${!world ? ' on' : ''}`} onClick=${() => setWorld('')}>Alle Welten <small>${own?.length || 0}</small></button>
            ${ORIGINS.map((o) => html`<button type="button" class=${`world-chip${world === o ? ' on' : ''}${counts[o] ? '' : ' none'}`} style=${{ '--c': ORIGIN_COLORS[o] }} title=${o} onClick=${() => setWorld(o)}><span class="od" />${originShort(o)} <small>${counts[o] || 0}</small></button>`)}
            ${counts[''] ? html`<button type="button" class=${`world-chip${world === '-' ? ' on' : ''}`} onClick=${() => setWorld('-')}>Ohne Welt <small>${counts['']}</small></button>` : null}
          </div>` : null}
          <div class="row">
            <div class="search-box grow" style="margin:0"><${Icon} name="search" size=${15} class="i" /><input class="input" placeholder="Suchen: Goblin, Drache, Untoter …" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
            <select class="select sm" style="width:auto" value=${type} onChange=${(e) => setType(e.target.value)}>
              <option value="">Alle Typen</option>${CREATURE_TYPES.map((t) => html`<option value=${t.name}>${t.name}</option>`)}
            </select>
            <select class="select sm" style="width:auto" value=${cr} onChange=${(e) => setCr(e.target.value)}>${CR_BANDS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
          </div>
          ${!list ? html`<div class="empty"><span class="spinner lg" /></div>`
            : !filtered.length ? html`<${Empty} icon="ghost" title=${src === 'own' ? (world && world !== '-' ? `Noch keine Monster aus ${originShort(world)}` : 'Noch leer') : 'Nichts gefunden'}>${src === 'own' ? (hasNameList(world) ? 'Unten findest du alle bekannten Monster dieser Welt – antippen, und der Encounter-Generator erstellt den Statblock.' : 'Kopiere Monster aus dem Kompendium oder speichere Statblocks aus dem Encounter-Generator.') : 'Andere Suche oder Filter probieren.'}<//>`
            : html`<div class="best-grid">${filtered.slice(0, 240).map((m) => {
                const o = src === 'own' && !world ? originOf(m) : '';
                return html`<button type="button" key=${m.id} class=${`best-card${m.id === sel ? ' on' : ''}`} onClick=${() => select(m)}>
                  <${MonsterArt} m=${m} size=${54} cr=${true} />
                  <span class="bc-main"><b>${m.name}</b><small>${[m.size, m.type].filter(Boolean).join(' ')}</small>
                    <small>RK ${m.ac} · TP ${m.hp}${o ? html` · <span class="bc-origin" style=${{ '--c': ORIGIN_COLORS[o] }}><span class="od" />${originShort(o)}</span>` : null}</small></span>
                </button>`;
              })}</div>`}
          ${filtered.length > 240 ? html`<div class="small faint">${filtered.length - 240} weitere – Suche oder Filter nutzen.</div>` : null}
          ${src === 'own' && hasNameList(world) ? html`<div class="card stack sm">
            <div class="row"><b class="grow">Aus ${world}: noch nicht in deinem Bestiarium</b><span class="small faint">${names ? `${missing.length}${missing.length >= 90 ? '+' : ''} Namen` : ''}</span></div>
            <div class="small muted">${world === DND ? 'SRD-Monster öffnen den offiziellen Statblock; alle anderen erstellt der Encounter-Generator per KI als 5e-Statblock.' : 'Antippen → der Encounter-Generator erstellt das Monster lore-getreu als 5e-Statblock; danach „Ins Bestiarium“ speichern.'}</div>
            ${!names ? html`<div class="empty"><span class="spinner" /></div>`
              : missing.length ? html`<div class="name-chips">${missing.map((n) => html`<button type="button" class="name-chip" title=${n.meta || ''} onClick=${() => fromName(n)}>${n.srd ? html`<span class="badge gold">SRD</span>` : html`<${Icon} name="sparkles" size=${12} />`}${n.name}</button>`)}</div>`
              : html`<div class="small faint">${q ? 'Kein Treffer – die Suche filtert auch diese Liste.' : 'Alles da!'}</div>`}
          </div>` : null}
          <div class="tiny faint">Monster: SRD 5.1 (deutsch) © Wizards of the Coast, CC-BY-4.0 · Symbole: game-icons.net (CC BY 3.0) · Namenslisten: D3 (dnddeutsch.de) und Fan-Wikis der jeweiligen Welten</div>
        </div>
        ${current && wide ? html`<aside class="best-side">${detail(current)}</aside>` : null}
      </div>
    </div>
  <//>`;
}
