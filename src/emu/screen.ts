// 80x25 colour text screen on a canvas: CP437 with box-drawing and block characters drawn as
// geometry so lines join cleanly (as the episode-3.1 screenshots were rendered), blink or bright
// background for attribute bit 7, and the hardware cursor.
import { CP437 } from '../mc3/core/cp437';

export const CGA = ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
  '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'];

const S = 2;                               // canvas pixels per VGA pixel
export const CW = 9 * S, CH = 16 * S;
const T = S;                               // line thickness
const D = 2 * S;                           // half spacing of double lines

type Arms = Partial<Record<'U' | 'D' | 'L' | 'R', 1 | 2>>;

// Box-drawing arms for CP437 0xB3-0xDA: [up, down, left, right], 0 none, 1 single, 2 double
const BOX: Record<string, [number, number, number, number]> = {
  '│': [1, 1, 0, 0], '┤': [1, 1, 1, 0], '╡': [1, 1, 2, 0], '╢': [2, 2, 1, 0], '╖': [0, 2, 1, 0], '╕': [0, 1, 2, 0],
  '╣': [2, 2, 2, 0], '║': [2, 2, 0, 0], '╗': [0, 2, 2, 0], '╝': [2, 0, 2, 0], '╜': [2, 0, 1, 0], '╛': [1, 0, 2, 0],
  '┐': [0, 1, 1, 0], '└': [1, 0, 0, 1], '┴': [1, 0, 1, 1], '┬': [0, 1, 1, 1], '├': [1, 1, 0, 1], '─': [0, 0, 1, 1],
  '┼': [1, 1, 1, 1], '╞': [1, 1, 0, 2], '╟': [2, 2, 0, 1], '╚': [2, 0, 0, 2], '╔': [0, 2, 0, 2], '╩': [2, 0, 2, 2],
  '╦': [0, 2, 2, 2], '╠': [2, 2, 0, 2], '═': [0, 0, 2, 2], '╬': [2, 2, 2, 2], '╧': [1, 0, 2, 2], '╨': [2, 0, 1, 1],
  '╤': [0, 1, 2, 2], '╥': [0, 2, 1, 1], '╙': [2, 0, 0, 1], '╘': [1, 0, 0, 2], '╒': [0, 1, 0, 2], '╓': [0, 2, 0, 1],
  '╫': [2, 2, 1, 1], '╪': [1, 1, 2, 2], '┘': [1, 0, 1, 0], '┌': [0, 1, 0, 1],
};
const ARMS: Record<string, Arms> = {};
for (const [ch, [u, d, l, r]] of Object.entries(BOX)) {
  const a: Arms = {};
  if (u) a.U = u as 1 | 2;
  if (d) a.D = d as 1 | 2;
  if (l) a.L = l as 1 | 2;
  if (r) a.R = r as 1 | 2;
  ARMS[ch] = a;
}

function drawBox(g: CanvasRenderingContext2D, x: number, y: number, arms: Arms) {
  const cx = x + CW / 2, cy = y + CH / 2;
  const off = (a: keyof Arms) => (arms[a] === 2 ? D : 0);
  const vmax = arms.U || arms.D ? Math.max(off('U'), off('D')) : 0;
  const hmax = arms.L || arms.R ? Math.max(off('L'), off('R')) : 0;
  const hline = (x0: number, x1: number, yy: number) => g.fillRect(Math.min(x0, x1), yy - T / 2, Math.abs(x1 - x0), T);
  const vline = (y0: number, y1: number, xx: number) => g.fillRect(xx - T / 2, Math.min(y0, y1), T, Math.abs(y1 - y0));
  for (const [a, edge, sgn] of [['R', x + CW, 1], ['L', x, -1]] as const) {
    if (!arms[a]) continue;
    if (arms[a] === 1) hline(vmax ? cx + sgn * vmax : cx - sgn * (T / 2), edge, cy);
    else {
      const up = arms.U ? cx + sgn * off('U') : arms.D ? cx - sgn * off('D') : cx;
      const dn = arms.D ? cx + sgn * off('D') : arms.U ? cx - sgn * off('U') : cx;
      hline(up, edge, cy - D);
      hline(dn, edge, cy + D);
    }
  }
  for (const [a, edge, sgn] of [['D', y + CH, 1], ['U', y, -1]] as const) {
    if (!arms[a]) continue;
    if (arms[a] === 1) vline(hmax ? cy + sgn * hmax : cy - sgn * (T / 2), edge, cx);
    else {
      const lf = arms.L ? cy + sgn * off('L') : arms.R ? cy - sgn * off('R') : cy;
      const rt = arms.R ? cy + sgn * off('R') : arms.L ? cy - sgn * off('L') : cy;
      vline(lf, edge, cx - D);
      vline(rt, edge, cx + D);
    }
  }
}

