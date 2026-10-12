// Courses (from the map's computed routes), checkpoints, turn cues, kite ramps and
// marigold boost rings, plus the race session timing logic.
import * as THREE from 'three';
import type { CourseData, MapData, RoadNetwork } from './map';
import { terrainHeight } from './terrain';
import type { Surfaces } from './world/surfaces';
import { textTexture } from './textures';
import { mergeInPlace, bakeVertexColored } from './geom';

export interface Gate { d: number; x: number; z: number; dx: number; dz: number; half: number }
export interface Turn { d: number; dir: 'left' | 'right'; angle: number; street: string }
export interface Ring { x: number; y: number; z: number; taken: boolean; yaw: number; idx: number }
export interface Ramp { x: number; z: number; yaw: number; d: number }

const STEP = 4;

export class Course {
  readonly id: string; readonly name: string; readonly blurb: string; readonly region: string; readonly laps: number;
  readonly x: number[] = []; readonly z: number[] = []; readonly y: number[] = []; readonly cum: number[] = []; readonly street: string[] = [];
  readonly length: number;
  readonly gates: Gate[] = [];   // one lap's gates; the last is the lap/finish line
  readonly turns: Turn[] = [];
  readonly ramps: Ramp[] = [];
  readonly rings: Ring[] = [];
  readonly closed: boolean;
  private corridor = new Set<number>();

