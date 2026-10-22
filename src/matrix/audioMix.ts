// Pure audio-mix logic: which port inputs (and at what gain) feed a destination port's output.
import type { Route } from './types';

export type SourceKind = 'tone' | 'speech' | 'noise' | 'off' | 'mic' | 'file';
export const SOURCE_KINDS: SourceKind[] = ['tone', 'speech', 'noise', 'off', 'mic', 'file'];

export interface MixEntry { src: number; gain: number; kind: Route['kind']; via: string }

/**
 * Mix heard at `dst`'s output: every route whose dst is that port, the source's input scaled by the route
 * gain. Sources whose input is switched off and muted routes (gain 0) are omitted. Sorted by src.
 */
export function computeMix(routesToDst: Iterable<Route> | undefined, dst: number,
  sourceKind: (gid: number) => SourceKind = () => 'tone'): MixEntry[] {
  const best = new Map<number, MixEntry>();
  for (const r of routesToDst ?? []) {
    if (r.dst !== dst || r.src === dst || !(r.gain > 0)) continue;
    if (sourceKind(r.src) === 'off') continue;
    const cur = best.get(r.src);
    if (!cur || r.gain > cur.gain) best.set(r.src, { src: r.src, gain: r.gain, kind: r.kind, via: r.via });
  }
  return [...best.values()].sort((a, b) => a.src - b.src);
}

export interface MixDiff { add: MixEntry[]; change: MixEntry[]; remove: number[] }

/** What changed between two mixes (by source). */
export function diffMix(prev: Map<number, number>, next: MixEntry[]): MixDiff {
  const out: MixDiff = { add: [], change: [], remove: [] };
  const seen = new Set<number>();
  for (const e of next) {
    seen.add(e.src);
    const g = prev.get(e.src);
    if (g === undefined) out.add.push(e);
    else if (Math.abs(g - e.gain) > 1e-6) out.change.push(e);
  }
  for (const src of prev.keys()) if (!seen.has(src)) out.remove.push(src);
  return out;
}

/** Distinct test pitch per port: semitone steps over 4 octaves from 110 Hz, detuned per facility. */
export function toneFrequency(gid: number, slice = 64): number {
  const local = (gid - 1) % slice;
  const facility = Math.floor((gid - 1) / slice);
  const semis = (local * 7) % 48;            // fifths walk: neighbouring ports are far apart in pitch
  return 110 * 2 ** (semis / 12) * (1 + facility * 0.0029);
}

/** Linear gain -> dBFS (floored). */
export function toDb(v: number, floor = -90): number {
  return v > 0 ? Math.max(floor, 20 * Math.log10(v)) : floor;
}
