import type { Station } from './types.js';

/** Approximate Greater London bounding box. */
const LONDON = { minLat: 51.28, maxLat: 51.7, minLon: -0.51, maxLon: 0.34 };

export function isInLondon(lat: number, lon: number): boolean {
  return lat >= LONDON.minLat && lat <= LONDON.maxLat && lon >= LONDON.minLon && lon <= LONDON.maxLon;
}

export function distanceMetres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const x = toRad(bLon - aLon) * Math.cos(toRad((aLat + bLat) / 2));
  const y = toRad(bLat - aLat);
  return 6_371_000 * Math.hypot(x, y);
}

/** Nearest supported station that a step-free journey can start from. */
export function nearestStation(stations: Station[], lat: number, lon: number) {
  return stations
    .filter((station) => station.stepFreeStreetAccess)
    .map((station) => ({ station, distanceMetres: Math.round(distanceMetres(lat, lon, station.lat, station.lon)) }))
    .sort((a, b) => a.distanceMetres - b.distanceMetres)[0];
}
