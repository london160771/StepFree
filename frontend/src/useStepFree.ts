import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AgentResponse, type AgentStatus, type DemoDisruptionInfo, type DemoDisruptionKind, type LiftDisruption, type Mode, type NetworkResponse, type PlanB, type Route, type RouteHealth, type AgentRuntimeInfo, type TraceEntry, type WhyThisRoute } from './api';
import { placeOnMap, schematicPositions, type Point } from './map/layout';

export type Phase = 'idle' | 'finding' | 'route' | 'outage' | 'recalculating' | 'rerouted' | 'noroute';

export type LiveState =
  | { status: 'prompt' }
  | { status: 'locating' }
  | { status: 'denied' }
  | { status: 'outside'; message: string }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      nearest: { id: string; name: string; distanceMetres: number };
      disruptions: LiftDisruption[];
      userPoint: Point;
      location: { lat: number; lon: number };
      fetchedAt: string;
    };

const OUTAGE_HOLD_MS = 1400;
const RECALC_MIN_MS = 1300;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useStepFree() {
  const [network, setNetwork] = useState<NetworkResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>('demo');
  const [live, setLive] = useState<LiveState>({ status: 'prompt' });
  const [from, setFromState] = useState('VIC');
  const [to, setToState] = useState('LNB');
  const [phase, setPhase] = useState<Phase>('idle');
  const [route, setRoute] = useState<Route | null>(null);
  const [fadingRoute, setFadingRoute] = useState<Route | null>(null);
  const [outageStationIds, setOutageStationIds] = useState<string[]>([]);
  const [unavailableLifts, setUnavailableLifts] = useState<LiftDisruption[]>([]);
  const [noRouteReason, setNoRouteReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [journeyKey, setJourneyKey] = useState('0');
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntimeInfo | null>(null);
  const [routeHealth, setRouteHealth] = useState<RouteHealth | null>(null);
  const [planB, setPlanB] = useState<PlanB | null>(null);
  const [why, setWhy] = useState<WhyThisRoute | null>(null);
  const sessionId = useRef<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  /** The simulated Demo Mode event the user activated, if any (one at a time). */
  const [activeDisruption, setActiveDisruption] = useState<DemoDisruptionInfo | null>(null);
  const [selectedKind, setSelectedKind] = useState<DemoDisruptionKind>('LIFT');
  const run = useRef(0);

  useEffect(() => {
    const load = () => api.network().then(setNetwork, (e: Error) => setLoadError(e.message));
    void load();
    // The installed app can open offline; load the network once a connection returns.
    const onOnline = () => {
      setLoadError(null);
      void load();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const clearRoute = useCallback(() => {
    run.current++;
    setPhase('idle');
    setRoute(null);
    setFadingRoute(null);
    setOutageStationIds([]);
    setUnavailableLifts([]);
    setNoRouteReason(null);
    setError(null);
    setAgentMessage(null);
    setTrace([]);
    setAgentRuntime(null);
    setRouteHealth(null);
    setPlanB(null);
    setWhy(null);
    setAgentStatus(null);
    setActiveDisruption(null);
    sessionId.current = null;
  }, []);

  const setFrom = (id: string) => {
    setFromState(id);
    clearRoute();
  };
  const setTo = (id: string) => {
    setToState(id);
    clearRoute();
  };

  const setMode = (next: Mode) => {
    if (next === mode) return;
    clearRoute();
    setModeState(next);
    if (next === 'live') setLive({ status: 'prompt' });
    else setFromState('VIC');
  };

  const findRoute = async (journey: { from: string; to: string } = { from, to }) => {
    const { from: origin, to: destination } = journey;
    if (origin === destination) {
      setError('Choose two different stations.');
      return;
    }
    const id = ++run.current;
    setError(null);
    setNoRouteReason(null);
    setFadingRoute(null);
    setOutageStationIds([]);
    setPhase('finding');
    try {
      const stationName = (stationId: string) => network?.stations.find((st) => st.id === stationId)?.name ?? stationId;
      const res = await api.agentJourney({ origin: stationName(origin), destination: stationName(destination), mode, demoDisruption: mode === 'demo' ? null : undefined });
      if (id !== run.current) return;
      if (!showable(res)) {
        setError(res.message);
        setPhase('idle');
        return;
      }
      const journey = res.route!;
      sessionId.current = res.sessionId;
      setAgentStatus(res.status);
      setUnavailableLifts(journey.unavailable.lifts);
      setOutageStationIds(mode === 'live' ? affectedStations(journey.unavailable.lifts, journey.unavailable.transferIds) : []);
      setRoute(journey.route);
      setNoRouteReason(journey.noRouteReason);
      setAgentMessage(res.message);
      setTrace(res.trace);
      setAgentRuntime(res.agent ?? null);
      setRouteHealth(res.routeHealth);
      setPlanB(res.planB);
      setWhy(res.whyThisRoute);
      setJourneyKey(`${Date.now()}`);
      setPhase(journey.route ? 'route' : 'noroute');
    } catch (e) {
      if (id !== run.current) return;
      setError((e as Error).message);
      setPhase('idle');
    }
  };

  /** Run Demo: the healthy Victoria to London Bridge journey, with no disruption and no location. */
  const runJudgeDemo = () => {
    clearRoute();
    setFromState('VIC');
    setToState('LNB');
    void findRoute({ from: 'VIC', to: 'LNB' });
  };

  /**
   * Demo Mode: activate one of the controlled, simulated disruptions. This only reports which event was activated;
   * the agent decides whether the current journey is affected and, if so, asks FalkorDB for another route.
   */
  const simulateDisruption = async (kind: DemoDisruptionKind = selectedKind) => {
    const info = network?.demoDisruptions.find((d) => d.kind === kind);
    if (!network || !route || !info) return;
    const id = ++run.current;
    setActiveDisruption(info);
    setOutageStationIds(markedStations(info, route));
    setPhase('outage');
    await wait(OUTAGE_HOLD_MS);
    if (id !== run.current) return;
    setFadingRoute(route);
    setRoute(null);
    setPhase('recalculating');
    try {
      const [res] = await Promise.all([api.agentJourney({ sessionId: sessionId.current ?? undefined, mode: 'demo', demoDisruption: kind }), wait(RECALC_MIN_MS)]);
      if (id !== run.current) return;
      if (!showable(res)) {
        setRoute(route);
        setFadingRoute(null);
        setActiveDisruption(null);
        setOutageStationIds([]);
        setError(res.message);
        setPhase('route');
        return;
      }
      const journey = res.route!;
      sessionId.current = res.sessionId;
      setAgentStatus(res.status);
      setUnavailableLifts(journey.unavailable.lifts);
      setRoute(journey.route);
      setNoRouteReason(journey.noRouteReason);
      setAgentMessage(res.message);
      setTrace(res.trace);
      setAgentRuntime(res.agent ?? null);
      setRouteHealth(res.routeHealth);
      setPlanB(res.planB);
      setWhy(res.whyThisRoute);
      setJourneyKey(`${Date.now()}`);
      setPhase(journey.route ? 'rerouted' : 'noroute');
    } catch (e) {
      if (id !== run.current) return;
      setRoute(route);
      setFadingRoute(null);
      setActiveDisruption(null);
      setOutageStationIds([]);
      setError((e as Error).message);
      setPhase('route');
    }
  };

  const resetDemo = () => {
    clearRoute();
    void findRoute();
  };

  /** Live Mode: only now ask the browser for location. */
  const allowLocation = () => {
    if (!navigator.onLine) {
      setLive({ status: 'error', message: 'Live Mode needs an internet connection for current TfL lift data.' });
      return;
    }
    if (!('geolocation' in navigator)) {
      setLive({ status: 'error', message: 'This browser cannot share your location, so Live Mode cannot start.' });
      return;
    }
    setLive({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const stations = network?.stations ?? [];
        try {
          const status = await api.liveStatus(latitude, longitude);
          if (!status.inLondon) {
            setLive({ status: 'outside', message: status.message });
            return;
          }
          setFromState(status.nearestStation.id);
          setToState(status.nearestStation.id === 'LNB' ? 'VIC' : 'LNB');
          setLive({
            status: 'ready',
            nearest: status.nearestStation,
            disruptions: status.disruptions,
            fetchedAt: status.fetchedAt,
            userPoint: placeOnMap(stations, schematicPositions(stations), status.nearestStation.id, latitude, longitude),
            location: { lat: latitude, lon: longitude },
          });
          setOutageStationIds(affectedStations(status.disruptions, status.unavailableTransferIds));
        } catch (e) {
          setLive({ status: 'error', message: (e as Error).message });
        }
      },
      (geoError) => {
        if (geoError.code === geoError.PERMISSION_DENIED) setLive({ status: 'denied' });
        else setLive({ status: 'error', message: 'We could not find your location. Please try again.' });
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  return {
    network,
    loadError,
    mode,
    setMode,
    live,
    allowLocation,
    from,
    to,
    setFrom,
    setTo,
    phase,
    route,
    fadingRoute,
    outageStationIds,
    unavailableLifts,
    noRouteReason,
    agentMessage,
    trace,
    agentRuntime,
    routeHealth,
    planB,
    why,
    error,
    journeyKey,
    findRoute,
    agentStatus,
    activeDisruption,
    selectedKind,
    setSelectedKind,
    runJudgeDemo,
    simulateDisruption,
    resetDemo,
  };
}

/** Where to show the red marker for a simulated event: its station, or the stations the current route rides that line through. */
export function markedStations(info: DemoDisruptionInfo, route: Route): string[] {
  if (info.stationId) return [info.stationId];
  const onLine = route.legs.flatMap((leg) => (leg.type === 'ride' && leg.lines.length === 1 && leg.lines[0] === info.line ? leg.stations : []));
  return [...new Set(onLine)];
}

/** The agent produced a journey (a route, or an honest no-route) that the app can show. */
function showable(res: AgentResponse): boolean {
  return res.route !== null && ['ROUTE_SELECTED', 'ROUTE_RETAINED', 'REROUTED', 'NO_ROUTE'].includes(res.status);
}

/** Stations where a disrupted lift actually makes a step-free connection unavailable. */
function affectedStations(lifts: LiftDisruption[], transferIds: string[]): string[] {
  const blocked = new Set(transferIds.map((id) => id.split(':')[0]));
  return [...new Set(lifts.map((l) => l.stationId))].filter((id) => blocked.has(id));
}
