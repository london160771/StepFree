import type { Leg, LineId } from '../api';
import { LINE_NAMES } from '../map/layout';

export const SAFETY_NOTE = 'based on currently available TfL accessibility data.';

const liftCount = (n: number) => (n === 0 ? 'level access' : n === 1 ? '1 lift' : `${n} lifts`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "District or Circle line" when several lines serve the same platforms, otherwise "Jubilee line". */
export function lineLabel(lines: LineId[]): string {
  const names = lines.map((l) => LINE_NAMES[l]);
  return names.length > 1 ? `${names.map((n) => n.replace(/ line$/, '')).join(' or ')} line` : names[0];
}

/** Plain-language description of one leg of the FalkorDB route. */
export function describeLeg(leg: Leg, name: (id: string) => string): string {
  if (leg.type === 'ride') {
    const end = name(leg.stations.at(-1)!);
    const passingSupported = leg.stations.slice(1, -1).map(name);
    const stops = leg.stations.length - 1 + leg.via.length;
    const parts = [...passingSupported, ...(leg.via.length > 0 ? [`${plural(leg.via.length, 'other stop')}`] : [])];
    const via = parts.length > 0 ? `, passing ${parts.join(', ')}` : '';
    return `${lineLabel(leg.lines)} to ${end}${via} (${plural(stops, 'stop')})`;
  }
  const station = name(leg.stationId);
  if (leg.kind === 'entrance') return `Step-free entrance at ${station} (${liftCount(leg.lifts.length)})`;
  if (leg.kind === 'exit') return `Step-free exit at ${station} (${liftCount(leg.lifts.length)})`;
  if (leg.fromLine && leg.fromLine === leg.toLine) return `Step-free change of platform at ${station} (${liftCount(leg.lifts.length)})`;
  return `Step-free change at ${station} to the ${LINE_NAMES[leg.toLine!]} (${liftCount(leg.lifts.length)})`;
}
