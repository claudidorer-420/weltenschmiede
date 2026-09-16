// MCP-Werkzeuge der Weltenschmiede. Alles läuft mit dem Konto des Nutzers → Firestore-Regeln gelten wie in der App,
// Änderungen erscheinen sofort live in allen offenen Browsern.
import { parseFrontmatter, extractLinks, extractTags, renameLinkTarget } from '../../js/lib/markdown.js';
import { roll } from '../../js/lib/dice.js';
import { normalizeMonster } from '../../js/ui/statblock.js';
import { MONSTERS } from '../../js/data/monsters-srd.js';
import { SPELLS as SPELLS_2014 } from '../../js/data/spells-2014.js';
import { SPELLS as SPELLS_2024 } from '../../js/data/spells-2024.js';
import { DND } from '../../js/data/origins.js';
import { cleanPath, newId } from './firestore.js';

const now = () => Date.now();
const low = (s) => String(s ?? '').toLowerCase();

// ───────────────────────── Hilfen ─────────────────────────
function deriveNoteFields(body) {
  const { props } = parseFrontmatter(body || '');
  const al = props.aliases ?? props.alias ?? [];
  const aliases = (Array.isArray(al) ? al : String(al).split(',')).map((x) => String(x).trim()).filter(Boolean);
  const kind = low(props.typ || props.type || props.kind) || null;
  return { tags: extractTags(body || '', props), links: extractLinks(body || ''), aliases, kind };
}

