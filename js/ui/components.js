// Gemeinsame UI-Bausteine: Icons, Buttons, Dialoge, Menüs, Toasts, Formularelemente, Markdown-Ansicht, Pickers.
import { html, useState, useEffect, useRef, useMemo, useLayoutEffect, useErrorBoundary } from '../lib/preact.js';
import { iconSvg } from '../lib/icons.js';
import { createStore, useStore } from '../core/store.js';
import { app, vault, bridge, isGM, getIndex, resolveTitle, createNote } from '../core/app.js';
import { openNote, openView, openSearch } from '../core/workspace.js';
import { renderMarkdown } from '../lib/markdown.js';
import { statblockHTML, parseStatblock } from './statblock.js';
import { fileUrl } from '../core/files.js';
import { doRoll, rollBridge } from '../core/rolls.js';
import { rollTableRange } from '../lib/dice.js';
import { fuzzyScore, esc, colorFromString, initials } from '../lib/util.js';
import { settings, updateSettings } from '../core/settings.js';
import { TASKS, PROVIDERS, resolveModel, modelLabel, modelsFor, recommendedRefs } from '../core/ai.js';

// ───────────────────────── Basis ─────────────────────────
export function Icon({ name, size = 18, class: cls = '' }) {
  return html`<span class=${`i ${cls}`} dangerouslySetInnerHTML=${{ __html: iconSvg(name, size) }} />`;
}

export function Btn({ icon, children, kind = '', size = '', class: cls = '', loading, disabled, type = 'button', iconSize, ...rest }) {
  const is = iconSize || (size === 'sm' ? 15 : size === 'lg' || size === 'xl' ? 19 : 17);
  return html`<button type=${type} class=${`btn ${kind} ${size} ${cls}`} disabled=${disabled || loading} ...${rest}>
    ${loading ? html`<span class="spinner sm" />` : icon ? html`<${Icon} name=${icon} size=${is} />` : null}
    ${children != null && children !== false ? html`<span>${children}</span>` : null}
  </button>`;
}

export function IconBtn({ icon, title, active, size = 18, class: cls = '', ...rest }) {
  return html`<button type="button" class=${`icon-btn ${active ? 'active' : ''} ${cls}`} title=${title} aria-label=${title} ...${rest}><${Icon} name=${icon} size=${size} /></button>`;
}

export function Spinner({ size = '' }) {
  return html`<span class=${`spinner ${size}`} />`;
}

export function Empty({ icon = 'sparkles', title, children, action }) {
  return html`<div class="empty"><${Icon} name=${icon} size=${42} />${title ? html`<h3>${title}</h3>` : null}${children ? html`<p>${children}</p>` : null}${action || null}</div>`;
}

export function Field({ label, hint, children, class: cls = '', style }) {
  return html`<div class=${`field ${cls}`} style=${style}>${label ? html`<label>${label}</label>` : null}${children}${hint ? html`<div class="hint">${hint}</div>` : null}</div>`;
}

export function Toggle({ checked, onChange, label, disabled, title }) {
  return html`<label class="switch" title=${title}><input type="checkbox" checked=${!!checked} disabled=${disabled} onChange=${(e) => onChange(e.target.checked)} /><span class="track"></span>${label ? html`<span>${label}</span>` : null}</label>`;
}

export function Check({ checked, onChange, label }) {
  return html`<label class="check"><input type="checkbox" checked=${!!checked} onChange=${(e) => onChange(e.target.checked)} />${label}</label>`;
}

export function Segmented({ value, onChange, options, full }) {
  return html`<div class=${`segmented${full ? ' full' : ''}`}>${options.map((o) => {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    return html`<button type="button" class=${value === opt.value ? 'active' : ''} title=${opt.title} onClick=${() => onChange(opt.value)}>${opt.icon ? html`<${Icon} name=${opt.icon} size=${15} />` : null}${opt.label}</button>`;
  })}</div>`;
}

export function Select({ value, onChange, options, class: cls = '', ...rest }) {
  return html`<select class=${`select ${cls}`} value=${value} onChange=${(e) => onChange(e.target.value)} ...${rest}>
    ${options.map((o) => {
      const opt = typeof o === 'string' ? { value: o, label: o } : o;
      return html`<option value=${opt.value} disabled=${opt.disabled}>${opt.label}</option>`;
    })}
  </select>`;
}