  constructor(data: CourseData, roads: RoadNetwork, landmarks: MapData['landmarks'], surfaceAt: (x: number, z: number, y: number) => number = terrainHeight) {
    this.id = data.id; this.name = data.name; this.blurb = data.blurb; this.region = data.region || 'New Delhi'; this.laps = data.laps;
    // Resample at STEP metres, carrying street names.
    const p = data.p;
    const n = p.length / 2;
    let carry = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
      const L = Math.hypot(bx - ax, bz - az);
      for (let s = carry; s < L; s += STEP) {
        this.x.push(ax + ((bx - ax) * s) / L);
        this.z.push(az + ((bz - az) * s) / L);
        this.street.push(data.s[i] || '');
      }
      carry = ((carry - L) % STEP + STEP) % STEP;
    }
    this.x.push(p[(n - 1) * 2]); this.z.push(p[(n - 1) * 2 + 1]); this.street.push(data.s[n - 1] || '');
    // Smooth corners a little (keeps junction geometry but rounds the racing line).
    for (let pass = 0; pass < 3; pass++) {
      const sx = this.x.slice(), sz = this.z.slice();
      for (let i = 2; i < this.x.length - 2; i++) {
        this.x[i] = (sx[i - 2] + sx[i - 1] + sx[i] * 2 + sx[i + 1] + sx[i + 2]) / 6;
        this.z[i] = (sz[i - 2] + sz[i - 1] + sz[i] * 2 + sz[i + 1] + sz[i + 2]) / 6;
      }
    }
    this.cum.push(0);
    for (let i = 1; i < this.x.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.z[i] - this.z[i - 1]));
    this.length = this.cum[this.cum.length - 1];
    // Driving height along the route: follow flyover and bridge decks the way the car does.
    let prevY = terrainHeight(this.x[0], this.z[0]);
    for (let i = 0; i < this.x.length; i++) {
      prevY = surfaceAt(this.x[i], this.z[i], prevY);
      this.y.push(prevY);
    }
    const onDeck = (i: number) => this.y[i] - terrainHeight(this.x[i], this.z[i]) > 0.3;
    this.closed = Math.hypot(this.x[0] - this.x[this.x.length - 1], this.z[0] - this.z[this.z.length - 1]) < 30;
    for (let i = 0; i < this.x.length; i += 2) {
      const cx = Math.floor(this.x[i] / 25), cz = Math.floor(this.z[i] / 25);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) this.corridor.add((cx + a + 4096) * 8192 + cz + b + 4096);
    }

    // Unnamed streets get a friendly name from context.
    const near = (k: string, r: number, i: number) => landmarks[k] && Math.hypot(this.x[i] - landmarks[k][0], this.z[i] - landmarks[k][1]) < r;
    for (let i = 0; i < this.street.length; i++) {
      if (this.street[i]) continue;
      this.street[i] = near('indiaGate', 450, i) ? 'C-Hexagon' : near('cpCenter', 450, i) ? 'Connaught Place' : 'the roundabout';
    }

    // Checkpoints: roughly every 450 m.
    const count = Math.max(3, Math.round(this.length / 450));
    for (let k = 1; k <= count; k++) {
      const d = k === count ? this.length - 1 : (this.length * k) / count;
      const i = this.indexAt(d);
      const [dx, dz] = this.dirAt(i);
      const nr = roads.nearest(this.x[i], this.z[i], 30);
      const half = Math.max(11, (nr ? roads.segs[nr.seg].half : 6) + 8);
      this.gates.push({ d, x: this.x[i], z: this.z[i], dx, dz, half });
    }

    // Turn cues from heading change over ~36 m windows.
    const W = 9;
    const heading = (i: number) => { const [dx, dz] = this.dirAt(i); return Math.atan2(dz, dx); };
    let i = W;
    while (i < this.x.length - W) {
      let dh = heading(i + W) - heading(i - W);
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      if (Math.abs(dh) > 0.5) {
        // Find the full extent of this bend.
        let j = i, total = 0;
        while (j < this.x.length - W) {
          let s = heading(j + 2) - heading(j);
          s = Math.atan2(Math.sin(s), Math.cos(s));
          if (Math.abs(s) < 0.03 && j > i + W) break;
          total += s;
          j += 2;
        }
        const angle = Math.abs(total) * (180 / Math.PI);
        const after = this.street[Math.min(this.street.length - 1, j + 6)];
        if (angle > 28) this.turns.push({ d: this.cum[i], dir: total > 0 ? 'right' : 'left', angle, street: after });
        i = j + W;
      } else i += 2;
    }

    // Kite ramps on long straights, each followed by marigold rings in the air.
    let lastRamp = -600;
    for (let k = 40; k < this.x.length - 60; k += 5) {
      const d = this.cum[k];
      if (d - lastRamp < 750 || d < 350 || d > this.length - 250) continue;
      if (this.maxTurn(k - 25, k + 55) > 0.12) continue;
      if (this.gates.some((g) => Math.abs(g.d - d) < 60)) continue;
      let deck = false;
      for (let j = Math.max(0, k - 10); j < Math.min(this.x.length, k + 45); j++) if (onDeck(j)) { deck = true; break; }
      if (deck) continue;
      const [dx, dz] = this.dirAt(k);
      this.ramps.push({ x: this.x[k], z: this.z[k], yaw: Math.atan2(-dx, -dz), d });
      for (const [ahead, h] of [[30, 5.5], [62, 8], [96, 7], [130, 4.5]]) {
        const ii = this.indexAt(d + ahead);
        this.rings.push({ x: this.x[ii], y: this.y[ii] + h, z: this.z[ii], taken: false, yaw: this.poseAt(d + ahead).yaw, idx: -1 });
      }
      lastRamp = d;
    }
    // Ground-level rings between ramps.
    for (let d = 260; d < this.length - 150; d += 520) {
      if (this.ramps.some((r) => Math.abs(r.d - d) < 220)) continue;
      const ii = this.indexAt(d);
      this.rings.push({ x: this.x[ii], y: this.y[ii] + 2.6, z: this.z[ii], taken: false, yaw: this.poseAt(d).yaw, idx: -1 });
    }
  }

  private maxTurn(a: number, b: number) {
    a = Math.max(1, a); b = Math.min(this.x.length - 2, b);
    let m = 0;
    for (let i = a; i < b; i += 3) {
      const [x0, z0] = this.dirAt(i), [x1, z1] = this.dirAt(i + 3);
      m = Math.max(m, Math.abs(Math.atan2(x0 * z1 - z0 * x1, x0 * x1 + z0 * z1)));
    }
    return m;
  }

  /** True when (x, z) is within roughly 25–50 m of the route. */
  nearRoute(x: number, z: number) {
    return this.corridor.has((Math.floor(x / 25) + 4096) * 8192 + Math.floor(z / 25) + 4096);
  }

  indexAt(d: number) {
    d = Math.max(0, Math.min(this.length, d));
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= d) lo = m; else hi = m; }
    return lo;
  }
  dirAt(i: number): [number, number] {
    const a = Math.max(0, Math.min(this.x.length - 2, i));
    const b = Math.min(this.x.length - 1, a + 2);
    const a0 = Math.max(0, b - 3);
    const dx = this.x[b] - this.x[a0], dz = this.z[b] - this.z[a0];
    const L = Math.hypot(dx, dz) || 1;
    return [dx / L, dz / L];
  }
  /** Pose at distance d: position and car yaw facing along the course. */
  poseAt(d: number, lateral = 0) {
    const i = this.indexAt(d);
    const [dx, dz] = this.dirAt(i);
    const x = this.x[i] - dz * lateral, z = this.z[i] + dx * lateral;
    return { x, z, y: this.y[i] ?? terrainHeight(x, z), yaw: Math.atan2(-dx, -dz) };
  }
  /** Projects a point onto the course near a hint index. */
  project(x: number, z: number, hint: number, window = 80) {
    let best = hint, bd = Infinity;
    const a = Math.max(0, hint - window), b = Math.min(this.x.length - 2, hint + window);
    for (let i = a; i <= b; i++) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return { index: best, d: this.cum[best], dist: Math.sqrt(bd) };
  }
  projectGlobal(x: number, z: number) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.x.length; i += 2) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return this.project(x, z, best, 4);
  }
}

