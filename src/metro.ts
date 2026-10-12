// Delhi Metro and RapidX trains running on the real line geometry (OSM route
// relations). Trains stop at stations, climb onto the elevated viaducts and dip
// out of sight where the line goes underground.
import * as THREE from 'three';
import type { MapData } from './map';
import { decode } from './map';
import { terrainHeight } from './terrain';
import { mergeGeometries, paint } from './geom';

const STEP = 10;            // path resampling (m)
const COACH = 21.6;         // coach length incl. gap (m)
const VMAX = 22;            // cruising speed (m/s, ~80 km/h)
const DWELL = 14;           // seconds at a station
const HEIGHT = [-16, 0.25, 10.7, 7.7]; // underground, at grade, elevated metro, elevated rail

interface Path { x: Float32Array; z: Float32Array; h: Float32Array; cum: Float32Array; len: number }
interface Leg { from: number; to: number; t0: number; t1: number } // travel between stops
interface Line { name: string; color: THREE.Color; path: Path; legs: Leg[]; cycle: number; trains: number; coaches: number }

function buildPath(flat: number[], modes: number[]): Path {
  const xs: number[] = [], zs: number[] = [], hs: number[] = [];
  for (let i = 0; i + 1 < flat.length / 2; i++) {
    const ax = flat[i * 2], az = flat[i * 2 + 1], bx = flat[i * 2 + 2], bz = flat[i * 2 + 3];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
    const ha = HEIGHT[modes[i]] ?? 0, hb = HEIGHT[modes[i + 1]] ?? 0;
    for (let k = 0; k < n; k++) {
      xs.push(ax + ((bx - ax) * k) / n);
      zs.push(az + ((bz - az) * k) / n);
      hs.push(ha + ((hb - ha) * k) / n);
    }
  }
  xs.push(flat[flat.length - 2]); zs.push(flat[flat.length - 1]); hs.push(HEIGHT[modes[modes.length - 1]] ?? 0);
  // Ramps between tunnel, grade and viaduct: smooth heights over ~±120 m.
  const W = 12;
  const sm = hs.map((_, i) => {
    let a = 0, n = 0;
    for (let k = Math.max(0, i - W); k <= Math.min(hs.length - 1, i + W); k++) { a += hs[k]; n++; }
    return a / n;
  });
  const cum = new Float32Array(xs.length);
  for (let i = 1; i < xs.length; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  return { x: Float32Array.from(xs), z: Float32Array.from(zs), h: Float32Array.from(sm), cum, len: cum[cum.length - 1] };
}

function sample(p: Path, s: number, out: { x: number; y: number; z: number; yaw: number; pitch: number }) {
  s = Math.max(0, Math.min(p.len - 0.01, s));
  let lo = 0, hi = p.cum.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (p.cum[m] <= s) lo = m; else hi = m; }
  const seg = p.cum[hi] - p.cum[lo] || 1;
  const t = (s - p.cum[lo]) / seg;
  const x = p.x[lo] + (p.x[hi] - p.x[lo]) * t, z = p.z[lo] + (p.z[hi] - p.z[lo]) * t;
  const h = p.h[lo] + (p.h[hi] - p.h[lo]) * t;
  out.x = x; out.z = z;
  out.y = terrainHeight(x, z) + h;
  out.yaw = Math.atan2(-(p.x[hi] - p.x[lo]), -(p.z[hi] - p.z[lo]));
  out.pitch = Math.atan2(p.h[hi] - p.h[lo], seg);
  return h;
}

/** Coach body (stainless steel, window band, doors) and its separate colour stripe. */
function coachGeometries() {
  const L = COACH - 0.6, W = 3.1, H = 3.7;
  const body: THREE.BufferGeometry[] = [];
  const shell = new THREE.BoxGeometry(W, H - 0.4, L);
  shell.translate(0, 0.4 + (H - 0.4) / 2, 0);
  body.push(paint(shell.toNonIndexed(), 0xd9dde0));
  const roof = new THREE.CylinderGeometry(W / 2, W / 2, L, 12, 1, false, -Math.PI / 2, Math.PI);
  roof.rotateX(Math.PI / 2); roof.rotateZ(Math.PI / 2);
  roof.scale(1, 0.18, 1);
  roof.translate(0, H, 0);
  body.push(paint(roof.toNonIndexed(), 0xc8cdd1));
  const under = new THREE.BoxGeometry(W - 0.4, 0.5, L - 3);
  under.translate(0, 0.25, 0);
  body.push(paint(under.toNonIndexed(), 0x3a3d40));
  for (const s of [-1, 1]) {
    const win = new THREE.BoxGeometry(0.04, 1.0, L - 1.2);
    win.translate(s * (W / 2 + 0.01), 2.55, 0);
    body.push(paint(win.toNonIndexed(), 0x1f2a33));
    for (const dz of [-6.6, -2.2, 2.2, 6.6]) {
      const door = new THREE.BoxGeometry(0.05, 2.3, 1.4);
      door.translate(s * (W / 2 + 0.02), 1.85, dz);
      body.push(paint(door.toNonIndexed(), 0x9aa3aa));
    }
  }
  for (const e of [-1, 1]) {
    const end = new THREE.BoxGeometry(W - 0.2, 1.3, 0.04);
    end.translate(0, 2.5, e * (L / 2 + 0.01));
    body.push(paint(end.toNonIndexed(), 0x1f2a33));
  }
  const b = mergeGeometries(body);
  b.computeVertexNormals();
  const stripes: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const st = new THREE.BoxGeometry(0.05, 0.42, L - 0.4);
    st.translate(s * (W / 2 + 0.03), 1.45, 0);
    stripes.push(paint(st.toNonIndexed(), 0xffffff));
  }
  const sg = mergeGeometries(stripes);
  sg.computeVertexNormals();
  return { body: b, stripe: sg };
}

