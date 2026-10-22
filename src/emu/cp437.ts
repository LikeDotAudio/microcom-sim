// Code page 437 as Unicode (0x00 shown as a no-break space, 0x01-0x1F and 0x7F as their glyphs,
// as mcomtui/terminal.py draws them).
const LOW = ' ☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼';
const HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export const CP437: string[] = Array.from({ length: 256 }, (_, i) =>
  i < 32 ? LOW[i] : i === 127 ? '⌂' : i < 128 ? String.fromCharCode(i) : HIGH[i - 128]);

/** Unicode -> CP437 byte for typed characters (undefined when it has none). */
export const FROM_UNICODE = new Map<string, number>(CP437.map((ch, i) => [ch, i] as [string, number]).filter(([, i]) => i >= 32));
