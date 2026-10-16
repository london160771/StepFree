import type { GraphEdge } from '../api';
import { STATION_POSITIONS, type Point } from './layout';

/** Coarse river centreline used to keep buildings off the water. */
export const RIVER_POINTS: Point[] = [
  { x: 40, y: 800 },
  { x: 150, y: 572 },
  { x: 205, y: 420 },
  { x: 236, y: 350 },
  { x: 275, y: 312 },
  { x: 330, y: 296 },
  { x: 400, y: 316 },
  { x: 520, y: 332 },
  { x: 700, y: 300 },
  { x: 1150, y: 322 },
];

export const PARKS = [
  { x: 108, y: 150, w: 70, h: 92, r: 18 },
  { x: 186, y: 214, w: 66, h: 40, r: 16 },
];

export interface Block {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  tone: number;
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Isometric street lattice: cell axes at +/-30 degrees, a road every ROAD_EVERY cells. */
const ORIGIN = { x: 200, y: 300 };
const AXIS_U = { x: 22.5, y: 13 };
const AXIS_V = { x: -22.5, y: 13 };
const ROAD_EVERY = 4;

const lattice = (u: number, v: number): Point => ({
  x: ORIGIN.x + u * AXIS_U.x + v * AXIS_V.x,
  y: ORIGIN.y + u * AXIS_U.y + v * AXIS_V.y,
});

export interface Road {
  a: Point;
  b: Point;
}

/**
 * Deterministic soft isometric city: a quiet street grid with low blocks that stay clear of the
 * network, station labels, parks and river.
 */
export function cityGrid(edges: GraphEdge[], bounds: { x: number; y: number; w: number; h: number }) {
  const segments: Array<[Point, Point]> = edges
    .filter((e) => e.type === 'RIDE')
    .map((e) => [STATION_POSITIONS[e.from.split(':')[0]], STATION_POSITIONS[e.to.split(':')[0]]]);
  const stations = Object.values(STATION_POSITIONS);
  const inside = (p: Point, margin: number) =>
    p.x > bounds.x - margin && p.x < bounds.x + bounds.w + margin && p.y > bounds.y - margin && p.y < bounds.y + bounds.h + margin;
  const span = 48;

  const roads: Road[] = [];
  for (let k = -span; k <= span; k += ROAD_EVERY) {
    roads.push({ a: lattice(k, -span), b: lattice(k, span) }, { a: lattice(-span, k), b: lattice(span, k) });
  }

  const blocks: Block[] = [];
  for (let u = -span; u < span; u++) {
    for (let v = -span; v < span; v++) {
      if (u % ROAD_EVERY === 0 || v % ROAD_EVERY === 0) continue;
      const p = lattice(u + 0.5, v + 0.5);
      if (!inside(p, 40)) continue;
      // Seed per cell so the city does not reshuffle when the visible frame changes.
      const random = seeded((u + 1000) * 7919 + (v + 1000) * 104729);
      if (random() < 0.32) continue;
      if (segments.some(([a, b]) => segmentDistance(p, a, b) < 26)) continue;
      if (stations.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < 58)) continue;
      if (RIVER_POINTS.slice(1).some((b, i) => segmentDistance(p, RIVER_POINTS[i], b) < 30)) continue;
      if (PARKS.some((park) => p.x > park.x - 14 && p.x < park.x + park.w + 14 && p.y > park.y - 14 && p.y < park.y + park.h + 14))
        continue;
      const w = 26 + random() * 8;
      const tall = random() > 0.92;
      blocks.push({ x: p.x, y: p.y + w * 0.29, w, d: w * 1.155, h: tall ? 24 + random() * 14 : 5 + random() * 11, tone: random() });
    }
  }
  // Paint back to front so nearer blocks overlap farther ones.
  return { roads, blocks: blocks.sort((a, b) => a.y - b.y) };
}

/** Faces of an isometric box whose footprint is centred on (x, y). */
export function isoFaces({ x, y, w, d, h }: Block) {
  const top = [
    [x, y - h - d / 2],
    [x + w / 2, y - h - d / 4],
    [x, y - h],
    [x - w / 2, y - h - d / 4],
  ];
  const left = [
    [x - w / 2, y - h - d / 4],
    [x, y - h],
    [x, y],
    [x - w / 2, y - d / 4],
  ];
  const right = [
    [x + w / 2, y - h - d / 4],
    [x, y - h],
    [x, y],
    [x + w / 2, y - d / 4],
  ];
  const toPoints = (pts: number[][]) => pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  return { top: toPoints(top), left: toPoints(left), right: toPoints(right) };
}
