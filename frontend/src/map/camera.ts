/**
 * Camera and building rules for the map. Pure, so they can be tested without a map.
 *
 * StepFree starts as a flat, natural-fit overview of the supported network. A route that naturally fits at a zoom where
 * OpenStreetMap building data exists gets a tilted, 3D view of its own corridor; a route too wide for that stays flat.
 * Nothing is zoomed artificially and nothing is rendered city-wide.
 */

/** OpenStreetMap buildings only exist in vector tiles from zoom 13, so 3D needs at least this zoom. */
export const BUILDING_MIN_ZOOM = 13;

/** Buildings below this render height (metres; unknown heights count as 8) are not drawn: sheds and outbuildings, not the city. */
export const MIN_BUILDING_HEIGHT = { desktop: 5, phone: 7 } as const;

export interface View {
  pitch: number;
  bearing: number;
}

/**
 * Desktop looks north-up. Phones turn the network so its long east-west axis runs up the screen.
 * The overview is flat; a route that gets 3D is tilted a little less on phones.
 */
export function viewsFor(compact: boolean): { overview: View; route3d: View } {
  return compact
    ? { overview: { pitch: 0, bearing: 78 }, route3d: { pitch: 42, bearing: 78 } }
    : { overview: { pitch: 0, bearing: 0 }, route3d: { pitch: 56, bearing: -10 } };
}

/** Is there building data to draw at this zoom? */
export function supportsBuildings(zoom: number | null | undefined): boolean {
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= BUILDING_MIN_ZOOM;
}

/** The camera for a state of the app: flat overview without a route; for a route, 3D only if its natural fit is at building zoom. */
export function chooseView(hasRoute: boolean, naturalRouteZoom: number | null | undefined, compact: boolean): { view: View; buildings: boolean } {
  const { overview, route3d } = viewsFor(compact);
  if (hasRoute && supportsBuildings(naturalRouteZoom)) return { view: route3d, buildings: true };
  return { view: overview, buildings: false };
}
