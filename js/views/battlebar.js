// Kampfleiste im Stil von Baldur's Gate 3: Porträt mit TP und Todesrettungswürfen, Aktion ● / Bonusaktion ▲ / Reaktion ◆,
// Bewegung, Zauberplätze je Grad (I–IX), Pakt- und Klassenressourcen, Reiter mit Aktionskacheln und ausführliche Tooltips.
import { html, useState, useRef } from '../lib/preact.js';
import { SpellArt, ItemArt, GameIcon } from '../ui/art.js';
import { Icon } from '../ui/components.js';
import * as A from '../core/actions.js';
import { fmtM, statsOf } from '../core/engine.js';
import { resourcesFor } from '../data/chargen.js';

export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const TABS = [
  ['common', 'Allgemein', 'hand'],
  ['attack', 'Angriffe', 'crossed-swords'],
  ['spell', 'Zauber', 'spell-book'],
  ['class', 'Klasse', 'star-swirl'],
  ['item', 'Gegenstände', 'backpack'],
];
const TAB_OF = { common: 'common', granted: 'common', attack: 'attack', monster: 'attack', spell: 'spell', class: 'class', item: 'item' };
const FACT_ICON = { range: 'bullseye', time: 'hourglass', conc: 'third-eye', hit: 'crossed-swords', save: 'dodging', dmg: 'death-skull', heal: 'heart-bottle', info: 'magic-swirl', uses: 'stopwatch' };
const RES_SHORT = {
  rage: 'Rausch', bardic: 'Inspiration', channel: 'Macht', wildshape: 'Tiergestalt', secondwind: 'Zw. Wind', surge: 'Tatendrang', indomitable: 'Unbeugsam',
  layonhands: 'Handaufl.', favored: 'Jagdmal', sorcery: 'Zaubereipkt.', arcanerecovery: 'Arkan', breath: 'Odem', luck: 'Glück',
};

function artOf(a, size = 44) {
  if (a.art?.spell) return html`<${SpellArt} sp=${a.art.spell} size=${size} level=${false} />`;
  if (a.art?.item) return html`<${ItemArt} item=${a.art.item} size=${size} />`;
  return html`<span class="bb-gi" style=${{ width: `${size}px`, height: `${size}px` }}><${GameIcon} name=${a.art?.gi || 'crossed-swords'} size=${Math.round(size * 0.66)} /></span>`;
}

function Pips({ max, left, cls = '' }) {
  if (max > 6) return html`<em class="bb-num">${left}/${max}</em>`;
  return html`<span class="bb-pips">${Array.from({ length: max }, (_, i) => html`<i key=${i} class=${`${cls}${i < left ? ' on' : ''}`}></i>`)}</span>`;
}

