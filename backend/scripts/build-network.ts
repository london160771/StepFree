/**
 * Network data build (Phase 0/1, extended to 17 Underground stations).
 *
 * Downloads TfL's official detailed station topology, Underground route sequences, timetable run
 * times and StopPoint coordinates, then writes backend/data/network.json for the supported
 * stations. Everything is derived from TfL data:
 *
 * - platforms and step-free street/interchange paths come from the detailed topology, per
 *   platform and direction (a station being "step-free" does not make every platform step-free);
 * - ride edges connect supported stations along real Underground routes; unsupported
 *   intermediate stops are aggregated into one edge and listed in `via`;
 * - the Demo Mode outage lift is derived, never guessed.
 *
 * Underground only: Elizabeth line, Overground, DLR and National Rail platforms are ignored.
 *
 * Usage: npm run topology   (optional TFL_APP_KEY in backend/.env)
 */
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAreaGraph, isTransferAvailable, stepFreePath, type AreaGraph } from '../src/network/stepfree.js';
import type { AreaEdge, Lift, LineId, LineNode, Network, Ride, Station, StreetNode, Transfer } from '../src/network/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const rawDir = join(dataDir, 'raw');
const cacheDir = join(rawDir, 'cache');
const TOPOLOGY_URL = 'https://api.tfl.gov.uk/stationdata/tfl-stationdata-detailed.zip';
const API = 'https://api.tfl.gov.uk';

/** Step-free travel pace used for walking parts of a transfer (3 km/h) and time per lift ride. */
const METRES_PER_MINUTE = 50;
const MINUTES_PER_LIFT = 2;
/** Straight-line distances between topology areas understate real corridors. */
const CORRIDOR_FACTOR = 1.3;

const TUBE_LINES = new Set<LineId>([
  'bakerloo',
  'central',
  'circle',
  'district',
  'hammersmith-city',
  'jubilee',
  'metropolitan',
  'northern',
  'piccadilly',
  'victoria',
  'waterloo-city',
]);

/** Which line labels a shared platform and its rides: first match wins. */
const LINE_PREFERENCE: LineId[] = [
  'district',
  'jubilee',
  'victoria',
  'northern',
  'central',
  'piccadilly',
  'bakerloo',
  'metropolitan',
  'hammersmith-city',
  'circle',
  'waterloo-city',
];

interface StationConfig {
  id: string;
  name: string;
  topologyId: string;
  naptanIds: string[];
}

/** The locked supported stations. */
const STATIONS: StationConfig[] = [
  { id: 'VIC', name: 'Victoria', topologyId: 'HUBVIC', naptanIds: ['940GZZLUVIC'] },
  { id: 'GPK', name: 'Green Park', topologyId: '940GZZLUGPK', naptanIds: ['940GZZLUGPK'] },
  { id: 'SJP', name: "St James's Park", topologyId: '940GZZLUSJP', naptanIds: ['940GZZLUSJP'] },
  { id: 'WSM', name: 'Westminster', topologyId: 'HUBWSM', naptanIds: ['940GZZLUWSM'] },
  { id: 'WLO', name: 'Waterloo', topologyId: 'HUBWAT', naptanIds: ['940GZZLUWLO'] },
  { id: 'SWK', name: 'Southwark', topologyId: '940GZZLUSWK', naptanIds: ['940GZZLUSWK'] },
  { id: 'LNB', name: 'London Bridge', topologyId: 'HUBLBG', naptanIds: ['940GZZLULNB'] },
  { id: 'BND', name: 'Bond Street', topologyId: 'HUBBDS', naptanIds: ['940GZZLUBND'] },
  { id: 'TCR', name: 'Tottenham Court Road', topologyId: 'HUBTCR', naptanIds: ['940GZZLUTCR'] },
  { id: 'KGX', name: "King's Cross St Pancras", topologyId: 'HUBKGX', naptanIds: ['940GZZLUKSX'] },
  { id: 'PAD', name: 'Paddington', topologyId: 'HUBPAD', naptanIds: ['940GZZLUPAC', '940GZZLUPAH'] },
  { id: 'LST', name: 'Liverpool Street', topologyId: 'HUBLST', naptanIds: ['940GZZLULVT'] },
  { id: 'FCN', name: 'Farringdon', topologyId: 'HUBZFD', naptanIds: ['940GZZLUFCN'] },
  { id: 'MGT', name: 'Moorgate', topologyId: 'HUBZMG', naptanIds: ['940GZZLUMGT'] },
  { id: 'CAN', name: 'Canary Wharf', topologyId: 'HUBCAW', naptanIds: ['940GZZLUCYF'] },
  { id: 'TWH', name: 'Tower Hill', topologyId: '940GZZLUTWH', naptanIds: ['940GZZLUTWH'] },
  { id: 'CWR', name: 'Canada Water', topologyId: 'HUBZCW', naptanIds: ['940GZZLUCWR'] },
];

