// Kampf auf der Karte – ein Rundenspiel nach D&D 5e: Initiativeleiste, Kampfleiste im Stil von Baldur's Gate 3,
// Zielen mit Reichweite, Sichtlinie und Trefferchance, getrennte Treffer- und Schadenswürfe (Schaden und Zustände
// wirken sofort), Zonen, Gelegenheitsangriffe, Bewegung nach Aktionsökonomie, Pings und Monster aus dem Kompendium.
import { html, useState, useEffect, useRef } from '../lib/preact.js';
import { col, myName } from '../core/app.js';
import { openView } from '../core/workspace.js';
import { db } from '../core/db.js';
import { useCol, useDoc } from '../core/hooks.js';
import { watchParty } from '../core/party.js';
import { doRoll } from '../core/rolls.js';
import { mutateCombat, combatantForToken, combatantFromCharacter, combatantsFromMonsters, makeCombatant, resort, hpState } from '../core/combat.js';
import { sendEvent } from '../core/relay.js';
import * as E from '../core/engine.js';
import * as A from '../core/actions.js';
import { classLevel } from '../data/chargen.js';
import { DAMAGE_ART } from '../data/artmap.js';
import {
  CELL_M, sizeCells, cellDistance, pointCellDistance, tokenCenter, reachable, pathTo, templateFor, inArea, tokensInArea, monsterSpeed, fmtMeters, lineOfSight, pointInSight, areaReaches,
} from '../core/tactics.js';
import { MonsterArt, creatureType, monsterIconName, giImage } from '../ui/art.js';
import { Icon, IconBtn, Btn, Statblock, toast, openModal, openMenu, promptDialog, confirmDialog } from '../ui/components.js';
import { now, initials, clamp } from '../lib/util.js';
import { BattleBar, ROMAN } from './battlebar.js';

const TAU = Math.PI * 2;
const imgCache = new Map();

function imageFor(src, onload) {
  if (!src) return null;
  let im = imgCache.get(src);
  if (!im) {
    im = new Image();
    im.onload = () => onload?.();
    im.src = src;
    imgCache.set(src, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

// ───────────────────────── Zustand ─────────────────────────
// x ist immer engine-tauglich ({ combatants, turn, zones … }) – bei Spielern aus der öffentlichen Projektion gebaut
function normCombat(raw, gm) {
  if (!raw) return { active: false, round: 1, list: [], curId: null, turnKey: '', zones: [], results: [], log: [], x: { active: false, combatants: [], zones: [], turn: -1 } };
  if (gm) {
    const list = (raw.combatants || []).map((c) => ({ ...c, hpState: hpState(c) }));
    const cur = raw.active ? list[raw.turn] : null;
    return { active: !!raw.active, round: raw.round || 1, list, curId: cur?.id || null, turnKey: `${raw.round || 1}:${cur?.id || ''}`, mapId: raw.mapId || null, zones: raw.zones || [], results: raw.results || [], log: raw.log || [], x: raw };
  }
  const list = raw.list || [];
  const turn = raw.active ? list.findIndex((c) => c.id === raw.currentId) : -1;
  return {
    active: !!raw.active, round: raw.round || 1, list, curId: raw.currentId || null, turnKey: `${raw.round || 1}:${raw.currentId || ''}`, mapId: raw.mapId || null,
    zones: raw.zones || [], results: raw.results || [], log: raw.log || [], x: { ...raw, combatants: list, turn },
  };
}

export function useBattle({ cid, mapId, gm, me, tokens, grid, gridKey, redraw, rerender }) {
  const ref = useRef(null);
  if (!ref.current) ref.current = { sel: null, pending: null, hover: null, drag: null, dismissed: new Set(), placing: null, placeHidden: false, showNames: false, logOpen: false, localMove: new Map() };
  const B = ref.current;
  const raw = useDoc(cid ? col('combat') : null, gm ? 'gm' : 'public');
  const overlays = useCol(cid ? col('party') : null, { where: [['mapId', '==', mapId]] });
  const bestiary = useCol(cid && gm ? col('monsters') : null);
  const [party, setParty] = useState([]);
  const [srd, setSrd] = useState(null);
  const [, setReady] = useState(0);
  useEffect(() => (cid ? watchParty(setParty) : undefined), [cid]);
  const needSrd = gm && tokens.some((t) => t.mref?.src === 'srd');
  useEffect(() => { if (needSrd && !srd) import('../data/monsters-srd.js').then((m) => setSrd(m.MONSTERS)); }, [needSrd]);
  // Zauberlisten für die Kampfleiste (Charakter-Regelwerk und SRD-2014 für Monster)
  useEffect(() => { Promise.all([A.spellsFor(A.edNow()), A.spellsFor('2014')]).then(() => setReady((n) => n + 1)).catch(() => {}); }, []);
  useEffect(() => () => A.setBattleContext({ live: false }), []);
  const combat = normCombat(raw, gm);
  Object.assign(B, { cid, mapId, gm, me, tokens, grid, gridKey, redraw, rerender, party, srd, overlays: overlays || [], bestiary: bestiary || [], combat });
  A.setBattleContext({ tokens, grid, party, mapId, live: true });
  B.ctx = A.makeCtx(combat.x, { tokens, grid, party });
  return B;
}

const charOf = (B, t) => (t?.charId ? B.party.find((p) => p.char?.id === t.charId) || null : null);
export function statFor(B, t) {
  const cb = combatantForToken(t, B.combat.list);
  if (cb?.statblock) return cb.statblock;
  if (t?.mref?.src === 'srd') return B.srd?.find((m) => m.id === t.mref.id) || null;
  if (t?.mref?.src === 'bst') return B.bestiary.find((m) => m.id === t.mref.id) || null;
  return null;
}
const cbOfTok = (B, t) => combatantForToken(t, B.combat.list);
const cbById = (B, id) => B.combat.list.find((c) => c.id === id) || null;
const sideOfTok = (B, t) => {
  const cb = cbOfTok(B, t);
  return t.charId || cb?.isPC || cb?.ally ? 'pc' : 'npc';
};
const canControl = (B, t) => !!t && (B.gm || (!!t.ownerUid && t.ownerUid === B.me));
const canControlCb = (B, cb) => !!cb && (B.gm || (!!cb.ownerUid && cb.ownerUid === B.me));
const isTurnOf = (B, t) => !!(B.combat.active && B.combat.curId && cbOfTok(B, t)?.id === B.combat.curId);
const tokenOfCb = (B, cb) => (cb ? B.tokens.find((t) => (t.combatantId && t.combatantId === cb.id) || (cb.charId && t.charId === cb.charId) || (cb.tokenId && cb.tokenId === t.id)) || null : null);
const charLevelOf = (B, cb) => (cb ? E.statsOf(cb, B.ctx).level || 5 : 1);
const isDown = (cb) => !!cb && (cb.dead || (cb.hp != null ? cb.hp <= 0 : !!cb.down));

// ───────────────────────── Bewegung ─────────────────────────
function speedOf(B, t) {
  const pe = charOf(B, t);
  if (pe) return Math.round((Number(pe.char.speed) || 30) * 0.3 * 10) / 10;
  const sb = statFor(B, t);
  return sb ? monsterSpeed(sb) : 9;
}
function blockedFor(B, t, W) {
  const side = sideOfTok(B, t);
  const set = new Set();
  for (const o of B.tokens) {
    if (o.id === t.id || sideOfTok(B, o) === side) continue;
    if (isDown(cbOfTok(B, o))) continue;
    const n = o.size || 1;
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) set.add((o.y + dy) * W + o.x + dx);
  }
  return set;
}
// Raster mit schwierigem Gelände aus Zonen (Netz, Spinnennetz, Dornenwachstum …)
function moveGrid(B) {
  const zones = (B.combat.zones || []).filter((z) => z.difficult || z.barrier);
  if (!B.grid || !zones.length) return B.grid;
  const key = `${B.gridKey}|${zones.map((z) => `${z.id}:${z.tpl?.x}:${z.tpl?.y}:${z.tpl?.dir}:${z.follow || ''}`).join(';')}`;
  if (B._mg?.key === key) return B._mg.grid;
  const g = { ...B.grid, cost: Uint8Array.from(B.grid.cost), walk: Uint8Array.from(B.grid.walk) };
  for (const z of zones) {
    const tpl = E.zoneTpl(B.combat.x, z, B.ctx);
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (!inArea(tpl, x + 0.5, y + 0.5)) continue;
        const i = y * g.w + x;
        // Stein-, Eis- und Kraftwände versperren den Weg, Dornen & Co. sind schwieriges Gelände
        if (z.barrier) g.walk[i] = 0;
        else g.cost[i] = Math.max(g.cost[i], z.difficult >= 4 ? 3 : 2);
      }
    }
  }
  B._mg = { key, grid: g };
  return g;
}
export function moveInfo(B, t, W, H) {
  if (!canControl(B, t)) return null;
  const cb = cbOfTok(B, t);
  const turn = isTurnOf(B, t);
  let totalM;
  let remainingM;
  if (B.combat.active && cb && turn && cb.eco) {
    totalM = Number(cb.eco.moveM) || 0;
    const used = Math.max(Number(cb.eco.movedM) || 0, B.localMove.get(`${B.combat.turnKey}|${cb.id}`) || 0);
    remainingM = Math.max(0, totalM - used);
  } else {
    totalM = speedOf(B, t) || 9;
    remainingM = totalM;
  }
  const prone = !!cb && E.has(cb, E.COND.prone);
  let cells = Math.floor(remainingM / CELL_M + 1e-6);
  if (prone) cells = Math.floor(cells / 2);
  const grid = moveGrid(B);
  const key = `${t.id}|${t.x}|${t.y}|${t.size || 1}|${B.gridKey}|${cells}|${B.combat.turnKey}|${B.tokens.map((o) => `${o.x},${o.y}`).join(';')}|${B._mg?.key || ''}`;
  if (B._reach?.key === key) return B._reach;
  const r = reachable(grid, { x: t.x, y: t.y }, cells, { size: t.size || 1, blocked: blockedFor(B, t, W), W, H });
  B._reach = { key, r, remaining: cells, remainingM, totalM, turn, prone, cb };
  return B._reach;
}
// Nach dem Ziehen: Bewegung prüfen und an die SL melden (Zonen, Gelegenheitsangriffe). false = zurück an den Start
export function onTokenDrop(B, t, nx, ny, W, H) {
  if (!B.combat.active) return true;
  const cb = cbOfTok(B, t);
  const info = moveInfo(B, t, W, H);
  if (!info || !cb) return true;
  if (!info.turn) {
    if (B.gm) return true;
    toast('Du bist gerade nicht am Zug.', 'error');
    return false;
  }
  const cost = info.r.dist[ny * W + nx];
  let path = pathTo(info.r, nx, ny);
  let costM = 0;
  if (!Number.isFinite(cost)) {
    if (!B.gm) {
      toast(info.remaining ? `Zu weit – noch ${fmtMeters(info.remainingM)} Bewegung.` : 'Keine Bewegung mehr übrig.', 'error');
      return false;
    }
    toast('Außerhalb der Bewegungsreichweite – als SL trotzdem versetzt.', 'info');
    path = [[t.x, t.y], [nx, ny]];
  } else costM = cost * CELL_M * (info.prone ? 2 : 1);
  const k = `${B.combat.turnKey}|${cb.id}`;
  B.localMove.set(k, Math.max(B.localMove.get(k) || 0, Number(cb.eco?.movedM) || 0) + costM);
  B._reach = null;
  sendEvent({ type: 'move', actor: cb.id, path: (path || [[t.x, t.y], [nx, ny]]).flat(), costM, mapId: B.mapId }).catch(() => {});
  return true;
}

