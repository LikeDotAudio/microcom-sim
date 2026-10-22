// Terminal Assignments (seg 19b2, spec 04): bus list (Assignment Edit / Group Edit / Transfer
// Assignment / Transfer Group), the panel-art key editor and the group editor.
// MicroCOM III: classic 7800-series terminals keep their MCOM key slots and gain a page of matrix keys
// (engine extended keys, any of the 2048 ports, any production); M7832/M7864/M2026 panels show all their
// 32/64 keys; talent (IFB/Mic) positions have no keys.
import { pad2, pad3, production, type Ctx } from '../ctx';
import type { ExtKey } from '../engine';
import { isChar, K, type Key } from '../keys';
import { KEY_LABELS, PANEL_MODELS, parsePhantom, phantomName, phantomOverlay, type Production } from '../model';
import { runPrint } from '../printer';
import { ASCII, clearMsg, editField, messageBox, msg, msgWait, pickList, wopen, type Win } from '../tcxl';
import { finishTransfer, openTransferWindow, progress } from './transfer';

// ---------------------------------------------------------------------------------------------
// Key values

/** What a key does: nothing, talk/listen to a port (any production), a phantom code, or a
 *  multi-target matrix key (kept as is unless retyped). */
export type Val =
  | { t: 'empty' }
  | { t: 'bus'; f: number; bus: number; attr: number; label?: string }
  | { t: 'ph'; attr: number; code: number }
  | { t: 'multi'; label: string; targets: number[]; talk: boolean; listen: boolean };

/** Where a cell is stored: an MCOM key slot, an extended key, or a matrix-panel key. */
export type CellKind = 'slot' | 'ext' | 'pm';
export interface Cell { kind: CellKind; slot: number; label: string; val: Val }
interface Bank { title: string; cells: number[]; breaks: Set<number> }

const EMPTY: Val = { t: 'empty' };

export function slotVal(p: Production, code: number, attr: number): Val {
  if (!code || code === 0xff) return EMPTY;
  if (attr & 0x05) {
    return phantomName(attr, code) ? { t: 'ph', attr, code } : EMPTY;
  }
  return code <= p.N ? { t: 'bus', f: p.f, bus: code, attr } : EMPTY;
}

export function extVal(p: Production, k: ExtKey): Val {
  const attr = (k.talk !== false ? 0x40 : 0) | (k.listen ? 0x80 : 0);
  if (k.targets.length === 1) {
    const [f, bus] = p.eng.local(k.targets[0]);
    return { t: 'bus', f, bus, attr, label: k.label };
  }
  return { t: 'multi', label: k.label, targets: [...k.targets], talk: k.talk !== false, listen: !!k.listen };
}

/** Mnemonic of a port of any production (working copy for the own one, engine view otherwise). */
export function mnemonicOf(p: Production, f: number, bus: number): string {
  if (f === p.f) return p.mn(bus);
  return (p.eng.port(p.eng.gid(f, bus))?.[3] ?? '').padEnd(4).slice(0, 4);
}

/** CODE / OVLY / ATTR texts of a cell. */
export function cellText(p: Production, v: Val): [string, string, string] {
  switch (v.t) {
    case 'empty': return ['....', '    ', '../.'];
    case 'ph': {
      const t = `${v.attr & 0x40 ? 'T' : ' '}${v.attr & 0x80 ? 'L' : ' '}/${v.attr & 0x20 ? 'M' : ' '}`;
      return [phantomName(v.attr, v.code) ?? '????', phantomOverlay(p.cfg, v.attr, v.code), t];
    }
    case 'bus': {
      const code = (v.label && v.label.trim() !== mnemonicOf(p, v.f, v.bus).trim() ? v.label : mnemonicOf(p, v.f, v.bus))
        .padEnd(4).slice(0, 4);
      const ovl = v.f === p.f ? p.ovl(v.bus) : `P${pad2(v.f + 1)} `;
      return [code, ovl, `${v.attr & 0x40 ? 'T' : ' '}${v.attr & 0x80 ? 'L' : ' '}/${v.attr & 0x20 ? 'M' : ' '}`];
    }
    case 'multi':
      return [v.label.padEnd(4).slice(0, 4), `+${pad2(v.targets.length)} `.slice(0, 4), `${v.talk ? 'T' : ' '}${v.listen ? 'L' : ' '}/ `];
  }
}

/** Resolve typed text for a cell. undefined = not a valid code (field refuses it). */
export function resolve(p: Production, cell: Cell, text: string, tp: number, thisBus: number): Val | undefined {
  const t = text.trimEnd();
  if (!t) return EMPTY;
  const [cur] = cellText(p, cell.val);
  if (t === cur.trimEnd()) return cell.val;
  const own = tp === p.f;
  if (own && cell.kind !== 'ext') {
    const ph = parsePhantom(t);
    if (ph) return { t: 'ph', attr: ph[0], code: ph[1] };
  }
  if (own) {
    const b = p.findBus(t);
    if (b) return { t: 'bus', f: p.f, bus: b, attr: p.attr(b) | (p.attr(thisBus) & 0x18) };
    return undefined;
  }
  if (cell.kind === 'slot') return undefined;
  const want = t.padEnd(4).slice(0, 4);
  let hit = 0;
  for (let b = 1; b <= p.eng.slice; b++) if (mnemonicOf(p, tp, b) === want) hit = b;
  return hit ? { t: 'bus', f: tp, bus: hit, attr: 0xc0 } : undefined;
}

