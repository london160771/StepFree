import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { RouteDependency, RouteResult, RoutingGraph } from '../graph/routing.js';
import { stationKey } from '../network/names.js';
import type { LiftDisruption } from '../tfl/liftDisruptions.js';
import {
  AGENT_UNAVAILABLE_MESSAGE,
  UNKNOWN_STATION_MESSAGE,
  groundedMessage,
  type GroundingFacts,
} from './grounding.js';
import { ModelUnavailableError, type AgentModel, type ModelToolCall, type ModelToolResult } from './model.js';
import type { AgentState, JourneySessionState } from './state.js';
import { compactResult, describeStep, type TraceEntry } from './trace.js';
import { computeRouteHealth, planBView, whyThisRoute, type PlanBView, type RouteHealth, type WhyThisRoute } from './insights.js';
import {
  TOOL_NAMES,
  describeDependencies,
  type BackupToolResult,
  type DependencyToolResult,
  type DisruptionToolResult,
  type RouteToolResult,
} from './toolbox.js';

/** Most MCP tool calls one agent request may make. The normal journey needs six; a reroute needs seven. */
export const MAX_TOOL_CALLS = 8;
const MAX_MODEL_TURNS = 10;
const MODEL_TIMEOUT_MS = 70_000;
const TOOL_TIMEOUT_MS = 20_000;

export type AgentStatus =
  | 'ROUTE_SELECTED'
  | 'ROUTE_RETAINED'
  | 'REROUTED'
  | 'NO_ROUTE'
  | 'UNKNOWN_STATION'
  | 'AGENT_UNAVAILABLE'
  | 'TFL_UNAVAILABLE'
  | 'AGENT_FAILED';

export interface AgentRequest {
  origin?: string;
  destination?: string;
  mode: 'demo' | 'live';
  sessionId?: string;
  /** Demo Mode: the user has triggered (true) or cleared (false) the controlled Green Park outage. */
  demoOutage?: boolean;
}

/** The same shape /api/route returns, so the map and journey panel need no changes. */
export interface JourneyView {
  mode: 'demo' | 'live';
  from: string | null;
  to: string | null;
  route: RouteResult | null;
  noRouteReason: string | null;
  unavailable: { lifts: LiftDisruption[]; transferIds: string[] };
  fetchedAt: string | null;
}

export interface AgentResponse {
  sessionId: string;
  status: AgentStatus;
  message: string;
  route: JourneyView | null;
  /** Is this journey usable right now? Computed from tool evidence, never by the model. */
  routeHealth: RouteHealth | null;
  /** The backup route FalkorDB found before anything broke. A preview, distinct from a reroute. */
  planB: PlanBView | null;
  /** The plain-language reasons for this route, built from the same evidence. */
  whyThisRoute: WhyThisRoute | null;
  dependencies: { station: string; kind: string; lifts: string[]; requiredConnectionIds: string[] }[];
  disruptions: { connectionId: string; station: string; name: string; message: string }[];
  trace: TraceEntry[];
  agent: { model: string; transport: 'mcp-streamable-http'; toolCalls: number; maxToolCalls: number };
}

export interface JourneyAgentDeps {
  routing: RoutingGraph;
  state: AgentState;
  /** Null when no model is configured: requests then fail honestly instead of bypassing the agent. */
  model: AgentModel | null;
  mcp: { url: () => string | null; token: string };
}

interface Evidence {
  resolvedIds: Map<string, string>;
  unknown: string[];
  routes: Map<string, Extract<RouteToolResult, { status: 'ROUTE_FOUND' }> & { tool: string }>;
  noRoutes: { origin: string; destination: string; reason: string }[];
  firstPlanRouteId: string | null;
  disruption: DisruptionToolResult | null;
  /** Plan B lookups, by the primary route they were for. */
  backups: Map<string, BackupToolResult>;
  dependencies: Map<string, DependencyToolResult>;
  decision: { args: Record<string, any>; result: any } | null;
  tflDown: boolean;
}

