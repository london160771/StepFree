import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import type { DecisionAction, RouteResult, RoutingGraph } from '../graph/routing.js';
import type { LiftDisruptionSource } from '../tfl/liftDisruptions.js';
import type { AgentState, StoredRoute } from './state.js';

/** The fixed tool catalogue. Every argument is validated here before any graph query runs. */

const stationText = z.string().trim().min(1).max(80);
const connectionId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9 _.\-]{1,64}$/, 'Not a valid connection id');
const connectionIds = z.array(connectionId).max(20);
const sessionId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Not a valid session id');
const routeId = z.string().regex(/^[a-f0-9]{12}$/, 'Not a valid route id');

export const resolveStationInput = z.strictObject({ station: stationText });
export const planJourneyInput = z.strictObject({
  origin: stationText,
  destination: stationText,
  unavailableConnectionIds: connectionIds.optional(),
});
export const inspectInput = z.strictObject({ routeId });
export const disruptionsInput = z.strictObject({
  mode: z.enum(['demo', 'live']),
  relevantConnectionIds: connectionIds.optional(),
  sessionId: sessionId.optional(),
});
export const alternativeInput = z.strictObject({
  origin: stationText,
  destination: stationText,
  unavailableConnectionIds: connectionIds.min(1),
});
export const backupInput = z.strictObject({
  origin: stationText,
  destination: stationText,
  primaryRouteId: routeId,
  /** The primary route's connections to consider losing, one at a time. Defaults to every connection the route uses. */
  primaryConnectionIds: connectionIds.optional(),
  /** Connections already unavailable (current disruptions): Plan B must avoid these too. */
  unavailableConnectionIds: connectionIds.optional(),
});
export const ROUTE_HEALTH = ['CLEAR', 'AFFECTED', 'REROUTED', 'NO_ROUTE'] as const;
export const DECISION_ACTIONS = ['ROUTE_SELECTED', 'ROUTE_RETAINED', 'REROUTED', 'NO_ROUTE'] as const;
export const recordInput = z.strictObject({
  sessionId,
  origin: stationText,
  destination: stationText,
  action: z.enum(DECISION_ACTIONS),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,39}$/, 'Use an UPPER_SNAKE_CASE reason code'),
  affectedConnectionIds: connectionIds.optional(),
  routeSummary: z.strictObject({ routeId }).optional(),
  /** Set by the agent host from tool evidence; whatever the model sends is overwritten. */
  routeHealth: z.enum(ROUTE_HEALTH).optional(),
});

export type ToolName =
  | 'resolve_station'
  | 'plan_step_free_journey'
  | 'inspect_route_dependencies'
  | 'get_accessibility_disruptions'
  | 'find_alternative_route'
  | 'find_backup_route'
  | 'record_journey_decision';

export const TOOL_NAMES: ToolName[] = [
  'resolve_station',
  'plan_step_free_journey',
  'inspect_route_dependencies',
  'get_accessibility_disruptions',
  'find_alternative_route',
  'find_backup_route',
  'record_journey_decision',
];

export interface RouteSummary {
  routeId: string;
  originId: string;
  destinationId: string;
  /** Connections with no step-free alternative: if one is out of service this route cannot be used. */
  requiredConnectionIds: string[];
  /** Every lift the route's step-free connections use. */
  allConnectionIds: string[];
  /** How many accessibility connections (entrance, interchanges, exit) the route relies on. */
  dependencyCount: number;
  durationMinutes: number;
  stationIds: string[];
  stations: string[];
  lines: string[];
  changes: { station: string; fromLine: string | null; toLine: string | null }[];
  lifts: string[];
}

export type RouteToolResult =
  | { status: 'ROUTE_FOUND'; origin: string; destination: string; originId: string; destinationId: string; excludedConnectionIds: string[]; route: RouteSummary }
  | { status: 'NO_ROUTE'; origin: string; destination: string; originId: string; destinationId: string; excludedConnectionIds: string[]; reason: string }
  | { status: 'UNKNOWN_STATION'; unknown: string[] };

