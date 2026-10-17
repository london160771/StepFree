import type { LineId, Route, Station } from '../api';

export interface Point {
  x: number;
  y: number;
}

export const VIEWBOX = { width: 400, height: 560 };

/** Metres per schematic map unit in the offline fallback map. */
const METRES_PER_UNIT = 18;
const MARGIN = 70;

/**
 * Positions for the offline/no-WebGL schematic map: the real station coordinates, projected flat
 * (north up) at a fixed scale. The 3D map uses the same coordinates directly.
 */
export function schematicPositions(stations: Pick<Station, 'id' | 'lat' | 'lon'>[]): Record<string, Point> {
  const lonMin = Math.min(...stations.map((s) => s.lon));
  const latMax = Math.max(...stations.map((s) => s.lat));
  const metresPerDegLon = 111_320 * Math.cos((51.51 * Math.PI) / 180);
  return Object.fromEntries(
    stations.map((s) => [
      s.id,
      {
        x: MARGIN + ((s.lon - lonMin) * metresPerDegLon) / METRES_PER_UNIT,
        y: MARGIN + ((latMax - s.lat) * 111_320) / METRES_PER_UNIT,
      },
    ]),
  );
}

/** The area of the schematic map that must stay visible (stations plus label room). */
export function contentBounds(positions: Record<string, Point>) {
  const xs = Object.values(positions).map((p) => p.x);
  const ys = Object.values(positions).map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x: x0 - 60, y: y0 - 50, w: x1 - x0 + 120, h: y1 - y0 + 100 };
}

/** Where each label sits relative to its marker in the schematic map. */
export type LabelAnchor = { dx: number; dy: number; anchor: 'start' | 'end' | 'middle' };
const ABOVE: LabelAnchor = { dx: 0, dy: -16, anchor: 'middle' };
const BELOW: LabelAnchor = { dx: 0, dy: 28, anchor: 'middle' };
const RIGHT: LabelAnchor = { dx: 16, dy: 5, anchor: 'start' };
export const LABEL_ANCHORS: Record<string, LabelAnchor> = {
  PAD: BELOW,
  BND: ABOVE,
  TCR: ABOVE,
  KGX: ABOVE,
  GPK: ABOVE,
  VIC: BELOW,
  SJP: BELOW,
  WSM: ABOVE,
  WLO: BELOW,
  SWK: ABOVE,
  LNB: BELOW,
  FCN: ABOVE,
  MGT: ABOVE,
  LST: ABOVE,
  TWH: BELOW,
  CWR: BELOW,
  CAN: ABOVE,
};
export const labelAnchor = (id: string): LabelAnchor => LABEL_ANCHORS[id] ?? RIGHT;

/** Where lift icons sit relative to a station marker. */
export const LIFT_OFFSET: Point = { x: 22, y: -16 };

export const LINE_COLORS: Record<LineId, string> = {
  bakerloo: '#B36305',
  central: '#E32017',
  circle: '#FFD300',
  district: '#00782A',
  'hammersmith-city': '#F3A9BB',
  jubilee: '#7C878E',
  metropolitan: '#9B0056',
  northern: '#44403C',
  piccadilly: '#003688',
  victoria: '#0098D4',
  'waterloo-city': '#95CDBA',
};

export const LINE_NAMES: Record<LineId, string> = {
  bakerloo: 'Bakerloo line',
  central: 'Central line',
  circle: 'Circle line',
  district: 'District line',
  'hammersmith-city': 'Hammersmith & City line',
  jubilee: 'Jubilee line',
  metropolitan: 'Metropolitan line',
  northern: 'Northern line',
  piccadilly: 'Piccadilly line',
  victoria: 'Victoria line',
  'waterloo-city': 'Waterloo & City line',
};

export function stationPoint(positions: Record<string, Point>, stationId: string): Point {
  const point = positions[stationId];
  if (!point) throw new Error(`No map position for ${stationId}`);
  return point;
}

/** Points along the route, in the order FalkorDB returned the stations. */
export function routePoints(route: Pick<Route, 'stations'>, positions: Record<string, Point>): Point[] {
  return route.stations.map((id) => stationPoint(positions, id));
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
  return clamp(polylineLength(points) / 190, 1, 1.8);
}

/**
 * Seconds for the wheelchair-user figure to travel a route. Scaled by on-map length so longer
 * routes take longer, but kept readable rather than real time.
 */
export function journeySeconds(points: Point[]): number {
  return clamp(polylineLength(points) / 17, 7, 18);
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
export function placeOnMap(stations: Station[], positions: Record<string, Point>, nearestId: string, lat: number, lon: number): Point {
  const nearest = stations.find((s) => s.id === nearestId);
  const anchor = stationPoint(positions, nearestId);
  if (!nearest) return anchor;
  const metresPerDegLat = 111_320;
  const metresPerDegLon = 111_320 * Math.cos((nearest.lat * Math.PI) / 180);
  const east = (lon - nearest.lon) * metresPerDegLon;
  const north = (lat - nearest.lat) * metresPerDegLat;
  const distance = Math.hypot(east, north);
  if (distance < 1) return { x: anchor.x + 14, y: anchor.y - 14 };
  const px = Math.min(Math.max(distance / METRES_PER_UNIT, 18), 44);
  return { x: anchor.x + (east / distance) * px, y: anchor.y - (north / distance) * px };
}
