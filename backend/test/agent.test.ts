import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAgentRuntime, type AgentRuntime } from '../src/agent/index.js';
import { claimsAreSupported, deterministicMessage } from '../src/agent/grounding.js';
import { MAX_TOOL_CALLS } from '../src/agent/journeyAgent.js';
import { TOOL_NAMES } from '../src/agent/toolbox.js';
import { createApp } from '../src/app.js';
import { RoutingGraph } from '../src/graph/routing.js';
import { loadNetwork } from '../src/network/load.js';
import type { LiftDisruptionSource } from '../src/tfl/liftDisruptions.js';
import { policyModel, scriptedModel } from './fakeModel.js';

const network = loadNetwork();
const LIFT_2 = network.demoOutage.liftUniqueId;
let routing: RoutingGraph;
let server: Server;
let baseUrl: string;
let liveDisruptions: LiftDisruptionSource = async () => ({ fetchedAt: '2026-10-17T10:00:00Z', disruptions: [] });

beforeAll(async () => {
  routing = await RoutingGraph.connect(process.env.FALKORDB_URL ?? 'redis://127.0.0.1:6379', network, 'stepfree_test_agent');
});

afterAll(async () => {
  server?.close();
  await routing?.close();
});

/** A real app with the real /mcp endpoint, listening on a free port so the agent host connects over HTTP. */
async function boot(model: Parameters<typeof createAgentRuntime>[0]['model']): Promise<{ runtime: AgentRuntime; app: ReturnType<typeof createApp> }> {
  const runtime = createAgentRuntime({ routing, liveDisruptions: () => liveDisruptions(), model });
  const app = createApp({ routing, liveDisruptions: () => liveDisruptions(), agent: runtime });
  server?.close();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  runtime.setMcpUrl(`${baseUrl}/mcp`);
  return { runtime, app };
}

const journey = (app: ReturnType<typeof createApp>, body: object) => request(app).post('/api/agent/journey').send(body);
const tools = (res: { body: { trace: { tool: string }[] } }) => res.body.trace.map((t) => t.tool);

