// Obsidian-kompatibler Markdown-Renderer (ohne Abhängigkeiten, XSS-sicher: Roh-HTML wird escaped).
// Unterstützt: Frontmatter, Überschriften, Listen (verschachtelt, Aufgaben), Tabellen (inkl. Würfeltabellen),
// Callouts (> [!typ]), Code, [[Wikilinks|Alias]], ![[Einbettungen]], #Tags, ==Markierung==, %%Kommentare%%,
// klickbare Würfel (1d8+3, W20), Münzen (5 gp), Farbfelder (#A0522D) und ```statblock-Blöcke.
import { esc, slugify } from './util.js';
import { iconSvg } from './icons.js';

export const CALLOUTS = {
  note: { icon: 'pencil', color: 'blue', label: 'Notiz' },
  info: { icon: 'info', color: 'blue', label: 'Info' },
  tip: { icon: 'flame', color: 'cyan', label: 'Tipp' },
  success: { icon: 'check', color: 'green', label: 'Erfolg' },
  question: { icon: 'help', color: 'orange', label: 'Frage' },
  warning: { icon: 'alert', color: 'orange', label: 'Warnung' },
  failure: { icon: 'x', color: 'red', label: 'Fehlschlag' },
  danger: { icon: 'zap', color: 'red', label: 'Gefahr' },
  bug: { icon: 'alert', color: 'red', label: 'Fehler' },
  example: { icon: 'list', color: 'purple', label: 'Beispiel' },
  quote: { icon: 'quote', color: 'gray', label: 'Zitat' },
  abstract: { icon: 'clipboard', color: 'cyan', label: 'Zusammenfassung' },
  todo: { icon: 'check-circle', color: 'blue', label: 'Aufgabe' },
  gm: { icon: 'lock', color: 'red', label: 'Nur für die Spielleitung', gm: true },
  vorlesen: { icon: 'scroll', color: 'parchment', label: 'Vorlesetext' },
  npc: { icon: 'user', color: 'purple', label: 'NPC' },
  loot: { icon: 'gem', color: 'gold', label: 'Beute' },
  regel: { icon: 'book', color: 'gray', label: 'Regel' },
  ort: { icon: 'map-pin', color: 'green', label: 'Ort' },
  kampf: { icon: 'swords', color: 'red', label: 'Kampf' },
};
const CALLOUT_ALIASES = {
  hint: 'tip', important: 'tip', tipp: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question', frage: 'question',
  caution: 'warning', attention: 'warning', warnung: 'warning', fail: 'failure', missing: 'failure', error: 'danger', gefahr: 'danger',
  cite: 'quote', zitat: 'quote', summary: 'abstract', tldr: 'abstract', beispiel: 'example', notiz: 'note',
  sl: 'gm', geheim: 'gm', secret: 'gm', dm: 'gm', read: 'vorlesen', readaloud: 'vorlesen', beute: 'loot', rule: 'regel',
};

export const FILE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|pdf|mp3|mp4|webm|ogg|wav|m4a)$/i;
export const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const COIN = { cp: 'cp', sp: 'sp', ep: 'ep', gp: 'gp', pp: 'pp', KM: 'cp', SM: 'sp', EM: 'ep', GM: 'gp', PM: 'pp' };
const DIE = iconSvg('d20', 13, 'die');