export type BackupToolResult =
  | {
      status: 'BACKUP_FOUND';
      available: true;
      primaryRouteId: string;
      route: RouteSummary;
      durationMinutes: number;
      extraMinutes: number;
      /** The connection whose loss this backup survives. */
      avoidedConnectionIds: string[];
      routeSignature: string;
      candidatesChecked: number;
    }
  | { status: 'NO_BACKUP'; available: false; primaryRouteId: string; candidatesChecked: number; reason: string };

/** Most single connections tried as the "what if this one fails" case when looking for Plan B. */
export const MAX_BACKUP_CANDIDATES = 8;

/** Which stations and lines a journey uses, ignoring which of several equal platforms it happens to use. Two routes with the same signature are the same journey. */
export function routeSignature(route: RouteResult): string {
  return route.legs
    .flatMap((leg) => (leg.type === 'ride' ? [`${leg.line}:${leg.stations.join('>')}`] : []))
    .join('|');
}

export interface DisruptionItem {
  connectionId: string;
  stationId: string;
  station: string;
  name: string;
  message: string;
  /** True when the caller listed this connection as relevant to the current journey. */
  relevant: boolean;
}

export interface DisruptionToolResult {
  mode: 'demo' | 'live';
  source: 'demo_simulation' | 'tfl_live';
  fetchedAt: string | null;
  activeCount: number;
  disruptions: DisruptionItem[];
}

export interface DependencyToolResult {
  routeId: string;
  dependencies: { transferId: string; station: string; stationId: string; kind: string; lifts: string[]; requiredConnectionIds: string[] }[];
  /** Connections with no step-free alternative: if one is out of service this route cannot be used. */
  requiredConnectionIds: string[];
  allConnectionIds: string[];
}

export class ToolError extends Error {
  constructor(
    readonly code: 'TFL_UNAVAILABLE' | 'INVALID_ARGUMENT' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
  }
}

export interface ToolboxDeps {
  routing: RoutingGraph;
  liveDisruptions: LiftDisruptionSource;
  state: AgentState;
}

/** The six operations behind the MCP tools. Each one runs a fixed, parameterised query; none accepts query text. */
export class StepFreeToolbox {
  private readonly liftsById;
  private readonly demoLift;

  constructor(private readonly deps: ToolboxDeps) {
    const { network } = deps.routing;
    this.liftsById = new Map(network.lifts.map((l) => [l.liftUniqueId, l]));
    this.demoLift = this.liftsById.get(network.demoOutage.liftUniqueId)!;
  }

  async resolveStation(input: z.infer<typeof resolveStationInput>) {
    const found = await this.deps.routing.resolveStation(input.station);
    if (!found) return { found: false as const, query: input.station };
    return { found: true as const, canonicalStation: found.name, stationId: found.id, stepFreeStreetAccess: found.stepFreeStreetAccess };
  }

  planStepFreeJourney(input: z.infer<typeof planJourneyInput>): Promise<RouteToolResult> {
    return this.computeRoute(input.origin, input.destination, input.unavailableConnectionIds ?? [], 'plan_step_free_journey');
  }

  findAlternativeRoute(input: z.infer<typeof alternativeInput>): Promise<RouteToolResult> {
    return this.computeRoute(input.origin, input.destination, input.unavailableConnectionIds, 'find_alternative_route');
  }

  async inspectRouteDependencies(input: z.infer<typeof inspectInput>): Promise<DependencyToolResult> {
    const stored = this.deps.state.routes.get(input.routeId);
    if (!stored) throw new ToolError('NOT_FOUND', 'Unknown routeId. Plan a route first.');
    stored.dependencies ??= await this.deps.routing.routeDependencies(stored.route.graph, stored.route.transferIds);
    return describeDependencies(stored, this.deps.routing.network.stations);
  }

