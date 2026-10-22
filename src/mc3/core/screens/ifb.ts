// Define System ▸ IFB/PGM Sound (seg 153b, spec 03 §1).
import { pad3, production, type Ctx } from '../ctx';
import { K } from '../keys';
import type { Production } from '../model';
import { runPrint } from '../printer';
import { clearMsg, DIGITS, editField, msg, msgWait, wopen, type Win } from '../tcxl';
import { atoi, commit, valid } from './arrayUtil';

const LIMITS = [24, 48, 96, 144, 192, 240];

/** Bus whose mnemonic is IFnn for IFB n (engine config.ifb_number_of), else 0. */
export function ifbBuses(p: Production): number[] {
  const out = new Array(48).fill(0);
  for (let b = 1; b <= p.N; b++) {
    const mn = p.mn(b);
    if (mn.slice(0, 2).toUpperCase() !== 'IF' || !/^\d+$/.test(mn.slice(2, 4).trim())) continue;
    const n = Number(mn.slice(2, 4));
    if (n >= 1 && n <= 48 && !out[n - 1]) out[n - 1] = b;
  }
  return out;
}

/** Lowest PGM source for a mode (1, 4, 8, 12, 1 sources for modes 0..4). */
export const lowOf = (mode: number, limit: number) => limit - ([0, 3, 7, 11, 0][mode] ?? 0);

export async function ifbEditor(ctx: Ctx) {
  const { rt } = ctx;
  clearMsg(rt);
  msg(rt, 24, 'IFB Table loading.... please wait!');
  const p = await production(ctx);
  if (!p) return;
  const bus = ifbBuses(p);
  const pgm = p.cfg.ifb_pgm.map(v => (v === 0xff ? 0 : v));
  let mode = Math.min(4, Math.max(0, p.cfg.ifb_mode | 0));
  let limit = LIMITS.includes(p.cfg.pgm_limit) ? p.cfg.pgm_limit : 48;

  const av = wopen(rt, 2, 60, 18, 68, 0, 0x30, 0x30);
  av.prints(0, 0, 0x30, ' Avail');
  av.prints(1, 0, 0x30, 'PGM SND');
  av.hline(2, 0, 8, 0, 0x30);
  const w = wopen(rt, 2, 24, 21, 50, 0, 0x30, 0x30);
  w.prints(0, 0, 0x30, 'IFB Bus    IFB    PGM SND');
  w.prints(1, 0, 0x30, ' #   #  Mnem Ovly Source ');
  w.hline(2, 0, 25, 0, 0x30);
  w.hline(15, 0, 25, 0, 0x30);
  w.vline(0, 3, 16, 0, 0x30);
  w.vline(0, 7, 16, 0, 0x30);
  w.vline(1, 12, 15, 0, 0x30);
  w.vline(0, 17, 16, 2, 0x30);
  w.prints(16, 1, 0x30, 'IFB Mode:');
  w.prints(17, 1, 0x30, 'Source Upper Limit:');
  const showMode = () => { w.prints(16, 12, 0x34, String(mode)); w.prints(17, 21, 0x34, pad3(limit)); };
  const avail = () => {
    for (let r = 3; r <= 14; r++) av.prints(r, 2, 0x31, '   ');
    const low = lowOf(mode, limit);
    for (let v = low, r = 3; v <= limit && r <= 14; v++, r++) av.prints(r, 2, 0x31, pad3(v));
  };
  const row = (win: Win, attr: number, wrow: number, n: number) => {
    win.prints(wrow, 0, attr, pad3(n));
    const b = bus[n - 1];
    win.prints(wrow, 4, attr, b ? pad3(b) : '   ');
    win.prints(wrow, 8, attr, b ? p.mn(b) : '    ');
    win.prints(wrow, 13, attr, b ? p.ovl(b) : '    ');
    win.prints(wrow, 20, attr, b && pgm[n - 1] > 0 && pgm[n - 1] <= p.N ? pad3(pgm[n - 1]) : '   ');
  };
  let cur = 1;
  let wrow = 3;
  const paint = () => { for (let i = 0; i < 12; i++) row(w, 0x31, 3 + i, cur - (wrow - 3) + i); };
  showMode();
  avail();
  paint();
  const save = () => {
    commit(p, 'ifb_mode', mode);
    commit(p, 'pgm_limit', limit);
    commit(p, 'ifb_pgm', pgm.map((v, i) => (bus[i] ? v : p.cfg.ifb_pgm[i])));
    commit(p, 'ifb_bus', bus);
  };
  const close = () => { w.close(); av.close(); clearMsg(rt); };
  for (;;) {
    msg(rt, 7, 'F3..IFB Mode   F5..Source Upper Limit   F10..Save/End   ESC..Abort');
    row(w, 0x1f, wrow, cur);
    let key;
    const low = lowOf(mode, limit);
    if (mode >= 1 && mode <= 3 && bus[cur - 1]) {
      const v = pgm[cur - 1];
      const s = v > limit || v < low ? pad3(limit) : pad3(v);
      const r = await editField(rt, {
        row: w.top + wrow, col: w.left + 20, width: 3, value: s, upper: true, charOk: DIGITS,
        validate: t => {
          const n = atoi(t);
          if (n >= low && n <= limit) return true;
          msg(rt, 14, 'Program Sound Assignment must be within defined Range!');
          return false;
        },
      }, 0x1f, k => /^\{F([1-9]|10)\}$/.test(k) || k === K.UP || k === K.DOWN || k === K.HOME || k === K.SF7, 0x1f);
      key = r.key;
      if (key !== K.ESC) pgm[cur - 1] = atoi(r.value);
    } else {
      rt.screen.hideCursor();
      key = await rt.getKey();
    }
    rt.screen.hideCursor();
    row(w, 0x31, wrow, cur);
    switch (key) {
      case K.ESC:
        if (mode === 0 || mode === 4) save();
        close();
        return;
      case K.CENTER: case K.F10:
        msg(rt, 18, 'Saving IFB Table....  please wait!');
        save();
        await rt.sleep(120);
        if (key === K.F10) { close(); return; }
        break;
      case K.ENTER: case K.DOWN:
        if (cur < 48) { cur++; if (wrow < 14) wrow++; else paint(); }
        break;
      case K.UP:
        if (cur > 1) { cur--; if (wrow > 3) wrow--; else paint(); }
        break;
      case K.HOME: cur = 1; wrow = 3; paint(); break;
      case K.F3: {
        msg(rt, 8, 'Press <SPACE> to toggle IFB Mode from 0 to 4 ,<ENTER> to accept.');
        for (;;) {
          w.cursor(16, 12);
          const k = await rt.getKey();
          if (k === ' ') { mode = (mode + 1) % 5; showMode(); avail(); continue; }
          if (k === K.ENTER || k === K.ESC || k === K.F10) break;
        }
        rt.screen.hideCursor();
        cur = 1; wrow = 3; paint();
        break;
      }
      case K.F5: {
        msg(rt, 6, 'Press <SPACE> to toggle Program Sound Upper Limit, <ENTER> to accept.');
        for (;;) {
          w.cursor(17, 21);
          const k = await rt.getKey();
          if (k === ' ') {
            const i = LIMITS.indexOf(limit);
            limit = i >= 0 && i < LIMITS.length - 1 && p.N > LIMITS[i] ? LIMITS[i + 1] : 24;
            showMode(); avail();
            continue;
          }
          if (k === K.ENTER || k === K.ESC || k === K.F10) break;
        }
        rt.screen.hideCursor();
        cur = 1; wrow = 3; paint();
        break;
      }
      case K.SF7: await printIfb(ctx, p, mode, limit, bus, pgm); break;
      default:
        if (key === K.F2) await msgWait(rt, 14, 'Program Sound Sources are entered as numbers!', false, 600);
        break;
    }
  }
}

