// The browser engine (src/local) against the Python engine (mcom-tui/mcommatrix): the same request
// script through both, every reply and broadcast compared.
// With mcom-tui/.venv present the Python engine runs live; without it (CI, the public microcom-sim repo)
// the comparison is against the Python engine's recorded trace, test/fixtures/local-parity.trace.json:
// one sha256 of canonical JSON per part (initial, every step, final, blocks), so the fixture stays a few KB.
// A recorded mismatch names the step; run with the venv for the full diff.
// Re-record after changing the script or the Python engine:  PARITY_RECORD=1 npx vitest run test/local-parity.test.ts
// The recorded trace never carries the MCOM sample-setup import (that reads the original MCOMFILE.*).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Access, ADMIN } from '../src/local/access';
import { FacilityConfig, type Pending } from '../src/local/config';
import { Host, stationView, viewScope } from '../src/local/host';
import { Profile } from '../src/local/profile';
import type { Msg } from '../src/local/engine';

const TUI = resolve(import.meta.dirname, '../../mcom-tui');
const PY = join(TUI, '.venv/bin/python');
const ORIGINAL = resolve(TUI, '..');
const TRACE = resolve(import.meta.dirname, 'fixtures/local-parity.trace.json');
const LIVE = existsSync(PY);
const TL = 0xc0;

type Step = { msg?: Record<string, unknown>; role?: number | null; flush?: boolean; view?: number };

const steps: Step[] = [
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(slot => ({ msg: { t: 'key', gid: 1, slot, action: 'toggle' } })),
  { msg: { t: 'station', gid: 1 } },
  { msg: { t: 'key', gid: 1, slot: 100, action: 'press' } },
  { msg: { t: 'key', gid: 1, slot: 101, action: 'toggle' } },
  { msg: { t: 'key', gid: 2, slot: 2, action: 'toggle' } },
  { msg: { t: 'key', gid: 2, slot: 3, action: 'toggle' } },
  { msg: { t: 'key', gid: 2, slot: 100, action: 'toggle' } },
  { msg: { t: 'key', gid: 5, slot: 0, action: 'press' } },
  { msg: { t: 'key', gid: 6, slot: 2, action: 'toggle' } },
  { msg: { t: 'key', gid: 14, slot: 0, action: 'toggle' } },
  { msg: { t: 'talent', gid: 25, mic: false } },
  { msg: { t: 'talent', gid: 26, cough: true } },
  { msg: { t: 'talent', gid: 5, mic: false } },
  { msg: { t: 'xt', facility: 0, n: 1, on: true } },
  { msg: { t: 'station', gid: 2 } },
  { msg: { t: 'station', gid: 25 } },
  { msg: { t: 'station', gid: 13 } },
  { msg: { t: 'station', gid: 16 } },
  { msg: { t: 'station', gid: 1985 } },
  { msg: { t: 'station', gid: 40 } },
  { msg: { t: 'key', gid: 5, slot: 0, action: 'release' } },
  { msg: { t: 'key', gid: 1, slot: 100, action: 'release' } },
  { msg: { t: 'setcfg', facility: 0, changes: { mnemonic: { 13: 'NEW1', 14: null }, keys: { 13: Array.from({ length: 40 }, (_, i) => (i < 3 ? [1 + i, TL | 0x20] : [0, 0])) } } } },
  { flush: true },
  { msg: { t: 'key', gid: 13, slot: 0, action: 'toggle' } },
  { msg: { t: 'key', gid: 1, slot: 2, action: 'toggle' } },
  { msg: { t: 'setcfg', facility: 1, changes: { epc: [{ in: 3, out: 1, type: 0x41, ext: 0, comment: '' }, { in: 5, out: 6, type: 0x40, ext: 0, comment: 'p' }], ifb_mode: '2', cam_flags: [0x80, 0, 0, 0, 0, 0, 0, 0] } } },
  { msg: { t: 'setcfg', facility: 1, changes: { bogus: 1 } } },
  { msg: { t: 'setcfg', facility: 1, changes: { iso: [1, 2] } } },
  { flush: true },
  { msg: { t: 'key', gid: 67, slot: 0, action: 'toggle' } },
  { msg: { t: 'getcfg', facility: 1 } },
  { msg: { t: 'panelmodel', gid: 3, model: 'M7864' } },
  { msg: { t: 'panelmodel', gid: 3, model: 'NOPE' } },
  { msg: { t: 'extkeys', gid: 3, keys: [{ label: 'ALL', targets: [1, 2, 4], talk: true, listen: true }, { label: 'L', targets: [65], talk: false, listen: true }] } },
  { flush: true },
  { msg: { t: 'key', gid: 3, slot: 100, action: 'toggle' } },
  { msg: { t: 'key', gid: 3, slot: 101, action: 'toggle' } },
  { msg: { t: 'meta', gid: 7, meta: { name: 'Pat Q', emoji: '🎥', role: '', location: { room: 'B', x: 3 } } } },
  { msg: { t: 'meta', gid: 7, meta: { bad: 1 } } },
  { msg: { t: 'facmeta', facility: 2, meta: { name: 'Show', lat: 1.5 } } },
  { msg: { t: 'history', gid: 2 } },
  { msg: { t: 'near' } },
  { msg: { t: 'heard', gid: 2, blip: 5, emitter: 3, snr: 12 } },
  { msg: { t: 'panellink', gid: 9 } },
  { msg: { t: 'nope' } },
  { msg: { t: 'key', gid: 5, slot: 1, action: 'toggle' }, role: 5 },
  { msg: { t: 'key', gid: 6, slot: 1, action: 'toggle' }, role: 5 },
  { msg: { t: 'meta', gid: 5, meta: { role: 'x' } }, role: 5 },
  { msg: { t: 'meta', gid: 5, meta: { name: 'Me' } }, role: 5 },
  { msg: { t: 'clear' }, role: 5 },
  { view: 5 }, { view: 2 }, { view: 25 },
  { msg: { t: 'xt', facility: 0, n: 1, on: false } },
  { msg: { t: 'clear' } },
];

