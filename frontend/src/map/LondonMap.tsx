import { useReducedMotion } from 'framer-motion';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
// Bundle MapLibre's web worker with Vite and tell MapLibre where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge, Route, Station } from '../api';
import { easeInOut, journeySecondsGeo, pointAlong, routeDrawSecondsGeo, type LngLat } from './geo';
import { LINE_COLORS } from './layout';

maplibregl.setWorkerUrl(workerUrl);

/** OpenFreeMap's calm Positron style: OpenStreetMap vector tiles, no API key. */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const ROUTE_COLOR = '#111827';

/**
 * Phones render the map 1.8x larger and scale it down, so the whole network fits while the camera stays
 * at tile zoom 13, where OpenStreetMap buildings exist. Markers scale back up to stay readable.
 */
const UI_SCALE = 1.8;

/** Opening shot: low over the South Bank looking across the Thames at Westminster, like the intro photo. */
const INTRO_CAMERA = { center: [-0.1197, 51.5003] as LngLat, zoom: 16.4, pitch: 70, bearing: -74 };
/** Keep the camera over central London. */
const LONDON_BOUNDS: [LngLat, LngLat] = [
  [-0.26, 51.45],
  [0.01, 51.56],
];

type Side = 'left' | 'right' | 'below' | 'above';
/** Which side of its marker each station label sits on, per camera (desktop / phone). */
const LABEL_SIDE: Record<string, [Side, Side]> = {
  VIC: ['left', 'left'],
  GPK: ['above', 'left'],
  SJP: ['right', 'right'],
  WSM: ['above', 'above'],
  WLO: ['below', 'below'],
  SWK: ['below', 'below'],
  LNB: ['right', 'left'],
};

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Props {
  stations: Station[];
  edges: GraphEdge[];
  route: Route | null;
  fadingRoute: Route | null;
  outageStationIds: string[];
  /** Live Mode: the user's real location. */
  userLocation: { lat: number; lon: number } | null;
  journeyKey: string;
  entrance: 'none' | 'hidden' | 'reveal';
  compact: boolean;
  padding: Padding;
  /** Called if the map cannot load (offline, blocked tiles, no WebGL); the app falls back to the schematic map. */
  onFail: () => void;
  /** Called once the city has loaded, so the intro can hand over to it. */
  onReady?: () => void;
}

const empty = { type: 'FeatureCollection' as const, features: [] };
const line = (coords: LngLat[]) => ({
  type: 'FeatureCollection' as const,
  features: coords.length > 1 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: coords } }] : [],
});

