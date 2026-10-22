// IBM PC code page 437 (the VGA text-mode character set) <-> Unicode, and the CGA 16-colour palette.

const LOW = ' ☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼';
const HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/** CP437 byte -> Unicode character (0x00 and 0xFF map to a no-break space, as on screen). */
export const CP437: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i < 32 ? LOW[i] : i < 127 ? String.fromCharCode(i) : i === 127 ? '⌂' : HIGH[i - 128]);

const REVERSE = new Map<string, number>();
for (let i = 255; i >= 0; i--) REVERSE.set(CP437[i], i);
REVERSE.set(' ', 32);

/** Unicode character -> CP437 byte, or -1 if the character has no CP437 glyph. */
export function toCp437(ch: string): number {
  return REVERSE.get(ch) ?? -1;
}

/** Decode a CP437 byte string (e.g. copied from MCOM.EXE) to Unicode. */
export function decodeCp437(bytes: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += CP437[bytes[i] & 0xff];
  return s;
}

/** Encode Unicode to CP437 bytes; characters outside the code page become '?'. */
export function encodeCp437(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const b = toCp437(ch);
    out.push(b < 0 ? 0x3f : b);
  }
  return Uint8Array.from(out);
}

/** CGA / VGA text-mode palette, index = attribute nibble. */
export const CGA: readonly string[] = [
  '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
  '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
];

export const CGA_RGB: readonly [number, number, number][] = CGA.map(h =>
  [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);

/** Foreground / background palette index of a text attribute (bit 7 = bright background, no blink). */
export const fgOf = (attr: number) => attr & 0x0f;
export const bgOf = (attr: number) => (attr >> 4) & 0x0f;