  async getAccessibilityDisruptions(input: z.infer<typeof disruptionsInput>): Promise<DisruptionToolResult> {
    const relevant = new Set(input.relevantConnectionIds ?? []);
    const toItem = (d: { liftUniqueId: string; stationId: string; friendlyName: string; message: string }): DisruptionItem => ({
      connectionId: d.liftUniqueId,
      stationId: d.stationId,
      station: this.deps.routing.network.stations.find((s) => s.id === d.stationId)?.name ?? d.stationId,
      name: d.friendlyName,
      message: d.message,
      relevant: relevant.has(d.liftUniqueId),
    });
    if (input.mode === 'demo') {
      const session = input.sessionId ? this.deps.state.sessions.get(input.sessionId) : undefined;
      const active = session?.demoOutage
        ? [toItem({ liftUniqueId: this.demoLift.liftUniqueId, stationId: this.demoLift.stationId, friendlyName: this.demoLift.friendlyName, message: 'Simulated outage (Demo Mode).' })]
        : [];
      return { mode: 'demo', source: 'demo_simulation', fetchedAt: null, activeCount: active.length, disruptions: active };
    }
    let snapshot;
    try {
      snapshot = await this.deps.liveDisruptions();
    } catch {
      throw new ToolError('TFL_UNAVAILABLE', 'Live TfL lift data is unavailable.');
    }
    const items = snapshot.disruptions.map(toItem);
    return { mode: 'live', source: 'tfl_live', fetchedAt: snapshot.fetchedAt, activeCount: items.length, disruptions: items };
  }

  /**
   * Plan B: the best valid step-free route that is genuinely different from the primary one, found by FalkorDB.
   * For each lift the primary route uses, FalkorDB is asked for the shortest route in a graph where that lift
   * (and anything currently unavailable) is out. Candidates that are the same journey are rejected; the fastest
   * distinct one wins. A lift with a working alternative changes nothing and is skipped without a query.
   */
  async findBackupRoute(input: z.infer<typeof backupInput>): Promise<BackupToolResult> {
    const { routing, state } = this.deps;
    const primary = state.routes.get(input.primaryRouteId);
    if (!primary) throw new ToolError('NOT_FOUND', 'Unknown primaryRouteId. Plan a route first.');
    const [origin, destination] = await Promise.all([routing.resolveStation(input.origin), routing.resolveStation(input.destination)]);
    if (!origin || !destination) throw new ToolError('INVALID_ARGUMENT', 'Origin and destination must be supported stations.');
    if (origin.id !== primary.origin.id || destination.id !== primary.destination.id) {
      throw new ToolError('INVALID_ARGUMENT', 'That route does not connect these stations.');
    }
    for (const id of input.unavailableConnectionIds ?? []) if (!this.liftsById.has(id)) throw new ToolError('INVALID_ARGUMENT', `Unknown connection id ${id}.`);
    primary.dependencies ??= await routing.routeDependencies(primary.route.graph, primary.route.transferIds);
    const used = describeDependencies(primary, routing.network.stations).allConnectionIds;
    const considered = input.primaryConnectionIds ?? used;
    for (const id of considered) if (!used.includes(id)) throw new ToolError('INVALID_ARGUMENT', `${id} is not a connection this route uses.`);

    const active = [...new Set([...(input.unavailableConnectionIds ?? []), ...primary.excludedConnectionIds])].sort();
    const baseline = routing.unavailableTransfers(active).sort().join('|');
    const primarySignature = routeSignature(primary.route);
    const seen = new Set<string>();
    let best: { route: RouteResult; excluded: string[]; lift: string } | null = null;
    let checked = 0;
    for (const lift of considered.slice(0, MAX_BACKUP_CANDIDATES)) {
      const excluded = [...new Set([...active, lift])].sort();
      const lost = routing.unavailableTransfers(excluded).sort().join('|');
      if (lost === baseline || seen.has(lost)) continue; // this lift has a working alternative, or was already tried
      seen.add(lost);
      checked++;
      const scenario = await routing.scenarioGraph(excluded);
      const candidate = await routing.route(origin.id, destination.id, scenario.name);
      if (!candidate || routeSignature(candidate) === primarySignature) continue;
      if (!best || candidate.totalMinutes < best.route.totalMinutes) best = { route: candidate, excluded, lift };
    }
    if (!best) {
      primary.backup = { available: false, routeId: null };
      return {
        status: 'NO_BACKUP',
        available: false,
        primaryRouteId: primary.id,
        candidatesChecked: checked,
        reason: 'No other step-free route avoids a connection this route depends on.',
      };
    }
    const stored = await this.storeRoute(origin, destination, best.route, best.excluded, 'find_backup_route');
    primary.backup = { available: true, routeId: stored.id };
    return {
      status: 'BACKUP_FOUND',
      available: true,
      primaryRouteId: primary.id,
      route: summarise(stored, routing.network.stations),
      durationMinutes: best.route.totalMinutes,
      extraMinutes: best.route.totalMinutes - primary.route.totalMinutes,
      avoidedConnectionIds: [best.lift],
      routeSignature: routeSignature(best.route),
      candidatesChecked: checked,
    };
  }