const cleanTitle = (t) => String(t || '').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim();
const cleanFolder = (p) => String(p || '').split('/').map((s) => s.trim().replace(/[\\:*?"<>|]/g, '-')).filter(Boolean).join('/');

function uniqueTitle(notes, title, excludeId) {
  const base = cleanTitle(title) || 'Unbenannt';
  const taken = new Set(notes.filter((n) => n.id !== excludeId).map((n) => low(n.title)));
  if (!taken.has(low(base))) return base;
  for (let i = 1; ; i++) if (!taken.has(low(`${base} ${i}`))) return `${base} ${i}`;
}

function snippet(body, at, len) {
  const s = Math.max(0, at - 80);
  const e = Math.min(body.length, at + len + 120);
  return (s > 0 ? '…' : '') + body.slice(s, e).replace(/\s+/g, ' ') + (e < body.length ? '…' : '');
}

const vis = (v) => (v === 'players' || v === 'spieler' ? 'players' : 'gm');
const date = (ts) => (ts ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') : null);

class Ctx {
  constructor(fs, user) {
    this.fs = fs;
    this.user = user;
    this.camps = null;
    this.members = new Map();
  }

  async campaigns() {
    if (!this.camps) this.camps = await this.fs.list(`users/${this.user.uid}/campaigns`);
    return this.camps;
  }

  // Kampagne per ID oder Name; ohne Angabe die einzige bzw. zuletzt beigetretene
  async campaign(ref) {
    const list = await this.campaigns();
    if (!list.length) throw new Error('Dieses Konto ist noch in keiner Kampagne.');
    let c = null;
    if (ref) {
      const r = low(ref).trim();
      c = list.find((x) => x.id === ref) || list.find((x) => low(x.name) === r) || list.find((x) => low(x.name).includes(r));
      if (!c) throw new Error(`Kampagne „${ref}“ nicht gefunden. Vorhanden: ${list.map((x) => x.name).join(', ')}`);
    } else if (list.length === 1) c = list[0];
    else throw new Error(`Mehrere Kampagnen – bitte „kampagne“ angeben: ${list.map((x) => `${x.name} (${x.id})`).join(', ')}`);
    if (!this.members.has(c.id)) {
      const m = await this.fs.get(`campaigns/${c.id}/members/${this.user.uid}`);
      if (!m) throw new Error(`Kein Zugriff (mehr) auf „${c.name}“.`);
      this.members.set(c.id, m);
    }
    const role = this.members.get(c.id).role;
    return { cid: c.id, name: c.name, role, gm: role === 'gm', p: (s) => `campaigns/${c.id}/${s}` };
  }

  // Spieler dürfen nur freigegebene Inhalte abfragen (Regeln sind keine Filter)
  async visibleList(k, coll) {
    return k.gm ? this.fs.list(k.p(coll)) : this.fs.query(k.p(coll), { where: [['visibility', '==', 'players']] });
  }

  async notes(k) {
    return this.visibleList(k, 'notes');
  }

  async findNote(k, { id, titel }) {
    if (id) {
      const n = await this.fs.get(k.p(`notes/${id}`));
      if (n) return n;
    }
    const t = low(titel || id).trim();
    if (!t) throw new Error('Bitte „id“ oder „titel“ angeben.');
    const notes = await this.notes(k);
    const n = notes.find((x) => low(x.title) === t) || notes.find((x) => (x.aliases || []).some((a) => low(a) === t));
    if (!n) {
      const near = notes.filter((x) => low(x.title).includes(t)).slice(0, 8).map((x) => x.title);
      throw new Error(`Notiz „${titel || id}“ nicht gefunden.${near.length ? ` Ähnlich: ${near.join(', ')}` : ''}`);
    }
    return n;
  }
}

function needGM(k) {
  if (!k.gm) throw new Error('Das darf nur die Spielleitung.');
}

async function members(ctx, k) {
  return ctx.fs.list(k.p('members'));
}

// ───────────────────────── Schemas ─────────────────────────
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const KAMPAGNE = str('Kampagne (ID oder Name). Weglassen, wenn das Konto nur eine Kampagne hat.');
const SICHT = str('„gm“ = nur Spielleitung, „players“ = für Spieler sichtbar', { enum: ['gm', 'players'] });

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DEL = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

export const TOOLS = [];
const HANDLERS = {};
function tool(name, title, description, inputSchema, annotations, handler) {
  TOOLS.push({ name, title, description, inputSchema, annotations: { title, ...annotations } });
  HANDLERS[name] = handler;
}

// ───────────────────────── Konto & Kampagnen ─────────────────────────
tool('kampagnen', 'Kampagnen auflisten', 'Zeigt das angemeldete Konto und alle Kampagnen mit Rolle (gm = Spielleitung, player = Spieler) und Regelwerk. Guter erster Schritt.', S({}), RO, async (ctx) => {
  const list = await ctx.campaigns();
  const profile = await ctx.fs.get(`users/${ctx.user.uid}`).catch(() => null);
  return {
    konto: { uid: ctx.user.uid, name: profile?.name || ctx.user.name, art: profile?.kind || 'gm' },
    kampagnen: list.map((c) => ({ id: c.id, name: c.name, rolle: c.role, regelwerk: c.edition || null })),
    app: 'https://claudidorer-420.github.io/weltenschmiede/',
  };
});

tool('kampagne', 'Kampagne ansehen', 'Überblick einer Kampagne: Beschreibung, Welt, Regelwerk, aktuelle Szene, Ordner, Mitglieder mit Charakter-IDs, Play-by-Post-Warteliste.', S({ kampagne: KAMPAGNE }), RO, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  const c = await ctx.fs.get(`campaigns/${k.cid}`);
  const ms = await members(ctx, k);
  return {
    id: k.cid, name: c.name, deineRolle: k.role, beschreibung: c.description || '', welt: c.world || '',
    regelwerk: c.settings?.rulesVersion || '2014', einheiten: c.settings?.units || 'm', szene: c.scene || null,
    ordner: c.folders || [], ordnerMarkierungen: c.folderMeta || {}, pbpWartetAuf: (c.pbpWaiting || []).map((u) => ms.find((m) => m.id === u)?.name || u),
    mitglieder: ms.map((m) => ({ uid: m.id, name: m.name, rolle: m.role, charakterId: m.characterId || null })),
  };
});

tool('kampagne_aendern', 'Kampagne ändern', 'Ändert Name, Beschreibung oder Weltbeschreibung der Kampagne (nur Spielleitung).', S({
  kampagne: KAMPAGNE, name: str('Neuer Name'), beschreibung: str('Kurzbeschreibung'), welt: str('Weltbeschreibung / Setting (Markdown)'),
}), RW, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  needGM(k);
  const patch = { updatedAt: now() };
  if (a.name != null) patch.name = a.name;
  if (a.beschreibung != null) patch.description = a.beschreibung;
  if (a.welt != null) patch.world = a.welt;
  await ctx.fs.update(`campaigns/${k.cid}`, patch);
  if (a.name) await ctx.fs.update(`users/${ctx.user.uid}/campaigns/${k.cid}`, { name: a.name }).catch(() => {});
  return { ok: true };
});

// ───────────────────────── Codex (Notizen) ─────────────────────────
tool('notizen_suchen', 'Codex durchsuchen', 'Sucht Notizen im Codex (Markdown, Obsidian-kompatibel, [[Wikilinks]]). Suchbegriffe in Titel und Text; Filter „tag:xyz“, „path:Ordner“, „typ:npc“ im Suchtext möglich. Ohne Suchtext: alle Titel (optional nach Ordner).', S({
  kampagne: KAMPAGNE, suche: str('Suchtext, z. B. „Drache tag:npc“'), ordner: str('Nur in diesem Ordner (inkl. Unterordner)'), limit: num('Maximale Treffer (Standard 40)'),
}), RO, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  let notes = await ctx.notes(k);
  if (a.ordner) {
    const f = low(cleanFolder(a.ordner));
    notes = notes.filter((n) => low(n.folder) === f || low(n.folder).startsWith(`${f}/`));
  }
  const terms = [];
  for (const part of String(a.suche || '').match(/"[^"]+"|\S+/g) || []) {
    if (/^tag:/i.test(part)) {
      const t = low(part.slice(4).replace(/^#/, ''));
      notes = notes.filter((n) => (n.tags || []).some((x) => low(x) === t || low(x).startsWith(`${t}/`)));
    } else if (/^path:/i.test(part)) {
      const p = low(part.slice(5).replace(/^"|"$/g, ''));
      notes = notes.filter((n) => low(n.folder).includes(p));
    } else if (/^typ:/i.test(part)) {
      const p = low(part.slice(4));
      notes = notes.filter((n) => (n.kind || '') === p);
    } else terms.push(low(part.replace(/^"|"$/g, '')));
  }
  const out = [];
  for (const n of notes) {
    const title = low(n.title);
    const body = low(n.body);
    let score = terms.length ? 0 : 1;
    let at = -1;
    let ok = true;
    for (const t of terms) {
      const ti = title.indexOf(t);
      const bi = body.indexOf(t);
      if (ti < 0 && bi < 0 && !(n.aliases || []).some((x) => low(x).includes(t))) { ok = false; break; }
      if (ti >= 0) score += ti === 0 ? 40 : 20;
      if (bi >= 0) { score += 4; if (at < 0) at = bi; }
    }
    if (!ok) continue;
    out.push({ n, score, at, len: terms[0]?.length || 0 });
  }
  out.sort((x, y) => y.score - x.score || String(x.n.title).localeCompare(String(y.n.title), 'de'));
  const lim = Math.max(1, Math.min(500, a.limit || (terms.length ? 40 : 300)));
  return {
    gesamt: out.length,
    treffer: out.slice(0, lim).map(({ n, at, len }) => ({
      id: n.id, titel: n.title, ordner: n.folder || '', tags: n.tags || [], typ: n.kind || null, sichtbarkeit: n.visibility,
      ...(at >= 0 ? { auszug: snippet(n.body || '', at, len) } : {}), geaendert: date(n.updatedAt),
    })),
  };
});

tool('notiz_lesen', 'Notiz lesen', 'Liest eine Notiz vollständig (per ID oder Titel/Alias) inkl. Rückverweisen und – für die Spielleitung – dem geheimen SL-Teil.', S({
  kampagne: KAMPAGNE, id: str('Notiz-ID'), titel: str('Titel oder Alias'),
}), RO, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  const n = await ctx.findNote(k, a);
  const notes = await ctx.notes(k);
  const names = [n.title, ...(n.aliases || [])].map(low);
  const backlinks = notes.filter((x) => x.id !== n.id && (x.links || []).some((l) => names.includes(low(l)))).map((x) => x.title);
  const secret = k.gm ? await ctx.fs.get(k.p(`secrets/${n.id}`)).catch(() => null) : null;
  return {
    id: n.id, titel: n.title, ordner: n.folder || '', sichtbarkeit: n.visibility, tags: n.tags || [], aliase: n.aliases || [], typ: n.kind || null,
    text: n.body || '', verlinkt: n.links || [], rueckverweise: backlinks, ...(k.gm ? { slGeheimnis: secret?.body || '' } : {}),
    erstellt: date(n.createdAt), geaendert: date(n.updatedAt),
  };
});

tool('notiz_erstellen', 'Notiz erstellen', 'Legt eine neue Notiz im Codex an (nur Spielleitung). Text in Markdown; Frontmatter (---\\ntyp: npc\\ntags: [a, b]\\naliases: [x]\\n---) und [[Wikilinks]] werden wie in der App ausgewertet. Standard-Sichtbarkeit: nur SL.', S({
  kampagne: KAMPAGNE, titel: str('Titel (wird eindeutig gemacht)'), text: str('Inhalt in Markdown'), ordner: str('Ordnerpfad, z. B. „Orte/Städte“'),
  sichtbarkeit: SICHT, geheimnis: str('Geheimer SL-Teil (für Spieler nie lesbar)'),
}, ['titel']), RW, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  needGM(k);
  const notes = await ctx.notes(k);
  const body = a.text || '';
  const id = newId(20);
  const doc = {
    title: uniqueTitle(notes, a.titel), folder: cleanFolder(a.ordner), body, visibility: vis(a.sichtbarkeit),
    ...deriveNoteFields(body), createdAt: now(), updatedAt: now(), createdBy: ctx.user.uid, updatedBy: ctx.user.uid,
  };
  await ctx.fs.set(k.p(`notes/${id}`), doc);
  if (a.geheimnis?.trim()) await ctx.fs.set(k.p(`secrets/${id}`), { body: a.geheimnis, updatedAt: now() });
  const folder = doc.folder;
  if (folder) {
    const c = await ctx.fs.get(`campaigns/${k.cid}`);
    if (!(c.folders || []).includes(folder)) await ctx.fs.update(`campaigns/${k.cid}`, { folders: [...(c.folders || []), folder] });
  }
  return { id, titel: doc.title, ordner: doc.folder };
});

tool('notiz_bearbeiten', 'Notiz bearbeiten', 'Ändert eine Notiz (nur Spielleitung): Text ersetzen, Text anhängen, gezielt Textstellen ersetzen, umbenennen (Links in anderen Notizen werden angepasst), verschieben, Sichtbarkeit oder SL-Geheimnis setzen.', S({
  kampagne: KAMPAGNE, id: str('Notiz-ID'), titel: str('Titel oder Alias der Notiz'),
  text: str('Neuer vollständiger Text (ersetzt alles)'), anhaengen: str('Text, der am Ende angehängt wird'),
  ersetzungen: { type: 'array', description: 'Gezielte Ersetzungen im Text', items: S({ suche: str('Exakter Text'), durch: str('Ersatz') }, ['suche', 'durch']) },
  neuer_titel: str('Neuer Titel'), ordner: str('Neuer Ordnerpfad ("" = oberste Ebene)'), sichtbarkeit: SICHT, geheimnis: str('Neuer SL-Geheimtext ("" = löschen)'),
}), RW, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  needGM(k);
  const n = await ctx.findNote(k, a);
  let body = a.text != null ? a.text : n.body || '';
  const missing = [];
  for (const r of a.ersetzungen || []) {
    if (!body.includes(r.suche)) missing.push(r.suche);
    else body = body.split(r.suche).join(r.durch);
  }
  if (missing.length) throw new Error(`Nicht im Text gefunden: ${missing.map((m) => `„${m.slice(0, 60)}“`).join(', ')} – nichts geändert.`);
  if (a.anhaengen) body = `${body.replace(/\s*$/, '')}\n\n${a.anhaengen}`;
  const patch = { updatedAt: now(), updatedBy: ctx.user.uid };
  if (body !== (n.body || '')) Object.assign(patch, { body }, deriveNoteFields(body));
  if (a.ordner != null) patch.folder = cleanFolder(a.ordner);
  if (a.sichtbarkeit) patch.visibility = vis(a.sichtbarkeit);
  const ops = [];
  let renamed = 0;
  if (a.neuer_titel && cleanTitle(a.neuer_titel) !== n.title) {
    const t = cleanTitle(a.neuer_titel);
    const notes = await ctx.notes(k);
    if (notes.some((x) => x.id !== n.id && low(x.title) === low(t))) throw new Error('Eine Notiz mit diesem Namen gibt es schon.');
    patch.title = t;
    const old = low(n.title);
    for (const o of notes) {
      if (o.id === n.id || !(o.links || []).some((l) => low(l) === old)) continue;
      const ob = renameLinkTarget(o.body || '', n.title, t);
      if (ob !== o.body) {
        ops.push({ op: 'update', path: k.p(`notes/${o.id}`), data: { body: ob, ...deriveNoteFields(ob), updatedAt: now() } });
        renamed++;
      }
    }
    if ((patch.body ?? n.body ?? '').match(/\[\[/)) {
      const sb = renameLinkTarget(patch.body ?? n.body ?? '', n.title, t);
      if (sb !== (patch.body ?? n.body)) Object.assign(patch, { body: sb }, deriveNoteFields(sb));
    }
  }
  ops.unshift({ op: 'update', path: k.p(`notes/${n.id}`), data: patch });
  await ctx.fs.batch(ops);
  if (a.geheimnis != null) {
    if (a.geheimnis.trim()) await ctx.fs.set(k.p(`secrets/${n.id}`), { body: a.geheimnis, updatedAt: now() });
    else await ctx.fs.remove(k.p(`secrets/${n.id}`)).catch(() => {});
  }
  return { ok: true, id: n.id, titel: patch.title || n.title, linksAngepasstIn: renamed };
});

tool('notiz_loeschen', 'Notiz löschen', 'Verschiebt eine Notiz in den Papierkorb der Kampagne (in der App wiederherstellbar). Nur Spielleitung.', S({
  kampagne: KAMPAGNE, id: str('Notiz-ID'), titel: str('Titel'),
}), DEL, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  needGM(k);
  const n = await ctx.findNote(k, a);
  const { id, ...data } = n;
  await ctx.fs.batch([
    { op: 'set', path: k.p(`trash/${id}`), data: { ...data, deletedAt: now() } },
    { op: 'delete', path: k.p(`notes/${id}`) },
  ]);
  return { ok: true, imPapierkorb: n.title };
});

tool('ordner', 'Ordner', 'Listet alle Codex-Ordner mit Anzahl Notizen. Mit „neu“ wird ein leerer Ordner angelegt (nur SL).', S({
  kampagne: KAMPAGNE, neu: str('Pfad eines neuen Ordners'),
}), RW, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  const c = await ctx.fs.get(`campaigns/${k.cid}`);
  let folders = c.folders || [];
  if (a.neu) {
    needGM(k);
    const p = cleanFolder(a.neu);
    if (p && !folders.includes(p)) {
      folders = [...folders, p];
      await ctx.fs.update(`campaigns/${k.cid}`, { folders });
    }
  }
  const notes = await ctx.notes(k);
  const counts = {};
  for (const n of notes) {
    let p = n.folder || '';
    counts[p] = (counts[p] || 0) + 1;
    while (p.includes('/')) {
      p = p.slice(0, p.lastIndexOf('/'));
      if (!(p in counts)) counts[p] = 0;
    }
  }
  const all = [...new Set([...folders, ...Object.keys(counts)])].filter(Boolean).sort((x, y) => x.localeCompare(y, 'de'));
  return { ordner: all.map((f) => ({ pfad: f, notizen: counts[f] || 0, markierung: c.folderMeta?.[f] || null })), ohneOrdner: counts[''] || 0 };
});

