import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_POLICY_NAME, demoPolicyModel } from '../src/agent/demoPolicyModel.js';
import { demoDisruptionCatalogue, type DemoDisruptionKind } from '../src/agent/demoDisruptions.js';
import { createAgentRuntime } from '../src/agent/index.js';
import { MAX_TOOL_CALLS } from '../src/agent/journeyAgent.js';
import type { AgentModel } from '../src/agent/model.js';
import { createApp } from '../src/app.js';
import { RoutingGraph } from '../src/graph/routing.js';
import { loadNetwork } from '../src/network/load.js';

const network = loadNetwork();
const catalogue = demoDisruptionCatalogue(network);
const noLive = async () => ({ fetchedAt: '2026-10-17T10:00:00Z', disruptions: [] });
let routing: RoutingGraph;
const servers: Server[] = [];

beforeAll(async () => {
  routing = await RoutingGraph.connect(process.env.FALKORDB_URL ?? 'redis://127.0.0.1:6379', network, 'stepfree_test_policy');
});
afterAll(async () => {
  servers.forEach((s) => s.close());
  await routing?.close();
});

/** Stands in for Gemini: records every time it is asked to start a conversation. In Demo Mode that must be never. */
function geminiSpy(): AgentModel & { started: number } {
  const spy = {
    name: 'gemini-3.8-flash',
    kind: 'llm' as const,
    started: 0,
    start(options: Parameters<AgentModel['start']>[0]) {
      spy.started++;
      // Live Mode's tool selection is not under test here: borrow the policy's choices so the run can complete.
      return demoPolicyModel.start(options);
    },
  };
  return spy;
}

/** The production runtime: the Demo policy is built in; only the Live model is supplied (or not). */
function boot(liveModel: AgentModel | null) {
  const runtime = createAgentRuntime({ routing, liveDisruptions: noLive, liveModel });
  const app = createApp({ routing, liveDisruptions: noLive, agent: runtime });
  const server = app.listen(0);
  servers.push(server);
  runtime.setMcpUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  return { app, runtime };
}
const journey = async (app: ReturnType<typeof createApp>, body: object) => (await request(app).post('/api/agent/journey').send(body)).body;
const tools = (res: any) => res.trace.map((t: any) => t.tool);

describe('Demo Mode runs the deterministic StepFree policy and never starts Gemini', () => {
  it('with a Gemini key configured: every Demo request uses the policy, and the Gemini model is never started', async () => {
    const gemini = geminiSpy();
    const { app } = boot(gemini);
    const fresh = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo', demoDisruption: null });
    expect(fresh.status).toBe('ROUTE_SELECTED');
    for (const kind of ['LIFT', 'STATION', 'LINE'] as DemoDisruptionKind[]) {
      const again = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo', demoDisruption: null });
      expect((await journey(app, { sessionId: again.sessionId, mode: 'demo', demoDisruption: kind })).status, kind).toBe('REROUTED');
    }
    await journey(app, { sessionId: fresh.sessionId, mode: 'demo', demoDisruption: null });
    await journey(app, { origin: 'Bond Street', destination: 'Canary Wharf', mode: 'demo', demoDisruption: null });
    await journey(app, { origin: 'Atlantis', destination: 'London Bridge', mode: 'demo' });
    expect(gemini.started).toBe(0);
  });

  it('without a Gemini key: Demo Mode still works', async () => {
    const { app } = boot(null);
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo', demoDisruption: null });
    expect(res.status).toBe('ROUTE_SELECTED');
    expect(res.route.route.totalMinutes).toBe(35);
  });

  it('says plainly what ran: the deterministic policy, not a language model', async () => {
    const { app } = boot(geminiSpy());
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo', demoDisruption: null });
    expect(res.agent).toMatchObject({ model: DEMO_POLICY_NAME, kind: 'deterministic', transport: 'mcp-streamable-http' });
    expect(JSON.stringify(res.agent)).not.toMatch(/gemini/i);
  });

  it('executes real MCP tool calls: the trace holds the seven-tool catalogue entries, run through /mcp', async () => {
    const { app } = boot(null);
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo', demoDisruption: null });
    expect(tools(res)).toEqual(['plan_step_free_journey', 'get_journey_disruptions', 'find_backup_route', 'record_journey_decision']);
    expect(res.trace.every((t: any) => t.ok !== false && typeof t.durationMs === 'number')).toBe(true);
    // The /mcp endpoint answers only with the backend's own bearer token, so these calls cannot have bypassed it.
    const port = (servers.at(-1)!.address() as AddressInfo).port;
    const anonymous = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(anonymous.status).toBe(401);
  });
});

