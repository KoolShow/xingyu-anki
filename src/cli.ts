#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildApkg } from "./apkg.ts";
import { EXTERNAL_DATA_WARNING, loadExternalData } from "./external.ts";
import { parseSave } from "./save.ts";
import { cardsFrom, parseXingyu } from "./xingyu.ts";

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log("用法: xingyu-anki [--save 存档] [--external] [input.json] [output.apkg]");
  console.log("默认: vendor/xingyu/data/xingyu.json -> dist/xingyu.apkg");
  console.log("存档可以是游戏的 .sav 或导出的 JSON；不提供时释义全部为 ?");
  console.log("--external 下载外部 MFA 字典，提供词性、字形组成和例句");
  process.exit(0);
}

const positional: string[] = [];
let savePath: string | undefined;
let useExternal = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--save") {
    savePath = args[++i];
    if (!savePath) {
      console.error("--save 缺少文件路径");
      process.exit(1);
    }
  } else if (args[i] === "--external") {
    useExternal = true;
  } else {
    positional.push(args[i]);
  }
}

const input = positional[0] ?? "vendor/xingyu/data/xingyu.json";
const output = positional[1] ?? "dist/xingyu.apkg";

const json = await readFile(input);
const data = parseXingyu(json);
const dictionary = savePath ? parseSave(await readFile(savePath)) : undefined;
const count = cardsFrom(data, dictionary).length;

let external;
if (useExternal) {
  console.warn(`警告：${EXTERNAL_DATA_WARNING}`);
  external = await loadExternalData(data.entries);
}

let font: Uint8Array | undefined;
try {
  font = await readFile(`${dirname(input)}/Xingyu-VF.ttf`);
} catch {
  console.warn("警告：未找到 Xingyu-VF.ttf，卡包将无法显示兴语字形");
}

const apkg = buildApkg(data, {
  deckName: "外星来信",
  media: font ? [{ name: "_Xingyu-VF.ttf", data: font }] : [],
  dictionary,
  external,
});

await mkdir(dirname(output), { recursive: true });
await writeFile(output, apkg);
console.log(`${count} 张卡片 -> ${output} (${apkg.length} bytes)`);
