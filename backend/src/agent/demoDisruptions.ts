import { lineConnectionId, stationConnectionId } from '../network/connections.js';
import type { LineId, Network } from '../network/types.js';

/**
 * Demo Mode's controlled, simulated disruptions. Exactly one of the three can be active at a time, and each is
 * just a connection id (see network/connections.ts): the graph, the tools and the agent treat all three alike.
 *
 * Choices (validated against the 17-station graph, see backend/test/demoDisruptions.test.ts):
 * - LIFT: Green Park Lift 2, the lift TfL topology shows the Victoria <-> Jubilee interchange cannot work without.
 * - STATION: Green Park. On Victoria -> London Bridge it is the only station whose closure changes the journey,
 *   because it is the only place the route uses a station (the Victoria to Jubilee interchange). Every other station
 *   on the route is passed through, and a closed station is run through, not stopped at.
 * - LINE: the Jubilee line, which carries most of the journey. Without it FalkorDB finds a genuinely different
 *   journey (Victoria line, then Northern line via Moorgate).
 */
export const DEMO_STATION_ID = 'GPK';
export const DEMO_LINE: LineId = 'jubilee';

export type DemoDisruptionKind = 'LIFT' | 'STATION' | 'LINE';
export const DEMO_DISRUPTION_KINDS: DemoDisruptionKind[] = ['LIFT', 'STATION', 'LINE'];

export interface DemoDisruption {
  kind: DemoDisruptionKind;
  /** The connection id the graph excludes while this disruption is active. */
  id: string;
  /** What is affected, as a noun phrase: "Green Park Lift 2", "Green Park station", "Jubilee line". */
  label: string;
  /** How it is affected: closed stations are closed; lifts and lines are unavailable. */
  closed: boolean;
  /** The station to mark on the map for lift and station events. */
  stationId: string | null;
  line: LineId | null;
}

const lineName = (line: LineId) => line.split('-')[0].replace(/^./, (c) => c.toUpperCase());

export function demoDisruptionCatalogue(network: Network): Record<DemoDisruptionKind, DemoDisruption> {
  const lift = network.lifts.find((l) => l.liftUniqueId === network.demoOutage.liftUniqueId);
  const liftStation = network.stations.find((s) => s.id === network.demoOutage.stationId);
  const station = network.stations.find((s) => s.id === DEMO_STATION_ID);
  if (!lift || !liftStation || !station) throw new Error('Demo disruptions do not match the supported network');
  return {
    LIFT: { kind: 'LIFT', id: lift.liftUniqueId, label: `${liftStation.name} ${network.demoOutage.friendlyName}`, closed: false, stationId: liftStation.id, line: null },
    STATION: { kind: 'STATION', id: stationConnectionId(station.id), label: `${station.name} station`, closed: true, stationId: station.id, line: null },
    LINE: { kind: 'LINE', id: lineConnectionId(DEMO_LINE), label: `${lineName(DEMO_LINE)} line`, closed: false, stationId: null, line: DEMO_LINE },
  };
}
