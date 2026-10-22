import { describe, expect, it } from 'vitest';
import {
  activeWord, agoLabel, counts, itemAt, itemKey, itemsFor, lanes, SPAN, timeToX, wordLines, wrap, xToTime,
} from '../../src/m2026/history';
import type { SaidItem } from '../../src/matrix/types';

const it_ = (id: number, src: number, t0: number, t1: number, dsts = [5]): SaidItem =>
  ({ id, src, dsts, t0, t1, text: null, words: null });

describe('timeline / scrubber', () => {
  const now = 10_000;
  it('maps now to the right edge and now-10min to the left edge', () => {
    expect(SPAN).toBe(600);
    expect(timeToX(now, now, 10, 200)).toBe(210);
    expect(timeToX(now - 600, now, 10, 200)).toBe(10);
    expect(timeToX(now - 300, now, 10, 200)).toBe(110);
    expect(timeToX(now - 9999, now, 10, 200)).toBe(10);   // clamped
  });
  it('inverts x back to time', () => {
    for (const t of [now, now - 1, now - 250, now - 600]) expect(xToTime(timeToX(t, now, 10, 200), now, 10, 200)).toBeCloseTo(t);
    expect(xToTime(-50, now, 10, 200)).toBe(now - 600);
  });
  it('filters and orders items for a station within the window', () => {
    const all = [it_(3, 1, now - 20, now - 18), it_(1, 1, now - 900, now - 890), it_(2, 9, now - 100, now - 95, [7])];
    expect(itemsFor(all, i => i.dsts.includes(5), now).map(i => i.id)).toEqual([3]);
    expect(itemsFor(all, () => true, now).map(i => i.id)).toEqual([2, 3]);
  });
  it('finds the item under the scrub cursor, even late talkers', () => {
    const items = [it_(1, 1, 100, 104), it_(2, 2, 110, 111), it_(3, 3, 300, 305)];
    expect(itemAt(items, 102)).toBe(0);
    expect(itemAt(items, 108)).toBe(1);       // nearest
    expect(itemAt(items, 200)).toBe(-1);      // nothing within tolerance
    expect(itemAt(items, 200, 120)).toBe(1);      // 89 s after #2 beats 100 s before #3
  });
  it('puts overlapping talkers on separate lanes', () => {
    const items = [it_(1, 1, 0, 10), it_(2, 2, 5, 8), it_(3, 3, 9, 12), it_(4, 4, 20, 22)];
    expect(lanes(items)).toEqual([0, 1, 1, 0]);
  });
});

describe('replay word highlight', () => {
  const words: [number, number, string][] = [[0, 0.4, 'Ready'], [0.5, 0.9, 'camera'], [1.0, 1.3, 'two']];
  it('tracks the spoken word', () => {
    expect(activeWord(words, -0.1)).toBe(-1);
    expect(activeWord(words, 0.2)).toBe(0);
    expect(activeWord(words, 0.95)).toBe(1);
    expect(activeWord(words, 5)).toBe(2);
    expect(activeWord(null, 1)).toBe(-1);
  });
  it('wraps word lines and scrolls to the focused word', () => {
    const w = 'one two three four five six seven eight nine ten'.split(' ');
    const all = wordLines(w, 10, 9);
    expect(all.map(l => l.map(x => x.w).join(' '))).toEqual(['one two', 'three four', 'five six', 'seven', 'eight nine', 'ten']);
    const win = wordLines(w, 10, 2, 9);
    expect(win.flat().some(x => x.i === 9)).toBe(true);
    expect(win).toHaveLength(2);
  });
});

describe('labels and read state', () => {
  it('formats ago labels', () => {
    expect(agoLabel(2)).toBe('now');
    expect(agoLabel(42)).toBe('42s ago');
    expect(agoLabel(134)).toBe('2m 14s ago');
    expect(agoLabel(540)).toBe('9m ago');
  });
  it('wraps text with an ellipsis', () => {
    expect(wrap('the quick brown fox jumps', 10, 2)).toEqual(['the quick', 'brown fox…']);
    expect(wrap('ok', 10, 2)).toEqual(['ok']);
  });
  it('counts unread and missed, ignoring own words', () => {
    const items = [it_(1, 1, 10, 12), it_(2, 2, 20, 22), it_(3, 5, 30, 31)];
    const rs = { seen: new Set([itemKey(items[0])]), missed: new Set([itemKey(items[1])]) };
    expect(counts(items, rs, 5)).toEqual({ unread: 1, missed: 1 });
  });
});