/**
 * TfL timetable arrival times are whole minutes measured from the origin stop, so a leg's length
 * can differ by a minute depending on which stop the timetable is requested from. The original
 * seven-station network measured these lines from a fixed origin; keeping that origin keeps its
 * published Demo times (35 min, then 39 min after the Green Park outage) unchanged.
 */
const TIMING_ORIGIN: Partial<Record<LineId, { from: string; to: string }>> = {
  victoria: { from: 'VIC', to: 'KGX' },
  district: { from: 'VIC', to: 'TWH' },
  jubilee: { from: 'GPK', to: 'CAN' },
};

const appKey = loadAppKey();

function loadAppKey(): string | undefined {
  if (process.env.TFL_APP_KEY) return process.env.TFL_APP_KEY;
  const envPath = join(here, '..', '.env');
  if (!existsSync(envPath)) return undefined;
  const match = readFileSync(envPath, 'utf8').match(/^TFL_APP_KEY=(.*)$/m);
  return match?.[1]?.trim() || undefined;
}

function withKey(url: string): string {
  return appKey ? `${url}${url.includes('?') ? '&' : '?'}app_key=${encodeURIComponent(appKey)}` : url;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const transientFailures: string[] = [];

/**
 * GET JSON with retries and an on-disk cache (backend/data/raw is git-ignored). Returns null on 404.
 * Requests are paced to stay under TfL's unauthenticated rate limit; transient failures are recorded
 * (and not cached) so a re-run resumes from the cache.
 */
async function getJson<T>(url: string, critical = false): Promise<T | null> {
  const file = join(cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T | null;
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(attempt === 0 ? (appKey ? 50 : 1300) : 4000 * attempt);
    const response = await fetch(withKey(url));
    if (response.status === 404) {
      writeFileSync(file, 'null');
      return null;
    }
    if (!critical && response.status >= 500 && attempt >= 1) {
      // TfL answers impossible journeys (for example across a branch junction) with a 5xx. Treat a
      // repeated 5xx like "no such journey" and remember it.
      writeFileSync(file, 'null');
      return null;
    }
    if (response.status === 429 || response.status >= 500) continue;
    if (!response.ok) throw new Error(`TfL request failed ${response.status}: ${url}`);
    const json = (await response.json()) as T;
    writeFileSync(file, JSON.stringify(json));
    return json;
  }
  transientFailures.push(url);
  return null;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  const keys = header.map((key) => key.replace(/^﻿/, '').trim());
  return body.map((values) => Object.fromEntries(keys.map((key, i) => [key, values[i] ?? ''])));
}

function haversine(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const x = toRad(b[1] - a[1]) * Math.cos(toRad((a[0] + b[0]) / 2));
  const y = toRad(b[0] - a[0]);
  return 6_371_000 * Math.hypot(x, y);
}

/** Compass bearing in degrees (0 = north) from one lat/lon to another. */
function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const DIRECTION_ANGLE: Record<string, number> = { NB: 0, EB: 90, SB: 180, WB: 270 };

/** Which of a group's platform directions a train travelling on `bearingDegrees` uses. */
function directionFor(directions: string[], bearingDegrees: number): string {
  const set = new Set(directions);
  if (set.size === 2 && set.has('EB') && set.has('WB')) return Math.sin((bearingDegrees * Math.PI) / 180) > 0 ? 'EB' : 'WB';
  if (set.size === 2 && set.has('NB') && set.has('SB')) return Math.cos((bearingDegrees * Math.PI) / 180) > 0 ? 'NB' : 'SB';
  const angular = (d: string) => {
    const diff = Math.abs(((bearingDegrees - DIRECTION_ANGLE[d] + 540) % 360) - 180);
    return diff;
  };
  return [...set].sort((a, b) => angular(a) - angular(b))[0];
}

const preference = (line: LineId) => LINE_PREFERENCE.indexOf(line);
const primaryOf = (lines: LineId[]) => [...lines].sort((a, b) => preference(a) - preference(b))[0];
const stripStation = (name: string) => name.replace(/ Underground Station$/, '').replace(/-Underground$/, '');

// --- Shortest-path lifts, used to decide which lifts matter to Underground journeys. ---

/** Lifts on any shortest step-free path between two areas. */
function liftsOnShortestPaths(graph: AreaGraph, from: string, to: string): Set<string> {
  const distance = (start: string) => {
    const dist = new Map<string, number>([[start, 0]]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      for (const edge of graph.get(queue[i]) ?? []) {
        if (!dist.has(edge.to)) {
          dist.set(edge.to, dist.get(queue[i])! + 1);
          queue.push(edge.to);
        }
      }
    }
    return dist;
  };
  const fromDist = distance(from);
  const toDist = distance(to);
  const total = fromDist.get(to);
  const lifts = new Set<string>();
  if (total === undefined) return lifts;
  for (const [area, d] of fromDist) {
    for (const edge of graph.get(area) ?? []) {
      if (edge.via === 'level' || edge.via === 'ramp') continue;
      if (toDist.get(edge.to) === total - d - 1) lifts.add(edge.via);
    }
  }
  return lifts;
}

interface Platform {
  id: string;
  stationId: string;
  lines: LineId[];
  direction: string | null;
  stopId: string;
  friendlyName: string;
  accessible: boolean;
}

interface Group {
  stationId: string;
  stopId: string;
  lines: LineId[];
  platforms: Platform[];
}

interface Candidate {
  line: LineId;
  fromStop: string;
  toStop: string;
  fromStation: string;
  toStation: string;
  /** Unsupported stop ids passed between the two supported stations. */
  path: string[];
  departBearing: number;
  arriveBearing: number;
}

interface SequenceStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

interface TimetableResponse {
  timetable: { routes: Array<{ stationIntervals: Array<{ intervals: Array<{ stopId: string; timeToArrival: number }> }> }> };
}

async function main() {
  mkdirSync(cacheDir, { recursive: true });

  // 1. Official detailed topology.
  const zipResponse = await fetch(withKey(TOPOLOGY_URL));
  if (!zipResponse.ok) throw new Error(`Topology download failed: ${zipResponse.status}`);
  const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
  writeFileSync(join(rawDir, 'tfl-stationdata-detailed.zip'), zipBuffer);
  const zip = new AdmZip(zipBuffer);
  const csv = (name: string) => parseCsv(zip.readAsText(name));

  const feedInfo = csv('FeedInfo.csv')[0];
  const topoStations = csv('Stations.csv');
  const platformRows = csv('Platforms.csv');
  const liftRows = csv('Lifts.csv');
  const sameLevel = csv('SameLevelPaths.csv');
  const ramps = csv('RampRoutes.csv');
  const points = csv('StationPoints.csv');
  const interchangeInfo = csv('StepFreeIntechangeInfo.csv');

  for (const station of STATIONS) {
    if (!topoStations.some((s) => s.UniqueId === station.topologyId)) {
      throw new Error(`${station.name} (${station.topologyId}) is not in TfL topology Stations.csv`);
    }
  }
  const stationByTopology = new Map(STATIONS.map((s) => [s.topologyId, s.id]));
  const belongs = (areaId: string) => STATIONS.some((s) => areaId.startsWith(`${s.topologyId}-`));

  // 2. Area graph for the supported stations (same-level paths, ramps and lifts are all step-free links).
  const areaEdges: AreaEdge[] = [];
  const pathRows: Record<string, string>[] = [
    ...sameLevel.map((r) => ({ ...r, via: 'level' })),
    ...ramps.map((r) => ({ ...r, via: 'ramp' })),
  ];
  for (const row of pathRows) {
    if (belongs(row.From) && belongs(row.To)) areaEdges.push({ from: row.From, to: row.To, via: row.via });
  }
  const allLifts: Lift[] = [];
  for (const row of liftRows) {
    const stationId = stationByTopology.get(row.StationUniqueId);
    if (!stationId) continue;
    const areas = ['FromAreas', 'IntermediateAreas', 'IntermediateAreas2', 'ToAreas'].flatMap((key) =>
      row[key] ? row[key].split('|') : [],
    );
    allLifts.push({ liftUniqueId: row.LiftUniqueId, stationId, friendlyName: row.FriendlyName, areas });
    for (const a of areas) for (const b of areas) if (a !== b) areaEdges.push({ from: a, to: b, via: row.LiftUniqueId });
  }
  const areaGraph = buildAreaGraph(areaEdges);
  const coords = new Map<string, [number, number]>(
    points.filter((p) => p.Lat && p.Lon).map((p) => [p.UniqueId, [Number(p.Lat), Number(p.Lon)]]),
  );

  // 3. Station coordinates from the TfL StopPoint API (the first Underground NaPTAN id).
  const stations: Station[] = [];
  for (const s of STATIONS) {
    const stop = await getJson<{ lat: number; lon: number }>(`${API}/StopPoint/${s.naptanIds[0]}`);
    if (!stop) throw new Error(`StopPoint ${s.naptanIds[0]} not found`);
    stations.push({
      id: s.id,
      name: s.name,
      naptanId: s.naptanIds[0],
      naptanIds: s.naptanIds,
      topologyId: s.topologyId,
      lat: stop.lat,
      lon: stop.lon,
      stepFreeStreetAccess: false,
      lines: [],
      accessNotes: [],
    });
  }
  const stationOfStop = new Map(STATIONS.flatMap((s) => s.naptanIds.map((n) => [n, s.id] as const)));

  // 4. Underground platforms, with step-free access worked out per platform.
  const platforms: Platform[] = [];
  for (const row of platformRows) {
    const stationId = stationByTopology.get(row.StationUniqueId);
    if (!stationId) continue;
    const match = row.UniqueId.match(/-Plat[0-9A-Z]+(?:-([NSEW]B))?-(.+)$/);
    if (!match) continue;
    const lines = match[2].split('|').filter((l): l is LineId => TUBE_LINES.has(l as LineId));
    if (lines.length === 0) continue;
    const code = row.PlatformNaptanCode;
    const stopId = `940GZZ${code.slice(6, 11)}`;
    if (stationOfStop.get(stopId) !== stationId) {
      throw new Error(`Platform ${row.UniqueId} (${code}) does not map to a ${stationId} Underground stop (${stopId})`);
    }
    const street = `${row.StationUniqueId}-Outside`;
    platforms.push({
      id: row.UniqueId,
      stationId,
      lines,
      direction: match[1] ?? null,
      stopId,
      friendlyName: row.FriendlyName,
      accessible: stepFreePath(areaGraph, street, row.UniqueId) !== null,
    });
  }

  // 5. Platform groups -> nodes. A group is the platforms one set of lines shares at a stop.
  const groups = new Map<string, Group>();
  for (const p of platforms) {
    const key = `${p.stationId}|${p.stopId}|${[...p.lines].sort().join('|')}`;
    const group = groups.get(key) ?? { stationId: p.stationId, stopId: p.stopId, lines: [...p.lines].sort(), platforms: [] };
    group.platforms.push(p);
    groups.set(key, group);
  }
  const lineNodes: LineNode[] = [];
  const streetNodes: StreetNode[] = STATIONS.map((s) => ({ id: `${s.id}:street`, stationId: s.id, areaId: `${s.topologyId}-Outside` }));
  const nodeGroup = new Map<string, Group>();
  const accessNotes = new Map<string, string[]>();
  for (const group of groups.values()) {
    const primary = primaryOf(group.lines);
    const accessible = group.platforms.filter((p) => p.accessible);
    const lineLabel = group.lines.join('/');
    for (const p of group.platforms.filter((x) => !x.accessible)) {
      const notes = accessNotes.get(group.stationId) ?? [];
      notes.push(`${lineLabel}: ${p.friendlyName.trim()} has no step-free access in TfL data`);
      accessNotes.set(group.stationId, notes);
    }
    const base = `${group.stationId}:${primary}`;
    const make = (id: string, plats: Platform[], direction: string | null, boardable: boolean) => {
      lineNodes.push({ id, stationId: group.stationId, line: primary, lines: group.lines, platformIds: boardable ? plats.map((p) => p.id) : [], direction, boardable, stopId: group.stopId });
      nodeGroup.set(id, group);
    };
    // One node per platform direction: a train that arrives on one platform only continues the same
    // way, and turning back means changing platform (a timed step-free transfer), never a free U-turn.
    // This also keeps partial access honest: a direction with no step-free platform is pass-through only.
    const directions = [...new Set(group.platforms.map((p) => p.direction ?? 'ANY'))];
    if (directions.length === 1) {
      make(base, accessible, directions[0] === 'ANY' ? null : directions[0], accessible.length > 0);
    } else {
      for (const direction of directions) {
        const okPlatforms = group.platforms.filter((p) => (p.direction ?? 'ANY') === direction && p.accessible);
        make(`${base}:${direction}`, okPlatforms, direction === 'ANY' ? null : direction, okPlatforms.length > 0);
      }
    }
  }
  const ids = lineNodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate line node ids');

  // 6. Underground route sequences -> ride candidates between supported stations.
  const candidates: Candidate[] = [];
  const timetableUrls: string[] = [];
  const lineStopNames = new Map<string, string>();
  const stopInfo = new Map<string, SequenceStop>();
  const linesOnNetwork = [...new Set(lineNodes.flatMap((n) => n.lines))].filter((l) => l !== 'waterloo-city');
  const sequenceByLine = new Map<LineId, Map<string, Set<string>>>();
  for (const line of linesOnNetwork) {
    const successors = new Map<string, Set<string>>();
    for (const direction of ['inbound', 'outbound']) {
      const sequence = await getJson<{ stopPointSequences: Array<{ stopPoint: SequenceStop[] }> }>(
        `${API}/Line/${line}/Route/Sequence/${direction}?serviceTypes=Regular&excludeCrowding=true`,
      );
      for (const branch of sequence?.stopPointSequences ?? []) {
        branch.stopPoint.forEach((stop, i) => {
          stopInfo.set(stop.id, stop);
          lineStopNames.set(stop.id, stripStation(stop.name));
          const next = branch.stopPoint[i + 1];
          if (next) successors.set(stop.id, (successors.get(stop.id) ?? new Set()).add(next.id));
        });
      }
    }
    sequenceByLine.set(line, successors);
  }

  for (const [line, successors] of sequenceByLine) {
    const servesStation = (stationId: string) => lineNodes.some((n) => n.stationId === stationId && n.lines.includes(line));
    for (const start of successors.keys()) {
      const fromStation = stationOfStop.get(start);
      if (!fromStation || !servesStation(fromStation)) continue;
      const found = new Map<string, Candidate>();
      const walk = (node: string, path: string[], visited: Set<string>) => {
        if (path.length > 60) return;
        for (const next of successors.get(node) ?? []) {
          if (visited.has(next)) continue;
          const nextStation = stationOfStop.get(next);
          if (nextStation && nextStation !== fromStation) {
            if (!servesStation(nextStation)) {
              walk(next, [...path, next], new Set(visited).add(next));
              continue;
            }
            const first = stopInfo.get(path[0] ?? next)!;
            const origin = stopInfo.get(start)!;
            const previous = stopInfo.get(path.at(-1) ?? start)!;
            const target = stopInfo.get(next)!;
            const key = `${next}`;
            const candidate: Candidate = {
              line,
              fromStop: start,
              toStop: next,
              fromStation,
              toStation: nextStation,
              path,
              departBearing: bearing(origin, first),
              arriveBearing: bearing(previous, target),
            };
            const existing = found.get(key);
            if (!existing || existing.path.length > path.length) found.set(key, candidate);
            continue;
          }
          walk(next, nextStation === fromStation ? path : [...path, next], new Set(visited).add(next));
        }
      };
      walk(start, [], new Set([start]));
      candidates.push(...found.values());
    }
  }

  // 7. Ride times from TfL timetables.
  const arrivals = async (line: LineId, from: string, to: string, critical = false) => {
    const url = `${API}/Line/${line}/Timetable/${from}/to/${to}`;
    if (!timetableUrls.includes(url)) timetableUrls.push(url);
    const response = await getJson<TimetableResponse>(url, critical);
    return response?.timetable?.routes.flatMap((r) => r.stationIntervals.map((s) => s.intervals)) ?? [];
  };
  const originLists = new Map<LineId, Map<string, number>>();
  for (const [line, origin] of Object.entries(TIMING_ORIGIN) as Array<[LineId, { from: string; to: string }]>) {
    const from = STATIONS.find((s) => s.id === origin.from)!.naptanIds[0];
    const to = STATIONS.find((s) => s.id === origin.to)!.naptanIds[0];
    const best = (await arrivals(line, from, to, true)).sort((a, b) => b.length - a.length)[0] ?? [];
    originLists.set(line, new Map([[from, 0], ...best.map((i) => [i.stopId, i.timeToArrival] as const)]));
  }

  interface TimedCandidate extends Candidate {
    minutes: number;
  }
  const timed: TimedCandidate[] = [];
  const skipped: string[] = [];
  for (const c of candidates) {
    let minutes: number | undefined;
    const origin = originLists.get(c.line);
    const a = origin?.get(c.fromStop);
    const b = origin?.get(c.toStop);
    if (a !== undefined && b !== undefined && a !== b) minutes = Math.abs(b - a);
    if (minutes === undefined) {
      const lists = await arrivals(c.line, c.fromStop, c.toStop);
      // Only accept a timetable whose stops between the two stations are exactly this route's stops,
      // so a leg is never timed from a different (longer) pattern.
      const matching = lists.find((list) => {
        const index = list.findIndex((i) => i.stopId === c.toStop);
        return index === c.path.length && c.path.every((p, k) => list[k]?.stopId === p);
      });
      const time = matching?.find((i) => i.stopId === c.toStop)?.timeToArrival;
      if (time !== undefined) minutes = time;
    }
    if (minutes === undefined) {
      skipped.push(`${c.line} ${c.fromStation}->${c.toStation}`);
      continue;
    }
    timed.push({ ...c, minutes: Math.max(1, Math.round(minutes)) });
  }

  if (transientFailures.length) {
    throw new Error(
      `TfL kept rate-limiting or failing ${transientFailures.length} request(s); re-run to resume from the cache: ${transientFailures.join(', ')}`,
    );
  }

  // 8. Candidates -> ride edges between line nodes (platform groups), merged across lines that share platforms.
  const nodesAtStop = (stopId: string, line: LineId) =>
    lineNodes.filter((n) => n.stopId === stopId && n.lines.includes(line));
  const pickNode = (stopId: string, line: LineId, travelBearing: number): LineNode | undefined => {
    const nodes = nodesAtStop(stopId, line);
    if (nodes.length <= 1) return nodes[0];
    const wanted = directionFor(nodes.map((n) => n.direction ?? 'ANY'), travelBearing);
    return nodes.find((n) => (n.direction ?? 'ANY') === wanted);
  };
  const merged = new Map<string, Ride & { _lines: Map<LineId, { minutes: number; via: string[] }> }>();
  for (const c of timed) {
    const from = pickNode(c.fromStop, c.line, c.departBearing);
    const to = pickNode(c.toStop, c.line, c.arriveBearing);
    if (!from || !to) continue;
    const key = `${from.id}->${to.id}`;
    const via = c.path.map((p) => lineStopNames.get(p) ?? p);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { from: from.id, to: to.id, line: c.line, lines: [c.line], minutes: c.minutes, via, _lines: new Map([[c.line, { minutes: c.minutes, via }]]) });
    } else {
      existing._lines.set(c.line, { minutes: c.minutes, via });
    }
  }
  const rides: Ride[] = [];
  for (const ride of merged.values()) {
    // Lines sharing platforms and track run the same segment; the preferred line's published time is used
    // (District before Circle), so the result never depends on which of several equivalent lines is fastest.
    const entries = [...ride._lines.entries()].sort((a, b) => preference(a[0]) - preference(b[0]));
    const [bestLine, best] = entries[0];
    rides.push({
      from: ride.from,
      to: ride.to,
      line: bestLine,
      lines: entries.map(([l]) => l).sort((a, b) => preference(a) - preference(b)),
      minutes: best.minutes,
      via: best.via,
    });
  }

  // Prune pass-through nodes that cannot sit inside a journey (no ride in or no ride out), and unused nodes.
  const stationOfNode = new Map(lineNodes.map((n) => [n.id, n.stationId]));
  /** A pass-through node only matters if some train arrives from one station and leaves to a different one. */
  const passesThrough = (id: string, list: Ride[]) =>
    list.some((i) => i.to === id && list.some((o) => o.from === id && stationOfNode.get(o.to) !== stationOfNode.get(i.from)));
  const nodeById = new Map(lineNodes.map((n) => [n.id, n]));
  let changed = true;
  let liveRides = rides;
  while (changed) {
    changed = false;
    const incoming = new Set(liveRides.map((r) => r.to));
    const outgoing = new Set(liveRides.map((r) => r.from));
    for (const node of [...nodeById.values()]) {
      const used = incoming.has(node.id) || outgoing.has(node.id);
      const dead = !used || (!node.boardable && !passesThrough(node.id, liveRides));
      if (dead) {
        nodeById.delete(node.id);
        changed = true;
      }
    }
    const filtered = liveRides.filter((r) => nodeById.has(r.from) && nodeById.has(r.to));
    if (filtered.length !== liveRides.length) changed = true;
    liveRides = filtered;
  }
  const finalNodes = lineNodes.filter((n) => nodeById.has(n.id));

  // 9. Step-free transfers derived from topology.
  const transferTime = (fromAreas: string[], toAreas: string[]) => {
    let worst = { minutes: 0 };
    for (const from of fromAreas)
      for (const to of toAreas) {
        const best = new Map<string, number>([[from, 0]]);
        const open = new Set([from]);
        while (open.size > 0) {
          const area = [...open].reduce((x, y) => (best.get(x)! <= best.get(y)! ? x : y));
          open.delete(area);
          if (area === to) break;
          for (const edge of areaGraph.get(area) ?? []) {
            const p = coords.get(area);
            const q = coords.get(edge.to);
            const distance = p && q ? haversine(p, q) * CORRIDOR_FACTOR : 0;
            const isLift = edge.via !== 'level' && edge.via !== 'ramp';
            const cost = best.get(area)! + distance / METRES_PER_MINUTE + (isLift ? MINUTES_PER_LIFT : 0);
            if (cost < (best.get(edge.to) ?? Infinity)) {
              best.set(edge.to, cost);
              open.add(edge.to);
            }
          }
        }
        if (!best.has(to)) return null;
        if (best.get(to)! > worst.minutes) worst = { minutes: best.get(to)! };
      }
    return worst;
  };

  const transfers: Transfer[] = [];
  const relevantLifts = new Set<string>();
  /**
   * Add one step-free transfer. Whether it exists, which lifts it needs and which lifts it uses come from the
   * exact platforms involved. Its time comes from the whole platform group (both directions), the documented
   * conservative estimate, unless the transfer changes platform within one group (then the platforms themselves).
   */
  const addTransfer = (
    stationId: string,
    from: string,
    to: string,
    kind: Transfer['kind'],
    fromAreas: string[],
    toAreas: string[],
    timeFromAreas: string[] = fromAreas,
    timeToAreas: string[] = toAreas,
  ) => {
    const pairs = fromAreas.flatMap((a) => toAreas.map((b) => stepFreePath(areaGraph, a, b)));
    if (pairs.some((p) => p === null)) return; // No step-free path in TfL topology: no edge in the graph.
    for (const a of fromAreas) for (const b of toAreas) for (const lift of liftsOnShortestPaths(areaGraph, a, b)) relevantLifts.add(lift);
    const liftsUsed = [...new Set(pairs.flat() as string[])];
    const stationLifts = allLifts.filter((l) => l.stationId === stationId).map((l) => l.liftUniqueId);
    const requiredLifts = stationLifts.filter((lift) => !isTransferAvailable(areaGraph, { fromAreas, toAreas }, new Set([lift])));
    const timePairs = timeFromAreas.flatMap((a) => timeToAreas.map((b) => stepFreePath(areaGraph, a, b)));
    const geometry = transferTime(timeFromAreas, timeToAreas)!;
    const published = interchangeInfo.filter((row) => timeFromAreas.includes(row.FromPlatformUniqueId) && timeToAreas.includes(row.ToPlatformUniqueId));
    const usePublished = kind === 'interchange' && published.length === timeFromAreas.length * timeToAreas.length;
    const lifted = Math.max(...timePairs.map((p) => p?.length ?? 0));
    const minutes = usePublished
      ? Math.max(...published.map((row) => Number(row.DistanceInMetres))) / METRES_PER_MINUTE + lifted * MINUTES_PER_LIFT
      : geometry.minutes;
    transfers.push({
      id: `${from}~${to}`,
      stationId,
      from,
      to,
      kind,
      minutes: Math.max(1, Math.ceil(minutes)),
      fromAreas,
      toAreas,
      liftsUsed,
      requiredLifts,
      timeSource: usePublished ? 'tfl-interchange-distance' : 'topology-geometry',
    });
  };

  /** All step-free platforms of the node's platform group, both directions. */
  const groupPlatforms = (node: LineNode) => nodeGroup.get(node.id)!.platforms.filter((p) => p.accessible).map((p) => p.id);
  for (const station of stations) {
    const street = streetNodes.find((n) => n.stationId === station.id)!;
    const nodes = finalNodes.filter((n) => n.stationId === station.id && n.boardable);
    for (const node of nodes) {
      addTransfer(station.id, street.id, node.id, 'entrance', [street.areaId], node.platformIds, [street.areaId], groupPlatforms(node));
      addTransfer(station.id, node.id, street.id, 'entrance', node.platformIds, [street.areaId], groupPlatforms(node), [street.areaId]);
    }
    for (const a of nodes)
      for (const b of nodes) {
        if (a === b) continue;
        const sameGroup = nodeGroup.get(a.id) === nodeGroup.get(b.id);
        // Changing direction within one platform group is a real platform change; otherwise time it between the groups.
        addTransfer(station.id, a.id, b.id, 'interchange', a.platformIds, b.platformIds, sameGroup ? a.platformIds : groupPlatforms(a), sameGroup ? b.platformIds : groupPlatforms(b));
      }
    station.stepFreeStreetAccess = transfers.some((t) => t.stationId === station.id && t.kind === 'entrance');
    station.lines = [...new Set(nodes.flatMap((n) => n.lines))].sort() as LineId[];
    station.accessNotes = accessNotes.get(station.id) ?? [];
  }

  // Only lifts that sit on a step-free Underground path matter (not Elizabeth line, DLR or rail lifts).
  const lifts = allLifts.filter((l) => relevantLifts.has(l.liftUniqueId));

  // 10. Derive the Demo Mode outage lift: the lift the Green Park Victoria -> Jubilee interchange requires.
  const nodeLine = new Map(finalNodes.map((n) => [n.id, n.line]));
  const gpkInterchanges = transfers.filter(
    (t) => t.stationId === 'GPK' && t.kind === 'interchange' && nodeLine.get(t.from) === 'victoria' && nodeLine.get(t.to) === 'jubilee',
  );
  if (gpkInterchanges.length === 0) throw new Error('Green Park Victoria -> Jubilee step-free interchange not found in topology');
  const requiredSets = new Set(gpkInterchanges.map((t) => t.requiredLifts.join('|')));
  if (requiredSets.size !== 1 || gpkInterchanges[0].requiredLifts.length !== 1) {
    throw new Error(`Expected exactly one required lift, found: ${[...requiredSets].join(' / ')}`);
  }
  const gpkInterchange = gpkInterchanges[0];
  const outageLiftId = gpkInterchange.requiredLifts[0];
  const outageLift = allLifts.find((l) => l.liftUniqueId === outageLiftId)!;
  const affected = transfers.filter((t) => !isTransferAvailable(areaGraph, t, new Set([outageLiftId]))).map((t) => t.id);

  const network: Network = {
    source: {
      topologyUrl: TOPOLOGY_URL,
      topologyFeedStartDate: feedInfo.FeedStartDate,
      timetableUrls,
      generatedAt: new Date().toISOString(),
    },
    stations,
    lineNodes: finalNodes,
    streetNodes,
    rides: liveRides,
    transfers,
    lifts,
    areaEdges,
    demoOutage: {
      liftUniqueId: outageLiftId,
      stationId: 'GPK',
      friendlyName: outageLift.friendlyName,
      affectedTransferIds: affected,
      evidence: `In TfL Lifts.csv, ${outageLiftId} links ${outageLift.areas.join(' and ')}. It is the only lift whose removal breaks every step-free path between the Green Park Victoria line and Jubilee line platforms.`,
    },
  };

  writeFileSync(join(dataDir, 'network.json'), `${JSON.stringify(network, null, 1)}\n`);
  console.log(`Topology feed ${feedInfo.FeedStartDate}`);
  console.log(`Stations (${stations.length}):`);
  for (const s of stations) {
    console.log(`  ${s.id} ${s.name} [${s.naptanIds.join(', ')}] ${s.stepFreeStreetAccess ? '' : '(no step-free street access) '}lines: ${s.lines.join(', ') || '-'}`);
    for (const note of s.accessNotes) console.log(`      note: ${note}`);
  }
  console.log(`Nodes: ${finalNodes.length} (${finalNodes.filter((n) => !n.boardable).length} pass-through), rides: ${liveRides.length}, transfers: ${transfers.length}, lifts: ${lifts.length}, area edges: ${areaEdges.length}`);
  if (skipped.length) console.log(`No TfL timetable for: ${skipped.join(', ')}`);
  console.log(`Demo outage lift: ${outageLiftId} (${outageLift.friendlyName}); affects ${affected.join(', ')}`);
  for (const r of [...liveRides].sort((a, b) => a.from.localeCompare(b.from))) {
    console.log(`  RIDE ${r.from} -> ${r.to} ${r.minutes} min ${r.lines.join('/')}${r.via.length ? ` via ${r.via.join(', ')}` : ''}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
