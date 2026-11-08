#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildApkgFromJson } from "./apkg.ts";
import { parseSave } from "./save.ts";
import { cardsFrom, parseXingyu } from "./xingyu.ts";

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log("用法: xingyu-anki [--save 存档] [input.json] [output.apkg]");
  console.log("默认: vendor/xingyu/data/xingyu.json -> dist/xingyu.apkg");
  console.log("存档可以是游戏的 .sav 或导出的 JSON；不提供时释义全部为 ?");
  process.exit(0);
}

const positional: string[] = [];
let savePath: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--save") {
    savePath = args[++i];
    if (!savePath) {
      console.error("--save 缺少文件路径");
      process.exit(1);
    }
  } else {
    positional.push(args[i]);
  }
}

const input = positional[0] ?? "vendor/xingyu/data/xingyu.json";
const output = positional[1] ?? "dist/xingyu.apkg";

const json = await readFile(input);
const dictionary = savePath ? parseSave(await readFile(savePath)) : undefined;
const count = cardsFrom(parseXingyu(json), dictionary).length;

let font: Uint8Array | undefined;
try {
  font = await readFile(`${dirname(input)}/Xingyu-VF.ttf`);
} catch {
  console.warn("警告：未找到 Xingyu-VF.ttf，卡包将无法显示兴语字形");
}

const apkg = buildApkgFromJson(json, {
  deckName: "外星来信",
  media: font ? [{ name: "_Xingyu-VF.ttf", data: font }] : [],
  dictionary,
});

await mkdir(dirname(output), { recursive: true });
await writeFile(output, apkg);
console.log(`${count} 张卡片 -> ${output} (${apkg.length} bytes)`);
