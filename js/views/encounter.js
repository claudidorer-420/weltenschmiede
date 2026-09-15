// Encounter-Generator (lore-getreue Statblocks per KI + Schwierigkeit 1–10 aus KI UND DMG-Formel) und Bestiarium.
import { html, useState, useEffect, useMemo, useRef } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, col, createNote } from '../core/app.js';
import { openView, openNote } from '../core/workspace.js';
import { db } from '../core/db.js';
import { settings, updateSettings } from '../core/settings.js';
import { extractJSON } from '../core/ai.js';
import { encounterSystemPrompt, buildEncounterPrompt } from '../core/prompts.js';
import { saveToArchive } from '../core/archive.js';
import { loadParty } from '../core/party.js';
import { addToCombat, combatantsFromMonsters, combatantFromCharacter, loadCombat } from '../core/combat.js';
import { calcEncounter, difficultyLabel, SRD_ATTRIBUTION } from '../data/rules5e.js';
import { lootFor } from '../data/tables.js';
import { ViewFrame } from '../ui/frame.js';
import {
  Icon, IconBtn, Btn, Field, Select, Segmented, Toggle, ModelPicker, AutoTextarea, Statblock, MarkdownView, toast, openModal,
  confirmDialog, Empty, Spinner,
} from '../ui/components.js';
import { useGeneration, GenStatus } from '../ui/aiout.js';
import { normalizeMonster, monsterToMarkdown } from '../ui/statblock.js';
import { useCol } from '../core/hooks.js';
import { uid, now, sortBy, debounce, fmtDate } from '../lib/util.js';
import { crToNumber } from '../data/rules5e.js';
import { ORIGINS, DND, namesFor, matchNames, hasNameList, originOf, originShort } from '../data/origins.js';

const ENVIRONMENTS = ['Wald', 'Höhle', 'Ruine', 'Sumpf', 'Gebirge', 'Stadtgassen', 'Taverne', 'Schiff', 'Wüste', 'Friedhof', 'Tempel', 'Kanalisation', 'Brücke', 'Schneesturm'];
const GOALS = ['Kampf bis zum Tod', 'Hinterhalt', 'Verteidigung', 'Flucht', 'Boss-Kampf', 'Welle um Welle', 'Ritual unterbrechen', 'Geisel befreien', 'Verfolgungsjagd'];

const blankMonster = (origin = DND) => ({ id: uid(6), qty: 1, name: '', origin, note: '' });
const defaultDraft = () => ({ levels: [5, 5, 5, 5], monsters: [blankMonster()], environment: '', goal: '', extra: '', paint: false });

