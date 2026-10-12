// Map data (built by tools/build-map.mjs from OpenStreetMap) plus the spatial
// indexes the game queries every frame.
// World coordinates: metres, X = east, Z = south (north is -Z), Y = up.

import { terrainHeight } from './terrain';

export interface Road { n: string; t: number; w: number; o: number; b: number; l: number; p: number[] }
/** Tile building: heights in decimetres, footprint already decoded to metres. */
export interface Building { h: number; k: number; p: number[]; m?: number; q?: number[][]; n?: string }
export interface Area { k: number; p: number[]; q?: number[][] }
export interface Rail { e: number; m: number; p: number[] }
export interface CourseData { id: string; name: string; blurb: string; region: string; laps: number; len: number; p: number[]; s: string[] }
export interface MapData {
  attribution: string;
  origin: { lat: number; lon: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  tileSize: number;
  tiles: [number, number, number][];
  landmarks: Record<string, [number, number]>;
  roads: Road[];
  areas: Area[];
  rails: Rail[];
  cows: number[];
  chai: { x: number; z: number; label: string }[];
  metro: { n: string; c: string; r: string; p: number[]; m: number[]; s: number[] }[];
  stations: { n: string; x: number; z: number; t: string }[];
  courses: CourseData[];
}
export interface TileData {
  b: Building[];
  t: number[];             // trees: x, z (dm), kind, scale (%)
  l: number[];             // lamps: x, z (dm), yaw (mrad)
  w: { f: number; p: number[] }[]; // walls (f = 1 for fences)
  d: number[];             // domes: x, z, top (dm), radius (dm), style
  s?: number[];            // food stalls: x, z (dm), yaw (mrad), type
}

export const AREA = { grass: 1, pitch: 2, stadium: 3, wood: 4, water: 5, plaza: 6, sand: 7, river: 8 } as const;

/** Decodes delta-encoded integer decimetres into flat metre coordinates. */
export function decode(d: number[]): number[] {
  const out = new Array<number>(d.length);
  let x = 0, z = 0;
  for (let i = 0; i < d.length; i += 2) {
    x += d[i]; z += d[i + 1];
    out[i] = x / 10; out[i + 1] = z / 10;
  }
  return out;
}

function decodeMap(m: MapData) {
  for (const r of m.roads) r.p = decode(r.p);
  for (const a of m.areas) { a.p = decode(a.p); if (a.q) a.q = a.q.map(decode); }
  for (const r of m.rails) r.p = decode(r.p);
  return m;
}

export function decodeTile(t: TileData): TileData {
  for (const b of t.b) { b.p = decode(b.p); if (b.q) b.q = b.q.map(decode); }
  for (const w of t.w) w.p = decode(w.p);
  return t;
}
export const ROAD_TYPE = { trunk: 0, primary: 1, secondary: 2, tertiary: 3, minor: 4, service: 5, pedestrian: 6 } as const;

export async function loadMap(onProgress?: (f: number) => void): Promise<MapData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/delhi.json`);
  if (!res.ok) throw new Error(`Map data failed to load (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total || !onProgress) return decodeMap(await res.json());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return decodeMap(JSON.parse(new TextDecoder().decode(all)));
}

// ------------------------------------------------------------------ spatial hash of segments

export class SegmentIndex {
  readonly ax: number[] = []; readonly az: number[] = []; readonly bx: number[] = []; readonly bz: number[] = [];
  private cells = new Map<number, number[]>();
  constructor(readonly cell: number) {}
  private key(cx: number, cz: number) { return (cx + 4096) * 8192 + (cz + 4096); }
  add(ax: number, az: number, bx: number, bz: number): number {
    const id = this.ax.length;
    this.ax.push(ax); this.az.push(az); this.bx.push(bx); this.bz.push(bz);
    const c = this.cell;
    const x0 = Math.floor(Math.min(ax, bx) / c), x1 = Math.floor(Math.max(ax, bx) / c);
    const z0 = Math.floor(Math.min(az, bz) / c), z1 = Math.floor(Math.max(az, bz) / c);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      // Only register cells the segment actually passes near.
      const cxm = (i + 0.5) * c, czm = (j + 0.5) * c;
      if (distToSeg(cxm, czm, ax, az, bx, bz) > c * 0.75) continue;
      const k = this.key(i, j);
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(id);
    }
    return id;
  }
  /** Calls fn for each segment id within the cells overlapping the circle (may repeat ids across cells). */
  query(x: number, z: number, r: number, fn: (id: number) => void) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const list = this.cells.get(this.key(i, j));
      if (list) for (const id of list) fn(id);
    }
  }
}

