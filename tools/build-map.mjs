// Builds the game map from OpenStreetMap (data-raw/slices/*.json) and Overture
// building footprints (data-raw/overture-buildings.ndjson, which adds Google and
// Microsoft ML footprints where OSM has no building).
//
// Output:
//   public/data/delhi.json           global data: roads, areas, rail, landmarks, races, tile index
//   public/data/tiles/<tx>_<tz>.json  1 km tiles: buildings, trees, lamps, walls, domes
//
// Map data © OpenStreetMap contributors (ODbL 1.0). Building footprints also from
// Overture Maps Foundation, Google Open Buildings and Microsoft ML Buildings.
// World coordinates: metres, X = east, Z = south (north is -Z), origin at ORIGIN.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data-raw');
const OUT_DIR = path.join(ROOT, 'public/data');
const TILE_DIR = path.join(OUT_DIR, 'tiles');
const TILE = 1000;

export const ORIGIN = { lat: 28.6200, lon: 77.2180 };
const BBOX = { south: 28.578, west: 77.158, north: 28.670, east: 77.322 };
const M_PER_DEG_LAT = 110829;
const M_PER_DEG_LON = 97789;
const project = (lat, lon) => [(lon - ORIGIN.lon) * M_PER_DEG_LON, -(lat - ORIGIN.lat) * M_PER_DEG_LAT];
const r1 = (v) => Math.round(v * 10) / 10;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---------------------------------------------------------------- load OSM
function loadElements() {
  const dir = path.join(RAW, 'slices');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  if (!files.length) throw new Error('No OSM data in data-raw/slices. Run: npm run fetch-map');
  const seen = new Map();
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const e of d.elements) seen.set(`${e.type}/${e.id}`, e);
  }
  log(`OSM: ${seen.size} elements from ${files.length} files`);
  return [...seen.values()];
}
const elements = loadElements();
const EXTRAS = path.join(RAW, 'extras.json');
const extras = fs.existsSync(EXTRAS) ? JSON.parse(fs.readFileSync(EXTRAS, 'utf8')).elements : [];
log(`extras: ${extras.length} elements (metro routes, stations, food spots)`);

