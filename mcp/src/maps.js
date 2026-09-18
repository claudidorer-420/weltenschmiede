// Kartenwerkstatt über MCP: Katalog, Lesen und Bauen von Dungeon-/Gelände-Karten (Typ „scrawl“).
// Katalog, Stile, Generatoren und Streu-Sets kommen direkt aus der App (maprender.js, mapgen.js, mapassets.js) –
// was dort hinzukommt, steht nach dem nächsten Deploy automatisch hier zur Verfügung. Unbekannte Felder an
// Elementen und Karteneinstellungen werden unverändert übernommen.
import { STAMPS, TEXTURES } from '../../js/data/mapassets.js';
import { PROC, FLUIDS, LEGACY, MAT_TEX } from '../../js/views/maprender.js';
import { STYLES, MATS, SETS, SCRAWL_GENERATORS, scatter } from '../../js/views/mapgen.js';

const now = () => Date.now();
const low = (s) => String(s ?? '').toLowerCase();
const r2 = (v) => Math.round(Number(v) * 100) / 100;
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const uid = (n = 6) => { let s = ''; for (const b of crypto.getRandomValues(new Uint8Array(n))) s += ID_CHARS[b % 36]; return s; };

const STAMP_BY_ID = new Map(STAMPS.map((s) => [s.id, s]));
const TEX_BY_ID = new Map(TEXTURES.map((t) => [t.id, t]));

// Elementlisten der Karte (deutscher Name → Feld). Weitere Listen gehen über „listen“.
const LISTS = { raeume: 'shapes', gelaende: 'terrain', objekte: 'objects', beschriftungen: 'labels', lichter: 'lights' };
const SHAPE_KINDS = ['rect', 'ellipse', 'poly', 'path', 'brush'];
// Felder, die nicht über „einstellungen“ gesetzt werden (eigene Parameter oder intern)
const PROTECTED = new Set(['id', 'type', 'createdAt', 'shapes', 'terrain', 'objects', 'labels', 'lights', 'thumb', 'bake']);

function assetInfo(key) {
  const i = String(key).indexOf(':');
  const src = i < 0 ? '' : key.slice(0, i);
  const id = i < 0 ? key : key.slice(i + 1);
  if (src === 'ph') { const s = STAMP_BY_ID.get(id); return s ? { key, name: s.name, cat: s.cat, w: s.w, h: s.h } : null; }
  if (src === 'p') { const p = PROC[id]; return p ? { key, name: p.name, cat: p.cat, w: p.w, h: p.h, door: !!p.door, block: !!p.block, layer: p.layer || 'obj', glow: !!p.glow } : null; }
  if (src === 'u') return { key, name: `Eigenes Asset ${id}`, cat: 'eigen', w: 1, h: 1 };
  return null;
}

// „stairs“, „p:stairs“, „ph:treasure_chest“, „treasure_chest“ oder ein altes Symbol → Schlüssel
function resolveAsset(a) {
  const k = String(a || '').trim();
  if (!k) return null;
  if (k.includes(':')) return assetInfo(k) ? k : null;
  if (PROC[k]) return `p:${k}`;
  if (STAMP_BY_ID.has(k)) return `ph:${k}`;
  if (LEGACY[k]) return LEGACY[k];
  return null;
}

// Vorschläge bei Tippfehlern: ID oder deutscher Name, auch Teilwörter
function suggest(q, list, key = (x) => x, name = (x) => x.name || '') {
  const t = low(q).replace(/^[a-z]+:/, '');
  const grams = new Set();
  for (let i = 0; i + 3 <= t.length; i++) grams.add(t.slice(i, i + 3));
  const score = (x) => { const h = `${low(key(x))} ${low(name(x))}`; return h.includes(t) ? 99 : [...grams].filter((gr) => h.includes(gr)).length; };
  return list.map((x) => [x, score(x)]).filter(([, sc]) => sc >= Math.max(1, Math.min(grams.size, Math.ceil(grams.size / 2)))).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([x]) => key(x));
}
const PROC_LIST = Object.entries(PROC).map(([k, p]) => ({ key: `p:${k}`, name: p.name }));

function validMat(mat) {
  const m = String(mat || '');
  if (m.startsWith('tex:')) return TEX_BY_ID.has(m.slice(4));
  return !!(FLUIDS[m] || MATS[m] || MAT_TEX[m]);
}

function flatPts(pts) {
  if (!Array.isArray(pts)) return null;
  const flat = pts.flatMap((p) => (Array.isArray(p) ? p : p && typeof p === 'object' ? [p.x, p.y] : [p])).map(Number);
  return flat.length >= 2 && flat.length % 2 === 0 && flat.every(Number.isFinite) ? flat.map(r2) : null;
}

