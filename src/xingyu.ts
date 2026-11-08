export interface XingyuEntry {
  cp: string;
  name: string;
  meaning: string;
  struct?: string;
  fan?: boolean;
  [key: string]: unknown;
}

export interface XingyuData {
  version?: string;
  entries: XingyuEntry[];
}

export interface DeckCard {
  cp: string;
  char: string;
  name: string;
  meaning: string;
  definition: string;
}

export function parseXingyu(input: string | Uint8Array): XingyuData {
  const text = typeof input === "string" ? input : new TextDecoder().decode(input);
  const data = JSON.parse(text) as XingyuData;
  if (!Array.isArray(data.entries)) throw new Error("xingyu.json: missing entries array");
  return data;
}

/** Keep only entries that have a valid code point, a name and a translation. */
export function cardsFrom(data: XingyuData, dictionary?: Record<string, string>): DeckCard[] {
  const cards: DeckCard[] = [];
  for (const entry of data.entries) {
    const name = entry.name?.trim();
    const meaning = entry.meaning?.trim();
    const value = Number.parseInt(entry.cp?.replace(/^U\+/i, "") ?? "", 16);
    if (!name || !meaning || !Number.isFinite(value)) continue;
    cards.push({
      cp: entry.cp,
      char: String.fromCodePoint(value),
      name,
      meaning,
      definition: firstDefinition(entry, dictionary),
    });
  }
  return cards;
}

/** First definition for every entry, used to annotate glyphs anywhere on a card. */
export function definitionsFrom(data: XingyuData, dictionary?: Record<string, string>): Map<string, string> {
  return new Map(data.entries.map((entry) => [entry.cp, firstDefinition(entry, dictionary)]));
}

/** The player's own translation is the first definition; "?" means unknown. */
function firstDefinition(entry: XingyuEntry, dictionary?: Record<string, string>): string {
  if (!dictionary) return "?";
  const note =
    dictionary[entry.name] ??
    dictionary[`:${entry.name}`] ??
    (entry.struct === "exp" ? dictionary[entry.name[0]] : undefined);
  const text = note?.trim();
  return text && text !== "?" ? text : "?";
}
