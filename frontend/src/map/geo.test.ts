import { describe, expect, it } from 'vitest';
import { journeySecondsGeo, lengthKm, lineUpTo, pointAlong, type LngLat } from './geo';

// Station coordinates (TfL StopPoint) along the Demo baseline: Victoria, Green Park, Westminster, Waterloo, Southwark, London Bridge.
const baseline: LngLat[] = [
  [-0.1447, 51.4965],
  [-0.1428, 51.5067],
  [-0.1254, 51.501],
  [-0.1143, 51.5036],
  [-0.1052, 51.5039],
  [-0.0864, 51.5052],
];

describe('geographic route helpers', () => {
  it('measures the baseline route length in kilometres', () => {
    expect(lengthKm(baseline)).toBeGreaterThan(4);
    expect(lengthKm(baseline)).toBeLessThan(6);
  });

  it('draws a route progressively from its start', () => {
    expect(lineUpTo(baseline, 0)).toEqual([baseline[0], baseline[0]]);
    expect(lineUpTo(baseline, 1)).toEqual(baseline);
    expect(pointAlong(baseline, 1)).toEqual(baseline.at(-1));
  });

  it('keeps the wheelchair-user journey slow and readable', () => {
    expect(journeySecondsGeo(baseline)).toBeGreaterThan(14);
    expect(journeySecondsGeo(baseline)).toBeLessThanOrEqual(18);
    expect(journeySecondsGeo(baseline.slice(3, 5))).toBe(7);
  });
});