// ---------------------------------------------------------------- geometry utils
function polyArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}
function centroid(ring) {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
}
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
function simplify(pts, tol) {
  if (pts.length <= 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distSeg(pts[i][0], pts[i][1], pts[s][0], pts[s][1], pts[e][0], pts[e][1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function cleanRing(ring, tol) {
  const r = ring.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  if (r.length < 3) return null;
  const closed = simplify([...r, r[0]], tol);
  closed.pop();
  return closed.length >= 3 ? closed : null;
}
const geomToPts = (geometry) => geometry.filter(Boolean).map((g) => project(g.lat, g.lon));
function assembleRings(members) {
  const segs = members.filter((m) => m.geometry && m.geometry.length > 1).map((m) => geomToPts(m.geometry));
  const rings = [];
  const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  while (segs.length) {
    let ring = segs.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 500) {
      const end = key(ring[ring.length - 1]);
      const i = segs.findIndex((s) => key(s[0]) === end || key(s[s.length - 1]) === end);
      if (i < 0) break;
      let s = segs.splice(i, 1)[0];
      if (key(s[0]) !== end) s = s.slice().reverse();
      ring = ring.concat(s.slice(1));
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
const hash = (n) => {
  let x = (Math.floor(n) * 2654435761) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13;
  return (x >>> 0) / 4294967295;
};
const phash = (x, z) => hash((Math.floor(x * 7.31) * 73856093) ^ (Math.floor(z * 3.17) * 19349663));

/** Integer decimetres, delta-encoded: [x0, z0, dx1, dz1, ...]. */
function enc(pts) {
  const out = [];
  let px = 0, pz = 0;
  for (const [x, z] of pts) {
    const ix = Math.round(x * 10), iz = Math.round(z * 10);
    out.push(ix - px, iz - pz);
    px = ix; pz = iz;
  }
  return out;
}
const flatPts = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);
const bboxOf = (ring) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return [x0, x1, z0, z1];
};

/** Uniform grid of items with bounding boxes. */
class Grid {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  add(bb, item) {
    const c = this.cell;
    for (let gx = Math.floor(bb[0] / c); gx <= Math.floor(bb[1] / c); gx++)
      for (let gz = Math.floor(bb[2] / c); gz <= Math.floor(bb[3] / c); gz++) {
        const k = gx * 100000 + gz;
        let l = this.m.get(k);
        if (!l) this.m.set(k, (l = []));
        l.push(item);
      }
  }
  at(x, z) { return this.m.get(Math.floor(x / this.cell) * 100000 + Math.floor(z / this.cell)) || []; }
  near(x, z, fn) {
    const gx = Math.floor(x / this.cell), gz = Math.floor(z / this.cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const it of this.m.get((gx + a) * 100000 + gz + b) || []) if (fn(it)) return true;
    return false;
  }
}

// ---------------------------------------------------------------- landmarks
// Reference points (lat/lon) for hand-built models, scenic cameras, chai stops and districts.
const LM = {
  indiaGate: [28.61293, 77.22949],
  canopy: [28.612845, 77.231115],
  warMemorial: [28.612749, 77.233045],
  rbDome: [28.614287, 77.199637],
  samratYantra: [28.62703, 77.216604],
  banglaSahib: [28.626308, 77.209085],
  cpCenter: [28.63281, 77.21971],
  vijayChowk: [28.6143, 77.209],
  northBlock: [28.61512, 77.20578],
  southBlock: [28.61297, 77.20566],
  oldParliament: [28.61719, 77.20819],
  newParliament: [28.61712, 77.21022],
  jantarMantar: [28.627099, 77.216596],
  agrasen: [28.62609, 77.22501],
  nationalMuseum: [28.61162, 77.21931],
  hanumanMandir: [28.6303505, 77.2150219],
  cathedral: [28.6287, 77.20678],
  ndls: [28.64178, 77.22177],
  stadium: [28.61233, 77.23733],
  puranaQila: [28.6093434, 77.2436159],
  bharatMandapam: [28.61941, 77.24243],
  ito: [28.6281, 77.2493],
  akshardham: [28.61251, 77.27736],
  humayunTomb: [28.59329, 77.25065],
  nizamuddinDargah: [28.59138, 77.24198],
  lodhiGarden: [28.59348, 77.21956],
  safdarjungTomb: [28.58924, 77.2106],
  teenMurti: [28.60279, 77.19877],
  chanakyapuri: [28.5960, 77.1880],
  nehruPark: [28.59132, 77.1927],
  yamunaBank: [28.62328, 77.26789],
  laxmiNagar: [28.63061, 77.27756],
  patparganj: [28.6250, 77.3020],
  madhuVihar: [28.63593, 77.30427],
  preetVihar: [28.64155, 77.29531],
  yamunaSports: [28.6610, 77.3098],
};
const LMXY = Object.fromEntries(Object.entries(LM).map(([k, [la, lo]]) => [k, project(la, lo)]));
const EXCLUDE = [
  { at: LMXY.indiaGate, r: 26 },
  { at: LMXY.canopy, r: 12 },
  { at: LMXY.rbDome, r: 30, partsOnly: true },
  { at: LMXY.samratYantra, r: 12 },
  { at: LMXY.northBlock, r: 200, partsOnly: true },
  { at: LMXY.southBlock, r: 200, partsOnly: true },
  { at: LMXY.akshardham, r: 62 },
  { at: LMXY.humayunTomb, r: 62 },
];
const excluded = (c, isPart) => EXCLUDE.some((e) => (!e.partsOnly || isPart) && Math.hypot(c[0] - e.at[0], c[1] - e.at[1]) < e.r);

// ---------------------------------------------------------------- districts
const inBox = (c, x0, x1, z0, z1) => c[0] > x0 && c[0] < x1 && c[1] > z0 && c[1] < z1;
const [chX0, chZ1] = project(28.578, 77.160), [chX1, chZ0] = project(28.606, 77.2005);
const zone = (c) => {
  if (inBox(c, chX0, chX1, chZ0, chZ1)) return 'chanakyapuri';
  if (c[0] > 4500) return 'east';                     // across the Yamuna
  if (c[0] > 2600 && c[1] > -500) return 'riverside';  // Pragati Maidan, Nizamuddin, floodplain
  if (c[1] > -1200 && c[0] < 2600) return 'lutyens';
  return 'central';
};

// Named group-housing societies (Patparganj, IP Extension, Mayur Vihar).
const societies = new Grid(200);
for (const e of elements) {
  const t = e.tags;
  if (!t || t.landuse !== 'residential' || !/apartment|society|cghs|enclave|awas|niketan|vihar apts/i.test(t.name || '')) continue;
  const rings = e.type === 'way' && e.geometry ? [geomToPts(e.geometry)] : e.type === 'relation' && e.members ? assembleRings(e.members.filter((m) => m.type === 'way')) : [];
  for (const r of rings) { const c = cleanRing(r, 0.5); if (c) { const it = { ring: c, bb: bboxOf(c) }; societies.add(it.bb, it); } }
}
const inSociety = (c) => societies.at(c[0], c[1]).some((s) => c[0] >= s.bb[0] && c[0] <= s.bb[1] && c[1] >= s.bb[2] && c[1] <= s.bb[3] && pointInRing(c, s.ring));

// ---------------------------------------------------------------- roads
const ROAD_W = {
  motorway: 20, trunk: 16, primary: 15, secondary: 13, tertiary: 10,
  unclassified: 7, residential: 7, living_street: 6, service: 5.5,
  motorway_link: 8, trunk_link: 8, primary_link: 8, secondary_link: 7.5, tertiary_link: 7,
  pedestrian: 7, busway: 7, road: 7,
};
const ROAD_T = {
  motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, unclassified: 4, residential: 4,
  living_street: 5, service: 5, road: 4, busway: 4, pedestrian: 6,
  motorway_link: 1, trunk_link: 1, primary_link: 2, secondary_link: 2, tertiary_link: 3,
};
const roads = [];
const graphEdges = [];
const nodePos = new Map();
for (const e of elements) {
  if (e.type !== 'way' || !e.tags?.highway) continue;
  const t = e.tags, hw = t.highway;
  if (!(hw in ROAD_W)) continue;
  if (t.tunnel === 'yes' || t.tunnel === 'building_passage' || Number(t.layer) < 0) continue;
  if (t.area === 'yes') continue;
  if (hw === 'service' && (t.service === 'parking_aisle' || t.service === 'drive-through')) continue;
  const pts = geomToPts(e.geometry);
  if (pts.length < 2) continue;
  let w = ROAD_W[hw];
  const lanes = Number(t.lanes);
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' ? 1 : t.oneway === '-1' ? -1 : 0;
  if (lanes > 0 && lanes < 9) w = Math.max(hw === 'service' ? 4 : 6, lanes * 3.3 + (oneway ? 1 : 1.5));
  else if (['residential', 'unclassified', 'living_street'].includes(hw)) {
    // Colony lanes in East Delhi and the old city are narrow.
    const z = zone(pts[Math.floor(pts.length / 2)]);
    if (z === 'east' || z === 'central') w = hw === 'living_street' ? 4 : 5;
  }
  const bridge = t.bridge && t.bridge !== 'no' ? 1 : 0;
  const name = t.name || t['name:en'] || '';
  roads.push({ n: name, t: ROAD_T[hw], w: r1(w), o: oneway, b: bridge, l: Number(t.layer) || 0, pts: simplify(pts, 0.35) });
  for (let i = 0; i < e.nodes.length; i++) nodePos.set(e.nodes[i], pts[i]);
  for (let i = 0; i + 1 < e.nodes.length; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const typeCost = { 0: 0.8, 1: 0.85, 2: 0.9, 3: 1, 4: 1.3, 5: 2.2, 6: 4 }[ROAD_T[hw]] ?? 1.5;
    graphEdges.push({ a: e.nodes[i], b: e.nodes[i + 1], cost: len * typeCost * (t.access === 'private' ? 3 : 1), oneway, name });
  }
}
log(`roads: ${roads.length}`);

const roadGrid = new Grid(20);
for (const r of roads) {
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
    roadGrid.add([Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz)], [ax, az, bx, bz, r.w / 2, r.b, r.t]);
  }
}
const nearRoad = (x, z, margin, groundOnly = false) => roadGrid.near(x, z, (s) => (!groundOnly || !s[5]) && distSeg(x, z, s[0], s[1], s[2], s[3]) < s[4] + margin);

// ---------------------------------------------------------------- buildings (OSM)
function defaultHeight(area, c, j, inSoc) {
  const z = zone(c);
  if (area < 40) return 3.5 + j;
  if (inSoc && area > 150) return 13 + j * 11;   // society blocks: four storeys to towers
  if (z === 'lutyens' || z === 'chanakyapuri') {
    if (area < 700) return 6.8 + j * 2.4;          // single and double-storey bungalows
    if (area < 2500) return 9 + j * 4;
    return 12 + j * 5;
  }
  if (z === 'east') {
    if (area < 300) return 9.5 + j * 4.5;          // 3–4 storey colony houses (Laxmi Nagar, Madhu Vihar)
    if (area < 3500) return 13 + j * 9;
    return 11 + j * 5;
  }
  if (z === 'central') {
    if (area < 300) return 10 + j * 5;             // Paharganj and old-city lanes
    return 12 + j * 8;
  }
  if (area < 200) return 6.5 + j * 3;
  if (area < 800) return 9 + j * 4;
  return 12 + j * 6;
}
function heightFor(t, area, c, id, inSoc) {
  const num = (v) => { const f = parseFloat(String(v).replace(',', '.')); return Number.isFinite(f) ? f : NaN; };
  let h = num(t.height);
  if (!Number.isFinite(h) && t['building:levels']) h = num(t['building:levels']) * 3.4 + 1;
  if (Number.isFinite(h) && h > 0) return h;
  const b = t.building || t['building:part'] || 'yes';
  const j = hash(id);
  switch (b) {
    case 'house': case 'detached': case 'bungalow': return 7 + j * 2;
    case 'apartments': case 'dormitory': case 'hotel': return 15 + j * 9;
    case 'commercial': case 'office': case 'retail': return 12 + j * 6;
    case 'roof': case 'shed': case 'hut': case 'kiosk': case 'toilets': case 'garage': case 'parking': return 3.5;
    case 'ruins': return 4;
    case 'construction': return 8;
    case 'temple': case 'church': case 'cathedral': case 'mosque': case 'gurdwara': return 13 + j * 2;
    case 'train_station': case 'stadium': case 'transportation': return 12;
    case 'school': case 'college': case 'hospital': case 'public': case 'government': return 11 + j * 4;
  }
  return defaultHeight(area, c, j, inSoc);
}
const cpXY = LMXY.cpCenter;
function kindFor(t, c, h, name, area, inSoc) {
  // 0 plaster, 1 bungalow, 2 commercial, 3 sandstone, 4 religious white, 5 CP colonnade,
  // 6 apartments, 7 glass tower, 8 jantar, 9 shed, 10 stone/ruins, 11 embassy/modern
  const b = t.building || t['building:part'] || 'yes';
  const dCP = Math.hypot(c[0] - cpXY[0], c[1] - cpXY[1]);
  const z = zone(c);
  if (/yantra/i.test(name) || t.man_made === 'observatory') return 8;
  if (b === 'ruins' || t.historic === 'ruins') return 10;
  if (/tomb|gumbad|gumbaz|maqbara|mausoleum|qila|qala|fort|baoli|darwaza/i.test(name) || t.historic === 'monument' || t.historic === 'tomb') return 10;
  if (['temple', 'church', 'cathedral', 'mosque', 'gurdwara', 'shrine'].includes(b)) return 4;
  if (Math.hypot(c[0] - LMXY.rbDome[0], c[1] - LMXY.rbDome[1]) < 170) return 3;
  if (c[0] > -2100 && c[0] < -650 && c[1] > 250 && c[1] < 1050 && h > 6) return 3;
  if (dCP > 95 && dCP < 360 && h < 26) return 5;
  if (/^(north|south) block$|bha[wv]an\b|parliament|sansad|national museum|rashtrapati|baroda house|hyderabad house|national archives/i.test(name)) return 3;
  if (/embassy|high commission|consulate|ambassador|chancery|delegation/i.test(name)) return 11;
  if (h >= 32) return 7;
  if (['roof', 'shed', 'hut', 'kiosk', 'toilets', 'garage', 'parking'].includes(b) || h < 4.5) return 9;
  if (inSoc) return 6;
  if (z === 'chanakyapuri') return area > 900 || ['office', 'commercial', 'public', 'government'].includes(b) ? 11 : 1;
  if (['house', 'detached', 'bungalow'].includes(b)) return 1;
  if (['apartments', 'residential', 'dormitory'].includes(b)) return 6;
  if (['commercial', 'office', 'retail', 'hotel'].includes(b)) return 2;
  if (z === 'lutyens' && h < 10 && area < 1500) return 1;
  if (z === 'east' && area >= 300 && area < 3500 && h >= 12) return 6;
  if (b === 'industrial' || b === 'warehouse') return 9;
  return 0;
}
const HEIGHT_OVERRIDE = { 44187405: 20 };

const rawBuildings = [];
function addBuilding(e, rings, isPart) {
  const t = e.tags;
  const sorted = rings.map((r) => cleanRing(r, 0.25)).filter(Boolean).sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)));
  const groups = [];
  for (const r of sorted) {
    const host = groups.find((g) => pointInRing(r[0], g.outer));
    if (host) host.holes.push(r); else groups.push({ outer: r, holes: [] });
  }
  for (const g of groups) {
    const area = Math.abs(polyArea(g.outer));
    if (area < 6) continue;
    const c = centroid(g.outer);
    if (excluded(c, isPart)) continue;
    const name = t.name || t['name:en'] || '';
    const inSoc = inSociety(c);
    let h = HEIGHT_OVERRIDE[e.id] ?? heightFor(t, area, c, e.id, inSoc);
    if (name === 'North Block' || name === 'South Block') h = 21;
    let mh = parseFloat(t.min_height);
    if (!Number.isFinite(mh) && t['building:min_level']) mh = parseFloat(t['building:min_level']) * 3.4;
    if (!Number.isFinite(mh) || mh >= h) mh = 0;
    if (/agrasen/i.test(name)) h = 7;
    const outer = polyArea(g.outer) < 0 ? g.outer.slice().reverse() : g.outer;
    const holes = g.holes.map((hr) => (polyArea(hr) > 0 ? hr.slice().reverse() : hr));
    rawBuildings.push({ id: e.id, isPart, outer, holes, h, mh, area, c, name, t, src: 'osm', inSoc });
  }
}
for (const e of elements) {
  const t = e.tags;
  if (!t) continue;
  const isB = t.building && t.building !== 'no';
  const isP = !!t['building:part'] && t['building:part'] !== 'no';
  if (!isB && !isP) continue;
  if (Number(t.layer) < 0 || t.location === 'underground' || t['building:levels'] === '0') continue;
  if (e.type === 'way' && e.geometry) addBuilding(e, [geomToPts(e.geometry)], isP && !isB);
  else if (e.type === 'relation' && e.members) addBuilding(e, assembleRings(e.members.filter((m) => m.type === 'way')), isP && !isB);
}
log(`OSM buildings and parts: ${rawBuildings.length}`);

