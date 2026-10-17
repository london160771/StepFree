import { createHash } from 'node:crypto';
import { FalkorDB } from 'falkordb';
import { buildAreaGraph, unavailableTransferIds, type AreaGraph } from '../network/stepfree.js';
import type { LineId, Network } from '../network/types.js';

export const BASE_GRAPH = 'stepfree';
const ROUTABLE = ['RIDE', 'STEP_FREE_TRANSFER'];

interface PathNode {
  id: string;
  stationId: string;
  kind: 'street' | 'line';
  line: LineId | null;
}

interface PathEdge {
  type: 'RIDE' | 'STEP_FREE_TRANSFER';
  id: string | null;
  kind: 'entrance' | 'interchange' | null;
  line: LineId | null;
  lines: LineId[] | null;
  minutes: number;
  liftsUsed: string[] | null;
  via: string[] | null;
}

export type Leg =
  | {
      type: 'ride';
      line: LineId;
      /** Every line that runs this stretch on the same platforms (the rider can take any of them). */
      lines: LineId[];
      /** Supported stations on the train, in order (includes pass-through stations). */
      stations: string[];
      /** Unsupported stations the train passes; they are not StepFree stations. */
      via: string[];
      minutes: number;
    }
  | { type: 'transfer'; kind: 'entrance' | 'interchange' | 'exit'; stationId: string; fromLine: LineId | null; toLine: LineId | null; minutes: number; lifts: string[] };

export interface RouteResult {
  graph: string;
  /** Total of the travel-time weights on the path returned by algo.SPpaths. */
  totalMinutes: number;
  /** Ordered station ids along the route, including pass-through stations. */
  stations: string[];
  nodeIds: string[];
  legs: Leg[];
}

export interface GraphEdge {
  type: 'RIDE' | 'STEP_FREE_TRANSFER' | 'UNAVAILABLE_TRANSFER';
  id: string | null;
  from: string;
  to: string;
  line: LineId | null;
  lines: LineId[] | null;
  kind: string | null;
  minutes: number;
  requiredLifts: string[] | null;
}

/**
 * FalkorDB-backed routing over the seven-station graph.
 *
 * The base graph holds every step-free connection. A lift disruption scenario is a copy of
 * the base graph in which the affected STEP_FREE_TRANSFER relationships are re-typed to
 * UNAVAILABLE_TRANSFER, so algo.SPpaths (restricted to RIDE and STEP_FREE_TRANSFER) can
 * no longer use them.
 */
export class RoutingGraph {
  private readonly areaGraph: AreaGraph;
  private readonly scenarios = new Map<string, Promise<void>>();

  private constructor(
    private readonly db: FalkorDB,
    readonly network: Network,
    private readonly prefix: string,
  ) {
    this.areaGraph = buildAreaGraph(network.areaEdges);
  }

  static async connect(url: string, network: Network, prefix = BASE_GRAPH): Promise<RoutingGraph> {
    const db = await FalkorDB.connect({ url });
    const routing = new RoutingGraph(db, network, prefix);
    await routing.seed();
    return routing;
  }

