import type { AgentModel, AgentModelRun, ModelStep, ModelToolCall, ModelToolResult } from '../src/agent/model.js';

type Seen = { call: ModelToolCall; result: any }[];

/**
 * A deterministic stand-in for Gemini in tests. It is not a script: each next call is chosen from the tool results
 * seen so far, the way the real model is asked to, so the MCP and FalkorDB path is exercised for real.
 */
export function policyModel(options: { origin: string; destination: string; recheckRouteId?: string; text?: (seen: Seen) => string }): AgentModel & { goals: string[]; toolNames: string[][] } {
  const goals: string[] = [];
  const toolNames: string[][] = [];
  return {
    name: 'test-policy-model',
    goals,
    toolNames,
    start({ goal, tools }): AgentModelRun {
      goals.push(goal);
      const goalText = goal;
      toolNames.push(tools.map((t) => t.name));
      const seen: Seen = [];
      let pending: ModelToolCall[] | null = null;
      const used = (name: string) => seen.filter((s) => s.call.name === name);
      const last = (name: string) => used(name).at(-1)?.result;
      const { origin, destination } = options;
      const hasBackup = (routeId: string) => used('find_backup_route').some((s) => s.call.args.primaryRouteId === routeId);
      const decide = (): ModelStep => {
        const planned = last('plan_step_free_journey');
        const current: string | undefined = options.recheckRouteId;
        // Unsupported station: the planner says so, and there is nothing more to do.
        if (planned?.status === 'UNKNOWN_STATION') return { kind: 'text', text: "That station isn't supported." };
        if (!current && !planned) return call('plan_step_free_journey', { origin, destination });
        if (!current && planned.status === 'NO_ROUTE') {
          return last('record_journey_decision') ? finish() : call('record_journey_decision', { sessionId: 'x'.repeat(8), origin, destination, action: 'NO_ROUTE', reasonCode: 'NO_STEP_FREE_ROUTE' });
        }
        // The route's required connections come with the plan result (or, on a re-check, with the goal text).
        const required: string[] = current ? JSON.parse(goalText.match(/requires these connections: (\[.*?\])/)![1]) : planned.requiredConnectionIds;
        if (!last('get_accessibility_disruptions')) {
          return call('get_accessibility_disruptions', { mode: 'demo', relevantConnectionIds: required });
        }
        if (last('record_journey_decision')) return finish();
        const relevant = last('get_accessibility_disruptions').disruptions.filter((d: any) => d.relevant).map((d: any) => d.connectionId);
        if (relevant.length > 0) {
          const alt = last('find_alternative_route');
          if (!alt) return call('find_alternative_route', { origin, destination, unavailableConnectionIds: relevant });
          if (alt.status !== 'ROUTE_FOUND') return call('record_journey_decision', { sessionId: 'x'.repeat(8), origin, destination, action: 'NO_ROUTE', reasonCode: 'NO_ALTERNATIVE' });
          // The new route is the one being kept, so look for its Plan B before recording.
          if (!hasBackup(alt.routeId)) return call('find_backup_route', { origin, destination, primaryRouteId: alt.routeId });
          return call('record_journey_decision', {
            sessionId: 'x'.repeat(8),
            origin,
            destination,
            action: 'REROUTED',
            reasonCode: 'REQUIRED_LIFT_UNAVAILABLE',
            affectedConnectionIds: relevant,
            routeSummary: { routeId: alt.routeId },
          });
        }
        // Nothing relevant is out. After a re-check, plan again in case something faster is now available.
        if (current && !planned) return call('plan_step_free_journey', { origin, destination });
        const chosen: string = current && planned?.status === 'ROUTE_FOUND' ? planned.routeId : (current ?? planned.routeId);
        if (!hasBackup(chosen)) return call('find_backup_route', { origin, destination, primaryRouteId: chosen });
        return call('record_journey_decision', {
          sessionId: 'x'.repeat(8),
          origin,
          destination,
          action: current && chosen === current ? 'ROUTE_RETAINED' : 'ROUTE_SELECTED',
          reasonCode: 'NO_DISRUPTION',
          routeSummary: { routeId: chosen },
        });
      };
      const finish = (): ModelStep => ({ kind: 'text', text: options.text ? options.text(seen) : '' });
      const call = (name: string, args: Record<string, unknown>): ModelStep => {
        pending = [{ name, args }];
        return { kind: 'tool_calls', calls: pending };
      };
      return {
        async step() {
          return decide();
        },
        addToolResults(results: ModelToolResult[]) {
          for (const r of results) seen.push({ call: r.call, result: r.result });
        },
        addUserText() {},
      };
    },
  };
}

/** A model that issues the given calls in order, then stops. For misbehaviour tests. */
export function scriptedModel(calls: ModelToolCall[] | ((turn: number) => ModelToolCall), finalText = ''): AgentModel {
  return {
    name: 'test-scripted-model',
    start(): AgentModelRun {
      let turn = 0;
      return {
        async step(): Promise<ModelStep> {
          if (typeof calls === 'function') return { kind: 'tool_calls', calls: [calls(turn++)] };
          const next = calls[turn++];
          return next ? { kind: 'tool_calls', calls: [next] } : { kind: 'text', text: finalText };
        },
        addToolResults() {},
        addUserText() {},
      };
    },
  };
}
