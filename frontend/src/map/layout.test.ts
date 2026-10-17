import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Station } from '../api';
import { contentBounds, journeySeconds, labelAnchor, placeOnMap, pointAt, routeDrawSeconds, routePoints, schematicPositions } from './layout';

// The real network data the backend builds from TfL; the frontend only ever receives the slim station list.
const network = JSON.parse(readFileSync(new URL('../../../backend/data/network.json', import.meta.url), 'utf8')) as { stations: Station[] };
const stations = network.stations.map(({ id, name, lat, lon, stepFreeStreetAccess }) => ({ id, name, lat, lon, stepFreeStreetAccess }));
const positions = schematicPositions(stations);

describe('map layout for 17 stations', () => {
  it('positions every supported station once, from its real coordinates', () => {
    expect(stations).toHaveLength(17);
    expect(Object.keys(positions).sort()).toEqual(stations.map((s) => s.id).sort());
    const spots = new Set(Object.values(positions).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
    expect(spots.size).toBe(17);
    // West is left and north is up, as on the real map.
    expect(positions.PAD.x).toBeLessThan(positions.WSM.x);
    expect(positions.CAN.x).toBeGreaterThan(positions.LNB.x);
    expect(positions.KGX.y).toBeLessThan(positions.VIC.y);
    const bounds = contentBounds(positions);
    for (const p of Object.values(positions)) {
      expect(p.x).toBeGreaterThan(bounds.x);
      expect(p.x).toBeLessThan(bounds.x + bounds.w);
      expect(p.y).toBeGreaterThan(bounds.y);
      expect(p.y).toBeLessThan(bounds.y + bounds.h);
    }
  });

  it('draws a route through the stations in the order the API returned them', () => {
    const ids = ['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB'];
    expect(routePoints({ stations: ids }, positions)).toEqual(ids.map((id) => positions[id]));
    expect(labelAnchor('VIC')).toBeDefined();
  });

  it('interpolates along a polyline by length', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(pointAt(line, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(line, 0.25)).toEqual({ x: 5, y: 0 });
    expect(pointAt(line, 0.75)).toEqual({ x: 10, y: 5 });
    expect(pointAt(line, 1)).toEqual({ x: 10, y: 10 });
  });

  it('places a user near their nearest station, in the right direction', () => {
    const vic = stations.find((s) => s.id === 'VIC')!;
    const north = placeOnMap(stations, positions, 'VIC', vic.lat + 0.004, vic.lon);
    expect(north.y).toBeLessThan(positions.VIC.y);
    expect(Math.hypot(north.x - positions.VIC.x, north.y - positions.VIC.y)).toBeLessThanOrEqual(44);
  });

  it('paces the journey by route length within a readable range', () => {
    const baseline = routePoints({ stations: ['VIC', 'GPK', 'WSM', 'WLO', 'SWK', 'LNB'] }, positions);
    const short = routePoints({ stations: ['WLO', 'SWK'] }, positions);
    expect(journeySeconds(baseline)).toBeGreaterThan(journeySeconds(short));
    expect(journeySeconds(short)).toBeGreaterThanOrEqual(7);
    expect(journeySeconds(baseline)).toBeGreaterThan(14);
    expect(journeySeconds(baseline)).toBeLessThanOrEqual(18);
    expect(routeDrawSeconds(baseline)).toBeLessThanOrEqual(1.8);
  });
});
