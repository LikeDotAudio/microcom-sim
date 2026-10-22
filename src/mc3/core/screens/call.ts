// Define System ▸ Call Array (seg 1319, spec 03 §3): 12 call arrays CA01..CA12 of bus numbers
// (24 slots each in the data; slots 1..16 are visible, as in MCOM).
import { pad3, production, type Ctx } from '../ctx';
import { K } from '../keys';
import type { Production } from '../model';
import { runPrint } from '../printer';
import { ASCII, clearMsg, editField, msg, wopen } from '../tcxl';
import { codePicker } from './assign';
import { commit, pairLine, valid } from './arrayUtil';
import { FILTER_1A82 } from './indexTable';

export async function callArray(ctx: Ctx) {
  const { rt } = ctx;
  const p = await production(ctx);
  if (!p) return;
  const call = p.cfg.call.map(arr => arr.map(v => (valid(p, v) ? v : 0)));
  const w = wopen(rt, 1, 12, 21, 77, 0, 0x30, 0x30);
  w.prints(0, 0, 0x30, 'CAL: CA01 CA02 CA03 CA04 CA05 CA06 CA07 CA08 CA09 CA10 CA11 CA12');
  w.prints(1, 0, 0x30, 'OVL:');
  for (let a = 1; a <= 12; a++) w.prints(1, 5 * a, 0x34, (p.cfg.phantom[3 + a] ?? '').padEnd(4).slice(0, 4));
  w.hline(2, 0, 65, 0, 0x30);
  for (let c = 9; c <= 59; c += 5) w.vline(0, c, 19, 0, 0x30);
  w.vline(0, 4, 20, 2, 0x30);
  for (let s = 1; s <= 16; s++) w.prints(2 + s, 1, 0x31, pad3(s));
  const cell = (attr: number, a: number, s: number) => {
    const b = call[a - 1][s - 1];
    w.prints(2 + s, 5 * a, attr, b ? p.mn(b) : '    ');
  };
  for (let a = 1; a <= 12; a++) for (let s = 1; s <= 16; s++) cell(0x31, a, s);
  let a = 1;
  let wrow = 3;
  const close = () => { w.close(); clearMsg(rt); };
  const save = () => commit(p, 'call', call.map((arr, i) => {
    // keep slots 17..24 (not editable here) as they are
    const orig = p.cfg.call[i];
    return arr.map((v, j) => (j < 16 ? v : orig[j] ?? 0));
  }));
  for (;;) {
    msg(rt, 1, 'F2..Select  TAB/Shft TAB..Next/Prev  Shft F6..Del  F10..Save/End  ESC..Abort');
    const s = wrow - 2;
    cell(0x1f, a, s);
    const cur = call[a - 1][s - 1];
    const r = await editField(rt, {
      row: w.top + wrow, col: w.left + 5 * a, width: 4, value: cur ? p.mn(cur) : '', upper: true, charOk: ASCII,
      validate: t => !t.trim() || p.findBus(t) > 0,
    }, 0x1f, FILTER_1A82, 0x1f);
    if (r.key === K.ESC) { close(); return; }
    if (r.value.trim()) call[a - 1][s - 1] = p.findBus(r.value);
    rt.screen.hideCursor();
    cell(0x31, a, s);
    const arr = call[a - 1];
    switch (r.key) {
      case K.TAB: case K.STAB:
        a = r.key === K.TAB ? (a % 12) + 1 : a === 1 ? 12 : a - 1;
        while (wrow > 3 && !call[a - 1][wrow - 4]) wrow--;
        break;
      case K.ENTER: case K.DOWN: if (wrow < 18 && arr[s - 1]) wrow++; break;
      case K.UP: if (wrow > 3) wrow--; break;
      case K.F2: {
        const pick = await codePicker(ctx, p, null);
        if (pick) { arr[s - 1] = pick[1]; cell(0x31, a, s); }
        break;
      }
      case K.SF6: {
        arr.splice(s - 1, 1);
        arr.splice(23, 0, 0);
        for (let j = 1; j <= 16; j++) cell(0x31, a, j);
        break;
      }
      case K.CENTER: case K.F10:
        msg(rt, 18, 'Saving CALL ARRAY Table - please wait!');
        save();
        await rt.sleep(120);
        if (r.key === K.F10) { close(); return; }
        break;
      case K.SF7: await printCall(ctx, p, call); break;
      default: break;
    }
  }
}

async function printCall(ctx: Ctx, p: Production, call: number[][]) {
  await runPrint(ctx, 'Call Array Data', 'Printing Call Array Definition Data for current Production!',
    `${ctx.eng.fname(p.f)}-call.txt`, pr => {
      for (let pg = 1; pg <= 4; pg++) {
        let lines = 26;
        pr.header('Call Array Definitions');
        for (let a = 3 * pg - 2; a <= 3 * pg; a++) {
          pr.w('\r\n\n');
          lines += 2;
          pr.w(`        Call Array: CA${String(a).padStart(2, '0')}       Overlay: ${(p.cfg.phantom[3 + a] ?? '').padEnd(4).slice(0, 4)}\r\n\n`);
          pr.w(`${pr.BOLD}        Bus#  Mnemonic  Overlay            Bus#  Mnemonic  Overlay\r\n`);
          pr.w(`        ${pr.UL}${' '.repeat(58)}\r\n\n${pr.NOUL}${pr.NOBOLD}`);
          for (let s = 1; s <= 8; s++) { pairLine(pr, p, call[a - 1][s - 1], call[a - 1][s + 7]); lines++; }
        }
        pr.footer(lines);
      }
    });
}

