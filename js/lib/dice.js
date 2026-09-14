// Würfel-Parser: 2d6+3, d20, 4d6dl1, 2d20kh1, d%, 3d6!, dF, "d20+5 vorteil", "W20" (deutsch)

export function rollDie(sides) {
  const a = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / sides) * sides;
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return (a[0] % sides) + 1;
}

const TERM = /([+\-]?)(?:(\d*)d(\d+|%|f)(kh\d*|kl\d*|dh\d*|dl\d*|k\d*)?(!)?|(\d+))/y;

export function normalizeRoll(input) {
  let src = String(input ?? '').toLowerCase().replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/w(?=\d|%)/g, 'd');
  let mode = null;
  const mm = /(vorteil|nachteil|adv|dis|vt|nt)$/.exec(src);
  if (mm) {
    mode = /vorteil|adv|vt/.test(mm[1]) ? 'adv' : 'dis';
    src = src.slice(0, -mm[1].length);
  }
  if (!src) src = 'd20';
  if (/^[+\-]\d+$/.test(src)) src = 'd20' + src;
  if (mode) {
    const suffix = mode === 'adv' ? 'kh1' : 'kl1';
    const re = /(^|[+\-])1?d20(?![\dkd!])/;
    if (re.test(src)) src = src.replace(re, `$12d20${suffix}`);
    else src = `2d20${suffix}` + (/^[+\-]/.test(src) ? src : '+' + src);
  }
  return src;
}

export function roll(input, label = '') {
  const expr = normalizeRoll(input);
  const terms = [];
  let pos = 0;
  let total = 0;
  let d20Kept = null;
  while (pos < expr.length) {
    TERM.lastIndex = pos;
    const m = TERM.exec(expr);
    if (!m || m[0] === '' || m.index !== pos) throw new Error(`Ungültiger Wurf: „${input}“`);
    pos = TERM.lastIndex;
    const sign = m[1] === '-' ? -1 : 1;
    if (m[6] !== undefined) {
      const value = parseInt(m[6], 10);
      terms.push({ kind: 'num', sign, value });
      total += sign * value;
      continue;
    }
    const count = m[2] ? parseInt(m[2], 10) : 1;
    const fate = m[3] === 'f';
    const sides = m[3] === '%' ? 100 : fate ? 3 : parseInt(m[3], 10);
    if (count < 1 || count > 200) throw new Error('Maximal 200 Würfel pro Wurf');
    if (!fate && (sides < 2 || sides > 1000)) throw new Error('Würfelseiten zwischen 2 und 1000');
    const explode = !!m[5] && !fate;
    const rolls = [];
    for (let i = 0; i < count; i++) {
      let v = rollDie(sides);
      if (fate) v -= 2;
      rolls.push({ v, dropped: false });
      let guard = 0;
      while (explode && v === sides && guard++ < 20) {
        v = rollDie(sides);
        rolls.push({ v, dropped: false, exploded: true });
      }
    }
    const mod = m[4];
    if (mod) {
      const kind = mod.startsWith('kl') ? 'kl' : mod.startsWith('kh') ? 'kh' : mod.startsWith('dl') ? 'dl' : mod.startsWith('dh') ? 'dh' : 'kh';
      const n = parseInt(mod.replace(/^[a-z]+/, '') || '1', 10);
      const order = rolls.map((r, i) => i).sort((a, b) => rolls[a].v - rolls[b].v);
      let drop = [];
      if (kind === 'kh') drop = order.slice(0, Math.max(0, rolls.length - n));
      if (kind === 'kl') drop = order.slice(n);
      if (kind === 'dl') drop = order.slice(0, n);
      if (kind === 'dh') drop = order.slice(Math.max(0, rolls.length - n));
      drop.forEach((i) => { rolls[i].dropped = true; });
    }
    const sum = rolls.filter((r) => !r.dropped).reduce((a, r) => a + r.v, 0);
    total += sign * sum;
    const kept = rolls.filter((r) => !r.dropped);
    if (sides === 20 && !fate && kept.length === 1 && d20Kept === null) d20Kept = kept[0].v;
    terms.push({ kind: 'dice', sign, count, sides: fate ? 'F' : sides, mod: mod || '', explode, rolls, sum });
  }
  const text = terms.map((t, i) => {
    const s = i === 0 ? (t.sign < 0 ? '−' : '') : t.sign < 0 ? ' − ' : ' + ';
    if (t.kind === 'num') return s + t.value;
    const rs = t.rolls.map((r) => (r.dropped ? `~${r.v}~` : String(r.v))).join(', ');
    return `${s}${t.count}d${t.sides}${t.mod}${t.explode ? '!' : ''} [${rs}]`;
  }).join('');
  return {
    input: String(input),
    label,
    expr,
    total,
    terms,
    text,
    crit: d20Kept === 20,
    fumble: d20Kept === 1,
    ts: Date.now(),
  };
}

