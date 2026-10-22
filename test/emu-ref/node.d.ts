// The few Node APIs the emulator harness uses (the project has no @types/node).
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], opts?: { stdio?: string; timeout?: number }): unknown;
}
declare module 'node:fs' {
  interface Bytes extends Uint8Array { toString(encoding?: string): string }
  export function existsSync(path: string): boolean;
  export function mkdtempSync(prefix: string): string;
  export function readFileSync(path: string): Bytes;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
}
declare module 'node:os' { export function tmpdir(): string }
declare module 'node:path' {
  export function dirname(p: string): string;
  export function join(...p: string[]): string;
  export function resolve(...p: string[]): string;
}
declare module 'node:url' { export function fileURLToPath(url: string | URL): string }
declare const process: { env: Record<string, string | undefined> };
