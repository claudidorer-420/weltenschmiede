// Kampf-Tracker: Initiative, Züge & Runden, TP/Temp-TP, Zustände mit Dauer, Konzentration, Todesrettungswürfe,
// legendäre Aktionen, Statblocks, Protokoll. Spieler sehen eine öffentliche Projektion und beenden ihren Zug selbst.
import { html, useState, useEffect, useRef, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, col, myUid } from '../core/app.js';
import { db } from '../core/db.js';
import { openView } from '../core/workspace.js';
import {
  saveCombat, makeCombatant, combatantsFromMonsters, combatantFromCharacter, sortByInit, EMPTY_COMBAT, hpState, advanceTurn, applyHp as applyHpCore, resort, isOut, pushCharHp,
} from '../core/combat.js';
import { sendEvent } from '../core/relay.js';
import { makeCtx } from '../core/actions.js';
import { MonsterArt } from '../ui/art.js';
import { loadParty, watchParty } from '../core/party.js';
import { doRoll } from '../core/rolls.js';
import { roll, modifier, fmtMod } from '../lib/dice.js';
import { CONDITIONS, EXTRA_MARKERS } from '../data/rules5e.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, IconBtn, Btn, Field, Toggle, Statblock, openMenu, openModal, promptDialog, confirmDialog, toast, Empty } from '../ui/components.js';
import { useCol, useDoc } from '../core/hooks.js';
import { now, debounce, fmtTime } from '../lib/util.js';

function hpClass(c) {
  const r = c.hp / (c.maxHp || 1);
  return r > 0.5 ? '' : r > 0.25 ? 'mid' : 'low';
}

export function CombatView(props) {
  const gm = useStore(app, (s) => s.role === 'gm' && !s.viewAsPlayer);
  return gm ? html`<${GmCombat} ...${props} />` : html`<${PlayerCombat} ...${props} />`;
}

// ───────────────────────── SL-Ansicht ─────────────────────────
function AddCustomForm({ close }) {
  const [f, setF] = useState({ name: '', hp: 10, ac: 12, initBonus: 0, count: 1, isPC: false, hidden: false });
  const set = (p) => setF({ ...f, ...p });
  return html`<form onSubmit=${(e) => { e.preventDefault(); if (f.name.trim()) close(f); }}>
    <div class="modal-body stack">
      <${Field} label="Name"><input class="input" value=${f.name} onInput=${(e) => set({ name: e.target.value })} autoFocus placeholder="z. B. Banditin" /><//>
      <div class="grid four" style="gap:8px">
        <${Field} label="TP"><input class="input" type="number" value=${f.hp} onInput=${(e) => set({ hp: Number(e.target.value) })} /><//>
        <${Field} label="RK"><input class="input" type="number" value=${f.ac} onInput=${(e) => set({ ac: Number(e.target.value) })} /><//>
        <${Field} label="Init-Bonus"><input class="input" type="number" value=${f.initBonus} onInput=${(e) => set({ initBonus: Number(e.target.value) })} /><//>
        <${Field} label="Anzahl"><input class="input" type="number" min="1" max="30" value=${f.count} onInput=${(e) => set({ count: Math.max(1, Number(e.target.value)) })} /><//>
      </div>
      <div class="row"><${Toggle} checked=${f.isPC} onChange=${(v) => set({ isPC: v })} label="Spielercharakter" /><${Toggle} checked=${f.hidden} onChange=${(v) => set({ hidden: v })} label="Vor Spielern verborgen" /></div>
    </div>
    <div class="modal-foot"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" type="submit" icon="plus">Hinzufügen<//></div>
  </form>`;
}