// ---------------------------------------------------------------------------------------------
// Layout: banks of at most 12 keys, two banks per page

const EXT_CLASSIC = 24;

interface Layout { cells: Cell[]; banks: Bank[]; extra: ExtKey[]; model: string }

function bank(title: string, cells: number[], breaks: number[] = []): Bank {
  return { title, cells, breaks: new Set(breaks) };
}

export function buildLayout(p: Production, bus: number): Layout {
  const term = p.term(bus);
  const model = p.model(bus);
  const keys = p.keys(bus);
  const ext = p.extKeys(bus);
  const labels = KEY_LABELS[term] ?? KEY_LABELS['0'];
  const cells: Cell[] = [];
  const banks: Bank[] = [];
  if (model) {
    const cap = PANEL_MODELS[model] ?? 32;
    for (let s = 0; s < 40; s++) {
      if (!labels[s]) continue;
      const v = slotVal(p, keys[s]?.[0] ?? 0, keys[s]?.[1] ?? 0);
      if (v.t !== 'empty' && cells.length < cap) cells.push({ kind: 'pm', slot: s, label: '', val: v });
    }
    let used = 0;
    for (const k of ext) {
      if (cells.length >= cap) break;
      cells.push({ kind: 'pm', slot: -1, label: '', val: extVal(p, k) });
      used++;
    }
    while (cells.length < cap) cells.push({ kind: 'pm', slot: -1, label: '', val: EMPTY });
    cells.forEach((c, i) => { c.label = String(i + 1); });
    for (let i = 0; i < cap; i += 12) banks.push(bank('KEYS', range(i, Math.min(cap, i + 12))));
    return { cells, banks, extra: ext.slice(used), model };
  }
  const add = (title: string, slots: number[], breaks: number[] = []) => {
    const idx: number[] = [];
    for (const s of slots) {
      idx.push(cells.length);
      cells.push({ kind: 'slot', slot: s, label: labels[s], val: slotVal(p, keys[s]?.[0] ?? 0, keys[s]?.[1] ?? 0) });
    }
    banks.push(bank(title, idx, breaks));
  };
  switch (term) {
    case '2': add('KEYS', range(0, 10), [6]); add('KEYS', range(10, 20)); break;
    case '3': add('KEY ', range(0, 6), [2]); break;
    case '9': add('KEYS', range(0, 6), [2]); break;
    case '4': add('KEY ', range(0, 12), [8]); add('KEY ', range(12, 16)); break;
    case '8': add('KEY ', range(0, 12), [8]); break;
    case '5': add('KEYS', range(0, 10), [6]); add('KEY ', range(20, 32)); add('KEY ', range(32, 36)); break;
    case '6': add('KEY ', range(0, 12), [8]); add('KEY ', range(12, 16)); add('KEY ', range(20, 32)); add('KEY ', range(32, 36)); break;
    default: add('KEYS', range(0, 10), [6]); break;
  }
  // banks of one physical panel stay on one page: pad to an even count before the matrix keys
  if (banks.length % 2) banks.push(bank('', []));
  const first = cells.length;
  for (let i = 0; i < EXT_CLASSIC; i++) {
    cells.push({ kind: 'ext', slot: -1, label: `X${i + 1}`, val: i < ext.length ? extVal(p, ext[i]) : EMPTY });
  }
  banks.push(bank('MTRX', range(first, first + 12)));
  banks.push(bank('MTRX', range(first + 12, first + 24)));
  return { cells, banks, extra: ext.slice(EXT_CLASSIC), model };
}

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

function toExt(p: Production, v: Val): ExtKey | null {
  if (v.t === 'multi') return { label: v.label, targets: v.targets, talk: v.talk, listen: v.listen };
  if (v.t !== 'bus') return null;
  const label = (v.label ?? mnemonicOf(p, v.f, v.bus)).trim() || 'EXT';
  return { label: label.slice(0, 8), targets: [p.eng.gid(v.f, v.bus)], talk: !!(v.attr & 0x40), listen: !!(v.attr & 0x80) };
}

