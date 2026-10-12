// Streams the city in 1 km tiles: fetches tile data near the focus point, builds
// meshes and collision a few milliseconds per frame, and unloads far tiles.
import * as THREE from 'three';
import type { MapData, RoadNetwork, WallIndex, TileData } from '../map';
import { decodeTile } from '../map';
import { buildStallMesh } from './stalls';
import { terrainHeight } from '../terrain';
import { bucketPolylines, bucketAreas, newRoadSink, addRoads, finishRoads, buildAreas, buildRails, newBuildingSink, buildBuildings, finishBuildings, buildDomes, buildWalls, buildTrees, buildLamps, Piece } from './tilebuild';

type Status = 'idle' | 'fetching' | 'fetched' | 'building' | 'built';

export interface Tile {
  key: string; tx: number; tz: number;
  hasFile: boolean;
  status: Status;
  data: TileData | null;
  group: THREE.Group | null;
  job: Generator<void, THREE.Group> | null;
  roads: Piece[]; rails: Piece[]; areas: number[];
  lastSeen: number;
}

const EMPTY: TileData = { b: [], t: [], l: [], w: [], d: [] };
const BATCH = 220;

export class TileManager {
  readonly group = new THREE.Group();
  readonly size: number;
  readonly tiles = new Map<string, Tile>();
  readonly globalAreas: number[];
  private inflight = 0;
  private frame = 0;
  onBuilt: (t: Tile) => void = () => {};
  onData: (t: Tile) => void = () => {};

  constructor(readonly map: MapData, readonly roads: RoadNetwork, readonly walls: WallIndex) {
    this.group.name = 'tiles';
    this.size = map.tileSize;
    const roadPieces = bucketPolylines(map.roads, this.size);
    const railPieces = bucketPolylines(map.rails, this.size);
    const areas = bucketAreas(map, this.size);
    this.globalAreas = areas.global;
    const withFile = new Set(map.tiles.map(([x, z]) => `${x}_${z}`));
    const B = map.bounds;
    for (let tx = Math.floor(B.minX / this.size); tx <= Math.floor(B.maxX / this.size); tx++) {
      for (let tz = Math.floor(B.minZ / this.size); tz <= Math.floor(B.maxZ / this.size); tz++) {
        const key = `${tx}_${tz}`;
        const r = roadPieces.get(key) ?? [], rl = railPieces.get(key) ?? [], a = areas.tiles.get(key) ?? [];
        if (!withFile.has(key) && !r.length && !rl.length && !a.length) continue;
        this.tiles.set(key, { key, tx, tz, hasFile: withFile.has(key), status: 'idle', data: null, group: null, job: null, roads: r, rails: rl, areas: a, lastSeen: 0 });
      }
    }
  }

  private dist(t: Tile, x: number, z: number) {
    const s = this.size;
    const dx = Math.max(t.tx * s - x, 0, x - (t.tx + 1) * s);
    const dz = Math.max(t.tz * s - z, 0, z - (t.tz + 1) * s);
    return Math.hypot(dx, dz);
  }

