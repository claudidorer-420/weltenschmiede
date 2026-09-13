// Charakterbögen (5e): gehören dem Spieler (users/{uid}/characters) und wandern von Kampagne zu Kampagne mit.
import { html, useState, useEffect, useRef, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, vault, col, myUid, isRealGM } from '../core/app.js';
import { db } from '../core/db.js';
import { openView } from '../core/workspace.js';
import { watchParty } from '../core/party.js';
import { doRoll } from '../core/rolls.js';
import { modifier, fmtMod } from '../lib/dice.js';
import { ABILITIES, SKILLS, CLASSES, SPECIES, ALIGNMENTS, pbForLevel, XP_LEVELS } from '../data/rules5e.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, IconBtn, Btn, Field, Select, Toggle, AutoTextarea, MarkdownView, openModal, confirmDialog, toast, Empty, Avatar, pickFiles, Segmented } from '../ui/components.js';
import { useCol, useDoc } from '../core/hooks.js';
import { now, colorFromString, debounce, uid } from '../lib/util.js';
import { dataUrlFromImageFile } from '../lib/image.js';

export function newCharacter({ name, cls = 'Kämpfer', species = 'Mensch', level = 1 }) {
  const c = CLASSES.find((x) => x.name === cls);
  const hd = c?.hd || 8;
  return {
    name, species, cls, subclass: '', level, background: '', alignment: '', xp: XP_LEVELS[Math.max(0, level - 1)] || 0,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, saves: c ? [...c.saves] : [], skills: {},
    ac: 10, speed: '9 m', maxHp: hd, hp: hd, tempHp: 0, hitDice: `${level}W${hd}`, initBonus: 0, inspiration: false, deathSaves: { s: 0, f: 0 },
    attacks: [], spell: { ability: c?.cast || '', slots: {}, spells: [] }, currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, inventory: [],
    features: '', personality: { traits: '', ideals: '', bonds: '', flaws: '' }, backstory: '', notes: '', portrait: '', conditions: [], exhaustion: 0,
    campaignId: null, color: colorFromString(name), createdAt: now(), updatedAt: now(),
  };
}

export async function assignToCampaign(charId, cid = app.get().cid) {
  const me = myUid();
  await db.update(`users/${me}/characters`, charId, { campaignId: cid || null });
  if (cid) await db.update(`campaigns/${cid}/members`, me, { characterId: charId }).catch(() => {});
}

