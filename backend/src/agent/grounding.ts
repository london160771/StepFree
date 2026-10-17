import { stationKey } from '../network/names.js';

/** Everything a user-facing sentence is allowed to mention: facts returned by graph tools in this request. */
export interface GroundingFacts {
  action: 'ROUTE_SELECTED' | 'ROUTE_RETAINED' | 'REROUTED' | 'NO_ROUTE' | 'UNKNOWN_STATION';
  durationMinutes: number | null;
  /** Duration of the route that was replaced, for REROUTED messages. */
  previousMinutes: number | null;
  /** Duration of the Plan B route, if one was found (it may be mentioned alongside the main duration). */
  backupMinutes: number | null;
  /** Names of the supported stations on the final route, plus origin and destination. */
  routeStations: string[];
  /** Station where the new route changes line (used as "through ..."), if any. */
  viaStation: string | null;
  /** Lines (display names, e.g. "Jubilee") on the final and previous route. */
  lines: string[];
  /** Disrupted connections the decision rests on. */
  disruptions: { station: string; name: string; connectionId: string }[];
  noRouteReason: string | null;
}

export const UNKNOWN_STATION_MESSAGE = "That station isn't in StepFree's current supported network.";
export const AGENT_UNAVAILABLE_MESSAGE = 'Journey agent is temporarily unavailable.';

/** Plain copy assembled only from tool results. Used whenever the model's own wording fails the checks. */
export function deterministicMessage(facts: GroundingFacts): string {
  const minutes = facts.durationMinutes;
  switch (facts.action) {
    case 'ROUTE_SELECTED':
      return `Your step-free route is ready. It takes about ${minutes} minutes.`;
    case 'ROUTE_RETAINED':
      return `Your current step-free route is still usable. It takes about ${minutes} minutes.`;
    case 'REROUTED': {
      const out = facts.disruptions.length > 0 ? facts.disruptions.map((d) => `${d.station} ${d.name}`).join(' and ') : 'A lift on your route';
      const plural = facts.disruptions.length > 1 ? 'are' : 'is';
      const via = facts.viaStation ? ` through ${facts.viaStation}` : '';
      return `${out} ${plural} unavailable and your previous journey depended on it. I've found another step-free route${via}. It takes about ${minutes} minutes.`;
    }
    case 'NO_ROUTE':
      return facts.noRouteReason ?? 'No step-free route is currently available in the supported network.';
    case 'UNKNOWN_STATION':
      return UNKNOWN_STATION_MESSAGE;
  }
}

/**
 * Accept the model's wording only if every checkable claim in it is supported by tool results; otherwise use the
 * deterministic copy. Checks: durations, supported station names, "<Name> line" mentions and lift numbers.
 */
export function groundedMessage(modelText: string | null, facts: GroundingFacts, supportedStations: string[]): string {
  const fallback = deterministicMessage(facts);
  const text = (modelText ?? '').trim();
  if (!text || text.length > 400 || facts.action === 'UNKNOWN_STATION' || facts.action === 'NO_ROUTE') return fallback;
  if (!claimsAreSupported(text, facts, supportedStations)) return fallback;
  return text;
}

export function claimsAreSupported(text: string, facts: GroundingFacts, supportedStations: string[]): boolean {
  // Durations: every "<n> min(ute)s" must be the final route's duration, or (for a reroute) the replaced route's.
  const allowedMinutes = new Set([facts.durationMinutes, facts.backupMinutes, facts.action === 'REROUTED' ? facts.previousMinutes : null].filter((n): n is number => n !== null));
  for (const match of text.matchAll(/(\d+)\s*(?:min|minute|minutes|mins)\b/gi)) {
    if (!allowedMinutes.has(Number(match[1]))) return false;
  }
  // The text must state the duration of the route it is about.
  if (facts.durationMinutes !== null && !new RegExp(`\\b${facts.durationMinutes}\\s*(?:min|minute|minutes|mins)\\b`, 'i').test(text)) return false;

  // Supported stations may only be named if they belong to this journey or a disruption in it.
  const allowedStations = new Set([...facts.routeStations, ...facts.disruptions.map((d) => d.station), ...(facts.viaStation ? [facts.viaStation] : [])].map(stationKey));
  const haystack = ` ${stationKey(text)} `;
  for (const name of supportedStations) {
    const key = stationKey(name);
    if (haystack.includes(` ${key} `) && !allowedStations.has(key)) return false;
  }

  // Lines: "<Name> line" must be a line on the route.
  const lines = new Set(facts.lines.map((l) => l.toLowerCase()));
  for (const match of text.matchAll(/\b([A-Z][A-Za-z&-]+(?: (?:and|&|City) [A-Z][A-Za-z&-]+)?)\s+line\b/g)) {
    const name = match[1].toLowerCase();
    const known = ['bakerloo', 'central', 'circle', 'district', 'hammersmith', 'jubilee', 'metropolitan', 'northern', 'piccadilly', 'victoria', 'waterloo'];
    if (known.some((k) => name.startsWith(k)) && ![...lines].some((l) => l.startsWith(name.split(' ')[0]))) return false;
  }

  // Lifts: "Lift N" must be one of the disruptions the decision rests on.
  const liftNames = new Set(facts.disruptions.map((d) => d.name.toLowerCase()));
  for (const match of text.matchAll(/\blift\s+\d+\b/gi)) {
    if (!liftNames.has(match[0].toLowerCase().replace(/\s+/g, ' '))) return false;
  }
  if (facts.action === 'REROUTED' && facts.disruptions.length === 0) return false;
  return true;
}
