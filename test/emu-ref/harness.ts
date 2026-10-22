// Runs MCOM.EXE on the TypeScript PC with the same frozen-time host loop as unicorn_ref.py,
// and runs the Python/Unicorn reference, so test/emu-diff.test.ts can compare the two.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Drive } from '../../src/emu/drive';
import { parseKeys } from '../../src/emu/keys';
import type { Clock } from '../../src/emu/machine';
import { Pc } from '../../src/emu/pc';
import { MatrixSim } from '../../src/emu/sim';
import { nullBackend, type Backend } from '../../src/emu/uart';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../..');
export const ORIGINAL = process.env.MCOM_ORIGINAL ?? REPO;            // folder with MCOM.EXE + sample setup
export const MCOM_EXE = join(ORIGINAL, 'MCOM.EXE');
const TUI = join(REPO, 'mcom-tui');
const PY_CANDIDATES = [join(TUI, '.venv/bin/python'), resolve(REPO, '../Microcom software/mcom-tui/.venv/bin/python')];
export const PYTHON = process.env.MCOM_PYTHON ?? PY_CANDIDATES.find(p => existsSync(p));
export const HAVE_EXE = existsSync(MCOM_EXE);

export const REGS = ['cs', 'ip', 'ax', 'bx', 'cx', 'dx', 'si', 'di', 'bp', 'sp', 'ds', 'es', 'ss', 'flags'] as const;

export interface Spec {
  seed: Record<string, string>;     // DOS path (below C:\) -> host file
  keys?: string;
  run_for?: number;
  trace?: number;
  slice?: number;
  com1?: string;
  key_delay?: number;
  args?: string;
}

export interface RunResult {
  trace: Uint16Array;
  sliceRegs: Uint16Array;
  instructions?: number;
  vram: Uint8Array;
  screen: string;
  serial: string[];
  matrix: string[];
  slices: number;
  exit: number | null;
  files: string[];
}

const T0 = 1000;
const WALL0 = new Date(2026, 0, 2, 10, 0, 0).getTime();

export function runTs(spec: Spec): RunResult {
  const t = { now: T0 };
  const clock: Clock = {
    now: () => t.now,
    wall: () => new Date(WALL0 + (t.now - T0) * 1000),
    sleep: s => { t.now += s; },
  };
  const drive = new Drive();
  drive.now = () => WALL0;
  for (const [name, src] of Object.entries(spec.seed)) drive.writeFile(name, readFileSync(src), WALL0);
  const serial: string[] = [], matrix: string[] = [];
  const com1 = spec.com1 ?? 'none';
  const be: Backend = com1.startsWith('sim')
    ? new MatrixSim(clock, com1.slice(4), l => matrix.push(l)) : nullBackend();
  const exe = drive.readFile('MICROCOM\\MCOM.EXE')!;
  const pc = new Pc({ drive, exe, clock, com1: be, args: spec.args, serialLog: l => serial.push(l) });

  const N = spec.trace ?? 0;
  const trace = new Uint16Array(N * 14);
  let n = 0;
  if (N) {
    pc.m.cpu.onStep = () => {
      if (n >= N) { pc.m.cpu.onStep = null; return; }
      REGS.forEach((r, i) => { trace[n * 14 + i] = pc.m.get(r); });
      n++;
    };
  }
  const script = parseKeys(spec.keys ?? '');
  const keyDelay = spec.key_delay ?? 0.05;
  const runFor = spec.run_for ?? 1;
  let nextKeyAt = T0, deadline: number | null = null, slices = 0;
  const sliceRegs: number[] = [];
  const m = pc.m, runSlice = m.runSlice.bind(m);
  m.runSlice = count => {
    try { return runSlice(count); } finally { for (const r of REGS) sliceRegs.push(m.get(r)); }
  };
  for (;;) {
    const alive = pc.step(spec.slice ?? 200_000);
    if (!alive) break;
    slices++;
    t.now += 0.01;
    const now = t.now;
    if (script.length && now >= nextKeyAt) {
      const item = script.shift()!;
      if (Array.isArray(item)) nextKeyAt = now + item[1];
      else { pc.bios.pushKey(item); nextKeyAt = now + keyDelay; }
    } else if (!script.length && deadline === null && now >= nextKeyAt) deadline = now + runFor;
    if (deadline !== null && now > deadline) break;
  }
  pc.traffic.flush();
  return {
    trace: trace.subarray(0, n * 14), sliceRegs: Uint16Array.from(sliceRegs), instructions: pc.m.cpu.icount, vram: pc.vram(), screen: pc.screenText(), serial, matrix,
    slices, exit: pc.exitCode, files: drive.list().map(([p]) => p).sort(),
  };
}

export function runPy(spec: Spec): RunResult {
  if (!PYTHON) throw new Error('no mcom-tui .venv python');
  const dir = mkdtempSync(join(tmpdir(), 'mcomref-'));
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec));
  execFileSync(PYTHON, [join(HERE, 'unicorn_ref.py'), TUI, join(dir, 'spec.json'), join(dir, 'out')], { stdio: 'inherit', timeout: 600_000 });
  const out = join(dir, 'out');
  const res = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));
  const tb = readFileSync(join(out, 'trace.bin'));
  const sb = readFileSync(join(out, 'slices.bin'));
  const lines = (f: string) => (existsSync(join(out, f)) ? readFileSync(join(out, f), 'latin1').split('\n').filter(Boolean) : []);
  return {
    trace: new Uint16Array(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength)),
    sliceRegs: new Uint16Array(sb.buffer.slice(sb.byteOffset, sb.byteOffset + sb.byteLength)),
    vram: new Uint8Array(readFileSync(join(out, 'screen.vram'))),
    screen: readFileSync(join(out, 'screen.txt'), 'utf8').replace(/\n$/, ''),
    serial: lines('serial.log'), matrix: lines('matrix.log'), slices: res.slices, exit: res.exit, files: res.files,
  };
}

/** First differing instruction of two traces, or null. */
export function traceDiff(a: Uint16Array, b: Uint16Array): string | null {
  const n = Math.min(a.length, b.length) / 14;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 14; j++) {
      if (a[i * 14 + j] !== b[i * 14 + j]) {
        const fmt = (t: Uint16Array, k: number) => REGS.map((r, x) => `${r}=${t[k * 14 + x].toString(16).padStart(4, '0')}`).join(' ');
        return `instruction ${i}: ${REGS[j]} differs\n  prev ts: ${i ? fmt(a, i - 1) : '-'}\n  prev py: ${i ? fmt(b, i - 1) : '-'}\n  ts: ${fmt(a, i)}\n  py: ${fmt(b, i)}`;
      }
    }
  }
  if (a.length !== b.length) return `trace lengths differ: ts ${a.length / 14}, py ${b.length / 14}`;
  return null;
}

export const seed = (names: string[]) =>
  Object.fromEntries(names.map(n => [`MICROCOM\\${n}`, join(ORIGINAL, n)]));
