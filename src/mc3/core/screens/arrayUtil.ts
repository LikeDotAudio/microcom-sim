// Helpers shared by the spec-03 array editors (IFB, camera, call, relay, EPC).
import { pad3 } from '../ctx';
import type { Production } from '../model';
import type { Printout } from '../printer';

/** Engine "empty" is 0 (MCOM used 0xFF): a bus number is valid if 1..N. */
export const valid = (p: Production, b: number) => Number.isInteger(b) && b >= 1 && b <= p.N;

/** Assign a cfg field only if it changed (so untouched data never shows as pending). */
export function commit(p: Production, field: string, value: unknown) {
  const cfg = p.cfg as unknown as Record<string, unknown>;
  if (JSON.stringify(cfg[field]) === JSON.stringify(value)) return;
  cfg[field] = value;
  p.touch(field);
}

/** atoi of a typed number ("" → 0). */
export const atoi = (s: string) => {
  const n = parseInt(s.trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

/** 2-char number of chars 2..3 of a mnemonic (c2 = '0' if not a digit), as MCOM's atoi(c2 c3). */
export function num23(mn: string): number {
  const c2 = /\d/.test(mn[2] ?? '') ? mn[2] : '0';
  return atoi(c2 + (mn[3] ?? ''));
}

/** Two-column bus listing line used by the camera and call array printouts. */
export function pairLine(pr: Printout, p: Production, left: number, right: number) {
  if (valid(p, left)) pr.w(`        ${pad3(left)}     ${p.mn(left)}     ${p.ovl(left)}`);
  else pr.w(' '.repeat(29));
  if (valid(p, right)) pr.w(`              ${pad3(right)}     ${p.mn(right)}     ${p.ovl(right)}\r\n`);
  else pr.w('\r\n');
}

export const UL_LINE = (pr: Printout, n: number) => `${pr.UL}${' '.repeat(n)}`;
