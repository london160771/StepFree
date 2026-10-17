import type { Station } from './types.js';

/** Lower-case, accent- and punctuation-free form used to match station names typed in different ways. */
export function stationKey(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['’`]s\b/g, '')
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(london )?underground\b|\btube\b|\bstation\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const EXTRA_ALIASES: Record<string, string[]> = {
  KGX: ['kings cross', 'kings cross st pancras', 'st pancras', 'kings cross and st pancras', 'king cross'],
  SJP: ['st james park', 'saint james park', 'st jamess park'],
  LST: ['liverpool st'],
  TCR: ['tottenham court rd'],
  CAN: ['canary wharf'],
  CWR: ['canada water'],
  PAD: ['paddington'],
};

/** Names that resolve to a station besides its canonical name. Unknown names never match anything. */
export function stationAliases(station: Pick<Station, 'id' | 'name'>): string[] {
  const own = stationKey(station.name);
  return [...new Set([own, ...(EXTRA_ALIASES[station.id] ?? [])])];
}
