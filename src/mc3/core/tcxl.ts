// A small TCXL 5.5 work-alike: windows with borders and shadows, line drawing with auto-joins, the
// row-24 message line, pick-lists, single- and multi-field input forms, the menu bar with pulldowns,
// and the help window. Behaviour follows mcom-web/specs/01-core-files.md §4 and §8.
import { BOX, lineWeight, merge } from './boxes';
import { isChar, K, type Key } from './keys';
import type { Runtime } from './runtime';
import { cellLen, cells, fit, type Saved } from './screen';

// ---------------------------------------------------------------------------------------------
// Windows

export class Win {
  readonly rt: Runtime;
  readonly srow: number; readonly scol: number; readonly erow: number; readonly ecol: number;
  readonly btype: number; readonly battr: number; readonly wattr: number;
  private saved: Saved;
  closed = false;

  constructor(rt: Runtime, srow: number, scol: number, erow: number, ecol: number,
    btype: number, battr: number, wattr: number, shadow: boolean) {
    this.rt = rt;
    this.srow = srow; this.scol = scol; this.erow = erow; this.ecol = ecol;
    this.btype = btype; this.battr = battr; this.wattr = wattr;
    const s = rt.screen;
    this.saved = s.save(srow, scol, erow + (shadow ? 1 : 0), ecol + (shadow ? 2 : 0));
    s.fill(srow, scol, erow, ecol, wattr);
    if (btype !== 5) {
      const b = BOX[btype] ?? BOX[0];
      s.putc(srow, scol, battr, b[0]);
      s.putc(srow, ecol, battr, b[2]);
      s.putc(erow, scol, battr, b[5]);
      s.putc(erow, ecol, battr, b[7]);
      for (let c = scol + 1; c < ecol; c++) { s.putc(srow, c, battr, b[1]); s.putc(erow, c, battr, b[6]); }
      for (let r = srow + 1; r < erow; r++) { s.putc(r, scol, battr, b[3]); s.putc(r, ecol, battr, b[4]); }
    }
    if (shadow) {
      for (let r = srow + 1; r <= erow + 1; r++) {
        s.setAttr(r, ecol + 1, 0x08);
        s.setAttr(r, ecol + 2, 0x08);
      }
      for (let c = scol + 2; c <= ecol + 2; c++) s.setAttr(erow + 1, c, 0x08);
    }
  }

  /** Interior origin and size. */
  get top() { return this.btype === 5 ? this.srow : this.srow + 1; }
  get left() { return this.btype === 5 ? this.scol : this.scol + 1; }
  get height() { return this.btype === 5 ? this.erow - this.srow + 1 : this.erow - this.srow - 1; }
  get width() { return this.btype === 5 ? this.ecol - this.scol + 1 : this.ecol - this.scol - 1; }

  /** wprints: window-relative print, clipped to the interior (a row outside it prints nothing). */
  prints(row: number, col: number, attr: number, text: string) {
    if (row < 0 || row >= this.height || col >= this.width) return;
    const c = cells(text);
    const room = this.width - col;
    this.rt.screen.put(this.top + row, this.left + col, attr, c.slice(0, Math.max(0, room)).join(''));
  }

