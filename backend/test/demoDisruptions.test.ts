import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_DISRUPTION_KINDS, demoDisruptionCatalogue, type DemoDisruptionKind } from '../src/agent/demoDisruptions.js';
import { createAgentRuntime, type AgentRuntime } from '../src/agent/index.js';
import { MAX_TOOL_CALLS } from '../src/agent/journeyAgent.js';
import { createApp } from '../src/app.js';
import { RoutingGraph, type RouteResult } from '../src/graph/routing.js';
import { parseConnection } from '../src/network/connections.js';
import { loadNetwork } from '../src/network/load.js';
import { policyModel } from './fakeModel.js';

const network = loadNetwork();
const catalogue = demoDisruptionCatalogue(network);
let routing: RoutingGraph;
let server: Server;
const noLive = async () => ({ fetchedAt: '2026-10-17T10:00:00Z', disruptions: [] });

beforeAll(async () => {
  routing = await RoutingGraph.connect(process.env.FALKORDB_URL ?? 'redis://127.0.0.1:6379', network, 'stepfree_test_judge');
});
afterAll(async () => {
  server?.close();
  await routing?.close();
});

const routeIn = async (from: string, to: string, ids: string[]): Promise<RouteResult | null> => routing.route(from, to, (await routing.scenarioGraph(ids)).name);
const ridesLines = (route: RouteResult) => route.legs.flatMap((l) => (l.type === 'ride' ? l.lines : []));
const usesStation = (route: RouteResult, stationId: string) => route.transferIds.some((id) => network.transfers.find((t) => t.id === id)?.stationId === stationId);

describe('One generic disruption model', () => {
  it('has exactly three controlled scenarios, each just a connection id the graph understands', () => {
    expect(DEMO_DISRUPTION_KINDS).toEqual(['LIFT', 'STATION', 'LINE']);
    for (const kind of DEMO_DISRUPTION_KINDS) {
      const event = catalogue[kind];
      expect(event.kind).toBe(kind);
      expect(parseConnection(network, event.id)?.kind).toBe(kind);
    }
    expect(catalogue.LIFT.id).toBe('940GZZLUGPK-Lift-2');
    expect(catalogue.STATION.id).toBe('STATION:GPK');
    expect(catalogue.LINE.id).toBe('LINE:jubilee');
    expect(catalogue.STATION.closed).toBe(true);
    expect(catalogue.LIFT.closed).toBe(false);
  });

  it('refuses ids that name nothing in the supported network', () => {
    expect(parseConnection(network, 'STATION:XXX')).toBeNull();
    expect(parseConnection(network, 'LINE:dlr')).toBeNull();
    expect(parseConnection(network, 'NOT-A-LIFT')).toBeNull();
  });
});