async function printIfb(ctx: Ctx, p: Production, mode: number, limit: number, bus: number[], pgm: number[]) {
  await runPrint(ctx, 'IFB/PGM Sound Data', 'Printing IFB/PGM Sound Definition Data for current Production!',
    `${ctx.eng.fname(p.f)}-ifb.txt`, pr => {
      pr.header('IFB/PGM Sound Definition Data');
      pr.w(`\n        IFB Mode:               ${mode}\r`);
      pr.w(`\n        PGM Sound Upper Limit:  ${pad3(limit)}\r`);
      pr.w('\n        Program Sound Sources:  ');
      for (let v = lowOf(mode, limit); v <= limit; v++) pr.w(`${v} `);
      pr.w(`\r\n\n\n${pr.BOLD}`);
      pr.centred(true, 'IFB / Program Sound Assignments');
      pr.w('\r\n\n            IFB #   Bus No. Mnemonic  Overlay  Program Sound');
      pr.w(`\r\n            ${pr.UL}${' '.repeat(48)}\r\n\n${pr.NOUL}${pr.NOBOLD}`);
      let lines = 20;
      for (let n = 1; n <= 24; n++) {
        const b = bus[n - 1];
        if (valid(p, b)) {
          pr.w(`             ${String(n).padStart(2)}       ${String(b).padStart(3)}     ${p.mn(b)}      ${p.ovl(b)}       ${String(pgm[n - 1]).padStart(3)}`);
        }
        pr.w('\r\n');
        lines++;
      }
      pr.footer(lines);
    });
}
