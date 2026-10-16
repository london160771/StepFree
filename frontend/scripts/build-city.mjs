/**
 * Builds the London city backdrop for the map: frontend/public/city/london-*.webp
 *
 * Real central London geometry (buildings, streets, parks, the Thames and its bridges) from
 * OpenStreetMap is warped with a thin-plate spline so each station's real location lands on its
 * schematic map position, then rendered as a calm 2.5D illustration (soft extrusion and shadows,
 * London stone/brick/slate roofs). Only the rendered images ship with the app; no OSM data is
 * bundled. Attribution: © OpenStreetMap contributors (ODbL), shown on the map and in the README.
 *
 * Usage: node scripts/build-city.mjs [path/to/overpass.json]
 *   Without a path, the data is downloaded from the Overpass API.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'public', 'city');

const BBOX = [51.47, -0.19, 51.53, -0.055];
const QUERY = `[out:json][timeout:180];
(
  way["building"](${BBOX});
  way["natural"="water"](${BBOX});
  relation["natural"="water"](${BBOX});
  way["leisure"~"park|garden"](${BBOX});
  relation["leisure"~"park|garden"](${BBOX});
  way["landuse"~"grass|recreation_ground"](${BBOX});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|pedestrian|living_street)$"](${BBOX});
);
out geom qt;`;

/** Map area covered by the backdrop, in the map's viewBox units, and output resolutions. */
const AREA = JSON.parse(
  readFileSync(join(root, 'src', 'map', 'city.ts'), 'utf8')
    .match(/CITY_AREA = (\{[^}]+\})/)[1]
    .replace(/(\w+):/g, '"$1":'),
);
const OUTPUTS = [
  { name: 'london-desktop', scale: 1.5, quality: 58 },
  { name: 'london-mobile', scale: 0.9, quality: 55 },
];

// ---------------------------------------------------------------------------------------------
// Inputs: station lat/lon from the backend network, schematic positions from the frontend layout.

const network = JSON.parse(readFileSync(join(root, '..', 'backend', 'data', 'network.json'), 'utf8'));
const layoutSource = readFileSync(join(root, 'src', 'map', 'layout.ts'), 'utf8');
const positions = Object.fromEntries(
  [...layoutSource.matchAll(/(\w{3}): \{ x: (-?[\d.]+), y: (-?[\d.]+) \}/g)]
    .slice(0, 7)
    .map(([, id, x, y]) => [id, { x: Number(x), y: Number(y) }]),
);
const origin = network.stations.find((s) => s.id === 'SJP');
const metresPerDegLat = 111_320;
const metresPerDegLon = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
/** Real location in metres east/north of St James's Park station. */
const project = (lat, lon) => [(lon - origin.lon) * metresPerDegLon, (lat - origin.lat) * metresPerDegLat];

// ---------------------------------------------------------------------------------------------
// Thin-plate spline warp: real metres -> schematic map units.

function solve(matrix, rhs) {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

function fitAffine(src, dst) {
  // Least squares for x' = a x + b y + c, y' = d x + e y + f.
  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atx = [0, 0, 0];
  const aty = [0, 0, 0];
  src.forEach(([x, y], i) => {
    const row = [x, y, 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) ata[r][c] += row[r] * row[c];
      atx[r] += row[r] * dst[i][0];
      aty[r] += row[r] * dst[i][1];
    }
  });
  const px = solve(ata, atx);
  const py = solve(ata, aty);
  return ([x, y]) => [px[0] * x + px[1] * y + px[2], py[0] * x + py[1] * y + py[2]];
}

