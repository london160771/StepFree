import type { LineId, Route, Station } from '../api';

export interface Point {
  x: number;
  y: number;
}

export const VIEWBOX = { width: 400, height: 560 };

/** Schematic map positions for the seven supported stations (portrait, phone-first). */
export const STATION_POSITIONS: Record<string, Point> = {
  GPK: { x: 118, y: 118 },
  VIC: { x: 72, y: 292 },
  SJP: { x: 172, y: 300 },
  WSM: { x: 268, y: 262 },
  WLO: { x: 300, y: 352 },
  SWK: { x: 318, y: 424 },
  LNB: { x: 342, y: 496 },
};

/** Where each label sits relative to its marker. */
export const LABEL_ANCHORS: Record<string, { dx: number; dy: number; anchor: 'start' | 'end' | 'middle' }> = {
  GPK: { dx: 18, dy: 5, anchor: 'start' },
  VIC: { dx: -2, dy: 34, anchor: 'middle' },
  SJP: { dx: 0, dy: 30, anchor: 'middle' },
  WSM: { dx: 18, dy: -12, anchor: 'start' },
  WLO: { dx: -18, dy: 5, anchor: 'end' },
  SWK: { dx: -18, dy: 5, anchor: 'end' },
  LNB: { dx: -18, dy: 5, anchor: 'end' },
};

/** Where lift icons sit relative to a station marker, clear of labels and lines. */
export const LIFT_OFFSETS: Record<string, Point> = {
  GPK: { x: -24, y: -14 },
  VIC: { x: 22, y: -16 },
  SJP: { x: 0, y: -20 },
  WSM: { x: 24, y: 14 },
  WLO: { x: 22, y: -12 },
  SWK: { x: 22, y: -12 },
  LNB: { x: 22, y: -16 },
};

export const LINE_COLORS: Record<LineId, string> = {
  victoria: '#0098D4',
  district: '#00782A',
  jubilee: '#7C878E',
};

export const LINE_NAMES: Record<LineId, string> = {
  victoria: 'Victoria line',
  district: 'District line',
  jubilee: 'Jubilee line',
};

/** The Thames, drawn as quiet context between Westminster and Waterloo. */
export const RIVER_PATH = 'M 150 572 C 190 470, 205 400, 236 344 S 300 290, 352 300 S 404 322, 420 318';

export function stationPoint(stationId: string): Point {
  const point = STATION_POSITIONS[stationId];
  if (!point) throw new Error(`No map position for ${stationId}`);
  return point;
}

/** Points along the route, in the order FalkorDB returned the stations. */
export function routePoints(route: Pick<Route, 'stations'>): Point[] {
  return route.stations.map(stationPoint);
}

export function toPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

export function polylineLength(points: Point[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Seconds to draw a route line: longer routes take a little longer, within a calm range. */
export function routeDrawSeconds(points: Point[]): number {
  return clamp(polylineLength(points) / 420, 1, 1.8);
}

/**
 * Seconds for the wheelchair-user figure to travel a route. Scaled by on-map length so longer
 * routes take longer, but kept readable rather than real time.
 */
export function journeySeconds(points: Point[]): number {
  return clamp(polylineLength(points) / 38, 7, 18);
}

/** Position at fraction t (0..1) along a polyline, by length. */
export function pointAt(points: Point[], t: number): Point {
  if (points.length === 1) return points[0];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = lengths.reduce((a, b) => a + b, 0);
  let remaining = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] === 0 ? 0 : Math.min(remaining / lengths[i], 1);
      return { x: points[i].x + (points[i + 1].x - points[i].x) * f, y: points[i].y + (points[i + 1].y - points[i].y) * f };
    }
    remaining -= lengths[i];
  }
  return points[points.length - 1];
}

/**
 * Place a real location on the schematic map relative to its nearest supported station.
 * The offset keeps its real direction, scaled to the map and capped so the figure stays near that station.
 */
export function placeOnMap(stations: Station[], nearestId: string, lat: number, lon: number): Point {
  const nearest = stations.find((s) => s.id === nearestId);
  const anchor = stationPoint(nearestId);
  if (!nearest) return anchor;
  const metresPerDegLat = 111_320;
  const metresPerDegLon = 111_320 * Math.cos((nearest.lat * Math.PI) / 180);
  const east = (lon - nearest.lon) * metresPerDegLon;
  const north = (lat - nearest.lat) * metresPerDegLat;
  const distance = Math.hypot(east, north);
  if (distance < 1) return { x: anchor.x + 14, y: anchor.y - 14 };
  const px = Math.min(Math.max(distance * 0.06, 18), 44);
  return { x: anchor.x + (east / distance) * px, y: anchor.y - (north / distance) * px };
}