describe('Graph effects of each scenario on Victoria -> London Bridge (computed by FalkorDB)', () => {
  it('baseline is 35 min via Green Park (Victoria line, then Jubilee line)', async () => {
    const route = (await routeIn('VIC', 'LNB', []))!;
    expect(route.totalMinutes).toBe(35);
    expect(route.stations).toEqual(['VIC', 'GPK', 'WSM', 'WLO', 'SWK', 'LNB']);
  });

  it('LIFT: Green Park Lift 2 out gives 39 min via St James\'s Park and Westminster', async () => {
    const route = (await routeIn('VIC', 'LNB', [catalogue.LIFT.id]))!;
    expect(route.totalMinutes).toBe(39);
    expect(route.stations).toEqual(['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB']);
  });

  it('STATION: Green Park closed cannot be boarded, alighted or interchanged at, and FalkorDB finds another valid route', async () => {
    const route = (await routeIn('VIC', 'LNB', [catalogue.STATION.id]))!;
    expect(route).not.toBeNull();
    expect(usesStation(route, 'GPK')).toBe(false);
    expect(route.totalMinutes).toBeGreaterThan(35);
    expect(route.stations).toEqual(['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB']);
  });

  it('STATION: a closed station is run through, so a route that only passes it still works', async () => {
    // The Victoria line passes Green Park without anyone using it: Plan B-style routes may still ride through.
    const route = (await routeIn('VIC', 'KGX', [catalogue.STATION.id]))!;
    expect(route).not.toBeNull();
    expect(usesStation(route, 'GPK')).toBe(false);
    expect(route.stations).toContain('GPK');
  });

  it('STATION: a closed origin or destination has no route, and nothing is invented', async () => {
    expect(await routeIn('GPK', 'LNB', [catalogue.STATION.id])).toBeNull();
    expect(await routeIn('VIC', 'GPK', [catalogue.STATION.id])).toBeNull();
  });

  it('LINE: Jubilee line disrupted gives a clearly different 52 min journey via King\'s Cross and the Northern line', async () => {
    const route = (await routeIn('VIC', 'LNB', [catalogue.LINE.id]))!;
    expect(route).not.toBeNull();
    expect(route.totalMinutes).toBe(52);
    expect(route.stations).toEqual(['VIC', 'GPK', 'KGX', 'MGT', 'LNB']);
    expect(ridesLines(route)).not.toContain('jubilee');
    expect(ridesLines(route)).toContain('northern');
  });

  it('LINE: a ride that another line also serves survives one of them being disrupted', async () => {
    const route = (await routeIn('VIC', 'TWH', ['LINE:circle']))!;
    expect(route).not.toBeNull();
    expect(ridesLines(route)).toContain('district');
  });

  it('an unrelated disruption leaves the journey unchanged', async () => {
    const base = (await routeIn('VIC', 'LNB', []))!;
    for (const id of ['STATION:BND', 'STATION:CAN', 'LINE:central', 'LINE:district']) {
      const route = (await routeIn('VIC', 'LNB', [id]))!;
      expect(route.stations, id).toEqual(base.stations);
      expect(route.totalMinutes, id).toBe(base.totalMinutes);
    }
  });

  it('reset restores the whole graph, across repeated cycles, with no stale exclusions', async () => {
    const baseline = (await routeIn('VIC', 'LNB', []))!;
    for (const kind of ['LIFT', 'STATION', 'LINE', 'STATION', 'LIFT', 'LINE'] as DemoDisruptionKind[]) {
      const during = (await routeIn('VIC', 'LNB', [catalogue[kind].id]))!;
      expect(during.totalMinutes, kind).toBeGreaterThan(baseline.totalMinutes);
      const after = (await routeIn('VIC', 'LNB', []))!;
      expect(after.totalMinutes, `reset after ${kind}`).toBe(35);
      expect(after.stations).toEqual(baseline.stations);
    }
    expect((await routing.scenarioGraph([])).name).toBe(routing.baseGraph);
  });

  it('every scenario leaves a valid alternative for the judge journey', async () => {
    for (const kind of DEMO_DISRUPTION_KINDS) expect(await routeIn('VIC', 'LNB', [catalogue[kind].id]), kind).not.toBeNull();
  });
});

