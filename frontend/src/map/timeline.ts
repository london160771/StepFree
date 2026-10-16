// Shared timings for the opening sequence.

/** Intro timeline (milliseconds from first paint unless noted). */
export const INTRO = {
  /** Photo + brand phase; the map reveal starts after this. */
  photoMs: 3000,
  /** Overlay removed this long after the reveal starts (by timer, never by animation). */
  overlayMs: 1800,
  /** Skip button appears after this. */
  skipAfterMs: 700,
  /** Seconds after the reveal starts that the header, mode switch and route sheet come in. */
  controls: 1.3,
};

/** Map reveal, in seconds after the reveal starts: city, then network, then stations. */
export const REVEAL = {
  roads: 0,
  farBlocks: 0.1,
  nearBlocks: 0.25,
  network: 0.7,
  stations: 0.95,
  trains: 1.9,
} as const;
