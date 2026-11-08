declare module "node:fs/promises" {
  export function readFile(path: string | URL): Promise<Uint8Array>;
  export function writeFile(path: string | URL, data: Uint8Array): Promise<void>;
  export function mkdir(path: string | URL, options?: { recursive?: boolean }): Promise<string | undefined>;
}

declare module "node:path" {
  export function dirname(path: string): string;
}

declare const process: {
  argv: string[];
  exitCode?: number;
  exit(code?: number): never;
};
