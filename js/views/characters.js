// Charaktere: Liste und Charakterbogen. Die Werte sind fest (entstehen im Assistenten und beim Stufenaufstieg);
// änderbar ist der Spielstand: TP, Zustände, Ressourcen, Zauberplätze, Ausrüstung, Geld, Notizen.
import { html, useState, useEffect, useRef, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, myUid, isRealGM, openCampaign } from '../core/app.js';
import { db } from '../core/db.js';
import { openView } from '../core/workspace.js';
import { watchParty } from '../core/party.js';
import { doRoll } from '../core/rolls.js';
import { settings } from '../core/settings.js';
import { fmtMod } from '../lib/dice.js';
import { CONDITIONS, XP_LEVELS, ALIGNMENTS } from '../data/rules5e.js';
import {
  AB, AB_NAME, AB_SHORT, ALL_SKILLS, skillName, skillAbility, charMods, rollTraits, resourcesFor, classExtras, spellSlots, classFeatures,
  findClass, findSpecies, findBackground, findFeat, findWeapon, weaponAttack, WEAPONS, ARMOR, ARMOR_TYPE, fmtDist, edOf, totalLevel, perEd,
} from '../data/chargen.js';
import { openCharacterWizard as runWizard, openLevelUp, derive, migrateLegacy } from './charwizard.js';
import { ViewFrame } from '../ui/frame.js';
import {
  Icon, IconBtn, Btn, Field, Select, Toggle, AutoTextarea, openModal, confirmDialog, toast, Empty, Avatar, pickFiles, Segmented, openMenu,
} from '../ui/components.js';
import { useCol, useDoc } from '../core/hooks.js';
import { now, debounce, uid } from '../lib/util.js';
import { dataUrlFromImageFile } from '../lib/image.js';

export async function assignToCampaign(charId, cid = app.get().cid) {
  const me = myUid();
  await db.update(`users/${me}/characters`, charId, { campaignId: cid || null });
  if (cid) await db.update(`campaigns/${cid}/members`, me, { characterId: charId }).catch(() => {});
}

export async function openCharacterWizard(opts = {}) {
  const c = await runWizard({ campaignId: opts.campaignId ?? app.get().cid ?? '' });
  if (c?.id) openCharacter(c);
  return c;
}

// Aus der Übersicht: in die verknüpfte Kampagne springen – sonst den Bogen als Dialog zeigen
export async function openCharacter(c) {
  const me = myUid();
  const member = c.campaignId && app.get().campaigns.some((x) => x.id === c.campaignId);
  if (member && app.get().cid !== c.campaignId) await openCampaign(c.campaignId);
  if (app.get().cid) {
    setTimeout(() => openView('character', { id: c.id, owner: me, title: c.name }), 30);
    return;
  }
  openModal(() => html`<div class="modal-body"><${CharacterSheet} id=${c.id} owner=${me} /></div>`, { title: c.name, icon: 'user', size: 'xl' });
}

function CharCard({ c, owner, mineInCampaign }) {
  const pct = Math.max(0, Math.min(100, ((c.hp ?? 0) / (c.maxHp || 1)) * 100));
  return html`<div class="card click" onClick=${() => openView('character', { id: c.id, owner, title: c.name })}>
    <div class="row nowrap">
      ${c.portrait ? html`<span class="avatar lg"><img src=${c.portrait} alt="" /></span>` : html`<${Avatar} name=${c.name} size="lg" color=${c.color} />`}
      <div class="grow">
        <b style="font-size:16px">${c.name}</b>
        <div class="small muted">${c.species} · ${c.cls}${c.subclass ? ` (${c.subclass})` : ''} · Stufe ${c.level}</div>
        <div class="hpbar"><div class=${pct > 50 ? '' : pct > 25 ? 'mid' : 'low'} style=${{ width: `${pct}%` }}></div></div>
        <div class="tiny faint">TP ${c.hp}/${c.maxHp} · RK ${c.ac}${mineInCampaign ? ' · in dieser Kampagne' : ''}${!c.classes?.length ? ' · alter Bogen' : ''}</div>
      </div>
    </div>
  </div>`;
}

export function CharactersView({ tabId }) {
  const me = useStore(app, (s) => s.user?.uid);
  const cid = useStore(app, (s) => s.cid);
  const gm = useStore(app, (s) => s.role === 'gm');
  const mine = useCol(me ? `users/${me}/characters` : null);
  const [party, setParty] = useState([]);
  useEffect(() => (cid && gm ? watchParty(setParty) : undefined), [cid, gm]);
  const others = party.filter((p) => p.owner !== me);
  const create = () => openCharacterWizard({ campaignId: cid });
  return html`<${ViewFrame} tabId=${tabId} title="Charaktere">
    <div class="page stack lg">
      <div class="page-head"><h1><${Icon} name="users" size=${24} />Charaktere</h1><span class="grow"></span><${Btn} kind="primary" icon="user-plus" onClick=${create}>Neuer Charakter<//>
        <span class="sub">Der Assistent führt Schritt für Schritt durch die 5e-Regeln. Charaktere gehören dir und bleiben erhalten, auch wenn eine Kampagne endet.</span></div>
      <div class="section-title">Meine Charaktere</div>
      ${!mine ? html`<div class="empty"><span class="spinner" /></div>` : !mine.length ? html`<${Empty} icon="user" title="Noch kein Charakter" action=${html`<${Btn} icon="user-plus" onClick=${create}>Charakter erschaffen<//>`}>Volk, Klasse, Hintergrund, Attribute, Fertigkeiten – alles nach den Regeln, in etwa 10 Minuten.<//>`
        : html`<div class="grid cards">${mine.map((c) => html`<${CharCard} key=${c.id} c=${c} owner=${me} mineInCampaign=${c.campaignId === cid} />`)}</div>`}
      ${gm && others.length ? html`<div class="section-title">Gruppe dieser Kampagne</div>
        <div class="grid cards">${others.map((p) => html`<${CharCard} key=${p.char.id} c=${p.char} owner=${p.owner} />`)}</div>` : null}
      ${gm && db.mode === 'cloud' && !others.length ? html`<div class="small faint">Sobald Spieler beitreten und ihre Charaktere verknüpfen, erscheinen sie hier.</div>` : null}
    </div>
  <//>`;
}

