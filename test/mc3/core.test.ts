import { describe, expect, it } from 'vitest';
import { incomplete, parseInput, AnsiRenderer } from '../../src/mc3/ansi';
import { arms, glyph, merge } from '../../src/mc3/core/boxes';
import { CP437, decodeCp437, encodeCp437, toCp437, typedCp437 } from '../../src/mc3/core/cp437';
import { parseKeys } from '../../src/mc3/core/keys';
import { Runtime } from '../../src/mc3/core/runtime';
import { cells, fit, Screen } from '../../src/mc3/core/screen';
import { editField, form, pickList, wopen } from '../../src/mc3/core/tcxl';
import { keyOf } from '../../src/mc3/webkeys';

describe('CP437', () => {
  it('maps the box, block and logo bytes', () => {
    expect(CP437[0xdb]).toBe('█');
    expect(CP437[0xdf]).toBe('▀');
    expect(CP437[0xdc]).toBe('▄');
    expect(CP437[0xc9]).toBe('╔');
    expect(CP437[0xb3]).toBe('│');
    expect(CP437[0x04]).toBe('♦');
    expect(CP437[0x41]).toBe('A');
  });
  it('round-trips all 256 bytes except the two blanks', () => {
    for (let i = 1; i < 255; i++) expect(toCp437(CP437[i])).toBe(i);
    expect(decodeCp437(encodeCp437('╒╦══╤ ░▒▓ Ç'))).toBe('╒╦══╤ ░▒▓ Ç');
    expect([...encodeCp437('€')]).toEqual([0x3f]);
  });
  it('maps typed characters the way the emulator keyboard sends them', () => {
    for (let i = 32; i < 255; i++) expect(typedCp437(CP437[i])).toBe(i);
    expect(typedCp437('\u00a0')).toBe(0xff);
    expect(typedCp437('☺')).toBeUndefined();
    expect(typedCp437('€')).toBeUndefined();
  });
});

describe('Screen', () => {
  it('prints, clips and restores', () => {
    const s = new Screen();
    s.put(0, 78, 0x1f, 'ABCD');
    expect(s.rowText(0).slice(76)).toBe('  AB');
    expect(s.attrAt(0, 79)).toBe(0x1f);
    const saved = s.save(0, 70, 1, 79);
    s.fill(0, 0, 1, 79, 0x70, 'x');
    s.restore(saved);
    expect(s.rowText(0).slice(78)).toBe('AB');
    expect(s.charAt(0, 0)).toBe('x');
  });
  it('treats an emoji with modifiers as one cell', () => {
    expect(cells('a🎛️b')).toEqual(['a', '🎛️', 'b']);
    expect(fit('🎬 Ava', 4)).toBe('🎬 Av');
    const s = new Screen();
    s.put(1, 0, 7, '🎤X');
    expect(s.charAt(1, 0)).toBe('🎤');
    expect(s.charAt(1, 1)).toBe('X');
  });
});

describe('box lines', () => {
  it('joins lines into junction glyphs', () => {
    expect(merge('│', [0, 0, 1, 1])).toBe('┼');
    expect(merge('─', [1, 1, 0, 0])).toBe('┼');
    expect(merge('║', [0, 0, 1, 1])).toBe('╫');
    expect(merge('┌', [0, 0, 1, 0])).toBe('┬');
    expect(glyph([0, 2, 0, 2])).toBe('╔');
    expect(arms('╪')).toEqual([1, 1, 2, 2]);
  });
  it('wvline/whline join the window border like TCXL', () => {
    const rt = new Runtime();
    const w = wopen(rt, 3, 2, 8, 20, 0, 0x30, 0x30, false);
    w.hline(2, 0, w.width, 0, 0x30);
    w.vline(0, 5, w.height, 0, 0x30);
    const s = rt.screen;
    expect(s.charAt(3, 8)).toBe('┬');
    expect(s.charAt(6, 2)).toBe('├');
    expect(s.charAt(6, 20)).toBe('┤');
    expect(s.charAt(6, 8)).toBe('┼');
    expect(s.charAt(8, 8)).toBe('┴');
  });
  it('windows get a TCXL shadow (attribute 0x08, characters kept)', () => {
    const rt = new Runtime();
    rt.screen.put(5, 11, 0x70, 'Q');
    const w = wopen(rt, 2, 2, 4, 10, 0, 0x17, 0x17);
    expect(rt.screen.attrAt(3, 11)).toBe(0x08);
    expect(rt.screen.attrAt(5, 11)).toBe(0x08);
    expect(rt.screen.charAt(5, 11)).toBe('Q');
    w.close();
    expect(rt.screen.attrAt(5, 11)).toBe(0x70);
  });
});

const run = async <T>(rt: Runtime, p: Promise<T>, script: string): Promise<T> => {
  for (const k of parseKeys(script)) rt.push(k);
  return p;
};

