import { describe, expect, it } from 'vitest';
import { VU_SEGMENTS, vuSegments } from '../../src/matrix/turret';

describe('turret VU bargraph', () => {
  it('maps -48..0 dBFS onto the segments', () => {
    expect(vuSegments(0)).toBe(0);
    expect(vuSegments(10 ** (-60 / 20))).toBe(0);
    expect(vuSegments(10 ** (-24 / 20))).toBe(VU_SEGMENTS / 2);
    expect(vuSegments(1)).toBe(VU_SEGMENTS);
    expect(vuSegments(4)).toBe(VU_SEGMENTS);
  });
});