const osmGrid = new Grid(50);
for (const b of rawBuildings) if (!b.isPart) { b.bb = bboxOf(b.outer); osmGrid.add(b.bb, b); }
const insideOsm = (p) => osmGrid.at(p[0], p[1]).some((b) => p[0] >= b.bb[0] && p[0] <= b.bb[1] && p[1] >= b.bb[2] && p[1] <= b.bb[3] && pointInRing(p, b.outer));

// Big lawns, parks and water: ML footprints there are usually false detections.
const openGrid = new Grid(100);
for (const e of elements) {
  const t = e.tags || {};
  const open = ['park', 'garden', 'golf_course', 'pitch', 'stadium'].includes(t.leisure) || ['grass', 'recreation_ground', 'meadow', 'village_green', 'forest'].includes(t.landuse) || t.natural === 'water' || t.water || t.waterway === 'riverbank';
  if (!open || t.building) continue;
  const rings = e.type === 'way' && e.geometry?.length >= 4 ? [geomToPts(e.geometry)] : e.type === 'relation' && e.members ? assembleRings(e.members.filter((m) => m.type === 'way' && m.role !== 'inner')) : [];
  for (const r of rings) {
    const c = cleanRing(r, 1);
    if (!c) continue;
    const area = Math.abs(polyArea(c));
    const water = t.natural === 'water' || t.water || t.waterway === 'riverbank';
    if (!water && area < 15000) continue;
    const it = { ring: c, bb: bboxOf(c) };
    openGrid.add(it.bb, it);
  }
}
const inOpenSpace = (p) => openGrid.at(p[0], p[1]).some((o) => p[0] >= o.bb[0] && p[0] <= o.bb[1] && p[1] >= o.bb[2] && p[1] <= o.bb[3] && pointInRing(p, o.ring));

