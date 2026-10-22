// Define System ▸ Matrix Index Table (1de4:0004 / 062c, spec 02 §3.1 + §4.1) over the 64 ports of the
// active production. MicroCOM III: terminal types include the matrix panel models; IFB/Mic ports
// without a terminal are shown as talent positions.
import { pad3, production, type Ctx } from '../ctx';
import { K, type Key } from '../keys';
import { MODEL_NAMES, TERM_NAMES, type Production } from '../model';
import { runPrint } from '../printer';
import { ASCII, clearMsg, form, msg, pickList, wopen, type Win } from '../tcxl';

/** Keys that end the row form (filter 16b8:1a82). */
export const FILTER_1A82 = (k: Key) => /^\{F([1-9]|10)\}$/.test(k) || k === K.SF6 || k === K.SF7
  || k === K.PGUP || k === K.PGDN || k === K.UP || k === K.DOWN || k === K.TAB || k === K.STAB
  || k === K.HOME || k === K.END;

const TYPE_LIST = [...TERM_NAMES.map(t => t.padEnd(8)), ...MODEL_NAMES.map(m => m.padEnd(8))];

interface Row { mn: string; ovl: string; attr: number; term: string; desc: string; model: string; kind: string }

function load(p: Production): Row[] {
  const rows: Row[] = [{ mn: '', ovl: '    ', attr: 0, term: '0', desc: ' '.repeat(22), model: '', kind: '' }];
  for (let b = 1; b <= p.N; b++) {
    rows.push({ mn: p.mn(b), ovl: p.ovl(b), attr: p.attr(b), term: p.term(b), desc: p.desc(b), model: p.model(b), kind: p.kind(b) });
  }
  return rows;
}

function typeText(r: Row): string {
  if (r.model) return r.model.padEnd(8);
  const t = TERM_NAMES[Number(r.term) & 0x0f] ?? '';
  return (t || (r.kind === 'ifb' ? 'Talent' : '')).padEnd(8);
}

const prioChar = (a: number) => ' 123'[(a >> 3) & 3];
const x = (on: boolean) => (on ? 'x' : ' ');

export function paintRow(w: Win, attr: number, row: number, bus: number, r: Row | undefined) {
  const f = r ? [pad3(bus), r.mn, r.ovl, x(!!(r.attr & 0x40)), x(!!(r.attr & 0x80)), x(!!(r.attr & 0x20)),
    x(!!(r.attr & 0x02)), prioChar(r.attr), r.desc, typeText(r)]
    : ['   ', '    ', '    ', ' ', ' ', ' ', ' ', ' ', ' '.repeat(22), ' '.repeat(8)];
  [0, 4, 9, 14, 16, 18, 20, 22, 24, 48].forEach((c, i) => w.prints(row, c, attr, f[i]));
}