export default function LondonMap(props: Props) {
  const { stations, edges, route, fadingRoute, outageStationIds, userLocation, journeyKey, entrance, compact, padding, onFail, onReady } = props;
  const reduceMotion = useReducedMotion() ?? false;
  const staged = entrance !== 'none' && !reduceMotion;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const stationMarkers = useRef(new Map<string, Marker>());
  const [ready, setReady] = useState(false);
  const settled = useRef(false);
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const coords = useMemo(() => new Map(stations.map((s) => [s.id, [s.lon, s.lat] as LngLat])), [stations]);
  // Look east along the Thames toward the City: Victoria near the camera, London Bridge in the distance.
  // Phones use a flatter, wider view so the whole network fits above the route sheet.
  const view = compact ? { zoom: 13.0, pitch: 42, bearing: 50 } : { zoom: 13.45, pitch: 58, bearing: 30 };
  const k = compact ? UI_SCALE : 1;
  const mapPadding = { top: padding.top * k, right: padding.right * k, bottom: padding.bottom * k, left: padding.left * k };
  const centre = useMemo(() => {
    const all = [...coords.values()];
    const lngs = all.map((c) => c[0]);
    const lats = all.map((c) => c[1]);
    return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2] as LngLat;
  }, [coords]);

  // Create the map once. The style is fetched first: if that fails (offline, blocked), fall back at once
  // rather than showing an empty canvas. Individual tile errors later are tolerated.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      let style: maplibregl.StyleSpecification;
      try {
        const response = await fetch(STYLE_URL);
        if (!response.ok) throw new Error(`Style request failed: ${response.status}`);
        style = await response.json();
      } catch {
        if (!cancelled) onFailRef.current();
        return;
      }
      if (cancelled || !container.current) return;
      try {
        map = new maplibregl.Map({
          container: container.current,
          style,
          ...INTRO_CAMERA,
          maxBounds: LONDON_BOUNDS,
          minZoom: 11.5,
          maxZoom: 17.5,
          maxPitch: 72,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          // Phones show the same credit in the route sheet instead (see App).
          attributionControl: compact ? false : { compact: true },
          fadeDuration: 150,
          // On phones the oversized map uses a lower pixel ratio, so it costs no more to draw than a normal one.
          ...(compact ? { pixelRatio: Math.min(window.devicePixelRatio || 1, 2) / UI_SCALE } : {}),
        });
      } catch {
        // No WebGL.
        onFailRef.current();
        return;
      }
      const created = map;
      created.touchZoomRotate.disableRotation();
      created.keyboard.disableRotation();
      mapRef.current = created;
      created.on('load', () => {
        styleBasemap(created, staged ? 0.2 : 1);
        addOverlays(created, edges, coords, staged);
        setReady(true);
        onReadyRef.current?.();
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Station markers (screen-facing, always above buildings).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    stations.forEach((station, i) => {
      const el = document.createElement('div');
      el.className = `sf-marker sf-station sf-label-${LABEL_SIDE[station.id]?.[compact ? 1 : 0] ?? 'right'}${station.stepFreeStreetAccess ? '' : ' sf-station-pass'}`;
      el.style.setProperty('--sf-delay', `${staged ? 1.25 + i * 0.07 : 0}s`);
      el.innerHTML = `<div class="sf-ui"><span class="sf-dot"></span><span class="sf-name">${station.name}${
        station.stepFreeStreetAccess ? '' : '<small>not step-free · pass through</small>'
      }</span></div>`;
      if (!staged) el.classList.add('sf-shown');
      stationMarkers.current.set(station.id, new maplibregl.Marker({ element: el }).setLngLat(coords.get(station.id)!).addTo(map));
    });
    const markers = stationMarkers.current;
    return () => {
      markers.forEach((m) => m.remove());
      markers.clear();
    };
  }, [ready, stations, coords, staged, compact]);

  // Camera: hold the Westminster shot during the intro, then settle into the StepFree view.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || entrance === 'hidden' || settled.current) return;
    settled.current = true;
    const animated = staged && entrance === 'reveal';
    map.easeTo({ center: centre, ...view, padding: mapPadding, duration: animated ? 2800 : 0, easing: (t) => 1 - Math.pow(1 - t, 3) });
    if (animated) {
      riseBuildings(map, 0.2, 1, 2200);
      for (const id of ['sf-glow', 'sf-network']) map.setPaintProperty(id, 'line-opacity', id === 'sf-glow' ? 0.75 : 0.95);
      stationMarkers.current.forEach((m) => m.getElement().classList.add('sf-shown'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, entrance]);

  // Keep the StepFree view framed if the layout changes (rotation, desktop/phone switch).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !settled.current) return;
    map.easeTo({ center: centre, ...view, padding: mapPadding, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, padding.top, padding.left, padding.bottom, padding.right]);

  // Station marker states for the current route and outage.
  useEffect(() => {
    if (!ready) return;
    const ends = route ? [route.stations[0], route.stations.at(-1)] : [];
    stationMarkers.current.forEach((marker, id) => {
      const el = marker.getElement();
      el.classList.toggle('sf-on-route', route?.stations.includes(id) ?? false);
      el.classList.toggle('sf-end', ends.includes(id));
      el.classList.toggle('sf-outage', outageStationIds.includes(id));
    });
    mapRef.current?.setPaintProperty('sf-network', 'line-opacity', route ? 0.45 : 0.95);
  }, [ready, route, outageStationIds]);

  const routeCoords = useMemo(() => (route ? route.stations.map((id) => coords.get(id)!) : null), [route, coords]);
  const drawSeconds = routeCoords ? routeDrawSecondsGeo(routeCoords) : 0;

  // Draw the FalkorDB route progressively: the line is set once, then revealed with a line-gradient
  // on the main thread (no per-frame data updates for the map's worker).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('sf-route') as GeoJSONSource).setData(routeCoords ? line(routeCoords) : empty);
    if (!routeCoords) return;
    if (reduceMotion) {
      revealRoute(map, 1);
      return;
    }
    revealRoute(map, 0);
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / (drawSeconds * 1000), 1);
      revealRoute(map, easeInOut(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, routeCoords, journeyKey, drawSeconds, reduceMotion]);

  // The replaced route fades to a quiet grey trace.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const source = map.getSource('sf-route-old') as GeoJSONSource;
    if (!fadingRoute) {
      source.setData(empty);
      return;
    }
    source.setData(line(fadingRoute.stations.map((id) => coords.get(id)!)));
    map.setPaintProperty('sf-route-old', 'line-opacity', 0.9);
    const timer = setTimeout(() => map.setPaintProperty('sf-route-old', 'line-opacity', 0.35), 60);
    return () => clearTimeout(timer);
  }, [ready, fadingRoute, coords]);

  // Lift icons: on the route once the line reaches them, and the unavailable lift at once.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const markers: Marker[] = [];
    const add = (stationId: string, unavailable: boolean, delay: number) => {
      const el = document.createElement('div');
      el.className = 'sf-marker';
      el.title = unavailable ? 'Lift unavailable' : 'Lift on this route';
      el.innerHTML = `<div class="sf-ui"><div class="sf-lift${unavailable ? ' sf-lift-out' : ''}" style="--sf-delay:${delay}s"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 8.5 10 4.5l3.5 4z"/><path d="M6.5 11.5 10 15.5l3.5-4z"/>${
        unavailable ? '<path d="M3 17 17 3" class="sf-slash"/>' : ''
      }</svg></div></div>`;
      markers.push(new maplibregl.Marker({ element: el }).setLngLat(coords.get(stationId)!).addTo(map));
    };
    const withLifts = new Set<string>();
    for (const leg of route?.legs ?? []) if (leg.type === 'transfer' && leg.lifts.length > 0) withLifts.add(leg.stationId);
    withLifts.forEach((id) => !outageStationIds.includes(id) && add(id, false, reduceMotion ? 0 : drawSeconds * 0.8));
    outageStationIds.forEach((id) => {
      add(id, true, 0);
      const pulse = document.createElement('div');
      pulse.className = 'sf-marker';
      pulse.innerHTML = '<div class="sf-ui"><div class="sf-pulse"></div></div>';
      markers.push(new maplibregl.Marker({ element: pulse }).setLngLat(coords.get(id)!).addTo(map));
    });
    return () => markers.forEach((m) => m.remove());
  }, [ready, route, journeyKey, outageStationIds, coords, drawSeconds, reduceMotion]);

  // The wheelchair-user marker: travels the returned route slowly, or waits at the user's location.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const user: LngLat | null = userLocation ? [userLocation.lon, userLocation.lat] : null;
    const path = routeCoords ? (user ? [user, ...routeCoords] : routeCoords) : user ? [user] : null;
    if (!path) return;
    const el = document.createElement('div');
    el.className = 'sf-marker';
    el.title = 'Wheelchair user';
    el.innerHTML = `<div class="sf-ui"><div class="sf-figure"><svg viewBox="-14 -14 28 28" aria-hidden="true"><circle r="12.5" class="sf-figure-disc"/><circle cx="-0.5" cy="-7.2" r="2.2" class="sf-figure-ink"/><path d="M -1.5 -4.2 L -1.5 1.6 L 4 1.6 L 6.2 6.2" class="sf-figure-line"/><path d="M -1.5 -1.6 L 3 -1.6" class="sf-figure-line"/><circle cx="-1.8" cy="4.4" r="4.2" class="sf-figure-line"/></svg></div></div>`;
    const marker = new maplibregl.Marker({ element: el }).setLngLat(path[0]).addTo(map);
    if (path.length === 1 || reduceMotion) {
      marker.setLngLat(path[path.length - 1]);
      return () => {
        marker.remove();
      };
    }
    let frame = 0;
    const duration = journeySecondsGeo(path) * 1000;
    const start = performance.now() + (drawSeconds + 0.3) * 1000;
    const tick = (now: number) => {
      const t = Math.min(Math.max((now - start) / duration, 0), 1);
      marker.setLngLat(pointAlong(path, easeInOut(t)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      marker.remove();
    };
  }, [ready, routeCoords, journeyKey, userLocation, drawSeconds, reduceMotion]);

  // Subtle trains: one small marker per line gliding slowly back and forth. Screen-facing DOM markers,
  // so they never trigger map data updates; they step back while a route is shown.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || reduceMotion || entrance === 'hidden') return;
    const lines = new Map<string, LngLat[]>();
    for (const edge of edges) {
      if (edge.type !== 'RIDE' || !edge.line) continue;
      const from = coords.get(edge.from.split(':')[0])!;
      const to = coords.get(edge.to.split(':')[0])!;
      const pts = lines.get(edge.line) ?? [];
      if (pts.length === 0) pts.push(from, to);
      else if (pts.at(-1) === from && !pts.includes(to)) pts.push(to);
      else if (pts[0] === to && !pts.includes(from)) pts.unshift(from);
      lines.set(edge.line, pts);
    }
    const trains = [...lines.entries()].map(([line, pts], i) => {
      const el = document.createElement('div');
      el.className = 'sf-marker';
      el.innerHTML = `<div class="sf-ui"><div class="sf-train" style="--sf-line:${LINE_COLORS[line as keyof typeof LINE_COLORS]}"></div></div>`;
      return { pts, period: 26 + pts.length * 6, phase: i * 0.37, marker: new maplibregl.Marker({ element: el }).setLngLat(pts[0]).addTo(map) };
    });
    let frame = 0;
    const start = performance.now() + (staged ? 1800 : 0);
    const tick = (now: number) => {
      const seconds = Math.max(0, now - start) / 1000;
      for (const train of trains) {
        const cycle = ((seconds / train.period + train.phase) % 1) * 2;
        train.marker.setLngLat(pointAlong(train.pts, easeInOut(cycle <= 1 ? cycle : 2 - cycle)));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      trains.forEach((t) => t.marker.remove());
    };
  }, [ready, edges, coords, reduceMotion, entrance, staged]);

  // Trains quieten while a route is on screen.
  useEffect(() => {
    container.current?.classList.toggle('sf-route-active', route !== null);
  }, [route]);

  const names = stations.map((s) => s.name).join(', ');
  return (
    <div
      ref={container}
      className={compact ? 'sf-compact' : 'h-full w-full'}
      style={compact ? { width: `${UI_SCALE * 100}%`, height: `${UI_SCALE * 100}%`, transform: `scale(${1 / UI_SCALE})`, transformOrigin: '0 0', ['--sf-ui' as string]: UI_SCALE } : undefined}
      role="img"
      aria-label={
        route
          ? `3D map of central London. Step-free route: ${route.stations.map((id) => stations.find((s) => s.id === id)?.name).join(', ')}.`
          : `3D map of central London showing the supported stations: ${names}.`
      }
    />
  );
}

