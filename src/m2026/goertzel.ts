// Proximity blip detection (pure): Goertzel tone power across the calibration band, and the SNR of a
// blip window against the noise floor measured just before it.

/** Power (amplitude²) of frequency `f` in x[start, start+len) at `rate` Hz (a sine of amplitude A → ≈A²). */
export function goertzel(x: ArrayLike<number>, f: number, rate: number, start = 0, len = x.length - start): number {
  if (len <= 0) return 0;
  const k = Math.round((len * f) / rate);
  const w = (2 * Math.PI * k) / len;
  const coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) {
    const s = x[start + i] + coeff * s1 - s2;
    s2 = s1; s1 = s;
  }
  const p = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.max(0, p) * (2 / len) ** 2;
}

/** Frequencies probed across a band: every DFT bin of a `len`-sample block that falls inside it. */
export function bandFreqs(band: [number, number], rate: number, len: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil((band[0] * len) / rate); k <= Math.floor((band[1] * len) / rate); k++) out.push((k * rate) / len);
  return out;
}

const hann = new Map<number, Float32Array>();
function hannOf(n: number): Float32Array {
  let w = hann.get(n);
  if (!w) {
    w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hann.set(n, w);
  }
  return w;
}

/** The blip tone every MicroCOM 2026 panel plays: the centre of the calibration band. */
export const blipFreq = (band: [number, number]) => (band[0] + band[1]) / 2;

/**
 * Tonal power of one block: the strongest bin within ±`focusHz` of `focus` (default: the whole band) minus
 * the band's median bin (Hann-windowed Goertzel over every bin in band). A tone there scores ≈ its
 * amplitude²; broadband clicks and noise, which lift all bins alike, and blocks whose strongest tone lies
 * elsewhere in the band score 0.
 */
export function bandPower(x: ArrayLike<number>, rate: number, band: [number, number], focus?: number, focusHz = 80): number {
  if (rate < 2 * band[1] || x.length < 16) return 0;      // the device cannot carry the band
  const n = x.length, w = hannOf(n), y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = x[i] * w[i];
  const fs = bandFreqs(band, rate, n);
  if (!fs.length) return 0;
  const p = fs.map(f => goertzel(y, f, rate));
  let peak = 0, elsewhere = 0;
  fs.forEach((f, i) => {
    if (focus === undefined || Math.abs(f - focus) <= focusHz) peak = Math.max(peak, p[i]);
    else elsewhere = Math.max(elsewhere, p[i]);
  });
  if (elsewhere > peak) return 0;                          // the band's strongest tone is not ours
  const median = [...p].sort((a, b) => a - b)[Math.floor(p.length / 2)];
  return Math.max(0, peak - median) * 4;                   // Hann coherent gain 0.5 → amplitude²
}

/** Noise floor for SNRs (amplitude², ≈ -90 dBFS): digital silence must not make any blip look loud. */
export const NOISE_FLOOR = 1e-9;

export interface BlockPower { t: number; p: number }

/**
 * SNR (dB) of a blip: the strongest block inside [t0, t1] against the median block power in the
 * baseline window [b0, b1). Returns null if either window has no blocks.
 */
export function blipSnr(blocks: BlockPower[], b0: number, b1: number, t0: number, t1: number): number | null {
  const base = blocks.filter(b => b.t >= b0 && b.t < b1).map(b => b.p).sort((a, b) => a - b);
  const win = blocks.filter(b => b.t >= t0 && b.t <= t1).map(b => b.p);
  if (!base.length || !win.length) return null;
  const noise = Math.max(NOISE_FLOOR, base[Math.floor(base.length / 2)]);
  const sig = Math.max(NOISE_FLOOR, ...win);
  return Math.round(10 * Math.log10(sig / noise) * 10) / 10;
}

/** Synthetic test/emission signal: a sine burst plus optional white noise (deterministic LCG). */
export function synth(rate: number, seconds: number, opts: { f?: number; amp?: number; from?: number; to?: number; noise?: number; seed?: number } = {}): Float32Array {
  const n = Math.round(rate * seconds);
  const x = new Float32Array(n);
  let seed = opts.seed ?? 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = (opts.noise ?? 0) * rnd() * 2;
    if (opts.f && t >= (opts.from ?? 0) && t < (opts.to ?? seconds)) v += (opts.amp ?? 0.1) * Math.sin(2 * Math.PI * opts.f * t);
    x[i] = v;
  }
  return x;
}

/** Cut a signal into consecutive blocks and measure each block's band power (what the panel does live). */
export function measureBlocks(x: Float32Array, rate: number, band: [number, number], focus?: number, block = 1024): BlockPower[] {
  const out: BlockPower[] = [];
  for (let i = 0; i + block <= x.length; i += block) {
    out.push({ t: (i + block / 2) / rate, p: bandPower(x.subarray(i, i + block), rate, band, focus) });
  }
  return out;
}