export async function matrixIndexTable(ctx: Ctx) {
  const { rt } = ctx;
  const p = await production(ctx);
  if (!p) return;
  const N = p.N;
  let rows = load(p);

  // window A: keypad prefix codes (read only)
  const wa = wopen(rt, 3, 64, 16, 76, 0, 0x30, 0x30);
  wa.prints(0, 0, 0x30, 'Prefix Code');
  wa.prints(1, 0, 0x30, 'Pri Key Sec');
  wa.hline(2, 0, 11, 0, 0x30);
  for (let k = 1; k <= 9; k++) {
    wa.prints(k + 2, 0, 0x34, (p.cfg.keypad[k - 1] ?? '').padEnd(4).slice(0, 4));
    wa.printc(k + 2, 5, 0x30, String(k));
    wa.prints(k + 2, 7, 0x31, (p.cfg.keypad[k + 8] ?? '').padEnd(4).slice(0, 4));
  }
  // window B: the index table
  const w = wopen(rt, 3, 2, 19, 59, 0, 0x30, 0x30);
  w.prints(0, 0, 0x30, 'Bus Mnem Ovly Attribute                         Terminal');
  w.prints(1, 0, 0x30, ' #  Code Code T L M I P       Description         Type  ');
  w.hline(2, 0, 56, 0, 0x30);
  for (const c of [3, 8, 13, 23, 47]) w.vline(0, c, 15, 0, 0x30);
  for (const c of [15, 17, 19, 21]) w.vline(1, c, 14, 0, 0x30);

  let bus = 1;
  let row = 3;
  const paintFrom = (top: number) => {
    for (let i = 0; i < 12; i++) paintRow(w, 0x31, 3 + i, top + i, top + i <= N ? rows[top + i] : undefined);
  };
  paintFrom(1);
  const down = () => {
    if (bus >= N) return;
    paintRow(w, 0x31, row, bus, rows[bus]);
    bus++;
    if (row < 14) row++; else paintFrom(bus - 11);
  };
  const up = () => {
    if (bus <= 1) return;
    paintRow(w, 0x31, row, bus, rows[bus]);
    bus--;
    if (row > 3) row--; else paintFrom(bus);
  };
  const close = () => { w.close(); wa.close(); };

  for (;;) {
    clearMsg(rt);
    msg(rt, 1, 'F2..Select Terminal  F3..Set Attributes  F4..Copy  F10..Save/End  ESC..Abort');
    const r = rows[bus];
    paintRow(w, 0x1f, row, bus, r);
    const base = w.top + row;
    const res = await form(rt, [
      { row: base, col: w.left + 4, width: 4, value: r.mn, upper: true, charOk: ASCII },
      { row: base, col: w.left + 9, width: 4, value: r.ovl, upper: true, charOk: ASCII },
      { row: base, col: w.left + 24, width: 22, value: r.desc, charOk: ASCII },
    ], 0x1f, 0x1f, FILTER_1A82, 0, false);
    if (res.key === K.ESC) {
      close();
      return;
    }
    r.mn = res.values[0].padEnd(4);
    r.ovl = res.values[1].padEnd(4);
    r.desc = res.values[2].padEnd(22);
    switch (res.key) {
      case K.ENTER: case K.DOWN: down(); break;
      case K.UP: up(); break;
      case K.HOME: bus = 1; row = 3; paintFrom(1); break;
      case K.END: bus = N; row = 14; paintFrom(Math.max(1, N - 11)); break;
      case K.PGUP: {
        const top = bus < 25 ? 1 : Math.max(1, bus - (row - 3) - 12);
        paintFrom(top); bus = top; row = 3; break;
      }
      case K.PGDN: {
        const t = bus - (row - 3);
        let top = t + 12;
        if (N < t + 24) top = Math.max(1, N - 11);
        paintFrom(top); bus = top; row = 3; break;
      }
      case K.F2: await pickType(ctx, w, row, r); break;
      case K.F3: await attrWalk(ctx, w, row, bus, r); break;
      case K.F4: if (copyIncrement(rows, bus)) down(); break;
      case K.SF6:
        rows[bus] = { ...r, desc: ' '.repeat(22), ovl: '    ', attr: 0xc0, term: '0', model: '', mn: `$${pad3(bus)}`.slice(0, 4) };
        if (bus < N) down();
        break;
      case K.SF7: await printIndex(ctx, p, rows); break;
      case K.F10:
        msg(rt, 24, 'Saving Index Table, please wait!', 0x47);
        save(p, rows);
        await rt.sleep(150);
        clearMsg(rt);
        close();
        return;
      default: break;
    }
  }
}

function save(p: Production, rows: Row[]) {
  for (let b = 1; b <= p.N; b++) {
    const r = rows[b];
    // only touch what was edited, so untouched ports keep the engine's exact values
    if (r.mn !== p.mn(b)) p.cfg.mnemonic[b] = r.mn.padEnd(4).slice(0, 4);
    if (r.attr !== p.attr(b)) p.cfg.attr[b] = r.attr;
    if (r.term !== p.term(b)) p.cfg.term[b] = r.term;
    if (r.desc !== p.desc(b)) p.cfg.desc[b] = r.desc.replace(/\s+$/, '');
    if (r.ovl !== p.ovl(b)) { if (r.ovl.trim()) p.cfg.overlay[b] = r.ovl; else delete p.cfg.overlay[b]; }
    if (r.model !== p.model(b)) p.setModel(b, r.model || null);
  }
  p.touch('index');
}

async function pickType(ctx: Ctx, w: Win, row: number, r: Row) {
  const { rt } = ctx;
  msg(rt, 18, 'Select a Terminal Type for current Bus!');
  const cur = r.model ? 10 + MODEL_NAMES.indexOf(r.model) : Number(r.term) & 0x0f;
  const top = w.top + row - 2;
  const choice = await pickList(rt, top, 59, Math.min(24, top + 6), 68, 0, 0x1f, 0x17, 0x2f, TYPE_LIST, cur);
  clearMsg(rt);
  if (choice < 0) return;
  if (choice === 0) {
    r.term = '0';
    r.model = '';
    r.attr &= 0xe7;
  } else {
    if (choice >= 10) r.model = MODEL_NAMES[choice - 10];
    else { r.term = String(choice); r.model = ''; }
    if (!(r.attr & 0x18)) r.attr |= 0x18;
  }
}

