// Define System ▸ Electronic Pegboard (seg 2247, spec 03 §5): up to 240 items connecting an input bus
// to an output bus with a control type (PERM / INHB / XTnn / EVnn + event mode) and a comment.
import { pad3, production, type Ctx } from '../ctx';
import type { EpcEntry } from '../engine';
import { K } from '../keys';
import type { Production } from '../model';
import { runPrint } from '../printer';
import { ASCII, clearMsg, DIGITS, form, msg, msgWait, pickList, wopen } from '../tcxl';
import { atoi, commit } from './arrayUtil';
import { FILTER_1A82 } from './indexTable';

const MAX = 240;
const MODES: [number, string][] = [[0x44, 'T   '], [0x84, 'L   '], [0xc4, 'TL  '], [0xe4, 'TL/M']];

interface Item { in: number; out: number; type: number; ext: number; comment: string }
const blank = (): Item => ({ in: 0, out: 0, type: 0xff, ext: 0xff, comment: '' });

/** 2247:0e90: record -> Type / Mode strings. */
export function typeText(it: Item): [string, string] {
  const two = String(it.ext).padStart(2, '0');
  if ((it.type & 6) === 4 && it.ext >= 1 && it.ext <= 24) {
    return [`EV${two}`, MODES.find(m => m[0] === it.type)?.[1] ?? 'T   '];
  }
  if (it.type === 0x40) return ['PERM', '    '];
  if (it.type === 0x41) return ['INHB', '    '];
  if (it.type === 0x42 && it.ext >= 1 && it.ext <= 24) return [`XT${two}`, '    '];
  return ['    ', '    '];
}

/** 2247:0ac4 type validator: normalized type text, or null if rejected. */
export function normType(t: string): string | null {
  const s = t.trim().toUpperCase();
  if (!s || s[0] === 'P') return 'PERM';
  if (s[0] === 'I') return 'INHB';
  if ((s.startsWith('EV') || s.startsWith('XT'))) {
    if (s.length <= 2) return s;
    const n = Number(s.slice(2, 4));
    if (!/^\d{1,2}$/.test(s.slice(2, 4)) || n < 1 || n > 24) return null;
    return s.slice(0, 2) + String(n).padStart(2, '0');
  }
  return s;
}

/** 2247:1110: strings -> record fields type/ext. */
export function applyType(it: Item, t: string) {
  const s = t.toUpperCase();
  it.ext = s[0] === 'E' || s[0] === 'X' ? atoi(s.slice(2, 4)) || 0xff : 0xff;
  if (s === 'PERM') it.type = 0x40;
  else if (s === 'INHB') it.type = 0x41;
  else if (s.startsWith('XT')) it.type = 0x42;
  else if (s.startsWith('EV')) it.type = MODES.some(m => m[0] === it.type) ? it.type : 0x44;
  else if (!s.trim()) it.type = 0xff;
}

const toEntry = (it: Item): EpcEntry => ({ in: it.in, out: it.out, type: it.type, ext: it.ext, comment: it.comment.trimEnd() });

