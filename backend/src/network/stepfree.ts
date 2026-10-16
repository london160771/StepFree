import type { AreaEdge, Transfer } from './types.js';

export type AreaGraph = Map<string, AreaEdge[]>;

export function buildAreaGraph(edges: AreaEdge[]): AreaGraph {
  const graph: AreaGraph = new Map();
  for (const edge of edges) {
    const list = graph.get(edge.from) ?? [];
    list.push(edge);
    graph.set(edge.from, list);
  }
  return graph;
}

/** Breadth-first search over TfL topology areas, skipping unavailable lifts. Returns the lifts used, or null. */
export function stepFreePath(
  graph: AreaGraph,
  from: string,
  to: string,
  unavailableLifts: ReadonlySet<string> = new Set(),
): string[] | null {
  const previous = new Map<string, { area: string; via: string } | null>([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const area = queue.shift()!;
    if (area === to) {
      const vias: string[] = [];
      let step = previous.get(area);
      while (step) {
        vias.push(step.via);
        step = previous.get(step.area);
      }
      return vias.reverse().filter((via) => via !== 'level' && via !== 'ramp');
    }
    for (const edge of graph.get(area) ?? []) {
      if (unavailableLifts.has(edge.via) || previous.has(edge.to)) continue;
      previous.set(edge.to, { area, via: edge.via });
      queue.push(edge.to);
    }
  }
  return null;
}

/** A transfer is usable only if every from/to area pair still has a step-free path. */
export function isTransferAvailable(
  graph: AreaGraph,
  transfer: Pick<Transfer, 'fromAreas' | 'toAreas'>,
  unavailableLifts: ReadonlySet<string>,
): boolean {
  return transfer.fromAreas.every((from) =>
    transfer.toAreas.every((to) => stepFreePath(graph, from, to, unavailableLifts) !== null),
  );
}

export function unavailableTransferIds(
  graph: AreaGraph,
  transfers: Transfer[],
  unavailableLifts: ReadonlySet<string>,
): string[] {
  if (unavailableLifts.size === 0) return [];
  return transfers
    .filter((transfer) => !isTransferAvailable(graph, transfer, unavailableLifts))
    .map((transfer) => transfer.id);
}
