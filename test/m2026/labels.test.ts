import { describe, expect, it } from 'vitest';
import { fitName, fitRole, keyLegend, keyTarget, ledChars } from '../../src/m2026/labels';
import type { StationKey } from '../../src/matrix/types';

const bus = (name: string, target = 5): StationKey => ({ slot: 0, label: '1', kind: 'bus', name, mode: 'TL', target, on: null });

describe('name fitting', () => {
  it('shortens names progressively', () => {
    expect(fitName('Rosa Moreau', 12)).toBe('Rosa Moreau');
    expect(fitName('Rosa Moreau', 8)).toBe('Rosa M.');
    expect(fitName('Rosa Moreau', 5)).toBe('Rosa');
    expect(fitName('Christopher Lee', 4)).toBe('CL');
    expect(fitName('Christopher', 4)).toBeNull();      // must scroll
  });
  it('abbreviates roles', () => {
    expect(fitRole('Director', 8)).toBe('Director');
    expect(fitRole('Technical Director', 8)).toBe('Tech Dir');
    expect(fitRole('Camera 3', 6)).toBe('Cam 3');
    expect(fitRole('Talent 12', 6)).toBe('Tal 12');
    expect(fitRole('Chief Executive Officer', 8)).toBeNull();
  });
  it('estimates LED characters per line', () => {
    expect(ledChars(15, 3)).toBe(8);
  });
});

describe('key legends', () => {
  it('shows the person behind a bus key', () => {
    const l = keyLegend(bus('DIR '), { name: 'Rosa Moreau', role: 'Director', emoji: '🎬' }, 8);
    expect(l).toMatchObject({ emoji: '🎬', top: 'DIR', name: 'Rosa M.', role: 'Director', scrollName: false });
    expect(l.full).toBe('🎬 Rosa Moreau · Director (DIR)');
  });
  it('scrolls names that cannot be shortened', () => {
    const l = keyLegend(bus('VTR '), { name: 'Maximiliano', role: 'Replay' }, 6);
    expect(l.scrollName).toBe(true);
    expect(l.name).toBe('Maximiliano');
  });
  it('falls back to the mnemonic without metadata', () => {
    expect(keyLegend(bus('CAM1'), undefined, 8)).toMatchObject({ top: 'CAM1', name: '', emoji: '' });
  });
  it('describes phantom and empty keys', () => {
    expect(keyLegend({ slot: 3, label: '4', kind: 'phantom', name: 'GRP1', on: null }, undefined, 8)).toMatchObject({ top: 'GRP1', name: 'Group' });
    expect(keyLegend({ slot: 4, label: '5', kind: 'empty', name: '', on: null }, undefined, 8).top).toBe('');
  });
  it('resolves single-target keys only', () => {
    expect(keyTarget(bus('DIR', 1793))).toBe(1793);
    expect(keyTarget({ slot: 100, label: 'X1', kind: 'ext', name: 'ALL', targets: [1, 2], on: null })).toBeNull();
    expect(keyTarget({ slot: 100, label: 'X1', kind: 'ext', name: 'D02', targets: [65], on: null })).toBe(65);
  });
});
