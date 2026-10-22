// Abstract key events shared by both front ends. A key is either one printable character (a grapheme,
// e.g. "a", "{", "🎤") or a named key in braces, the same tokens as mcom-tui's headless --keys option:
// {F1}..{F10} {SF1}..{SF10} {ENTER} {ESC} {TAB} {STAB} {UP} {DOWN} {LEFT} {RIGHT} {HOME} {END}
// {PGUP} {PGDN} {INS} {DEL} {BKSP} {CENTER} (Ctrl-Enter) {CLEFT} {CRIGHT} {ALT-x} {CTRL-x}.

export type Key = string;

export const K = {
  F1: '{F1}', F2: '{F2}', F3: '{F3}', F4: '{F4}', F5: '{F5}', F6: '{F6}', F7: '{F7}', F8: '{F8}',
  F9: '{F9}', F10: '{F10}', SF6: '{SF6}', SF7: '{SF7}',
  ENTER: '{ENTER}', ESC: '{ESC}', TAB: '{TAB}', STAB: '{STAB}', UP: '{UP}', DOWN: '{DOWN}',
  LEFT: '{LEFT}', RIGHT: '{RIGHT}', HOME: '{HOME}', END: '{END}', PGUP: '{PGUP}', PGDN: '{PGDN}',
  INS: '{INS}', DEL: '{DEL}', BKSP: '{BKSP}', CENTER: '{CENTER}', CLEFT: '{CLEFT}', CRIGHT: '{CRIGHT}',
  ALT_P: '{ALT-P}', ALT_V: '{ALT-V}',
} as const;

/** True for a printable character key (not a named key). */
export function isChar(k: Key): boolean {
  return !(k.length > 2 && k[0] === '{' && k[k.length - 1] === '}');
}

/** Function key number 1..10 of {F1}..{F10}, else 0. */
export function fnum(k: Key): number {
  const m = /^\{F(\d+)\}$/.exec(k);
  return m ? Number(m[1]) : 0;
}

/** Split a key script like "abc{ENTER}{WAIT 0.5}x" into keys; {WAIT s} becomes "{WAIT s}". */
export function parseKeys(script: string): Key[] {
  const out: Key[] = [];
  const re = /\{[A-Z0-9-]+(?: [0-9.]+)?\}|\{SPACE\}|[\s\S]/gu;
  for (const m of script.matchAll(re)) {
    const t = m[0];
    out.push(t === '{SPACE}' ? ' ' : t);
  }
  return out;
}