  printc(row: number, col: number, attr: number, ch: string) {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) return;
    this.rt.screen.putc(this.top + row, this.left + col, attr, ch);
  }

  /** wcenters: col = innerWidth/2 − strlen/2. */
  centers(row: number, attr: number, text: string) {
    this.prints(row, Math.max(0, Math.floor(this.width / 2) - Math.floor(cellLen(text) / 2)), attr, text);
  }

  clear(attr = this.wattr) {
    this.rt.screen.fill(this.top, this.left, this.top + this.height - 1, this.left + this.width - 1, attr);
  }

  clearRow(row: number, attr = this.wattr) {
    this.prints(row, 0, attr, ' '.repeat(this.width));
  }

  /** Change the attribute of a run of cells (keeps the characters). */
  paint(row: number, col: number, count: number, attr: number) {
    for (let i = 0; i < count; i++) {
      if (col + i >= 0 && col + i < this.width && row >= 0 && row < this.height) {
        this.rt.screen.setAttr(this.top + row, this.left + col + i, attr);
      }
    }
  }

  /** whline: horizontal line, joining crossing lines and the border. */
  hline(row: number, col: number, count: number, btype: number, attr: number) {
    const w = lineWeight(btype).h;
    const s = this.rt.screen;
    const r = this.top + row;
    for (let i = 0; i < count; i++) {
      const c = this.left + col + i;
      if (col + i < 0 || col + i >= this.width) continue;
      s.putc(r, c, attr, merge(s.charAt(r, c), [0, 0, w, w]));
    }
    if (this.btype !== 5) {
      if (col <= 0) s.putc(r, this.scol, this.battr, merge(s.charAt(r, this.scol), [0, 0, 0, w]));
      if (col + count >= this.width) s.putc(r, this.ecol, this.battr, merge(s.charAt(r, this.ecol), [0, 0, w, 0]));
    }
  }

  /** wvline: vertical line, joining crossing lines and the border. */
  vline(row: number, col: number, count: number, btype: number, attr: number) {
    const w = lineWeight(btype).v;
    const s = this.rt.screen;
    const c = this.left + col;
    for (let i = 0; i < count; i++) {
      const r = this.top + row + i;
      if (row + i < 0 || row + i >= this.height) continue;
      s.putc(r, c, attr, merge(s.charAt(r, c), [w, w, 0, 0]));
    }
    if (this.btype !== 5) {
      if (row <= 0) s.putc(this.srow, c, this.battr, merge(s.charAt(this.srow, c), [0, w, 0, 0]));
      if (row + count >= this.height) s.putc(this.erow, c, this.battr, merge(s.charAt(this.erow, c), [w, 0, 0, 0]));
    }
  }

  /** wtitle: text on the top border; pos 1 = left, 2 = centre, else right. */
  title(text: string, pos: number, attr: number) {
    const w = this.ecol - this.scol + 1;
    const len = cellLen(text);
    const col = pos === 1 ? this.scol + 1 : pos === 2 ? this.scol + Math.floor((w - len) / 2) : this.ecol - len;
    this.rt.screen.put(this.srow, col, attr, text);
  }

  /** Text on the bottom border at a border-relative column. */
  footer(text: string, col: number, attr: number) {
    this.rt.screen.put(this.erow, this.scol + col, attr, text);
  }

  /** Place the hardware cursor at a window-relative position. */
  cursor(row: number, col: number, visible = true) {
    this.rt.screen.setCursor(this.top + row, this.left + col, visible);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.rt.screen.restore(this.saved);
  }
}

/** wopen (+ wshadow 0x08, the app's standard open function). */
export function wopen(rt: Runtime, srow: number, scol: number, erow: number, ecol: number,
  btype: number, battr: number, wattr: number, shadow = true): Win {
  return new Win(rt, srow, scol, erow, ecol, btype, battr, wattr, shadow);
}

// ---------------------------------------------------------------------------------------------
// Row-24 message line (spec 01 §8.5)

export const MSG_ROW = 24;

export function clearMsg(rt: Runtime) {
  rt.screen.fill(MSG_ROW, 0, MSG_ROW, 79, 0x4f);
}

export function msg(rt: Runtime, col: number, text: string, attr = 0x4f) {
  clearMsg(rt);
  rt.screen.put(MSG_ROW, col, attr, text);
}

/** Centred message (MC III messages that have no original column). */
export function msgC(rt: Runtime, text: string, attr = 0x4f) {
  msg(rt, Math.max(0, Math.floor((80 - cellLen(text)) / 2)), text, attr);
}

/** Message + beep + wait ≈1 s or a key, then clear (the app's standard error/info message). */
export async function msgWait(rt: Runtime, col: number | null, text: string, beep = true, ms = 1000) {
  if (col === null) msgC(rt, text);
  else msg(rt, col, text);
  if (beep) rt.beep();
  await rt.waitKey(ms);
  clearMsg(rt);
}

// ---------------------------------------------------------------------------------------------
// Pick list (wpickstr, spec 01 §8.2)

