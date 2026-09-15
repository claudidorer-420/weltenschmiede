// Zauberverwaltung: Zauber lernen, ins Zauberbuch schreiben, vorbereiten – nach Klasse, Stufe und Regelwerk.
// Genutzt im Charakter-Assistenten, beim Stufenaufstieg (Pflichtauswahl) und im Charakterbogen.
// Eintrag: { id, ref (Zauber-ID), name, level, cls, prepared, book, always, arcanum, source }
import { html, useState, useEffect, useRef } from '../lib/preact.js';
import { uid } from '../lib/util.js';
import { findClass, AB_NAME, AB_SHORT, charMods, edOf, totalLevel } from '../data/chargen.js';
import {
  useSpells, levelName, schoolName, damageName, fmtDice, timeShort, rangeShort, areaShort, damageAt, healAt, healHasMod,
  spellNeeds, classSpells, listClassOf, KIND_TEXT, findSpell,
} from '../data/spells.js';
import { SCHOOL_ART } from '../data/artmap.js';
import { SpellArt, SchoolDot, DamageTag } from '../ui/art.js';
import { Icon, IconBtn, Btn, openModal, useMedia } from '../ui/components.js';

const clsName = (k) => findClass(k)?.name || k;
const KIND_LABEL = { known: 'Bekannt', prepare: 'Vorbereitet', book: 'Zauberbuch' };

// Anforderungen aller Zauberklassen eines (fertigen oder Vorschau-)Charakters
export function casterNeeds(c) {
  if (!c?.classes?.length) return [];
  const ed = edOf(c);
  const cm = charMods(c);
  return c.classes.map((x) => spellNeeds(x, ed, cm.mods)).filter(Boolean);
}

// Alte Einträge (nur Name) auf die Datenbank abbilden und Felder ergänzen
export function normalizeEntries(list, spells, c) {
  const first = (c?.classes || []).find((x) => listClassOf(x))?.cls || null;
  return (list || []).map((e) => {
    const sp = e.ref ? spells?.find((s) => s.id === e.ref) : findSpell(spells, e.name);
    const level = sp ? sp.level : Number(e.level) || 0;
    const cls = e.source ? null : e.cls || first;
    return { ...e, id: e.id || uid(6), ref: sp?.id || e.ref || null, name: sp?.name || e.name, level, cls, book: e.book ?? (cls === 'magier' && level > 0 ? true : undefined), prepared: level === 0 ? true : !!e.prepared };
  });
}

const counts = (es, n) => ({
  cantrips: es.filter((e) => e.level === 0).length,
  known: es.filter((e) => e.level > 0 && !e.always && !e.arcanum).length,
  book: es.filter((e) => e.level > 0 && e.book).length,
  prepared: es.filter((e) => e.level > 0 && e.prepared && !e.always && !e.arcanum && (n?.kind !== 'book' || e.book)).length,
});

// Prüft die Auswahl gegen die Regeln. mode: 'create' | 'levelup' | 'sheet'
export function checkSpells(entries, needs, { mode = 'create', baseline = null } = {}) {
  const probs = [];
  for (const n of needs) {
    const es = entries.filter((e) => e.cls === n.cls && !e.source);
    const cnt = counts(es, n);
    const name = clsName(n.cls);
    if (cnt.cantrips < n.cantrips) probs.push(`${name}: noch ${n.cantrips - cnt.cantrips} Zaubertrick${n.cantrips - cnt.cantrips > 1 ? 's' : ''} wählen.`);
    if (cnt.cantrips > n.cantrips) probs.push(`${name}: nur ${n.cantrips} Zaubertricks erlaubt.`);
    if (n.kind === 'book') {
      const base = (baseline || []).filter((e) => e.cls === n.cls && e.book && e.level > 0).length;
      const need = mode === 'levelup' && baseline ? base + 2 : n.spellbook;
      if (cnt.book < need) probs.push(`${name}: noch ${need - cnt.book} Zauber ins Zauberbuch schreiben.`);
      if (mode === 'create' && cnt.book > need) probs.push(`${name}: Das Zauberbuch fasst zu Beginn ${need} Zauber.`);
      const prepNeed = Math.min(n.count, cnt.book);
      if (cnt.prepared < prepNeed) probs.push(`${name}: noch ${prepNeed - cnt.prepared} Zauber aus dem Buch vorbereiten.`);
      if (cnt.prepared > n.count) probs.push(`${name}: höchstens ${n.count} vorbereitete Zauber.`);
    } else if (n.kind === 'prepare') {
      if (cnt.prepared < n.count) probs.push(`${name}: noch ${n.count - cnt.prepared} Zauber vorbereiten.`);
      if (cnt.prepared > n.count) probs.push(`${name}: höchstens ${n.count} vorbereitete Zauber.`);
    } else {
      if (cnt.known < n.count) probs.push(`${name}: noch ${n.count - cnt.known} Zauber lernen.`);
      if (cnt.known > n.count) probs.push(`${name}: höchstens ${n.count} bekannte Zauber.`);
    }
    for (const g of n.arcanum || []) if (!es.some((e) => e.arcanum && e.level === g)) probs.push(`${name}: Mystisches Arkanum des ${g}. Grades wählen.`);
  }
  return probs;
}