export function CharacterView({ params, tabId }) {
  return html`<${ViewFrame} tabId=${tabId} title=${params.title || 'Charakterbogen'}><${CharacterSheet} id=${params.id} owner=${params.owner} /><//>`;
}

// ───────────────────────── Bogen ─────────────────────────
function hitDicePools(c) {
  return (c.classes || []).map((x) => ({ cls: x.cls, hd: findClass(x.cls)?.hd || 8, total: x.level, used: Number(c.hdUsed?.[x.cls] ?? (typeof c.hdUsed === 'number' && x === c.classes[0] ? c.hdUsed : 0)) || 0 }));
}

function Pips({ max, used, onSet, disabled }) {
  if (max > 12) {
    return html`<div class="row nowrap" style="gap:4px"><${IconBtn} icon="minus" disabled=${disabled || used >= max} onClick=${() => onSet(used + 1)} /><b>${max - used}</b><span class="faint">/ ${max}</span><${IconBtn} icon="plus" disabled=${disabled || used <= 0} onClick=${() => onSet(used - 1)} /></div>`;
  }
  return html`<span class="pips">${Array.from({ length: max }, (_, i) => html`<i class=${i < used ? 'used' : ''} onClick=${() => !disabled && onSet(i < used ? i : i + 1)}></i>`)}</span>`;
}