export async function pickList(rt: Runtime, srow: number, scol: number, erow: number, ecol: number,
  btype: number, battr: number, wattr: number, barattr: number, items: string[], init = 0,
  opts: { title?: string; onMove?: (i: number) => void } = {}): Promise<number> {
  const w = wopen(rt, srow, scol, erow, ecol, btype, battr, wattr);
  if (opts.title) w.title(opts.title, 2, battr);
  const W = w.width;
  const H = w.height;
  const maxlen = Math.max(1, ...items.map(cellLen));
  const ncols = Math.max(1, Math.floor((W - 2) / (maxlen + 2)));
  const gap = Math.max(0, Math.floor((W - ncols * maxlen) / (ncols + 1)));
  const margin = Math.max(0, Math.floor(((W - ncols * maxlen) % (ncols + 1)) / 2));
  const nrows = Math.ceil(items.length / ncols);
  let cur = Math.min(Math.max(0, init), items.length - 1);
  let topRow = 0;
  const colOf = (k: number) => margin + gap * ((k % ncols) + 1) + (k % ncols) * maxlen;
  const draw = () => {
    const cr = Math.floor(cur / ncols);
    if (cr < topRow) topRow = cr;
    if (cr >= topRow + H) topRow = cr - H + 1;
    w.clear();
    for (let k = topRow * ncols; k < Math.min(items.length, (topRow + H) * ncols); k++) {
      const r = Math.floor(k / ncols) - topRow;
      w.prints(r, colOf(k), k === cur ? barattr : wattr, fit(items[k], maxlen));
    }
    if (nrows > H && btype !== 5) {
      rt.screen.putc(srow + 1, ecol, battr, topRow > 0 ? '↑' : BOX[btype][4]);
      rt.screen.putc(erow - 1, ecol, battr, topRow + H < nrows ? '↓' : BOX[btype][4]);
    }
    opts.onMove?.(cur);
  };
  rt.screen.hideCursor();
  draw();
  for (;;) {
    const k = await rt.getKey();
    const n = items.length;
    if (k === K.ENTER) { w.close(); return cur; }
    if (k === K.ESC) { w.close(); return -1; }
    if (k === K.UP) cur = Math.max(cur % ncols, cur - ncols);
    else if (k === K.DOWN) { if (cur + ncols < n) cur += ncols; }
    else if (k === K.LEFT) cur = Math.max(0, cur - 1);
    else if (k === K.RIGHT) cur = Math.min(n - 1, cur + 1);
    else if (k === K.HOME) cur = 0;
    else if (k === K.END) cur = n - 1;
    else if (k === K.PGUP) cur = Math.max(cur % ncols, cur - ncols * H);
    else if (k === K.PGDN) cur = Math.min(n - 1, cur + ncols * H);
    else if (isChar(k) && k !== ' ') {
      const u = k.toUpperCase();
      for (let i = 1; i <= n; i++) {
        const j = (cur + i) % n;
        if (items[j].trimStart().charAt(0).toUpperCase() === u) { cur = j; break; }
      }
    } else continue;
    draw();
  }
}

// ---------------------------------------------------------------------------------------------
// Input fields (winpdef / winpread, spec 01 §8.4)

export interface Field {
  row: number; col: number;           // absolute screen position
  width: number;
  value: string;
  upper?: boolean;                    // flags 2: force upper case
  charOk?: (ch: string) => boolean;   // format filter (default: any printable)
  validate?: (v: string) => boolean;  // non-OK refuses to leave the field (cursor to col 0)
}

export interface FieldResult { value: string; key: Key }

/** Printable ASCII 0x20..0x7E (TCXL format '*'). */
export const ASCII = (ch: string) => ch.length === 1 && ch >= ' ' && ch <= '~';
export const DIGITS = (ch: string) => /^[0-9 ]$/.test(ch);
export const NUMERIC = (ch: string) => /^[0-9 .+-]$/.test(ch);

/**
 * Edit one field. Ends on ENTER (accept), ESC (original value back), or any key for which
 * `exit(k)` is true (accept + that key) — the app's winpkeyfn filters. The value comes back
 * right-trimmed (the app always strrtrim()s).
 */