function Counter({ label, have, need, strict = true }) {
  const ok = strict ? have === need : have >= need;
  const pct = need ? Math.min(1, have / need) : 1;
  return html`<div class=${`sm-counter${ok ? ' ok' : have > need ? ' over' : ''}`}>
    <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" class="bg" /><circle cx="18" cy="18" r="15" class="fg" style=${{ strokeDasharray: `${(pct * 94.25).toFixed(1)} 94.25` }} /></svg>
    <div><b>${have}/${need}</b><span>${label}</span></div>
  </div>`;
}

function para(p) {
  const m = /^([A-ZÄÖÜ][^:.!?]{1,48}):\s(.*)$/.exec(p);
  return m ? html`<p><b>${m[1]}:</b> ${m[2]}</p>` : html`<p>${p}</p>`;
}

export function SpellDetail({ sp, ed = '2024', charLevel = 1, footer = null }) {
  if (!sp) return null;
  const d = damageAt(sp, { charLevel });
  const h = healAt(sp);
  const areaInRange = /Radius|Kegel|Linie|Würfel|Kugel|Ausströmung/.test(sp.range || '');
  return html`<div class="spell-detail">
    <div class="sd-head">
      <${SpellArt} sp=${sp} size=${76} level=${false} />
      <div style="min-width:0">
        <h2>${sp.name}</h2>
        <div class="muted small">${sp.level ? `${levelName(sp.level)} · ${schoolName(sp.school)}` : `Zaubertrick · ${schoolName(sp.school)}`}${sp.ritual ? ' · Ritual' : ''}${sp.conc ? ' · Konzentration' : ''}</div>
        ${sp.en ? html`<div class="tiny faint">${sp.en}</div>` : null}
      </div>
    </div>
    <div class="sd-stats">
      <div><span>Zeitaufwand</span><b>${sp.time}</b></div>
      <div><span>Reichweite</span><b>${sp.range}${sp.area && !areaInRange ? ` · ${areaShort(sp.area)}` : ''}</b></div>
      <div><span>Komponenten</span><b>${sp.comps || '–'}</b>${sp.material ? html`<small>${sp.material}</small>` : null}</div>
      <div><span>Wirkungsdauer</span><b>${sp.duration}</b></div>
      ${sp.attack || sp.save ? html`<div><span>${sp.attack ? 'Angriff' : 'Rettungswurf'}</span><b>${sp.attack ? (sp.attack === 'melee' ? 'Nahkampf-Zauberangriff' : 'Fernkampf-Zauberangriff') : AB_NAME[sp.save] || sp.save}</b></div>` : null}
      ${d ? html`<div><span>Schaden</span><b><${DamageTag} type=${d.type}>${fmtDice(d.dice)} ${damageName(d.type)}<//></b></div>`
        : h ? html`<div><span>Heilung</span><b class="success-text">${fmtDice(h)}${healHasMod(sp) ? ' + Mod.' : ''}</b></div>` : null}
    </div>
    <div class="sd-text">${(sp.desc || []).map(para)}</div>
    ${sp.higher?.length ? html`<div class="sd-higher"><b>${sp.level ? 'Auf höheren Graden' : 'Zaubertrick-Aufwertung'}</b>${sp.higher.map((p) => html`<p>${p}</p>`)}</div>` : null}
    ${sp.classes?.length ? html`<div class="chips">${sp.classes.map((k) => html`<span class="chip">${clsName(k)}</span>`)}</div>` : null}
    <div class="tiny faint">Quelle: System Reference Document ${ed === '2024' ? '5.2.1' : '5.1'} (Wizards of the Coast, CC-BY-4.0)</div>
    ${footer}
  </div>`;
}

export function openSpellDetail(sp, { ed, charLevel, footer } = {}) {
  return openModal(() => html`<div class="modal-body"><${SpellDetail} sp=${sp} ed=${ed} charLevel=${charLevel} footer=${footer} /></div>`, { title: sp.name, icon: 'wand', size: 'md' });
}

function effectLine(sp, charLevel) {
  const d = damageAt(sp, { charLevel });
  const parts = [];
  if (sp.attack) parts.push(html`<span>Angriff</span>`);
  else if (sp.save) parts.push(html`<span>RW ${AB_SHORT[sp.save] || sp.save}</span>`);
  if (d) parts.push(html`<${DamageTag} type=${d.type}>${fmtDice(d.dice)}<//>`);
  else if (sp.heal) parts.push(html`<span class="success-text">Heilung ${fmtDice(healAt(sp) || '')}</span>`);
  else if (sp.area) parts.push(html`<span>${areaShort(sp.area)}</span>`);
  return parts.length ? parts.reduce((a, x, i) => (i ? [...a, html`<span class="faint">·</span>`, x] : [x]), []) : html`<span class="faint">${sp.duration}</span>`;
}

