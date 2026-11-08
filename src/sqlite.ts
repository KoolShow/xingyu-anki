export type SqlValue = string | number;

export interface SqlIndex {
  name: string;
  sql: string;
  columns(row: SqlValue[]): SqlValue[];
}

export interface SqlTable {
  name: string;
  sql: string;
  rows: SqlValue[][];
  indexes?: SqlIndex[];
}

const PAGE_SIZE = 4096;
const PAGE1_OFFSET = 100;

interface TableCell {
  key: number;
  payload: Uint8Array;
}

interface PreparedTableCell extends TableCell {
  local: Uint8Array;
  overflow: Uint8Array;
  cellSize: number;
  overflowPage?: number;
}

interface IndexCell {
  key: SqlValue[];
  payload: Uint8Array;
}

/**
 * Write a minimal SQLite 3 database. Supports table leaves/interiors and
 * non-unique indexes; payloads are small enough that overflow pages are not
 * needed.
 */
export function buildSqlite(tables: SqlTable[]): Uint8Array {
  const pages: Uint8Array[] = [new Uint8Array(PAGE_SIZE)];
  const alloc = (page: Uint8Array): number => {
    pages.push(page);
    return pages.length;
  };
  const master: SqlValue[][] = [];

  for (const table of tables) {
    const rowid = (row: SqlValue[], i: number): number => (typeof row[0] === "number" ? row[0] : i + 1);
    const cells = table.rows
      .map((row, i) => ({ key: rowid(row, i), payload: encodeRecord(row) }))
      .sort((a, b) => a.key - b.key);
    const root = buildTableTree(cells, alloc);
    master.push(["table", table.name, table.name, root, table.sql]);

    for (const index of table.indexes ?? []) {
      const cells = table.rows
        .map((row, i) => {
          const key = [...index.columns(row), rowid(row, i)];
          return { key, payload: encodeRecord(key) };
        })
        .sort((a, b) => compareKeys(a.key, b.key));
      master.push(["index", index.name, table.name, buildIndexTree(cells, alloc), index.sql]);
    }
  }

  const masterCells = master.map((row, i) => ({ key: i + 1, payload: encodeRecord(row) }));
  const groups = packLeaf(masterCells, (cell) => tableLeafCell(cell).length, PAGE1_OFFSET);
  if (groups.length !== 1) throw new Error("sqlite master does not fit on page 1");
  pages[0] = makeLeafPage(13, groups[0], PAGE1_OFFSET, tableLeafCell);

  const out = concatBytes(pages);
  writeHeader(out, pages.length);
  return out;
}

function buildTableTree(cells: TableCell[], alloc: (page: Uint8Array) => number): number {
  if (!cells.length) return alloc(makeLeafPage(13, [], 0, tableLeafCell));
  const prepared = cells.map(prepareTableCell);
  let level = packLeaf(prepared, (cell) => cell.cellSize).map((group) => ({
    page: alloc(makeTableLeafPage(group, alloc)),
    max: group[group.length - 1].key,
  }));
  while (level.length > 1) {
    level = packInterior(level, (item) => varint(item.max).length).map((group) => ({
      page: alloc(makeInteriorTablePage(group)),
      max: group[group.length - 1].max,
    }));
  }
  return level[0].page;
}

function buildIndexTree(cells: IndexCell[], alloc: (page: Uint8Array) => number): number {
  if (!cells.length) return alloc(makeLeafPage(10, [], 0, indexLeafCell));
  const groups = packLeaf(cells, (cell) => indexLeafCell(cell).length);
  if (groups.length === 1) return alloc(makeLeafPage(10, groups[0], 0, indexLeafCell));

  // In a SQLite index b-tree the separator key lives only in the parent, so
  // promote (and remove) the largest entry of every leaf except the last.
  const separators = groups.slice(0, -1).map((group) => group.pop()!);
  const children = groups.map((group) => alloc(makeLeafPage(10, group, 0, indexLeafCell)));
  const rootCells = separators.map((cell, i) => ({
    data: concatBytes([uint32(children[i]), bytes(varint(cell.payload.length)), cell.payload]),
    key: cell.key,
  }));
  const used = 12 + rootCells.reduce((sum, cell) => sum + 2 + cell.data.length, 0);
  if (used > PAGE_SIZE) throw new Error("sqlite index root overflow");
  return alloc(makeInteriorPage(2, rootCells, children[children.length - 1]));
}