export function CharacterSheet({ id, owner }) {
  const path = owner ? `users/${owner}/characters` : null;
  const remote = useDoc(path, id);
  const me = useStore(app, (s) => s.user?.uid);
  const units = useStore(settings, (s) => s.units || 'm');
  const campaigns = useStore(app, (s) => s.campaigns);
  const [c, setC] = useState(null);
  const [tab, setTab] = useState('werte');
  const [unlock, setUnlock] = useState(false);
  const [dmg, setDmg] = useState('');
  const pending = useRef({});
  const canEdit = owner === me || isRealGM();

  const flush = useMemo(() => debounce(async () => {
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) await db.update(path, id, { ...patch, updatedAt: now() }).catch((e) => toast(`Speichern fehlgeschlagen: ${e.message}`, 'error'));
  }, 500), [path, id]);
  useEffect(() => () => flush.flush?.(), []);
  useEffect(() => {
    if (remote && !Object.keys(pending.current).length) setC(remote);
  }, [remote]);

  if (remote === undefined) return html`<div class="empty"><span class="spinner lg" /></div>`;
  if (!remote || !c) return html`<${Empty} icon="user" title="Charakter nicht gefunden" />`;

  const ed = edOf(c);
  const legacy = !c.classes?.length;
  const cm = charMods(c);
  const traits = rollTraits(c);
  const res = legacy ? [] : resourcesFor(c);
  const slots = legacy ? { slots: {}, pact: null } : spellSlots(c);
  const hdp = hitDicePools(c);

  const upd = (patch, { rederive = false } = {}) => {
    if (!canEdit) return;
    let next = { ...c, ...patch };
    if (rederive) {
      next = derive(next);
      Object.assign(patch, { maxHp: next.maxHp, ac: next.ac, initBonus: next.initBonus, hp: next.hp, level: next.level, cls: next.cls, subclass: next.subclass });
    }
    setC(next);
    Object.assign(pending.current, patch);
    flush();
  };
  const saveAll = async (next) => {
    const { id: _i, ...data } = next;
    pending.current = {};
    setC(next);
    await db.set(path, id, { ...data, updatedAt: now() });
  };

  const fxFor = (kind, prof) => {
    const fx = {};
    if (traits.halfling) fx.halfling = true;
    if (traits.reliable && kind === 'check' && prof) fx.reliable = true;
    if (traits.exhaustion) fx.exhaustion = traits.exhaustion;
    if (kind === 'damage') {
      if (traits.gwf) fx.gwf = true;
      if (traits.elemental) fx.elemental = true;
    }
    return fx;
  };
  const roll20 = (bonus, label, kind, prof) => doRoll(`1d20${bonus >= 0 ? '+' : ''}${bonus}`, { label: `${c.name}: ${label}`, character: c.name, kind, fx: fxFor(kind, prof) });
  const rollDmg = (expr, label) => doRoll(expr, { label: `${c.name}: ${label}`, character: c.name, kind: 'damage', fx: fxFor('damage') });

  const hpDelta = (d) => {
    let hp = Number(c.hp) || 0;
    let temp = Number(c.tempHp) || 0;
    if (d < 0) {
      const t = Math.min(temp, -d);
      temp -= t;
      hp = Math.max(0, hp + d + t);
    } else hp = Math.min(c.maxHp, hp + d);
    const patch = { hp, tempHp: temp };
    if (hp > 0) patch.deathSaves = { s: 0, f: 0 };
    upd(patch);
  };
  const spendHd = (pool) => {
    if (pool.used >= pool.total) return toast('Keine Trefferwürfel mehr übrig.', 'error');
    const r = doRoll(`1d${pool.hd}${fmtMod(cm.mods.con).replace('−', '-')}`, { label: `${c.name}: Trefferwürfel`, character: c.name, kind: 'free' });
    if (!r) return;
    const heal = Math.max(0, r.total);
    upd({ hp: Math.min(c.maxHp, (Number(c.hp) || 0) + heal), hdUsed: { ...(typeof c.hdUsed === 'object' ? c.hdUsed : {}), [pool.cls]: pool.used + 1 } });
  };
  const shortRest = () => {
    const resUsed = { ...(c.resUsed || {}) };
    for (const r of res) if (r.reset === 'short') resUsed[r.key] = 0;
    upd({ resUsed, spell: { ...(c.spell || {}), pactUsed: 0 } });
    toast('Kurze Rast: Ressourcen und Paktmagie aufgefrischt. Trefferwürfel kannst du oben ausgeben.', 'success');
  };
  const longRest = () => {
    const hdUsed = {};
    for (const p of hdp) {
      const back = ed === '2024' ? p.total : Math.max(1, Math.floor(totalLevel(c) / 2));
      hdUsed[p.cls] = Math.max(0, p.used - back);
    }
    upd({ hp: c.maxHp, tempHp: 0, resUsed: {}, spell: { ...(c.spell || {}), used: {}, pactUsed: 0 }, hdUsed, exhaustion: Math.max(0, (Number(c.exhaustion) || 0) - 1), deathSaves: { s: 0, f: 0 } });
    toast('Lange Rast: TP, Ressourcen und Zauberplätze voll.', 'success');
  };
  const levelUp = async () => {
    const next = await openLevelUp(c);
    if (next) {
      await saveAll(next);
      toast(`${c.name} ist jetzt Stufe ${next.level}!`, 'success');
    }
  };
  const migrate = async () => {
    const ed2 = await openModal(({ close }) => html`<div class="modal-body stack">
      <p style="margin:0">Dieser Bogen stammt aus der ersten Version. Beim Übernehmen bleiben Attribute, Übungen, TP und RK erhalten; neu hinzu kommen Klassenmerkmale, Ressourcen, Zauberplätze und der Stufenaufstieg.</p>
      <div class="btn-row"><${Btn} kind="primary" onClick=${() => close('2014')}>Nach Regeln 2014 übernehmen<//><${Btn} kind="primary" onClick=${() => close('2024')}>Nach Regeln 2024 übernehmen<//></div>
    </div>`, { title: 'Bogen übernehmen', icon: 'refresh', size: 'sm' });
    if (!ed2) return;
    await saveAll(migrateLegacy(c, ed2));
    toast('Bogen übernommen', 'success');
  };
  const setPortrait = async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (f) upd({ portrait: await dataUrlFromImageFile(f, { maxDim: 320, quality: 0.8 }) });
  };
  const menu = (e) => openMenu(e, [
    canEdit ? { label: unlock ? 'Korrektur-Modus beenden' : 'Korrektur-Modus …', icon: unlock ? 'lock' : 'unlock', onClick: async () => {
      if (unlock) return setUnlock(false);
      if (await confirmDialog('Im Korrektur-Modus kannst du Attribute, Übungen und Trefferpunkte direkt ändern – gedacht für Ausnahmen wie magische Gegenstände oder Tippfehler. Normalerweise ändern sich Werte nur beim Stufenaufstieg.', { title: 'Korrektur-Modus', ok: 'Werte freigeben' })) setUnlock(true);
    } } : null,
    canEdit ? { label: 'Porträt ändern …', icon: 'image', onClick: setPortrait } : null,
    owner === me ? { divider: true } : null,
    owner === me ? { header: true, label: 'Kampagne' } : null,
    ...(owner === me ? [{ value: '', label: '– keine –' }, ...campaigns.map((x) => ({ value: x.id, label: x.name }))].map((o) => ({
      label: o.label, icon: (c.campaignId || '') === o.value ? 'check' : 'castle',
      onClick: () => assignToCampaign(c.id, o.value || null).then(() => { upd({ campaignId: o.value || null }); toast(o.value ? 'Mit Kampagne verknüpft' : 'Verknüpfung gelöst', 'success'); }),
    })) : []),
    owner === me ? { divider: true } : null,
    owner === me ? { label: 'Charakter löschen …', icon: 'trash', danger: true, onClick: async () => {
      if (!(await confirmDialog(`„${c.name}“ endgültig löschen?`, { danger: true, ok: 'Löschen' }))) return;
      await db.remove(path, id);
      toast('Charakter gelöscht', 'success');
      openView('characters');
    } } : null,
  ]);

  const nextXp = XP_LEVELS[Math.min(19, cm.level)] || null;
  const canLevel = canEdit && !legacy && cm.level < 20;
  const readyXp = nextXp && (Number(c.xp) || 0) >= nextXp;
  const clsLong = (c.classes || []).map((x) => `${findClass(x.cls)?.name || x.cls} ${x.level}${x.subclass ? ` (${x.subclass})` : ''}`).join(' / ') || `${c.cls || ''} ${c.level || ''}`;
  const isCaster = cm.spell.length || Object.keys(slots.slots).length || slots.pact || (c.spell?.list || []).length;
  const tabs = [
    { value: 'werte', label: 'Werte', icon: 'shield' },
    { value: 'kampf', label: 'Kampf', icon: 'swords' },
    isCaster ? { value: 'zauber', label: 'Zauber', icon: 'wand' } : null,
    { value: 'merkmale', label: 'Merkmale', icon: 'star' },
    { value: 'inventar', label: 'Inventar', icon: 'backpack' },
    { value: 'persona', label: 'Persönlichkeit', icon: 'feather' },
  ].filter(Boolean);

  return html`<div class="page sheet">
    <div class="sheet-hero">
      <div class="sheet-portrait" style=${c.portrait ? { backgroundImage: `url(${c.portrait})` } : {}} onClick=${canEdit ? setPortrait : null} title=${canEdit ? 'Porträt ändern' : ''}>${c.portrait ? '' : html`<${Icon} name="user" size=${30} />`}</div>
      <div class="grow" style="min-width:0">
        <h1 class="sheet-name">${c.name}</h1>
        <div class="muted">${c.species || '–'} · ${clsLong}${c.background ? ` · ${c.background}` : ''}</div>
        <div class="row" style="gap:6px;margin-top:6px">
          <span class="badge accent">Stufe ${cm.level}</span><span class="badge">Übung +${cm.pb}</span><span class="badge">Regeln ${ed}</span>
          ${c.alignment ? html`<span class="badge">${c.alignment}</span>` : null}
          ${readyXp && canLevel ? html`<span class="badge gold">Stufenaufstieg verfügbar</span>` : null}
        </div>
      </div>
      <div class="row nowrap" style="gap:4px">
        ${canLevel ? html`<${Btn} kind="primary" icon="arrow-up" onClick=${levelUp}>Stufenaufstieg<//>` : null}
        <${IconBtn} icon="more-vertical" title="Mehr" onClick=${menu} />
      </div>
    </div>

    ${legacy ? html`<div class="callout callout-orange"><div class="callout-title"><${Icon} name="refresh" size=${16} />Alter Charakterbogen</div><div class="callout-content small">Übernimm ihn einmal ins neue Format – dann gibt es Klassenmerkmale, Ressourcen, Zauberplätze und den geführten Stufenaufstieg. ${canEdit ? html`<${Btn} size="sm" kind="primary" onClick=${migrate}>Jetzt übernehmen<//>` : ''}</div></div>` : null}
    ${unlock ? html`<div class="callout callout-red"><div class="callout-title"><${Icon} name="unlock" size=${16} />Korrektur-Modus aktiv</div><div class="callout-content small row">Attribute, Rettungswürfe, Fertigkeiten, TP-Korrektur und Bewegung sind jetzt änderbar. <${Btn} size="sm" onClick=${() => setUnlock(false)}>Fertig<//></div></div>` : null}

    <${Segmented} value=${tab} onChange=${setTab} options=${tabs} />

    ${tab === 'werte' ? html`
      <div class="stat-grid">${AB.map((k) => html`<div class="stat-box">
        <span class="lbl">${AB_NAME[k]}</span>
        <span class="mod" title=${`${AB_NAME[k]}-Probe würfeln`} onClick=${() => roll20(cm.mods[k], `${AB_NAME[k]}-Probe`, 'check', 0)}>${fmtMod(cm.mods[k])}</span>
        ${unlock ? html`<input class="input" type="number" value=${c.abilities?.[k] ?? 10} onInput=${(e) => upd({ abilities: { ...c.abilities, [k]: Math.max(1, Math.min(30, Number(e.target.value) || 10)) } }, { rederive: true })} />` : html`<span class="score">${c.abilities?.[k] ?? 10}</span>`}
      </div>`)}</div>

      <div class="vitals">
        <div class="vital" title=${cm.ac.parts.join(' · ')}><div class="lbl">Rüstungsklasse</div><div class="val">${cm.ac.ac}</div></div>
        <div class="vital click" onClick=${() => roll20(cm.init, 'Initiative', 'init')}><div class="lbl">Initiative</div><div class="val">${fmtMod(cm.init)}</div></div>
        <div class="vital"><div class="lbl">Bewegung</div>${unlock ? html`<input class="input" type="number" value=${c.speed || 30} title="in Fuß" onInput=${(e) => upd({ speed: Number(e.target.value) || 30 })} />` : html`<div class="val">${fmtDist(c.speed || 30, units)}</div>`}</div>
        <div class="vital"><div class="lbl">Passive Wahrn.</div><div class="val">${cm.passive.perception}</div></div>
        <div class="vital"><div class="lbl">Übungsbonus</div><div class="val">+${cm.pb}</div></div>
        <div class=${`vital click${c.inspiration ? ' on' : ''}`} onClick=${() => upd({ inspiration: !c.inspiration })}><div class="lbl">Inspiration</div><div class="val">${c.inspiration ? '★' : '☆'}</div></div>
      </div>

      <div class="grid two">
        <div class="card stack sm">
          <div class="row"><b class="grow"><${Icon} name="heart" size=${16} /> Trefferpunkte</b>${unlock ? html`<label class="small muted">Korrektur <input class="input tiny" type="number" value=${c.hpAdjust || 0} onInput=${(e) => upd({ hpAdjust: Number(e.target.value) || 0 }, { rederive: true })} /></label>` : null}</div>
          <div class="row">
            <span style="font:700 38px var(--font-serif)">${c.hp}</span><span class="muted">/ ${c.maxHp}</span>
            ${c.tempHp ? html`<span class="badge accent">+${c.tempHp} temp.</span>` : null}
            <span class="grow"></span>
            <div class="input-group" style="width:auto">
              <input class="input" type="number" min="0" style="width:84px" value=${dmg} placeholder="Wert" onInput=${(e) => setDmg(e.target.value)} />
              <${Btn} kind="danger" disabled=${!canEdit || !dmg} onClick=${() => { hpDelta(-Math.abs(Number(dmg) || 0)); setDmg(''); }}>Schaden<//>
              <${Btn} kind="success" disabled=${!canEdit || !dmg} onClick=${() => { hpDelta(Math.abs(Number(dmg) || 0)); setDmg(''); }}>Heilen<//>
            </div>
          </div>
          <div class="hpbar" style="max-width:none"><div class=${c.hp / (c.maxHp || 1) > 0.5 ? '' : c.hp / (c.maxHp || 1) > 0.25 ? 'mid' : 'low'} style=${{ width: `${Math.max(0, Math.min(100, (c.hp / (c.maxHp || 1)) * 100))}%` }}></div></div>
          <div class="row small">
            <span class="muted">Temporäre TP</span><input class="input tiny" type="number" min="0" value=${c.tempHp || 0} disabled=${!canEdit} onInput=${(e) => upd({ tempHp: Math.max(0, Number(e.target.value) || 0) })} />
            <span class="grow"></span>
            ${hdp.map((p) => html`<span class="hd-pool">W${p.hd}: <b>${p.total - p.used}</b>/${p.total} <${Btn} size="sm" kind="ghost" disabled=${!canEdit || p.used >= p.total} onClick=${() => spendHd(p)}>ausgeben<//></span>`)}
          </div>
          ${c.hp <= 0 ? html`<div class="row"><b>Todesrettungswürfe</b>
            <span class="death-saves">${[0, 1, 2].map((i) => html`<i class=${i < (c.deathSaves?.s || 0) ? 's' : ''} onClick=${() => upd({ deathSaves: { ...c.deathSaves, s: i < (c.deathSaves?.s || 0) ? i : i + 1 } })}></i>`)}</span> Erfolge
            <span class="death-saves">${[0, 1, 2].map((i) => html`<i class=${i < (c.deathSaves?.f || 0) ? 'f' : ''} onClick=${() => upd({ deathSaves: { ...c.deathSaves, f: i < (c.deathSaves?.f || 0) ? i : i + 1 } })}></i>`)}</span> Fehlschläge
            <${Btn} size="sm" icon="d20" onClick=${() => roll20(0, 'Todesrettungswurf', 'save')}>Würfeln<//></div>` : null}
          <div class="btn-row">
            <${Btn} size="sm" icon="clock" disabled=${!canEdit} onClick=${shortRest}>Kurze Rast<//>
            <${Btn} size="sm" icon="moon" disabled=${!canEdit} onClick=${longRest}>Lange Rast<//>
          </div>
        </div>
        <div class="card stack sm">
          <b><${Icon} name="alert" size=${16} /> Zustände</b>
          <div class="chips">${CONDITIONS.filter((x) => x.name !== 'Erschöpft').map((x) => {
            const on = (c.conditions || []).includes(x.name);
            return html`<button type="button" title=${x.desc} class=${`chip${on ? ' selected' : ' suggest'}`} disabled=${!canEdit} onClick=${() => upd({ conditions: on ? c.conditions.filter((y) => y !== x.name) : [...(c.conditions || []), x.name] })}>${x.name}</button>`;
          })}</div>
          <div class="row small"><span class="muted">Erschöpfung</span>
            <${IconBtn} icon="minus" disabled=${!canEdit || !c.exhaustion} onClick=${() => upd({ exhaustion: Math.max(0, (c.exhaustion || 0) - 1) })} /><b>${c.exhaustion || 0}</b><${IconBtn} icon="plus" disabled=${!canEdit || c.exhaustion >= 6} onClick=${() => upd({ exhaustion: Math.min(6, (c.exhaustion || 0) + 1) })} />
            <span class="faint">${ed === '2024' ? `−${2 * (c.exhaustion || 0)} auf W20-Würfe` : c.exhaustion ? 'siehe Regeln (Nachteile je Stufe)' : ''}</span>
          </div>
          ${res.length ? html`<div class="stack sm" style="margin-top:6px"><b><${Icon} name="zap" size=${15} /> Ressourcen</b>
            ${res.map((r) => html`<div class="res-row"><span class="grow">${r.name} <small class="faint">(${r.reset === 'short' ? 'kurze' : 'lange'} Rast)</small></span>
              <${Pips} max=${r.max >= 99 ? 0 : r.max} used=${c.resUsed?.[r.key] || 0} disabled=${!canEdit} onSet=${(v) => upd({ resUsed: { ...(c.resUsed || {}), [r.key]: Math.max(0, Math.min(r.max, v)) } })} />
              ${r.max >= 99 ? html`<b>unbegrenzt</b>` : null}</div>`)}
          </div>` : null}
          ${!legacy && classExtras(c).length ? html`<div class="chips">${classExtras(c).map((x) => html`<span class="badge">${x}</span>`)}</div>` : null}
        </div>
      </div>

      <div class="grid two">
        <div class="card">
          <div class="card-head"><h3>Rettungswürfe</h3></div>
          ${AB.map((k) => html`<div class="skill">
            <span class=${`prof${cm.saves[k].prof ? ' p1' : ''}${unlock ? ' edit' : ''}`} onClick=${() => unlock && upd({ saves: cm.saves[k].prof ? c.saves.filter((x) => x !== k) : [...(c.saves || []), k] })}></span>
            <span class="bonus" onClick=${() => roll20(cm.saves[k].bonus, `${AB_NAME[k]}-Rettungswurf`, 'save')}>${fmtMod(cm.saves[k].bonus)}</span><span>${AB_NAME[k]}</span>
          </div>`)}
          <div class="tiny faint" style="margin-top:8px">Wert antippen zum Würfeln. ${traits.halfling ? 'Halblingsglück wird automatisch angewandt.' : ''}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Fertigkeiten</h3><span class="grow"></span><span class="tiny faint">● geübt · ◉ Expertise</span></div>
          <div class="skill-list">${ALL_SKILLS.map((k) => html`<div class="skill">
            <span class=${`prof${cm.skills[k].prof ? ` p${cm.skills[k].prof}` : ''}${unlock ? ' edit' : ''}`} onClick=${() => unlock && upd({ skills: { ...c.skills, [k]: ((Number(c.skills?.[k]) || 0) + 1) % 3 } })}></span>
            <span class="bonus" onClick=${() => roll20(cm.skills[k].bonus, skillName(k), 'check', cm.skills[k].prof)}>${fmtMod(cm.skills[k].bonus)}</span><span>${skillName(k)}</span><span class="ab">${AB_SHORT[skillAbility(k)]}</span>
          </div>`)}</div>
          <div class="tiny faint" style="margin-top:8px">Passive Werte: Wahrnehmung ${cm.passive.perception} · Motiv erkennen ${cm.passive.insight} · Nachforschungen ${cm.passive.investigation}${cm.jack ? ` · Alleskönner +${cm.jack}` : ''}</div>
        </div>
      </div>
    ` : null}

    ${tab === 'kampf' ? html`<${CombatTab} c=${c} cm=${cm} canEdit=${canEdit} upd=${upd} roll20=${roll20} rollDmg=${rollDmg} />` : null}
    ${tab === 'zauber' ? html`<${SpellTab} c=${c} cm=${cm} slots=${slots} canEdit=${canEdit} upd=${upd} roll20=${roll20} />` : null}
    ${tab === 'merkmale' ? html`<${FeaturesTab} c=${c} canEdit=${canEdit} upd=${upd} units=${units} />` : null}
    ${tab === 'inventar' ? html`<${InventoryTab} c=${c} canEdit=${canEdit} upd=${upd} />` : null}
    ${tab === 'persona' ? html`<${PersonaTab} c=${c} canEdit=${canEdit} upd=${upd} nextXp=${nextXp} />` : null}
  </div>`;
}

function CombatTab({ c, cm, canEdit, upd, roll20, rollDmg }) {
  const weapons = (c.weapons || []).map((k) => findWeapon(k)).filter(Boolean).map((w) => weaponAttack(c, w, cm.mods, cm.pb));
  const attacks = c.attacks || [];
  const setAtk = (i, patch) => upd({ attacks: attacks.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  return html`<div class="stack lg">
    <div class="card stack sm">
      <div class="card-head" style="margin:0"><h3><${Icon} name="swords" size=${18} />Waffen</h3><span class="grow"></span>
        ${canEdit ? html`<select class="select sm" style="width:auto" value="" onChange=${(e) => { if (e.target.value) upd({ weapons: [...(c.weapons || []), e.target.value] }); e.target.value = ''; }}>
          <option value="">+ Waffe hinzufügen</option>${WEAPONS.map((w) => html`<option value=${w.key}>${w.name} (${w.dmg})</option>`)}
        </select>` : null}</div>
      ${weapons.map((a, i) => html`<div class="atk-row">
        <div class="grow"><b>${a.name}</b><div class="tiny faint">${a.type}${a.props ? ` · ${a.props}` : ''}${cm.ed === '2024' && a.mastery ? ` · Meisterschaft: ${a.mastery}` : ''}${a.prof ? '' : ' · ungeübt'}</div></div>
        <${Btn} size="sm" icon="d20" onClick=${() => roll20(a.bonus, `${a.name} – Angriff`, 'attack')}>${fmtMod(a.bonus)}<//>
        <${Btn} size="sm" icon="flame" onClick=${() => rollDmg(a.damage, `${a.name} – Schaden`)}>${a.damage}<//>
        ${a.versatile ? html`<${Btn} size="sm" kind="ghost" title="Zweihändig" onClick=${() => rollDmg(a.versatile, `${a.name} – Schaden (zweihändig)`)}>${a.versatile}<//>` : null}
        ${canEdit ? html`<${IconBtn} icon="x" class="danger" title="Entfernen" onClick=${() => upd({ weapons: c.weapons.filter((_, j) => j !== i) })} />` : null}
      </div>`)}
      ${!weapons.length ? html`<div class="small faint">Noch keine Waffen – oben hinzufügen.</div>` : null}
      <div class="tiny faint">Angriff = Attributsmodifikator + Übungsbonus (falls geübt), Schaden = Waffenwürfel + Modifikator. Kritisch? In der Würfel-Ansicht „Kritischer Treffer“ aktivieren.</div>
    </div>
    <div class="card stack sm">
      <div class="card-head" style="margin:0"><h3><${Icon} name="sparkles" size=${18} />Weitere Angriffe & Fähigkeiten</h3><span class="grow"></span>${canEdit ? html`<${Btn} size="sm" icon="plus" onClick=${() => upd({ attacks: [...attacks, { id: uid(5), name: '', bonus: '+0', damage: '1d6' }] })}>Hinzufügen<//>` : null}</div>
      ${attacks.map((a, i) => html`<div class="atk-row">
        <input class="input sm grow" value=${a.name} placeholder="z. B. Odemwaffe, Hinterhältiger Angriff" disabled=${!canEdit} onInput=${(e) => setAtk(i, { name: e.target.value })} />
        <input class="input sm" style="width:70px" value=${a.bonus} disabled=${!canEdit} onInput=${(e) => setAtk(i, { bonus: e.target.value })} />
        <input class="input sm" style="width:100px" value=${a.damage} disabled=${!canEdit} onInput=${(e) => setAtk(i, { damage: e.target.value })} />
        <${IconBtn} icon="d20" title="Angriff" onClick=${() => roll20(parseInt(String(a.bonus).replace('−', '-'), 10) || 0, `${a.name || 'Angriff'}`, 'attack')} />
        <${IconBtn} icon="flame" title="Schaden" onClick=${() => rollDmg(a.damage || '1d6', `${a.name || 'Angriff'} – Schaden`)} />
        ${canEdit ? html`<${IconBtn} icon="x" class="danger" onClick=${() => upd({ attacks: attacks.filter((_, j) => j !== i) })} />` : null}
      </div>`)}
    </div>
    <div class="card stack sm">
      <div class="row"><b class="grow"><${Icon} name="shield" size=${16} /> Rüstung</b><span class="badge accent">RK ${cm.ac.ac}</span></div>
      <div class="row">
        <${Select} value=${c.armor?.body || ''} disabled=${!canEdit} onChange=${(v) => upd({ armor: { ...(c.armor || {}), body: v } }, { rederive: true })} options=${[{ value: '', label: 'Keine Rüstung' }, ...ARMOR.map((a) => ({ value: a.key, label: `${a.name} (${ARMOR_TYPE[a.type]}, RK ${a.ac})` }))]} style="max-width:340px" />
        <${Toggle} checked=${!!c.armor?.shield} onChange=${(v) => canEdit && upd({ armor: { ...(c.armor || {}), shield: v } }, { rederive: true })} label="Schild" />
        <label class="small muted">Magie/Sonstiges <input class="input tiny" type="number" value=${c.acBonus || 0} disabled=${!canEdit} onInput=${(e) => upd({ acBonus: Number(e.target.value) || 0 }, { rederive: true })} /></label>
      </div>
      <div class="tiny faint">${cm.ac.parts.join(' · ')}${cm.ac.stealthDis ? ' · Nachteil auf Heimlichkeit' : ''}${cm.ac.heavyStrShort ? ' · STÄ zu niedrig: −3 m Bewegung' : ''}</div>
    </div>
  </div>`;
}

function SpellTab({ c, cm, slots, canEdit, upd, roll20 }) {
  const sp = c.spell || {};
  const list = sp.list || [];
  const setList = (next) => upd({ spell: { ...sp, list: next } });
  return html`<div class="stack lg">
    ${cm.spell.map((s) => html`<div class="card row" style="gap:8px">
      <b class="grow">${findClass(s.cls)?.name || 'Zauberwirken'} (${AB_NAME[s.ability]})</b>
      <span class="badge accent">SG ${s.dc}</span>
      <span class="badge accent click" onClick=${() => roll20(s.attack, 'Zauberangriff', 'attack')}>Angriff ${fmtMod(s.attack)}</span>
      <span class="badge">${s.cantrips} Zaubertricks</span><span class="badge">${s.count} ${s.mode}</span>
      ${s.spellbook ? html`<span class="badge">Zauberbuch ≥ ${s.spellbook}</span>` : null}
    </div>`)}
    ${Object.keys(slots.slots).length || slots.pact ? html`<div class="card stack sm">
      <b>Zauberplätze</b>
      ${Object.entries(slots.slots).map(([g, n]) => html`<div class="slot-row"><span class="small" style="width:70px">${g}. Grad</span>
        <${Pips} max=${n} used=${sp.used?.[g] || 0} disabled=${!canEdit} onSet=${(v) => upd({ spell: { ...sp, used: { ...(sp.used || {}), [g]: Math.max(0, Math.min(n, v)) } } })} /></div>`)}
      ${slots.pact ? html`<div class="slot-row"><span class="small" style="width:70px">Pakt (${slots.pact.level}.)</span>
        <${Pips} max=${slots.pact.count} used=${sp.pactUsed || 0} disabled=${!canEdit} onSet=${(v) => upd({ spell: { ...sp, pactUsed: Math.max(0, Math.min(slots.pact.count, v)) } })} /><span class="tiny faint">kehrt nach kurzer Rast zurück</span></div>` : null}
    </div>` : null}
    <div class="card stack sm">
      <div class="card-head" style="margin:0"><h3><${Icon} name="wand" size=${18} />Zauber</h3><span class="grow"></span>${canEdit ? html`<${Btn} size="sm" icon="plus" onClick=${() => setList([...list, { id: uid(5), name: '', level: 1, prepared: true }])}>Zauber<//>` : null}</div>
      ${[...list].sort((a, b) => a.level - b.level).map((s) => html`<div class="row nowrap" key=${s.id}>
        <select class="select sm" style="width:110px" value=${s.level} disabled=${!canEdit} onChange=${(e) => setList(list.map((x) => (x.id === s.id ? { ...x, level: Number(e.target.value) } : x)))}>
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => html`<option value=${g}>${g ? `${g}. Grad` : 'Zaubertrick'}</option>`)}
        </select>
        <input class="input sm grow" value=${s.name} placeholder="Zauber" disabled=${!canEdit} onInput=${(e) => setList(list.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
        ${s.level ? html`<label class="check small"><input type="checkbox" checked=${!!s.prepared} disabled=${!canEdit} onChange=${(e) => setList(list.map((x) => (x.id === s.id ? { ...x, prepared: e.target.checked } : x)))} />vorb.</label>` : null}
        ${canEdit ? html`<${IconBtn} icon="x" class="danger" onClick=${() => setList(list.filter((x) => x.id !== s.id))} />` : null}
      </div>`)}
      ${!list.length ? html`<div class="small faint">Noch keine Zauber eingetragen.</div>` : null}
    </div>
  </div>`;
}

function FeaturesTab({ c, canEdit, upd, units }) {
  const ed = edOf(c);
  const sp = findSpecies(ed, c.speciesKey);
  const sub = sp?.subs?.find((s) => s.key === c.subspeciesKey);
  const opt = sp?.option?.list.find((o) => o.key === c.speciesOption);
  const bg = findBackground(ed, c.backgroundKey);
  return html`<div class="stack lg">
    ${(c.classes || []).map((x) => {
      const cls = findClass(x.cls);
      const feats = classFeatures(x.cls, ed, x.level).filter((f) => f.kind !== 'asi' && f.kind !== 'boon');
      return html`<div class="card stack sm">
        <b><${Icon} name="shield" size=${16} /> ${cls?.name} ${x.level}${x.subclass ? ` · ${x.subclass}` : ''}</b>
        <div class="feat-list">${feats.map((f) => html`<div><b>St. ${f.level} · ${f.kind === 'sub' ? (x.subclass ? `${x.subclass}: Merkmal` : f.name) : f.name}</b>${f.desc && f.kind !== 'sub' ? html` <span class="small muted">– ${f.desc}</span>` : null}</div>`)}</div>
      </div>`;
    })}
    ${sp ? html`<div class="card stack sm">
      <b><${Icon} name="globe" size=${16} /> ${c.species}</b>
      <div class="small muted">${c.size || sp.size} · Bewegung ${fmtDist(c.speed || sp.speed, units)}${c.darkvision ? ` · Dunkelsicht ${fmtDist(c.darkvision, units)}` : ''}${opt?.note ? ` · ${opt.note}` : ''}</div>
      <div class="feat-list">${[...(sp.traits || []), ...(sub?.traits || [])].map(([n, t]) => html`<div><b>${n}</b> <span class="small muted">– ${t}</span></div>`)}</div>
    </div>` : null}
    ${(c.feats || []).length ? html`<div class="card stack sm">
      <b><${Icon} name="star" size=${16} /> Talente</b>
      <div class="feat-list">${c.feats.map((f) => html`<div><b>${f.name || findFeat(f.key)?.name}</b>${f.source ? html` <span class="tiny faint">(${f.source})</span>` : null} <span class="small muted">– ${findFeat(f.key)?.desc || ''}</span></div>`)}</div>
    </div>` : null}
    <div class="card stack sm small">
      <b><${Icon} name="book" size=${16} /> Übungen & Sprachen</b>
      <div><b>Rüstung:</b> ${[...new Set((c.classes || []).flatMap((x, i) => (i === 0 ? perEd(findClass(x.cls)?.armor, ed) || [] : [])))].map((a) => (a === 'shield' ? 'Schilde' : ARMOR_TYPE[a])).join(', ') || 'keine'}</div>
      <div><b>Werkzeuge:</b> ${c.tools || '–'}</div>
      <div><b>Sprachen:</b> ${(c.languages || []).join(', ') || '–'}</div>
      ${bg?.feature ? html`<div><b>Hintergrundmerkmal:</b> ${bg.feature}</div>` : null}
    </div>
    <${Field} label="Eigene Merkmale & Notizen (magische Gegenstände, Segnungen, Hausregeln)">
      <${AutoTextarea} value=${c.customFeatures || c.features || ''} disabled=${!canEdit} minRows=${4} onInput=${(e) => upd({ customFeatures: e.target.value })} />
    <//>
  </div>`;
}

function InventoryTab({ c, canEdit, upd }) {
  const inv = c.inventory || [];
  const set = (i, patch) => upd({ inventory: inv.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const cur = c.currency || {};
  return html`<div class="stack lg">
    <div class="card">
      <div class="card-head"><h3><${Icon} name="coins" size=${18} />Geld</h3></div>
      <div class="coins-row">${[['pp', 'PM'], ['gp', 'GM'], ['ep', 'EM'], ['sp', 'SM'], ['cp', 'KM']].map(([k, l]) => html`<${Field} label=${l}><input class="input" type="number" value=${cur[k] || 0} disabled=${!canEdit} onInput=${(e) => upd({ currency: { ...cur, [k]: Number(e.target.value) || 0 } })} /><//>`)}</div>
      <div class="tiny faint" style="margin-top:6px">Gesamtwert: ${(((cur.pp || 0) * 1000 + (cur.gp || 0) * 100 + (cur.ep || 0) * 50 + (cur.sp || 0) * 10 + (cur.cp || 0)) / 100).toLocaleString('de-DE')} GM</div>
    </div>
    <div class="card">
      <div class="card-head"><h3><${Icon} name="backpack" size=${18} />Ausrüstung</h3><span class="grow"></span>${canEdit ? html`<${Btn} size="sm" icon="plus" onClick=${() => upd({ inventory: [...inv, { id: uid(5), name: '', qty: 1, notes: '' }] })}>Gegenstand<//>` : null}</div>
      <table class="inv-table"><tbody>${inv.map((it, i) => html`<tr key=${it.id || i}>
        <td style="width:64px"><input class="input" type="number" value=${it.qty} disabled=${!canEdit} onInput=${(e) => set(i, { qty: Number(e.target.value) })} /></td>
        <td><input class="input" value=${it.name} placeholder="Gegenstand" disabled=${!canEdit} onInput=${(e) => set(i, { name: e.target.value })} /></td>
        <td><input class="input" value=${it.notes} placeholder="Notiz" disabled=${!canEdit} onInput=${(e) => set(i, { notes: e.target.value })} /></td>
        <td style="width:40px">${canEdit ? html`<${IconBtn} icon="x" class="danger" onClick=${() => upd({ inventory: inv.filter((_, j) => j !== i) })} />` : null}</td>
      </tr>`)}</tbody></table>
      ${!inv.length ? html`<div class="small faint">Leer.</div>` : null}
    </div>
  </div>`;
}

function PersonaTab({ c, canEdit, upd, nextXp }) {
  const p = c.personality || {};
  return html`<div class="stack lg">
    <div class="grid two">
      <${Field} label="Gesinnung"><${Select} value=${c.alignment || ''} disabled=${!canEdit} onChange=${(v) => upd({ alignment: v })} options=${[{ value: '', label: '–' }, ...ALIGNMENTS]} /><//>
      <${Field} label=${`Erfahrungspunkte${nextXp ? ` (nächste Stufe bei ${nextXp.toLocaleString('de-DE')})` : ''}`}><input class="input" type="number" value=${c.xp || 0} disabled=${!canEdit} onInput=${(e) => upd({ xp: Number(e.target.value) || 0 })} /><//>
    </div>
    <${Field} label="Aussehen"><${AutoTextarea} value=${c.appearance || ''} disabled=${!canEdit} minRows=${2} onInput=${(e) => upd({ appearance: e.target.value })} /><//>
    <div class="grid two">
      ${[['traits', 'Persönlichkeitsmerkmale'], ['ideals', 'Ideale'], ['bonds', 'Bindungen'], ['flaws', 'Makel']].map(([k, l]) => html`<${Field} label=${l}><${AutoTextarea} value=${p[k] || ''} disabled=${!canEdit} minRows=${2} onInput=${(e) => upd({ personality: { ...p, [k]: e.target.value } })} /><//>`)}
    </div>
    <${Field} label="Hintergrundgeschichte"><${AutoTextarea} value=${c.backstory || ''} disabled=${!canEdit} minRows=${5} onInput=${(e) => upd({ backstory: e.target.value })} /><//>
    <${Field} label="Notizen"><${AutoTextarea} value=${c.notes || ''} disabled=${!canEdit} minRows=${4} onInput=${(e) => upd({ notes: e.target.value })} /><//>
  </div>`;
}
