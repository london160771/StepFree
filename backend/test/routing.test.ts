import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoutingGraph, type RouteResult } from '../src/graph/routing.js';
import { loadNetwork } from '../src/network/load.js';

const network = loadNetwork();
let routing: RoutingGraph;

beforeAll(async () => {
  routing = await RoutingGraph.connect(process.env.FALKORDB_URL ?? 'redis://127.0.0.1:6379', network, 'stepfree_test_routing');
});

afterAll(async () => {
  await routing?.close();
});

const rideLines = (route: RouteResult) => route.legs.flatMap((l) => (l.type === 'ride' ? [l.lines] : []));
const interchanges = (route: RouteResult) => route.legs.filter((l) => l.type === 'transfer' && l.kind === 'interchange');
const expectRoute = (route: RouteResult | null): RouteResult => {
  expect(route).not.toBeNull();
  return route!;
};

describe('FalkorDB graph', () => {
  it('stores 17 stations, their platform nodes and the ride and transfer edges', async () => {
    const edges = await routing.edges(routing.baseGraph);
    expect(edges.filter((e) => e.type === 'RIDE')).toHaveLength(network.rides.length);
    expect(edges.filter((e) => e.type === 'STEP_FREE_TRANSFER')).toHaveLength(network.transfers.length);
    const stationsInGraph = new Set(edges.flatMap((e) => [e.from.split(':')[0], e.to.split(':')[0]]));
    expect(network.stations.filter((s) => s.stepFreeStreetAccess).every((s) => stationsInGraph.has(s.id))).toBe(true);
  });
});

describe('Demo Mode: Victoria -> London Bridge (unchanged)', () => {
  it('returns the baseline via Green Park in 35 min', async () => {
    const route = expectRoute(await routing.route('VIC', 'LNB', routing.baseGraph));
    expect(route.stations).toEqual(['VIC', 'GPK', 'WSM', 'WLO', 'SWK', 'LNB']);
    expect(rideLines(route)).toEqual([['victoria'], ['jubilee']]);
    expect(route.totalMinutes).toBe(35);
  });

  it('reroutes via the District line and Westminster in 39 min when Green Park Lift 2 is unavailable', async () => {
    const scenario = await routing.scenarioGraph([network.demoOutage.liftUniqueId]);
    expect(scenario.name).not.toBe(routing.baseGraph);
    const baseline = expectRoute(await routing.route('VIC', 'LNB', routing.baseGraph));
    const reroute = expectRoute(await routing.route('VIC', 'LNB', scenario.name));
    expect(reroute.stations).toEqual(['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB']);
    expect(rideLines(reroute).map((l) => l[0])).toEqual(['district', 'jubilee']);
    expect(reroute.legs.some((l) => l.type === 'transfer' && l.stationId === 'SJP')).toBe(false);
    expect(reroute.totalMinutes).toBe(39);
    expect(reroute.totalMinutes).toBeGreaterThan(baseline.totalMinutes);
  });

  it('keeps the unavailable connections out of routing, and restores the baseline afterwards', async () => {
    const scenario = await routing.scenarioGraph([network.demoOutage.liftUniqueId]);
    const edges = await routing.edges(scenario.name);
    const unavailable = edges.filter((e) => e.type === 'UNAVAILABLE_TRANSFER').map((e) => e.id).sort();
    expect(unavailable).toEqual([...network.demoOutage.affectedTransferIds].sort());
    const base = await routing.edges(routing.baseGraph);
    expect(base.some((e) => e.type === 'UNAVAILABLE_TRANSFER')).toBe(false);
    // "Resetting" the outage is simply routing on the base graph (or an empty lift set) again.
    const none = await routing.scenarioGraph([]);
    expect(none.name).toBe(routing.baseGraph);
    expect(expectRoute(await routing.route('VIC', 'LNB', none.name)).totalMinutes).toBe(35);
  });

  it('can still reach Green Park on the Victoria line during the outage', async () => {
    const scenario = await routing.scenarioGraph([network.demoOutage.liftUniqueId]);
    expect(expectRoute(await routing.route('VIC', 'GPK', scenario.name)).stations).toEqual(['VIC', 'GPK']);
  });
});

