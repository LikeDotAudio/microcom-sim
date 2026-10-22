// Printouts (seg 2379). MicroCOM III "prints" to a text file: a browser download or a file in the
// terminal's current directory. Printer control strings are only embedded for the Epson / LaserJet
// settings of Printer Setup (plain text by default).
import type { Ctx } from './ctx';
import { K } from './keys';
import { clearMsg, msg, wopen, type Win } from './tcxl';

const ESC = '\x1b';
const CODES: string[][] = [
  ['', '', '', '', '', '', ''],
  [`${ESC}@`, `${ESC}G`, `${ESC}H`, `${ESC}-1`, `${ESC}-0`, `${ESC}2`, `${ESC}0`],
  [`${ESC}E${ESC}&l0o2A`, `${ESC}(s3B`, `${ESC}(s0B`, `${ESC}&dD`, `${ESC}&d@`, `${ESC}&l6D`, `${ESC}&l8D`],
];
export const PRINTER_TYPES = ['Text File       ', 'Dot Matrix      ', 'LaserJet        '];

export class Printout {
  readonly ctx: Ctx;
  readonly c: string[];
  out = '';
  page = 1;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.c = CODES[ctx.printer.type] ?? CODES[0];
  }

  get INIT() { return this.c[0]; }
  get BOLD() { return this.c[1]; }
  get NOBOLD() { return this.c[2]; }
  get UL() { return this.c[3]; }
  get NOUL() { return this.c[4]; }
  get LPI6() { return this.c[5]; }
  get LPI8() { return this.c[6]; }

  w(s: string) { this.out += s; }

  /** 2379:0524 centred line. */
  centred(ul: boolean, s: string) {
    this.w(' '.repeat(Math.floor((80 - s.length) / 2)));
    if (ul) this.w(this.UL);
    this.w(s + '\r\n');
    if (ul) this.w(this.NOUL);
  }

  /** 2379:031c page header (MicroCOM III wording). */
  header(title: string) {
    const { eng, ws, rt } = this.ctx;
    const d = rt.now();
    const date = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
    const f = ws.current;
    this.w(`${this.LPI6}\r\n\n${this.BOLD}`);
    this.centred(true, 'WBS MicroCOM III Communications System');
    this.w('\n');
    this.centred(true, title);
    this.w(this.NOBOLD);
    this.w(`\n        Production    : ${eng.fname(f).padEnd(8)}    Ports          : ${String(eng.slice).padStart(3, '0')} of ${eng.profile?.ports ?? 2048}\r\n`);
    this.w(`        Name          : ${(eng.prodName(f) || '-').padEnd(20)}  Site: ${eng.facMeta[String(f)]?.site ?? '-'}\r\n`);
    this.w(`        Printout Date:  ${date}\r\n\n`);
  }

  /** 2379:0418 page footer. */
  footer(lines: number) {
    this.w(this.LPI8);
    this.w('\n'.repeat(Math.max(0, 58 - lines)));
    this.w(`        ${this.UL}${' '.repeat(66)}\n\n\r${this.NOUL}`);
    this.centred(false, `Page ${this.page++}`);
    this.w('\f');
  }
}

/** 2379:01b0 confirm window; returns the open window (caller closes) or null if aborted. */
export async function printConfirm(ctx: Ctx): Promise<Win | null> {
  const { rt } = ctx;
  const w = wopen(rt, 11, 15, 14, 50, 0, 0x2f, 0x2f);
  w.prints(0, 4, 0x24, 'Press <ENTER> to continue!');
  w.prints(1, 2, 0x24, 'Any other Key aborts Printout.');
  msg(rt, 14, 'Press <ENTER> to Print Data, any other key to abort!');
  rt.screen.hideCursor();
  rt.flush();
  const k = await rt.getKey();
  clearMsg(rt);
  if (k !== K.ENTER) {
    rt.beep();
    w.close();
    return null;
  }
  return w;
}

/** Run a printout: confirm, build the text, deliver it, report. */
export async function runPrint(ctx: Ctx, what: string, rowMsg: string, file: string, build: (p: Printout) => void) {
  const { rt } = ctx;
  const w = await printConfirm(ctx);
  if (!w) return;
  w.prints(0, 0, 0x28, ` Printing ${what}`.padEnd(34));
  w.prints(1, 0, 0x24, '          Please wait.....       ');
  msg(rt, Math.max(0, Math.floor((80 - rowMsg.length) / 2)), rowMsg);
  const p = new Printout(ctx);
  p.w(p.INIT);
  build(p);
  let where = file;
  try {
    where = (await rt.host.print?.(file, p.out)) ?? file;
  } catch (e) {
    where = `failed: ${(e as Error).message}`;
  }
  w.prints(1, 0, 0x28, '      Printout Complete!     ');
  msg(rt, 2, `Printout saved to ${where}`.slice(0, 76));
  await rt.waitKey(1500);
  clearMsg(rt);
  w.close();
}
