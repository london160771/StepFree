import { readFileSync } from 'node:fs';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStyle, pruneStyle, resetStyleCache, STYLE_URL, VECTOR_SOURCE } from './style';

const layer = (l: object) => l as LayerSpecification;
const baseStyle = (): StyleSpecification => ({
  version: 8,
  sprite: 'https://example.test/sprites/x',
  glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf',
  sources: { ne2_shaded: { type: 'raster', tiles: ['https://example.test/{z}/{x}/{y}.png'] }, [VECTOR_SOURCE]: { type: 'vector', url: 'https://example.test/planet' } },
  layers: [
    layer({ id: 'background', type: 'background' }),
    layer({ id: 'water', type: 'fill', source: VECTOR_SOURCE, 'source-layer': 'water' }),
    layer({ id: 'park', type: 'fill', source: VECTOR_SOURCE, 'source-layer': 'park' }),
    layer({ id: 'building', type: 'fill', source: VECTOR_SOURCE, 'source-layer': 'building' }),
    layer({ id: 'landcover_glacier', type: 'fill', source: VECTOR_SOURCE, 'source-layer': 'landcover' }),
    layer({ id: 'aeroway-area', type: 'fill', source: VECTOR_SOURCE, 'source-layer': 'aeroway' }),
    layer({ id: 'boundary_2', type: 'line', source: VECTOR_SOURCE, 'source-layer': 'boundary' }),
    layer({ id: 'highway_minor', type: 'line', source: VECTOR_SOURCE, 'source-layer': 'transportation' }),
    layer({ id: 'highway-name-major', type: 'symbol', source: VECTOR_SOURCE, 'source-layer': 'transportation_name', layout: { 'text-field': '{name}' } }),
    layer({ id: 'water_name_line_label', type: 'symbol', source: VECTOR_SOURCE, 'source-layer': 'water_name', layout: { 'text-field': '{name}' } }),
    layer({ id: 'highway-shield-non-us', type: 'symbol', source: VECTOR_SOURCE, 'source-layer': 'transportation_name', layout: { 'icon-image': 'shield' } }),
    layer({ id: 'label_city', type: 'symbol', source: VECTOR_SOURCE, 'source-layer': 'place', layout: { 'text-field': '{name}' } }),
    layer({ id: 'airport', type: 'symbol', source: VECTOR_SOURCE, 'source-layer': 'aerodrome_label', layout: { 'icon-image': 'airport' } }),
  ],
});
const ids = (style: StyleSpecification) => style.layers.map((l) => l.id);

