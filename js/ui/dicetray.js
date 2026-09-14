// Würfelschale: Die Würfel rollen von der Seite herein, prallen ab und kommen zur Ruhe – erst dann steht
// die Summe fest. Wird in der Würfel-Ansicht eingebettet und als schwebende Schale für alle anderen Würfe genutzt.
import { html, useEffect, useRef } from '../lib/preact.js';
import { createStore, useStore } from '../core/store.js';
import { settings } from '../core/settings.js';
import { rollBridge } from '../core/rolls.js';
import { toast, Icon } from './components.js';
import { esc } from '../lib/util.js';

const COLORS = {
  4: ['#35d0d2', '#0c5f64'], 6: ['#f0666b', '#7d151c'], 8: ['#48d993', '#0f5c38'], 10: ['#ffa24d', '#8a3f02'],
  12: ['#5b97ff', '#173a86'], 20: ['#9c72ff', '#35178a'], 100: ['#e8bc55', '#6e500d'], F: ['#a3a3a3', '#3d3d3d'],
};
const BONUS = ['#ffd45c', '#8a6a00'];

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

const animOn = () => settings.get().diceAnim !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches;
const shapeKey = (s) => (s === 'F' ? 6 : s === 100 ? 10 : SHAPES[s] ? s : s <= 4 ? 4 : s <= 6 ? 6 : s <= 8 ? 8 : s <= 10 ? 10 : s <= 12 ? 12 : 20);
const face = (v) => (v === 6 || v === 9 ? `${v}.` : String(v));

// d100 wird als Zehner- und Einer-W10 gezeigt
function expand(dice) {
  const out = [];
  for (const d of dice || []) {
    if (d.sides === 100) {
      const v = d.value;
      const tens = v === 100 ? '00' : String(Math.floor(v / 10) * 10).padStart(2, '0');
      out.push({ ...d, shape: 10, color: 100, final: tens, rand: () => `${Math.floor(Math.random() * 10)}0` });
      out.push({ ...d, shape: 10, color: 100, final: String(v % 10), rand: () => String(Math.floor(Math.random() * 10)) });
    } else if (d.sides === 'F') {
      const sym = d.value > 0 ? '+' : d.value < 0 ? '−' : '';
      out.push({ ...d, shape: 6, color: 'F', final: sym, rand: () => ['+', '−', ''][Math.floor(Math.random() * 3)] });
    } else {
      out.push({ ...d, shape: shapeKey(d.sides), color: COLORS[d.sides] ? d.sides : shapeKey(d.sides), final: face(d.value), rand: () => face(1 + Math.floor(Math.random() * d.sides)) });
    }
  }
  return out;
}

let gid = 0;
function dieSvg(d) {
  const sh = SHAPES[d.shape];
  const [c1, c2] = d.bonus ? BONUS : COLORS[d.color] || COLORS[20];
  const id = `dg${++gid}`;
  const fs = String(d.final).length > 2 ? sh.fs * 0.8 : sh.fs;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
    + `<g class="body" fill="url(#${id})" stroke="${c2}" stroke-width="3" stroke-linejoin="round">${sh.body}</g>`
    + `<g class="facet">${sh.facet}</g>`
    + `<text x="50" y="${sh.ty}" font-size="${fs}">${esc(d.final)}</text></svg>`;
}