// ---------------------------------------------------------------- buildings (Overture ML footprints)
const OVERTURE = path.join(RAW, 'overture-buildings.ndjson');
let mlAdded = 0, mlSkipped = 0;
if (fs.existsSync(OVERTURE)) {
  let k = 0;
  for (const line of fs.readFileSync(OVERTURE, 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (r.src === 'OpenStreetMap') continue; // OSM buildings come from Overpass, with full tags and 3D parts
    const g = typeof r.geom === 'string' ? JSON.parse(r.geom) : r.geom;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const rings = poly.map((ring) => ring.map(([lon, lat]) => project(lat, lon)));
      const outer0 = cleanRing(rings[0], 0.3);
      if (!outer0) continue;
      const area = Math.abs(polyArea(outer0));
      if (area < 12) continue;
      const c = centroid(outer0);
      if (excluded(c, false) || insideOsm(c) || outer0.some((p, i) => i % 2 === 0 && insideOsm(p))) { mlSkipped++; continue; }
      if (inOpenSpace(c) || nearRoad(c[0], c[1], -0.5, true)) { mlSkipped++; continue; }
      const id = 9e8 + k++;
      const inSoc = inSociety(c);
      const h = r.height || (r.num_floors ? r.num_floors * 3.3 + 1 : defaultHeight(area, c, hash(id), inSoc));
      const outer = polyArea(outer0) < 0 ? outer0.slice().reverse() : outer0;
      const holes = rings.slice(1).map((hr) => cleanRing(hr, 0.3)).filter(Boolean).map((hr) => (polyArea(hr) > 0 ? hr.slice().reverse() : hr));
      rawBuildings.push({ id, isPart: false, outer, holes, h, mh: 0, area, c, name: r.name || '', t: { building: r.class || 'yes' }, src: 'ml', inSoc });
      mlAdded++;
    }
  }
}
log(`ML footprints added: ${mlAdded} (skipped ${mlSkipped} that overlap OSM, landmarks, roads, lawns or water)`);

// Suppress OSM outlines mostly covered by their parts (Simple 3D Buildings).
const partGrid = new Grid(100);
for (const p of rawBuildings) if (p.isPart) partGrid.add([p.c[0], p.c[0], p.c[1], p.c[1]], p);
let buildings = [];
const domes = [];
for (const b of rawBuildings) {
  if (!b.isPart && b.src === 'osm') {
    let covered = 0;
    const bb = b.bb;
    for (let gx = Math.floor(bb[0] / 100); gx <= Math.floor(bb[1] / 100); gx++)
      for (let gz = Math.floor(bb[2] / 100); gz <= Math.floor(bb[3] / 100); gz++)
        for (const p of partGrid.m.get(gx * 100000 + gz) || []) if (pointInRing(p.c, b.outer)) covered += p.area;
    if (covered / b.area > 0.6) continue;
  }
  b.kind = kindFor(b.t, b.c, b.h, b.name, b.area, b.inSoc);
  buildings.push(b);
  // A central dome on tombs and mosques, sized to the footprint.
  const domed = /tomb|gumbad|gumbaz|maqbara|mausoleum|dargah|masjid|mosque/i.test(b.name) || b.t.building === 'mosque' || b.t.historic === 'tomb';
  if (domed && !b.isPart && b.area > 40 && b.area < 6000) {
    domes.push({ x: b.c[0], z: b.c[1], top: b.h, r: Math.max(2.5, Math.min(13, Math.sqrt(b.area) * 0.32)), style: b.kind === 10 ? 1 : 0 });
  }
}
log(`buildings kept: ${buildings.length}, domes: ${domes.length}`);

// ---------------------------------------------------------------- rail elevation rule
// 0 underground, 1 at grade, 2 elevated metro (deck ~10.5 m), 3 elevated rail (~7.5 m).
// Delhi Metro east of the Yamuna is elevated even where OSM lacks a bridge tag.
function railMode(t, at) {
  if (t.tunnel === 'yes' || Number(t.layer) < 0 || t.location === 'underground') return 0;
  const metro = t.railway !== 'rail';
  if ((t.bridge && t.bridge !== 'no') || Number(t.layer) > 0) return metro ? 2 : 3;
  if (t.railway === 'subway') return at && at[0] > 2600 ? 2 : 0;
  return 1;
}