export function AutoTextarea({ value, onInput, class: cls = 'textarea', minRows = 3, maxHeight = 1600, inputRef, ...rest }) {
  const local = useRef();
  const ref = inputRef || local;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, maxHeight)}px`;
  }, [value]);
  return html`<textarea ref=${ref} class=${cls} rows=${minRows} value=${value} onInput=${onInput} ...${rest} />`;
}

export function VisibilityBadge({ v }) {
  return v === 'players'
    ? html`<span class="badge players" title="Für Spieler sichtbar"><${Icon} name="users" size=${12} />Spieler</span>`
    : html`<span class="badge gm" title="Nur Spielleitung"><${Icon} name="lock" size=${12} />SL</span>`;
}

export function Avatar({ name, src, size = '', color }) {
  return html`<span class=${`avatar ${size}`} style=${{ background: color || colorFromString(name || '?') }}>${src ? html`<img src=${src} alt="" />` : initials(name)}</span>`;
}

export function ErrorBoundary({ children }) {
  const [err, reset] = useErrorBoundary((e) => console.error(e));
  if (err) {
    return html`<div class="empty"><${Icon} name="alert" size=${38} /><h3>Hier ist etwas schiefgegangen</h3><p class="mono small">${String(err?.message || err)}</p><${Btn} onClick=${reset}>Erneut versuchen<//></div>`;
  }
  return children;
}

export function useMedia(q) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}

export function useInterval(fn, ms) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ms) return undefined;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

// ───────────────────────── Overlays ─────────────────────────
export const overlay = createStore({ modals: [], toasts: [], menu: null, lightbox: null });
let seq = 0;

export function toast(msg, type = 'info', opts = {}) {
  const id = ++seq;
  overlay.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, msg, type, ...opts }] }));
  setTimeout(() => dismissToast(id), opts.duration || (type === 'error' ? 7000 : type === 'roll' ? 6000 : 3500));
  return id;
}
export function dismissToast(id) {
  overlay.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
bridge.toast = toast;
rollBridge.show = (r) => toast(null, 'roll', { roll: r });
rollBridge.error = (m) => toast(m, 'error');

export function openModal(render, opts = {}) {
  return new Promise((resolve) => {
    const id = ++seq;
    const close = (value) => {
      overlay.set((s) => ({ modals: s.modals.filter((m) => m.id !== id) }));
      resolve(value);
    };
    overlay.set((s) => ({ modals: [...s.modals, { id, render, close, ...opts }] }));
  });
}

export function confirmDialog(text, { title = 'Bist du sicher?', ok = 'OK', cancel = 'Abbrechen', danger = false } = {}) {
  return openModal(({ close }) => html`
    <div class="modal-body"><p style="margin:0;line-height:1.6">${text}</p></div>
    <div class="modal-foot">
      <${Btn} kind="ghost" onClick=${() => close(false)}>${cancel}<//>
      <${Btn} kind=${danger ? 'danger' : 'primary'} onClick=${() => close(true)}>${ok}<//>
    </div>`, { title, size: 'sm' }).then(Boolean);
}

function PromptBody({ label, value, ok, placeholder, multiline, hint, close, showLabel }) {
  const [v, setV] = useState(value || '');
  const ref = useRef();
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select?.();
    }, 40);
    return () => clearTimeout(t);
  }, []);
  const submit = (e) => {
    e?.preventDefault();
    close(v.trim() ? v : null);
  };
  return html`<form onSubmit=${submit}>
    <div class="modal-body stack sm">
      ${showLabel ? html`<label class="field-label">${label}</label>` : null}
      ${multiline
        ? html`<textarea ref=${ref} class="textarea" value=${v} onInput=${(e) => setV(e.target.value)} placeholder=${placeholder} />`
        : html`<input ref=${ref} class="input" value=${v} onInput=${(e) => setV(e.target.value)} placeholder=${placeholder} />`}
      ${hint ? html`<div class="small faint">${hint}</div>` : null}
    </div>
    <div class="modal-foot"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" type="submit">${ok}<//></div>
  </form>`;
}

