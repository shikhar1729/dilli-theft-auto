// Chase, far and bonnet cameras with wall avoidance, plus an orbit camera for
// scenic stops and menus.
import * as THREE from 'three';
import type { CarState } from './physics';
import type { WallIndex } from './map';

export type CamMode = 'chase' | 'far' | 'hood';
const MODES: CamMode[] = ['chase', 'far', 'hood'];

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'chase';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private shake = 0;
  private yawSmooth = 0;
  private init = false;
  orbit: { target: THREE.Vector3; yaw: number; pitch: number; dist: number; auto: number } | null = null;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.4, 7000);
  }

  cycle() { this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]; }
  reset() { this.init = false; }
  kick(amount: number) { this.shake = Math.min(1.2, this.shake + amount); }

  follow(car: CarState, dt: number, walls: WallIndex | null) {
    const c = this.camera;
    const speed = car.absSpeed;
    if (!this.init) { this.yawSmooth = car.yaw; }
    // Heading follows the car with a little lag (more in drifts).
    let dy = car.yaw - this.yawSmooth;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yawSmooth += dy * Math.min(1, dt * (car.drifting ? 3 : 6));
    const fx = -Math.sin(this.yawSmooth), fz = -Math.cos(this.yawSmooth);

    let dist: number, height: number, lookAhead: number, lookH: number;
    if (this.mode === 'hood') { dist = -0.6; height = 1.45; lookAhead = 20; lookH = 1.0; }
    else if (this.mode === 'far') { dist = 13 + speed * 0.07; height = 5.6; lookAhead = 6; lookH = 1.4; }
    else { dist = 7.6 + speed * 0.05; height = 2.9 + speed * 0.012; lookAhead = 5; lookH = 1.3; }
    if (car.hover) { dist += 3; height += 1.8; }

    const want = new THREE.Vector3(car.x - fx * dist, car.y + height, car.z - fz * dist);
    // Keep the camera out of buildings.
    if (walls && this.mode !== 'hood') {
      const t = this.clearance(walls, car.x, car.y + 1.5, car.z, want.x, want.y, want.z);
      if (t < 1) {
        const d = Math.max(2.8, dist * t - 0.6);
        want.set(car.x - fx * d, car.y + height + (1 - t) * 2.5, car.z - fz * d);
      }
    }
    const lookAt = new THREE.Vector3(car.x + fx * lookAhead, car.y + lookH, car.z + fz * lookAhead);
    if (!this.init) { this.pos.copy(want); this.look.copy(lookAt); this.init = true; }
    const k = this.mode === 'hood' ? 1 : 1 - Math.exp(-dt * 9);
    this.pos.lerp(want, k);
    this.look.lerp(lookAt, 1 - Math.exp(-dt * 14));
    if (this.mode === 'hood') { this.pos.copy(want); this.look.copy(lookAt); }
    c.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      c.position.x += (Math.random() - 0.5) * s;
      c.position.y += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 7);
    }
    c.lookAt(this.look);
    const fov = 62 + Math.min(16, speed * 0.22) + (car.boosting ? 6 : 0);
    c.fov += (fov - c.fov) * Math.min(1, dt * 3);
    c.updateProjectionMatrix();
  }

  /** Fraction along car→camera where a wall blocks the view (1 = clear). */
  private clearance(walls: WallIndex, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    let best = 1;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const r = Math.hypot(bx - ax, bz - az) / 2 + 1;
    walls.query(mx, mz, r, (sx, sz, ex, ez, top, bottom) => {
      const t = segIntersect(ax, az, bx, bz, sx, sz, ex, ez);
      if (t === null || t >= best) return;
      const y = ay + (by - ay) * t;
      if (top > y - 0.5 && bottom < y) best = t;
    });
    return best;
  }

  setOrbit(target: THREE.Vector3, dist: number, yaw: number, pitch: number, auto = 0) {
    this.orbit = { target: target.clone(), yaw, pitch, dist, auto };
  }
  updateOrbit(dt: number) {
    const o = this.orbit;
    if (!o) return;
    o.yaw += o.auto * dt;
    const c = this.camera;
    c.position.set(
      o.target.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist,
      o.target.y + Math.sin(o.pitch) * o.dist,
      o.target.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist,
    );
    c.lookAt(o.target);
    c.fov += (55 - c.fov) * Math.min(1, dt * 3);
    c.updateProjectionMatrix();
  }
}

function segIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number | null {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
