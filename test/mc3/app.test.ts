import { describe, expect, it } from 'vitest';
import { copyIncrement } from '../../src/mc3/core/screens/indexTable';
import { screen, settle, startApp, type } from './harness';

const row = (t: string, r: number) => t.split('\n')[r] ?? '';

describe('MicroCOM III shell', () => {
  it('draws the title screen and status panel (snapshot)', async () => {
    const { app } = await startApp();
    expect(screen(app)).toMatchSnapshot();
    expect(app.rt.screen.attrAt(0, 36)).toBe(0x1f);          // "Terminal Assignments" selected
    expect(app.rt.screen.attrAt(0, 3)).toBe(0x74);           // hot letter D
    expect(app.rt.screen.attrAt(24, 0)).toBe(0x4f);          // message line
  });

  it('navigates the menu bar and pulldowns like TCXL', async () => {
    const { app } = await startApp();
    await type(app, '{DOWN}');
    let t = screen(app);
    expect(row(t, 2)).toContain('│ Select Definition   │');
    expect(app.rt.screen.attrAt(3, 37)).toBe(0x71);           // initial item: Assignment Edit
    await type(app, '{RIGHT}');
    t = screen(app);
    expect(row(t, 2)).toContain('Select Production');
    await type(app, '{ESC}{LEFT}{LEFT}{LEFT}{ENTER}');
    t = screen(app);
    expect(row(t, 2)).toContain('Matrix Index Table');
    expect(app.rt.screen.attrAt(4, 4)).toBe(0x71);            // Overlay Definition preselected (row 4)
    await type(app, '{ESC}{ESC}');
  });

  it('F1 opens help for the item, Alt-V the about box', async () => {
    const { app } = await startApp();
    await type(app, 'd{F1}');
    expect(screen(app)).toContain('Global Key Functions');
    await type(app, '{ESC}m{F1}');
    expect(screen(app)).toContain('Matrix Editing Keys');
    await type(app, '{ESC}{ESC}');
  });

  it('switches production with Alt-P', async () => {
    const { app } = await startApp(29);
    expect(row(screen(app), 22)).toContain('PROD30');
    await type(app, '{ALT-P}');
    expect(screen(app)).toContain('Select Production');
    expect(screen(app)).toContain('PROD01 Hockey Night');
    await type(app, '{HOME}{ENTER}');
    await settle(app);
    expect(row(screen(app), 22)).toContain('PROD01');
    expect(row(screen(app), 22)).toContain('Hockey Night');
    expect(app.ws.current).toBe(0);
  });
});

describe('Matrix Index Table', () => {
  it('edits a mnemonic, saves with F10 and applies via Data Transfer', async () => {
    const { app, eng } = await startApp(29);
    await type(app, 'dm');
    let t = screen(app);
    expect(row(t, 7)).toContain('│001│DIR │    │x│x│ │ │ │PROD30 port 1');
    expect(row(t, 7)).toContain('M7880D/F');
    await type(app, 'tst1{F10}');
    expect(row(screen(app), 23)).toContain('Pending: YES');
    expect(eng.cfg[29].mnemonic['1']).toBe('DIR ');
    await type(app, '{RIGHT}i');                                // Data Transfer ▸ Index & Keypad
    expect(screen(app)).toContain('Press <ENTER> to continue!');
    await type(app, '{ENTER}');
    await settle(app);
    const set = eng.received.find(m => m.t === 'setcfg') as { facility: number; changes: Record<string, unknown> };
    expect(set.facility).toBe(29);
    expect(set.changes).toEqual({ mnemonic: { 1: 'TST1' } });
    expect(eng.cfg[29].mnemonic['1']).toBe('TST1');
    expect(row(screen(app), 23)).toContain('Pending: NONE');
  });

  it('F3 attribute walk, F2 terminal/panel types, ESC discards', async () => {
    const { app } = await startApp(29);
    await type(app, 'dm{DOWN}{F3}');
    expect(row(screen(app), 24)).toContain('Toggle Talk Attribute');
    await type(app, ' {ENTER}{ESC}');
    expect(row(screen(app), 8)).toContain('│002│PRD │    │ │x│');
    await type(app, '{F2}');
    expect(screen(app)).toContain('Select a Terminal Type');
    await type(app, '{END}{ENTER}');                            // M2026P
    expect(row(screen(app), 8)).toContain('M2026P');
    await type(app, '{ESC}');
    await type(app, 'm');
    expect(row(screen(app), 8)).toContain('│002│PRD │    │x│x│');
    expect(app.ws.dirtyProductions()).toEqual([]);
  });

  it('shows IFB/Mic ports as talent positions', async () => {
    const { app } = await startApp(29);
    await type(app, 'dm{PGDN}{PGDN}');
    const t = screen(app);
    expect(t).toContain('│025│IF01│');
    expect(t).toMatch(/│025│IF01│.*Talent/);
  });

  it('F4 copies the previous line with increment (spec 02 §4.1)', () => {
    const rows = [{ mn: '', ovl: '', attr: 0, term: '0', desc: '' },
      { mn: '$019', ovl: 'X   ', attr: 0xc8, term: '1', desc: 'Cam 9'.padEnd(22) },
      { mn: '', ovl: '', attr: 0, term: '0', desc: '' }];
    expect(copyIncrement(rows, 2)).toBe(true);
    expect(rows[2]).toMatchObject({ mn: '$020', ovl: '    ', attr: 0xc8, term: '1', desc: 'Cam 10'.padEnd(22) });
    rows[1].mn = '$099';
    expect(copyIncrement(rows, 2)).toBe(false);
  });
});

