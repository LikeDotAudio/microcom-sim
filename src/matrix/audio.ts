// WebAudio monitor: plays the mix a destination port's output receives. Source nodes are created lazily,
// only for inputs that currently feed the monitored port; crosspoint gains ramp (~20 ms) on changes.
import { toneFrequency, type MixEntry, type SourceKind } from './audioMix';

const RAMP = 0.02;

interface SourceNode { kind: SourceKind; out: AudioNode; stop: () => void }
interface Crosspoint { gain: GainNode; src: SourceNode | null; target: number; dispose?: ReturnType<typeof setTimeout> }

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private analyser!: AnalyserNode;
  private xps = new Map<number, Crosspoint>();
  private kinds = new Map<number, SourceKind>();
  private files = new Map<number, AudioBuffer>();
  private fileNames = new Map<number, string>();
  private pink: AudioBuffer | null = null;
  private micStream: MediaStream | null = null;
  private buf = new Float32Array(2048);
  defaultKind: SourceKind = 'tone';
  micGid: number | null = null;
  slice = 64;
  volume = 0.5;
  muted = false;

  get enabled() { return !!this.ctx; }

  /** Must be called from a user gesture. */
  async enable() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 4; limiter.ratio.value = 12;
    limiter.attack.value = 0.003; limiter.release.value = 0.1;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(limiter).connect(this.analyser).connect(ctx.destination);
    await ctx.resume();
  }

  sourceKind(gid: number): SourceKind {
    if (this.micGid === gid) return 'mic';
    const k = this.kinds.get(gid);
    if (k === 'mic') return this.defaultKind;     // mic moved to another port
    return k ?? this.defaultKind;
  }

  hasOverride(gid: number) { return this.kinds.has(gid) || this.micGid === gid; }
  fileName(gid: number) { return this.fileNames.get(gid); }

  setVolume(v: number) { this.volume = v; this.applyMaster(); }
  setMuted(m: boolean) { this.muted = m; this.applyMaster(); }
  private applyMaster() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, RAMP / 3);
  }

  /** Per-port source selection ('default' clears the override). */
  async setSource(gid: number, kind: SourceKind | 'default') {
    if (kind === 'mic') {
      await this.ensureMic();
      const prev = this.micGid;
      this.micGid = gid;
      this.kinds.set(gid, 'mic');
      if (prev !== null && prev !== gid) { this.kinds.delete(prev); this.rebuild(prev); }
    } else {
      if (this.micGid === gid) this.micGid = null;
      if (kind === 'default') this.kinds.delete(gid); else this.kinds.set(gid, kind);
    }
    this.rebuild(gid);
  }

  setDefaultKind(kind: SourceKind) {
    this.defaultKind = kind;
    for (const gid of this.xps.keys()) if (!this.hasOverride(gid)) this.rebuild(gid);
  }

  async loadFile(gid: number, file: File) {
    if (!this.ctx) await this.enable();
    const data = await file.arrayBuffer();
    this.files.set(gid, await this.ctx!.decodeAudioData(data));
    this.fileNames.set(gid, file.name);
    this.kinds.set(gid, 'file');
    if (this.micGid === gid) this.micGid = null;
    this.rebuild(gid);
  }

  private async ensureMic() {
    if (this.micStream) return;
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
  }

  /** Apply a new mix for the monitored port (entries from computeMix). */
  setMix(mix: MixEntry[]) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const want = new Map(mix.map(e => [e.src, e.gain]));
    for (const [src, gain] of want) {
      let xp = this.xps.get(src);
      if (!xp) {
        const g = ctx.createGain();
        g.gain.value = 0;
        g.connect(this.master);
        xp = { gain: g, src: null, target: 0 };
        this.xps.set(src, xp);
        this.attach(src, xp);
      }
      if (xp.dispose) { clearTimeout(xp.dispose); xp.dispose = undefined; }
      if (xp.target !== gain) {
        xp.target = gain;
        xp.gain.gain.cancelScheduledValues(now);
        xp.gain.gain.setValueAtTime(xp.gain.gain.value, now);
        xp.gain.gain.linearRampToValueAtTime(gain, now + RAMP);
      }
    }
    for (const [src, xp] of this.xps) {
      if (want.has(src) || xp.dispose) continue;
      xp.target = 0;
      xp.gain.gain.cancelScheduledValues(now);
      xp.gain.gain.setValueAtTime(xp.gain.gain.value, now);
      xp.gain.gain.linearRampToValueAtTime(0, now + RAMP);
      xp.dispose = setTimeout(() => {
        xp.src?.stop();
        xp.gain.disconnect();
        this.xps.delete(src);
      }, RAMP * 1000 + 60);
    }
  }

  /** Swap a port's source node (after a source-kind change) with a short dip. */
  private rebuild(gid: number) {
    const xp = this.xps.get(gid);
    if (!xp || !this.ctx) return;
    const old = xp.src;
    const now = this.ctx.currentTime;
    xp.gain.gain.cancelScheduledValues(now);
    xp.gain.gain.setValueAtTime(xp.gain.gain.value, now);
    xp.gain.gain.linearRampToValueAtTime(0, now + RAMP);
    setTimeout(() => {
      old?.stop();
      if (this.xps.get(gid) !== xp) return;
      this.attach(gid, xp);
      const t = this.ctx!.currentTime;
      xp.gain.gain.setValueAtTime(0, t);
      xp.gain.gain.linearRampToValueAtTime(xp.target, t + RAMP);
    }, RAMP * 1000 + 10);
  }

  private attach(gid: number, xp: Crosspoint) {
    xp.src = this.makeSource(gid, this.sourceKind(gid));
    xp.src?.out.connect(xp.gain);
  }

  private makeSource(gid: number, kind: SourceKind): SourceNode | null {
    const ctx = this.ctx!;
    const level = ctx.createGain();
    const nodes: AudioScheduledSourceNode[] = [];
    const start = (n: AudioScheduledSourceNode) => { nodes.push(n); n.start(); };
    switch (kind) {
      case 'off': return null;
      case 'tone': {
        const o = ctx.createOscillator();
        o.frequency.value = toneFrequency(gid, this.slice);
        level.gain.value = 0.2;
        o.connect(level); start(o);
        break;
      }
      case 'speech': {                          // speech-like: buzzy carrier, formant band, syllabic AM
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 95 + ((gid * 37) % 120);
        const vib = ctx.createOscillator(); vib.frequency.value = 0.7 + (gid % 5) * 0.13;
        const vibAmt = ctx.createGain(); vibAmt.gain.value = 12;
        vib.connect(vibAmt).connect(o.frequency);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = 700 + ((gid * 53) % 900); bp.Q.value = 1.2;
        const am = ctx.createGain(); am.gain.value = 0.5;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 3 + (gid % 7) * 0.35;
        const depth = ctx.createGain(); depth.gain.value = 0.5;
        lfo.connect(depth).connect(am.gain);
        level.gain.value = 0.5;
        o.connect(bp).connect(am).connect(level);
        start(o); start(vib); start(lfo);
        break;
      }
      case 'noise': {
        const b = ctx.createBufferSource();
        b.buffer = this.pinkNoise();
        b.loop = true;
        level.gain.value = 0.35;
        b.connect(level);
        nodes.push(b);
        b.start(0, Math.random() * b.buffer.duration);
        break;
      }
      case 'mic': {
        if (!this.micStream) return null;
        const m = ctx.createMediaStreamSource(this.micStream);
        level.gain.value = 1;
        m.connect(level);
        return { kind, out: level, stop: () => { m.disconnect(); level.disconnect(); } };
      }
      case 'file': {
        const buf = this.files.get(gid);
        if (!buf) return null;
        const b = ctx.createBufferSource();
        b.buffer = buf; b.loop = true;
        level.gain.value = 0.8;
        b.connect(level); start(b);
        break;
      }
    }
    return {
      kind, out: level,
      stop: () => { for (const n of nodes) { try { n.stop(); } catch { /* already stopped */ } n.disconnect(); } level.disconnect(); },
    };
  }

  private pinkNoise(): AudioBuffer {
    if (this.pink) return this.pink;
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;   // Paul Kellet's refined method
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return (this.pink = buf);
  }

  /** Output level (after master + limiter): peak and RMS, linear. */
  level(): { peak: number; rms: number } {
    if (!this.ctx) return { peak: 0, rms: 0 };
    this.analyser.getFloatTimeDomainData(this.buf);
    let peak = 0, sum = 0;
    for (const v of this.buf) { const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
    return { peak, rms: Math.sqrt(sum / this.buf.length) };
  }

  activeSources(): number[] { return [...this.xps.keys()].filter(k => !this.xps.get(k)!.dispose); }
}
