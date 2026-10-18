import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILDING_MIN_ZOOM, MIN_BUILDING_HEIGHT, chooseView, supportsBuildings, viewsFor } from './camera';

describe('overview and route views', () => {
  it('the overview is flat on desktop and phone: no tilt, so nothing 3D is needed to read it', () => {
    expect(viewsFor(false).overview.pitch).toBe(0);
    expect(viewsFor(true).overview.pitch).toBe(0);
  });

  it('a route that gets 3D is tilted: about 56 degrees on desktop and 42 on phones', () => {
    expect(viewsFor(false).route3d.pitch).toBe(56);
    expect(viewsFor(true).route3d.pitch).toBe(42);
  });
});

describe('when buildings are used', () => {
  it('only from the zoom where OpenStreetMap building data exists', () => {
    expect(BUILDING_MIN_ZOOM).toBe(13);
    expect(supportsBuildings(13)).toBe(true);
    expect(supportsBuildings(14.6)).toBe(true);
    expect(supportsBuildings(12.99)).toBe(false);
    expect(supportsBuildings(undefined)).toBe(false);
    expect(supportsBuildings(Number.NaN)).toBe(false);
  });

  it('no route: the flat overview, no buildings, whatever the zoom', () => {
    for (const compact of [false, true]) {
      expect(chooseView(false, 14, compact)).toEqual({ view: viewsFor(compact).overview, buildings: false });
      expect(chooseView(false, undefined, compact).buildings).toBe(false);
    }
  });

  it('a route that naturally fits at building zoom gets the tilted view and buildings', () => {
    expect(chooseView(true, 14.1, false)).toEqual({ view: viewsFor(false).route3d, buildings: true });
    expect(chooseView(true, 13.2, true)).toEqual({ view: viewsFor(true).route3d, buildings: true });
  });

  it('a route too wide for building data stays flat, and is never zoomed in artificially to force 3D', () => {
    expect(chooseView(true, 12.4, false)).toEqual({ view: viewsFor(false).overview, buildings: false });
    expect(chooseView(true, undefined, true)).toEqual({ view: viewsFor(true).overview, buildings: false });
  });

  it('keeps the filter that skips the smallest buildings, stricter on phones', () => {
    expect(MIN_BUILDING_HEIGHT.desktop).toBe(5);
    expect(MIN_BUILDING_HEIGHT.phone).toBe(7);
    expect(MIN_BUILDING_HEIGHT.phone).toBeGreaterThan(MIN_BUILDING_HEIGHT.desktop);
  });
});

describe('the map component no longer fakes building zoom for the whole network', () => {
  const source = readFileSync(new URL('./LondonMap.tsx', import.meta.url), 'utf8');

  it('has no oversized canvas, no scaled pixel ratio and no scaled UI', () => {
    for (const gone of ['uiScaleFor', 'MAX_UI_SCALE', 'BUILDING_ZOOM', 'kRef', 'uiScale', 'setPixelRatio', 'scale(${1 / ', 'landingStations', 'INTRO_CAMERA']) {
      expect(source, gone).not.toContain(gone);
    }
    expect(source).not.toMatch(/pixelRatio:/);
  });

  it('is created already framed on the whole network, flat, by the real viewport', () => {
    expect(source).toContain('bounds: boundsOf([...coords.values()])');
    expect(source).toContain('...viewsFor(compactRef.current).overview');
    expect(source).toContain('fitBoundsOptions');
  });

  it('adds the building layer hidden, and shows it only through setBuildings', () => {
    expect(source).toMatch(/id: 'sf-buildings'[\s\S]*layout: \{ visibility: 'none' \}/);
    expect(source).toContain('setBuildings(map, buildings, reduceMotion)');
    expect(source).toContain('chooseView(route !== null, natural, compact)');
  });

  it('measures the natural route fit in the real viewport before deciding on 3D', () => {
    expect(source).toContain('map.cameraForBounds(bounds, options(views.route3d))');
    expect(source).toContain('map.fitBounds(bounds,');
    expect(source).not.toMatch(/\bzoom:\s*BUILDING/);
  });

  it('is ready when the flat overview has rendered, not when buildings have, and has no 4-second 3D cap', () => {
    expect(source).toContain("created.once('render', announceReady)");
    expect(source).not.toContain('READY_TIMEOUT_MS');
    expect(source).not.toContain('3d-ready');
    // 'idle' is only used to time the route-focused render, never to decide when the map is shown.
    expect(source).not.toMatch(/once\('idle', *(announce|fire)/);
    expect(source).toContain('READY_STUCK_MS = 10_000');
    // Announced from the load handler, before any route or building exists.
    const load = source.slice(source.indexOf("created.on('load'"), source.indexOf("created.on('load'") + 500);
    expect(load).toContain('announceReady');
    expect(load).not.toContain('setBuildings');
  });

  it('draws the route without waiting for buildings, and re-evaluates 3D whenever the route changes', () => {
    const cameraEffect = source.slice(source.indexOf('// Camera and buildings.'), source.indexOf('// Station marker states'));
    expect(cameraEffect).toContain('[ready, fitKey,');
    expect(cameraEffect).toContain('setBuildings(map, buildings, reduceMotion)');
    // The route's own layer is fed by a separate effect that does not depend on the camera or buildings.
    expect(source).toContain("(map.getSource('sf-route') as GeoJSONSource).setData");
  });

  it('keeps the map instance for resets: one creation effect, never rebuilt on route changes', () => {
    expect(source.match(/new maplibregl\.Map\(/g)).toHaveLength(1);
    expect(source).toContain('// The map is created once; later prop changes are applied by the effects below.');
  });

  it('keeps stations and the route above the buildings (layers added after the buildings; markers are DOM)', () => {
    expect(source.indexOf('addBuildings(created')).toBeLessThan(source.indexOf('addOverlays(created'));
    expect(source).toContain('new maplibregl.Marker({ element: el })');
  });
});
