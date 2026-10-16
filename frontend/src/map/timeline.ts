// Shared timings for the opening sequence. TransitMap's REVEAL runs from when the map mounts.

/** Intro timeline in seconds/milliseconds; the map reveal in TransitMap runs alongside it. */
export const INTRO = {
  /** When the wordmark and tagline start to recede. */
  heroMs: 1250,
  /** When the header, mode switch and route sheet come in. */
  controls: 1.45,
  /** When everything has settled and the intro state can be dropped. */
  settledMs: 2600,
};

/**
 * Opening reveal timeline (seconds from page load). City first, then the network draws in,
 * then stations; ambient trains start once everything has settled.
 */
export const REVEAL = {
  roads: 0.1,
  farBlocks: 0.2,
  nearBlocks: 0.35,
  network: 0.95,
  stations: 1.2,
  trains: 2.3,
} as const;