describe('MCP server', () => {
  it('lists exactly the six approved tools and no query or code tool', async () => {
    const { runtime } = await boot(null);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${runtime.mcpToken}` } } }));
    const listed = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(listed).toEqual([...TOOL_NAMES].sort());
    expect(listed.join(' ')).not.toMatch(/cypher|query|execute|shell|file|fetch/);
    await client.close();
  });

  it('refuses callers without the backend’s bearer token', async () => {
    const { app } = await boot(null);
    const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
  });

  it('validates every tool’s input before touching the graph', async () => {
    const { runtime } = await boot(null);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${runtime.mcpToken}` } } }));
    const bad: [string, Record<string, unknown>][] = [
      ['resolve_station', { station: '' }],
      ['resolve_station', { station: 'x'.repeat(200) }],
      ['resolve_station', { station: 'Victoria', extra: 'MATCH (n) DETACH DELETE n' }],
      ['plan_step_free_journey', { origin: 'Victoria' }],
      ['plan_step_free_journey', { origin: 'Victoria', destination: 'London Bridge', unavailableConnectionIds: Array.from({ length: 50 }, (_, i) => `L${i}`) }],
      ['plan_step_free_journey', { origin: 'Victoria', destination: 'London Bridge', unavailableConnectionIds: ["x'; MATCH (n) DELETE n //"] }],
      ['inspect_route_dependencies', { routeId: 'not a route id' }],
      ['get_accessibility_disruptions', { mode: 'sometimes' }],
      ['find_alternative_route', { origin: 'Victoria', destination: 'London Bridge', unavailableConnectionIds: [] }],
      ['record_journey_decision', { sessionId: 'abc', origin: 'Victoria', destination: 'London Bridge', action: 'DELETE_EVERYTHING', reasonCode: 'X' }],
    ];
    for (const [name, args] of bad) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBe(true);
    }
    await client.close();
  });

  it('runs the real graph behind a tool: unknown stations are explicit, aliases resolve, unknown lifts are rejected', async () => {
    const { runtime } = await boot(null);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${runtime.mcpToken}` } } }));
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
    expect((await call('resolve_station', { station: 'Atlantis' })).structuredContent).toEqual({ found: false, query: 'Atlantis' });
    expect((await call('resolve_station', { station: 'Victoria Station Underground' })).structuredContent).toMatchObject({ found: true, canonicalStation: 'Victoria', stationId: 'VIC' });
    expect((await call('resolve_station', { station: 'kings cross' })).structuredContent).toMatchObject({ stationId: 'KGX' });
    expect((await call('resolve_station', { station: 'London' })).structuredContent.found).toBe(false);
    const planned = (await call('plan_step_free_journey', { origin: 'Victoria', destination: 'London Bridge' })).structuredContent;
    expect(planned).toMatchObject({ status: 'ROUTE_FOUND', route: { durationMinutes: 35, stations: ['Victoria', 'Green Park', 'Westminster', 'Waterloo', 'Southwark', 'London Bridge'] } });
    const unknownLift = await call('plan_step_free_journey', { origin: 'Victoria', destination: 'London Bridge', unavailableConnectionIds: ['NOT-A-LIFT'] });
    expect(unknownLift.isError).toBe(true);
    const unknownStation = (await call('plan_step_free_journey', { origin: 'Atlantis', destination: 'London Bridge' })).structuredContent;
    expect(unknownStation).toEqual({ status: 'UNKNOWN_STATION', unknown: ['Atlantis'] });
    await client.close();
  });

  it('reads route dependencies from the graph: the Demo route needs Green Park Lift 2', async () => {
    const { runtime } = await boot(null);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${runtime.mcpToken}` } } }));
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
    const planned = (await call('plan_step_free_journey', { origin: 'VIC', destination: 'LNB' })).structuredContent;
    const deps = (await call('inspect_route_dependencies', { routeId: planned.route.routeId })).structuredContent;
    expect(deps.requiredConnectionIds).toContain(LIFT_2);
    expect(deps.dependencies.some((d: any) => d.station === 'Green Park' && d.kind === 'interchange' && d.requiredConnectionIds.includes(LIFT_2))).toBe(true);
    const alt = (await call('find_alternative_route', { origin: 'VIC', destination: 'LNB', unavailableConnectionIds: [LIFT_2] })).structuredContent;
    expect(alt).toMatchObject({ status: 'ROUTE_FOUND', route: { durationMinutes: 39 } });
    expect(alt.route.stations).toContain('Westminster');
    expect(alt.route.stations).not.toContain('Green Park');
    await client.close();
  });
});

