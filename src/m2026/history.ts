// 'Recently said' screen maths (pure): the 10-minute timeline, scrubbing, word highlighting during replay,
// unread/missed bookkeeping and LED-text wrapping.
import type { SaidItem, SaidWord } from '../matrix/types';

export const SPAN = 600;          // seconds shown on the scrubber (the engine keeps 10 minutes)

/** Timeline x of time t: `now` at the right edge (x0 + w), now - span at the left edge. Clamped. */
export function timeToX(t: number, now: number, x0: number, w: number, span = SPAN): number {
  const f = 1 - (now - t) / span;
  return x0 + w * Math.max(0, Math.min(1, f));
}

/** Inverse of timeToX (clamped to the visible window). */
export function xToTime(x: number, now: number, x0: number, w: number, span = SPAN): number {
  const f = Math.max(0, Math.min(1, (x - x0) / w));
  return now - span * (1 - f);
}

/** Items in time order that concern a station (said to it, or by it), within the window. */
export function itemsFor(all: Iterable<SaidItem>, pred: (it: SaidItem) => boolean, now: number, span = SPAN): SaidItem[] {
  return [...all].filter(it => pred(it) && it.t1 >= now - span).sort((a, b) => a.t0 - b.t0 || a.id - b.id);
}

/**
 * The item at time t: one whose [t0, t1] contains t, else the nearest within `tol` seconds; -1 if none.
 * Items must be time-ordered; later items win ties (the most recent talker).
 */
export function itemAt(items: SaidItem[], t: number, tol = 15): number {
  let best = -1, bestD = Infinity;
  items.forEach((it, i) => {
    const d = t < it.t0 ? it.t0 - t : t > it.t1 ? t - it.t1 : 0;
    if (d <= bestD && d <= tol) { best = i; bestD = d; }
  });
  return best;
}

/** Index of the word being spoken `rel` seconds into the clip (-1 before the first word). */
export function activeWord(words: SaidWord[] | null | undefined, rel: number): number {
  if (!words?.length) return -1;
  let idx = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i][0] <= rel) idx = i; else break;
  }
  return idx;
}

/** Short 'how long ago' label for the LED screen. */
export function agoLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60), r = s % 60;
  return m < 10 && r >= 10 ? `${m}m ${String(r).padStart(2, '0')}s ago` : `${m}m ago`;
}

export const itemKey = (it: Pick<SaidItem, 'id' | 't0'>) => `${it.id}:${Math.round(it.t0)}`;

export interface ReadState { seen: Set<string>; missed: Set<string> }

export function counts(items: SaidItem[], rs: ReadState, self?: number): { unread: number; missed: number } {
  let unread = 0, missed = 0;
  for (const it of items) {
    if (it.src === self) continue;               // own words are never unread
    const k = itemKey(it);
    if (!rs.seen.has(k)) unread++;
    if (rs.missed.has(k) && !rs.seen.has(k)) missed++;
  }
  return { unread, missed };
}

/** Word-wrap text into at most `maxLines` lines of `width` characters (ellipsis on overflow). */
export function wrap(text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w0 of words) {
    const w = w0.length > width ? `${w0.slice(0, width - 1)}…` : w0;
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    const last = keep[maxLines - 1];
    keep[maxLines - 1] = last.length >= width ? `${last.slice(0, width - 1)}…` : `${last}…`;
    return keep;
  }
  return lines;
}

/**
 * Lay caption words out on lines of `width` characters, keeping each word's index (for highlighting the
 * word being replayed). When the text overflows `maxLines`, the window scrolls to keep `focus` visible.
 */
export function wordLines(words: string[], width: number, maxLines: number, focus = 0): { i: number; w: string }[][] {
  const lines: { i: number; w: string }[][] = [];
  let cur: { i: number; w: string }[] = [], len = 0;
  words.forEach((raw, i) => {
    const w = raw.trim();
    if (!w) return;
    if (cur.length && len + 1 + w.length > width) { lines.push(cur); cur = []; len = 0; }
    len += (cur.length ? 1 : 0) + w.length;
    cur.push({ i, w });
  });
  if (cur.length) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const at = Math.max(0, lines.findIndex(l => l.some(x => x.i >= focus)));
  const start = Math.min(Math.max(0, at - 1), lines.length - maxLines);
  return lines.slice(start, start + maxLines);
}

/** Speaker lane (0..lanes-1) per item so overlapping talkers sit on separate scrubber rows. */
export function lanes(items: SaidItem[], n = 3): number[] {
  const ends: number[] = Array(n).fill(-Infinity);
  return items.map(it => {
    let lane = ends.findIndex(e => e <= it.t0);
    if (lane < 0) lane = ends.indexOf(Math.min(...ends));
    ends[lane] = it.t1;
    return lane;
  });
}
