import { buildSqlite, type SqlTable } from "./sqlite.ts";
import { createZip } from "./zip.ts";
import { cardsFrom, definitionsFrom, parseXingyu, type DeckCard, type XingyuData } from "./xingyu.ts";
import type { ExternalDetails, ExternalDetailsMap, ExternalGlyph } from "./external.ts";

const DECK_ID = 1_765_000_000_001;
const MODEL_ID = 1_765_000_000_002;
const DEFAULT_DECK_NAME = "外星来信";
const DEFAULT_DESCRIPTION =
  "原作：<i>外星来信（Message From Aliens）</i>；兴语字体与翻译：windlandneko。" +
  "建议完成此游戏的全部字典后再使用，当心剧透。禁止二次分发产物！" +
  "非官方同人作品，仅限个人非商业使用。";

const LATEX_PRE =
  "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n" +
  "\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n";

const SCHEMA = `
CREATE TABLE col (
    id              integer primary key,
    crt             integer not null,
    mod             integer not null,
    scm             integer not null,
    ver             integer not null,
    dty             integer not null,
    usn             integer not null,
    ls              integer not null,
    conf            text not null,
    models          text not null,
    decks           text not null,
    dconf           text not null,
    tags            text not null
);
CREATE TABLE notes (
    id              integer primary key,
    guid            text not null,
    mid             integer not null,
    mod             integer not null,
    usn             integer not null,
    tags            text not null,
    flds            text not null,
    sfld            integer not null,
    csum            integer not null,
    flags           integer not null,
    data            text not null
);
CREATE TABLE cards (
    id              integer primary key,
    nid             integer not null,
    did             integer not null,
    ord             integer not null,
    mod             integer not null,
    usn             integer not null,
    type            integer not null,
    queue           integer not null,
    due             integer not null,
    ivl             integer not null,
    factor          integer not null,
    reps            integer not null,
    lapses          integer not null,
    left            integer not null,
    odue            integer not null,
    odid            integer not null,
    flags           integer not null,
    data            text not null
);
CREATE TABLE revlog (
    id              integer primary key,
    cid             integer not null,
    usn             integer not null,
    ease            integer not null,
    ivl             integer not null,
    lastIvl         integer not null,
    factor          integer not null,
    time            integer not null,
    type            integer not null
);
CREATE TABLE graves (
    usn             integer not null,
    oid             integer not null,
    type            integer not null
);
`;

const INDEXES = [
  ["ix_notes_usn", "CREATE INDEX ix_notes_usn on notes (usn)", 4],
  ["ix_cards_usn", "CREATE INDEX ix_cards_usn on cards (usn)", 5],
  ["ix_revlog_usn", "CREATE INDEX ix_revlog_usn on revlog (usn)", 2],
  ["ix_cards_nid", "CREATE INDEX ix_cards_nid on cards (nid)", 1],
  ["ix_cards_sched", "CREATE INDEX ix_cards_sched on cards (did, queue, due)", [2, 7, 8]],
  ["ix_revlog_cid", "CREATE INDEX ix_revlog_cid on revlog (cid)", 1],
  ["ix_notes_csum", "CREATE INDEX ix_notes_csum on notes (csum)", 8],
] as const;

export interface ApkgMedia {
  name: string;
  data: Uint8Array;
}

export interface ApkgOptions {
  deckName?: string;
  description?: string;
  /** Timestamp in milliseconds; useful for reproducible builds. */
  timestamp?: number;
  /** Extra files copied into the package (e.g. the Xingyu font). */
  media?: ApkgMedia[];
  /** Player translations from a save file, keyed by word name. */
  dictionary?: Record<string, string>;
  /** Optional details from the external MFA dictionary, keyed by code point. */
  external?: ExternalDetailsMap;
}

export function buildApkgFromJson(input: string | Uint8Array, options: ApkgOptions = {}): Uint8Array {
  return buildApkg(parseXingyu(input), options);
}