// ───────────────────────── Verwaltung ─────────────────────────
export function SpellManager({ c, entries, onChange, mode = 'sheet', baseline = null, needs: needsIn, unlock = false, only: onlyCls = null }) {
  const ed = edOf(c);
  const spells = useSpells(ed);
  const wide = useMedia('(min-width: 1100px)');
  const needs = (needsIn || casterNeeds(c)).filter((n) => !onlyCls || n.cls === onlyCls);
  const tabs = [...needs.map((n) => ({ key: n.cls, label: clsName(n.cls) })), ...(mode === 'sheet' ? [{ key: 'extra', label: 'Talente & Gegenstände' }] : [])];
  const [tab, setTab] = useState(tabs[0]?.key || 'extra');
  const [q, setQ] = useState('');
  const [lvl, setLvl] = useState('all');
  const [school, setSchool] = useState('');
  const [flag, setFlag] = useState('');
  const [sel, setSel] = useState(null);
  const latest = useRef({ current: entries, pending: null }).current;
  useEffect(() => { if (!tabs.some((t) => t.key === tab)) setTab(tabs[0]?.key || 'extra'); }, [tabs.map((t) => t.key).join()]);
  if (!spells) return html`<div class="empty"><span class="spinner lg" /></div>`;
  if (!tabs.length) return html`<div class="small muted">Dieser Charakter wirkt (noch) keine Zauber.</div>`;

  const n = needs.find((x) => x.cls === tab) || null;
  const charLevel = totalLevel(c);
  const isExtra = tab === 'extra';
  const es = isExtra ? entries.filter((e) => e.source) : entries.filter((e) => e.cls === tab && !e.source);
  const cnt = counts(es, n);
  const baseIds = new Set((baseline || []).filter((e) => e.cls === tab && !e.source).map((e) => e.ref));
  const removedBase = (pred) => (baseline || []).filter((e) => e.cls === tab && !e.source && pred(e) && !es.some((x) => x.ref === e.ref)).length;
  const bookBase = (baseline || []).filter((e) => e.cls === tab && e.book && e.level > 0).length;
  const bookLimit = !n || n.kind !== 'book' ? 0 : mode === 'levelup' && baseline ? bookBase + 2 : mode === 'create' ? n.spellbook : Infinity;
  const maxLvl = n ? Math.max(n.maxLevel, ...(n.arcanum || [0])) : 9;

  // Immer auf dem neuesten Stand aufbauen – schnelle Klicks hintereinander sollen nichts verlieren
  latest.current = latest.pending || entries;
  latest.pending = null;
  const commit = (next) => { latest.current = next; latest.pending = next; onChange(next); };
  const add = (s, patch) => commit([...latest.current, { id: uid(6), ref: s.id, name: s.name, level: s.level, cls: isExtra ? null : tab, prepared: true, ...patch }]);
  const remove = (e) => commit(latest.current.filter((x) => x.id !== e.id));
  const patch = (e, p) => commit(latest.current.map((x) => (x.id === e.id ? { ...x, ...p } : x)));
  const entryOf = (s) => es.find((e) => e.ref === s.id);

  // Darf ein vorhandener Eintrag entfernt werden?
  const canRemove = (e) => {
    if (mode === 'create' || unlock || !baseIds.has(e.ref)) return true;
    if (mode === 'sheet') return n?.kind === 'prepare' && e.level > 0;
    // Stufenaufstieg: einen bekannten Zauber tauschen (2024 auch einen Zaubertrick)
    if (e.level === 0) return ed === '2024' && removedBase((x) => x.level === 0) < 1;
    if (n.kind === 'known') return removedBase((x) => x.level > 0 && !x.arcanum) < 1;
    if (n.kind === 'prepare') return true;
    return false;
  };

  const actionsFor = (s) => {
    const e = entryOf(s);
    if (isExtra) return [e ? { label: 'Entfernen', icon: 'x', on: () => remove(e), active: true } : { label: 'Hinzufügen', icon: 'plus', on: () => add(s, { source: 'feat' }) }];
    if (s.level === 0) {
      if (e) return [{ label: 'Gelernt', icon: 'check', active: true, on: canRemove(e) ? () => remove(e) : null, why: 'Tausch nur beim Stufenaufstieg' }];
      return [{ label: 'Lernen', icon: 'plus', on: cnt.cantrips < n.cantrips ? () => add(s) : null, why: `Alle ${n.cantrips} Zaubertricks gewählt` }];
    }
    if ((n.arcanum || []).includes(s.level) && s.level > n.maxLevel) {
      if (e) return [{ label: 'Arkanum', icon: 'check', active: true, on: () => remove(e) }];
      const has = es.some((x) => x.arcanum && x.level === s.level);
      return [{ label: 'Als Arkanum', icon: 'star', on: has ? null : () => add(s, { arcanum: true }), why: 'Arkanum dieses Grades schon gewählt' }];
    }
    if (n.kind === 'book') {
      if (!e) return [{ label: 'Ins Buch', icon: 'plus', on: cnt.book < bookLimit ? () => add(s, { book: true, prepared: false }) : null, why: mode === 'levelup' ? 'Pro Stufe 2 neue Zauber' : `Das Zauberbuch fasst ${n.spellbook} Zauber` }];
      return [
        { label: e.prepared ? 'Vorbereitet' : 'Vorbereiten', icon: 'star', active: e.prepared, prep: true, on: e.prepared || cnt.prepared < n.count ? () => patch(e, { prepared: !e.prepared }) : null, why: `Schon ${n.count} vorbereitet` },
        { label: 'Im Buch', icon: 'book', active: true, on: canRemove(e) ? () => remove(e) : null, why: 'Einmal im Buch – bleibt drin' },
      ];
    }
    if (n.kind === 'prepare') {
      if (e) return [{ label: 'Vorbereitet', icon: 'check', active: true, on: canRemove(e) ? () => remove(e) : null }];
      return [{ label: 'Vorbereiten', icon: 'plus', on: cnt.prepared < n.count ? () => add(s) : null, why: `Schon ${n.count} vorbereitet` }];
    }
    if (e) return [{ label: 'Gelernt', icon: 'check', active: true, on: canRemove(e) ? () => remove(e) : null, why: 'Tausch nur beim Stufenaufstieg' }];
    return [{ label: 'Lernen', icon: 'plus', on: cnt.known < n.count && (mode !== 'sheet' || unlock) ? () => add(s) : null, why: mode === 'sheet' && !unlock ? 'Neue Zauber lernst du beim Stufenaufstieg' : `Alle ${n.count} Zauber gewählt` }];
  };

  const ql = q.trim().toLowerCase();
  let pool = isExtra ? spells : classSpells(spells, n.listCls, { maxLevel: maxLvl });
  if (!isExtra && n.kind === 'book' && flag === 'book') pool = pool.filter((s) => entryOf(s) || s.level === 0);
  pool = pool.filter((s) => (lvl === 'all' || s.level === lvl)
    && (!school || s.school === school)
    && (!ql || s.name.toLowerCase().includes(ql) || s.en?.toLowerCase().includes(ql))
    && (flag !== 'mine' || entryOf(s))
    && (flag !== 'ritual' || s.ritual) && (flag !== 'conc' || s.conc) && (flag !== 'dmg' || s.damage) && (flag !== 'heal' || s.heal));
  const levels = [...new Set((isExtra ? spells : classSpells(spells, n.listCls, { maxLevel: maxLvl })).map((s) => s.level))].sort((a, b) => a - b);
  const groups = levels.filter((l) => lvl === 'all' || l === lvl).map((l) => ({ l, list: pool.filter((s) => s.level === l) })).filter((g) => g.list.length);
  const selSp = sel ? spells.find((s) => s.id === sel) : null;

  const actBtns = (s, stop) => html`<div class="sm-act" onClick=${stop ? (ev) => ev.stopPropagation() : null}>${actionsFor(s).map((a) => html`<button type="button"
    class=${`sm-btn${a.active ? ' on' : ''}${a.prep ? ' prep' : ''}`} disabled=${!a.on} title=${!a.on ? a.why || '' : ''} onClick=${() => a.on?.()}>
    <${Icon} name=${a.icon} size=${13} />${a.label}</button>`)}</div>`;

  const openDetail = (s) => {
    if (wide) return setSel(sel === s.id ? null : s.id);
    const Foot = () => html`<div class="btn-row">${actionsFor(s).map((a) => html`<${Btn} kind=${a.active ? '' : 'primary'} icon=${a.icon} disabled=${!a.on} onClick=${() => a.on?.()}>${a.label}<//>`)}</div>`;
    openSpellDetail(s, { ed, charLevel, footer: html`<${Foot} />` });
  };

  return html`<div class="sm">
    ${tabs.length > 1 ? html`<div class="sm-tabs">${tabs.map((t) => html`<button type="button" class=${`sm-tab${t.key === tab ? ' active' : ''}`} onClick=${() => { setTab(t.key); setLvl('all'); setSel(null); }}>${t.label}</button>`)}</div>` : null}
    ${n ? html`<div class="sm-counters">
      <${Counter} label="Zaubertricks" have=${cnt.cantrips} need=${n.cantrips} />
      ${n.kind === 'book' ? html`<${Counter} label="Zauberbuch" have=${cnt.book} need=${bookLimit === Infinity ? n.spellbook : bookLimit} strict=${mode !== 'sheet'} />` : null}
      <${Counter} label=${n.kind === 'known' ? 'Bekannte Zauber' : 'Vorbereitet'} have=${n.kind === 'known' ? cnt.known : cnt.prepared} need=${n.count} />
      ${(n.arcanum || []).length ? html`<${Counter} label="Arkanum" have=${es.filter((e) => e.arcanum).length} need=${n.arcanum.length} />` : null}
      <span class="badge">bis ${levelName(n.maxLevel)}</span>
      <span class="badge">${AB_NAME[n.ability]}</span>
    </div>
    <div class="tiny faint">${KIND_TEXT[n.kind]}${mode === 'levelup' && n.kind === 'known' ? ' Jetzt beim Aufstieg darfst du einen bekannten Zauber gegen einen anderen tauschen.' : ''}</div>` : html`<div class="tiny faint">Zauber aus Talenten (z. B. Magie-Eingeweihter), von der Spezies oder aus magischen Gegenständen – ohne Obergrenze.</div>`}
    <div class="sm-tools">
      <div class="search-box"><${Icon} name="search" size=${15} /><input class="input" placeholder="Zauber suchen …" value=${q} onInput=${(ev) => setQ(ev.target.value)} /></div>
      <select class="select sm" style="width:auto" value=${school} onChange=${(ev) => setSchool(ev.target.value)}>
        <option value="">Alle Schulen</option>${Object.entries(SCHOOL_ART).map(([k, v]) => html`<option value=${k}>${v.name}</option>`)}
      </select>
      <select class="select sm" style="width:auto" value=${flag} onChange=${(ev) => setFlag(ev.target.value)}>
        <option value="">Alle Zauber</option><option value="mine">Nur gewählte</option>${n?.kind === 'book' ? html`<option value="book">Nur Zauberbuch</option>` : null}
        <option value="ritual">Rituale</option><option value="conc">Konzentration</option><option value="dmg">Mit Schaden</option><option value="heal">Heilung</option>
      </select>
    </div>
    <div class="sm-lvls">
      <button type="button" class=${`sm-lvl${lvl === 'all' ? ' active' : ''}`} onClick=${() => setLvl('all')}>Alle</button>
      ${levels.map((l) => html`<button type="button" class=${`sm-lvl${lvl === l ? ' active' : ''}`} onClick=${() => setLvl(l)}>${l ? `${l}.` : 'ZT'}</button>`)}
    </div>
    <div class=${`sm-body${selSp && wide ? ' with-detail' : ''}`}>
      <div class="sm-list">
        ${groups.map((g) => html`<div key=${g.l}>
          <div class="sm-group-title">${g.l ? levelName(g.l) : 'Zaubertricks'} <span class="faint">${g.list.length}</span></div>
          <div class="sm-grid">${g.list.map((s) => {
            const e = entryOf(s);
            return html`<div key=${s.id} class=${`sm-card${e ? ' on' : ''}${sel === s.id ? ' sel' : ''}`} onClick=${() => openDetail(s)}>
              <${SpellArt} sp=${s} size=${46} />
              <div class="sm-main">
                <div class="sm-name">${s.name}${s.ritual ? html`<span class="tag-r" title="Ritual">R</span>` : null}${s.conc ? html`<span class="tag-k" title="Konzentration">K</span>` : null}</div>
                <div class="sm-meta"><${SchoolDot} school=${s.school} />${schoolName(s.school)} · ${timeShort(s)} · ${rangeShort(s)}</div>
                <div class="sm-eff">${effectLine(s, charLevel)}</div>
              </div>
              ${actBtns(s, true)}
            </div>`;
          })}</div>
        </div>`)}
        ${!groups.length ? html`<div class="empty small">Keine passenden Zauber.</div>` : null}
      </div>
      ${selSp && wide ? html`<aside class="sm-detail">
        <div class="row" style="justify-content:flex-end;margin:-6px -6px 0 0"><${IconBtn} icon="x" title="Schließen" onClick=${() => setSel(null)} /></div>
        <${SpellDetail} sp=${selSp} ed=${ed} charLevel=${charLevel} footer=${actBtns(selSp)} />
      </aside>` : null}
    </div>
  </div>`;
}