/** deterministic bytes */
function rng(seed: number) { return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) & 0xff; }
function blockSet(): [number, number, number, number[]][] {
  const r = rng(7);
  const rnd = (n = 30) => Array.from({ length: n }, r);
  const term = (bus: number, _blk: number, nblocks: number, nkeys: number) => {
    const d = rnd(); d[0] = bus; d[27] = nblocks; d[29] = nkeys; return d;
  };
  const idx = (blk: number) => { const d = rnd(); for (let j = 0; j < 6; j++) for (let i = 0; i < 4; i++) d[j * 5 + i] = 0x41 + ((d[j * 5 + i] + blk) % 26); return d; };
  const zero = Array(30).fill(0);
  const epc1 = rnd(); epc1[28] = 2; epc1[29] = 8;
  const epc2 = rnd(); epc2[28] = 2; epc2[29] = 8;
  return [
    [0, 0x0f, 1, idx(1)], [0, 0x0f, 2, idx(2)], [0, 0x0f, 3, zero], [0, 0x0a, 1, rnd()], [0, 0x0a, 3, rnd()],
    [0, 0x0d, 1, idx(3)], [0, 0x0d, 0x31, idx(4)], [0, 0x0d, 0x3a, idx(5)], [0, 0x50, 1, rnd()], [0, 0x50, 2, rnd()], [0, 0x50, 13, rnd()],
    [0, 0xa6, 1, rnd()], [0, 0xa6, 4, rnd()], [0, 0xa5, 1, rnd()], [0, 0xa5, 4, rnd()], [0, 0xa5, 5, rnd()],
    [0, 0xa9, 2, rnd()], [0, 0xa9, 12, rnd()], [0, 0xa0, 1, epc1], [0, 0xa0, 2, epc2],
    [0, 0xf0, 1, term(7, 1, 1, 10)], [0, 0xf0, 5, term(7, 5, 1, 10)],
    [1, 0xf0, 2, term(9, 2, 4, 36)], [1, 0xf0, 1, term(9, 1, 4, 36)], [1, 0xf0, 3, term(9, 3, 4, 36)], [1, 0xf0, 4, term(9, 4, 4, 36)],
    [1, 0xf0, 1, term(10, 1, 2, 16)], [1, 0xf0, 2, term(10, 2, 2, 16)],
    [1, 0xf0, 1, term(11, 1, 2, 20)], [1, 0xf0, 2, term(11, 2, 2, 20)],
    [1, 0xf0, 1, term(12, 1, 1, 7)], [1, 0x77, 1, rnd()],
  ];
}

const strip = (evs: { kind: string; text: string; facility: number | null }[]) => evs.map(e => [e.kind, e.text, e.facility]);
const norm = <T>(x: T): T => JSON.parse(JSON.stringify(x));

