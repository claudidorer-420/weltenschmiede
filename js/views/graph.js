// Graph-Ansicht wie in Obsidian: Kraftlayout auf Canvas, Zoom/Pan/Pinch, Farbgruppen, Filter, lokaler Graph.
import { html, useState, useEffect, useRef } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, vault, getIndex, isGM, createNote } from '../core/app.js';
import { openNote, openSearch } from '../core/workspace.js';
import { settings, updateSettings, DEFAULT_GRAPH_GROUPS } from '../core/settings.js';
import { groupColor } from '../core/groups.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, IconBtn, Btn, Toggle } from '../ui/components.js';

const cssVar = (name, fb) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;

function buildData({ local, depth = 1, gs }) {
  const idx = getIndex();
  const nodes = new Map();
  const links = [];
  for (const n of idx.notes) nodes.set(n.id, { id: n.id, label: n.title, kind: 'note', note: n });
  for (const [s, ts] of idx.outLinks) for (const t of ts) if (nodes.has(s) && nodes.has(t)) links.push([s, t]);
  if (gs.showUnresolved) {
    for (const [title, srcs] of idx.unresolved) {
      const id = `u:${title.toLowerCase()}`;
      if (!nodes.has(id)) nodes.set(id, { id, label: title, kind: 'unresolved' });
      for (const s of srcs) if (nodes.has(s)) links.push([s, id]);
    }
  }
  if (gs.showTags) {
    for (const [tag, ids] of idx.tags) {
      const id = `t:${tag}`;
      nodes.set(id, { id, label: `#${tag}`, kind: 'tag' });
      for (const s of ids) if (nodes.has(s)) links.push([s, id]);
    }
  }
  const adj = new Map();
  for (const id of nodes.keys()) adj.set(id, new Set());
  for (const [s, t] of links) {
    adj.get(s).add(t);
    adj.get(t).add(s);
  }
  let keep = null;
  if (local) {
    keep = new Set([local]);
    let frontier = [local];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const id of frontier) for (const nb of adj.get(id) || []) if (!keep.has(nb)) { keep.add(nb); next.push(nb); }
      frontier = next;
    }
  } else if (!gs.showOrphans) {
    keep = new Set([...nodes.keys()].filter((id) => adj.get(id).size > 0));
  }
  const list = [...nodes.values()].filter((n) => !keep || keep.has(n.id));
  const ids = new Set(list.map((n) => n.id));
  const L = links.filter(([s, t]) => ids.has(s) && ids.has(t));
  const deg = new Map();
  for (const [s, t] of L) {
    deg.set(s, (deg.get(s) || 0) + 1);
    deg.set(t, (deg.get(t) || 0) + 1);
  }
  for (const n of list) n.deg = deg.get(n.id) || 0;
  const adjK = new Map();
  for (const n of list) adjK.set(n.id, new Set([...adj.get(n.id)].filter((x) => ids.has(x))));
  return { nodes: list, links: L, adj: adjK };
}

