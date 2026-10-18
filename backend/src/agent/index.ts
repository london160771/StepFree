import type { RoutingGraph } from '../graph/routing.js';
import type { LiftDisruptionSource } from '../tfl/liftDisruptions.js';
import { randomBytes } from 'node:crypto';
import { JourneyAgent } from './journeyAgent.js';
import type { AgentModel } from './model.js';
import { demoPolicyModel } from './demoPolicyModel.js';
import { AgentState } from './state.js';
import { StepFreeToolbox } from './toolbox.js';

export interface AgentRuntime {
  agent: JourneyAgent;
  toolbox: StepFreeToolbox;
  state: AgentState;
  /** Bearer token the agent host uses to call the backend's own /mcp endpoint. */
  mcpToken: string;
  /** Tell the agent host where the backend's /mcp endpoint is listening (known once the server has started). */
  setMcpUrl(url: string): void;
}

export function createAgentRuntime(deps: { routing: RoutingGraph; liveDisruptions: LiftDisruptionSource; liveModel: AgentModel | null; demoModel?: AgentModel }): AgentRuntime {
  const state = new AgentState();
  const toolbox = new StepFreeToolbox({ routing: deps.routing, liveDisruptions: deps.liveDisruptions, state });
  const mcpToken = randomBytes(24).toString('hex');
  let mcpUrl: string | null = null;
  const agent = new JourneyAgent({ routing: deps.routing, state, models: { demo: deps.demoModel ?? demoPolicyModel, live: deps.liveModel }, mcp: { url: () => mcpUrl, token: mcpToken } });
  return { agent, toolbox, state, mcpToken, setMcpUrl: (url) => (mcpUrl = url) };
}