/** Calm the Positron basemap and add London-toned 3D buildings from OpenStreetMap heights. */
function styleBasemap(map: MapLibreMap, heightFactor: number) {
  const set = (layer: string, prop: string, value: Parameters<MapLibreMap['setPaintProperty']>[2]) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop as Parameters<MapLibreMap['setPaintProperty']>[1], value);
  };
  set('background', 'background-color', '#f0ede6');
  set('water', 'fill-color', '#b7d1df');
  set('park', 'fill-color', '#d2e3c3');
  set('park', 'fill-opacity', 0.95);
  set('landcover_wood', 'fill-color', '#c9ddb8');
  set('landuse_residential', 'fill-opacity', 0.35);
  set('highway_minor', 'line-color', '#fbfaf6');
  set('highway_major_inner', 'line-color', '#ffffff');
  set('highway_major_casing', 'line-color', '#dcd6ca');
  for (const id of ['highway-name-path', 'highway-name-minor', 'highway-name-major']) {
    if (map.getLayer(id)) map.setPaintProperty(id, 'text-opacity', 0.55);
  }
  // Station labels carry the story: hide area names, road shields and the flat building layer.
  for (const id of ['building', 'water_name_point_label', 'label_other', 'label_village', 'label_town', 'label_city', 'label_city_capital', 'label_state', 'highway-shield-non-us', 'highway-shield-us-interstate', 'road_shield_us', 'airport']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  }

  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  map.addLayer(
    {
      id: 'sf-buildings',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        // Portland stone and London stock brick for most streets, cooler glass for taller towers.
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'render_height'], 12],
          0,
          '#f1ece3',
          18,
          '#ebe3d6',
          40,
          '#e2ddd5',
          120,
          '#d9dee4',
        ],
        'fill-extrusion-height': heightExpression(heightFactor),
        'fill-extrusion-base': ['*', ['coalesce', ['get', 'render_min_height'], 0], heightFactor],
        'fill-extrusion-opacity': 0.82,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    firstSymbol,
  );
  map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.3, position: [1.3, 210, 35] });
}

