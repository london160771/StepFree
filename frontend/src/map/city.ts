/**
 * The London backdrop: real central London from OpenStreetMap, warped so each station's real
 * location sits on its schematic position, rendered as 2.5D images by scripts/build-city.mjs.
 * CITY_AREA is the part of the map's viewBox those images cover (the build script reads it here).
 */
export const CITY_AREA = { x: -420, y: -220, w: 1320, h: 1340 };

export const CITY_IMAGES = {
  desktop: '/city/london-desktop.webp',
  mobile: '/city/london-mobile.webp',
};
