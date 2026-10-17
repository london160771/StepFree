import type { RouteResult } from '../graph/routing.js';
import type { BackupToolResult } from './toolbox.js';

/**
 * What the traveller sees besides the route: is the journey usable, is there a Plan B, and why this route.
 * Everything here is computed deterministically from tool evidence. No model wording, no confidence scores.
 */

export type RouteHealthStatus = 'CLEAR' | 'AFFECTED' | 'REROUTED' | 'NO_ROUTE';

export interface RouteHealth {
  status: RouteHealthStatus;
  /** Currently unavailable connections that matter to this state. */
  affectedConnectionIds: string[];
}

/**
 * CLEAR: a route exists and no current disruption touches a connection it requires.
 * AFFECTED: a route exists but a current disruption does touch a connection it requires.
 * REROUTED: the previous route was affected and the agent selected a new, currently valid route.
 * NO_ROUTE: no valid step-free route exists.
 */
export function computeRouteHealth(input: {
  action: 'ROUTE_SELECTED' | 'ROUTE_RETAINED' | 'REROUTED' | 'NO_ROUTE';
  requiredConnectionIds: string[];
  activeConnectionIds: string[];
  affectedConnectionIds: string[];
}): RouteHealth {
  if (input.action === 'NO_ROUTE') return { status: 'NO_ROUTE', affectedConnectionIds: [] };
  if (input.action === 'REROUTED') return { status: 'REROUTED', affectedConnectionIds: [...new Set(input.affectedConnectionIds)] };
  const active = new Set(input.activeConnectionIds);
  const hit = input.requiredConnectionIds.filter((id) => active.has(id));
  return hit.length > 0 ? { status: 'AFFECTED', affectedConnectionIds: hit } : { status: 'CLEAR', affectedConnectionIds: [] };
}

/** Plan B as the app shows it. A backup preview only: it never replaces the current route. */
export interface PlanBView {
  available: boolean;
  durationMinutes: number | null;
  extraMinutes: number | null;
  /** The full backup route, in the same shape as the primary route. */
  route: RouteResult | null;
  stations: string[];
  lines: string[];
  /** The connections whose loss this backup survives (a lift, a station or a line). */
  avoided: { connectionId: string; kind: 'LIFT' | 'STATION' | 'LINE'; label: string }[];
  routeSignature: string | null;
}

export function planBView(
  backup: BackupToolResult | undefined,
  route: RouteResult | undefined,
  stationName: (id: string) => string,
  describe: (connectionId: string) => { kind: 'LIFT' | 'STATION' | 'LINE'; label: string },
): PlanBView {
  if (!backup || !backup.available || !route) {
    return { available: false, durationMinutes: null, extraMinutes: null, route: null, stations: [], lines: [], avoided: [], routeSignature: null };
  }
  return {
    available: true,
    durationMinutes: backup.durationMinutes,
    extraMinutes: backup.extraMinutes,
    route,
    stations: route.stations.map(stationName),
    lines: lineLabels(route),
    avoided: backup.avoidedConnectionIds.map((connectionId) => ({ connectionId, ...describe(connectionId) })),
    routeSignature: backup.routeSignature,
  };
}

const display = (line: string) => line.split('-')[0].replace(/^./, (c) => c.toUpperCase());

/** One label per ride, in order: "Victoria", "Jubilee", or "District or Circle" where several lines share the platform. */
export function lineLabels(route: RouteResult): string[] {
  return route.legs.flatMap((leg) => (leg.type === 'ride' ? [leg.lines.map(display).join(' or ')] : []));
}

export interface WhyThisRoute {
  reasons: string[];
}

export interface WhyDisruption {
  kind: 'LIFT' | 'STATION' | 'LINE';
  label: string;
  closed: boolean;
  simulated: boolean;
}

/** The plain-language reasons for the chosen route, assembled from structured results. Normal users never see graph terms. */
export function whyThisRoute(input: {
  health: RouteHealth;
  route: RouteResult;
  /** Lifts on the route with no step-free alternative. */
  requiredLiftCount: number;
  planB: PlanBView;
  /** The disruptions the previous route depended on (REROUTED only). */
  affected: WhyDisruption[];
  /** Active disruptions that do not touch this route. */
  unrelated: WhyDisruption[];
}): WhyThisRoute {
  const { health, route, requiredLiftCount, planB, affected, unrelated } = input;
  const reasons: string[] = [];
  const state = (d: WhyDisruption) => (d.closed ? 'closed' : 'unavailable');
  const previously = (d: WhyDisruption) =>
    d.kind === 'LIFT'
      ? `Your previous route depended on ${d.label}, which is ${state(d)}`
      : d.kind === 'STATION'
        ? `Your previous journey needed ${d.label}, which is ${state(d)}`
        : `Your previous journey used the ${d.label}, which is ${state(d)}`;
  if (health.status === 'REROUTED') {
    if (affected.length === 0) reasons.push('Something your previous route depended on is unavailable');
    for (const d of affected) reasons.push(previously(d));
    reasons.push('This is the fastest step-free route that avoids it');
    reasons.push('Nothing this route needs is reported unavailable');
  } else if (health.status === 'AFFECTED') {
    reasons.push('The shortest step-free route found, but something it needs is currently unavailable');
  } else {
    reasons.push('The shortest step-free route that is currently usable');
    reasons.push('All the lifts and step-free connections it needs are working right now');
  }
  for (const d of unrelated) reasons.push(`The ${d.simulated ? 'simulated ' : ''}${d.label} being ${state(d)} does not affect this journey`);
  reasons.push(`About ${route.totalMinutes} minutes, including time in stations`);
  const labels = [...new Set(lineLabels(route))];
  if (labels.length > 0) reasons.push(`Travels on the ${labels.map((l) => `${l} line`).join(', then the ')}`);
  const changes = route.legs.filter((l) => l.type === 'transfer' && l.kind === 'interchange').length;
  reasons.push(changes === 0 ? 'No changes of line' : `${changes} change${changes === 1 ? '' : 's'} of line, each step-free`);
  reasons.push(requiredLiftCount === 0 ? 'Does not depend on any single lift' : `${requiredLiftCount} lift${requiredLiftCount === 1 ? '' : 's'} it cannot do without`);
  reasons.push(
    planB.available
      ? `A backup route is ready if this one becomes unusable${planB.extraMinutes ? ` (+${planB.extraMinutes} min)` : ''}`
      : 'No backup route is currently available',
  );
  return { reasons };
}
