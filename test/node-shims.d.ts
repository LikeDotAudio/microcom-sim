// The few Node APIs the parity test uses (the project has no @types/node; vitest runs tests in Node).
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], opts?: { maxBuffer?: number }): { toString(): string };
}
declare module 'node:fs' {
  export function existsSync(p: string): boolean;
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(p: string, data: string): void;
  export function readFileSync(p: string): Uint8Array;
  export function readFileSync(p: string, enc: 'utf8'): string;
}
declare module 'node:crypto' {
  export function createHash(alg: 'sha256'): { update(s: string): { digest(enc: 'hex'): string } };
}
declare const process: { env: Record<string, string | undefined> };
declare module 'node:os' { export function tmpdir(): string }
declare module 'node:path' {
  export function join(...p: string[]): string;
  export function resolve(...p: string[]): string;
}
interface ImportMeta { readonly dirname: string }
