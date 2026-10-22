// Acoustic proximity (MicroCOM 2026): while this panel has intercom audio on, it answers the engine's
// calibration blips. When the blip is ours we play a short, quiet tone in the 18-19.5 kHz band through
// the speaker; otherwise we measure that band on a raw microphone capture (echo cancellation, noise
// suppression and AGC off, device sample rate) during the blip vs. the noise just before it, and report
// {t:'heard', snr}. The engine turns the reports into same-room pairs ({t:'near'}).
import type { Store } from '../matrix/store';
import type { Blip } from '../matrix/types';
import type { MatrixClient } from '../matrix/ws';
import { bandPower, blipFreq, blipSnr, type BlockPower } from './goertzel';

const BLOCK = 1024;
const TAP = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${BLOCK}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === ${BLOCK}) {
        this.port.postMessage({ t: currentTime, x: this.buf }, [this.buf.buffer]);
        this.buf = new Float32Array(${BLOCK}); this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('m26-tap', Tap);
`;

export const BLIP_LEVEL = 0.05;       // ≈ -26 dBFS: quiet, and above hearing range for most adults

export interface ProxStatus {
  state: 'off' | 'starting' | 'on' | 'unsupported' | 'error';
  rate: number; note: string;
  emitted: number; measured: number; lastSnr: number | null; lastEmitter: number | null;
}

interface Pending { blip: Blip; t: number; done: boolean }

export class ProximityAgent {
  status: ProxStatus = { state: 'off', rate: 0, note: '', emitted: 0, measured: 0, lastSnr: null, lastEmitter: null };
  onChange: (() => void) | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private blocks: BlockPower[] = [];
  private pending: Pending[] = [];
  private unsub: (() => void) | null = null;

  /** `gid()` = the station whose audio this page has joined (null = audio off). */
  constructor(private store: Store, private client: MatrixClient, private gid: () => number | null) {}

  get running() { return this.status.state === 'on' || this.status.state === 'starting'; }

  async start() {
    if (this.running) return;
    this.set({ state: 'starting', note: '' });
    this.unsub = this.store.subscribe((t, data) => { if (t === 'blip') this.onBlip(data as Blip); });
    try {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      const rate = this.ctx.sampleRate;
      if (rate < 40000) { this.set({ state: 'unsupported', rate, note: `device runs at ${rate} Hz; the 18–19.5 kHz band needs ≥ 40 kHz` }); return; }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const src = this.ctx.createMediaStreamSource(this.stream);
      const tap = new AudioWorkletNode(this.ctx, 'm26-tap', { numberOfInputs: 1, numberOfOutputs: 0 });
      tap.port.onmessage = e => this.onBlock(e.data as { t: number; x: Float32Array });
      src.connect(tap);
      await this.ctx.resume();
      this.set({ state: 'on', rate, note: '' });
    } catch (e) {
      this.set({ state: 'error', note: (e as Error).message });
      this.stopAudio();
    }
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
    this.stopAudio();
    this.pending = [];
    this.set({ state: 'off', note: '' });
  }

  private stopAudio() {
    this.stream?.getTracks().forEach(t => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
  }

  private set(p: Partial<ProxStatus>) { Object.assign(this.status, p); this.onChange?.(); }

  /** Server announced a blip: play it (ours) or measure it (someone else's). */
  onBlip(b: Blip) {
    const me = this.gid();
    if (!me || !this.ctx || this.status.state !== 'on') return;
    if (b.gid === me) this.emit(b);
    else this.pending.push({ blip: b, t: this.ctx.currentTime, done: false });
  }

  private emit(b: Blip) {
    const ctx = this.ctx!;
    const f = blipFreq(b.band);
    const t0 = ctx.currentTime + b.in;
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(BLIP_LEVEL, t0 + 0.012);
    g.gain.setValueAtTime(BLIP_LEVEL, t0 + b.dur - 0.012);
    g.gain.linearRampToValueAtTime(0, t0 + b.dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + b.dur + 0.02);
    this.set({ emitted: this.status.emitted + 1 });
  }

  private onBlock(m: { t: number; x: Float32Array }) {
    if (!this.pending.length || !this.ctx) return;
    const band = this.pending[0].blip.band;
    this.blocks.push({ t: m.t, p: bandPower(m.x, this.ctx.sampleRate, band, blipFreq(band)) });
    const now = this.ctx.currentTime;
    for (const p of this.pending) {
      const { blip } = p;
      if (p.done || now < p.t + blip.in + blip.dur + 0.3) continue;
      p.done = true;
      // baseline: from the announcement until just before the blip; window: the blip (+ network slack)
      const snr = blipSnr(this.blocks, p.t + 0.05, p.t + blip.in - 0.05, p.t + blip.in - 0.02, p.t + blip.in + blip.dur + 0.2);
      const me = this.gid();
      if (snr !== null && me) {
        this.client.send({ t: 'heard', gid: me, blip: blip.id, emitter: blip.gid, snr });
        this.set({ measured: this.status.measured + 1, lastSnr: snr, lastEmitter: blip.gid });
      }
    }
    this.pending = this.pending.filter(p => !p.done);
    if (!this.pending.length) this.blocks = [];
    else this.blocks = this.blocks.filter(b => b.t > now - 4);
  }
}
