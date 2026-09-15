// Würfel: Würfelschale mit Animation, Würfelpool mit Anzahl, Effekte (Vorteil, Halblingsglück, Segen …),
// Würfe für den eigenen Charakter (Proben, Rettungswürfe, Angriffe), Makros, Attribute auswürfeln, Verlauf.
import { html, useState, useMemo, useEffect } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, useEdition } from '../core/app.js';
import { db } from '../core/db.js';
import { rolls, prepareRoll, commitRoll, clearRollLog } from '../core/rolls.js';
import { settings, updateSettings } from '../core/settings.js';
import { fmtMod } from '../lib/dice.js';
import { fmtTime } from '../lib/util.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, IconBtn, Btn, Toggle, Segmented, Select, promptDialog, toast } from '../ui/components.js';
import { DiceTray, RollResult, DieIcon, diceSummary } from '../ui/dicetray.js';
import { useCol } from '../core/hooks.js';
import { AB, AB_NAME, AB_SHORT, ALL_SKILLS, charMods, rollTraits, skillName, skillAbility, findWeapon, weaponAttack } from '../data/chargen.js';

const DICE = [4, 6, 8, 10, 12, 20, 100];
const DEFAULT_MACROS = [
  { label: 'Angriff', expr: '1d20+5' },
  { label: 'Langschwert', expr: '1d8+3' },
  { label: 'Feuerball', expr: '8d6' },
  { label: 'Heiltrank', expr: '2d4+2' },
];

const D20_FX = [
  { key: 'adv', label: 'Vorteil', icon: 'arrow-up', hint: 'Zwei W20, der höhere zählt' },
  { key: 'dis', label: 'Nachteil', icon: 'arrow-down', hint: 'Zwei W20, der niedrigere zählt' },
  { key: 'elven', label: 'Elfische Präzision', hint: 'Bei Vorteil drei W20 (Talent, 2014)' },
  { key: 'lucky', label: 'Glückspunkt', hint: '2014: zusätzlicher W20, der beste zählt · 2024: Vorteil' },
  { key: 'halfling', label: 'Halblingsglück', hint: 'Natürliche 1 wird neu gewürfelt' },
  { key: 'reliable', label: 'Verlässliches Talent', hint: 'Geübte Probe: unter 10 zählt als 10' },
  { key: 'bless', label: 'Segen +W4', hint: 'Angriffe und Rettungswürfe' },
  { key: 'guidance', label: 'Göttliche Führung +W4', hint: 'Attributswürfe' },
  { key: 'bane', label: 'Fluch −W4', hint: 'Angriffe und Rettungswürfe' },
];
const DMG_FX = [
  { key: 'crit', label: 'Kritischer Treffer', icon: 'zap', hint: 'Alle Schadenswürfel doppelt' },
  { key: 'gwf', label: 'Kampf mit Großwaffen', hint: '2024: 1 und 2 zählen als 3 · 2014: einmal neu würfeln' },
  { key: 'elemental', label: 'Elementarer Adept', hint: '1 zählt als 2' },
  { key: 'savage', label: 'Wilder Angreifer', hint: 'Schaden zweimal würfeln, das bessere zählt' },
];

function poolExpr(pool, mod) {
  const parts = Object.entries(pool).filter(([, n]) => n > 0).sort((a, b) => Number(b[0]) - Number(a[0])).map(([s, n]) => `${n}d${s}`);
  if (!parts.length) return '';
  return parts.join('+') + (mod ? (mod > 0 ? `+${mod}` : `${mod}`) : '');
}

