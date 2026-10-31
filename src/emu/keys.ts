// BIOS key codes: key-script tokens (as mcomtui's --keys) and browser KeyboardEvent mapping.
import { typedCp437 } from '../mc3/core/cp437';

export const KEY_TOKENS: Record<string, number> = {
  F1: 0x3B00, F2: 0x3C00, F3: 0x3D00, F4: 0x3E00, F5: 0x3F00, F6: 0x4000,
  F7: 0x4100, F8: 0x4200, F9: 0x4300, F10: 0x4400, SF6: 0x5900, SF7: 0x5A00,
  ENTER: 0x1C0D, ESC: 0x011B, TAB: 0x0F09, STAB: 0x0F00, BKSP: 0x0E08,
  UP: 0x4800, DOWN: 0x5000, LEFT: 0x4B00, RIGHT: 0x4D00, HOME: 0x4700, END: 0x4F00,
  PGUP: 0x4900, PGDN: 0x5100, INS: 0x5200, DEL: 0x5300, SPACE: 0x3920,
};

// BIOS scan codes for printable ASCII (US layout)
export const SCAN: Record<string, number> = { ' ': 0x39 };
const ROWS: [number, string][] = [[0x02, '1234567890-='], [0x10, 'qwertyuiop[]'], [0x1E, "asdfghjkl;'`"], [0x2B, '\\zxcvbnm,./']];
for (const [start, chars] of ROWS) [...chars].forEach((c, i) => { SCAN[c] = start + i; });
const SHIFTED: Record<string, string> = {
  '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  _: '-', '+': '=', '{': '[', '}': ']', ':': ';', '"': "'", '~': '`', '|': '\\', '<': ',', '>': '.', '?': '/',
};

export type KeyItem = number | ['wait', number];

/** '{F10}{WAIT 0.5}abc{ENTER}' -> key codes and ['wait', secs] items (same rules as mcomtui). */
export function parseKeys(script: string): KeyItem[] {
  const out: KeyItem[] = [];
  for (const tok of script.match(/\{[^}]+\}|[\s\S]/g) ?? []) {
    if (tok.startsWith('{')) {
      const name = tok.slice(1, -1).trim().toUpperCase();
      if (name.startsWith('WAIT')) out.push(['wait', Number(name.slice(4)) || 1]);
      else if (name in KEY_TOKENS) out.push(KEY_TOKENS[name]);
      else throw new Error(`unknown key token ${tok}`);
    } else out.push(((SCAN[tok.toLowerCase()] ?? 0) << 8) | tok.charCodeAt(0));
  }
  return out;
}

const LSHIFT = 0x02, CTRL = 0x04, ALT = 0x08;

const NAMED: Record<string, number> = {
  Enter: 0x1C0D, Escape: 0x011B, Backspace: 0x0E08, Tab: 0x0F09,
  ArrowUp: 0x4800, ArrowDown: 0x5000, ArrowLeft: 0x4B00, ArrowRight: 0x4D00,
  Home: 0x4700, End: 0x4F00, PageUp: 0x4900, PageDown: 0x5100, Insert: 0x5200, Delete: 0x5300,
};

/** A browser key event -> [BIOS code, BDA shift flags], or null if it is not for the PC. */
export function browserKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): [number, number] | null {
  const flags = (e.shiftKey ? LSHIFT : 0) | (e.ctrlKey ? CTRL : 0) | (e.altKey ? ALT : 0);
  if (e.metaKey) return null;
  const f = /^F(\d+)$/.exec(e.key);
  if (f) {
    const n = Number(f[1]);
    if (n < 1 || n > 10) return null;
    const base = e.shiftKey ? 0x5400 : e.ctrlKey ? 0x5E00 : e.altKey ? 0x6800 : 0x3B00;
    return [base + (n - 1) * 0x100, flags];
  }
  if (e.key === 'Tab' && e.shiftKey) return [0x0F00, flags];
  if (e.key in NAMED) return [NAMED[e.key], flags];
  // Alt+1..Alt+0 act as F1..F10 (for browsers and systems that keep the F keys)
  if (e.altKey && !e.ctrlKey && /^Digit\d$/.test(e.code)) {
    const d = Number(e.code[5]);
    return [0x3B00 + ((d + 9) % 10) * 0x100, 0];
  }
  if (e.key.length !== 1) return null;
  const ch = e.key;
  const base = SHIFTED[ch] ?? ch.toLowerCase();
  const scan = SCAN[base] ?? 0;
  if (e.altKey && /[a-z]/i.test(ch)) return [scan << 8, flags];
  if (e.ctrlKey && /[a-z]/i.test(ch)) return [(scan << 8) | (ch.toLowerCase().charCodeAt(0) - 96), flags];
  const code = ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : typedCp437(ch);
  if (code === undefined) return null;
  return [(scan << 8) | code, flags];
}
