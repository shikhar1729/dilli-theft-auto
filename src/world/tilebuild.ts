// Builds the meshes and collision for one 1 km map tile: roads, parks and water,
// rail and metro viaducts, buildings (OSM + ML footprints), domes, compound
// walls, trees and street lamps. Work is split into small steps (a generator) so
// tiles stream in while driving without long frame stalls.
import * as THREE from 'three';
import type { MapData, RoadNetwork, WallIndex, TileData } from '../map';
import { ROAD_TYPE, AREA } from '../map';
import { terrainHeight, inHillRegion } from '../terrain';
import { MeshBuilder, drapePolygon, densify, ribbon, disc, triangulate, hash01, offsetPolyline, mergeGeometries, paint } from '../geom';
import { materials, KIND_COLORS, ROOF_COLORS } from './materials';

export interface Piece { i: number; a: number; b: number } // feature index, vertex range [a, b]

/** Splits polylines into per-tile pieces (each segment goes to the tile of its midpoint). */
export function bucketPolylines(lines: { p: number[] }[], tile: number) {
  const out = new Map<string, Piece[]>();
  lines.forEach((l, i) => {
    const p = l.p;
    const n = p.length / 2;
    let start = 0, cur = '';
    for (let s = 0; s < n - 1; s++) {
      const k = `${Math.floor((p[s * 2] + p[s * 2 + 2]) / 2 / tile)}_${Math.floor((p[s * 2 + 1] + p[s * 2 + 3]) / 2 / tile)}`;
      if (s === 0) cur = k;
      if (k !== cur) {
        push(cur, i, start, s);
        start = s; cur = k;
      }
    }
    push(cur, i, start, n - 1);
  });
  function push(k: string, i: number, a: number, b: number) {
    let list = out.get(k);
    if (!list) out.set(k, (list = []));
    list.push({ i, a, b });
  }
  return out;
}

/** Areas: small ones go to the tile of their centroid, big ones (river, large parks) are global. */
export function bucketAreas(map: MapData, tile: number) {
  const global: number[] = [];
  const tiles = new Map<string, number[]>();
  map.areas.forEach((a, i) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, cx = 0, cz = 0;
    const n = a.p.length / 2;
    for (let k = 0; k < a.p.length; k += 2) {
      x0 = Math.min(x0, a.p[k]); x1 = Math.max(x1, a.p[k]); z0 = Math.min(z0, a.p[k + 1]); z1 = Math.max(z1, a.p[k + 1]);
      cx += a.p[k]; cz += a.p[k + 1];
    }
    if (Math.max(x1 - x0, z1 - z0) > tile * 1.1 || a.k === AREA.river) { global.push(i); return; }
    const k = `${Math.floor(cx / n / tile)}_${Math.floor(cz / n / tile)}`;
    let list = tiles.get(k);
    if (!list) tiles.set(k, (list = []));
    list.push(i);
  });
  return { global, tiles };
}

const slice = (p: number[], a: number, b: number) => p.slice(a * 2, b * 2 + 2);

// ---------------------------------------------------------------- roads

export interface RoadSink {
  roadB: MeshBuilder[]; footB: MeshBuilder; kerbB: MeshBuilder; dashB: MeshBuilder; edgeB: MeshBuilder;
  deckB: MeshBuilder; sideB: MeshBuilder; pillars: THREE.Matrix4[];
}
export function newRoadSink(): RoadSink {
  return {
    roadB: materials().roads.map(() => new MeshBuilder()), footB: new MeshBuilder(), kerbB: new MeshBuilder(), dashB: new MeshBuilder(), edgeB: new MeshBuilder(),
    deckB: new MeshBuilder(), sideB: new MeshBuilder(true), pillars: [],
  };
}