export function buildApkg(data: XingyuData, options: ApkgOptions = {}): Uint8Array {
  const cards = cardsFrom(data, options.dictionary);
  if (!cards.length) throw new Error("no entries with both name and meaning");
  const definitions = definitionsFrom(data, options.dictionary);

  const ms = options.timestamp ?? Date.now();
  const seconds = Math.floor(ms / 1000);
  const deckName = options.deckName ?? DEFAULT_DECK_NAME;
  const description = options.description ?? DEFAULT_DESCRIPTION;

  const model = {
    css: `
@font-face { font-family: "Xingyu"; src: url("_Xingyu-VF.ttf"); }
.card {
  --fg: #1f2937; --muted: #737373; --canvas: #fffaf0; --panel: #fff;
  --border: #d1d5db; --radius: 7px;
  font-family: Georgia, "Songti SC", "Noto Serif CJK SC", serif;
  background: var(--canvas); color: var(--fg); font-size: 17px; line-height: 1.5; text-align: left;
}
:root.night-mode, :root .night_mode, :root .nightMode, [data-bs-theme="dark"] {
  --fg: #e5e7eb; --muted: #a3a3a3; --canvas: #2c2c2c; --panel: #363636; --border: #494949;
}
.CardSide { max-width: 720px; margin: 0 auto; padding: 8px 12px 20px; }
.Question {
  min-height: 180px; display: flex; align-items: center; justify-content: center;
  padding: 16px; border: 1px solid var(--border); border-radius: var(--radius) var(--radius) 0 0;
  background: var(--panel);
}
.VocabKanji { margin: 0; font-family: "Xingyu"; font-size: 96px; font-weight: normal; line-height: 1.1; }
.Answer {
  display: flex; flex-direction: column; gap: 8px; padding: 14px 18px;
  border: 1px solid var(--border); border-top: 0; border-radius: 0 0 var(--radius) var(--radius);
  background: var(--panel);
}
.Word { font-size: 22px; font-weight: 600; }
.Definition { font-size: 20px; }
.Meaning { color: var(--muted); font-size: 16px; }
.Field { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.Label { color: var(--muted); font-size: 13px; }
.GlyphRow { display: flex; flex-wrap: wrap; align-items: flex-start; }
.xy { display: inline-flex; flex-direction: column; align-items: center; margin: 2px 5px 4px 0; vertical-align: top; }
.xy-char { font-family: "Xingyu"; font-size: 2em; line-height: 1; }
.xy-def {
  max-width: 8em; margin-top: 2px; color: var(--muted); font-size: 11px;
  line-height: 1.25; text-align: center; overflow-wrap: anywhere;
}
.big .xy-char { font-size: 96px; }
.big .xy-def { max-width: 12em; margin-top: 6px; font-size: 15px; }
.SentenceList {
  margin-top: 14px; padding: 12px 16px;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel);
}
.Sentence { display: flex; flex-wrap: wrap; align-items: flex-start; padding: 8px 0; }
.Sentence + .Sentence { border-top: 1px solid var(--border); }
.Sentence .xy-char { font-size: 28px; }
.Sentence .xy-def { max-width: 7em; font-size: 10px; }
.Notice { margin-top: 10px; color: var(--muted); font-size: 12px; text-align: center; }
@media (max-width: 475px) {
  .CardSide { padding: 0 6px 16px; }
  .Answer { padding: 12px; }
  .VocabKanji, .big .xy-char { font-size: 72px; }
}
`,
    did: DECK_ID,
    flds: [
      field("字符", 0),
      field("原文", 1),
      field("释义", 2),
      field("翻译", 3),
      field("词性", 4),
      field("组成", 5),
      field("例句", 6),
    ],
    id: MODEL_ID,
    latexPost: "\\end{document}",
    latexPre: LATEX_PRE,
    latexsvg: false,
    mod: seconds,
    name: "外星来信",
    req: [[0, "all", [0]]],
    sortf: 1,
    tags: [],
    tmpls: [
      {
        name: "Card 1",
        ord: 0,
        qfmt: `
<main class="CardSide">
  <header class="Question"><h1 class="VocabKanji">{{字符}}</h1></header>
  <div class="Notice">建议完成此游戏的全部字典后再使用，当心剧透</div>
</main>`,
        afmt: `
<main class="CardSide">
  <header class="Question">
    <h1 class="VocabKanji"><span class="xy big"><span class="xy-char">{{字符}}</span><span class="xy-def">{{释义}}</span></span></h1>
  </header>
  <section class="Answer">
    <div class="Word">{{原文}}</div>
    <div class="Definition">{{释义}}</div>
    <div class="Meaning">{{翻译}}</div>
    {{#词性}}<div class="Field"><span class="Label">词性</span><div class="GlyphRow">{{词性}}</div></div>{{/词性}}
    {{#组成}}<div class="Field"><span class="Label">组成</span><div class="GlyphRow">{{组成}}</div></div>{{/组成}}
  </section>
  {{#例句}}<section class="SentenceList"><div class="Label">例句</div>{{例句}}</section>{{/例句}}
  <div class="Notice">禁止二次分发产物！</div>
</main>`,
        bafmt: "",
        bqfmt: "",
        bfont: "",
        bsize: 0,
        did: null,
      },
    ],
    type: 0,
    usn: -1,
    vers: [],
  };

  const conf = {
    activeDecks: [DECK_ID],
    addToCur: true,
    collapseTime: 1200,
    curDeck: DECK_ID,
    curModel: String(MODEL_ID),
    dueCounts: true,
    estTimes: true,
    newBury: true,
    newSpread: 0,
    nextPos: 1,
    sortBackwards: false,
    sortType: "noteFld",
    timeLim: 0,
  };

  const deck = {
    collapsed: false,
    conf: 1,
    desc: description,
    dyn: 0,
    extendNew: 0,
    extendRev: 50,
    id: DECK_ID,
    lrnToday: [0, 0],
    mod: seconds,
    name: deckName,
    newToday: [0, 0],
    revToday: [0, 0],
    timeToday: [0, 0],
    usn: -1,
  };

  const deckConf = {
    "1": {
      autoplay: true,
      id: 1,
      lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      maxTaken: 60,
      mod: 0,
      name: "Default",
      new: {
        bury: true,
        delays: [1, 10],
        initialFactor: 2500,
        ints: [1, 4, 7],
        order: 1,
        perDay: 20,
        separate: true,
      },
      replayq: true,
      rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 },
      timer: 0,
      usn: 0,
    },
  };

  const base = ms;
  const notes = cards.map((card, i) =>
    noteRow(card, base + i, seconds, options.external?.get(card.cp), definitions),
  );
  const cardRows = cards.map((_, i) => [
    base + 10_000 + i,
    base + i,
    DECK_ID,
    0,
    seconds,
    -1,
    0,
    0,
    i + 1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    "",
  ]);

  const tables: SqlTable[] = [
    {
      name: "col",
      sql: schemaOf("col"),
      rows: [
        [
          1,
          seconds,
          ms,
          ms,
          11,
          0,
          0,
          0,
          JSON.stringify(conf),
          JSON.stringify({ [String(MODEL_ID)]: model }),
          JSON.stringify({ [String(DECK_ID)]: deck }),
          JSON.stringify(deckConf),
          "{}",
        ],
      ],
    },
    { name: "notes", sql: schemaOf("notes"), rows: notes, indexes: indexDefs("notes") },
    { name: "cards", sql: schemaOf("cards"), rows: cardRows, indexes: indexDefs("cards") },
    { name: "revlog", sql: schemaOf("revlog"), rows: [], indexes: indexDefs("revlog") },
    { name: "graves", sql: schemaOf("graves"), rows: [] },
  ];

  const db = buildSqlite(tables);
  const media = options.media ?? [];
  const mediaList: Record<string, string> = {};
  media.forEach((file, i) => (mediaList[String(i)] = file.name));
  return createZip([
    { name: "collection.anki2", data: db },
    { name: "media", data: new TextEncoder().encode(JSON.stringify(mediaList)) },
    ...media.map((file, i) => ({ name: String(i), data: file.data })),
  ]);
}