export function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
export function segParam(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// ------------------------------------------------------------------ roads & flyover decks

export interface RoadSeg { road: number; half: number; type: number; bridge: boolean; ha: number; hb: number }

export class RoadNetwork {
  readonly index = new SegmentIndex(24);
  readonly segs: RoadSeg[] = [];
  /** Per road, per vertex deck height above terrain (only for elevated flyovers). */
  readonly deck = new Map<number, number[]>();

  constructor(readonly roads: Road[]) {
    this.computeDecks();
    roads.forEach((r, ri) => {
      const p = r.p;
      const d = this.deck.get(ri);
      for (let i = 0; i + 3 < p.length; i += 2) {
        this.index.add(p[i], p[i + 1], p[i + 2], p[i + 3]);
        this.segs.push({ road: ri, half: r.w / 2, type: r.t, bridge: !!d, ha: d ? d[i / 2] : 0, hb: d ? d[i / 2 + 1] : 0 });
      }
    });
  }

  private computeDecks() {
    // Group bridge ways into chains by shared endpoints; long chains become flyovers.
    const bridges = this.roads.map((r, i) => ({ r, i })).filter(({ r }) => r.b && r.t <= ROAD_TYPE.minor);
    const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;
    const ends = new Map<string, number[]>();
    for (const { r, i } of bridges) {
      const p = r.p;
      for (const k of [key(p[0], p[1]), key(p[p.length - 2], p[p.length - 1])]) {
        if (!ends.has(k)) ends.set(k, []);
        ends.get(k)!.push(i);
      }
    }
    const len = (p: number[]) => { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; };
    // Chain length via flood fill.
    const chainOf = new Map<number, number>();
    const chainLen: number[] = [];
    for (const { i } of bridges) {
      if (chainOf.has(i)) continue;
      const id = chainLen.length; chainLen.push(0);
      const stack = [i];
      while (stack.length) {
        const j = stack.pop()!;
        if (chainOf.has(j)) continue;
        chainOf.set(j, id);
        const p = this.roads[j].p;
        chainLen[id] += len(p);
        for (const k of [key(p[0], p[1]), key(p[p.length - 2], p[p.length - 1])]) for (const n of ends.get(k) || []) stack.push(n);
      }
    }
    const CLEAR = 6.8, RAMP = 90;
    for (const { r, i } of bridges) {
      if (chainLen[chainOf.get(i)!] < 160) continue;
      // Subdivide long straight bridge ways so the deck can rise between its ends.
      const dense: number[] = [r.p[0], r.p[1]];
      for (let v = 2; v < r.p.length; v += 2) {
        const ax = r.p[v - 2], az = r.p[v - 1], bx = r.p[v], bz = r.p[v + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 15));
        for (let k = 1; k <= n; k++) dense.push(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
      }
      r.p = dense;
      const p = r.p;
      const startJoined = (ends.get(key(p[0], p[1])) || []).length > 1;
      const endJoined = (ends.get(key(p[p.length - 2], p[p.length - 1])) || []).length > 1;
      const L = len(p);
      const hs: number[] = [];
      let s = 0;
      for (let v = 0; v < p.length; v += 2) {
        if (v > 0) s += Math.hypot(p[v] - p[v - 2], p[v + 1] - p[v - 1]);
        let h = CLEAR;
        if (!startJoined) h = Math.min(h, CLEAR * smooth(s / RAMP));
        if (!endJoined) h = Math.min(h, CLEAR * smooth((L - s) / RAMP));
        hs.push(h);
      }
      this.deck.set(i, hs);
    }
  }

  /** Nearest road info at a point (ground-level roads and decks). */
  nearest(x: number, z: number, maxR = 40) {
    let best = -1, bd = Infinity, bt = 0;
    this.index.query(x, z, maxR, (id) => {
      const ix = this.index;
      const d = distToSeg(x, z, ix.ax[id], ix.az[id], ix.bx[id], ix.bz[id]) - this.segs[id].half;
      if (d < bd) { bd = d; best = id; bt = segParam(x, z, ix.ax[id], ix.az[id], ix.bx[id], ix.bz[id]); }
    });
    return best < 0 ? null : { seg: best, dist: bd, t: bt };
  }

  /** True when (x, z) lies on a road surface at ground level. */
  onRoad(x: number, z: number): boolean {
    let hit = false;
    this.index.query(x, z, 2, (id) => {
      if (hit) return;
      const s = this.segs[id];
      if (s.type === ROAD_TYPE.pedestrian) return;
      const ix = this.index;
      if (distToSeg(x, z, ix.ax[id], ix.az[id], ix.bx[id], ix.bz[id]) <= s.half + 0.3) hit = true;
    });
    return hit;
  }

  /** Highest flyover deck under (x, z) that is no more than `reach` above y. Returns -Infinity if none. */
  deckHeight(x: number, z: number, y: number, reach = 1.6): number {
    let best = -Infinity;
    this.index.query(x, z, 2, (id) => {
      const s = this.segs[id];
      if (!s.bridge) return;
      const ix = this.index;
      const ax = ix.ax[id], az = ix.az[id], bx = ix.bx[id], bz = ix.bz[id];
      // Only the segment the point actually lies along (no clamped ends), so slopes
      // are not flattened by the next segment's height on wide roads.
      const dx = bx - ax, dz = bz - az;
      const L2 = dx * dx + dz * dz;
      if (L2 < 1e-6) return;
      const t = ((x - ax) * dx + (z - az) * dz) / L2;
      if (t < -0.02 || t > 1.02) return;
      const lat = Math.abs((x - ax) * dz - (z - az) * dx) / Math.sqrt(L2);
      if (lat > s.half + 0.4) return;
      const tc = Math.max(0, Math.min(1, t));
      const h = terrainHeight(x, z) + s.ha + (s.hb - s.ha) * tc;
      if (h <= y + reach && h > best) best = h;
    });
    return best;
  }
}

function smooth(t: number) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

// ------------------------------------------------------------------ solid walls (buildings, monuments)

interface WallLayer { index: SegmentIndex; top: number[]; bottom: number[]; x0: number; x1: number; z0: number; z1: number }

/**
 * Collision walls in layers: one global layer (landmarks, ramps) plus one per
 * streamed map tile, so a tile's walls can be dropped when it unloads.
 */
export class WallIndex {
  private layers = new Map<string, WallLayer>();
  private layer(key: string) {
    let l = this.layers.get(key);
    if (!l) this.layers.set(key, (l = { index: new SegmentIndex(16), top: [], bottom: [], x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }));
    return l;
  }
  removeLayer(key: string) { this.layers.delete(key); }
  addSegment(ax: number, az: number, bx: number, bz: number, top: number, bottom: number, key = 'global') {
    const l = this.layer(key);
    l.index.add(ax, az, bx, bz);
    l.top.push(top); l.bottom.push(bottom);
    l.x0 = Math.min(l.x0, ax, bx); l.x1 = Math.max(l.x1, ax, bx);
    l.z0 = Math.min(l.z0, az, bz); l.z1 = Math.max(l.z1, az, bz);
  }
  addPolygon(flat: number[], base: number, top: number, bottom = base, key = 'global') {
    const n = flat.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.addSegment(flat[i * 2], flat[i * 2 + 1], flat[j * 2], flat[j * 2 + 1], top, bottom, key);
    }
  }
  addCircle(x: number, z: number, r: number, base: number, top: number, sides = 10, key = 'global') {
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      pts.push(x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
    this.addPolygon(pts, base, top, base, key);
  }
  addBox(x: number, z: number, w: number, d: number, yaw: number, base: number, top: number, key = 'global') {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const pts: number[] = [];
    for (const [u, v] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
      pts.push(x + u * c + v * s, z - u * s + v * c);
    }
    this.addPolygon(pts, base, top, base, key);
  }
  /** Calls fn for every wall segment near (x, z). */
  query(x: number, z: number, r: number, fn: (ax: number, az: number, bx: number, bz: number, top: number, bottom: number) => void) {
    for (const l of this.layers.values()) {
      if (x + r < l.x0 - 1 || x - r > l.x1 + 1 || z + r < l.z0 - 1 || z - r > l.z1 + 1) continue;
      const ix = l.index;
      ix.query(x, z, r, (id) => fn(ix.ax[id], ix.az[id], ix.bx[id], ix.bz[id], l.top[id], l.bottom[id]));
    }
  }
}

export function ringArea(flat: number[]) {
  let a = 0;
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1];
  }
  return a / 2;
}

