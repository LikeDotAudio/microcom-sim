// 'Recently said' (MicroCOM 2026 panel screen): talk segments from live microphones, kept 10 minutes
// (port of mcommatrix/history.py). An energy detector with hangover cuts each live source into segments;
// while a segment is open every station that received it is noted, so each panel can list exactly what
// was said to it and replay it. Captions: the Python engine runs faster-whisper; the browser engine has
// no speech-to-text, so items keep text = null (the panel shows the audio only).
import type { Engine } from './engine';
import { RATE } from './audio';
import { now } from './engine';

const KEEP_SECONDS = 600;
const OPEN_RMS = 0.02;
const CLOSE_AFTER = 0.6;
const MIN_SECONDS = 0.35;
const MAX_SECONDS = 30;

export class Segment {
  dsts = new Set<number>();
  frames: Float32Array[] = [];
  t1 = 0;
  quiet = 0;
  text: string | null = null;
  words: [number, number, string][] | null = null;
  constructor(readonly id: number, readonly src: number, readonly t0: number) {}

  item() {
    return { id: this.id, src: this.src, dsts: [...this.dsts].sort((a, b) => a - b), t0: this.t0,
      t1: this.t1 || now(), text: this.text, words: this.words };
  }
}

export class History {
  open = new Map<number, Segment>();
  done: Segment[] = [];
  private ids = 1;

  constructor(private engine: Engine) {}

  // ---- capture (called by the audio hub every 20 ms per live source frame) -------------------
  frame(src: number, pcm: Float32Array, rms: number, dsts: Set<number>) {
    let seg = this.open.get(src);
    if (!seg) {
      if (rms < OPEN_RMS) return;
      seg = new Segment(this.ids++, src, now() - 0.02);
      this.open.set(src, seg);
    }
    seg.frames.push(pcm);
    for (const d of dsts) seg.dsts.add(d);
    seg.quiet = rms < OPEN_RMS ? seg.quiet + 0.02 : 0.0;
    if (seg.quiet >= CLOSE_AFTER || seg.frames.length * 0.02 >= MAX_SECONDS) this.close(src);
  }

  sourceGone(src: number) { if (this.open.has(src)) this.close(src); }

  private close(src: number) {
    const seg = this.open.get(src)!;
    this.open.delete(src);
    seg.t1 = now() - seg.quiet;
    const keep = Math.round((seg.frames.length * 0.02 - seg.quiet) / 0.02) + 5;
    seg.frames = seg.frames.slice(0, Math.max(keep, 1));
    if (seg.frames.length * 0.02 < MIN_SECONDS || !seg.dsts.size) return;
    this.done.push(seg);
    this.expire();
    this.engine.publish({ t: 'said', item: seg.item() });
  }

  private expire() {
    const cutoff = now() - KEEP_SECONDS;
    while (this.done.length && this.done[0].t1 < cutoff) this.done.shift();
  }

  // ---- queries ---------------------------------------------------------------------------------
  forPorts(ports: Set<number>) {
    this.expire();
    return this.done.filter(s => ports.has(s.src) || [...s.dsts].some(d => ports.has(d))).map(s => s.item());
  }

  get(id: number): Segment | undefined { return this.done.find(s => s.id === id); }

  static wav(seg: Segment): ArrayBuffer {
    const n = seg.frames.reduce((a, f) => a + f.length, 0);
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44;
    for (const f of seg.frames) for (const x of f) { v.setInt16(o, Math.trunc(Math.max(-1, Math.min(1, x)) * 32767), true); o += 2; }
    return buf;
  }
}
