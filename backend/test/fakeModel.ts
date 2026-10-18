import { demoPolicyModel } from '../src/agent/demoPolicyModel.js';
import type { AgentModel, AgentModelRun, ModelStep, ModelToolCall } from '../src/agent/model.js';

/**
 * The production Demo policy, with the traveller's station names fixed and the goal text and tool catalogue recorded.
 * `text` replaces the policy's final (empty) text, for tests of the grounded-message check.
 */
export function policyModel(options: { origin: string; destination: string; recheckRouteId?: string; text?: () => string }): AgentModel & { goals: string[]; toolNames: string[][] } {
  const goals: string[] = [];
  const toolNames: string[][] = [];
  return {
    name: demoPolicyModel.name,
    kind: 'deterministic',
    goals,
    toolNames,
    start(start): AgentModelRun {
      goals.push(start.goal);
      toolNames.push(start.tools.map((t) => t.name));
      const run = demoPolicyModel.start({ ...start, request: { ...start.request, origin: options.origin, destination: options.destination } });
      if (!options.text) return run;
      return {
        ...run,
        step: async (signal): Promise<ModelStep> => {
          const step = await run.step(signal);
          return step.kind === 'text' ? { kind: 'text', text: options.text!() } : step;
        },
      };
    },
  };
}

/** A model that issues the given calls in order, then stops. For misbehaviour tests. */
export function scriptedModel(calls: ModelToolCall[] | ((turn: number) => ModelToolCall), finalText = ''): AgentModel {
  return {
    name: 'test-scripted-model',
    kind: 'llm',
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
