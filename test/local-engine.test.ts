// Browser engine pieces the parity test cannot reach: the frame link byte protocol, the mixer and
// 'recently said', proximity, connections with panel-link roles, and static-site panel routes.
import { describe, expect, it, vi } from 'vitest';
import { Access } from '../src/local/access';
import { FRAME } from '../src/local/audio';
import { Host } from '../src/local/host';
import { ACK, CR, ENQ, SOH, SYN, checksum } from '../src/local/link';
import { panelRoutePath } from '../src/local/mode';
import { Profile } from '../src/local/profile';
import { resolvePanel } from '../src/panel/route';
import type { Msg } from '../src/local/engine';

async function newHost() {
  const profile = new Profile();
  return new Host(await Access.create(new Uint8Array(32).fill(1), profile.ports), profile, null, null);
}

function block(typ: number, blk: number, data: number[]): Uint8Array {
  const d = Uint8Array.from({ length: 30 }, (_, i) => data[i] ?? 0);
  return Uint8Array.from([SOH, typ, blk, 0xff - blk, ...d, checksum(d)]);
}

/** A scripted PC on the frame link: answers each ENQ with ACK when it has a block, then sends it on SYN. */
function pc(host: Host, f: number, blocks: Uint8Array[]) {
  const rx: number[] = [];
  const queue = [...blocks];
  let waitingSyn = false;
  const link = host.attachLink(f, b => {
    for (const x of b) {
      rx.push(x);
      if (x === ENQ && queue.length && !waitingSyn) { waitingSyn = true; link.send(Uint8Array.of(ACK)); }
      else if (x === SYN && waitingSyn) { waitingSyn = false; link.send(queue.shift()!); }
    }
  });
  return { rx, link, queue };
}

describe('frame link (link.py protocol)', () => {
  it('polls with ENQ, takes blocks after ACK/SYN, ACKs good ones and applies them', async () => {
    vi.useFakeTimers();
    const host = await newHost();
    const name = [0x44, 0x49, 0x52, 0x20];   // "DIR "
    const p = pc(host, 3, [block(0x0f, 1, [...name, 0xc0, 0x54, 0x44, 0x20, 0x20, 0xc0]), block(0x0f, 2, [1, 2])]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(p.rx[0]).toBe(ENQ);
    expect(p.rx.filter(x => x === SYN)).toHaveLength(2);
    expect(p.rx.filter(x => x === ACK)).toHaveLength(2);
    expect(host.engine.facilities[3].mnemonic[1]).toBe('DIR ');
    expect(host.engine.facilities[3].mnemonic[2]).toBe('TD  ');
    expect(host.engine.linkStatus()[3]).toMatchObject({ connected: true, blocks: 2, port: 7003 });
    p.link.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.engine.linkStatus()[3]).toMatchObject({ connected: false });
    expect(host.engine.events.map(e => e.text)).toEqual(expect.arrayContaining(['MCOM connected from this browser',
      'Index upload received (2 blocks)', 'MCOM disconnected']));
    vi.useRealTimers();
  });

  it('rejects a bad checksum with CR and honours nak_every / offline faults', async () => {
    vi.useFakeTimers();
    const host = await newHost();
    const bad = block(0x0a, 1, [0x31, 0x32]);
    bad[34] ^= 1;
    const p = pc(host, 0, [bad]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.rx).toContain(CR);
    host.handle({ admin: true, gid: null }, { t: 'fault', facility: 0, faults: { offline: true } });
    const before = p.rx.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(p.rx.length).toBeLessThanOrEqual(before + 1);       // offline: no more ENQ
    p.link.close();
    vi.useRealTimers();
  });

  it('echoes a Data Link Test block (ENQ bytes zeroed)', async () => {
    vi.useFakeTimers();
    const host = await newHost();
    const t = block(0xaa, 1, [5, 6, 7]);
    const p = pc(host, 1, [t]);
    await vi.advanceTimersByTimeAsync(1000);
    const i = p.rx.indexOf(SYN);
    expect(p.rx.slice(i + 1, i + 34)).toEqual([...t.slice(1, 34)].map(x => (x === ENQ ? 0 : x)));
    p.link.send(Uint8Array.of(0x04));
    p.link.close();
    vi.useRealTimers();
  });
});

