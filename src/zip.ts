const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Minimal ZIP writer (stored entries, no external dependencies). */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0x21, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    local.push(header, entry.data);

    const record = new Uint8Array(46 + name.length);
    const rview = new DataView(record.buffer);
    rview.setUint32(0, 0x02014b50, true);
    rview.setUint16(4, 20, true);
    rview.setUint16(6, 20, true);
    rview.setUint16(8, 0x0800, true);
    rview.setUint16(10, 0, true);
    rview.setUint16(12, 0, true);
    rview.setUint16(14, 0x21, true);
    rview.setUint32(16, crc, true);
    rview.setUint32(20, entry.data.length, true);
    rview.setUint32(24, entry.data.length, true);
    rview.setUint16(28, name.length, true);
    rview.setUint32(42, offset, true);
    record.set(name, 46);
    central.push(record);

    offset += header.length + entry.data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);

  return concat([...local, ...central, end]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