describe('Assignment Edit', () => {
  it('shows the panel art of a classic terminal and its matrix keys', async () => {
    const { app } = await startApp(0);
    await type(app, '{DOWN}{ENTER}');
    expect(screen(app)).toContain('Bus#│ Code │Overlay│Terminal');
    await type(app, '{ENTER}');
    const t = screen(app);
    expect(t).toContain('█ CODE ║CAM1│GRP1│TD  │');
    expect(t).toContain('Station: DIR');
    expect(t).toContain('🎬 Ava Adams');
    await type(app, '{PGDN}{PGDN}');
    expect(screen(app)).toContain('█ MTRX ║ X1   X2');
    expect(screen(app)).toMatch(/█ CODE ║P02 │/);
    expect(screen(app)).toMatch(/█ OVLY ║P02 │/);
    await type(app, '{ESC}{ESC}');
  });

  it('assigns a cross-production matrix key with F5 and applies with F9', async () => {
    const { app, eng } = await startApp(0);
    await type(app, '{DOWN}{ENTER}{ENTER}{PGDN}{PGDN}{TAB}');   // X2 of PROD01 DIR
    await type(app, '{F5}');
    expect(screen(app)).toContain('Target Production of Key');
    await type(app, '{HOME}{RIGHT}{RIGHT}{ENTER}');               // PROD03
    expect(row(screen(app), 24)).toContain('Key targets PROD03');
    await type(app, 'cam2{ENTER}');
    expect(screen(app)).toMatch(/█ CODE ║P02 │CAM2│/);
    expect(screen(app)).toMatch(/█ OVLY ║P02 │P03 │/);
    await type(app, '{STAB}{F3}{HOME}{DOWN}{ENTER}');             // X2: Listen only
    await type(app, '{F9}');
    expect(screen(app)).toContain('Press <ENTER> to continue!');
    await type(app, '{ENTER}');
    await settle(app);
    const ek = eng.received.find(m => m.t === 'extkeys') as { gid: number; keys: unknown[] };
    expect(ek.gid).toBe(1);
    expect(ek.keys).toEqual([
      { label: 'P02', targets: [65], talk: true, listen: true },
      { label: 'CAM2', targets: [2 * 64 + 6], talk: false, listen: true },
    ]);
    await type(app, '{ESC}{ESC}');
  });

  it('rejects unknown codes and edits local phantom keys', async () => {
    const { app, eng } = await startApp(29);
    await type(app, '{DOWN}{ENTER}{ENTER}');
    await type(app, 'zzzz{ENTER}');                               // refused: stays on key 1
    expect(screen(app)).toContain('█ CODE ║ZZZZ│GRP1│');
    await type(app, '{CTRL-U}ev02{ENTER}{F10}');
    await type(app, '{ESC}');
    expect(app.ws.get(29)!.cfg.keys['1'][0]).toEqual([2, 0xc6]);
    expect(eng.received.some(m => m.t === 'setcfg')).toBe(false);
  });

  it('shows a 32-key matrix panel (M7832)', async () => {
    const { app } = await startApp(0);
    await type(app, '{DOWN}{ENTER}{DOWN}{ENTER}');
    const t = screen(app);
    expect(t).toContain('Type:    M7832');
    expect(t).toContain('Page 1 of 2');
    expect(t).toContain('█ KEYS ║ 1    2    3');
    await type(app, '{ESC}{ESC}');
  });

  it('talent positions have no keys', async () => {
    const { app } = await startApp(29);
    await type(app, '{DOWN}{ENTER}{END}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{UP}{ENTER}');
    const t = screen(app);
    expect(t).toContain('Talent Position IF08');
    expect(t).toContain('listen-only');
    await type(app, 'x{ESC}');
  });
});

