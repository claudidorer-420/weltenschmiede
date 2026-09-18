// Charaktere: Liste und Charakterbogen. Aufbau angelehnt an D&D Beyond (Attributskästen, Aktionen, Zauber, Inventar,
// Übungen, Hintergrund) – aber ohne Dauer-Kopfleiste: Die schmale Leiste erscheint erst beim Scrollen.
// Werte sind fest (Assistent & Stufenaufstieg); änderbar ist der Spielstand. Korrektur-Modus für Ausnahmen.
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
  findClass, findSpecies, findBackground, findFeat, findWeapon, weaponAttack, ARMOR, ARMOR_TYPE, fmtDist, edOf, totalLevel, perEd, classLevel, RES_INFO,
} from '../data/chargen.js';
import { useSpells, damageAt, healAt, healHasMod, fmtDice, damageName, timeShort, rangeShort, levelName, listClassOf } from '../data/spells.js';
import { CATALOG, CATEGORIES, catalogItem, catalogByName, fmtCost, fmtWeight, carryCapacity, WEAPON_RANGE, weaponReach } from '../data/items.js';
import { openCharacterWizard as runWizard, openLevelUp, derive, migrateLegacy } from './charwizard.js';
import { openSpellManager, normalizeEntries, SpellDetail, openSpellDetail } from './spellbook.js';
import { SpellArt, ItemArt, DamageTag, GameIcon } from '../ui/art.js';
import { ViewFrame } from '../ui/frame.js';
import {
  Icon, IconBtn, Btn, Field, Select, Toggle, AutoTextarea, openModal, confirmDialog, toast, Empty, Avatar, pickFiles, openMenu, promptDialog, useMedia,
} from '../ui/components.js';
import { useCol, useDoc } from '../core/hooks.js';
import { now, debounce, uid } from '../lib/util.js';
import { dataUrlFromImageFile } from '../lib/image.js';

const sg = (n) => (n >= 0 ? `+${n}` : `${n}`);
const DMG_KEY = { Wucht: 'bludgeoning', Stich: 'piercing', Hieb: 'slashing' };

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
  const cls = [c.cls, c.subclass].filter(Boolean).join(' · ');
  return html`<button type="button" class="char-card" onClick=${() => openView('character', { id: c.id, owner, title: c.name })}>
    ${c.portrait ? html`<span class="avatar lg"><img src=${c.portrait} alt="" /></span>` : html`<${Avatar} name=${c.name} size="lg" color=${c.color} />`}
    <span class="cc-main">
      <span class="cc-top"><b class="cc-name" title=${c.name}>${c.name}</b>${c.level ? html`<span class="badge accent">Stufe ${c.level}</span>` : null}</span>
      ${c.species ? html`<span class="cc-line">${c.species}</span>` : null}
      ${cls ? html`<span class="cc-line muted" title=${cls}>${cls}</span>` : null}
      <span class="cc-hp"><span class=${pct > 50 ? '' : pct > 25 ? 'mid' : 'low'} style=${{ width: `${pct}%` }}></span></span>
      <span class="cc-stats"><span>TP ${c.hp ?? '?'}/${c.maxHp ?? '?'}</span><span>RK ${c.ac ?? '?'}</span>
        ${mineInCampaign ? html`<span class="badge players">in dieser Kampagne</span>` : null}${!c.classes?.length ? html`<span class="badge">alter Bogen</span>` : null}</span>
    </span>
  </button>`;
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
      ${!mine ? html`<div class="empty"><span class="spinner" /></div>` : !mine.length ? html`<${Empty} icon="user" title="Noch kein Charakter" action=${html`<${Btn} icon="user-plus" onClick=${create}>Charakter erschaffen<//>`}>Volk, Klasse, Hintergrund, Attribute, Fertigkeiten, Zauber – alles nach den Regeln, in etwa 10 Minuten.<//>`
        : html`<div class="char-grid">${mine.map((c) => html`<${CharCard} key=${c.id} c=${c} owner=${me} mineInCampaign=${c.campaignId === cid} />`)}</div>`}
      ${gm && others.length ? html`<div class="section-title">Gruppe dieser Kampagne</div>
        <div class="char-grid">${others.map((p) => html`<${CharCard} key=${p.char.id} c=${p.char} owner=${p.owner} />`)}</div>` : null}
      ${gm && db.mode === 'cloud' && !others.length ? html`<div class="small faint">Sobald Spieler beitreten und ihre Charaktere verknüpfen, erscheinen sie hier.</div>` : null}
    </div>
  <//>`;
}

export function CharacterView({ params, tabId }) {
  return html`<${ViewFrame} tabId=${tabId} title=${params.title || 'Charakterbogen'}><${CharacterSheet} id=${params.id} owner=${params.owner} /><//>`;
}

// ───────────────────────── Hilfen ─────────────────────────
function hitDicePools(c) {
  return (c.classes || []).map((x) => ({ cls: x.cls, hd: findClass(x.cls)?.hd || 8, total: x.level, used: Number(c.hdUsed?.[x.cls] ?? (typeof c.hdUsed === 'number' && x === c.classes[0] ? c.hdUsed : 0)) || 0 }));
}

function Pips({ max, used, onSet, disabled }) {
  if (max > 12) {
    return html`<div class="row nowrap" style="gap:4px"><${IconBtn} icon="minus" disabled=${disabled || used >= max} onClick=${() => onSet(used + 1)} /><b>${max - used}</b><span class="faint">/ ${max}</span><${IconBtn} icon="plus" disabled=${disabled || used <= 0} onClick=${() => onSet(used - 1)} /></div>`;
  }
  return html`<span class="pips">${Array.from({ length: max }, (_, i) => html`<i class=${i < used ? 'used' : ''} onClick=${() => !disabled && onSet(i < used ? i : i + 1)}></i>`)}</span>`;
}

function attacksPerAction(c) {
  let n = 1;
  for (const x of c.classes || []) {
    if (x.cls === 'kaempfer') n = Math.max(n, x.level >= 20 ? 4 : x.level >= 11 ? 3 : x.level >= 5 ? 2 : 1);
    else if (['barbar', 'moench', 'paladin', 'waldlaeufer'].includes(x.cls) && x.level >= 5) n = Math.max(n, 2);
  }
  return n;
}
function martialDie(c) {
  const l = classLevel(c, 'moench');
  if (!l) return 0;
  return edOf(c) === '2024' ? (l >= 17 ? 12 : l >= 11 ? 10 : l >= 5 ? 8 : 6) : l >= 17 ? 10 : l >= 11 ? 8 : l >= 5 ? 6 : 4;
}
const fmtM = (m) => `${String(m).replace('.', ',')} m`;

// Welche Klassenmerkmale sind Aktionen, Bonusaktionen oder Reaktionen?
const FEATURE_ACTIONS = {
  'Zweiter Wind': 'bonus', 'Raffinierte Aktion': 'bonus', Kampfrausch: 'bonus', 'Bardische Inspiration': 'bonus', 'Fokus des Mönchs': 'bonus', Ki: 'bonus',
  'Unglaubliches Ausweichen': 'reaction', 'Angriffe ablenken': 'reaction', 'Geschosse abwehren': 'reaction', Handauflegen: 'action', 'Göttliche Macht fokussieren': 'action',
  Tiergestalt: 'action', 'Untote versengen': 'action', 'Untote zerstören': 'action', Gegenbezauberung: 'action', 'Betäubender Schlag': 'other', 'Tollkühner Angriff': 'other',
  'Hinterhältiger Angriff': 'other', 'Göttliches Niederstrecken': 'other', Tatendrang: 'other', 'Arkane Erholung': 'other', Metamagie: 'other', 'Quelle der Magie': 'bonus',
  'Bevorzugter Feind': 'bonus', 'Gerissener Schlag': 'other', 'Ruhiges Zielen': 'bonus', 'Taktische Verlagerung': 'bonus', Unbeugsam: 'other',
};
const STD_ACTIONS = {
  2024: [
    ['Angreifen', 'Ein Angriff mit einer Waffe oder waffenlos – mit Extra-Angriff entsprechend mehr.'], ['Magie', 'Einen Zauber mit Zeitaufwand „Aktion“ wirken oder einen magischen Gegenstand bzw. eine magische Fähigkeit nutzen.'],
    ['Spurt', 'Zusätzliche Bewegung in Höhe deiner Bewegungsrate.'], ['Rückzug', 'Deine Bewegung provoziert in diesem Zug keine Gelegenheitsangriffe.'],
    ['Ausweichen', 'Bis zu deinem nächsten Zug: Angriffe gegen dich im Nachteil, GES-Rettungswürfe im Vorteil.'], ['Helfen', 'Ein Verbündeter hat Vorteil auf seinen nächsten Attributswurf oder Angriff.'],
    ['Verstecken', 'GES (Heimlichkeit) SG 15 – außer Sicht, stark verschleiert oder hinter Deckung.'], ['Beeinflussen', 'CHA- oder WEI-Probe, um die Haltung einer Kreatur zu verändern.'],
    ['Studieren', 'INT-Probe, um etwas zu untersuchen oder dich an Wissen zu erinnern.'], ['Suchen', 'WEI-Probe, um etwas zu entdecken (Wahrnehmung, Motiv erkennen …).'],
    ['Vorbereiten', 'Eine Aktion für einen Auslöser bereithalten – ausgeführt als Reaktion.'], ['Verwenden', 'Einen Gegenstand benutzen, z. B. einen Heiltrank trinken.'],
  ],
  2014: [
    ['Angriff', 'Ein Nahkampf- oder Fernkampfangriff – mit Extra-Angriff entsprechend mehr.'], ['Zauber wirken', 'Einen Zauber mit Zeitaufwand „1 Aktion“ wirken.'],
    ['Spurt', 'Zusätzliche Bewegung in Höhe deiner Bewegungsrate.'], ['Rückzug', 'Deine Bewegung provoziert in diesem Zug keine Gelegenheitsangriffe.'],
    ['Ausweichen', 'Bis zu deinem nächsten Zug: Angriffe gegen dich im Nachteil, GES-Rettungswürfe im Vorteil.'], ['Helfen', 'Ein Verbündeter hat Vorteil auf seine nächste Probe bzw. seinen Angriff.'],
    ['Verstecken', 'GES-Probe (Heimlichkeit), um dich zu verbergen.'], ['Bereitmachen', 'Eine Aktion für einen Auslöser bereithalten – ausgeführt als Reaktion.'],
    ['Suchen', 'WEI (Wahrnehmung) oder INT (Nachforschungen), um etwas zu finden.'], ['Gegenstand benutzen', 'Einen Gegenstand verwenden, der eine Aktion braucht.'],
  ],
};
const WEAPON_CAT = { simple: 'Einfache Waffen', martial: 'Kriegswaffen', 'martial-light': 'Kriegswaffen (leicht)', 'martial-finesse': 'Kriegswaffen (Finesse oder leicht)' };

// ───────────────────────── Bogen ─────────────────────────
const TABS = [
  { value: 'werte', label: 'Werte', icon: 'shield', narrowOnly: true },
  { value: 'aktionen', label: 'Aktionen', icon: 'swords' },
  { value: 'zauber', label: 'Zauber', icon: 'wand', caster: true },
  { value: 'inventar', label: 'Inventar', icon: 'backpack' },
  { value: 'merkmale', label: 'Merkmale', icon: 'star' },
  { value: 'uebungen', label: 'Übungen', icon: 'book' },
  { value: 'hintergrund', label: 'Hintergrund', icon: 'feather' },
  { value: 'notizen', label: 'Notizen', icon: 'file-text' },
];

