// Delhi traffic: autos, buses, hatchbacks and taxis keeping left (India drives on
// the left), plus a few unbothered cows. Vehicles live near the player only.
import * as THREE from 'three';
import type { MapData } from './map';
import { ROAD_TYPE } from './map';
import { terrainHeight } from './terrain';
import { offsetPolyline } from './geom';
import { buildTraffic, TrafficKind } from './vehicles/models';
import type { Obstacle } from './physics';
import { bakeVertexColored } from './geom';

interface Lane { x: number[]; z: number[]; cum: number[]; len: number; next: number[]; speed: number }
interface Vehicle {
  lane: number; s: number; v: number; vmax: number; kind: TrafficKind; obj: THREE.Group;
  x: number; z: number; yaw: number; vx: number; vz: number; stop: number; honked: number; len: number;
  lastHit: number; touch: number;
}
interface Cow { x: number; z: number; yaw: number; nudge: number }

const KINDS: { kind: TrafficKind; w: number; colors: string[] }[] = [
  { kind: 'auto', w: 0.34, colors: ['#1f8a3a'] },
  { kind: 'hatch', w: 0.26, colors: ['#f2f2f0', '#c8ccd0', '#b3242a', '#2a4f8a', '#3a3a3c', '#e6e2d8'] },
  { kind: 'sedan', w: 0.2, colors: ['#f2f2f0', '#9aa0a6', '#1e2a44', '#5a1f1f'] },
  { kind: 'taxi', w: 0.08, colors: ['#18181a'] },
  { kind: 'bus', w: 0.12, colors: ['#c0392b', '#2e8b3e'] },
];

export class Traffic {
  readonly group = new THREE.Group();
  private lanes: Lane[] = [];
  private vehicles: Vehicle[] = [];
  private cows: Cow[] = [];
  private pool = new Map<string, THREE.Group[]>();
  target = 36;
  radius = 380;
  onHonk: (x: number, z: number) => void = () => {};
  onMoo: () => void = () => {};

  private cowMesh: THREE.InstancedMesh | null = null;