function thinPlate(src, dst) {
  const n = src.length;
  const U = (r2) => (r2 === 0 ? 0 : r2 * Math.log(r2));
  const size = n + 3;
  const L = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = src[i][0] - src[j][0];
      const dy = src[i][1] - src[j][1];
      L[i][j] = U(dx * dx + dy * dy);
    }
    L[i][n] = L[n][i] = 1;
    L[i][n + 1] = L[n + 1][i] = src[i][0];
    L[i][n + 2] = L[n + 2][i] = src[i][1];
  }
  const wx = solve(L, [...dst.map((d) => d[0]), 0, 0, 0]);
  const wy = solve(L, [...dst.map((d) => d[1]), 0, 0, 0]);
  return ([x, y]) => {
    let ox = wx[n] + wx[n + 1] * x + wx[n + 2] * y;
    let oy = wy[n] + wy[n + 1] * x + wy[n + 2] * y;
    for (let i = 0; i < n; i++) {
      const dx = x - src[i][0];
      const dy = y - src[i][1];
      const u = U(dx * dx + dy * dy);
      ox += wx[i] * u;
      oy += wy[i] * u;
    }
    return [ox, oy];
  };
}

const stationIds = Object.keys(positions);
const srcStations = stationIds.map((id) => {
  const s = network.stations.find((st) => st.id === id);
  return project(s.lat, s.lon);
});
// Schematic y grows downward; real north grows upward. Work in "y up" units, flip at the end.
const dstStations = stationIds.map((id) => [positions[id].x, -positions[id].y]);
const affine = fitAffine(srcStations, dstStations);
// Distant anchors follow the best-fit affine so the warp settles down away from the network.
const anchors = [];
for (const ax of [-6000, -2000, 2000, 6000, 10000]) for (const ay of [-5000, 5000]) anchors.push([ax, ay]);
for (const ay of [-1500, 2500]) for (const ax of [-6000, 10000]) anchors.push([ax, ay]);
// Spread the surroundings wider than the plain fit so real streets fill the whole screen around
// the compact schematic network (checked below for folds).
const SPREAD = Number(process.env.CITY_SPREAD ?? 2.6);
const centre = dstStations.reduce(([sx, sy], [x, y]) => [sx + x / dstStations.length, sy + y / dstStations.length], [0, 0]);
const spread = ([x, y]) => {
  const [ax, ay] = affine([x, y]);
  return [centre[0] + (ax - centre[0]) * SPREAD, centre[1] + (ay - centre[1]) * SPREAD];
};
const warpUp = thinPlate([...srcStations, ...anchors], [...dstStations, ...anchors.map(spread)]);
const warp = (lat, lon) => {
  const [x, y] = warpUp(project(lat, lon));
  return [x, -y];
};

// Local scale (map units per metre) and fold check over the data area.
let folds = 0;
for (let lat = BBOX[0]; lat <= BBOX[2]; lat += 0.0008) {
  for (let lon = BBOX[1]; lon <= BBOX[3]; lon += 0.0012) {
    const [x0, y0] = warp(lat, lon);
    const [x1, y1] = warp(lat, lon + 0.0001);
    const [x2, y2] = warp(lat + 0.0001, lon);
    // Real east x north should keep the same handedness as map right x up (y flipped).
    const det = (x1 - x0) * -(y2 - y0) - -(y1 - y0) * (x2 - x0);
    if (det <= 0) folds++;
  }
}
console.log(`Warp folds in data area: ${folds}`);
const unitsPerMetre = (lat, lon) => {
  const [x0, y0] = warp(lat, lon);
  const [x1, y1] = warp(lat, lon + 10 / metresPerDegLon);
  return Math.hypot(x1 - x0, y1 - y0) / 10;
};

// ---------------------------------------------------------------------------------------------
// OSM features.

async function loadOsm() {
  const path = process.argv[2];
  if (path) return JSON.parse(readFileSync(path, 'utf8'));
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': 'StepFree/0.1 (city backdrop build)' },
    body: new URLSearchParams({ data: QUERY }),
  });
  if (!response.ok) throw new Error(`Overpass request failed: ${response.status}`);
  return response.json();
}

const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;

