import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AGENT_UNAVAILABLE_MESSAGE } from './agent/grounding.js';
import type { AgentRuntime } from './agent/index.js';
import { mcpHandler } from './agent/mcpServer.js';
import type { RoutingGraph } from './graph/routing.js';
import { isInLondon, nearestStation } from './network/geo.js';
import type { LiftDisruption, LiftDisruptionSource } from './tfl/liftDisruptions.js';

export interface AppDeps {
  routing: RoutingGraph;
  liveDisruptions: LiftDisruptionSource;
  agent?: AgentRuntime;
  corsOrigin?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApp({ routing, liveDisruptions, agent, corsOrigin }: AppDeps) {
  const app = express();
  const { network } = routing;
  const stationIds = new Set(network.stations.map((s) => s.id));
  const demoLift = network.lifts.find((l) => l.liftUniqueId === network.demoOutage.liftUniqueId)!;

  app.use(express.json());

  // The MCP endpoint is internal: it is registered before CORS (browsers never call it) and needs the backend's own bearer token.
  if (agent) app.post('/mcp', mcpHandler(agent.toolbox, agent.mcpToken));

  app.use(cors({ origin: corsOrigin ?? true }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  /** The supported network as stored in FalkorDB. */
  app.get('/api/network', async (_req, res) => {
    res.json({
      stations: network.stations.map(({ id, name, lat, lon, stepFreeStreetAccess }) => ({ id, name, lat, lon, stepFreeStreetAccess })),
      // The map only needs the ride connections (stored in FalkorDB) to draw the network; transfers stay on the server.
      edges: (await routing.edges(routing.baseGraph))
        .filter((e) => e.type === 'RIDE')
        .map(({ type, from, to, line, lines, minutes }) => ({ type, from, to, line, lines, minutes })),
      demoOutage: {
        liftUniqueId: network.demoOutage.liftUniqueId,
        stationId: network.demoOutage.stationId,
        friendlyName: network.demoOutage.friendlyName,
        affectedTransferIds: network.demoOutage.affectedTransferIds,
      },
      source: { topologyFeedStartDate: network.source.topologyFeedStartDate },
    });
  });

  app.post('/api/route', async (req, res) => {
    const { from, to, mode, outage } = req.body ?? {};
    if (!stationIds.has(from) || !stationIds.has(to)) throw new HttpError(400, 'Choose two supported stations.');
    if (from === to) throw new HttpError(400, 'Choose two different stations.');
    if (mode !== 'demo' && mode !== 'live') throw new HttpError(400, 'Mode must be demo or live.');

    let unavailableLifts: LiftDisruption[];
    let fetchedAt: string | null = null;
    if (mode === 'demo') {
      unavailableLifts = outage
        ? [{ liftUniqueId: demoLift.liftUniqueId, stationId: demoLift.stationId, friendlyName: demoLift.friendlyName, message: 'Simulated outage (Demo Mode).' }]
        : [];
    } else {
      const snapshot = await live(liveDisruptions);
      unavailableLifts = snapshot.disruptions;
      fetchedAt = snapshot.fetchedAt;
    }

    const scenario = await routing.scenarioGraph(unavailableLifts.map((l) => l.liftUniqueId));
    const route = await routing.route(from, to, scenario.name);
    res.json({
      mode,
      from,
      to,
      route,
      noRouteReason: route ? null : noRouteReason(from, to),
      unavailable: { lifts: unavailableLifts, transferIds: scenario.unavailableTransferIds },
      fetchedAt,
    });

    function noRouteReason(fromId: string, toId: string) {
      const blocked = [fromId, toId].map((id) => network.stations.find((s) => s.id === id)!).find((s) => !s.stepFreeStreetAccess);
      if (blocked) return `${blocked.name} has no step-free street access in TfL data.`;
      return 'No step-free route is currently available in the supported network.';
    }
  });

  /**
   * The journey agent. The first call starts a journey session; a call with the same sessionId re-checks it (for
   * example after the Demo Mode outage is triggered or cleared). The agent, not this handler, decides what to do.
   */
  app.post('/api/agent/journey', async (req, res) => {
    const { origin, destination, mode, sessionId, demoOutage } = req.body ?? {};
    if (mode !== 'demo' && mode !== 'live') throw new HttpError(400, 'Mode must be demo or live.');
    if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(sessionId))) throw new HttpError(400, 'Invalid session.');
    if (demoOutage !== undefined && typeof demoOutage !== 'boolean') throw new HttpError(400, 'demoOutage must be true or false.');
    const resuming = typeof sessionId === 'string' && Boolean(agent?.state.sessions.has(sessionId));
    if (!resuming && [origin, destination].some((v) => typeof v !== 'string' || v.trim() === '' || v.length > 80)) {
      throw new HttpError(400, 'Choose two stations.');
    }
    if (!agent) {
      res.status(503).json({ status: 'AGENT_UNAVAILABLE', message: AGENT_UNAVAILABLE_MESSAGE, trace: [] });
      return;
    }
    const result = await agent.agent.run({ origin, destination, mode, sessionId, demoOutage });
    const unavailable = result.status === 'AGENT_UNAVAILABLE' || result.status === 'TFL_UNAVAILABLE';
    res.status(unavailable ? 503 : result.status === 'AGENT_FAILED' ? 502 : 200).json(result);
  });

  /** Live Mode entry: London check, nearest supported station and current lift disruptions. */
  // POST keeps the user's location out of URLs and access logs.
  app.post('/api/live/status', async (req, res) => {
    const lat = Number(req.body?.lat);
    const lon = Number(req.body?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new HttpError(400, 'A valid location is required.');
    }
    if (!isInLondon(lat, lon)) {
      res.json({ inLondon: false, message: 'Live Mode is currently available in London only.' });
      return;
    }
    const nearest = nearestStation(network.stations, lat, lon);
    const snapshot = await live(liveDisruptions);
    res.json({
      inLondon: true,
      nearestStation: { id: nearest.station.id, name: nearest.station.name, distanceMetres: nearest.distanceMetres },
      disruptions: snapshot.disruptions,
      unavailableTransferIds: routing.unavailableTransfers(snapshot.disruptions.map((d) => d.liftUniqueId)),
      fetchedAt: snapshot.fetchedAt,
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Something went wrong while finding a route.' });
  });

  return app;
}

async function live(source: LiftDisruptionSource) {
  try {
    return await source();
  } catch {
    throw new HttpError(503, 'Live TfL lift data is unavailable. Live Mode needs an internet connection.');
  }
}