/** Adds road pieces to the sink (call in batches), then finishRoads() once. */
export function addRoads(map: MapData, net: RoadNetwork, pieces: Piece[], sink: RoadSink, walls: WallIndex, layer: string) {
  const { roadB, footB, kerbB, dashB, edgeB, deckB, sideB, pillars } = sink;
  const matIndexFor = (t: number) => (t <= 2 ? 0 : t === 3 ? 1 : t === 4 ? 2 : t === 5 ? 3 : 4);
  for (const pc of pieces) {
    const r = map.roads[pc.i];
    const deck = net.deck.get(pc.i);
    const raw = slice(r.p, pc.a, pc.b);
    if (deck) { buildDeck(raw, r.w, deck.slice(pc.a, pc.b + 1), deckB, sideB, pillars, walls, layer); continue; }
    const mi = matIndexFor(r.t);
    const pts = densify(raw, 40, 8);
    ribbon(roadB[mi], pts, r.w, 0.03, { worldUV: 10 });
    for (let v = pc.a; v <= pc.b; v++) {
      const first = v === 0, last = v === r.p.length / 2 - 1;
      if (first || last || r.t <= 4) disc(roadB[mi], r.p[v * 2], r.p[v * 2 + 1], r.w / 2, 0.03, 10);
    }
    if (r.t <= ROAD_TYPE.minor) {
      // Footpath / verge and the black-and-yellow painted kerb stones.
      ribbon(footB, pts, r.w + (r.t <= 3 ? 5 : 3), 0.02, { worldUV: 4 });
      if (r.t <= 3) {
        ribbon(kerbB, pts, 0.45, 0.04, { offset: r.w / 2 + 0.2, uLen: 2 });
        ribbon(kerbB, pts, 0.45, 0.04, { offset: -(r.w / 2 + 0.2), uLen: 2 });
      }
    }
    if (r.t <= 3 && r.w >= 7) {
      if (!r.o) ribbon(dashB, pts, 0.18, 0.05, { uLen: 9 });
      ribbon(edgeB, pts, 0.14, 0.05, { offset: r.w / 2 - 0.6, uLen: 9 });
      ribbon(edgeB, pts, 0.14, 0.05, { offset: -(r.w / 2 - 0.6), uLen: 9 });
    }
  }
}

export function finishRoads(sink: RoadSink, group: THREE.Group) {
  const M = materials();
  const { roadB, footB, kerbB, dashB, edgeB, deckB, sideB, pillars } = sink;
  add(group, footB, M.foot);
  roadB.forEach((b, i) => add(group, b, M.roads[i]));
  add(group, kerbB, M.kerb);
  add(group, dashB, M.dash);
  add(group, edgeB, M.edge);
  const dm = add(group, deckB, M.deck); if (dm) dm.castShadow = true;
  const sm = add(group, sideB, M.concrete); if (sm) sm.castShadow = true;
  if (pillars.length) {
    const g = new THREE.CylinderGeometry(0.9, 1.1, 1, 10);
    g.translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(g, M.pillar, pillars.length);
    pillars.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
}

function add(group: THREE.Group, b: MeshBuilder, mat: THREE.Material) {
  if (!b.count) return null;
  const m = new THREE.Mesh(b.build(), mat);
  m.receiveShadow = true;
  group.add(m);
  return m;
}

function buildDeck(flat: number[], width: number, deck: number[], top: MeshBuilder, sides: MeshBuilder, pillars: THREE.Matrix4[], walls: WallIndex, layer: string) {
  const pts: number[] = [], hs: number[] = [];
  for (let i = 0; i + 2 < flat.length; i += 2) {
    const ax = flat[i], az = flat[i + 1], bx = flat[i + 2], bz = flat[i + 3];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 6));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      pts.push(x, z);
      hs.push(terrainHeight(x, z) + deck[i / 2] + (deck[i / 2 + 1] - deck[i / 2]) * t);
    }
  }
  if (pts.length < 4) return;
  ribbon(top, pts, width, 0.02, { worldUV: 10, heights: hs });
  const concrete = new THREE.Color(0xc9c2b4), rail = new THREE.Color(0xe2ddd2);
  const n = pts.length / 2;
  for (const side of [-1, 1]) {
    const edge = offsetPolyline(pts, (side * width) / 2);
    for (let i = 0; i < n - 1; i++) {
      const x0 = edge[i * 2], z0 = edge[i * 2 + 1], x1 = edge[i * 2 + 2], z1 = edge[i * 2 + 3];
      const y0 = hs[i], y1 = hs[i + 1];
      const quad = (ya0: number, ya1: number, yb0: number, yb1: number, c: THREE.Color) => {
        const a = [x0, ya0, z0], b = [x1, ya1, z1], cc = [x1, yb1, z1], d = [x0, yb0, z0];
        const tri = (p: number[], q: number[], r: number[]) => { sides.vert(p[0], p[1], p[2], 0, 0, c); sides.vert(q[0], q[1], q[2], 0, 0, c); sides.vert(r[0], r[1], r[2], 0, 0, c); };
        if (side > 0) { tri(a, cc, b); tri(a, d, cc); } else { tri(a, b, cc); tri(a, cc, d); }
      };
      quad(y0 + 1.0, y1 + 1.0, y0 - 1.3, y1 - 1.3, concrete);
      quad(y0 + 1.05, y1 + 1.05, y0 + 0.95, y1 + 0.95, rail);
    }
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) acc += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const x = pts[i * 2], z = pts[i * 2 + 1];
    const ground = terrainHeight(x, z);
    const clearance = hs[i] - ground;
    if (clearance > 3.2 && acc > 26) {
      acc = 0;
      const s = Math.min(2.4, width / 6);
      pillars.push(new THREE.Matrix4().compose(new THREE.Vector3(x, ground, z), new THREE.Quaternion(), new THREE.Vector3(s, clearance - 1.2, s)));
      walls.addCircle(x, z, 1.0 * s, ground, ground + clearance - 1.5, 8, layer);
    }
  }
}