describe('connections and audio', () => {
  it('a panel-link token sees only its station; the operator sees everything', async () => {
    const host = await newHost();
    const got: Msg[] = [], op: Msg[] = [];
    const panel = host.connect(host.access.panelToken(5), 'https://x.github.io/sim/panel.html', { json: m => got.push(m), binary: () => {} });
    host.connect(null, 'https://x.github.io/sim/matrix.html', { json: m => op.push(m), binary: () => {} });
    expect(got[0]).toEqual({ t: 'hello', admin: false, gid: 5 });
    expect(op[0]).toEqual({ t: 'hello', admin: true, gid: null });
    const snap = got[1].state as Record<string, unknown[]>;
    expect(snap.facilities).toEqual([]);
    panel.message(JSON.stringify({ t: 'key', gid: 6, slot: 0 }));
    expect(got.at(-1)).toEqual({ t: 'error', message: 'this link only operates its own panel' });
    panel.message(JSON.stringify({ t: 'panellink', gid: 5 }));
    expect(got.at(-1)).toEqual({ t: 'panellink', gid: 5,
      url: `https://x.github.io/sim/panel.html?p=PROD01/PNL05&k=${encodeURIComponent(host.access.panelToken(5))}` });
    panel.message(JSON.stringify({ t: 'key', gid: 5, slot: 0, action: 'toggle' }));
    expect(got.some(m => m.t === 'event')).toBe(false);          // the log is operator only
    expect(op.some(m => m.t === 'event')).toBe(true);
  });

  it('mixes routed microphones into each listening station and records what was said', async () => {
    const host = await newHost();
    const e = host.engine;
    e.key(5, 0, 'toggle');                            // CAM1 key 1 talks to DIR (bus 1)
    const toDir: ArrayBuffer[] = [], said: Msg[] = [];
    e.subscribers.add(m => { if (m.t === 'said') said.push(m); });
    const dir = host.connect(null, 'http://h/', { json: () => {}, binary: b => toDir.push(b) });
    dir.message(JSON.stringify({ t: 'audio', on: true, gid: 1 }));
    const cam = host.connect(null, 'http://h/', { json: () => {}, binary: () => {} });
    cam.message(JSON.stringify({ t: 'audio', on: true, gid: 5 }));
    const tone = new ArrayBuffer(FRAME * 2);
    const v = new DataView(tone);
    for (let i = 0; i < FRAME; i++) v.setInt16(i * 2, Math.round(8000 * Math.sin(i / 5)), true);
    for (let n = 0; n < 40; n++) { cam.message(tone.slice(0)); host.audio.tick(); }
    expect(toDir.length).toBe(40);
    const out = new Int16Array(toDir[5]);
    expect(Math.max(...out)).toBeGreaterThan(7000);   // CAM1 heard at unity gain
    for (let n = 0; n < 40; n++) host.audio.tick();   // 0.8 s of quiet closes the segment
    expect(said).toHaveLength(1);
    const item = said[0].item as { id: number; src: number; dsts: number[]; text: null };
    expect(item).toMatchObject({ src: 5, dsts: [1, 6, 7, 8, 9, 10, 11, 12], text: null });   // DIR + the CMA1 party line
    const wav = host.clip(null, item.id)!;
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(host.clip(host.access.panelToken(20), item.id)).toBeNull();  // not said to PNL20
    expect(host.clip(host.access.panelToken(1), item.id)).not.toBeNull();
  });

  it('proximity: a blip heard by another joined station becomes a near pair', async () => {
    const host = await newHost();
    for (const g of [20, 21]) host.connect(null, 'http://h/', { json: () => {}, binary: () => {} }).message(JSON.stringify({ t: 'audio', on: true, gid: g }));
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;              // both idle for > 10 s
    host.proximity.round();
    Date.now = realNow;
    const cur = host.proximity.current!;
    const other = cur.gid === 20 ? 21 : 20;
    host.proximity.heard(other, cur.id, cur.gid, 14);
    expect(host.proximity.near()).toEqual([[20, 21, 14]]);
  });
});

describe('static-site panel routes', () => {
  const ports = new Profile().portList.map(p => ({ gid: p.gid, facility: p.facility, local: p.local, kind: p.kind, label: p.label, mnemonic: '', overlay: '', termType: '', hasKeys: false }));
  const loc = (pathname: string, search = '', hash = '') => ({ pathname, search, hash });
  it('maps panel.html?p=… and #… onto server paths', () => {
    expect(panelRoutePath(loc('/sim/panel.html', '?p=PROD01/PNL02&k=x'))).toBe('/panel/PROD01/PNL02');
    expect(panelRoutePath(loc('/sim/panel.html', '', '#PROD32/1'))).toBe('/panel/PROD32/1');
    expect(panelRoutePath(loc('/sim/panel.html'))).toBe('/panels');
    expect(panelRoutePath(loc('/panel/F01/PNL01'))).toBe('/panel/F01/PNL01');
    expect(resolvePanel(panelRoutePath(loc('/x/panel.html', '?p=PROD01/PNL02')), ports as never)).toEqual({ kind: 'panel', gid: 2 });
  });
});