export async function epcEditor(ctx: Ctx) {
  const { rt } = ctx;
  const p = await production(ctx);
  if (!p) return;
  const N = p.N;
  let items: Item[] = [];
  const load = () => {
    items = p.cfg.epc.filter(e => e.in && e.in !== 0xff).slice(0, MAX)
      .map(e => ({ in: e.in, out: e.out === 0xff ? 0 : e.out, type: e.type, ext: e.ext, comment: e.comment ?? '' }));
    while (items.length < MAX) items.push(blank());
  };
  load();
  const save = () => {
    const list = items.filter(it => it.in && it.out).map(toEntry);
    const orig = p.cfg.epc.map(e => ({ in: e.in, out: e.out, type: e.type, ext: e.ext, comment: (e.comment ?? '').trimEnd() }));
    if (JSON.stringify(list) !== JSON.stringify(orig)) commit(p, 'epc', list);
  };

  const w = wopen(rt, 2, 24, 20, 69, 0, 0x30, 0x30);
  w.prints(0, 0, 0x30, 'Item Input Output  Control               ');
  w.prints(1, 0, 0x30, ' #    Bus   Bus   Type Mode     Comment  ');
  w.hline(2, 0, 45, 0, 0x30);
  w.vline(0, 4, 15, 0, 0x30);
  w.vline(0, 10, 15, 0, 0x30);
  w.vline(0, 17, 15, 0, 0x30);
  w.vline(1, 22, 15, 0, 0x30);
  w.vline(0, 27, 15, 0, 0x30);
  w.hline(15, 0, 45, 0, 0x30);
  w.prints(16, 0, 0x30, ' Type:       anent      it     ent    ernal');
  w.prints(16, 9, 0x34, 'PERM');
  w.prints(16, 20, 0x34, 'INHB');
  w.prints(16, 29, 0x34, 'EV');
  w.prints(16, 36, 0x34, 'XT');
  const row = (attr: number, wrow: number, i: number) => {
    const it = items[i - 1];
    w.prints(wrow, 1, attr, pad3(i));
    if (!it.in || !it.out) {
      for (const [c, n] of [[6, 3], [12, 3], [18, 4], [23, 4], [28, 16]]) w.prints(wrow, c, attr, ' '.repeat(n));
      return;
    }
    const [t, m] = typeText(it);
    w.prints(wrow, 6, attr, pad3(it.in));
    w.prints(wrow, 12, attr, pad3(it.out));
    w.prints(wrow, 18, attr, t);
    w.prints(wrow, 23, t.startsWith('EV') ? attr : 0x31, t.startsWith('EV') ? m : '    ');
    w.prints(wrow, 28, attr, it.comment.padEnd(16).slice(0, 16));
  };
  let cur = 1;
  let wrow = 3;
  const top = () => cur - (wrow - 3);
  const paint = (t: number) => { for (let j = 0; j < 12; j++) row(0x31, 3 + j, t + j); };
  paint(1);
  const close = () => { w.close(); clearMsg(rt); };
  for (;;) {
    msg(rt, 4, 'F3..Set Event Mode  Shft F6..Delete Item   F10..Save/End   ESC..Abort');
    row(0x1f, wrow, cur);
    const it = items[cur - 1];
    const [t] = typeText(it);
    const r0 = w.top + wrow;
    const res = await form(rt, [
      { row: r0, col: w.left + 6, width: 3, value: it.in ? pad3(it.in) : '', upper: true, charOk: DIGITS, validate: v => atoi(v) <= N },
      { row: r0, col: w.left + 12, width: 3, value: it.out ? pad3(it.out) : '', upper: true, charOk: DIGITS, validate: v => atoi(v) <= N },
      { row: r0, col: w.left + 18, width: 4, value: t.trim(), upper: true, charOk: ASCII, validate: v => normType(v) !== null },
      { row: r0, col: w.left + 28, width: 16, value: it.comment, charOk: ASCII },
    ], 0x1f, 0x1f, FILTER_1A82, 0, false);
    if (res.key === K.ESC) { close(); return; }
    const [vin, vout, vtype, vcom] = res.values;
    it.in = atoi(vin);
    it.out = atoi(vout);
    it.comment = vcom.padEnd(16).slice(0, 16).trimEnd();
    applyType(it, normType(vtype) ?? '');
    rt.screen.hideCursor();
    row(0x31, wrow, cur);
    switch (res.key) {
      case K.ENTER: case K.DOWN:
        if (cur < MAX) { cur++; if (wrow < 14) wrow++; else paint(top()); }
        break;
      case K.UP:
        if (cur > 1) { cur--; if (wrow > 3) wrow--; else paint(top()); }
        break;
      case K.HOME: cur = 1; wrow = 3; paint(1); break;
      case K.END: cur = MAX; wrow = 14; paint(MAX - 11); break;
      case K.PGUP: { const tp = cur < 25 ? 1 : Math.max(1, top() - 12); cur = tp; wrow = 3; paint(tp); break; }
      case K.PGDN: { let tp = top() + 12; if (tp + 12 > MAX - 12) tp = MAX - 11; cur = tp; wrow = 3; paint(tp); break; }
      case K.F3:
        if (typeText(it)[0].startsWith('EV')) {
          msg(rt, 20, 'Select a Mode Bit for this Event!');
          const ch = await pickList(rt, 12, 3, 17, 24, 0, 0x1f, 0x17, 0x2f,
            ['Talk only         ', 'Listen only       ', 'Talk & Listen     ', 'Talk & Listen/Mute'], 0);
          if (ch >= 0) it.type = MODES[ch][0];
        } else await msgWait(rt, 20, 'Mode can only be selected for an Event!');
        break;
      case K.SF6: {
        items.splice(cur - 1, 1);
        items.push(blank());
        paint(top());
        break;
      }
      case K.CENTER: case K.F10:
        msg(rt, 10, 'Saving Electronic Pegboard Control Table - please wait!');
        save();
        await rt.sleep(120);
        if (res.key === K.F10) { close(); return; }
        // MicroCOM III: the table is compacted and shown again (MCOM left memory empty here)
        load();
        paint(top());
        break;
      case K.SF7: await printEpc(ctx, p, items); break;
      default: break;
    }
  }
}

async function printEpc(ctx: Ctx, p: Production, items: Item[]) {
  await runPrint(ctx, 'Electronic Pegboard Data', 'Printing Electronic Pegboard Control Data for current Production!',
    `${ctx.eng.fname(p.f)}-epc.txt`, pr => {
      let i = 1;
      while (i <= MAX && items[i - 1].in && items[i - 1].out) {
        pr.header('EPC Definitions');
        pr.w(`\r\n${pr.BOLD}`);
        pr.w('        Item   Input    Output      Control\r\n');
        pr.w('          #     Bus      Bus    Type     Mode      Comment\r\n');
        pr.w(`${pr.LPI8}        ${pr.UL}${' '.repeat(55)}\r\n\n${pr.NOUL}${pr.NOBOLD}`);
        for (let line = 0; line < 48 && i <= MAX; line++, i++) {
          const it = items[i - 1];
          const [t, m] = typeText(it);
          const ok = it.in && it.out;
          pr.w(`        ${pad3(i)}     ${ok ? pad3(it.in) + ' ' : '    '}      ${ok ? pad3(it.out) + ' ' : '    '}    ${t}     ${t.startsWith('EV') ? m : '    '}   ${it.comment.padEnd(16)}\r\n`);
        }
        pr.footer(50);
      }
    });
}