// ------------------------------------------------------------------ world objects for a course

export interface CourseProps {
  group: THREE.Group;
  gateObjs: THREE.Group[];
  setActiveGate(i: number): void;
  update(t: number): void;
  dispose(): void;
}

const marigold = new THREE.MeshLambertMaterial({ color: 0xf59e0b, emissive: 0x6b3500 });
const marigold2 = new THREE.MeshLambertMaterial({ color: 0xf97316, emissive: 0x5a2300 });

/** Garland gate: two bamboo poles and a sagging marigold string. */
function gateMesh(half: number, label: string) {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xd8b26e });
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 8, 8), poleMat);
    pole.position.set(s * half, 4, 0);
    pole.castShadow = true;
    g.add(pole);
    // Garland wrapped around the pole.
    for (let k = 0; k < 12; k++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), k % 2 ? marigold : marigold2);
      b.position.set(s * half + Math.cos(k * 1.3) * 0.24, 0.6 + k * 0.6, Math.sin(k * 1.3) * 0.24);
      g.add(b);
    }
  }
  const beads = 34;
  const bead = new THREE.SphereGeometry(0.34, 8, 6);
  const inst = new THREE.InstancedMesh(bead, marigold, beads);
  const m = new THREE.Matrix4();
  for (let k = 0; k < beads; k++) {
    const u = k / (beads - 1);
    const x = -half + u * half * 2;
    const y = 7.8 - Math.sin(u * Math.PI) * 1.6;
    inst.setMatrixAt(k, m.makeTranslation(x, y, 0));
  }
  g.add(inst);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: textTexture(label, { w: 512, h: 128, font: 'bold 70px Anton, Impact, sans-serif', color: '#ffffff', bg: '#0f3d4c' }), side: THREE.DoubleSide }));
  sign.position.set(0, 9.3, 0);
  sign.name = 'sign';
  g.add(sign);
  mergeInPlace(g, gateMat);
  return g;
}
const gateMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a1400 });

function rampMesh() {
  // Yellow-and-black barricade ramp: 14 m long, rising to 2.6 m.
  const L = 14, W = 7, H = 2.6;
  const s = new THREE.Shape();
  s.moveTo(-L / 2, 0); s.lineTo(L / 2, H); s.lineTo(L / 2, 0); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false });
  geo.translate(0, 0, -W / 2);
  geo.rotateY(Math.PI / 2); // length along -Z (forward)
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g2 = c.getContext('2d')!;
  for (let i = -4; i < 8; i++) {
    g2.fillStyle = i % 2 ? '#1a1a1a' : '#f2c21b';
    g2.beginPath(); g2.moveTo(i * 24, 0); g2.lineTo(i * 24 + 24, 0); g2.lineTo(i * 24 + 24 + 128, 128); g2.lineTo(i * 24 + 128, 128); g2.closePath(); g2.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.25, 0.25);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

