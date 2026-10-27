import { describe, expect, it } from 'vitest';
import { chooseStation, keysThatFit, KEY_PX, panelPorts, stationName, stripKeys } from '../../src/strip/model';
import type { Port, StationKey } from '../../src/matrix/types';

const port = (gid: number, label: string, mnemonic: string, over: Partial<Port> = {}): Port =>
  ({ gid, kind: 'panel', label, mnemonic, overlay: '', termType: '7880', hasKeys: true, facility: 0, local: gid, ...over });
const ports = [
  port(1, 'PROD01 PNL01', 'DIR'),
  port(2, 'PROD01 PNL02', 'PRD'),
  port(3, 'PROD01 IFB01', 'TAL1', { kind: 'ifb', hasKeys: false, termType: '0' }),
  port(4, 'PROD01 LINE1', '', { hasKeys: false, termType: '0' }),
];
const key = (slot: number, kind: StationKey['kind'], name: string, extra: Partial<StationKey> = {}): StationKey =>
  ({ slot, label: String(slot + 1), kind, name, on: null, ...extra });

describe('which ports are panels', () => {
  it('keeps ports with keys or a terminal, never a talent position or a bare line', () => {
    expect(panelPorts(ports).map(p => p.gid)).toEqual([1, 2]);
  });
});

describe('the keys a strip shows', () => {
  const st = { keys: [key(3, 'bus', 'cam1', { target: 9, mode: 'TL' }), key(0, 'bus', 'Director', { target: 1 }), key(1, 'empty', ''), key(2, 'phantom', 'GRP2')] };
  it('skips blanks, keeps slot order, and stops at the strip’s length', () => {
    expect(stripKeys(st, 12).map(k => k.slot)).toEqual([0, 2, 3]);
    expect(stripKeys(st, 2).map(k => k.slot)).toEqual([0, 2]);
  });
  it('writes the panel’s own 4-character LED legend, a phantom by its function', () => {
    expect(stripKeys(st, 12).map(k => k.legend)).toEqual(['DIRE', 'GRP', 'CAM1']);
  });
  it('knows who a key reaches and says so in its tooltip', () => {
    const [dir, , cam] = stripKeys(st, 12, g => `#${g}`);
    expect(dir.target).toBe(1);
    expect(cam.title).toBe('4: cam1 → #9 (TL)');
  });
});

describe('how many keys fit', () => {
  it('as many as the room leaves after the picker and buttons, never none, never more than asked', () => {
    expect(keysThatFit(null, 200, 12)).toBe(12);
    expect(keysThatFit(200 + 5 * KEY_PX + 10, 200, 12)).toBe(5);
    expect(keysThatFit(100, 200, 12)).toBe(1);
    expect(keysThatFit(5000, 200, 12)).toBe(12);
  });
});

describe('which station is mine', () => {
  it('the page’s ?p= first, then the one remembered, then the first panel', () => {
    expect(chooseStation(ports, 'PROD01/PNL02', 'PROD01 PNL01')?.gid).toBe(2);
    expect(chooseStation(ports, null, 'PROD01 PNL02')?.gid).toBe(2);
    expect(chooseStation(ports, 'PROD09/PNL99', null)?.gid).toBe(1);
    expect(chooseStation(ports, null, 'PROD01 IFB01')?.gid).toBe(1);
    expect(chooseStation([], null, null)).toBeNull();
  });
  it('names a station by its mnemonic and port', () => {
    expect(stationName(ports[1])).toBe('PRD · PNL02');
    expect(stationName(ports[3])).toBe('LINE1');
  });
});