// Physik: einfache 2D-Simulation mit Reibung, Wandabprall und Stößen zwischen Würfeln
function animate(stage, roll, onDone) {
  stage.textContent = '';
  const list = expand(roll.dice).slice(0, 40);
  if (!list.length) {
    onDone?.();
    return () => {};
  }
  const W = stage.clientWidth || 320;
  const H = stage.clientHeight || 200;
  const n = list.length;
  const S = Math.round(Math.max(30, Math.min(72, Math.min(W / (1.6 + n * 0.62), H / 1.9, (W * H) ** 0.5 / (1.2 + Math.sqrt(n) * 1.15)))));
  const bodies = list.map((d, i) => {
    const el = document.createElement('div');
    el.className = `die${d.bonus ? ' bonus' : ''}`;
    el.style.width = el.style.height = `${S}px`;
    el.innerHTML = dieSvg({ ...d, final: d.rand() });
    stage.appendChild(el);
    const speed = (0.85 + Math.random() * 0.55) * Math.max(560, W * 1.45);
    return {
      d, el, txt: el.querySelector('text'),
      x: -S - Math.random() * 30, y: Math.random() * Math.max(1, H - S),
      vx: speed, vy: (Math.random() - 0.5) * 560, a: Math.random() * 360, va: (Math.random() < 0.5 ? -1 : 1) * (560 + Math.random() * 700),
      start: i * 70, entered: false, done: false, flip: 0,
    };
  });
  const place = (b) => { b.el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px) rotate(${b.a.toFixed(1)}deg)`; };
  const settle = (b) => {
    b.done = true;
    b.vx = 0;
    b.vy = 0;
    b.a = ((b.a % 360) + 360) % 360;
    const near = Math.round(b.a / 90) * 90;
    b.a = near + (b.a - near) * 0.25;
    b.txt.textContent = b.d.final;
    b.el.classList.add('settled');
    if (b.d.dropped) b.el.classList.add('dropped');
    if (b.d.main && !b.d.dropped && b.d.value === 20) b.el.classList.add('nat20');
    if (b.d.main && !b.d.dropped && b.d.value === 1) b.el.classList.add('nat1');
    const tag = b.d.adj != null ? `→${b.d.adj}` : b.d.note === 'Glück' ? '↻' : b.d.from ? '↻' : b.d.exploded ? '!' : '';
    if (tag) {
      const t = document.createElement('span');
      t.className = 'die-tag';
      t.textContent = tag;
      b.el.appendChild(t);
    }
    place(b);
  };

  if (!animOn()) {
    const cols = Math.max(1, Math.floor(W / (S * 1.15)));
    bodies.forEach((b, i) => {
      b.x = 10 + (i % cols) * S * 1.15;
      b.y = 10 + Math.floor(i / cols) * S * 1.15;
      b.a = 0;
      settle(b);
    });
    onDone?.();
    return () => {};
  }

  bodies.forEach(place);
  let last = performance.now();
  const t0 = last;
  let raf = 0;
  let stopped = false;
  const step = (now) => {
    if (stopped) return;
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const t = now - t0;
    let active = 0;
    for (const b of bodies) {
      if (b.done) continue;
      active++;
      if (t < b.start) continue;
      const age = (t - b.start) / 1000;
      const drag = age > 1.25 ? 5.2 : 1.55;
      const k = Math.max(0, 1 - drag * dt);
      b.vx *= k;
      b.vy *= k;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x > 2) b.entered = true;
      if (b.x > W - S) { b.x = W - S; b.vx = -Math.abs(b.vx) * 0.55; b.va *= -0.75; }
      if (b.entered && b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx) * 0.55; }
      if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy) * 0.6; }
      if (b.y > H - S) { b.y = H - S; b.vy = -Math.abs(b.vy) * 0.6; }
      b.va *= Math.max(0, 1 - (drag + 0.7) * dt);
      b.a += b.va * dt;
      const sp = Math.hypot(b.vx, b.vy);
      b.flip -= dt * 1000;
      if (sp > 60 && b.flip <= 0) {
        b.txt.textContent = b.d.rand();
        b.flip = 45 + 900 / (sp / 50 + 1);
      }
      if ((b.entered && sp < 20 && Math.abs(b.va) < 45) || age > 2.8) settle(b);
      else place(b);
    }
    // Stöße zwischen Würfeln (ruhende Würfel sind feste Hindernisse)
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (t < a.start) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (t < b.start || (a.done && b.done)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const min = S * 0.9;
        if (dist >= min) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const push = min - dist;
        if (a.done) { b.x += nx * push; b.y += ny * push; } else if (b.done) { a.x -= nx * push; a.y -= ny * push; } else {
          a.x -= nx * push / 2; a.y -= ny * push / 2; b.x += nx * push / 2; b.y += ny * push / 2;
        }
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = -rel * 0.8;
          if (!a.done) { a.vx -= nx * imp / (b.done ? 1 : 2); a.vy -= ny * imp / (b.done ? 1 : 2); }
          if (!b.done) { b.vx += nx * imp / (a.done ? 1 : 2); b.vy += ny * imp / (a.done ? 1 : 2); }
        }
        if (!a.done) place(a);
        if (!b.done) place(b);
      }
    }
    if (active) raf = requestAnimationFrame(step);
    else onDone?.();
  };
  raf = requestAnimationFrame(step);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

// Kleines Würfelsymbol in der Form des echten Würfels (für Knöpfe)
export function DieIcon({ sides, size = 40, label }) {
  const d = { shape: shapeKey(sides), color: COLORS[sides] ? sides : shapeKey(sides), final: label ?? (sides === 100 ? '%' : String(sides)) };
  return html`<span class="die-icon" style=${{ width: `${size}px`, height: `${size}px` }} dangerouslySetInnerHTML=${{ __html: dieSvg(d) }} />`;
}

export function DiceTray({ roll, onDone, height = 220, hint = 'Würfel antippen und werfen', class: cls = '' }) {
  const ref = useRef();
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!roll || !ref.current) return undefined;
    let fired = false;
    return animate(ref.current, roll, () => {
      if (fired) return;
      fired = true;
      done.current?.(roll);
    });
  }, [roll?.ts]);
  return html`<div ref=${ref} class=${`dice-tray ${cls}`} data-hint=${hint} style=${{ height: `${height}px` }}></div>`;
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

// ───────── schwebende Schale für Würfe aus Bogen, Notizen, Kampf … ─────────
export const tray = createStore({ current: null, queue: [], phase: 'idle' });

export function showRollAnimated(r) {
  const s = tray.get();
  if (s.current) tray.set({ queue: [...s.queue, r].slice(-4) });
  else tray.set({ current: r, phase: 'rolling' });
}

function nextInQueue() {
  const [n, ...rest] = tray.get().queue;
  tray.set({ current: n || null, queue: rest, phase: n ? 'rolling' : 'idle' });
}

rollBridge.show = (r) => {
  if (animOn() && r?.dice?.length) showRollAnimated(r);
  else toast(null, 'roll', { roll: r });
};

export function DiceOverlay() {
  const s = useStore(tray);
  const r = s.current;
  useEffect(() => {
    if (s.phase !== 'result') return undefined;
    const t = setTimeout(nextInQueue, s.queue.length ? 1400 : 3200);
    return () => clearTimeout(t);
  }, [s.phase, r?.ts]);
  if (!r) return null;
  return html`<div class=${`dice-overlay ${s.phase}`} onClick=${() => s.phase === 'result' && nextInQueue()} title="Antippen zum Schließen">
    <${DiceTray} roll=${r} height=${140} onDone=${() => tray.set({ phase: 'result' })} />
    <div class="dice-overlay-res">${s.phase === 'result'
      ? html`<${RollResult} r=${r} compact />`
      : html`<span class="rolling-note"><span class="spinner sm" />${r.label ? `${r.label}: ` : ''}${diceSummary(r)} rollen …</span>`}</div>
  </div>`;
}