describe('People & Places', () => {
  it('edits a person and saves straight to the matrix', async () => {
    const { app, eng } = await startApp(0);
    await type(app, '{RIGHT}{DOWN}l');
    let t = screen(app);
    expect(t).toContain(' People & Places - PROD01 Hockey Night ');
    expect(t).toMatch(/│001│DIR │🎬 │Ava Adams/);
    await type(app, '{ENTER}');
    expect(screen(app)).toContain('Editing Person & Place!');
    await type(app, 'Bob Brown{TAB}{TAB}{TAB}Halifax{F10}');
    await settle(app);
    const m = eng.received.find(x => x.t === 'meta') as { gid: number; meta: Record<string, unknown> };
    expect(m.gid).toBe(1);
    expect(m.meta).toMatchObject({ name: 'Bob Brown', role: 'Director', emoji: '🎬' });
    expect(m.meta.location).toMatchObject({ site: 'Halifax', room: 'Control Room 1', row: 1, seat: 1 });
    t = screen(app);
    expect(t).toMatch(/│001│DIR │🎬 │Bob Brown/);
    await type(app, '{ESC}');
  });
});

describe('Printing', () => {
  it('Shift-F7 prints the Matrix Index Table to a text file', async () => {
    const { app, printed } = await startApp(29);
    await type(app, 'dm{SF7}{ENTER}');
    await settle(app);
    expect(printed).toHaveLength(1);
    const [name, text] = printed[0];
    expect(name).toBe('PROD30-index.txt');
    expect(text).toContain('WBS MicroCOM III Communications System');
    expect(text).toContain('        001   DIR           x x         PROD30 port 1            M7880D/F');
    await type(app, '{ESC}{ESC}');
  });
});

describe('Terminal Group Edit / Transfer', () => {
  it('edits a group member and applies it with Transfer Group', async () => {
    const { app, eng } = await startApp(29);
    await type(app, '{DOWN}{DOWN}{ENTER}{ENTER}');                // Terminal Group Edit, bus 1
    let t = screen(app);
    expect(t).toContain('█ GRP1│ CODES   ║CAM1│CAM2│CAM3│....│');
    await type(app, '{TAB}{TAB}{TAB}td{ENTER}{F10}{ESC}');
    expect(app.ws.get(29)!.cfg.groups['1'].slice(0, 6)).toEqual([5, 6, 7, 3, 0, 0]);
    await type(app, '{DOWN}{DOWN}{ENTER}{ENTER}');                 // Transfer Group, bus 1
    t = screen(app);
    expect(t).toContain('Press <ENTER> to continue!');
    await type(app, '{ENTER}');
    await settle(app);
    const set = eng.received.find(m => m.t === 'setcfg') as { changes: Record<string, unknown> };
    expect(set.changes).toEqual({ groups: { 1: [5, 6, 7, 3, 0, 0, ...new Array(18).fill(0)] } });
  });
});

describe('Keypad Prefix Codes and Overlay Definition', () => {
  it('edits a keypad code in the working copy', async () => {
    const { app } = await startApp(29);
    await type(app, 'dk');
    expect(screen(app)).toContain('║ $0.. ║ $1.. ║ $2.. ║ SAVE ║');
    await type(app, '{ENTER}KEY1{F10}{F10}');
    expect(app.ws.get(29)!.cfg.keypad[0]).toBe('KEY1');
  });
  it('edits phantom overlay codes (Group)', async () => {
    const { app } = await startApp(29);
    await type(app, 'dog');
    expect(screen(app)).toContain('│Code│Overlay│');
    await type(app, 'ALL1{F10}{ESC}{ESC}');
    expect(app.ws.get(29)!.cfg.phantom[0]).toBe('ALL1');
    expect(app.ws.get(29)!.changed()).toEqual(['phantom']);
  });
});
