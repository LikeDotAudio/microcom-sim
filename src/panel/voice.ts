// Real intercom audio for a panel: the browser mic feeds this station's matrix input, and the station's
// matrix output (other people's voices mixed by the engine's crosspoints) plays back. Transport is the
// panel's WebSocket: 16 kHz mono int16, 320-sample (20 ms) binary frames in both directions.
import type { Store } from '../matrix/store';
import type { MatrixClient } from '../matrix/ws';

export const RATE = 16000;
export const FRAME = 320;

const WORKLETS = `
const RATE = ${RATE}, FRAME = ${FRAME};
// Mic: one-pole anti-alias low-pass, then linear-interpolated resampling to 16 kHz, posted in 20 ms frames.
class MicProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / RATE;            // input samples per output sample
    this.alpha = Math.min(1, 2 * Math.PI * 7000 / sampleRate);
    this.lp = 0; this.prev = 0; this.i = 0; this.t = 1;
    this.buf = new Int16Array(FRAME); this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let k = 0; k < ch.length; k++) {
      this.lp += this.alpha * (ch[k] - this.lp);
      this.i += 1;
      while (this.t <= this.i) {              // output position falls between input i-1 and i
        const v = this.prev + (this.lp - this.prev) * (this.t - (this.i - 1));
        this.buf[this.n++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
        if (this.n === FRAME) {
          this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Int16Array(FRAME); this.n = 0;
        }
        this.t += this.step;
      }
      this.prev = this.lp;
    }
    return true;
  }
}
// Speaker: 16 kHz frames queued (~60 ms jitter buffer), linear-interpolated up to the device rate.
class SpkProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = []; this.cur = null; this.idx = 0;
    this.step = RATE / sampleRate; this.frac = 0; this.a = 0; this.b = 0; this.primed = false;
    this.port.onmessage = e => {
      this.q.push(new Int16Array(e.data));
      if (this.q.length > 12) this.q.splice(0, this.q.length - 6);   // drift: drop backlog
    };
  }
  next() {
    if (!this.cur || this.idx >= this.cur.length) { this.cur = this.q.shift() || null; this.idx = 0; }
    if (!this.cur) return null;
    return this.cur[this.idx++] / 32768;
  }
  process(_in, outputs) {
    const out = outputs[0][0];
    if (!this.primed && this.q.length >= 3) this.primed = true;
    for (let k = 0; k < out.length; k++) {
      if (!this.primed) { this.b *= 0.98; out[k] = this.b; continue; }
      this.frac += this.step;
      while (this.frac >= 1) {
        this.frac -= 1;
        const v = this.next();
        if (v === null) { this.primed = false; break; }
        this.a = this.b; this.b = v;
      }
      out[k] = this.a + (this.b - this.a) * this.frac;
    }
    return true;
  }
}
registerProcessor('mcom-mic', MicProc);
registerProcessor('mcom-spk', SpkProc);
`;

export type VoiceState = 'off' | 'starting' | 'on' | 'error';

export class Voice {
  state: VoiceState = 'off';
  error = '';
  muted = false;
  gid: number | null = null;
  micLevel = 0;
  outLevel = 0;
  onChange: (() => void) | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private spk: AudioWorkletNode | null = null;
  private micAn: AnalyserNode | null = null;
  private outAn: AnalyserNode | null = null;
  private outGain: GainNode | null = null;
  private gainValue = 1;
  private meterTimer: ReturnType<typeof setInterval> | null = null;

  constructor(store: Store, private client: MatrixClient) {
    // the engine forgets audio membership when the socket drops: rejoin after every reconnect
    store.subscribe(t => { if (t === 'hello' && this.state === 'on' && this.gid) client.send({ t: 'audio', on: true, gid: this.gid }); });
    client.onBinary = buf => { this.spk?.port.postMessage(buf, [buf]); };
  }

  /** Microphone capture needs a secure context (HTTPS or localhost). */
  static supported(): string | null {
    if (!window.isSecureContext) return 'Microphone access needs HTTPS: open the https:// panel link.';
    if (!navigator.mediaDevices?.getUserMedia) return 'This browser cannot capture the microphone.';
    if (typeof AudioWorkletNode === 'undefined') return 'This browser has no AudioWorklet support.';
    return null;
  }

  async join(gid: number) {
    const why = Voice.supported();
    if (why) { this.fail(why); return; }
    this.gid = gid;
    this.set('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const ctx = this.ctx = new AudioContext({ latencyHint: 'interactive' });
      const url = URL.createObjectURL(new Blob([WORKLETS], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const src = ctx.createMediaStreamSource(this.stream);
      const mic = new AudioWorkletNode(ctx, 'mcom-mic', { numberOfInputs: 1, numberOfOutputs: 0 });
      mic.port.onmessage = e => { if (!this.muted) this.client.sendBinary(e.data as ArrayBuffer); };
      this.micAn = ctx.createAnalyser(); this.micAn.fftSize = 512;
      src.connect(mic); src.connect(this.micAn);
      this.spk = new AudioWorkletNode(ctx, 'mcom-spk', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      this.outAn = ctx.createAnalyser(); this.outAn.fftSize = 512;
      this.outGain = ctx.createGain();
      this.outGain.gain.value = this.gainValue;
      this.spk.connect(this.outGain).connect(this.outAn).connect(ctx.destination);
      await ctx.resume();
      this.client.send({ t: 'audio', on: true, gid });
      this.meterTimer = setInterval(() => this.meter(), 80);
      this.set('on');
    } catch (e) {
      this.leave();
      this.fail(e instanceof DOMException && e.name === 'NotAllowedError'
        ? 'Microphone permission was refused.' : `Audio failed: ${(e as Error).message}`);
    }
  }

  leave() {
    this.client.send({ t: 'audio', on: false });
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    this.stream?.getTracks().forEach(t => t.stop());
    void this.ctx?.close();
    this.ctx = this.stream = this.spk = this.micAn = this.outAn = this.outGain = null;
    this.micLevel = this.outLevel = 0;
    if (this.state !== 'error') this.set('off');
  }

  /** Earpiece / speaker level 0..1 (e.g. the turret's HEADSET knob). */
  setOutputGain(v: number) {
    this.gainValue = v;
    if (this.outGain && this.ctx) this.outGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.stream?.getAudioTracks().forEach(t => { t.enabled = !m; });
    this.onChange?.();
  }

  private meter() {
    const rms = (an: AnalyserNode | null) => {
      if (!an) return 0;
      const d = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(d);
      return Math.sqrt(d.reduce((a, v) => a + v * v, 0) / d.length);
    };
    this.micLevel = this.muted ? 0 : rms(this.micAn);
    this.outLevel = rms(this.outAn);
    this.onChange?.();
  }

  private set(s: VoiceState) { this.state = s; if (s !== 'error') this.error = ''; this.onChange?.(); }
  private fail(msg: string) { this.error = msg; this.state = 'error'; this.onChange?.(); }
}