// ───────────────────────── Sitzungen & Quests ─────────────────────────
tool('sitzungen', 'Sitzungen', 'Listet die Sitzungen (Nummer, Titel, Datum, Status). Mit „id“ die ganze Sitzung inkl. Rückblick/Vorbereitung.', S({
  kampagne: KAMPAGNE, id: str('Sitzungs-ID für Details'),
}), RO, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  if (a.id) return ctx.fs.get(k.p(`sessions/${a.id}`));
  const list = await ctx.visibleList(k, 'sessions');
  return list.sort((x, y) => (x.number || 0) - (y.number || 0)).map((s) => ({ id: s.id, nummer: s.number, titel: s.title, datum: s.date, status: s.status, sichtbarkeit: s.visibility, rueckblickLaenge: (s.recap || '').length }));
});

tool('sitzung_speichern', 'Sitzung speichern', 'Legt eine Sitzung an oder ändert sie (nur SL). Ohne „id“ neu mit nächster Nummer.', S({
  kampagne: KAMPAGNE, id: str('ID einer bestehenden Sitzung'), nummer: num('Sitzungsnummer'), titel: str('Titel'), datum: str('Datum JJJJ-MM-TT'),
  status: str('geplant oder gespielt', { enum: ['planned', 'done'] }), rueckblick: str('Rückblick / Notizen (Markdown)'), vorbereitung: str('Vorbereitung (Markdown, Feld „prep“)'), sichtbarkeit: SICHT,
}), RW, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  needGM(k);
  const patch = {};
  if (a.nummer != null) patch.number = a.nummer;
  if (a.titel != null) patch.title = a.titel;
  if (a.datum != null) patch.date = a.datum;
  if (a.status) patch.status = a.status;
  if (a.rueckblick != null) patch.recap = a.rueckblick;
  if (a.vorbereitung != null) patch.prep = a.vorbereitung;
  if (a.sichtbarkeit) patch.visibility = vis(a.sichtbarkeit);
  if (a.id) {
    await ctx.fs.update(k.p(`sessions/${a.id}`), patch);
    return { ok: true, id: a.id };
  }
  const list = await ctx.fs.list(k.p('sessions'));
  const num = patch.number ?? list.reduce((m, s) => Math.max(m, s.number || 0), 0) + 1;
  const id = await ctx.fs.add(k.p('sessions'), {
    number: num, title: `Sitzung ${num}`, date: new Date().toISOString().slice(0, 10), status: 'planned', visibility: 'gm', recap: '', createdAt: now(), ...patch,
  });
  return { ok: true, id, nummer: num };
});