async function attrWalk(ctx: Ctx, w: Win, row: number, bus: number, r: Row) {
  const { rt } = ctx;
  const steps: [number, number, string, number][] = [
    [14, 0x40, 'Press <SPACE> to Toggle Talk Attribute ON or OFF!', 16],
    [16, 0x80, 'Press <SPACE> to Toggle Listen Attribute ON or OFF!', 16],
    [18, 0x20, 'Press <SPACE> to Toggle Listen/Mute Attribute ON or OFF!', 14],
    [20, 0x02, 'Press <SPACE> to Toggle IFB Attribute ON or OFF!', 16],
  ];
  for (const [col, bit, prompt, mcol] of steps) {
    clearMsg(rt);
    msg(rt, mcol, prompt);
    for (;;) {
      w.cursor(row, col);
      const k = await rt.getKey();
      if (k === ' ') { r.attr ^= bit; w.printc(row, col, 0x1f, x(!!(r.attr & bit))); continue; }
      if (k === K.ENTER) break;
      if (k === K.ESC || k === K.F10) { clearMsg(rt); rt.screen.hideCursor(); paintRow(w, 0x1f, row, bus, r); return; }
    }
  }
  clearMsg(rt);
  if (r.term === '0' && !r.model) {
    r.attr &= 0xe7;
  } else {
    msg(rt, 16, 'Press <SPACE> to select IFB Priority 1, 2 or 3');
    let pr = (r.attr >> 3) & 3;
    for (;;) {
      w.cursor(row, 22);
      const k = await rt.getKey();
      if (k === ' ') { pr = pr >= 3 ? 1 : pr + 1; w.printc(row, 22, 0x1f, ' 123'[pr]); continue; }
      if (k === K.ENTER || k === K.ESC || k === K.F10) break;
    }
    r.attr = (r.attr & 0xe7) | (pr << 3);
  }
  clearMsg(rt);
  rt.screen.hideCursor();
  paintRow(w, 0x1f, row, bus, r);
}

/** F4: copy the previous bus with increment (spec 02 §4.1). Returns true if something was copied. */
export function copyIncrement(rows: { mn: string; ovl: string; attr: number; term: string; desc: string; model?: string }[], bus: number): boolean {
  if (bus < 2) return false;
  const prev = rows[bus - 1];
  const p = prev.mn.padEnd(4).split('');
  if (p[3] === '9' && p[2] < '9') { p[3] = '0'; p[2] = String.fromCharCode(p[2].charCodeAt(0) + 1); }
  else if (p[3] >= '0' && p[3] <= '8') p[3] = String.fromCharCode(p[3].charCodeAt(0) + 1);
  else return false;
  const cur = rows[bus];
  cur.mn = p.join('');
  cur.ovl = '    ';
  cur.attr = prev.attr;
  cur.term = prev.term;
  if ('model' in prev) cur.model = prev.model;
  const s = prev.desc.replace(/\s+$/, '');
  const d = prev.desc.padEnd(22).split('');
  const n = s.length;
  if (n > 0) {
    const last = s[n - 1];
    const isD = (c: string | undefined) => !!c && c >= '0' && c <= '9';
    if (last >= '0' && last <= '8') d[n - 1] = String.fromCharCode(last.charCodeAt(0) + 1);
    else if (last === '9' && isD(s[n - 2])) { d[n - 1] = '0'; d[n - 2] = String.fromCharCode(s.charCodeAt(n - 2) + 1); }
    else if (last === '9' && n < 22) { d[n - 1] = '1'; d[n] = '0'; }
    else d[n - 1] = '?';
  }
  cur.desc = d.join('').slice(0, 22);
  return true;
}

async function printIndex(ctx: Ctx, p: Production, rows: Row[]) {
  await runPrint(ctx, 'Matrix Index Table Data', 'Printing Matrix Index Data of current Production!',
    `${ctx.eng.fname(p.f)}-index.txt`, pr => {
      let bus = 1;
      while (bus <= p.N) {
        pr.header('Matrix Index Table');
        pr.w(pr.BOLD);
        pr.w('                            Attribute                            Terminal\n\r');
        pr.w('        Bus  Mnemonic Ovly  T L M I P      Description             Type\n\r');
        pr.w(`${pr.LPI8}        ${pr.UL}${' '.repeat(66)}\n\r${pr.NOUL}${pr.BOLD ? pr.NOBOLD : ''}\n`);
        let line = 0;
        for (; line < 48 && bus <= p.N; line++, bus++) {
          const r = rows[bus];
          pr.w(`        ${pad3(bus)}   ${r.mn}    ${r.ovl}  ${x(!!(r.attr & 0x40))} ${x(!!(r.attr & 0x80))} `
            + `${x(!!(r.attr & 0x20))} ${x(!!(r.attr & 0x02))} ${prioChar(r.attr)}   ${r.desc}   ${typeText(r)}\n\r`);
        }
        pr.footer(line + 1);
      }
    });
}
