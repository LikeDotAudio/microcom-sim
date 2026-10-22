// MicroCOM 2026 map maths (pure): globe/world projections, great-circle distance and bearing, floor-plan
// bearings, room packing and arrow-key navigation between plotted points.

export interface LatLon { lat: number; lon: number }
export interface XY { x: number; y: number }
export interface Projected extends XY { visible: boolean }

const RAD = Math.PI / 180;
export const EARTH_KM = 6371;

/** Wrap a longitude to [-180, 180). */
export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
export const clampLat = (lat: number) => Math.max(-89.9, Math.min(89.9, lat));

/** Great-circle distance in km (haversine). */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from a to b, degrees clockwise from north, [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD, φ2 = b.lat * RAD, Δλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

const POINTS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** 16-point compass name for a bearing. */
export const compass = (deg: number) => POINTS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/** Clock-face direction ("3 o'clock") for a bearing relative to straight ahead. */
export function clockDir(deg: number): string {
  const h = Math.round((((deg % 360) + 360) % 360) / 30) % 12;
  return `${h === 0 ? 12 : h} o'clock`;
}

/** Floor-plan bearing (screen y grows downwards = towards the back of the room), clockwise from "ahead". */
export function planBearing(from: XY, to: XY): number {
  return (Math.atan2(to.x - from.x, -(to.y - from.y)) / RAD + 360) % 360;
}
export const planDistance = (a: XY, b: XY) => Math.hypot(b.x - a.x, b.y - a.y);

export function fmtKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}
export const fmtM = (m: number) => (m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`);

/**
 * Orthographic (globe) projection centred on (lat0, lon0) with radius r around (cx, cy); SVG y grows down.
 * Points on the far side are pulled onto the limb and flagged invisible (outline polygons stay closed).
 */
export function ortho(p: LatLon, c: LatLon, r: number, cx: number, cy: number): Projected {
  const φ = p.lat * RAD, λ = p.lon * RAD, φ0 = c.lat * RAD, λ0 = c.lon * RAD;
  const cosc = Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * Math.cos(φ) * Math.cos(λ - λ0);
  let x = Math.cos(φ) * Math.sin(λ - λ0);
  let y = Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(λ - λ0);
  const visible = cosc >= 0;
  if (!visible) {
    const n = Math.hypot(x, y) || 1;
    x /= n; y /= n;
  }
  return { x: cx + r * x, y: cy - r * y, visible };
}

/** Equirectangular world map: lon0 at the centre, `scale` px per degree. */
export function equirect(p: LatLon, c: LatLon, scale: number, cx: number, cy: number): Projected {
  const dx = wrapLon(p.lon - c.lon);
  return { x: cx + dx * scale, y: cy - (p.lat - c.lat) * scale, visible: true };
}

/** Points along the great circle a→b (spherical linear interpolation), for drawing talk arcs. */
export function greatCircle(a: LatLon, b: LatLon, n = 24): LatLon[] {
  const v = (p: LatLon) => [Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD), Math.sin(p.lat * RAD)];
  const A = v(a), B = v(b);
  const dot = Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  const ω = Math.acos(dot);
  if (ω < 1e-9) return [a, b];
  const out: LatLon[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s1 = Math.sin((1 - t) * ω) / Math.sin(ω), s2 = Math.sin(t * ω) / Math.sin(ω);
    const x = s1 * A[0] + s2 * B[0], y = s1 * A[1] + s2 * B[1], z = s1 * A[2] + s2 * B[2];
    out.push({ lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD });
  }
  return out;
}

export type Dir = 'up' | 'down' | 'left' | 'right';
const DIR_ANGLE: Record<Dir, number> = { right: 0, down: 90, left: 180, up: 270 };

/**
 * Arrow-key navigation: the index of the best point in direction `dir` from `pts[from]` (screen
 * coordinates), favouring near points close to the arrow's axis; -1 if nothing lies that way.
 */
export function nextInDirection(pts: XY[], from: number, dir: Dir): number {
  const o = pts[from];
  if (!o) return pts.length ? 0 : -1;
  let best = -1, bestScore = Infinity;
  pts.forEach((p, i) => {
    if (i === from) return;
    const dx = p.x - o.x, dy = p.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    let off = Math.abs((Math.atan2(dy, dx) / RAD - DIR_ANGLE[dir] + 540) % 360 - 180);
    if (off >= 70) return;
    const score = d * (1 + off / 25);
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

export interface RoomBox { name: string; x: number; y: number; w: number; h: number; ox: number; oy: number }

/**
 * Lay rooms side by side on a floor plan. Each room's own coordinates (metres) keep their scale;
 * `ox`/`oy` map a member's room coordinates to plan coordinates (planX = ox + x).
 */
export function packRooms(rooms: { name: string; pts: XY[] }[], gap = 1.5, pad = 1): RoomBox[] {
  const out: RoomBox[] = [];
  let x = 0;
  for (const r of rooms) {
    const xs = r.pts.map(p => p.x), ys = r.pts.map(p => p.y);
    const minX = Math.min(0, ...xs) , minY = Math.min(0, ...ys);
    const maxX = Math.max(minX + 2, ...xs), maxY = Math.max(minY + 2, ...ys);
    const w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad;
    out.push({ name: r.name, x, y: 0, w, h, ox: x + pad - minX, oy: pad - minY });
    x += w + gap;
  }
  return out;
}

/** Bounding box of points (with a minimum size) for fitting a plan into a viewport. */
export function bounds(pts: XY[], minSize = 1): { x: number; y: number; w: number; h: number } {
  if (!pts.length) return { x: 0, y: 0, w: minSize, h: minSize };
  const x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x));
  const y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
  const w = Math.max(minSize, x1 - x0), h = Math.max(minSize, y1 - y0);
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}
