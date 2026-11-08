import type { XingyuEntry } from "./xingyu.ts";

export const EXTERNAL_DATA_URL =
  "https://raw.githubusercontent.com/ztyqwq/MFA-dictionary/refs/heads/gh-pages/data/app-data.json";

export const EXTERNAL_DATA_WARNING = `将会从 ${EXTERNAL_DATA_URL} 下载未经授权的数据。`;

export interface ExternalDetails {
  wordType: string;
  components: string;
  examples: string[];
}

export type ExternalDetailsMap = Map<string, ExternalDetails>;

const TOKEN_NAMESPACE = "message-from-aliens:glyph-entry:runtime-v1";
const EXAMPLE_LIMIT = 3;

/** Download and map the external MFA dictionary. */
export async function loadExternalData(
  entries: XingyuEntry[],
  url = EXTERNAL_DATA_URL,
): Promise<ExternalDetailsMap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`外部数据下载失败: HTTP ${response.status}`);
  return buildExternalData(await response.json(), entries);
}

export function buildExternalData(raw: unknown, entries: XingyuEntry[]): ExternalDetailsMap {
  const data = raw as {
    save_key_tokens?: unknown;
    entries?: unknown;
    occurrence_sentences?: unknown;
  };
  const tokens = data.save_key_tokens;
  const mfaEntries = data.entries;
  if (!Array.isArray(tokens) || !Array.isArray(mfaEntries) || tokens.length !== mfaEntries.length) {
    throw new Error("外部数据格式不正确");
  }
  const sentences = Array.isArray(data.occurrence_sentences) ? data.occurrence_sentences : [];

  const byToken = new Map<string, XingyuEntry>();
  for (const entry of entries) byToken.set(tokenForName(entry.name), entry);
  const byIndex = tokens.map((token) => byToken.get(String(token)) ?? null);

  const result: ExternalDetailsMap = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const entry = byIndex[i];
    if (!entry) continue;
    const mfa = mfaEntries[i] as {
      atoms?: GlyphRef[];
      dictionary?: { wordtype?: GlyphRef[]; radicals?: GlyphRef[] };
      occurrences?: { sentence?: number }[];
    };
    const dictionary = mfa.dictionary ?? {};

    const wordType = unique(
      glyphIds(dictionary.wordtype)
        .map((id) => byIndex[id]?.name)
        .filter((name): name is string => Boolean(name)),
    ).join(" / ");

    const own = entry.cp;
    const atoms = glyphIds(mfa.atoms).filter((id) => byIndex[id] && byIndex[id]!.cp !== own);
    const radicals = glyphIds(dictionary.radicals).filter((id) => byIndex[id] && byIndex[id]!.cp !== own);
    const components = (atoms.length ? atoms : radicals)
      .map((id) => charOf(byIndex[id]!))
      .join("");

    const examples = (mfa.occurrences ?? [])
      .slice(0, EXAMPLE_LIMIT)
      .map((occurrence) => {
        const sentence = sentences[occurrence.sentence ?? -1] as { sentence?: GlyphRef[] } | undefined;
        return glyphIds(sentence?.sentence)
          .map((id) => (byIndex[id] ? charOf(byIndex[id]!) : ""))
          .join("");
      })
      .filter(Boolean);

    result.set(entry.cp, { wordType, components, examples });
  }
  return result;
}

type GlyphRef = number | { glyph?: number };

function glyphIds(values: GlyphRef[] | undefined): number[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => (typeof value === "number" ? value : value.glyph))
    .filter((value): value is number => Number.isInteger(value));
}

function charOf(entry: XingyuEntry): string {
  return String.fromCodePoint(parseInt(entry.cp, 16));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function tokenForName(name: string): string {
  const input = new TextEncoder().encode(`${TOKEN_NAMESPACE}\0${name.replaceAll(":", "")}`);
  return [...sha256(input).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(data: Uint8Array): Uint8Array {
  const length = data.length;
  const total = Math.ceil((length + 9) / 64) * 64;
  const message = new Uint8Array(total);
  message.set(data);
  message[length] = 0x80;
  const view = new DataView(message.buffer);
  const bits = length * 8;
  view.setUint32(total - 8, Math.floor(bits / 0x100000000), false);
  view.setUint32(total - 4, bits >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, i) => outView.setUint32(i * 4, value, false));
  return out;
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}
