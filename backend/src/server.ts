import { DEMO_POLICY_NAME } from './agent/demoPolicyModel.js';
import { createAgentRuntime } from './agent/index.js';
import { GEMINI_MODEL, GeminiAgentModel } from './agent/model.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { RoutingGraph } from './graph/routing.js';
import { loadNetwork } from './network/load.js';
import { tflLiftDisruptions } from './tfl/liftDisruptions.js';

const network = loadNetwork();
const routing = await RoutingGraph.connect(config.falkordbUrl, network);
const liveDisruptions = tflLiftDisruptions(network, config.tflAppKey);
const agent = createAgentRuntime({
  routing,
  liveDisruptions,
  // Demo Mode always runs the deterministic StepFree policy (no Gemini request). Live Mode needs Gemini.
  liveModel: config.geminiApiKey ? new GeminiAgentModel(config.geminiApiKey) : null,
});
const app = createApp({ routing, liveDisruptions, agent, corsOrigin: config.corsOrigin });

app.listen(config.port, () => {
  agent.setMcpUrl(`http://127.0.0.1:${config.port}/mcp`);
  console.log(`StepFree API on http://localhost:${config.port} (FalkorDB graph "${routing.baseGraph}" seeded)`);
  console.log(`Demo agent: ${DEMO_POLICY_NAME} (deterministic, no Gemini) through the StepFree MCP server at /mcp`);
  console.log(config.geminiApiKey ? `Live agent: ${GEMINI_MODEL} through the StepFree MCP server at /mcp` : 'Live agent unavailable: set GEMINI_API_KEY');
});
