export type LineId =
  | 'bakerloo'
  | 'central'
  | 'circle'
  | 'district'
  | 'hammersmith-city'
  | 'jubilee'
  | 'metropolitan'
  | 'northern'
  | 'piccadilly'
  | 'victoria'
  | 'waterloo-city';

export interface Station {
  /** Short id used across the app, e.g. "GPK". */
  id: string;
  name: string;
  /** Primary TfL StopPoint NaPTAN id of the Underground station, e.g. "940GZZLUGPK". */
  naptanId: string;
  /** Every Underground NaPTAN id of the station (Paddington has two). */
  naptanIds: string[];
  /** TfL detailed-topology station id (some stations use a HUB id). */
  topologyId: string;
  lat: number;
  lon: number;
  /** True when TfL topology shows a step-free path between street and at least one Underground platform. */
  stepFreeStreetAccess: boolean;
  /** Underground lines with a step-free platform used by the routing graph. */
  lines: LineId[];
  /** Plain-language partial-access findings from TfL topology (platforms or lines without step-free access). */
  accessNotes: string[];
}

export interface LineNode {
  id: string;
  stationId: string;
  /** Primary line of the platform group (used for the node id and labels). */
  line: LineId;
  /** Every line that stops at these platforms. */
  lines: LineId[];
  /** Step-free platforms the node represents; empty for pass-through nodes. */
  platformIds: string[];
  /** Platform direction (EB/WB/NB/SB) when a line's platforms differ in accessibility, otherwise null. */
  direction: string | null;
  /** False for pass-through nodes: trains pass or stop here but there is no step-free platform access. */
  boardable: boolean;
  /** NaPTAN stop id the platforms belong to. */
  stopId: string;
}

export interface StreetNode {
  id: string;
  stationId: string;
  areaId: string;
}

export interface Ride {
  from: string;
  to: string;
  /** The line used for this segment (the fastest of the lines that serve it). */
  line: LineId;
  /** All lines that run this segment on the same platforms. */
  lines: LineId[];
  minutes: number;
  /** Unsupported stations the train passes between the two supported stations (aggregated ride). */
  via: string[];
}

export type TransferKind = 'entrance' | 'interchange';

export interface Transfer {
  id: string;
  stationId: string;
  from: string;
  to: string;
  kind: TransferKind;
  minutes: number;
  /** Topology area ids that the transfer must connect (all pairs). */
  fromAreas: string[];
  toAreas: string[];
  /** Lifts on the step-free path in the current topology. */
  liftsUsed: string[];
  /** Lifts with no step-free alternative: if one is unavailable, the transfer is unavailable. */
  requiredLifts: string[];
  timeSource: 'tfl-interchange-distance' | 'topology-geometry';
}

export interface AreaEdge {
  from: string;
  to: string;
  /** "level", "ramp", or a TfL LiftUniqueId. */
  via: string;
}

export interface Lift {
  liftUniqueId: string;
  stationId: string;
  friendlyName: string;
  areas: string[];
}

export interface Network {
  source: {
    topologyUrl: string;
    topologyFeedStartDate: string;
    timetableUrls: string[];
    generatedAt: string;
  };
  stations: Station[];
  lineNodes: LineNode[];
  streetNodes: StreetNode[];
  rides: Ride[];
  transfers: Transfer[];
  lifts: Lift[];
  areaEdges: AreaEdge[];
  demoOutage: {
    liftUniqueId: string;
    stationId: string;
    friendlyName: string;
    affectedTransferIds: string[];
    evidence: string;
  };
}
