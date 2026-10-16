/**
 * Phase 0 / Phase 1 data build.
 *
 * Downloads TfL's official detailed station topology, timetable run times and StopPoint
 * coordinates, then writes backend/data/network.json for the seven supported stations.
 * It also derives (never guesses) the Green Park lift used by the Demo Mode outage: the
 * lift that the Victoria line <-> Jubilee line step-free interchange cannot work without.
 *
 * Usage: npm run topology   (optional TFL_APP_KEY in backend/.env)
 */
import AdmZip from 'adm-zip';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAreaGraph, isTransferAvailable, stepFreePath } from '../src/network/stepfree.js';
import type {
  AreaEdge,
  Lift,
  LineId,
  LineNode,
  Network,
  Ride,
  Station,
  StreetNode,
  Transfer,
} from '../src/network/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const rawDir = join(dataDir, 'raw');
const TOPOLOGY_URL = 'https://api.tfl.gov.uk/stationdata/tfl-stationdata-detailed.zip';
const API = 'https://api.tfl.gov.uk';

/** Step-free travel pace used for walking parts of a transfer (3 km/h) and time per lift ride. */
const METRES_PER_MINUTE = 50;
const MINUTES_PER_LIFT = 2;
/** Straight-line distances between topology areas understate real corridors. */
const CORRIDOR_FACTOR = 1.3;

const STATIONS: Array<{ id: string; name: string; naptanId: string; lines: LineId[] }> = [
  { id: 'VIC', name: 'Victoria', naptanId: '940GZZLUVIC', lines: ['victoria', 'district'] },
  { id: 'GPK', name: 'Green Park', naptanId: '940GZZLUGPK', lines: ['victoria', 'jubilee'] },
  { id: 'SJP', name: "St James's Park", naptanId: '940GZZLUSJP', lines: ['district'] },
  { id: 'WSM', name: 'Westminster', naptanId: '940GZZLUWSM', lines: ['district', 'jubilee'] },
  { id: 'WLO', name: 'Waterloo', naptanId: '940GZZLUWLO', lines: ['jubilee'] },
  { id: 'SWK', name: 'Southwark', naptanId: '940GZZLUSWK', lines: ['jubilee'] },
  { id: 'LNB', name: 'London Bridge', naptanId: '940GZZLULNB', lines: ['jubilee'] },
];

/** Supported line sections, in travel order. */
const LINE_SECTIONS: Array<{ line: LineId; stops: string[] }> = [
  { line: 'victoria', stops: ['VIC', 'GPK'] },
  { line: 'district', stops: ['VIC', 'SJP', 'WSM'] },
  { line: 'jubilee', stops: ['GPK', 'WSM', 'WLO', 'SWK', 'LNB'] },
];

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

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(withKey(url));
  if (!response.ok) throw new Error(`TfL request failed ${response.status}: ${url}`);
  return (await response.json()) as T;
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

