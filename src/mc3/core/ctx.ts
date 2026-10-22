// Shared context handed to every screen, the status panel (rows 19-24) and small common helpers.
import type { EngineClient } from './engine';
import type { Production, Workspace } from './model';
import type { Runtime } from './runtime';
import { messageBox, msgWait } from './tcxl';

export interface PrinterCfg { type: number /* 0 plain text, 1 Epson dot matrix, 2 LaserJet */ }

export interface Ctx {
  rt: Runtime;
  eng: EngineClient;
  ws: Workspace;
  printer: PrinterCfg;
  /** "127.0.0.1:8048" shown as the drive/path. */
  server: string;
}

export const pad3 = (n: number) => String(n).padStart(3, '0');
export const pad2 = (n: number) => String(n).padStart(2, '0');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

/** sysdate(0): "October 21, 2026". */
export function sysdate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** systime(2): "7:46 PM". */
export function systime(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'A' : 'P'}M`;
}

/** Bottom status panel, static part (spec 01 §2.1, MicroCOM III labels). */
export function drawStatusPanel(ctx: Ctx) {
  const s = ctx.rt.screen;
  for (let r = 19; r <= 23; r++) s.fill(r, 0, r, 79, 0x1f);
  s.fill(24, 0, 24, 79, 0x4f);
  s.put(19, 6, 0x17, '@ Copyright 1991,92,93,2026 WARD-BECK SYSTEMS  - all rights reserved');
  s.put(20, 1, 0x17, '[F1]=Help  [ENTER]=Select  [F10]=Save  [ESC]=Abort  [CURSOR]=Browse Selections');
  s.put(21, 1, 0x17, 'Matrix Engine:');
  s.put(21, 45, 0x17, 'Systems ID:');
  s.put(21, 62, 0x17, 'Status:');
  s.put(22, 1, 0x17, 'Production:');
  s.put(22, 27, 0x17, 'Size:');
  s.put(22, 45, 0x17, 'Name:');
  s.put(23, 1, 0x17, 'Date:');
  s.put(23, 27, 0x17, 'Time:');
  s.put(23, 45, 0x17, 'Site:');
  s.put(23, 62, 0x17, 'Pending:');
  s.put(23, 7, 0x1f, sysdate(ctx.rt.now()));
  clock(ctx);
  refreshStatus(ctx);
}

/** Status values (1000:2b1e). */
export function refreshStatus(ctx: Ctx) {
  const s = ctx.rt.screen;
  const { eng, ws } = ctx;
  const f = ws.current;
  const fm = eng.facMeta[String(f)] ?? {};
  s.put(21, 16, 0x1f, ctx.server.padEnd(28).slice(0, 28));
  s.put(21, 57, 0x1f, pad2(f + 1));
  s.put(21, 70, 0x1f, eng.connected ? 'ON-LINE ' : 'OFF-LINE');
  s.put(22, 13, 0x1f, eng.fname(f).padEnd(13));
  s.put(22, 33, 0x1f, `${pad3(eng.slice)} of ${eng.profile?.ports ?? 2048}`.padEnd(11));
  s.put(22, 51, 0x1f, (fm.name ?? '').padEnd(28).slice(0, 28));
  s.put(23, 51, 0x1f, (fm.site ?? '').padEnd(10).slice(0, 10));
  const dirty = ws.dirtyProductions();
  s.put(23, 71, 0x1f, (dirty.includes(f) ? 'YES' : dirty.length ? `${dirty.length} PRD` : 'NONE').padEnd(8));
}

/** Clock idle hook (1000:0d1e). */
export function clock(ctx: Ctx) {
  ctx.rt.screen.put(23, 33, 0x1f, systime(ctx.rt.now()).padEnd(8));
}

/** The active production's working copy, or null (message shown) if the engine is unreachable. */
export async function production(ctx: Ctx): Promise<Production | null> {
  try {
    return await ctx.ws.load();
  } catch (e) {
    await msgWait(ctx.rt, 10, `Matrix Engine not ON-LINE!  ${(e as Error).message}`.slice(0, 68));
    return null;
  }
}

/** MicroCOM III placeholder for screens not carried over yet. */
export async function notYet(ctx: Ctx, what: string) {
  await messageBox(ctx.rt, [what, '', 'This function is not yet available', 'in MicroCOM III.', '', 'Press any key to continue.'], 0x4f, 0x4e);
}
