import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type LiftDisruption, type Mode, type NetworkResponse, type Route } from './api';
import { placeOnMap, type Point } from './map/layout';

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
  const run = useRef(0);

  useEffect(() => {
    api.network().then(setNetwork, (e: Error) => setLoadError(e.message));
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

  const findRoute = async () => {
    if (from === to) {
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
      const res = await api.route({ from, to, mode });
      if (id !== run.current) return;
      setUnavailableLifts(res.unavailable.lifts);
      setOutageStationIds(mode === 'live' ? affectedStations(res.unavailable.lifts, res.unavailable.transferIds) : []);
      setRoute(res.route);
      setNoRouteReason(res.noRouteReason);
      setJourneyKey(`${Date.now()}`);
      setPhase(res.route ? 'route' : 'noroute');
    } catch (e) {
      if (id !== run.current) return;
      setError((e as Error).message);
      setPhase('idle');
    }
  };

  /** Demo Mode: make the verified Green Park lift unavailable and let FalkorDB find another route. */
  const simulateOutage = async () => {
    if (!network || !route) return;
    const id = ++run.current;
    setOutageStationIds([network.demoOutage.stationId]);
    setPhase('outage');
    await wait(OUTAGE_HOLD_MS);
    if (id !== run.current) return;
    setFadingRoute(route);
    setRoute(null);
    setPhase('recalculating');
    try {
      const [res] = await Promise.all([api.route({ from, to, mode: 'demo', outage: true }), wait(RECALC_MIN_MS)]);
      if (id !== run.current) return;
      setUnavailableLifts(res.unavailable.lifts);
      setRoute(res.route);
      setNoRouteReason(res.noRouteReason);
      setJourneyKey(`${Date.now()}`);
      setPhase(res.route ? 'rerouted' : 'noroute');
    } catch (e) {
      if (id !== run.current) return;
      setError((e as Error).message);
      setPhase('idle');
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
            userPoint: placeOnMap(network?.stations ?? [], status.nearestStation.id, latitude, longitude),
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
    error,
    journeyKey,
    findRoute,
    simulateOutage,
    resetDemo,
  };
}

/** Stations where a disrupted lift actually makes a step-free connection unavailable. */
function affectedStations(lifts: LiftDisruption[], transferIds: string[]): string[] {
  const blocked = new Set(transferIds.map((id) => id.split(':')[0]));
  return [...new Set(lifts.map((l) => l.stationId))].filter((id) => blocked.has(id));
}
