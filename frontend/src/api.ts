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
  /** Every line that runs this segment on the same platforms. */
  lines: LineId[] | null;
  kind: string | null;
  minutes: number;
}

export interface NetworkResponse {
  stations: Station[];
  edges: GraphEdge[];
  demoOutage: { liftUniqueId: string; stationId: string; friendlyName: string; affectedTransferIds: string[] };
  /** The three controlled, simulated Demo Mode events. The app offers them; the agent decides what they mean for a journey. */
  demoDisruptions: DemoDisruptionInfo[];
}

export type DemoDisruptionKind = 'LIFT' | 'STATION' | 'LINE';

export interface DemoDisruptionInfo {
  kind: DemoDisruptionKind;
  id: string;
  /** What is affected: "Green Park Lift 2", "Green Park station", "Jubilee line". */
  label: string;
  closed: boolean;
  stationId: string | null;
  line: LineId | null;
  simulated: true;
}

export type Leg =
  | {
      type: 'ride';
      line: LineId;
      /** Every line that runs this stretch; the rider can take any of them. */
      lines: LineId[];
      /** Supported stations on the train, including pass-through ones. */
      stations: string[];
      /** Unsupported stations the train passes (not StepFree stations). */
      via: string[];
      minutes: number;
    }
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

export type AgentStatus =
  | 'ROUTE_SELECTED'
  | 'ROUTE_RETAINED'
  | 'REROUTED'
  | 'NO_ROUTE'
  | 'UNKNOWN_STATION'
  | 'AGENT_UNAVAILABLE'
  | 'TFL_UNAVAILABLE'
  | 'AGENT_FAILED';

/** One MCP tool call the journey agent made: what it asked, a compact result, and how long it took. */
export interface TraceEntry {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
  summary: string;
  durationMs: number;
}

export interface RouteHealth {
  status: 'CLEAR' | 'AFFECTED' | 'REROUTED' | 'NO_ROUTE';
  affectedConnectionIds: string[];
}

/** A backup route found before anything broke. Different from a reroute, which is what the agent selects after a disruption. */
export interface PlanB {
  available: boolean;
  durationMinutes: number | null;
  extraMinutes: number | null;
  route: Route | null;
  stations: string[];
  lines: string[];
  avoided: { connectionId: string; station: string; name: string }[];
}

export interface WhyThisRoute {
  reasons: string[];
}

export interface AgentResponse {
  sessionId: string;
  status: AgentStatus;
  message: string;
  /** The journey in the same shape the map and journey panel already use. */
  route: RouteResponse | null;
  routeHealth: RouteHealth | null;
  planB: PlanB | null;
  whyThisRoute: WhyThisRoute | null;
  dependencies: { station: string; kind: string; lifts: string[]; requiredConnectionIds: string[] }[];
  disruptions: {
    kind: DemoDisruptionKind;
    id: string;
    label: string;
    closed: boolean;
    simulated: boolean;
    stationId: string | null;
    station: string | null;
    message: string;
    affectedConnectionIds: string[];
  }[];
  trace: TraceEntry[];
}

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:4000';

class AgentBodyError extends Error {
  readonly body: AgentResponse;
  constructor(body: AgentResponse) {
    super(body.message);
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit & { keepErrorBody?: boolean }): Promise<T> {
  let response: Response;
  const { keepErrorBody, ...fetchInit } = init ?? {};
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...fetchInit,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new Error(
      navigator.onLine
        ? 'StepFree could not reach its route service. Check your connection and try again.'
        : 'You’re offline. StepFree needs an internet connection to find routes.',
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok && keepErrorBody && typeof body.status === 'string') throw new AgentBodyError(body as AgentResponse);
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong while finding a route.');
  return body as T;
}

export const api = {
  network: () => request<NetworkResponse>('/api/network'),
  /**
   * Ask the journey agent. The first call starts a journey; a call with the same sessionId makes the agent re-check it
   * (for example once a simulated Demo Mode disruption is activated). The agent decides; this app only reports what changed.
   */
  agentJourney: async (body: { origin?: string; destination?: string; mode: Mode; sessionId?: string; demoDisruption?: DemoDisruptionKind | null }): Promise<AgentResponse> => {
    try {
      return await request<AgentResponse>('/api/agent/journey', { method: 'POST', body: JSON.stringify(body), keepErrorBody: true });
    } catch (error) {
      if (error instanceof AgentBodyError) return error.body;
      throw error;
    }
  },
  liveStatus: (lat: number, lon: number) =>
    request<LiveStatus>('/api/live/status', { method: 'POST', body: JSON.stringify({ lat, lon }) }),
};