  constructor(map: MapData) {
    this.group.name = 'traffic';
    // Build lanes.
    for (const r of map.roads) {
      if (r.t > ROAD_TYPE.minor || r.b) continue;
      if (r.p.length < 4) continue;
      const speed = r.t <= 2 ? 13 : r.t === 3 ? 11 : 8;
      const pts = r.p;
      const rev = (p: number[]) => { const o: number[] = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); return o; };
      const add = (p: number[], off: number) => {
        const q = off ? offsetPolyline(p, off) : p;
        const x: number[] = [], z: number[] = [], cum: number[] = [0];
        for (let i = 0; i < q.length; i += 2) { x.push(q[i]); z.push(q[i + 1]); }
        for (let i = 1; i < x.length; i++) cum.push(cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]));
        if (cum[cum.length - 1] < 8) return;
        this.lanes.push({ x, z, cum, len: cum[cum.length - 1], next: [], speed });
      };
      // Keep left: offset to the left of travel (negative = left).
      if (r.o === 1) add(pts, r.w > 9 ? -r.w / 4 : 0);
      else if (r.o === -1) add(rev(pts), r.w > 9 ? -r.w / 4 : 0);
      else { add(pts, -r.w / 4); add(rev(pts), -r.w / 4); }
    }
    // Connect lane ends to lane starts.
    const starts = new Map<string, number[]>();
    const key = (x: number, z: number) => `${Math.round(x / 8)},${Math.round(z / 8)}`;
    this.lanes.forEach((l, i) => {
      const k = key(l.x[0], l.z[0]);
      if (!starts.has(k)) starts.set(k, []);
      starts.get(k)!.push(i);
    });
    this.lanes.forEach((l, i) => {
      const ex = l.x[l.x.length - 1], ez = l.z[l.z.length - 1];
      const cx = Math.round(ex / 8), cz = Math.round(ez / 8);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const j of starts.get(`${cx + a},${cz + b}`) || []) {
          if (j === i) continue;
          const o = this.lanes[j];
          if (Math.hypot(o.x[0] - ex, o.z[0] - ez) > 9) continue;
          // Skip immediate U-turns.
          const d1x = l.x[l.x.length - 1] - l.x[l.x.length - 2], d1z = l.z[l.z.length - 1] - l.z[l.z.length - 2];
          const d2x = o.x[1] - o.x[0], d2z = o.z[1] - o.z[0];
          if ((d1x * d2x + d1z * d2z) / (Math.hypot(d1x, d1z) * Math.hypot(d2x, d2z) || 1) < -0.6) continue;
          l.next.push(j);
        }
      }
    });
    // Cows on verges, mostly in East Delhi and the older northern lanes (placed by the map build).
    for (let i = 0; i < map.cows.length; i += 3) this.cows.push({ x: map.cows[i], z: map.cows[i + 1], yaw: map.cows[i + 2], nudge: 0 });
    if (this.cows.length) {
      const geo = bakeVertexColored(cowMesh())!;
      this.cowMesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), this.cows.length);
      this.cowMesh.castShadow = true;
      this.cows.forEach((c, i) => this.placeCow(c, i));
      this.cowMesh.computeBoundingSphere();
      this.group.add(this.cowMesh);
    }
  }

  private placeCow(c: Cow, i: number) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(c.x, terrainHeight(c.x, c.z), c.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, c.yaw, c.nudge > 0 ? Math.sin(c.nudge * 30) * 0.05 * c.nudge : 0)),
      new THREE.Vector3(1, 1, 1),
    );
    this.cowMesh!.setMatrixAt(i, m);
    this.cowMesh!.instanceMatrix.needsUpdate = true;
  }

  private take(kind: TrafficKind, color: string) {
    const k = kind + color;
    const list = this.pool.get(k);
    const obj = list?.pop() ?? buildTraffic(kind, color);
    obj.visible = true;
    this.group.add(obj);
    return obj;
  }
  private release(v: Vehicle) {
    this.group.remove(v.obj);
    const k = v.kind + (v.obj.userData.color as string);
    if (!this.pool.has(k)) this.pool.set(k, []);
    this.pool.get(k)!.push(v.obj);
  }

  clear() {
    for (const v of this.vehicles) this.release(v);
    this.vehicles = [];
  }

  private spawn(fx: number, fz: number, rnd: () => number, avoid?: (x: number, z: number) => boolean) {
    for (let t = 0; t < 30; t++) {
      const li = Math.floor(rnd() * this.lanes.length);
      const l = this.lanes[li];
      const s = rnd() * l.len;
      const i = this.indexAt(l, s);
      const d = Math.hypot(l.x[i] - fx, l.z[i] - fz);
      if (d < 110 || d > this.radius) continue;
      if (avoid?.(l.x[i], l.z[i])) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - l.x[i], v.z - l.z[i]) < 14)) continue;
      let r = rnd() * KINDS.reduce((a, k) => a + k.w, 0);
      let K = KINDS[0];
      for (const k of KINDS) { r -= k.w; if (r <= 0) { K = k; break; } }
      if (K.kind === 'bus' && l.speed < 11) K = KINDS[1];
      const color = K.colors[Math.floor(rnd() * K.colors.length)];
      const obj = this.take(K.kind, color);
      obj.userData.color = color;
      const vmax = l.speed * (K.kind === 'auto' ? 0.85 : K.kind === 'bus' ? 0.8 : 1) * (0.85 + rnd() * 0.3);
      this.vehicles.push({ lane: li, s, v: vmax * 0.8, vmax, kind: K.kind, obj, x: l.x[i], z: l.z[i], yaw: 0, vx: 0, vz: 0, stop: 0, honked: 0, len: K.kind === 'bus' ? 11.5 : K.kind === 'auto' ? 2.8 : 4.3, lastHit: -1e9, touch: 0 });
      return;
    }
  }

  private indexAt(l: Lane, s: number) {
    let lo = 0, hi = l.cum.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (l.cum[m] <= s) lo = m; else hi = m; }
    return lo;
  }

  update(dt: number, focusX: number, focusZ: number, player: { x: number; z: number; vx: number; vz: number } | null, rnd = Math.random, avoid?: (x: number, z: number) => boolean) {
    // Population control.
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (Math.hypot(v.x - focusX, v.z - focusZ) > this.radius + 60) { this.release(v); this.vehicles.splice(i, 1); }
    }
    let spawns = 0;
    while (this.vehicles.length < this.target && spawns++ < 3) this.spawn(focusX, focusZ, rnd, avoid);

    const now = performance.now();
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      // A vehicle pinned against the player for a while gives up and leaves (no deadlocks).
      v.touch = now - v.lastHit < 250 ? v.touch + dt : 0;
      if (v.touch > 1.8) { this.release(v); this.vehicles.splice(i, 1); continue; }
      const l = this.lanes[v.lane];
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      // Look ahead for the player and other traffic.
      let gap = Infinity;
      const check = (x: number, z: number, len: number) => {
        const dx = x - v.x, dz = z - v.z;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(dx * -fz + dz * fx);
        if (ahead > 0 && side < 2.6) gap = Math.min(gap, ahead - len / 2 - v.len / 2);
      };
      if (player) check(player.x, player.z, 4.3);
      for (const o of this.vehicles) if (o !== v && Math.abs(o.x - v.x) < 30 && Math.abs(o.z - v.z) < 30) check(o.x, o.z, o.len);
      let target = v.vmax;
      if (gap < 18) target = Math.min(target, Math.max(0, (gap - 3) * 0.8));
      if (v.stop > 0) { v.stop -= dt; target = 0; }
      v.v += Math.max(-9 * dt, Math.min(3 * dt, target - v.v));
      // Honk when blocked by the player, Delhi style.
      v.honked -= dt;
      if (player && gap < 8 && v.honked <= 0 && Math.hypot(player.x - v.x, player.z - v.z) < 40) { v.honked = 3 + Math.random() * 4; this.onHonk(v.x, v.z); }
      v.s += v.v * dt;
      if (v.s >= l.len) {
        if (!l.next.length) { this.release(v); this.vehicles.splice(i, 1); continue; }
        v.s -= l.len;
        v.lane = l.next[Math.floor(rnd() * l.next.length)];
      }
      const L = this.lanes[v.lane];
      const k = this.indexAt(L, v.s);
      const k2 = Math.min(L.x.length - 1, k + 1);
      const seg = L.cum[k2] - L.cum[k] || 1;
      const t = Math.min(1, (v.s - L.cum[k]) / seg);
      const nx = L.x[k] + (L.x[k2] - L.x[k]) * t, nz = L.z[k] + (L.z[k2] - L.z[k]) * t;
      const dx = L.x[k2] - L.x[k], dz = L.z[k2] - L.z[k];
      const yaw = Math.atan2(-dx, -dz);
      let dy = yaw - v.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      v.yaw += dy * Math.min(1, dt * 6);
      v.vx = (nx - v.x) / Math.max(dt, 1e-3); v.vz = (nz - v.z) / Math.max(dt, 1e-3);
      v.x = nx; v.z = nz;
      v.obj.position.set(nx, terrainHeight(nx, nz), nz);
      v.obj.rotation.y = v.yaw;
      for (const w of v.obj.userData.wheels as THREE.Object3D[]) w.rotation.x -= (v.v * dt) / 0.34;
    }
    this.cows.forEach((c, i) => { if (c.nudge > 0) { c.nudge = Math.max(0, c.nudge - dt); this.placeCow(c, i); } });
  }

  obstacles = (x: number, z: number, r: number): Obstacle[] => {
    const out: Obstacle[] = [];
    for (const v of this.vehicles) {
      if (Math.abs(v.x - x) > r + 8 || Math.abs(v.z - z) > r + 8) continue;
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      const n = v.kind === 'bus' ? 4 : 2;
      const rad = v.kind === 'bus' ? 1.35 : v.kind === 'auto' ? 0.75 : 1.0;
      for (let k = 0; k < n; k++) {
        const off = (k / (n - 1) - 0.5) * (v.len - rad * 2);
        out.push({
          x: v.x + fx * off, z: v.z + fz * off, r: rad, vx: v.vx, vz: v.vz,
          hit: (impact) => { v.lastHit = performance.now(); v.stop = Math.max(v.stop, 1.5 + impact * 0.1); v.v *= 0.3; if (v.honked <= 0) { v.honked = 2; this.onHonk(v.x, v.z); } },
        });
      }
    }
    for (const c of this.cows) {
      if (Math.abs(c.x - x) > r + 4 || Math.abs(c.z - z) > r + 4) continue;
      const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
      for (const off of [-0.7, 0.7]) out.push({ x: c.x + fx * off, z: c.z + fz * off, r: 0.75, vx: 0, vz: 0, hit: () => { if (c.nudge <= 0) this.onMoo(); c.nudge = 0.6; } });
    }
    return out;
  };

  get count() { return this.vehicles.length; }
  positions() { return this.vehicles.map((v) => ({ x: v.x, z: v.z, kind: v.kind })); }
}

function cowMesh() {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf1ede4 });
  const grey = new THREE.MeshLambertMaterial({ color: 0x8c857a });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 1.7), white);
  body.position.y = 1.05; body.castShadow = true;
  g.add(body);
  const head = new THREE.Group();
  head.position.set(0, 1.25, -0.95);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.4, 0.55), white);
  skull.position.z = -0.15; skull.castShadow = true;
  head.add(skull);
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 6), grey);
    horn.position.set(s * 0.15, 0.3, -0.05); horn.rotation.z = -s * 0.4;
    head.add(horn);
  }
  g.add(head);
  const hump = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), white);
  hump.position.set(0, 1.45, -0.55); g.add(hump);
  for (const [x, z] of [[-0.25, -0.65], [0.25, -0.65], [-0.25, 0.65], [0.25, 0.65]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.75, 0.14), white);
    leg.position.set(x, 0.38, z); leg.castShadow = true; g.add(leg);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), grey);
  tail.position.set(0, 1.0, 0.88); g.add(tail);
  return g;
}
