// The few Node APIs the parity test uses (the project has no @types/node; vitest runs tests in Node).
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], opts?: { maxBuffer?: number }): { toString(): string };
}
declare module 'node:fs' {
  export function existsSync(p: string): boolean;
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(p: string, data: string): void;
  export function readFileSync(p: string): Uint8Array;
}
declare module 'node:os' { export function tmpdir(): string }
declare module 'node:path' {
  export function join(...p: string[]): string;
  export function resolve(...p: string[]): string;
}
interface ImportMeta { readonly dirname: string }