// ---------------------------------------------------------------- areas, rail, walls, OSM trees
const AREA_K = { grass: 1, pitch: 2, stadium: 3, wood: 4, water: 5, plaza: 6, sand: 7, river: 8 };
const areas = [];
function addArea(kind, rings) {
  const sorted = rings.map((r) => cleanRing(r, 0.6)).filter(Boolean).sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)));
  const groups = [];
  for (const r of sorted) {
    const host = groups.find((g) => pointInRing(r[0], g.outer));
    if (host) host.holes.push(r); else groups.push({ outer: r, holes: [] });
  }
  for (const g of groups) {
    const area = Math.abs(polyArea(g.outer));
    if (area < 20) continue;
    areas.push({ k: AREA_K[kind], outer: g.outer, holes: g.holes, area });
  }
}
const rails = [];
const barriers = [];
const osmTrees = [];
for (const e of elements) {
  const t = e.tags || {};
  if (e.type === 'node' && t.natural === 'tree') { osmTrees.push(project(e.lat, e.lon)); continue; }
  let kind = null;
  if (t.water === 'river' || t.waterway === 'riverbank') kind = 'river';
  else if (t.natural === 'water' || t.water || t.landuse === 'reservoir' || t.landuse === 'basin') kind = 'water';
  else if (['park', 'garden', 'golf_course', 'playground'].includes(t.leisure) || ['grass', 'recreation_ground', 'meadow', 'village_green', 'cemetery'].includes(t.landuse) || t.natural === 'grassland') kind = 'grass';
  else if (t.leisure === 'pitch') kind = 'pitch';
  else if (t.leisure === 'stadium') kind = 'stadium';
  else if (t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub') kind = 'wood';
  else if (t.highway === 'pedestrian' && t.area === 'yes') kind = 'plaza';
  if (kind && !t.building) {
    if (e.type === 'way' && e.geometry && e.geometry.length >= 4) addArea(kind, [geomToPts(e.geometry)]);
    else if (e.type === 'relation' && e.members) addArea(kind, assembleRings(e.members.filter((m) => m.type === 'way' && m.role !== 'inner').concat(e.members.filter((m) => m.type === 'way' && m.role === 'inner'))));
  }
  if (e.type === 'way' && /^(rail|light_rail|subway)$/.test(t.railway || '') && t.tunnel !== 'yes' && !(Number(t.layer) < 0) && t.location !== 'underground') {
    const pts0 = geomToPts(e.geometry);
    const elevated = railMode(t, pts0[Math.floor(pts0.length / 2)]) >= 2;
    if (t.railway === 'subway' && !elevated) continue; // underground metro
    rails.push({ pts: simplify(geomToPts(e.geometry), 0.5), e: elevated ? 1 : 0, metro: t.railway !== 'rail' ? 1 : 0 });
  }
  if (e.type === 'way' && /^(wall|fence)$/.test(t.barrier || '') && e.geometry?.length >= 2) {
    barriers.push({ pts: simplify(geomToPts(e.geometry), 0.3), f: t.barrier === 'fence' ? 1 : 0 });
  }
}
log(`areas ${areas.length}, rails ${rails.length} (${rails.filter((r) => r.e).length} elevated), barriers ${barriers.length}, OSM trees ${osmTrees.length}`);

// ---------------------------------------------------------------- routing
const adj = new Map();
for (const ed of graphEdges) {
  const push = (from, to, cost) => {
    let l = adj.get(from);
    if (!l) adj.set(from, (l = []));
    l.push({ to, cost, name: ed.name });
  };
  if (ed.oneway >= 0) push(ed.a, ed.b, ed.cost);
  if (ed.oneway <= 0) push(ed.b, ed.a, ed.cost);
  if (ed.oneway === 1) push(ed.b, ed.a, ed.cost * 2.5);
  if (ed.oneway === -1) push(ed.a, ed.b, ed.cost * 2.5);
}
class Heap {
  constructor() { this.a = []; }
  push(v) { const a = this.a; a.push(v); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}
function dijkstra(src, dst, streets) {
  const dist = new Map([[src, 0]]);
  const prev = new Map();
  const heap = new Heap();
  heap.push([0, src]);
  const done = new Set();
  while (heap.size) {
    const [d, u] = heap.pop();
    if (done.has(u)) continue;
    done.add(u);
    if (u === dst) break;
    for (const e of adj.get(u) || []) {
      const nd = d + e.cost * (streets.includes(e.name) ? 1 : 12);
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { u, name: e.name }); heap.push([nd, e.to]); }
    }
  }
  if (!prev.has(dst) && src !== dst) throw new Error(`no route ${src} -> ${dst}`);
  const pathN = [{ id: dst, name: '' }];
  let cur = dst;
  while (cur !== src) { const p = prev.get(cur); pathN.push({ id: p.u, name: p.name }); cur = p.u; }
  pathN.reverse();
  for (let i = 0; i + 1 < pathN.length; i++) pathN[i].name = prev.get(pathN[i + 1].id).name;
  pathN[pathN.length - 1].name = pathN.length > 1 ? pathN[pathN.length - 2].name : '';
  return pathN;
}
function snapToStreet(lat, lon, streets) {
  const [x, z] = project(lat, lon);
  let best = null, bd = Infinity;
  for (const [id, p] of nodePos) {
    const edges = adj.get(id);
    if (!edges || !edges.some((e) => streets.includes(e.name))) continue;
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < bd) { bd = d; best = id; }
  }
  if (best == null) throw new Error(`no node on [${streets}] near ${lat},${lon}`);
  if (bd > 80) console.warn(`  snap ${lat},${lon} to [${streets}] is ${bd.toFixed(0)} m away`);
  return best;
}
const COURSES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/courses.json'), 'utf8'));
function buildCourse(c) {
  let cur = snapToStreet(c.start[0], c.start[1], c.start[2]);
  let pathN = [{ id: cur, name: c.start[2][0] }];
  for (const leg of c.legs) {
    const to = snapToStreet(leg.to[0], leg.to[1], leg.streets);
    const seg = dijkstra(cur, to, leg.streets);
    seg.shift();
    pathN = pathN.concat(seg);
    cur = to;
  }
  const pts = [], names = [];
  for (const n of pathN) {
    const p = nodePos.get(n.id);
    if (pts.length && Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) < 0.5) continue;
    pts.push(p); names.push(n.name);
  }
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const seq = [];
  for (const nm of names) if (seq[seq.length - 1] !== nm) seq.push(nm);
  log(`course ${c.id}: ${(len / 1000).toFixed(2)} km × ${c.laps || 1}: ${seq.map((n) => n || '·').join(' → ')}`);
  return { id: c.id, name: c.name, blurb: c.blurb, region: c.region || '', laps: c.laps || 1, len: Math.round(len), p: flatPts(pts), s: names };
}
const courses = COURSES.map(buildCourse);

// ---------------------------------------------------------------- keep roads and race lines clear
// ML footprints that cut into a carriageway, and any building within 4 m of a race
// line, would block the road: drop them.
{
  const fine = new Set();
  const fkey = (x, z) => Math.floor(x / 2) * 100000 + Math.floor(z / 2);
  for (const c of courses) {
    for (let i = 0; i + 3 < c.p.length; i += 2) {
      const ax = c.p[i], az = c.p[i + 1], bx = c.p[i + 2], bz = c.p[i + 3];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) fine.add(fkey(x + a * 2, z + b * 2));
      }
    }
  }
  const samples = (ring) => {
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    return out;
  };
  // Main roads only (tertiary and up): colony lanes have no reliable width in OSM.
  const intrudes = (pts, depth) => pts.some(([x, z]) => roadGrid.near(x, z, (s) => !s[5] && s[6] <= 3 && distSeg(x, z, s[0], s[1], s[2], s[3]) < s[4] - depth));
  let onRouteDrop = 0, roadDrop = 0;
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    const pts = samples(b.outer);
    if (pts.some(([x, z]) => fine.has(fkey(x, z)))) { buildings.splice(i, 1); onRouteDrop++; continue; }
    if (b.src === 'ml' && intrudes(pts, 1.0)) { buildings.splice(i, 1); roadDrop++; }
  }
  log(`dropped ${onRouteDrop} buildings on race lines, ${roadDrop} ML footprints inside carriageways`);
}

// ---------------------------------------------------------------- occupancy raster (buildings + water)
const [bx0, bz0] = project(BBOX.north, BBOX.west);
const [bx1, bz1] = project(BBOX.south, BBOX.east);
const OC = 3;
const OW = Math.ceil((bx1 - bx0) / OC), OH = Math.ceil((bz1 - bz0) / OC);
const occ = new Uint8Array(OW * OH);
function fillRing(ring, bit) {
  let zmin = Infinity, zmax = -Infinity;
  for (const [, z] of ring) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
  const r0 = Math.max(0, Math.floor((zmin - bz0) / OC)), r1v = Math.min(OH - 1, Math.floor((zmax - bz0) / OC));
  const xs = [];
  for (let r = r0; r <= r1v; r++) {
    const z = bz0 + (r + 0.5) * OC;
    xs.length = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z)) xs.push(xi + ((z - zi) / (zj - zi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.floor((xs[k] - bx0) / OC)), c1 = Math.min(OW - 1, Math.floor((xs[k + 1] - bx0) / OC));
      for (let c = c0; c <= c1; c++) occ[r * OW + c] |= bit;
    }
  }
}
for (const b of buildings) fillRing(b.outer, 1);
for (const a of areas) if (a.k === AREA_K.water || a.k === AREA_K.river) fillRing(a.outer, 2);
// Hand-built landmarks occupy their footprints too.
for (const [k, r] of [['akshardham', 58], ['humayunTomb', 50], ['indiaGate', 20], ['canopy', 9], ['samratYantra', 20]]) {
  const [x, z] = LMXY[k];
  fillRing([[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]], 1);
}
const occAt = (x, z) => {
  const c = Math.floor((x - bx0) / OC), r = Math.floor((z - bz0) / OC);
  return c < 0 || r < 0 || c >= OW || r >= OH ? 1 : occ[r * OW + c];
};
const occClear = (x, z, rad) => { for (let dx = -rad; dx <= rad; dx += OC) for (let dz = -rad; dz <= rad; dz += OC) if (occAt(x + dx, z + dz)) return false; return true; };
log('occupancy raster ready');