describe('Live Mode keeps the real model and fails honestly', () => {
  it('with a Gemini key configured: the Gemini model is the one selected', async () => {
    const gemini = geminiSpy();
    const { app } = boot(gemini);
    const res = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'live' });
    expect(gemini.started).toBe(1);
    expect(res.agent).toMatchObject({ model: 'gemini-3.8-flash', kind: 'llm' });
  });

  it('without a Gemini key: AGENT_UNAVAILABLE, and the Demo policy is not used as a quiet fallback', async () => {
    const { app } = boot(null);
    const res = await request(app).post('/api/agent/journey').send({ origin: 'Victoria', destination: 'London Bridge', mode: 'live' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'AGENT_UNAVAILABLE', message: 'Journey agent is temporarily unavailable.', route: null, trace: [], agent: { kind: 'none', toolCalls: 0 } });
  });

  it('a Demo request and a Live request at the same time each get their own model', async () => {
    const gemini = geminiSpy();
    const { app } = boot(gemini);
    const [demo, live] = await Promise.all([
      journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo', demoDisruption: null }),
      journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'live' }),
    ]);
    expect(demo.agent.kind).toBe('deterministic');
    expect(live.agent.kind).toBe('llm');
    expect(gemini.started).toBe(1);
  });
});

describe('The policy follows tool evidence: results come from FalkorDB', () => {
  const run = async (app: ReturnType<typeof createApp>, first: any, demoDisruption: DemoDisruptionKind | null) => journey(app, { sessionId: first.sessionId, mode: 'demo', demoDisruption });

  it('Run Demo, then Lift, Reset, Station, Reset, Line, Reset', async () => {
    const { app } = boot(null);
    const normal = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo', demoDisruption: null });
    expect([normal.route.route.totalMinutes, normal.routeHealth.status, normal.planB.durationMinutes]).toEqual([35, 'CLEAR', 39]);

    const lift = await run(app, normal, 'LIFT');
    expect([lift.status, lift.route.route.totalMinutes, lift.routeHealth.status, lift.planB.durationMinutes]).toEqual(['REROUTED', 39, 'REROUTED', 52]);
    expect(lift.disruptions[0].id).toBe(catalogue.LIFT.id);

    const reset = async () => {
      const fresh = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo', demoDisruption: null });
      expect([fresh.status, fresh.route.route.totalMinutes, fresh.routeHealth.status, fresh.planB.durationMinutes, fresh.disruptions]).toEqual(['ROUTE_SELECTED', 35, 'CLEAR', 39, []]);
      return fresh;
    };
    const afterLift = await reset();

    const station = await run(app, afterLift, 'STATION');
    expect([station.status, station.route.route.totalMinutes, station.routeHealth.status]).toEqual(['REROUTED', 39, 'REROUTED']);
    const afterStation = await reset();

    const line = await run(app, afterStation, 'LINE');
    expect([line.status, line.route.route.totalMinutes, line.routeHealth.status, line.planB.durationMinutes]).toEqual(['REROUTED', 52, 'REROUTED', 59]);
    await reset();
  });

  it('records a reason that matches the kind of disruption, derived from the returned evidence', async () => {
    const { app } = boot(null);
    const reasons: string[] = [];
    for (const kind of ['LIFT', 'STATION', 'LINE'] as DemoDisruptionKind[]) {
      const first = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo', demoDisruption: null });
      const res = await run(app, first, kind);
      expect(res.agent.toolCalls).toBeLessThanOrEqual(MAX_TOOL_CALLS);
      reasons.push((await routing.decisions(res.sessionId)).at(-1)!.reasonCode);
    }
    expect(reasons).toEqual(['LIFT_DISRUPTION', 'STATION_CLOSURE', 'LINE_DISRUPTION']);
  });

  it('an unrelated simulated disruption keeps the route: Clear, no reroute', async () => {
    const { app } = boot(null);
    // Canary Wharf to Canada Water never goes near Green Park Lift 2.
    const first = await journey(app, { origin: 'Canary Wharf', destination: 'Canada Water', mode: 'demo', demoDisruption: null });
    expect(first.status).toBe('ROUTE_SELECTED');
    const res = await run(app, first, 'LIFT');
    expect(res.status).toBe('ROUTE_RETAINED');
    expect(res.routeHealth.status).toBe('CLEAR');
    expect(res.route.route.totalMinutes).toBe(first.route.route.totalMinutes);
    expect(tools(res)).not.toContain('find_alternative_route');
  });

  it('switching the simulated event on the same journey follows the evidence: the kept route is retained when the new event misses it, and the original returns when the event is cleared', async () => {
    const { app } = boot(null);
    const first = await journey(app, { origin: 'Victoria', destination: 'London Bridge', mode: 'demo', demoDisruption: null });
    const lift = await run(app, first, 'LIFT');
    expect(lift.status).toBe('REROUTED');
    // The rerouted route does not use Green Park, so closing the station does not touch it.
    const station = await run(app, first, 'STATION');
    expect([station.status, station.routeHealth.status, station.route.route.totalMinutes]).toEqual(['ROUTE_RETAINED', 'CLEAR', 39]);
    // The Jubilee line is what the rerouted route rides: FalkorDB finds the next valid route again.
    const line = await run(app, first, 'LINE');
    expect(line.status).toBe('REROUTED');
    const cleared = await run(app, first, null);
    expect(cleared.status).toBe('ROUTE_SELECTED');
    expect(cleared.route.route.totalMinutes).toBe(35);
    expect(cleared.disruptions).toEqual([]);
  });

  it('another supported journey works end to end from graph evidence alone', async () => {
    const { app } = boot(null);
    const res = await journey(app, { origin: 'Bond Street', destination: 'Canary Wharf', mode: 'demo', demoDisruption: null });
    expect(res.status).toBe('ROUTE_SELECTED');
    expect(res.route.route.totalMinutes).toBeGreaterThan(0);
    expect(res.message).toContain(`${res.route.route.totalMinutes} minutes`);
  });

  it('keeps the honest errors: unsupported station, same station, and no step-free street access', async () => {
    const { app } = boot(null);
    const unknown = await journey(app, { origin: 'Atlantis', destination: 'London Bridge', mode: 'demo' });
    expect(unknown).toMatchObject({ status: 'UNKNOWN_STATION', route: null, routeHealth: null, planB: null });
    const same = await journey(app, { origin: 'Victoria', destination: 'Victoria', mode: 'demo' });
    expect(same.status).toBe('NO_ROUTE');
    const noAccess = await journey(app, { origin: "St James's Park", destination: 'London Bridge', mode: 'demo' });
    expect(noAccess.status).toBe('NO_ROUTE');
    expect(noAccess.planB).toBeNull();
  });
});

describe('The policy holds no answers', () => {
  it('contains no stations, lifts, lines or travel times', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/agent/demoPolicyModel.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/Victoria|London Bridge|Green Park|Westminster|Jubilee|Lift-|\b(35|39|52|59)\b/);
    expect(source).not.toMatch(/MATCH|CREATE|algo\./);
  });
});