describe('Journey agent: model chooses tools, MCP executes them, FalkorDB decides', () => {
  it('Scenario A: a normal journey is selected through MCP tools', async () => {
    const model = policyModel({ origin: 'Victoria', destination: 'London Bridge' });
    const { app } = await boot(model);
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ROUTE_SELECTED');
    expect(tools(res)).toEqual(['resolve_station', 'resolve_station', 'plan_step_free_journey', 'inspect_route_dependencies', 'get_accessibility_disruptions', 'record_journey_decision']);
    expect(res.body.route.route.totalMinutes).toBe(35);
    expect(res.body.route.route.stations).toEqual(['VIC', 'GPK', 'WSM', 'WLO', 'SWK', 'LNB']);
    expect(res.body.message).toBe('Your step-free route is ready. It takes about 35 minutes.');
    expect(res.body.dependencies.length).toBeGreaterThan(0);
    expect(res.body.trace.every((t: any) => t.ok && typeof t.durationMs === 'number' && typeof t.summary === 'string')).toBe(true);
    expect(res.body.trace.length).toBeLessThanOrEqual(MAX_TOOL_CALLS);
    expect(model.toolNames[0].sort()).toEqual([...TOOL_NAMES].sort());
    expect(JSON.stringify(res.body)).not.toMatch(/GEMINI|apiKey|Bearer/i);
  });

  it('Scenario B: the Green Park Lift 2 outage is detected, matched to the route and rerouted in 39 min', async () => {
    const first = await boot(policyModel({ origin: 'Victoria', destination: 'London Bridge' }));
    const started = await journey(first.app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo' });
    const routeId = first.runtime.state.sessions.get(started.body.sessionId)!.currentRouteId!;
    // The user triggers the outage; the same session is re-evaluated by the agent.
    first.runtime.agent['deps'].model = policyModel({ origin: 'Victoria', destination: 'London Bridge', recheckRouteId: routeId });
    const res = await journey(first.app, { sessionId: started.body.sessionId, mode: 'demo', demoOutage: true });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(started.body.sessionId);
    expect(res.body.status).toBe('REROUTED');
    expect(tools(res)).toEqual(['inspect_route_dependencies', 'get_accessibility_disruptions', 'find_alternative_route', 'record_journey_decision']);
    expect(res.body.route.route.totalMinutes).toBe(39);
    expect(res.body.route.route.stations).toEqual(['VIC', 'SJP', 'WSM', 'WLO', 'SWK', 'LNB']);
    expect(res.body.route.unavailable.lifts.map((l: any) => l.liftUniqueId)).toEqual([LIFT_2]);
    expect(res.body.route.unavailable.transferIds.length).toBeGreaterThan(0);
    expect(res.body.disruptions[0]).toMatchObject({ connectionId: LIFT_2, station: 'Green Park' });
    expect(res.body.message).toBe(
      "Green Park Lift 2 is unavailable and your current journey depended on it. I've found another step-free route through Westminster. It takes about 39 minutes.",
    );
    const disruptionStep = res.body.trace.find((t: any) => t.tool === 'get_accessibility_disruptions');
    expect(disruptionStep.summary).toBe('Detected Green Park Lift 2 unavailable');
    expect(res.body.trace.find((t: any) => t.tool === 'find_alternative_route').args.unavailableConnectionIds).toEqual([LIFT_2]);

    // The decisions are in FalkorDB, linked to the journey session.
    const decisions = await routing.decisions(started.body.sessionId);
    expect(decisions.map((d) => d.action)).toEqual(['ROUTE_SELECTED', 'REROUTED']);
    expect(decisions[1]).toMatchObject({ reasonCode: 'REQUIRED_LIFT_UNAVAILABLE', routeDuration: 39, affectedStationIds: ['GPK'] });

    // Clearing the outage: the agent plans again and returns to the faster route.
    const afterRouteId = first.runtime.state.sessions.get(started.body.sessionId)!.currentRouteId!;
    first.runtime.agent['deps'].model = policyModel({ origin: 'Victoria', destination: 'London Bridge', recheckRouteId: afterRouteId });
    const reset = await journey(first.app, { sessionId: started.body.sessionId, mode: 'demo', demoOutage: false });
    expect(reset.body.status).toBe('ROUTE_SELECTED');
    expect(reset.body.route.route.totalMinutes).toBe(35);
    expect(reset.body.route.unavailable.lifts).toEqual([]);
  });

  it('keeps the route when nothing on it is affected (live disruption elsewhere)', async () => {
    liveDisruptions = async () => ({
      fetchedAt: '2026-10-17T10:00:00Z',
      disruptions: [{ liftUniqueId: network.lifts.find((l) => l.stationId === 'CAN')!.liftUniqueId, stationId: 'CAN', friendlyName: 'Lift', message: 'Out of service' }],
    });
    try {
      const { app, runtime } = await boot(policyModel({ origin: 'Victoria', destination: 'London Bridge' }));
      const started = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'live' });
      expect(started.body.status).toBe('ROUTE_SELECTED');
      expect(started.body.route.unavailable.lifts).toHaveLength(1);
      const routeId = runtime.state.sessions.get(started.body.sessionId)!.currentRouteId!;
      runtime.agent['deps'].model = policyModel({ origin: 'Victoria', destination: 'London Bridge', recheckRouteId: routeId });
      const again = await journey(app, { sessionId: started.body.sessionId, mode: 'live' });
      expect(again.body.status).toBe('ROUTE_RETAINED');
      expect(again.body.message).toBe('Your current step-free route is still usable. It takes about 35 minutes.');
    } finally {
      liveDisruptions = async () => ({ fetchedAt: '2026-10-17T10:00:00Z', disruptions: [] });
    }
  });

  it('reaches NO_ROUTE honestly when a station has no step-free access', async () => {
    const { app } = await boot(policyModel({ origin: "St James's Park", destination: 'London Bridge' }));
    const res = await journey(app, { origin: "St James's Park", destination: 'London Bridge', mode: 'demo' });
    expect(res.body.status).toBe('NO_ROUTE');
    expect(res.body.route.route).toBeNull();
    expect(res.body.message).toBe("St James's Park has no step-free street access in TfL data.");
  });

  it('Scenario C: an unsupported station never produces a route', async () => {
    const { app } = await boot(policyModel({ origin: 'Atlantis', destination: 'London Bridge' }));
    const res = await journey(app, { origin: 'Atlantis', destination: 'London Bridge', mode: 'demo' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UNKNOWN_STATION');
    expect(res.body.route).toBeNull();
    expect(res.body.message).toBe("That station isn't in StepFree's current supported network.");
    expect(tools(res)).toEqual(['resolve_station']);
  });

  it('routes between stations the original seven did not cover, still through the agent', async () => {
    const { app } = await boot(policyModel({ origin: 'Bond Street', destination: 'Canary Wharf' }));
    const res = await journey(app, { origin: 'Bond Street', destination: 'Canary Wharf', mode: 'demo' });
    expect(res.body.status).toBe('ROUTE_SELECTED');
    expect(res.body.route.route.stations.at(-1)).toBe('CAN');
  });
});

describe('Agent safety invariants', () => {
  const sid = 'abcdefgh';
  const plan = { name: 'plan_step_free_journey', args: { origin: 'Victoria', destination: 'London Bridge' } };

  it('rejects a decision for a route that no graph tool returned', async () => {
    const { app } = await boot(
      scriptedModel([
        { name: 'record_journey_decision', args: { sessionId: sid, origin: 'Victoria', destination: 'London Bridge', action: 'ROUTE_SELECTED', reasonCode: 'MADE_UP', routeSummary: { routeId: 'abcdefabcdef' } } },
      ]),
    );
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo' });
    expect(res.body.status).toBe('AGENT_FAILED');
    expect(res.body.trace[0]).toMatchObject({ tool: 'record_journey_decision', ok: false });
    expect(res.body.route).toBeNull();
  });

  it('rejects ROUTE_SELECTED before disruptions and dependencies were checked, and REROUTED without an alternative route', async () => {
    const { app, runtime } = await boot(null);
    const planned = await runtime.toolbox.planStepFreeJourney({ origin: 'Victoria', destination: 'London Bridge' });
    if (planned.status !== 'ROUTE_FOUND') throw new Error('expected a route');
    const record = (action: string, extra: object = {}) => ({ name: 'record_journey_decision', args: { sessionId: sid, origin: 'Victoria', destination: 'London Bridge', action, reasonCode: 'TEST', routeSummary: { routeId: planned.route.routeId }, ...extra } });
    runtime.agent['deps'].model = scriptedModel([
      { name: 'resolve_station', args: { station: 'Victoria' } },
      { name: 'resolve_station', args: { station: 'London Bridge' } },
      plan,
      record('ROUTE_SELECTED'),
      record('REROUTED', { affectedConnectionIds: [LIFT_2] }),
    ]);
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo' });
    const rejected = res.body.trace.filter((t: any) => t.tool === 'record_journey_decision');
    expect(rejected.map((t: any) => t.ok)).toEqual([false, false]);
    expect(JSON.stringify(rejected[0].result)).toMatch(/get_accessibility_disruptions/);
    expect(JSON.stringify(rejected[1].result)).toMatch(/find_alternative_route/);
    expect(res.body.status).toBe('AGENT_FAILED');
  });

  it('bounds repeated identical calls', async () => {
    const { app } = await boot(scriptedModel(() => ({ name: 'resolve_station', args: { station: 'Victoria' } })));
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo' });
    expect(res.body.status).toBe('AGENT_FAILED');
    expect(res.body.trace.filter((t: any) => t.ok)).toHaveLength(1);
    expect(res.body.trace.length).toBeLessThanOrEqual(4);
  });

  it(`stops at ${MAX_TOOL_CALLS} tool calls`, async () => {
    const stations = ['Victoria', 'Green Park', 'Westminster', 'Waterloo', 'Southwark', 'London Bridge', 'Bond Street', 'Moorgate', 'Farringdon', 'Paddington'];
    const { app } = await boot(scriptedModel((turn) => ({ name: 'resolve_station', args: { station: stations[turn % stations.length] } })));
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo' });
    expect(res.body.status).toBe('AGENT_FAILED');
    expect(res.body.trace).toHaveLength(MAX_TOOL_CALLS);
    expect(res.body.message).toMatch(/too many steps/);
  });

  it('refuses to bypass the agent: no Gemini key gives an honest unavailable state', async () => {
    const { app } = await boot(null);
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'AGENT_UNAVAILABLE', message: 'Journey agent is temporarily unavailable.', route: null });
  });

  it('reports the model being down as unavailable, not as a route', async () => {
    const { app } = await boot({
      name: 'broken',
      start: () => ({
        async step() {
          const { ModelUnavailableError } = await import('../src/agent/model.js');
          throw new ModelUnavailableError('503');
        },
        addToolResults() {},
        addUserText() {},
      }),
    });
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo' });
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('AGENT_UNAVAILABLE');
    expect(res.body.route).toBeNull();
  });

  it('reports TfL being down in Live Mode', async () => {
    liveDisruptions = async () => {
      throw new Error('offline');
    };
    try {
      const { app } = await boot(policyModel({ origin: 'Victoria', destination: 'London Bridge' }));
      const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'live' });
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('TFL_UNAVAILABLE');
    } finally {
      liveDisruptions = async () => ({ fetchedAt: '2026-10-17T10:00:00Z', disruptions: [] });
    }
  });

  it('validates the request body', async () => {
    const { app } = await boot(null);
    expect((await journey(app, { origin: 'Victoria', mode: 'demo' })).status).toBe(400);
    expect((await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'later' })).status).toBe(400);
    expect((await journey(app, { origin: 'x'.repeat(500), destination: 'London Bridge', mode: 'demo' })).status).toBe(400);
  });
});