tool('quests', 'Quests', 'Listet alle Quests (Status open/active/done/failed) mit Beschreibung, Auftraggeber, Belohnung; für die SL auch die geheime Quest-Notiz.', S({ kampagne: KAMPAGNE }), RO, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  const list = await ctx.visibleList(k, 'quests');
  const secrets = k.gm ? await ctx.fs.list(k.p('gm')).catch(() => []) : [];
  return list.map((q) => ({
    id: q.id, titel: q.title, status: q.status || 'open', beschreibung: q.description || '', auftraggeber: q.giver || '', belohnung: q.reward || '', sichtbarkeit: q.visibility,
    ...(k.gm ? { slNotiz: secrets.find((s) => s.id === `quest-${q.id}`)?.body || '' } : {}),
  }));
});

tool('quest_speichern', 'Quest speichern', 'Legt eine Quest an oder ändert sie. Spieler dürfen nur den Status freigegebener Quests ändern.', S({
  kampagne: KAMPAGNE, id: str('ID einer bestehenden Quest'), titel: str('Titel'), status: str('Spalte', { enum: ['open', 'active', 'done', 'failed'] }),
  beschreibung: str('Beschreibung (Markdown)'), auftraggeber: str('Auftraggeber'), belohnung: str('Belohnung'), sichtbarkeit: SICHT, sl_notiz: str('Geheime SL-Notiz'),
}), RW, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  if (!k.gm) {
    if (!a.id || !a.status) throw new Error('Spieler können nur den Status einer freigegebenen Quest ändern (id + status).');
    await ctx.fs.update(k.p(`quests/${a.id}`), { status: a.status, updatedAt: now(), movedBy: ctx.user.uid });
    return { ok: true };
  }
  const patch = { updatedAt: now() };
  if (a.titel != null) patch.title = a.titel;
  if (a.status) patch.status = a.status;
  if (a.beschreibung != null) patch.description = a.beschreibung;
  if (a.auftraggeber != null) patch.giver = a.auftraggeber;
  if (a.belohnung != null) patch.reward = a.belohnung;
  if (a.sichtbarkeit) patch.visibility = vis(a.sichtbarkeit);
  let id = a.id;
  if (id) await ctx.fs.update(k.p(`quests/${id}`), patch);
  else {
    if (!a.titel) throw new Error('Neue Quest braucht einen Titel.');
    id = await ctx.fs.add(k.p('quests'), { title: '', status: 'open', description: '', giver: '', reward: '', visibility: 'gm', createdAt: now(), ...patch });
  }
  if (a.sl_notiz != null) await ctx.fs.set(k.p(`gm/quest-${id}`), { body: a.sl_notiz });
  return { ok: true, id };
});

