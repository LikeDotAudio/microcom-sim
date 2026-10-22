// Define System ▸ Overlay Definition (16b8:0002, spec 02 §3.4–3.7). MicroCOM III keeps one overlay per
// production (the engine's `overlay` / `phantom` fields), so "Select" only reports that.
import { pad3, production, type Ctx } from '../ctx';
import { K } from '../keys';
import type { Production } from '../model';
import { ASCII, clearMsg, editField, messageBox, msg, vmenu, wopen } from '../tcxl';
import { FILTER_1A82 } from './indexTable';

export async function overlayDefinition(ctx: Ctx) {
  const p = await production(ctx);
  if (!p) return;
  const ph = (first: number, count: number, si: number, labels: string[]) => () => phantomEditor(ctx, p, first, count, si, labels);
  const lab = (pre: string, n: number, d: number) => Array.from({ length: n }, (_, i) => pre + String(i + 1).padStart(d, '0'));
  await vmenu(ctx.rt, 5, 13, 13, 26, 0x2f, 0x24, 0x1f, [
    { text: 'Select      ', hot: 0, run: async () => messageBox(ctx.rt, ['Overlay Definition', '',
      `MicroCOM III keeps one overlay per Production.`, `Active overlay: ${ctx.eng.fname(p.f)}`, '', 'Press any key to continue.'], 0x2f, 0x24) },
    { text: 'Matrix      ', hot: 0, run: () => matrixOverlay(ctx, p) },
    { text: 'Group       ', hot: 0, run: ph(0, 3, 10, lab('GRP', 4, 1)) },
    { text: 'Call Array  ', hot: 5, run: ph(4, 11, 18, lab('CA', 12, 2)) },
    { text: 'Camera Array', hot: 0, run: ph(16, 7, 14, lab('CMA', 8, 1)) },
    { text: 'ConFerence  ', hot: 3, run: ph(24, 7, 14, lab('CNF', 8, 1)) },
    { text: 'Event       ', hot: 0, run: ph(32, 23, 18, lab('EV', 24, 2)) },
  ]);
}

/** 16b8:0ffa: per-bus overlay codes. */
async function matrixOverlay(ctx: Ctx, p: Production) {
  const { rt } = ctx;
  const N = p.N;
  const ovl = ['', ...Array.from({ length: N }, (_, i) => p.ovl(i + 1))];
  const w = wopen(rt, 3, 24, 20, 42, 0, 0x30, 0x30);
  w.prints(0, 0, 0x30, 'Bus# Code Overlay');
  w.hline(1, 0, 17, 0, 0x30);
  w.hline(14, 0, 17, 0, 0x30);
  w.vline(0, 4, 14, 0, 0x30);
  w.vline(0, 9, 14, 0, 0x30);
  w.prints(15, 0, 0x30, 'Active:');
  w.prints(15, 8, 0x34, ctx.eng.fname(p.f));
  const line = (attr: number, row: number, b: number) => {
    if (b < 1 || b > N) return;
    w.prints(row, 0, attr, pad3(b));
    w.prints(row, 5, attr, p.mn(b));
    w.prints(row, 11, attr, ovl[b]);
  };
  let top = 1;
  let row = 2;
  const paint = () => { for (let i = 0; i < 12; i++) line(0x31, 2 + i, top + i); };
  paint();
  for (;;) {
    msg(rt, 14, 'Editing Overlay Codes,     F10..Save/End   ESC..Abort ');
    const b = top + row - 2;
    line(0x1f, row, b);
    const r = await editField(rt, { row: w.top + row, col: w.left + 11, width: 4, value: ovl[b], upper: true, charOk: ASCII },
      0x1f, FILTER_1A82, 0x1f);
    if (r.key === K.ESC) { w.close(); return; }
    ovl[b] = r.value.padEnd(4);
    line(0x31, row, b);
    switch (r.key) {
      case K.ENTER: case K.DOWN: if (b < N) { if (row < 13) row++; else { top++; paint(); } } break;
      case K.UP: if (b > 1) { if (row > 2) row--; else { top--; paint(); } } break;
      case K.HOME: top = 1; row = 2; paint(); break;
      case K.END: top = Math.max(1, N - 11); row = 2 + N - top; paint(); break;
      case K.PGUP: top = b < 25 ? 1 : Math.max(1, b - (row - 2) - 12); row = 2; paint(); break;
      case K.PGDN: { const t = b - (row - 2); top = N < t + 24 ? Math.max(1, N - 11) : t + 12; row = 2; paint(); break; }
      case K.F10: case K.CENTER:
        msg(rt, 24, 'Saving Overlay Table, please wait!');
        for (let i = 1; i <= N; i++) {
          if (ovl[i] === p.ovl(i)) continue;
          if (ovl[i].trim()) p.cfg.overlay[i] = ovl[i]; else delete p.cfg.overlay[i];
        }
        p.touch('overlay');
        await rt.sleep(120);
        clearMsg(rt);
        w.close();
        return;
      default: break;
    }
  }
}