  async recordJourneyDecision(input: z.infer<typeof recordInput>) {
    const { routing, state } = this.deps;
    const [origin, destination] = await Promise.all([routing.resolveStation(input.origin), routing.resolveStation(input.destination)]);
    if (!origin || !destination) throw new ToolError('INVALID_ARGUMENT', 'Origin and destination must be supported stations.');
    const session = state.sessions.get(input.sessionId);
    if (!session) throw new ToolError('NOT_FOUND', 'Unknown journey session.');
    const affected = (input.affectedConnectionIds ?? []).map((id) => {
      const lift = this.liftsById.get(id);
      if (!lift) throw new ToolError('INVALID_ARGUMENT', `Unknown connection id ${id}.`);
      return lift;
    });
    let storedRouteId: string | null = null;
    let routeDuration: number | null = null;
    if (input.action === 'NO_ROUTE') {
      if (input.routeSummary) throw new ToolError('INVALID_ARGUMENT', 'NO_ROUTE has no route.');
    } else {
      const stored = input.routeSummary ? state.routes.get(input.routeSummary.routeId) : undefined;
      if (!stored) throw new ToolError('INVALID_ARGUMENT', 'A route decision must reference a routeId returned by a graph tool.');
      if (stored.origin.id !== origin.id || stored.destination.id !== destination.id) {
        throw new ToolError('INVALID_ARGUMENT', 'The route does not connect the recorded origin and destination.');
      }
      storedRouteId = stored.id;
      routeDuration = stored.route.totalMinutes;
    }
    const backup = storedRouteId ? state.routes.get(storedRouteId)?.backup : undefined;
    const decisionId = await routing.recordDecision({
      sessionId: input.sessionId,
      mode: session.mode,
      originId: origin.id,
      destinationId: destination.id,
      action: input.action as DecisionAction,
      reasonCode: input.reasonCode,
      routeId: storedRouteId,
      routeDuration,
      affectedConnectionIds: affected.map((l) => l.liftUniqueId),
      affectedStationIds: [...new Set(affected.map((l) => l.stationId))],
      routeHealth: input.routeHealth ?? null,
      backupAvailable: backup ? backup.available : null,
      backupRouteId: backup?.routeId ?? null,
    });
    return { recorded: true as const, decisionId, action: input.action, routeId: storedRouteId, durationMinutes: routeDuration };
  }

  /** Keep a graph-returned route (and its accessibility dependencies) so later tools can refer to it by id. */
  private async storeRoute(
    origin: { id: string; name: string },
    destination: { id: string; name: string },
    route: RouteResult,
    excludedConnectionIds: string[],
    source: StoredRoute['source'],
  ): Promise<StoredRoute> {
    const { routing, state } = this.deps;
    const stored: StoredRoute = {
      id: createHash('sha1').update(`${route.graph}|${route.nodeIds.join('>')}`).digest('hex').slice(0, 12),
      origin: { id: origin.id, name: origin.name },
      destination: { id: destination.id, name: destination.name },
      route,
      excludedConnectionIds,
      source,
    };
    // The route's accessibility dependencies come back with the route, so nobody has to ask the graph for them again.
    stored.dependencies = await routing.routeDependencies(route.graph, route.transferIds);
    const existing = state.routes.get(stored.id);
    if (existing?.backup) stored.backup = existing.backup;
    state.saveRoute(stored);
    return stored;
  }

