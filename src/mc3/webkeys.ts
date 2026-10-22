// Browser keyboard events -> MCOM keys (PC/AT layout semantics).
import type { Key } from './core/keys';

const NAMED: Record<string, string> = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Home: 'HOME', End: 'END',
  PageUp: 'PGUP', PageDown: 'PGDN', Insert: 'INS', Delete: 'DEL', Backspace: 'BKSP', Escape: 'ESC',
};

/** Map a browser key event to an MCOM key (null = let the browser have it). */
export function keyOf(e: KeyboardEvent): Key | null {
  const k = e.key;
  const f = /^F(\d+)$/.exec(k);
  if (f) {
    const n = Number(f[1]);
    if (n > 10) return null;
    return e.shiftKey ? `{SF${n}}` : `{F${n}}`;
  }
  if (e.altKey && !e.ctrlKey) {
    if (/^Digit\d$/.test(e.code)) {
      const d = Number(e.code.slice(5));
      return `{F${d === 0 ? 10 : d}}`;
    }
    if (/^Key[A-Z]$/.test(e.code)) return `{ALT-${e.code.slice(3)}}`;
    return null;
  }
  if (k === 'Enter') return e.ctrlKey ? '{CENTER}' : '{ENTER}';
  if (k === 'Tab') return e.shiftKey ? '{STAB}' : '{TAB}';
  if (e.ctrlKey && k === 'ArrowLeft') return '{CLEFT}';
  if (e.ctrlKey && k === 'ArrowRight') return '{CRIGHT}';
  if (NAMED[k]) return `{${NAMED[k]}}`;
  if (e.ctrlKey || e.metaKey) {
    if (e.ctrlKey && /^[uyrt]$/i.test(k)) return `{CTRL-${k.toUpperCase()}}`;
    return null;
  }
  if ([...k].length === 1 || /\p{Extended_Pictographic}/u.test(k)) return k;
  return null;
}