// ───────────────────────── Spieltisch ─────────────────────────
tool('handouts', 'Handouts', 'Listet die an die Spieler verteilten Handouts (Titel, Text).', S({ kampagne: KAMPAGNE }), RO, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  const list = await ctx.visibleList(k, 'handouts');
  return list.sort((x, y) => (y.ts || 0) - (x.ts || 0)).map((h) => ({ id: h.id, titel: h.title, text: h.body || '', notizId: h.noteId || null, zeit: date(h.ts) }));
});

tool('handout_teilen', 'Handout teilen', 'Verteilt ein Handout (Titel + Markdown-Text) sofort an alle Spieler (nur SL). Optional aus einer Notiz.', S({
  kampagne: KAMPAGNE, titel: str('Titel'), text: str('Inhalt (Markdown)'), notiz: str('Stattdessen Titel/ID einer Codex-Notiz teilen'),
}), RW, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  needGM(k);
  let data = { title: a.titel || 'Handout', body: a.text || '' };
  if (a.notiz) {
    const n = await ctx.findNote(k, { titel: a.notiz, id: a.notiz });
    data = { title: a.titel || n.title, noteId: n.id, body: n.body || '' };
  }
  const id = await ctx.fs.add(k.p('handouts'), { ...data, visibility: 'players', ts: now(), by: ctx.user.uid });
  return { ok: true, id };
});

tool('szene_setzen', 'Szene setzen', 'Zeigt allen am Spieltisch eine Szene (Titel + Beschreibung) oder leert sie (nur SL).', S({
  kampagne: KAMPAGNE, titel: str('Titel der Szene'), text: str('Beschreibung (Markdown)'), leeren: bool('true = Szene entfernen'),
}), RW, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  needGM(k);
  const scene = a.leeren ? null : { title: a.titel || '', body: a.text || '', fileId: null, ts: now() };
  await ctx.fs.update(`campaigns/${k.cid}`, { scene, updatedAt: now() });
  return { ok: true };
});

tool('chat_lesen', 'Chat lesen', 'Liest die letzten Nachrichten aus Chat (inkl. Würfe), Flüstern an/von dir oder Play-by-Post.', S({
  kampagne: KAMPAGNE, kanal: str('chat (Standard), fluestern oder pbp', { enum: ['chat', 'fluestern', 'pbp'] }), anzahl: num('Anzahl (Standard 40)'),
}), RO, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  const n = Math.max(1, Math.min(300, a.anzahl || 40));
  let list;
  if (a.kanal === 'fluestern') {
    list = k.gm
      ? await ctx.fs.query(k.p('whispers'), { orderBy: ['ts', 'desc'], limit: n })
      : await ctx.fs.query(k.p('whispers'), { where: [['participants', 'array-contains', ctx.user.uid]], limit: 300 });
  } else list = await ctx.fs.query(k.p(a.kanal === 'pbp' ? 'posts' : 'chat'), { orderBy: ['ts', 'desc'], limit: n });
  const ms = await members(ctx, k);
  return list.sort((x, y) => (x.ts || 0) - (y.ts || 0)).slice(-n).map((m) => ({
    zeit: date(m.ts), von: m.as || m.character || m.name, konto: m.name, art: m.kind, text: m.text || '',
    ...(m.roll ? { wurf: `${m.roll.input || ''} = ${m.roll.total} (${m.roll.text || ''})${m.roll.crit ? ' KRITISCH' : m.roll.fumble ? ' PATZER' : ''}` } : {}),
    ...(m.to ? { an: m.to === 'gm' ? 'Spielleitung' : ms.find((x) => x.id === m.to)?.name || m.to } : {}),
  }));
});

tool('chat_senden', 'Nachricht senden', 'Schreibt in den Chat (Markdown), flüstert an ein Mitglied oder die SL, oder schreibt einen Play-by-Post-Beitrag. Optional mit Würfelwurf. Erscheint sofort bei allen.', S({
  kampagne: KAMPAGNE, text: str('Nachricht'), kanal: str('chat (Standard) oder pbp', { enum: ['chat', 'pbp'] }),
  an: str('Flüstern: Name eines Mitglieds oder „gm“'), als: str('Sprechername (z. B. NSC oder Charakter)'),
  art: str('pbp: narration (nur SL), action oder ooc', { enum: ['narration', 'action', 'ooc'] }), wurf: str('Würfelausdruck, z. B. 1d20+5'),
}, ['text']), RW, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  const me = ctx.user.uid;
  const ms = await members(ctx, k);
  const myName = ms.find((m) => m.id === me)?.name || ctx.user.name;
  let r = null;
  if (a.wurf) {
    const x = roll(a.wurf, a.text || '');
    r = { input: x.input, expr: x.expr, total: x.total, text: x.text, crit: x.crit, fumble: x.fumble, label: a.text || '' };
  }
  if (a.kanal === 'pbp') {
    const kind = a.art || (k.gm ? 'narration' : 'action');
    const id = await ctx.fs.add(k.p('posts'), { uid: me, name: myName, as: a.als || '', kind, text: a.text, roll: r ? { input: r.input, total: r.total, text: r.text, crit: r.crit, fumble: r.fumble } : null, ts: now() });
    return { ok: true, id, wurf: r?.total };
  }
  const base = { uid: me, name: myName, character: a.als || '', kind: r ? 'roll' : 'text', text: a.text, roll: r, ts: now() };
  if (a.an) {
    const target = low(a.an) === 'gm' || low(a.an) === 'sl' ? 'gm' : ms.find((m) => m.id === a.an || low(m.name) === low(a.an))?.id;
    if (!target) throw new Error(`Mitglied „${a.an}“ nicht gefunden: ${ms.map((m) => m.name).join(', ')}`);
    const participants = [...new Set([me, ...(target === 'gm' ? ms.filter((m) => m.role === 'gm').map((m) => m.id) : [target])])];
    await ctx.fs.add(k.p('whispers'), { ...base, from: me, to: target, participants });
  } else await ctx.fs.add(k.p('chat'), base);
  return { ok: true, wurf: r ? { summe: r.total, details: r.text } : null };
});

