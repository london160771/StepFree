import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { RoutingGraph } from '../src/graph/routing.js';
import { loadNetwork } from '../src/network/load.js';
import type { LiftDisruptionSnapshot } from '../src/tfl/liftDisruptions.js';

const network = loadNetwork();
let routing: RoutingGraph;
let liveSnapshot: LiftDisruptionSnapshot | Error = { fetchedAt: '2026-01-01T00:00:00.000Z', disruptions: [] };
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  routing = await RoutingGraph.connect(process.env.FALKORDB_URL ?? 'redis://127.0.0.1:6379', network, 'stepfree_test_api');
  app = createApp({
    routing,
    liveDisruptions: async () => {
      if (liveSnapshot instanceof Error) throw liveSnapshot;
      return liveSnapshot;
    },
  });
});

afterAll(async () => {
  await routing?.close();
});

describe('Route API', () => {
  it('returns the network from FalkorDB', async () => {
    const res = await request(app).get('/api/network').expect(200);
    expect(res.body.stations).toHaveLength(17);
    expect(new Set(res.body.stations.map((s: { id: string }) => s.id)).size).toBe(17);
    for (const s of res.body.stations) {
      expect(typeof s.lat).toBe('number');
      expect(typeof s.lon).toBe('number');
      // Only what the map needs: no topology, lifts or raw TfL data.
      expect(Object.keys(s).sort()).toEqual(['id', 'lat', 'lon', 'name', 'stepFreeStreetAccess']);
    }
    expect(res.body.edges.some((e: { type: string }) => e.type === 'RIDE')).toBe(true);
    expect(JSON.stringify(res.body).length).toBeLessThan(20_000);
    expect(res.body.edges.every((e: { type: string }) => e.type === 'RIDE')).toBe(true);
    expect(res.body.demoOutage.liftUniqueId).toBe('940GZZLUGPK-Lift-2');
  });

  it('Demo Mode: baseline then outage reroute', async () => {
    const baseline = await request(app).post('/api/route').send({ from: 'VIC', to: 'LNB', mode: 'demo' }).expect(200);
    expect(baseline.body.route.stations).toEqual(['VIC', 'GPK', 'WSM', 'WLO', 'SWK', 'LNB']);
    expect(baseline.body.unavailable.transferIds).toEqual([]);

    const outage = await request(app).post('/api/route').send({ from: 'VIC', to: 'LNB', mode: 'demo', outage: true }).expect(200);
    expect(outage.body.route.stations).toEqual(['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB']);
    expect(outage.body.unavailable.lifts[0].liftUniqueId).toBe('940GZZLUGPK-Lift-2');
    expect(baseline.body.route.totalMinutes).toBe(35);
    expect(outage.body.route.totalMinutes).toBe(39);

    // Resetting the outage restores the original graph behaviour.
    const reset = await request(app).post('/api/route').send({ from: 'VIC', to: 'LNB', mode: 'demo' }).expect(200);
    expect(reset.body.route.stations).toEqual(baseline.body.route.stations);
    expect(reset.body.route.totalMinutes).toBe(35);
  });

  it('plans journeys between any two supported stations, and the route comes back from FalkorDB', async () => {
    const res = await request(app).post('/api/route').send({ from: 'BND', to: 'CAN', mode: 'demo' }).expect(200);
    expect(res.body.route.stations).toEqual(['BND', 'GPK', 'WSM', 'WLO', 'SWK', 'LNB', 'CWR', 'CAN']);
    expect(res.body.route.graph).toMatch(/^stepfree/);
    expect(res.body.route.legs.find((l: { type: string }) => l.type === 'ride').lines).toEqual(['jubilee']);
    const west = await request(app).post('/api/route').send({ from: 'PAD', to: 'TWH', mode: 'demo' }).expect(200);
    expect(west.body.route.stations).toEqual(['PAD', 'KGX', 'FCN', 'MGT', 'LST', 'TWH']);
  });

  it('rejects unsupported stations and modes', async () => {
    await request(app).post('/api/route').send({ from: 'VIC', to: 'BANK', mode: 'demo' }).expect(400);
    await request(app).post('/api/route').send({ from: 'VIC', to: 'VIC', mode: 'demo' }).expect(400);
    await request(app).post('/api/route').send({ from: 'VIC', to: 'LNB', mode: 'other' }).expect(400);
  });

  it('explains when a station has no step-free street access', async () => {
    const res = await request(app).post('/api/route').send({ from: 'SJP', to: 'LNB', mode: 'demo' }).expect(200);
    expect(res.body.route).toBeNull();
    expect(res.body.noRouteReason).toMatch(/St James's Park/);
  });

  it('answers a calm no-route result when a lift outage leaves no step-free path', async () => {
    const lift = network.lifts.find((l) => l.stationId === 'CAN' && l.liftUniqueId.includes('LU 2'))!;
    liveSnapshot = {
      fetchedAt: '2026-01-01T00:00:00.000Z',
      disruptions: [{ liftUniqueId: lift.liftUniqueId, stationId: 'CAN', friendlyName: lift.friendlyName, message: 'Lift out of service' }],
    };
    const res = await request(app).post('/api/route').send({ from: 'BND', to: 'CAN', mode: 'live' }).expect(200);
    expect(res.body.route).toBeNull();
    expect(res.body.noRouteReason).toBe('No step-free route is currently available in the supported network.');
    liveSnapshot = { fetchedAt: '2026-01-01T00:00:00.000Z', disruptions: [] };
  });
});

describe('Live Mode API', () => {
  it('uses current TfL lift disruptions for routing', async () => {
    liveSnapshot = {
      fetchedAt: '2026-01-01T00:00:00.000Z',
      disruptions: [{ liftUniqueId: '940GZZLUGPK-Lift-2', stationId: 'GPK', friendlyName: 'Lift 2', message: 'Faulty lift' }],
    };
    const res = await request(app).post('/api/route').send({ from: 'VIC', to: 'LNB', mode: 'live' }).expect(200);
    expect(res.body.route.stations).toEqual(['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB']);
    expect(res.body.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('maps a London location to the nearest supported station', async () => {
    liveSnapshot = { fetchedAt: '2026-01-01T00:00:00.000Z', disruptions: [] };
    // Near Buckingham Palace Road, closest to Victoria.
    const res = await request(app).post('/api/live/status').send({ lat: 51.4955, lon: -0.1445 }).expect(200);
    expect(res.body.inLondon).toBe(true);
    expect(res.body.nearestStation.id).toBe('VIC');
  });

  it('considers all 17 stations when finding the nearest one', async () => {
    const near = async (id: string) => {
      const s = network.stations.find((x) => x.id === id)!;
      // A few metres from the station.
      const res = await request(app).post('/api/live/status').send({ lat: s.lat + 0.0002, lon: s.lon + 0.0002 }).expect(200);
      return res.body.nearestStation.id as string;
    };
    for (const s of network.stations.filter((x) => x.stepFreeStreetAccess)) expect(await near(s.id), s.name).toBe(s.id);
  });

  it('does not map users to a station without step-free street access', async () => {
    const sjp = network.stations.find((s) => s.id === 'SJP')!;
    const res = await request(app).post('/api/live/status').send({ lat: sjp.lat, lon: sjp.lon }).expect(200);
    expect(res.body.nearestStation.id).not.toBe('SJP');
  });

  it('is London only', async () => {
    const res = await request(app).post('/api/live/status').send({ lat: 53.4808, lon: -2.2426 }).expect(200);
    expect(res.body).toEqual({ inLondon: false, message: 'Live Mode is currently available in London only.' });
  });

  it('reports when live TfL data cannot be reached', async () => {
    liveSnapshot = new Error('offline');
    await request(app).post('/api/route').send({ from: 'VIC', to: 'LNB', mode: 'live' }).expect(503);
    liveSnapshot = { fetchedAt: '2026-01-01T00:00:00.000Z', disruptions: [] };
  });
});