export async function editField(rt: Runtime, f: Field, attr: number, exit: (k: Key) => boolean = () => false,
  doneAttr = attr): Promise<FieldResult> {
  const s = rt.screen;
  const orig = fit(f.value, f.width);
  let buf = cells(orig);
  const textLen = () => { let n = buf.length; while (n > 0 && buf[n - 1] === ' ') n--; return n; };
  let pos = Math.min(textLen(), f.width - 1);
  let first = true;
  const ok = f.charOk ?? ((ch: string) => ch >= ' ' && !/[\u0000-\u001f\u007f]/.test(ch));
  const draw = () => {
    s.put(f.row, f.col, attr, buf.join(''));
    s.setCursor(f.row, f.col + Math.min(pos, f.width - 1), true);
  };
  const finish = (key: Key, value: string): FieldResult => {
    s.put(f.row, f.col, doneAttr, fit(value, f.width));
    s.cursor.insert = false;
    s.hideCursor();
    return { value: value.replace(/\s+$/, ''), key };
  };
  draw();
  for (;;) {
    const k = await rt.getKey();
    if (k === K.ESC) return finish(K.ESC, orig);
    const accepting = k === K.ENTER || k === K.CENTER || exit(k);
    if (accepting) {
      const v = buf.join('').replace(/\s+$/, '');
      if (f.validate && !f.validate(v)) {
        rt.beep();
        pos = 0;
        first = false;
        draw();
        continue;
      }
      return finish(k, buf.join(''));
    }
    if (isChar(k)) {
      let ch = k;
      if (f.upper && /^[a-z]$/.test(ch)) ch = ch.toUpperCase();
      if (!ok(ch)) { rt.beep(); continue; }
      if (first) { buf = new Array(f.width).fill(' '); pos = 0; }
      first = false;
      if (pos >= f.width) { rt.beep(); continue; }
      if (s.cursor.insert) { buf.splice(pos, 0, ch); buf.length = f.width; } else buf[pos] = ch;
      pos++;
      draw();
      continue;
    }
    first = false;
    switch (k) {
      case K.LEFT: pos = Math.max(0, Math.min(pos, f.width - 1) - 1); break;
      case K.RIGHT: pos = Math.min(f.width - 1, pos + 1); break;
      case K.HOME: pos = 0; break;
      case K.END: pos = Math.min(textLen(), f.width - 1); break;
      case K.BKSP:
        if (pos > 0) { pos--; buf.splice(pos, 1); buf.push(' '); }
        break;
      case K.DEL: buf.splice(Math.min(pos, f.width - 1), 1); buf.push(' '); break;
      case K.INS: s.cursor.insert = !s.cursor.insert; break;
      case '{CTRL-U}': buf = new Array(f.width).fill(' '); pos = 0; break;
      case '{CTRL-Y}': for (let i = pos; i < f.width; i++) buf[i] = ' '; break;
      case '{CTRL-R}': buf = cells(orig); pos = Math.min(textLen(), f.width - 1); break;
      default: continue;
    }
    draw();
  }
}

export interface FormResult { values: string[]; key: Key; index: number }

/**
 * Multi-field form (winpread with several winpdef). ENTER/TAB/DOWN next field (ENTER on the last
 * accepts), SHIFT-TAB/UP previous (both wrap), F10 / Ctrl-ENTER accept, ESC cancel (originals back).
 * `exit(k)` keys accept and end the form with that key.
 */
export async function form(rt: Runtime, fields: Field[], attr: number, idleAttr: number,
  exit: (k: Key) => boolean = () => false, start = 0, navKeys = true): Promise<FormResult> {
  const values = fields.map(f => f.value);
  for (const f of fields) rt.screen.put(f.row, f.col, idleAttr, fit(f.value, f.width));
  let i = start;
  if (!navKeys) {
    // only ENTER moves between fields; every exit() key ends the form (app key filters like 16b8:1a82)
    for (;;) {
      const r = await editField(rt, { ...fields[i], value: values[i] }, attr, exit, idleAttr);
      if (r.key === K.ESC) {
        fields.forEach(f => rt.screen.put(f.row, f.col, idleAttr, fit(f.value, f.width)));
        return { values: fields.map(f => f.value.replace(/\s+$/, '')), key: K.ESC, index: i };
      }
      values[i] = r.value;
      if (r.key === K.ENTER && i < fields.length - 1) { i++; continue; }
      return { values, key: r.key, index: i };
    }
  }
  const nav = (k: Key) => k === K.TAB || k === K.STAB || k === K.UP || k === K.DOWN || k === K.F10 || exit(k);
  for (;;) {
    const r = await editField(rt, { ...fields[i], value: values[i] }, attr, nav, idleAttr);
    if (r.key === K.ESC) {
      fields.forEach(f => rt.screen.put(f.row, f.col, idleAttr, fit(f.value, f.width)));
      return { values: fields.map(f => f.value.replace(/\s+$/, '')), key: K.ESC, index: i };
    }
    values[i] = r.value;
    if (r.key === K.F10 || r.key === K.CENTER || (exit(r.key) && r.key !== K.TAB && r.key !== K.STAB
      && r.key !== K.UP && r.key !== K.DOWN)) {
      return { values, key: r.key, index: i };
    }
    if (r.key === K.ENTER) {
      if (i === fields.length - 1) return { values, key: K.ENTER, index: i };
      i++;
    } else if (r.key === K.TAB || r.key === K.DOWN) i = (i + 1) % fields.length;
    else if (r.key === K.STAB || r.key === K.UP) i = (i + fields.length - 1) % fields.length;
  }
}