// Race-route corridor: no trees, lamps or walls there.
const routeCells = new Set();
for (const c of courses) {
  for (let i = 0; i + 3 < c.p.length; i += 2) {
    const ax = c.p[i], az = c.p[i + 1], bx = c.p[i + 2], bz = c.p[i + 3];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) routeCells.add((Math.floor(x / 3) + a) * 100000 + Math.floor(z / 3) + b);
    }
  }
}
const onRoute = (x, z) => routeCells.has(Math.floor(x / 3) * 100000 + Math.floor(z / 3));

// ---------------------------------------------------------------- trees and lamps
// Kinds: 0 neem/jamun (round), 1 Ashoka (columnar), 2 gulmohar (orange), 3 amaltas (yellow)
const trees = [];
const free = (x, z) => occClear(x, z, 3) && !nearRoad(x, z, 1.2, true) && !onRoute(x, z);
for (const [x, z] of osmTrees) if (!nearRoad(x, z, 0.6, true) && !onRoute(x, z) && !occAt(x, z)) trees.push([x, z, phash(x, z) < 0.05 ? 2 : 0, 0.85 + phash(z, x) * 0.4]);
roads.forEach((r, ri) => {
  if (r.t > 4 || r.b) return;
  const zn = zone(r.pts[0]);
  const green = zn === 'lutyens' || zn === 'chanakyapuri';
  if (r.t === 4 && !green) return; // colony lanes in east and central Delhi rarely have avenue trees
  const ashoka = hash(ri * 31 + 7) < (green ? 0.22 : 0.1);
  const spacing = r.t <= 3 ? (green ? 14 : 22) : 19;
  let carry = hash(ri) * spacing;
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    for (let s = carry; s < L; s += spacing) {
      for (const side of [-1, 1]) {
        const h = hash(ri * 9973 + Math.floor(s) * 7 + side + i * 131);
        const off = r.w / 2 + 3.2 + h * 1.6;
        const x = ax + dx * s - dz * off * side, z = az + dz * s + dx * off * side;
        if (h < 0.28 || !free(x, z)) continue;
        trees.push([x, z, ashoka ? 1 : h > 0.975 ? 2 : h > 0.955 ? 3 : 0, 0.8 + h * 0.45]);
      }
    }
    carry = ((carry - L) % spacing + spacing) % spacing;
  }
});
for (const a of areas) {
  if (a.k !== AREA_K.grass && a.k !== AREA_K.wood) continue;
  const density = a.k === AREA_K.wood ? 1 / 170 : a.area > 40000 ? 1 / 9000 : 1 / 1100;
  const [x0, x1, z0, z1] = bboxOf(a.outer);
  const n = Math.round(a.area * density);
  let placed = 0;
  for (let k = 0; k < n * 3 && placed < n; k++) {
    const x = x0 + hash(k * 2 + a.area) * (x1 - x0), z = z0 + hash(k * 2 + 1 + a.area * 3) * (z1 - z0);
    if (!pointInRing([x, z], a.outer) || a.holes.some((h) => pointInRing([x, z], h)) || !free(x, z)) continue;
    const h = phash(x, z);
    trees.push([x, z, h > 0.975 ? 2 : h > 0.955 ? 3 : h > 0.85 ? 1 : 0, 0.75 + h * 0.6]);
    placed++;
  }
}
// Bungalow and embassy compounds in Lutyens' Delhi and Chanakyapuri are full of trees
// that OSM rarely maps: scatter them on open ground there.
{
  const [gx0, gz0] = project(28.640, 77.160), [gx1, gz1] = project(28.578, 77.248);
  const S = 34;
  let added = 0;
  for (let x = gx0; x < gx1; x += S) for (let z = gz0; z < gz1; z += S) {
    const px = x + (hash(x * 3.1 + z) - 0.5) * S * 0.9, pz = z + (hash(z * 7.3 - x) - 0.5) * S * 0.9;
    const zn = zone([px, pz]);
    if (zn !== 'lutyens' && zn !== 'chanakyapuri') continue;
    if (Math.hypot(px - cpXY[0], pz - cpXY[1]) < 600) continue;
    if (!occClear(px, pz, 4) || nearRoad(px, pz, 3, true) || onRoute(px, pz)) continue;
    const h = phash(px, pz);
    trees.push([px, pz, h > 0.97 ? 2 : h > 0.94 ? 3 : h > 0.8 ? 1 : 0, 0.8 + h * 0.5]);
    added++;
  }
  log(`compound trees: ${added}`);
}
const lamps = [];
for (const r of roads) {
  if (r.t > 2 || r.b) continue;
  let carry = 12;
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    for (let s = carry; s < L; s += 40) {
      const off = r.w / 2 + 1.2;
      const x = ax + dx * s - dz * off, z = az + dz * s + dx * off;
      if (!occClear(x, z, 1) || onRoute(x, z)) continue;
      lamps.push([x, z, Math.atan2(dx, dz)]);
    }
    carry = ((carry - L) % 40 + 40) % 40;
  }
}
log(`trees ${trees.length}, lamps ${lamps.length}`);

// Barrier walls: drop pieces that run inside a carriageway or across a race route.
const wallPieces = [];
for (const w of barriers) {
  let cur = [];
  const flush = () => { if (cur.length > 1) wallPieces.push({ pts: cur, f: w.f }); cur = []; };
  for (const p of w.pts) {
    if (nearRoad(p[0], p[1], -0.3, true) || onRoute(p[0], p[1])) { flush(); continue; }
    cur.push(p);
  }
  flush();
}

// ---------------------------------------------------------------- cows and chai stops
const cows = [];
for (let tries = 0, k = 0; tries < 40000 && cows.length < 60 * 3; tries++) {
  const r = roads[Math.floor(hash(tries * 3 + 1) * roads.length)];
  if (r.t !== 4) continue;
  const zn = zone(r.pts[0]);
  if (zn !== 'east' && zn !== 'central' && hash(tries) > 0.15) continue;
  const p = r.pts[Math.floor(hash(tries * 7) * r.pts.length)];
  const x = p[0] + (hash(tries * 11) - 0.5) * 10, z = p[1] + (hash(tries * 13) - 0.5) * 10;
  if (!occClear(x, z, 2) || nearRoad(x, z, 0.5) || onRoute(x, z)) continue;
  cows.push(r1(x), r1(z), Math.round(hash(k++) * 628) / 100);
}
const CHAI = [
  ['indiaGate', 'India Gate lawns', -60, -70], ['samratYantra', 'Jantar Mantar', 0, 52], ['banglaSahib', 'Bangla Sahib', 70, 50],
  ['vijayChowk', 'Vijay Chowk', 40, -30], ['cpCenter', 'Central Park, CP', 70, 60], ['akshardham', 'Akshardham', 0, 150],
  ['laxmiNagar', 'Laxmi Nagar market', 0, 30], ['madhuVihar', 'Madhu Vihar', 0, 0], ['yamunaSports', 'Yamuna Sports Complex', -60, 60],
  ['nehruPark', 'Nehru Park, Chanakyapuri', 0, 0], ['humayunTomb', 'Humayun’s Tomb', 0, 130], ['lodhiGarden', 'Lodhi Garden', 0, 0],
];
const chai = [];
for (const [k, label, dx, dz] of CHAI) {
  const base = LMXY[k];
  let x = base[0] + dx, z = base[1] + dz;
  for (let i = 0; i < 600 && !occClear(x, z, 4); i++) { const a = i * 0.7, rr = 2 + i * 0.6; x = base[0] + dx + Math.cos(a) * rr; z = base[1] + dz + Math.sin(a) * rr; }
  chai.push({ x: r1(x), z: r1(z), label });
}

