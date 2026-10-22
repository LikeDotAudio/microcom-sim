import { describe, expect, it } from 'vitest';
import { layoutM2026, m2026Keys, PAD } from '../../src/m2026/face';
import { RACK_W, U } from '../../src/matrix/panelSvg';
import type { Station, StationKey } from '../../src/matrix/types';

function station(n: number, ext = 0): Station {
  const keys: StationKey[] = Array.from({ length: n }, (_, slot) => ({ slot, label: String(slot + 1), kind: 'bus', name: 'CAM1', mode: 'TL', target: 5, on: null }));
  keys.push({ slot: n, label: String(n + 1), kind: 'empty', name: '', on: null });
  for (let i = 0; i < ext; i++) keys.push({ slot: 100 + i, label: `X${i + 1}`, kind: 'ext', name: 'D02', targets: [65], on: null });
  return { gid: 1, label: 'PROD01 PNL01', kind: 'panel', facility: 0, local: 1, type: '1', typeName: 'M7880', mnemonic: 'DIR ',
    overlay: '', keys, groups: [], panelModel: 'M2026' };
}

const inside = (a: { x: number; y: number; w: number; h: number }, W: number, H: number) =>
  a.x >= 0 && a.y >= 0 && a.x + a.w <= W && a.y + a.h <= H;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('M2026 layout', () => {
  it('always has 32 keys: programmed, then matrix keys, then blanks (empties dropped)', () => {
    const keys = m2026Keys(station(10, 3));
    expect(keys).toHaveLength(32);
    expect(keys.slice(10, 13).map(k => k.kind)).toEqual(['ext', 'ext', 'ext']);
    expect(keys[13].kind).toBe('empty');
    expect(keys.map(k => k.label)).toEqual(Array.from({ length: 32 }, (_, i) => String(i + 1)));
  });
  it('is a 4RU station / 5RU producer with two rows of 16 keys', () => {
    const s = layoutM2026(station(20), false), p = layoutM2026(station(20), true);
    expect(s.height).toBeCloseTo(4 * U);
    expect(p.height).toBeCloseTo(5 * U);
    expect(s.talent).toBeNull();
    expect(p.talent).not.toBeNull();
    expect(new Set(s.keys.map(k => k.win.y)).size).toBe(2);
    expect(s.keys.filter(k => k.win.y === s.keys[0].win.y)).toHaveLength(16);
  });
  it('keeps screens, keys and controls on the faceplate without overlaps', () => {
    for (const producer of [false, true]) {
      const L = layoutM2026(station(32), producer);
      const parts = [L.screen, L.ticker, L.prod, L.map, L.pad, L.knobs, ...(L.talent ? [L.talent] : [])];
      for (const b of [...parts, ...L.keys.map(k => k.win), ...L.keys.map(k => k.paddle)]) expect(inside(b, RACK_W, L.height)).toBe(true);
      for (const k of L.keys) for (const b of parts) {
        expect(overlap(k.win, b)).toBe(false);
        expect(overlap(k.paddle, b)).toBe(false);
      }
      expect(overlap(L.map, L.pad)).toBe(false);
      expect(overlap(L.screen, L.map)).toBe(false);
    }
  });
  it('maps the 4x4 keypad to navigation and screen actions', () => {
    expect(PAD).toHaveLength(16);
    expect(PAD.map(p => p[1])).toEqual(expect.arrayContaining(['up', 'down', 'left', 'right', 'ok', 'zin', 'zout', 'here', 'there', 'every', 'play', 'ack']));
  });
});
