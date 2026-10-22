// Define System ▸ Keypad Prefix Codes (165c:000c, spec 02 §3.3 / §4.2).
import { production, type Ctx } from '../ctx';
import { K } from '../keys';
import { runPrint } from '../printer';
import { ASCII, clearMsg, form, msg, wopen } from '../tcxl';

const ART: [string, number][] = [
  [' ....   ....   ....   SAVE', 0x34], ['  1      2      3      A', 0x30], [' ....   ....   ....   PAGE', 0x31], ['', 0],
  [' ....   ....   ....   GRP.', 0x34], ['  4      5      6      B', 0x30], [' ....   ....   ....   CA..', 0x31], ['', 0],
  [' ....   ....   ....   CMA.', 0x34], ['  7      8      9      C', 0x30], [' ....   ....   ....   IS..', 0x31], ['', 0],
  ['         #            CNF.', 0x34], [' CLR     0      P      D', 0x30], ['                      EV..', 0x31],
];

/** Window-relative (row, col) of keypad code i (0..8 primary key i+1, 9..17 secondary key i-8). */
export function keypadPos(i: number): [number, number] {
  const j = i % 9;
  return [4 * Math.floor(j / 3) + (i >= 9 ? 2 : 0), 1 + 7 * (j % 3)];
}

export async function keypadPrefix(ctx: Ctx) {
  const { rt } = ctx;
  const p = await production(ctx);
  if (!p) return;
  let codes = p.cfg.keypad.map(c => (c ?? '').padEnd(4).slice(0, 4));
  const w = wopen(rt, 4, 6, 20, 34, 1, 0x30, 0x30);
  ART.forEach(([t, a], r) => { if (t) w.prints(r, 0, a, t); });
  for (const r of [3, 7, 11]) w.hline(r, 0, 28, 1, 0x30);
  for (const c of [6, 13, 20]) w.vline(0, c, 16, 1, 0x30);
  const paint = () => codes.forEach((c, i) => {
    const [r, col] = keypadPos(i);
    w.prints(r, col, i < 9 ? 0x34 : 0x31, c);
  });
  for (;;) {
    paint();
    clearMsg(rt);
    msg(rt, 16, 'ENTER..Edit Keypad   F10..Save/End   ESC..Abort');
    rt.screen.hideCursor();
    const k = await rt.getKey();
    if (k === K.ENTER) {
      msg(rt, 10, 'Editing Keypad Mnemonics!  Press <F10> to save, <ESC> to abort.');
      const fields = codes.map((c, i) => {
        const [r, col] = keypadPos(i);
        return { row: w.top + r, col: w.left + col, width: 4, value: c, upper: true, charOk: ASCII };
      });
      const res = await form(rt, fields, 0x3f, 0x30, kk => kk === K.PGUP || kk === K.PGDN);
      if (res.key !== K.ESC) codes = res.values.map(v => v.padEnd(4).slice(0, 4));
    } else if (k === K.F10) {
      p.cfg.keypad = [...codes];
      p.touch('keypad');
      clearMsg(rt);
      w.close();
      return;
    } else if (k === K.ESC) {
      w.close();
      return;
    } else if (k === K.SF7) {
      await runPrint(ctx, 'Keypad Definition Data', 'Printing Keypad Definition Data of current Production!',
        `${ctx.eng.fname(p.f)}-keypad.txt`, pr => {
          pr.header('Keypad Definition Data');
          pr.w(`${pr.BOLD}\n                    Key  Primary  Secondary\n\r                    ${pr.UL}${' '.repeat(24)}\n\r${pr.NOUL}${pr.NOBOLD}\n`);
          for (let i = 1; i <= 9; i++) pr.w(`                     ${i}     ${codes[i - 1]}     ${codes[i + 8]}\n\r`);
          pr.footer(14);
        });
    }
  }
}