// Namensfeld mit Suchliste: Monster der gewählten Welt (Wiki-Listen, bei D&D SRD + offizielle Bücher) und das eigene Bestiarium
function MonsterNameInput({ value, origin, onChange, bestiary }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [act, setAct] = useState(0);
  const [pos, setPos] = useState(null);
  const wrap = useRef();
  // Liste breit nach rechts aufklappen (am rechten Rand nach links verschieben)
  const place = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const vw = document.documentElement.clientWidth;
    const width = Math.round(Math.min(520, vw - 24, Math.max(r.width, 420)));
    setPos({ width, left: Math.round(Math.min(0, vw - 12 - (r.left + width))) });
  };
  const show = () => { place(); setOpen(true); };
  useEffect(() => {
    let alive = true;
    setList(null);
    namesFor(origin).then((l) => alive && setList(l)).catch(() => alive && setList([]));
    return () => { alive = false; };
  }, [origin]);
  const own = useMemo(() => (bestiary || [])
    .filter((b) => !hasNameList(origin) || originOf(b) === origin)
    .map((b) => ({ name: b.name, meta: `HG ${b.cr ?? '?'}`, own: true })), [bestiary, origin]);
  const items = useMemo(() => {
    const seen = new Set();
    const all = [...own, ...(list || [])].filter((it) => {
      const k = it.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return matchNames(all, value, 60);
  }, [own, list, value]);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', off);
    addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', off);
      removeEventListener('resize', place);
    };
  }, [open]);
  const pick = (it) => { onChange(it.name); setOpen(false); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); setAct((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAct((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && open && items[act]) { e.preventDefault(); pick(items[act]); }
    else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
  };
  const total = (list?.length || 0) + own.length;
  const ph = hasNameList(origin) ? `Monster suchen (${list ? total : '…'})` : 'Name frei eingeben';
  const tip = hasNameList(origin) ? `${total} Monster aus ${originShort(origin)} – tippen zum Filtern oder frei eingeben` : 'Eigene Kreatur: Name frei eingeben';
  return html`<div class="mn-combo" ref=${wrap}>
    <input class="input" value=${value} placeholder=${ph} title=${tip} autocomplete="off" spellcheck=${false}
      onInput=${(e) => { onChange(e.target.value); show(); setAct(0); }} onFocus=${show} onKeyDown=${onKey} />
    <button type="button" class="mn-toggle" tabIndex="-1" title="Liste öffnen" onPointerDown=${(e) => e.preventDefault()} onClick=${() => (open ? setOpen(false) : show())}><${Icon} name="chevron-down" size=${15} /></button>
    ${open && (items.length || !list) ? html`<div class="mn-pop" role="listbox" style=${pos ? { width: `${pos.width}px`, left: `${pos.left}px` } : null}>
      ${!list ? html`<div class="mn-empty"><span class="spinner sm" /> Namen werden geladen …</div>` : null}
      ${items.map((it, i) => html`<button type="button" key=${`${it.name}:${i}`} class=${`mn-item${i === act ? ' active' : ''}`} onMouseEnter=${() => setAct(i)} onPointerDown=${(e) => e.preventDefault()} onClick=${() => pick(it)}>
        <span class="mn-name">${it.name}${it.alt ? html` <small>${it.alt}</small>` : null}</span>
        <span class="mn-meta">${it.own ? html`<span class="badge players">Bestiarium</span>` : it.srd ? html`<span class="badge gold">SRD</span>` : null}<span class="ellipsis">${it.meta}</span></span>
      </button>`)}
    </div>` : null}
  </div>`;
}

function gaugeColor(score) {
  const s = Math.max(1, Math.min(10, score || 1));
  const hue = 130 - ((s - 1) / 9) * 130;
  return `hsl(${hue} 70% 50%)`;
}

function Difficulty({ result, levels, version }) {
  const calc = useMemo(() => calcEncounter({ levels, monsters: result.monsters.map((m) => ({ cr: m.cr, xp: m.xp, qty: m.qty })), version }), [result, levels, version]);
  const ai = result.difficulty || {};
  const aiScore = Number(ai.score) || 0;
  return html`<div class="card">
    <div class="difficulty">
      <div class="gauge" style=${{ '--v': aiScore, '--gc': gaugeColor(aiScore) }}><b>${aiScore || '–'}</b><small>von 10</small></div>
      <div class="stack sm">
        <div class="row"><b style="font-size:18px">${ai.label || difficultyLabel(aiScore)}</b><span class="badge accent">KI-Einschätzung</span></div>
        ${ai.reasoning ? html`<div class="small muted" style="line-height:1.55">${ai.reasoning}</div>` : null}
      </div>
    </div>
    ${calc ? html`<div class="hr"></div>
      <div class="row between"><b>Nach DMG-Formel (${version}): ${calc.score}/10 · ${calc.band}</b><span class="small faint">${calc.count} Gegner · ${calc.totalXp.toLocaleString('de-DE')} EP${calc.multiplier ? ` × ${calc.multiplier} = ${calc.adjustedXp.toLocaleString('de-DE')} angepasste EP` : ''}</span></div>
      <div class="diff-bar"><span class="mark" style=${{ left: `${(calc.score - 1) / 9 * 100}%` }} title="DMG-Formel"></span>${aiScore ? html`<span class="mark ai" style=${{ left: `${(aiScore - 1) / 9 * 100}%` }} title="KI"></span>` : null}</div>
      <table class="xp-table">${Object.entries(calc.thresholds).map(([k, v]) => html`<tr class=${calc.band.startsWith(k) ? 'hit' : ''}><td>${k}</td><td>${v.toLocaleString('de-DE')} EP</td></tr>`)}</table>
      <div class="tiny faint">Weiße Markierung = Formel, lila = KI. Die Formel kennt keine Taktik, Gelände oder Spezialfähigkeiten – die KI-Einschätzung schon.</div>` : null}
  </div>`;
}

function JsonEditor({ close, monster }) {
  const [text, setText] = useState(JSON.stringify(monster, null, 2));
  const [err, setErr] = useState('');
  return html`<div class="modal-body stack">
    <textarea class="textarea mono" style="min-height:55vh;font-size:13px" value=${text} onInput=${(e) => setText(e.target.value)} spellcheck=${false} />
    ${err ? html`<div class="danger-text small">${err}</div>` : null}
    <div class="btn-row end"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" onClick=${() => { try { close(JSON.parse(text)); } catch (e) { setErr(`Ungültiges JSON: ${e.message}`); } }}>Übernehmen<//></div>
  </div>`;
}
const editJson = (monster) => openModal(({ close }) => html`<${JsonEditor} close=${close} monster=${monster} />`, { title: 'Statblock bearbeiten', icon: 'pencil', size: 'lg' });

export async function saveToBestiary(m) {
  const { qty, ...rest } = normalizeMonster(m);
  await db.add(col('monsters'), { ...rest, origin: m.origin || rest.origin || '', createdAt: now() });
  toast(`„${rest.name}“ im Bestiarium gespeichert`, 'success', { action: { label: 'Öffnen', onClick: () => openView('bestiary') } });
}

export async function monsterToNote(m) {
  const n = await createNote({ title: m.name, folder: 'Monster', body: `---\ntyp: monster\ntags: [monster]\n---\n${monsterToMarkdown(m)}` });
  toast(`Notiz „${n.title}“ angelegt`, 'success', { action: { label: 'Öffnen', onClick: () => openNote(n.id) } });
}

export function EncounterView({ tabId, params = {} }) {
  const campEd = useStore(app, (s) => s.campaign?.settings?.rulesVersion);
  const devEd = useStore(settings, (s) => s.rulesVersion);
  const version = (campEd || devEd) === '2024' ? '2024' : '2014';
  const [draft, setDraft] = useState(() => settings.get().encounterDraft || defaultDraft());
  const [result, setResult] = useState(null);
  const [model, setModel] = useState(null);
  const [count, setCount] = useState(4);
  const [lvl, setLvl] = useState(5);
  const [loot, setLoot] = useState(null);
  const gen = useGeneration('encounter');
  const saved = useCol(app.get().cid ? col('encounters') : null);
  const bestiary = useCol(app.get().cid ? col('monsters') : null);
  const persist = useMemo(() => debounce((d) => updateSettings({ encounterDraft: d }), 700), []);
  const set = (patch) => setDraft((d) => {
    const n = { ...d, ...patch };
    persist(n);
    return n;
  });
  const setMon = (i, patch) => set({ monsters: draft.monsters.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  // Aus dem Bestiarium: „Mit KI erstellen“ übergibt Name und Welt
  useEffect(() => {
    const p = params.preset;
    if (!p?.name || (p.ts && Date.now() - p.ts > 60000)) return; // nach dem Neuladen nicht erneut übernehmen
    set({ monsters: [{ ...blankMonster(p.origin || DND), name: p.name }] });
    toast(`„${p.name}“ übernommen – Gruppe prüfen und „Statblocks generieren“`, 'success');
  }, [params.preset?.name, params.preset?.ts]);

  const livePreview = useMemo(() => {
    if (!bestiary) return null;
    const byName = new Map(bestiary.map((b) => [b.name.toLowerCase(), b]));
    const known = draft.monsters.filter((m) => m.name.trim()).map((m) => ({ ...m, sb: byName.get(m.name.trim().toLowerCase()) }));
    if (!known.length || known.some((k) => !k.sb)) return null;
    return calcEncounter({ levels: draft.levels, monsters: known.map((k) => ({ cr: k.sb.cr, qty: k.qty })), version });
  }, [draft, bestiary, version]);

  const importParty = async () => {
    const party = await loadParty();
    if (!party.length) return toast('Keine Charaktere mit dieser Kampagne verknüpft (Charaktere → „Kampagne zuordnen“).', 'error');
    set({ levels: party.map((p) => Number(p.char.level) || 1) });
    toast(`${party.length} Charaktere übernommen`, 'success');
  };

  const run = async () => {
    const monsters = draft.monsters.filter((m) => m.name.trim());
    if (!monsters.length) return toast('Mindestens ein Monster mit Namen eintragen.', 'error');
    setResult(null);
    setLoot(null);
    const res = await gen.run({ system: encounterSystemPrompt({ version, paint: draft.paint }), model, json: true, prompt: buildEncounterPrompt({ ...draft, monsters }) });
    if (!res) return;
    try {
      const data = extractJSON(res.text);
      data.monsters = (data.monsters || []).map((m, i) => ({ ...m, qty: Number(m.qty) || monsters[i]?.qty || 1, origin: (monsters.find((x) => x.name.trim().toLowerCase() === String(m.name || '').toLowerCase()) || monsters[i])?.origin || '' }));
      setResult(data);
      saveToArchive({ kind: 'encounter', title: `Encounter: ${monsters.map((m) => `${m.qty}× ${m.name}`).join(', ')}`, text: '', data, config: draft, provider: res.provider, model: res.model });
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const updateMonster = (i, m) => setResult({ ...result, monsters: result.monsters.map((x, j) => (j === i ? { ...m, qty: x.qty } : x)) });
  const startCombat = async (withParty = true) => {
    const st = await loadCombat();
    if (st.combatants.length && !(await confirmDialog(`Im Kampf-Tracker sind schon ${st.combatants.length} Kämpfer. Trotzdem hinzufügen?`, { ok: 'Hinzufügen' }))) return;
    const list = combatantsFromMonsters(result.monsters);
    if (withParty && !st.combatants.some((c) => c.isPC)) {
      const party = await loadParty();
      list.unshift(...party.map(combatantFromCharacter));
    }
    await addToCombat(list, 'Encounter geladen');
    openView('combat');
  };
  const saveEncounter = async () => {
    await db.add(col('encounters'), { name: result.monsters.map((m) => `${m.qty}× ${m.name}`).join(', '), draft, result, ts: now() });
    toast('Encounter gespeichert', 'success');
  };
  const asNote = async () => {
    const r = result;
    let body = `---\ntyp: encounter\ntags: [encounter]\n---\n> [!kampf] Schwierigkeit ${r.difficulty?.score ?? '?'}/10 – ${r.difficulty?.label || ''}\n> ${r.difficulty?.reasoning || ''}\n\n`;
    body += `**Gruppe:** Stufen ${draft.levels.join(', ')}${draft.environment ? ` · **Umgebung:** ${draft.environment}` : ''}\n\n`;
    for (const m of r.monsters) body += `## ${m.qty}× ${m.name}\n${monsterToMarkdown(m)}\n`;
    if (r.tactics) body += `## Taktik\n${r.tactics}\n\n`;
    if (r.terrain?.length) body += `## Gelände\n${r.terrain.map((t) => `- ${t}`).join('\n')}\n\n`;
    if (r.loot) body += `> [!loot] Beute\n> ${r.loot}\n\n`;
    if (r.scaling) body += `## Anpassen\n${r.scaling}\n`;
    const n = await createNote({ title: `Encounter – ${r.monsters.map((m) => m.name).join(', ')}`.slice(0, 90), folder: 'Encounter', body });
    openNote(n.id);
  };
  const maxCR = result ? Math.max(...result.monsters.map((m) => crToNumber(m.cr))) : 0;

  return html`<${ViewFrame} tabId=${tabId} title="Encounter" actions=${html`<${IconBtn} icon="ghost" title="Bestiarium" onClick=${() => openView('bestiary')} />`}>
    <div class="page wide">
      <div class="split">
        <div class="stack lg">
          <div class="page-head" style="margin:0"><h1><${Icon} name="swords" size=${26} />Encounter-Generator</h1><span class="sub">Monster aus jeder Welt – lore-getreu in 5e übertragen, mit Schwierigkeit 1–10 (KI + DMG-Formel), Taktik, Gelände und Beute.</span></div>

          <div class="card stack">
            <div class="card-head" style="margin:0"><h3><${Icon} name="users" size=${18} />Gruppe</h3><span class="grow"></span><${Btn} size="sm" icon="download" onClick=${importParty}>Aus Kampagne<//></div>
            <div class="party-levels">
              ${draft.levels.map((l, i) => html`<span class="lvl" title=${`Charakter ${i + 1}`}><b class="faint">#${i + 1}</b> Stufe
                <${IconBtn} icon="minus" size=${13} class="sm" onClick=${() => set({ levels: draft.levels.map((x, j) => (j === i ? Math.max(1, x - 1) : x)) })} /><b>${l}</b>
                <${IconBtn} icon="plus" size=${13} class="sm" onClick=${() => set({ levels: draft.levels.map((x, j) => (j === i ? Math.min(20, x + 1) : x)) })} />
                <${IconBtn} icon="x" size=${13} class="sm" onClick=${() => draft.levels.length > 1 && set({ levels: draft.levels.filter((_, j) => j !== i) })} /></span>`)}
              <${Btn} size="sm" kind="ghost" icon="plus" onClick=${() => set({ levels: [...draft.levels, draft.levels[draft.levels.length - 1] || 1] })}>Charakter<//>
            </div>
            <div class="row small" title="Setzt die ganze Gruppe auf einmal, z. B. 4 Charaktere, alle auf Stufe 5.">
              <span class="muted">Ganze Gruppe festlegen:</span>
              <input class="input tiny" type="number" min="1" max="10" value=${count} onInput=${(e) => setCount(Number(e.target.value) || 1)} /> Charaktere, alle auf Stufe
              <input class="input tiny" type="number" min="1" max="20" value=${lvl} onInput=${(e) => setLvl(Number(e.target.value) || 1)} />
              <${Btn} size="sm" icon="check" onClick=${() => set({ levels: Array.from({ length: count }, () => lvl) })}>Übernehmen<//>
            </div>
          </div>

          <div class="card stack">
            <div class="card-head" style="margin:0"><h3><${Icon} name="ghost" size=${18} />Gegner</h3></div>
            ${draft.monsters.map((m, i) => html`<div class="monster-row" key=${m.id}>
              <input class="input" type="number" min="1" max="99" value=${m.qty} title="Anzahl" onInput=${(e) => setMon(i, { qty: Math.max(1, Number(e.target.value) || 1) })} />
              <${Select} class="origin" value=${m.origin} onChange=${(v) => setMon(i, { origin: v })} options=${ORIGINS} title="Welt – bestimmt die Namensliste" />
              <${MonsterNameInput} value=${m.name} origin=${m.origin} bestiary=${bestiary} onChange=${(v) => setMon(i, { name: v })} />
              <${IconBtn} icon="x" class="danger" title="Entfernen" onClick=${() => draft.monsters.length > 1 ? set({ monsters: draft.monsters.filter((_, j) => j !== i) }) : toast('Mindestens ein Monster ist nötig.', 'error')} />
              <input class="input sm extra" value=${m.note} placeholder="Hinweis (optional): Anführer, verwundet, reitet einen Warg …" onInput=${(e) => setMon(i, { note: e.target.value })} />
            </div>`)}
            <${Btn} icon="plus" onClick=${() => set({ monsters: [...draft.monsters, blankMonster(draft.monsters[draft.monsters.length - 1]?.origin || DND)] })}>Weiteres Monster<//>
            ${livePreview ? html`<div class="small"><${Icon} name="activity" size=${14} /> Vorab (Bestiarium): <b>${livePreview.score}/10 · ${livePreview.band}</b></div>` : null}
          </div>

          <div class="card stack">
            <div class="card-head" style="margin:0"><h3><${Icon} name="mountain" size=${18} />Szene</h3></div>
            <${Field} label="Umgebung">
              <input class="input" value=${draft.environment} onInput=${(e) => set({ environment: e.target.value })} placeholder="z. B. Nebliger Friedhof bei Nacht" />
              <div class="chips" style="margin-top:6px">${ENVIRONMENTS.map((x) => html`<button type="button" class="chip suggest" onClick=${() => set({ environment: x })}>${x}</button>`)}</div>
            <//>
            <${Field} label="Situation / Ziel">
              <div class="chips">${GOALS.map((x) => html`<button type="button" class=${`chip${draft.goal === x ? ' selected' : ' suggest'}`} onClick=${() => set({ goal: draft.goal === x ? '' : x })}>${x}</button>`)}</div>
            <//>
            <${Field} label="Zusatzwünsche"><${AutoTextarea} value=${draft.extra} onInput=${(e) => set({ extra: e.target.value })} minRows=${2} placeholder="z. B. Der Anführer soll eine Hortaktion haben; Silberschwäche wie im Witcher" /><//>
            <div class="row">
              <span class="badge" title="Regelwerk der Kampagne – festgelegt beim Anlegen">D&D 5e ${version}</span>
              <${Toggle} checked=${draft.paint} onChange=${(v) => set({ paint: v })} label="Bemal-Guide" />
            </div>
          </div>

          <div class="row"><${ModelPicker} task="encounter" value=${model} onChange=${setModel} /></div>
          <${Btn} kind="primary" size="xl" block icon="swords" loading=${gen.busy} onClick=${run}>Statblocks & Bewertung generieren<//>

          ${saved?.length ? html`<div class="card">
            <div class="card-head"><h3><${Icon} name="archive" size=${18} />Gespeicherte Encounter</h3></div>
            <div class="list">${sortBy(saved, (e) => e.ts || 0, -1).map((e) => html`<div class="list-item">
              <span class="title" onClick=${() => { setDraft(e.draft); setResult(e.result); }}>${e.name}</span><span class="meta">${fmtDate(e.ts)}</span>
              <${IconBtn} icon="trash" class="danger" title="Löschen" onClick=${() => db.remove(col('encounters'), e.id)} />
            </div>`)}</div>
          </div>` : null}
        </div>

        <div class="gen-output sticky stack">
          <${GenStatus} gen=${gen} label="Monster werden beschworen …" />
          ${gen.busy && !result ? html`<div class="card"><div class="small faint">Die KI antwortet als JSON – die Statblocks erscheinen, sobald sie vollständig sind.</div></div>` : null}
          ${result ? html`
            <div class="toolbar">
              <${Btn} kind="primary" icon="sword" onClick=${() => startCombat(true)}>Kampf starten<//>
              <${Btn} icon="save" onClick=${saveEncounter}>Speichern<//>
              <${Btn} icon="file-text" onClick=${asNote}>Als Notiz<//>
              <${Btn} icon="refresh" onClick=${run}>Neu<//>
            </div>
            <${Difficulty} result=${result} levels=${draft.levels} version=${version} />
            ${result.monsters.map((m, i) => html`<div key=${i}>
              <div class="row" style="margin-bottom:6px"><span class="badge accent">${m.qty}×</span><b>${m.name}</b><span class="faint small">HG ${m.cr}</span></div>
              <${Statblock} monster=${m} twoCol=${true} tools=${html`
                <${IconBtn} icon="save" title="Ins Bestiarium" onClick=${() => saveToBestiary(m)} />
                <${IconBtn} icon="file-text" title="Als Notiz" onClick=${() => monsterToNote(m)} />
                <${IconBtn} icon="sword" title="In den Kampf" onClick=${async () => { await addToCombat(combatantsFromMonsters([m]), `${m.qty}× ${m.name}`); toast('Im Kampf-Tracker', 'success', { action: { label: 'Öffnen', onClick: () => openView('combat') } }); }} />
                <${IconBtn} icon="pencil" title="JSON bearbeiten" onClick=${async () => { const nm = await editJson(m); if (nm) updateMonster(i, nm); }} />`} />
              ${m.tactics ? html`<div class="small muted" style="margin:-8px 0 14px"><b>Taktik:</b> ${m.tactics}</div>` : null}
            </div>`)}
            ${result.tactics ? html`<div class="card"><div class="card-head"><h3><${Icon} name="target" size=${18} />Gemeinsame Taktik</h3></div><${MarkdownView} src=${result.tactics} /></div>` : null}
            ${result.terrain?.length ? html`<div class="card"><div class="card-head"><h3><${Icon} name="mountain" size=${18} />Gelände</h3></div><${MarkdownView} src=${result.terrain.map((t) => `- ${t}`).join('\n')} /></div>` : null}
            <div class="card">
              <div class="card-head"><h3><${Icon} name="gem" size=${18} />Beute</h3><span class="grow"></span><${Btn} size="sm" icon="d20" onClick=${() => setLoot(lootFor(maxCR))}>Offline würfeln<//></div>
              ${result.loot ? html`<${MarkdownView} src=${result.loot} />` : null}
              ${loot ? html`<${MarkdownView} src=${loot.map((l) => `- ${l}`).join('\n')} />` : null}
            </div>
            ${result.scaling ? html`<div class="card"><div class="card-head"><h3><${Icon} name="sort" size=${18} />Anpassen</h3></div><${MarkdownView} src=${result.scaling} /></div>` : null}
          ` : !gen.busy ? html`<div class="card"><${Empty} icon="swords" title="Noch kein Encounter">Trage Gruppe und Gegner ein – z. B. „3× Ertrunkener (The Witcher)“ und „1× Wasserweib“. Die KI erstellt passende 5e-Statblocks, die Formel prüft nach.<//></div>` : null}
        </div>
      </div>
    </div>
  <//>`;
}

// ───────────────────────── Bestiarium ─────────────────────────
const SRD_BASE = 'https://www.dnd5eapi.co';
const SIZE_DE = { Tiny: 'Winzig', Small: 'Klein', Medium: 'Mittelgroß', Large: 'Groß', Huge: 'Riesig', Gargantuan: 'Gigantisch' };

function fromSrd(m) {
  const prof = (prefix) => (m.proficiencies || []).filter((p) => p.proficiency?.name?.startsWith(prefix)).map((p) => `${p.proficiency.name.replace(`${prefix}: `, '')} +${p.value}`).join(', ');
  const list = (arr) => (arr || []).map((a) => ({ name: a.name, desc: a.desc || '' }));
  const ac = Array.isArray(m.armor_class) ? m.armor_class[0] : { value: m.armor_class };
  return normalizeMonster({
    name: m.name, size: SIZE_DE[m.size] || m.size, type: `${m.type}${m.subtype ? ` (${m.subtype})` : ''}`, alignment: m.alignment,
    ac: ac?.value, acNote: ac?.type && ac.type !== 'natural' ? ac.type : ac?.type === 'natural' ? 'natürliche Rüstung' : '',
    hp: m.hit_points, hpDice: m.hit_points_roll || m.hit_dice, speed: m.speed,
    abilities: { str: m.strength, dex: m.dexterity, con: m.constitution, int: m.intelligence, wis: m.wisdom, cha: m.charisma },
    saves: prof('Saving Throw'), skills: prof('Skill'),
    vulnerabilities: (m.damage_vulnerabilities || []).join(', '), resistances: (m.damage_resistances || []).join(', '), immunities: (m.damage_immunities || []).join(', '),
    conditionImmunities: (m.condition_immunities || []).map((c) => c.name).join(', '),
    senses: Object.entries(m.senses || {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', '), languages: m.languages,
    cr: String(m.challenge_rating), xp: m.xp, traits: list(m.special_abilities), actions: list(m.actions), reactions: list(m.reactions),
    legendary: list(m.legendary_actions), source: 'SRD 5.1 (englisch)',
  });
}

export function BestiaryView({ tabId }) {
  const list = useCol(app.get().cid ? col('monsters') : null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [srd, setSrd] = useState(null);
  const [srdQ, setSrdQ] = useState('');
  const [srdBusy, setSrdBusy] = useState('');
  const filtered = (list || []).filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()));
  const current = sel && list?.find((m) => m.id === sel);

  const loadSrdList = async () => {
    setSrdBusy('list');
    try {
      const cached = localStorage.getItem('ws.srdList');
      if (cached) setSrd(JSON.parse(cached));
      else {
        let res = await fetch(`${SRD_BASE}/api/2014/monsters`);
        if (!res.ok) res = await fetch(`${SRD_BASE}/api/monsters`);
        const j = await res.json();
        const items = (j.results || []).map((r) => ({ index: r.index, name: r.name, url: r.url }));
        localStorage.setItem('ws.srdList', JSON.stringify(items));
        setSrd(items);
      }
    } catch (e) {
      toast(`SRD-Liste nicht erreichbar: ${e.message}`, 'error');
    } finally {
      setSrdBusy('');
    }
  };
  const importSrd = async (item) => {
    setSrdBusy(item.index);
    try {
      const res = await fetch(`${SRD_BASE}${item.url}`);
      const m = fromSrd(await res.json());
      const { qty, ...rest } = m;
      const id = await db.add(col('monsters'), { ...rest, createdAt: now() });
      setSel(id);
      toast(`„${m.name}“ importiert`, 'success');
    } catch (e) {
      toast(`Import fehlgeschlagen: ${e.message}`, 'error');
    } finally {
      setSrdBusy('');
    }
  };

  return html`<${ViewFrame} tabId=${tabId} title="Bestiarium">
    <div class="page wide">
      <div class="split">
        <div class="stack">
          <div class="page-head" style="margin:0"><h1><${Icon} name="ghost" size=${24} />Bestiarium</h1><span class="sub">Deine gespeicherten Statblocks – für Encounter, Kampf-Tracker und Notizen.</span></div>
          <div class="search-box" style="margin:0"><${Icon} name="search" size=${16} /><input class="input" placeholder="Suchen …" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
          <div class="card tight">
            ${!list ? html`<div class="empty"><${Spinner} /></div>` : !filtered.length ? html`<div class="faint small" style="padding:8px">Noch leer. Speichere Statblocks aus dem Encounter-Generator oder importiere SRD-Monster.</div>`
              : html`<div class="list">${sortBy(filtered, 'name').map((m) => html`<div class=${`list-item${m.id === sel ? ' active' : ''}`} onClick=${() => setSel(m.id)}><${Icon} name="ghost" size=${15} /><span class="title">${m.name}</span><span class="meta">HG ${m.cr || '?'}</span></div>`)}</div>`}
          </div>
          <div class="card stack">
            <div class="card-head" style="margin:0"><h3><${Icon} name="download" size=${18} />SRD-Monster importieren</h3><span class="grow"></span>${!srd ? html`<${Btn} size="sm" loading=${srdBusy === 'list'} onClick=${loadSrdList}>Liste laden<//>` : null}</div>
            <div class="tiny faint">Über die freie D&D-5e-API (englische Texte). ${SRD_ATTRIBUTION}</div>
            ${srd ? html`<input class="input sm" placeholder="z. B. goblin, owlbear, lich" value=${srdQ} onInput=${(e) => setSrdQ(e.target.value)} />
              <div class="list" style="max-height:300px;overflow:auto">${srd.filter((s) => !srdQ || s.name.toLowerCase().includes(srdQ.toLowerCase())).slice(0, 60).map((s) => html`<div class="list-item" onClick=${() => importSrd(s)}><span class="title">${s.name}</span>${srdBusy === s.index ? html`<${Spinner} size="sm" />` : html`<${Icon} name="plus" size=${14} />`}</div>`)}</div>` : null}
          </div>
        </div>
        <div class="sticky">
          ${current ? html`<${Statblock} monster=${current} twoCol=${true} tools=${html`
            <${IconBtn} icon="sword" title="In den Kampf" onClick=${async () => { await addToCombat(combatantsFromMonsters([current])); toast('Im Kampf-Tracker', 'success', { action: { label: 'Öffnen', onClick: () => openView('combat') } }); }} />
            <${IconBtn} icon="file-text" title="Als Notiz" onClick=${() => monsterToNote(current)} />
            <${IconBtn} icon="pencil" title="Bearbeiten" onClick=${async () => { const nm = await editJson(current); if (nm) { const { id, ...rest } = normalizeMonster(nm); await db.set(col('monsters'), current.id, { ...rest, createdAt: current.createdAt || now() }); } }} />
            <${IconBtn} icon="trash" title="Löschen" onClick=${async () => { if (await confirmDialog(`„${current.name}“ aus dem Bestiarium löschen?`, { danger: true, ok: 'Löschen' })) { await db.remove(col('monsters'), current.id); setSel(null); } }} />`} />`
            : html`<div class="card"><${Empty} icon="ghost" title="Monster wählen">Links einen Eintrag antippen.<//></div>`}
        </div>
      </div>
    </div>
  <//>`;
}