export class Metro {
  readonly group = new THREE.Group();
  private lines: Line[] = [];
  private bodies: THREE.InstancedMesh;
  private stripes: THREE.InstancedMesh;
  private capacity: number;
  /** Distance to the nearest visible train coach this frame (for the rumble sound). */
  nearest = Infinity;

  constructor(map: MapData) {
    this.group.name = 'metro';
    for (const m of map.metro ?? []) {
      const flat = decode(m.p);
      if (flat.length < 8) continue;
      const path = buildPath(flat, m.m);
      if (path.len < 400) continue;
      // Timetable: ease out of each stop, cruise, ease into the next, then dwell.
      const stops = [0, ...m.s.filter((d) => d > 60 && d < path.len - 60), path.len];
      const legs: Leg[] = [];
      let t = 0;
      for (let i = 0; i + 1 < stops.length; i++) {
        const d = stops[i + 1] - stops[i];
        if (d < 1) continue;
        const travel = d / VMAX + 6; // the easing adds ~6 s
        legs.push({ from: stops[i], to: stops[i + 1], t0: t, t1: t + travel });
        t += travel + (i + 1 < stops.length - 1 ? DWELL : 0);
      }
      const rapid = /RRTS|RapidX/i.test(m.n);
      const coaches = rapid ? 6 : /Airport/i.test(m.n) ? 6 : /Green/i.test(m.n) ? 4 : 6;
      const trains = Math.max(2, Math.round(path.len / 1300)); // roughly peak-hour frequency
      this.lines.push({ name: m.n, color: new THREE.Color(m.c), path, legs, cycle: t + 30, trains, coaches });
    }
    this.capacity = this.lines.reduce((a, l) => a + l.trains * l.coaches, 0);
    const { body, stripe } = coachGeometries();
    this.bodies = new THREE.InstancedMesh(body, new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, this.capacity));
    this.stripes = new THREE.InstancedMesh(stripe, new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, this.capacity));
    this.bodies.castShadow = true;
    for (const im of [this.bodies, this.stripes]) { im.frustumCulled = false; im.count = 0; this.group.add(im); }
  }

  get lineCount() { return this.lines.length; }

  private headAt(line: Line, t: number) {
    const tau = ((t % line.cycle) + line.cycle) % line.cycle;
    for (const leg of line.legs) {
      if (tau < leg.t0) return leg.from; // dwelling at this leg's start
      if (tau <= leg.t1) {
        const f = (tau - leg.t0) / (leg.t1 - leg.t0);
        const e = f * f * (3 - 2 * f); // smooth start and stop
        return leg.from + (leg.to - leg.from) * e;
      }
    }
    return line.path.len + 1000; // past the end of the map: hidden until the next cycle
  }

  update(time: number, cx: number, cz: number, range = 1600) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const s = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    let n = 0;
    this.nearest = Infinity;
    for (const line of this.lines) {
      for (let k = 0; k < line.trains; k++) {
        const head = this.headAt(line, time + (k * line.cycle) / line.trains);
        for (let c = 0; c < line.coaches; c++) {
          const d = head - c * COACH - COACH / 2;
          if (d < 0 || d > line.path.len) continue;
          const h = sample(line.path, d, s);
          if (h < -3) continue; // underground
          const dist = Math.hypot(s.x - cx, s.z - cz);
          if (dist > range) continue;
          if (dist < this.nearest) this.nearest = dist;
          e.set(-s.pitch, s.yaw, 0);
          q.setFromEuler(e);
          m.compose(pos.set(s.x, s.y, s.z), q, one);
          this.bodies.setMatrixAt(n, m);
          this.stripes.setMatrixAt(n, m);
          this.stripes.setColorAt(n, line.color);
          n++;
        }
      }
    }
    this.bodies.count = n;
    this.stripes.count = n;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.stripes.instanceMatrix.needsUpdate = true;
    if (this.stripes.instanceColor) this.stripes.instanceColor.needsUpdate = true;
  }

  /** Line geometry for the minimap: [colour, flat points, elevated flags]. */
  minimapLines(map: MapData) {
    return (map.metro ?? []).map((m) => ({ color: m.c, p: decode(m.p), m: m.m }));
  }
}