// Ein Element prüfen und normalisieren. Unbekannte Felder bleiben erhalten.
function normalize(field, el, warn) {
  if (!el || typeof el !== 'object') throw new Error(`Ungültiges Element in ${field}.`);
  const o = { ...el, id: el.id || uid(6) };
  const label = `${field}[${o.id}]`;
  if (field === 'shapes' || field === 'terrain') {
    o.op = o.op === 'sub' ? 'sub' : 'add';
    if (!SHAPE_KINDS.includes(o.kind)) throw new Error(`${label}: kind muss ${SHAPE_KINDS.join('/')} sein.`);
    const pts = flatPts(o.pts);
    if (!pts) throw new Error(`${label}: pts braucht Zahlenpaare [x1, y1, x2, y2 …].`);
    if ((o.kind === 'rect' || o.kind === 'ellipse') && pts.length !== 4) throw new Error(`${label}: ${o.kind} braucht genau [x1, y1, x2, y2].`);
    o.pts = pts;
    if ((o.kind === 'path' || o.kind === 'brush') && !(o.w > 0)) o.w = 1;
    if (field === 'terrain') {
      if (o.op === 'add' && !validMat(o.mat)) throw new Error(`${label}: Material „${o.mat}“ unbekannt – Flüssigkeit (${Object.keys(FLUIDS).join(', ')}), difficult oder tex:<Textur-ID>.`);
    } else {
      if (o.tex && !TEX_BY_ID.has(o.tex)) throw new Error(`${label}: Bodentextur „${o.tex}“ unbekannt. Ähnlich: ${suggest(o.tex, TEXTURES, (t) => t.id).join(', ') || '–'}`);
      if (o.roof && !TEX_BY_ID.has(o.roof)) throw new Error(`${label}: Dachtextur „${o.roof}“ unbekannt.`);
    }
  } else if (field === 'objects') {
    if (!o.t || o.t === 'stamp') {
      const key = resolveAsset(o.a);
      if (!key) throw new Error(`${label}: Objekt „${o.a}“ unbekannt. Ähnlich: ${[...suggest(o.a, PROC_LIST, (p) => p.key), ...suggest(o.a, STAMPS, (s) => `ph:${s.id}`)].slice(0, 8).join(', ') || '– (karten_katalog nutzen)'}`);
      if (key.startsWith('u:')) warn.push(`${label}: eigene Assets (u:) gibt es nur auf dem Gerät der SL.`);
      o.t = 'stamp';
      o.a = key;
      o.r = Math.round(Number(o.r) || 0);
      o.s = r2(o.s ?? 1);
    }
    if (!Number.isFinite(Number(o.x)) || !Number.isFinite(Number(o.y))) throw new Error(`${label}: x und y fehlen.`);
    o.x = r2(o.x);
    o.y = r2(o.y);
  } else if (field === 'labels') {
    if (!o.text) throw new Error(`${label}: text fehlt.`);
    o.kind = o.kind === 'room' ? 'room' : o.kind || 'text';
    o.x = r2(o.x); o.y = r2(o.y);
    o.size = r2(o.size ?? (o.kind === 'room' ? 0.65 : 0.7));
  } else if (field === 'lights') {
    o.x = r2(o.x); o.y = r2(o.y);
    o.r = r2(o.r ?? 5);
    if (!o.color) o.color = 'rgba(255,190,110,.45)';
  }
  return JSON.parse(JSON.stringify(o));
}

// ───────────────────────── Textvorschau ─────────────────────────
function pointInPoly(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function nearPath(x, y, p, w) {
  for (let i = 0; i + 3 < p.length; i += 2) {
    const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= w / 2 + 0.01) return true;
  }
  return p.length === 2 && Math.hypot(p[0] - x, p[1] - y) <= w / 2;
}
function covers(s, x, y) {
  const p = s.pts || [];
  if (s.kind === 'rect') return x >= Math.min(p[0], p[2]) && x <= Math.max(p[0], p[2]) && y >= Math.min(p[1], p[3]) && y <= Math.max(p[1], p[3]);
  if (s.kind === 'ellipse') {
    const cx = (p[0] + p[2]) / 2, cy = (p[1] + p[3]) / 2, rx = Math.abs(p[2] - p[0]) / 2, ry = Math.abs(p[3] - p[1]) / 2;
    return rx > 0 && ry > 0 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  }
  if (s.kind === 'poly') return pointInPoly(x, y, p);
  return nearPath(x, y, p, s.w || 1);
}

