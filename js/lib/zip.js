// Minimaler ZIP-Leser/-Schreiber ohne Abhängigkeiten.
// Lesen: Stored + Deflate (über DecompressionStream), UTF-8- und CP437-Dateinamen, ZIP64-Grundunterstützung.
// Schreiben: Deflate (falls CompressionStream verfügbar) sonst Stored, UTF-8-Dateinamen.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const CP437 =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeName(bytes, flags) {
  if (flags & 0x800) return new TextDecoder('utf-8').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : CP437[b - 128];
    return s;
  }
}

async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Dieser Browser kann keine komprimierten ZIP-Dateien entpacken. Bitte Chrome, Edge, Firefox oder Safari ≥ 16.4 verwenden.');
  const ds = new DecompressionStream('deflate-raw');
  const out = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

export async function readZip(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Das ist keine gültige ZIP-Datei.');
  let count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z64 = Number(dv.getBigUint64(loc + 8, true));
      if (dv.getUint32(z64, true) === 0x06064b50) {
        count = Number(dv.getBigUint64(z64 + 32, true));
        cdOffset = Number(dv.getBigUint64(z64 + 48, true));
      }
    }
  }
  const entries = [];
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    let csize = dv.getUint32(p + 20, true);
    let usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    let lho = dv.getUint32(p + 42, true);
    const name = decodeName(u8.subarray(p + 46, p + 46 + nlen), flags);
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) {
      let x = p + 46 + nlen;
      const xend = x + xlen;
      while (x + 4 <= xend) {
        const id = dv.getUint16(x, true);
        const sz = dv.getUint16(x + 2, true);
        if (id === 0x0001) {
          let q = x + 4;
          if (usize === 0xffffffff) { usize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (lho === 0xffffffff) { lho = Number(dv.getBigUint64(q, true)); }
        }
        x += 4 + sz;
      }
    }
    entries.push({ name, method, csize, usize, lho, dir: name.endsWith('/') });
    p += 46 + nlen + xlen + clen;
  }
  return entries.map((e) => ({
    name: e.name,
    dir: e.dir,
    size: e.usize,
    async data() {
      const lh = e.lho;
      if (dv.getUint32(lh, true) !== 0x04034b50) throw new Error(`ZIP-Eintrag beschädigt: ${e.name}`);
      const nl = dv.getUint16(lh + 26, true);
      const xl = dv.getUint16(lh + 28, true);
      const start = lh + 30 + nl + xl;
      const raw = u8.subarray(start, start + e.csize);
      if (e.method === 0) return raw.slice();
      if (e.method === 8) return inflateRaw(raw);
      throw new Error(`Nicht unterstützte Kompression (${e.method}) bei ${e.name}`);
    },
    async text() {
      return new TextDecoder('utf-8').decode(await this.data());
    },
  }));
}

function dosDateTime(d = new Date()) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function deflateRaw(u8) {
  const cs = new CompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer());
}

// files: [{ name: 'Ordner/Notiz.md', data: string | Uint8Array | Blob }]
export async function writeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const dt = dosDateTime();
  const canDeflate = typeof CompressionStream !== 'undefined';
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    let data = f.data;
    if (typeof data === 'string') data = enc.encode(data);
    else if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
    const crc = crc32(data);
    let method = 0;
    let comp = data;
    if (canDeflate && data.length > 512 && !/\.(png|jpe?g|webp|gif|zip|mp3|mp4)$/i.test(f.name)) {
      try {
        const c = await deflateRaw(data);
        if (c.length < data.length) {
          comp = c;
          method = 8;
        }
      } catch { /* fallback: stored */ }
    }
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true);
    lh.setUint16(10, dt.time, true);
    lh.setUint16(12, dt.date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, comp.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nameBytes, comp);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, dt.time, true);
    cd.setUint16(14, dt.date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, comp.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + comp.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
