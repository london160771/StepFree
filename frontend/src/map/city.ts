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
  /** Background blocks sit farther from the network and recede (lighter, less parallax). */
  far: boolean;
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
const NETWORK_CENTRE = { x: 210, y: 300 };

const lattice = (u: number, v: number): Point => ({
  x: ORIGIN.x + u * AXIS_U.x + v * AXIS_V.x,
  y: ORIGIN.y + u * AXIS_U.y + v * AXIS_V.y,
});

export interface Road {
  a: Point;
  b: Point;
  /** Main roads are wider and brighter, like London's arterial streets. */
  main: boolean;
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
    const main = k % (ROAD_EVERY * 3) === 0;
    roads.push({ a: lattice(k, -span), b: lattice(k, span), main }, { a: lattice(-span, k), b: lattice(span, k), main });
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
      const far = Math.hypot(p.x - NETWORK_CENTRE.x, (p.y - NETWORK_CENTRE.y) * 1.2) > 250;
      blocks.push({ x: p.x, y: p.y + w * 0.29, w, d: w * 1.155, h: tall ? 24 + random() * 14 : 5 + random() * 11, tone: random(), far });
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

/**
 * Soft ground shadows for all blocks as one path: each block's footprint swept toward the
 * lower right (light from the upper left), so height reads as depth without extra nodes.
 */
export function shadowPath(blocks: Block[]): string {
  return blocks
    .map(({ x, y, w, d, h }) => {
      const ox = h * 0.55;
      const oy = h * 0.22;
      const pts = [
        [x, y - d / 2],
        [x + ox, y - d / 2 + oy],
        [x + w / 2 + ox, y - d / 4 + oy],
        [x + ox, y + oy],
        [x, y],
        [x - w / 2, y - d / 4],
      ];
      return `M${pts.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join('L')}Z`;
    })
    .join('');
}

export interface Tree {
  x: number;
  y: number;
  r: number;
}

/** Deterministic tree canopies scattered inside the parks. */
export function parkTrees(): Tree[] {
  const trees: Tree[] = [];
  PARKS.forEach((park, n) => {
    const random = seeded(97 + n * 31);
    const count = Math.round((park.w * park.h) / 260);
    for (let i = 0; i < count; i++) {
      trees.push({
        x: park.x + 8 + random() * (park.w - 16),
        y: park.y + 8 + random() * (park.h - 16),
        r: 3.2 + random() * 2.6,
      });
    }
  });
  return trees.sort((a, b) => a.y - b.y);
}

/** Bridges across the Thames near Westminster and Waterloo (decorative). */
export const BRIDGES: Array<[Point, Point]> = [
  [{ x: 202, y: 377 }, { x: 239, y: 393 }],
  [{ x: 314, y: 280 }, { x: 326, y: 318 }],
  [{ x: 443, y: 301 }, { x: 437, y: 341 }],
];