  private fetchTile(t: Tile) {
    if (!t.hasFile) { t.data = EMPTY; t.status = 'fetched'; this.onData(t); return; }
    t.status = 'fetching';
    this.inflight++;
    fetch(`${import.meta.env.BASE_URL}data/tiles/${t.key}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: TileData) => { t.data = decodeTile(d); t.status = 'fetched'; this.onData(t); })
      .catch(() => { t.data = EMPTY; t.status = 'fetched'; })
      .finally(() => { this.inflight--; });
  }

  private *buildJob(t: Tile): Generator<void, THREE.Group> {
    const g = new THREE.Group();
    g.name = `tile-${t.key}`;
    const key = t.key, data = t.data ?? EMPTY;
    const rs = newRoadSink();
    for (let i = 0; i < t.roads.length; i += 120) {
      addRoads(this.map, this.roads, t.roads.slice(i, i + 120), rs, this.walls, key);
      yield;
    }
    finishRoads(rs, g);
    yield;
    buildAreas(this.map, t.areas, g);
    buildRails(this.map, t.rails, g, this.walls, key);
    yield;
    const sink = newBuildingSink();
    for (let i = 0; i < data.b.length; i += BATCH) {
      buildBuildings(data, i, Math.min(data.b.length, i + BATCH), sink, this.walls, key);
      yield;
    }
    finishBuildings(sink, g);
    yield;
    buildDomes(data, g);
    buildWalls(data, g, this.walls, key);
    yield;
    buildTrees(data, g, this.walls, key);
    buildLamps(data, g);
    const st = data.s ?? [];
    const stalls = buildStallMesh(st, terrainHeight);
    if (stalls) g.add(stalls);
    for (let i = 0; i < st.length; i += 4) {
      const x = st[i] / 10, z = st[i + 1] / 10, y = terrainHeight(x, z);
      this.walls.addCircle(x, z, 1.25, y, y + 2.6, 8, key);
    }
    g.updateMatrixWorld(true);
    g.traverse((o) => { o.matrixAutoUpdate = false; });
    return g;
  }

  private unload(t: Tile) {
    if (t.group) {
      this.group.remove(t.group);
      t.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) (m as unknown as THREE.InstancedMesh).dispose();
        else if (m.isMesh) m.geometry.dispose();
      });
    }
    if (t.job) { t.job.return(new THREE.Group()); t.job = null; }
    this.walls.removeLayer(t.key);
    t.group = null;
    t.status = t.data ? 'fetched' : 'idle';
  }

  /** Streams tiles around (x, z). Spends at most `budgetMs` building meshes this frame. */
  update(x: number, z: number, loadR: number, unloadR: number, budgetMs = 5) {
    this.frame++;
    const wanted: Tile[] = [];
    for (const t of this.tiles.values()) {
      const d = this.dist(t, x, z);
      if (d <= loadR) { t.lastSeen = this.frame; wanted.push(t); }
      else if (d > unloadR && (t.status === 'built' || t.status === 'building')) this.unload(t);
    }
    wanted.sort((a, b) => this.dist(a, x, z) - this.dist(b, x, z));
    for (const t of wanted) if (t.status === 'idle' && this.inflight < 4) this.fetchTile(t);
    const t0 = performance.now();
    for (const t of wanted) {
      if (t.status === 'fetched') { t.status = 'building'; t.job = this.buildJob(t); }
      while (t.status === 'building' && t.job) {
        const r = t.job.next();
        if (r.done) {
          t.group = r.value;
          t.job = null;
          t.status = 'built';
          this.group.add(t.group);
          this.onBuilt(t);
        }
        if (performance.now() - t0 > budgetMs) return;
      }
    }
  }

  /** True when every tile within r of (x, z) is built. */
  ready(x: number, z: number, r: number) {
    for (const t of this.tiles.values()) if (this.dist(t, x, z) <= r && t.status !== 'built') return false;
    return true;
  }
  progress(x: number, z: number, r: number) {
    let n = 0, done = 0;
    for (const t of this.tiles.values()) if (this.dist(t, x, z) <= r) { n++; if (t.status === 'built') done++; }
    return n ? done / n : 1;
  }

  /** Builds everything within r of (x, z) with a generous per-frame budget. */
  async ensure(x: number, z: number, r: number, onProgress?: (f: number) => void) {
    while (!this.ready(x, z, r)) {
      this.update(x, z, r, r + 2000, 40);
      onProgress?.(this.progress(x, z, r));
      await new Promise((res) => { requestAnimationFrame(() => res(null)); setTimeout(() => res(null), 30); });
    }
  }

  tileAt(x: number, z: number) { return this.tiles.get(`${Math.floor(x / this.size)}_${Math.floor(z / this.size)}`); }

  /** Food stalls in built tiles near (x, z): calls fn(index key, x, z, type). */
  stallsNear(x: number, z: number, r: number, fn: (id: string, sx: number, sz: number, type: number) => void) {
    const S = this.size;
    for (let tx = Math.floor((x - r) / S); tx <= Math.floor((x + r) / S); tx++) for (let tz = Math.floor((z - r) / S); tz <= Math.floor((z + r) / S); tz++) {
      const t = this.tiles.get(`${tx}_${tz}`);
      const s = t?.status === 'built' ? t.data?.s : null;
      if (!s) continue;
      for (let i = 0; i < s.length; i += 4) {
        const sx = s[i] / 10, sz = s[i + 1] / 10;
        if (Math.abs(sx - x) < r && Math.abs(sz - z) < r) fn(`${t!.key}:${i}`, sx, sz, s[i + 3]);
      }
    }
  }
}