class Abort extends Error {
  constructor(
    readonly status: AgentStatus,
    message: string,
  ) {
    super(message);
  }
}

const SYSTEM_PROMPT = [
  'You are the StepFree journey agent. StepFree finds step-free London Underground routes for wheelchair users, older people, injured people and parents with pushchairs.',
  'You act only by calling the StepFree tools. FalkorDB computes every route: never invent stations, routes, times, lines or lift states, and never describe anything a tool did not return.',
  'Procedure for a new journey: (1) plan_step_free_journey with the two stations as given. It resolves them itself and returns the route together with the connections it depends on (requiredConnectionIds). If it returns UNKNOWN_STATION, stop and tell the traveller that station is not in the supported network; call no other tool.',
  '(2) get_accessibility_disruptions, passing the route requiredConnectionIds as relevantConnectionIds.',
  '(3) If a disruption is on a required connection of the route, call find_alternative_route with those connection ids as unavailableConnectionIds; that new route is the one to keep.',
  '(4) For the route you are going to keep, call find_backup_route (Plan B) with its routeId as primaryRouteId, so the traveller knows whether another step-free route exists before anything breaks. A backup is only a preview: never present it as the chosen route.',
  '(5) Record the decision: REROUTED (with that alternative routeId and the affected connection ids) after a reroute, otherwise ROUTE_SELECTED with the planned routeId. If planning returned NO_ROUTE, record NO_ROUTE and call find_backup_route for nothing.',
  'When re-checking a journey that already has a route, its requiredConnectionIds are given to you: call get_accessibility_disruptions with them. Then, if it is still usable, call find_backup_route for it and record ROUTE_RETAINED; if a required connection is now out, call find_alternative_route, then find_backup_route for the new route, then record REROUTED; if no disruption remains and a faster route may exist, plan again, call find_backup_route for it and record ROUTE_SELECTED.',
  'Use resolve_station or inspect_route_dependencies only if you are genuinely unsure; they are rarely needed.',
  'Always finish by calling record_journey_decision once, then reply in one or two short, plain sentences for the traveller, quoting the duration in minutes exactly as the tool returned it. Do not mention graphs, tools or databases.',
].join('\n');

/**
 * The agent host. It connects to the StepFree MCP server as a real MCP client, gives the model the tool catalogue from
 * tools/list, executes each model-selected call through tools/call, and enforces the safety invariants before any
 * decision is recorded. The model never writes Cypher and never computes a route.
 */
export class JourneyAgent {
  constructor(private readonly deps: JourneyAgentDeps) {}