// Zauberplätze (I–IX), Paktmagie und Klassenressourcen
function Resources({ cb, char }) {
  const out = [];
  if (char) {
    const si = A.slotInfo(char);
    for (const [g, v] of Object.entries(si.levels)) {
      if (v.max) out.push(html`<span class="bb-slot" key=${`s${g}`} title=${`Zauberplätze ${g}. Grad: ${v.left} von ${v.max} frei`}><b>${ROMAN[g]}</b><${Pips} max=${v.max} left=${v.left} /></span>`);
    }
    if (si.pact?.max) out.push(html`<span class="bb-slot" key="pact" title=${`Paktmagie (${si.pact.level}. Grad): ${si.pact.left} von ${si.pact.max} frei`}><b class="pact">${ROMAN[si.pact.level]}</b><${Pips} max=${si.pact.max} left=${si.pact.left} cls="pact" /></span>`);
    for (const r of resourcesFor(char)) {
      if (!r.max || r.max >= 99) continue;
      const left = Math.max(0, r.max - (Number(char.resUsed?.[r.key]) || 0));
      const label = r.key === 'ki' ? String(r.name).replace(/-?punkte/i, '') : RES_SHORT[r.key] || String(r.name).split(/[ (]/)[0];
      out.push(html`<span class="bb-slot" key=${`r${r.key}`} title=${`${r.name}: ${left} von ${r.max}`}><b class="res">${label}</b><${Pips} max=${r.max} left=${left} cls="res" /></span>`);
    }
  } else {
    for (const cast of cb.statblock?.casting || []) {
      for (const g of cast.groups || []) {
        if (!g.level || !g.slots) continue;
        const left = Math.max(0, g.slots - (Number(cb.mSlots?.[g.level]) || 0));
        out.push(html`<span class="bb-slot" key=${`m${g.level}`} title=${`Zauberplätze ${g.level}. Grad: ${left} von ${g.slots}`}><b>${ROMAN[g.level]}</b><${Pips} max=${g.slots} left=${left} /></span>`);
      }
    }
  }
  return out.length ? html`<div class="bb-slots">${out}</div>` : null;
}

// Aktion ●, Bonusaktion ▲, Reaktion ◆, Bewegung
function Economy({ cb, turn, speedM, movedLocal }) {
  const e = turn && cb.eco ? cb.eco : null;
  const act = e ? (e.action || 0) > 0 : true;
  const bonus = e ? (e.bonus || 0) > 0 : true;
  const total = e ? Number(e.moveM) || 0 : speedM || 0;
  const left = e ? Math.max(0, total - Math.max(Number(e.movedM) || 0, movedLocal || 0)) : total;
  const react = cb.reaction !== false;
  return html`<div class="bb-eco">
    <span class=${`bb-pip action${act ? '' : ' used'}`} title=${act ? 'Aktion verfügbar' : 'Aktion verbraucht'}></span>
    ${e?.extra ? html`<span class="bb-pip action extra" title="Zusätzliche Aktion durch Hast (ein Waffenangriff, Spurt, Rückzug, Verstecken oder Gegenstand)"></span>` : null}
    ${e?.attacks > 0 ? html`<span class="bb-att" title="Weitere Angriffe dieser Angriffsaktion">⚔×${e.attacks}</span>` : null}
    <span class=${`bb-pip bonus${bonus ? '' : ' used'}`} title=${bonus ? 'Bonusaktion verfügbar' : 'Bonusaktion verbraucht'}></span>
    <span class=${`bb-pip reaction${react ? '' : ' used'}`} title=${react ? 'Reaktion verfügbar' : 'Reaktion verbraucht'}></span>
    <span class="bb-move" title=${`Bewegung: noch ${fmtM(left)} von ${fmtM(total)}`}><i style=${{ width: `${total ? Math.round((left / total) * 100) : 0}%` }}></i><b>${fmtM(left)}</b></span>
  </div>`;
}

function Vitals({ cb }) {
  const hp = cb.hp;
  const max = cb.maxHp;
  const known = hp != null && !!max;
  const frac = known ? Math.max(0, Math.min(1, hp / max)) : ({ Unverletzt: 1, Angeschlagen: 0.7, Blutig: 0.4, Kritisch: 0.15 })[cb.hpState] ?? 0;
  const zero = cb.isPC && known && hp <= 0 && !cb.dead;
  const ds = cb.deathSaves || { s: 0, f: 0 };
  return html`<div class="bb-vit">
    <div class="bb-hpbar" title="Trefferpunkte"><i style=${{ width: `${frac * 100}%` }}></i>${cb.tempHp && known ? html`<em style=${{ width: `${Math.min(100, (cb.tempHp / max) * 100)}%` }}></em>` : null}<b>${known ? `${hp}/${max}${cb.tempHp ? ` +${cb.tempHp}` : ''}` : cb.hpState || ''}</b></div>
    ${zero ? html`<div class="bb-ds" title=${`Todesrettungswürfe: ${ds.s} Erfolge, ${ds.f} Fehlschläge${cb.stable ? ' – stabil' : ''}`}>
      ${[0, 1, 2].map((i) => html`<i key=${`s${i}`} class=${`s${i < ds.s ? ' on' : ''}`}></i>`)}<span>${cb.stable ? '✚' : '☠'}</span>${[0, 1, 2].map((i) => html`<i key=${`f${i}`} class=${`f${i < ds.f ? ' on' : ''}`}></i>`)}
    </div>` : null}
  </div>`;
}

function Tile({ a, on, onArm, onTip }) {
  const off = !a.state?.ok;
  return html`<button type="button" class=${`bb-tile${off ? ' off' : ''}${on ? ' on' : ''}${a.state?.reaction ? ' react' : ''}`} aria-label=${a.name}
    onClick=${() => onArm(a)} onMouseEnter=${(e) => onTip(a, e.currentTarget)} onFocus=${(e) => onTip(a, e.currentTarget)} onBlur=${() => onTip(null)}>
    <span class="bb-art">${artOf(a)}</span>
    ${a.cost && a.cost !== 'long' ? html`<i class=${`bb-cost ${a.cost}`}></i>` : null}
    ${a.kind === 'spell' && a.level ? html`<b class="bb-lvl">${ROMAN[a.level]}</b>` : null}
    ${a.uses && a.uses.max < 99 ? html`<b class="bb-uses">${a.uses.left}</b>` : a.recharge === false ? html`<b class="bb-uses">⟳</b>` : null}
  </button>`;
}

// Tooltip wie in BG3: Name, Art, Beschreibung, Werte mit Symbolen, Kosten und warum es gerade nicht geht
function Tip({ a, x, cb, ctx }) {
  const t = A.tipFor(a, cb, ctx);
  return html`<div class="bb-tip" style=${{ left: `${x}px` }}>
    <div class="bb-tip-h"><span class="bb-tip-art">${artOf(a, 40)}</span><div class="grow" style="min-width:0"><b>${t.title}</b><small>${t.sub}</small></div></div>
    ${t.lines.map((l, i) => html`<p key=${i}>${l}</p>`)}
    ${t.facts.length ? html`<div class="bb-facts">${t.facts.map(([k, v], i) => html`<span key=${i}><${GameIcon} name=${FACT_ICON[k] || 'magic-swirl'} size=${14} /><span>${v}</span></span>`)}</div>` : null}
    ${t.costs.length ? html`<div class="bb-costs">${t.costs.map(([k, v], i) => html`<span key=${i}><i class=${`bb-cost ${k}`}></i>${v}</span>`)}</div>` : null}
    ${t.why ? html`<div class="bb-why">${t.why}</div>` : null}
  </div>`;
}

function spellRows(list) {
  const m = new Map();
  for (const a of list) {
    const l = a.level || 0;
    if (!m.has(l)) m.set(l, []);
    m.get(l).push(a);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

export function BattleBar({ B, cb, char, acts, turn, speedM, movedLocal, pendingKey, portrait, onArm, onEnd, onGm, onEndConc }) {
  const [tab, setTab] = useState(null);
  const [tip, setTip] = useState(null);
  const ref = useRef();
  const groups = {};
  for (const a of acts) (groups[TAB_OF[a.group] || 'common'] ||= []).push(a);
  if (groups.spell) groups.spell.sort((p, q) => (p.level || 0) - (q.level || 0) || p.name.localeCompare(q.name, 'de'));
  const avail = TABS.filter(([k]) => groups[k]?.length);
  const cur = tab && groups[tab]?.length ? tab : groups.attack?.length ? 'attack' : avail[0]?.[0];
  const showTip = (a, el) => {
    if (!a || !el || !ref.current) { setTip(null); return; }
    const r = el.getBoundingClientRect();
    const pr = ref.current.getBoundingClientRect();
    setTip({ a, x: Math.max(150, Math.min(pr.width - 150, r.left - pr.left + r.width / 2)) });
  };
  const list = groups[cur] || [];
  const rows = cur === 'spell' ? spellRows(list) : [[null, list]];
  const ac = statsOf(cb, B.ctx).ac;
  return html`<div class="bb" ref=${ref} onMouseLeave=${() => setTip(null)}>
    ${tip ? html`<${Tip} a=${tip.a} x=${tip.x} cb=${cb} ctx=${B.ctx} />` : null}
    <div class="bb-left">
      <div class="bb-port">${portrait}
        ${B.gm || cb.isPC ? html`<span class="bb-ac" title="Rüstungsklasse"><${GameIcon} name="shield" size=${11} />${ac}</span>` : null}
        ${onGm ? html`<button type="button" class="bb-gm" title="SL: Trefferpunkte, Zustände, Statblock …" onClick=${onGm}><${Icon} name="settings" size=${13} /></button>` : null}
      </div>
      <${Vitals} cb=${cb} />
    </div>
    <div class="bb-mid">
      <div class="bb-top"><${Economy} cb=${cb} turn=${turn} speedM=${speedM} movedLocal=${movedLocal} /><${Resources} cb=${cb} char=${char} /></div>
      ${avail.length > 1 ? html`<div class="bb-tabs">${avail.map(([k, label, gi]) => html`<button type="button" key=${k} class=${`bb-tab${k === cur ? ' on' : ''}`} onClick=${() => { setTab(k); setTip(null); }} title=${label}>
        <${GameIcon} name=${gi} size=${15} /><span>${label}</span><small>${groups[k].length}</small></button>`)}</div>` : null}
      <div class="bb-grid">
        ${rows.map(([lvl, arr]) => html`${lvl != null ? html`<span class="bb-sep" key=${`h${lvl}`} title=${lvl ? `${lvl}. Grad` : 'Zaubertricks'}>${lvl ? ROMAN[lvl] : '∘'}</span>` : null}${arr.map((a) => html`<${Tile} key=${a.key} a=${a} on=${pendingKey === a.key} onArm=${onArm} onTip=${showTip} />`)}`)}
        ${!list.length ? html`<span class="tiny faint">Keine Aktionen.</span>` : null}
      </div>
    </div>
    <div class="bb-right">
      ${onEnd ? html`<button type="button" class="bb-end" onClick=${onEnd} title="Zug beenden"><${GameIcon} name="hourglass" size=${22} /><span>Zug beenden</span></button>` : html`<div class="bb-wait">${B.combat.active ? 'nicht am Zug' : 'kein Kampf'}</div>`}
      ${cb.concentration ? html`<button type="button" class="bb-conc" title="Konzentration – antippen, um sie zu beenden" onClick=${onEndConc}>◎ ${cb.concentration.name}</button>` : null}
    </div>
  </div>`;
}
