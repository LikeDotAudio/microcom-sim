// Acoustic proximity calibration (MicroCOM 2026), port of mcommatrix/proximity.py: idle panels take
// turns playing a short, quiet 18-19.5 kHz blip; every other panel with audio on measures that band and
// reports the SNR. The engine keeps a smoothed 'near' score per pair. Detection happens in the pages.
import type { AudioHub } from './audio';
import type { Engine } from './engine';
import type { History } from './history';
import { now } from './engine';

const BAND: [number, number] = [18000, 19500];
const NEAR_DB = 8.0;
export const PERIOD = 15.0;

export class Proximity {
  scores = new Map<string, number>();                 // "emitter,listener" -> smoothed SNR dB
  current: { id: number; gid: number; listeners: Set<number> } | null = null;
  private lastBusy = new Map<number, number>();

  constructor(private engine: Engine, private hub: AudioHub, private history: History) {}

  idle(gid: number): boolean {
    if (this.history.open.has(gid)) { this.lastBusy.set(gid, now()); return false; }
    for (const r of this.engine.routes.values()) {
      if ((r.src === gid || r.dst === gid) && !['pgm', 'cpl', 'perm'].includes(r.kind) && r.gain > 0) {
        this.lastBusy.set(gid, now());
        return false;
      }
    }
    return now() - (this.lastBusy.get(gid) ?? 0) > 10;
  }

  /** One calibration round (the host calls this every PERIOD * uniform(0.7, 1.3) s). */
  round() {
    const joined = [...this.hub.listeners.keys()];
    if (joined.length < 2) return;
    const idle = joined.filter(g => this.idle(g));
    if (!idle.length) return;
    const gid = idle[Math.floor(Math.random() * idle.length)];
    this.current = { id: Math.floor(now() * 1000), gid, listeners: new Set(joined.filter(g => g !== gid)) };
    this.engine.publish({ t: 'blip', id: this.current.id, gid, in: 0.6, dur: 0.25, band: [...BAND] });
  }

  heard(listener: number, blipId: number, emitter: number, snrDb: number) {
    const cur = this.current;
    if (!cur || cur.id !== blipId || cur.gid !== emitter || !cur.listeners.has(listener)) return;
    cur.listeners.delete(listener);
    const key = `${emitter},${listener}`;
    const old = this.scores.get(key);
    this.scores.set(key, old === undefined ? snrDb : 0.7 * old + 0.3 * snrDb);
    this.engine.publish({ t: 'near', near: this.near() });
  }

  /** Symmetric 'same room' pairs: [a, b, score]. */
  near(): [number, number, number][] {
    const out = new Map<string, number>();
    for (const [k, s] of this.scores) {
      const [a, b] = k.split(',').map(Number);
      const kk = `${Math.min(a, b)},${Math.max(a, b)}`;
      out.set(kk, Math.max(out.get(kk) ?? -99.0, s));
    }
    return [...out].filter(([, s]) => s >= NEAR_DB).map(([k, s]) => {
      const [a, b] = k.split(',').map(Number);
      return [a, b, Math.round(s * 10) / 10];
    });
  }
}