function ManagerDialog({ c, mode, unlock, close }) {
  const spells = useSpells(edOf(c));
  const [entries, setEntries] = useState(null);
  useEffect(() => { if (spells && !entries) setEntries(normalizeEntries(c.spell?.list, spells, c)); }, [spells]);
  if (!entries) return html`<div class="modal-body"><div class="empty"><span class="spinner lg" /></div></div>`;
  const needs = casterNeeds(c);
  const probs = checkSpells(entries, needs, { mode: 'sheet' });
  return html`<div class="modal-body sm-modal"><${SpellManager} c=${c} entries=${entries} onChange=${setEntries} mode=${mode} unlock=${unlock} needs=${needs} /></div>
    <div class="modal-foot">
      ${probs.length ? html`<span class="small warn-text"><${Icon} name="info" size=${14} /> ${probs[0]}</span>` : html`<span class="small success-text"><${Icon} name="check" size=${14} /> Auswahl passt zu den Regeln.</span>`}
      <span class="grow"></span>
      <${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//>
      <${Btn} kind="primary" icon="check" onClick=${() => close(entries)}>Übernehmen<//>
    </div>`;
}

// Öffnet die Verwaltung für einen fertigen Charakter; liefert die neue Liste (oder null)
export function openSpellManager(c, { unlock = false } = {}) {
  return openModal(({ close }) => html`<${ManagerDialog} c=${c} mode="sheet" unlock=${unlock} close=${close} />`, { title: `Zauber: ${c.name}`, icon: 'wand', size: 'xl' });
}