// ---------------------------------------------------------------- metro lines (Delhi Metro and RapidX)
const railTags = new Map();
for (const e of elements) if (e.type === 'way' && e.tags?.railway) railTags.set(e.id, e.tags);
const [mx0, mz0] = [bx0 - 400, bz0 - 400], [mx1, mz1] = [bx1 + 400, bz1 + 400];
const inMetroBox = ([x, z]) => x > mx0 && x < mx1 && z > mz0 && z < mz1;
const metro = [];
for (const rel of extras) {
  if (rel.type !== 'relation' || !/^(subway|light_rail)$/.test(rel.tags?.route || '')) continue;
  const ways = rel.members.filter((m) => m.type === 'way' && ['', 'forward', 'backward'].includes(m.role) && m.geometry?.length > 1);
  // Chain member ways in order, flipping each to continue from the previous end.
  const pts = [], modes = [];
  for (const m of ways) {
    let g = geomToPts(m.geometry);
    const tags = railTags.get(m.ref) || { railway: /RRTS|RapidX/i.test(rel.tags.name || '') ? 'rail' : 'subway', bridge: 'yes' };
    if (pts.length) {
      const last = pts[pts.length - 1];
      const d0 = Math.hypot(g[0][0] - last[0], g[0][1] - last[1]), d1 = Math.hypot(g[g.length - 1][0] - last[0], g[g.length - 1][1] - last[1]);
      if (d1 < d0) g = g.slice().reverse();
      if (Math.min(d0, d1) > 60) { pts.push(null); modes.push(-1); } // gap: break the line
    }
    const mode = railMode(tags, g[Math.floor(g.length / 2)]);
    for (const p of g) { pts.push(p); modes.push(mode); }
  }
  // Split at gaps, clip to the map, keep runs with something visible.
  let run = [], runModes = [];
  const flush = () => {
    if (run.length > 3 && runModes.some((m) => m > 0)) {
      // Drop duplicate points and simplify lightly.
      const P = [], M = [];
      run.forEach((p, i) => { if (!P.length || Math.hypot(p[0] - P[P.length - 1][0], p[1] - P[P.length - 1][1]) > 1) { P.push(p); M.push(runModes[i]); } });
      const stops = rel.members.filter((m) => m.type === 'node' && /stop/.test(m.role) && m.lat).map((m) => project(m.lat, m.lon));
      let cum = 0;
      const cumArr = P.map((p, i) => (i ? (cum += Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1])) : 0));
      const stopD = [];
      for (const sp of stops) {
        let bd = Infinity, bi = -1;
        P.forEach((p, i) => { const d = Math.hypot(p[0] - sp[0], p[1] - sp[1]); if (d < bd) { bd = d; bi = i; } });
        if (bd < 60) stopD.push(Math.round(cumArr[bi]));
      }
      metro.push({ n: rel.tags.name || '', c: rel.tags.colour || '#888888', r: rel.tags.ref || '', p: enc(P), m: M, s: [...new Set(stopD)].sort((a, b) => a - b) });
    }
    run = []; runModes = [];
  };
  pts.forEach((p, i) => {
    if (!p || !inMetroBox(p)) { flush(); return; }
    run.push(p); runModes.push(modes[i]);
  });
  flush();
}
log(`metro: ${metro.length} line runs, ${metro.reduce((a, l) => a + l.s.length, 0)} stops`);

const stations = [];
for (const e of extras) {
  const t = e.tags || {};
  if (e.type !== 'node' || !(t.railway === 'station' || t.public_transport === 'station') || !t.name) continue;
  const [x, z] = project(e.lat, e.lon);
  if (x < bx0 || x > bx1 || z < bz0 || z > bz1) continue;
  if (stations.some((s) => s.n === t.name && Math.hypot(s.x - x, s.z - z) < 300)) continue;
  stations.push({ n: t.name.replace(/\s*metro station$/i, ''), x: r1(x), z: r1(z), t: t.station || t.railway || '' });
}

// Elevated stations: lift station buildings beside elevated metro track onto the viaduct.
{
  const g = new Grid(50);
  for (const r of rails) if (r.e && r.metro) for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
    g.add([Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz)], [ax, az, bx, bz]);
  }
  let lifted = 0;
  for (const b of buildings) {
    const isStation = /metro|station|\(.*line\)/i.test(b.name) || ['train_station', 'transportation', 'roof'].includes(b.t.building);
    if (!isStation) continue;
    if (!g.near(b.c[0], b.c[1], (s) => distSeg(b.c[0], b.c[1], s[0], s[1], s[2], s[3]) < 30)) continue;
    if (b.t.building === 'roof') { b.mh = 15.5; b.h = Math.max(b.h, 18); }
    else { b.mh = 8.4; b.h = Math.max(b.h, 17.5); }
    b.kind = 2;
    lifted++;
  }
  log(`elevated station buildings: ${lifted}`);
}