export function pointInRing(x: number, z: number, flat: number[]) {
  let inside = false;
  const n = flat.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = flat[i * 2], zi = flat[i * 2 + 1], xj = flat[j * 2], zj = flat[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Grid of polygons for point-in-area lookups (water, grass). */
export class AreaIndex {
  private cells = new Map<number, number[]>();
  constructor(readonly areas: Area[], readonly cell = 100) {
    areas.forEach((a, i) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < a.p.length; k += 2) {
        x0 = Math.min(x0, a.p[k]); x1 = Math.max(x1, a.p[k]);
        z0 = Math.min(z0, a.p[k + 1]); z1 = Math.max(z1, a.p[k + 1]);
      }
      for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++)
        for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) {
          const k = (cx + 4096) * 8192 + cz + 4096;
          if (!this.cells.has(k)) this.cells.set(k, []);
          this.cells.get(k)!.push(i);
        }
    });
  }
  /** Kind of the smallest area containing the point (0 when none). */
  kindAt(x: number, z: number): number {
    const k = (Math.floor(x / this.cell) + 4096) * 8192 + Math.floor(z / this.cell) + 4096;
    let kind = 0, best = Infinity;
    for (const i of this.cells.get(k) || []) {
      const a = this.areas[i];
      if (!pointInRing(x, z, a.p)) continue;
      if (a.q?.some((h) => pointInRing(x, z, h))) continue;
      const ar = Math.abs(ringArea(a.p));
      if (ar < best) { best = ar; kind = a.k; }
    }
    return kind;
  }
}
