import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoutingGraph } from '../src/graph/routing.js';
import { loadNetwork } from '../src/network/load.js';

const network = loadNetwork();
let routing: RoutingGraph;

beforeAll(async () => {
  routing = await RoutingGraph.connect(process.env.FALKORDB_URL ?? 'redis://127.0.0.1:6379', network, 'stepfree_test_routing');
});

afterAll(async () => {
  await routing?.close();
});

describe('FalkorDB routing (Phase 1)', () => {
  it('returns the baseline Victoria -> London Bridge route via Green Park', async () => {
    const route = await routing.route('VIC', 'LNB', routing.baseGraph);
    expect(route).not.toBeNull();
    expect(route!.stations).toEqual(['VIC', 'GPK', 'WSM', 'WLO', 'SWK', 'LNB']);
    expect(route!.legs.filter((l) => l.type === 'ride').map((l) => l.type === 'ride' && l.line)).toEqual(['victoria', 'jubilee']);
    const weights = await routing.edges(routing.baseGraph);
    expect(route!.totalMinutes).toBeGreaterThan(0);
    expect(weights.length).toBeGreaterThan(0);
  });

  it('reroutes via the District line and Westminster when Green Park Lift 2 is unavailable', async () => {
    const scenario = await routing.scenarioGraph([network.demoOutage.liftUniqueId]);
    expect(scenario.name).not.toBe(routing.baseGraph);
    const baseline = await routing.route('VIC', 'LNB', routing.baseGraph);
    const reroute = await routing.route('VIC', 'LNB', scenario.name);
    expect(reroute!.stations).toEqual(['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB']);
    expect(reroute!.legs.filter((l) => l.type === 'ride').map((l) => l.type === 'ride' && l.line)).toEqual(['district', 'jubilee']);
    // St James's Park is passed on the train, never used as a transfer.
    expect(reroute!.legs.some((l) => l.type === 'transfer' && l.stationId === 'SJP')).toBe(false);
    expect(reroute!.totalMinutes).toBeGreaterThan(baseline!.totalMinutes);
  });

  it('keeps unavailable connections in the scenario graph but out of routing', async () => {
    const scenario = await routing.scenarioGraph([network.demoOutage.liftUniqueId]);
    const edges = await routing.edges(scenario.name);
    const unavailable = edges.filter((e) => e.type === 'UNAVAILABLE_TRANSFER').map((e) => e.id).sort();
    expect(unavailable).toEqual([...network.demoOutage.affectedTransferIds].sort());
    // The base graph is untouched.
    const base = await routing.edges(routing.baseGraph);
    expect(base.some((e) => e.type === 'UNAVAILABLE_TRANSFER')).toBe(false);
  });

  it('can still reach Green Park on the Victoria line during the outage', async () => {
    const scenario = await routing.scenarioGraph([network.demoOutage.liftUniqueId]);
    const route = await routing.route('VIC', 'GPK', scenario.name);
    expect(route!.stations).toEqual(['VIC', 'GPK']);
  });

  it("finds no step-free route from St James's Park", async () => {
    expect(await routing.route('SJP', 'LNB', routing.baseGraph)).toBeNull();
  });
});
