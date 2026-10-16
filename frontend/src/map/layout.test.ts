import { describe, expect, it } from 'vitest';
import { placeOnMap, pointAt, routePoints, STATION_POSITIONS } from './layout';

describe('map layout', () => {
  it('draws the route through the stations in the order the API returned them', () => {
    const points = routePoints({ stations: ['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB'] });
    expect(points).toEqual(['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB'].map((id) => STATION_POSITIONS[id]));
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
    const stations = [{ id: 'VIC', name: 'Victoria', lat: 51.4965, lon: -0.1447, stepFreeStreetAccess: true }];
    const north = placeOnMap(stations, 'VIC', 51.5, -0.1447);
    const vic = STATION_POSITIONS.VIC;
    expect(north.y).toBeLessThan(vic.y);
    expect(Math.hypot(north.x - vic.x, north.y - vic.y)).toBeLessThanOrEqual(44);
  });
});
