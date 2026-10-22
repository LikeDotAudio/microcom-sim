import { describe, expect, it } from 'vitest';
import { bandPower, blipFreq, blipSnr, goertzel, measureBlocks, synth } from '../../src/m2026/goertzel';

const RATE = 48000, BAND: [number, number] = [18000, 19500];

describe('goertzel', () => {
  it('measures a sine amplitude squared at its frequency', () => {
    const x = synth(RATE, 1024 / RATE, { f: 18750, amp: 0.5 });
    expect(goertzel(x, 18750, RATE)).toBeCloseTo(0.25, 2);
    expect(goertzel(x, 1000, RATE)).toBeLessThan(1e-4);
  });
  it('finds a tone anywhere in the band, but not outside it', () => {
    for (const f of [18050, 18750, 19400]) {
      expect(bandPower(synth(RATE, 0.03, { f, amp: 0.1 }).subarray(0, 1024), RATE, BAND)).toBeGreaterThan(0.004);
    }
    expect(bandPower(synth(RATE, 0.03, { f: 1000, amp: 0.5 }).subarray(0, 1024), RATE, BAND)).toBeLessThan(1e-4);
  });
  it('cannot hear the band at a 16 kHz device rate', () => {
    expect(bandPower(synth(16000, 0.1, { f: 7000, amp: 0.5 }), 16000, BAND)).toBe(0);
  });
});

describe('blip detection', () => {
  it('reports a high SNR for a quiet blip over noise, timed after a baseline', () => {
    // 0.6 s of noise, then a 0.25 s 18.75 kHz burst at -32 dBFS, then noise
    const x = synth(RATE, 1.2, { f: 18750, amp: 0.025, from: 0.6, to: 0.85, noise: 0.02, seed: 7 });
    const blocks = measureBlocks(x, RATE, BAND);
    const snr = blipSnr(blocks, 0.05, 0.55, 0.6, 0.9)!;
    expect(snr).toBeGreaterThan(15);
  });
  it('reports ~0 dB when nothing was played', () => {
    const x = synth(RATE, 1.2, { noise: 0.02, seed: 3 });
    const snr = blipSnr(measureBlocks(x, RATE, BAND), 0.05, 0.55, 0.6, 0.9)!;
    expect(Math.abs(snr)).toBeLessThan(8);         // under the engine's NEAR_DB threshold
  });
  it('a distant (attenuated) blip scores lower than a near one', () => {
    const near = synth(RATE, 1.2, { f: 18500, amp: 0.03, from: 0.6, to: 0.85, noise: 0.01, seed: 5 });
    const far = synth(RATE, 1.2, { f: 18500, amp: 0.003, from: 0.6, to: 0.85, noise: 0.01, seed: 5 });
    const s = (x: Float32Array) => blipSnr(measureBlocks(x, RATE, BAND), 0.05, 0.55, 0.6, 0.9)!;
    expect(s(near)).toBeGreaterThan(s(far) + 10);
  });
  it('ignores broadband clicks and digital silence', () => {
    const x = synth(RATE, 1.2, {});                          // silence
    for (const t of [0.7, 0.75, 0.8]) x[Math.round(t * RATE) + 300] = 0.8;   // clicks (impulses) in the window
    expect(blipSnr(measureBlocks(x, RATE, BAND), 0.05, 0.55, 0.6, 0.9)!).toBeLessThan(8);
    const tone = synth(RATE, 1.2, { f: 18750, amp: 0.001, from: 0.6, to: 0.85 });   // -60 dBFS over silence
    expect(blipSnr(measureBlocks(tone, RATE, BAND), 0.05, 0.55, 0.6, 0.9)!).toBeGreaterThan(20);
  });
  it('with a focus frequency, ignores other tones in the band', () => {
    const f0 = blipFreq(BAND);
    expect(f0).toBe(18750);
    const other = synth(RATE, 1.2, { f: 19000, amp: 0.05, from: 0.6, to: 0.85, noise: 0.002, seed: 9 });   // e.g. a beep harmonic
    expect(blipSnr(measureBlocks(other, RATE, BAND, f0), 0.05, 0.55, 0.6, 0.9)!).toBeLessThan(8);
    const ours = synth(RATE, 1.2, { f: f0, amp: 0.01, from: 0.6, to: 0.85, noise: 0.002, seed: 9 });
    expect(blipSnr(measureBlocks(ours, RATE, BAND, f0), 0.05, 0.55, 0.6, 0.9)!).toBeGreaterThan(20);
  });
  it('returns null without baseline or window blocks', () => {
    expect(blipSnr([{ t: 1, p: 1 }], 0, 0.5, 0.6, 0.9)).toBeNull();
  });
});