function GraphCanvas({ active, focus, local, depth = 1, compact = false, query = '' }) {
  const wrapRef = useRef();
  const canvasRef = useRef();
  const S = useRef(null);
  if (!S.current) {
    S.current = { nodes: [], byId: new Map(), links: [], adj: new Map(), t: { x: 0, y: 0, k: 1 }, alpha: 1, hover: null, drag: null, pan: null, pinch: null, pointers: new Map(), w: 0, h: 0, fitted: false, dirty: true, colors: {} };
  }
  const version = useStore(vault, (s) => s.version);
  const gs = useStore(settings, (s) => s.graph);
  const theme = useStore(settings, (s) => `${s.theme}${s.accent}`);
  const lens = useStore(app, (s) => `${s.role}:${s.viewAsPlayer}`);
  const [count, setCount] = useState(0);

  // Farben aus dem Theme
  useEffect(() => {
    const s = S.current;
    s.colors = {
      node: cssVar('--text-2', '#aaa'), faint: cssVar('--text-3', '#666'), line: cssVar('--border-2', '#444'),
      text: cssVar('--text-2', '#bbb'), strong: cssVar('--text', '#eee'), accent: cssVar('--accent', '#8a5cf5'), tag: '#4cc38a', bg: cssVar('--bg', '#111'),
    };
    s.dirty = true;
  }, [theme]);

  // Graphdaten (Positionen bleiben erhalten)
  useEffect(() => {
    const s = S.current;
    const data = buildData({ local, depth, gs });
    const old = s.byId;
    const byId = new Map();
    const fresh = [];
    for (const n of data.nodes) {
      const prev = old.get(n.id);
      const node = prev ? Object.assign(prev, { label: n.label, kind: n.kind, note: n.note, deg: n.deg }) : { ...n, x: 0, y: 0, vx: 0, vy: 0 };
      node.color = n.kind === 'note' ? groupColor(n.note, gs.groups) : n.kind === 'tag' ? s.colors.tag || '#4cc38a' : null;
      byId.set(n.id, node);
      if (!prev) fresh.push(node);
    }
    for (const node of fresh) {
      const nb = [...(data.adj.get(node.id) || [])].map((id) => byId.get(id)).find((x) => x && !fresh.includes(x));
      const a = Math.random() * Math.PI * 2;
      const r = nb ? 30 + Math.random() * 30 : Math.sqrt(data.nodes.length) * 18 * Math.random();
      node.x = (nb?.x || 0) + Math.cos(a) * r;
      node.y = (nb?.y || 0) + Math.sin(a) * r;
    }
    s.nodes = [...byId.values()];
    s.byId = byId;
    s.adj = data.adj;
    s.links = data.links.map(([a, b]) => ({ a: byId.get(a), b: byId.get(b) })).filter((l) => l.a && l.b);
    s.alpha = Math.max(s.alpha, fresh.length ? 1 : 0.4);
    if (fresh.length > 5) {
      for (let i = 0; i < 220; i++) step(s, gs, true);
      s.fitted = false;
    }
    s.focus = local || focus || null;
    s.dirty = true;
    setCount(s.nodes.length);
  }, [version, gs.showOrphans, gs.showUnresolved, gs.showTags, gs.groups, lens, local, depth]);

  useEffect(() => {
    S.current.focus = local || focus || null;
    S.current.dirty = true;
  }, [focus]);
  useEffect(() => {
    S.current.query = query.toLowerCase();
    S.current.dirty = true;
  }, [query]);
  useEffect(() => {
    S.current.dirty = true;
    S.current.alpha = Math.max(S.current.alpha, 0.3);
  }, [gs.repel, gs.linkDistance, gs.centerForce, gs.nodeSize, gs.linkWidth, gs.textFade]);

  // Größe
  useEffect(() => {
    const el = wrapRef.current;
    const cv = canvasRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      const s = S.current;
      s.w = r.width;
      s.h = r.height;
      s.dpr = dpr;
      if (!s.fitted) fit(s);
      s.dirty = true;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Animationsschleife
  useEffect(() => {
    if (!active) return undefined;
    let raf;
    const loop = () => {
      const s = S.current;
      const moved = step(s, settings.get().graph, false);
      if (!s.fitted && s.w > 10) fit(s);
      if (moved || s.dirty) {
        draw(s, canvasRef.current, settings.get().graph, compact);
        s.dirty = false;
      }
      raf = requestAnimationFrame(loop);
    };
    S.current.dirty = true;
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, compact]);

  // Eingabe
  useEffect(() => {
    const cv = canvasRef.current;
    const s = S.current;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const hit = (x, y) => {
      let best = null;
      let bd = Infinity;
      const k = s.t.k;
      for (const n of s.nodes) {
        const sx = n.x * k + s.t.x;
        const sy = n.y * k + s.t.y;
        const r = nodeRadius(n, settings.get().graph) * rScale(k) + 7;
        const d = (sx - x) ** 2 + (sy - y) ** 2;
        if (d < r * r && d < bd) { bd = d; best = n; }
      }
      return best;
    };
    const zoomAt = (x, y, f) => {
      const k = Math.min(6, Math.max(0.08, s.t.k * f));
      const real = k / s.t.k;
      s.t.x = x - (x - s.t.x) * real;
      s.t.y = y - (y - s.t.y) * real;
      s.t.k = k;
      s.dirty = true;
    };
    const down = (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e);
      s.pointers.set(e.pointerId, p);
      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        s.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: s.t.k };
        if (s.drag) s.drag.n.fixed = false;
        s.drag = null;
        s.pan = null;
        return;
      }
      const n = hit(p.x, p.y);
      if (n) {
        s.drag = { n, sx: p.x, sy: p.y, moved: false, ev: e };
        n.fixed = true;
      } else s.pan = { sx: p.x, sy: p.y, tx: s.t.x, ty: s.t.y, moved: false };
      cv.classList.add('dragging');
    };
    const move = (e) => {
      const p = pos(e);
      if (s.pointers.has(e.pointerId)) s.pointers.set(e.pointerId, p);
      if (s.pinch && s.pointers.size >= 2) {
        const [a, b] = [...s.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        zoomAt(mid.x, mid.y, (s.pinch.k * (d / s.pinch.d)) / s.t.k);
        return;
      }
      if (s.drag) {
        if (Math.hypot(p.x - s.drag.sx, p.y - s.drag.sy) > 4) s.drag.moved = true;
        if (s.drag.moved) {
          s.drag.n.x = (p.x - s.t.x) / s.t.k;
          s.drag.n.y = (p.y - s.t.y) / s.t.k;
          s.alpha = Math.max(s.alpha, 0.25);
          s.dirty = true;
        }
        return;
      }
      if (s.pan) {
        const dx = p.x - s.pan.sx;
        const dy = p.y - s.pan.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) s.pan.moved = true;
        s.t.x = s.pan.tx + dx;
        s.t.y = s.pan.ty + dy;
        s.dirty = true;
        return;
      }
      if (e.pointerType === 'mouse') {
        const h = hit(p.x, p.y);
        if (h !== s.hover) {
          s.hover = h;
          cv.style.cursor = h ? 'pointer' : 'grab';
          s.dirty = true;
        }
      }
    };
    const up = (e) => {
      s.pointers.delete(e.pointerId);
      cv.classList.remove('dragging');
      if (s.pinch) {
        if (s.pointers.size < 2) s.pinch = null;
        return;
      }
      if (s.drag) {
        const { n, moved } = s.drag;
        n.fixed = false;
        s.drag = null;
        if (!moved) activate(n, e);
        return;
      }
      if (s.pan) {
        if (!s.pan.moved && e.pointerType !== 'mouse') { s.hover = null; s.dirty = true; }
        s.pan = null;
      }
    };
    const activate = async (n, e) => {
      const newTab = e.ctrlKey || e.metaKey;
      if (n.kind === 'note') openNote(n.id, { newTab });
      else if (n.kind === 'tag') openSearch(`tag:${n.label}`);
      else if (n.kind === 'unresolved' && isGM()) {
        const created = await createNote({ title: n.label });
        openNote(created.id, { newTab });
      }
    };
    const wheel = (e) => {
      e.preventDefault();
      const p = pos(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    const dbl = (e) => {
      const p = pos(e);
      if (!hit(p.x, p.y)) {
        fit(s);
        s.dirty = true;
      }
    };
    const leave = () => { s.hover = null; s.dirty = true; };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('dblclick', dbl);
    cv.addEventListener('pointerleave', leave);
    return () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('wheel', wheel);
      cv.removeEventListener('dblclick', dbl);
      cv.removeEventListener('pointerleave', leave);
    };
  }, []);

  const reheat = () => {
    S.current.alpha = 1;
    S.current.fitted = false;
  };
  return html`<div class="graph-wrap" ref=${wrapRef}>
    <canvas ref=${canvasRef}></canvas>
    ${!count ? html`<div class="empty" style="position:absolute;inset:0;justify-content:center;pointer-events:none"><${Icon} name="graph" size=${40} /><p>Noch keine verknüpften Notizen. Verlinke Notizen mit [[…]], dann entsteht hier dein Netz.</p></div>` : null}
    ${!compact ? html`<div class="graph-hint">${count} Knoten · Mausrad/Pinch zoomt · Doppelklick zentriert</div>` : null}
    ${compact ? html`<div style="position:absolute;right:6px;top:6px"><${IconBtn} icon="maximize" size=${15} class="sm" title="Zentrieren" onClick=${() => { fit(S.current); S.current.dirty = true; }} /></div>` : html`<div style="position:absolute;left:10px;bottom:10px"><${Btn} size="sm" icon="refresh" onClick=${reheat}>Neu anordnen<//></div>`}
  </div>`;
}

function rScale(k) {
  return Math.max(0.6, Math.min(1.7, k));
}
function nodeRadius(n, gs) {
  return (3.2 + Math.sqrt(n.deg || 0) * 1.7) * (gs.nodeSize || 1);
}

function fit(s) {
  if (!s.nodes.length || s.w < 10) return;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const n of s.nodes) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
  }
  const bw = Math.max(60, x1 - x0);
  const bh = Math.max(60, y1 - y0);
  const k = Math.min(2.2, Math.max(0.12, Math.min((s.w - 70) / bw, (s.h - 70) / bh)));
  s.t.k = k;
  s.t.x = s.w / 2 - ((x0 + x1) / 2) * k;
  s.t.y = s.h / 2 - ((y0 + y1) / 2) * k;
  s.fitted = true;
}

function step(s, gs, warm) {
  if (s.alpha < 0.004 && !s.drag) return false;
  const nodes = s.nodes;
  const n = nodes.length;
  const alpha = s.alpha;
  const repel = 700 * (gs.repel || 1);
  const dist = 70 * (gs.linkDistance || 1);
  const center = 0.015 * (gs.centerForce || 1);
  const cutoff = 600 * 600;
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > cutoff) continue;
      if (d2 < 0.01) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      const f = (repel * alpha) / Math.max(d2, 30);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx -= fx; a.vy -= fy;
      b.vx += fx; b.vy += fy;
    }
  }
  for (const l of s.links) {
    const a = l.a;
    const b = l.b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const w = 1 / Math.min(a.deg || 1, b.deg || 1);
    const k = ((d - dist) / d) * 0.12 * alpha * Math.max(0.25, w);
    a.vx += dx * k; a.vy += dy * k;
    b.vx -= dx * k; b.vy -= dy * k;
  }
  for (const a of nodes) {
    a.vx -= a.x * center * alpha;
    a.vy -= a.y * center * alpha;
    if (a.fixed) { a.vx = 0; a.vy = 0; continue; }
    a.vx *= 0.55;
    a.vy *= 0.55;
    a.x += Math.max(-40, Math.min(40, a.vx));
    a.y += Math.max(-40, Math.min(40, a.vy));
  }
  s.alpha *= warm ? 0.975 : 0.988;
  if (s.drag) s.alpha = Math.max(s.alpha, 0.12);
  return true;
}

function draw(s, cv, gs, compact) {
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = s.dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, s.w, s.h);
  const { x: tx, y: ty, k } = s.t;
  const C = s.colors;
  const hov = s.hover || (s.focus ? s.byId.get(s.focus) : null);
  const near = hov ? s.adj.get(hov.id) || new Set() : null;
  const q = s.query;
  const matches = (n) => !q || n.label.toLowerCase().includes(q);

  ctx.lineWidth = Math.max(0.4, 0.9 * (gs.linkWidth || 1) * Math.min(1.6, k));
  for (const l of s.links) {
    const hi = hov && (l.a === hov || l.b === hov);
    ctx.globalAlpha = hi ? 0.95 : hov ? 0.12 : q && !(matches(l.a) || matches(l.b)) ? 0.1 : 0.55;
    ctx.strokeStyle = hi ? C.accent : C.line;
    ctx.beginPath();
    ctx.moveTo(l.a.x * k + tx, l.a.y * k + ty);
    ctx.lineTo(l.b.x * k + tx, l.b.y * k + ty);
    ctx.stroke();
  }
  const rs = rScale(k);
  for (const n of s.nodes) {
    const x = n.x * k + tx;
    const y = n.y * k + ty;
    if (x < -40 || y < -40 || x > s.w + 40 || y > s.h + 40) continue;
    const important = n === hov || near?.has(n.id);
    const dim = (hov && !important) || (q && !matches(n));
    ctx.globalAlpha = dim ? 0.18 : 1;
    ctx.fillStyle = n.id === s.focus && !s.hover ? C.accent : n.color || (n.kind === 'unresolved' ? C.faint : C.node);
    ctx.beginPath();
    ctx.arc(x, y, nodeRadius(n, gs) * rs, 0, Math.PI * 2);
    ctx.fill();
    if (n === hov) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.accent;
      ctx.stroke();
    }
  }
  const fade = 0.85 * (gs.textFade || 1);
  const fs = Math.round(11.5 * Math.max(0.85, Math.min(1.35, k)));
  ctx.font = `${fs}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const n of s.nodes) {
    const important = n === hov || near?.has(n.id) || n.id === s.focus || (q && matches(n));
    const showAll = k >= fade || compact;
    if (!showAll && !important && !(k > fade * 0.6 && n.deg >= 6)) continue;
    const x = n.x * k + tx;
    const y = n.y * k + ty;
    if (x < -120 || y < -40 || x > s.w + 120 || y > s.h + 40) continue;
    const dim = (hov && !important) || (q && !matches(n));
    ctx.globalAlpha = dim ? 0.15 : important ? 1 : Math.min(1, 0.45 + (k - fade) * 1.5);
    ctx.fillStyle = important ? C.strong : C.text;
    const label = n.label.length > 42 ? `${n.label.slice(0, 40)}…` : n.label;
    ctx.fillText(label, x, y + nodeRadius(n, gs) * rs + 4);
  }
  ctx.globalAlpha = 1;
}