// ---------------------------------------------------------------- street food stalls
// Thelas and stalls on the footpath near markets, eateries, metro exits and landmarks.
// Types: 0 chhole kulche, 1 shikanji, 2 golgappe, 3 chai, 4 momos, 5 bhutta, 6 kulfi
const STALL_W = [0.24, 0.2, 0.16, 0.14, 0.12, 0.07, 0.07];
const pickType = (h) => { let a = 0; for (let i = 0; i < STALL_W.length; i++) { a += STALL_W[i]; if (h < a) return i; } return 0; };
const stalls = [];
const stallGrid = new Grid(40);
function placeStall(x, z, type, rng) {
  // Snap to the verge of the nearest road and face the road.
  let best = null, bd = Infinity;
  roadGrid.near(x, z, (sg) => {
    if (sg[5] || sg[6] > 4) return false;
    const [ax, az, bx, bz, half] = sg;
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    if (L2 < 1) return false;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; best = { px, pz, dx, dz, half, L: Math.sqrt(L2) }; }
    return false;
  });
  if (!best || bd > 45) return false;
  const nx = -best.dz / best.L, nz = best.dx / best.L;
  const side = (x - best.px) * nx + (z - best.pz) * nz >= 0 ? 1 : -1;
  const off = best.half + 1.9 + rng * 0.8;
  const sx = best.px + nx * off * side, sz = best.pz + nz * off * side;
  if (!occClear(sx, sz, 2) || onRoute(sx, sz) || nearRoad(sx, sz, 0.3, true)) return false;
  if (stallGrid.near(sx, sz, (o) => Math.hypot(o.x - sx, o.z - sz) < 14)) return false;
  // Face the road (stall front = local -Z).
  const yaw = Math.atan2(nx * side, nz * side);
  const st = { x: sx, z: sz, yaw, type };
  stalls.push(st);
  stallGrid.add([sx, sx, sz, sz], st);
  return true;
}
{
  let k = 0;
  const anchors = [];
  for (const e of extras) {
    const t = e.tags || {};
    if (e.type === 'node' && /^(fast_food|food_court)$/.test(t.amenity)) anchors.push([project(e.lat, e.lon), 0.55]);
    if (e.type === 'node' && t.railway === 'subway_entrance') anchors.push([project(e.lat, e.lon), 0.5]);
    if (t.amenity === 'marketplace') {
      const c = e.type === 'node' ? project(e.lat, e.lon) : e.bounds ? project((e.bounds.minlat + e.bounds.maxlat) / 2, (e.bounds.minlon + e.bounds.maxlon) / 2) : null;
      if (c) for (let i = 0; i < 4; i++) anchors.push([[c[0] + (hash(k++) - 0.5) * 120, c[1] + (hash(k++) - 0.5) * 120], 1]);
    }
  }
  // Well-known street-food spots.
  const SPOTS = [
    ['indiaGate', 6, 260, [6, 3, 5, 2]], ['cpCenter', 10, 380, [0, 1, 2, 4]], ['laxmiNagar', 8, 300, [0, 1, 2, 4]], ['madhuVihar', 5, 250, [0, 1, 3]],
    ['preetVihar', 4, 250, [0, 2, 4]], ['patparganj', 4, 300, [0, 1, 3]], ['ito', 3, 200, [3, 1]], ['ndls', 6, 300, [0, 3, 1]],
    ['yamunaSports', 3, 250, [1, 3, 5]], ['akshardham', 3, 260, [1, 6, 5]], ['lodhiGarden', 2, 300, [3, 1]], ['jantarMantar', 3, 200, [3, 1, 0]],
  ];
  for (const [key, n, r, types] of SPOTS) {
    const L = LMXY[key];
    if (!L) continue;
    for (let i = 0, made = 0; i < n * 12 && made < n; i++) {
      const a = hash(k++) * Math.PI * 2, d = hash(k++) * r;
      if (placeStall(L[0] + Math.cos(a) * d, L[1] + Math.sin(a) * d, types[Math.floor(hash(k++) * types.length)], hash(k++))) made++;
    }
  }
  for (const [[x, z], p] of anchors) if (hash(k++) < p) placeStall(x + (hash(k++) - 0.5) * 20, z + (hash(k++) - 0.5) * 20, pickType(hash(k++)), hash(k++));
  // A sprinkling along busy roads in markets and colonies.
  roads.forEach((r, ri) => {
    if (r.t < 2 || r.t > 4 || r.b) return;
    const zn = zone(r.pts[0]);
    const rate = zn === 'east' || zn === 'central' ? 1 / 380 : zn === 'riverside' ? 1 / 900 : 1 / 1500;
    let len = 0;
    for (let i = 0; i + 1 < r.pts.length; i++) len += Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]);
    const n = Math.floor(len * rate + hash(ri * 7 + 3));
    for (let j = 0; j < n; j++) {
      const p = r.pts[Math.floor(hash(ri * 31 + j * 13) * r.pts.length)];
      placeStall(p[0] + (hash(k++) - 0.5) * 6, p[1] + (hash(k++) - 0.5) * 6, pickType(hash(k++)), hash(k++));
    }
  });
  log(`food stalls: ${stalls.length} (${STALL_W.map((_, i) => stalls.filter((s) => s.type === i).length).join('/')})`);
}

// ---------------------------------------------------------------- tiles
const tiles = new Map();
const tileKey = (x, z) => `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;
const tile = (x, z) => {
  const k = tileKey(x, z);
  let t = tiles.get(k);
  if (!t) tiles.set(k, (t = { b: [], t: [], l: [], w: [], d: [], s: [] }));
  return t;
};
for (const b of buildings) {
  const pts = simplify([...b.outer, b.outer[0]], 0.2).slice(0, -1);
  if (pts.length < 3) continue;
  const o = { h: Math.round(b.h * 10), k: b.kind, p: enc(pts) };
  if (b.mh > 0) o.m = Math.round(b.mh * 10);
  if (b.holes.length) o.q = b.holes.map(enc);
  if (b.name) o.n = b.name;
  tile(b.c[0], b.c[1]).b.push(o);
}
for (const [x, z, k, s] of trees) tile(x, z).t.push(Math.round(x * 10), Math.round(z * 10), k, Math.round(s * 100));
for (const [x, z, yaw] of lamps) tile(x, z).l.push(Math.round(x * 10), Math.round(z * 10), Math.round(yaw * 1000));
for (const w of wallPieces) tile(w.pts[0][0], w.pts[0][1]).w.push({ f: w.f, p: enc(w.pts) });
for (const st of stalls) tile(st.x, st.z).s.push(Math.round(st.x * 10), Math.round(st.z * 10), Math.round(st.yaw * 1000), st.type);
for (const d of domes) tile(d.x, d.z).d.push(Math.round(d.x * 10), Math.round(d.z * 10), Math.round(d.top * 10), Math.round(d.r * 10), d.style);

fs.rmSync(TILE_DIR, { recursive: true, force: true });
fs.mkdirSync(TILE_DIR, { recursive: true });
let tileBytes = 0;
const tileIndex = [];
for (const [k, t] of tiles) {
  const s = JSON.stringify(t);
  fs.writeFileSync(path.join(TILE_DIR, `${k}.json`), s);
  tileBytes += s.length;
  const [tx, tz] = k.split('_').map(Number);
  tileIndex.push([tx, tz, t.b.length]);
}
log(`tiles: ${tiles.size}, ${(tileBytes / 1e6).toFixed(1)} MB total, densest ${Math.max(...tileIndex.map((t) => t[2]))} buildings`);

// ---------------------------------------------------------------- global output
const landmarks = Object.fromEntries(Object.entries(LMXY).map(([k, [x, z]]) => [k, [r1(x), r1(z)]]));
const out = {
  attribution: 'Map data © OpenStreetMap contributors (ODbL 1.0). Building footprints: Overture Maps Foundation, Google Open Buildings (CC BY 4.0), Microsoft ML Buildings (ODbL).',
  origin: ORIGIN,
  bounds: { minX: r1(bx0), maxX: r1(bx1), minZ: r1(bz0), maxZ: r1(bz1) },
  tileSize: TILE,
  tiles: tileIndex,
  landmarks,
  roads: roads.map((r) => ({ n: r.n, t: r.t, w: r.w, o: r.o, b: r.b, l: r.l, p: enc(r.pts) })),
  areas: areas.sort((a, b) => b.area - a.area).map((a) => { const o = { k: a.k, p: enc(a.outer) }; if (a.holes.length) o.q = a.holes.map(enc); return o; }),
  rails: rails.map((r) => ({ e: r.e, m: r.metro, p: enc(r.pts) })),
  cows,
  chai,
  metro,
  stations,
  courses,
};
const outFile = path.join(OUT_DIR, 'delhi.json');
fs.writeFileSync(outFile, JSON.stringify(out));
log(`buildings ${buildings.length} (OSM ${buildings.filter((b) => b.src === 'osm').length}, ML ${buildings.filter((b) => b.src === 'ml').length}), roads ${roads.length}, areas ${areas.length}`);
log(`wrote ${outFile} (${(fs.statSync(outFile).size / 1e6).toFixed(2)} MB)`);