function BestiaryPick({ close }) {
  const [list, setList] = useState(null);
  const [qty, setQty] = useState({});
  useEffect(() => { db.list(col('monsters')).then(setList); }, []);
  const chosen = (list || []).filter((m) => qty[m.id] > 0);
  return html`<div class="modal-body stack">
    ${!list ? html`<div class="empty"><span class="spinner" /></div>` : !list.length ? html`<div class="faint">Das Bestiarium ist leer.</div>` : html`<div class="list" style="max-height:55vh;overflow:auto">
      ${list.map((m) => html`<div class="list-item"><span class="title">${m.name}</span><span class="meta">HG ${m.cr || '?'} · TP ${m.hp}</span>
        <input class="input tiny" type="number" min="0" max="30" value=${qty[m.id] || 0} onInput=${(e) => setQty({ ...qty, [m.id]: Number(e.target.value) })} /></div>`)}
    </div>`}
    <div class="btn-row end"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" disabled=${!chosen.length} onClick=${() => close(chosen.map((m) => ({ ...m, qty: qty[m.id] })))}>Hinzufügen<//></div>
  </div>`;
}

function CombatantRow({ c, current, selected, onSelect, onHp, onMenu, onInit, onDeath, onLegendary }) {
  const [val, setVal] = useState('');
  const n = parseInt(val, 10);
  const apply = (sign) => {
    if (!n) return;
    onHp(c.id, sign * Math.abs(n));
    setVal('');
  };
  const pct = Math.max(0, Math.min(100, (c.hp / (c.maxHp || 1)) * 100));
  return html`<div class=${`cbt ${c.isPC ? 'pc' : 'npc'}${current ? ' current' : ''}${c.hp <= 0 ? ' down' : ''}${c.hidden ? ' hidden-c' : ''}`} onClick=${(e) => { if (!e.target.closest('button,input')) onSelect(c.id); }}>
    <button type="button" class="init" title="Initiative ändern / würfeln" onClick=${() => onInit(c)}>${c.init ?? '–'}</button>
    <div style="min-width:0">
      <div class="nm">${c.statblock ? html`<${MonsterArt} m=${c.statblock} size=${22} />` : null}${c.name}
        ${c.isPC ? html`<span class="badge players">SC</span>` : null}
        ${c.hidden ? html`<span class="badge"><${Icon} name="eye-off" size=${11} />verborgen</span>` : null}
        ${c.concentration ? html`<span class="badge warn" title="Konzentriert sich">Konz.</span>` : null}
        ${selected ? html`<${Icon} name="chevron-right" size=${14} class="accent-text" />` : null}
      </div>
      <div class="sub">
        <span><${Icon} name="shield" size=${12} /> RK ${c.ac}</span>
        <span><${Icon} name="heart" size=${12} /> ${c.hp}/${c.maxHp}${c.tempHp ? html` <span class="accent-text">+${c.tempHp}</span>` : ''}</span>
        ${!c.isPC ? html`<span class="faint">${hpState(c)}</span>` : null}
        ${c.statblock?.legendaryCount ? html`<span class="death-saves" title="Legendäre Aktionen">${Array.from({ length: c.statblock.legendaryCount }, (_, i) => html`<i class=${i < (c.legendaryUsed || 0) ? 'f' : ''} onClick=${() => onLegendary(c.id, i < (c.legendaryUsed || 0) ? i : i + 1)}></i>`)}</span>` : null}
        ${c.isPC && c.hp <= 0 ? html`<span class="death-saves" title="Todesrettungswürfe">
          ${[0, 1, 2].map((i) => html`<i class=${i < c.deathSaves.s ? 's' : ''} onClick=${() => onDeath(c.id, 's', i < c.deathSaves.s ? i : i + 1)}></i>`)} /
          ${[0, 1, 2].map((i) => html`<i class=${i < c.deathSaves.f ? 'f' : ''} onClick=${() => onDeath(c.id, 'f', i < c.deathSaves.f ? i : i + 1)}></i>`)}</span>` : null}
      </div>
      <div class="hpbar">${c.tempHp ? html`<div class="temp" style=${{ width: `${Math.min(100, (c.tempHp / c.maxHp) * 100)}%`, float: 'right' }}></div>` : null}<div class=${hpClass(c)} style=${{ width: `${pct}%` }}></div></div>
      ${c.conditions?.length ? html`<div class="conds">${c.conditions.map((k, i) => html`<span class="cond-chip" title="Klicken zum Entfernen" onClick=${() => onMenu(c, 'removeCond', i)}>${k.name}${k.rounds ? ` (${k.rounds})` : ''}</span>`)}</div>` : null}
    </div>
    <div class="cbt-controls">
      <input class="input tiny" inputmode="numeric" placeholder="±" value=${val} onInput=${(e) => setVal(e.target.value.replace(/[^\d]/g, ''))} onKeyDown=${(e) => { if (e.key === 'Enter') apply(-1); }} />
      <${IconBtn} icon="minus" class="danger" title="Schaden" onClick=${() => apply(-1)} />
      <${IconBtn} icon="plus" title="Heilen" onClick=${() => apply(1)} />
      <${IconBtn} icon="more-vertical" title="Mehr" onClick=${(e) => onMenu(c, 'menu', e)} />
    </div>
  </div>`;
}