/** Join multipolygon member ways into closed rings. */
function rings(members) {
  const pieces = members.filter((m) => m.geometry?.length).map((m) => m.geometry.slice());
  const out = [];
  while (pieces.length) {
    let ring = pieces.shift();
    let grown = true;
    while (key(ring[0]) !== key(ring.at(-1)) && grown) {
      grown = false;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        if (key(p[0]) === key(ring.at(-1))) ring = ring.concat(p.slice(1));
        else if (key(p.at(-1)) === key(ring.at(-1))) ring = ring.concat(p.slice(0, -1).reverse());
        else if (key(p.at(-1)) === key(ring[0])) ring = p.concat(ring.slice(1));
        else if (key(p[0]) === key(ring[0])) ring = p.slice(1).reverse().concat(ring);
        else continue;
        pieces.splice(i, 1);
        grown = true;
        break;
      }
    }
    out.push(ring);
  }
  return out;
}

function hash(n) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const ROOFS = [
  // [roof, wall] pairs: Portland stone, London stock brick, red brick, slate, lead/zinc.
  ['#efeae0', '#d9d1c2'],
  ['#ece2d2', '#d6c6b0'],
  ['#e8d6c8', '#d1b8a6'],
  ['#e2e5e9', '#c9ced6'],
  ['#e6e8e4', '#cdd1cb'],
];

const fmt = (n) => Math.round(n * 10) / 10;
const toPath = (pts) => `M${pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}Z`;
const toLine = (pts) => `M${pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}`;