describe('Expanded network: genuinely different journeys, all computed by FalkorDB', () => {
  it('Bond Street -> Canary Wharf: Jubilee line all the way, no changes', async () => {
    const route = expectRoute(await routing.route('BND', 'CAN', routing.baseGraph));
    expect(route.stations).toEqual(['BND', 'GPK', 'WSM', 'WLO', 'SWK', 'LNB', 'CWR', 'CAN']);
    expect(rideLines(route)).toEqual([['jubilee']]);
    expect(interchanges(route)).toHaveLength(0);
  });

  it('Victoria -> Tower Hill: District/Circle line via Westminster', async () => {
    const route = expectRoute(await routing.route('VIC', 'TWH', routing.baseGraph));
    expect(route.stations).toEqual(['VIC', 'SJP', 'WSM', 'TWH']);
    expect(rideLines(route)).toEqual([['district', 'circle']]);
    const ride = route.legs.find((l) => l.type === 'ride')!;
    expect(ride.type === 'ride' && ride.via).toEqual(['Embankment', 'Temple', 'Blackfriars', 'Mansion House', 'Cannon Street', 'Monument']);
  });

  it("King's Cross -> London Bridge: Northern line via Moorgate", async () => {
    const route = expectRoute(await routing.route('KGX', 'LNB', routing.baseGraph));
    expect(route.stations).toEqual(['KGX', 'MGT', 'LNB']);
    expect(rideLines(route)).toEqual([['northern']]);
  });

  it('Farringdon -> Liverpool Street: Metropolitan/H&C/Circle platform via Moorgate', async () => {
    const route = expectRoute(await routing.route('FCN', 'LST', routing.baseGraph));
    expect(route.stations).toEqual(['FCN', 'MGT', 'LST']);
    expect(rideLines(route)[0]).toEqual(expect.arrayContaining(['metropolitan', 'circle']));
  });

  it('Paddington -> Tower Hill: Circle line, passing unsupported stops', async () => {
    const route = expectRoute(await routing.route('PAD', 'TWH', routing.baseGraph));
    expect(route.stations).toEqual(['PAD', 'KGX', 'FCN', 'MGT', 'LST', 'TWH']);
    expect(rideLines(route)).toEqual([['circle']]);
  });

  it('Paddington -> Canary Wharf needs accessible changes at King\'s Cross and London Bridge', async () => {
    const route = expectRoute(await routing.route('PAD', 'CAN', routing.baseGraph));
    expect(route.stations).toEqual(['PAD', 'KGX', 'MGT', 'LNB', 'CWR', 'CAN']);
    expect(interchanges(route).map((l) => l.type === 'transfer' && l.stationId)).toEqual(['KGX', 'LNB']);
    for (const leg of interchanges(route)) expect(leg.type === 'transfer' && leg.lifts.length).toBeGreaterThan(0);
  });

  it('Tottenham Court Road -> Canary Wharf changes from Central to Jubilee at Bond Street', async () => {
    const route = expectRoute(await routing.route('TCR', 'CAN', routing.baseGraph));
    expect(route.stations.slice(0, 3)).toEqual(['TCR', 'BND', 'GPK']);
    expect(interchanges(route).map((l) => l.type === 'transfer' && l.stationId)).toEqual(['BND']);
  });

  it('a journey is symmetric in coverage: every pair of step-free stations is routable', async () => {
    const open = network.stations.filter((s) => s.stepFreeStreetAccess).map((s) => s.id);
    expect(open).toHaveLength(16);
    for (const a of open) for (const b of open) if (a !== b) expect(await routing.route(a, b, routing.baseGraph), `${a}->${b}`).not.toBeNull();
  });
});

describe('Partial access and no-route handling', () => {
  it('arrives at Liverpool Street eastbound only, never by the inaccessible westbound platform', async () => {
    const route = expectRoute(await routing.route('FCN', 'LST', routing.baseGraph));
    expect(route.nodeIds.at(-2)!).toMatch(/^LST:.*:EB$/);
    // From Tower Hill the Circle train arrives at Liverpool Street westbound, where nobody can get off
    // step-free. FalkorDB has to ride on to Moorgate, change platform there and come back eastbound.
    const fromTower = expectRoute(await routing.route('TWH', 'LST', routing.baseGraph));
    expect(fromTower.nodeIds.at(-2)!).toMatch(/^LST:.*:EB$/);
    expect(interchanges(fromTower).map((l) => l.type === 'transfer' && l.stationId)).toEqual(['MGT']);
    expect(fromTower.totalMinutes).toBeGreaterThan(20);
  });

  it("finds no step-free route from St James's Park", async () => {
    expect(await routing.route('SJP', 'LNB', routing.baseGraph)).toBeNull();
    expect(await routing.route('LNB', 'SJP', routing.baseGraph)).toBeNull();
  });

  it('returns no route (never a made-up one) when a lift outage cuts a station off', async () => {
    const lifts = network.lifts.filter((l) => l.stationId === 'CAN' && l.liftUniqueId.includes('LU 2'));
    expect(lifts).toHaveLength(1);
    const scenario = await routing.scenarioGraph([lifts[0].liftUniqueId]);
    expect(await routing.route('BND', 'CAN', scenario.name)).toBeNull();
    expect(expectRoute(await routing.route('BND', 'CWR', scenario.name)).stations.at(-1)).toBe('CWR');
  });
});