function heightExpression(factor: number) {
  return ['*', ['coalesce', ['get', 'render_height'], 10], factor] as maplibregl.ExpressionSpecification;
}

/** Buildings rise gently from low to full height. */
function riseBuildings(map: MapLibreMap, from: number, to: number, ms: number) {
  const start = performance.now();
  const tick = (now: number) => {
    if (!map.getLayer('sf-buildings')) return;
    const t = Math.min((now - start) / ms, 1);
    const k = from + (to - from) * (1 - Math.pow(1 - t, 3));
    map.setPaintProperty('sf-buildings', 'fill-extrusion-height', heightExpression(k));
    map.setPaintProperty('sf-buildings', 'fill-extrusion-base', ['*', ['coalesce', ['get', 'render_min_height'], 0], k]);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** FalkorDB network and route layers, drawn above the city. */
function addOverlays(map: MapLibreMap, edges: GraphEdge[], coords: Map<string, LngLat>, staged: boolean) {
  const seen = new Set<string>();
  const features = [];
  for (const edge of edges) {
    if (edge.type !== 'RIDE' || !edge.line) continue;
    const [a, b] = [edge.from.split(':')[0], edge.to.split(':')[0]].sort();
    const key = `${edge.line}:${a}-${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    features.push({
      type: 'Feature' as const,
      properties: { color: LINE_COLORS[edge.line] },
      geometry: { type: 'LineString' as const, coordinates: [coords.get(a)!, coords.get(b)!] },
    });
  }
  map.addSource('sf-network', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  map.addSource('sf-route', { type: 'geojson', data: empty, lineMetrics: true });
  map.addSource('sf-route-old', { type: 'geojson', data: empty });
  const width = (base: number) => ['interpolate', ['exponential', 1.6], ['zoom'], 12, base * 0.55, 14, base, 16.5, base * 2.1] as maplibregl.ExpressionSpecification;
  const fade = { duration: 900, delay: staged ? 900 : 0 };

  // A soft light band under the network calms the buildings around it.
  map.addLayer({
    id: 'sf-glow',
    type: 'line',
    source: 'sf-network',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fbfaf6', 'line-width': width(34), 'line-blur': width(12), 'line-opacity': staged ? 0 : 0.75, 'line-opacity-transition': fade },
  });
  map.addLayer({
    id: 'sf-network',
    type: 'line',
    source: 'sf-network',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': width(7), 'line-opacity': staged ? 0 : 0.95, 'line-opacity-transition': fade },
  });
  map.addLayer({
    id: 'sf-route-old',
    type: 'line',
    source: 'sf-route-old',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#64748b',
      'line-width': width(5),
      'line-dasharray': [0.4, 2.2],
      'line-opacity': 0.9,
      'line-opacity-transition': { duration: 1200, delay: 0 },
    },
  });
  map.addLayer({
    id: 'sf-route-casing',
    type: 'line',
    source: 'sf-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-gradient': routeGradient('#ffffff', 0), 'line-width': width(15) },
  });
  map.addLayer({
    id: 'sf-route',
    type: 'line',
    source: 'sf-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-gradient': routeGradient(ROUTE_COLOR, 0), 'line-width': width(9) },
  });
}

/** Colour the first `progress` (0..1) of the route line and leave the rest transparent. */
function routeGradient(color: string, progress: number) {
  if (progress >= 1) return ['interpolate', ['linear'], ['line-progress'], 0, color, 1, color] as maplibregl.ExpressionSpecification;
  return ['step', ['line-progress'], color, Math.max(progress, 0.0001), 'rgba(0,0,0,0)'] as maplibregl.ExpressionSpecification;
}

function revealRoute(map: MapLibreMap, progress: number) {
  map.setPaintProperty('sf-route-casing', 'line-gradient', routeGradient('#ffffff', progress));
  map.setPaintProperty('sf-route', 'line-gradient', routeGradient(ROUTE_COLOR, progress));
}