// ───────────────────────── Aktionen wählen & zielen ─────────────────────────
const CHOICES = {
  command: [['approach', 'Komm her'], ['drop', 'Lass fallen'], ['flee', 'Flieh'], ['grovel', 'Kriech'], ['halt', 'Halt']],
  enlarge: [['enlarge', 'Vergrößern'], ['reduce', 'Verkleinern']],
  curse: [['extra', '+1W8 nekrotisch'], ['attack', 'Nachteil gegen dich'], ['turn', 'Handlungsunfähig (WEI)']],
  shove: [['prone', 'Umstoßen'], ['push', 'Wegstoßen (1,5 m)']],
};
function choiceList(a) {
  const s = a.spec || {};
  if (a.std === 'shove') return CHOICES.shove.map(([id, label]) => ({ id, label }));
  if (s.special && CHOICES[s.special]) return CHOICES[s.special].map(([id, label]) => ({ id, label }));
  if (s.choice?.length) return s.choice.map((t) => ({ id: t, label: DAMAGE_ART[t]?.name || t }));
  if (s.condChoice?.length) return s.condChoice.map((n) => ({ id: n, label: n }));
  if (a.grant?.condChoice?.length) return a.grant.condChoice.map((n) => ({ id: n, label: n }));
  return null;
}
export function arm(B, t, a) {
  if (!t || !a) {
    B.pending = null;
    B.rerender();
    B.redraw();
    return;
  }
  armAction(B, t, a);
}
export function selectToken(B, id) {
  B.sel = id;
  B.pending = null;
  B.rerender();
  B.redraw();
}
function armAction(B, t, a) {
  const cb = cbOfTok(B, t);
  if (!cb) { toast('Dieser Token ist nicht im Kampf.', 'error'); return; }
  if (!a.state?.ok) { toast(a.state?.why || 'Gerade nicht möglich', 'info'); return; }
  const char = B.ctx.charOf(cb);
  let slots = [];
  if (a.kind === 'spell' && a.level > 0 && !a.arcanum) slots = char ? A.slotOptions(char, a.level) : a.monster ? A.monsterSlotOptions(cb, a) : [];
  const choices = choiceList(a);
  const p = { t: t.id, cb: cb.id, a, slot: slots[0]?.level || a.level || 0, pact: !!slots[0]?.pact, slots, targets: [], choice: choices?.[0]?.id || null, choices, tpl: null, dest: null };
  B.pending = p;
  const needs = a.needs || { target: 'none' };
  if ((needs.target === 'none' || needs.target === 'self') && slots.length <= 1 && !choices) {
    if (needs.target === 'self') p.targets = [cb.id];
    execute(B);
    return;
  }
  if (needs.target === 'self') p.targets = [cb.id];
  B.rerender();
  B.redraw();
}
function rangeOf(a) {
  if (a.attack) {
    const at = a.attack;
    if (at.kind === 'melee' || at.kind === 'spellMelee') {
      const reach = at.reach || 1.5;
      if (at.thrown && at.range) return { near: at.range[0], far: at.range[1], reach };
      return { near: reach, far: reach, reach };
    }
    return { near: at.range?.[0] ?? at.reach ?? 1.5, far: at.range?.[1] ?? at.range?.[0] ?? 1.5 };
  }
  const r = a.needs?.range;
  const v = r == null ? 1.5 : r;
  return { near: v, far: v };
}
function validTarget(B, p, meTok, tok, cb) {
  const a = p.a;
  const needs = a.needs || {};
  const me = cbById(B, p.cb);
  if (cb.dead && a.spec?.special !== 'revive') return { ok: false, why: `${cb.name} ist tot.` };
  if (cb.id === me?.id && !(needs.target === 'ally' || needs.selfOk)) return { ok: false, why: 'Wähle ein anderes Ziel.' };
  if (!meTok || !tok || cb.id === me?.id) return { ok: true, distM: 0 };
  const distM = cellDistance(meTok, tok) * CELL_M;
  const rg = rangeOf(a);
  if (rg.far < 900 && distM > rg.far + 1e-6) return { ok: false, why: `Außer Reichweite: ${fmtMeters(distM)} (höchstens ${fmtMeters(rg.far)})`, distM };
  // Angriffe brauchen freie Linie durch Wände; Zauber mit Sicht zusätzlich freie Sicht (Nebel, Dunkelheit)
  const needSight = !!a.attack || needs.sight;
  if (needSight && B.ctx.grid && !lineOfSight(B.ctx.grid, meTok, tok, { blocks: a.attack ? null : B.ctx.blocks })) return { ok: false, why: 'Keine Sichtlinie zum Ziel.', distM };
  return { ok: true, distM, long: !!a.attack && distM > rg.near + 1e-6 };
}
function tryTarget(B, tok) {
  const p = B.pending;
  const meTok = B.tokens.find((t) => t.id === p.t);
  const cb = cbOfTok(B, tok);
  if (!cb) { toast(`${tok.label} ist nicht im Kampf.`, 'info'); return; }
  const v = validTarget(B, p, meTok, tok, cb);
  if (!v.ok) { toast(v.why, 'error'); return; }
  const max = A.targetCount(p.a, p.slot, charLevelOf(B, cbById(B, p.cb)));
  if (!p.a.needs?.same && p.targets.includes(cb.id)) p.targets = p.targets.filter((id) => id !== cb.id);
  else if (p.targets.length < max) p.targets = [...p.targets, cb.id];
  B._tv = null;
  if (p.targets.length >= max) { execute(B); return; }
  B.rerender();
  B.redraw();
}
function pointCheck(B, p, meTok, tpl) {
  const needs = p.a.needs || {};
  if (needs.rangeKind === 'self') return { ok: true };
  const d = pointCellDistance(meTok, tpl.x, tpl.y) * CELL_M;
  const maxM = needs.range == null ? 0 : needs.range;
  if (maxM < 900 && d > maxM + 1e-6) return { ok: false, why: `Außer Reichweite: ${fmtMeters(d)} (höchstens ${fmtMeters(maxM)})` };
  if (B.ctx.grid && !pointInSight(B.ctx.grid, meTok, tpl.x, tpl.y, { blocks: B.ctx.blocks })) return { ok: false, why: 'Keine Sichtlinie zu diesem Punkt.' };
  return { ok: true };
}
function tryPoint(B, w) {
  const p = B.pending;
  const meTok = B.tokens.find((t) => t.id === p.t);
  if (!meTok) return;
  const needs = p.a.needs;
  const tpl = templateFor(needs.area, meTok, w, needs.rangeKind);
  const v = pointCheck(B, p, meTok, tpl);
  if (!v.ok) { toast(v.why, 'error'); return; }
  p.tpl = tpl;
  execute(B);
}
function cellCheck(B, p, meTok, cx, cy) {
  const needs = p.a.needs || {};
  const n = meTok.size || 1;
  if (needs.fromZone) {
    const z = (B.combat.zones || []).find((q) => q.id === needs.fromZone);
    const tpl = z ? E.zoneTpl(B.combat.x, z, B.ctx) : null;
    const d = tpl ? Math.max(Math.abs(cx + 0.5 - tpl.x), Math.abs(cy + 0.5 - tpl.y)) * CELL_M : 0;
    return d <= (needs.range || 18) + 1e-6 ? { ok: true } : { ok: false, why: `Zu weit (${fmtMeters(d)})` };
  }
  const d = pointCellDistance(meTok, cx + 0.5, cy + 0.5) * CELL_M;
  if (d > (needs.range || 9) + 1e-6) return { ok: false, why: `Außer Reichweite: ${fmtMeters(d)} (höchstens ${fmtMeters(needs.range || 9)})` };
  const g = moveGrid(B) || B.grid;
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) {
    const x = cx + dx;
    const y = cy + dy;
    if (g && (x >= g.w || y >= g.h || !g.walk[y * g.w + x])) return { ok: false, why: 'Dort ist kein freier Boden.' };
  }
  if (B.tokens.some((o) => o.id !== meTok.id && cx < o.x + (o.size || 1) && o.x < cx + n && cy < o.y + (o.size || 1) && o.y < cy + n)) return { ok: false, why: 'Das Feld ist besetzt.' };
  if (needs.sight && B.ctx.grid && !pointInSight(B.ctx.grid, meTok, cx + 0.5, cy + 0.5, { blocks: B.ctx.blocks })) return { ok: false, why: 'Keine Sicht auf dieses Feld.' };
  return { ok: true };
}
function tryCell(B, w) {
  const p = B.pending;
  const meTok = B.tokens.find((t) => t.id === p.t);
  if (!meTok) return;
  const cx = Math.floor(w.x);
  const cy = Math.floor(w.y);
  const v = cellCheck(B, p, meTok, cx, cy);
  if (!v.ok) { toast(v.why, 'error'); return; }
  p.dest = { x: cx, y: cy };
  execute(B);
}
// Klick auf die Karte während des Zielens. true = verarbeitet
export function onDown(B, w) {
  const p = B?.pending;
  if (!p) return false;
  const needs = p.a.needs || {};
  if (needs.target === 'point') { tryPoint(B, w); return true; }
  if (needs.target === 'wall') { tryWall(B, w); return true; }
  if (needs.target === 'cell') { tryCell(B, w); return true; }
  if (['enemy', 'ally', 'creature'].includes(needs.target)) {
    const t = [...B.tokens].reverse().find((x) => w.x >= x.x && w.x < x.x + (x.size || 1) && w.y >= x.y && w.y < x.y + (x.size || 1));
    if (t) tryTarget(B, t);
    else toast('Tippe auf einen Token als Ziel – oder „Abbrechen“.', 'info');
  }
  return true;
}
const roundTpl = (t) => ({ shape: t.shape, x: Math.round(t.x * 100) / 100, y: Math.round(t.y * 100) / 100, dir: Math.round((t.dir || 0) * 1000) / 1000, size: Math.round(t.size * 100) / 100, ...(t.width ? { width: t.width } : {}) });
function rollAmount(h, label) {
  const dice = h.dice || '';
  const flat = Number(h.flat) || 0;
  const expr = `${dice}${flat ? (dice ? (flat > 0 ? `+${flat}` : `${flat}`) : `${flat}`) : ''}` || '0';
  const r = doRoll(expr, { label, kind: 'heal' });
  return r ? Math.max(0, r.total) : 0;
}
// Wände (Steinwand, Feuerwand …): erster Klick = Anfang, zweiter Klick = Richtung
function wallTpl(p, w) {
  const s = p.wallStart;
  return { shape: 'line', x: s.x, y: s.y, dir: Math.atan2(w.y - s.y, w.x - s.x) || 0, size: (p.a.needs?.len || 18) / CELL_M, width: 1 };
}
function tryWall(B, w) {
  const p = B.pending;
  const meTok = B.tokens.find((t) => t.id === p.t);
  if (!meTok) return;
  if (!p.wallStart) {
    const pt = { x: Math.floor(w.x) + 0.5, y: Math.floor(w.y) + 0.5 };
    const v = pointCheck(B, { a: { needs: { ...p.a.needs, rangeKind: 'dist' } } }, meTok, pt);
    if (!v.ok) { toast(v.why, 'error'); return; }
    p.wallStart = pt;
    B.rerender();
    B.redraw();
    return;
  }
  p.tpl = wallTpl(p, w);
  execute(B);
}