const ringGeo = new THREE.TorusGeometry(2.6, 0.32, 8, 28);
let ringBaked: THREE.BufferGeometry | null = null;
/** All marigold rings share one instanced mesh. */
export function ringInstances(count: number) {
  ringBaked ??= bakeVertexColored(ringMesh(), undefined)!;
  const inst = new THREE.InstancedMesh(ringBaked, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x4a2600 }), Math.max(1, count));
  inst.frustumCulled = false;
  return inst;
}
export function ringMesh() {
  const g = new THREE.Group();
  const torus = new THREE.Mesh(ringGeo, new THREE.MeshLambertMaterial({ color: 0xffb020, emissive: 0x8a4a00 }));
  g.add(torus);
  // Marigold flowers dotted around the ring.
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), k % 2 ? marigold2 : marigold);
    f.position.set(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0);
    g.add(f);
  }
  return g;
}

/** Ramps live in the world permanently (they are physical); call once per course. */
export function installRamps(course: Course, surfaces: Surfaces, scene: THREE.Object3D) {
  for (const r of course.ramps) {
    const m = rampMesh();
    const y = terrainHeight(r.x, r.z);
    m.position.set(r.x, y, r.z);
    m.rotation.y = r.yaw;
    scene.add(m);
    surfaces.addRamp(r.x, r.z, 7, 14, r.yaw, 2.6);
  }
}

export function buildCourseProps(course: Course): CourseProps {
  const group = new THREE.Group();
  group.name = `course-${course.id}`;
  const gateObjs: THREE.Group[] = [];
  const total = course.gates.length;
  course.gates.forEach((g, i) => {
    const last = i === total - 1;
    const label = last ? (course.laps > 1 ? 'LAP / FINISH' : 'FINISH') : `CHECKPOINT ${i + 1}`;
    const obj = gateMesh(g.half, label);
    obj.position.set(g.x, course.y[course.indexAt(g.d)], g.z);
    obj.rotation.y = Math.atan2(-g.dx, -g.dz); // local X spans the road
    group.add(obj);
    gateObjs.push(obj);
  });
  // Start line: chequered strip.
  const start = course.poseAt(6);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 16;
  const g2 = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { g2.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g2.fillRect(i * 8, j * 8, 8, 8); }
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(16, 2), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40 }));
  (strip.material as THREE.MeshLambertMaterial).map!.colorSpace = THREE.SRGBColorSpace;
  strip.rotation.x = -Math.PI / 2;
  strip.rotation.z = start.yaw;
  strip.position.set(start.x, start.y + 0.06, start.z);
  group.add(strip);

  // Chevron boards on the outside of sharp turns.
  const chevTex = (() => {
    const cc = document.createElement('canvas'); cc.width = 128; cc.height = 64;
    const g = cc.getContext('2d')!;
    g.fillStyle = '#f2c21b'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#111';
    for (const x of [18, 58, 98]) { g.beginPath(); g.moveTo(x - 12, 8); g.lineTo(x + 8, 32); g.lineTo(x - 12, 56); g.lineTo(x - 2, 56); g.lineTo(x + 18, 32); g.lineTo(x - 2, 8); g.closePath(); g.fill(); }
    const t = new THREE.CanvasTexture(cc); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const chevMat = new THREE.MeshBasicMaterial({ map: chevTex, side: THREE.DoubleSide });
  for (const t of course.turns) {
    if (t.angle < 45) continue;
    const i = course.indexAt(t.d + 8);
    const [dx, dz] = course.dirAt(i);
    // Outside of the bend: left of travel for a right turn, right for a left turn.
    const [ox, oz] = t.dir === 'right' ? [dz, -dx] : [-dz, dx];
    const off = 13;
    const x = course.x[i] + ox * off, z = course.z[i] + oz * off;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), chevMat);
    const by = Math.max(terrainHeight(x, z), course.y[i] - 1);
    board.position.set(x, by + 2.2, z);
    board.rotation.y = Math.atan2(-dx, -dz);
    if (t.dir === 'left') board.scale.x = -1;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 6), new THREE.MeshLambertMaterial({ color: 0x555555 }));
    post.position.set(x, by + 0.75, z);
    group.add(board, post);
  }

  return {
    group, gateObjs,
    setActiveGate(i: number) {
      gateObjs.forEach((o, k) => { o.visible = k >= i; o.scale.setScalar(k === i ? 1 : 0.92); });
    },
    update(t: number) {
      gateObjs.forEach((o) => { const sg = o.getObjectByName('sign'); if (sg) sg.position.y = 9.3 + Math.sin(t * 2) * 0.15; });
    },
    dispose() {
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    },
  };
}

