/** Geographic helpers for drawing FalkorDB routes on the real-coordinate 3D map. */

export type LngLat = [number, number];

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distance in kilometres between two [lng, lat] points. */
export function distanceKm([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const x = toRad(lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2));
  const y = toRad(lat2 - lat1);
  return 6371 * Math.hypot(x, y);
}

export function lengthKm(coords: LngLat[]): number {
  return coords.slice(1).reduce((sum, c, i) => sum + distanceKm(coords[i], c), 0);
}

/** The first fraction t (0..1, by length) of a line, for drawing a route progressively. */
export function lineUpTo(coords: LngLat[], t: number): LngLat[] {
  if (coords.length < 2 || t >= 1) return coords;
  const total = lengthKm(coords);
  let remaining = Math.max(t, 0) * total;
  const out: LngLat[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const seg = distanceKm(coords[i - 1], coords[i]);
    if (remaining >= seg) {
      out.push(coords[i]);
      remaining -= seg;
      continue;
    }
    const f = seg === 0 ? 0 : remaining / seg;
    out.push([coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f]);
    break;
  }
  return out;
}

/** Point at fraction t (0..1, by length) along a line. */
export function pointAlong(coords: LngLat[], t: number): LngLat {
  const part = lineUpTo(coords, Math.min(Math.max(t, 0), 1));
  return part[part.length - 1];
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/**
 * Seconds for the wheelchair-user marker to travel a route. Scales with real length so longer
 * routes take longer (Victoria to London Bridge is about 16 s), but stays a readable visual.
 */
export function journeySecondsGeo(coords: LngLat[]): number {
  return clamp(lengthKm(coords) * 3.4, 7, 18);
}

/** Seconds to draw a route line on the map. */
export function routeDrawSecondsGeo(coords: LngLat[]): number {
  return clamp(lengthKm(coords) * 0.32, 1, 1.8);
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