/** Write the layout back into the working copy. Returns a warning or ''. */
export function storeLayout(p: Production, bus: number, lay: Layout): string {
  const keys = p.keys(bus).map(k => [...k]);
  while (keys.length < 40) keys.push([0, 0]);
  const ext: ExtKey[] = [];
  let warn = '';
  if (lay.model) {
    const labels = KEY_LABELS[p.term(bus)] ?? KEY_LABELS['0'];
    const usable = range(0, 40).filter(s => labels[s]);
    let li = 0;
    let sawExt = false;
    for (const c of lay.cells) {
      const v = c.val;
      if (v.t === 'empty') continue;
      const local = v.t === 'ph' || (v.t === 'bus' && v.f === p.f && !sawExt && !v.label);
      if (local && li < usable.length) {
        keys[usable[li++]] = v.t === 'ph' ? [v.code, v.attr] : [(v as { bus: number }).bus, (v as { attr: number }).attr];
        if (sawExt && v.t === 'ph') warn = 'Phantom keys come first on matrix panels - keys reordered.';
        continue;
      }
      if (v.t === 'ph') { warn = 'Too many phantom keys for this panel - extra ones dropped!'; continue; }
      const e = toExt(p, v);
      if (e) { ext.push(e); sawExt = true; }
    }
    for (; li < usable.length; li++) keys[usable[li]] = [0, 0];
  } else {
    for (const c of lay.cells) {
      const v = c.val;
      if (c.kind === 'slot') {
        keys[c.slot] = v.t === 'empty' ? [0, 0] : v.t === 'ph' ? [v.code, v.attr] : v.t === 'bus' ? [v.bus, v.attr] : [0, 0];
      } else {
        const e = toExt(p, v);
        if (e) ext.push(e);
      }
    }
  }
  p.setKeys(bus, keys);
  p.setExtKeys(bus, [...ext, ...lay.extra]);
  return warn;
}

// ---------------------------------------------------------------------------------------------
// Panel art

export function bankArt(b: Bank, labels: string[]): string[] {
  const n = b.cells.length;
  const w = 8 + 5 * n;
  const join = (cell: string, sep: string, dsep: string) =>
    Array.from({ length: n }, (_, k) => (k > 0 ? (b.breaks.has(k) ? dsep : sep) : '') + cell).join('');
  const ruler = labels.map(l => (' ' + l).padEnd(4).slice(0, 4)).join(' ');
  return [
    '▄'.repeat(w),
    `█ ${b.title.padEnd(4)} ║${ruler}█`,
    `█══════╬${join('════', '╤', '╦')}█`,
    `█ CODE ║${join('....', '│', '║')}█`,
    `█ OVLY ║${join('    ', '│', '║')}█`,
    `█──────╫${join('────', '┼', '╫')}█`,
    `█ ATTR ║${join('../.', '│', '║')}█`,
    '▀'.repeat(w),
  ];
}

class KeyEditor {
  readonly ctx: Ctx;
  readonly p: Production;
  readonly bus: number;
  lay: Layout;
  w: Win | null = null;
  page = -1;
  tp = new Map<number, number>();      // cell -> target production for typing

  constructor(ctx: Ctx, p: Production, bus: number) {
    this.ctx = ctx;
    this.p = p;
    this.bus = bus;
    this.lay = buildLayout(p, bus);
  }

  get pages() { return Math.ceil(this.lay.banks.length / 2); }
  pageOf(cell: number) { return Math.floor(this.lay.banks.findIndex(b => b.cells.includes(cell)) / 2); }
  bankOf(cell: number) { return this.lay.banks.findIndex(b => b.cells.includes(cell)); }

  /** Window geometry of a page, MCOM-like positions. */
  private geom(page: number) {
    const banks = this.lay.banks.slice(page * 2, page * 2 + 2).filter(b => b.cells.length);
    const width = Math.max(38, ...banks.map(b => 8 + 5 * b.cells.length));
    const height = 3 + 8 * Math.max(1, banks.length);
    const scol = width >= 75 ? 2 : Math.floor((80 - width) / 2) - 1;
    const srow = banks.length > 1 ? 2 : 10;
    return { banks, width, height, scol, srow };
  }

  show(page: number) {
    if (page === this.page && this.w) return;
    this.w?.close();
    this.page = page;
    const g = this.geom(page);
    const w = wopen(this.ctx.rt, g.srow, g.scol, g.srow + g.height - 1, g.scol + g.width - 1, 5, 0x30, 0x30);
    this.w = w;
    const p = this.p;
    const narrow = g.width < 50;
    const vc = narrow ? 29 : 35;
    const lc = narrow ? 17 : 23;
    const hdr = (r: number, a: string, b: string) => {
      w.prints(r, 0, 0x1f, (' ' + a).padEnd(lc) + b.padEnd(g.width - lc));
    };
    hdr(0, 'Station:', 'Overlay:');
    hdr(1, 'Bus No.:', 'Priority:');
    hdr(2, 'Type:', 'Production:');
    const pr = p.attr(this.bus) & 0x18;
    w.prints(0, 10, 0x1c, p.mn(this.bus));
    w.prints(0, vc, 0x1c, p.ovl(this.bus));
    w.prints(1, 10, 0x1c, pad3(this.bus));
    w.prints(1, vc, 0x1c, pr === 0x08 ? '1' : pr === 0x10 ? '2' : '3');
    w.prints(2, narrow ? 8 : 10, 0x1c, p.typeName(this.bus).trim());
    w.prints(2, narrow ? vc + 2 : vc + 2, 0x1c, p.eng.fname(p.f));
    if (!narrow) {
      const meta = p.eng.meta[String(p.gid(this.bus))];
      if (meta?.name) w.prints(0, 45, 0x1c, `${meta.emoji ? meta.emoji + ' ' : ''}${meta.name}`.slice(0, g.width - 46));
      if (this.pages > 1) w.prints(1, g.width - 12, 0x1f, `Page ${page + 1} of ${this.pages}`);
      if (g.banks.some(b => b.title === 'MTRX')) w.prints(2, 45, 0x1e, 'Matrix Keys (X1..)'.slice(0, g.width - 46));
    }
    g.banks.forEach((b, i) => {
      const art = bankArt(b, b.cells.map(c => this.lay.cells[c].label));
      art.forEach((line, r) => w.prints(3 + 8 * i + r, 0, r === 0 && i === 0 ? 0x10 : 0x30, line.padEnd(g.width)));
      b.cells.forEach(c => this.drawCell(c, false));
    });
  }

