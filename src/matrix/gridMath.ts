// Pure viewport math for the crosspoint grid: world = cells (x = dst-1, y = src-1), screen = CSS px.
import { routeKey } from './store';
import type { Route } from './types';

export interface Viewport {
  scale: number;   // px per cell
  ox: number;      // screen x of world x=0
  oy: number;      // screen y of world y=0
}

export interface Rect { x: number; y: number; w: number; h: number }

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 64;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function worldToScreen(v: Viewport, wx: number, wy: number): [number, number] {
  return [v.ox + wx * v.scale, v.oy + wy * v.scale];
}

export function screenToWorld(v: Viewport, sx: number, sy: number): [number, number] {
  return [(sx - v.ox) / v.scale, (sy - v.oy) / v.scale];
}

/** Port numbers (gid) under a screen point, or null if outside 1..n. */
export function cellAt(v: Viewport, sx: number, sy: number, n: number): { src: number; dst: number } | null {
  const [wx, wy] = screenToWorld(v, sx, sy);
  const dst = Math.floor(wx) + 1;
  const src = Math.floor(wy) + 1;
  if (dst < 1 || dst > n || src < 1 || src > n) return null;
  return { src, dst };
}

/** Zoom by `factor` keeping the world point under (sx, sy) fixed. */
export function zoomAt(v: Viewport, sx: number, sy: number, factor: number): Viewport {
  const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
  const k = scale / v.scale;
  return { scale, ox: sx - (sx - v.ox) * k, oy: sy - (sy - v.oy) * k };
}

export function pan(v: Viewport, dx: number, dy: number): Viewport {
  return { scale: v.scale, ox: v.ox + dx, oy: v.oy + dy };
}

/** Fit ports first..last (inclusive, both axes) into the plot rect, centred. */
export function fitRange(plot: Rect, first: number, last: number): Viewport {
  const cells = last - first + 1;
  const scale = clamp(Math.min(plot.w, plot.h) / cells, MIN_SCALE, MAX_SCALE);
  const span = cells * scale;
  return {
    scale,
    ox: plot.x + (plot.w - span) / 2 - (first - 1) * scale,
    oy: plot.y + (plot.h - span) / 2 - (first - 1) * scale,
  };
}

/** Visible world cell range [first, last] (1-based ports) for an axis. */
export function visibleRange(v: Viewport, plot: Rect, n: number, axis: 'x' | 'y'): [number, number] {
  const o = axis === 'x' ? v.ox : v.oy;
  const a = axis === 'x' ? plot.x : plot.y;
  const len = axis === 'x' ? plot.w : plot.h;
  const first = clamp(Math.floor((a - o) / v.scale) + 1, 1, n);
  const last = clamp(Math.ceil((a + len - o) / v.scale), 1, n);
  return [first, last];
}

/**
 * Route nearest to a screen point. When cells are smaller than `slopPx`, routes within that radius
 * count as hits (so tiny dots at full-matrix zoom stay hoverable).
 */
export function hitRoute(v: Viewport, sx: number, sy: number, n: number,
  index: Map<number, Route>, slopPx = 4): Route | null {
  const c = cellAt(v, sx, sy, n);
  if (c) {
    const exact = index.get(routeKey(c.src, c.dst));
    if (exact) return exact;
  }
  const r = Math.ceil(slopPx / v.scale);
  if (r < 1 || r > 64) return null;
  const [wx, wy] = screenToWorld(v, sx, sy);
  const cx = Math.floor(wx) + 1, cy = Math.floor(wy) + 1;
  let best: Route | null = null;
  let bestD = Infinity;
  for (let src = Math.max(1, cy - r); src <= Math.min(n, cy + r); src++) {
    for (let dst = Math.max(1, cx - r); dst <= Math.min(n, cx + r); dst++) {
      const rt = index.get(routeKey(src, dst));
      if (!rt) continue;
      const dx = (dst - 0.5 - wx) * v.scale, dy = (src - 0.5 - wy) * v.scale;
      const d = dx * dx + dy * dy;
      if (d < bestD && d <= (slopPx + v.scale) ** 2) { bestD = d; best = rt; }
    }
  }
  return best;
}
