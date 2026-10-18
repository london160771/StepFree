import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

/** OpenFreeMap's calm Positron style: OpenStreetMap vector tiles, no API key. */
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** Road names and the river name stay: they are what makes the base map read as London. Every other label goes. */
const KEPT_SYMBOLS = /^(highway-name-|waterway_line_label$|water_name_line_label$)/;
/** Layers StepFree draws itself (the flat building fill becomes the 3D `sf-buildings` extrusion) or that never appear in central London. */
const DROPPED_IDS = new Set(['building', 'landcover_ice_shelf', 'landcover_glacier']);
const DROPPED_SOURCE_LAYERS = new Set(['aeroway', 'boundary']);
/** The vector source the 3D buildings are drawn from. Always kept. */
export const VECTOR_SOURCE = 'openmaptiles';

/**
 * The part of the base style StepFree actually shows: ground, water, parks, roads and railways, road and river names.
 * Place labels, shields, POIs, airports, boundaries and the flat building layer are removed before the map is created,
 * so MapLibre never builds, lays out or draws them. Layers are matched by id, type and source layer, never by position,
 * and anything the style no longer contains is simply skipped. Returns a new object; the input is not modified.
 */
export function pruneStyle(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.filter((layer) => keep(layer));
  const used = new Set(layers.flatMap((l) => ('source' in l && l.source ? [l.source] : [])));
  used.add(VECTOR_SOURCE);
  const sources = Object.fromEntries(Object.entries(style.sources).filter(([id]) => used.has(id)));
  const pruned: StyleSpecification = { ...style, layers, sources };
  // The sprite sheet only serves icon layers (shields, airports). With none left, skip downloading it.
  if (!layers.some((l) => l.layout && 'icon-image' in l.layout)) delete pruned.sprite;
  return pruned;
}

function keep(layer: LayerSpecification): boolean {
  if (layer.type === 'background') return true;
  if (DROPPED_IDS.has(layer.id)) return false;
  if ('source-layer' in layer && layer['source-layer'] && DROPPED_SOURCE_LAYERS.has(layer['source-layer'])) return false;
  if (layer.type === 'symbol') return KEPT_SYMBOLS.test(layer.id);
  return true;
}

let styleRequest: Promise<StyleSpecification> | undefined;

/**
 * The pruned base style. The request is shared: the app starts it while the intro photo is showing, and the map
 * reuses the same promise instead of fetching again. A failed request is forgotten so a later attempt can retry.
 */
export function loadStyle(fetchImpl: typeof fetch = fetch): Promise<StyleSpecification> {
  styleRequest ??= fetchImpl(STYLE_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Style request failed: ${response.status}`);
      return response.json() as Promise<StyleSpecification>;
    })
    .then(pruneStyle)
    .then((style) => {
      performance.mark('stepfree:style-ready');
      return style;
    })
    .catch((error) => {
      styleRequest = undefined;
      throw error;
    });
  return styleRequest;
}

/** For tests. */
export function resetStyleCache() {
  styleRequest = undefined;
}
