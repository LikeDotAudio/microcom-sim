// Differential test: the TypeScript PC against mcom-tui's Unicorn machine, both running the real
// MCOM.EXE with time frozen. Needs MCOM.EXE and mcom-tui's .venv; skips cleanly without them
// (the public repository has neither).
import { describe, expect, it } from 'vitest';
import { HAVE_EXE, PYTHON, runPy, runTs, seed, type Spec, traceDiff } from './emu-ref/harness';

const ready = HAVE_EXE && !!PYTHON;
const FRESH = seed(['MCOM.EXE', 'MCOM.HLP']);
const SAMPLE = seed(['MCOM.EXE', 'MCOM.HLP', 'MCOMFILE.MTX', 'MCOMFILE.TMA', 'MCOMFILE.OVA', 'MCOMFILE.EPC']);
const TRACE_N = Number(process.env.EMU_TRACE_N ?? 300_000);
// first run on a drive without MCOM.CFG: New Configuration, size and ID pick lists, then the title
const SETUP = '{WAIT 3.5}{ENTER}{WAIT 0.6}{ENTER}{WAIT 0.8}{ENTER}{WAIT 0.8}{ENTER}{WAIT 3}';

function compare(spec: Spec) {
  const ts = runTs(spec);
  const py = runPy(spec);
  // registers at the end of every host-loop slice, over the whole session
  expect(traceDiff(ts.sliceRegs, py.sliceRegs)?.replace('instruction', 'slice') ?? null).toBeNull();
  if (process.env.EMU_DUMP) console.log(`slices ts ${ts.sliceRegs.length / 14} py ${py.sliceRegs.length / 14}, instructions ${ts.instructions}\n${ts.screen}\n--- serial ${ts.serial.length} lines, matrix:\n${ts.matrix.join('\n')}\n--- files ${ts.files.join(' ')}`);
  return { ts, py };
}

describe.skipIf(!ready)('TypeScript CPU vs Unicorn on MCOM.EXE', () => {
  it(`executes the first ${TRACE_N} instructions identically`, () => {
    const { ts, py } = compare({ seed: SAMPLE, trace: TRACE_N, run_for: 3, com1: 'sim' });
    expect(traceDiff(ts.trace, py.trace)).toBeNull();
    expect(ts.trace.length / 14).toBe(TRACE_N);
    expect(ts.screen).toBe(py.screen);
  }, 600_000);

  it('New Configuration on an empty drive: same screens and files', () => {
    const { ts, py } = compare({ seed: FRESH, keys: SETUP, run_for: 2 });
    expect(ts.screen).toBe(py.screen);
    expect(Array.from(ts.vram)).toEqual(Array.from(py.vram));
    expect(ts.files).toEqual(py.files);
  }, 600_000);

  it('Define System menu and Matrix Index Table: same screen', () => {
    const { ts, py } = compare({ seed: SAMPLE, keys: SETUP + '{LEFT}{LEFT}{ENTER}{WAIT 1}M{WAIT 1.5}DIR{ENTER}{ENTER}Director{ENTER}{WAIT 1}', run_for: 2, com1: 'sim' });
    expect(ts.screen).toBe(py.screen);
    expect(Array.from(ts.vram)).toEqual(Array.from(py.vram));
  }, 600_000);

  it('Index and Keypad upload to the simulated frame: same bytes on the wire', () => {
    const keys = SETUP + '{LEFT}{LEFT}{ENTER}{WAIT 1}{RIGHT}{WAIT 1}I{WAIT 3}{ENTER}{WAIT 12}';
    const { ts, py } = compare({ seed: SAMPLE, keys, run_for: 3, com1: 'sim' });
    expect(ts.matrix.filter(l => l.includes('-> ACK')).length).toBeGreaterThan(8);
    expect(ts.serial).toEqual(py.serial);
    expect(ts.matrix).toEqual(py.matrix);
    expect(ts.screen).toBe(py.screen);
  }, 600_000);

  it('Data Link Test: same bytes on the wire', () => {
    const keys = SETUP + '{RIGHT}{ENTER}{WAIT 1}T{WAIT 6}{ESC}{WAIT 2}';
    const { ts, py } = compare({ seed: SAMPLE, keys, run_for: 2, com1: 'sim' });
    expect(ts.serial).toEqual(py.serial);
    expect(ts.screen).toBe(py.screen);
  }, 600_000);
});