async function runTs(blocks: ReturnType<typeof blockSet>) {
  const profile = new Profile();
  const access = await Access.create(new Uint8Array(32), profile.ports);
  const host = new Host(access, profile, null, null);
  const engine = host.engine;
  engine.events = [];
  engine.links.clear();
  const published: Msg[] = [];
  engine.publish = m => { published.push(m); };
  const snap = () => { const s = norm(engine.snapshot()) as Record<string, unknown>; s.events = strip(s.events as never); return s; };
  const out: Record<string, unknown> = { initial: snap(), steps: [] };
  for (const step of steps) {
    published.length = 0;
    let reply: unknown = null;
    if (step.view) {
      const v = stationView({ t: 'snapshot', state: norm(engine.snapshot()) }, step.view, viewScope(engine, step.view))!;
      const st = v.state as Record<string, unknown>;
      st.events = strip(st.events as never);
      reply = v;
    } else if (step.flush) {
      const e = engine as unknown as { dirty: Set<string> };
      if (e.dirty.size) {
        const d = e.dirty;
        e.dirty = new Set();
        if (d.has('config')) { engine.recompute(); engine.publish({ t: 'snapshot', state: engine.snapshot() }); }
      }
    } else {
      const role = step.role == null ? ADMIN : { admin: false, gid: step.role };
      try {
        const r = host.handle(role, step.msg!) as Record<string, unknown> | null;
        if (r && r.t === 'panellink') r.url = '<url>';
        reply = r;
      } catch { reply = { t: 'error' }; }
    }
    const pubs = published.map(m => {
      if (m.t === 'event') return { t: 'event', e: strip([m.e as never])[0] };
      if (m.t === 'snapshot') { const st = norm(m.state) as Record<string, unknown>; st.events = strip(st.events as never); return { t: 'snapshot', state: st }; }
      return norm(m);
    });
    (out.steps as unknown[]).push({ reply: norm(reply), published: pubs });
  }
  out.final = snap();
  const descs: (string | null)[] = [];
  const pend: Pending = new Map();
  const cfgs = new Map<number, FacilityConfig>();
  for (const [f, typ, blk, data] of blocks) {
    if (!cfgs.has(f)) cfgs.set(f, new FacilityConfig());
    descs.push(cfgs.get(f)!.applyBlock(typ, blk, Uint8Array.from(data), pend));
  }
  out.blocks = { descs, cfgs: Object.fromEntries([...cfgs].map(([f, c]) => [String(f), c.toJson()])) };
  return out;
}

/** JSON with sorted keys, so the digest is the same whichever engine built the object */
const canon = (x: unknown): string => {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (Array.isArray(x)) return `[${x.map(v => (v === undefined ? 'null' : canon(v))).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
};
const digest = (x: unknown) => `sha256:${createHash('sha256').update(canon(norm(x))).digest('hex')}`;
/** live: the Python object itself; recorded: its digest */
const expectSame = (ts: unknown, py: unknown, what: string) =>
  typeof py === 'string' && py.startsWith('sha256:') ? expect(digest(ts), what).toBe(py) : expect(ts).toEqual(py);

describe.skipIf(!LIVE && !existsSync(TRACE))(`local engine = Python engine (${LIVE ? 'live' : 'recorded trace'})`, () => {
  const blocks = blockSet();
  let py: any;
  let ts: Awaited<ReturnType<typeof runTs>>;

  // in beforeAll, not the describe body: a skipped describe still runs its body while collecting
  beforeAll(() => {
    const script = digest({ steps, blocks });   // a recorded trace answers only the script it was recorded from
    if (!LIVE) {
      const rec = JSON.parse(readFileSync(TRACE, 'utf8'));
      if (rec.script !== script) throw new Error(`${TRACE} was recorded from another script: re-record with PARITY_RECORD=1 (needs mcom-tui/.venv)`);
      py = rec.trace;
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'mcom-parity-'));
    const scriptPath = join(dir, 'script.json');
    writeFileSync(scriptPath, JSON.stringify({ steps, blocks, mcomDir: ORIGINAL }));
    py = JSON.parse(execFileSync(PY, [join(TUI, 'harness/engine_trace.py'), scriptPath], { maxBuffer: 1 << 28 }).toString());
    if (process.env.PARITY_RECORD === '1') {
      // never record what was read from MCOMFILE.* (py.mcom)
      const trace = { initial: digest(py.initial), steps: (py.steps as unknown[]).map(digest), final: digest(py.final), blocks: digest(py.blocks) };
      writeFileSync(TRACE, JSON.stringify({ script, trace }, null, 1) + '\n');
    }
  }, 60000);

  it('runs the script', async () => { ts = await runTs(blocks); }, 30000);

  it('starts from the same demo programming', () => expectSame(ts.initial, py.initial, 'initial'));

  it('answers and broadcasts the same for every request', () => {
    const tsSteps = ts.steps as unknown[];
    steps.forEach((s, i) => typeof py.steps[i] === 'string'
      ? expectSame(tsSteps[i], py.steps[i], `step ${i} ${JSON.stringify(s)}`)
      : expect({ i, s, ...(tsSteps[i] as object) }).toEqual({ i, s, ...py.steps[i] }));
  });

  it('ends in the same state', () => expectSame(ts.final, py.final, 'final'));

  it('decodes serial upload blocks the same', () => expectSame(ts.blocks, py.blocks, 'blocks'));

  it.skipIf(!LIVE || !existsSync(join(ORIGINAL, 'MCOMFILE.MTX')))('imports the MCOM sample setup the same', async () => {
    const { readFileSync } = await import('node:fs');
    const rd = (ext: string) => { const p = join(ORIGINAL, `MCOMFILE.${ext}`); return existsSync(p) ? new Uint8Array(readFileSync(p)) : undefined; };
    const c = FacilityConfig.fromMcomFiles({ mtx: rd('MTX')!, ova: rd('OVA'), tma: rd('TMA'), epc: rd('EPC') });
    expect(norm(c.toJson())).toEqual(py.mcom);
  });
});