export function preview(m, { max = 120 } = {}) {
  const W = Math.min(m.w || 36, max), H = Math.min(m.h || 26, max);
  const g = Array.from({ length: H }, () => Array(W).fill(m.outdoor ? ',' : ' '));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cx = x + 0.5, cy = y + 0.5;
    // wie renderReal: außen liegt Gelände unter den Böden, innen nur auf den Böden
    const terrain = () => { for (const t of m.terrain || []) if (covers(t, cx, cy)) g[y][x] = t.op === 'sub' ? (m.outdoor ? ',' : '.') : FLUIDS[t.mat] ? '~' : t.mat === 'difficult' ? '%' : ':'; };
    if (m.outdoor) terrain();
    for (const s of m.shapes || []) if (covers(s, cx, cy)) g[y][x] = s.op === 'sub' ? (m.outdoor ? ',' : ' ') : s.wall ? '#' : '.';
    if (!m.outdoor && g[y][x] === '.') terrain();
  }
  const put = (x, y, ch) => { const cx = Math.floor(x), cy = Math.floor(y); if (cy >= 0 && cy < H && cx >= 0 && cx < W) g[cy][cx] = ch; };
  for (const o of m.objects || []) {
    const info = assetInfo(o.a || LEGACY[o.t] || '');
    put(o.x, o.y, info?.door ? 'D' : info?.glow ? '*' : info?.block ? '#' : (info?.cat || '').match(/baum|pflanze|natur/) ? 'T' : 'o');
  }
  for (const l of m.labels || []) if (l.kind === 'room') put(l.x, l.y, String(l.text).slice(-1));
  const ruler = (k) => Array.from({ length: W }, (_, i) => String(Math.floor(i / k) % 10)).join('');
  return [
    `    ${W > 10 ? ruler(10) : ''}`, `    ${ruler(1)}`,
    ...g.map((row, y) => `${String(y).padStart(3)} ${row.join('')}`),
    'Legende: . Boden  # Wand/Block  ~ Flüssigkeit  : Gelände  % schwierig  D Tür  * Licht/Feuer  o Objekt  T Pflanze  Ziffer = Raumnummer',
  ].join('\n');
}