  /** Screen-relative (window) position of a cell's CODE line. */
  pos(cell: number): [number, number] {
    const bi = this.bankOf(cell);
    const b = this.lay.banks[bi];
    const k = b.cells.indexOf(cell);
    return [3 + 8 * (bi % 2) + 3, 8 + 5 * k];
  }

  drawCell(cell: number, cursor: boolean) {
    if (!this.w || this.pageOf(cell) !== this.page) return;
    const [r, c] = this.pos(cell);
    const [code, ovl, at] = cellText(this.p, this.lay.cells[cell].val);
    this.w.prints(r, c, cursor ? 0x1f : 0x31, code);
    this.w.prints(r + 1, c, 0x34, ovl);
    this.w.prints(r + 3, c, 0x31, at);
  }

  close() { this.w?.close(); this.w = null; }
}

export async function keyEditor(ctx: Ctx, p: Production, bus: number) {
  const { rt } = ctx;
  const ed = new KeyEditor(ctx, p, bus);
  const n = ed.lay.cells.length;
  let cur = 0;
  const filter = (k: Key) => /^\{F([2-9]|10)\}$/.test(k) || k === K.SF6 || k === K.SF7 || k === K.UP || k === K.DOWN
    || k === K.PGUP || k === K.PGDN || k === K.HOME || k === K.END || k === K.TAB || k === K.STAB;
  const help = () => {
    clearMsg(rt);
    if (ed.lay.cells[cur].kind === 'slot') msg(rt, 2, '<F2> Select Code, <F3> Set Attribute, <F9> Upload, <F10> Save, <ESC> abort');
    else msg(rt, 0, '<F2>Code <F3>Attr <F5>Production <F9>Apply <F10>Save <ESC>Abort <PgDn>Page');
  };
  const save = () => {
    const warn = storeLayout(p, bus, ed.lay);
    ed.lay = buildLayout(p, bus);
    return warn;
  };
  for (;;) {
    ed.show(ed.pageOf(cur));
    help();
    ed.drawCell(cur, true);
    const cell = ed.lay.cells[cur];
    const tp = ed.tp.get(cur) ?? (cell.val.t === 'bus' ? cell.val.f : p.f);
    if (tp !== p.f) msg(rt, 1, `Key targets ${ctx.eng.fname(tp)} ${ctx.eng.prodName(tp)} - type a Mnemonic of that Production, F5 changes`.slice(0, 78));
    const [r, c] = ed.pos(cur);
    const w = ed.w!;
    const [code] = cellText(p, cell.val);
    const res = await editField(rt, {
      row: w.top + r, col: w.left + c, width: 4, value: cell.val.t === 'empty' ? '' : code, upper: true, charOk: ASCII,
      validate: v => resolve(p, cell, v, tp, bus) !== undefined,
    }, 0x1f, filter, 0x31);
    if (res.key === K.ESC) { ed.close(); return; }
    const v = resolve(p, cell, res.value, tp, bus);
    if (v) cell.val = v;
    ed.drawCell(cur, false);
    const bi = ed.bankOf(cur);
    switch (res.key) {
      case K.ENTER: case K.TAB: cur = (cur + 1) % n; break;
      case K.STAB: if (cur > 0) cur--; break;
      case K.UP: case K.DOWN: {
        const banks = ed.lay.banks;
        const k = banks[bi].cells.indexOf(cur);
        let nb = bi;
        do { nb = (nb + (res.key === K.DOWN ? 1 : banks.length - 1)) % banks.length; } while (!banks[nb].cells.length);
        cur = banks[nb].cells[Math.min(k, banks[nb].cells.length - 1)];
        break;
      }
      case K.PGDN: case K.PGUP: {
        const pg = (ed.pageOf(cur) + (res.key === K.PGDN ? 1 : ed.pages - 1)) % ed.pages;
        cur = ed.lay.banks.slice(pg * 2).find(b => b.cells.length)!.cells[0];
        break;
      }
      case K.HOME: cur = 0; break;
      case K.END: cur = n - 1; break;
      case K.F2: {
        const pick = await codePicker(ctx, p, cell.kind === 'slot' ? null : tp);
        if (pick) {
          const [f, b] = pick;
          cell.val = { t: 'bus', f, bus: b, attr: f === p.f ? p.attr(b) | (p.attr(bus) & 0x18) : 0xc0 };
          ed.tp.set(cur, f);
        }
        break;
      }
      case K.F3: await setAttribute(ctx, cell); break;
      case K.F5: {
        if (cell.kind === 'slot') {
          await msgWait(rt, 4, 'Other Productions only on the Matrix Keys page (PgDn) or matrix panels!');
          break;
        }
        const f = await pickProduction(ctx, tp, 'Target Production of Key');
        if (f >= 0) ed.tp.set(cur, f);
        break;
      }
      case K.SF6: cell.val = EMPTY; ed.tp.delete(cur); cur = (cur + 1) % n; break;
      case K.SF7: await printTerminal(ctx, p, bus, ed.lay); break;
      case K.F9: case K.CENTER: case K.F10: {
        msg(rt, 12, 'Saving Terminal Assignment Table - please wait!');
        const warn = save();
        await rt.sleep(120);
        clearMsg(rt);
        if (warn) await msgWait(rt, null, warn);
        if (res.key === K.F9) await applyStations(ctx, p, [bus], 'keys');
        if (res.key === K.F10) { ed.close(); return; }
        ed.page = -1;
        break;
      }
      default: break;
    }
  }
}

