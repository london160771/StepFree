import type { LineId, Network } from './types.js';

/**
 * One way to name anything a journey can depend on, and therefore anything that can be unavailable:
 *   a lift             "940GZZLUGPK-Lift-2"   (a TfL LiftUniqueId, as is)
 *   a station          "STATION:GPK"
 *   an Underground line "LINE:jubilee"
 * A disruption, a route dependency and a graph exclusion all use these ids, so the agent, the tools and the graph
 * share a single model instead of one per disruption type.
 */
export type Connection =
  | { kind: 'LIFT'; id: string; liftUniqueId: string; stationId: string }
  | { kind: 'STATION'; id: string; stationId: string }
  | { kind: 'LINE'; id: string; line: LineId };

export const stationConnectionId = (stationId: string) => `STATION:${stationId}`;
export const lineConnectionId = (line: LineId) => `LINE:${line}`;

export const LINE_IDS: LineId[] = ['bakerloo', 'central', 'circle', 'district', 'hammersmith-city', 'jubilee', 'metropolitan', 'northern', 'piccadilly', 'victoria', 'waterloo-city'];

/** The connection a validated id names, or null if it names nothing in the supported network. */
export function parseConnection(network: Pick<Network, 'stations' | 'lifts'>, id: string): Connection | null {
  if (id.startsWith('STATION:')) {
    const stationId = id.slice('STATION:'.length);
    return network.stations.some((s) => s.id === stationId) ? { kind: 'STATION', id, stationId } : null;
  }
  if (id.startsWith('LINE:')) {
    const line = id.slice('LINE:'.length) as LineId;
    return LINE_IDS.includes(line) ? { kind: 'LINE', id, line } : null;
  }
  const lift = network.lifts.find((l) => l.liftUniqueId === id);
  return lift ? { kind: 'LIFT', id, liftUniqueId: id, stationId: lift.stationId } : null;
}
