import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { RoutingGraph } from './graph/routing.js';
import { isInLondon, nearestStation } from './network/geo.js';
import type { LiftDisruption, LiftDisruptionSource } from './tfl/liftDisruptions.js';

export interface AppDeps {
  routing: RoutingGraph;
  liveDisruptions: LiftDisruptionSource;
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

export function createApp({ routing, liveDisruptions, corsOrigin }: AppDeps) {
  const app = express();
  const { network } = routing;
  const stationIds = new Set(network.stations.map((s) => s.id));
  const demoLift = network.lifts.find((l) => l.liftUniqueId === network.demoOutage.liftUniqueId)!;

  app.use(cors({ origin: corsOrigin ?? true }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  /** The supported network as stored in FalkorDB. */
  app.get('/api/network', async (_req, res) => {
    res.json({
      stations: network.stations.map(({ id, name, lat, lon, stepFreeStreetAccess }) => ({ id, name, lat, lon, stepFreeStreetAccess })),
      edges: await routing.edges(routing.baseGraph),
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
      return 'No step-free route is available between these stations right now.';
    }
  });

  /** Live Mode entry: London check, nearest supported station and current lift disruptions. */
  app.get('/api/live/status', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
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
