// The page <-> engine transport (socket.ts / serve.ts) end to end, with the in-page engine that is used
// when SharedWorker is missing (Node has no SharedWorker and no IndexedDB: no persistence, demo state).
import { beforeAll, describe, expect, it } from 'vitest';
import { ACK, ENQ, SOH, SYN, checksum } from '../src/local/link';

import { PROTOCOL } from '../src/matrix/types';
type Mod = typeof import('../src/local/socket') & typeof import('../src/local/frameLink');
let mod: Mod;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.location ??= new URL('https://example.github.io/microcom-sim/matrix.html');
  g.addEventListener ??= () => {};
  mod = { ...(await import('../src/local/socket')), ...(await import('../src/local/frameLink')) };
});

const until = async (f: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); }
};

describe('local engine transport', () => {
  it('a LocalSocket opens, gets hello + snapshot, and answers requests', async () => {
    expect(mod.localEngineKind()).toBe('inpage');
    const ws = mod.openEngineSocket('wss://example.github.io/ws');
    const got: Record<string, unknown>[] = [];
    let opened = false;
    ws.onopen = () => { opened = true; };
    ws.onmessage = ev => { if (typeof ev.data === 'string') got.push(JSON.parse(ev.data)); };
    await until(() => got.length >= 2);
    expect(opened).toBe(true);
    expect(got[0]).toEqual({ t: 'hello', admin: true, gid: null, proto: PROTOCOL });
    expect(got[1].t).toBe('snapshot');
    ws.send(JSON.stringify({ t: 'station', gid: 1 }));
    await until(() => got.some(m => m.t === 'station'));
    ws.send(JSON.stringify({ t: 'panellink', gid: 2 }));
    await until(() => got.some(m => m.t === 'panellink'));
    expect(String(got.find(m => m.t === 'panellink')!.url)).toMatch(/^https:\/\/example\.github\.io\/microcom-sim\/panel\.html\?p=PROD01\/PNL02&k=/);
    ws.close();
    expect(ws.readyState).toBe(3);
  });

  it('openFrameLink carries the frame protocol: ENQ, ACK -> SYN, block -> ACK', async () => {
    const link = mod.openFrameLink(2);
    const rx: number[] = [];
    link.onData(b => rx.push(...b));
    await until(() => rx.includes(ENQ), 3000);
    link.send(Uint8Array.of(ACK));
    await until(() => rx.includes(SYN), 3000);
    const d = Uint8Array.from({ length: 30 }, (_, i) => (i < 4 ? 0x41 + i : i === 4 ? 0xc0 : 0));
    link.send(Uint8Array.from([SOH, 0x0f, 1, 0xfe, ...d, checksum(d)]));
    await until(() => rx.slice(rx.indexOf(SYN)).includes(ACK), 3000);
    link.close();
    // the facility now has the uploaded mnemonic: ask through a socket after the ticker ran
    const ws = mod.openEngineSocket('wss://x/ws');
    const got: Record<string, unknown>[] = [];
    ws.onmessage = ev => { if (typeof ev.data === 'string') got.push(JSON.parse(ev.data)); };
    await until(() => got.length >= 2);
    await new Promise(r => setTimeout(r, 300));
    ws.send(JSON.stringify({ t: 'getcfg', facility: 2 }));
    await until(() => got.some(m => m.t === 'cfg'));
    expect((got.find(m => m.t === 'cfg')!.cfg as { mnemonic: Record<string, string> }).mnemonic['1']).toBe('ABCD');
    ws.close();
  }, 15000);
});