// ───────────────────────── Registrierung ─────────────────────────
export function registerMapTools({ tool, S, str, num, bool, KAMPAGNE, RO, RW, needGM }) {
  const MAP = str('Karte (ID oder Name)');
  const anyObj = (description) => ({ type: 'object', description, additionalProperties: true });
  const arr = (description) => ({ type: 'array', description, items: { type: 'object', additionalProperties: true } });

  async function findMap(ctx, k, ref) {
    if (!ref) throw new Error('Bitte „karte“ angeben (ID oder Name).');
    const direct = await ctx.fs.get(k.p(`maps/${ref}`)).catch(() => null);
    if (direct) return direct;
    const list = await ctx.visibleList(k, 'maps');
    const r = low(ref).trim();
    const m = list.find((x) => low(x.name) === r) || list.find((x) => low(x.name).includes(r));
    if (!m) throw new Error(`Karte „${ref}“ nicht gefunden. Vorhanden: ${list.map((x) => `${x.name} (${x.id})`).join(', ') || '–'}`);
    return m;
  }

  tool('karten_katalog', 'Kartenkatalog', 'Alles, was man auf Dungeon-/Geländekarten bauen kann – direkt aus der App: Stempel (3D-Modelle, ph:), Bauteile (Türen, Treppen, Fallen, Licht …, p:), Texturen (Boden/Wand/Dach/Gelände), Flüssigkeiten, Generatoren, Streu-Sets, Stile, Karteneinstellungen und die Formate aller Elemente. Vor dem Bauen aufrufen.', S({
    bereich: str('uebersicht (Standard: Formate + Zahlen), stempel, bauteile, texturen, gelaende, generatoren, streusets, stile', { enum: ['uebersicht', 'stempel', 'bauteile', 'texturen', 'gelaende', 'generatoren', 'streusets', 'stile'] }),
    suche: str('Filter nach Name, ID, Kategorie oder Schlagwort (z. B. „tür“, „fass“, „moebel“, „wand“)'),
    limit: num('Maximale Einträge (Standard 150)'),
  }), RO, async (ctx, a) => {
    const q = low(a.suche).trim();
    const fit = (...xs) => !q || xs.some((x) => low(x).includes(q));
    const lim = Math.max(1, Math.min(1000, a.limit || 150));
    const cut = (list) => ({ gesamt: list.length, eintraege: list.slice(0, lim) });
    switch (a.bereich || 'uebersicht') {
      case 'stempel': return cut(STAMPS.filter((s) => fit(s.id, s.name, s.cat, s.tags)).map((s) => ({ a: `ph:${s.id}`, name: s.name, kat: s.cat, felder: `${s.w}×${s.h}`, tags: s.tags || '' })));
      case 'bauteile': return cut(Object.entries(PROC).filter(([k, p]) => fit(k, p.name, p.cat)).map(([k, p]) => ({ a: `p:${k}`, name: p.name, kat: p.cat, felder: `${p.w}×${p.h}`, ...(p.door ? { tuer: true } : {}), ...(p.block ? { blockiert: true } : {}), ...(p.glow ? { leuchtet: true } : {}), ...(p.layer ? { ebene: p.layer } : {}) })));
      case 'texturen': return cut(TEXTURES.filter((t) => fit(t.id, t.name, t.cat)).map((t) => ({ id: t.id, name: t.name, kat: t.cat, kachelMeter: t.m })));
      case 'gelaende': return {
        fluessigkeiten: Object.entries(FLUIDS).map(([k, f]) => ({ mat: k, name: f.label })),
        klassisch: Object.entries(MATS).map(([k, f]) => ({ mat: k, name: f.label })),
        texturen: 'mat: "tex:<Textur-ID>" – alle Texturen aus bereich=texturen (kat gelaende/pflaster/boden)',
      };
      case 'generatoren': return Object.entries(SCRAWL_GENERATORS).map(([k, g]) => ({ generator: k, name: g.label }));
      case 'streusets': return Object.entries(SETS).map(([k, s]) => ({ set: k, name: s.label, stempel: s.keys.length, groesse: s.s }));
      case 'stile': return Object.entries(STYLES).map(([k, s]) => ({ stil: k, name: s.label, realistisch: !!s.real }));
      default: return {
        anzahl: { stempel: STAMPS.length, bauteile: Object.keys(PROC).length, texturen: TEXTURES.length, fluessigkeiten: Object.keys(FLUIDS).length, generatoren: Object.keys(SCRAWL_GENERATORS).length, streusets: Object.keys(SETS).length },
        koordinaten: '1 Feld = 1,5 m. x nach rechts, y nach unten, (0,0) oben links. Feldmitte = x.5. Punkte immer flach: pts [x1, y1, x2, y2, …].',
        einstellungen: {
          name: 'Name', w: 'Breite in Feldern', h: 'Höhe in Feldern', style: `Stil: ${Object.keys(STYLES).join(', ')} (real = Texturen, 3D-Objekte, Licht)`,
          outdoor: 'Außenkarte (Untergrund sichtbar)', ground: 'Untergrund-Textur (z. B. dark_rock, leafy_grass)', floorTex: 'Standard-Bodentextur', wallTex: 'Wandtextur (kat wand)',
          wallW: 'Wandstärke 0,15–0,8', dark: 'Dunkelheit 0–0,9', soft: 'weiche Geländeübergänge 0–1', roofs: 'Dächer zeigen (true/false)', gridOn: 'Raster zeigen', hatch: 'Schraffur 0–2,5 (klassische Stile)',
          bgAlpha: 'Deckkraft der Bildvorlage', visibility: 'gm oder players', 'fog.enabled': 'Nebel des Krieges (einstellungen: { fog: { enabled: true } })',
          weitere: 'Unbekannte Felder werden unverändert gespeichert (für künftige Funktionen).',
        },
        formate: {
          raeume: '{ kind: rect|ellipse|poly|path|brush, pts, op?: add|sub (sub = ausschneiden), tex?: Bodentextur, roof?: Dachtextur, w?: Breite bei path/brush, wall?: 1 (dünne Wandlinie) } – Wände entstehen automatisch um Böden',
          gelaende: '{ kind: rect|ellipse|poly|brush|path, pts, mat: water|deepwater|swamp|lava|pit|blood|ice|difficult|tex:<id>, op?, w? }',
          objekte: '{ a: "p:door" | "ph:treasure_chest" | kurz "door", x, y, r?: Grad, s?: Größe (1 = echte Größe), fx?: 1 gespiegelt, layer?: floor|obj|top, z?: Reihenfolge in der Ebene (größer liegt oben), sh?: Schatten } – Türen auf die Raumkante setzen (r 0 = waagrechte Wand, 90 = senkrechte)',
          beschriftungen: '{ kind: room|text, text, x, y, size? }',
          lichter: '{ x, y, r: Radius in Feldern, color?: "rgba(255,190,110,.45)", i?: Stärke }',
        },
        tipps: [
          'Räume als rect-Böden anlegen, Gänge als path mit w 1; zwischen getrennten Räumen mind. 1 Feld Abstand lassen, sonst verschmelzen sie.',
          'Türen: Objekt p:door/p:doorIron/p:portcullis/p:secret genau auf die Grenze zwischen Gang und Raum.',
          'Fackeln (p:torch) und Kohlebecken (p:brazier) leuchten von selbst; „dark“ 0,3–0,6 macht Kerker stimmungsvoll.',
          'Nach dem Bauen mit karte_lesen die Textvorschau prüfen.',
        ],
      };
    }
  });

  tool('karte_lesen', 'Karte lesen', 'Liest eine Karte: Einstellungen, alle Elemente mit IDs (Räume, Gelände, Objekte mit Namen, Beschriftungen, Lichter) und eine Textvorschau des Grundrisses. Ohne „karte“: Liste aller Karten.', S({
    kampagne: KAMPAGNE, karte: MAP,
    teile: { type: 'array', items: { type: 'string', enum: ['einstellungen', 'raeume', 'gelaende', 'objekte', 'beschriftungen', 'lichter', 'vorschau', 'alles'] }, description: 'Nur diese Teile (Standard: einstellungen, vorschau und Anzahl)' },
    bereich: { type: 'array', items: { type: 'number' }, description: 'Nur Elemente in [x1, y1, x2, y2]' },
  }), RO, async (ctx, a) => {
    const k = await ctx.campaign(a.kampagne);
    if (!a.karte) {
      const list = await ctx.visibleList(k, 'maps');
      return list.map((m) => ({ id: m.id, name: m.name, typ: m.type, groesse: m.w ? `${m.w}×${m.h}` : null, stil: m.style || null, sichtbarkeit: m.visibility, geaendert: m.updatedAt ? new Date(m.updatedAt).toISOString().slice(0, 16) : null }));
    }
    const m = await findMap(ctx, k, a.karte);
    if (m.type !== 'scrawl') return { id: m.id, name: m.name, typ: m.type, hinweis: 'Bild-/Rasterkarte – nur Dungeon-Karten (scrawl) lassen sich bauen.', felder: Object.keys(m) };
    const parts = new Set(a.teile?.length ? a.teile : ['einstellungen', 'vorschau']);
    const all = parts.has('alles');
    const box = a.bereich?.length === 4 ? a.bereich : null;
    const inBox = (e) => {
      if (!box) return true;
      const xs = e.pts ? e.pts.filter((_, i) => i % 2 === 0) : [e.x];
      const ys = e.pts ? e.pts.filter((_, i) => i % 2 === 1) : [e.y];
      return Math.max(...xs) >= box[0] && Math.min(...xs) <= box[2] && Math.max(...ys) >= box[1] && Math.min(...ys) <= box[3];
    };
    const out = { id: m.id, name: m.name, anzahl: Object.fromEntries(Object.entries(LISTS).map(([de, f]) => [de, (m[f] || []).length])) };
    if (all || parts.has('einstellungen')) {
      out.einstellungen = Object.fromEntries(Object.entries(m).filter(([key, v]) => !PROTECTED.has(key) && !Array.isArray(v) && key !== 'fog'));
      out.einstellungen.fog = { enabled: !!m.fog?.enabled };
      const extra = Object.keys(m).filter((key) => Array.isArray(m[key]) && !Object.values(LISTS).includes(key));
      if (extra.length) out.weitereListen = extra;
    }
    for (const [de, f] of Object.entries(LISTS)) {
      if (!all && !parts.has(de)) continue;
      out[de] = (m[f] || []).filter(inBox).map((e) => (f === 'objects' ? { ...e, name: assetInfo(e.a || LEGACY[e.t] || '')?.name || e.t } : e));
    }
    if (all || parts.has('vorschau')) out.vorschau = preview(m);
    return out;
  });

  tool('karte_erstellen', 'Karte erstellen/ändern', 'Erstellt eine neue Dungeon-/Geländekarte oder ändert eine bestehende (mit „karte“). Alles in einem Aufruf und in dieser Reihenfolge: generator → einstellungen/groesse → entfernen → aendern → hinzufuegen → streuen. Formate und alle verfügbaren Objekte/Texturen: karten_katalog. Die Antwort enthält eine Textvorschau. Nur Spielleitung.', S({
    kampagne: KAMPAGNE,
    karte: str('ID oder Name einer bestehenden Karte (weglassen = neue Karte)'),
    name: str('Name (neue Karte oder umbenennen)'),
    breite: num('Breite in Feldern (neu: Standard 36)'), hoehe: num('Höhe in Feldern (neu: Standard 26)'),
    verschieben: { type: 'array', items: { type: 'number' }, description: '[dx, dy] – alle Elemente verschieben (z. B. beim Vergrößern nach links/oben)' },
    stil: str('Stil, z. B. real (Standard), klassisch, pergament, blaupause, dunkel'),
    generator: str('Generator aus dem Katalog (dungeon, hoehle, taverne, tempel, lichtung, wald, dorf, leer …). Bei bestehenden Karten nur mit ersetzen=true'),
    ersetzen: bool('true = bestehenden Inhalt komplett durch den Generator ersetzen'),
    sichtbarkeit: str('gm oder players', { enum: ['gm', 'players'] }),
    einstellungen: anyObj('Karteneinstellungen, z. B. { "dark": 0.5, "wallTex": "old_stone_wall", "floorTex": "worn_brick_floor", "ground": "dark_rock", "outdoor": false, "fog": { "enabled": true } } – unbekannte Felder werden übernommen'),
    hinzufuegen: {
      type: 'object', additionalProperties: false, description: 'Neue Elemente (IDs werden vergeben, eigene IDs erlaubt)',
      properties: { raeume: arr('Böden/Räume/Gänge'), gelaende: arr('Gelände & Flüssigkeiten'), objekte: arr('Stempel, Bauteile, Türen'), beschriftungen: arr('Raumnummern & Texte'), lichter: arr('Lichtquellen'), listen: anyObj('Weitere Listenfelder der Karte: { feldname: [ … ] }') },
    },
    aendern: arr('Elemente per ID ändern: [{ "id": "abc123", "x": 4.5, "r": 90, "tex": "marble_01" }] – gesucht wird in allen Listen'),
    entfernen: {
      type: 'object', additionalProperties: false, description: 'Elemente entfernen',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Element-IDs' },
        bereich: { type: 'array', items: { type: 'number' }, description: '[x1, y1, x2, y2] – alles, was vollständig darin liegt' },
        listen: { type: 'array', items: { type: 'string', enum: ['raeume', 'gelaende', 'objekte', 'beschriftungen', 'lichter'] }, description: 'Nur in diesen Listen (mit bereich) oder – ohne ids/bereich – diese Listen komplett leeren' },
        objekt: str('Nur Objekte dieses Typs, z. B. „p:torch“ (mit bereich oder allein)'),
      },
    },
    streuen: arr('Zufällig verteilen: [{ "set": "fels", "anzahl": 20, "bereich": [x1, y1, x2, y2] }] – Sets aus karten_katalog bereich=streusets, oder { "objekte": ["ph:…", "p:…"], "anzahl", "bereich", "groesse": [0.8, 1.2] }'),
  }), RW, async (ctx, a) => {
    const k = await ctx.campaign(a.kampagne);
    needGM(k);
    const warn = [];
    let m;
    let isNew = false;
    if (a.karte) {
      m = await findMap(ctx, k, a.karte);
      if (m.type !== 'scrawl') throw new Error('Nur Dungeon-/Geländekarten (scrawl) lassen sich bauen.');
    } else {
      isNew = true;
      const w = Math.round(a.breite || 36);
      const h = Math.round(a.hoehe || 26);
      m = { name: a.name || 'Neue Karte', type: 'scrawl', w, h, style: a.stil || 'real', gridOn: true, hatch: 1, shapes: [], terrain: [], objects: [], labels: [], lights: [], outdoor: false, ground: 'dark_rock', floorTex: 'stone_tiles', wallTex: 'castle_brick_01', dark: 0, fog: { enabled: false, revealed: '0'.repeat(w * h) }, visibility: 'gm', createdAt: now() };
    }
    const W0 = m.w || 36;
    const H0 = m.h || 26;

    // 1. Generator
    if (a.generator) {
      const g = SCRAWL_GENERATORS[a.generator];
      if (!g) throw new Error(`Generator „${a.generator}“ unbekannt: ${Object.keys(SCRAWL_GENERATORS).join(', ')}`);
      if (!isNew && !a.ersetzen) throw new Error('Diese Karte hat schon Inhalt – für einen Generator ersetzen=true setzen.');
      const gw = Math.round(a.breite || W0);
      const gh = Math.round(a.hoehe || H0);
      Object.assign(m, g.fn(gw, gh), { w: gw, h: gh });
    }

    // 2. Einstellungen, Größe, Verschieben
    if (a.name) m.name = a.name;
    if (a.stil) {
      if (!STYLES[a.stil]) throw new Error(`Stil „${a.stil}“ unbekannt: ${Object.keys(STYLES).join(', ')}`);
      m.style = a.stil;
    }
    if (a.sichtbarkeit) m.visibility = a.sichtbarkeit;
    for (const [key, v] of Object.entries(a.einstellungen || {})) {
      if (PROTECTED.has(key)) { warn.push(`Einstellung „${key}“ ignoriert (eigener Parameter).`); continue; }
      if (['ground', 'floorTex', 'wallTex'].includes(key) && v && !TEX_BY_ID.has(v)) throw new Error(`Textur „${v}“ für ${key} unbekannt. Ähnlich: ${suggest(v, TEXTURES, (t) => t.id).join(', ') || '–'}`);
      if (key === 'fog') m.fog = { ...(m.fog || {}), ...v, revealed: m.fog?.revealed || '' };
      else if (key === 'w' || key === 'h') m[key] = Math.round(v);
      else if (v === null) delete m[key];
      else m[key] = v;
    }
    if (a.breite && !a.generator) m.w = Math.round(a.breite);
    if (a.hoehe && !a.generator) m.h = Math.round(a.hoehe);
    const [dx, dy] = a.verschieben?.length === 2 ? a.verschieben.map(Number) : [0, 0];
    if (dx || dy) {
      for (const f of Object.values(LISTS)) m[f] = (m[f] || []).map((e) => (e.pts ? { ...e, pts: e.pts.map((v, i) => r2(v + (i % 2 ? dy : dx))) } : { ...e, x: r2(e.x + dx), y: r2(e.y + dy) }));
    }
    if (m.w < 4 || m.h < 4 || m.w > 200 || m.h > 200) throw new Error('Kartengröße muss zwischen 4 und 200 Feldern liegen.');
    if (m.w !== W0 || m.h !== H0 || dx || dy || !m.fog?.revealed) {
      const old = String(m.fog?.revealed || '').padEnd(W0 * H0, '0');
      let rev = '';
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const ox = x - Math.round(dx), oy = y - Math.round(dy);
        rev += ox >= 0 && oy >= 0 && ox < W0 && oy < H0 && !isNew ? old[oy * W0 + ox] : '0';
      }
      m.fog = { enabled: !!m.fog?.enabled, ...(m.fog || {}), revealed: rev };
    }

    // 3. Entfernen
    let removed = 0;
    const en = a.entfernen;
    if (en) {
      const ids = new Set(en.ids || []);
      const box = en.bereich?.length === 4 ? en.bereich : null;
      const fields = (en.listen?.length ? en.listen : Object.keys(LISTS)).map((de) => LISTS[de]);
      const objKey = en.objekt ? resolveAsset(en.objekt) || en.objekt : null;
      const inside = (e) => {
        const xs = e.pts ? e.pts.filter((_, i) => i % 2 === 0) : [e.x];
        const ys = e.pts ? e.pts.filter((_, i) => i % 2 === 1) : [e.y];
        return Math.min(...xs) >= box[0] && Math.max(...xs) <= box[2] && Math.min(...ys) >= box[1] && Math.max(...ys) <= box[3];
      };
      const byId = new Set();
      const wipe = !ids.size && !box && !objKey && en.listen?.length;
      for (const key of Object.keys(m)) {
        if (!Array.isArray(m[key]) || !m[key].some((e) => e && typeof e === 'object')) continue;
        const before = m[key].length;
        m[key] = m[key].filter((e) => {
          if (ids.has(e?.id)) { byId.add(e.id); return false; }
          if (!fields.includes(key)) return true;
          if (wipe) return false;
          if (!box && !objKey) return true;
          if (objKey && !(key === 'objects' && e.a === objKey)) return true;
          return box ? !inside(e) : false;
        });
        removed += before - m[key].length;
      }
      const missing = [...ids].filter((x) => !byId.has(x));
      if (missing.length) warn.push(`entfernen: IDs nicht gefunden: ${missing.join(', ')}`);
    }

    // 4. Ändern
    let changed = 0;
    for (const patch of a.aendern || []) {
      if (!patch?.id) throw new Error('aendern: jedes Element braucht eine id.');
      let hit = false;
      for (const key of Object.keys(m)) {
        if (!Array.isArray(m[key])) continue;
        const i = m[key].findIndex((e) => e?.id === patch.id);
        if (i < 0) continue;
        const merged = { ...m[key][i], ...patch };
        for (const [pk, pv] of Object.entries(patch)) if (pv === null) delete merged[pk];
        m[key][i] = Object.values(LISTS).includes(key) ? normalize(key, merged, warn) : merged;
        hit = true;
        changed++;
      }
      if (!hit) warn.push(`aendern: ID „${patch.id}“ nicht gefunden.`);
    }

    // 5. Hinzufügen
    const added = {};
    for (const [de, list] of Object.entries(a.hinzufuegen || {})) {
      if (de === 'listen') {
        for (const [key, items] of Object.entries(list || {})) {
          if (PROTECTED.has(key) && !Object.values(LISTS).includes(key)) throw new Error(`Liste „${key}“ ist geschützt.`);
          if (!Array.isArray(items)) throw new Error(`listen.${key} muss eine Liste sein.`);
          m[key] = [...(Array.isArray(m[key]) ? m[key] : []), ...items.map((e) => (Object.values(LISTS).includes(key) ? normalize(key, e, warn) : { id: uid(6), ...e }))];
          added[key] = items.length;
        }
        continue;
      }
      const f = LISTS[de];
      const items = (list || []).map((e) => normalize(f, e, warn));
      m[f] = [...(m[f] || []), ...items];
      added[de] = items.map((e) => e.id);
    }

    // 6. Streuen
    let scattered = 0;
    for (const sc of a.streuen || []) {
      const n = Math.max(1, Math.min(500, Math.round(sc.anzahl || 10)));
      const b = sc.bereich?.length === 4 ? sc.bereich : [0, 0, m.w, m.h];
      const at = () => ({ x: b[0] + 0.3 + Math.random() * Math.max(0.1, b[2] - b[0] - 0.6), y: b[1] + 0.3 + Math.random() * Math.max(0.1, b[3] - b[1] - 0.6) });
      const out = [];
      if (sc.set) {
        if (!SETS[sc.set]) throw new Error(`Streu-Set „${sc.set}“ unbekannt: ${Object.keys(SETS).join(', ')}`);
        scatter(out, sc.set, n, at);
      } else if (sc.objekte?.length) {
        const keys = sc.objekte.map((x) => resolveAsset(x) || (() => { throw new Error(`Streuen: Objekt „${x}“ unbekannt.`); })());
        const [s0, s1] = sc.groesse?.length === 2 ? sc.groesse : [0.9, 1.2];
        for (let i = 0; i < n; i++) { const p = at(); out.push({ id: uid(6), t: 'stamp', a: keys[Math.floor(Math.random() * keys.length)], x: r2(p.x), y: r2(p.y), r: Math.floor(Math.random() * 360), s: r2(s0 + Math.random() * (s1 - s0)), ...(Math.random() < 0.5 ? { fx: 1 } : {}) }); }
      } else throw new Error('streuen braucht „set“ oder „objekte“.');
      m.objects = [...(m.objects || []), ...out];
      scattered += out.length;
    }

    // Außerhalb der Karte?
    const outside = (m.objects || []).filter((o) => o.x < 0 || o.y < 0 || o.x > m.w || o.y > m.h).length;
    if (outside) warn.push(`${outside} Objekt(e) liegen außerhalb der Karte (${m.w}×${m.h}).`);

    // Speichern
    const { id: mapId, ...doc } = m;
    doc.updatedAt = now();
    doc.thumb = null; // Vorschaubild erzeugt der Editor beim nächsten Öffnen und Speichern
    const clean = JSON.parse(JSON.stringify(doc));
    const size = JSON.stringify(clean).length;
    if (size > 950_000) throw new Error(`Karte zu groß für Firestore (${Math.round(size / 1024)} KB, max. ~950 KB) – weniger Objekte oder kleinere Karte.`);
    let id = mapId;
    if (isNew) id = await ctx.fs.add(k.p('maps'), clean);
    else await ctx.fs.set(k.p(`maps/${id}`), clean);

    return {
      ok: true, id, name: m.name, neu: isNew, groesse: `${m.w}×${m.h}`,
      anzahl: Object.fromEntries(Object.entries(LISTS).map(([de, f]) => [de, (m[f] || []).length])),
      ...(Object.keys(added).length ? { hinzugefuegt: added } : {}), ...(removed ? { entfernt: removed } : {}), ...(changed ? { geaendert: changed } : {}), ...(scattered ? { gestreut: scattered } : {}),
      ...(warn.length ? { hinweise: warn } : {}),
      vorschau: preview(m),
      oeffnen: 'In der App: Karten → Karte öffnen (Vorschaubild erscheint nach dem ersten Speichern im Editor).',
    };
  });
}
