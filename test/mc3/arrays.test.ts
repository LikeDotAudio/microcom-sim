// Spec-03 array editors: IFB/PGM Sound, Camera Array, Call Array, Relay Control, Electronic Pegboard.
import { describe, expect, it } from 'vitest';
import { applyType, normType, typeText } from '../../src/mc3/core/screens/epc';
import { ifbBuses, lowOf } from '../../src/mc3/core/screens/ifb';
import { screen, startApp, type } from './harness';

const prod = (app: Awaited<ReturnType<typeof startApp>>['app']) => app.ws.get(29)!;

describe('IFB/PGM Sound', () => {
  it('derives IFB buses from IFnn mnemonics and the source range from the mode', async () => {
    const { app } = await startApp();
    await type(app, 'di');
    const s = screen(app);
    expect(s).toContain('IFB│Bus│   IFB   ║PGM SND│');
    expect(s).toContain('│001│025│IF01│    ║       │');
    expect(s).toContain('Source Upper Limit: 048');
    expect(ifbBuses(prod(app)).slice(0, 9)).toEqual([25, 26, 27, 28, 29, 30, 31, 32, 0]);
    expect([0, 1, 2, 3, 4].map(m => lowOf(m, 48))).toEqual([48, 45, 41, 37, 48]);
  });

  it('sets mode 1, edits a PGM source with range check and saves on F10', async () => {
    const { app } = await startApp();
    await type(app, 'di{F3} {ENTER}');
    expect(screen(app)).toContain(' 045');
    await type(app, '030{ENTER}');                       // out of range 45..48: refused
    expect(screen(app)).toContain('Program Sound Assignment must be within defined Range!');
    await type(app, '{CTRL-U}047{ENTER}{F10}');
    const c = prod(app).cfg;
    expect(c.ifb_mode).toBe(1);
    expect(c.pgm_limit).toBe(48);
    expect(c.ifb_pgm[0]).toBe(47);
    expect(c.ifb_bus.slice(0, 8)).toEqual([25, 26, 27, 28, 29, 30, 31, 32]);
    expect(prod(app).changed()).toEqual(expect.arrayContaining(['ifb_mode', 'pgm_limit', 'ifb_pgm', 'ifb_bus']));
  });
});

describe('Camera Array', () => {
  it('auto-detects ISO circuits and assigns a camera to CMA1', async () => {
    const { app } = await startApp();
    await type(app, 'dc');
    const s = screen(app);
    expect(s).toContain('CAM:║CMA1│CMA2│CMA3│CMA4│CMA5│CMA6│CMA7│CMA8│');
    expect(s).toContain('│IS01│CAM1║IS13│');
    await type(app, 'XXXX{ENTER}');                      // not an ISO mnemonic: refused, field stays
    await type(app, '{CTRL-U}CAM2{ENTER}CAM1{ENTER}{F3} {ENTER}{F10}');
    const c = prod(app).cfg;
    expect(c.cam.slice(0, 3)).toEqual([6, 5, 0]);
    expect(c.iso.slice(0, 8)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(c.cam_flags[0]).toBe(0x80);
  });

  it('Shift-F6 deletes a member and packs the array', async () => {
    const { app } = await startApp();
    await type(app, 'dcCAM1{ENTER}CAM2{ENTER}{UP}{UP}{SF6}{F10}');
    expect(prod(app).cfg.cam.slice(0, 2)).toEqual([6, 0]);
  });
});

describe('Call Array', () => {
  it('assigns buses by mnemonic and with the F2 picker', async () => {
    const { app } = await startApp();
    await type(app, 'da');
    expect(screen(app)).toContain('CAL:║CA01│CA02│CA03│');
    await type(app, 'DIR{ENTER}{F2}{DOWN}{DOWN}{ENTER}{ENTER}{TAB}TD{ENTER}{F10}');
    const c = prod(app).cfg;
    expect(c.call[0].slice(0, 3)).toEqual([1, 3, 0]);
    expect(c.call[1][0]).toBe(3);
  });

  it('prints the call arrays (Shift-F7)', async () => {
    const { app, printed } = await startApp();
    await type(app, 'daDIR{ENTER}{SF7}{ENTER}');
    expect(printed[0][0]).toBe('PROD30-call.txt');
    expect(printed[0][1]).toContain('Call Array: CA01');
    expect(printed[0][1]).toContain('001     DIR ');
  });
});

describe('Relay Control', () => {
  it('sets an output bus and toggles mask bits', async () => {
    const { app } = await startApp();
    await type(app, 'dr');
    expect(screen(app)).toContain('│Relay│Bus#│Code│');
    await type(app, '{ENTER}049{ENTER}');
    expect(screen(app)).toContain('Bus#│Code│Sel');
    await type(app, ' {DOWN} {F10}');                    // deselect buses 1 and 2 (new relays are all selected)
    const c = prod(app).cfg;
    expect(c.relay_out[0]).toBe(49);
    expect(c.relay_mask[0].slice(0, 2)).toBe('fc');
    await type(app, '{ESC}');
  });
});

describe('Electronic Pegboard', () => {
  it('enters a PERM and an event item and saves compacted', async () => {
    const { app } = await startApp();
    await type(app, 'de');
    expect(screen(app)).toContain('│Item│Input│Output│ Control │');
    await type(app, '033{ENTER}004{ENTER}p{ENTER}R01 to AUD{ENTER}');
    await type(app, '001{ENTER}049{ENTER}ev1{ENTER}event{ENTER}{UP}{F3}{DOWN}{DOWN}{ENTER}{F10}');
    expect(prod(app).cfg.epc).toEqual([
      { in: 33, out: 4, type: 0x40, ext: 0xff, comment: 'R01 to AUD' },
      { in: 1, out: 49, type: 0xc4, ext: 1, comment: 'event' },
    ]);
  });

  it('type validator and text round trip', () => {
    expect(normType('')).toBe('PERM');
    expect(normType('i')).toBe('INHB');
    expect(normType('XT5')).toBe('XT05');
    expect(normType('EV25')).toBeNull();
    const it = { in: 1, out: 2, type: 0xff, ext: 0xff, comment: '' };
    applyType(it, 'XT05');
    expect(it).toMatchObject({ type: 0x42, ext: 5 });
    expect(typeText(it)).toEqual(['XT05', '    ']);
    applyType(it, 'EV12');
    expect(typeText(it)).toEqual(['EV12', 'T   ']);
  });
});
