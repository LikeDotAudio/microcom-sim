// Canvas renderer for the 80x25 cell buffer: VGA-like 9x16 cells scaled to the window with integer
// device-pixel cell sizes, text from a monospace font stack, and box-drawing / block characters drawn
// as rectangles so lines join seamlessly whatever font is installed.
import { arms } from './core/boxes';
import { CGA } from './core/cp437';
import { COLS, ROWS, type Screen } from './core/screen';

export const FONT_STACK = '"Perfect DOS VGA 437", "Px437 IBM VGA8", "Px437 IBM VGA 9x16", ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';

export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private screen: Screen;
  private cw = 9;
  private chh = 16;
  private prev: string[] = [];
  private blinkOn = true;
  private lastCursor: [number, number] | null = null;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement, screen: Screen) {
    this.canvas = canvas;
    this.screen = screen;
    this.g = canvas.getContext('2d', { alpha: false })!;
    screen.onChange(() => this.schedule());
    setInterval(() => { this.blinkOn = !this.blinkOn; this.drawCursor(); }, 266);
  }

  /** Fit the screen into (w, h) CSS pixels. */
  resize(w: number, h: number) {
    const dpr = window.devicePixelRatio || 1;
    const s = Math.max(0.5, Math.min(w / 720, h / 400));
    this.cw = Math.max(5, Math.floor(9 * s * dpr));
    this.chh = Math.max(9, Math.floor(16 * s * dpr));
    this.canvas.width = this.cw * COLS;
    this.canvas.height = this.chh * ROWS;
    this.canvas.style.width = `${(this.cw * COLS) / dpr}px`;
    this.canvas.style.height = `${(this.chh * ROWS) / dpr}px`;
    this.prev = [];
    this.draw();
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    const s = this.screen;
    const g = this.g;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.font = `${Math.round(this.chh * 0.82)}px ${FONT_STACK}`;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const sig = s.ch[i] + s.at[i];
        if (this.prev[i] === sig) continue;
        this.prev[i] = sig;
        this.cell(r, c, s.ch[i], s.at[i]);
      }
    }
    this.drawCursor();
  }

  private cell(r: number, c: number, ch: string, at: number) {
    const g = this.g;
    const x = c * this.cw;
    const y = r * this.chh;
    const fg = CGA[at & 0x0f];
    const bg = CGA[(at >> 4) & 0x0f];
    g.fillStyle = bg;
    g.fillRect(x, y, this.cw, this.chh);
    if (ch === ' ' || ch === ' ') return;
    g.fillStyle = fg;
    if (this.block(ch, x, y, fg, bg)) return;
    const a = arms(ch);
    if (a) { this.box(a, x, y, bg); return; }
    g.save();
    g.beginPath();
    g.rect(x, y, this.cw, this.chh);
    g.clip();
    g.fillText(ch, x + this.cw / 2, y + this.chh / 2 + this.chh * 0.04);
    g.restore();
  }

  private block(ch: string, x: number, y: number, fg: string, bg: string): boolean {
    const g = this.g;
    const { cw, chh } = this;
    const hh = Math.floor(chh / 2);
    const hw = Math.floor(cw / 2);
    switch (ch) {
      case '█': g.fillRect(x, y, cw, chh); return true;
      case '▀': g.fillRect(x, y, cw, hh); return true;
      case '▄': g.fillRect(x, y + hh, cw, chh - hh); return true;
      case '▌': g.fillRect(x, y, hw, chh); return true;
      case '▐': g.fillRect(x + hw, y, cw - hw, chh); return true;
      case '░': case '▒': case '▓': {
        // ordered dither like the VGA font's shade glyphs
        const p = ch === '░' ? 0.25 : ch === '▒' ? 0.5 : 0.75;
        g.fillStyle = bg;
        g.fillRect(x, y, cw, chh);
        g.fillStyle = fg;
        const step = Math.max(1, Math.round(cw / 9));
        for (let yy = 0; yy < chh; yy += step) {
          for (let xx = 0; xx < cw; xx += step) {
            const k = ((xx / step) & 1) + 2 * ((yy / step) & 1);
            const on = p === 0.5 ? (k === 0 || k === 3) : p === 0.25 ? k === 0 : k !== 3;
            if (on) g.fillRect(x + xx, y + yy, step, step);
          }
        }
        return true;
      }
      default: return false;
    }
  }

  /** Box-drawing glyph from its arms [up, down, left, right] (1 single, 2 double). */
  private box(a: readonly number[], x: number, y: number, bg: string) {
    const g = this.g;
    const { cw, chh } = this;
    const t = Math.max(1, Math.round(chh / 16));
    const cx = x + Math.floor(cw / 2) - Math.floor(t / 2);
    const cy = y + Math.floor(chh / 2) - Math.floor(t / 2);
    const off = t + Math.max(1, Math.round(t * 0.75));      // centre of each double stroke from the axis
    const D = off + Math.ceil(t / 2);                        // outer half-width of a double pair
    const gp = off - Math.floor(t / 2);                      // half-width of the gap between strokes
    const [u, d, l, r] = a;
    const vDouble = u === 2 || d === 2;
    const hDouble = l === 2 || r === 2;
    const mid = (v: number) => v + t / 2;
    const fgStyle = g.fillStyle;
    // 1) thick bands of double arms
    const band = (half: number, extH: number, extV: number) => {
      if (l === 2) g.fillRect(x, mid(cy) - half, mid(cx) + extH - x, 2 * half);
      if (r === 2) g.fillRect(mid(cx) - extH, mid(cy) - half, x + cw - (mid(cx) - extH), 2 * half);
      if (u === 2) g.fillRect(mid(cx) - half, y, 2 * half, mid(cy) + extV - y);
      if (d === 2) g.fillRect(mid(cx) - half, mid(cy) - extV, 2 * half, y + chh - (mid(cy) - extV));
    };
    const extH = vDouble ? D : t / 2;
    const extV = hDouble ? D : t / 2;
    band(D, extH, extV);
    // 2) hollow them out
    g.fillStyle = bg;
    band(gp, vDouble ? gp : t / 2, hDouble ? gp : t / 2);
    g.fillStyle = fgStyle;
    // 3) single arms
    const hThrough = l === 2 && r === 2;
    const vThrough = u === 2 && d === 2;
    // a single arm meeting a double line stops at the near stroke if the double line passes
    // through (╢ ╤), else reaches the far stroke (╖ ╕); otherwise it overlaps the centre (┌ ┼)
    if (l === 1 && r === 1) g.fillRect(x, cy, cw, t);
    else if (l === 1) {
      const end = vDouble ? (vThrough ? mid(cx) - gp : mid(cx) + D) : cx + t;
      g.fillRect(x, cy, end - x, t);
    } else if (r === 1) {
      const start = vDouble ? (vThrough ? mid(cx) + gp : mid(cx) - D) : cx;
      g.fillRect(start, cy, x + cw - start, t);
    }
    if (u === 1 && d === 1) g.fillRect(cx, y, t, chh);
    else if (u === 1) {
      const end = hDouble ? (hThrough ? mid(cy) - gp : mid(cy) + D) : cy + t;
      g.fillRect(cx, y, t, end - y);
    } else if (d === 1) {
      const start = hDouble ? (hThrough ? mid(cy) + gp : mid(cy) - D) : cy;
      g.fillRect(cx, start, t, y + chh - start);
    }
  }

  private drawCursor() {
    const s = this.screen;
    const cur = s.cursor;
    // restore the cell the cursor was on
    if (this.lastCursor) {
      const [r, c] = this.lastCursor;
      const i = r * COLS + c;
      if (i >= 0 && i < COLS * ROWS) { this.prev[i] = ''; this.cell(r, c, s.ch[i], s.at[i]); this.prev[i] = s.ch[i] + s.at[i]; }
      this.lastCursor = null;
    }
    if (!cur.visible || !this.blinkOn || cur.row < 0 || cur.row >= ROWS || cur.col < 0 || cur.col >= COLS) return;
    const at = s.at[cur.row * COLS + cur.col];
    this.g.fillStyle = CGA[at & 0x0f];
    const h = cur.insert ? Math.floor(this.chh / 2) : Math.max(2, Math.round(this.chh / 8));
    this.g.fillRect(cur.col * this.cw, (cur.row + 1) * this.chh - h - Math.round(this.chh / 16), this.cw, h);
    this.lastCursor = [cur.row, cur.col];
  }
}