function NewCharForm({ close }) {
  const [f, setF] = useState({ name: '', cls: 'Kämpfer', species: 'Mensch', level: 1, assign: !!app.get().cid });
  return html`<form onSubmit=${(e) => { e.preventDefault(); if (f.name.trim()) close(f); }}>
    <div class="modal-body stack">
      <${Field} label="Name"><input class="input" value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} autoFocus /><//>
      <div class="grid three" style="gap:8px">
        <${Field} label="Klasse"><${Select} value=${f.cls} onChange=${(v) => setF({ ...f, cls: v })} options=${CLASSES.map((c) => c.name)} /><//>
        <${Field} label="Volk"><input class="input" list="ws-sp" value=${f.species} onInput=${(e) => setF({ ...f, species: e.target.value })} /><datalist id="ws-sp">${SPECIES.map((s) => html`<option value=${s} />`)}</datalist><//>
        <${Field} label="Stufe"><input class="input" type="number" min="1" max="20" value=${f.level} onInput=${(e) => setF({ ...f, level: Math.max(1, Math.min(20, Number(e.target.value))) })} /><//>
      </div>
      ${app.get().cid ? html`<${Toggle} checked=${f.assign} onChange=${(v) => setF({ ...f, assign: v })} label=${`Mit „${app.get().campaign?.name}“ verknüpfen`} />` : null}
    </div>
    <div class="modal-foot"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" type="submit" icon="plus">Anlegen<//></div>
  </form>`;
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
        <div class="tiny faint">TP ${c.hp}/${c.maxHp} · RK ${c.ac}${mineInCampaign ? ' · in dieser Kampagne' : ''}</div>
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

  const create = async () => {
    const f = await openModal(({ close }) => html`<${NewCharForm} close=${close} />`, { title: 'Neuer Charakter', icon: 'user-plus' });
    if (!f) return;
    const id = await db.add(`users/${me}/characters`, newCharacter(f));
    if (f.assign) await assignToCampaign(id);
    openView('character', { id, owner: me, title: f.name });
  };

  return html`<${ViewFrame} tabId=${tabId} title="Charaktere">
    <div class="page stack lg">
      <div class="page-head"><h1><${Icon} name="users" size=${24} />Charaktere</h1><span class="grow"></span><${Btn} kind="primary" icon="user-plus" onClick=${create}>Neuer Charakter<//>
        <span class="sub">Charaktere gehören dir und bleiben erhalten, auch wenn eine Kampagne endet – verknüpfe sie einfach mit der nächsten.</span></div>
      <div class="section-title">Meine Charaktere</div>
      ${!mine ? html`<div class="empty"><span class="spinner" /></div>` : !mine.length ? html`<${Empty} icon="user" title="Noch kein Charakter" action=${html`<${Btn} icon="user-plus" onClick=${create}>Charakter anlegen<//>`} />`
        : html`<div class="grid cards">${mine.map((c) => html`<${CharCard} key=${c.id} c=${c} owner=${me} mineInCampaign=${c.campaignId === cid} />`)}</div>`}
      ${gm && others.length ? html`<div class="section-title">Gruppe dieser Kampagne</div>
        <div class="grid cards">${others.map((p) => html`<${CharCard} key=${p.char.id} c=${p.char} owner=${p.owner} />`)}</div>` : null}
      ${gm && db.mode === 'cloud' && !others.length ? html`<div class="small faint">Sobald Spieler beitreten und ihre Charaktere verknüpfen, erscheinen sie hier.</div>` : null}
    </div>
  <//>`;
}