function GraphControls({ query, setQuery, onClose }) {
  const gs = useStore(settings, (s) => s.graph);
  const set = (patch) => updateSettings({ graph: patch });
  const setGroup = (i, patch) => set({ groups: gs.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  const slider = (label, key, min, max, stepV) => html`<div class="slider"><span>${label}</span><input type="range" min=${min} max=${max} step=${stepV} value=${gs[key] ?? 1} onInput=${(e) => set({ [key]: Number(e.target.value) })} /></div>`;
  return html`<div class="graph-panel">
    <div class="row between"><b>Einstellungen</b><${IconBtn} icon="x" size=${16} class="sm" onClick=${onClose} /></div>
    <h4>Filter</h4>
    <input class="input sm" placeholder="Knoten hervorheben …" value=${query} onInput=${(e) => setQuery(e.target.value)} />
    <div class="stack sm" style="margin-top:8px">
      <${Toggle} checked=${gs.showOrphans} onChange=${(v) => set({ showOrphans: v })} label="Waisen anzeigen" />
      <${Toggle} checked=${gs.showUnresolved} onChange=${(v) => set({ showUnresolved: v })} label="Nicht angelegte Links" />
      <${Toggle} checked=${gs.showTags} onChange=${(v) => set({ showTags: v })} label="Tags als Knoten" />
    </div>
    <h4>Gruppen (Farben)</h4>
    <div class="small faint">Titel-Text, <code>path:Ordner</code>, <code>tag:#x</code> oder <code>typ:npc</code></div>
    ${gs.groups.map((g, i) => html`<div class="group-row">
      <input type="color" value=${g.color} onInput=${(e) => setGroup(i, { color: e.target.value })} />
      <input class="input sm" value=${g.query} onInput=${(e) => setGroup(i, { query: e.target.value })} />
      <${IconBtn} icon="x" size=${14} class="sm" onClick=${() => set({ groups: gs.groups.filter((_, j) => j !== i) })} />
    </div>`)}
    <div class="row" style="margin-top:6px">
      <${Btn} size="sm" icon="plus" onClick=${() => set({ groups: [...gs.groups, { query: '', color: '#e0b24a' }] })}>Gruppe<//>
      <${Btn} size="sm" kind="ghost" onClick=${() => set({ groups: DEFAULT_GRAPH_GROUPS })}>Standard<//>
    </div>
    <h4>Darstellung</h4>
    ${slider('Knotengröße', 'nodeSize', 0.4, 2.5, 0.1)}
    ${slider('Linienstärke', 'linkWidth', 0.3, 3, 0.1)}
    ${slider('Text ab Zoom', 'textFade', 0.3, 2.5, 0.1)}
    <h4>Kräfte</h4>
    ${slider('Zentrierung', 'centerForce', 0, 3, 0.1)}
    ${slider('Abstoßung', 'repel', 0.2, 4, 0.1)}
    ${slider('Linkabstand', 'linkDistance', 0.3, 3, 0.1)}
  </div>`;
}

export function GraphView({ params, active, tabId }) {
  const [panel, setPanel] = useState(false);
  const [query, setQuery] = useState('');
  const groups = useStore(settings, (s) => s.graph.groups);
  return html`<${ViewFrame} tabId=${tabId} title="Graph-Ansicht" noScroll
    actions=${html`<${IconBtn} icon="settings" title="Graph-Einstellungen" active=${panel} onClick=${() => setPanel(!panel)} />`}>
    <${GraphCanvas} active=${active} focus=${params.focus} query=${query} />
    ${panel ? html`<${GraphControls} query=${query} setQuery=${setQuery} onClose=${() => setPanel(false)} />` : null}
    <div class="graph-legend" style="left:auto;right:10px;bottom:10px">${groups.filter((g) => g.query).slice(0, 10).map((g) => html`<span class="chip"><span class="pin-dot" style=${{ background: g.color, width: '10px', height: '10px', boxShadow: 'none' }}></span>${g.label || g.query.replace(/^\(|^path:|^tag:/, '')}</span>`)}</div>
  <//>`;
}

export function LocalGraph({ noteId }) {
  return html`<${GraphCanvas} active=${true} local=${noteId} depth=${1} compact=${true} />`;
}
