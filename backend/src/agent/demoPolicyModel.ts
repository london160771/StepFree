import type { AgentModel, AgentModelRun, ModelStep, ModelToolCall, ModelToolResult } from './model.js';

type Seen = { call: ModelToolCall; result: any }[];

/** Name reported in every Demo Mode response. It is a StepFree policy, not a language model. */
export const DEMO_POLICY_NAME = 'stepfree-demo-policy';

/**
 * The Demo Mode agent policy: a deterministic tool-selection policy, so the repeatable judge experience does not
 * depend on an external AI quota. It is not Gemini and never calls one.
 *
 * It does the same job the language model does in Live Mode: it picks the next StepFree MCP tool from the results of
 * the tools it has already called, and the agent host executes every pick through the real MCP client, `/mcp` and
 * StepFreeToolbox. It knows the procedure, not the answer: it holds no routes, times, stations or lifts, never
 * computes anything, and accepts whatever FalkorDB returns (including no route and no backup).
 *
 * Procedure, fresh journey: plan -> disruptions -> (alternative route if a relevant disruption) -> Plan B for the
 * route being kept -> record. Re-check: disruptions -> (alternative, or plan again) -> Plan B -> record.
 */
export const demoPolicyModel: AgentModel = {
  name: DEMO_POLICY_NAME,
  kind: 'deterministic',
  start({ request }): AgentModelRun {
    const { origin, destination, sessionId, recheck } = request;
    const seen: Seen = [];
    const used = (name: string) => seen.filter((s) => s.call.name === name);
    const last = (name: string) => used(name).at(-1)?.result;
    const hasBackup = (routeId: string) => used('find_backup_route').some((s) => s.call.args.primaryRouteId === routeId);
    const record = (args: Record<string, unknown>) => call('record_journey_decision', { sessionId, origin, destination, ...args });
    const call = (name: string, args: Record<string, unknown>): ModelStep => ({ kind: 'tool_calls', calls: [{ name, args }] });
    const text = (value: string): ModelStep => ({ kind: 'text', text: value });

    const decide = (): ModelStep => {
      const planned = last('plan_step_free_journey');
      // Unsupported station: the planner says so, and there is nothing more to do.
      if (planned?.status === 'UNKNOWN_STATION') return text('');
      if (!recheck && !planned) return call('plan_step_free_journey', { origin, destination });
      if (!recheck && planned.status === 'NO_ROUTE') {
        return last('record_journey_decision') ? text('') : record({ action: 'NO_ROUTE', reasonCode: 'NO_STEP_FREE_ROUTE' });
      }

      // The connections the route depends on come with the plan result (or, on a re-check, from the host).
      const required: string[] = recheck ? recheck.requiredConnectionIds : planned.requiredConnectionIds;
      if (!last('get_journey_disruptions')) return call('get_journey_disruptions', { mode: request.mode, relevantConnectionIds: required });
      if (last('record_journey_decision')) return text('');

      const disruptions: { id: string; kind: string; relevant: boolean }[] = last('get_journey_disruptions').disruptions ?? [];
      const relevant = disruptions.filter((d) => d.relevant);
      if (relevant.length > 0) {
        const alt = last('find_alternative_route');
        if (!alt) return call('find_alternative_route', { origin, destination, unavailableConnectionIds: relevant.map((d) => d.id) });
        if (alt.status !== 'ROUTE_FOUND') return record({ action: 'NO_ROUTE', reasonCode: 'NO_ALTERNATIVE' });
        // The new route is the one being kept, so it gets its own Plan B before the decision is recorded.
        if (!hasBackup(alt.routeId)) return call('find_backup_route', { origin, destination, primaryRouteId: alt.routeId });
        return record({
          action: 'REROUTED',
          reasonCode: relevant[0].kind === 'STATION' ? 'STATION_CLOSURE' : relevant[0].kind === 'LINE' ? 'LINE_DISRUPTION' : 'LIFT_DISRUPTION',
          affectedConnectionIds: relevant.map((d) => d.id),
          routeSummary: { routeId: alt.routeId },
        });
      }

      // Nothing the route needs is unavailable. After a re-check with nothing disrupted at all, plan again in case something
      // faster is available. While something is still disrupted the planner (which ignores disruptions) is not asked, so the
      // route already known to avoid it is kept.
      if (recheck && !planned && disruptions.length === 0) return call('plan_step_free_journey', { origin, destination });
      const chosen: string = recheck && planned?.status === 'ROUTE_FOUND' ? planned.routeId : (recheck?.routeId ?? planned.routeId);
      if (!hasBackup(chosen)) return call('find_backup_route', { origin, destination, primaryRouteId: chosen });
      return record({
        action: recheck && chosen === recheck.routeId ? 'ROUTE_RETAINED' : 'ROUTE_SELECTED',
        reasonCode: disruptions.length > 0 ? 'DISRUPTION_NOT_ON_ROUTE' : 'NO_DISRUPTION',
        routeSummary: { routeId: chosen },
      });
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