// ───────────────────────── Charakterbogen ─────────────────────────
export function CharacterView({ params, tabId }) {
  const { id, owner } = params;
  const path = owner ? `users/${owner}/characters` : null;
  const remote = useDoc(path, id);
  const me = useStore(app, (s) => s.user?.uid);
  const cid = useStore(app, (s) => s.cid);
  const [c, setC] = useState(null);
  const [tab, setTab] = useState('bogen');
  const pending = useRef({});
  const editable = owner === me || isRealGM();

  const flush = useMemo(() => debounce(async () => {
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) await db.update(path, id, { ...patch, updatedAt: now() }).catch((e) => toast(`Speichern fehlgeschlagen: ${e.message}`, 'error'));
  }, 600), [path, id]);
  useEffect(() => () => flush.flush?.(), []);
  useEffect(() => {
    if (remote && !Object.keys(pending.current).length) setC(remote);
  }, [remote]);

  if (remote === undefined) return html`<${ViewFrame} tabId=${tabId} title="Charakterbogen"><div class="empty"><span class="spinner lg" /></div><//>`;
  if (!remote || !c) return html`<${ViewFrame} tabId=${tabId} title="Charakterbogen"><${Empty} icon="user" title="Charakter nicht gefunden" /><//>`;

  const upd = (patch) => {
    if (!editable) return;
    setC((x) => ({ ...x, ...patch }));
    Object.assign(pending.current, patch);
    flush();
  };
  const pb = pbForLevel(c.level || 1);
  const m = (k) => modifier(c.abilities?.[k] ?? 10);
  const rollIt = (bonus, label) => doRoll(`1d20${bonus >= 0 ? '+' : ''}${bonus}`, { label: `${c.name}: ${label}`, character: c.name });
  const skillBonus = (s) => m(s.ability) + (c.skills?.[s.key] || 0) * pb;
  const saveBonus = (k) => m(k) + ((c.saves || []).includes(k) ? pb : 0);
  const perc = 10 + skillBonus(SKILLS.find((s) => s.key === 'perception'));
  const castAb = c.spell?.ability;
  const campaigns = app.get().campaigns;

  const setAbility = (k, v) => upd({ abilities: { ...c.abilities, [k]: Math.max(1, Math.min(30, Number(v) || 10)) } });
  const cycleSkill = (key) => upd({ skills: { ...c.skills, [key]: ((c.skills?.[key] || 0) + 1) % 3 } });
  const toggleSave = (k) => upd({ saves: (c.saves || []).includes(k) ? c.saves.filter((x) => x !== k) : [...(c.saves || []), k] });
  const hpDelta = (d) => {
    let hp = c.hp;
    let temp = c.tempHp || 0;
    if (d < 0) {
      const t = Math.min(temp, -d);
      temp -= t;
      hp = Math.max(0, hp + d + t);
    } else hp = Math.min(c.maxHp, hp + d);
    upd({ hp, tempHp: temp });
  };
  const levelUp = async () => {
    const cls = CLASSES.find((x) => x.name === c.cls);
    const hd = cls?.hd || 8;
    const gain = Math.max(1, Math.floor(hd / 2) + 1 + m('con'));
    if (!(await confirmDialog(`${c.name} steigt auf Stufe ${c.level + 1}. Max-TP +${gain} (Durchschnitt W${hd} + KON).`, { ok: 'Aufsteigen', title: 'Stufenaufstieg' }))) return;
    upd({ level: c.level + 1, maxHp: c.maxHp + gain, hp: c.hp + gain, hitDice: `${c.level + 1}W${hd}` });
    toast(`Stufe ${c.level + 1}!`, 'success');
  };
  const setPortrait = async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (f) upd({ portrait: await dataUrlFromImageFile(f, { maxDim: 320, quality: 0.8 }) });
  };
  const rows = (key, blank) => {
    const list = c[key] || [];
    return {
      list,
      set: (i, patch) => upd({ [key]: list.map((r, j) => (j === i ? { ...r, ...patch } : r)) }),
      add: () => upd({ [key]: [...list, { id: uid(5), ...blank }] }),
      remove: (i) => upd({ [key]: list.filter((_, j) => j !== i) }),
    };
  };
  const atk = rows('attacks', { name: '', bonus: '+0', damage: '1d6', notes: '' });
  const inv = rows('inventory', { name: '', qty: 1, weight: '', notes: '' });
  const spells = c.spell?.spells || [];
  const setSpell = (patch) => upd({ spell: { ...c.spell, ...patch } });

  const header = html`<div class="row nowrap" style="gap:2px">
    ${editable ? html`<${Btn} size="sm" icon="arrow-up" onClick=${levelUp}>Stufe +1<//>` : null}
  </div>`;

  return html`<${ViewFrame} tabId=${tabId} title=${c.name} actions=${header}>
    <div class="page sheet">
      <div class="sheet-top">
        <div class="sheet-portrait" style=${c.portrait ? { backgroundImage: `url(${c.portrait})` } : {}} onClick=${editable ? setPortrait : null} title="Porträt ändern">${c.portrait ? '' : html`<${Icon} name="image" size=${28} />`}</div>
        <div class="stack sm">
          <input class="inline-title-input" style="margin:0;font-family:var(--font-serif)" value=${c.name} disabled=${!editable} onInput=${(e) => upd({ name: e.target.value })} />
          <div class="row" style="gap:6px">
            <input class="input sm" style="width:140px" list="ws-sp2" value=${c.species} disabled=${!editable} onInput=${(e) => upd({ species: e.target.value })} placeholder="Volk" /><datalist id="ws-sp2">${SPECIES.map((s) => html`<option value=${s} />`)}</datalist>
            <${Select} class="sm" value=${c.cls} disabled=${!editable} onChange=${(v) => upd({ cls: v })} options=${CLASSES.map((x) => x.name)} style="width:150px" />
            <input class="input sm" style="width:150px" value=${c.subclass} disabled=${!editable} onInput=${(e) => upd({ subclass: e.target.value })} placeholder="Unterklasse" />
            <span class="badge accent">Stufe ${c.level}</span><span class="badge">Übung +${pb}</span>
          </div>
          <div class="row" style="gap:6px">
            <input class="input sm" style="width:170px" value=${c.background} disabled=${!editable} onInput=${(e) => upd({ background: e.target.value })} placeholder="Hintergrund" />
            <${Select} class="sm" value=${c.alignment} disabled=${!editable} onChange=${(v) => upd({ alignment: v })} options=${[{ value: '', label: 'Gesinnung' }, ...ALIGNMENTS]} style="width:190px" />
            ${owner === me ? html`<${Select} class="sm" value=${c.campaignId || ''} onChange=${(v) => assignToCampaign(c.id, v || null).then(() => toast(v ? 'Mit Kampagne verknüpft' : 'Verknüpfung gelöst', 'success'))} options=${[{ value: '', label: '– keine Kampagne –' }, ...campaigns.map((x) => ({ value: x.id, label: `Kampagne: ${x.name}` }))]} style="width:230px" />` : null}
          </div>
        </div>
      </div>

      <${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'bogen', label: 'Werte', icon: 'shield' }, { value: 'kampf', label: 'Angriffe & Zauber', icon: 'swords' }, { value: 'inventar', label: 'Inventar', icon: 'backpack' }, { value: 'persona', label: 'Persönlichkeit', icon: 'feather' }]} />

      ${tab === 'bogen' ? html`
        <div class="stat-grid">${ABILITIES.map((a) => html`<div class="stat-box">
          <span class="lbl">${a.short}</span>
          <span class="mod" title=${`${a.name}-Probe würfeln`} onClick=${() => rollIt(m(a.key), `${a.name}-Probe`)}>${fmtMod(m(a.key))}</span>
          <input class="input" type="number" value=${c.abilities?.[a.key] ?? 10} disabled=${!editable} onInput=${(e) => setAbility(a.key, e.target.value)} />
        </div>`)}</div>

        <div class="vitals">
          <div class="vital"><div class="lbl">Rüstungsklasse</div><input class="input" type="number" value=${c.ac} disabled=${!editable} onInput=${(e) => upd({ ac: Number(e.target.value) })} /></div>
          <div class="vital" style="cursor:pointer" onClick=${() => rollIt(m('dex') + (Number(c.initBonus) || 0), 'Initiative')}><div class="lbl">Initiative</div><div class="val">${fmtMod(m('dex') + (Number(c.initBonus) || 0))}</div></div>
          <div class="vital"><div class="lbl">Bewegung</div><input class="input" value=${c.speed} disabled=${!editable} onInput=${(e) => upd({ speed: e.target.value })} /></div>
          <div class="vital"><div class="lbl">Passive Wahrn.</div><div class="val">${perc}</div></div>
          <div class="vital"><div class="lbl">Trefferwürfel</div><input class="input" value=${c.hitDice} disabled=${!editable} onInput=${(e) => upd({ hitDice: e.target.value })} /></div>
          <div class="vital" onClick=${() => upd({ inspiration: !c.inspiration })} style="cursor:pointer"><div class="lbl">Inspiration</div><div class="val">${c.inspiration ? '★' : '☆'}</div></div>
        </div>

        <div class="card stack">
          <div class="row"><b class="grow"><${Icon} name="heart" size=${16} /> Trefferpunkte</b>
            <span class="small muted">Max</span><input class="input tiny" type="number" value=${c.maxHp} disabled=${!editable} onInput=${(e) => upd({ maxHp: Number(e.target.value) })} />
            <span class="small muted">Temp</span><input class="input tiny" type="number" value=${c.tempHp || 0} disabled=${!editable} onInput=${(e) => upd({ tempHp: Number(e.target.value) })} />
          </div>
          <div class="row">
            <span style="font:700 34px var(--font-serif)">${c.hp}</span><span class="muted">/ ${c.maxHp}</span>
            <span class="grow"></span>
            ${[-10, -5, -1].map((d) => html`<${Btn} size="sm" kind="danger" disabled=${!editable} onClick=${() => hpDelta(d)}>${d}<//>`)}
            ${[1, 5, 10].map((d) => html`<${Btn} size="sm" kind="success" disabled=${!editable} onClick=${() => hpDelta(d)}>+${d}<//>`)}
          </div>
          <div class="hpbar" style="max-width:none"><div class=${c.hp / (c.maxHp || 1) > 0.5 ? '' : c.hp / (c.maxHp || 1) > 0.25 ? 'mid' : 'low'} style=${{ width: `${Math.max(0, Math.min(100, (c.hp / (c.maxHp || 1)) * 100))}%` }}></div></div>
          ${c.hp <= 0 ? html`<div class="row"><b>Todesrettungswürfe</b>
            <span class="death-saves">${[0, 1, 2].map((i) => html`<i class=${i < c.deathSaves.s ? 's' : ''} onClick=${() => upd({ deathSaves: { ...c.deathSaves, s: i < c.deathSaves.s ? i : i + 1 } })}></i>`)}</span> Erfolge
            <span class="death-saves">${[0, 1, 2].map((i) => html`<i class=${i < c.deathSaves.f ? 'f' : ''} onClick=${() => upd({ deathSaves: { ...c.deathSaves, f: i < c.deathSaves.f ? i : i + 1 } })}></i>`)}</span> Fehlschläge
            <${Btn} size="sm" icon="d20" onClick=${() => doRoll('1d20', { label: `${c.name}: Todesrettungswurf`, character: c.name })}>Würfeln<//></div>` : null}
        </div>

        <div class="grid two">
          <div class="card">
            <div class="card-head"><h3>Rettungswürfe</h3></div>
            ${ABILITIES.map((a) => html`<div class="skill">
              <span class=${`prof${(c.saves || []).includes(a.key) ? ' p1' : ''}`} onClick=${() => editable && toggleSave(a.key)}></span>
              <span class="bonus" onClick=${() => rollIt(saveBonus(a.key), `${a.name}-Rettungswurf`)}>${fmtMod(saveBonus(a.key))}</span><span>${a.name}</span>
            </div>`)}
          </div>
          <div class="card">
            <div class="card-head"><h3>Fertigkeiten</h3><span class="grow"></span><span class="tiny faint">Kreis antippen: geübt → Expertise</span></div>
            <div class="skill-list">${SKILLS.map((s) => html`<div class="skill">
              <span class=${`prof${c.skills?.[s.key] ? ` p${c.skills[s.key]}` : ''}`} onClick=${() => editable && cycleSkill(s.key)}></span>
              <span class="bonus" onClick=${() => rollIt(skillBonus(s), s.name)}>${fmtMod(skillBonus(s))}</span><span>${s.name}</span><span class="ab">${ABILITIES.find((a) => a.key === s.ability).short}</span>
            </div>`)}</div>
          </div>
        </div>
        <div class="card"><div class="card-head"><h3>Merkmale & Fähigkeiten</h3></div>
          <${AutoTextarea} value=${c.features} disabled=${!editable} onInput=${(e) => upd({ features: e.target.value })} minRows=${4} placeholder="Klassenmerkmale, Volksmerkmale, Talente … (Markdown, 1d6 wird klickbar)" /></div>
      ` : null}

      ${tab === 'kampf' ? html`
        <div class="card">
          <div class="card-head"><h3><${Icon} name="swords" size=${18} />Angriffe</h3><span class="grow"></span>${editable ? html`<${Btn} size="sm" icon="plus" onClick=${atk.add}>Angriff<//>` : null}</div>
          <table class="inv-table"><tbody>
            ${atk.list.map((a, i) => html`<tr>
              <td><input class="input" value=${a.name} placeholder="Waffe" disabled=${!editable} onInput=${(e) => atk.set(i, { name: e.target.value })} /></td>
              <td style="width:80px"><input class="input" value=${a.bonus} placeholder="+5" disabled=${!editable} onInput=${(e) => atk.set(i, { bonus: e.target.value })} /></td>
              <td style="width:120px"><input class="input" value=${a.damage} placeholder="1d8+3" disabled=${!editable} onInput=${(e) => atk.set(i, { damage: e.target.value })} /></td>
              <td style="width:120px" class="nowrap">
                <${IconBtn} icon="d20" title="Angriff würfeln" onClick=${() => doRoll(`1d20${/^[+-]/.test(a.bonus) ? a.bonus : `+${a.bonus || 0}`}`, { label: `${c.name}: ${a.name || 'Angriff'}`, character: c.name })} />
                <${IconBtn} icon="flame" title="Schaden würfeln" onClick=${() => doRoll(a.damage || '1d6', { label: `${c.name}: ${a.name || 'Angriff'} – Schaden`, character: c.name })} />
                ${editable ? html`<${IconBtn} icon="x" class="danger" onClick=${() => atk.remove(i)} />` : null}
              </td>
            </tr>`)}
          </tbody></table>
          ${!atk.list.length ? html`<div class="small faint">Noch keine Angriffe eingetragen.</div>` : null}
        </div>
        <div class="card stack">
          <div class="card-head" style="margin:0"><h3><${Icon} name="wand" size=${18} />Zauberwirken</h3></div>
          <div class="row">
            <${Select} value=${castAb || ''} disabled=${!editable} onChange=${(v) => setSpell({ ability: v })} options=${[{ value: '', label: 'Kein Zauberwirken' }, ...ABILITIES.map((a) => ({ value: a.key, label: a.name }))]} style="width:200px" />
            ${castAb ? html`<span class="badge accent">Zauber-SG ${8 + pb + m(castAb)}</span><span class="badge accent" style="cursor:pointer" onClick=${() => rollIt(pb + m(castAb), 'Zauberangriff')}>Zauberangriff ${fmtMod(pb + m(castAb))}</span>` : null}
          </div>
          ${castAb ? html`<div>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => {
            const s = c.spell?.slots?.[lv] || { max: 0, used: 0 };
            if (!editable && !s.max) return null;
            return html`<div class="slot-row"><span class="small" style="width:70px">Grad ${lv}</span>
              ${editable ? html`<input class="input tiny" type="number" min="0" max="9" value=${s.max} onInput=${(e) => setSpell({ slots: { ...c.spell.slots, [lv]: { max: Number(e.target.value), used: Math.min(s.used, Number(e.target.value)) } } })} />` : null}
              ${Array.from({ length: s.max }, (_, i) => html`<span class=${`slot-pip${i < s.used ? ' used' : ''}`} onClick=${() => setSpell({ slots: { ...c.spell.slots, [lv]: { ...s, used: i < s.used ? i : i + 1 } } })}></span>`)}
            </div>`;
          })}
            <${Btn} size="sm" kind="ghost" icon="moon" onClick=${() => setSpell({ slots: Object.fromEntries(Object.entries(c.spell?.slots || {}).map(([k, v]) => [k, { ...v, used: 0 }])) })}>Lange Rast: Plätze auffüllen<//>
          </div>` : null}
          ${castAb ? html`<div class="stack sm">
            ${spells.map((sp, i) => html`<div class="row nowrap">
              <input class="input tiny" type="number" min="0" max="9" value=${sp.level} title="Grad" disabled=${!editable} onInput=${(e) => setSpell({ spells: spells.map((x, j) => (j === i ? { ...x, level: Number(e.target.value) } : x)) })} />
              <input class="input sm grow" value=${sp.name} placeholder="Zauber" disabled=${!editable} onInput=${(e) => setSpell({ spells: spells.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <label class="check small"><input type="checkbox" checked=${!!sp.prepared} disabled=${!editable} onChange=${(e) => setSpell({ spells: spells.map((x, j) => (j === i ? { ...x, prepared: e.target.checked } : x)) })} />vorb.</label>
              ${editable ? html`<${IconBtn} icon="x" class="danger" onClick=${() => setSpell({ spells: spells.filter((_, j) => j !== i) })} />` : null}
            </div>`)}
            ${editable ? html`<${Btn} size="sm" icon="plus" onClick=${() => setSpell({ spells: [...spells, { id: uid(5), level: 1, name: '', prepared: true }] })}>Zauber<//>` : null}
          </div>` : null}
        </div>
      ` : null}

      ${tab === 'inventar' ? html`
        <div class="card">
          <div class="card-head"><h3><${Icon} name="coins" size=${18} />Geld</h3></div>
          <div class="coins-row">${['pp', 'gp', 'ep', 'sp', 'cp'].map((k) => html`<${Field} label=${k}><input class="input" type="number" value=${c.currency?.[k] || 0} disabled=${!editable} onInput=${(e) => upd({ currency: { ...c.currency, [k]: Number(e.target.value) } })} /><//>`)}</div>
          <div class="tiny faint" style="margin-top:6px">Gesamtwert: ${(((c.currency?.pp || 0) * 1000 + (c.currency?.gp || 0) * 100 + (c.currency?.ep || 0) * 50 + (c.currency?.sp || 0) * 10 + (c.currency?.cp || 0)) / 100).toLocaleString('de-DE')} gp</div>
        </div>
        <div class="card">
          <div class="card-head"><h3><${Icon} name="backpack" size=${18} />Ausrüstung</h3><span class="grow"></span>${editable ? html`<${Btn} size="sm" icon="plus" onClick=${inv.add}>Gegenstand<//>` : null}</div>
          <table class="inv-table"><tbody>${inv.list.map((it, i) => html`<tr>
            <td style="width:64px"><input class="input" type="number" value=${it.qty} disabled=${!editable} onInput=${(e) => inv.set(i, { qty: Number(e.target.value) })} /></td>
            <td><input class="input" value=${it.name} placeholder="Gegenstand" disabled=${!editable} onInput=${(e) => inv.set(i, { name: e.target.value })} /></td>
            <td><input class="input" value=${it.notes} placeholder="Notiz" disabled=${!editable} onInput=${(e) => inv.set(i, { notes: e.target.value })} /></td>
            <td style="width:40px">${editable ? html`<${IconBtn} icon="x" class="danger" onClick=${() => inv.remove(i)} />` : null}</td>
          </tr>`)}</tbody></table>
        </div>
      ` : null}

      ${tab === 'persona' ? html`
        <div class="grid two">
          ${[['traits', 'Persönlichkeitsmerkmale'], ['ideals', 'Ideale'], ['bonds', 'Bindungen'], ['flaws', 'Makel']].map(([k, l]) => html`<${Field} label=${l}><${AutoTextarea} value=${c.personality?.[k] || ''} disabled=${!editable} minRows=${2} onInput=${(e) => upd({ personality: { ...c.personality, [k]: e.target.value } })} /><//>`)}
        </div>
        <${Field} label="Hintergrundgeschichte"><${AutoTextarea} value=${c.backstory} disabled=${!editable} minRows=${5} onInput=${(e) => upd({ backstory: e.target.value })} /><//>
        <${Field} label="Notizen"><${AutoTextarea} value=${c.notes} disabled=${!editable} minRows=${4} onInput=${(e) => upd({ notes: e.target.value })} /><//>
      ` : null}
    </div>
  <//>`;
}
