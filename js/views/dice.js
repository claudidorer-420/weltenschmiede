// Würfel: Sofortwurf oder Würfelpool, Ausdrücke (4d6dl1, d20 vorteil), Makros, Attributswürfe, Verlauf, Teilen am Tisch.
import { html, useState } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app } from '../core/app.js';
import { db } from '../core/db.js';
import { rolls, doRoll, clearRollLog } from '../core/rolls.js';
import { settings, updateSettings } from '../core/settings.js';
import { rollAbilityScores, modifier, fmtMod } from '../lib/dice.js';
import { fmtTime } from '../lib/util.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, IconBtn, Btn, Toggle, Segmented, promptDialog, toast } from '../ui/components.js';

const DICE = [4, 6, 8, 10, 12, 20, 100];
const DEFAULT_MACROS = [
  { label: 'Angriff', expr: '1d20+5' },
  { label: 'Langschwert', expr: '1d8+3' },
  { label: 'Feuerball', expr: '8d6' },
  { label: 'Heiltrank', expr: '2d4+2' },
];

export function DiceView({ tabId }) {
  const log = useStore(rolls, (s) => s.log);
  const macros = useStore(settings, (s) => s.diceMacros || DEFAULT_MACROS);
  const share = useStore(settings, (s) => s.shareRolls !== false);
  const cid = useStore(app, (s) => s.cid);
  const role = useStore(app, (s) => s.role);
  const cloud = db.mode === 'cloud' && !!cid;
  const [mode, setMode] = useState('instant');
  const [pool, setPool] = useState({});
  const [mod, setMod] = useState(0);
  const [expr, setExpr] = useState('');
  const [secret, setSecret] = useState(false);
  const [last, setLast] = useState(log[0] || null);
  const [stats, setStats] = useState(null);

  const run = (e, label = '') => {
    const r = doRoll(e, { label, secret: secret && cloud, share: cloud ? share : false, silent: true });
    if (r) setLast(r);
    return r;
  };
  const poolExpr = () => {
    const parts = Object.entries(pool).filter(([, c]) => c > 0).sort((a, b) => Number(b[0]) - Number(a[0])).map(([s, c]) => `${c}d${s}`);
    if (!parts.length) return '';
    return parts.join('+') + (mod ? (mod > 0 ? `+${mod}` : `${mod}`) : '');
  };
  const tapDie = (sides) => {
    if (mode === 'instant') run(`1d${sides}${mod ? (mod > 0 ? `+${mod}` : mod) : ''}`, `W${sides}`);
    else setPool({ ...pool, [sides]: (pool[sides] || 0) + 1 });
  };
  const rollPool = () => {
    const e = poolExpr();
    if (!e) return;
    run(e, 'Würfelpool');
    setPool({});
  };
  const addMacro = async () => {
    const e = expr.trim() || poolExpr();
    if (!e) return toast('Erst einen Ausdruck eingeben oder Würfel wählen.', 'error');
    const label = await promptDialog('Name des Makros', '', { title: 'Makro speichern', placeholder: 'z. B. Feuerball' });
    if (label) updateSettings({ diceMacros: [...macros, { label, expr: e }] });
  };
  const rollStats = () => {
    const s = rollAbilityScores().sort((a, b) => b - a);
    setStats(s);
  };
  const cls = last?.crit ? ' crit' : last?.fumble ? ' fumble' : '';

  return html`<${ViewFrame} tabId=${tabId} title="Würfel">
    <div class="page narrow stack lg">
      <div class="card big-result">
        ${last ? html`<div class=${`n${cls}`} key=${last.ts}>${last.total}</div>
          <div class="t">${last.label ? html`<b>${last.label}</b> · ` : null}<span dangerouslySetInnerHTML=${{ __html: String(last.text).replace(/[<>&]/g, '').replace(/~(\d+)~/g, '<s>$1</s>') }} /></div>
          ${last.crit ? html`<div class="success-text" style="margin-top:6px;font-weight:700">Natürliche 20!</div>` : last.fumble ? html`<div class="danger-text" style="margin-top:6px;font-weight:700">Patzer!</div>` : null}`
          : html`<div class="faint">Tippe einen Würfel an.</div>`}
      </div>

      <div class="row between">
        <${Segmented} value=${mode} onChange=${setMode} options=${[{ value: 'instant', label: 'Sofort würfeln', icon: 'zap' }, { value: 'pool', label: 'Würfelpool', icon: 'layers' }]} />
        <div class="row nowrap">
          <span class="small muted">Modifikator</span>
          <${IconBtn} icon="minus" title="−1" onClick=${() => setMod(mod - 1)} />
          <b style="min-width:32px;text-align:center">${fmtMod(mod)}</b>
          <${IconBtn} icon="plus" title="+1" onClick=${() => setMod(mod + 1)} />
        </div>
      </div>

      <div class="dice-grid">
        ${DICE.map((d) => html`<button type="button" class="die-btn" onClick=${() => tapDie(d)}>
          <${Icon} name="d20" size=${26} /><span>W${d}</span><span class="cnt">${pool[d] ? `×${pool[d]}` : ''}</span>
        </button>`)}
      </div>

      ${mode === 'pool' ? html`<div class="row"><div class="grow mono">${poolExpr() || 'Pool leer – Würfel antippen'}</div>
        <${Btn} kind="ghost" onClick=${() => setPool({})}>Leeren<//><${Btn} kind="primary" icon="d20" disabled=${!poolExpr()} onClick=${rollPool}>Würfeln<//></div>` : null}

      <div class="btn-row">
        <${Btn} icon="d20" onClick=${() => run(`1d20${mod ? fmtMod(mod).replace('−', '-') : ''}`, 'W20')}>W20<//>
        <${Btn} icon="arrow-up" onClick=${() => run(`d20${mod ? fmtMod(mod).replace('−', '-') : ''} vorteil`, 'Vorteil')}>Vorteil<//>
        <${Btn} icon="arrow-down" onClick=${() => run(`d20${mod ? fmtMod(mod).replace('−', '-') : ''} nachteil`, 'Nachteil')}>Nachteil<//>
        <${Btn} icon="skull" onClick=${() => run('1d20', 'Todesrettungswurf')}>Todesrettung<//>
      </div>

      <form class="input-group" onSubmit=${(e) => { e.preventDefault(); if (expr.trim()) run(expr.trim()); }}>
        <input class="input mono" value=${expr} onInput=${(e) => setExpr(e.target.value)} placeholder="Ausdruck, z. B. 2d6+3 · 4d6dl1 · d20+5 vorteil · 3W8" />
        <${Btn} kind="primary" type="submit" icon="d20">Würfeln<//>
      </form>
      <div class="chips">${['2d6+3', '4d6dl1', 'd20+5 vorteil', '8d6', '1d100', '3d6!'].map((x) => html`<button type="button" class="chip suggest" onClick=${() => { setExpr(x); run(x); }}>${x}</button>`)}</div>

      ${cloud ? html`<div class="card row">
        <${Toggle} checked=${share} onChange=${(v) => updateSettings({ shareRolls: v })} label="Würfe am Spieltisch zeigen" />
        ${role !== 'gm' ? html`<${Toggle} checked=${secret} onChange=${setSecret} label="Geheim – nur die SL sieht es" />` : html`<${Toggle} checked=${secret} onChange=${setSecret} label="Verdeckt würfeln (nicht teilen)" />`}
      </div>` : null}

      <div class="card">
        <div class="card-head"><h3><${Icon} name="star" size=${18} />Makros</h3><span class="grow"></span><${Btn} size="sm" icon="plus" onClick=${addMacro}>Speichern<//></div>
        <div class="btn-row">${macros.map((m, i) => html`<span class="chip">
          <button type="button" style="font-weight:600" onClick=${() => run(m.expr, m.label)}>${m.label}</button><span class="faint mono">${m.expr}</span>
          <span class="x" onClick=${() => updateSettings({ diceMacros: macros.filter((_, j) => j !== i) })}><${Icon} name="x" size=${12} /></span>
        </span>`)}</div>
      </div>

      <div class="card">
        <div class="card-head"><h3><${Icon} name="dices" size=${18} />Attribute auswürfeln</h3><span class="grow"></span><${Btn} size="sm" icon="refresh" onClick=${rollStats}>4W6 (niedrigsten streichen) ×6<//></div>
        ${stats ? html`<div class="row" style="gap:8px">${stats.map((v) => html`<span class="badge accent" style="font-size:15px;padding:4px 12px">${v} (${fmtMod(modifier(v))})</span>`)}
          <span class="muted small">Summe ${stats.reduce((a, b) => a + b, 0)} · Mods ${fmtMod(stats.reduce((a, b) => a + modifier(b), 0))}</span></div>` : html`<div class="faint small">Für neue Charaktere – das Ergebnis frei auf die Attribute verteilen.</div>`}
      </div>

      <div class="card">
        <div class="card-head"><h3><${Icon} name="clock" size=${18} />Verlauf</h3><span class="grow"></span>${log.length ? html`<${Btn} size="sm" kind="ghost" onClick=${clearRollLog}>Leeren<//>` : null}</div>
        ${log.length ? log.slice(0, 40).map((r) => html`<div class="roll-log-item">
          <span class=${`n${r.crit ? ' success-text' : r.fumble ? ' danger-text' : ''}`}>${r.total}</span>
          <span class="small"><b>${r.label || r.input}</b><br /><span class="mono faint">${r.text}</span></span>
          <span class="tiny faint">${fmtTime(r.ts)}</span>
        </div>`) : html`<div class="faint small">Noch keine Würfe.</div>`}
      </div>
    </div>
  <//>`;
}