/** 16b8:1582: phantom overlay codes of one family. */
async function phantomEditor(ctx: Ctx, p: Production, first: number, count: number, si: number, labels: string[]) {
  const { rt } = ctx;
  const codes = p.cfg.phantom.map(c => (c ?? '').padEnd(4).slice(0, 4));
  const w = wopen(rt, 3, 25, si + 3, 38, 0, 0x30, 0x30);
  const vis = si - 6;
  w.prints(0, 0, 0x30, 'Code Overlay');
  w.hline(1, 0, 12, 0, 0x30);
  w.hline(si - 4, 0, 12, 0, 0x30);
  w.vline(0, 4, si - 3, 0, 0x30);
  w.prints(si - 3, 2, 0x30, 'Active:');
  w.prints(si - 2, 2, 0x34, ctx.eng.fname(p.f));
  let top = first;
  let idx = first;
  const line = (attr: number, i: number) => {
    const r = 2 + i - top;
    if (r < 2 || r >= 2 + vis) return;
    w.prints(r, 0, attr, labels[i - first]);
    w.prints(r, 6, attr, codes[i]);
  };
  const paint = () => { for (let i = 0; i < vis; i++) { w.clearRow(2 + i); w.vline(2 + i, 4, 1, 0, 0x30); if (top + i <= first + count) line(0x31, top + i); } };
  paint();
  for (;;) {
    msg(rt, 12, 'Editing Phantom Overlay Codes,   F10..Save/End   ESC..Abort');
    line(0x1f, idx);
    const r = await editField(rt, { row: w.top + 2 + idx - top, col: w.left + 6, width: 4, value: codes[idx], upper: true, charOk: ASCII },
      0x1f, FILTER_1A82, 0x1f);
    if (r.key === K.ESC) { w.close(); return; }
    codes[idx] = r.value.padEnd(4);
    line(0x31, idx);
    switch (r.key) {
      case K.ENTER: case K.DOWN:
        if (idx < first + count) { idx++; if (idx >= top + vis) { top++; paint(); } }
        break;
      case K.UP:
        if (idx > first) { idx--; if (idx < top) { top--; paint(); } }
        break;
      case K.PGUP: if (count > 12) { top = first; idx = first; paint(); } break;
      case K.PGDN: if (count > 12) { top = first + 12; idx = first + 12; paint(); } break;
      case K.F10: case K.CENTER:
        msg(rt, 24, 'Saving Overlay Table, please wait!', 0x47);
        p.cfg.phantom = p.cfg.phantom.map((c, i) => (i >= first && i <= first + count && codes[i].trimEnd() !== (c ?? '').trimEnd() ? codes[i] : c));
        p.touch('phantom');
        await rt.sleep(120);
        clearMsg(rt);
        w.close();
        return;
      default: break;
    }
  }
}
