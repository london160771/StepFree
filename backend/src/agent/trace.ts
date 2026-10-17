import type { ToolName } from './toolbox.js';

/** One executed MCP tool call, safe to show: the tool, its arguments, a compact result and how long it took. No model reasoning. */
export interface TraceEntry {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** Compact structured result. */
  result: unknown;
  /** One plain sentence built from the structured result (never from model text). */
  summary: string;
  durationMs: number;
}

const ACTION_LABEL: Record<string, string> = {
  ROUTE_SELECTED: 'route selected',
  ROUTE_RETAINED: 'route kept',
  REROUTED: 'rerouted',
  NO_ROUTE: 'no route',
};

/** Compact a tool result for the trace and the model: drop bulky fields, keep what a decision depends on. */
export function compactResult(tool: string, result: any): unknown {
  switch (tool as ToolName) {
    case 'plan_step_free_journey':
    case 'find_alternative_route':
      if (result?.status === 'ROUTE_FOUND') {
        const r = result.route;
        return {
          status: result.status,
          routeId: r.routeId,
          durationMinutes: r.durationMinutes,
          stations: r.stations,
          lines: r.lines,
          changes: r.changes,
          requiredConnectionIds: r.requiredConnectionIds,
          excludedConnectionIds: result.excludedConnectionIds,
        };
      }
      return result;
    case 'find_backup_route':
      if (result?.available) {
        return {
          status: result.status,
          primaryRouteId: result.primaryRouteId,
          routeId: result.route.routeId,
          durationMinutes: result.durationMinutes,
          extraMinutes: result.extraMinutes,
          stations: result.route.stations,
          avoidedConnectionIds: result.avoidedConnectionIds,
          candidatesChecked: result.candidatesChecked,
        };
      }
      return result;
    case 'inspect_route_dependencies':
      return {
        routeId: result.routeId,
        connections: result.dependencies?.length ?? 0,
        requiredConnectionIds: result.requiredConnectionIds,
      };
    case 'get_journey_disruptions':
      return {
        mode: result.mode,
        source: result.source,
        activeCount: result.activeCount,
        active: result.active,
        disruptions: (result.disruptions ?? []).map((d: any) => ({ kind: d.kind, id: d.id, label: d.label, simulated: d.simulated, relevant: d.relevant })),
      };
    default:
      return result;
  }
}

/** A plain-language line for "How StepFree decided", generated from the structured result. */
export function describeStep(tool: string, args: Record<string, any>, result: any, ok: boolean): string {
  if (!ok) return `${label(tool)} did not complete (${result?.message ?? 'error'})`;
  switch (tool as ToolName) {
    case 'resolve_station':
      return result.found ? `Checked that ${result.canonicalStation} is a supported station` : `Checked “${args.station}”: not in the supported network`;
    case 'plan_step_free_journey':
      return routeLine('Asked FalkorDB for a step-free route', result);
    case 'find_alternative_route':
      return routeLine('Asked FalkorDB for another step-free route', result);
    case 'find_backup_route':
      return result.available
        ? `Looked for a Plan B: ${result.durationMinutes} min (+${result.extraMinutes} min) via ${result.route.stations.join(', ')}`
        : 'Looked for a Plan B: no other step-free route is available';
    case 'inspect_route_dependencies': {
      const n = result.dependencies.length;
      return `Checked the ${n} accessibility connection${n === 1 ? '' : 's'} the route relies on`;
    }
    case 'get_journey_disruptions': {
      const state = (d: any) => `${d.label} ${d.closed ? 'closed' : 'unavailable'}${d.simulated ? ' (simulated)' : ''}`;
      const relevant = result.disruptions.filter((d: any) => d.relevant);
      if (relevant.length > 0) return `Detected ${relevant.map(state).join(', ')}`;
      if (result.activeCount === 0) return 'Checked current disruptions: none affect this journey';
      return `Checked current disruptions: ${result.disruptions.map(state).join(', ')}, but this journey does not depend on ${result.activeCount === 1 ? 'it' : 'them'}`;
    }
    case 'record_journey_decision':
      return `Recorded the decision (${ACTION_LABEL[result.action] ?? result.action})`;
    default:
      return label(tool);
  }
}

function routeLine(prefix: string, result: any): string {
  if (result.status === 'ROUTE_FOUND') {
    const n = result.route.dependencyCount;
    return `${prefix}: ${result.route.durationMinutes} min via ${result.route.stations.join(', ')}, relying on ${n} accessibility connection${n === 1 ? '' : 's'}`;
  }
  if (result.status === 'UNKNOWN_STATION') return `${prefix}: station not in the supported network`;
  return `${prefix}: no step-free route found`;
}

function label(tool: string) {
  return tool.replace(/_/g, ' ');
}