// ───────── Detaillierte Würfe: jeder physische Würfel + Effekte aus Volk, Talenten und Klassen ─────────
// kind: 'auto' | 'check' | 'save' | 'attack' | 'init' | 'damage' | 'free'
// fx:   adv, dis, elven, lucky, halfling, reliable, bless, guidance, bardic ('d6'…'d12'), bane, exhaustion (Stufe),
//       crit, gwf, elemental, savage
const D20_KINDS = new Set(['check', 'save', 'attack', 'init', 'd20', 'auto']);

function parseTerms(src, input) {
  const terms = [];
  let pos = 0;
  while (pos < src.length) {
    TERM.lastIndex = pos;
    const m = TERM.exec(src);
    if (!m || m[0] === '' || m.index !== pos) throw new Error(`Ungültiger Wurf: „${input}“`);
    pos = TERM.lastIndex;
    const sign = m[1] === '-' ? -1 : 1;
    if (m[6] !== undefined) {
      terms.push({ kind: 'num', sign, value: parseInt(m[6], 10) });
      continue;
    }
    const count = m[2] ? parseInt(m[2], 10) : 1;
    const fate = m[3] === 'f';
    const sides = m[3] === '%' ? 100 : fate ? 3 : parseInt(m[3], 10);
    if (count < 1 || count > 200) throw new Error('Maximal 200 Würfel pro Wurf');
    if (!fate && (sides < 2 || sides > 1000)) throw new Error('Würfelseiten zwischen 2 und 1000');
    terms.push({ kind: 'dice', sign, count, sides, fate, mod: m[4] || '', explode: !!m[5] && !fate });
  }
  return terms;
}

const dieVal = (d) => d.adj ?? d.value;

function applyKeep(set, mod) {
  if (!mod) return;
  const live = set.filter((d) => !d.dropped);
  const kindK = mod.startsWith('kl') ? 'kl' : mod.startsWith('kh') ? 'kh' : mod.startsWith('dl') ? 'dl' : mod.startsWith('dh') ? 'dh' : 'kh';
  const n = parseInt(mod.replace(/^[a-z]+/, '') || '1', 10);
  const order = [...live].sort((a, b) => dieVal(a) - dieVal(b));
  let drop = [];
  if (kindK === 'kh') drop = order.slice(0, Math.max(0, live.length - n));
  if (kindK === 'kl') drop = order.slice(n);
  if (kindK === 'dl') drop = order.slice(0, n);
  if (kindK === 'dh') drop = order.slice(Math.max(0, live.length - n));
  drop.forEach((d) => { d.dropped = true; });
}

