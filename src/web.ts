import { buildApkg } from "./apkg.ts";
import { EXTERNAL_DATA_WARNING, loadExternalData } from "./external.ts";
import { parseSave } from "./save.ts";
import { parseXingyu } from "./xingyu.ts";

const button = document.querySelector<HTMLButtonElement>("#build")!;
const saveInput = document.querySelector<HTMLInputElement>("#save")!;
const externalInput = document.querySelector<HTMLInputElement>("#external")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;

externalInput.addEventListener("change", () => {
  if (externalInput.checked) alert(EXTERNAL_DATA_WARNING);
});

const sources = [
  "./vendor/xingyu/data/xingyu.json",
  "https://raw.githubusercontent.com/windlandneko/xingyu/main/data/xingyu.json",
];

const fontSources = [
  "./vendor/xingyu/data/Xingyu-VF.ttf",
  "https://raw.githubusercontent.com/windlandneko/xingyu/main/data/Xingyu-VF.ttf",
];

async function loadText(urls: string[]): Promise<string> {
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.text();
    } catch {
      // try the next source
    }
  }
  throw new Error("无法读取 xingyu.json，请确认通过 HTTP 提供服务");
}

async function loadBytes(urls: string[]): Promise<Uint8Array> {
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
    } catch {
      // try the next source
    }
  }
  throw new Error("无法读取 Xingyu-VF.ttf，请确认通过 HTTP 提供服务");
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "正在生成…";
  try {
    const [json, font] = await Promise.all([loadText(sources), loadBytes(fontSources)]);
    const data = parseXingyu(json);
    const file = saveInput.files?.[0];
    const dictionary = file ? parseSave(await file.text()) : undefined;
    const external = externalInput.checked ? await loadExternalData(data.entries) : undefined;
    const apkg = buildApkg(data, {
      media: [{ name: "_Xingyu-VF.ttf", data: font }],
      dictionary,
      external,
    });
    const buffer = apkg.buffer.slice(apkg.byteOffset, apkg.byteOffset + apkg.byteLength) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([buffer], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "xingyu.apkg";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "已生成 xingyu.apkg";
  } catch (error) {
    status.textContent = String(error);
  } finally {
    button.disabled = false;
  }
});
