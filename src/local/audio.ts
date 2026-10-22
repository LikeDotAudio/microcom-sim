// Intercom audio through the emulated crosspoints (port of mcommatrix/audio.py). Clients send their
// station's microphone as binary frames (16 kHz mono int16, 320 samples = 20 ms). Every 20 ms the hub
// takes one frame per live source and, for every station with a listening client, sums the sources
// routed to it (route gain applied) and sends the mix back. Remote ports can carry a quiet synthetic
// program tone so IFB/program feeds are audible without a second person.
import type { Engine } from './engine';
import type { History } from './history';

export const RATE = 16000;
export const FRAME = 320;
export const FRAME_BYTES = FRAME * 2;
const MAX_QUEUE = 8;

export type Send = (data: ArrayBuffer) => void;

export const rmsOf = (f: Float32Array) => { let s = 0; for (const v of f) s += v * v; return Math.sqrt(s / f.length); };

export class AudioHub {
  sources = new Map<number, Float32Array[]>();
  listeners = new Map<number, Set<Send>>();
  t = 0;
  levels = new Map<number, number>();
  private nextT = 0;

  constructor(private engine: Engine, private tones = true, private history: History | null = null) {}

  // ---- clients ---------------------------------------------------------------------
  addListener(gid: number, send: Send) {
    let s = this.listeners.get(gid);
    if (!s) this.listeners.set(gid, s = new Set());
    s.add(send);
  }

  removeListener(gid: number, send: Send) {
    const s = this.listeners.get(gid);
    if (!s) return;
    s.delete(send);
    if (!s.size) {
      this.listeners.delete(gid);
      this.sources.delete(gid);
      this.history?.sourceGone(gid);
    }
  }

  micFrame(gid: number, data: ArrayBuffer) {
    if (data.byteLength !== FRAME_BYTES) return;
    let q = this.sources.get(gid);
    if (!q) this.sources.set(gid, q = []);
    const v = new DataView(data);
    const f = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) f[i] = v.getInt16(i * 2, true) / 32768.0;
    q.push(f);
    if (q.length > MAX_QUEUE) q.shift();
  }

  // ---- synthetic program sources ----------------------------------------------------------
  /** A soft two-tone 'program' bed, pitch distinct per port. */
  tone(gid: number): Float32Array {
    const out = new Float32Array(FRAME);
    const f = 220.0 * 2 ** ((gid % 12) / 12);
    for (let i = 0; i < FRAME; i++) {
      const n = this.t + i;
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * n / RATE);
      out[i] = 0.06 * env * (Math.sin(2 * Math.PI * f * n / RATE) + 0.5 * Math.sin(2 * Math.PI * 1.5 * f * n / RATE));
    }
    return out;
  }

  private synthetic(): Set<number> {
    if (!this.tones) return new Set();
    return new Set(this.engine.profile.portList.filter(p => p.kind === 'remote').map(p => p.gid));
  }

  /** Publish live mic levels (called ~8 times a second). */
  meters() {
    if (!this.levels.size) return;
    for (const g of [...this.levels.keys()]) {
      if (!this.sources.has(g)) {
        const v = this.levels.get(g)! * 0.5;
        if (v < 1e-4) this.levels.delete(g); else this.levels.set(g, v);
      }
    }
    this.engine.publish({ t: 'levels', levels: Object.fromEntries([...this.levels].map(([g, v]) => [String(g), Math.round(v * 1e4) / 1e4])) });
  }

  // ---- mixer ---------------------------------------------------------------------------------
  /** Run every few ms: mixes as many 20 ms frames as wall-clock time calls for. */
  pump(nowSec: number) {
    const period = FRAME / RATE;
    if (!this.nextT) this.nextT = nowSec;
    if (nowSec - this.nextT > 0.2) this.nextT = nowSec;       // fell far behind (suspended?): resync
    while (this.nextT <= nowSec) {
      this.nextT += period;
      if (this.listeners.size) this.tick();
      this.t += FRAME;
    }
  }

  tick() {
    const frames = new Map<number, Float32Array>();
    for (const [gid, q] of this.sources) {
      if (q.length) {
        const fr = q.shift()!;
        frames.set(gid, fr);
        this.levels.set(gid, Math.max(rmsOf(fr), (this.levels.get(gid) ?? 0) * 0.85));
      }
    }
    const synth = this.synthetic();
    const incoming = new Map<number, { src: number; gain: number }[]>();
    for (const dst of this.listeners.keys()) incoming.set(dst, []);
    const reach = new Map<number, Set<number>>();
    for (const src of frames.keys()) reach.set(src, new Set());
    for (const r of this.engine.routes.values()) {
      if (r.gain <= 0) continue;
      reach.get(r.src)?.add(r.dst);
      if (incoming.has(r.dst) && (frames.has(r.src) || synth.has(r.src))) incoming.get(r.dst)!.push(r);
    }
    if (this.history) {                    // 'recently said' capture (2026 panel screens)
      for (const [src, fr] of frames) this.history.frame(src, fr, rmsOf(fr), reach.get(src)!);
      for (const src of [...this.history.open.keys()]) {
        if (!frames.has(src)) this.history.frame(src, new Float32Array(FRAME), 0.0, new Set());
      }
    }
    for (const [dst, rs] of incoming) {
      if (!rs.length) continue;
      const mix = new Float32Array(FRAME);
      for (const r of rs) {
        const src = frames.get(r.src) ?? this.tone(r.src);
        for (let i = 0; i < FRAME; i++) mix[i] += src[i] * r.gain;
      }
      const out = new ArrayBuffer(FRAME_BYTES);
      const v = new DataView(out);
      for (let i = 0; i < FRAME; i++) v.setInt16(i * 2, Math.trunc(Math.max(-1, Math.min(1, mix[i])) * 32767), true);
      for (const send of [...(this.listeners.get(dst) ?? [])]) {
        try { send(out.slice(0)); } catch { /* a closing connection; removed on disconnect */ }
      }
    }
  }
}