tool('wuerfeln', 'Würfeln', 'Würfelt einen Ausdruck (z. B. 2d6+3, 1d20+5, 4d6kh3, 2d20kl1, 1d100, W20) mit echtem Zufall. Optional ins Chat-Protokoll oder geheim an die SL.', S({
  ausdruck: str('Würfelausdruck'), bezeichnung: str('Wofür (z. B. „Wahrnehmung“)'), kampagne: KAMPAGNE,
  teilen: bool('true = im Chat der Kampagne posten'), geheim: bool('true = nur an die Spielleitung'),
}, ['ausdruck']), RW, async (ctx, a) => {
  const x = roll(a.ausdruck, a.bezeichnung || '');
  const res = { ausdruck: x.expr, summe: x.total, details: x.text, kritisch: x.crit, patzer: x.fumble };
  if (a.teilen || a.geheim) {
    const k = await ctx.campaign(a.kampagne);
    const ms = await members(ctx, k);
    const me = ctx.user.uid;
    const data = { uid: me, name: ms.find((m) => m.id === me)?.name || ctx.user.name, kind: 'roll', text: a.bezeichnung || '', character: '', roll: { input: x.input, expr: x.expr, total: x.total, text: x.text, crit: x.crit, fumble: x.fumble, label: a.bezeichnung || '', notes: [] }, ts: now() };
    if (a.geheim) await ctx.fs.add(k.p('whispers'), { ...data, from: me, to: 'gm', participants: [...new Set([me, ...ms.filter((m) => m.role === 'gm').map((m) => m.id)])] });
    else await ctx.fs.add(k.p('chat'), data);
    res.gepostet = true;
  }
  return res;
});

// ───────────────────────── Charaktere ─────────────────────────
tool('charaktere', 'Charaktere der Gruppe', 'Listet die Charaktere der Kampagne (Name, Klasse, Stufe, TP, RK, Besitzer) sowie eigene Charaktere des Kontos.', S({ kampagne: KAMPAGNE }), RO, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  const ms = await members(ctx, k);
  const brief = (c, owner) => ({ id: c.id, besitzerUid: owner, name: c.name, klasse: c.cls || (c.classes || []).map((x) => x.cls).join(' / '), stufe: c.level, volk: c.speciesName || c.speciesKey || c.race || '', tp: c.hp, maxTp: c.maxHp, tempTp: c.tempHp || 0, rk: c.ac, zustaende: c.conditions || [] });
  const party = [];
  for (const m of ms) {
    if (!m.characterId) continue;
    const c = await ctx.fs.get(`users/${m.id}/characters/${m.characterId}`).catch(() => null);
    if (c) party.push({ ...brief(c, m.id), spieler: m.name });
  }
  const own = await ctx.fs.list(`users/${ctx.user.uid}/characters`).catch(() => []);
  return { gruppe: party, eigeneCharaktere: own.map((c) => ({ ...brief(c, ctx.user.uid), kampagne: c.campaignId || null })) };
});

tool('charakter_lesen', 'Charakterbogen lesen', 'Liest einen vollständigen Charakterbogen (alle Felder als JSON).', S({
  besitzer_uid: str('UID des Besitzers (aus „charaktere“; eigene: weglassen)'), id: str('Charakter-ID'),
}, ['id']), RO, async (ctx, a) => {
  const c = await ctx.fs.get(`users/${a.besitzer_uid || ctx.user.uid}/characters/${a.id}`);
  if (!c) throw new Error('Charakter nicht gefunden.');
  return c;
});

tool('charakter_aendern', 'Charakterbogen ändern', 'Ändert Felder eines Charakterbogens (oberste Ebene, z. B. {"hp": 12, "tempHp": 5, "conditions": ["vergiftet"], "inspiration": true, "xp": 900}). Eigene Bögen immer; fremde nur als SL der verknüpften Kampagne. Vorher mit charakter_lesen die Feldnamen prüfen.', S({
  besitzer_uid: str('UID des Besitzers (eigene: weglassen)'), id: str('Charakter-ID'), felder: { type: 'object', description: 'Zu setzende Felder', additionalProperties: true },
}, ['id', 'felder']), RW, async (ctx, a) => {
  const path = `users/${a.besitzer_uid || ctx.user.uid}/characters/${a.id}`;
  const f = { ...a.felder, updatedAt: now() };
  if ('campaignId' in f) delete f.campaignId;
  await ctx.fs.update(path, f);
  return { ok: true, geaendert: Object.keys(a.felder) };
});

// ───────────────────────── Monster & Zauber ─────────────────────────
const crNum = (cr) => {
  const s = String(cr ?? '');
  if (s.includes('/')) { const [x, y] = s.split('/'); return Number(x) / Number(y); }
  return Number(s) || 0;
};

