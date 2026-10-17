import type { RouteDependency, RouteResult } from '../graph/routing.js';

/** A route a graph tool returned. Later tools (inspect, record) refer to it by id, so nothing can be recorded that FalkorDB did not produce. */
export interface StoredRoute {
  id: string;
  origin: { id: string; name: string };
  destination: { id: string; name: string };
  route: RouteResult;
  /** Lifts excluded when FalkorDB computed this route. */
  excludedConnectionIds: string[];
  /** Which tool produced it. */
  source: 'plan_step_free_journey' | 'find_alternative_route';
  dependencies?: RouteDependency[];
}

export interface JourneySessionState {
  id: string;
  mode: 'demo' | 'live';
  /** Demo Mode only: the controlled Green Park outage has been triggered by the user. */
  demoOutage: boolean;
  originId: string | null;
  destinationId: string | null;
  currentRouteId: string | null;
}

const MAX_ROUTES = 300;
const MAX_SESSIONS = 300;

/** Small in-memory working state shared by the MCP tools and the agent host. Durable decisions live in FalkorDB. */
export class AgentState {
  readonly routes = new Map<string, StoredRoute>();
  readonly sessions = new Map<string, JourneySessionState>();

  saveRoute(stored: StoredRoute): void {
    this.routes.delete(stored.id);
    this.routes.set(stored.id, stored);
    trim(this.routes, MAX_ROUTES);
  }

  saveSession(session: JourneySessionState): void {
    this.sessions.delete(session.id);
    this.sessions.set(session.id, session);
    trim(this.sessions, MAX_SESSIONS);
  }
}

function trim<K, V>(map: Map<K, V>, max: number) {
  while (map.size > max) map.delete(map.keys().next().value as K);
}
