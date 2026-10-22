// Terminal front-end helpers (pure, no Node APIs): ANSI truecolor renderer for the cell buffer and a
// parser turning terminal input sequences into keys (same table idea as mcom-tui/mcomtui/terminal.py).
import { CGA_RGB } from './core/cp437';
import type { Key } from './core/keys';
import { cells, COLS, ROWS, type Screen } from './core/screen';

const WIDE = /\p{Extended_Pictographic}|[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

export class AnsiRenderer {
  private prev: string[] = [];
  private prevCursor = '';

  /** Forget what is on the terminal (after a resize or resume). */
  invalidate() { this.prev = []; this.prevCursor = ''; }

  /** Escape sequences that bring the terminal up to date with the screen ('' if nothing changed). */
  frame(s: Screen): string {
    const out: string[] = [];
    let last = -1;
    for (let r = 0; r < ROWS; r++) {
      let sig = '';
      for (let c = 0; c < COLS; c++) sig += s.ch[r * COLS + c] + String.fromCharCode(s.at[r * COLS + c] + 0x100);
      if (this.prev[r] === sig) continue;
      this.prev[r] = sig;
      out.push(`\x1b[${r + 1};1H`);
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const a = s.at[i];
        if (a !== last) {
          const fg = CGA_RGB[a & 0x0f];
          const bg = CGA_RGB[(a >> 4) & 0x0f];
          out.push(`\x1b[0;38;2;${fg[0]};${fg[1]};${fg[2]};48;2;${bg[0]};${bg[1]};${bg[2]}m`);
          last = a;
        }
        let ch = s.ch[i];
        if (ch === ' ') ch = ' ';
        if (ch.length > 1 || WIDE.test(ch)) {
          out.push(ch);
          if (c + 1 < COLS && s.ch[i + 1] === ' ' && s.at[i + 1] === a) c++;   // the glyph covers the blank
          out.push(`\x1b[${r + 1};${c + 2}H`);
          continue;
        }
        out.push(ch);
      }
    }
    const cur = s.cursor;
    const cs = `${cur.visible}:${cur.row}:${cur.col}:${cur.insert}`;
    if (out.length || cs !== this.prevCursor) {
      this.prevCursor = cs;
      if (cur.visible) out.push(`\x1b[${cur.insert ? 1 : 3} q\x1b[${cur.row + 1};${cur.col + 1}H\x1b[?25h`);
      else out.push('\x1b[?25l');
    }
    return out.length ? out.join('') : '';
  }
}

export const QUIT = '{QUIT}';

const SEQ: Record<string, Key> = {
  OP: '{F1}', OQ: '{F2}', OR: '{F3}', OS: '{F4}',
  '[11~': '{F1}', '[12~': '{F2}', '[13~': '{F3}', '[14~': '{F4}', '[15~': '{F5}', '[17~': '{F6}',
  '[18~': '{F7}', '[19~': '{F8}', '[20~': '{F9}', '[21~': '{F10}',
  '[[A': '{F1}', '[[B': '{F2}', '[[C': '{F3}', '[[D': '{F4}', '[[E': '{F5}',
  '[A': '{UP}', '[B': '{DOWN}', '[C': '{RIGHT}', '[D': '{LEFT}',
  OA: '{UP}', OB: '{DOWN}', OC: '{RIGHT}', OD: '{LEFT}',
  '[H': '{HOME}', '[F': '{END}', OH: '{HOME}', OF: '{END}', '[1~': '{HOME}', '[4~': '{END}', '[7~': '{HOME}', '[8~': '{END}',
  '[5~': '{PGUP}', '[6~': '{PGDN}', '[2~': '{INS}', '[3~': '{DEL}', '[Z': '{STAB}',
  '[1;5C': '{CRIGHT}', '[1;5D': '{CLEFT}', '[1;5H': '{CHOME}', '[1;5F': '{CEND}',
  '[1;2P': '{SF1}', '[1;2Q': '{SF2}', '[1;2R': '{SF3}', '[1;2S': '{SF4}', '[15;2~': '{SF5}', '[17;2~': '{SF6}',
  '[18;2~': '{SF7}', '[19;2~': '{SF8}', '[20;2~': '{SF9}', '[21;2~': '{SF10}',
  '[25~': '{SF3}', '[26~': '{SF4}', '[28~': '{SF5}', '[29~': '{SF6}', '[31~': '{SF7}', '[32~': '{SF8}', '[33~': '{SF9}', '[34~': '{SF10}',
  '[13;5u': '{CENTER}', '[27;5;13~': '{CENTER}',
};

/** Alt+1..Alt+0 = F1..F10 (terminals that grab function keys). */
const ALT_DIGIT: Record<string, Key> = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [String((i + 1) % 10), `{F${i + 1}}`]));

export function parseInput(s: string): Key[] {
  const out: Key[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\x1b') {
      if (i + 1 >= s.length) { out.push('{ESC}'); i++; continue; }
      const n = s[i + 1];
      if (n === '[' || n === 'O') {
        let j = i + 2;
        if (n === '[' && s[j] === '[') j++;                  // linux console "[[A"
        while (j < s.length && !/[A-Za-z~]/.test(s[j])) j++;
        const seq = s.slice(i + 1, j + 1);
        const k = SEQ[seq];
        if (k) out.push(k);
        i = j + 1;
        continue;
      }
      if (n === '\x1b') { out.push('{ESC}'); i++; continue; }
      if (/[a-zA-Z]/.test(n)) { out.push(`{ALT-${n.toUpperCase()}}`); i += 2; continue; }
      if (ALT_DIGIT[n]) { out.push(ALT_DIGIT[n]); i += 2; continue; }
      out.push('{ESC}');
      i++;
      continue;
    }
    const o = c.charCodeAt(0);
    if (c === '\x1d') { out.push(QUIT); i++; continue; }
    if (c === '\r') { out.push('{ENTER}'); i++; continue; }
    if (c === '\n') { out.push('{CENTER}'); i++; continue; }
    if (c === '\t') { out.push('{TAB}'); i++; continue; }
    if (o === 0x7f || o === 0x08) { out.push('{BKSP}'); i++; continue; }
    if (o < 0x20) { out.push(`{CTRL-${String.fromCharCode(o + 0x40)}}`); i++; continue; }
    // printable run: split into graphemes
    let j = i;
    while (j < s.length && s.charCodeAt(j) >= 0x20 && s[j] !== '\x1b' && s.charCodeAt(j) !== 0x7f) j++;
    out.push(...cells(s.slice(i, j)));
    i = j;
  }
  return out;
}

/** True if the input ends in the middle of an escape sequence (wait a moment for the rest). */
export function incomplete(s: string): boolean {
  return /\x1b(\[[\d;[]*|O)?$/.test(s);
}