describe('pruneStyle', () => {
  it('keeps what the StepFree map needs: ground, water, parks, roads, road and river names', () => {
    expect(ids(pruneStyle(baseStyle()))).toEqual(['background', 'water', 'park', 'highway_minor', 'highway-name-major', 'water_name_line_label']);
  });

  it('removes labels, shields, airports, boundaries and the flat building fill', () => {
    const kept = new Set(ids(pruneStyle(baseStyle())));
    for (const id of ['building', 'landcover_glacier', 'aeroway-area', 'boundary_2', 'highway-shield-non-us', 'label_city', 'airport']) expect(kept.has(id), id).toBe(false);
  });

  it('always keeps the vector source the 3D buildings are drawn from, and drops sources nothing uses', () => {
    const pruned = pruneStyle(baseStyle());
    expect(Object.keys(pruned.sources)).toEqual([VECTOR_SOURCE]);
    const onlyBackground: StyleSpecification = { ...baseStyle(), layers: [layer({ id: 'background', type: 'background' })] };
    expect(Object.keys(pruneStyle(onlyBackground).sources)).toContain(VECTOR_SOURCE);
  });

  it('drops the sprite when no icon layer is left, and keeps it if one is', () => {
    expect(pruneStyle(baseStyle()).sprite).toBeUndefined();
    const withIcon = baseStyle();
    withIcon.layers.push(layer({ id: 'highway-name-icon', type: 'symbol', source: VECTOR_SOURCE, 'source-layer': 'transportation_name', layout: { 'icon-image': 'x' } }));
    expect(pruneStyle(withIcon).sprite).toBe('https://example.test/sprites/x');
  });

  it('keeps the glyph URL for the road-name labels that remain', () => {
    expect(pruneStyle(baseStyle()).glyphs).toContain('{fontstack}');
  });

  it('does not modify its input, and copes with a style that lacks the layers it would remove', () => {
    const style = baseStyle();
    const before = JSON.stringify(style);
    pruneStyle(style);
    expect(JSON.stringify(style)).toBe(before);
    expect(ids(pruneStyle({ ...style, layers: [layer({ id: 'water', type: 'fill', source: VECTOR_SOURCE, 'source-layer': 'water' })] }))).toEqual(['water']);
  });

  it('prunes a snapshot of the real Positron layer ids by category, not by position', () => {
    const real = [
      'background:background',
      'park:fill',
      'water:fill',
      'landcover_ice_shelf:fill',
      'building:fill',
      'highway_minor:line',
      'highway_major_inner:line',
      'railway:line',
      'boundary_3:line',
      'highway-name-minor:symbol',
      'highway-shield-us-interstate:symbol',
      'label_town:symbol',
      'label_country_1:symbol',
    ];
    const layers = real.map((entry) => {
      const [id, type] = entry.split(':');
      const sourceLayer = id.startsWith('boundary') ? 'boundary' : id.startsWith('highway-name') || id.startsWith('highway-shield') ? 'transportation_name' : 'x';
      return layer({ id, type, ...(type === 'background' ? {} : { source: VECTOR_SOURCE, 'source-layer': sourceLayer }) });
    });
    expect(ids(pruneStyle({ ...baseStyle(), layers }))).toEqual(['background', 'park', 'water', 'highway_minor', 'highway_major_inner', 'railway', 'highway-name-minor']);
  });

  it('is a pure style transform: it does not load MapLibre at runtime or create a map', () => {
    const source = readFileSync(new URL('./style.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/import type \{[^}]*\} from 'maplibre-gl'/);
    expect(source.replace(/import type[^;]*;/g, '')).not.toContain("'maplibre-gl'");
    expect(source).not.toMatch(/new (maplibregl\.)?Map\(/);
  });
});

describe('loadStyle', () => {
  beforeEach(() => resetStyleCache());

  it('fetches and prunes once, however many callers ask (the intro preload and the map share one request)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(baseStyle()), { status: 200 }));
    const [a, b] = await Promise.all([loadStyle(fetchImpl as unknown as typeof fetch), loadStyle(fetchImpl as unknown as typeof fetch)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(STYLE_URL);
    expect(a).toBe(b);
    expect(a.layers.some((l) => l.id === 'building')).toBe(false);
  });

  it('forgets a failed request so the map can try again, and reports the failure so the app falls back', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 503 }));
    await expect(loadStyle(failing as unknown as typeof fetch)).rejects.toThrow(/503/);
    const working = vi.fn(async () => new Response(JSON.stringify(baseStyle()), { status: 200 }));
    await expect(loadStyle(working as unknown as typeof fetch)).resolves.toBeDefined();
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    resetStyleCache();
    await expect(loadStyle(offline as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe('Map startup wiring', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const homeStart = app.indexOf('function MapHome');
  const home = app.slice(homeStart);

  it('starts loading the map code and style only on the map page, once, while the intro plays', () => {
    expect(home).toContain("void import('./map/LondonMap')");
    expect(app.slice(0, homeStart)).not.toContain("void import('./map/LondonMap')");
    expect(home).toContain('loadStyle()');
  });

  it('keeps the schematic map underneath until 3D is ready, and for good if 3D fails', () => {
    expect(home).toContain('ready3d');
    expect(home).toContain('schematicLive');
    expect(home).toContain('(!map3d || schematicLive)');
    // Not mounted while the intro photo is up, so it never competes with the 3D map's start-up.
    expect(home).toMatch(/if \(stage !== 'photo'\) setSchematicLive\(true\)/);
    expect(home).toContain('setMap3d(false)');
  });

  it('declares the OpenFreeMap origin early, and nothing else', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain('rel="preconnect" href="https://tiles.openfreemap.org"');
    expect(html).toContain('rel="dns-prefetch" href="https://tiles.openfreemap.org"');
    expect(html.match(/rel="(preconnect|dns-prefetch)"/g)).toHaveLength(2);
  });
});
