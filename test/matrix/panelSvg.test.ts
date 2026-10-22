import { describe, expect, it } from 'vitest';
import { layoutPanel, RACK_W } from '../../src/matrix/panelSvg';
import type { Station, StationKey } from '../../src/matrix/types';

const LABELS: Record<string, string[]> = {
  '1': ['1', '2', '3', '4', '5', '6', 'A', 'B', 'C', 'D'],
  '2': ['1', '2', '3', '4', '5', '6', 'A', 'B', 'C', 'D', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'],
  '6': [...Array.from({ length: 12 }, (_, i) => String(i + 1)), 'A', 'B', 'C', 'D',
    ...Array.from({ length: 16 }, (_, i) => `2:${i + 1}`)],
  '9': ['#0', '#9', '#1', '#2', '#3', '#4'],
};

function station(type: string, ext = 0): Station {
  const keys: StationKey[] = LABELS[type].map((label, slot) => ({ slot, label, kind: 'bus', name: 'CAM1', mode: 'TL', on: null }));
  for (let i = 0; i < ext; i++) keys.push({ slot: 100 + i, label: `X${i + 1}`, kind: 'ext', name: 'F02', targets: [65], on: null });
  return { gid: 1, label: 'F01 PNL01', kind: 'panel', facility: 0, local: 1, type, typeName: 'M7880', mnemonic: 'DIR ',
    overlay: '', keys, groups: [] };
}

describe('layoutPanel', () => {
  it('splits M7880 into 6 station keys and 4 function keys on one 2RU unit', () => {
    const L = layoutPanel(station('1'));
    expect(L.units).toHaveLength(1);
    expect(L.units[0].units).toBe(2);
    expect(L.units[0].groups.map(g => g.fn)).toEqual([false, true]);
    expect(L.units[0].keys.filter(k => k.fn).map(k => k.key.label)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('puts M7880/81 keys 7-16 on an M7881 expansion unit', () => {
    const L = layoutPanel(station('2'));
    expect(L.units.map(u => u.model)).toEqual(['M7880', 'M7881']);
    expect(L.units[1].keys.map(k => k.key.label)).toEqual(['7', '8', '9', '10', '11', '12', '13', '14', '15', '16']);
  });

  it('draws the 32-key M7880D/F as one 3RU station with two key rows', () => {
    const L = layoutPanel(station('6', 2));
    expect(L.units.map(u => [u.model, u.units])).toEqual([['M7880D/F', 3], ['MATRIX EXT', 2]]);
    const rows = new Set(L.units[0].keys.map(k => k.y));
    expect(L.units[0].keys).toHaveLength(32);
    expect(rows.size).toBe(2);
    expect(L.units[1].keys.map(k => k.slot)).toEqual([100, 101]);
  });

  it('fills M7832 / M7864 matrix panels to 32 / 64 keys in rows of 16', () => {
    for (const [model, n, u] of [['M7832', 32, 3], ['M7864', 64, 5]] as const) {
      const st = { ...station('1', 5), panelModel: model };
      const L = layoutPanel(st);
      expect(L.units).toHaveLength(1);
      expect(L.units[0].units).toBe(u);
      const ks = L.units[0].keys;
      expect(ks).toHaveLength(n);
      expect(new Set(ks.map(k => k.y)).size).toBe(n / 16);
      expect(ks.map(k => k.key.label)).toEqual(Array.from({ length: n }, (_, i) => String(i + 1)));
      expect(ks.filter(k => k.slot >= 100)).toHaveLength(5);           // matrix keys follow MCOM keys
      expect(ks.filter(k => k.key.kind === 'empty')).toHaveLength(n - 15);
    }
  });

  it('keeps keys inside the key area without overlapping', () => {
    for (const st of [...Object.keys(LABELS).map(t => station(t, 3)), { ...station('1', 40), panelModel: 'M7864' }]) {
      for (const u of layoutPanel(st).units) {
        const ks = [...u.keys].sort((a, b) => a.y - b.y || a.x - b.x);
        ks.forEach((k, i) => {
          if (i && ks[i - 1].y !== k.y) return;
          expect(k.x).toBeGreaterThanOrEqual(u.keyX0 - 0.01);
          expect(k.x + k.w).toBeLessThanOrEqual(Math.min(u.keyX1, RACK_W) + 0.01);
          if (i) expect(k.x).toBeGreaterThanOrEqual(ks[i - 1].x + ks[i - 1].w);
        });
      }
    }
  });
});