export function promptDialog(label, value = '', { title, ok = 'OK', placeholder = '', multiline = false, hint = '' } = {}) {
  return openModal(({ close }) => html`<${PromptBody} label=${label} value=${value} ok=${ok} placeholder=${placeholder} multiline=${multiline} hint=${hint} close=${close} showLabel=${!!title && title !== label} />`, { title: title || label, size: 'sm' });
}

export function openMenu(anchor, items) {
  let x = 100;
  let y = 100;
  let fromButton = false;
  if (anchor && (anchor.currentTarget || anchor.target) && anchor.preventDefault) {
    const el = anchor.currentTarget || anchor.target;
    if (anchor.type === 'contextmenu') {
      x = anchor.clientX;
      y = anchor.clientY;
    } else {
      const r = el.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 4;
      fromButton = true;
    }
    anchor.preventDefault();
    anchor.stopPropagation();
  } else if (anchor && 'left' in anchor) {
    x = anchor.left;
    y = anchor.bottom + 4;
  } else if (anchor) {
    x = anchor.x;
    y = anchor.y;
  }
  overlay.set({ menu: { id: ++seq, x, y, items: items.filter(Boolean), fromButton } });
}

export function openLightbox(src) {
  overlay.set({ lightbox: src });
}

function MenuView({ menu }) {
  const ref = useRef();
  const [pos, setPos] = useState({ left: menu.x, top: menu.y, vis: 'hidden' });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;
    if (left + r.width > innerWidth - 8) left = Math.max(8, innerWidth - r.width - 8);
    if (top + r.height > innerHeight - 8) top = Math.max(8, (menu.fromButton ? menu.y - 40 : menu.y) - r.height);
    setPos({ left, top, vis: 'visible' });
  }, [menu.id]);
  useEffect(() => {
    const close = (e) => {
      if (!ref.current?.contains(e.target)) overlay.set({ menu: null });
    };
    const key = (e) => e.key === 'Escape' && overlay.set({ menu: null });
    const t = setTimeout(() => addEventListener('pointerdown', close, true), 0);
    addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      removeEventListener('pointerdown', close, true);
      removeEventListener('keydown', key);
    };
  }, [menu.id]);
  return html`<div class="menu" ref=${ref} role="menu" style=${{ left: `${pos.left}px`, top: `${pos.top}px`, visibility: pos.vis }}>
    ${menu.items.map((it) => {
      if (it.divider) return html`<div class="menu-sep" />`;
      if (it.header) return html`<div class="menu-label">${it.label}</div>`;
      return html`<button type="button" class=${`menu-item${it.danger ? ' danger' : ''}`} disabled=${it.disabled} onClick=${() => { overlay.set({ menu: null }); it.onClick?.(); }}>
        ${it.icon ? html`<${Icon} name=${it.icon} size=${16} />` : html`<span style="width:16px;flex:none"></span>`}
        <span class="ellipsis">${it.label}</span>${it.hint ? html`<span class="hint">${it.hint}</span>` : null}
      </button>`;
    })}
  </div>`;
}