  async run(request: AgentRequest): Promise<AgentResponse> {
    const { routing, state, model } = this.deps;
    const known = request.sessionId ? state.sessions.get(request.sessionId) : undefined;
    const recheck = Boolean(known && known.originId && known.destinationId && known.mode === request.mode);
    const session: JourneySessionState = recheck
      ? known!
      : { id: randomUUID(), mode: request.mode, demoOutage: false, originId: null, destinationId: null, currentRouteId: null };
    if (request.demoOutage !== undefined && request.mode === 'demo') session.demoOutage = request.demoOutage;
    state.saveSession(session);
    const startRouteId = recheck ? session.currentRouteId : null;
    const names = new Map(routing.network.stations.map((s) => [s.id, s.name]));
    const originText = recheck ? names.get(session.originId!)! : (request.origin ?? '');
    const destinationText = recheck ? names.get(session.destinationId!)! : (request.destination ?? '');

    const trace: TraceEntry[] = [];
    const ev: Evidence = {
      resolvedIds: new Map(),
      unknown: [],
      routes: new Map(),
      noRoutes: [],
      firstPlanRouteId: null,
      disruption: null,
      backups: new Map(),
      dependencies: new Map(),
      decision: null,
      tflDown: false,
    };
    const finish = (status: AgentStatus, message: string, view: JourneyView | null = null, extra: Partial<AgentResponse> = {}): AgentResponse => ({
      sessionId: session.id,
      status,
      message,
      route: view,
      routeHealth: null,
      planB: null,
      whyThisRoute: null,
      dependencies: [],
      disruptions: [],
      trace,
      agent: { model: model?.name ?? 'none', transport: 'mcp-streamable-http', toolCalls: trace.length, maxToolCalls: MAX_TOOL_CALLS },
      ...extra,
    });

    if (!model) return finish('AGENT_UNAVAILABLE', AGENT_UNAVAILABLE_MESSAGE);
    const mcpUrl = this.deps.mcp.url();
    if (!mcpUrl) return finish('AGENT_UNAVAILABLE', AGENT_UNAVAILABLE_MESSAGE);

    const client = new Client({ name: 'stepfree-agent-host', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { authorization: `Bearer ${this.deps.mcp.token}` } } }));
      const listed = await client.listTools();
      const tools = listed.tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> }));
      if (!TOOL_NAMES.every((name) => tools.some((t) => t.name === name))) throw new Abort('AGENT_UNAVAILABLE', AGENT_UNAVAILABLE_MESSAGE);

      // A re-check reuses what the graph already told us about the current route instead of asking again.
      const current = recheck && startRouteId ? state.routes.get(startRouteId) : undefined;
      if (current) ev.dependencies.set(current.id, describeDependencies(current, routing.network.stations));
      const goal = recheck
        ? `Re-check journey session ${session.id} (${request.mode} mode) from ${originText} to ${destinationText}. The selected route is routeId ${startRouteId} (${current?.route.totalMinutes} min) and it requires these connections: ${JSON.stringify(ev.dependencies.get(startRouteId!)?.requiredConnectionIds ?? [])}. The accessibility situation may have changed. Decide whether that route is still usable and act on what the tools show.`
        : `Find a currently usable step-free journey from ${originText} to ${destinationText}. Journey session id: ${session.id}. Mode: ${request.mode}. Use only StepFree tools and graph evidence.`;
      const modelRun = model.start({ system: SYSTEM_PROMPT, goal, tools });

      const expected = (text: string, fixed: string | null) => (fixed ? fixed : ev.resolvedIds.get(stationKey(text)) ?? null);
      const seen = new Set<string>();
      let duplicates = 0;
      let rejections = 0;
      let nudged = false;
      let finalText: string | null = null;

      for (let turn = 0; turn < MAX_MODEL_TURNS; turn++) {
        const step = await withTimeout(modelRun.step(AbortSignal.timeout(MODEL_TIMEOUT_MS)), MODEL_TIMEOUT_MS + 1000, 'model');
        if (step.kind === 'text') {
          finalText = step.text;
          if (ev.decision || ev.unknown.length > 0) break;
          if (nudged) throw new Abort('AGENT_FAILED', "The journey agent couldn't verify a route. Please try again.");
          nudged = true;
          modelRun.addUserText('Before finishing, call record_journey_decision based only on what the tools returned.');
          continue;
        }
        const results: ModelToolResult[] = [];
        for (const call of step.calls) {
          if (trace.length >= MAX_TOOL_CALLS) throw new Abort('AGENT_FAILED', 'The journey agent used too many steps. Please try again.');
          const args = normaliseArgs(call, session, ev);
          const key = `${call.name}:${JSON.stringify(args)}`;
          const started = Date.now();
          let outcome: { ok: boolean; result: any };
          if (!TOOL_NAMES.includes(call.name as never)) {
            outcome = { ok: false, result: { error: 'UNKNOWN_TOOL', message: `There is no tool called ${call.name}.` } };
          } else if (seen.has(key)) {
            duplicates++;
            outcome = { ok: false, result: { error: 'DUPLICATE_CALL', message: 'You already made this exact call. Use its earlier result.' } };
          } else {
            seen.add(key);
            const rejected =
              call.name === 'record_journey_decision'
                ? guardDecision(args, ev, startRouteId, { origin: expected(originText, recheck ? session.originId : null), destination: expected(destinationText, recheck ? session.destinationId : null) })
                : null;
            if (rejected) {
              rejections++;
              outcome = { ok: false, result: { error: 'DECISION_NOT_SUPPORTED', message: rejected } };
            } else {
              outcome = await callTool(client, call.name, args);
              if (outcome.ok) absorb(ev, call.name, args, outcome.result, (id) => { const r = state.routes.get(id); return r && describeDependencies(r, routing.network.stations); });
              else if (outcome.result?.error === 'TFL_UNAVAILABLE') ev.tflDown = true;
            }
          }
          const durationMs = Date.now() - started;
          const entryResult = outcome.ok ? compactResult(call.name, outcome.result) : outcome.result;
          trace.push({
            step: trace.length + 1,
            tool: call.name,
            args,
            ok: outcome.ok,
            result: entryResult,
            summary: describeStep(call.name, args, outcome.result, outcome.ok),
            durationMs,
          });
          results.push({ call, result: entryResult });
          if (ev.tflDown) throw new Abort('TFL_UNAVAILABLE', 'Live TfL lift data is unavailable. Live Mode needs an internet connection.');
          if (duplicates >= 3 || rejections >= 3) throw new Abort('AGENT_FAILED', "The journey agent couldn't verify a route. Please try again.");
        }
        modelRun.addToolResults(results);
        if (ev.decision && !finalText) {
          // One last turn so the model can word the result; its tool calls (if any) are not executed.
          const last = await withTimeout(modelRun.step(AbortSignal.timeout(MODEL_TIMEOUT_MS)), MODEL_TIMEOUT_MS + 1000, 'model');
          finalText = last.kind === 'text' ? last.text : null;
          break;
        }
      }

      if (!ev.decision) {
        if (ev.unknown.length > 0) return finish('UNKNOWN_STATION', UNKNOWN_STATION_MESSAGE);
        throw new Abort('AGENT_FAILED', "The journey agent couldn't verify a route. Please try again.");
      }
      return this.assemble(session, ev, finalText, trace, finish, startRouteId);
    } catch (error) {
      if (error instanceof Abort) return finish(error.status, error.message);
      if (error instanceof ModelUnavailableError || (error instanceof Error && error.message.startsWith('model timed out'))) {
        console.error('Journey agent model error:', redact(error.message));
        return finish('AGENT_UNAVAILABLE', AGENT_UNAVAILABLE_MESSAGE);
      }
      console.error('Journey agent error:', error);
      return finish('AGENT_UNAVAILABLE', AGENT_UNAVAILABLE_MESSAGE);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private assemble(
    session: JourneySessionState,
    ev: Evidence,
    modelText: string | null,
    trace: TraceEntry[],
    finish: (status: AgentStatus, message: string, view?: JourneyView | null, extra?: Partial<AgentResponse>) => AgentResponse,
    startRouteId: string | null,
  ): AgentResponse {
    const { routing, state } = this.deps;
    const decision = ev.decision!;
    const action = decision.args.action as 'ROUTE_SELECTED' | 'ROUTE_RETAINED' | 'REROUTED' | 'NO_ROUTE';
    const names = new Map(routing.network.stations.map((s) => [s.id, s.name]));
    const supported = routing.network.stations.map((s) => s.name);
    const active = ev.disruption?.disruptions ?? [];
    const lifts: LiftDisruption[] = active.map((d) => ({ liftUniqueId: d.connectionId, stationId: d.stationId, friendlyName: d.name, message: d.message }));
    const unavailable = { lifts, transferIds: routing.unavailableTransfers(lifts.map((l) => l.liftUniqueId)) };
    const fetchedAt = ev.disruption?.fetchedAt ?? null;
    const disruptions = active.map(({ connectionId, station, name, message }) => ({ connectionId, station, name, message }));

    if (action === 'NO_ROUTE') {
      const last = ev.noRoutes.at(-1)!;
      const origin = routing.network.stations.find((s) => stationKey(s.name) === stationKey(last.origin));
      const destination = routing.network.stations.find((s) => stationKey(s.name) === stationKey(last.destination));
      session.originId = origin?.id ?? session.originId;
      session.destinationId = destination?.id ?? session.destinationId;
      session.currentRouteId = null;
      const facts: GroundingFacts = { action, backupMinutes: null, durationMinutes: null, previousMinutes: null, routeStations: [], viaStation: null, lines: [], disruptions: [], noRouteReason: last.reason };
      const view: JourneyView = { mode: session.mode, from: origin?.id ?? null, to: destination?.id ?? null, route: null, noRouteReason: last.reason, unavailable, fetchedAt };
      return finish('NO_ROUTE', groundedMessage(modelText, facts, supported), view, { disruptions, routeHealth: { status: 'NO_ROUTE', affectedConnectionIds: [] } });
    }

    const routeId = decision.args.routeSummary.routeId as string;
    const stored = state.routes.get(routeId)!;
    session.originId = stored.origin.id;
    session.destinationId = stored.destination.id;
    session.currentRouteId = routeId;
    const previous = startRouteId ? state.routes.get(startRouteId) : undefined;
    const affected = new Set<string>(decision.args.affectedConnectionIds ?? []);
    const linesOf = (route: RouteResult) => [...new Set(route.legs.flatMap((l) => (l.type === 'ride' ? l.lines : [])))].map(lineDisplay);
    const liftName = (connectionId: string) => {
      const lift = routing.network.lifts.find((l) => l.liftUniqueId === connectionId);
      return { station: lift ? (names.get(lift.stationId) ?? lift.stationId) : connectionId, name: lift?.friendlyName ?? connectionId };
    };
    const backup = ev.backups.get(routeId);
    const backupStored = backup?.available ? state.routes.get(backup.route.routeId) : undefined;
    const planB = planBView(backup, backupStored?.route, (id) => names.get(id)!, liftName);
    const dependencyView = ev.dependencies.get(routeId);
    const health = computeRouteHealth({
      action,
      requiredConnectionIds: dependencyView?.requiredConnectionIds ?? [],
      activeConnectionIds: active.map((d) => d.connectionId),
      affectedConnectionIds: [...affected],
    });
    const why = whyThisRoute({
      health,
      route: stored.route,
      requiredCount: dependencyView?.requiredConnectionIds.length ?? 0,
      planB,
      avoidedNames: active.filter((d) => affected.has(d.connectionId)).map((d) => `${d.station} ${d.name}`),
    });
    const facts: GroundingFacts = {
      action,
      backupMinutes: planB.durationMinutes,
      durationMinutes: stored.route.totalMinutes,
      previousMinutes: previous ? previous.route.totalMinutes : (ev.firstPlanRouteId ? state.routes.get(ev.firstPlanRouteId)?.route.totalMinutes ?? null : null),
      routeStations: [...stored.route.stations.map((id) => names.get(id)!), stored.origin.name, stored.destination.name],
      viaStation: action === 'REROUTED' ? (ev.routes.get(routeId)?.route.changes[0]?.station ?? null) : null,
      lines: linesOf(stored.route),
      disruptions: active.filter((d) => affected.has(d.connectionId)).map((d) => ({ station: d.station, name: d.name, connectionId: d.connectionId })),
      noRouteReason: null,
    };
    const dependencies = (ev.dependencies.get(routeId)?.dependencies ?? []).map((d) => ({ station: d.station, kind: d.kind, lifts: d.lifts, requiredConnectionIds: d.requiredConnectionIds }));
    const view: JourneyView = { mode: session.mode, from: stored.origin.id, to: stored.destination.id, route: stored.route, noRouteReason: null, unavailable, fetchedAt };
    return finish(action, groundedMessage(modelText, facts, supported), view, { dependencies, disruptions, routeHealth: health, planB, whyThisRoute: why });
  }
}