function drawShade(g: CanvasRenderingContext2D, x: number, y: number, level: number) {
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 9; i++) {
      const on = level === 1 ? (j % 4 === 0 ? i % 2 === 0 : j % 2 === 0 && i % 2 === 1)
        : level === 2 ? (i + j) % 2 === 0 : !(i % 2 === 0 && j % 2 === 0);
      if (on) g.fillRect(x + i * S, y + j * S, S, S);
    }
  }
}

export interface ScreenState {
  vram: Uint8Array;
  cursor: [number, number];
  cursorVisible: boolean;
  blink: boolean;                          // attribute bit 7 = blink (false: bright background)
}

export class Screen {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private prev = new Uint8Array(4000);
  private prevPhase = -1;
  private prevCursor = -1;
  private font = '';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = 80 * CW;
    canvas.height = 25 * CH;
    this.g = canvas.getContext('2d', { alpha: false })!;
    this.font = `bold ${Math.round(CH * 0.86)}px "DejaVu Sans Mono", "Cascadia Mono", Consolas, Menlo, "Liberation Mono", monospace`;
    this.prev.fill(0xFF);
  }

  /** Redraw what changed. `phase` toggles text blink (~1.9 Hz) and the cursor. */
  draw(st: ScreenState, phase: number, force = false) {
    const g = this.g, v = st.vram;
    const blinkChanged = phase !== this.prevPhase;
    const cur = st.cursorVisible ? st.cursor[0] * 80 + st.cursor[1] : -1;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = this.font;
    for (let i = 0; i < 2000; i++) {
      const code = v[i * 2], attr = v[i * 2 + 1];
      const blinking = st.blink && attr & 0x80;
      const dirty = force || code !== this.prev[i * 2] || attr !== this.prev[i * 2 + 1] ||
        (blinkChanged && blinking) || i === cur || i === this.prevCursor;
      if (!dirty) continue;
      const x = (i % 80) * CW, y = Math.floor(i / 80) * CH;
      const bg = CGA[st.blink ? (attr >> 4) & 7 : attr >> 4];
      const fg = CGA[attr & 15];
      g.fillStyle = bg;
      g.fillRect(x, y, CW, CH);
      if (!(blinking && phase)) this.glyph(x, y, CP437[code], fg);
      if (i === cur && phase === 0) {
        g.fillStyle = fg;
        g.fillRect(x, y + CH - 3 * S, CW, 2 * S);
      }
    }
    this.prev.set(v.subarray(0, 4000));
    this.prevPhase = phase;
    this.prevCursor = cur;
  }

  private glyph(x: number, y: number, ch: string, fg: string) {
    const g = this.g;
    g.fillStyle = fg;
    switch (ch) {
      case ' ': case ' ': return;
      case '█': g.fillRect(x, y, CW, CH); return;
      case '▀': g.fillRect(x, y, CW, CH / 2); return;
      case '▄': g.fillRect(x, y + CH / 2, CW, CH / 2); return;
      case '▌': g.fillRect(x, y, CW / 2, CH); return;
      case '▐': g.fillRect(x + CW / 2, y, CW / 2, CH); return;
      case '░': drawShade(g, x, y, 1); return;
      case '▒': drawShade(g, x, y, 2); return;
      case '▓': drawShade(g, x, y, 3); return;
    }
    const arms = ARMS[ch];
    if (arms) { drawBox(g, x, y, arms); return; }
    g.fillText(ch, x + CW / 2, y + CH / 2 + S, CW + S);
  }
}