export function DiceView({ tabId }) {
  const log = useStore(rolls, (s) => s.log);
  const macros = useStore(settings, (s) => s.diceMacros || DEFAULT_MACROS);
  const share = useStore(settings, (s) => s.shareRolls !== false);
  const edition = useEdition();
  const cid = useStore(app, (s) => s.cid);
  const role = useStore(app, (s) => s.role);
  const me = useStore(app, (s) => s.user?.uid);
  const chars = useCol(me ? `users/${me}/characters` : null);
  const cloud = db.mode === 'cloud' && !!cid;

  const [mode, setMode] = useState(() => localStorage.getItem('ws.diceMode') || 'pool');
  const [pool, setPool] = useState({});
  const [mod, setMod] = useState(0);
  const [expr, setExpr] = useState('');
  const [secret, setSecret] = useState(false);
  const [fx, setFx] = useState({});
  const [bardic, setBardic] = useState('');
  const [exhaustion, setExhaustion] = useState(0);
  const [charId, setCharId] = useState(() => localStorage.getItem('ws.diceChar') || '');
  const [current, setCurrent] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [statSets, setStatSets] = useState(null);
  const [tab, setTab] = useState('checks');

  const char = (chars || []).find((c) => c.id === charId) || null;
  const cm = useMemo(() => (char ? charMods(char) : null), [char]);
  const traits = useMemo(() => rollTraits(char), [char]);
  useEffect(() => {
    localStorage.setItem('ws.diceChar', charId);
    setExhaustion(traits.exhaustion || 0);
  }, [charId, char?.exhaustion]);

  const rolling = phase === 'rolling';
  const fromChar = (k) => !!char && !!traits[k] && fx[k] === undefined;
  const on = (k) => (fx[k] !== undefined ? fx[k] : !!traits[k]);
  const toggle = (k) => setFx({ ...fx, [k]: !on(k) });

  const effects = (kind, { prof } = {}) => {
    const out = {};
    for (const f of [...D20_FX, ...DMG_FX]) if (on(f.key)) out[f.key] = true;
    if (out.reliable && kind === 'check' && prof === 0) delete out.reliable;
    if (bardic) out.bardic = bardic;
    if (exhaustion) out.exhaustion = exhaustion;
    return out;
  };

  const go = (e, { label = '', kind = 'auto', prof } = {}) => {
    if (rolling) return;
    const r = prepareRoll(e, { label, kind, fx: effects(kind, { prof }), character: char?.name || '' });
    if (!r) return;
    setStatSets(null);
    setCurrent(r);
    setPhase('rolling');
  };
  const onDone = (r) => {
    if (!r.synthetic) commitRoll(r, { share: cloud ? share : false, secret: secret && cloud });
    setPhase('done');
    // Einmal-Effekte nach dem Wurf zurücksetzen
    if (fx.lucky || fx.crit || fx.savage || bardic || fx.bless || fx.guidance || fx.bane) {
      setFx({ ...fx, lucky: undefined, crit: undefined, savage: undefined });
      setBardic('');
    }
  };

  const pe = poolExpr(pool, mod);
  const poolKind = () => {
    const n20 = pool[20] || 0;
    const others = Object.entries(pool).some(([s, n]) => Number(s) !== 20 && n > 0);
    if (n20 === 1 && !others) return 'd20';
    if (!n20) return 'damage';
    return 'auto';
  };
  const tapDie = (sides) => {
    if (rolling) return;
    if (mode === 'instant') go(`1d${sides}${mod ? (mod > 0 ? `+${mod}` : mod) : ''}`, { label: `W${sides}`, kind: sides === 20 ? 'd20' : 'damage' });
    else setPool({ ...pool, [sides]: Math.min(30, (pool[sides] || 0) + 1) });
  };
  const dropDie = (e, sides) => {
    e.preventDefault();
    e.stopPropagation();
    if (pool[sides]) setPool({ ...pool, [sides]: pool[sides] - 1 });
  };
  const rollPool = () => {
    if (!pe) return;
    go(pe, { label: 'Würfelpool', kind: poolKind() });
  };
  const addMacro = async () => {
    const e = expr.trim() || pe;
    if (!e) return toast('Erst einen Ausdruck eingeben oder Würfel wählen.', 'error');
    const label = await promptDialog('Name des Makros', '', { title: 'Makro speichern', placeholder: 'z. B. Feuerball' });
    if (label) updateSettings({ diceMacros: [...macros, { label, expr: e }] });
  };
  const rollStats = () => {
    if (rolling) return;
    const sets = Array.from({ length: 6 }, () => prepareRoll('4d6dl1', { kind: 'free' })).filter(Boolean);
    const dice = sets.flatMap((s, i) => s.dice.map((d) => ({ ...d, group: i })));
    const vals = sets.map((s) => s.total);
    setStatSets(vals.slice().sort((a, b) => b - a));
    setCurrent({ synthetic: true, dice, total: vals.reduce((a, b) => a + b, 0), label: 'Attributswerte (4W6, niedrigster fällt weg)', text: vals.join(' · '), notes: [], ts: Date.now(), input: '6 × 4d6dl1' });
    setPhase('rolling');
  };

  const chip = (f) => html`<button type="button" key=${f.key} title=${f.hint} class=${`chip fx-chip${on(f.key) ? ' selected' : ''}`} onClick=${() => toggle(f.key)}>
    ${f.icon ? html`<${Icon} name=${f.icon} size=${13} />` : null}${f.label}${fromChar(f.key) ? html`<${Icon} name="user" size=${11} class="faint" />` : null}
  </button>`;

  const charPanel = () => {
    if (!char || !cm) return null;
    const roll20 = (bonus, label, kind, prof) => go(`1d20${bonus >= 0 ? '+' : ''}${bonus}`, { label: `${label}`, kind, prof });
    const weapons = (char.weapons || []).map((k) => findWeapon(k)).filter(Boolean).map((w) => weaponAttack(char, w, cm.mods, cm.pb));
    const manual = char.attacks || [];
    return html`<div class="card stack">
      <div class="row"><b class="grow"><${Icon} name="user" size=${16} /> ${char.name}</b><span class="small muted">Übung +${cm.pb} · Initiative ${fmtMod(cm.init)} · RK ${cm.ac.ac}</span></div>
      <${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'checks', label: 'Proben' }, { value: 'saves', label: 'Rettungswürfe' }, { value: 'attacks', label: 'Angriffe' }]} />
      ${tab === 'checks' ? html`<div class="quick-rolls">
        <button type="button" class="qr" disabled=${rolling} onClick=${() => roll20(cm.init, 'Initiative', 'init')}><span>Initiative</span><b>${fmtMod(cm.init)}</b></button>
        ${AB.map((k) => html`<button type="button" class="qr" disabled=${rolling} onClick=${() => roll20(cm.mods[k], `${AB_NAME[k]}-Probe`, 'check', 0)}><span>${AB_NAME[k]}</span><b>${fmtMod(cm.mods[k])}</b></button>`)}
        ${ALL_SKILLS.map((k) => html`<button type="button" class=${`qr${cm.skills[k].prof ? ' prof' : ''}`} disabled=${rolling} onClick=${() => roll20(cm.skills[k].bonus, skillName(k), 'check', cm.skills[k].prof)}>
          <span>${skillName(k)} <small class="faint">${AB_SHORT[skillAbility(k)]}</small></span><b>${fmtMod(cm.skills[k].bonus)}</b></button>`)}
      </div>` : null}
      ${tab === 'saves' ? html`<div class="quick-rolls">
        ${AB.map((k) => html`<button type="button" class=${`qr${cm.saves[k].prof ? ' prof' : ''}`} disabled=${rolling} onClick=${() => roll20(cm.saves[k].bonus, `${AB_NAME[k]}-Rettungswurf`, 'save')}><span>${AB_NAME[k]}</span><b>${fmtMod(cm.saves[k].bonus)}</b></button>`)}
        <button type="button" class="qr" disabled=${rolling} onClick=${() => go('1d20', { label: 'Todesrettungswurf', kind: 'save' })}><span>Todesrettung</span><b>SG 10</b></button>
      </div>` : null}
      ${tab === 'attacks' ? html`<div class="stack sm">
        ${weapons.map((a) => html`<div class="atk-row">
          <b class="grow">${a.name}<small class="faint"> · ${a.props || a.type}${a.prof ? '' : ' · ungeübt'}</small></b>
          <${Btn} size="sm" icon="d20" disabled=${rolling} onClick=${() => go(`1d20${fmtMod(a.bonus).replace('−', '-')}`, { label: `${a.name}: Angriff`, kind: 'attack' })}>${fmtMod(a.bonus)}<//>
          <${Btn} size="sm" icon="flame" disabled=${rolling} onClick=${() => go(a.damage, { label: `${a.name}: Schaden`, kind: 'damage' })}>${a.damage}<//>
          ${a.versatile ? html`<${Btn} size="sm" kind="ghost" disabled=${rolling} title="Zweihändig" onClick=${() => go(a.versatile, { label: `${a.name}: Schaden (zweihändig)`, kind: 'damage' })}>${a.versatile}<//>` : null}
        </div>`)}
        ${manual.map((a) => html`<div class="atk-row">
          <b class="grow">${a.name || 'Angriff'}</b>
          <${Btn} size="sm" icon="d20" disabled=${rolling} onClick=${() => go(`1d20${/^[+-]/.test(a.bonus) ? a.bonus : `+${a.bonus || 0}`}`, { label: `${a.name}: Angriff`, kind: 'attack' })}>${a.bonus || '+0'}<//>
          <${Btn} size="sm" icon="flame" disabled=${rolling} onClick=${() => go(a.damage || '1d6', { label: `${a.name}: Schaden`, kind: 'damage' })}>${a.damage || '1d6'}<//>
        </div>`)}
        ${!weapons.length && !manual.length ? html`<div class="small faint">Noch keine Waffen im Bogen.</div>` : null}
        ${cm.spell.map((s) => html`<div class="atk-row"><b class="grow">Zauberangriff<small class="faint"> · SG ${s.dc}</small></b><${Btn} size="sm" icon="wand" disabled=${rolling} onClick=${() => go(`1d20+${s.attack}`, { label: 'Zauberangriff', kind: 'attack' })}>${fmtMod(s.attack)}<//></div>`)}
      </div>` : null}
    </div>`;
  };

  return html`<${ViewFrame} tabId=${tabId} title="Würfel">
    <div class="page stack lg dice-page">
      <div class="dice-stage">
        <${DiceTray} roll=${current} onDone=${onDone} height=${250} hint="Würfel antippen – dann „Würfeln“" />
        <div class="dice-result">
          ${rolling ? html`<span class="rolling-note"><span class="spinner sm" />${diceSummary(current)} rollen …</span>`
            : current ? (statSets ? html`<div class="stack sm"><b>Attributswerte</b><div class="row" style="gap:6px">${statSets.map((v) => html`<span class="badge accent" style="font-size:16px;padding:4px 12px">${v} (${fmtMod(Math.floor((v - 10) / 2))})</span>`)}</div><span class="small muted">Summe ${statSets.reduce((a, b) => a + b, 0)} – frei auf die Attribute verteilen.</span></div>`
              : html`<${RollResult} r=${current} />`)
            : html`<span class="faint small">Tippe Würfel an, um sie in den Becher zu legen. Die Summe erscheint, sobald alle Würfel liegen.</span>`}
        </div>
      </div>

      <div class="row between">
        <${Segmented} value=${mode} onChange=${(v) => { setMode(v); localStorage.setItem('ws.diceMode', v); }} options=${[{ value: 'pool', label: 'Würfelbecher', icon: 'layers' }, { value: 'instant', label: 'Sofort werfen', icon: 'zap' }]} />
        <div class="row nowrap">
          <span class="small muted">Modifikator</span>
          <${IconBtn} icon="minus" title="−1" onClick=${() => setMod(mod - 1)} />
          <b style="min-width:32px;text-align:center">${fmtMod(mod)}</b>
          <${IconBtn} icon="plus" title="+1" onClick=${() => setMod(mod + 1)} />
        </div>
      </div>

      <div class="dice-picker">
        ${DICE.map((d) => html`<button type="button" class=${`die-pick${pool[d] ? ' has' : ''}`} disabled=${rolling} onClick=${() => tapDie(d)} onContextMenu=${(e) => dropDie(e, d)} title=${mode === 'pool' ? `W${d} hinzufügen (Rechtsklick: entfernen)` : `W${d} werfen`}>
          <${DieIcon} sides=${d} size=${46} />
          <span class="nm">W${d}</span>
          ${pool[d] ? html`<span class="cnt">×${pool[d]}</span>` : null}
          ${pool[d] ? html`<span class="minus" role="button" title="Einen entfernen" onClick=${(e) => dropDie(e, d)}>−</span>` : null}
        </button>`)}
      </div>

      ${mode === 'pool' ? html`<div class="pool-bar">
        <div class="grow"><b>${pe ? Object.entries(pool).filter(([, n]) => n).sort((a, b) => b[0] - a[0]).map(([s, n]) => `${n}× W${s}`).join(' + ') + (mod ? ` ${fmtMod(mod)}` : '') : 'Becher leer'}</b>
          <div class="tiny faint mono">${pe || 'Würfel oben antippen'}</div></div>
        <${Btn} kind="ghost" disabled=${!pe || rolling} onClick=${() => setPool({})}>Leeren<//>
        <${Btn} kind="primary" size="lg" icon="d20" disabled=${!pe || rolling} onClick=${rollPool}>${rolling ? 'Rollt …' : 'Würfeln'}<//>
      </div>` : null}

      <div class="card stack sm">
        <div class="row"><b class="grow"><${Icon} name="sparkles" size=${16} /> Effekte auf den Wurf</b>
          <label class="small muted row nowrap" style="gap:6px">Würfeln als
            <${Select} class="sm" value=${charId} onChange=${setCharId} options=${[{ value: '', label: '– frei –' }, ...(chars || []).map((c) => ({ value: c.id, label: c.name }))]} style="width:180px" />
          </label>
        </div>
        <div class="small muted">W20-Würfe (Proben, Angriffe, Rettungswürfe)</div>
        <div class="chips">
          ${D20_FX.map(chip)}
          <select class="chip fx-select" value=${bardic} onChange=${(e) => setBardic(e.target.value)} title="Bardische Inspiration">
            <option value="">Bardische Inspiration …</option>${['d6', 'd8', 'd10', 'd12'].map((d) => html`<option value=${d}>+W${d.slice(1)} Inspiration</option>`)}
          </select>
          <span class="chip fx-ex">Erschöpfung
            <button type="button" onClick=${() => setExhaustion(Math.max(0, exhaustion - 1))}>−</button><b>${exhaustion}</b><button type="button" onClick=${() => setExhaustion(Math.min(6, exhaustion + 1))}>+</button>
          </span>
        </div>
        <div class="small muted" style="margin-top:4px">Schaden</div>
        <div class="chips">${DMG_FX.map(chip)}</div>
        <div class="tiny faint">Regelstand ${edition} (Einstellungen → Spiel). ${char ? 'Mit 👤 markierte Effekte kommen von deinem Charakter.' : ''} Einmal-Effekte (Glückspunkt, Kritisch, Wilder Angreifer, Segen …) werden nach dem Wurf zurückgesetzt.</div>
      </div>

      ${charPanel()}

      <div class="btn-row">
        <${Btn} icon="d20" disabled=${rolling} onClick=${() => go(`1d20${mod ? fmtMod(mod).replace('−', '-') : ''}`, { label: 'W20', kind: 'd20' })}>W20${mod ? ` ${fmtMod(mod)}` : ''}<//>
        <${Btn} icon="skull" disabled=${rolling} onClick=${() => go('1d20', { label: 'Todesrettungswurf', kind: 'save' })}>Todesrettung<//>
        <${Btn} icon="dices" disabled=${rolling} onClick=${rollStats}>Attribute auswürfeln (6 × 4W6)<//>
      </div>

      <form class="input-group" onSubmit=${(e) => { e.preventDefault(); if (expr.trim()) go(expr.trim(), { label: expr.trim() }); }}>
        <input class="input mono" value=${expr} onInput=${(e) => setExpr(e.target.value)} placeholder="Ausdruck, z. B. 2d6+3 · 4d6dl1 · d20+5 vorteil · 3W8" />
        <${Btn} kind="primary" type="submit" icon="d20" disabled=${rolling}>Würfeln<//>
      </form>
      <div class="chips">${['2d6+3', '4d6dl1', 'd20+5 vorteil', '8d6', '1d100', '3d6!'].map((x) => html`<button type="button" class="chip suggest" disabled=${rolling} onClick=${() => { setExpr(x); go(x, { label: x }); }}>${x}</button>`)}</div>

      ${cloud ? html`<div class="card row">
        <${Toggle} checked=${share} onChange=${(v) => updateSettings({ shareRolls: v })} label="Würfe am Spieltisch zeigen" />
        <${Toggle} checked=${secret} onChange=${setSecret} label=${role !== 'gm' ? 'Geheim – nur die SL sieht es' : 'Verdeckt würfeln (nicht teilen)'} />
      </div>` : null}

      <div class="card">
        <div class="card-head"><h3><${Icon} name="star" size=${18} />Makros</h3><span class="grow"></span><${Btn} size="sm" icon="plus" onClick=${addMacro}>Speichern<//></div>
        <div class="btn-row">${macros.map((m, i) => html`<span class="chip">
          <button type="button" style="font-weight:600" disabled=${rolling} onClick=${() => go(m.expr, { label: m.label })}>${m.label}</button><span class="faint mono">${m.expr}</span>
          <span class="x" onClick=${() => updateSettings({ diceMacros: macros.filter((_, j) => j !== i) })}><${Icon} name="x" size=${12} /></span>
        </span>`)}</div>
      </div>

      <div class="card">
        <div class="card-head"><h3><${Icon} name="clock" size=${18} />Verlauf</h3><span class="grow"></span>${log.length ? html`<${Btn} size="sm" kind="ghost" onClick=${clearRollLog}>Leeren<//>` : null}</div>
        ${log.length ? log.slice(0, 40).map((r) => html`<div class="roll-log-item">
          <span class=${`n${r.crit ? ' success-text' : r.fumble ? ' danger-text' : ''}`}>${r.total}</span>
          <span class="small"><b>${r.label || r.input}</b>${r.character ? html` <span class="faint">· ${r.character}</span>` : null}<br /><span class="mono faint">${String(r.text).replace(/~(-?\d+)~/g, '($1)')}</span></span>
          <span class="tiny faint">${fmtTime(r.ts)}</span>
        </div>`) : html`<div class="faint small">Noch keine Würfe.</div>`}
      </div>
    </div>
  <//>`;
}
