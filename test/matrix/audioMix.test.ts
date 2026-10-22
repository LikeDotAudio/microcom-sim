import { describe, expect, it } from 'vitest';
import { computeMix, diffMix, toDb, toneFrequency } from '../../src/matrix/audioMix';
import { Store } from '../../src/matrix/store';
import { snapshot } from './fixtures';

describe('audio mix', () => {
  const s = new Store();
  s.apply({ t: 'snapshot', state: snapshot([
    [5, 1, 'listen', 1, 'key'],
    [6, 1, 'cpl', 0.7, 'cpl'],
    [7, 1, 'listen-lm', 0, 'muted while talking'],
    [41, 1, 'pgm', 0.1, 'IFB interrupted'],
    [1, 9, 'talk', 1, 'other direction'],
    [8, 2, 'talk', 1, 'other destination'],
  ]) });

  it('mixes every route into the destination, scaled by route gain', () => {
    const mix = computeMix(s.byDst.get(1), 1);
    expect(mix.map(e => [e.src, e.gain])).toEqual([[5, 1], [6, 0.7], [41, 0.1]]);
    expect(computeMix(s.byDst.get(9), 9).map(e => e.src)).toEqual([1]);
    expect(computeMix(s.byDst.get(3), 3)).toEqual([]);
  });

  it('omits inputs switched off', () => {
    const mix = computeMix(s.byDst.get(1), 1, g => (g === 6 ? 'off' : 'tone'));
    expect(mix.map(e => e.src)).toEqual([5, 41]);
  });

  it('diffs mixes for gain ramps', () => {
    const prev = new Map([[5, 1], [6, 1], [99, 1]]);
    const d = diffMix(prev, computeMix(s.byDst.get(1), 1));
    expect(d.add.map(e => e.src)).toEqual([41]);
    expect(d.change.map(e => [e.src, e.gain])).toEqual([[6, 0.7]]);
    expect(d.remove).toEqual([99]);
  });

  it('gives neighbouring ports distinct test pitches', () => {
    const f = Array.from({ length: 48 }, (_, i) => toneFrequency(i + 1));
    expect(new Set(f.map(x => x.toFixed(2))).size).toBe(48);
    expect(Math.min(...f)).toBeGreaterThanOrEqual(110);
    expect(toneFrequency(65)).not.toBe(toneFrequency(1));
    expect(toDb(1)).toBe(0);
    expect(toDb(0)).toBe(-90);
  });
});