  private async computeRoute(originText: string, destinationText: string, excluded: string[], source: StoredRoute['source']): Promise<RouteToolResult> {
    const { routing, state } = this.deps;
    for (const id of excluded) if (!this.liftsById.has(id)) throw new ToolError('INVALID_ARGUMENT', `Unknown connection id ${id}.`);
    const [origin, destination] = await Promise.all([routing.resolveStation(originText), routing.resolveStation(destinationText)]);
    const unknown = [!origin && originText, !destination && destinationText].filter((x): x is string => Boolean(x));
    if (!origin || !destination) return { status: 'UNKNOWN_STATION', unknown };
    const excludedConnectionIds = [...new Set(excluded)].sort();
    const base = { origin: origin.name, destination: destination.name, originId: origin.id, destinationId: destination.id, excludedConnectionIds };
    if (origin.id === destination.id) return { status: 'NO_ROUTE', ...base, reason: 'Origin and destination are the same station.' };
    const blocked = [origin, destination].find((s) => !s.stepFreeStreetAccess);
    if (blocked) return { status: 'NO_ROUTE', ...base, reason: `${blocked.name} has no step-free street access in TfL data.` };
    const scenario = await routing.scenarioGraph(excludedConnectionIds);
    const route = await routing.route(origin.id, destination.id, scenario.name);
    if (!route) return { status: 'NO_ROUTE', ...base, reason: 'No step-free route is currently available in the supported network.' };
    const stored = await this.storeRoute(origin, destination, route, excludedConnectionIds, source);
    return { status: 'ROUTE_FOUND', ...base, route: summarise(stored, routing.network.stations) };
  }
}

/** The route's dependencies in the shape the inspect tool returns and the agent host reuses on a re-check. */
export function describeDependencies(stored: StoredRoute, stations: { id: string; name: string }[]): DependencyToolResult {
  const names = new Map(stations.map((s) => [s.id, s.name]));
  const dependencies = stored.dependencies ?? [];
  const unique = (values: string[]) => [...new Set(values)];
  return {
    routeId: stored.id,
    dependencies: dependencies.map((d) => ({
      transferId: d.transferId,
      station: names.get(d.stationId) ?? d.stationId,
      stationId: d.stationId,
      kind: d.kind,
      lifts: d.lifts,
      requiredConnectionIds: d.requiredLifts,
    })),
    requiredConnectionIds: unique(dependencies.flatMap((d) => d.requiredLifts)),
    allConnectionIds: unique(dependencies.flatMap((d) => d.lifts)),
  };
}

function summarise(stored: StoredRoute, stations: { id: string; name: string }[]): RouteSummary {
  const deps = describeDependencies(stored, stations);
  const name = (id: string) => stations.find((s) => s.id === id)?.name ?? id;
  const route: RouteResult = stored.route;
  const lines: string[] = [];
  const changes: RouteSummary['changes'] = [];
  const lifts = new Set<string>();
  for (const leg of route.legs) {
    if (leg.type === 'ride') lines.push(leg.line);
    else {
      leg.lifts.forEach((l) => lifts.add(l));
      if (leg.kind === 'interchange') changes.push({ station: name(leg.stationId), fromLine: leg.fromLine, toLine: leg.toLine });
    }
  }
  return {
    routeId: stored.id,
    originId: stored.origin.id,
    destinationId: stored.destination.id,
    requiredConnectionIds: deps.requiredConnectionIds,
    allConnectionIds: deps.allConnectionIds,
    dependencyCount: deps.dependencies.length,
    durationMinutes: route.totalMinutes,
    stationIds: route.stations,
    stations: route.stations.map(name),
    lines,
    changes,
    lifts: [...lifts],
  };
}