async function main() {
  mkdirSync(rawDir, { recursive: true });

  // 1. Official detailed topology.
  const zipResponse = await fetch(withKey(TOPOLOGY_URL));
  if (!zipResponse.ok) throw new Error(`Topology download failed: ${zipResponse.status}`);
  const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
  writeFileSync(join(rawDir, 'tfl-stationdata-detailed.zip'), zipBuffer);
  const zip = new AdmZip(zipBuffer);
  const csv = (name: string) => parseCsv(zip.readAsText(name));

  const feedInfo = csv('FeedInfo.csv')[0];
  const topoStations = csv('Stations.csv');
  const platforms = csv('Platforms.csv');
  const liftRows = csv('Lifts.csv');
  const sameLevel = csv('SameLevelPaths.csv');
  const ramps = csv('RampRoutes.csv');
  const points = csv('StationPoints.csv');
  const interchangeInfo = csv('StepFreeIntechangeInfo.csv');

  const topologyIdFor = (station: (typeof STATIONS)[number]) => {
    const row =
      topoStations.find((s) => s.UniqueId === station.naptanId) ??
      topoStations.find((s) => s.Name === station.name);
    if (!row) throw new Error(`Station ${station.name} not found in TfL topology`);
    return row.UniqueId;
  };
  const topologyIds = new Map(STATIONS.map((s) => [s.id, topologyIdFor(s)]));
  const belongs = (areaId: string) => [...topologyIds.values()].some((t) => areaId.startsWith(`${t}-`));

  // 2. Area graph for the supported stations (same-level paths, ramps and lifts are all step-free links).
  const areaEdges: AreaEdge[] = [];
  const pathRows: Record<string, string>[] = [
    ...sameLevel.map((r) => ({ ...r, via: 'level' })),
    ...ramps.map((r) => ({ ...r, via: 'ramp' })),
  ];
  for (const row of pathRows) {
    if (belongs(row.From) && belongs(row.To)) areaEdges.push({ from: row.From, to: row.To, via: row.via });
  }
  const lifts: Lift[] = [];
  for (const row of liftRows) {
    const stationId = [...topologyIds.entries()].find(([, t]) => t === row.StationUniqueId)?.[0];
    if (!stationId) continue;
    const areas = ['FromAreas', 'IntermediateAreas', 'IntermediateAreas2', 'ToAreas'].flatMap((key) =>
      row[key] ? row[key].split('|') : [],
    );
    lifts.push({ liftUniqueId: row.LiftUniqueId, stationId, friendlyName: row.FriendlyName, areas });
    for (const a of areas) for (const b of areas) if (a !== b) areaEdges.push({ from: a, to: b, via: row.LiftUniqueId });
  }
  const areaGraph = buildAreaGraph(areaEdges);
  const coords = new Map<string, [number, number]>(
    points.filter((p) => p.Lat && p.Lon).map((p) => [p.UniqueId, [Number(p.Lat), Number(p.Lon)]]),
  );

  // 3. Station coordinates from the TfL StopPoint API.
  const stations: Station[] = [];
  for (const s of STATIONS) {
    const stop = await getJson<{ lat: number; lon: number }>(`${API}/StopPoint/${s.naptanId}`);
    stations.push({
      id: s.id,
      name: s.name,
      naptanId: s.naptanId,
      topologyId: topologyIds.get(s.id)!,
      lat: stop.lat,
      lon: stop.lon,
      stepFreeStreetAccess: false,
    });
  }

  // 4. Line-specific nodes and street nodes.
  const lineNodes: LineNode[] = [];
  const streetNodes: StreetNode[] = [];
  for (const s of STATIONS) {
    const topologyId = topologyIds.get(s.id)!;
    streetNodes.push({ id: `${s.id}:street`, stationId: s.id, areaId: `${topologyId}-Outside` });
    for (const line of s.lines) {
      const platformIds = platforms
        .filter((p) => p.StationUniqueId === topologyId && p.UniqueId.split('-').pop()!.split('|').includes(line))
        .map((p) => p.UniqueId);
      if (platformIds.length === 0) throw new Error(`No ${line} platforms at ${s.name}`);
      lineNodes.push({ id: `${s.id}:${line}`, stationId: s.id, line, platformIds });
    }
  }

  // 5. Step-free transfers derived from topology.
  const transferTime = (fromAreas: string[], toAreas: string[]) => {
    let worst = { minutes: 0, metres: 0 };
    for (const from of fromAreas)
      for (const to of toAreas) {
        // Dijkstra over areas with geometric distances and a cost per lift.
        const best = new Map<string, number>([[from, 0]]);
        const metres = new Map<string, number>([[from, 0]]);
        const open = new Set([from]);
        while (open.size > 0) {
          const area = [...open].reduce((a, b) => (best.get(a)! <= best.get(b)! ? a : b));
          open.delete(area);
          if (area === to) break;
          for (const edge of areaGraph.get(area) ?? []) {
            const a = coords.get(area);
            const b = coords.get(edge.to);
            const distance = a && b ? haversine(a, b) * CORRIDOR_FACTOR : 0;
            const isLift = edge.via !== 'level' && edge.via !== 'ramp';
            const cost = best.get(area)! + distance / METRES_PER_MINUTE + (isLift ? MINUTES_PER_LIFT : 0);
            if (cost < (best.get(edge.to) ?? Infinity)) {
              best.set(edge.to, cost);
              metres.set(edge.to, metres.get(area)! + distance);
              open.add(edge.to);
            }
          }
        }
        if (!best.has(to)) return null;
        if (best.get(to)! > worst.minutes) worst = { minutes: best.get(to)!, metres: metres.get(to)! };
      }
    return worst;
  };

  const transfers: Transfer[] = [];
  const addTransfer = (stationId: string, from: string, to: string, kind: Transfer['kind'], fromAreas: string[], toAreas: string[]) => {
    const pairs = fromAreas.flatMap((a) => toAreas.map((b) => stepFreePath(areaGraph, a, b)));
    if (pairs.some((p) => p === null)) return; // No step-free path in TfL topology: no edge in the graph.
    const liftsUsed = [...new Set(pairs.flat() as string[])];
    const stationLifts = lifts.filter((l) => l.stationId === stationId).map((l) => l.liftUniqueId);
    const requiredLifts = stationLifts.filter(
      (lift) => !isTransferAvailable(areaGraph, { fromAreas, toAreas }, new Set([lift])),
    );
    const geometry = transferTime(fromAreas, toAreas)!;
    const published = interchangeInfo.filter(
      (row) => fromAreas.includes(row.FromPlatformUniqueId) && toAreas.includes(row.ToPlatformUniqueId),
    );
    const usePublished = kind === 'interchange' && published.length === fromAreas.length * toAreas.length;
    const lifted = Math.max(...pairs.map((p) => p!.length));
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

  for (const s of STATIONS) {
    const street = streetNodes.find((n) => n.stationId === s.id)!;
    const nodes = lineNodes.filter((n) => n.stationId === s.id);
    for (const node of nodes) {
      addTransfer(s.id, street.id, node.id, 'entrance', [street.areaId], node.platformIds);
      addTransfer(s.id, node.id, street.id, 'entrance', node.platformIds, [street.areaId]);
    }
    for (const a of nodes)
      for (const b of nodes) if (a !== b) addTransfer(s.id, a.id, b.id, 'interchange', a.platformIds, b.platformIds);
    stations.find((st) => st.id === s.id)!.stepFreeStreetAccess = transfers.some(
      (t) => t.stationId === s.id && t.kind === 'entrance',
    );
  }

  // 6. Ride times from the TfL timetable API (both directions use the same run time).
  const rides: Ride[] = [];
  const timetableUrls: string[] = [];
  for (const section of LINE_SECTIONS) {
    const first = STATIONS.find((s) => s.id === section.stops[0])!.naptanId;
    const last = STATIONS.find((s) => s.id === section.stops.at(-1))!.naptanId;
    const url = `${API}/Line/${section.line}/Timetable/${first}/to/${last}`;
    timetableUrls.push(url);
    const timetable = await getJson<{
      timetable: { routes: Array<{ stationIntervals: Array<{ intervals: Array<{ stopId: string; timeToArrival: number }> }> }> };
    }>(url);
    const naptans = section.stops.map((id) => STATIONS.find((s) => s.id === id)!.naptanId);
    const intervals = timetable.timetable.routes
      .flatMap((route) => route.stationIntervals)
      .map((si) => si.intervals)
      .find((list) => naptans.slice(1).every((n) => list.some((i) => i.stopId === n)));
    if (!intervals) throw new Error(`No timetable intervals for ${section.line}`);
    const arrival = (naptan: string) => (naptan === first ? 0 : intervals.find((i) => i.stopId === naptan)!.timeToArrival);
    for (let i = 0; i < section.stops.length - 1; i++) {
      const minutes = arrival(naptans[i + 1]) - arrival(naptans[i]);
      const from = `${section.stops[i]}:${section.line}`;
      const to = `${section.stops[i + 1]}:${section.line}`;
      rides.push({ from, to, line: section.line, minutes }, { from: to, to: from, line: section.line, minutes });
    }
  }

  // 7. Derive the Demo Mode outage lift: the lift the Green Park Victoria -> Jubilee interchange requires.
  const gpkInterchange = transfers.find((t) => t.id === 'GPK:victoria~GPK:jubilee');
  if (!gpkInterchange) throw new Error('Green Park Victoria -> Jubilee step-free interchange not found in topology');
  if (gpkInterchange.requiredLifts.length !== 1) {
    throw new Error(`Expected exactly one required lift, found: ${gpkInterchange.requiredLifts.join(', ')}`);
  }
  const outageLiftId = gpkInterchange.requiredLifts[0];
  const outageLift = lifts.find((l) => l.liftUniqueId === outageLiftId)!;
  const affected = transfers.filter((t) => !isTransferAvailable(areaGraph, t, new Set([outageLiftId]))).map((t) => t.id);

  const network: Network = {
    source: {
      topologyUrl: TOPOLOGY_URL,
      topologyFeedStartDate: feedInfo.FeedStartDate,
      timetableUrls,
      generatedAt: new Date().toISOString(),
    },
    stations,
    lineNodes,
    streetNodes,
    rides,
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

  writeFileSync(join(dataDir, 'network.json'), `${JSON.stringify(network, null, 2)}\n`);
  console.log(`Topology feed ${feedInfo.FeedStartDate}`);
  console.log(`Stations: ${stations.map((s) => `${s.name}${s.stepFreeStreetAccess ? '' : ' (no step-free street access)'}`).join(', ')}`);
  console.log(`Transfers: ${transfers.length}, rides: ${rides.length}, area edges: ${areaEdges.length}`);
  console.log(`Demo outage lift: ${outageLiftId} (${outageLift.friendlyName}); affects ${affected.join(', ')}`);
  for (const t of transfers) console.log(`  ${t.id}: ${t.minutes} min, required ${t.requiredLifts.join(' ') || '-'} [${t.timeSource}]`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