// ---------------------------------------------------------------------------------------------
// Confirmation prompt on the message line

/** Row-24 prompt + beep; true if the next key is ENTER. */
export async function confirm(rt: Runtime, col: number | null, text: string): Promise<boolean> {
  if (col === null) msgC(rt, text); else msg(rt, col, text);
  rt.beep();
  const k = await rt.getKey();
  clearMsg(rt);
  return k === K.ENTER;
}

/** A small MCOM-style message box (white on red/green), any key closes. */
export async function messageBox(rt: Runtime, lines: string[], attr = 0x2f, titleAttr = 0x24,
  wait = -1): Promise<void> {
  const width = Math.max(...lines.map(cellLen)) + 4;
  const scol = Math.floor((80 - width) / 2);
  const srow = Math.max(2, Math.floor((19 - lines.length) / 2));
  const w = wopen(rt, srow, scol, srow + lines.length + 1, scol + width - 1, 0, attr, attr);
  lines.forEach((l, i) => w.centers(i, i === 0 ? titleAttr : attr, l));
  rt.screen.hideCursor();
  if (wait >= 0) await rt.waitKey(wait);
  else await rt.getKey();
  w.close();
}

// ---------------------------------------------------------------------------------------------
// Menu bar + pulldowns (wmenubeg/wmenuitm/wmenuend/wmenuget, spec 01 §4)

export interface MenuItem {
  text: string;
  hot: number;                           // index of the highlighted hot character
  help?: number;
  /** Return 'close' to close the whole menu afterwards (fmask 4). */
  run?: () => Promise<void | 'close'>;
  close?: boolean;
}

export interface Pulldown {
  srow: number; scol: number; erow: number; ecol: number;
  barwidth: number;
  items: MenuItem[];
  init: number;
}

export interface BarItem { text: string; col: number; hot: number; help?: number; pull: Pulldown }

function drawBarItem(rt: Runtime, it: BarItem, selected: boolean) {
  if (selected) rt.screen.put(0, it.col, 0x1f, it.text);
  else {
    rt.screen.put(0, it.col, 0x70, it.text);
    rt.screen.putc(0, it.col + it.hot, 0x74, it.text[it.hot]);
  }
}

/** Run the horizontal menu bar until ESC on the bar or an item closes it. */
export async function menuBar(rt: Runtime, bar: BarItem[], init: number): Promise<void> {
  let sel = init;
  rt.screen.fill(0, 0, 0, 79, 0x70);
  const drawBar = () => bar.forEach((b, i) => drawBarItem(rt, b, i === sel));
  drawBar();
  let open = false;
  for (;;) {
    if (!open) {
      rt.helpCat = bar[sel].help || 1;
      rt.screen.hideCursor();
      const k = await rt.getKey();
      if (k === K.LEFT) sel = (sel + bar.length - 1) % bar.length;
      else if (k === K.RIGHT) sel = (sel + 1) % bar.length;
      else if (k === K.ENTER || k === K.DOWN) open = true;
      else if (k === K.ESC) return;
      else if (isChar(k)) {
        const j = bar.findIndex(b => b.text[b.hot].toUpperCase() === k.toUpperCase());
        if (j < 0) continue;
        sel = j;
        open = true;
      } else continue;
      drawBar();
      continue;
    }
    const r = await pulldown(rt, bar[sel].pull);
    if (r === 'close') return;
    if (r === 'esc') open = false;
    else sel = (sel + (r === 'left' ? bar.length - 1 : 1)) % bar.length;
    drawBar();
  }
}