function noteRow(
  card: DeckCard,
  id: number,
  seconds: number,
  details: ExternalDetails | undefined,
  definitions: Map<string, string>,
): (string | number)[] {
  const wordType = renderGlyphs(details?.wordType ?? [], definitions);
  const components = renderGlyphs(details?.components ?? [], definitions);
  const examples = (details?.examples ?? [])
    .map((sentence) => `<div class="Sentence">${renderGlyphs(sentence, definitions)}</div>`)
    .join("");
  return [
    id,
    card.cp,
    MODEL_ID,
    seconds,
    -1,
    " ",
    `${escapeHtml(card.char)}\x1f${escapeHtml(card.name)}\x1f${escapeHtml(card.definition)}\x1f${escapeHtml(card.meaning)}` +
      `\x1f${wordType}\x1f${components}\x1f${examples}`,
    card.name,
    0,
    0,
    "",
  ];
}

function renderGlyphs(glyphs: ExternalGlyph[], definitions: Map<string, string>): string {
  return glyphs
    .map(
      (glyph) =>
        `<span class="xy"><span class="xy-char">${escapeHtml(glyph.char)}</span>` +
        `<span class="xy-def">${escapeHtml(definitions.get(glyph.cp) ?? "?")}</span></span>`,
    )
    .join("");
}

function field(name: string, ord: number) {
  return { name, ord, font: "Arial", media: [], rtl: false, size: 20, sticky: false };
}

function schemaOf(name: string): string {
  const start = SCHEMA.indexOf(`CREATE TABLE ${name} (`);
  const end = SCHEMA.indexOf(";", start);
  return SCHEMA.slice(start, end).trim();
}

function indexDefs(table: string) {
  return INDEXES.filter(([, sql]) => sql.includes(` on ${table} `)).map(([name, sql, columns]) => ({
    name,
    sql,
    columns: (row: (string | number)[]) =>
      (Array.isArray(columns) ? columns : [columns]).map((i) => row[i]),
  }));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}