function tableLeafCell(cell: TableCell): Uint8Array {
  return concatBytes([bytes(varint(cell.payload.length)), bytes(varint(cell.key)), cell.payload]);
}

function prepareTableCell(cell: TableCell): PreparedTableCell {
  const size = cell.payload.length;
  const maxLocal = PAGE_SIZE - 35;
  const minLocal = Math.floor(((PAGE_SIZE - 12) * 32) / 255) - 23;
  let localLength = size;
  if (size > maxLocal) {
    const candidate = minLocal + ((size - minLocal) % (PAGE_SIZE - 4));
    localLength = candidate <= maxLocal ? candidate : minLocal;
  }
  return {
    ...cell,
    local: cell.payload.subarray(0, localLength),
    overflow: cell.payload.subarray(localLength),
    cellSize:
      varint(size).length + varint(cell.key).length + localLength + (localLength < size ? 4 : 0),
  };
}

function tableLeafCellData(cell: PreparedTableCell): Uint8Array {
  return concatBytes([
    bytes(varint(cell.payload.length)),
    bytes(varint(cell.key)),
    cell.local,
    ...(cell.overflow.length ? [uint32(cell.overflowPage ?? 0)] : []),
  ]);
}

function makeTableLeafPage(
  cells: PreparedTableCell[],
  alloc: (page: Uint8Array) => number,
): Uint8Array {
  for (const cell of cells) {
    if (cell.overflow.length) cell.overflowPage = allocOverflow(cell.overflow, alloc);
  }
  return makeLeafPage(13, cells, 0, tableLeafCellData);
}

function allocOverflow(data: Uint8Array, alloc: (page: Uint8Array) => number): number {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += PAGE_SIZE - 4) {
    chunks.push(data.subarray(offset, offset + PAGE_SIZE - 4));
  }
  const pages = chunks.map((chunk) => {
    const page = new Uint8Array(PAGE_SIZE);
    page.set(chunk, 4);
    return page;
  });
  const numbers = pages.map((page) => alloc(page));
  pages.forEach((page, i) => {
    new DataView(page.buffer).setUint32(0, i + 1 < numbers.length ? numbers[i + 1] : 0, false);
  });
  return numbers[0];
}

function indexLeafCell(cell: IndexCell): Uint8Array {
  return concatBytes([bytes(varint(cell.payload.length)), cell.payload]);
}

function packLeaf<T>(cells: T[], size: (cell: T) => number, offset = 0): T[][] {
  const available = PAGE_SIZE - offset - 8;
  const groups: T[][] = [];
  let current: T[] = [];
  let used = 8;
  for (const cell of cells) {
    const needed = 2 + size(cell);
    if (current.length && used + needed > available) {
      groups.push(current);
      current = [];
      used = 8;
    }
    current.push(cell);
    used += needed;
  }
  if (current.length) groups.push(current);
  return groups;
}

function packInterior<T>(children: T[], size: (child: T) => number): T[][] {
  return packChildren(children, (child) => 6 + size(child));
}

function packChildren<T>(children: T[], addedSize: (child: T) => number): T[][] {
  const available = PAGE_SIZE - 12;
  const groups: T[][] = [];
  let current: T[] = [];
  let used = 12;
  for (const child of children) {
    if (!current.length) {
      current.push(child);
      continue;
    }
    const needed = addedSize(current[current.length - 1]);
    if (used + needed > available) {
      groups.push(current);
      current = [child];
      used = 12;
    } else {
      used += needed;
      current.push(child);
    }
  }
  if (current.length) groups.push(current);
  if (groups.length > 1 && groups[groups.length - 1].length === 1) {
    const previous = groups[groups.length - 2];
    if (previous.length > 2) groups[groups.length - 1].unshift(previous.pop()!);
  }
  return groups;
}

