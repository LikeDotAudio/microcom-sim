import { describe, expect, it } from 'vitest';
import {
  bearingDeg, clockDir, compass, distanceKm, equirect, greatCircle, nextInDirection, ortho, packRooms,
  planBearing, planDistance, wrapLon,
} from '../../src/m2026/geo';

const TORONTO = { lat: 43.6426, lon: -79.3871 };
const LONDON = { lat: 51.5094, lon: -0.2264 };
const SYDNEY = { lat: -33.8688, lon: 151.2093 };

describe('great circle', () => {
  it('measures Toronto–London ≈ 5,700 km', () => {
    expect(distanceKm(TORONTO, LONDON)).toBeGreaterThan(5650);
    expect(distanceKm(TORONTO, LONDON)).toBeLessThan(5760);
    expect(distanceKm(TORONTO, TORONTO)).toBe(0);
  });
  it('gives initial bearings and compass points', () => {
    expect(bearingDeg(TORONTO, LONDON)).toBeGreaterThan(45);   // leaves Toronto to the NE
    expect(bearingDeg(TORONTO, LONDON)).toBeLessThan(60);
    expect(compass(bearingDeg(TORONTO, LONDON))).toBe('NE');
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBeCloseTo(0);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBeCloseTo(90);
    expect(compass(359)).toBe('N');
    expect(compass(-90)).toBe('W');
  });
  it('interpolates arcs that start and end at the endpoints', () => {
    const arc = greatCircle(TORONTO, SYDNEY, 10);
    expect(arc).toHaveLength(11);
    expect(arc[0].lat).toBeCloseTo(TORONTO.lat);
    expect(arc[10].lon).toBeCloseTo(SYDNEY.lon);
  });
  it('wraps longitudes', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-180)).toBe(-180);
    expect(wrapLon(540)).toBe(-180);
  });
});

describe('projections', () => {
  it('puts the globe centre at the centre and hides the far side', () => {
    const c = ortho(TORONTO, TORONTO, 40, 50, 50);
    expect(c).toEqual({ x: 50, y: 50, visible: true });
    const back = ortho({ lat: -TORONTO.lat, lon: TORONTO.lon + 180 }, TORONTO, 40, 50, 50);
    expect(back.visible).toBe(false);
    expect(Math.hypot(back.x - 50, back.y - 50)).toBeCloseTo(40, 0);   // pulled onto the limb
  });
  it('places north up and east right on the globe', () => {
    const c = { lat: 0, lon: 0 };
    expect(ortho({ lat: 30, lon: 0 }, c, 40, 0, 0).y).toBeLessThan(0);
    expect(ortho({ lat: 0, lon: 30 }, c, 40, 0, 0).x).toBeGreaterThan(0);
    expect(ortho({ lat: 0, lon: 90 }, c, 40, 0, 0).x).toBeCloseTo(40);
  });
  it('maps the world with the centre longitude in the middle', () => {
    const p = equirect({ lat: 10, lon: 170 }, { lat: 0, lon: -170 }, 1, 0, 0);
    expect(p.x).toBeCloseTo(-20);    // across the date line, the short way
    expect(p.y).toBeCloseTo(-10);
  });
});

describe('floor plans', () => {
  it('gives clockwise bearings from ahead (screen up)', () => {
    expect(planBearing({ x: 0, y: 0 }, { x: 0, y: -1 })).toBeCloseTo(0);
    expect(planBearing({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
    expect(planBearing({ x: 0, y: 0 }, { x: 0, y: 3 })).toBeCloseTo(180);
    expect(clockDir(90)).toBe("3 o'clock");
    expect(clockDir(0)).toBe("12 o'clock");
    expect(planDistance({ x: 1.5, y: 2 }, { x: 4.7, y: 2 })).toBeCloseTo(3.2);
  });
  it('packs rooms left to right without overlap', () => {
    const rooms = packRooms([{ name: 'CR', pts: [{ x: 1.5, y: 2 }, { x: 6.3, y: 4 }] }, { name: 'ST', pts: [{ x: 4, y: 8 }] }]);
    expect(rooms[0].x).toBe(0);
    expect(rooms[1].x).toBeGreaterThan(rooms[0].x + rooms[0].w);
    // a member's plan position lies inside its room
    const px = rooms[0].ox + 6.3, py = rooms[0].oy + 4;
    expect(px).toBeLessThan(rooms[0].x + rooms[0].w);
    expect(py).toBeLessThan(rooms[0].y + rooms[0].h);
  });
});

describe('arrow navigation', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 1 }, { x: 30, y: 0 }, { x: 0, y: -10 }, { x: -8, y: 9 }];
  it('picks the nearest point roughly in the arrow direction', () => {
    expect(nextInDirection(pts, 0, 'right')).toBe(1);
    expect(nextInDirection(pts, 1, 'right')).toBe(2);
    expect(nextInDirection(pts, 0, 'up')).toBe(3);
    expect(nextInDirection(pts, 0, 'down')).toBe(4);
    expect(nextInDirection(pts, 2, 'right')).toBe(-1);
  });
  it('starts at the first point when nothing is selected', () => {
    expect(nextInDirection(pts, -1, 'left')).toBe(0);
    expect(nextInDirection([], -1, 'left')).toBe(-1);
  });
});