tool('monster_suchen', 'Monster suchen', 'Sucht Monster im SRD-Kompendium (317 Monster, deutsch) und/oder im eigenen Bestiarium der Kampagne (nur SL). Mit „id“ den vollständigen Statblock.', S({
  kampagne: KAMPAGNE, suche: str('Name oder Typ'), quelle: str('srd, eigen oder beide (Standard)', { enum: ['srd', 'eigen', 'beide'] }),
  hg_min: num('Herausforderungsgrad ab'), hg_max: num('Herausforderungsgrad bis'), id: str('ID für Details (bei eigenen Monstern mit quelle=eigen)'),
}), RO, async (ctx, a) => {
  const src = a.quelle || 'beide';
  let own = [];
  if (src !== 'srd') {
    const k = await ctx.campaign(a.kampagne).catch((e) => (src === 'eigen' ? Promise.reject(e) : null));
    if (k?.gm) own = await ctx.fs.list(k.p('monsters'));
  }
  if (a.id) {
    const m = (src !== 'srd' && own.find((x) => x.id === a.id)) || (src !== 'eigen' && MONSTERS.find((x) => x.id === a.id));
    if (!m) throw new Error('Monster nicht gefunden.');
    return m;
  }
  const q = low(a.suche).trim();
  const fit = (m) => (!q || low(m.name).includes(q) || low(m.type).includes(q) || low(m.en).includes(q))
    && (a.hg_min == null || crNum(m.cr) >= a.hg_min) && (a.hg_max == null || crNum(m.cr) <= a.hg_max);
  const row = (m, quelle) => ({ id: m.id, quelle, name: m.name, typ: m.type, groesse: m.size, hg: m.cr, rk: m.ac, tp: m.hp, welt: m.origin || (quelle === 'srd' ? DND : null) });
  const out = [
    ...(src !== 'srd' ? own.filter(fit).map((m) => row(m, 'eigen')) : []),
    ...(src !== 'eigen' ? MONSTERS.filter(fit).map((m) => row(m, 'srd')) : []),
  ];
  return { gesamt: out.length, treffer: out.slice(0, 60) };
});

tool('monster_speichern', 'Monster ins Bestiarium', 'Kopiert ein SRD-Monster ins Bestiarium der Kampagne oder legt ein eigenes Monster an bzw. ändert es (nur SL). Eigene Statblöcke im Format der SRD-Monster (name, size, type, alignment, ac, hp, hpDice, speed, abilities{str,dex,con,int,wis,cha}, cr, traits[], actions[] …).', S({
  kampagne: KAMPAGNE, srd_id: str('ID eines SRD-Monsters zum Kopieren'), id: str('ID eines eigenen Monsters zum Ändern'),
  statblock: { type: 'object', description: 'Statblock / zu ändernde Felder', additionalProperties: true }, welt: str('Herkunftswelt, z. B. „The Witcher“, „Eigene Kreation“'),
}), RW, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  needGM(k);
  if (a.id) {
    await ctx.fs.update(k.p(`monsters/${a.id}`), { ...(a.statblock || {}), ...(a.welt ? { origin: a.welt } : {}), updatedAt: now() });
    return { ok: true, id: a.id };
  }
  let data;
  if (a.srd_id) {
    const m = MONSTERS.find((x) => x.id === a.srd_id);
    if (!m) throw new Error('SRD-Monster nicht gefunden.');
    const { qty, ...rest } = normalizeMonster(m);
    data = { ...rest, srdId: m.id, origin: DND, ...(a.statblock || {}) };
  } else {
    if (!a.statblock?.name) throw new Error('Eigener Statblock braucht mindestens „name“.');
    const { qty, ...rest } = normalizeMonster(a.statblock);
    data = { ...rest, origin: a.welt || 'Eigene Kreation' };
  }
  const id = await ctx.fs.add(k.p('monsters'), JSON.parse(JSON.stringify({ ...data, createdAt: now() })));
  return { ok: true, id, name: data.name };
});

tool('zauber_suchen', 'Zauber suchen', 'Sucht Zauber im SRD (deutsch, Regeln 2014 oder 2024) nach Name, Klasse, Grad oder Schule. Mit „id“ die vollständige Beschreibung.', S({
  suche: str('Name (deutsch oder englisch) oder Stichwort'), regelwerk: str('2014 oder 2024 (Standard: Regelwerk der Kampagne, sonst 2024)', { enum: ['2014', '2024'] }),
  klasse: str('z. B. magier, kleriker, druide, barde, hexenmeister, zauberer, paladin, waldlaeufer'), grad: num('Zaubergrad (0 = Zaubertrick)'), id: str('Zauber-ID für Details'), kampagne: KAMPAGNE,
}), RO, async (ctx, a) => {
  let ed = a.regelwerk;
  if (!ed) ed = await ctx.campaign(a.kampagne).then(async (k) => (await ctx.fs.get(`campaigns/${k.cid}`))?.settings?.rulesVersion).catch(() => null) || '2024';
  const list = ed === '2014' ? SPELLS_2014 : SPELLS_2024;
  if (a.id) {
    const s = list.find((x) => x.id === a.id);
    if (!s) throw new Error('Zauber nicht gefunden.');
    return { regelwerk: ed, ...s };
  }
  const q = low(a.suche).trim();
  const out = list.filter((s) => (!q || low(s.name).includes(q) || low(s.en).includes(q) || low((s.desc || []).join(' ')).includes(q))
    && (!a.klasse || (s.classes || []).includes(low(a.klasse))) && (a.grad == null || s.level === a.grad));
  out.sort((x, y) => (low(y.name).includes(q) ? 1 : 0) - (low(x.name).includes(q) ? 1 : 0) || x.level - y.level || x.name.localeCompare(y.name, 'de'));
  return { regelwerk: ed, gesamt: out.length, treffer: out.slice(0, 60).map((s) => ({ id: s.id, name: s.name, en: s.en, grad: s.level, schule: s.school, klassen: s.classes, zeit: s.time, reichweite: s.range, dauer: s.duration, konzentration: s.conc, ritual: s.ritual })) };
});

// ───────────────────────── Kampf & Karten ─────────────────────────
tool('kampf_status', 'Kampf ansehen', 'Zeigt den laufenden Kampf: Runde, wer am Zug ist, Initiative, TP/Zustände/Konzentration, letzte Protokollzeilen. Die SL sieht alle Werte, Spieler die öffentliche Ansicht.', S({
  kampagne: KAMPAGNE, protokoll: num('Anzahl Protokollzeilen (Standard 20)'),
}), RO, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  const st = await ctx.fs.get(k.p(k.gm ? 'combat/gm' : 'combat/public'));
  if (!st) return { aktiv: false };
  const n = a.protokoll ?? 20;
  if (!k.gm) return { aktiv: st.active, runde: st.round, amZug: st.list?.find((c) => c.id === st.currentId)?.name || null, kaempfer: st.list, protokoll: (n > 0 ? (st.log || []).slice(-n) : []) };
  const cur = st.combatants?.[st.turn];
  return {
    aktiv: !!st.active, runde: st.round, amZug: cur?.name || null, karteId: st.mapId || null,
    kaempfer: (st.combatants || []).map((c) => ({
      id: c.id, name: c.name, ini: c.init, sc: !!c.isPC, verbuendet: !!c.ally, tp: c.hp, maxTp: c.maxHp, tempTp: c.tempHp || 0, rk: c.ac,
      zustaende: (c.conditions || []).map((x) => x.name || x), konzentration: c.concentration?.name || null, tot: !!c.dead, versteckt: !!c.hidden,
    })),
    zonen: (st.zones || []).map((z) => z.name || z.label || z.id),
    protokoll: (n > 0 ? (st.log || []).slice(-n) : []).map((l) => l.text || l),
  };
});