// ---------------------------------------------------------------- areas and rail

export function buildAreas(map: MapData, ids: number[], group: THREE.Group) {
  const M = materials();
  const builders = new Map<number, MeshBuilder>();
  const waterB = new MeshBuilder();
  for (const i of ids) {
    const a = map.areas[i];
    if (a.k === AREA.water || a.k === AREA.river) { drapePolygon(waterB, a.p, a.q, a.k === AREA.river ? 0.04 : 0.05, 20); continue; }
    if (!M.areas[a.k]) continue;
    let b = builders.get(a.k);
    if (!b) builders.set(a.k, (b = new MeshBuilder()));
    drapePolygon(b, a.p, a.q, 0.02, a.k === AREA.plaza ? 4 : 18);
  }
  for (const [k, b] of builders) add(group, b, M.areas[k]);
  add(group, waterB, M.water);
}

export function buildRails(map: MapData, pieces: Piece[], group: THREE.Group, walls: WallIndex, layer: string) {
  const M = materials();
  const ballast = new MeshBuilder(), steel = new MeshBuilder();
  const viaduct = new MeshBuilder(true);
  const pillars: THREE.Matrix4[] = [];
  const grey = new THREE.Color(0xc7c2b8), under = new THREE.Color(0x9e988e), track = new THREE.Color(0x5e5a55);
  for (const pc of pieces) {
    const r = map.rails[pc.i];
    const pts = densify(slice(r.p, pc.a, pc.b), 30, 8);
    if (!r.e) {
      ribbon(ballast, pts, 3.4, 0.03, { worldUV: 3 });
      ribbon(steel, pts, 0.12, 0.08, { offset: 0.72, uLen: 10 });
      ribbon(steel, pts, 0.12, 0.08, { offset: -0.72, uLen: 10 });
      continue;
    }
    // Elevated metro / rail viaduct: a concrete box girder on single piers.
    const H = r.m ? 10.5 : 7.5;
    const hs = [];
    for (let i = 0; i < pts.length; i += 2) hs.push(terrainHeight(pts[i], pts[i + 1]) + H);
    ribbon(viaduct, pts, 5.2, 0, { heights: hs, color: track });
    const n = pts.length / 2;
    for (const side of [-1, 1]) {
      const e = offsetPolyline(pts, side * 2.6);
      for (let i = 0; i < n - 1; i++) {
        const a = [e[i * 2], hs[i], e[i * 2 + 1]], b = [e[i * 2 + 2], hs[i + 1], e[i * 2 + 3]];
        const tri = (p: number[], q: number[], s: number[], c: THREE.Color) => { viaduct.vert(p[0], p[1], p[2], 0, 0, c); viaduct.vert(q[0], q[1], q[2], 0, 0, c); viaduct.vert(s[0], s[1], s[2], 0, 0, c); };
        const lo = (p: number[], d: number) => [p[0], p[1] - d, p[2]];
        if (side > 0) { tri(a, lo(b, 1.8), b, grey); tri(a, lo(a, 1.8), lo(b, 1.8), grey); tri(a, b, [b[0], b[1] + 1.1, b[2]], grey); tri(a, [b[0], b[1] + 1.1, b[2]], [a[0], a[1] + 1.1, a[2]], grey); }
        else { tri(a, b, lo(b, 1.8), grey); tri(a, lo(b, 1.8), lo(a, 1.8), grey); tri(a, [b[0], b[1] + 1.1, b[2]], b, grey); tri(a, [a[0], a[1] + 1.1, a[2]], [b[0], b[1] + 1.1, b[2]], grey); }
      }
    }
    // Underside.
    const low = hs.map((h) => h - 1.8);
    const flipped: number[] = [];
    for (let i = pts.length - 2; i >= 0; i -= 2) flipped.push(pts[i], pts[i + 1]);
    ribbon(viaduct, flipped, 5.2, 0, { heights: low.slice().reverse(), color: under });
    let acc = 0;
    for (let i = 1; i < n; i++) {
      acc += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      if (acc < 28) continue;
      acc = 0;
      const x = pts[i * 2], z = pts[i * 2 + 1], g = terrainHeight(x, z);
      pillars.push(new THREE.Matrix4().compose(new THREE.Vector3(x, g, z), new THREE.Quaternion(), new THREE.Vector3(1.4, H - 1.8, 1.4)));
      walls.addCircle(x, z, 1.3, g, g + H - 2, 8, layer);
    }
  }
  add(group, ballast, M.ballast);
  add(group, steel, M.steel);
  const vm = add(group, viaduct, M.concrete);
  if (vm) vm.castShadow = true;
  if (pillars.length) {
    const g = new THREE.CylinderGeometry(0.9, 1.0, 1, 10);
    g.translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(g, M.pillar, pillars.length);
    pillars.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
}

// ---------------------------------------------------------------- buildings

export interface BuildingSink {
  walls: MeshBuilder[];
  roof: MeshBuilder;
  tanks: THREE.Matrix4[];
}
export function newBuildingSink(): BuildingSink {
  return { walls: materials().facades.map(() => new MeshBuilder(true, true)), roof: new MeshBuilder(true, true), tanks: [] };
}

const COL = 3.6;
const tint = new THREE.Color();
const roofCol = new THREE.Color();

/** Emits buildings [from, to) of a tile into the sink and registers their collision walls. */
export function buildBuildings(data: TileData, from: number, to: number, sink: BuildingSink, walls: WallIndex, layer: string) {
  for (let bi = from; bi < to; bi++) {
    const b = data.b[bi];
    const flat = b.p;
    const n = flat.length / 2;
    if (n < 3) continue;
    const h = b.h / 10, minH = (b.m ?? 0) / 10;
    let base = 0;
    if (inHillRegion(flat[0], flat[1], 30)) {
      base = Infinity;
      for (let i = 0; i < n; i++) base = Math.min(base, terrainHeight(flat[i * 2], flat[i * 2 + 1]));
      base -= 0.3;
    }
    const top = base + h, bottom = base + minH;
    const floors = Math.max(1, Math.round(h / 3.4));
    const floorH = h / floors;
    const seed = Math.floor(flat[0] * 13.7) ^ Math.floor(flat[1] * 7.3);
    const palette = KIND_COLORS[b.k] ?? KIND_COLORS[0];
    const hv = hash01(seed);
    tint.set(palette[Math.floor(hv * palette.length)]).multiplyScalar(0.92 + hash01(seed + 7) * 0.08);
    const wb = sink.walls[b.k] ?? sink.walls[0];
    const emitRing = (ring: number[]) => {
      const m = ring.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        // Outer rings run clockwise on screen and holes the other way, so each wall
        // faces left of its edge direction: always outward from the building.
        const x0 = ring[i * 2], z0 = ring[i * 2 + 1], x1 = ring[j * 2], z1 = ring[j * 2 + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.05) continue;
        const cols = Math.max(1, Math.round(len / COL));
        const v0 = minH / floorH, v1 = h / floorH;
        const nx = (z1 - z0) / len, nz = -(x1 - x0) / len;
        const nrm: [number, number, number] = [nx, 0, nz];
        wb.vert(x0, bottom, z0, 0, v0, tint, nrm);
        wb.vert(x1, top, z1, cols, v1, tint, nrm);
        wb.vert(x1, bottom, z1, cols, v0, tint, nrm);
        wb.vert(x0, bottom, z0, 0, v0, tint, nrm);
        wb.vert(x0, top, z0, 0, v1, tint, nrm);
        wb.vert(x1, top, z1, cols, v1, tint, nrm);
      }
    };
    emitRing(flat);
    b.q?.forEach(emitRing);
    roofCol.set(ROOF_COLORS[b.k] ?? ROOF_COLORS[0]).multiplyScalar(0.88 + hash01(seed + 3) * 0.14);
    const { verts, faces } = triangulate(flat, b.q);
    for (const [a, c, d] of faces) {
      const A = verts[a], C = verts[c], D = verts[d];
      const cross = (C.x - A.x) * (D.y - A.y) - (C.y - A.y) * (D.x - A.x);
      for (const p of cross > 0 ? [A, D, C] : [A, C, D]) sink.roof.vert(p.x, top, p.y, 0, 0, roofCol, [0, 1, 0]);
    }
    // Black water tanks on Delhi rooftops.
    if ((b.k === 0 || b.k === 6 || b.k === 2) && h > 6 && h < 40 && hv > 0.3) {
      let cx = 0, cz = 0;
      for (let i = 0; i < n; i++) { cx += flat[i * 2]; cz += flat[i * 2 + 1]; }
      cx /= n; cz /= n;
      const s = 0.7 + hash01(seed + 11) * 0.5;
      sink.tanks.push(new THREE.Matrix4().compose(new THREE.Vector3(cx + (hv - 0.5) * 2, top, cz), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
    }
    if (h > 1.5) {
      walls.addPolygon(flat, base, top, bottom, layer);
      b.q?.forEach((q) => walls.addPolygon(q, base, top, bottom, layer));
    }
  }
}

export function finishBuildings(sink: BuildingSink, group: THREE.Group) {
  const M = materials();
  sink.walls.forEach((wb, k) => {
    if (!wb.count) return;
    const mesh = new THREE.Mesh(wb.build(false), M.facades[k]);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  });
  if (sink.roof.count) {
    const roof = new THREE.Mesh(sink.roof.build(false), M.roof);
    roof.castShadow = roof.receiveShadow = true;
    group.add(roof);
  }
  if (sink.tanks.length) {
    const inst = new THREE.InstancedMesh(tankGeo(), M.tank, sink.tanks.length);
    sink.tanks.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.computeBoundingSphere();
    group.add(inst);
  }
}
let _tank: THREE.BufferGeometry | null = null;
const tankGeo = () => {
  if (!_tank) { _tank = new THREE.CylinderGeometry(0.7, 0.7, 1.5, 6, 1, false); _tank.translate(0, 0.75, 0); }
  return _tank;
};

// ---------------------------------------------------------------- domes, walls, trees, lamps

export function buildDomes(data: TileData, group: THREE.Group) {
  const d = data.d;
  if (!d.length) return;
  const M = materials();
  const white: THREE.Matrix4[] = [], stone: THREE.Matrix4[] = [];
  for (let i = 0; i < d.length; i += 5) {
    const x = d[i] / 10, z = d[i + 1] / 10, top = d[i + 2] / 10 + terrainHeight(d[i] / 10, d[i + 1] / 10), r = d[i + 3] / 10;
    (d[i + 4] ? stone : white).push(new THREE.Matrix4().compose(new THREE.Vector3(x, top, z), new THREE.Quaternion(), new THREE.Vector3(r, r, r)));
  }
  const geo = domeGeo();
  for (const [list, mat] of [[white, M.domeWhite], [stone, M.domeStone]] as const) {
    if (!list.length) continue;
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
}
let _dome: THREE.BufferGeometry | null = null;
function domeGeo() {
  if (_dome) return _dome;
  // Unit dome on a short drum, with a finial: radius 1 at the base.
  const pts = [[1.0, 0], [1.0, 0.28], [1.05, 0.3], [1.02, 0.42], [0.95, 0.68], [0.8, 0.95], [0.55, 1.18], [0.25, 1.32], [0.08, 1.4], [0.05, 1.62], [0.0, 1.7]].map(([a, b]) => new THREE.Vector2(a, b));
  _dome = new THREE.LatheGeometry(pts, 20);
  return _dome;
}

export function buildWalls(data: TileData, group: THREE.Group, walls: WallIndex, layer: string) {
  if (!data.w.length) return;
  const b = new MeshBuilder(true, true);
  const plaster = new THREE.Color(0xeee6d6), cap = new THREE.Color(0xd8cfbf), fence = new THREE.Color(0x3c4a3f);
  for (const w of data.w) {
    const p = w.p;
    const H = w.f ? 1.6 : 2.1, T = w.f ? 0.06 : 0.25;
    const col = w.f ? fence : plaster;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.1) continue;
      const nx = (bz - az) / L * T, nz = -(bx - ax) / L * T;
      const ya = terrainHeight(ax, az), yb = terrainHeight(bx, bz);
      for (const s of [1, -1]) {
        const x0 = ax + nx * s, z0 = az + nz * s, x1 = bx + nx * s, z1 = bz + nz * s;
        const n: [number, number, number] = [(nx / T) * s, 0, (nz / T) * s];
        const q = s > 0
          ? [[x0, ya, z0], [x1, yb + H, z1], [x1, yb, z1], [x0, ya, z0], [x0, ya + H, z0], [x1, yb + H, z1]]
          : [[x0, ya, z0], [x1, yb, z1], [x1, yb + H, z1], [x0, ya, z0], [x1, yb + H, z1], [x0, ya + H, z0]];
        for (const v of q) b.vert(v[0], v[1], v[2], 0, 0, col, n);
      }
      if (!w.f) {
        const c = [[ax + nx, ya + H, az + nz], [bx - nx, yb + H, bz - nz], [bx + nx, yb + H, bz + nz], [ax + nx, ya + H, az + nz], [ax - nx, ya + H, az - nz], [bx - nx, yb + H, bz - nz]];
        for (const v of c) b.vert(v[0], v[1] + 0.02, v[2], 0, 0, cap, [0, 1, 0]);
      }
      walls.addSegment(ax, az, bx, bz, Math.max(ya, yb) + H, Math.min(ya, yb), layer);
    }
  }
  const mesh = new THREE.Mesh(b.build(false), materials().vertexColor);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
}

const LEAF = [0x5a8a3a, 0x2f5f2b, 0xe4572b, 0xf0c02e]; // neem/jamun, Ashoka, gulmohar, amaltas
let treeGeos: THREE.BufferGeometry[] | null = null;
let lampGeo: THREE.BufferGeometry | null = null;
function treeGeometry(kind: number) {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.38, kind === 1 ? 4 : 5, 5, 1, true);
  trunk.translate(0, kind === 1 ? 2 : 2.5, 0);
  parts.push(paint(trunk.toNonIndexed(), 0x5b4636));
  const leaf = LEAF[kind];
  if (kind === 1) {
    for (const [y, r, h] of [[4.4, 1.3, 2.8], [6.8, 1.35, 3.0], [9.1, 1.15, 2.8], [11.2, 0.85, 2.4], [12.9, 0.5, 1.6]]) {
      const g = new THREE.IcosahedronGeometry(1, 0);
      g.scale(r, h / 2, r);
      g.translate(0, y, 0);
      parts.push(paint(g.toNonIndexed(), leaf));
    }
  } else {
    const blobs = kind === 0 ? [[0, 6.6, 0, 3.4], [1.8, 5.9, 1, 2.6], [-1.7, 6.1, -0.8, 2.7], [0.3, 8.1, -0.5, 2.3]] : [[0, 5.6, 0, 3.1], [1.6, 5.2, 0.8, 2.2], [-1.4, 5.4, -0.6, 2.3]];
    blobs.forEach(([x, y, z, r], i) => {
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.scale(1, 0.82, 1);
      g.translate(x, y, z);
      parts.push(paint(g.toNonIndexed(), new THREE.Color(leaf).multiplyScalar(0.9 + i * 0.06)));
    });
  }
  const m = mergeGeometries(parts);
  m.computeVertexNormals();
  return m;
}