function ModalView({ m, top }) {
  useEffect(() => {
    if (!top) return undefined;
    const key = (e) => {
      if (e.key === 'Escape' && m.dismissable !== false) m.close(undefined);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [top]);
  const Body = m.render;
  return html`<div class="modal-backdrop" onPointerDown=${(e) => { if (e.target === e.currentTarget && m.dismissable !== false) m.close(undefined); }}>
    <div class=${`modal ${m.size || ''}`} role="dialog" aria-modal="true">
      ${m.title ? html`<div class="modal-head"><h2>${m.icon ? html`<${Icon} name=${m.icon} />` : null}${m.title}</h2><${IconBtn} icon="x" title="Schließen" onClick=${() => m.close(undefined)} /></div>` : null}
      <${Body} close=${m.close} />
    </div>
  </div>`;
}

function ToastView({ t }) {
  if (t.type === 'roll') {
    const r = t.roll;
    const cls = r.crit ? ' crit' : r.fumble ? ' fumble' : '';
    return html`<div class="toast roll" onClick=${() => dismissToast(t.id)}>
      <div class=${`roll-total${cls}`}>${r.total}</div>
      <div class="roll-detail">
        <span class="lbl">${r.label || r.input}${r.crit ? ' · Natürliche 20!' : r.fumble ? ' · Patzer!' : ''}</span>
        <span class="txt" dangerouslySetInnerHTML=${{ __html: esc(r.text).replace(/~(\d+)~/g, '<s>$1</s>') }} />
      </div>
    </div>`;
  }
  const icon = t.type === 'error' ? 'alert' : t.type === 'success' ? 'check-circle' : 'info';
  return html`<div class=${`toast ${t.type}`}>
    <${Icon} name=${icon} class="lead" />
    <span class="grow">${t.msg}</span>
    ${t.action ? html`<${Btn} size="sm" kind="ghost" onClick=${() => { t.action.onClick(); dismissToast(t.id); }}>${t.action.label}<//>` : null}
    <${IconBtn} icon="x" size=${14} class="sm" title="Schließen" onClick=${() => dismissToast(t.id)} />
  </div>`;
}

export function OverlayHost() {
  const s = useStore(overlay);
  return html`
    ${s.modals.map((m, i) => html`<${ModalView} key=${m.id} m=${m} top=${i === s.modals.length - 1} />`)}
    ${s.menu ? html`<${MenuView} key=${s.menu.id} menu=${s.menu} />` : null}
    ${s.lightbox ? html`<div class="lightbox" onClick=${() => overlay.set({ lightbox: null })}><img src=${s.lightbox} alt="" /></div>` : null}
    <div class="toasts">${s.toasts.map((t) => html`<${ToastView} key=${t.id} t=${t} />`)}</div>`;
}

// ───────────────────────── Markdown ─────────────────────────
export function mdContext(extra = {}) {
  const player = !isGM();
  return {
    resolveLink: (t) => resolveTitle(t),
    resolveFile: (name) => getIndex().fileByName.get(String(name).toLowerCase())?.id || null,
    embedNote: (title, ctx) => {
      const n = resolveTitle(title);
      return n ? renderMarkdown(n.body || '', ctx).html : null;
    },
    statblock: (code) => statblockHTML(parseStatblock(code)),
    hideGM: player,
    noCreate: player,
    ...extra,
  };
}

export function hydrateImages(root) {
  if (!root) return;
  const cid = app.get().cid;
  root.querySelectorAll('img[data-fid]').forEach(async (img) => {
    if (img.dataset.loaded === img.dataset.fid) return;
    img.dataset.loaded = img.dataset.fid;
    const u = await fileUrl(cid, img.dataset.fid);
    if (u) img.src = u;
  });
}

export function scrollToHeading(root, heading) {
  if (!heading) return;
  const id = `h-${String(heading).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
  const el = (root || document).querySelector(`#${CSS.escape(id)}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function createFromLink(title, newTab) {
  const n = await createNote({ title });
  openNote(n.id, { newTab });
}

export function handleMarkdownClick(e, opts = {}) {
  const t = e.target;
  const link = t.closest('.internal-link');
  if (link) {
    e.preventDefault();
    if (link.classList.contains('is-static')) return;
    if (link.classList.contains('heading-link')) {
      scrollToHeading(link.closest('.view-body'), link.dataset.heading);
      return;
    }
    const newTab = e.ctrlKey || e.metaKey || e.button === 1;
    if (link.dataset.note) openNote(link.dataset.note, { newTab, heading: link.dataset.heading || undefined });
    else if (isGM() && link.dataset.target) createFromLink(link.dataset.target, newTab);
    return;
  }
  const tag = t.closest('a.tag');
  if (tag) {
    e.preventDefault();
    openSearch(`tag:#${tag.dataset.tag}`);
    return;
  }
  const tableRoll = t.closest('.table-roll');
  if (tableRoll) {
    e.preventDefault();
    rollOnTable(tableRoll);
    return;
  }
  const r = t.closest('[data-roll]');
  if (r) {
    e.preventDefault();
    doRoll(r.dataset.roll, { label: r.dataset.label || opts.rollLabel || '' });
    return;
  }
  const cb = t.closest('input.task-cb');
  if (cb) {
    if (cb.dataset.line != null && opts.onToggleTask) {
      e.preventDefault();
      opts.onToggleTask(Number(cb.dataset.line));
    } else e.preventDefault();
    return;
  }
  const img = t.closest('img');
  if (img?.src && !t.closest('a')) openLightbox(img.src);
}

function rollOnTable(btn) {
  const table = btn.closest('table');
  const r = doRoll(btn.dataset.die, { label: 'Zufallstabelle', silent: true });
  if (!r || !table) return;
  table.querySelectorAll('tr.rolled').forEach((x) => x.classList.remove('rolled'));
  const rows = [...table.querySelectorAll('tbody tr')];
  const hit = rows.find((tr) => rollTableRange(tr.cells[0]?.textContent, r.total)) || rows[r.total - 1];
  if (hit) {
    hit.classList.add('rolled');
    hit.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    toast(null, 'roll', { roll: { ...r, label: (hit.cells[1]?.textContent || '').slice(0, 140) } });
  } else toast(null, 'roll', { roll: r });
}

export function MarkdownView({ src, onToggleTask, class: cls = '', ctx, onRendered }) {
  const ref = useRef();
  const version = useStore(vault, (s) => s.version);
  const lens = useStore(app, (s) => `${s.role}:${s.viewAsPlayer}`);
  const out = useMemo(() => renderMarkdown(src || '', mdContext(ctx)).html, [src, version, lens]);
  useEffect(() => {
    hydrateImages(ref.current);
    onRendered?.(ref.current);
  }, [out]);
  return html`<div ref=${ref} class=${`markdown ${cls}`} onClick=${(e) => handleMarkdownClick(e, { onToggleTask })} onAuxClick=${(e) => e.button === 1 && handleMarkdownClick(e, {})} dangerouslySetInnerHTML=${{ __html: out }} />`;
}

export function Statblock({ monster, twoCol, tools }) {
  const out = useMemo(() => statblockHTML(monster, { twoCol }), [monster, twoCol]);
  return html`<div class="statblock-wrap" style="position:relative" onClick=${(e) => handleMarkdownClick(e, {})}>
    ${tools ? html`<div class="sb-tools">${tools}</div>` : null}
    <div dangerouslySetInnerHTML=${{ __html: out }} />
  </div>`;
}

// ───────────────────────── Notiz-Auswahl ─────────────────────────
export function NotePicker({ onPick, placeholder = 'Notiz suchen …', exclude = [], autoFocus, allowCreate = false, class: cls = '' }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const version = useStore(vault, (s) => s.version);
  const items = useMemo(() => {
    const ex = new Set(exclude);
    return getIndex().notes
      .filter((n) => !ex.has(n.id))
      .map((n) => ({ n, s: q ? fuzzyScore(q, n.title) : 1 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.n.title.localeCompare(b.n.title, 'de'))
      .slice(0, 30)
      .map((x) => x.n);
  }, [q, version, exclude.join(',')]);
  const pick = async (n) => {
    setQ('');
    setOpen(false);
    onPick(n);
  };
  const createIt = async () => {
    const n = await createNote({ title: q.trim() });
    pick(n);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAct((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAct((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[act]) pick(items[act]);
      else if (allowCreate && q.trim()) createIt();
    } else if (e.key === 'Escape') setOpen(false);
  };
  return html`<div class=${`picker-wrap ${cls}`}>
    <input class="input" value=${q} placeholder=${placeholder} autoFocus=${autoFocus}
      onInput=${(e) => { setQ(e.target.value); setOpen(true); setAct(0); }}
      onFocus=${() => setOpen(true)} onBlur=${() => setTimeout(() => setOpen(false), 150)} onKeyDown=${onKey} />
    ${open && (items.length || (allowCreate && q.trim())) ? html`<div class="ac-pop" style="left:0;right:0;top:calc(100% + 4px)">
      ${items.map((n, i) => html`<div class=${`suggest-item${i === act ? ' active' : ''}`} onMouseDown=${(e) => { e.preventDefault(); pick(n); }}>
        <${Icon} name="file-text" size=${15} /><span class="ellipsis">${n.title}</span>${n.folder ? html`<span class="path">${n.folder}</span>` : null}
      </div>`)}
      ${allowCreate && q.trim() && !items.some((n) => n.title.toLowerCase() === q.trim().toLowerCase()) ? html`<div class="suggest-item" onMouseDown=${(e) => { e.preventDefault(); createIt(); }}><${Icon} name="file-plus" size=${15} />„${q.trim()}“ anlegen</div>` : null}
    </div>` : null}
  </div>`;
}

// ───────────────────────── KI-Modellwahl ─────────────────────────
export function ModelPicker({ task, value, onChange }) {
  useStore(settings, (s) => s.ai);
  const sel = resolveModel(task, value);
  const ref = sel ? `${sel.provider}:${sel.model}` : '';
  const open = (e) => {
    const recs = recommendedRefs(task);
    const models = modelsFor(task);
    const ready = models.filter((m) => m.ready);
    ready.sort((a, b) => {
      const ia = recs.indexOf(a.ref);
      const ib = recs.indexOf(b.ref);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.label.localeCompare(b.label);
    });
    const shown = ready.slice(0, 40);
    const items = [{ header: true, label: `${TASKS[task]?.label || task} – Modell` }];
    shown.forEach((m) => {
      const ri = recs.indexOf(m.ref);
      items.push({
        label: `${m.label}${m.free ? ' · gratis' : ''}`,
        hint: `${ri === 0 ? '⭐ ' : ri > 0 && ri < 3 ? '☆ ' : ''}${PROVIDERS[m.provider]?.short || m.provider}`,
        icon: m.ref === ref ? 'check' : 'sparkles',
        onClick: () => onChange?.(m.ref),
      });
    });
    if (!ready.length) items.push({ label: 'Noch kein Anbieter eingerichtet', disabled: true, icon: 'alert' });
    items.push({ divider: true });
    if (sel) items.push({ label: 'Als Standard für diese Aufgabe merken', icon: 'save', onClick: () => { updateSettings({ ai: { tasks: { [task]: ref } } }); toast('Als Standard gespeichert', 'success'); } });
    if (sel && sel.provider !== 'demo') {
      items.push({
        label: 'Überall als bevorzugtes Modell verwenden', icon: 'star',
        onClick: () => { updateSettings({ ai: TASKS[task]?.image ? { preferredImage: ref } : { preferred: ref } }); toast(`${modelLabel(sel)} ist jetzt dein bevorzugtes Modell`, 'success'); },
      });
    }
    items.push({ label: 'KI-Einstellungen …', icon: 'settings', onClick: () => openView('settings', { section: 'ai' }) });
    openMenu(e, items);
  };
  return html`<button type="button" class="model-chip" onClick=${open} title=${TASKS[task]?.why || ''}>
    <span class=${`dotp${sel ? '' : ' off'}`}></span>
    <span class="t">${sel ? modelLabel(sel) : 'Kein KI-Modell'}</span>
    <${Icon} name="chevron-down" size=${14} />
  </button>`;
}

// ───────────────────────── Diktat ─────────────────────────
export function DictateButton({ onText, title = 'Diktieren (Spracheingabe)' }) {
  const [on, setOn] = useState(false);
  const ref = useRef(null);
  useEffect(() => () => ref.current?.stop(), []);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const toggle = () => {
    if (on) {
      ref.current?.stop();
      return;
    }
    const r = new SR();
    r.lang = 'de-DE';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (ev) => {
      let txt = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) txt += ev.results[i][0].transcript;
      if (txt.trim()) onText(txt.trim());
    };
    r.onerror = (ev) => {
      toast(`Diktat: ${ev.error === 'not-allowed' ? 'Mikrofon nicht erlaubt' : ev.error}`, 'error');
      setOn(false);
    };
    r.onend = () => setOn(false);
    try {
      r.start();
      ref.current = r;
      setOn(true);
    } catch (e) {
      toast(`Diktat nicht möglich: ${e.message}`, 'error');
    }
  };
  return html`<${IconBtn} icon="mic" title=${on ? 'Diktat beenden' : title} class=${on ? 'mic-on' : ''} onClick=${toggle} />`;
}

// ───────────────────────── Datei-Auswahl ─────────────────────────
export function pickFiles({ accept = '*/*', multiple = false, directory = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    if (directory) {
      inp.webkitdirectory = true;
      inp.setAttribute('webkitdirectory', '');
    }
    inp.style.display = 'none';
    inp.onchange = () => {
      resolve([...(inp.files || [])]);
      inp.remove();
    };
    document.body.appendChild(inp);
    inp.click();
  });
}