async function setAttribute(ctx: Ctx, cell: Cell) {
  const { rt } = ctx;
  const v = cell.val;
  if (v.t === 'empty') return;
  if (v.t === 'ph') { await msgWait(rt, 20, 'Cannot change Attribute for Phantom Codes!'); return; }
  const items = ['Talk only', 'Listen only', 'Talk & Listen', 'Talk & Listen/Mute'].map(s => s.padEnd(18));
  const cur = v.t === 'multi' ? (v.talk && v.listen ? 2 : v.listen ? 1 : 0)
    : [0x40, 0x80, 0xc0, 0xe0].indexOf(v.attr & 0xe0);
  const ch = await pickList(rt, 9, 3, 14, 24, 0, 0x1f, 0x17, 0x2f, items, Math.max(0, cur));
  if (ch < 0) return;
  const bits = [0x40, 0x80, 0xc0, 0xe0][ch];
  if (v.t === 'multi') { v.talk = !!(bits & 0x40); v.listen = !!(bits & 0x80); return; }
  v.attr = (v.attr & 0x1f) | (cell.kind === 'slot' || (cell.kind === 'pm' && v.f === ctx.ws.current) ? bits : bits & 0xc0);
}

/** F2 code picker (19b2:2650): 8 buses at a time; LEFT/RIGHT browse productions when allowed. */
export async function codePicker(ctx: Ctx, p: Production, startProd: number | null): Promise<[number, number] | null> {
  const { rt, eng } = ctx;
  let f = startProd ?? p.f;
  const N = eng.slice;
  const w = wopen(rt, 4, 3, 14, 20, 0, 0x1f, 0x1f);
  w.prints(0, 0, 0x47, 'Bus│Code│Overlay ');
  w.vline(1, 3, 8, 0, 0x17);
  w.vline(1, 8, 8, 0, 0x17);
  let top = 1;
  let row = 1;
  const line = (b: number, r: number, attr: number) => {
    const ovl = f === p.f ? p.ovl(b) : (eng.port(eng.gid(f, b))?.[4] ?? '').padEnd(4).slice(0, 4);
    w.prints(r, 0, attr, pad3(b));
    w.prints(r, 4, attr, mnemonicOf(p, f, b));
    w.prints(r, 10, attr, ovl + '   ');
  };
  const draw = () => {
    w.title(`${startProd === null ? '' : '◄'}${eng.fname(f)}${startProd === null ? '' : '►'}`, 2, 0x1f);
    for (let i = 0; i < 8; i++) line(top + i, i + 1, i + 1 === row ? 0x70 : 0x17);
  };
  msg(rt, 12, `Press <ENTER> to select Code under cursor, <ESC> to abort!${startProd === null ? '' : ' </> Prod'}`);
  rt.screen.hideCursor();
  draw();
  for (;;) {
    const k = await rt.getKey();
    if (k === K.ENTER) { w.close(); clearMsg(rt); return [f, top + row - 1]; }
    if (k === K.ESC) { w.close(); clearMsg(rt); return null; }
    if (k === K.DOWN) { if (row < 8) row++; else if (top + 8 <= N) top++; }
    else if (k === K.UP) { if (row > 1) row--; else if (top > 1) top--; }
    else if (k === K.HOME) { top = 1; row = 1; }
    else if (k === K.END) { top = N - 7; row = 8; }
    else if (k === K.PGUP) { top = Math.max(1, top - 8); row = 1; }
    else if (k === K.PGDN) { top = Math.min(N - 7, top + 8); row = 1; }
    else if ((k === K.LEFT || k === K.RIGHT) && startProd !== null) {
      f = (f + (k === K.RIGHT ? 1 : eng.facilities - 1)) % eng.facilities;
    } else if (isChar(k)) {
      // jump to the next code starting with the letter
      const u = k.toUpperCase();
      for (let i = 1; i <= N; i++) {
        const b = ((top + row - 2 + i) % N) + 1;
        if (mnemonicOf(p, f, b).startsWith(u)) { top = Math.min(Math.max(1, b - 7), N - 7); row = b - top + 1; break; }
      }
    } else continue;
    draw();
  }
}

