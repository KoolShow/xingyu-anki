import { aesCbcDecrypt } from "./aes.ts";

export type SaveDictionary = Record<string, string>;

/**
 * Read a Message From Aliens save file. Both plain JSON saves and the game's
 * AES-CBC/base64 saves are supported; the returned object maps word names to
 * the player's translations.
 */
export function parseSave(input: string | Uint8Array): SaveDictionary {
  let text = (typeof input === "string" ? input : new TextDecoder().decode(input)).trim();
  if (!text.startsWith("{")) text = decrypt(text);

  const data = JSON.parse(text) as { dict?: unknown };
  const dict = data.dict;
  if (!dict || typeof dict !== "object" || !Object.values(dict).every((value) => typeof value === "string")) {
    throw new Error("存档中没有字典记录");
  }
  return dict as SaveDictionary;
}

function decrypt(base64: string): string {
  const encoder = new TextEncoder();
  const bytes = Uint8Array.from(atob(base64.replace(/\s+/g, "")), (char) => char.charCodeAt(0));
  const plain = aesCbcDecrypt(bytes, encoder.encode("terrible_artwork"), encoder.encode("wedidn'tplaytest"));
  return new TextDecoder().decode(plain);
}
