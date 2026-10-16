import { createApp } from './app.js';
import { config } from './config.js';
import { RoutingGraph } from './graph/routing.js';
import { loadNetwork } from './network/load.js';
import { tflLiftDisruptions } from './tfl/liftDisruptions.js';

const network = loadNetwork();
const routing = await RoutingGraph.connect(config.falkordbUrl, network);
const app = createApp({
  routing,
  liveDisruptions: tflLiftDisruptions(network, config.tflAppKey),
  corsOrigin: config.corsOrigin,
});

app.listen(config.port, () => {
  console.log(`StepFree API on http://localhost:${config.port} (FalkorDB graph "${routing.baseGraph}" seeded)`);
});