// ───────────────────────── Frontmatter ─────────────────────────
export function parseFrontmatter(text) {
  const src = String(text ?? '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(src);
  if (!m) return { props: {}, body: src, raw: '', lines: 0 };
  return { props: parseYaml(m[1]), body: src.slice(m[0].length), raw: m[1], lines: m[0].split('\n').length - (m[2] ? 1 : 0) };
}

function yamlValue(v) {
  const s = v.trim();
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map((x) => yamlValue(x)).filter((x) => x !== '');
  if (/^(['"]).*\1$/.test(s)) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

export function parseYaml(src) {
  const props = {};
  let key = null;
  for (const line of String(src).split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const li = /^\s*-\s*(.*)$/.exec(line);
    if (li && key && /^\s/.test(line) || (li && key && props[key] === '')) {
      if (!Array.isArray(props[key])) props[key] = props[key] === '' || props[key] == null ? [] : [props[key]];
      props[key].push(yamlValue(li[1]));
      continue;
    }
    const kv = /^([^:#\s][^:]*):(?:\s+(.*)|\s*)$/.exec(line);
    if (kv) {
      key = kv[1].trim();
      props[key] = kv[2] === undefined || kv[2].trim() === '' ? '' : yamlValue(kv[2]);
    }
  }
  return props;
}

function yamlStr(v) {
  if (typeof v !== 'string') return String(v);
  if (v === '' || /[:#\[\]{},&*!|>'"%@`]/.test(v) || /^(true|false|null|-?\d+(\.\d+)?)$/.test(v) || /^\s|\s$/.test(v)) return JSON.stringify(v);
  return v;
}

export function stringifyFrontmatter(props) {
  const keys = Object.keys(props || {}).filter((k) => {
    const v = props[k];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
  });
  if (!keys.length) return '';
  const lines = keys.map((k) => {
    const v = props[k];
    if (Array.isArray(v)) return `${k}:\n${v.map((x) => `  - ${yamlStr(x)}`).join('\n')}`;
    return `${k}: ${yamlStr(v)}`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

export function setFrontmatter(src, patch) {
  const { props, body } = parseFrontmatter(src);
  const next = { ...props, ...patch };
  for (const k of Object.keys(patch)) if (patch[k] === undefined || patch[k] === null || patch[k] === '') delete next[k];
  return stringifyFrontmatter(next) + body.replace(/^\r?\n/, '');
}

// ───────────────────────── Extraktion ─────────────────────────
function stripCode(src) {
  return String(src || '').replace(/^\s*(```|~~~)[\s\S]*?^\s*\1\s*$/gm, '').replace(/`[^`\n]*`/g, '');
}

export function extractLinks(src) {
  const out = new Set();
  for (const m of stripCode(src).matchAll(/(!?)\[\[([^\]]+?)\]\]/g)) {
    const t = m[2].split('|')[0].split('#')[0].trim();
    if (!t || FILE_RE.test(t)) continue;
    out.add(t);
  }
  return [...out];
}

export function extractEmbeddedFiles(src) {
  const out = new Set();
  for (const m of String(src || '').matchAll(/!\[\[([^\]|#]+?)(?:\|[^\]]*)?\]\]/g)) if (FILE_RE.test(m[1].trim())) out.add(m[1].trim());
  return [...out];
}

export function extractTags(src, props) {
  const out = new Set();
  const fm = props || parseFrontmatter(src).props;
  const t = fm.tags ?? fm.tag;
  if (Array.isArray(t)) t.forEach((x) => x && out.add(String(x).replace(/^#/, '')));
  else if (typeof t === 'string') t.split(/[,\s]+/).forEach((x) => x && out.add(x.replace(/^#/, '')));
  const body = stripCode(parseFrontmatter(src).body);
  for (const m of body.matchAll(/(^|\s)#([\p{L}_][\p{L}\p{N}_\-/]*)/gu)) {
    if (/^[0-9a-f]{6}$/i.test(m[2])) continue;
    out.add(m[2]);
  }
  return [...out];
}

export function extractHeadings(src) {
  const out = [];
  let inCode = false;
  const { body } = parseFrontmatter(src);
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inCode = !inCode;
    if (inCode) continue;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], id: headingId(m[2]) });
  }
  return out;
}

export function headingId(text) {
  return 'h-' + slugify(String(text).replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a));
}

export function stripMarkdown(src) {
  return parseFrontmatter(src).body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s*\[![^\]]+\][+-]?/gm, '')
    .replace(/[#>*_=~`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(src) {
  const s = stripMarkdown(src);
  return s ? s.split(/\s+/).length : 0;
}

export function toggleTask(src, lineIndex) {
  const lines = String(src).split('\n');
  const l = lines[lineIndex];
  if (l === undefined) return src;
  lines[lineIndex] = l.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX/\-])\]/, (_, pre, c) => `${pre}[${c === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
}

// Link-Ziel in einem Text umbenennen ([[Alt]], [[Alt|x]], [[Alt#h]], ![[Alt]])
export function renameLinkTarget(src, oldTitle, newTitle) {
  const escOld = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(!?\\[\\[)${escOld}(?=(\\|[^\\]]*)?(#[^\\]]*)?\\]\\]|#|\\|)`, 'gi');
  return String(src).replace(re, `$1${newTitle}`);
}

// ───────────────────────── Rendering ─────────────────────────
export function renderMarkdown(src, ctx = {}) {
  const { props, body, lines } = parseFrontmatter(src || '');
  const html = renderBlocks(body.split(/\r?\n/), ctx, lines, 0);
  return { html, props };
}

export function renderInline(text, ctx = {}) {
  return inline(text, ctx);
}

function isBlockStart(lines, i) {
  const l = lines[i];
  return (
    /^\s*(```|~~~)/.test(l) ||
    /^#{1,6}\s/.test(l) ||
    /^\s*>/.test(l) ||
    LIST_RE.test(l) ||
    HR_RE.test(l) ||
    (l.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) ||
    /^\s*%%\s*$/.test(l)
  );
}

function renderBlocks(lines, ctx, offset, depth) {
  let out = '';
  let i = 0;
  const n = lines.length;
  const lineAttr = (k) => (ctx.noLines ? '' : ` data-line="${offset + k}"`);
  while (i < n) {
    const line = lines[i];
    let m;
    if ((m = /^\s*(```+|~~~+)\s*([\w-]*)\s*$/.exec(line))) {
      const fence = m[1];
      const lang = m[2].toLowerCase();
      const buf = [];
      i++;
      while (i < n && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++;
      out += renderFence(lang, buf.join('\n'), ctx);
      continue;
    }
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    if (/^\s*%%/.test(line) && !/%%.*%%/.test(line.trim().slice(2) ? line : '')) {
      if (line.trim() === '%%' || line.trim().indexOf('%%', 2) < 0) {
        i++;
        while (i < n && !lines[i].includes('%%')) i++;
        i++;
        continue;
      }
    }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      const lvl = m[1].length;
      out += `<h${lvl} id="${headingId(m[2])}"${lineAttr(i)}>${inline(m[2], ctx)}</h${lvl}>`;
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      out += '<hr>';
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < n && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*> ?/, ''));
      out += renderQuote(buf, ctx, depth);
      continue;
    }
    if (line.includes('|') && i + 1 < n && TABLE_SEP.test(lines[i + 1])) {
      const t = renderTable(lines, i, ctx);
      out += t.html;
      i = t.next;
      continue;
    }
    if (LIST_RE.test(line)) {
      const buf = [];
      while (i < n) {
        const l = lines[i];
        if (LIST_RE.test(l) || (/^\s+\S/.test(l) && buf.length)) {
          buf.push({ text: l, line: offset + i });
          i++;
        } else if (/^\s*$/.test(l) && i + 1 < n && (LIST_RE.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))) {
          i++;
        } else break;
      }
      out += renderList(buf, ctx);
      continue;
    }
    const buf = [];
    while (i < n && !/^\s*$/.test(lines[i]) && (buf.length === 0 || !isBlockStart(lines, i))) buf.push(lines[i++]);
    out += `<p>${buf.map((l) => inline(l, ctx)).join('<br>')}</p>`;
  }
  return out;
}

function renderFence(lang, code, ctx) {
  if ((lang === 'statblock' || lang === 'monster') && ctx.statblock) {
    try {
      return ctx.statblock(code);
    } catch (e) {
      return `<div class="callout callout-red"><div class="callout-title">Statblock fehlerhaft</div><pre><code>${esc(code)}</code></pre></div>`;
    }
  }
  if (lang === 'dice' || lang === 'würfel' || lang === 'wuerfel') {
    const rows = code.split('\n').filter((l) => l.trim()).map((l) => {
      const [label, expr] = l.includes(':') ? l.split(/:(.+)/) : [l, l];
      return `<button type="button" class="dice-chip big" data-roll="${esc(expr.trim())}" data-label="${esc(label.trim())}">${DIE}${esc(label.trim())}${label !== expr ? ` <span class="faint">${esc(expr.trim())}</span>` : ''}</button>`;
    });
    return `<div class="dice-block">${rows.join('')}</div>`;
  }
  return `<pre class="code-block"><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(code)}</code></pre>`;
}

function renderQuote(buf, ctx, depth) {
  const first = (buf[0] || '').trim();
  const m = /^\[!([\wÀ-ſ-]+)\]([+-]?)\s*(.*)$/.exec(first);
  if (m) {
    let type = m[1].toLowerCase();
    type = CALLOUT_ALIASES[type] || type;
    const def = CALLOUTS[type] || { ...CALLOUTS.note, label: m[1] };
    if (def.gm && ctx.hideGM) return '';
    const title = m[3] || def.label;
    const inner = renderBlocks(buf.slice(1), { ...ctx, noLines: true }, 0, depth + 1);
    const cls = `callout callout-${def.color}${def.gm ? ' callout-gm' : ''}`;
    const head = `${iconSvg(def.icon, 16)}<span>${inline(title, ctx)}</span>`;
    if (m[2]) {
      return `<details class="${cls}"${m[2] === '+' ? ' open' : ''} data-callout="${esc(type)}"><summary class="callout-title">${head}</summary><div class="callout-content">${inner}</div></details>`;
    }
    return `<div class="${cls}" data-callout="${esc(type)}"><div class="callout-title">${head}</div>${inner ? `<div class="callout-content">${inner}</div>` : ''}</div>`;
  }
  return `<blockquote>${renderBlocks(buf, { ...ctx, noLines: true }, 0, depth + 1)}</blockquote>`;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let depth = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '[' && s[k + 1] === '[') { depth++; cur += '[['; k++; continue; }
    if (c === ']' && s[k + 1] === ']') { depth = Math.max(0, depth - 1); cur += ']]'; k++; continue; }
    if (c === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (c === '|' && depth === 0) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function renderTable(lines, i, ctx) {
  const head = splitRow(lines[i]);
  const aligns = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : ''));
  let j = i + 2;
  const rows = [];
  while (j < lines.length && lines[j].trim() && lines[j].includes('|')) rows.push(splitRow(lines[j++]));
  const al = (k) => (aligns[k] ? ` style="text-align:${aligns[k]}"` : '');
  const die = /^(\d*)\s*[dwW](\d+)$/.exec(head[0] || '');
  const rollBtn = die ? `<button type="button" class="table-roll" data-die="${die[1] || 1}d${die[2]}" title="Auf Tabelle würfeln">${DIE}</button>` : '';
  const th = head.map((c, k) => `<th${al(k)}>${k === 0 ? rollBtn : ''}${inline(c, { ...ctx, dice: !die })}</th>`).join('');
  const tb = rows.map((r) => `<tr>${head.map((_, k) => `<td${al(k)}>${inline(r[k] || '', ctx)}</td>`).join('')}</tr>`).join('');
  return { html: `<div class="table-wrap"><table${die ? ' class="roll-table"' : ''}><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`, next: j };
}

function renderList(items, ctx) {
  const root = { children: [], indent: -1 };
  const stack = [root];
  let last = null;
  for (const { text, line } of items) {
    const m = LIST_RE.exec(text);
    if (!m) {
      if (last && text.trim()) last.text += '\n' + text.trim();
      continue;
    }
    const indent = m[1].replace(/\t/g, '    ').length;
    const ordered = /\d/.test(m[2]);
    const item = { indent, ordered, text: m[3], line, children: [], start: ordered ? parseInt(m[2], 10) : 1 };
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].children.push(item);
    stack.push(item);
    last = item;
  }
  return renderItems(root.children, ctx);
}

function renderItems(items, ctx) {
  let out = '';
  let i = 0;
  while (i < items.length) {
    const ordered = items[i].ordered;
    const group = [];
    while (i < items.length && items[i].ordered === ordered) group.push(items[i++]);
    const tag = ordered ? 'ol' : 'ul';
    const start = ordered && group[0].start !== 1 ? ` start="${group[0].start}"` : '';
    out += `<${tag}${start}>${group.map((it) => renderItem(it, ctx)).join('')}</${tag}>`;
  }
  return out;
}

function renderItem(it, ctx) {
  let text = it.text;
  let cls = '';
  let pre = '';
  const t = /^\[([ xX/\-])\]\s?([\s\S]*)$/.exec(text);
  if (t) {
    const done = t[1] !== ' ';
    cls = ` class="task${done ? ' done' : ''}"`;
    pre = `<input type="checkbox" class="task-cb"${ctx.noLines ? ' disabled' : ` data-line="${it.line}"`}${done ? ' checked' : ''}>`;
    text = t[2];
  }
  const body = text.split('\n').map((l) => inline(l, ctx)).join('<br>');
  return `<li${cls}>${pre}<span>${body}</span>${it.children.length ? renderItems(it.children, ctx) : ''}</li>`;
}

function safeUrl(url) {
  const u = String(url || '').trim();
  if (/^(https?:|mailto:|tel:|#)/i.test(u)) return u;
  if (/^data:image\/(png|jpe?g|gif|webp);/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null; // javascript:, vbscript: …
  return u;
}

function renderWikilink(inner, ctx) {
  const bar = inner.indexOf('|');
  let target = bar >= 0 ? inner.slice(0, bar) : inner;
  const alias = bar >= 0 ? inner.slice(bar + 1).trim() : '';
  let heading = '';
  const hi = target.indexOf('#');
  if (hi >= 0) {
    heading = target.slice(hi + 1).replace(/^\^/, '');
    target = target.slice(0, hi);
  }
  target = target.trim();
  const label = alias || (target ? target + (heading ? ` › ${heading}` : '') : heading);
  if (!target && heading) return `<a class="internal-link heading-link" data-heading="${esc(heading)}">${esc(label)}</a>`;
  const r = ctx.resolveLink ? ctx.resolveLink(target) : null;
  if (!r && ctx.noCreate) return `<span class="internal-link is-unresolved is-static">${esc(label)}</span>`;
  return `<a class="internal-link${r ? '' : ' is-unresolved'}" data-note="${esc(r?.id || '')}" data-target="${esc(target)}" data-heading="${esc(heading)}" href="#">${esc(label)}</a>`;
}

function renderEmbed(inner, ctx) {
  const bar = inner.indexOf('|');
  const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
  const opt = bar >= 0 ? inner.slice(bar + 1).trim() : '';
  if (IMAGE_RE.test(target)) {
    const fid = ctx.resolveFile ? ctx.resolveFile(target) : null;
    const w = /^\d+/.exec(opt);
    const style = w ? ` style="width:${parseInt(w[0], 10)}px"` : '';
    if (fid) return `<img class="embed-img" data-fid="${esc(fid)}" alt="${esc(opt && !w ? opt : target)}"${style}>`;
    return `<span class="embed-missing">${iconSvg('image', 14)} ${esc(target)}</span>`;
  }
  if (FILE_RE.test(target)) return `<span class="embed-missing">${iconSvg('file', 14)} ${esc(target)}</span>`;
  const depth = ctx.embedDepth || 0;
  if (ctx.embedNote && depth < 1) {
    const h = ctx.embedNote(target.split('#')[0].trim(), { ...ctx, embedDepth: depth + 1 });
    if (h != null) return `<span class="embed-note"><span class="embed-title">${renderWikilink(target, ctx)}</span>${h}</span>`;
  }
  return renderWikilink(inner, ctx);
}

function renderMdImage(alt, url, ctx) {
  const u = safeUrl(url);
  if (!u) return null;
  if (/^(https?:|data:image)/i.test(u)) return `<img src="${esc(u)}" alt="${esc(alt)}" loading="lazy">`;
  const name = decodeURIComponent(u.split('/').pop());
  const fid = ctx.resolveFile ? ctx.resolveFile(name) : null;
  return fid ? `<img class="embed-img" data-fid="${esc(fid)}" alt="${esc(alt || name)}">` : `<span class="embed-missing">${iconSvg('image', 14)} ${esc(name)}</span>`;
}

function inline(text, ctx) {
  if (!text) return '';
  const ph = [];
  const put = (h) => ' ' + (ph.push(h) - 1) + '';
  let s = String(text);
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|=~%])/g, (_, c) => put(esc(c)));
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, t, c) => put(`<code>${esc(c.replace(/^ (.*) $/, '$1'))}</code>`));
  s = s.replace(/%%[\s\S]*?%%/g, '');
  s = s.replace(/!\[\[([^\]]+?)\]\]/g, (_, x) => put(renderEmbed(x, ctx)));
  s = s.replace(/\[\[([^\]]+?)\]\]/g, (_, x) => put(renderWikilink(x, ctx)));
  s = s.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (m0, alt, url) => {
    const h = renderMdImage(alt, url, ctx);
    return h ? put(h) : m0;
  });
  s = s.replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (m0, label, url) => {
    const u = safeUrl(url);
    if (!u) return label;
    return put(`<a href="${esc(u)}" class="external-link" target="_blank" rel="noopener noreferrer">${inline(label, { ...ctx, dice: false })}</a>`);
  });
  s = s.replace(/\bhttps?:\/\/[^\s<>"'` ]+[^\s<>"'`.,;:!?)\] ]/g, (u) => put(`<a href="${esc(u)}" class="external-link" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`));
  s = s.replace(/(^|[\s(:,])#([0-9a-fA-F]{6})(?![\w-])/g, (_, pre, hex) => pre + put(`<span class="swatch" style="background:#${hex}" title="#${hex}"></span><code class="hex">#${hex.toUpperCase()}</code>`));
  s = s.replace(/<(\/?)(br|u|sub|sup|mark|kbd|small|s|b|i|em|strong)\s*\/?>/gi, (_, sl, tag) => put(`<${sl}${tag.toLowerCase()}>`));
  s = s.replace(/(^|\s)#([\p{L}_][\p{L}\p{N}_\-/]*)/gu, (_, pre, tag) => pre + put(`<a class="tag" data-tag="${esc(tag)}" href="#">#${esc(tag)}</a>`));
  if (ctx.dice !== false) {
    s = s.replace(/(^|[^\w])(\d{0,3}[dW](?:\d{1,3}|%)(?:(?:kh|kl|dh|dl)\d{0,2})?(?:\s?[+\-−]\s?\d{1,3})?)(?![\w%])/g, (_, pre, d) =>
      pre + put(`<button type="button" class="dice-chip" data-roll="${esc(d.replace(/W/g, 'd').replace(/−/g, '-').replace(/\s/g, ''))}">${DIE}${esc(d)}</button>`));
    s = s.replace(/(^|[^\w])([+\-−]\d{1,2})(\s(?:zum Treffen|auf Treffer|to hit))/g, (_, pre, b, rest) =>
      pre + put(`<button type="button" class="dice-chip hit" data-roll="1d20${esc(b.replace('−', '-'))}" data-label="Angriff">${DIE}${esc(b)}</button>`) + rest);
  }
  s = s.replace(/(\d[\d.]*)\s?(cp|sp|ep|gp|pp|KM|SM|EM|GM|PM)(?![\w])/g, (_, num, c) => put(`<span class="coin coin-${COIN[c]}">${esc(num)} ${c}</span>`));
  s = esc(s);
  s = s
    .replace(/\*\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__([^\s_](?:[\s\S]*?[^\s_])?)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*([^\s*](?:[^*]*?[^\s*])?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^\s_](?:[^_]*?[^\s_])?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^\s~](?:[\s\S]*?[^\s~])?)~~/g, '<del>$1</del>')
    .replace(/==([^\s=](?:[\s\S]*?[^\s=])?)==/g, '<mark>$1</mark>');
  let prev;
  let guard = 0;
  do {
    prev = s;
    s = s.replace(/ (\d+)/g, (_, k) => ph[+k]);
  } while (s !== prev && guard++ < 5);
  return s;
}