function makeLeafPage<T>(type: number, cells: T[], offset: number, encode: (cell: T) => Uint8Array): Uint8Array {
  const page = new Uint8Array(PAGE_SIZE);
  const view = new DataView(page.buffer);
  let content = PAGE_SIZE;
  const offsets: number[] = [];
  for (const cell of cells) {
    const data = encode(cell);
    content -= data.length;
    page.set(data, content);
    offsets.push(content);
  }
  page[offset] = type;
  view.setUint16(offset + 1, 0);
  view.setUint16(offset + 3, cells.length);
  view.setUint16(offset + 5, content);
  page[offset + 7] = 0;
  offsets.forEach((cell, i) => view.setUint16(offset + 8 + i * 2, cell));
  return page;
}

function makeInteriorTablePage(children: { page: number; max: number }[]): Uint8Array {
  const cells = children.slice(0, -1).map((child) => {
    const cell = concatBytes([uint32(child.page), bytes(varint(child.max))]);
    return { data: cell, key: child.max };
  });
  return makeInteriorPage(5, cells, children[children.length - 1].page);
}

function makeInteriorPage(
  type: number,
  cells: { data: Uint8Array; key: SqlValue[] | number }[],
  rightmost: number,
): Uint8Array {
  const page = new Uint8Array(PAGE_SIZE);
  const view = new DataView(page.buffer);
  let content = PAGE_SIZE;
  const offsets: number[] = [];
  for (const cell of cells) {
    content -= cell.data.length;
    page.set(cell.data, content);
    offsets.push(content);
  }
  page[0] = type;
  view.setUint16(1, 0);
  view.setUint16(3, cells.length);
  view.setUint16(5, content);
  page[7] = 0;
  view.setUint32(8, rightmost);
  offsets.forEach((cell, i) => view.setUint16(12 + i * 2, cell));
  return page;
}

function encodeRecord(values: SqlValue[]): Uint8Array {
  const types: number[] = [];
  const bodies: Uint8Array[] = [];
  for (const value of values) {
    if (typeof value === "number") {
      types.push(6);
      const body = new Uint8Array(8);
      new DataView(body.buffer).setBigInt64(0, BigInt(Math.trunc(value)), false);
      bodies.push(body);
    } else {
      const body = new TextEncoder().encode(value);
      types.push(13 + body.length * 2);
      bodies.push(body);
    }
  }
  const typeBytes = types.flatMap(varint);
  let headerSize = typeBytes.length + 1;
  while (varint(headerSize).length + typeBytes.length !== headerSize) {
    headerSize = typeBytes.length + varint(headerSize).length;
  }
  return concatBytes([bytes(varint(headerSize)), bytes(typeBytes), ...bodies]);
}

function varint(value: number): number[] {
  if (value < 0 || !Number.isSafeInteger(value)) throw new RangeError(`bad varint: ${value}`);
  if (value <= 0x7f) return [value];
  const groups: number[] = [];
  while (value > 0) {
    groups.unshift(value & 0x7f);
    value = Math.floor(value / 128);
  }
  return groups.map((group, i) => (i === groups.length - 1 ? group : group | 0x80));
}

function compareKeys(a: SqlValue[], b: SqlValue[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const left = a[i];
    const right = b[i];
    if (typeof left === "number" && typeof right === "number") {
      if (left !== right) return left - right;
    } else if (typeof left === "string" && typeof right === "string") {
      if (left !== right) return left < right ? -1 : 1;
    } else {
      return typeof left === "number" ? -1 : 1;
    }
  }
  return a.length - b.length;
}

function writeHeader(db: Uint8Array, pageCount: number): void {
  const view = new DataView(db.buffer);
  db.set(new TextEncoder().encode("SQLite format 3\0"), 0);
  view.setUint16(16, PAGE_SIZE);
  db[18] = 1;
  db[19] = 1;
  db[20] = 0;
  db[21] = 64;
  db[22] = 32;
  db[23] = 32;
  view.setUint32(24, 1);
  view.setUint32(28, pageCount);
  view.setUint32(32, 0);
  view.setUint32(36, 0);
  view.setUint32(40, 1);
  view.setUint32(44, 4);
  view.setUint32(48, 0);
  view.setUint32(52, 0);
  view.setUint32(56, 1);
  view.setUint32(60, 0);
  view.setUint32(64, 0);
  view.setUint32(68, 0);
  view.setUint32(92, 1);
  view.setUint32(96, 3045000);
}

function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function bytes(values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