export function rollDetailed(input, { kind = 'auto', fx = {}, label = '', edition = '2014' } = {}) {
  let src = String(input ?? '').toLowerCase().replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/w(?=\d|%)/g, 'd');
  const f = { ...fx };
  const mm = /(vorteil|nachteil|adv|dis|vt|nt)$/.exec(src);
  if (mm) {
    if (/vorteil|adv|vt/.test(mm[1])) f.adv = true;
    else f.dis = true;
    src = src.slice(0, -mm[1].length);
  }
  if (!src) src = 'd20';
  if (/^[+\-]\d+$/.test(src)) src = `d20${src}`;
  const terms = parseTerms(src, input);
  const mainIdx = terms.findIndex((t) => t.kind === 'dice' && t.sides === 20 && t.count === 1 && !t.mod && !t.explode);
  const isD20 = mainIdx >= 0 && D20_KINDS.has(kind);
  const isDmg = kind === 'damage';
  const notes = [];

  if (isD20) {
    const ex = Number(f.exhaustion) || 0;
    if (ex && edition === '2024') terms.push({ kind: 'num', sign: -1, value: 2 * ex, label: `Erschöpfung ${ex}` });
    if (ex && edition !== '2024' && ((kind === 'check' && ex >= 1) || ((kind === 'attack' || kind === 'save') && ex >= 3))) {
      f.dis = true;
      notes.push(`Erschöpfung ${ex}: Nachteil`);
    }
    if (f.bless && kind !== 'check' && kind !== 'init') terms.push({ kind: 'dice', sign: 1, count: 1, sides: 4, mod: '', label: 'Segen', bonus: true });
    if (f.guidance && (kind === 'check' || kind === 'init' || kind === 'auto')) terms.push({ kind: 'dice', sign: 1, count: 1, sides: 4, mod: '', label: 'Göttliche Führung', bonus: true });
    if (f.bardic) terms.push({ kind: 'dice', sign: 1, count: 1, sides: parseInt(String(f.bardic).replace(/\D/g, ''), 10) || 6, mod: '', label: 'Bardische Inspiration', bonus: true });
    if (f.bane && kind !== 'check' && kind !== 'init') terms.push({ kind: 'dice', sign: -1, count: 1, sides: 4, mod: '', label: 'Fluch', bonus: true });
  }

  const dice = [];
  const text = [];
  let total = 0;
  let natural = null;

  terms.forEach((t, ti) => {
    const s = ti === 0 ? (t.sign < 0 ? '−' : '') : t.sign < 0 ? ' − ' : ' + ';
    const lbl = t.label ? ` (${t.label})` : '';
    if (t.kind === 'num') {
      total += t.sign * t.value;
      text.push(`${s}${t.value}${lbl}`);
      return;
    }
    if (isD20 && ti === mainIdx) {
      let adv = !!f.adv;
      let dis = !!f.dis;
      let luckyExtra = false;
      if (f.lucky) {
        if (edition === '2024') adv = true;
        else luckyExtra = true;
      }
      if (adv && dis) { adv = false; dis = false; notes.push('Vorteil und Nachteil heben sich auf'); }
      const n = (adv ? (f.elven ? 3 : 2) : dis ? 2 : 1) + (luckyExtra ? 1 : 0);
      const slots = [];
      for (let i = 0; i < n; i++) {
        let v = rollDie(20);
        let from = null;
        if (f.halfling && v === 1) {
          dice.push({ sides: 20, value: 1, dropped: true, group: ti, note: 'Glück' });
          v = rollDie(20);
          from = 1;
          notes.push(`Halblingsglück: natürliche 1 neu gewürfelt → ${v}`);
        }
        const d = { sides: 20, value: v, dropped: false, group: ti, main: true, from };
        dice.push(d);
        slots.push(d);
      }
      const high = adv || luckyExtra;
      let keep = slots[0];
      for (const d of slots) {
        if (high && d.value > keep.value) keep = d;
        else if (!high && dis && d.value < keep.value) keep = d;
      }
      slots.forEach((d) => { if (d !== keep) d.dropped = true; });
      natural = keep.value;
      if (f.reliable && kind === 'check' && keep.value < 10) {
        keep.adj = 10;
        notes.push(`Verlässliches Talent: ${keep.value} zählt als 10`);
      }
      total += t.sign * dieVal(keep);
      const rs = slots.map((d) => `${d.from ? '~1~→' : ''}${d.dropped ? `~${d.value}~` : d.adj ? `${d.value}→${d.adj}` : d.value}`).join(', ');
      text.push(`${s}${slots.length > 1 ? `${slots.length}d20${high ? 'kh1' : 'kl1'}` : 'd20'} [${rs}]${lbl}`);
      return;
    }
    const count = t.count * (isDmg && f.crit && !t.bonus ? 2 : 1);
    const rollSet = () => {
      const set = [];
      for (let i = 0; i < count; i++) {
        let v = rollDie(t.fate ? 3 : t.sides);
        if (t.fate) v -= 2;
        let d = { sides: t.fate ? 'F' : t.sides, value: v, dropped: false, group: ti, bonus: !!t.bonus };
        if (isDmg && f.gwf && !t.fate && !t.bonus && v <= 2) {
          if (edition === '2024') d.adj = 3;
          else {
            set.push({ ...d, dropped: true, note: 'neu' });
            d = { ...d, value: rollDie(t.sides), from: v };
          }
        }
        if (isDmg && f.elemental && !t.fate && !t.bonus && dieVal(d) === 1) d.adj = 2;
        set.push(d);
        let last = d.value;
        let guard = 0;
        while (t.explode && last === t.sides && guard++ < 20) {
          const e = { sides: t.sides, value: rollDie(t.sides), dropped: false, group: ti, exploded: true };
          set.push(e);
          last = e.value;
        }
      }
      applyKeep(set, t.mod);
      return set;
    };
    let set = rollSet();
    const sumOf = (xs) => xs.filter((d) => !d.dropped).reduce((a, d) => a + dieVal(d), 0);
    if (isDmg && f.savage && !t.bonus) {
      const alt = rollSet();
      const a = sumOf(set);
      const b = sumOf(alt);
      const loser = b > a ? set : alt;
      loser.forEach((d) => { d.dropped = true; d.note = 'Wilder Angreifer'; });
      notes.push(`Wilder Angreifer: ${a} gegen ${b} – ${Math.max(a, b)} zählt`);
      set = [...set, ...alt];
    }
    dice.push(...set);
    const sum = sumOf(set);
    total += t.sign * sum;
    const rs = set.map((d) => (d.dropped ? `~${d.value}~` : d.adj ? `${d.value}→${d.adj}` : d.from ? `${d.from}→${d.value}` : String(d.value))).join(', ');
    text.push(`${s}${count}d${t.fate ? 'F' : t.sides}${t.mod}${t.explode ? '!' : ''} [${rs}]${lbl}`);
    if (sides20(t) && kind === 'auto' && natural === null) {
      const kept = set.filter((d) => !d.dropped);
      if (kept.length === 1) natural = kept[0].value;
    }
  });
  if (isDmg && f.crit) notes.unshift('Kritischer Treffer: Schadenswürfel verdoppelt');
  if (isDmg && f.gwf) notes.push(edition === '2024' ? 'Kampf mit Großwaffen: 1 und 2 zählen als 3' : 'Kampf mit Großwaffen: 1 und 2 einmal neu gewürfelt');
  if (isDmg && f.elemental) notes.push('Elementarer Adept: 1 zählt als 2');
  return {
    input: String(input), label, expr: src, kind, total, text: text.join(''), dice, notes,
    crit: natural === 20, fumble: natural === 1, ts: Date.now(),
  };
}

function sides20(t) {
  return t.kind === 'dice' && t.sides === 20;
}

export function tryRoll(input, label) {
  try {
    return roll(input, label);
  } catch {
    return null;
  }
}

export function isRollable(input) {
  return !!tryRoll(input);
}

// 4d6, niedrigsten verwerfen – sechsmal (Attributswürfe)
export function rollAbilityScores() {
  return Array.from({ length: 6 }, () => roll('4d6dl1').total);
}

export function modifier(score) {
  return Math.floor(((Number(score) || 10) - 10) / 2);
}

export function fmtMod(n) {
  const v = Number(n) || 0;
  return v >= 0 ? `+${v}` : `−${Math.abs(v)}`;
}

export function rollTableRange(cell, value) {
  // "1", "2-3", "4–6", "00", "91-00"
  const c = String(cell || '').trim().replace(/[–—]/g, '-');
  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(c);
  if (!m) return false;
  let a = parseInt(m[1], 10);
  let b = m[2] !== undefined ? parseInt(m[2], 10) : a;
  if (m[1] === '00') a = 100;
  if (m[2] === '00') b = 100;
  return value >= a && value <= b;
}
