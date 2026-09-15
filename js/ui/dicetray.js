// Würfel: 3D-Würfel (ui/dice3d.js) – eingebettet in der Würfel-Ansicht und als Schicht über der ganzen App.
// Ergebnisse erscheinen als Karten unten links (Name, Art, Rechnung, großes Ergebnis) und verschwinden von selbst.
import { html, useEffect, useRef } from '../lib/preact.js';
import { createStore, useStore } from '../core/store.js';
import { settings } from '../core/settings.js';
import { rollBridge } from '../core/rolls.js';
import { Icon } from './components.js';
import { esc } from '../lib/util.js';
import { createDiceScene, DICE_COLORS } from './dice3d.js';

const animOn = () => settings.get().diceAnim !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Kleines Würfelsymbol für Knöpfe (flach, SVG) ──
const HEX = '50,3 91,26 91,74 50,97 9,74 9,26';
const SHAPES = {
  4: { body: '<polygon points="50,5 96,91 4,91"/>', facet: '<polyline points="50,5 50,91"/>', ty: 70, fs: 30 },
  6: { body: '<rect x="7" y="7" width="86" height="86" rx="17"/>', facet: '', ty: 52, fs: 42 },
  8: { body: '<polygon points="50,3 96,50 50,97 4,50"/>', facet: '<polyline points="4,50 96,50"/>', ty: 53, fs: 32 },
  10: { body: '<polygon points="50,3 95,40 50,97 5,40"/>', facet: '<polyline points="5,40 50,57 95,40"/><polyline points="50,57 50,97"/>', ty: 40, fs: 28 },
  12: { body: '<polygon points="50,4 95,37 78,91 22,91 5,37"/>', facet: '<polygon points="50,28 72,44 64,70 36,70 28,44"/>', ty: 54, fs: 28 },
  20: {
    body: `<polygon points="${HEX}"/>`,
    facet: '<polygon points="50,22 80,70 20,70"/><polyline points="50,3 50,22 9,26"/><polyline points="91,26 50,22"/><polyline points="9,74 20,70 50,97 80,70 91,74"/><polyline points="9,26 20,70"/><polyline points="91,26 80,70"/>',
    ty: 55, fs: 25,
  },
};
const shapeKey = (s) => (s === 'F' ? 6 : s === 100 ? 10 : SHAPES[s] ? s : s <= 4 ? 4 : s <= 6 ? 6 : s <= 8 ? 8 : s <= 10 ? 10 : s <= 12 ? 12 : 20);
let gid = 0;
function dieSvg(shape, color, label) {
  const sh = SHAPES[shape];
  const [c1, c2] = DICE_COLORS[color] || DICE_COLORS[20];
  const id = `dg${++gid}`;
  const fs = String(label).length > 2 ? sh.fs * 0.8 : sh.fs;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
    + `<g class="body" fill="url(#${id})" stroke="${c2}" stroke-width="3" stroke-linejoin="round">${sh.body}</g>`
    + `<g class="facet">${sh.facet}</g><text x="50" y="${sh.ty}" font-size="${fs}">${esc(label)}</text></svg>`;
}
export function DieIcon({ sides, size = 40, label }) {
  const k = shapeKey(sides);
  return html`<span class="die-icon" style=${{ width: `${size}px`, height: `${size}px` }} dangerouslySetInnerHTML=${{ __html: dieSvg(k, DICE_COLORS[sides] ? sides : k, label ?? (sides === 100 ? '%' : String(sides))) }} />`;
}

// ── Würfelschale in der Würfel-Ansicht ──
export function DiceTray({ roll, onDone, height = 220, hint = 'Würfel antippen und werfen', class: cls = '' }) {
  const ref = useRef();
  const scene = useRef(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    scene.current = createDiceScene(ref.current, { mode: 'tray' });
    return () => scene.current?.destroy();
  }, []);
  useEffect(() => {
    if (!roll || !scene.current) return;
    let fired = false;
    scene.current.clear();
    scene.current.throwRoll(roll, { persist: true, animate: animOn(), onDone: () => { if (fired) return; fired = true; done.current?.(roll); } });
  }, [roll?.ts]);
  return html`<div class=${`dice-tray ${cls}${roll ? '' : ' idle'}`} data-hint=${hint} style=${{ height: `${height}px` }}><canvas ref=${ref} class="dice-tray-cv"></canvas></div>`;
}

