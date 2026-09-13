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
