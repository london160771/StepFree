import type { Network } from '../network/types.js';

export interface LiftDisruption {
  liftUniqueId: string;
  stationId: string;
  friendlyName: string;
  message: string;
}

export interface LiftDisruptionSnapshot {
  fetchedAt: string;
  disruptions: LiftDisruption[];
}

export type LiftDisruptionSource = () => Promise<LiftDisruptionSnapshot>;

interface TflLiftDisruption {
  stationUniqueId: string;
  disruptedLiftUniqueIds: string[];
  message: string;
}

export const TFL_LIFT_DISRUPTIONS_URL = 'https://api.tfl.gov.uk/Disruptions/Lifts/v2/';
const CACHE_MS = 60_000;

/** Current TfL lift disruptions, limited to lifts inside the seven supported stations. */
export function tflLiftDisruptions(network: Network, appKey?: string, fetchImpl: typeof fetch = fetch): LiftDisruptionSource {
  const lifts = new Map(network.lifts.map((lift) => [lift.liftUniqueId, lift]));
  let cache: { at: number; snapshot: LiftDisruptionSnapshot } | undefined;

  return async () => {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.snapshot;
    const url = appKey ? `${TFL_LIFT_DISRUPTIONS_URL}?app_key=${encodeURIComponent(appKey)}` : TFL_LIFT_DISRUPTIONS_URL;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`TfL lift disruptions request failed: ${response.status}`);
    const body = (await response.json()) as TflLiftDisruption[];
    const disruptions: LiftDisruption[] = [];
    for (const item of body) {
      for (const liftId of item.disruptedLiftUniqueIds ?? []) {
        const lift = lifts.get(liftId);
        if (lift) {
          disruptions.push({ liftUniqueId: liftId, stationId: lift.stationId, friendlyName: lift.friendlyName, message: item.message });
        }
      }
    }
    const snapshot = { fetchedAt: new Date().toISOString(), disruptions };
    cache = { at: Date.now(), snapshot };
    return snapshot;
  };
}