tool('karten', 'Karten', 'Listet Welt-, Raster- und Dungeon-Karten (Name, Typ, Größe, Sichtbarkeit). Karten selbst zeichnet man in der App.', S({ kampagne: KAMPAGNE }), RO, async (ctx, a) => {
  const k = await ctx.campaign(a.kampagne);
  const list = await ctx.visibleList(k, 'maps');
  return list.map((m) => ({ id: m.id, name: m.name || m.title, typ: m.type, breite: m.w, hoehe: m.h, stil: m.style, sichtbarkeit: m.visibility, objekte: (m.objects || []).length, formen: (m.shapes || []).length }));
});

// ───────────────────────── Direkter Datenzugriff ─────────────────────────
const PFAD = str('Firestore-Pfad, z. B. „campaigns/{kampagnenId}/encounters“ oder „users/{uid}/notes/{id}“ (siehe Datenmodell der App)');

tool('daten_lesen', 'Daten lesen (Experte)', 'Liest ein beliebiges Dokument (gerade Anzahl Pfadteile) oder listet eine Sammlung (ungerade). Für alles, was kein eigenes Werkzeug hat: encounters, tokens, pins, party, users/{uid}/notes (Tagebuch) … Spieler-Abfragen auf Sammlungen mit Sichtbarkeit brauchen nur_spieler=true.', S({
  pfad: PFAD, nur_spieler: bool('Filter visibility == players (für Spieler nötig)'), limit: num('Maximal (Standard 100)'), felder: { type: 'array', items: { type: 'string' }, description: 'Nur diese Felder zurückgeben (spart Platz bei großen Dokumenten)' },
}, ['pfad']), RO, async (ctx, a) => {
  const p = cleanPath(a.pfad);
  const pick = (d) => (a.felder?.length ? Object.fromEntries(['id', ...a.felder].filter((f) => f in d).map((f) => [f, d[f]])) : d);
  if (p.split('/').length % 2 === 0) {
    const d = await ctx.fs.get(p);
    return d ? pick(d) : { gefunden: false };
  }
  const lim = Math.max(1, Math.min(1000, a.limit || 100));
  const list = a.nur_spieler ? await ctx.fs.query(p, { where: [['visibility', '==', 'players']], limit: lim }) : await ctx.fs.list(p, { max: lim });
  return { anzahl: list.length, dokumente: list.slice(0, lim).map(pick) };
});

tool('daten_schreiben', 'Daten schreiben (Experte)', 'Schreibt ein Dokument. modus „merge“ (Standard) ändert nur die angegebenen obersten Felder, „set“ ersetzt das Dokument komplett, „add“ legt in der Sammlung ein neues Dokument mit zufälliger ID an. Firestore kennt keine verschachtelten Listen. Werkzeuge mit eigenem Namen bevorzugen.', S({
  pfad: PFAD, daten: { type: 'object', additionalProperties: true, description: 'Felder' }, modus: str('merge, set oder add', { enum: ['merge', 'set', 'add'] }),
}, ['pfad', 'daten']), RW, async (ctx, a) => {
  const p = cleanPath(a.pfad);
  const mode = a.modus || 'merge';
  if (mode === 'add') {
    if (p.split('/').length % 2 === 0) throw new Error('„add“ braucht einen Sammlungspfad.');
    return { ok: true, id: await ctx.fs.add(p, a.daten) };
  }
  if (p.split('/').length % 2 !== 0) throw new Error('Pfad muss auf ein Dokument zeigen.');
  await ctx.fs.set(p, a.daten, { merge: mode === 'merge' });
  return { ok: true };
});

tool('daten_loeschen', 'Dokument löschen (Experte)', 'Löscht ein einzelnes Dokument endgültig (kein Papierkorb). Für Notizen stattdessen notiz_loeschen verwenden.', S({ pfad: PFAD }, ['pfad']), DEL, async (ctx, a) => {
  const p = cleanPath(a.pfad);
  if (p.split('/').length % 2 !== 0) throw new Error('Pfad muss auf ein Dokument zeigen.');
  await ctx.fs.remove(p);
  return { ok: true };
});

export const INSTRUCTIONS = `Weltenschmiede ist eine D&D-5e-Kampagnen-App (deutsch) unter https://claudidorer-420.github.io/weltenschmiede/.
Alle Werkzeuge arbeiten mit dem verbundenen Konto; Änderungen erscheinen sofort live in der App bei allen Mitspielern.
- Beginne mit „kampagnen“. Hat das Konto mehrere Kampagnen, gib „kampagne“ (Name oder ID) an.
- Codex = Markdown-Notizen im Obsidian-Stil mit [[Wikilinks]], #Tags und Frontmatter (typ, tags, aliases). Vor dem Bearbeiten lesen; für kleine Änderungen „ersetzungen“ oder „anhaengen“ statt den ganzen Text neu zu schreiben.
- Sichtbarkeit: „gm“ = nur Spielleitung, „players“ = Spieler sehen es. Neue Inhalte standardmäßig „gm“; nichts ohne Wunsch für Spieler freigeben.
- Spieler-Konten dürfen nur lesen, was freigegeben ist, und nur eigene Dinge ändern.
- Antworte dem Nutzer auf Deutsch.`;

export async function callTool(fs, user, name, args) {
  const h = HANDLERS[name];
  if (!h) throw new Error(`Unbekanntes Werkzeug: ${name}`);
  return h(new Ctx(fs, user), args || {});
}