// Kreaturenwahl (Beschwörung, Verwandlung, Tiergestalt) aus den SRD-Monstern
const fmtCr = (v) => (v === 0.125 ? '⅛' : v === 0.25 ? '¼' : v === 0.5 ? '½' : String(v));
function CreaturePicker({ list, close, hint, countFor }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [n, setN] = useState(1);
  const ql = q.trim().toLowerCase();
  const shown = list.filter((m) => !ql || m.name.toLowerCase().includes(ql) || String(m.type || '').toLowerCase().includes(ql)).slice(0, 80);
  const maxN = sel && countFor ? countFor(sel) : 1;
  return html`<div class="modal-body stack">
    ${hint ? html`<div class="small muted">${hint}</div>` : null}
    <input class="input" placeholder="Suchen: Wolf, Bär, Elementar …" value=${q} onInput=${(e) => setQ(e.target.value)} />
    <div class="bt-mlist" style="max-height:340px">
      ${shown.map((m) => html`<button type="button" key=${m.id} class=${`bt-mrow${sel?.id === m.id ? ' on' : ''}`} onClick=${() => { setSel(m); setN(countFor ? countFor(m) : 1); }}>
        <${MonsterArt} m=${m} size=${30} />
        <span class="grow" style="min-width:0"><b>${m.name}</b><small>HG ${m.cr} · ${m.type}${countFor ? ` · bis ${countFor(m)}×` : ''}</small></span>
      </button>`)}
      ${!shown.length ? html`<div class="tiny faint">Nichts gefunden.</div>` : null}
    </div>
    ${sel && maxN > 1 ? html`<label class="row small">Anzahl <input class="input sm" type="number" min="1" max=${maxN} value=${n} style="width:80px" onInput=${(e) => setN(Math.max(1, Math.min(maxN, parseInt(e.target.value, 10) || 1)))} /> <span class="faint">höchstens ${maxN}</span></label>` : null}
  </div>
  <div class="modal-foot"><${Btn} kind="ghost" onClick=${() => close(null)}>Abbrechen<//><${Btn} kind="primary" disabled=${!sel} onClick=${() => close({ id: sel.id, n })}>Wählen<//></div>`;
}
async function pickCreature({ title, hint, filter, countFor }) {
  const { MONSTERS } = await import('../data/monsters-srd.js');
  const list = MONSTERS.filter(filter).sort((p, q) => A.crNum(q.cr) - A.crNum(p.cr) || p.name.localeCompare(q.name, 'de'));
  if (!list.length) { toast('Keine passende Kreatur gefunden.', 'error'); return null; }
  return openModal(({ close }) => html`<${CreaturePicker} list=${list} close=${close} hint=${hint} countFor=${countFor} />`, { title, icon: 'ghost' });
}
function pickSummon(a, slot) {
  const rule = A.summonRule(a, slot);
  if (!rule) return null;
  const re = rule.types ? new RegExp(rule.types.join('|'), 'i') : null;
  return pickCreature({
    title: `${a.name}: Kreatur wählen`, hint: rule.hint, countFor: rule.count,
    filter: (m) => (rule.ids ? rule.ids.includes(m.id) : re.test(m.type || '')) && A.crNum(m.cr) <= rule.maxCr,
  });
}
function pickForm(B, form, tgt) {
  const limit = tgt.isPC ? E.statsOf(tgt, B.ctx).level || 1 : A.crNum(tgt.statblock?.cr ?? tgt.art?.cr ?? 1);
  const re = form.types ? new RegExp(form.types.join('|'), 'i') : null;
  const not = form.not ? new RegExp(form.not, 'i') : null;
  return pickCreature({
    title: `${tgt.name}: neue Gestalt`, hint: `${form.types ? 'Tiere' : 'Kreaturen'} bis HG ${fmtCr(limit)} (${tgt.isPC ? 'Stufe' : 'HG'} des Ziels).`,
    filter: (m) => (!re || re.test(m.type || '')) && (!not || !not.test(m.type || '')) && A.crNum(m.cr) <= limit,
  });
}
function pickWildShape(char) {
  const lv = classLevel(char, 'druide');
  const ed = A.edNow();
  const maxCr = lv >= 8 ? 1 : lv >= 4 ? 0.5 : 0.25;
  const noFly = lv < 8;
  const noSwim = ed === '2014' && lv < 4;
  return pickCreature({
    title: 'Tiergestalt wählen', hint: `Tiere bis HG ${fmtCr(maxCr)}${noFly ? ', ohne Fliegen' : ''}${noSwim ? ', ohne Schwimmen' : ''}.`,
    filter: (m) => /Tier/i.test(m.type || '') && A.crNum(m.cr) <= maxCr && !(noFly && m.speeds?.fly) && !(noSwim && m.speeds?.swim),
  });
}

// Aktion ausführen: Angriffswürfe hier (3D-Würfel beim Handelnden), alles Weitere entscheidet die SL-Seite
async function execute(B) {
  const p = B.pending;
  if (!p) return;
  const a = p.a;
  const x = B.combat.x;
  const cb = cbById(B, p.cb);
  if (!cb) return;
  const ctx = B.ctx;
  const char = ctx.charOf(cb);
  const spec = a.spec || {};
  const ev = { type: 'act', actor: cb.id, key: a.key, targets: [...p.targets], mapId: B.mapId };
  if (p.slot) ev.slot = p.slot;
  if (p.pact) ev.pact = true;
  if (p.choice) {
    ev.choice = p.choice;
    if (spec.condChoice) ev.condChoice = p.choice;
  }
  if (p.tpl) ev.tpl = roundTpl(p.tpl);
  if (p.dest) ev.dest = p.dest;
  // Kreatur wählen: Beschwörung, Verwandlung, Tiergestalt
  const cancel = () => { B.pending = null; B.rerender(); B.redraw(); };
  if (spec.summon) {
    const pick = await pickSummon(a, p.slot);
    if (!pick) { cancel(); return; }
    ev.summon = pick;
  }
  if (spec.special === 'polymorph') {
    const tgt = spec.form?.self ? cb : cbById(B, p.targets[0]);
    const pick = tgt ? await pickForm(B, spec.form || {}, tgt) : null;
    if (!pick) { cancel(); return; }
    ev.form = pick;
  }
  if (a.key === 'f:wildshape') {
    const pick = await pickWildShape(char);
    if (!pick) { cancel(); return; }
    ev.form = pick;
  }
  const attackish = !!a.attack && (a.kind === 'attack' || a.kind === 'granted' || ['attack', 'summonAttack'].includes(spec.use) || ['iceKnife', 'acidArrow'].includes(spec.special));
  if (attackish) {
    const att = { ...a.attack, bonus: spec.attack && a.attack.kind?.startsWith('spell') ? a.spellAttack : a.attack.bonus };
    ev.rolls = [];
    for (const tid of p.targets) {
      const tgt = cbById(B, tid);
      const plan = E.attackPlan(x, cb, tgt, att, ctx);
      const mode = plan.mode === 'adv' ? ' (Vorteil)' : plan.mode === 'dis' ? ' (Nachteil)' : '';
      const r = A.rollAttack({ attack: att }, plan, { label: `${cb.name} → ${tgt?.name || '?'}: ${a.name}${mode}`, doRoll });
      if (!r) return;
      ev.rolls.push(r);
    }
  }
  if (spec.use === 'auto') {
    const alloc = {};
    for (const id of p.targets) alloc[id] = (alloc[id] || 0) + 1;
    ev.alloc = alloc;
    ev.targets = Object.keys(alloc);
  }
  if (a.kind === 'spell' && spec.use === 'heal') {
    const h = A.healOf(a, p.slot);
    if (h) ev.amount = rollAmount(h, `${a.name} – Heilung`);
  }
  if (a.kind === 'spell' && spec.use === 'temp') {
    const tp = A.tempOf(a, p.slot);
    if (tp) ev.amount = rollAmount(tp, `${a.name} – temporäre TP`);
  }
  if (a.key === 'f:secondwind') ev.amount = rollAmount({ dice: '1d10', flat: classLevel(char, 'kaempfer') }, 'Zweiter Wind');
  if (a.key === 'f:layonhands') {
    const left = a.uses?.left ?? 0;
    const v = await promptDialog(`Wie viele Trefferpunkte heilen? (Vorrat: ${left})`, String(Math.min(left, 10)), { title: 'Handauflegen', ok: 'Heilen' });
    const n = Math.max(0, Math.min(left, parseInt(v, 10) || 0));
    if (!n) { B.pending = null; B.rerender(); return; }
    ev.amount = n;
  }
  if (a.kind === 'item' && a.heal) ev.amount = rollAmount(A.parseDmg(a.heal), a.name);
  B.pending = null;
  B._tv = null;
  B.rerender();
  B.redraw();
  if (char) await A.consumeOnUse(cb, char, a, ev);
  await sendEvent(ev).catch((e) => toast(e.message, 'error'));
}