/** Keep API keys out of logs even if a vendor error message echoes one. */
const redact = (text: string) => text.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]').slice(0, 400);

const lineDisplay = (line: string) => line.split('-')[0].replace(/^./, (c) => c.toUpperCase());

/** The host, not the model, decides the session and mode the tools run in. */
function normaliseArgs(call: ModelToolCall, session: JourneySessionState, ev: Evidence): Record<string, unknown> {
  const args = { ...call.args };
  if (call.name === 'get_accessibility_disruptions') {
    args.mode = session.mode;
    args.sessionId = session.id;
  }
  // Plan B must avoid whatever is unavailable right now, as reported by the disruption tool.
  if (call.name === 'find_backup_route' && ev.disruption) args.unavailableConnectionIds = ev.disruption.disruptions.map((d) => d.connectionId);
  if (call.name === 'record_journey_decision') {
    args.sessionId = session.id;
    // Route health is computed from evidence here, never taken from the model.
    const routeId = (args.routeSummary as { routeId?: string } | undefined)?.routeId;
    args.routeHealth = computeRouteHealth({
      action: args.action as 'ROUTE_SELECTED' | 'ROUTE_RETAINED' | 'REROUTED' | 'NO_ROUTE',
      requiredConnectionIds: (routeId && ev.dependencies.get(routeId)?.requiredConnectionIds) || [],
      activeConnectionIds: (ev.disruption?.disruptions ?? []).map((d) => d.connectionId),
      affectedConnectionIds: (args.affectedConnectionIds as string[] | undefined) ?? [],
    }).status;
  }
  return args;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<{ ok: boolean; result: any }> {
  try {
    const response = await withTimeout(client.callTool({ name, arguments: args }), TOOL_TIMEOUT_MS, 'tool');
    const structured = (response as any).structuredContent;
    const text = (response as any).content?.find((c: any) => c.type === 'text')?.text;
    let result = structured;
    if (!result && text) {
      try {
        result = JSON.parse(text);
      } catch {
        result = { error: 'TOOL_ERROR', message: String(text).slice(0, 300) };
      }
    }
    if ((response as any).isError) return { ok: false, result: result && typeof result === 'object' && 'error' in result ? result : { error: 'INVALID_ARGUMENT', message: String(text ?? 'Tool error').slice(0, 300) } };
    return { ok: true, result };
  } catch (error) {
    return { ok: false, result: { error: 'TOOL_ERROR', message: error instanceof Error ? error.message.slice(0, 200) : 'Tool call failed' } };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Fold a successful tool result into the evidence the guards check. */
function absorb(ev: Evidence, tool: string, args: Record<string, any>, result: any, dependenciesOf: (routeId: string) => DependencyToolResult | undefined): void {
  switch (tool) {
    case 'resolve_station':
      if (result.found) {
        ev.resolvedIds.set(stationKey(args.station), result.stationId);
        ev.resolvedIds.set(stationKey(result.canonicalStation), result.stationId);
      } else ev.unknown.push(args.station);
      break;
    case 'plan_step_free_journey':
    case 'find_alternative_route': {
      const r = result as RouteToolResult;
      if (r.status !== 'UNKNOWN_STATION') {
        // The planner resolved both names against the graph; remember which stations the traveller's words mean.
        ev.resolvedIds.set(stationKey(args.origin), r.originId);
        ev.resolvedIds.set(stationKey(args.destination), r.destinationId);
      }
      if (r.status === 'ROUTE_FOUND') {
        ev.routes.set(r.route.routeId, { ...r, tool });
        const deps = dependenciesOf(r.route.routeId);
        if (deps) ev.dependencies.set(r.route.routeId, deps);
        if (tool === 'plan_step_free_journey' && r.excludedConnectionIds.length === 0) ev.firstPlanRouteId ??= r.route.routeId;
      } else if (r.status === 'NO_ROUTE') ev.noRoutes.push({ origin: r.origin, destination: r.destination, reason: r.reason });
      else ev.unknown.push(...r.unknown);
      break;
    }
    case 'inspect_route_dependencies':
      ev.dependencies.set(result.routeId, result as DependencyToolResult);
      break;
    case 'get_accessibility_disruptions':
      ev.disruption = result as DisruptionToolResult;
      break;
    case 'find_backup_route':
      ev.backups.set(result.primaryRouteId, result as BackupToolResult);
      break;
    case 'record_journey_decision':
      ev.decision = { args, result };
      break;
  }
}

/**
 * Safety invariants. Returns why a decision is not supported by the evidence, or null if it is.
 * - no route decision without a route a graph tool returned for the user's stations
 * - no disruption claim without get_accessibility_disruptions
 * - no reroute without find_alternative_route and a disruption on a required connection of the current route
 */
export function guardDecision(
  args: Record<string, any>,
  ev: Pick<Evidence, 'resolvedIds' | 'routes' | 'noRoutes' | 'firstPlanRouteId' | 'disruption' | 'dependencies' | 'backups'>,
  startRouteId: string | null,
  expected: { origin: string | null; destination: string | null },
): string | null {
  const routeId: string | undefined = args.routeSummary?.routeId;
  const active = new Set((ev.disruption?.disruptions ?? []).map((d) => d.connectionId));
  const conflicts = (id: string) => (ev.dependencies.get(id)?.requiredConnectionIds ?? []).filter((c) => active.has(c));
  const found = routeId ? ev.routes.get(routeId) : undefined;
  switch (args.action) {
    case 'NO_ROUTE':
      if (routeId) return 'NO_ROUTE cannot reference a route.';
      return ev.noRoutes.length > 0 ? null : 'No graph tool returned NO_ROUTE for this journey.';
    case 'ROUTE_SELECTED': {
      if (!found || found.tool !== 'plan_step_free_journey') return 'ROUTE_SELECTED needs a routeId returned by plan_step_free_journey.';
      break;
    }
    case 'ROUTE_RETAINED':
      if (!routeId || routeId !== startRouteId) return 'ROUTE_RETAINED must reference the journey’s current routeId.';
      break;
    case 'REROUTED':
      if (!found || found.tool !== 'find_alternative_route') return 'REROUTED needs a routeId returned by find_alternative_route.';
      break;
    default:
      return 'Unknown action.';
  }
  const route = ev.routes.get(routeId!);
  if (route) {
    const originId = route.route.stationIds[0];
    const destinationId = route.route.stationIds.at(-1);
    if (expected.origin === null || expected.destination === null) return 'Resolve both stations with resolve_station first.';
    if (originId !== expected.origin || destinationId !== expected.destination) return 'That route is not for the traveller’s stations.';
  }
  if (!ev.disruption) return 'Check get_accessibility_disruptions before recording this decision.';
  if (!ev.backups.has(routeId!)) return 'Call find_backup_route for this route before recording it, so the traveller knows whether a Plan B exists.';
  if (args.action === 'ROUTE_SELECTED' || args.action === 'ROUTE_RETAINED') {
    if (!ev.dependencies.has(routeId!)) return 'This route’s dependencies are not known. Plan it with plan_step_free_journey first.';
    const blocked = conflicts(routeId!);
    if (blocked.length > 0) return `This route requires ${blocked.join(', ')}, which is unavailable. Use find_alternative_route and record REROUTED.`;
  }
  if (args.action === 'REROUTED') {
    const affected: string[] = args.affectedConnectionIds ?? [];
    if (affected.length === 0 || !affected.every((id) => active.has(id))) return 'REROUTED needs affectedConnectionIds that get_accessibility_disruptions reported.';
    const previousId = startRouteId ?? ev.firstPlanRouteId;
    if (!previousId || !ev.dependencies.has(previousId)) return 'The current route’s dependencies are not known.';
    if (!conflicts(previousId).some((id) => affected.includes(id))) return 'The current route does not depend on the affected connections, so it does not need rerouting.';
    if (!affected.every((id) => found!.excludedConnectionIds.includes(id))) return 'The alternative route must exclude every affected connection.';
  }
  return null;
}

export type { RouteDependency };