async function pulldown(rt: Runtime, pd: Pulldown): Promise<'left' | 'right' | 'esc' | 'close'> {
  const w = wopen(rt, pd.srow, pd.scol, pd.erow, pd.ecol, 0, 0x17, 0x17);
  const bw = Math.min(pd.barwidth, w.width);
  let cur = pd.init;
  const drawItem = (i: number) => {
    const it = pd.items[i];
    const t = fit(' ' + it.text, bw);
    if (i === cur) w.prints(i, 0, 0x71, t);
    else {
      w.prints(i, 0, 0x17, t);
      w.printc(i, 1 + it.hot, 0x1f, it.text[it.hot]);
    }
  };
  const drawAll = () => pd.items.forEach((_, i) => drawItem(i));
  drawAll();
  const run = async (): Promise<boolean> => {
    const it = pd.items[cur];
    pd.init = cur;
    rt.helpCat = it.help || 1;
    const res = it.run ? await it.run() : undefined;
    if (it.close || res === 'close') { w.close(); return true; }
    drawAll();
    return false;
  };
  for (;;) {
    rt.helpCat = pd.items[cur].help || 1;
    rt.screen.hideCursor();
    const k = await rt.getKey();
    const n = pd.items.length;
    const prev = cur;
    if (k === K.UP) cur = (cur + n - 1) % n;
    else if (k === K.DOWN) cur = (cur + 1) % n;
    else if (k === K.HOME) cur = 0;
    else if (k === K.END) cur = n - 1;
    else if (k === K.ENTER) { if (await run()) return 'close'; continue; }
    else if (k === K.LEFT || k === K.RIGHT || k === K.ESC) {
      pd.init = cur;
      w.close();
      return k === K.LEFT ? 'left' : k === K.RIGHT ? 'right' : 'esc';
    } else if (isChar(k)) {
      const u = k.toUpperCase();
      let found = -1;
      for (let i = 1; i <= n; i++) {
        const j = (cur + i) % n;
        if (pd.items[j].text[pd.items[j].hot].toUpperCase() === u) { found = j; break; }
      }
      if (found < 0) continue;
      cur = found;
      drawItem(prev);
      drawItem(cur);
      if (await run()) return 'close';
      continue;
    } else continue;
    drawItem(prev);
    drawItem(cur);
  }
}

/** A stand-alone vertical menu (e.g. the Overlay Definition sub-menu); runs items until ESC. */
export async function vmenu(rt: Runtime, srow: number, scol: number, erow: number, ecol: number,
  attr: number, hotAttr: number, barAttr: number, items: MenuItem[], init = 0) {
  const w = wopen(rt, srow, scol, erow, ecol, 0, attr, attr);
  let cur = init;
  const drawItem = (i: number) => {
    const it = items[i];
    w.prints(i, 0, i === cur ? barAttr : attr, it.text);
    if (i !== cur) w.printc(i, it.hot, hotAttr, it.text[it.hot]);
  };
  const all = () => items.forEach((_, i) => drawItem(i));
  all();
  for (;;) {
    rt.helpCat = items[cur].help || 1;
    rt.screen.hideCursor();
    const k = await rt.getKey();
    const n = items.length;
    let run = false;
    if (k === K.UP) cur = (cur + n - 1) % n;
    else if (k === K.DOWN) cur = (cur + 1) % n;
    else if (k === K.HOME) cur = 0;
    else if (k === K.END) cur = n - 1;
    else if (k === K.ENTER) run = true;
    else if (k === K.ESC) { w.close(); return; }
    else if (isChar(k)) {
      const j = items.findIndex(it => it.text[it.hot].toUpperCase() === k.toUpperCase());
      if (j < 0) continue;
      cur = j;
      run = true;
    } else continue;
    all();
    if (run && items[cur].run) {
      rt.helpCat = items[cur].help || 1;
      await items[cur].run!();
      all();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Help window (spec 01 §9)

export async function helpWindow(rt: Runtime, lines: string[] | null, cat: number) {
  const w = wopen(rt, 6, 16, 20, 62, 1, 0x4f, 0x4f);
  w.title('[ Help ]', 2, 0x4f);
  const saveCur = { ...rt.screen.cursor };
  rt.screen.hideCursor();
  const body = lines ?? ['No help category defined.', '', `Help category not found:    ${cat}`];
  const pages: string[][] = [[]];
  for (const l of body) {
    if (l === '*P' || pages[pages.length - 1].length >= w.height) {
      pages.push([]);
      if (l === '*P') continue;
    }
    pages[pages.length - 1].push(l);
  }
  let p = 0;
  const draw = () => {
    w.clear();
    pages[p].forEach((l, i) => w.prints(i, 0, 0x4f, l));
    if (pages.length > 1) {
      const ind = p === 0 ? '─────PgDn' : p === pages.length - 1 ? '─────PgUp' : 'PgUp/PgDn';
      w.footer(ind, w.ecol - w.scol - 10, 0x4f);
    }
  };
  draw();
  for (;;) {
    const k = await rt.getKey();
    if (k === K.ESC || k === K.F1) break;
    if (k === K.PGDN && p < pages.length - 1) { p++; draw(); }
    if (k === K.PGUP && p > 0) { p--; draw(); }
  }
  w.close();
  Object.assign(rt.screen.cursor, saveCur);
  rt.screen.touch();
}