/** Production pick list (used by the selector and F5). Returns 0-based production or -1. */
export async function pickProduction(ctx: Ctx, cur: number, title: string): Promise<number> {
  const { eng, ws } = ctx;
  const dirty = new Set(ws.dirtyProductions());
  const items = Array.from({ length: eng.facilities }, (_, f) =>
    `${eng.fname(f)}${dirty.has(f) ? '*' : ' '}${eng.prodName(f).padEnd(14).slice(0, 14)}`);
  msg(ctx.rt, 18, 'Select a Production, <ENTER> to confirm!');
  const r = await pickList(ctx.rt, 3, 14, 20, 66, 0, 0x1f, 0x17, 0x2f, items, cur, { title: ` ${title} ` });
  clearMsg(ctx.rt);
  return r;
}

// ---------------------------------------------------------------------------------------------
// Group editor (2610:000e)

const GROUP_ART = [
  ' Station:           Overlay:       Bus#:       ',
  ' Terminal:          Definition:                ',
  '▄'.repeat(47),
  '█    GROUPS     ║ 1    2    3    4    5    6  █',
  '█═════╤═════════╬════╤════╤════╤════╤════╤════█',
  '█ GRP1│ CODES   ║....│....│....│....│....│....█',
  '█     │ OVERLAY ║    │    │    │    │    │    █',
  '█─────┼─────────╫────┼────┼────┼────┼────┼────█',
  '█ GRP2│ CODES   ║....│....│....│....│....│....█',
  '█     │ OVERLAY ║    │    │    │    │    │    █',
  '█─────┼─────────╫────┼────┼────┼────┼────┼────█',
  '█ GRP3│ CODES   ║....│....│....│....│....│....█',
  '█     │ OVERLAY ║    │    │    │    │    │    █',
  '█─────┼─────────╫────┼────┼────┼────┼────┼────█',
  '█ GRP4│ CODES   ║....│....│....│....│....│....█',
  '█     │ OVERLAY ║    │    │    │    │    │    █',
  '▀'.repeat(47),
];