function GmCombat({ tabId }) {
  const cid = useStore(app, (s) => s.cid);
  const remote = useDoc(cid ? col('combat') : null, 'gm');
  const [st, setSt] = useState(null);
  const [sel, setSel] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const dirty = useRef(false);
  const stRef = useRef(null);
  stRef.current = st;
  const saveDeb = useMemo(() => debounce((s) => saveCombat(s).then(() => { dirty.current = false; }).catch((e) => toast(`Speichern fehlgeschlagen: ${e.message}`, 'error')), 300), [cid]);

  useEffect(() => {
    if (remote === undefined) return;
    if (!dirty.current) setSt(remote ? { ...EMPTY_COMBAT, ...remote } : { ...EMPTY_COMBAT });
  }, [remote]);

  const update = (fn) => setSt((cur) => {
    const base = structuredClone(cur || EMPTY_COMBAT);
    const next = fn(base) || base;
    next.log = (next.log || []).slice(-100);
    dirty.current = true;
    saveDeb(next);
    return next;
  });
  const log = (x, text) => { x.log.push({ ts: now(), text }); };

  // SC-TP aus den Charakterbögen übernehmen
  useEffect(() => watchParty((party) => {
    const cur = stRef.current;
    if (!cur) return;
    let changed = false;
    const combatants = cur.combatants.map((c) => {
      if (!c.isPC || !c.charId) return c;
      const p = party.find((x) => x.char.id === c.charId);
      if (!p) return c;
      const ch = p.char;
      const hp = ch.hp ?? c.hp;
      const maxHp = ch.maxHp ?? c.maxHp;
      const ac = ch.ac ?? c.ac;
      if (hp !== c.hp || maxHp !== c.maxHp || ac !== c.ac) {
        changed = true;
        return { ...c, hp, maxHp, ac };
      }
      return c;
    });
    if (changed) update((x) => { x.combatants = combatants; return x; });
  }), [cid]);

  const nextTurn = () => update((x) => advanceTurn(x, makeCtx(x)));
  const prevTurn = () => update((x) => {
    if (!x.combatants.length) return x;
    x.turn--;
    if (x.turn < 0) {
      x.turn = x.combatants.length - 1;
      x.round = Math.max(1, x.round - 1);
    }
    return x;
  });

  // Spieler-Signale (Zug beenden, Initiative, Angriffe) verarbeitet jetzt core/relay.js – auch ohne offenen Tracker.
  const applyHp = (id, delta) => update((x) => { applyHpCore(x, id, delta); return x; });

  const setInit = async (c) => {
    const v = await promptDialog(`Initiative für ${c.name}`, c.init != null ? String(c.init) : '', { title: 'Initiative', hint: `Leer lassen = würfeln (W20 ${fmtMod(c.initBonus || 0)})`, ok: 'Übernehmen' });
    update((x) => {
      const cc = x.combatants.find((y) => y.id === c.id);
      if (!cc) return x;
      cc.init = v && !Number.isNaN(parseInt(v, 10)) ? parseInt(v, 10) : roll(`1d20${cc.initBonus >= 0 ? '+' : ''}${cc.initBonus || 0}`).total;
      return resort(x);
    });
  };
  const rollInit = (all = false) => update((x) => {
    for (const c of x.combatants) {
      if (!all && (c.isPC || c.init != null)) continue;
      c.init = roll(`1d20${c.initBonus >= 0 ? '+' : ''}${c.initBonus || 0}`).total;
    }
    log(x, all ? 'Initiative für alle gewürfelt' : 'Initiative der NSC gewürfelt');
    return resort(x);
  });
  const start = () => update((x) => {
    for (const c of x.combatants) if (c.init == null) c.init = roll(`1d20${c.initBonus >= 0 ? '+' : ''}${c.initBonus || 0}`).total;
    x.combatants = sortByInit(x.combatants);
    x.active = true;
    x.round = 1;
    x.turn = 0;
    log(x, '⚔️ Kampf beginnt');
    if (x.combatants[0]) log(x, `${x.combatants[0].name} ist am Zug`);
    return x;
  });
  const end = async () => {
    const removeDefeated = await confirmDialog('Kampf beenden. Besiegte Gegner aus der Liste entfernen?', { ok: 'Ja, entfernen', cancel: 'Nein, behalten' });
    update((x) => {
      x.active = false;
      if (removeDefeated) x.combatants = x.combatants.filter((c) => !isOut(c));
      x.turn = 0;
      log(x, 'Kampf beendet');
      return x;
    });
  };
  const clearAll = async () => {
    if (await confirmDialog('Alle Kämpfer entfernen und den Tracker zurücksetzen?', { danger: true, ok: 'Zurücksetzen' })) update(() => ({ ...EMPTY_COMBAT, log: [] }));
  };

  const addMenu = (e) => openMenu(e, [
    { label: 'Gruppe (Charaktere der Kampagne)', icon: 'users', onClick: async () => {
      const party = await loadParty();
      const have = new Set((st?.combatants || []).map((c) => c.charId).filter(Boolean));
      const list = party.filter((p) => !have.has(p.char.id)).map(combatantFromCharacter);
      if (!list.length) return toast('Keine (weiteren) verknüpften Charaktere gefunden.', 'error');
      update((x) => { x.combatants.push(...list); log(x, `${list.length} Charaktere hinzugefügt`); return resort(x); });
    } },
    { label: 'Aus dem Bestiarium …', icon: 'ghost', onClick: async () => {
      const picked = await openModal(({ close }) => html`<${BestiaryPick} close=${close} />`, { title: 'Aus dem Bestiarium', icon: 'ghost' });
      if (picked?.length) update((x) => { x.combatants.push(...combatantsFromMonsters(picked)); return resort(x); });
    } },
    { label: 'Eigener Kämpfer …', icon: 'plus', onClick: async () => {
      const f = await openModal(({ close }) => html`<${AddCustomForm} close=${close} />`, { title: 'Kämpfer hinzufügen', icon: 'plus' });
      if (!f) return;
      update((x) => {
        for (let i = 1; i <= f.count; i++) x.combatants.push(makeCombatant({ name: f.count > 1 ? `${f.name} ${i}` : f.name, hp: f.hp, ac: f.ac, initBonus: f.initBonus, isPC: f.isPC, hidden: f.hidden, ownerUid: f.isPC ? null : null }));
        return resort(x);
      });
    } },
    { label: 'Encounter-Generator öffnen', icon: 'swords', onClick: () => openView('encounter') },
  ]);

  const onMenu = (c, kind, arg) => {
    if (kind === 'removeCond') return update((x) => { const cc = x.combatants.find((y) => y.id === c.id); cc.conditions.splice(arg, 1); return x; });
    const addCond = async (name) => {
      const r = await promptDialog(`Dauer von „${name}“ in Runden`, '', { title: name, hint: 'Leer = bis zur manuellen Entfernung', ok: 'Setzen' });
      update((x) => {
        const cc = x.combatants.find((y) => y.id === c.id);
        cc.conditions = [...(cc.conditions || []).filter((k) => k.name !== name), { name, rounds: parseInt(r, 10) || 0 }];
        log(x, `${cc.name}: ${name}`);
        return x;
      });
    };
    openMenu(arg, [
      { header: true, label: c.name },
      { label: 'Zustand hinzufügen …', icon: 'activity', onClick: () => openMenu(arg, [...CONDITIONS.map((k) => ({ label: k.name, icon: k.icon, onClick: () => addCond(k.name) })), { divider: true }, ...EXTRA_MARKERS.map((m) => ({ label: m, icon: 'tag', onClick: () => addCond(m) }))]) },
      { label: c.concentration ? 'Konzentration beenden' : 'Konzentriert sich', icon: 'target', onClick: () => update((x) => { const cc = x.combatants.find((y) => y.id === c.id); cc.concentration = !cc.concentration; return x; }) },
      { label: 'Temporäre TP …', icon: 'shield', onClick: async () => { const v = await promptDialog('Temporäre TP', String(c.tempHp || ''), { title: c.name }); if (v != null) update((x) => { const cc = x.combatants.find((y) => y.id === c.id); cc.tempHp = Math.max(0, parseInt(v, 10) || 0); pushCharHp(cc); return x; }); } },
      { label: 'TP / RK bearbeiten …', icon: 'heart', onClick: async () => {
        const v = await promptDialog('TP / Max-TP / RK', `${c.hp}/${c.maxHp}/${c.ac}`, { title: c.name, hint: 'Format: aktuell/maximal/RK' });
        if (!v) return;
        const [hp, max, ac] = v.split('/').map((s) => parseInt(s, 10));
        update((x) => { const cc = x.combatants.find((y) => y.id === c.id); if (!Number.isNaN(max)) cc.maxHp = max; if (!Number.isNaN(hp)) cc.hp = hp; if (!Number.isNaN(ac)) cc.ac = ac; pushCharHp(cc); return x; });
      } },
      { label: c.hidden ? 'Für Spieler sichtbar machen' : 'Vor Spielern verbergen', icon: c.hidden ? 'eye' : 'eye-off', onClick: () => update((x) => { const cc = x.combatants.find((y) => y.id === c.id); cc.hidden = !cc.hidden; return x; }) },
      !c.isPC ? { label: c.showHp ? 'Genaue TP verbergen' : 'Genaue TP den Spielern zeigen', icon: 'heart', onClick: () => update((x) => { const cc = x.combatants.find((y) => y.id === c.id); cc.showHp = !cc.showHp; return x; }) } : null,
      c.statblock ? { label: 'Angriff würfeln …', icon: 'd20', onClick: () => setSel(c.id) } : null,
      { label: 'Umbenennen …', icon: 'edit-square', onClick: async () => { const v = await promptDialog('Name', c.name, { title: 'Umbenennen' }); if (v) update((x) => { x.combatants.find((y) => y.id === c.id).name = v; return x; }); } },
      { label: 'Duplizieren', icon: 'copy', onClick: () => update((x) => { const cc = x.combatants.find((y) => y.id === c.id); x.combatants.push({ ...structuredClone(cc), id: Math.random().toString(36).slice(2, 10), name: `${cc.name} (2)`, init: null, charId: null, ownerUid: null }); return x; }) },
      { divider: true },
      { label: 'Entfernen', icon: 'trash', danger: true, onClick: () => update((x) => { const curId = x.combatants[x.turn]?.id; x.combatants = x.combatants.filter((y) => y.id !== c.id); x.turn = Math.max(0, x.combatants.findIndex((y) => y.id === curId)); return x; }) },
    ]);
  };
  const onDeath = (id, k, v) => update((x) => { const c = x.combatants.find((y) => y.id === id); c.deathSaves[k] = Math.max(0, Math.min(3, v)); if (c.deathSaves.s >= 3) log(x, `${c.name} ist stabil`); if (c.deathSaves.f >= 3) log(x, `☠ ${c.name} ist gestorben`); return x; });
  const onLegendary = (id, v) => update((x) => { x.combatants.find((y) => y.id === id).legendaryUsed = v; return x; });

  if (!st) return html`<${ViewFrame} tabId=${tabId} title="Kampf"><div class="empty"><span class="spinner lg" /></div><//>`;
  const current = st.active ? st.combatants[st.turn] : null;
  const detail = st.combatants.find((c) => c.id === sel) || (current?.statblock ? current : null);

  return html`<${ViewFrame} tabId=${tabId} title="Kampf" actions=${html`<div class="row nowrap" style="gap:2px">
      <${IconBtn} icon="list" title="Protokoll" active=${showLog} onClick=${() => setShowLog(!showLog)} />
      <${IconBtn} icon="trash" title="Zurücksetzen" onClick=${clearAll} />
    </div>`}>
    <div class="combat-head">
      <span class="round-badge">Runde ${st.round || 1}</span>
      ${st.active
        ? html`<${Btn} kind="primary" icon="skip-forward" onClick=${nextTurn}>Nächster Zug<//><${IconBtn} icon="skip-back" title="Vorheriger Zug" onClick=${prevTurn} /><${Btn} kind="ghost" icon="stop" onClick=${end}>Beenden<//>`
        : html`<${Btn} kind="primary" icon="play" disabled=${!st.combatants.length} onClick=${start}>Kampf starten<//>`}
      <${Btn} icon="d20" onClick=${() => rollInit(false)}>NSC-Initiative<//>
      <${Btn} icon="plus" onClick=${addMenu}>Hinzufügen<//>
      ${st.mapId ? html`<${Btn} icon="map" onClick=${() => openView('map', { id: st.mapId })}>Kampfkarte<//>` : null}
      ${current ? html`<span class="grow"></span><span class="small muted">Am Zug: <b>${current.name}</b></span>` : null}
    </div>
    ${showLog ? html`<div class="card" style="margin:12px 16px 0"><div class="combat-log">${[...(st.log || [])].reverse().map((l) => html`<div><span class="faint tiny">${fmtTime(l.ts)}</span> ${l.text}</div>`)}</div></div>` : null}
    ${!st.combatants.length ? html`<${Empty} icon="sword" title="Noch keine Kämpfer" action=${html`<div class="btn-row center"><${Btn} icon="plus" onClick=${addMenu}>Kämpfer hinzufügen<//><${Btn} icon="swords" onClick=${() => openView('encounter')}>Encounter erstellen<//></div>`}>Füge die Gruppe, Monster aus dem Bestiarium oder einen generierten Encounter hinzu.<//>` : html`
      <div class="split even" style="padding:0 0 60px">
        <div class="combatants">
          ${st.combatants.map((c, i) => html`<${CombatantRow} key=${c.id} c=${c} current=${st.active && i === st.turn} selected=${detail?.id === c.id}
            onSelect=${(id) => setSel(sel === id ? null : id)} onHp=${applyHp} onMenu=${onMenu} onInit=${setInit} onDeath=${onDeath} onLegendary=${onLegendary} />`)}
        </div>
        <div style="padding:12px 16px" class="sticky">
          ${detail?.statblock ? html`<${Statblock} monster=${{ ...detail.statblock, name: detail.name }} />` : detail ? html`<div class="card"><b>${detail.name}</b><div class="small muted">Kein Statblock hinterlegt.</div>${detail.isPC && detail.charId ? html`<${Btn} size="sm" icon="user" onClick=${() => openView('character', { id: detail.charId, owner: detail.ownerUid, title: detail.name })}>Charakterbogen<//>` : null}</div>` : html`<div class="card small faint">Tippe einen Kämpfer an, um seinen Statblock zu sehen – Würfe darin sind klickbar.</div>`}
        </div>
      </div>`}
  <//>`;
}

// ───────────────────────── Spieler-Ansicht ─────────────────────────
function PlayerCombat({ tabId }) {
  const cid = useStore(app, (s) => s.cid);
  const me = myUid();
  const pub = useDoc(cid ? col('combat') : null, 'public');
  const myChars = useCol(me ? `users/${me}/characters` : null);
  const list = pub?.list || [];
  const cur = list.find((c) => c.id === pub?.currentId);
  const mine = cur && cur.ownerUid === me;
  const myChar = (myChars || []).find((c) => c.campaignId === cid);
  const endTurn = async () => {
    await sendEvent({ type: 'endTurn' });
    toast('Zug beendet', 'success');
  };
  const sendInit = async () => {
    const bonus = modifier(myChar?.abilities?.dex ?? 10) + (Number(myChar?.initBonus) || 0);
    const r = doRoll(`1d20${bonus >= 0 ? '+' : ''}${bonus}`, { label: 'Initiative', character: myChar?.name });
    if (r) await sendEvent({ type: 'init', value: r.total, charId: myChar?.id || null });
  };
  return html`<${ViewFrame} tabId=${tabId} title="Kampf">
    <div class="page narrow stack lg">
      ${!pub?.active && !list.length ? html`<${Empty} icon="sword" title="Gerade kein Kampf">Sobald die Spielleitung einen Kampf startet, siehst du hier die Reihenfolge.<//>` : html`
        <div class=${`waiting-for${mine ? ' me' : ''}`} style="font-size:16px">
          <span class="round-badge">Runde ${pub?.round || 1}</span>
          ${mine ? html`<b>Du bist am Zug!</b><span class="grow"></span><${Btn} kind="primary" icon="check" onClick=${endTurn}>Zug beenden<//>` : html`<span>Am Zug: <b>${cur?.name || '…'}</b></span>`}
        </div>
        <div class="row"><${Btn} icon="d20" onClick=${sendInit}>Initiative würfeln & melden<//><${Btn} icon="user" disabled=${!myChar} onClick=${() => openView('character', { id: myChar.id, owner: me, title: myChar.name })}>Mein Bogen<//>
          ${pub?.mapId ? html`<${Btn} kind="primary" icon="map" onClick=${() => openView('map', { id: pub.mapId })}>Zur Kampfkarte<//>` : null}</div>
        <div class="combatants" style="padding:0">
          ${list.map((c) => html`<div class=${`cbt ${c.isPC ? 'pc' : 'npc'}${c.id === pub.currentId ? ' current' : ''}${c.down ? ' down' : ''}`} key=${c.id}>
            <div class="init">${c.init ?? '–'}</div>
            <div>
              <div class="nm">${c.art ? html`<${MonsterArt} m=${c.art} size=${22} />` : null}${c.name}${c.ownerUid === me ? html`<span class="badge players">du</span>` : null}</div>
              <div class="sub">${c.hp != null ? html`<span><${Icon} name="heart" size=${12} /> ${c.hp}/${c.maxHp}${c.tempHp ? ` +${c.tempHp}` : ''}</span>` : html`<span>${c.hpState}</span>`}</div>
              ${c.hp != null ? html`<div class="hpbar"><div class=${c.hp / (c.maxHp || 1) > 0.5 ? '' : c.hp / (c.maxHp || 1) > 0.25 ? 'mid' : 'low'} style=${{ width: `${Math.max(0, Math.min(100, (c.hp / (c.maxHp || 1)) * 100))}%` }}></div></div>` : null}
              ${c.conditions?.length ? html`<div class="conds">${c.conditions.map((k) => html`<span class="cond-chip">${k.name}${k.rounds ? ` (${k.rounds})` : ''}</span>`)}</div>` : null}
            </div>
            <span></span>
          </div>`)}
        </div>`}
    </div>
  <//>`;
}
