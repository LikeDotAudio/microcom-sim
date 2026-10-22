// TCXL box types and line joining. Box-drawing characters are described by their four arms
// (up, down, left, right) with weight 0 = none, 1 = single, 2 = double; drawing a line over an
// existing one adds arms, which yields the junction glyphs (├ ┼ ╤ ╫ ...) the way TCXL whline/wvline do.

/** TL, T, TR, L, R, BL, B, BR per btype 0..5 (spec 01 §8.1). */
export const BOX: readonly string[] = [
  '┌─┐││└─┘',
  '╔═╗║║╚═╝',
  '╓─╖║║╙─╜',
  '╒═╕││╘═╛',
  '▄▄▄▌▐▀▀▀',
  '        ',
];

type Arms = [number, number, number, number]; // up, down, left, right

const GLYPHS: Record<string, Arms> = {
  '─': [0, 0, 1, 1], '│': [1, 1, 0, 0], '┌': [0, 1, 0, 1], '┐': [0, 1, 1, 0], '└': [1, 0, 0, 1],
  '┘': [1, 0, 1, 0], '├': [1, 1, 0, 1], '┤': [1, 1, 1, 0], '┬': [0, 1, 1, 1], '┴': [1, 0, 1, 1],
  '┼': [1, 1, 1, 1],
  '═': [0, 0, 2, 2], '║': [2, 2, 0, 0], '╔': [0, 2, 0, 2], '╗': [0, 2, 2, 0], '╚': [2, 0, 0, 2],
  '╝': [2, 0, 2, 0], '╠': [2, 2, 0, 2], '╣': [2, 2, 2, 0], '╦': [0, 2, 2, 2], '╩': [2, 0, 2, 2],
  '╬': [2, 2, 2, 2],
  '╒': [0, 1, 0, 2], '╓': [0, 2, 0, 1], '╕': [0, 1, 2, 0], '╖': [0, 2, 1, 0], '╘': [1, 0, 0, 2],
  '╙': [2, 0, 0, 1], '╛': [1, 0, 2, 0], '╜': [2, 0, 1, 0], '╞': [1, 1, 0, 2], '╟': [2, 2, 0, 1],
  '╡': [1, 1, 2, 0], '╢': [2, 2, 1, 0], '╤': [0, 1, 2, 2], '╥': [0, 2, 1, 1], '╧': [1, 0, 2, 2],
  '╨': [2, 0, 1, 1], '╪': [1, 1, 2, 2], '╫': [2, 2, 1, 1],
};

const BY_ARMS = new Map<string, string>();
for (const [g, a] of Object.entries(GLYPHS)) BY_ARMS.set(a.join(''), g);

export function arms(ch: string): Arms | null {
  return GLYPHS[ch] ?? null;
}

/** Glyph for a set of arms; mixed weights on one axis are promoted to the heavier one. */
export function glyph(a: Arms): string {
  const exact = BY_ARMS.get(a.join(''));
  if (exact) return exact;
  const v = Math.max(a[0], a[1]);
  const h = Math.max(a[2], a[3]);
  const b: Arms = [a[0] ? v : 0, a[1] ? v : 0, a[2] ? h : 0, a[3] ? h : 0];
  const g = BY_ARMS.get(b.join(''));
  if (g) return g;
  // lone arm (dangling line end): draw the straight line
  if (!b[2] && !b[3]) return v === 2 ? '║' : '│';
  if (!b[0] && !b[1]) return h === 2 ? '═' : '─';
  return '┼';
}

/** Merge arms into an existing character (a non-line character is replaced). */
export function merge(existing: string, add: Arms): string {
  const e = arms(existing) ?? [0, 0, 0, 0];
  return glyph([Math.max(e[0], add[0]), Math.max(e[1], add[1]), Math.max(e[2], add[2]), Math.max(e[3], add[3])]);
}

/** Line weight of a box type: 1 single, 2 double (btypes 0..3; horizontal / vertical). */
export function lineWeight(btype: number): { h: number; v: number } {
  switch (btype) {
    case 1: return { h: 2, v: 2 };
    case 2: return { h: 1, v: 2 };
    case 3: return { h: 2, v: 1 };
    default: return { h: 1, v: 1 };
  }
}
