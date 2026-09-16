// Notiz-Logik ohne App-Zustand: abgeleitete Felder, Titel/Pfade bereinigen, Suche.
// Gemeinsam genutzt von core/app.js und dem MCP-Server (mcp/) – hier nichts importieren, was DOM oder Datenbank braucht.
import { parseFrontmatter, extractLinks, extractTags } from './markdown.js';

export function deriveNoteFields(body) {
  const { props } = parseFrontmatter(body || '');
  const al = props.aliases ?? props.alias ?? [];
  const aliases = (Array.isArray(al) ? al : String(al).split(',')).map((x) => String(x).trim()).filter(Boolean);
  const kind = String(props.typ || props.type || props.kind || '').toLowerCase() || null;
  return { tags: extractTags(body || '', props), links: extractLinks(body || ''), aliases, kind };
}

// notes: sichtbare Notizen (nach Titel sortiert)
export function searchNoteList(allNotes, query, { limit = 60 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  let notes = allNotes;
  const terms = [];
  for (const part of q.match(/"[^"]+"|\S+/g) || []) {
    if (/^tag:/i.test(part)) {
      const t = part.slice(4).replace(/^#/, '').toLowerCase();
      notes = notes.filter((n) => (n.tags || []).some((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(`${t}/`)));
    } else if (/^path:/i.test(part)) {
      const p = part.slice(5).replace(/^"|"$/g, '').toLowerCase();
      notes = notes.filter((n) => (n.folder || '').toLowerCase().includes(p));
    } else if (/^typ:/i.test(part)) {
      const p = part.slice(4).toLowerCase();
      notes = notes.filter((n) => (n.kind || '') === p);
    } else terms.push(part.replace(/^"|"$/g, '').toLowerCase());
  }
  const out = [];
  for (const n of notes) {
    const title = String(n.title || '').toLowerCase();
    const body = String(n.body || '').toLowerCase();
    let score = terms.length ? 0 : 1;
    let at = -1;
    let ok = true;
    for (const t of terms) {
      const ti = title.indexOf(t);
      const bi = body.indexOf(t);
      if (ti < 0 && bi < 0) {
        ok = false;
        break;
      }
      if (ti >= 0) score += ti === 0 ? 40 : 20;
      if (bi >= 0) {
        score += 4;
        if (at < 0) at = bi;
      }
    }
    if (!ok) continue;
    out.push({ note: n, score, snippet: at >= 0 ? snippet(n.body, at, terms[0].length) : '', term: terms[0] || '' });
  }
  return out.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title, 'de')).slice(0, limit);
}

function snippet(body, at, len) {
  const s = Math.max(0, at - 60);
  const e = Math.min(body.length, at + len + 90);
  return (s > 0 ? '…' : '') + body.slice(s, e).replace(/\s+/g, ' ') + (e < body.length ? '…' : '');
}

export function cleanTitle(t) {
  return String(t || '').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim();
}

export function cleanPath(p) {
  return String(p || '').split('/').map((s) => s.trim().replace(/[\\:*?"<>|]/g, '-')).filter(Boolean).join('/');
}

export function uniqueTitleIn(notes, title, excludeId) {
  const base = cleanTitle(title) || 'Unbenannt';
  const taken = new Set(notes.filter((n) => n.id !== excludeId).map((n) => String(n.title).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 1; ; i++) {
    const t = `${base} ${i}`;
    if (!taken.has(t.toLowerCase())) return t;
  }
}
