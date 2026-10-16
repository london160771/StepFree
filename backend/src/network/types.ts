export type LineId = 'victoria' | 'district' | 'jubilee';

export interface Station {
  /** Short id used across the app, e.g. "GPK". */
  id: string;
  name: string;
  /** TfL StopPoint NaPTAN id, e.g. "940GZZLUGPK". */
  naptanId: string;
  /** TfL detailed-topology station id (some stations use a HUB id). */
  topologyId: string;
  lat: number;
  lon: number;
  /** True when TfL topology shows a step-free path between street and at least one supported line. */
  stepFreeStreetAccess: boolean;
}

export interface LineNode {
  id: string;
  stationId: string;
  line: LineId;
  platformIds: string[];
}

export interface StreetNode {
  id: string;
  stationId: string;
  areaId: string;
}

export interface Ride {
  from: string;
  to: string;
  line: LineId;
  minutes: number;
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