export function CharacterSheet({ id, owner }) {
  const path = owner ? `users/${owner}/characters` : null;
  const remote = useDoc(path, id);
  const me = useStore(app, (s) => s.user?.uid);
  const units = useStore(settings, (s) => s.units || 'm');
  const campaigns = useStore(app, (s) => s.campaigns);
  const wide = useMedia('(min-width: 1180px)');
  const [c, setC] = useState(null);
  const [tab, setTabRaw] = useState(() => localStorage.getItem('ws.sheetTab') || '');
  const [unlock, setUnlock] = useState(false);
  const [mini, setMini] = useState(false);
  const heroRef = useRef(null);
  const pending = useRef({});
  const canEdit = owner === me || isRealGM();
  const ed = c ? edOf(c) : '2014';
  const spells = useSpells(ed);

  const flush = useMemo(() => debounce(async () => {
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) await db.update(path, id, { ...patch, updatedAt: now() }).catch((e) => toast(`Speichern fehlgeschlagen: ${e.message}`, 'error'));
  }, 500), [path, id]);
  useEffect(() => () => flush.flush?.(), []);
  useEffect(() => {
    if (remote && !Object.keys(pending.current).length) setC(remote);
  }, [remote]);
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setMini(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [!!c]);

  if (remote === undefined) return html`<div class="empty"><span class="spinner lg" /></div>`;
  if (!remote || !c) return html`<${Empty} icon="user" title="Charakter nicht gefunden" />`;

  const legacy = !c.classes?.length;
  const cm = charMods(c);
  const traits = rollTraits(c);
  const res = legacy ? [] : resourcesFor(c);
  const slots = legacy ? { slots: {}, pact: null } : spellSlots(c);
  const entries = spells ? normalizeEntries(c.spell?.list, spells, c) : [];

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
  const roll20 = (bonus, label, kind, prof) => doRoll(`1d20${sg(bonus)}`, { label: `${c.name}: ${label}`, character: c.name, kind, fx: fxFor(kind, prof), edition: ed });
  const rollDmg = (expr, label, kind = 'damage') => doRoll(String(expr), { label: `${c.name}: ${label}`, character: c.name, kind, fx: kind === 'damage' ? fxFor('damage') : {}, edition: ed });

  const hpDelta = (d) => {
    let hp = Number(c.hp) || 0;
    let temp = Number(c.tempHp) || 0;
    if (d < 0) {
      const t = Math.min(temp, -d);
      temp -= t;
      hp = Math.max(0, hp + d + t);
      if (c.concentration && -d > 0) toast(`Konzentration auf „${c.concentration.name}“: KON-Rettungswurf SG ${Math.max(10, Math.floor(-d / 2))}`, 'info', { duration: 7000 });
    } else hp = Math.min(c.maxHp, hp + d);
    const patch = { hp, tempHp: temp };
    if (hp > 0) patch.deathSaves = { s: 0, f: 0 };
    upd(patch);
  };
  const hpDialog = async () => {
    if (!canEdit) return;
    const r = await openModal(({ close }) => html`<${HpDialog} c=${c} close=${close} />`, { title: 'Trefferpunkte', icon: 'heart', size: 'sm' });
    if (!r) return;
    if (r.temp != null) upd({ tempHp: Math.max(0, r.temp) });
    if (r.delta) hpDelta(r.delta);
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
  const editXp = async () => {
    if (!canEdit) return;
    const v = await promptDialog('Erfahrungspunkte', String(c.xp || 0), { title: 'Erfahrung', hint: nextXp ? `Nächste Stufe bei ${nextXp.toLocaleString('de-DE')} EP` : '', ok: 'Speichern' });
    if (v != null) upd({ xp: Math.max(0, parseInt(v, 10) || 0) });
  };
  const toggleUnlock = async () => {
    if (unlock) return setUnlock(false);
    if (await confirmDialog('Im Korrektur-Modus kannst du Attribute, Übungen, Trefferpunkte und Persönlichkeit direkt ändern – gedacht für Ausnahmen wie magische Gegenstände, Segnungen oder Tippfehler. Normalerweise ändern sich Werte nur beim Stufenaufstieg.', { title: 'Korrektur-Modus', ok: 'Freigeben' })) setUnlock(true);
  };
  const menu = (e) => openMenu(e, [
    canEdit ? { label: unlock ? 'Korrektur-Modus beenden' : 'Korrektur-Modus …', icon: unlock ? 'lock' : 'unlock', onClick: toggleUnlock } : null,
    canEdit ? { label: 'Porträt ändern …', icon: 'image', onClick: setPortrait } : null,
    canEdit ? { label: 'Erfahrungspunkte …', icon: 'star', onClick: editXp } : null,
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
  const prevXp = XP_LEVELS[cm.level - 1] || 0;
  const canLevel = canEdit && !legacy && cm.level < 20;
  const readyXp = nextXp && (Number(c.xp) || 0) >= nextXp;
  const clsLong = (c.classes || []).map((x) => `${findClass(x.cls)?.name || x.cls} ${x.level}${x.subclass ? ` (${x.subclass})` : ''}`).join(' / ') || `${c.cls || ''} ${c.level || ''}`;
  const isCaster = cm.spell.length || Object.keys(slots.slots).length || slots.pact || (c.spell?.list || []).length;
  const tabs = TABS.filter((t) => (!t.narrowOnly || !wide) && (!t.caster || isCaster));
  const cur = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;
  const setTab = (v) => { setTabRaw(v); localStorage.setItem('ws.sheetTab', v); };
  const hpPct = Math.max(0, Math.min(100, ((Number(c.hp) || 0) / (c.maxHp || 1)) * 100));
  const hpCls = hpPct > 50 ? '' : hpPct > 25 ? 'mid' : 'low';

  const ctx = { c, cm, ed, canEdit, unlock, upd, roll20, rollDmg, units, spells, entries, slots, res, traits, hpDelta, hpDialog, saveAll };

  return html`<div class="sheet2">
    <div ref=${heroRef} class="sh-hero">
      <div class="sh-portrait" style=${c.portrait ? { backgroundImage: `url(${c.portrait})` } : {}} onClick=${canEdit ? setPortrait : null} title=${canEdit ? 'Porträt ändern' : ''}>${c.portrait ? '' : (c.name || '?').slice(0, 1)}</div>
      <div class="sh-id">
        <h1>${c.name}</h1>
        <div class="muted">${c.species || '–'} · ${clsLong}${c.background ? ` · ${c.background}` : ''}</div>
        <div class="sh-badges">
          <button type="button" class="lvl-badge" title="Erfahrungspunkte" onClick=${editXp}>Stufe ${cm.level}</button>
          ${nextXp ? html`<span class="xp-bar" title=${`${(c.xp || 0).toLocaleString('de-DE')} / ${nextXp.toLocaleString('de-DE')} EP`}><i style=${{ width: `${Math.max(0, Math.min(100, (((c.xp || 0) - prevXp) / (nextXp - prevXp)) * 100))}%` }}></i></span>` : null}
          <span class="badge">Regeln ${ed}</span>
          ${readyXp && canLevel ? html`<span class="badge gold">Stufenaufstieg verfügbar</span>` : null}
          ${c.concentration ? html`<span class="conc-pill" title="Konzentration">◎ ${c.concentration.name}<button type="button" onClick=${() => upd({ concentration: null })} title="Konzentration beenden">✕</button></span>` : null}
        </div>
      </div>
      <div class="sh-quick">
        <button type="button" class=${`insp-star${c.inspiration ? ' on' : ''}`} title=${c.inspiration ? 'Inspiration (antippen zum Verbrauchen)' : 'Keine Inspiration'} disabled=${!canEdit} onClick=${() => upd({ inspiration: !c.inspiration })}>★</button>
        ${canLevel ? html`<${Btn} kind="primary" icon="arrow-up" onClick=${levelUp}>Stufenaufstieg<//>` : null}
        <${IconBtn} icon="more-vertical" title="Mehr" onClick=${menu} />
      </div>
    </div>

    <div class="sh-strip">
      <div class="sh-stat ac" title=${cm.ac.parts.join(' · ')}><span class="l">RK</span><span class="v">${cm.ac.ac}</span></div>
      <button type="button" class="sh-stat click" onClick=${() => roll20(cm.init, 'Initiative', 'init')}><span class="l">Initiative</span><span class="v">${fmtMod(cm.init)}</span></button>
      <div class="sh-stat"><span class="l">Bewegung</span><span class="v">${fmtDist(c.speed || 30, units)}</span></div>
      <div class="sh-stat"><span class="l">Übung</span><span class="v">+${cm.pb}</span></div>
      <button type="button" class=${`sh-stat hp click ${hpCls}`} onClick=${hpDialog}>
        <span class="l">Trefferpunkte</span>
        <span class="v">${c.hp}<small>/ ${c.maxHp}</small>${c.tempHp ? html`<em>+${c.tempHp}</em>` : null}</span>
        <span class="hpbar"><i class=${hpCls} style=${{ width: `${hpPct}%` }}></i></span>
      </button>
    </div>

    ${legacy ? html`<div class="callout callout-orange"><div class="callout-title"><${Icon} name="refresh" size=${16} />Alter Charakterbogen</div><div class="callout-content small">Übernimm ihn einmal ins neue Format – dann gibt es Klassenmerkmale, Ressourcen, Zauberplätze und den geführten Stufenaufstieg. ${canEdit ? html`<${Btn} size="sm" kind="primary" onClick=${migrate}>Jetzt übernehmen<//>` : ''}</div></div>` : null}
    ${unlock ? html`<div class="callout callout-red"><div class="callout-title"><${Icon} name="unlock" size=${16} />Korrektur-Modus aktiv</div><div class="callout-content small row">Attribute, Rettungswürfe, Fertigkeiten, TP-Korrektur, Bewegung, Hintergrund und Persönlichkeit sind jetzt änderbar. <${Btn} size="sm" onClick=${() => setUnlock(false)}>Fertig<//></div></div>` : null}

    <div class=${`sheet-bar${mini ? ' mini' : ''}`}>
      ${mini ? html`<div class="sb-mini">
        <span class="nm">${c.name}</span>
        <button type="button" class=${`mini-pill hp ${hpCls}`} onClick=${hpDialog} title="Trefferpunkte"><${Icon} name="heart" size=${13} />${c.hp}/${c.maxHp}${c.tempHp ? `+${c.tempHp}` : ''}</button>
        <span class="mini-pill" title="Rüstungsklasse"><${Icon} name="shield" size=${13} />${cm.ac.ac}</span>
        <button type="button" class=${`mini-pill insp${c.inspiration ? ' on' : ''}`} title="Inspiration" disabled=${!canEdit} onClick=${() => upd({ inspiration: !c.inspiration })}>★</button>
      </div>` : null}
      <nav class="sheet-tabs">${tabs.map((t) => html`<button type="button" class=${`tab-pill${cur === t.value ? ' active' : ''}`} onClick=${() => setTab(t.value)}><${Icon} name=${t.icon} size=${14} />${t.label}</button>`)}</nav>
    </div>

    <div class=${`sheet-cols${wide ? ' wide' : ''}`}>
      ${wide ? html`<aside class="sheet-core"><${CoreColumn} ...${ctx} /></aside>` : null}
      <section class="sheet-main">
        ${cur === 'werte' ? html`<${CoreColumn} ...${ctx} />` : null}
        ${cur === 'aktionen' ? html`<${ActionsTab} ...${ctx} />` : null}
        ${cur === 'zauber' ? html`<${SpellsTab} ...${ctx} />` : null}
        ${cur === 'inventar' ? html`<${InventoryTab} ...${ctx} />` : null}
        ${cur === 'merkmale' ? html`<${FeaturesTab} ...${ctx} />` : null}
        ${cur === 'uebungen' ? html`<${ProfsTab} ...${ctx} />` : null}
        ${cur === 'hintergrund' ? html`<${BackgroundTab} ...${ctx} />` : null}
        ${cur === 'notizen' ? html`<${NotesTab} ...${ctx} />` : null}
      </section>
    </div>
  </div>`;
}

function HpDialog({ c, close }) {
  const [v, setV] = useState('');
  const [temp, setTemp] = useState(c.tempHp || 0);
  const n = Math.abs(parseInt(v, 10) || 0);
  return html`<div class="modal-body stack">
    <div class="hp-big"><b>${c.hp}</b><span>/ ${c.maxHp}</span>${c.tempHp ? html`<em>+${c.tempHp} temp.</em>` : null}</div>
    <input class="input" type="number" min="0" inputmode="numeric" placeholder="Wert" value=${v} autoFocus onInput=${(e) => setV(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && n) close({ delta: -n }); }} />
    <div class="grid two"><${Btn} kind="danger" icon="minus" disabled=${!n} onClick=${() => close({ delta: -n })}>Schaden<//><${Btn} kind="success" icon="plus" disabled=${!n} onClick=${() => close({ delta: n })}>Heilen<//></div>
    <div class="row"><span class="muted grow">Temporäre TP</span><input class="input tiny" type="number" min="0" value=${temp} onInput=${(e) => setTemp(Number(e.target.value) || 0)} /><${Btn} size="sm" onClick=${() => close({ temp })}>Setzen<//></div>
  </div>`;
}

// ───────────────────────── Werte-Spalte ─────────────────────────
function CoreColumn(p) {
  return html`<div class="stack">
    <${VitalsCard} ...${p} />
    <${AbilityGrid} ...${p} />
    <div class="sheet-card"><h3><${Icon} name="shield" size=${13} />Rettungswürfe</h3><${SavesBlock} ...${p} /></div>
    <div class="sheet-card"><h3><${Icon} name="eye" size=${13} />Sinne</h3><${SensesBlock} ...${p} /></div>
    <div class="sheet-card"><h3><${Icon} name="list" size=${13} />Fertigkeiten<span class="grow"></span><span class="tiny faint" style="text-transform:none;letter-spacing:0">● geübt · ◉ Expertise</span></h3><${SkillsBlock} ...${p} /></div>
    <${ConditionsCard} ...${p} />
  </div>`;
}

function AbilityGrid({ c, cm, unlock, upd, roll20 }) {
  return html`<div class="ab-grid">${AB.map((k) => html`<div class="ab-box" key=${k}>
    <span class="l">${AB_NAME[k]}</span>
    <button type="button" class="m" title=${`${AB_NAME[k]}-Probe würfeln`} onClick=${() => roll20(cm.mods[k], `${AB_NAME[k]}-Probe`, 'check', 0)}>${fmtMod(cm.mods[k])}</button>
    <span class="s">${unlock ? html`<input type="number" value=${c.abilities?.[k] ?? 10} onInput=${(e) => upd({ abilities: { ...c.abilities, [k]: Math.max(1, Math.min(30, Number(e.target.value) || 10)) } }, { rederive: true })} />` : c.abilities?.[k] ?? 10}</span>
  </div>`)}</div>`;
}

function SavesBlock({ c, cm, unlock, upd, roll20, traits }) {
  return html`<div class="save-grid">${AB.map((k) => html`<div class="srow" key=${k}>
      <span class=${`dot${cm.saves[k].prof ? ' p1' : ''}${unlock ? ' edit' : ''}`} onClick=${() => unlock && upd({ saves: cm.saves[k].prof ? (c.saves || []).filter((x) => x !== k) : [...(c.saves || []), k] })}></span>
      <span class="ab">${AB_SHORT[k]}</span><span class="nm">${AB_NAME[k]}</span>
      <button type="button" class="rollbtn" onClick=${() => roll20(cm.saves[k].bonus, `${AB_NAME[k]}-Rettungswurf`, 'save')}>${fmtMod(cm.saves[k].bonus)}</button>
    </div>`)}</div>
    ${traits.halfling ? html`<div class="tiny faint" style="margin-top:6px">Halblingsglück: natürliche 1 wird automatisch neu gewürfelt.</div>` : null}`;
}

function SensesBlock({ c, cm, units }) {
  return html`<div class="senses">
    <div class="sense"><b>${cm.passive.perception}</b>Passive Weisheit (Wahrnehmung)</div>
    <div class="sense"><b>${cm.passive.investigation}</b>Passive Intelligenz (Nachforschungen)</div>
    <div class="sense"><b>${cm.passive.insight}</b>Passive Weisheit (Motiv erkennen)</div>
    ${c.darkvision ? html`<div class="small muted">Dunkelsicht ${fmtDist(c.darkvision, units)}</div>` : null}
  </div>`;
}

function SkillsBlock({ c, cm, unlock, upd, roll20 }) {
  return html`<div class="skill-rows">${ALL_SKILLS.map((k) => html`<div class="srow" key=${k}>
    <span class=${`dot${cm.skills[k].prof ? ` p${cm.skills[k].prof}` : ''}${unlock ? ' edit' : ''}`} onClick=${() => unlock && upd({ skills: { ...c.skills, [k]: ((Number(c.skills?.[k]) || 0) + 1) % 3 } })}></span>
    <span class="ab">${AB_SHORT[skillAbility(k)]}</span><span class="nm">${skillName(k)}</span>
    <button type="button" class="rollbtn" onClick=${() => roll20(cm.skills[k].bonus, skillName(k), 'check', cm.skills[k].prof)}>${fmtMod(cm.skills[k].bonus)}</button>
  </div>`)}</div>
  ${cm.jack ? html`<div class="tiny faint" style="margin-top:6px">Alleskönner: +${cm.jack} auf ungeübte Attributswürfe.</div>` : null}`;
}

function VitalsCard({ c, cm, ed, canEdit, unlock, upd, roll20, units, res, hpDelta }) {
  const [dmg, setDmg] = useState('');
  const hdp = hitDicePools(c);
  const spendHd = (pool) => {
    if (pool.used >= pool.total) return toast('Keine Trefferwürfel mehr übrig.', 'error');
    const r = doRoll(`1d${pool.hd}${sg(cm.mods.con)}`, { label: `${c.name}: Trefferwürfel`, character: c.name, kind: 'free' });
    if (!r) return;
    upd({ hp: Math.min(c.maxHp, (Number(c.hp) || 0) + Math.max(0, r.total)), hdUsed: { ...(typeof c.hdUsed === 'object' ? c.hdUsed : {}), [pool.cls]: pool.used + 1 } });
  };
  const shortRest = () => {
    const resUsed = { ...(c.resUsed || {}) };
    for (const r of res) if (r.reset === 'short') resUsed[r.key] = 0;
    upd({ resUsed, spell: { ...(c.spell || {}), pactUsed: 0 } });
    toast('Kurze Rast: Ressourcen und Paktmagie aufgefrischt. Trefferwürfel kannst du hier ausgeben.', 'success');
  };
  const longRest = () => {
    const hdUsed = {};
    for (const p of hdp) hdUsed[p.cls] = Math.max(0, p.used - (ed === '2024' ? p.total : Math.max(1, Math.floor(totalLevel(c) / 2))));
    upd({ hp: c.maxHp, tempHp: 0, resUsed: {}, spell: { ...(c.spell || {}), used: {}, pactUsed: 0 }, hdUsed, exhaustion: Math.max(0, (Number(c.exhaustion) || 0) - 1), deathSaves: { s: 0, f: 0 }, concentration: null });
    toast('Lange Rast: TP, Ressourcen und Zauberplätze voll.', 'success');
  };
  return html`<div class="sheet-card stack sm">
    <div class="row"><b class="grow"><${Icon} name="heart" size=${16} /> Trefferpunkte</b>${unlock ? html`<label class="small muted">Korrektur <input class="input tiny" type="number" value=${c.hpAdjust || 0} onInput=${(e) => upd({ hpAdjust: Number(e.target.value) || 0 }, { rederive: true })} /></label>` : null}</div>
    <div class="row">
      <span style="font:700 38px var(--font-serif)">${c.hp}</span><span class="muted">/ ${c.maxHp}</span>
      ${c.tempHp ? html`<span class="badge accent">+${c.tempHp} temp.</span>` : null}
      <span class="grow"></span>
      <div class="input-group" style="width:auto">
        <input class="input" type="number" min="0" style="width:78px" value=${dmg} placeholder="Wert" onInput=${(e) => setDmg(e.target.value)} />
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
    ${unlock ? html`<label class="small muted row">Bewegung (Fuß) <input class="input tiny" type="number" value=${c.speed || 30} onInput=${(e) => upd({ speed: Number(e.target.value) || 30 })} /> = ${fmtDist(c.speed || 30, units)}</label>` : null}
    ${c.hp <= 0 ? html`<div class="row"><b>Todesrettungswürfe</b>
      <span class="death-saves">${[0, 1, 2].map((i) => html`<i class=${i < (c.deathSaves?.s || 0) ? 's' : ''} onClick=${() => upd({ deathSaves: { ...c.deathSaves, s: i < (c.deathSaves?.s || 0) ? i : i + 1 } })}></i>`)}</span> Erfolge
      <span class="death-saves">${[0, 1, 2].map((i) => html`<i class=${i < (c.deathSaves?.f || 0) ? 'f' : ''} onClick=${() => upd({ deathSaves: { ...c.deathSaves, f: i < (c.deathSaves?.f || 0) ? i : i + 1 } })}></i>`)}</span> Fehlschläge
      <${Btn} size="sm" icon="d20" onClick=${() => roll20(0, 'Todesrettungswurf', 'save')}>Würfeln<//></div>` : null}
    <div class="btn-row">
      <${Btn} size="sm" icon="clock" disabled=${!canEdit} onClick=${shortRest}>Kurze Rast<//>
      <${Btn} size="sm" icon="moon" disabled=${!canEdit} onClick=${longRest}>Lange Rast<//>
    </div>
  </div>`;
}

// Ressourcenname mit Infotext: Zeiger darüber zeigt ihn kurz, Klick/Tipp öffnet ihn ganz
function resName(r) {
  const nach = `Frischt sich nach einer ${r.reset === 'short' ? 'kurzen' : 'langen'} Rast wieder auf${r.max >= 99 ? '' : ` · ${r.max}×`}.`;
  const txt = RES_INFO[r.key] || 'Begrenzt nutzbare Fähigkeit.';
  return html`<button type="button" class="res-name" title=${`${txt} ${nach}`}
    onClick=${() => openModal(() => html`<div class="modal-body stack sm">
      <p style="margin:0">${txt}</p><div class="small muted">${nach}</div></div>`, { title: r.name, icon: 'zap', size: 'sm' })}>
    <span>${r.name}</span> <small class="faint">(${r.reset === 'short' ? 'kurze' : 'lange'} Rast)</small><${Icon} name="info" size=${12} />
  </button>`;
}

function ConditionsCard({ c, ed, canEdit, upd, res }) {
  const aktiv = CONDITIONS.filter((x) => (c.conditions || []).includes(x.name));
  return html`<div class="sheet-card stack sm">
    <b><${Icon} name="alert" size=${16} /> Zustände</b>
    <div class="chips">${CONDITIONS.filter((x) => x.name !== 'Erschöpft').map((x) => {
      const on = (c.conditions || []).includes(x.name);
      return html`<button type="button" title=${x.desc} class=${`chip${on ? ' selected' : ' suggest'}`} disabled=${!canEdit} onClick=${() => upd({ conditions: on ? c.conditions.filter((y) => y !== x.name) : [...(c.conditions || []), x.name] })}>${x.name}</button>`;
    })}</div>
    ${aktiv.length ? html`<div class="stack sm cur-cond">
      <b class="small"><${Icon} name="alert-triangle" size=${14} /> Aktueller Zustand</b>
      ${aktiv.map((x) => html`<div class="cur-cond-item" key=${x.name}>
        <div class="row nowrap"><b class="grow">${x.name}</b>
          ${canEdit ? html`<${IconBtn} icon="x" size=${13} title=${`${x.name} aufheben`} onClick=${() => upd({ conditions: (c.conditions || []).filter((y) => y !== x.name) })} />` : null}</div>
        <span class="small muted">${x.desc}</span>
      </div>`)}
    </div>` : null}
    <div class="row small"><span class="muted">Erschöpfung</span>
      <${IconBtn} icon="minus" disabled=${!canEdit || !c.exhaustion} onClick=${() => upd({ exhaustion: Math.max(0, (c.exhaustion || 0) - 1) })} /><b>${c.exhaustion || 0}</b><${IconBtn} icon="plus" disabled=${!canEdit || c.exhaustion >= 6} onClick=${() => upd({ exhaustion: Math.min(6, (c.exhaustion || 0) + 1) })} />
      <span class="faint">${ed === '2024' ? `−${2 * (c.exhaustion || 0)} auf W20-Würfe` : c.exhaustion ? 'siehe Regeln (Nachteile je Stufe)' : ''}</span>
    </div>
    ${res.length ? html`<div class="stack sm" style="margin-top:6px"><b><${Icon} name="zap" size=${15} /> Ressourcen</b>
      ${res.map((r) => html`<div class="res-row"><span class="grow">${resName(r)}</span>
        <${Pips} max=${r.max >= 99 ? 0 : r.max} used=${c.resUsed?.[r.key] || 0} disabled=${!canEdit} onSet=${(v) => upd({ resUsed: { ...(c.resUsed || {}), [r.key]: Math.max(0, Math.min(r.max, v)) } })} />
        ${r.max >= 99 ? html`<b>unbegrenzt</b>` : null}</div>`)}
    </div>` : null}
    ${c.classes?.length && classExtras(c).length ? html`<div class="chips">${classExtras(c).map((x) => html`<span class="badge">${x}</span>`)}</div>` : null}
  </div>`;
}

// ───────────────────────── Aktionen ─────────────────────────
function spellStats(cm, e) {
  const s = cm.spell.find((x) => x.cls === e?.cls) || cm.spell[0];
  return s ? { atk: s.attack, dc: s.dc, mod: cm.mods[s.ability] || 0, ability: s.ability } : { atk: cm.pb, dc: 8 + cm.pb, mod: 0, ability: 'int' };
}
const castable = (e) => e.level === 0 || e.prepared || e.always || e.arcanum || e.source;

// Angriff im Detail – wie bei „Aktionen“ und „Sonstiges“ als Popup
function openAttackDetail({ name, icon = 'swords', art, rows = [], text }) {
  return openModal(() => html`<div class="modal-body stack sm">
    ${art ? html`<div class="row" style="justify-content:center">${art}</div>` : null}
    <div class="det-grid">${rows.filter(Boolean).map(([k, v]) => html`<div class="det-row"><span class="k">${k}</span><span class="v">${v}</span></div>`)}</div>
    ${text ? html`<div class="small muted">${text}</div>` : null}
  </div>`, { title: name, icon, size: 'sm' });
}

function ActionsTab({ c, cm, ed, canEdit, upd, roll20, rollDmg, spells, entries, res }) {
  const [f, setF] = useState('all');
  const weapons = (c.weapons || []).map((k) => findWeapon(k)).filter(Boolean).map((w) => ({ w, a: weaponAttack(c, w, cm.mods, cm.pb) }));
  const md = martialDie(c);
  const uAb = md && cm.mods.dex > cm.mods.str ? 'dex' : 'str';
  const unarmed = { name: 'Waffenloser Schlag', bonus: cm.mods[uAb] + cm.pb, damage: md ? `1d${md}${cm.mods[uAb] ? sg(cm.mods[uAb]) : ''}` : String(Math.max(1, 1 + cm.mods.str)), type: 'Wucht' };
  const spellRows = spells ? entries.filter(castable).map((e) => ({ e, sp: spells.find((s) => s.id === e.ref) })).filter((x) => x.sp && (x.sp.attack || x.sp.save) && (x.sp.damage || x.sp.heal)) : [];
  const feats = (c.classes || []).flatMap((x) => classFeatures(x.cls, ed, x.level).filter((ft) => ft.kind === 'feature' && FEATURE_ACTIONS[ft.name]).map((ft) => ({ ...ft, type: ft.name === 'Tiergestalt' && ed === '2024' ? 'bonus' : FEATURE_ACTIONS[ft.name], cls: x.cls })));
  const spellBy = (type) => (spells ? entries.filter(castable).map((e) => spells.find((s) => s.id === e.ref)).filter((sp) => sp && sp.action === type) : []);
  const attacks = c.attacks || [];
  const setAtk = (i, patch) => upd({ attacks: attacks.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const show = (k) => f === 'all' || f === k;
  const perAction = attacksPerAction(c);
  const FILTERS = [['all', 'Alle'], ['attack', 'Angriffe'], ['action', 'Aktionen'], ['bonus', 'Bonusaktionen'], ['reaction', 'Reaktionen'], ['other', 'Sonstiges'], ['limited', 'Begrenzt']];

  const atkRow = ({ key, art, name, sub, range, hit, onHit, dmg, dmgType, onDmg, extra, onInfo }) => html`<div class="act-row" key=${key}>
    <span>${art}</span>
    <span class=${`nm${onInfo ? ' click' : ''}`} onClick=${onInfo} title=${onInfo ? 'Angriff im Detail' : null}><b>${name}</b><small>${sub}</small></span>
    <span class="rng small">${range}</span>
    <span>${hit != null ? html`<button type="button" class="rollbtn" onClick=${onHit}>${hit}</button>` : null}</span>
    <span class="row nowrap" style="gap:4px">${dmg ? html`<button type="button" class="dmgbtn" onClick=${onDmg}><${DamageTag} type=${dmgType}>${fmtDice(dmg)}<//></button>` : null}${extra || null}</span>
  </div>`;

  return html`<div class="stack">
    <div class="filter-chips">${FILTERS.map(([k, l]) => html`<button type="button" class=${`fchip${f === k ? ' active' : ''}`} onClick=${() => setF(k)}>${l}</button>`)}</div>

    ${show('attack') ? html`<div class="sheet-card">
      <h3><${Icon} name="swords" size=${13} />Angriffe<span class="grow"></span><span class="badge">Angriffe pro Aktion: ${perAction}</span></h3>
      <div class="act-table">
        <div class="act-head"><span></span><span>Angriff</span><span>Reichweite</span><span>Treffer/SG</span><span>Schaden</span></div>
        ${weapons.map(({ w, a }, i) => atkRow({
          key: `w${i}`, art: html`<${ItemArt} item=${{ name: w.name, ref: `w:${w.key}` }} size=${34} />`, name: a.name,
          sub: `${/a/.test(w.p) ? 'Fernkampfwaffe' : 'Nahkampfwaffe'}${a.props ? ` · ${a.props}` : ''}${ed === '2024' && a.mastery ? ` · Meisterschaft: ${a.mastery}` : ''}${a.prof ? '' : ' · ungeübt'}`,
          range: WEAPON_RANGE[w.key] ? `${WEAPON_RANGE[w.key].join('/')} m` : fmtM(weaponReach(w)),
          hit: fmtMod(a.bonus), onHit: () => roll20(a.bonus, `${a.name} – Angriff`, 'attack'),
          dmg: a.damage, dmgType: DMG_KEY[w.type], onDmg: () => rollDmg(a.damage, `${a.name} – Schaden`),
          extra: a.versatile ? html`<button type="button" class="dmgbtn" title="Zweihändig" onClick=${() => rollDmg(a.versatile, `${a.name} – Schaden (zweihändig)`)}>${fmtDice(a.versatile)}</button>` : null,
          onInfo: () => openAttackDetail({
            name: a.name, icon: 'swords',
            art: html`<${ItemArt} item=${{ name: w.name, ref: `w:${w.key}` }} size=${64} />`,
            rows: [
              ['Art', /a/.test(w.p) ? 'Fernkampfwaffe' : 'Nahkampfwaffe'],
              ['Reichweite', WEAPON_RANGE[w.key] ? `${WEAPON_RANGE[w.key].join(' / ')} m (normal / weit)` : fmtM(weaponReach(w))],
              ['Angriffswurf', `W20 ${fmtMod(a.bonus)}${a.prof ? '' : ' – ungeübt, kein Übungsbonus'}`],
              ['Schaden', `${fmtDice(a.damage)} ${w.type || ''}`],
              a.versatile && ['Zweihändig', `${fmtDice(a.versatile)} ${w.type || ''}`],
              a.props && ['Eigenschaften', a.props],
              ed === '2024' && a.mastery && ['Meisterschaft', a.mastery],
              w.weight != null && ['Gewicht', `${w.weight} kg`],
            ],
            text: `Der Angriffswurf ist W20 + Attributsmodifikator + Übungsbonus (${cm.pb >= 0 ? '+' : ''}${cm.pb}). Der Schaden wird um denselben Attributsmodifikator erhöht. Bei einem kritischen Treffer (natürliche 20) würfelst du die Schadenswürfel doppelt.`,
          }),
        }))}
        ${atkRow({ key: 'u', art: html`<${ItemArt} item=${{ name: 'Faust', icon: 'fist' }} size=${34} />`, name: unarmed.name, sub: md ? 'Kampfkunst' : 'Nahkampf', range: '1,5 m', hit: fmtMod(unarmed.bonus), onHit: () => roll20(unarmed.bonus, 'Waffenloser Schlag', 'attack'), dmg: unarmed.damage, dmgType: 'bludgeoning', onDmg: () => rollDmg(unarmed.damage, 'Waffenloser Schlag – Schaden'),
          onInfo: () => openAttackDetail({
            name: 'Waffenloser Schlag', icon: 'fist', art: html`<${ItemArt} item=${{ name: 'Faust', icon: 'fist' }} size=${64} />`,
            rows: [['Art', 'Nahkampf'], ['Reichweite', '1,5 m'], ['Angriffswurf', `W20 ${fmtMod(unarmed.bonus)}`], ['Schaden', `${fmtDice(unarmed.damage)} Wucht`]],
            text: md ? 'Mit Kampfkunst schlägst du mit dem Kampfkunstwürfel statt mit 1 + Stärkemodifikator und darfst Stärke oder Geschicklichkeit nehmen.'
              : 'Ohne Waffe verursachst du 1 + Stärkemodifikator Wuchtschaden. Statt Schaden darfst du auch festhalten oder zu Boden bringen.',
          }) })}
        ${spellRows.map(({ e, sp }) => {
          const st = spellStats(cm, e);
          const d = damageAt(sp, { charLevel: cm.level });
          const h = healAt(sp);
          return atkRow({
            key: e.id, art: html`<${SpellArt} sp=${sp} size=${34} />`, name: sp.name, sub: sp.level ? `${levelName(sp.level)} · ${timeShort(sp)}` : `Zaubertrick · ${timeShort(sp)}`,
            range: rangeShort(sp), hit: sp.attack ? fmtMod(st.atk) : `SG ${st.dc} ${AB_SHORT[sp.save] || ''}`,
            onHit: sp.attack ? () => roll20(st.atk, `${sp.name} – Zauberangriff`, 'attack') : () => toast(`${sp.name}: Ziele machen einen ${AB_NAME[sp.save] || ''}-Rettungswurf gegen SG ${st.dc}.`, 'info'),
            dmg: d ? d.dice : h ? `${h}${healHasMod(sp) ? sg(st.mod) : ''}` : null, dmgType: d?.type,
            onDmg: d ? () => rollDmg(d.dice, `${sp.name} – ${damageName(d.type)}schaden`) : () => rollDmg(`${h}${healHasMod(sp) ? sg(st.mod) : ''}`, `${sp.name} – Heilung`, 'free'),
            onInfo: () => openSpellDetail(sp, { ed, charLevel: cm.level }),
          });
        })}
        ${attacks.map((a, i) => html`<div class="act-row custom" key=${a.id || i}>
          <span><${ItemArt} item=${{ name: a.name || 'Angriff', icon: 'crossed-swords' }} size=${34} /></span>
          <span class="nm"><input class="input sm" value=${a.name} placeholder="z. B. Odemwaffe" disabled=${!canEdit} onInput=${(e) => setAtk(i, { name: e.target.value })} /></span>
          <span class="rng"><input class="input sm" value=${a.range || ''} placeholder="1,5 m" disabled=${!canEdit} onInput=${(e) => setAtk(i, { range: e.target.value })} /></span>
          <span class="row nowrap" style="gap:4px"><input class="input sm" style="width:58px" value=${a.bonus} disabled=${!canEdit} onInput=${(e) => setAtk(i, { bonus: e.target.value })} /><${IconBtn} icon="d20" title="Angriff" onClick=${() => roll20(parseInt(String(a.bonus).replace('−', '-'), 10) || 0, a.name || 'Angriff', 'attack')} /></span>
          <span class="row nowrap" style="gap:4px"><input class="input sm" style="width:84px" value=${a.damage} disabled=${!canEdit} onInput=${(e) => setAtk(i, { damage: e.target.value })} /><${IconBtn} icon="flame" title="Schaden" onClick=${() => rollDmg(a.damage || '1d6', `${a.name || 'Angriff'} – Schaden`)} />${canEdit ? html`<${IconBtn} icon="x" class="danger" onClick=${() => upd({ attacks: attacks.filter((_, j) => j !== i) })} />` : null}</span>
        </div>`)}
      </div>
      ${canEdit ? html`<div class="btn-row" style="margin-top:8px"><${Btn} size="sm" icon="plus" onClick=${() => upd({ attacks: [...attacks, { id: uid(5), name: '', bonus: '+0', damage: '1d6' }] })}>Eigener Angriff<//>
        <span class="tiny faint">Waffen legst du im Inventar an bzw. aus.</span></div>` : null}
    </div>` : null}

    ${show('action') ? html`<div class="sheet-card">
      <h3><${Icon} name="play" size=${13} />Aktionen</h3>
      <div class="rule-list">
        ${feats.filter((x) => x.type === 'action').map((x) => html`<div class="rule-item feat"><b>${x.name}</b><span class="small muted">${x.desc}</span></div>`)}
        ${spellBy('action').filter((sp) => !sp.damage && !sp.heal).slice(0, 12).map((sp) => html`<div class="rule-item spell click" onClick=${() => openSpellDetail(sp, { ed, charLevel: cm.level })}><${SpellArt} sp=${sp} size=${24} /><b>${sp.name}</b><span class="small muted">${levelName(sp.level)} · ${rangeShort(sp)}</span></div>`)}
        ${STD_ACTIONS[ed].map(([n, d]) => html`<div class="rule-item"><b>${n}</b><span class="small muted">${d}</span></div>`)}
      </div>
    </div>` : null}

    ${show('bonus') ? html`<div class="sheet-card">
      <h3><${Icon} name="zap" size=${13} />Bonusaktionen</h3>
      <div class="rule-list">
        ${feats.filter((x) => x.type === 'bonus').map((x) => html`<div class="rule-item feat"><b>${x.name}</b><span class="small muted">${x.desc}</span></div>`)}
        ${spellBy('bonus').map((sp) => html`<div class="rule-item spell click" onClick=${() => openSpellDetail(sp, { ed, charLevel: cm.level })}><${SpellArt} sp=${sp} size=${24} /><b>${sp.name}</b><span class="small muted">${levelName(sp.level)} · ${rangeShort(sp)}</span></div>`)}
        <div class="rule-item"><b>Zweiter Angriff (zwei Waffen)</b><span class="small muted">Mit einer leichten Waffe in jeder Hand: nach dem Angriff mit der einen ein Angriff mit der anderen – ohne Attributsmodifikator auf den Schaden (außer mit Kampfstil).</span></div>
      </div>
    </div>` : null}

    ${show('reaction') ? html`<div class="sheet-card">
      <h3><${Icon} name="refresh" size=${13} />Reaktionen</h3>
      <div class="rule-list">
        <div class="rule-item"><b>Gelegenheitsangriff</b><span class="small muted">Verlässt eine feindliche Kreatur, die du sehen kannst, deine Reichweite, führst du einen Nahkampfangriff gegen sie aus.</span></div>
        ${feats.filter((x) => x.type === 'reaction').map((x) => html`<div class="rule-item feat"><b>${x.name}</b><span class="small muted">${x.desc}</span></div>`)}
        ${spellBy('reaction').map((sp) => html`<div class="rule-item spell click" onClick=${() => openSpellDetail(sp, { ed, charLevel: cm.level })}><${SpellArt} sp=${sp} size=${24} /><b>${sp.name}</b><span class="small muted">${sp.time}</span></div>`)}
      </div>
    </div>` : null}

    ${show('other') ? html`<div class="sheet-card">
      <h3><${Icon} name="sparkles" size=${13} />Sonstiges</h3>
      <div class="rule-list">
        ${feats.filter((x) => x.type === 'other').map((x) => html`<div class="rule-item feat"><b>${x.name}</b><span class="small muted">${x.desc}</span></div>`)}
        ${spells ? entries.map((e) => spells.find((s) => s.id === e.ref)).filter((sp) => sp?.ritual).map((sp) => html`<div class="rule-item spell click" onClick=${() => openSpellDetail(sp, { ed, charLevel: cm.level })}><${SpellArt} sp=${sp} size=${24} /><b>${sp.name}</b><span class="small muted">Ritual · +10 Minuten, kein Zauberplatz</span></div>`) : null}
        ${!feats.some((x) => x.type === 'other') ? html`<div class="small faint">Keine besonderen Fähigkeiten.</div>` : null}
      </div>
    </div>` : null}

    ${show('limited') ? html`<div class="sheet-card stack sm">
      <h3><${Icon} name="hourglass" size=${13} />Begrenzte Nutzung</h3>
      ${res.length ? res.map((r) => html`<div class="res-row"><span class="grow">${resName(r)}</span>
        <${Pips} max=${r.max >= 99 ? 0 : r.max} used=${c.resUsed?.[r.key] || 0} disabled=${!canEdit} onSet=${(v) => upd({ resUsed: { ...(c.resUsed || {}), [r.key]: Math.max(0, Math.min(r.max, v)) } })} />
        ${r.max >= 99 ? html`<b>unbegrenzt</b>` : null}</div>`) : html`<div class="small faint">Keine begrenzten Ressourcen.</div>`}
    </div>` : null}
  </div>`;
}

// ───────────────────────── Zauber ─────────────────────────
function CastDialog({ sp, opts, st, ed, charLevel, close }) {
  const [slot, setSlot] = useState(opts[0] || null);
  const [ritual, setRitual] = useState(false);
  const d = damageAt(sp, { slot: slot?.level, charLevel });
  const h = healAt(sp, { slot: slot?.level });
  const need = sp.level > 0 && !ritual;
  return html`<div class="modal-body stack">
    <div class="row nowrap"><${SpellArt} sp=${sp} size=${54} /><div><b style="font-size:17px">${sp.name}</b><div class="small muted">${sp.time} · ${sp.range} · ${sp.duration}</div></div></div>
    ${sp.level > 0 ? html`<div class="stack sm"><span class="small muted">Zauberplatz</span>
      <div class="chips">${opts.map((o) => html`<button type="button" class=${`chip${slot === o && !ritual ? ' selected' : ' suggest'}`} onClick=${() => { setSlot(o); setRitual(false); }}>${o.pact ? `Pakt (${o.level}. Grad)` : `${o.level}. Grad`} · ${o.free} frei</button>`)}
        ${sp.ritual ? html`<button type="button" class=${`chip${ritual ? ' selected' : ' suggest'}`} onClick=${() => setRitual(true)}>Als Ritual (kein Platz)</button>` : null}</div>
      ${!opts.length && !sp.ritual ? html`<div class="small danger-text">Kein passender Zauberplatz frei.</div>` : null}</div>` : html`<div class="small muted">Zaubertrick – beliebig oft.</div>`}
    <div class="cast-stats">
      ${sp.attack ? html`<div class="cast-stat"><span>Angriff</span><b>${fmtMod(st.atk)}</b></div>` : null}
      ${sp.save ? html`<div class="cast-stat"><span>Rettungswurf</span><b>SG ${st.dc} ${AB_SHORT[sp.save] || ''}</b></div>` : null}
      ${d ? html`<div class="cast-stat"><span>Schaden</span><b><${DamageTag} type=${d.type}>${fmtDice(d.dice)}<//></b></div>` : null}
      ${h ? html`<div class="cast-stat"><span>Heilung</span><b>${fmtDice(h)}${healHasMod(sp) ? sg(st.mod) : ''}</b></div>` : null}
      ${sp.conc ? html`<div class="cast-stat"><span>Dauer</span><b>Konz.</b></div>` : null}
    </div>
    <div class="modal-foot" style="margin:0 -16px -16px">
      <${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//>
      <${Btn} kind="primary" icon="wand" disabled=${need && !slot} onClick=${() => close({ slot: need ? slot : null, ritual })}>Wirken${d || h || sp.attack ? ' & würfeln' : ''}<//>
    </div>
  </div>`;
}

function SpellsTab({ c, cm, ed, canEdit, unlock, upd, roll20, rollDmg, spells, entries, slots }) {
  const [lv, setLv] = useState('all');
  const [all, setAll] = useState(false);
  const sp = c.spell || {};
  if (!spells) return html`<div class="empty"><span class="spinner lg" /></div>`;
  const rows = entries.map((e) => ({ e, s: spells.find((x) => x.id === e.ref) || null }));
  const visible = rows.filter(({ e }) => all || castable(e));
  const levels = [...new Set([...visible.map((r) => r.e.level), ...Object.keys(slots.slots).map(Number), ...(slots.pact ? [slots.pact.level] : [])])].sort((a, b) => a - b);
  const manage = async () => {
    const next = await openSpellManager(c, { unlock });
    if (next) upd({ spell: { ...sp, list: next } });
  };
  const slotOptions = (level) => {
    const out = [];
    for (const [g, n] of Object.entries(slots.slots)) {
      const free = n - (sp.used?.[g] || 0);
      if (Number(g) >= level && free > 0) out.push({ level: Number(g), free });
    }
    if (slots.pact && slots.pact.level >= level && slots.pact.count - (sp.pactUsed || 0) > 0) out.push({ level: slots.pact.level, pact: true, free: slots.pact.count - (sp.pactUsed || 0) });
    return out.sort((a, b) => a.level - b.level);
  };
  const cast = async (e, s) => {
    const st = spellStats(cm, e);
    const opts = e.arcanum ? [{ level: s.level, free: 1, arcanum: true }] : slotOptions(s.level);
    const res = await openModal(({ close }) => html`<${CastDialog} sp=${s} opts=${opts} st=${st} ed=${ed} charLevel=${cm.level} close=${close} />`, { title: `${s.name} wirken`, icon: 'wand', size: 'sm' });
    if (!res) return;
    const patch = {};
    if (res.slot && !res.slot.arcanum) patch.spell = res.slot.pact ? { ...sp, pactUsed: (sp.pactUsed || 0) + 1 } : { ...sp, used: { ...(sp.used || {}), [res.slot.level]: (sp.used?.[res.slot.level] || 0) + 1 } };
    if (s.conc) {
      if (c.concentration && c.concentration.name !== s.name) toast(`Konzentration auf „${c.concentration.name}“ endet.`, 'info');
      patch.concentration = { name: s.name, id: s.id };
    }
    if (Object.keys(patch).length) upd(patch);
    if (s.attack) roll20(st.atk, `${s.name} – Zauberangriff`, 'attack');
    const d = damageAt(s, { slot: res.slot?.level, charLevel: cm.level });
    if (d) rollDmg(d.dice, `${s.name} – ${damageName(d.type)}schaden`);
    const h = healAt(s, { slot: res.slot?.level });
    if (h) rollDmg(`${h}${healHasMod(s) ? sg(st.mod) : ''}`, `${s.name} – Heilung`, 'free');
    if (s.save) toast(`${s.name}: ${AB_NAME[s.save] || ''}-Rettungswurf gegen SG ${st.dc}.`, 'info', { duration: 6000 });
  };
  return html`<div class="stack">
    <div class="sheet-card">
      <div class="row" style="gap:10px;align-items:stretch">
        ${cm.spell.map((s) => html`<div class="cast-stats">
          <div class="cast-stat"><span>${findClass(s.cls)?.name || 'Zauber'} · ${AB_SHORT[s.ability]}</span><b>${fmtMod(cm.mods[s.ability])}</b></div>
          <button type="button" class="cast-stat click" onClick=${() => roll20(s.attack, 'Zauberangriff', 'attack')}><span>Zauberangriff</span><b>${fmtMod(s.attack)}</b></button>
          <div class="cast-stat"><span>Rettungswurf-SG</span><b>${s.dc}</b></div>
        </div>`)}
        <span class="grow"></span>
        ${canEdit ? html`<${Btn} kind="primary" icon="wand" onClick=${manage}>Zauber verwalten<//>` : null}
      </div>
    </div>
    <div class="row">
      <div class="filter-chips">
        <button type="button" class=${`fchip${lv === 'all' ? ' active' : ''}`} onClick=${() => setLv('all')}>Alle</button>
        ${levels.map((l) => html`<button type="button" class=${`fchip${lv === l ? ' active' : ''}`} onClick=${() => setLv(l)}>${l ? `${l}. Grad` : 'Zaubertricks'}</button>`)}
      </div>
      <span class="grow"></span>
      <${Toggle} checked=${all} onChange=${setAll} label="Auch nicht vorbereitete" />
    </div>
    ${levels.filter((l) => lv === 'all' || lv === l).map((l) => {
      const list = visible.filter((r) => r.e.level === l).sort((a, b) => (a.s?.name || a.e.name).localeCompare(b.s?.name || b.e.name, 'de'));
      const n = slots.slots[l];
      const pact = slots.pact && slots.pact.level === l;
      if (!list.length && !n && !pact) return null;
      return html`<div class="sheet-card" key=${l}>
        <div class="spell-lvl-head"><b>${l ? levelName(l) : 'Zaubertricks'}</b>
          ${l === 0 ? html`<span class="tiny faint">beliebig oft</span>` : null}
          ${n ? html`<span class="row nowrap small" style="gap:6px">Plätze <${Pips} max=${n} used=${sp.used?.[l] || 0} disabled=${!canEdit} onSet=${(v) => upd({ spell: { ...sp, used: { ...(sp.used || {}), [l]: Math.max(0, Math.min(n, v)) } } })} /></span>` : null}
          ${pact ? html`<span class="row nowrap small" style="gap:6px">Pakt <${Pips} max=${slots.pact.count} used=${sp.pactUsed || 0} disabled=${!canEdit} onSet=${(v) => upd({ spell: { ...sp, pactUsed: Math.max(0, Math.min(slots.pact.count, v)) } })} /><span class="tiny faint">kurze Rast</span></span>` : null}
        </div>
        <div class="act-table">
          ${list.map(({ e, s }) => {
            if (!s) return html`<div class="act-row sp-row" key=${e.id}><${SpellArt} sp=${null} size=${34} /><span class="nm"><b>${e.name}</b><small>eigener Zauber</small></span></div>`;
            const st = spellStats(cm, e);
            const d = damageAt(s, { charLevel: cm.level });
            const h = healAt(s);
            return html`<div class=${`act-row sp-row${!castable(e) ? ' dim' : ''}`} key=${e.id}>
              <span class="click" onClick=${() => openSpellDetail(s, { ed, charLevel: cm.level })}><${SpellArt} sp=${s} size=${34} level=${false} /></span>
              <span class="nm click" onClick=${() => openSpellDetail(s, { ed, charLevel: cm.level })}><b>${s.name}${s.ritual ? html` <span class="tag-r">R</span>` : null}${s.conc ? html` <span class="tag-k">K</span>` : null}${e.always ? html` <span class="badge">immer</span>` : null}${e.arcanum ? html` <span class="badge gold">Arkanum</span>` : null}</b>
                <small>${findClass(e.cls)?.name || (e.source ? 'Talent/Gegenstand' : '')}${e.book && !e.prepared ? ' · nur im Buch' : ''}</small></span>
              <span class="small hide-sm">${timeShort(s)}</span>
              <span class="small hide-sm">${rangeShort(s)}</span>
              <span>${s.attack ? html`<button type="button" class="rollbtn" onClick=${() => roll20(st.atk, `${s.name} – Zauberangriff`, 'attack')}>${fmtMod(st.atk)}</button>` : s.save ? html`<span class="small"><b>${AB_SHORT[s.save]}</b> ${st.dc}</span>` : null}</span>
              <span>${d ? html`<button type="button" class="dmgbtn" onClick=${() => rollDmg(d.dice, `${s.name} – Schaden`)}><${DamageTag} type=${d.type}>${fmtDice(d.dice)}<//></button>`
                : h ? html`<button type="button" class="dmgbtn success-text" onClick=${() => rollDmg(`${h}${healHasMod(s) ? sg(st.mod) : ''}`, `${s.name} – Heilung`, 'free')}>${fmtDice(h)}${healHasMod(s) ? sg(st.mod) : ''}</button>` : html`<span class="tiny faint">${s.duration}</span>`}</span>
              <span>${canEdit && castable(e) ? html`<button type="button" class="sm-btn" onClick=${() => cast(e, s)}><${Icon} name="wand" size=${13} />Wirken</button>` : null}</span>
            </div>`;
          })}
          ${!list.length ? html`<div class="small faint" style="padding:6px 4px">Keine ${l ? 'vorbereiteten Zauber dieses Grades' : 'Zaubertricks'}.</div>` : null}
        </div>
      </div>`;
    })}
    ${!entries.length ? html`<${Empty} icon="wand" title="Noch keine Zauber" action=${canEdit ? html`<${Btn} kind="primary" icon="wand" onClick=${manage}>Zauber wählen<//>` : null}>Über „Zauber verwalten“ wählst du Zaubertricks und Zauber passend zu Klasse und Stufe.<//>` : null}
  </div>`;
}

// ───────────────────────── Inventar ─────────────────────────
let MAGIC = null;
const loadMagic = () => (MAGIC ? Promise.resolve(MAGIC) : import('../data/magicitems-srd.js').then((m) => { MAGIC = m.MAGIC_ITEMS; return MAGIC; }));

function ItemPicker({ close }) {
  const [tab, setTab] = useState('catalog');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [magic, setMagic] = useState(MAGIC);
  const [custom, setCustom] = useState({ name: '', qty: 1, weight: '', cost: '', notes: '' });
  useEffect(() => { if (tab === 'magic' && !magic) loadMagic().then(setMagic); }, [tab]);
  const ql = q.trim().toLowerCase();
  const cats = [...new Set(CATALOG.map((x) => x.cat))];
  const list = tab === 'catalog' ? CATALOG.filter((x) => (!cat || x.cat === cat) && (!ql || x.name.toLowerCase().includes(ql)))
    : (magic || []).filter((x) => !ql || x.name.toLowerCase().includes(ql) || x.type.toLowerCase().includes(ql));
  return html`<div class="modal-body stack">
    <div class="sm-tabs">${[['catalog', 'Ausrüstung'], ['magic', 'Magische Gegenstände (SRD)'], ['custom', 'Eigener Gegenstand']].map(([k, l]) => html`<button type="button" class=${`sm-tab${tab === k ? ' active' : ''}`} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${tab !== 'custom' ? html`<div class="row">
      <div class="search-box grow" style="margin:0"><${Icon} name="search" size=${15} /><input class="input" placeholder="Suchen …" value=${q} autoFocus onInput=${(e) => setQ(e.target.value)} /></div>
      ${tab === 'catalog' ? html`<select class="select sm" style="width:auto" value=${cat} onChange=${(e) => setCat(e.target.value)}><option value="">Alle Kategorien</option>${cats.map((k) => html`<option value=${k}>${CATEGORIES[k]}</option>`)}</select>` : null}
    </div>
    <div class="pick-list">
      ${tab === 'magic' && !magic ? html`<div class="empty"><span class="spinner" /></div>` : null}
      ${list.slice(0, 250).map((x) => html`<div class="pick-row" key=${x.key || x.id}>
        <${ItemArt} item=${tab === 'magic' ? { ...x, magic: true } : { name: x.name, ref: x.key, icon: x.icon }} size=${38} />
        <div class="grow" style="min-width:0"><b>${x.name}</b><div class="tiny faint">${tab === 'magic' ? `${x.type} · ${x.rarity}${x.attune ? ' · Einstimmung' : ''}` : `${CATEGORIES[x.cat]}${x.sub ? ` · ${x.sub}` : ''} · ${fmtCost(x.cost)} · ${fmtWeight(x.weight)}`}</div></div>
        <${Btn} size="sm" icon="plus" onClick=${() => close(tab === 'magic'
          ? { id: uid(6), name: x.name, qty: 1, magic: true, mref: x.id, type: x.type, rarity: x.rarity, attune: !!x.attune }
          : { id: uid(6), name: x.name, qty: 1, ref: x.key, weight: x.weight, cost: x.cost })}>Hinzufügen<//>
      </div>`)}
    </div>` : html`<div class="stack">
      <${Field} label="Name"><input class="input" value=${custom.name} autoFocus onInput=${(e) => setCustom({ ...custom, name: e.target.value })} placeholder="z. B. Silberner Schlüssel" /><//>
      <div class="grid three">
        <${Field} label="Anzahl"><input class="input" type="number" min="1" value=${custom.qty} onInput=${(e) => setCustom({ ...custom, qty: Number(e.target.value) || 1 })} /><//>
        <${Field} label="Gewicht (kg)"><input class="input" type="number" step="0.1" value=${custom.weight} onInput=${(e) => setCustom({ ...custom, weight: e.target.value })} /><//>
        <${Field} label="Wert (GM)"><input class="input" type="number" step="0.01" value=${custom.cost} onInput=${(e) => setCustom({ ...custom, cost: e.target.value })} /><//>
      </div>
      <${Field} label="Notiz"><input class="input" value=${custom.notes} onInput=${(e) => setCustom({ ...custom, notes: e.target.value })} /><//>
      <div class="btn-row end"><${Btn} kind="primary" icon="plus" disabled=${!custom.name.trim()} onClick=${() => close({ id: uid(6), name: custom.name.trim(), qty: custom.qty, weight: Number(custom.weight) || 0, cost: Number(custom.cost) || 0, notes: custom.notes })}>Hinzufügen<//></div>
    </div>`}
  </div>`;
}

function ItemDetail({ it, cat, canEdit, close }) {
  const [x, setX] = useState({ ...it });
  const [magic, setMagic] = useState(MAGIC);
  useEffect(() => { if (it.magic && !magic) loadMagic().then(setMagic); }, []);
  const mi = it.magic ? (magic || []).find((m) => m.id === it.mref) : null;
  const w = cat?.cat === 'weapon' ? findWeapon(cat.ref) : null;
  return html`<div class="modal-body stack">
    <div class="row nowrap"><${ItemArt} item=${it} size=${72} />
      <div style="min-width:0"><b style="font-size:18px">${it.name}</b>
        <div class="small muted">${mi ? `${mi.type} · ${mi.rarity}${mi.attune ? ` · Einstimmung ${mi.attune}` : ''}` : cat ? `${CATEGORIES[cat.cat]}${cat.sub ? ` · ${cat.sub}` : ''}` : 'Gegenstand'}</div>
        <div class="tiny faint">${fmtWeight(it.weight ?? cat?.weight)} · ${fmtCost(it.cost ?? cat?.cost)}</div></div></div>
    ${w ? html`<div class="small">Schaden <b>${fmtDice(w.dmg)} ${w.type}</b>${w.vers ? ` (zweihändig ${fmtDice(w.vers)})` : ''} · ${[...w.p].map((p) => ({ f: 'Finesse', l: 'leicht', h: 'schwer', 2: 'zweihändig', t: 'Wurfwaffe', r: 'Reichweite', v: 'vielseitig', a: 'Munition', o: 'Laden' })[p]).filter(Boolean).join(', ')}${WEAPON_RANGE[w.key] ? ` · ${WEAPON_RANGE[w.key].join('/')} m` : ''}</div>` : null}
    ${mi ? html`<div class="sd-text">${mi.desc.map((p) => html`<p>${p}</p>`)}</div><div class="tiny faint">Quelle: SRD 5.1 (Wizards of the Coast, CC-BY-4.0)</div>` : null}
    <div class="grid two">
      <${Field} label="Anzahl"><input class="input" type="number" min="0" value=${x.qty} disabled=${!canEdit} onInput=${(e) => setX({ ...x, qty: Number(e.target.value) || 0 })} /><//>
      <${Field} label="Name"><input class="input" value=${x.name} disabled=${!canEdit} onInput=${(e) => setX({ ...x, name: e.target.value })} /><//>
    </div>
    <${Field} label="Notiz"><${AutoTextarea} value=${x.notes || ''} disabled=${!canEdit} minRows=${2} onInput=${(e) => setX({ ...x, notes: e.target.value })} /><//>
    <div class="modal-foot" style="margin:0 -16px -16px">
      ${canEdit ? html`<${Btn} kind="danger" icon="trash" onClick=${() => close({ remove: true })}>Entfernen<//>` : null}
      <span class="grow"></span>
      <${Btn} kind="ghost" onClick=${() => close(null)}>Schließen<//>
      ${canEdit ? html`<${Btn} kind="primary" icon="check" onClick=${() => close({ item: x })}>Speichern<//>` : null}
    </div>
  </div>`;
}

function InventoryTab({ c, cm, canEdit, upd }) {
  const inv = c.inventory || [];
  const cur = c.currency || {};
  const rows = inv.map((it) => ({ it, cat: it.ref ? catalogItem(it.ref) : it.magic ? null : catalogByName(it.name) }));
  const weightOf = (r) => (Number(r.it.weight ?? r.cat?.weight) || 0) * (Number(r.it.qty) || 0);
  const total = rows.reduce((a, r) => a + weightOf(r), 0);
  const cap = carryCapacity(c.abilities?.str);
  const load = total / cap;
  const setItem = (id, patch) => upd({ inventory: inv.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const isEquipped = (r) => {
    if (r.cat?.cat === 'weapon') return (c.weapons || []).includes(r.cat.ref);
    if (r.cat?.cat === 'armor') return c.armor?.body === r.cat.ref;
    if (r.cat?.cat === 'shield') return !!c.armor?.shield;
    return !!r.it.equipped;
  };
  const toggleEquip = (r) => {
    const k = r.cat?.ref;
    if (r.cat?.cat === 'weapon') {
      const list = [...(c.weapons || [])];
      const i = list.indexOf(k);
      if (i >= 0) list.splice(i, 1); else list.push(k);
      upd({ weapons: list });
    } else if (r.cat?.cat === 'armor') upd({ armor: { ...(c.armor || {}), body: c.armor?.body === k ? '' : k } }, { rederive: true });
    else if (r.cat?.cat === 'shield') upd({ armor: { ...(c.armor || {}), shield: !c.armor?.shield } }, { rederive: true });
    else setItem(r.it.id, { equipped: !r.it.equipped });
  };
  const attuned = inv.filter((x) => x.attuned);
  const add = async () => {
    const it = await openModal(({ close }) => html`<${ItemPicker} close=${close} />`, { title: 'Gegenstand hinzufügen', icon: 'backpack', size: 'lg' });
    if (it) upd({ inventory: [...inv, it] });
  };
  const open = async (r) => {
    const res = await openModal(({ close }) => html`<${ItemDetail} it=${r.it} cat=${r.cat} canEdit=${canEdit} close=${close} />`, { title: r.it.name, icon: 'backpack', size: 'md' });
    if (!res) return;
    if (res.remove) upd({ inventory: inv.filter((x) => x.id !== r.it.id) });
    else if (res.item) setItem(r.it.id, res.item);
  };
  const equipped = rows.filter(isEquipped);
  const pack = rows.filter((r) => !isEquipped(r));
  const itemRow = (r) => html`<div class="act-row inv-row" key=${r.it.id} onClick=${() => open(r)}>
    <span><${ItemArt} item=${{ ...r.it, icon: r.it.icon || r.cat?.icon }} size=${36} /></span>
    <span class="nm"><b>${r.it.name}${r.it.attuned ? html` <span class="badge gold">eingestimmt</span>` : null}</b><small>${r.it.magic ? `${r.it.type || ''} · ${r.it.rarity || ''}` : r.cat ? `${CATEGORIES[r.cat.cat]}${r.cat.sub ? ` · ${r.cat.sub}` : ''}` : r.it.notes || ''}</small></span>
    <span class="small hide-sm">${fmtWeight(weightOf(r))}</span>
    <span class="small">×${r.it.qty}</span>
    <span class="small hide-sm">${fmtCost((r.it.cost ?? r.cat?.cost ?? 0) * (r.it.qty || 1))}</span>
    <span class="row nowrap" style="gap:4px" onClick=${(e) => e.stopPropagation()}>
      ${r.it.attune ? html`<button type="button" class=${`equip-toggle${r.it.attuned ? ' on' : ''}`} title="Einstimmen (max. 3)" disabled=${!canEdit || (!r.it.attuned && attuned.length >= 3)} onClick=${() => setItem(r.it.id, { attuned: !r.it.attuned })}><${Icon} name="sparkles" size=${14} /></button>` : null}
      <button type="button" class=${`equip-toggle${isEquipped(r) ? ' on' : ''}`} title=${isEquipped(r) ? 'Ablegen' : 'Ausrüsten'} disabled=${!canEdit} onClick=${() => toggleEquip(r)}><${Icon} name="check" size=${14} /></button>
    </span>
  </div>`;

  return html`<div class="stack">
    <div class="inv-top">
      <div class="sheet-card stack sm">
        <h3><${Icon} name="coins" size=${13} />Geld</h3>
        <div class="coin-row">${[['pp', 'PM'], ['gp', 'GM'], ['ep', 'EM'], ['sp', 'SM'], ['cp', 'KM']].map(([k, l]) => html`<label class=${`coin ${k}`}><i>${l}</i>
          <input class="input sm" type="number" value=${cur[k] || 0} disabled=${!canEdit} onInput=${(e) => upd({ currency: { ...cur, [k]: Number(e.target.value) || 0 } })} /></label>`)}</div>
        <div class="tiny faint">Gesamtwert: ${(((cur.pp || 0) * 1000 + (cur.gp || 0) * 100 + (cur.ep || 0) * 50 + (cur.sp || 0) * 10 + (cur.cp || 0)) / 100).toLocaleString('de-DE')} GM</div>
      </div>
      <div class="sheet-card stack sm">
        <h3><${Icon} name="backpack" size=${13} />Traglast</h3>
        <div class="row"><b style="font-size:20px">${String(Math.round(total * 10) / 10).replace('.', ',')} kg</b><span class="muted">von ${cap.toLocaleString('de-DE')} kg</span></div>
        <div class=${`load-bar${load > 1 ? ' over' : load > 0.66 ? ' warn' : ''}`}><i style=${{ width: `${Math.min(100, load * 100)}%` }}></i></div>
        <div class="tiny faint">Stärke ${c.abilities?.str ?? 10} × 7,5 kg. ${load > 1 ? 'Überladen – Bewegung stark eingeschränkt.' : ''}</div>
      </div>
      <div class="sheet-card stack sm">
        <h3><${Icon} name="sparkles" size=${13} />Einstimmung</h3>
        <div class="attune-slots">${[0, 1, 2].map((i) => (attuned[i] ? html`<span title=${attuned[i].name}><${ItemArt} item=${attuned[i]} size=${52} /></span>` : html`<span class="attune-slot"><${Icon} name="plus" size=${16} /></span>`))}</div>
        <div class="tiny faint">${attuned.length}/3 magische Gegenstände eingestimmt.</div>
      </div>
    </div>

    <div class="sheet-card stack sm">
      <div class="row"><b class="grow"><${Icon} name="shield" size=${16} /> Rüstung & Schild</b><span class="badge accent">RK ${cm.ac.ac}</span></div>
      <div class="row">
        <${Select} value=${c.armor?.body || ''} disabled=${!canEdit} onChange=${(v) => upd({ armor: { ...(c.armor || {}), body: v } }, { rederive: true })} options=${[{ value: '', label: 'Keine Rüstung' }, ...ARMOR.map((a) => ({ value: a.key, label: `${a.name} (${ARMOR_TYPE[a.type]}, RK ${a.ac})` }))]} style="max-width:340px" />
        <${Toggle} checked=${!!c.armor?.shield} onChange=${(v) => canEdit && upd({ armor: { ...(c.armor || {}), shield: v } }, { rederive: true })} label="Schild" />
        <label class="small muted">Magie/Sonstiges <input class="input tiny" type="number" value=${c.acBonus || 0} disabled=${!canEdit} onInput=${(e) => upd({ acBonus: Number(e.target.value) || 0 }, { rederive: true })} /></label>
      </div>
      <div class="tiny faint">${cm.ac.parts.join(' · ')}${cm.ac.stealthDis ? ' · Nachteil auf Heimlichkeit' : ''}${cm.ac.heavyStrShort ? ' · STÄ zu niedrig: −3 m Bewegung' : ''}</div>
    </div>

    <div class="sheet-card">
      <h3><${Icon} name="check" size=${13} />Ausgerüstet<span class="grow"></span>${canEdit ? html`<${Btn} size="sm" icon="plus" onClick=${add}>Gegenstand<//>` : null}</h3>
      <div class="act-table">
        <div class="act-head inv-row"><span></span><span>Name</span><span class="hide-sm">Gewicht</span><span>Anz.</span><span class="hide-sm">Wert</span><span></span></div>
        ${equipped.map(itemRow)}
        ${!equipped.length ? html`<div class="small faint" style="padding:6px 4px">Nichts ausgerüstet – Haken bei einem Gegenstand setzen.</div>` : null}
      </div>
    </div>
    <div class="sheet-card">
      <h3><${Icon} name="backpack" size=${13} />Rucksack & Besitz</h3>
      <div class="act-table">
        ${pack.map(itemRow)}
        ${!pack.length ? html`<div class="small faint" style="padding:6px 4px">Leer.</div>` : null}
      </div>
    </div>
  </div>`;
}

// ───────────────────────── Merkmale, Übungen, Hintergrund, Notizen ─────────────────────────
function FeaturesTab({ c, ed, canEdit, upd, units }) {
  const sp = findSpecies(ed, c.speciesKey);
  const sub = sp?.subs?.find((s) => s.key === c.subspeciesKey);
  const opt = sp?.option?.list.find((o) => o.key === c.speciesOption);
  return html`<div class="stack">
    ${(c.classes || []).map((x) => {
      const cls = findClass(x.cls);
      const feats = classFeatures(x.cls, ed, x.level).filter((f) => f.kind !== 'asi' && f.kind !== 'boon');
      return html`<div class="sheet-card stack sm">
        <h3><${Icon} name="shield" size=${13} />${cls?.name} ${x.level}${x.subclass ? ` · ${x.subclass}` : ''}</h3>
        <div class="feat-list">${feats.map((f) => html`<div><b>St. ${f.level} · ${f.kind === 'sub' ? (x.subclass ? `${x.subclass}: Merkmal` : f.name) : f.name}</b>${f.desc && f.kind !== 'sub' ? html` <span class="small muted">– ${f.desc}</span>` : null}</div>`)}</div>
      </div>`;
    })}
    ${sp ? html`<div class="sheet-card stack sm">
      <h3><${Icon} name="globe" size=${13} />${c.species}</h3>
      <div class="small muted">${c.size || sp.size} · Bewegung ${fmtDist(c.speed || sp.speed, units)}${c.darkvision ? ` · Dunkelsicht ${fmtDist(c.darkvision, units)}` : ''}${opt?.note ? ` · ${opt.note}` : ''}</div>
      <div class="feat-list">${[...(sp.traits || []), ...(sub?.traits || [])].map(([n, t]) => html`<div><b>${n}</b> <span class="small muted">– ${t}</span></div>`)}</div>
    </div>` : null}
    ${(c.feats || []).length ? html`<div class="sheet-card stack sm">
      <h3><${Icon} name="star" size=${13} />Talente</h3>
      <div class="feat-list">${c.feats.map((f) => html`<div><b>${f.name || findFeat(f.key)?.name}</b>${f.source ? html` <span class="tiny faint">(${f.source})</span>` : null} <span class="small muted">– ${findFeat(f.key)?.desc || ''}</span></div>`)}</div>
    </div>` : null}
    <${Field} label="Eigene Merkmale (magische Gegenstände, Segnungen, Hausregeln)">
      <${AutoTextarea} value=${c.customFeatures || c.features || ''} disabled=${!canEdit} minRows=${4} onInput=${(e) => upd({ customFeatures: e.target.value })} />
    <//>
  </div>`;
}

function ProfsTab({ c, cm, ed }) {
  const armor = [...new Set((c.classes || []).flatMap((x, i) => (i === 0 ? perEd(findClass(x.cls)?.armor, ed) || [] : [])))];
  const weapons = [...new Set((c.classes || []).flatMap((x) => perEd(findClass(x.cls)?.weapons, ed) || []))];
  const profSkills = ALL_SKILLS.filter((k) => cm.skills[k].prof);
  const box = (label, val) => html`<div class="persona-box"><div class="l">${label}</div><p>${val || '–'}</p></div>`;
  return html`<div class="stack">
    <div class="sh-strip" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
      <div class="sh-stat"><span class="l">Übungsbonus</span><span class="v">+${cm.pb}</span></div>
      <div class="sh-stat"><span class="l">Rettungswürfe</span><span class="v" style="font-size:16px">${AB.filter((k) => cm.saves[k].prof).map((k) => AB_SHORT[k]).join(' · ') || '–'}</span></div>
    </div>
    <div class="persona-grid">
      ${box('Rüstung', armor.map((a) => (a === 'shield' ? 'Schilde' : ARMOR_TYPE[a] ? `${ARMOR_TYPE[a][0].toUpperCase()}${ARMOR_TYPE[a].slice(1)}e Rüstung` : a)).join(', '))}
      ${box('Waffen', weapons.map((w) => WEAPON_CAT[w] || findWeapon(w)?.name || w).join(', '))}
      ${box('Werkzeuge', c.tools)}
      ${box('Sprachen', (c.languages || []).join(', '))}
      ${box('Fertigkeiten', profSkills.map((k) => `${skillName(k)}${cm.skills[k].prof === 2 ? ' (Expertise)' : ''}`).join(', '))}
      ${box('Talente', (c.feats || []).map((f) => f.name || findFeat(f.key)?.name).join(', '))}
    </div>
  </div>`;
}

function BackgroundTab({ c, ed, unlock, upd }) {
  const bg = findBackground(ed, c.backgroundKey);
  const p = c.personality || {};
  const field = (label, value, onInput, rows = 2) => (unlock
    ? html`<${Field} label=${label}><${AutoTextarea} value=${value || ''} minRows=${rows} onInput=${(e) => onInput(e.target.value)} /><//>`
    : html`<div class="persona-box"><div class="l">${label}</div><p>${value || html`<span class="faint">–</span>`}</p></div>`);
  return html`<div class="stack">
    <div class="sheet-card stack sm">
      <h3><${Icon} name="feather" size=${13} />Hintergrund: ${c.background || bg?.name || '–'}</h3>
      ${bg?.feature ? html`<div class="small"><b>Merkmal:</b> ${bg.feature}</div>` : null}
      ${bg?.feat ? html`<div class="small"><b>Herkunftstalent:</b> ${findFeat(bg.feat)?.name || bg.feat} <span class="muted">– ${findFeat(bg.feat)?.desc || ''}</span></div>` : null}
      ${bg?.skills ? html`<div class="small"><b>Fertigkeiten:</b> ${(bg.skills || []).map((k) => skillName(k)).join(', ')}</div>` : null}
      ${bg?.tool ? html`<div class="small"><b>Werkzeug:</b> ${bg.tool}</div>` : null}
    </div>
    ${!unlock ? html`<div class="tiny faint"><${Icon} name="lock" size=${12} /> Persönlichkeit und Geschichte änderst du im Korrektur-Modus (Menü ⋮ oben).</div>` : null}
    <div class="persona-grid">
      ${unlock ? html`<${Field} label="Gesinnung"><${Select} value=${c.alignment || ''} onChange=${(v) => upd({ alignment: v })} options=${[{ value: '', label: '–' }, ...ALIGNMENTS]} /><//>` : html`<div class="persona-box"><div class="l">Gesinnung</div><p>${ALIGNMENTS.find((a) => a.value === c.alignment)?.label || c.alignment || '–'}</p></div>`}
      ${field('Aussehen', c.appearance, (v) => upd({ appearance: v }))}
      ${field('Persönlichkeitsmerkmale', p.traits, (v) => upd({ personality: { ...p, traits: v } }))}
      ${field('Ideale', p.ideals, (v) => upd({ personality: { ...p, ideals: v } }))}
      ${field('Bindungen', p.bonds, (v) => upd({ personality: { ...p, bonds: v } }))}
      ${field('Makel', p.flaws, (v) => upd({ personality: { ...p, flaws: v } }))}
    </div>
    ${field('Hintergrundgeschichte', c.backstory, (v) => upd({ backstory: v }), 6)}
  </div>`;
}

function NotesTab({ c, canEdit, upd }) {
  return html`<div class="stack">
    <${Field} label="Notizen"><${AutoTextarea} value=${c.notes || ''} disabled=${!canEdit} minRows=${6} onInput=${(e) => upd({ notes: e.target.value })} placeholder="Was dein Charakter weiß, Hinweise, Pläne …" /><//>
    <div class="grid two">
      <${Field} label="Verbündete & Organisationen"><${AutoTextarea} value=${c.allies || ''} disabled=${!canEdit} minRows=${3} onInput=${(e) => upd({ allies: e.target.value })} /><//>
      <${Field} label="Feinde & Rivalen"><${AutoTextarea} value=${c.enemies || ''} disabled=${!canEdit} minRows=${3} onInput=${(e) => upd({ enemies: e.target.value })} /><//>
    </div>
    <${Field} label="Sonstiges (Schätze, Titel, Versprechen)"><${AutoTextarea} value=${c.misc || ''} disabled=${!canEdit} minRows=${3} onInput=${(e) => upd({ misc: e.target.value })} /><//>
  </div>`;
}