describe('input fields (winpdef)', () => {
  it('first printable key clears the field; upper case; ENTER accepts', async () => {
    const rt = new Runtime();
    const r = await run(rt, editField(rt, { row: 5, col: 10, width: 4, value: 'DIR', upper: true }, 0x1f), 'ab{ENTER}');
    expect(r).toEqual({ value: 'AB', key: '{ENTER}' });
    expect(rt.screen.rowText(5).slice(10, 14)).toBe('AB  ');
  });
  it('an editing key first keeps the text; ESC restores', async () => {
    const rt = new Runtime();
    expect(await run(rt, editField(rt, { row: 0, col: 0, width: 6, value: 'Mic 1' }, 0x1f), '{BKSP}2{ENTER}')).toEqual({ value: 'Mic 2', key: '{ENTER}' });
    expect(await run(rt, editField(rt, { row: 0, col: 0, width: 6, value: 'Mic 1' }, 0x1f), 'zz{ESC}')).toEqual({ value: 'Mic 1', key: '{ESC}' });
  });
  it('exit keys accept; validation refuses to leave', async () => {
    const rt = new Runtime();
    const f = { row: 0, col: 0, width: 4, value: '', upper: true, validate: (v: string) => v === 'CAM1' || v === '' };
    const r = await run(rt, editField(rt, f, 0x1f, k => k === '{TAB}'), 'xx{TAB}{CTRL-U}cam1{TAB}');
    expect(r).toEqual({ value: 'CAM1', key: '{TAB}' });
  });
  it('typing past the end beeps', async () => {
    let beeps = 0;
    const rt = new Runtime({ beep: () => { beeps++; } });
    expect((await run(rt, editField(rt, { row: 0, col: 0, width: 2, value: '' }, 0x1f), 'abc{ENTER}')).value).toBe('ab');
    expect(beeps).toBe(1);
  });
  it('forms move with ENTER/TAB/UP and accept with F10', async () => {
    const rt = new Runtime();
    const fields = [0, 1, 2].map(i => ({ row: i, col: 0, width: 5, value: `v${i}` }));
    const r = await run(rt, form(rt, fields, 0x20, 0x2f), 'a{ENTER}b{UP}c{F10}');
    expect(r.values).toEqual(['c', 'b', 'v2']);
    expect(r.key).toBe('{F10}');
  });
});

describe('pick list (wpickstr)', () => {
  it('lays out columns and moves by rows and letters', async () => {
    const rt = new Runtime();
    const items = ['048', '096', '144', '192', '240'];
    expect(await run(rt, pickList(rt, 14, 51, 20, 56, 0, 0x1f, 0x17, 0x2f, items, 0), '{DOWN}{DOWN}{ENTER}')).toBe(2);
    expect(await run(rt, pickList(rt, 3, 10, 12, 70, 0, 0x1f, 0x17, 0x2f, ['Alpha', 'Bravo', 'Charlie', 'Delta'], 0), 'd{ENTER}')).toBe(3);
    expect(await run(rt, pickList(rt, 3, 10, 12, 70, 0, 0x1f, 0x17, 0x2f, ['A', 'B'], 1), '{ESC}')).toBe(-1);
  });
});

describe('terminal front end', () => {
  it('parses function keys, arrows, Alt and Ctrl', () => {
    expect(parseInput('\x1bOP\x1b[21~\x1b[17;2~\x1b[18;2~\x1b[A\x1b[6~\x1b[Z')).toEqual(
      ['{F1}', '{F10}', '{SF6}', '{SF7}', '{UP}', '{PGDN}', '{STAB}']);
    expect(parseInput('\x1b1\x1b0\x1bp\x1d')).toEqual(['{F1}', '{F10}', '{ALT-P}', '{QUIT}']);
    expect(parseInput('ab\r\t\x7f\x15🎤')).toEqual(['a', 'b', '{ENTER}', '{TAB}', '{BKSP}', '{CTRL-U}', '🎤']);
    expect(parseInput('\x1b')).toEqual(['{ESC}']);
    expect(incomplete('\x1b[1')).toBe(true);
    expect(incomplete('x')).toBe(false);
  });
  it('renders truecolor rows and only redraws changes', () => {
    const s = new Screen();
    s.put(0, 0, 0x1f, 'Hi');
    const r = new AnsiRenderer();
    const first = r.frame(s);
    expect(first).toContain('\x1b[1;1H');
    expect(first).toContain('38;2;255;255;255;48;2;0;0;170m');
    expect(r.frame(s)).toBe('');
    s.put(3, 0, 0x07, 'x');
    const next = r.frame(s);
    expect(next).toContain('\x1b[4;1H');
    expect(next).not.toContain('\x1b[1;1H');
  });
});

describe('browser keys', () => {
  const ev = (o: Partial<KeyboardEvent>) => ({ key: '', code: '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...o }) as KeyboardEvent;
  it('maps PC keys, Alt+digit F-keys and Ctrl-Enter', () => {
    expect(keyOf(ev({ key: 'F7', shiftKey: true }))).toBe('{SF7}');
    expect(keyOf(ev({ key: '1', code: 'Digit1', altKey: true }))).toBe('{F1}');
    expect(keyOf(ev({ key: '0', code: 'Digit0', altKey: true }))).toBe('{F10}');
    expect(keyOf(ev({ key: 'p', code: 'KeyP', altKey: true }))).toBe('{ALT-P}');
    expect(keyOf(ev({ key: 'Enter', ctrlKey: true }))).toBe('{CENTER}');
    expect(keyOf(ev({ key: 'Tab', shiftKey: true }))).toBe('{STAB}');
    expect(keyOf(ev({ key: 'q' }))).toBe('q');
    expect(keyOf(ev({ key: 'c', ctrlKey: true }))).toBe(null);
  });
});
