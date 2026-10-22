import { describe, expect, it } from 'vitest';
import { cellAt, fitRange, hitRoute, MAX_SCALE, pan, screenToWorld, visibleRange, worldToScreen, zoomAt } from '../../src/matrix/gridMath';
import { routeKey } from '../../src/matrix/store';
import type { Route } from '../../src/matrix/types';

const route = (src: number, dst: number): Route => ({ src, dst, kind: 'talk', gain: 1, via: '' });
const index = (...rs: Route[]) => new Map(rs.map(r => [routeKey(r.src, r.dst), r]));

describe('grid math', () => {
  it('maps cells: x = destination, y = source', () => {
    const v = { scale: 10, ox: 50, oy: 20 };
    expect(cellAt(v, 55, 25, 2048)).toEqual({ src: 1, dst: 1 });
    expect(cellAt(v, 50 + 10 * 4 + 1, 20 + 10 * 7 + 9, 2048)).toEqual({ src: 8, dst: 5 });
    expect(cellAt(v, 49, 25, 2048)).toBeNull();
    expect(cellAt(v, 50 + 10 * 2048, 25, 2048)).toBeNull();
    const [sx, sy] = worldToScreen(v, 3.5, 7.25);
    expect(screenToWorld(v, sx, sy)).toEqual([3.5, 7.25]);
  });

  it('zooms around the cursor (point under cursor stays fixed)', () => {
    const v = { scale: 2, ox: 10, oy: 10 };
    const before = screenToWorld(v, 300, 200);
    const z = zoomAt(v, 300, 200, 3);
    expect(z.scale).toBe(6);
    const after = screenToWorld(z, 300, 200);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(zoomAt(v, 0, 0, 1e6).scale).toBe(MAX_SCALE);
    expect(pan(v, 5, -5)).toEqual({ scale: 2, ox: 15, oy: 5 });
  });

  it('fits a facility into the plot', () => {
    const plot = { x: 40, y: 20, w: 640, h: 512 };
    const v = fitRange(plot, 129, 192);                 // facility 3 (64 ports)
    expect(v.scale).toBe(8);
    expect(cellAt(v, plot.x + (640 - 512) / 2 + 1, plot.y + 1, 2048)).toEqual({ src: 129, dst: 129 });
    expect(visibleRange(v, plot, 2048, 'y')).toEqual([129, 192]);
    const all = fitRange(plot, 1, 2048);
    expect(all.scale).toBe(0.25);
    expect(visibleRange(all, plot, 2048, 'x')).toEqual([1, 2048]);
  });

  it('hit-tests routes exactly when zoomed in and with slop when zoomed out', () => {
    const idx = index(route(10, 20), route(100, 100 + 1));
    const big = { scale: 10, ox: 0, oy: 0 };
    expect(hitRoute(big, 19 * 10 + 5, 9 * 10 + 5, 2048, idx)).toMatchObject({ src: 10, dst: 20 });
    expect(hitRoute(big, 19 * 10 + 5, 12 * 10 + 5, 2048, idx)).toBeNull();
    const small = { scale: 0.5, ox: 0, oy: 0 };          // cells are half a pixel: slop finds near route
    expect(hitRoute(small, 20 * 0.5 + 2, 10 * 0.5 + 1, 2048, idx)).toMatchObject({ src: 10, dst: 20 });
    expect(hitRoute(small, 400, 400, 2048, idx)).toBeNull();
  });
});
