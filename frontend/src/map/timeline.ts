// Shared timings for the opening sequence.

/** Intro timeline (milliseconds from first paint unless noted). */
export const INTRO = {
  /** Photo + brand phase; the map reveal starts after this. */
  photoMs: 3600,
  /** Overlay removed this long after the reveal starts (by timer, never by animation). */
  overlayMs: 1600,
  /** Skip button appears after this. */
  skipAfterMs: 700,
  /** Seconds after the reveal starts that the header, mode switch and route sheet come in. */
  controls: 1.0,
};

/** Map reveal, in seconds after the reveal starts: city, then network, then stations. */
export const REVEAL = {
  city: 0,
  network: 0.7,
  stations: 0.95,
  trains: 1.9,
} as const;