function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function main() {
  const osm = await loadOsm();
  const inArea = (pts) =>
    pts.some(([x, y]) => x > AREA.x - 40 && x < AREA.x + AREA.w + 40 && y > AREA.y - 40 && y < AREA.y + AREA.h + 40);
  const warpGeom = (geom) => geom.map((p) => warp(p.lat, p.lon));

  const water = [];
  const greens = [];
  const roads = { major: [], minor: [], foot: [] };
  const bridges = [];
  const buildings = [];

  for (const el of osm.elements) {
    const t = el.tags ?? {};
    if (el.type === 'relation') {
      const outer = rings(el.members.filter((m) => m.role !== 'inner')).map(warpGeom).filter(inArea);
      if (t.natural === 'water') water.push(...outer);
      else greens.push(...outer);
      continue;
    }
    if (!el.geometry) continue;
    const pts = warpGeom(el.geometry);
    if (!inArea(pts)) continue;
    if (t.building) {
      const levels = Number.parseFloat(t['building:levels']) || 4 + Math.floor(hash(el.id) * 3);
      const [lat, lon] = [el.geometry[0].lat, el.geometry[0].lon];
      buildings.push({ id: el.id, pts, levels, upm: unitsPerMetre(lat, lon) });
    } else if (t.natural === 'water') water.push(pts);
    else if (t.leisure || t.landuse) greens.push(pts);
    else if (t.highway) {
      if (t.bridge === 'yes' && /trunk|primary|secondary|tertiary/.test(t.highway)) bridges.push(pts);
      if (/motorway|trunk|primary/.test(t.highway)) roads.major.push(pts);
      else if (/pedestrian|living_street/.test(t.highway)) roads.foot.push(pts);
      else roads.minor.push(pts);
    }
  }
  console.log(`buildings ${buildings.length}, water ${water.length}, greens ${greens.length}, bridges ${bridges.length}`);

  // Trees: a light scatter of canopies inside larger green spaces.
  const trees = [];
  for (const [gi, poly] of greens.entries()) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const area = (maxX - minX) * (maxY - minY);
    if (area < 60) continue;
    const count = Math.min(400, Math.round(area / 55));
    for (let i = 0; i < count; i++) {
      const p = [minX + hash(gi * 7919 + i * 2) * (maxX - minX), minY + hash(gi * 104729 + i * 3 + 1) * (maxY - minY)];
      if (pointInPolygon(p, poly)) trees.push([...p, 1.3 + hash(i * 31 + gi) * 1.1]);
    }
  }

  // Painter's order for buildings: north (top) first.
  buildings.sort((a, b) => Math.max(...a.pts.map((p) => p[1])) - Math.max(...b.pts.map((p) => p[1])));

  const parts = [];
  parts.push(`<rect x="${AREA.x}" y="${AREA.y}" width="${AREA.w}" height="${AREA.h}" fill="#efece5"/>`);
  parts.push(`<g fill="#d5e5c6" stroke="#c4d9b2" stroke-width="0.6">${greens.map((g) => `<path d="${toPath(g)}"/>`).join('')}</g>`);
  parts.push(
    `<g>${trees
      .map(([x, y, r]) => `<circle cx="${fmt(x + 0.5)}" cy="${fmt(y + 0.7)}" r="${fmt(r)}" fill="#7f9a72" fill-opacity="0.18"/><circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r)}" fill="#b5cfa3"/>`)
      .join('')}</g>`,
  );
  // The Thames: embankment edge, then water.
  parts.push(`<g fill="none" stroke="#d7d1c4" stroke-width="3" stroke-linejoin="round">${water.map((w) => `<path d="${toPath(w)}"/>`).join('')}</g>`);
  parts.push(`<g fill="#bcd5e2">${water.map((w) => `<path d="${toPath(w)}"/>`).join('')}</g>`);
  // Streets with a soft kerb casing.
  const street = (list, width, casing) =>
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${list.map(toLine).join('')}" stroke="${casing}" stroke-width="${width + 0.9}"/><path d="${list.map(toLine).join('')}" stroke="#fbfaf6" stroke-width="${width}"/></g>`;
  parts.push(street(roads.foot, 0.9, '#e4dfd5'));
  parts.push(street(roads.minor, 1.4, '#ddd7cb'));
  parts.push(street(roads.major, 2.6, '#d4cdbf'));
  // Bridges over the river: stone parapets and deck.
  parts.push(
    `<g fill="none" stroke-linecap="butt"><path d="${bridges.map(toLine).join('')}" stroke="#bfb5a3" stroke-width="5"/><path d="${bridges.map(toLine).join('')}" stroke="#f6f2ea" stroke-width="3.4"/></g>`,
  );
  // Buildings: ground shadow, walls (base footprint), roof lifted by height.
  const shadows = [];
  const bodies = [];
  for (const b of buildings) {
    const lift = Math.min(8, b.levels * 3.2 * b.upm * 2.4);
    const [roof, wall] = ROOFS[Math.floor(hash(b.id) * ROOFS.length)];
    shadows.push(`<path d="${toPath(b.pts.map(([x, y]) => [x + lift * 0.7, y + lift * 0.25]))}"/>`);
    bodies.push(
      `<path d="${toPath(b.pts)}" fill="${wall}"/><path d="${toPath(b.pts.map(([x, y]) => [x, y - lift]))}" fill="${roof}" stroke="${wall}" stroke-width="0.3"/>`,
    );
  }
  parts.push(`<g fill="#2b3340" fill-opacity="0.1">${shadows.join('')}</g>`);
  parts.push(`<g>${bodies.join('')}</g>`);
  // Feather the far edges into the ground colour so the data boundary never shows.
  parts.push(
    `<defs><radialGradient id="feather" gradientUnits="userSpaceOnUse" cx="230" cy="330" r="760"><stop offset="0.62" stop-color="#efece5" stop-opacity="0"/><stop offset="1" stop-color="#efece5" stop-opacity="1"/></radialGradient></defs><rect x="${AREA.x}" y="${AREA.y}" width="${AREA.w}" height="${AREA.h}" fill="url(#feather)"/>`,
  );

  const svg = (scale) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(AREA.w * scale)}" height="${Math.round(AREA.h * scale)}" viewBox="${AREA.x} ${AREA.y} ${AREA.w} ${AREA.h}">${parts.join('')}</svg>`;

  mkdirSync(outDir, { recursive: true });
  for (const out of OUTPUTS) {
    const file = join(outDir, `${out.name}.webp`);
    const info = await sharp(Buffer.from(svg(out.scale)), { limitInputPixels: false })
      .webp({ quality: out.quality, effort: 6 })
      .toFile(file);
    console.log(`${out.name}.webp ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)} KB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