  get baseGraph(): string {
    return this.prefix;
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  /** Recreate the base graph from network.json and drop any stale scenario graphs. */
  async seed(): Promise<void> {
    for (const name of await this.db.list()) {
      if (name === this.prefix || name.startsWith(`${this.prefix}:`)) await this.db.selectGraph(name).delete();
    }
    this.scenarios.clear();
    const { stations, streetNodes, lineNodes, rides, transfers } = this.network;
    const graph = this.db.selectGraph(this.prefix);
    await graph.query(
      `UNWIND $stations AS s
       CREATE (:Station {id: s.id, name: s.name, naptanId: s.naptanId, lat: s.lat, lon: s.lon, stepFreeStreetAccess: s.stepFreeStreetAccess})`,
      { params: { stations: stations.map((s) => ({ ...s })) } },
    );
    await graph.query(
      `UNWIND $nodes AS n
       MATCH (s:Station {id: n.stationId})
       CREATE (a:Access {id: n.id, stationId: n.stationId, kind: n.kind, line: n.line, lines: n.lines, boardable: n.boardable, direction: n.direction})-[:AT]->(s)`,
      {
        params: {
          nodes: [
            ...streetNodes.map((n) => ({ id: n.id, stationId: n.stationId, kind: 'street', line: null, lines: [], boardable: true, direction: null })),
            ...lineNodes.map((n) => ({ id: n.id, stationId: n.stationId, kind: 'line', line: n.line, lines: n.lines, boardable: n.boardable, direction: n.direction })),
          ],
        },
      },
    );
    await graph.query('CREATE INDEX FOR (a:Access) ON (a.id)');
    await graph.query(
      `UNWIND $rides AS r
       MATCH (a:Access {id: r.from}), (b:Access {id: r.to})
       CREATE (a)-[:RIDE {line: r.line, lines: r.lines, minutes: r.minutes, via: r.via, viaCount: size(r.via)}]->(b)`,
      { params: { rides: rides.map((r) => ({ ...r })) } },
    );
    await graph.query(
      `UNWIND $transfers AS t
       MATCH (a:Access {id: t.from}), (b:Access {id: t.to})
       CREATE (a)-[:STEP_FREE_TRANSFER {id: t.id, kind: t.kind, minutes: t.minutes, liftsUsed: t.liftsUsed, requiredLifts: t.requiredLifts}]->(b)`,
      {
        params: {
          transfers: transfers.map((t) => ({
            id: t.id,
            from: t.from,
            to: t.to,
            kind: t.kind,
            minutes: t.minutes,
            liftsUsed: t.liftsUsed,
            requiredLifts: t.requiredLifts,
          })),
        },
      },
    );
  }

  /** Transfers TfL topology says cannot work without the given lifts. */
  unavailableTransfers(unavailableLifts: Iterable<string>): string[] {
    return unavailableTransferIds(this.areaGraph, this.network.transfers, new Set(unavailableLifts));
  }

  /** Name of the FalkorDB graph that reflects the given unavailable lifts, creating it if needed. */
  async scenarioGraph(unavailableLifts: Iterable<string>): Promise<{ name: string; unavailableTransferIds: string[] }> {
    const transferIds = this.unavailableTransfers(unavailableLifts).sort();
    if (transferIds.length === 0) return { name: this.prefix, unavailableTransferIds: [] };
    const name = `${this.prefix}:${createHash('sha1').update(transferIds.join('|')).digest('hex').slice(0, 12)}`;
    let ready = this.scenarios.get(name);
    if (!ready) {
      ready = this.createScenario(name, transferIds);
      this.scenarios.set(name, ready);
      ready.catch(() => this.scenarios.delete(name));
    }
    await ready;
    return { name, unavailableTransferIds: transferIds };
  }

  private async createScenario(name: string, transferIds: string[]): Promise<void> {
    if ((await this.db.list()).includes(name)) await this.db.selectGraph(name).delete();
    await this.db.selectGraph(this.prefix).copy(name);
    await this.db.selectGraph(name).query(
      `MATCH (a)-[t:STEP_FREE_TRANSFER]->(b)
       WHERE t.id IN $ids
       CREATE (a)-[:UNAVAILABLE_TRANSFER {id: t.id, kind: t.kind, minutes: t.minutes, liftsUsed: t.liftsUsed, requiredLifts: t.requiredLifts}]->(b)
       DELETE t`,
      { params: { ids: transferIds } },
    );
  }

  /** Weighted shortest step-free path between two stations' street entrances, computed by FalkorDB. */
  async route(fromStationId: string, toStationId: string, graphName: string): Promise<RouteResult | null> {
    const reply = await this.db.selectGraph(graphName).roQuery<{
      nodes: PathNode[];
      edges: PathEdge[];
      pathWeight: number;
    }>(
      `MATCH (a:Access {id: $from}), (b:Access {id: $to})
       CALL algo.SPpaths({sourceNode: a, targetNode: b, relTypes: $relTypes, weightProp: 'minutes', pathCount: 1})
       YIELD path, pathWeight
       RETURN [n IN nodes(path) | {id: n.id, stationId: n.stationId, kind: n.kind, line: n.line}] AS nodes,
              [r IN relationships(path) | {type: type(r), id: r.id, kind: r.kind, line: r.line, lines: r.lines, minutes: r.minutes, liftsUsed: r.liftsUsed, via: r.via}] AS edges,
              pathWeight`,
      { params: { from: `${fromStationId}:street`, to: `${toStationId}:street`, relTypes: ROUTABLE } },
    );
    const row = reply.data?.[0];
    if (!row) return null;
    return {
      graph: graphName,
      totalMinutes: row.pathWeight,
      nodeIds: row.nodes.map((n) => n.id),
      stations: dedupe(row.nodes.map((n) => n.stationId)),
      legs: toLegs(row.nodes, row.edges),
    };
  }

  /** Every node relationship in the given graph, read from FalkorDB for the map. */
  async edges(graphName: string): Promise<GraphEdge[]> {
    const reply = await this.db.selectGraph(graphName).roQuery<GraphEdge>(
      `MATCH (a:Access)-[r]->(b:Access)
       RETURN type(r) AS type, r.id AS id, a.id AS from, b.id AS to, r.line AS line, r.lines AS lines, r.kind AS kind, r.minutes AS minutes, r.requiredLifts AS requiredLifts`,
    );
    return reply.data ?? [];
  }
}

function dedupe(values: string[]): string[] {
  return values.filter((value, i) => i === 0 || values[i - 1] !== value);
}

const linePreference: LineId[] = ['district', 'jubilee', 'victoria', 'northern', 'central', 'piccadilly', 'bakerloo', 'metropolitan', 'hammersmith-city', 'circle', 'waterloo-city'];
const preferred = (lines: LineId[]) => [...lines].sort((a, b) => linePreference.indexOf(a) - linePreference.indexOf(b))[0];

/**
 * Turn a FalkorDB path into journey legs. Consecutive rides stay one leg while some line serves all
 * of them (a Circle train through Moorgate stays one leg even though other lines share the platform),
 * so the rider is only told to change when they actually must.
 */
function toLegs(nodes: PathNode[], edges: PathEdge[]): Leg[] {
  const legs: Leg[] = [];
  edges.forEach((edge, i) => {
    const from = nodes[i];
    const to = nodes[i + 1];
    if (edge.type === 'RIDE') {
      const lines = edge.lines?.length ? edge.lines : [edge.line!];
      const previous = legs.at(-1);
      const shared = previous?.type === 'ride' ? previous.lines.filter((l) => lines.includes(l)) : [];
      if (previous?.type === 'ride' && shared.length > 0) {
        previous.lines = shared;
        previous.line = preferred(shared);
        previous.stations.push(to.stationId);
        previous.via.push(...(edge.via ?? []));
        previous.minutes += edge.minutes;
      } else {
        legs.push({ type: 'ride', line: preferred(lines), lines, stations: [from.stationId, to.stationId], via: [...(edge.via ?? [])], minutes: edge.minutes });
      }
    } else {
      legs.push({
        type: 'transfer',
        kind: edge.kind === 'interchange' ? 'interchange' : to.kind === 'street' ? 'exit' : 'entrance',
        stationId: from.stationId,
        fromLine: null,
        toLine: null,
        minutes: edge.minutes,
        lifts: edge.liftsUsed ?? [],
      });
    }
  });
  // An interchange is described by the lines either side of it.
  legs.forEach((leg, i) => {
    if (leg.type !== 'transfer' || leg.kind !== 'interchange') return;
    const before = legs[i - 1];
    const after = legs[i + 1];
    leg.fromLine = before?.type === 'ride' ? before.line : null;
    leg.toLine = after?.type === 'ride' ? after.line : null;
  });
  return legs;
}