describe('The agent decides what each simulated disruption means', () => {
  async function boot(origin: string, destination: string): Promise<{ runtime: AgentRuntime; app: ReturnType<typeof createApp>; first: any }> {
    const runtime = createAgentRuntime({ routing, liveDisruptions: noLive, model: policyModel({ origin, destination }) });
    const app = createApp({ routing, liveDisruptions: noLive, agent: runtime });
    server?.close();
    server = app.listen(0);
    runtime.setMcpUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    const first = (await request(app).post('/api/agent/journey').send({ origin, destination, mode: 'demo', demoDisruption: null })).body;
    return { runtime, app, first };
  }
  const recheck = async (ctx: { runtime: AgentRuntime; app: ReturnType<typeof createApp>; first: any }, origin: string, destination: string, demoDisruption: DemoDisruptionKind | null) => {
    const routeId = ctx.runtime.state.sessions.get(ctx.first.sessionId)!.currentRouteId!;
    ctx.runtime.agent['deps'].model = policyModel({ origin, destination, recheckRouteId: routeId });
    return (await request(ctx.app).post('/api/agent/journey').send({ sessionId: ctx.first.sessionId, mode: 'demo', demoDisruption })).body;
  };
  const tools = (res: any) => res.trace.map((t: any) => t.tool);

  it('Run Demo: the healthy journey, with Route Health Clear and Plan B, in 4 calls and no location', async () => {
    const { first } = await boot('Victoria', 'London Bridge');
    expect(first.status).toBe('ROUTE_SELECTED');
    expect(first.route.route.totalMinutes).toBe(35);
    expect(first.routeHealth.status).toBe('CLEAR');
    expect(first.planB.available).toBe(true);
    expect(first.disruptions).toEqual([]);
    expect(tools(first)).toEqual(['plan_step_free_journey', 'get_journey_disruptions', 'find_backup_route', 'record_journey_decision']);
  });

  it.each([
    ['LIFT', 'LIFT_DISRUPTION', 39, 'Green Park Lift 2 is unavailable', ['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB']],
    ['STATION', 'STATION_CLOSURE', 39, 'Green Park station is closed', ['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB']],
    ['LINE', 'LINE_DISRUPTION', 52, 'Jubilee line is unavailable', ['VIC', 'GPK', 'KGX', 'MGT', 'LNB']],
  ] as const)('%s: the agent finds the journey affected and FalkorDB reroutes', async (kind, reason, minutes, phrase, stations) => {
    const ctx = await boot('Victoria', 'London Bridge');
    const res = await recheck(ctx, 'Victoria', 'London Bridge', kind);
    expect(res.status).toBe('REROUTED');
    expect(res.routeHealth).toEqual({ status: 'REROUTED', affectedConnectionIds: [catalogue[kind].id] });
    expect(res.route.route.totalMinutes).toBe(minutes);
    expect(res.route.route.stations).toEqual(stations);
    expect(tools(res)).toEqual(['get_journey_disruptions', 'find_alternative_route', 'find_backup_route', 'record_journey_decision']);
    expect(res.agent.toolCalls).toBeLessThanOrEqual(MAX_TOOL_CALLS);
    expect(res.disruptions[0]).toMatchObject({ kind, id: catalogue[kind].id, simulated: true });
    expect(res.message).toContain(phrase);
    expect(res.message).toContain(`${minutes} minutes`);
    expect(res.trace[0].summary).toMatch(/\(simulated\)$/);
    expect(res.trace[1].args.unavailableConnectionIds).toEqual([catalogue[kind].id]);
    // Plan B is recalculated for the new route and respects the disruption that is still active.
    if (res.planB.available) {
      expect(res.planB.routeSignature).not.toBe(ctx.first.planB.routeSignature);
      const backup = res.planB.route as RouteResult;
      if (kind === 'LINE') expect(ridesLines(backup)).not.toContain('jubilee');
      if (kind === 'STATION') expect(usesStation(backup, 'GPK')).toBe(false);
    }
    expect(res.whyThisRoute.reasons[0]).toMatch(/^Your previous (route depended on Green Park Lift 2|journey needed Green Park station|journey used the Jubilee line), which is (unavailable|closed)$/);
    const decisions = await routing.decisions(ctx.first.sessionId);
    expect(decisions.at(-1)).toMatchObject({ action: 'REROUTED', reasonCode: reason, routeHealth: 'REROUTED' });
  });

  it('records the disruption type on the decision', async () => {
    const ctx = await boot('Victoria', 'London Bridge');
    await recheck(ctx, 'Victoria', 'London Bridge', 'LINE');
    const reply = await routing.decisions(ctx.first.sessionId);
    expect(reply.map((d) => d.action)).toEqual(['ROUTE_SELECTED', 'REROUTED']);
  });

  it('retains the route when a simulated disruption does not touch the journey', async () => {
    const ctx = await boot("King's Cross St Pancras", 'Moorgate');
    expect(ctx.first.status).toBe('ROUTE_SELECTED');
    for (const kind of ['LIFT', 'STATION', 'LINE'] as DemoDisruptionKind[]) {
      const res = await recheck(ctx, "King's Cross St Pancras", 'Moorgate', kind);
      expect(res.status, kind).toBe('ROUTE_RETAINED');
      expect(res.routeHealth.status, kind).toBe('CLEAR');
      expect(res.route.route.totalMinutes, kind).toBe(ctx.first.route.route.totalMinutes);
      expect(tools(res), kind).not.toContain('find_alternative_route');
      expect(res.whyThisRoute.reasons.join(' '), kind).toMatch(/simulated .* does not affect this journey/);
      expect(res.message, kind).toMatch(/still usable/);
    }
  });

  it('a clicked disruption never forces a reroute, and reset restores the original route', async () => {
    const ctx = await boot('Victoria', 'London Bridge');
    for (const kind of ['LIFT', 'STATION', 'LINE'] as DemoDisruptionKind[]) {
      const hit = await recheck(ctx, 'Victoria', 'London Bridge', kind);
      expect(hit.status, kind).toBe('REROUTED');
      // Reset = a fresh Demo journey in a new session: clean graph, no stale exclusions.
      const reset = await boot('Victoria', 'London Bridge');
      expect(reset.first.status).toBe('ROUTE_SELECTED');
      expect(reset.first.route.route.totalMinutes).toBe(35);
      expect(reset.first.disruptions).toEqual([]);
      ctx.runtime = reset.runtime;
      ctx.app = reset.app;
      ctx.first = reset.first;
    }
  });

  it('rejects an unknown disruption kind', async () => {
    const { app } = await boot('Victoria', 'London Bridge');
    const res = await request(app).post('/api/agent/journey').send({ origin: 'Victoria', destination: 'London Bridge', mode: 'demo', demoDisruption: 'METEOR' });
    expect(res.status).toBe(400);
  });

  it('offers the three simulated events to the app, labelled and flagged simulated', async () => {
    const { app } = await boot('Victoria', 'London Bridge');
    const res = await request(app).get('/api/network');
    expect(res.body.demoDisruptions.map((d: any) => [d.kind, d.simulated])).toEqual([['LIFT', true], ['STATION', true], ['LINE', true]]);
    expect(res.body.demoDisruptions.map((d: any) => d.label)).toEqual(['Green Park Lift 2', 'Green Park station', 'Jubilee line']);
  });
});