export async function groupEditor(ctx: Ctx, p: Production, bus: number) {
  const { rt } = ctx;
  const N = p.N;
  const g = [...(p.cfg.groups[bus] ?? new Array(24).fill(0))].map(x => (x > 0 && x <= N ? x : 0));
  while (g.length < 24) g.push(0);
  const w = wopen(rt, 5, 16, 21, 62, 5, 0x30, 0x30);
  GROUP_ART.forEach((l, r) => w.prints(r, 0, r < 2 ? 0x1f : r === 2 ? 0x10 : 0x30, l));
  w.prints(0, 10, 0x1c, p.mn(bus));
  w.prints(0, 29, 0x1c, p.ovl(bus));
  w.prints(0, 41, 0x1c, pad3(bus));
  w.prints(1, 11, 0x1c, p.typeName(bus).trim());
  w.prints(1, 32, 0x1c, ctx.eng.fname(p.f));
  for (let i = 0; i < 4; i++) w.prints(6 + 3 * i, 2, 0x34, (p.cfg.phantom[i] ?? '').padEnd(4).slice(0, 4));
  const cell = (gi: number, j: number, cursor: boolean) => {
    const b = g[gi * 6 + j];
    w.prints(5 + 3 * gi, 17 + 5 * j, cursor ? 0x1f : 0x31, b ? p.mn(b) : '....');
    w.prints(6 + 3 * gi, 17 + 5 * j, 0x34, b ? p.ovl(b) : '    ');
  };
  for (let gi = 0; gi < 4; gi++) for (let j = 0; j < 6; j++) cell(gi, j, false);
  let gi = 0;
  let j = 0;
  const filter = (k: Key) => /^\{F([2-9]|10)\}$/.test(k) || k === K.SF6 || k === K.SF7 || k === K.UP || k === K.DOWN
    || k === K.TAB || k === K.STAB || k === K.PGUP || k === K.PGDN || k === K.HOME || k === K.END;
  const save = () => {
    const out: number[] = [];
    for (let i = 0; i < 4; i++) {
      const m = g.slice(i * 6, i * 6 + 6).filter(b => b > 0 && b <= N);
      while (m.length < 6) m.push(0);
      out.push(...m);
    }
    p.cfg.groups[bus] = out;
    p.touch('groups');
  };
  for (;;) {
    msg(rt, 1, '<F2>..Select  <TAB/Shft TAB>..Next/Prev  <F10>..Save/End  <ESC>..Abort');
    cell(gi, j, true);
    const b = g[gi * 6 + j];
    const res = await editField(rt, {
      row: w.top + 5 + 3 * gi, col: w.left + 17 + 5 * j, width: 4, value: b ? p.mn(b) : '', upper: true, charOk: ASCII,
      validate: v => !v.trim() || p.findBus(v) > 0,
    }, 0x1f, filter, 0x31);
    if (res.key === K.ESC) { w.close(); return; }
    if (res.value.trim()) g[gi * 6 + j] = p.findBus(res.value);
    cell(gi, j, false);
    switch (res.key) {
      case K.ENTER: case K.TAB: j = (j + 1) % 6; break;
      case K.STAB: j = (j + 5) % 6; break;
      case K.DOWN: gi = (gi + 1) % 4; break;
      case K.UP: gi = (gi + 3) % 4; break;
      case K.SF6: g[gi * 6 + j] = 0; cell(gi, j, false); j = (j + 1) % 6; break;
      case K.F2: {
        const pick = await codePicker(ctx, p, null);
        if (pick) g[gi * 6 + j] = pick[1];
        break;
      }
      case K.F9: case K.F10: case K.CENTER:
        msg(rt, 14, 'Saving Group Assignment Table - please wait!');
        save();
        await rt.sleep(120);
        clearMsg(rt);
        if (res.key === K.F9) await applyStations(ctx, p, [bus], 'groups');
        if (res.key === K.F10) { w.close(); return; }
        break;
      default: break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Transfers (Transfer Assignment / Transfer Group / F9)

export async function applyStations(ctx: Ctx, p: Production, buses: number[], what: 'keys' | 'groups') {
  const { rt } = ctx;
  const w = await openTransferWindow(ctx);
  if (!w) return;
  w.prints(0, 14, 0x28, what === 'keys' ? 'Bus#     Assignment Data' : 'Bus#     Group Data');
  msg(rt, what === 'keys' ? 10 : 12, what === 'keys' ? 'Uploading Terminal Assignment Data to MicroCOM III Matrix!'
    : 'Uploading Terminal Group Data to MicroCOM III Matrix!');
  let pos = 0;
  try {
    for (let i = 0; i < buses.length; i++) {
      const b = buses[i];
      w.prints(0, 19, 0x28, pad3(b));
      const msgs = p.stationMessages(b, what);
      if (msgs.length) await ctx.eng.transact(p.f, msgs);
      p.stationApplied(b, what);
      const to = Math.round(((i + 1) / buses.length) * 36);
      await progress(ctx, w, pos, to);
      pos = to;
    }
  } catch (e) {
    await finishTransfer(ctx, w, false, '', `Matrix Engine error: ${(e as Error).message}`);
    return;
  }
  await finishTransfer(ctx, w, true);
}

// ---------------------------------------------------------------------------------------------
// Talent positions (IFB/Mic ports 25-32)

async function talentInfo(ctx: Ctx, p: Production, bus: number) {
  const n = ifbNumber(p, bus);
  const pgm = n ? p.cfg.ifb_pgm[n - 1] : 0;
  const meta = ctx.eng.meta[String(p.gid(bus))];
  await messageBox(ctx.rt, [
    `Talent Position ${p.mn(bus).trim() || pad3(bus)}  (Bus ${pad3(bus)})`,
    '',
    meta?.name ? `${meta.name}${meta.role ? ' - ' + meta.role : ''}` : 'IFB earpiece + talent microphone',
    `IFB ${n ? pad2(n) : '--'}   Program: ${pgm && pgm !== 0xff ? p.mn(pgm) + ' (bus ' + pad3(pgm) + ')' : 'none'}`,
    'Turret: MIC ON/OFF and cough key.',
    'The talent mic is listen-only (no talk keys).',
    '',
    'Press any key to continue.',
  ], 0x2f, 0x2e);
}

export function ifbNumber(p: Production, bus: number): number {
  const mn = p.mn(bus);
  if (mn.slice(0, 2).toUpperCase() === 'IF' && /^\d+$/.test(mn.slice(2, 4).trim())) {
    const n = Number(mn.slice(2, 4));
    return n >= 1 && n <= 48 ? n : 0;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Bus list (19b2:002c)

export async function assignmentMenu(ctx: Ctx, mode: 1 | 2 | 3 | 4) {
  const { rt } = ctx;
  const p = await production(ctx);
  if (!p) return;
  const N = p.N;
  const tags = new Set<number>();
  const w = wopen(rt, mode + 3, 25, mode + 18, 55, 0, 0x2f, 0x2f);
  w.prints(0, 1, mode <= 2 ? 0x2f : 0x2e, 'Bus#  Code  Overlay Terminal');
  w.hline(1, 0, 30, 0, 0x2f);
  for (const c of [5, 12, 20]) w.vline(0, c, 14, 0, 0x2f);
  w.title(` ${ctx.eng.fname(p.f)} `, 2, 0x2f);
  const line = (attr: number, row: number, b: number) => {
    if (b < 1 || b > N) return;
    w.printc(row, 0, 0x28, tags.has(b) ? '♦' : ' ');
    w.prints(row, 1, attr, pad3(b));
    w.prints(row, 7, attr, p.mn(b));
    w.prints(row, 14, attr, p.ovl(b));
    w.prints(row, 21, attr, p.typeName(b));
  };
  let top = 1;
  let row = 2;
  const paint = () => { for (let i = 0; i < 12; i++) line(0x28, 2 + i, top + i); };
  paint();
  const helps: Record<number, [number, string]> = {
    1: [4, 'Press <ENTER> to Edit Terminal under Cursor, <F10> or <ESC> to EXIT!'],
    2: [4, '<ENTER> to Edit Group for Terminal under Cursor, <F10> or <ESC> to EXIT!'],
    3: [4, '<ENTER> to Transfer Data, <SPACE> to Tag Terminal, <F10> or <ESC> to EXIT!'],
    4: [4, '<ENTER> to Transfer Data, <SPACE> to Tag Terminal, <F10> or <ESC> to EXIT!'],
  };
  rt.helpCat = mode === 2 ? 8 : mode === 1 ? 4 : 6;
  const down = () => {
    const b = top + row - 2;
    if (b >= N) return;
    if (row < 13) row++; else { top++; paint(); }
  };
  for (;;) {
    const bus = top + row - 2;
    msg(rt, helps[mode][0], helps[mode][1], 0x47);
    line(0x1f, row, bus);
    rt.screen.hideCursor();
    const k = await rt.getKey();
    line(0x28, row, bus);
    if (k === K.ESC || k === K.F10) { w.close(); return; }
    if (k === K.DOWN || (k === ' ' && mode <= 2)) down();
    else if (k === K.UP) { if (bus > 1) { if (row > 2) row--; else { top--; paint(); } } }
    else if (k === K.HOME) { top = 1; row = 2; paint(); }
    else if (k === K.END) { top = Math.max(1, N - 11); row = 2 + (N - top); paint(); }
    else if (k === K.PGUP) { top = bus < 25 ? 1 : Math.max(1, top - 12); row = 2; paint(); }
    else if (k === K.PGDN) { top = top + 12 > N - 11 ? Math.max(1, N - 11) : top + 12; row = 2; paint(); }
    else if (k === ' ' && mode >= 3) {
      if (!p.hasTerminal(bus)) await msgWait(rt, 8, 'No Terminal associated with this Bus, any Key to continue!');
      else { if (tags.has(bus)) tags.delete(bus); else tags.add(bus); line(0x28, row, bus); down(); }
    } else if (k === K.SF7) {
      await printTerminal(ctx, p, bus, buildLayout(p, bus));
    } else if (k === K.ENTER) {
      if (!p.hasTerminal(bus) && !tags.size) {
        if (p.kind(bus) === 'ifb') await talentInfo(ctx, p, bus);
        else await msgWait(rt, 8, 'No Terminal associated with this Bus, any Key to continue!');
        continue;
      }
      if (mode === 1) { rt.helpCat = 4; await keyEditor(ctx, p, bus); rt.helpCat = 4; }
      else if (mode === 2) { rt.helpCat = 8; await groupEditor(ctx, p, bus); }
      else {
        const list = tags.size ? [...tags].sort((a, b) => a - b) : [bus];
        await applyStations(ctx, p, list, mode === 3 ? 'keys' : 'groups');
        tags.clear();
        paint();
      }
      paint();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Printout (2379:2202)

async function printTerminal(ctx: Ctx, p: Production, bus: number, lay: Layout) {
  await runPrint(ctx, 'Terminal Assignment Data', 'Printing Terminal Assignment Data of current Production!',
    `${ctx.eng.fname(p.f)}-${p.mn(bus).trim() || pad3(bus)}-keys.txt`, pr => {
      const pri = p.attr(bus) & 0x18;
      pr.header(`Terminal Assignment Data for ${p.mn(bus)}`);
      pr.w('\n');
      pr.w(`        Terminal Type: ${p.typeName(bus).padStart(8)}   Priority:  ${pri === 0x08 ? '1' : pri === 0x10 ? '2' : '3'}\n\r`);
      pr.w(`        Station Name:  ${p.mn(bus)}       Bus No.: ${String(bus).padStart(3)}   Overlay: ${p.ovl(bus)}\r\n\n`);
      pr.w(`${pr.BOLD}                        Key Assignment\n\r`);
      pr.w('        Key #  Bus #  Mnemonic  Overlay  Talk Listen L/M\n\r');
      pr.w(`        ${pr.UL}${' '.repeat(48)}\n\r${pr.NOUL}${pr.NOBOLD}\n`);
      let lines = 0;
      for (const c of lay.cells) {
        const v = c.val;
        pr.w(`${pr.BOLD}        ${c.label.padStart(3).slice(0, 3)}${pr.NOBOLD}`);
        if (v.t !== 'empty') {
          const [code, ovl, at] = cellText(p, v);
          const busStr = v.t === 'bus' ? (v.f === p.f ? pad3(v.bus) : `${pad2(v.f + 1)}:${pad3(v.bus)}`.slice(-6)) : '   ';
          pr.w(`    ${busStr.padEnd(6)} ${code}      ${ovl}      ${at[0] === 'T' ? 'x' : ' '}    ${at[1] === 'L' ? 'x' : ' '}    ${at[3] === 'M' ? 'x' : ' '}`);
        }
        pr.w('\r\n');
        lines++;
      }
      pr.footer(lines + 12);
    });
}