// ------------------------------------------------------------------ race session

export type RaceEvent = { type: 'checkpoint'; index: number; split: number } | { type: 'lap'; lap: number } | { type: 'finish'; time: number } | { type: 'wrongway'; on: boolean };

export class RaceSession {
  phase: 'countdown' | 'racing' | 'finished' = 'countdown';
  countdown = 3.4;
  elapsed = 0;
  gateIndex = 0;    // within lap
  lap = 1;
  hint = 0;
  progress = 0;     // metres along total race
  finishTime = 0;
  wrongWay = false;
  private wrongTimer = 0;
  readonly totalGates: number;

  constructor(readonly course: Course) {
    this.totalGates = course.gates.length * course.laps;
  }
  get gatesPassed() { return (this.lap - 1) * this.course.gates.length + this.gateIndex; }

  update(dt: number, px: number, pz: number, x: number, z: number, vx: number, vz: number): RaceEvent[] {
    const ev: RaceEvent[] = [];
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.phase = 'racing'; this.elapsed = 0; }
      return ev;
    }
    if (this.phase !== 'racing') return ev;
    this.elapsed += dt;
    const c = this.course;
    const pr = c.project(x, z, this.hint, 40);
    if (pr.dist < 60) this.hint = pr.index;
    this.progress = (this.lap - 1) * c.length + c.cum[this.hint];

    // Gate crossing: segment (px,pz)->(x,z) against the gate line.
    const g = c.gates[this.gateIndex];
    const ax = g.x + g.dz * g.half, az = g.z - g.dx * g.half;
    const bx = g.x - g.dz * g.half, bz = g.z + g.dx * g.half;
    if (segmentsCross(px, pz, x, z, ax, az, bx, bz) && (x - px) * g.dx + (z - pz) * g.dz > 0) {
      this.gateIndex++;
      if (this.gateIndex >= c.gates.length) {
        if (this.lap >= c.laps) {
          this.phase = 'finished';
          this.finishTime = this.elapsed;
          ev.push({ type: 'finish', time: this.elapsed });
          return ev;
        }
        this.lap++;
        this.gateIndex = 0;
        this.hint = 0;
        ev.push({ type: 'lap', lap: this.lap });
      } else ev.push({ type: 'checkpoint', index: this.gatesPassed, split: this.elapsed });
    }

    // Wrong way: moving against the course direction for a while.
    const [dx, dz] = c.dirAt(this.hint);
    const sp = Math.hypot(vx, vz);
    const against = sp > 6 && (vx * dx + vz * dz) / sp < -0.5 && pr.dist < 40;
    this.wrongTimer = against ? this.wrongTimer + dt : Math.max(0, this.wrongTimer - dt * 2);
    const ww = this.wrongTimer > 1.2;
    if (ww !== this.wrongWay) { this.wrongWay = ww; ev.push({ type: 'wrongway', on: ww }); }
    return ev;
  }

  /** Next turn cue ahead of the car, if any within 400 m. */
  nextTurn(): { turn: Turn; dist: number } | null {
    const d = this.course.cum[this.hint];
    for (const t of this.course.turns) {
      if (t.d > d - 5) return t.d - d < 450 ? { turn: t, dist: Math.max(0, t.d - d) } : null;
    }
    return null;
  }
}

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

export function formatTime(t: number) {
  if (!isFinite(t) || t <= 0) return '--:--.--';
  const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
