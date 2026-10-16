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

/** Deterministic soft isometric blocks that stay clear of the network, labels, parks and river. */
export function cityBlocks(edges: GraphEdge[], bounds: { x: number; y: number; w: number; h: number }): Block[] {
  const random = seeded(7);
  const segments: Array<[Point, Point]> = edges
    .filter((e) => e.type === 'RIDE')
    .map((e) => [STATION_POSITIONS[e.from.split(':')[0]], STATION_POSITIONS[e.to.split(':')[0]]]);
  const stations = Object.values(STATION_POSITIONS);
  const blocks: Block[] = [];
  for (let y = bounds.y - 20; y < bounds.y + bounds.h + 40; y += 38) {
    for (let x = bounds.x - 20; x < bounds.x + bounds.w + 40; x += 44) {
      const p = { x: x + (random() - 0.5) * 18, y: y + (random() - 0.5) * 14 };
      if (random() < 0.28) continue;
      if (segments.some(([a, b]) => segmentDistance(p, a, b) < 30)) continue;
      if (stations.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < 62)) continue;
      if (RIVER_POINTS.slice(1).some((b, i) => segmentDistance(p, RIVER_POINTS[i], b) < 34)) continue;
      if (PARKS.some((park) => p.x > park.x - 18 && p.x < park.x + park.w + 18 && p.y > park.y - 18 && p.y < park.y + park.h + 18))
        continue;
      blocks.push({ x: p.x, y: p.y, w: 10 + random() * 8, d: 8 + random() * 6, h: 6 + random() * 16, tone: random() });
    }
  }
  // Paint back to front so nearer blocks overlap farther ones.
  return blocks.sort((a, b) => a.y - b.y);
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