export function diceSummary(r) {
  const c = {};
  for (const d of r?.dice || []) {
    const k = d.sides === 'F' ? 'WF' : `W${d.sides}`;
    c[k] = (c[k] || 0) + 1;
  }
  return Object.entries(c).map(([k, n]) => `${n}× ${k}`).join(' · ');
}

export function RollResult({ r, compact }) {
  if (!r) return null;
  const cls = r.crit ? ' crit' : r.fumble ? ' fumble' : '';
  return html`<div class=${`roll-res${compact ? ' compact' : ''}`}>
    <div class=${`tot${cls}`} key=${r.ts}>${r.total}</div>
    <div class="det">
      <b>${r.label || r.input}${r.character ? html` <span class="faint">· ${r.character}</span>` : null}</b>
      ${r.crit ? html`<span class="success-text flag">Natürliche 20!</span>` : r.fumble ? html`<span class="danger-text flag">Natürliche 1 – Patzer!</span>` : null}
      <span class="txt" dangerouslySetInnerHTML=${{ __html: esc(r.text).replace(/~(-?\d+)~/g, '<s>$1</s>') }} />
      ${r.notes?.length ? html`<span class="notes">${r.notes.map((n) => html`<span><${Icon} name="sparkles" size=${11} />${n}</span>`)}</span>` : null}
    </div>
  </div>`;
}

// ── Schicht über der App: Würfel fliegen herein, Ergebnis als Karte unten links ──
export const tray = createStore({ cards: [] });
let overlay = null;
const waiting = [];
function pushCard(r) {
  if (!r) return;
  tray.set({ cards: [...tray.get().cards, { id: `${r.ts || Date.now()}-${Math.random().toString(36).slice(2, 7)}`, r, at: Date.now() }].slice(-5) });
}
const dropCard = (id) => tray.set({ cards: tray.get().cards.filter((c) => c.id !== id) });
export function showRollAnimated(r) {
  if (!r) return;
  if (!animOn() || !r.dice?.length) { pushCard(r); return; }
  if (!overlay) { waiting.push(r); return; }
  overlay.throwRoll(r, { onDone: () => pushCard(r) });
}
rollBridge.show = (r) => showRollAnimated(r);

const KIND = { attack: 'Angriff', damage: 'Schaden', check: 'Probe', save: 'Rettungswurf', init: 'Initiative', free: 'Wurf' };
const dText = (s) => String(s || '').replace(/(\d*)d(\d|%|F)/gi, '$1W$2');
function RollCard({ c }) {
  const r = c.r;
  const lab = String(r.label || '');
  const i = lab.indexOf(': ');
  const who = i > 0 ? lab.slice(0, i) : r.character || '';
  const what = i > 0 ? lab.slice(i + 2) : lab || dText(r.input);
  return html`<div class=${`roll-card${r.crit ? ' crit' : r.fumble ? ' fumble' : ''}`} onClick=${() => dropCard(c.id)} title="Antippen zum Schließen">
    <div class="rc-left">
      <span class="rc-what">${what}</span>
      <span class="rc-kind">${[KIND[r.kind], who].filter(Boolean).join(' · ') || 'Wurf'}${r.crit ? ' · Natürliche 20!' : r.fumble ? ' · Patzer' : ''}</span>
      <span class="rc-expr">${dText(r.input)}${r.text ? html` = <span dangerouslySetInnerHTML=${{ __html: esc(r.text).replace(/~(-?\d+)~/g, '<s>$1</s>') }} />` : null}</span>
      ${r.notes?.length ? html`<span class="rc-notes">${r.notes.slice(0, 3).join(' · ')}</span>` : null}
    </div>
    <b class="rc-total">${r.total}</b>
  </div>`;
}

export function DiceOverlay() {
  const ref = useRef();
  const cards = useStore(tray, (s) => s.cards);
  useEffect(() => {
    overlay = createDiceScene(ref.current, { mode: 'overlay' });
    for (const r of waiting.splice(0)) showRollAnimated(r);
    return () => { overlay?.destroy(); overlay = null; };
  }, []);
  useEffect(() => {
    if (!cards.length) return undefined;
    const t = setInterval(() => {
      const now = Date.now();
      const keep = tray.get().cards.filter((c) => now - c.at < 9000);
      if (keep.length !== tray.get().cards.length) tray.set({ cards: keep });
    }, 1000);
    return () => clearInterval(t);
  }, [cards.length > 0]);
  return html`<canvas ref=${ref} class="dice-layer" aria-hidden="true"></canvas>
    ${cards.length ? html`<div class="roll-cards">${cards.map((c) => html`<${RollCard} key=${c.id} c=${c} />`)}</div>` : null}`;
}
