export type LineId = 'victoria' | 'district' | 'jubilee';
export type Mode = 'demo' | 'live';

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  stepFreeStreetAccess: boolean;
}

export interface GraphEdge {
  type: 'RIDE' | 'STEP_FREE_TRANSFER' | 'UNAVAILABLE_TRANSFER';
  id: string | null;
  from: string;
  to: string;
  line: LineId | null;
  kind: string | null;
  minutes: number;
}

export interface NetworkResponse {
  stations: Station[];
  edges: GraphEdge[];
  demoOutage: { liftUniqueId: string; stationId: string; friendlyName: string; affectedTransferIds: string[] };
}

export type Leg =
  | { type: 'ride'; line: LineId; stations: string[]; minutes: number }
  | {
      type: 'transfer';
      kind: 'entrance' | 'interchange' | 'exit';
      stationId: string;
      fromLine: LineId | null;
      toLine: LineId | null;
      minutes: number;
      lifts: string[];
    };

export interface Route {
  graph: string;
  totalMinutes: number;
  stations: string[];
  nodeIds: string[];
  legs: Leg[];
}

export interface LiftDisruption {
  liftUniqueId: string;
  stationId: string;
  friendlyName: string;
  message: string;
}

export interface RouteResponse {
  mode: Mode;
  from: string;
  to: string;
  route: Route | null;
  noRouteReason: string | null;
  unavailable: { lifts: LiftDisruption[]; transferIds: string[] };
  fetchedAt: string | null;
}

export type LiveStatus =
  | { inLondon: false; message: string }
  | {
      inLondon: true;
      nearestStation: { id: string; name: string; distanceMetres: number };
      disruptions: LiftDisruption[];
      unavailableTransferIds: string[];
      fetchedAt: string;
    };

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:4000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new Error('StepFree could not reach its route service. Check your connection and try again.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong while finding a route.');
  return body as T;
}

export const api = {
  network: () => request<NetworkResponse>('/api/network'),
  route: (body: { from: string; to: string; mode: Mode; outage?: boolean }) =>
    request<RouteResponse>('/api/route', { method: 'POST', body: JSON.stringify(body) }),
  liveStatus: (lat: number, lon: number) =>
    request<LiveStatus>('/api/live/status', { method: 'POST', body: JSON.stringify({ lat, lon }) }),
};
