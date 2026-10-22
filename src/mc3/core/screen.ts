// 80x25 text-mode cell buffer: one Unicode grapheme + one PC text attribute (hi nibble bg, lo nibble fg)
// per cell, plus the hardware cursor. Front ends render it; the app only ever paints into it.

export const COLS = 80;
export const ROWS = 25;

const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/** Split text into display cells (graphemes; an emoji with modifiers is one cell). */
export function cells(text: string): string[] {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(text)) return text.split('');
  if (seg) return Array.from(seg.segment(text), s => s.segment);
  return Array.from(text);
}

/** Display width in cells. */
export const cellLen = (text: string) => cells(text).length;

/** Pad / truncate to exactly n cells (TCXL strsetsz). */
export function fit(text: string, n: number): string {
  const c = cells(text);
  if (c.length >= n) return c.slice(0, n).join('');
  return text + ' '.repeat(n - c.length);
}

export interface Cursor { row: number; col: number; visible: boolean; insert: boolean }

export interface Saved { r0: number; c0: number; r1: number; c1: number; ch: string[]; at: number[] }

export class Screen {
  readonly cols = COLS;
  readonly rows = ROWS;
  readonly ch: string[] = new Array(COLS * ROWS).fill(' ');
  readonly at = new Uint8Array(COLS * ROWS).fill(0x07);
  readonly cursor: Cursor = { row: 0, col: 0, visible: false, insert: false };
  /** Incremented on every change; front ends compare it to decide when to redraw. */
  version = 0;
  private listeners = new Set<() => void>();
  private pending = false;

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  touch() {
    this.version++;
    if (this.pending || !this.listeners.size) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      for (const fn of this.listeners) fn();
    });
  }

  /** Print text at an absolute position; clipped at the screen edge. */
  put(row: number, col: number, attr: number, text: string) {
    if (row < 0 || row >= ROWS) return;
    let c = col;
    for (const g of cells(text)) {
      if (c >= COLS) break;
      if (c >= 0) {
        const i = row * COLS + c;
        this.ch[i] = g;
        this.at[i] = attr;
      }
      c++;
    }
    this.touch();
  }

  putc(row: number, col: number, attr: number, ch: string) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
    const i = row * COLS + col;
    this.ch[i] = ch;
    this.at[i] = attr;
    this.touch();
  }

  fill(r0: number, c0: number, r1: number, c1: number, attr: number, ch = ' ') {
    for (let r = Math.max(0, r0); r <= Math.min(ROWS - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(COLS - 1, c1); c++) {
        const i = r * COLS + c;
        this.ch[i] = ch;
        this.at[i] = attr;
      }
    }
    this.touch();
  }

  /** Change only the attribute of a cell (window shadows). */
  setAttr(row: number, col: number, attr: number) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
    this.at[row * COLS + col] = attr;
    this.touch();
  }

  charAt(row: number, col: number): string { return this.ch[row * COLS + col]; }
  attrAt(row: number, col: number): number { return this.at[row * COLS + col]; }

  save(r0 = 0, c0 = 0, r1 = ROWS - 1, c1 = COLS - 1): Saved {
    r0 = Math.max(0, r0); c0 = Math.max(0, c0); r1 = Math.min(ROWS - 1, r1); c1 = Math.min(COLS - 1, c1);
    const ch: string[] = [];
    const at: number[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        ch.push(this.ch[r * COLS + c]);
        at.push(this.at[r * COLS + c]);
      }
    }
    return { r0, c0, r1, c1, ch, at };
  }

  restore(s: Saved) {
    let k = 0;
    for (let r = s.r0; r <= s.r1; r++) {
      for (let c = s.c0; c <= s.c1; c++) {
        this.ch[r * COLS + c] = s.ch[k];
        this.at[r * COLS + c] = s.at[k];
        k++;
      }
    }
    this.touch();
  }

  setCursor(row: number, col: number, visible = true) {
    this.cursor.row = row;
    this.cursor.col = col;
    this.cursor.visible = visible;
    this.touch();
  }

  hideCursor() {
    if (!this.cursor.visible) return;
    this.cursor.visible = false;
    this.touch();
  }

  rowText(row: number): string {
    return this.ch.slice(row * COLS, (row + 1) * COLS).join('');
  }

  /** The whole screen as 25 lines of text (trailing blanks trimmed) — for tests and logs. */
  text(trim = true): string {
    const lines: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      const t = this.rowText(r).replace(/ /g, ' ');
      lines.push(trim ? t.replace(/\s+$/, '') : t);
    }
    return lines.join('\n');
  }

  /** Text of a rectangle, e.g. one window. */
  region(r0: number, c0: number, r1: number, c1: number): string {
    const lines: string[] = [];
    for (let r = r0; r <= r1; r++) lines.push(this.ch.slice(r * COLS + c0, r * COLS + c1 + 1).join(''));
    return lines.join('\n');
  }

  /** Find text on screen; returns [row, col] or null. */
  find(text: string): [number, number] | null {
    for (let r = 0; r < ROWS; r++) {
      const i = this.rowText(r).indexOf(text);
      if (i >= 0) return [r, i];
    }
    return null;
  }
}