// ───────────────────────── Kampf verwalten (SL) ─────────────────────────
export async function startCombat(B) {
  const toks = B.tokens.filter((t) => t.charId || t.mref || t.combatantId);
  if (!toks.length) { toast('Setze zuerst Tokens: „Gruppe“ oder Monster aus dem Kompendium.', 'error'); return; }
  if (toks.some((t) => t.mref?.src === 'srd') && !B.srd) B.srd = (await import('../data/monsters-srd.js')).MONSTERS;
  const links = [];
  await mutateCombat((x) => {
    x.mapId = B.mapId;
    for (const t of toks) {
      const had = combatantForToken(t, x.combatants);
      if (had) { if (t.surprised) had.surprised = true; continue; }
      let c = null;
      if (t.charId) { const pe = charOf(B, t); if (pe) c = combatantFromCharacter(pe); } else {
        const sb = statFor(B, t);
        c = sb ? combatantsFromMonsters([{ ...sb, name: t.label, qty: 1 }])[0] : makeCombatant({ name: t.label });
      }
      if (!c) continue;
      c.tokenId = t.id;
      c.hidden = t.visibility === 'gm';
      c.surprised = !!t.surprised;
      x.combatants.push(c);
      if (!t.charId) links.push([t.id, c.id]);
    }
    const ctx = A.makeCtx(x);
    for (const c of x.combatants) if (c.init == null) E.rollInitiative(x, c, ctx);
    // Vorab beschworene Kreaturen: 2014 eine Initiative je Gruppe, 2024 direkt nach dem Wirker
    const groups = {};
    for (const c of x.combatants) {
      if (!c.summonOf) continue;
      const k = x.combatants.find((o) => o.id === c.summonOf);
      if (ctx.ed === '2024' && k) c.init = (Number(k.init) || 0) - 0.01;
      else if (c.summonGroup) {
        if (groups[c.summonGroup] == null) groups[c.summonGroup] = c.init;
        else c.init = groups[c.summonGroup];
      }
    }
    x.combatants = E.sortInitiative(x.combatants);
    x.zones = [];
    x.results = [];
    x.prompts = [];
    E.beginCombat(x, ctx);
    return x;
  });
  for (const [tid, c2] of links) await db.update(col('tokens'), tid, { combatantId: c2 }).catch(() => {});
  for (const t of toks) if (t.surprised) await db.update(col('tokens'), t.id, { surprised: false }).catch(() => {});
  toast('Kampf gestartet – Initiative ist gewürfelt.', 'success');
}
export async function addTokenToCombat(B, t, sbIn = null) {
  const sb = sbIn || statFor(B, t);
  let newId = null;
  await mutateCombat((x) => {
    if (combatantForToken(t, x.combatants)) return x;
    let c;
    if (t.charId) { const pe = charOf(B, t); if (!pe) return x; c = combatantFromCharacter(pe); } else c = sb ? combatantsFromMonsters([{ ...sb, name: t.label, qty: 1 }])[0] : makeCombatant({ name: t.label });
    c.tokenId = t.id;
    c.hidden = t.visibility === 'gm';
    x.combatants.push(c);
    if (x.active) {
      E.rollInitiative(x, c, A.makeCtx(x));
      resort(x);
    }
    newId = c.id;
    E.log(x, `${c.name} betritt den Kampf`);
    return x;
  });
  if (newId && !t.charId) await db.update(col('tokens'), t.id, { combatantId: newId }).catch(() => {});
}
export async function placeMonster(B, w, W, H) {
  const m = B.placing;
  if (!m) return;
  const n = sizeCells(m);
  const same = B.tokens.filter((t) => t.mref?.id === m.id).length;
  const ty = creatureType(m.type);
  const tok = {
    mapId: B.mapId, x: clamp(Math.floor(w.x - (n - 1) / 2), 0, W - n), y: clamp(Math.floor(w.y - (n - 1) / 2), 0, H - n), label: same ? `${m.name} ${same + 1}` : m.name, size: n,
    color: ty.color, art: { icon: monsterIconName(m), color: ty.color }, mref: { src: m.src, id: m.id }, ownerUid: null, visibility: B.placeHidden ? 'gm' : 'players', createdAt: now(),
  };
  const id = await db.add(col('tokens'), tok);
  if (B.combat.active) await addTokenToCombat(B, { ...tok, id }, m);
}
const prevTurn = () => mutateCombat((x) => {
  if (!x.combatants.length) return x;
  x.turn--;
  if (x.turn < 0) { x.turn = x.combatants.length - 1; x.round = Math.max(1, (x.round || 1) - 1); }
  return x;
});
async function endCombat() {
  if (!(await confirmDialog('Kampf beenden? Die Kämpferliste bleibt im Kampf-Tracker erhalten, Zonen verschwinden.', { ok: 'Beenden' }))) return;
  await mutateCombat((x) => {
    x.active = false;
    x.turn = 0;
    x.zones = [];
    x.prompts = [];
    for (const c of x.combatants) c.eco = null;
    E.log(x, '🏁 Kampf beendet', 'round');
    return x;
  });
}
async function hpQuick(t, cb) {
  if (!cb) { toast('Erst in den Kampf aufnehmen.', 'error'); return; }
  const v = await promptDialog(`Trefferpunkte von ${t.label} ändern`, '', { title: 'Trefferpunkte', hint: 'z. B. -7 für Schaden oder +5 für Heilung (mit allen Regeln: Resistenz, 0 TP, Konzentration)', ok: 'Anwenden' });
  const n = parseInt(String(v || '').replace('−', '-'), 10);
  if (!n) return;
  await mutateCombat((x) => {
    const c = x.combatants.find((y) => y.id === cb.id);
    if (!c) return x;
    if (n < 0) E.applyDamage(x, c, [{ amount: -n, type: null }], { source: 'SL' }, A.makeCtx(x));
    else E.applyHealing(x, c, n, { source: 'SL' });
    return x;
  });
}
const COND_MENU = [...Object.values(E.COND), E.XCOND.hidden];
function condMenu(cb, e) {
  if (!cb) return;
  openMenu(e, COND_MENU.map((name) => {
    const on = (cb.conditions || []).some((k) => k.name === name);
    return {
      label: name, icon: on ? 'check' : 'activity',
      onClick: () => mutateCombat((x) => {
        const c = x.combatants.find((y) => y.id === cb.id);
        if (!c) return x;
        if (on) E.removeCondition(x, c, name, 'SL');
        else if (E.addCondition(x, c, { name }, A.makeCtx(x))) E.log(x, `⛓ ${c.name}: ${name} (SL)`);
        return x;
      }),
    };
  }));
}
async function toggleSurprised(t, cb) {
  if (cb) await mutateCombat((x) => { const c = x.combatants.find((y) => y.id === cb.id); if (c) c.surprised = !c.surprised; return x; });
  else await db.update(col('tokens'), t.id, { surprised: !t.surprised }).catch(() => {});
}
function gmMenu(B, t, cb, e, editToken) {
  const items = [];
  if (cb) {
    items.push({ label: 'Trefferpunkte ändern …', icon: 'heart', onClick: () => hpQuick(t, cb) });
    items.push({ label: 'Zustand setzen …', icon: 'activity', onClick: () => condMenu(cb, e) });
  }
  const sb = statFor(B, t);
  if (sb) items.push({ label: 'Statblock', icon: 'scroll', onClick: () => openModal(() => html`<div class="modal-body"><${Statblock} monster=${sb} /></div>`, { title: t.label, icon: 'ghost', size: 'lg' }) });
  if (!cb && (t.charId || t.mref)) items.push({ label: 'In den Kampf', icon: 'plus', onClick: () => addTokenToCombat(B, t) });
  if (!B.combat.active || !cb) items.push({ label: (cb ? cb.surprised : t.surprised) ? 'Nicht überrascht' : 'Überrascht (Kampfbeginn)', icon: 'eye-off', onClick: () => toggleSurprised(t, cb) });
  if (editToken) items.push({ label: 'Token bearbeiten', icon: 'pencil', onClick: () => editToken(t) });
  openMenu(e, items);
}
async function endConc(B, cb) {
  if (!cb?.concentration) return;
  if (!(await confirmDialog(`Konzentration auf „${cb.concentration.name}“ beenden?`, { ok: 'Beenden' }))) return;
  const char = B.ctx.charOf(cb);
  if (char && cb.ownerUid) db.update(`users/${cb.ownerUid}/characters`, char.id, { concentration: null }).catch(() => {});
  await sendEvent({ type: 'endConc', actor: cb.id }).catch(() => {});
}
export async function clearTemplates(B, { mine = false } = {}) {
  for (const o of B.overlays.filter((x) => x.kind === 'tpl' && (!mine || x.uid === B.me))) await db.remove(col('party'), o.id).catch(() => {});
}

export async function ping(B, w) {
  if (!B) return;
  const doc = { kind: 'ping', mapId: B.mapId, x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100, name: myName(), color: B.gm ? '#e0b24a' : '#4d8dff', ts: now() };
  B.localPing = doc;
  B.redraw();
  try { await db.set(col('party'), `ping-${B.me}`, doc); } catch { /* egal */ }
}
export const animating = (B) => !!B && (B.combat.active || !!B.pending || [B.localPing, ...B.overlays.filter((o) => o.kind === 'ping')].some((p) => p && now() - p.ts < 2800));