export function buildTrees(data: TileData, group: THREE.Group, walls: WallIndex, layer: string) {
  const M = materials();
  treeGeos ??= [0, 1, 2, 3].map(treeGeometry);
  const t = data.t;
  const byKind: number[][] = [[], [], [], []];
  for (let i = 0; i < t.length; i += 4) byKind[t[i + 2]]?.push(i);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  byKind.forEach((list, kind) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(treeGeos![kind], M.flatColor, list.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    list.forEach((i, k) => {
      const x = t[i] / 10, z = t[i + 1] / 10, s = t[i + 3] / 100;
      const h = hash01(t[i] ^ (t[i + 1] * 3));
      q.setFromAxisAngle(up, h * Math.PI * 2);
      sc.set(s, s * (kind === 1 ? 1 : 0.9 + h * 0.25), s);
      const y = terrainHeight(x, z);
      inst.setMatrixAt(k, m4.compose(pos.set(x, y, z), q, sc));
      col.setRGB(0.88 + h * 0.18, 0.9 + ((h * 7) % 1) * 0.16, 0.86 + ((h * 13) % 1) * 0.14);
      inst.setColorAt(k, col);
      walls.addCircle(x, z, 0.45 * s, y, y + 4, 6, layer);
    });
    inst.computeBoundingSphere();
    group.add(inst);
  });
}

export function buildLamps(data: TileData, group: THREE.Group) {
  const l = data.l;
  if (!l.length) return;
  if (!lampGeo) {
    const pole = new THREE.CylinderGeometry(0.09, 0.14, 9, 5, 1, true); pole.translate(0, 4.5, 0);
    const arm = new THREE.BoxGeometry(2.2, 0.12, 0.12); arm.translate(1.1, 8.9, 0);
    const head = new THREE.BoxGeometry(0.7, 0.22, 0.32); head.translate(2.15, 8.8, 0);
    lampGeo = mergeGeometries([paint(pole, 0x3d4a46), paint(arm, 0x3d4a46), paint(head, 0xf3eedf)]);
    lampGeo.computeVertexNormals();
  }
  const inst = new THREE.InstancedMesh(lampGeo, materials().vertexColor, l.length / 3);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < l.length; i += 3) {
    const x = l[i] / 10, z = l[i + 1] / 10;
    q.setFromAxisAngle(up, l[i + 2] / 1000);
    inst.setMatrixAt(i / 3, m4.compose(pos.set(x, terrainHeight(x, z), z), q, one));
  }
  inst.computeBoundingSphere();
  group.add(inst);
}