describe('Grounded wording', () => {
  const facts = {
    action: 'REROUTED' as const,
    durationMinutes: 39,
    previousMinutes: 35,
    routeStations: ['Victoria', "St James's Park", 'Westminster', 'Waterloo', 'Southwark', 'London Bridge'],
    viaStation: 'Westminster',
    lines: ['District', 'Circle', 'Jubilee'],
    disruptions: [{ station: 'Green Park', name: 'Lift 2', connectionId: LIFT_2 }],
    noRouteReason: null,
  };
  const supported = network.stations.map((s) => s.name);

  it('accepts wording that matches the tool results', () => {
    expect(claimsAreSupported('Green Park Lift 2 is out, so I found another route through Westminster. It takes about 39 minutes.', facts, supported)).toBe(true);
  });

  it.each([
    ['the wrong duration', 'I found another route through Westminster. It takes about 25 minutes.'],
    ['no duration at all', 'I found another route through Westminster.'],
    ['a supported station that is not on the journey', 'Route via Canary Wharf takes about 39 minutes.'],
    ['a lift that was not reported', 'Lift 7 is out. It takes about 39 minutes.'],
    ['a line that is not on the route', 'Take the Northern line, about 39 minutes.'],
  ])('rejects %s', (_label, text) => {
    expect(claimsAreSupported(text, facts, supported)).toBe(false);
  });

  it('falls back to deterministic copy when the model’s wording is unsupported', async () => {
    const { app } = await boot(policyModel({ origin: 'Victoria', destination: 'London Bridge', text: () => 'Great news, your trip takes 12 minutes via Canary Wharf!' }));
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo' });
    expect(res.body.message).toBe('Your step-free route is ready. It takes about 35 minutes.');
  });

  it('uses the model’s own wording when it is grounded', async () => {
    const text = 'Your step-free route is ready and takes about 35 minutes, changing at Green Park.';
    const { app } = await boot(policyModel({ origin: 'Victoria', destination: 'London Bridge', text: () => text }));
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo' });
    expect(res.body.message).toBe(text);
  });

  it('has fixed copy for every outcome', () => {
    expect(deterministicMessage({ ...facts, action: 'UNKNOWN_STATION' })).toBe("That station isn't in StepFree's current supported network.");
  });
});