// ───────────────────────── Zeichnen ─────────────────────────
function disk(c, x, y, r, fill, stroke, lw) {
  c.beginPath();
  c.arc(x, y, Math.max(0.01, r), 0, TAU);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
}
function wtext(c, str, x, y, size, fill, halo, weight = 700) {
  c.save();
  c.scale(0.01, 0.01);
  c.font = `${weight} ${size * 100}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (halo) { c.lineWidth = size * 20; c.lineJoin = 'round'; c.strokeStyle = halo; c.strokeText(str, x * 100, y * 100); }
  c.fillStyle = fill;
  c.fillText(str, x * 100, y * 100);
  c.restore();
}
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
}
function lighten(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex || '#888';
  const n = parseInt(m[1], 16);
  const mix = (v) => Math.round(v + (255 - v) * 0.25);
  return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}
function tplPath(c, t) {
  c.beginPath();
  if (t.shape === 'cube') c.rect(t.x - t.size / 2, t.y - t.size / 2, t.size, t.size);
  else if (t.shape === 'cone') {
    const a = Math.atan(0.5);
    c.moveTo(t.x, t.y);
    c.arc(t.x, t.y, t.size, (t.dir || 0) - a, (t.dir || 0) + a);
    c.closePath();
  } else if (t.shape === 'line') {
    const ux = Math.cos(t.dir || 0);
    const uy = Math.sin(t.dir || 0);
    const px = -uy * (t.width || 1) / 2;
    const py = ux * (t.width || 1) / 2;
    c.moveTo(t.x + px, t.y + py);
    c.lineTo(t.x + ux * t.size + px, t.y + uy * t.size + py);
    c.lineTo(t.x + ux * t.size - px, t.y + uy * t.size - py);
    c.lineTo(t.x - px, t.y - py);
    c.closePath();
  } else c.arc(t.x, t.y, t.size, 0, TAU);
}
const bounds = (t, W, H) => [Math.max(0, Math.floor(t.x - t.size - 1)), Math.min(W - 1, Math.ceil(t.x + t.size + 1)), Math.max(0, Math.floor(t.y - t.size - 1)), Math.min(H - 1, Math.ceil(t.y + t.size + 1))];
function drawTpl(ctx, t, color, W, H, k, label, grid = null) {
  // betroffene Felder einfärben (so zählt das Raster; Wände halten Flächen auf), darüber die genaue Form
  ctx.fillStyle = `${color}33`;
  const [x0, x1, y0, y1] = bounds(t, W, H);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inArea(t, x + 0.5, y + 0.5) && (!grid || areaReaches(grid, t.x, t.y, x, y))) ctx.fillRect(x, y, 1, 1);
  tplPath(ctx, t);
  ctx.fillStyle = `${color}22`;
  ctx.fill();
  ctx.lineWidth = 2.5 / k;
  ctx.strokeStyle = color;
  ctx.stroke();
  if (label) wtext(ctx, label, t.x, t.y - 0.1, 0.36, '#fff', 'rgba(0,0,0,.7)');
}
function drawZone(ctx, B, z, W, H, k) {
  const tpl = E.zoneTpl(B.combat.x, z, B.ctx);
  if (!tpl) return;
  const color = /^#[0-9a-f]{6}$/i.test(z.color || '') ? z.color : '#9f7aea';
  const wall = z.barrier || z.opaque;
  if (z.obscure || wall) {
    // Nebel/Dunkelheit dunkel, Wände (Stein, Eis, Feuer …) kräftig in ihrer Farbe
    ctx.fillStyle = z.obscure ? 'rgba(16,16,24,.62)' : `${color}cc`;
    const [x0, x1, y0, y1] = bounds(tpl, W, H);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inArea(tpl, x + 0.5, y + 0.5)) ctx.fillRect(x, y, 1, 1);
  }
  ctx.setLineDash([0.25, 0.15]);
  drawTpl(ctx, tpl, color, W, H, k, z.name, wall ? null : B.ctx.grid);
  ctx.setLineDash([]);
}
const colorOf = (a) => DAMAGE_ART[a.sp?.damage?.type || a.spec?.dmg?.[0]?.[1] || a.damage?.[0]?.type]?.color || '#b07cff';
// Gültige Ziele, Trefferchance (wie BG3) – zwischengespeichert, bis sich Ziele oder Tokens ändern
function targetInfo(B, selT) {
  const p = B.pending;
  const key = `${p.a.key}|${p.slot}|${p.targets.join(',')}|${B.combat.turnKey}|${B.tokens.map((t) => `${t.id},${t.x},${t.y}`).join(';')}`;
  if (B._tv?.key === key) return B._tv.map;
  const map = new Map();
  const me = cbById(B, p.cb);
  const a = p.a;
  const att = a.attack ? { ...a.attack, bonus: a.spec?.attack && a.attack.kind?.startsWith('spell') ? a.spellAttack : a.attack.bonus } : null;
  for (const t of B.tokens) {
    const cb = cbOfTok(B, t);
    if (!cb) continue;
    const v = validTarget(B, p, selT, t, cb);
    let label = '';
    let mode = null;
    if (v.ok && att && me && cb.id !== me.id) {
      const plan = E.attackPlan(B.combat.x, me, cb, att, B.ctx);
      mode = plan.mode;
      const arrow = plan.mode === 'adv' ? ' ▲' : plan.mode === 'dis' ? ' ▼' : '';
      label = B.gm || cb.isPC ? `${Math.round(E.hitChance(att.bonus, plan.ac, plan.mode) * 100)} %${arrow}` : plan.mode === 'adv' ? '▲ Vorteil' : plan.mode === 'dis' ? '▼ Nachteil' : '';
    }
    map.set(t.id, { ...v, label, mode, cb });
  }
  B._tv = { key, map };
  return map;
}
function drawTargetUnder(ctx, B, selT, vis, W, H, k) {
  const p = B.pending;
  const a = p.a;
  const needs = a.needs || {};
  const n = selT.size || 1;
  const rg = rangeOf(a);
  const ring = !(needs.target === 'point' && needs.rangeKind === 'self') && needs.target !== 'none' && needs.target !== 'self';
  if (ring && rg.far < 200) {
    const rN = rg.near / CELL_M;
    const rL = rg.far / CELL_M;
    rrect(ctx, selT.x - rN, selT.y - rN, n + rN * 2, n + rN * 2, 0.4);
    ctx.fillStyle = 'rgba(77,141,255,.07)';
    ctx.fill();
    ctx.lineWidth = 2.5 / k;
    ctx.strokeStyle = '#4d8dff';
    ctx.stroke();
    if (rL > rN + 0.01) {
      ctx.setLineDash([8 / k, 6 / k]);
      rrect(ctx, selT.x - rL, selT.y - rL, n + rL * 2, n + rL * 2, 0.4);
      ctx.lineWidth = 2 / k;
      ctx.strokeStyle = '#f5c542';
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (['enemy', 'ally', 'creature'].includes(needs.target)) {
    const info = targetInfo(B, selT);
    for (const t of vis) {
      const v = info.get(t.id);
      if (!v || t.id === selT.id && !v.ok) continue;
      const cc = tokenCenter(t);
      const picked = p.targets.includes(v.cb.id);
      if (!v.ok) disk(ctx, cc.x, cc.y, (t.size || 1) / 2 + 0.08, null, 'rgba(239,90,95,.5)', 2 / k);
      else disk(ctx, cc.x, cc.y, (t.size || 1) / 2 + 0.08, picked ? 'rgba(138,92,245,.28)' : null, v.long ? '#f5c542' : '#3dd68c', 3.5 / k);
    }
  }
  if (needs.target === 'point' && B.hover) {
    const tpl = templateFor(needs.area, selT, B.hover, needs.rangeKind);
    const ok = pointCheck(B, p, selT, tpl).ok;
    const color = ok ? colorOf(a) : '#8a8a8a';
    drawTpl(ctx, tpl, color, W, H, k, ok ? '' : 'außer Reichweite', B.ctx.grid);
    if (ok) {
      for (const t of tokensInArea(tpl, vis)) {
        const nn = t.size || 1;
        let hit = false;
        for (let dy = 0; dy < nn && !hit; dy++) for (let dx = 0; dx < nn && !hit; dx++) if (inArea(tpl, t.x + dx + 0.5, t.y + dy + 0.5) && (!B.ctx.grid || areaReaches(B.ctx.grid, tpl.x, tpl.y, t.x + dx, t.y + dy))) hit = true;
        if (!hit || (t.id === selT.id && needs.rangeKind === 'self')) continue;
        const cc = tokenCenter(t);
        disk(ctx, cc.x, cc.y, nn / 2 + 0.08, null, '#ff5a5a', 3.5 / k);
      }
    }
  }
  if (needs.target === 'wall' && B.hover) {
    if (!p.wallStart) {
      const pt = { x: Math.floor(B.hover.x) + 0.5, y: Math.floor(B.hover.y) + 0.5 };
      const ok = pointCheck(B, { a: { needs: { ...needs, rangeKind: 'dist' } } }, selT, pt).ok;
      disk(ctx, pt.x, pt.y, 0.35, ok ? 'rgba(61,214,140,.55)' : 'rgba(239,90,95,.55)', '#fff', 2 / k);
    } else {
      drawTpl(ctx, wallTpl(p, B.hover), colorOf(p.a), W, H, k, '');
      disk(ctx, p.wallStart.x, p.wallStart.y, 0.22, '#fff', null, 0);
    }
  }
  if (needs.target === 'cell' && B.hover) {
    const cx = Math.floor(B.hover.x);
    const cy = Math.floor(B.hover.y);
    const ok = cellCheck(B, p, selT, cx, cy).ok;
    ctx.fillStyle = ok ? 'rgba(61,214,140,.35)' : 'rgba(239,90,95,.3)';
    ctx.fillRect(cx, cy, needs.fromZone ? 1 : n, needs.fromZone ? 1 : n);
  }
}
function drawTargetOver(ctx, B, selT, vis) {
  const p = B.pending;
  const needs = p.a.needs || {};
  if (!['enemy', 'ally', 'creature'].includes(needs.target)) return;
  const info = targetInfo(B, selT);
  for (const t of vis) {
    const v = info.get(t.id);
    if (!v) continue;
    const cc = tokenCenter(t);
    const nn = t.size || 1;
    if (v.ok && v.label) wtext(ctx, v.label, cc.x, t.y - 0.26, 0.34, v.mode === 'dis' ? '#ffb4b4' : v.mode === 'adv' ? '#b4ffd2' : '#fff', 'rgba(0,0,0,.85)');
    const picked = p.targets.filter((id) => id === v.cb.id).length;
    if (picked) {
      disk(ctx, cc.x + nn / 2 - 0.1, cc.y - nn / 2 + 0.1, 0.2, '#8a5cf5', '#fff', 0.04);
      wtext(ctx, picked > 1 ? `${picked}` : '✓', cc.x + nn / 2 - 0.1, cc.y - nn / 2 + 0.11, 0.22, '#fff');
    }
  }
}
function drawToken(ctx, B, t, k, tm, selected) {
  const n = t.size || 1;
  const x = t.dragX ?? t.x;
  const y = t.dragY ?? t.y;
  const cx = x + n / 2;
  const cy = y + n / 2;
  const r = n / 2 - 0.07;
  const cb = cbOfTok(B, t);
  const pe = charOf(B, t);
  const pc = !!(pe || cb?.isPC || t.charId);
  const down = isDown(cb);
  const ring = pc ? '#4d8dff' : t.art || t.mref || cb ? '#d64541' : t.color || '#e0b24a';
  ctx.globalAlpha = t.visibility === 'players' ? 1 : 0.6;
  if (cb && cb.id === B.combat.curId) {
    const pulse = 0.5 + 0.5 * Math.sin(tm / 260);
    disk(ctx, cx, cy, r + 0.12 + pulse * 0.08, 'rgba(224,178,74,.22)', '#e0b24a', (2 + pulse * 2) / k);
  }
  disk(ctx, cx + 0.03, cy + 0.06, r, 'rgba(0,0,0,.35)');
  const img = pe?.char?.portrait ? imageFor(pe.char.portrait, B.redraw) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  else if (t.art?.icon) {
    const g = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, lighten(t.art.color));
    g.addColorStop(1, '#120e0a');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const ic = giImage(t.art.icon, '#f6e8c9', B.redraw);
    if (ic?.complete && ic.naturalWidth) ctx.drawImage(ic, cx - r * 0.7, cy - r * 0.7, r * 1.4, r * 1.4);
  } else {
    ctx.fillStyle = t.color || '#e0b24a';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    wtext(ctx, initials(t.label).slice(0, 2), cx, cy + 0.02, Math.max(0.28, r * 0.8), '#111');
  }
  if (down) { ctx.fillStyle = 'rgba(20,20,20,.6)'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
  ctx.restore();
  disk(ctx, cx, cy, r, null, t.ownerUid && t.ownerUid === B.me ? '#ffffff' : ring, 0.08);
  if (down) wtext(ctx, cb?.dead || !cb?.isPC ? '☠' : cb?.stable ? '✚' : '💀', cx, cy + 0.03, r * (cb?.dead || !cb?.isPC ? 1.1 : 0.8), '#f1f1f1', 'rgba(0,0,0,.6)');
  if (cb?.concentration) { ctx.setLineDash([0.12, 0.1]); disk(ctx, cx, cy, r + 0.1, null, '#f5c542', 0.05); ctx.setLineDash([]); }
  if (cb && (cb.hp != null || cb.hpState)) {
    const frac = cb.hp != null && cb.maxHp ? Math.max(0, Math.min(1, cb.hp / cb.maxHp)) : ({ Unverletzt: 1, Angeschlagen: 0.7, Blutig: 0.4, Kritisch: 0.15, Kampfunfähig: 0, Tot: 0 })[cb.hpState] ?? 1;
    const bw = n * 0.84;
    const bx = cx - bw / 2;
    const by = y + n - 0.04;
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(bx, by, bw, 0.14);
    ctx.fillStyle = frac > 0.5 ? '#3dd68c' : frac > 0.25 ? '#f5c542' : '#ef5a5f';
    ctx.fillRect(bx + 0.02, by + 0.025, (bw - 0.04) * frac, 0.09);
    if (cb.tempHp) { ctx.fillStyle = '#7fb0ff'; ctx.fillRect(bx + 0.02, by - 0.05, Math.min(bw - 0.04, (bw - 0.04) * (cb.tempHp / (cb.maxHp || 1))), 0.05); }
  }
  (cb?.conditions || []).filter((cd) => cd.name !== E.COND.prone || !down).slice(0, 4).forEach((cd, i) => {
    const a = -Math.PI / 4 - i * 0.6;
    const px = cx + Math.cos(a) * (r + 0.02);
    const py = cy + Math.sin(a) * (r + 0.02);
    disk(ctx, px, py, 0.13, '#8a5cf5', '#fff', 0.03);
    wtext(ctx, String(cd.name || cd).slice(0, 1), px, py + 0.01, 0.15, '#fff');
  });
  if (cb?.surprised && !B.combat.active) wtext(ctx, '!', cx - r, cy - r + 0.1, 0.4, '#f5c542', 'rgba(0,0,0,.8)', 900);
  if (selected) { ctx.setLineDash([0.15, 0.1]); disk(ctx, cx, cy, r + 0.2, null, '#8a5cf5', 0.07); ctx.setLineDash([]); }
  if (selected || B.showNames) wtext(ctx, t.label, cx, y - 0.24, 0.32, '#fff', 'rgba(0,0,0,.75)');
  ctx.globalAlpha = 1;
}

// Alles, was der Kampf auf die Karte zeichnet (in Feld-Koordinaten)
export function drawBattle(ctx, s, k) {
  const B = s.B;
  if (!B) return;
  const W = s.doc.w;
  const H = s.doc.h;
  const tm = performance.now();
  const hidden = (t) => !B.gm && s.fogOn && s.fog && s.fog[Math.floor(t.y) * W + Math.floor(t.x)] !== '1';
  const vis = B.tokens.filter((t) => !hidden(t));
  for (const z of B.combat.zones || []) drawZone(ctx, B, z, W, H, k);
  for (const o of B.overlays) if (o.kind === 'tpl') drawTpl(ctx, o, o.color || '#b07cff', W, H, k, o.label);
  const selT = B.sel ? B.tokens.find((t) => t.id === B.sel) : null;
  if (selT && !B.pending && canControl(B, selT) && !B.drag) {
    const info = moveInfo(B, selT, W, H);
    if (info) {
      ctx.fillStyle = info.turn ? 'rgba(61,214,140,.18)' : 'rgba(77,141,255,.12)';
      const { dist } = info.r;
      for (let i = 0; i < dist.length; i++) if (dist[i] <= info.remaining) ctx.fillRect(i % W, Math.floor(i / W), 1, 1);
    }
  }
  if (B.pending && selT) drawTargetUnder(ctx, B, selT, vis, W, H, k);
  for (const t of vis) drawToken(ctx, B, t, k, tm, t.id === B.sel);
  if (B.pending && selT) drawTargetOver(ctx, B, selT, vis);
  if (B.drag) {
    const { t, x, y } = B.drag;
    const info = moveInfo(B, t, W, H);
    const n = t.size || 1;
    const path = info && pathTo(info.r, x, y);
    if (path && path.length > 1) {
      ctx.strokeStyle = info.turn ? '#3dd68c' : '#4d8dff';
      ctx.lineWidth = 4 / k;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      path.forEach(([px, py], i) => { if (i) ctx.lineTo(px + n / 2, py + n / 2); else ctx.moveTo(px + n / 2, py + n / 2); });
      ctx.stroke();
      const m = info.r.dist[y * W + x] * CELL_M * (info.prone ? 2 : 1);
      wtext(ctx, info.turn && B.combat.active ? `${fmtMeters(m)} · noch ${fmtMeters(Math.max(0, info.remainingM - m))}` : fmtMeters(m), x + n / 2, y - 0.4, 0.36, '#fff', 'rgba(0,0,0,.8)');
    } else if (info && B.combat.active && info.turn && (x !== t.x || y !== t.y)) wtext(ctx, 'zu weit', x + n / 2, y - 0.4, 0.36, '#ef5a5f', 'rgba(0,0,0,.8)');
  }
  for (const p of [...B.overlays.filter((o) => o.kind === 'ping'), B.localPing]) {
    if (!p) continue;
    const age = (now() - p.ts) / 1000;
    if (age < -1 || age > 2.6) continue;
    for (let i = 0; i < 3; i++) {
      const a = (Math.max(0, age) * 1.2 + i * 0.33) % 1;
      ctx.globalAlpha = (1 - a) * 0.9;
      disk(ctx, p.x, p.y, 0.3 + a * 2.2, null, p.color || '#e0b24a', 3.5 / k);
    }
    ctx.globalAlpha = 1;
    if (age < 2) wtext(ctx, p.name || '', p.x, p.y - 0.9, 0.4, '#fff', 'rgba(0,0,0,.7)');
  }
}

// ───────────────────────── Oberfläche ─────────────────────────
function TokenArt({ B, t, cb, size = 32 }) {
  const pe = t ? charOf(B, t) : null;
  if (pe?.char?.portrait) return html`<span class="bt-art" style=${{ width: `${size}px`, height: `${size}px`, backgroundImage: `url(${pe.char.portrait})` }}></span>`;
  const sb = B.gm && t ? statFor(B, t) : null;
  if (sb) return html`<${MonsterArt} m=${sb} size=${size} />`;
  if (cb?.statblock) return html`<${MonsterArt} m=${cb.statblock} size=${size} />`;
  if (cb?.art) return html`<${MonsterArt} m=${cb.art} size=${size} />`;
  if (t?.art) return html`<${MonsterArt} m=${{ name: t.label, icon: t.art.icon, color: t.art.color }} size=${size} />`;
  return html`<span class="bt-art ini" style=${{ width: `${size}px`, height: `${size}px`, background: t?.color || cb?.color || '#7a7a7a' }}>${initials(t?.label || cb?.name || '?').slice(0, 2)}</span>`;
}

function TurnStrip({ B, s }) {
  const c = B.combat;
  const list = c.list.filter((x) => (B.gm || !x.hidden) && !x.vanish);
  const myCb = list.find((x) => x.isPC && x.ownerUid === B.me);
  const rollMyInit = () => {
    const pe = B.party.find((p) => p.char?.id === myCb.charId);
    const bonus = pe ? E.statsOf(myCb, B.ctx).init ?? 0 : 0;
    const r = doRoll(`1d20${bonus >= 0 ? '+' : ''}${bonus}`, { label: 'Initiative', character: myCb.name, kind: 'init' });
    if (r) sendEvent({ type: 'init', value: r.total, charId: myCb.charId || null });
  };
  return html`<div class="bt-strip">
    <span class=${`bt-round${c.active ? '' : ' idle'}`}>${c.active ? `Runde ${c.round}` : 'Vorbereitung'}</span>
    <div class="bt-order">${list.map((x) => {
      const t = tokenOfCb(B, x);
      const frac = x.hp != null && x.maxHp ? Math.max(0, Math.min(1, x.hp / x.maxHp)) : ({ Unverletzt: 1, Angeschlagen: 0.7, Blutig: 0.4, Kritisch: 0.15, Kampfunfähig: 0, Tot: 0 })[x.hpState] ?? 1;
      const down = isDown(x);
      const ini = x.init != null ? Math.round(x.init) : '–';
      const tip = [`${x.name} · Initiative ${ini}`, x.form ? `Verwandelt: ${x.form.name}` : '', ...(x.conditions || []).map((k) => k.name), x.concentration ? `Konzentration: ${x.concentration.name}` : '', x.surprised ? 'überrascht' : '', t ? '' : '(kein Token auf dieser Karte)'].filter(Boolean).join('\n');
      return html`<button type="button" key=${x.id} class=${`bt-chip${x.id === c.curId ? ' cur' : ''}${down ? ' down' : ''}${x.isPC ? ' pc' : ' npc'}${x.hidden ? ' hid' : ''}`}
        title=${tip} onClick=${() => { if (t) { s.focusToken?.(t); selectToken(B, t.id); } }}>
        <${TokenArt} B=${B} t=${t} cb=${x} size=${34} />
        <b class="ini">${ini}</b>
        <span class="nm">${x.dead ? '☠ ' : ''}${x.name}</span>
        <i class="hp"><i style=${{ width: `${frac * 100}%`, background: frac > 0.5 ? '#3dd68c' : frac > 0.25 ? '#f5c542' : '#ef5a5f' }}></i></i>
        ${(x.conditions || []).length ? html`<i class="bt-cdot" title=${(x.conditions || []).map((k) => k.name).join(', ')}>${x.conditions.length}</i>` : null}
      </button>`;
    })}</div>
    <div class="bt-ctl">
      <${IconBtn} icon="scroll" title="Kampfprotokoll" active=${B.logOpen} onClick=${() => { B.logOpen = !B.logOpen; B.rerender(); }} />
      ${B.gm && c.active ? html`<${IconBtn} icon="skip-back" title="Vorheriger Zug (ohne Regeln)" onClick=${prevTurn} /><${Btn} size="sm" kind="primary" icon="skip-forward" onClick=${() => { B.pending = null; sendEvent({ type: 'endTurn' }).catch(() => {}); }}>Nächster Zug<//><${IconBtn} icon="stop" title="Kampf beenden" onClick=${endCombat} /><${IconBtn} icon="list" title="Kampf-Tracker (Liste mit allen Werten)" onClick=${() => openView('combat')} />` : null}
      ${B.gm && !c.active ? html`<${Btn} size="sm" kind="primary" icon="swords" onClick=${() => startCombat(B)}>Kampf starten<//>` : null}
      ${!B.gm && myCb && myCb.init == null ? html`<${Btn} size="sm" icon="d20" onClick=${rollMyInit}>Initiative<//>` : null}
    </div>
  </div>`;
}

function CombatLog({ B }) {
  const ref = useRef();
  const lines = (B.combat.log || []).slice(-100);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [lines.length]);
  return html`<div class="bt-log" ref=${ref}>
    ${lines.length ? lines.map((l, i) => html`<div key=${i} class=${`bt-logl ${l.kind || ''}`}>${B.gm ? l.gm || l.text : l.text}</div>`) : html`<div class="tiny faint">Noch keine Einträge.</div>`}
  </div>`;
}

function StatusChips({ cb }) {
  const conds = cb.conditions || [];
  const effs = (cb.effects || []).filter((e) => !e.silent && e.name);
  const zero = cb.isPC && cb.hp <= 0 && !cb.dead;
  if (!conds.length && !effs.length && !cb.concentration && !cb.surprised && !cb.dead && !zero) return null;
  return html`<div class="bt-stat">
    ${cb.dead ? html`<span class="cond">☠ tot</span>` : null}
    ${zero ? html`<span class="cond">Todesrettungswürfe ${cb.deathSaves?.s || 0}✓ ${cb.deathSaves?.f || 0}✗${cb.stable ? ' · stabil' : ''}</span>` : null}
    ${cb.surprised ? html`<span class="cond">überrascht</span>` : null}
    ${conds.map((k, i) => html`<span class="cond" key=${`c${i}`}>${k.name}${k.label ? ` (${k.label})` : ''}${k.rounds ? ` · ${k.rounds} R.` : ''}</span>`)}
    ${effs.map((e) => html`<span class="eff" key=${e.id}>${e.name}${e.rounds ? ` · ${e.rounds} R.` : ''}</span>`)}
    ${cb.concentration ? html`<span class="conc">◎ ${cb.concentration.name}</span>` : null}
  </div>`;
}

function InfoCard({ B, t, editToken }) {
  const cb = cbOfTok(B, t);
  const pe = charOf(B, t);
  const sb = B.gm ? statFor(B, t) : null;
  const hpTxt = cb && cb.hp != null ? `${cb.hp}/${cb.maxHp}${cb.tempHp ? ` +${cb.tempHp}` : ''}` : cb?.hpState || (pe ? `${pe.char.hp}/${pe.char.maxHp}` : null);
  const ac = cb && (B.gm || cb.isPC) ? E.statsOf(cb, B.ctx).ac : pe ? pe.char.ac ?? null : null;
  const sub = pe ? `${pe.char.species || ''} · ${pe.char.cls || ''} ${pe.char.level || ''}` : sb ? `${sb.size || ''} ${sb.type || ''} · HG ${sb.cr || '?'}` : cb?.art?.type || (cb ? (cb.isPC ? 'Spielercharakter' : 'Kreatur') : 'Token');
  return html`<div class="bt-info">
    <div class="bt-head">
      <${TokenArt} B=${B} t=${t} cb=${cb} size=${40} />
      <div class="grow" style="min-width:0"><b>${t.label}</b><div class="tiny muted">${sub}</div></div>
      ${hpTxt ? html`<span class="bt-pill"><${Icon} name="heart" size=${13} />${hpTxt}</span>` : null}
      ${ac != null ? html`<span class="bt-pill"><${Icon} name="shield" size=${13} />${ac}</span>` : null}
      ${B.gm ? html`<${IconBtn} icon="settings" title="SL: Trefferpunkte, Zustände, Statblock …" onClick=${(e) => gmMenu(B, t, cb, e, editToken)} />` : null}
      <${IconBtn} icon="x" title="Schließen" onClick=${() => selectToken(B, null)} />
    </div>
    ${cb ? html`<${StatusChips} cb=${cb} />` : null}
    ${B.gm && !cb && (t.charId || t.mref) ? html`<div class="btn-row"><${Btn} size="sm" icon="plus" onClick=${() => addTokenToCombat(B, t)}>In den Kampf<//>${t.surprised ? html`<span class="tiny accent-text">überrascht</span>` : null}</div>` : null}
  </div>`;
}

function PendingBar({ B }) {
  const p = B.pending;
  if (!p) return null;
  const a = p.a;
  const me = cbById(B, p.cb);
  const needs = a.needs || {};
  const multi = ['enemy', 'ally', 'creature'].includes(needs.target);
  const max = multi ? A.targetCount(a, p.slot, charLevelOf(B, me)) : 0;
  const hint = needs.target === 'point' ? (needs.rangeKind === 'self' ? 'Richtung wählen: auf die Karte tippen' : 'Fläche platzieren: auf die Karte tippen')
    : needs.target === 'wall' ? (p.wallStart ? 'Richtung der Wand wählen' : 'Anfang der Wand wählen')
    : needs.target === 'cell' ? (needs.summon ? 'Wo sollen die Kreaturen erscheinen?' : 'Zielfeld wählen') : multi ? (max > 1 ? `Ziele wählen (${p.targets.length}/${max})` : 'Ziel antippen') : 'Bereit';
  const set = (patch) => { Object.assign(p, patch); B._tv = null; B.rerender(); B.redraw(); };
  const names = p.targets.map((id) => cbById(B, id)?.name || '?');
  const canGo = (multi && p.targets.length > 0) || needs.target === 'none' || needs.target === 'self';
  return html`<div class="bt-pend">
    <b>${a.name}</b><span class="muted-l">${hint}</span>
    ${p.slots.length > 1 ? html`<span class="bt-chipsel" title="Zauberplatz (höherer Grad = stärker)">${p.slots.map((o) => html`<button type="button" key=${`${o.level}${o.pact ? 'p' : ''}`} class=${p.slot === o.level && !!p.pact === !!o.pact ? 'on' : ''}
      onClick=${() => set({ slot: o.level, pact: !!o.pact, targets: p.targets.slice(0, A.targetCount(a, o.level, charLevelOf(B, me))) })}>${ROMAN[o.level]}${o.pact ? ' ✦' : ''}${o.left != null ? ` · ${o.left}` : ''}</button>`)}</span>` : null}
    ${p.choices ? html`<span class="bt-chipsel">${p.choices.map((c) => html`<button type="button" key=${c.id} class=${p.choice === c.id ? 'on' : ''} onClick=${() => set({ choice: c.id })}>${c.label}</button>`)}</span>` : null}
    ${names.length && max > 1 ? html`<span class="tiny">${names.join(', ')}</span>` : null}
    <span class="grow"></span>
    ${canGo ? html`<${Btn} size="sm" kind="primary" onClick=${() => execute(B)}>${a.kind === 'spell' ? 'Wirken' : 'Ausführen'}<//>` : null}
    <${Btn} size="sm" kind="ghost" onClick=${() => arm(B, null)}>Abbrechen<//>
  </div>`;
}

function ResultCard({ r, B }) {
  const [sneak, setSneak] = useState(true);
  const [smiteIdx, setSmiteIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const x = B.combat.x;
  const actor = cbById(B, r.actor);
  const ctl = canControlCb(B, actor);
  // Spieler würfeln ihren Schaden selbst; die SL kann es notfalls übernehmen
  const mine = ctl && (!B.gm || !actor.ownerUid || actor.ownerUid === B.me);
  const close = () => { B.dismissed.add(r.id); B.rerender(); };
  const anyHit = (r.targets || []).some((t) => t.hit);
  const cls = r.kind === 'error' ? 'miss' : r.kind === 'attack' ? (anyHit ? 'hit' : 'miss') : r.kind === 'heal' ? 'heal' : 'area';
  const needDmg = r.stage === 'damage';
  const smites = needDmg && ctl ? A.smiteOptions(x, actor, r, B.ctx) : [];
  const smite = smites[smiteIdx] || null;
  const pseudo = { attack: { weapon: r.weapon, finesse: r.finesse, kind: r.attKind } };
  const sneakOk = needDmg && ctl && r.kind === 'attack' && (r.targets || []).some((t) => t.hit && A.sneakEligible(x, actor, pseudo, t, B.ctx));
  const rollDmg = async () => {
    setBusy(true);
    try {
      const char = B.ctx.charOf(actor);
      const ev = A.rollDamage(x, actor, r, B.ctx, { sneak: sneakOk && sneak, smite, doRoll });
      if (smite && char) await A.consumeSlot(actor, char, smite.slot, smite.pact);
      await sendEvent(ev);
    } finally { setBusy(false); }
  };
  const acShown = (t) => t.ac != null && (B.gm || cbById(B, t.id)?.isPC);
  return html`<div class=${`bt-res ${cls}`}>
    <div class="row nowrap"><b class="grow">${r.actorName}: ${r.title}${r.level ? ` · ${ROMAN[r.level] || r.level}` : ''}</b><${IconBtn} icon="x" size=${14} title="Ausblenden" onClick=${close} /></div>
    ${r.kind === 'error' ? html`<div class="small danger-text">${r.note}</div>` : null}
    ${r.save ? html`<div class="tiny muted">SG ${r.dc} ${E.AB_SHORT[r.save] || ''}-Rettungswurf${r.half ? ' · Hälfte bei Erfolg' : ''}</div>` : null}
    ${(r.targets || []).length ? html`<div class="bt-targets">${r.targets.map((t, i) => html`<div class="bt-trow" key=${`${t.id}${i}`}>
      <span class="grow">${t.name}${t.darts ? ` ×${t.darts}` : ''}</span>
      ${t.natural != null ? html`<span class="bt-roll" title=${[...(t.adv || []).map((q) => `▲ ${q}`), ...(t.dis || []).map((q) => `▼ ${q}`)].join('\n')}>${t.dice?.length > 1 ? `${t.mode === 'adv' ? '▲' : t.mode === 'dis' ? '▼' : ''}[${t.dice.join(', ')}] ` : ''}${t.total}${acShown(t) ? ` / RK ${t.ac}` : ''}</span>` : null}
      ${t.save ? html`<span class=${t.save.ok ? 'success-text' : 'danger-text'}>${t.save.auto ? 'scheitert' : t.save.immune ? 'immun' : `${t.save.total} ${t.save.ok ? '✓' : '✗'}`}</span>` : null}
      ${r.kind === 'attack' && t.natural != null ? html`<b class=${t.crit ? 'bt-crit' : t.hit ? 'success-text' : 'danger-text'}>${t.crit ? 'Kritisch!' : t.hit ? 'Treffer' : t.image ? 'Spiegelbild' : t.shield ? 'Schild' : t.parry ? 'Pariert' : t.fumble ? 'Patzer' : 'Verfehlt'}</b>` : null}
      ${t.note ? html`<span class="tiny faint">${t.note}</span>` : null}
      ${t.applied != null ? html`<b class="danger-text">−${t.applied}</b>` : null}
      ${t.healed != null ? html`<b class="success-text">+${t.healed}</b>` : null}
      ${t.temp ? html`<b class="accent-text">+${t.temp} temp.</b>` : null}
    </div>`)}</div>` : null}
    ${r.rolled?.length ? html`<div class="tiny muted">Schaden gewürfelt: ${r.rolled.join(' + ')}</div>` : null}
    ${needDmg && ctl ? html`<div class="bt-dmg">
      ${sneakOk ? html`<label class="check small"><input type="checkbox" checked=${sneak} onChange=${(e) => setSneak(e.target.checked)} /> Hinterhältiger Angriff</label>` : null}
      ${smites.length ? html`<select class="select sm" style="width:auto" value=${String(smiteIdx)} onChange=${(e) => setSmiteIdx(Number(e.target.value))}>
        <option value="-1">Kein Niederstrecken</option>${smites.map((o, i) => html`<option value=${String(i)}>${o.label}</option>`)}</select>` : null}
      <${Btn} size="sm" kind=${mine ? 'danger' : 'ghost'} icon="d20" loading=${busy} onClick=${rollDmg}>${mine ? 'Schaden würfeln' : 'Für den Spieler würfeln'}<//>
    </div>` : needDmg ? html`<div class="tiny faint">Wartet auf den Schadenswurf von ${r.actorName} …</div>` : null}
  </div>`;
}

function ResultStack({ B }) {
  const [, force] = useState(0);
  useEffect(() => { const i = setInterval(() => force((n) => n + 1), 5000); return () => clearInterval(i); }, []);
  const t = now();
  const all = (B.combat.results || []).filter((r) => (!r.mapId || r.mapId === B.mapId) && !B.dismissed.has(r.id) && t - (r.ts || 0) < (r.stage === 'damage' ? 300000 : 40000));
  const shown = all.slice(-4);
  if (!shown.length) return null;
  return html`<div class="bt-results">${shown.map((r) => html`<${ResultCard} key=${r.id} r=${r} B=${B} />`)}</div>`;
}

export function BattleHud({ B, s, editToken }) {
  const c = B.combat;
  const selT = B.sel ? B.tokens.find((t) => t.id === B.sel) : null;
  // Wer am Zug ist und von mir gesteuert wird, ist automatisch ausgewählt
  useEffect(() => {
    if (!c.active || !c.curId) return;
    const cb = c.list.find((x) => x.id === c.curId);
    const t = cb && tokenOfCb(B, cb);
    if (t && canControl(B, t)) {
      B.sel = t.id;
      B.pending = null;
      s.focusToken?.(t, true);
      B.rerender();
      B.redraw();
    }
  }, [c.turnKey]);
  const showStrip = c.active || (B.gm && (c.list.length || B.tokens.some((t) => t.charId || t.mref)));
  const selCb = selT ? cbOfTok(B, selT) : null;
  const ctl = !!selT && canControl(B, selT) && !!selCb;
  const acts = ctl ? A.catalogSync(c.x, selCb, B.ctx) : [];
  const char = ctl ? B.ctx.charOf(selCb) : null;
  const isTurn = ctl && c.active && c.curId === selCb.id;
  const movedLocal = selCb ? B.localMove.get(`${c.turnKey}|${selCb.id}`) || 0 : 0;
  return html`${showStrip ? html`<${TurnStrip} B=${B} s=${s} />` : null}
    ${B.logOpen ? html`<${CombatLog} B=${B} />` : null}
    <${ResultStack} B=${B} />
    <div class="bt-dock">
      ${B.pending ? html`<${PendingBar} B=${B} />` : null}
      ${selT && !ctl ? html`<${InfoCard} B=${B} t=${selT} editToken=${editToken} />` : null}
      ${ctl ? html`<${StatusChips} cb=${selCb} />` : null}
      ${ctl ? html`<${BattleBar} B=${B} cb=${selCb} char=${char} acts=${acts} turn=${isTurn} speedM=${speedOf(B, selT)} movedLocal=${movedLocal}
        pendingKey=${B.pending?.a?.key || null} portrait=${html`<${TokenArt} B=${B} t=${selT} cb=${selCb} size=${64} />`}
        onArm=${(a) => (B.pending?.a?.key === a.key ? arm(B, null) : armAction(B, selT, a))}
        onEnd=${isTurn ? () => { B.pending = null; sendEvent({ type: 'endTurn' }).catch(() => {}); } : null}
        onGm=${B.gm ? (e) => gmMenu(B, selT, selCb, e, editToken) : null}
        onEndConc=${() => endConc(B, selCb)}
        onClose=${() => selectToken(B, null)} />` : null}
    </div>`;
}

// Kompendium in der Seitenleiste (SL): SRD-Monster (deutsch) und eigenes Bestiarium auf die Karte setzen
export function MonsterPlacer({ B, active, onPick, onStop }) {
  const [q, setQ] = useState('');
  const [srd, setSrd] = useState(null);
  const [hidden, setHidden] = useState(!!B.placeHidden);
  useEffect(() => { import('../data/monsters-srd.js').then((m) => setSrd(m.MONSTERS)); }, []);
  const ql = q.trim().toLowerCase();
  const list = [...(B.bestiary || []).map((m) => ({ ...m, src: 'bst' })), ...(srd || []).map((m) => ({ ...m, src: 'srd' }))]
    .filter((m) => !ql || m.name.toLowerCase().includes(ql) || String(m.type || '').toLowerCase().includes(ql)).slice(0, 40);
  return html`<div class="stack sm">
    <b>Monster platzieren</b>
    <input class="input sm" placeholder="Suchen: Goblin, Drache, Untoter …" value=${q} onInput=${(e) => setQ(e.target.value)} />
    <div class="bt-mlist">
      ${!srd ? html`<div class="empty"><span class="spinner" /></div>` : null}
      ${list.map((m) => html`<button type="button" key=${`${m.src}:${m.id}`} class=${`bt-mrow${active && B.placing?.id === m.id ? ' on' : ''}`} onClick=${() => onPick({ ...m })}>
        <${MonsterArt} m=${m} size=${30} />
        <span class="grow" style="min-width:0"><b>${m.name}</b><small>HG ${m.cr || '?'} · ${m.src === 'srd' ? 'SRD' : 'Bestiarium'}</small></span>
      </button>`)}
    </div>
    <label class="check small"><input type="checkbox" checked=${hidden} onChange=${(e) => { B.placeHidden = e.target.checked; setHidden(e.target.checked); }} /> Verborgen platzieren (nur SL sieht sie)</label>
    ${active ? html`<div class="row small"><span class="accent-text grow">Antippen = „${B.placing?.name}“ setzen</span><${Btn} size="sm" onClick=${onStop}>Fertig<//></div>` : null}
  </div>`;
}
