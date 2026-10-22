// Define System ▸ Relay Control (seg 186a, spec 03 §4): 12 relays, each with an output bus and a
// 240-bit input mask (engine: relay closes when a selected input talks to the output bus).
import { pad3, production, type Ctx } from '../ctx';
import { K } from '../keys';
import type { Production } from '../model';
import { runPrint } from '../printer';
import { clearMsg, DIGITS, editField, msg, wopen } from '../tcxl';
import { atoi, commit, valid } from './arrayUtil';

const toBytes = (hex: string) => {
  const b = new Uint8Array(30).fill(0xff);
  for (let i = 0; i < 30 && i * 2 + 2 <= hex.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
};
const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export const bit = (m: Uint8Array, bus: number) => !!((m[(bus - 1) >> 3] >> ((bus - 1) & 7)) & 1);

export async function relayEditor(ctx: Ctx) {
  const { rt } = ctx;
  const p = await production(ctx);
  if (!p) return;
  let out: number[] = [];
  let mask: Uint8Array[] = [];
  const load = () => {
    out = p.cfg.relay_out.map(v => (valid(p, v) ? v : 0));
    mask = p.cfg.relay_mask.map(toBytes);
  };
  load();
  const save = () => {
    commit(p, 'relay_out', out.map((v, i) => (v === (p.cfg.relay_out[i] === 0xff ? 0 : p.cfg.relay_out[i]) ? p.cfg.relay_out[i] : v)));
    commit(p, 'relay_mask', mask.map((m, i) => (toHex(m) === p.cfg.relay_mask[i]?.toLowerCase() ? p.cfg.relay_mask[i] : toHex(m))));
  };
  const w = wopen(rt, 5, 10, 20, 26, 0, 0x2f, 0x2f);
  w.prints(0, 0, 0x2f, 'Relay Bus# Code');
  w.hline(1, 0, 16, 0, 0x2f);
  w.vline(0, 5, 14, 0, 0x2f);
  w.vline(0, 10, 14, 0, 0x2f);
  const line = (attr: number, r: number) => {
    w.prints(1 + r, 1, attr, pad3(r));
    const b = out[r - 1];
    w.prints(1 + r, 6, attr, b ? pad3(b) : '   ');
    w.prints(1 + r, 11, attr, b ? p.mn(b) : '    ');
  };
  for (let r = 1; r <= 12; r++) line(0x28, r);
  let r = 1;
  for (;;) {
    msg(rt, 6, 'ENTER..Edit Relay Mask   Shft F6..Clear   F10..Save/End   ESC..Abort');
    line(0x1f, r);
    rt.screen.hideCursor();
    const k = await rt.getKey();
    line(0x28, r);
    if (k === K.ESC) { w.close(); clearMsg(rt); return; }
    if (k === K.F10) {
      msg(rt, 20, 'Saving Relay Definition Table, please wait!');
      save();
      await rt.sleep(120);
      w.close(); clearMsg(rt);
      return;
    }
    if (k === K.UP && r > 1) r--;
    else if (k === K.DOWN && r < 12) r++;
    else if (k === K.HOME) r = 1;
    else if (k === K.END) r = 12;
    else if (k === K.SF6) { out[r - 1] = 0; mask[r - 1].fill(0xff); }
    else if (k === K.SF7) await printRelays(ctx, p, out, mask);
    else if (k === K.ENTER) {
      if (await maskEditor(ctx, p, r, out, mask)) {
        msg(rt, 20, 'Saving Relay Definition Table, please wait!');
        save();
        await rt.sleep(120);
      }
      line(0x28, r);
    }
  }
}

/** 186a:0466: output bus + input mask of one relay. Returns true if F10 (save all) was pressed. */
async function maskEditor(ctx: Ctx, p: Production, r: number, out: number[], mask: Uint8Array[]): Promise<boolean> {
  const { rt } = ctx;
  const N = p.N;
  const m = mask[r - 1];
  const w = wopen(rt, 2, 16, 20, 75, 0, 0x30, 0x30);
  w.prints(0, 0, 0x1f, ' Relay #:           Output Bus:         Bus Code:         ');
  w.prints(0, 10, 0x1c, pad3(r));
  const showOut = () => {
    const b = out[r - 1];
    w.prints(0, 32, 0x1c, b ? pad3(b) : '   ');
    w.prints(0, 50, 0x1c, b ? p.mn(b) : '    ');
  };
  showOut();
  w.prints(1, 0, 0x30, 'Bus# Code Sel  Bus# Code Sel  Bus# Code Sel  Bus# Code Sel');
  w.hline(2, 0, 58, 0, 0x30);
  for (const c of [4, 9, 13, 14, 19, 24, 28, 29, 34, 39, 43, 44, 49, 54]) w.vline(1, c, 14, 0, 0x30);
  w.hline(15, 0, 58, 0, 0x30);
  w.prints(16, 3, 0x34, 'Press <SPACE> to Select/Deselect Bus under Cursor');
  let T = 1;
  let cb = 1;
  const posOf = (b: number): [number, number] => { const i = b - T; return [3 + (i % 12), 1 + 15 * Math.floor(i / 12)]; };
  const cell = (b: number, cursor: boolean) => {
    const [row, g] = posOf(b);
    w.prints(row, g, 0x31, pad3(b));
    w.prints(row, g + 4, 0x31, b <= N ? p.mn(b) : '    ');
    w.printc(row, g + 10, cursor ? 0x1f : 0x31, bit(m, b) ? 'x' : ' ');
  };
  const grid = () => { for (let b = T; b < T + 48; b++) cell(b, false); };
  grid();
  // step 1: output bus (MicroCOM III: an unset relay starts blank, not with its relay number)
  msg(rt, 8, 'Please enter new Output Bus Number or <ENTER> to continue!');
  const res = await editField(rt, {
    row: w.top, col: w.left + 32, width: 3, value: out[r - 1] ? pad3(out[r - 1]) : '', charOk: DIGITS,
    validate: t => atoi(t) <= N,
  }, 0x1f, () => false, 0x1c);
  if (res.key === K.ESC) { w.close(); clearMsg(rt); return false; }
  out[r - 1] = atoi(res.value);
  showOut();
  msg(rt, 6, 'Editing Relay Definition Table, press <F10> to end, <ESC> to abort!');
  const toggle = () => { const i = (cb - 1) >> 3; m[i] ^= 1 << ((cb - 1) & 7); };
  for (;;) {
    cell(cb, true);
    const [row, g] = posOf(cb);
    w.cursor(row, g + 10);
    const k = await rt.getKey();
    cell(cb, false);
    const down = () => { if (cb < N) { cb++; if (cb >= T + 48) { T++; grid(); } } };
    if (k === ' ') toggle();
    else if (k === K.ENTER) { toggle(); down(); }
    else if (k === K.DOWN) down();
    else if (k === K.UP) { if (cb > 1) { cb--; if (cb < T) { T--; grid(); } } }
    else if (k === K.TAB || k === K.RIGHT) cb = cb - T < 36 ? cb + 12 : cb - 36;
    else if (k === K.STAB || k === K.LEFT) cb = cb - T >= 12 ? cb - 12 : cb + 36;
    else if (k === K.HOME) { T = 1; cb = 1; grid(); }
    else if (k === K.END) { T = Math.max(1, N - 47); cb = N; grid(); }
    else if (k === K.PGUP) { if (cb < 49) { T = 1; cb = 1; } else { cb -= 48; T = Math.max(1, T - 48); } grid(); }
    else if (k === K.PGDN) { if (cb + 48 >= N) { T = Math.max(1, N - 47); cb = N; } else { cb += 48; T += 48; } grid(); }
    else if (k === K.F10) { rt.screen.hideCursor(); w.close(); clearMsg(rt); return true; }
    else if (k === K.ESC) { rt.screen.hideCursor(); w.close(); clearMsg(rt); return false; }
    else if (k === K.SF7) await printRelays(ctx, p, out, mask);
    if (cb > N) cb = N;
  }
}

async function printRelays(ctx: Ctx, p: Production, out: number[], mask: Uint8Array[]) {
  await runPrint(ctx, 'Relay Assignment Data', 'Printing Relay Assignment Data of current Production!',
    `${ctx.eng.fname(p.f)}-relays.txt`, pr => {
      pr.header('Relay Assignment Data');
      pr.w(`\r\n${pr.BOLD}`);
      pr.centred(true, 'Relay to Output Bus Assignments');
      pr.w('\r\n\n                Relay#  Bus#  Mnemonic  Overlay\n\r');
      pr.w(`                ${pr.UL}${' '.repeat(30)}\n\r${pr.NOUL}${pr.NOBOLD}\n`);
      for (let r = 1; r <= 12; r++) {
        const b = out[r - 1];
        if (valid(p, b)) pr.w(`                 ${String(r).padStart(2)}     ${pad3(b)}     ${p.mn(b)}     ${p.ovl(b)}\n\r`);
        else pr.w(`                 ${String(r).padStart(2)}     ...     ....\n\r`);
      }
      pr.footer(21);
      for (let B = 1; B <= p.N; B += 48) {
        pr.header('Relay Assignment Data');
        pr.w(pr.BOLD);
        pr.w('          Input Mask                        Relay #                      \n\r');
        pr.w('        Bus  Mnemonic Ovly  1   2   3   4   5   6   7   8   9  10  11  12\n\r');
        pr.w(`${pr.LPI8}        ${pr.UL}${' '.repeat(66)}\n\r${pr.NOUL}${pr.NOBOLD}\n`);
        for (let b = B; b < B + 48; b++) {
          pr.w(`        ${String(b).padStart(3)}   ${b <= p.N ? p.mn(b) : '    '}    ${b <= p.N ? p.ovl(b) : '    '}  `);
          for (let r = 0; r < 12; r++) pr.w(!valid(p, out[r]) ? '    ' : bit(mask[r], b) ? 'x   ' : '    ');
          pr.w('\r\n');
        }
        pr.w(`\r\n        ${pr.UL}${' '.repeat(66)}\r\n\n${pr.NOUL}${pr.BOLD}        Output Bus Assign: ${pr.NOBOLD}`);
        for (let r = 0; r < 12; r++) pr.w(valid(p, out[r]) ? `${pad3(out[r])} ` : '    ');
        pr.w('\r\n');
        pr.footer(53);
      }
    });
}
