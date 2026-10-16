import type { Leg } from '../api';
import { LINE_NAMES } from '../map/layout';

export const SAFETY_NOTE = 'based on currently available TfL accessibility data.';

const liftCount = (n: number) => (n === 0 ? 'level access' : n === 1 ? '1 lift' : `${n} lifts`);

/** Plain-language description of one leg of the FalkorDB route. */
export function describeLeg(leg: Leg, name: (id: string) => string): string {
  if (leg.type === 'ride') {
    const end = name(leg.stations.at(-1)!);
    const passing = leg.stations.slice(1, -1).map(name);
    const stops = leg.stations.length - 1;
    const via = passing.length > 0 ? `, passing ${passing.join(', ')}` : '';
    return `${LINE_NAMES[leg.line]} to ${end}${via} (${stops} ${stops === 1 ? 'stop' : 'stops'})`;
  }
  const station = name(leg.stationId);
  if (leg.kind === 'entrance') return `Step-free entrance at ${station} (${liftCount(leg.lifts.length)})`;
  if (leg.kind === 'exit') return `Step-free exit at ${station} (${liftCount(leg.lifts.length)})`;
  return `Step-free change at ${station} to the ${LINE_NAMES[leg.toLine!]} (${liftCount(leg.lifts.length)})`;
}
