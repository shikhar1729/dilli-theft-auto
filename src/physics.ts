// Arcade driving simulation. Deterministic fixed-step (120 Hz) so every client and
// the autopilot share the same handling.
import type { WallIndex, RoadNetwork, AreaIndex, MapData } from './map';
import { AREA, distToSeg, segParam } from './map';
import type { Surfaces } from './world/surfaces';

export interface CarInput { throttle: number; brake: number; steer: number; boost: boolean; drift: boolean }
export const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, boost: false, drift: false };

export interface Obstacle { x: number; z: number; r: number; vx: number; vz: number; hit(impact: number, nx: number, nz: number): void }

export interface PhysicsEnv {
  surfaces: Surfaces;
  walls: WallIndex;
  roads: RoadNetwork;
  areas: AreaIndex;
  bounds: MapData['bounds'];
  obstacles?: (x: number, z: number, r: number) => Obstacle[];
}

export const TUNING = {
  maxSpeed: 46,        // m/s (~166 km/h)
  boostSpeed: 63,      // m/s (~227 km/h)
  reverseSpeed: 11,
  accel: 17,
  boostAccel: 14,
  brake: 30,
  coastDrag: 1.5,
  airDrag: 0.0011,
  wheelBase: 2.6,
  latLimit: 25,
  gravity: 19,
  hoverGravity: 4.6,
  hoverSpeed: 24,      // 54 mph: wings (kites) deploy above this when airborne
  boostDrain: 0.22,    // per second
  boostRegen: 0.02,
  radius: 1.05,
  axle: 1.25,
};

export type Surface = 'road' | 'grass' | 'water' | 'river' | 'dirt' | 'paving';

export class CarState {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  yaw = 0; yawRate = 0;
  grounded = true;
  airTime = 0;
  hover = false;
  boost = 1;
  boosting = false;
  drifting = false;
  surface: Surface = 'road';
  impact = 0;          // last impact speed (m/s), decays
  impactX = 0; impactZ = 0;
  landing = 0;         // last landing impact
  slip = 0;            // lateral speed
  frozen = false;
  splash = 0;
  safeTimer = 0;
  prevSlopeV = 0;
  safe = { x: 0, y: 0, z: 0, yaw: 0 };
  // Visual-only smoothing.
  pitch = 0; roll = 0;
  wheelSpin = 0;
  steerVis = 0;

  get forwardX() { return -Math.sin(this.yaw); }
  get forwardZ() { return -Math.cos(this.yaw); }
  get speed() { return this.vx * this.forwardX + this.vz * this.forwardZ; }
  get absSpeed() { return Math.hypot(this.vx, this.vz); }

  place(x: number, y: number, z: number, yaw: number) {
    this.x = x; this.y = y; this.z = z; this.yaw = yaw;
    this.vx = this.vy = this.vz = 0; this.yawRate = 0;
    this.grounded = true; this.airTime = 0; this.hover = false; this.prevSlopeV = 0;
    this.safe = { x, y, z, yaw };
  }
}

const DT = 1 / 120;

export function stepCar(car: CarState, input: CarInput, env: PhysicsEnv, dt = DT) {
  const T = TUNING;
  if (car.frozen) { car.vx = car.vz = car.vy = 0; return; }
  const fx = car.forwardX, fz = car.forwardZ;
  // Right vector (x east, z south): right of forward (fx, fz) is (-fz, fx).
  const rx = -fz, rz = fx;
  let vf = car.vx * fx + car.vz * fz;
  let vl = car.vx * rx + car.vz * rz;

  // Surface under the car.
  if (car.grounded) {
    if (env.roads.onRoad(car.x, car.z)) car.surface = 'road';
    else {
      const k = env.areas.kindAt(car.x, car.z);
      car.surface = k === AREA.river ? 'river' : k === AREA.water ? 'water' : k === AREA.grass || k === AREA.wood || k === AREA.pitch ? 'grass' : k === AREA.plaza ? 'paving' : 'dirt';
    }
  }
  const surf = car.surface;
  const wet = surf === 'water' || surf === 'river';
  const speedMul = wet ? 0.42 : surf === 'grass' ? 0.8 : surf === 'dirt' ? 0.86 : 1;
  const extraDrag = wet ? 7 : surf === 'grass' ? 1.6 : surf === 'dirt' ? 1.0 : 0;

  // Boost.
  const wantsBoost = input.boost && car.boost > 0.01 && (input.throttle > 0.1 || !car.grounded);
  car.boosting = wantsBoost;
  if (wantsBoost) car.boost = Math.max(0, car.boost - T.boostDrain * dt);
  else car.boost = Math.min(1, car.boost + T.boostRegen * dt);

  if (car.grounded) {
    const vmax = (wantsBoost ? T.boostSpeed : T.maxSpeed) * speedMul;
    // Engine.
    if (input.throttle > 0) {
      if (vf < -0.5) vf += T.brake * input.throttle * dt; // throttle while rolling back brakes first
      else if (vf < vmax) {
        const r = Math.max(0, vf) / vmax;
        vf += (T.accel * (1 - Math.pow(r, 1.7)) + (wantsBoost ? T.boostAccel : 0)) * input.throttle * dt;
      }
    }
    if (input.brake > 0) {
      if (vf > 0.4) vf = Math.max(0, vf - T.brake * input.brake * dt);
      else if (vf > -T.reverseSpeed) vf -= 9 * input.brake * dt; // reverse
    }
    // Rolling resistance and aero drag.
    const drag = (T.coastDrag + extraDrag) * (input.throttle > 0 ? 0.25 : 1) + T.airDrag * vf * vf;
    if (vf > 0) vf = Math.max(0, vf - drag * dt);
    else if (vf < 0) vf = Math.min(0, vf + drag * dt);
    if (vf > vmax + 0.5) vf -= (vf - vmax) * 1.5 * dt; // shed excess speed after boost / off-road

    // Steering.
    const sv = Math.abs(vf);
    const steerAngle = 0.6 / (1 + sv / 14);
    const geomYaw = (vf * Math.tan(steerAngle)) / T.wheelBase;
    const drift = input.drift && sv > 8;
    car.drifting = drift && Math.abs(input.steer) > 0.2;
    const lat = T.latLimit * (drift ? 1.5 : 1) * (wet ? 0.4 : surf === 'grass' ? 0.8 : 1);
    const maxYaw = Math.min(Math.abs(geomYaw), sv > 0.5 ? lat / sv : Infinity) * Math.sign(geomYaw);
    const targetYaw = input.steer * maxYaw;
    car.yawRate += (targetYaw - car.yawRate) * Math.min(1, (drift ? 6 : 9) * dt);

    // Grip: lateral velocity bleeds away; drifting lets the rear step out.
    const grip = drift ? 1.6 : wet ? 2 : surf === 'grass' ? 5 : 10;
    vl *= Math.exp(-grip * dt);
    if (car.drifting) {
      vl -= input.steer * sv * 0.5 * dt; // kick the tail out
      vf -= 1.2 * dt * Math.sign(vf);
    }
    car.vy = 0;
  } else {
    // Airborne / hovering.
    if (!car.hover && car.airTime > 0.12 && car.absSpeed > T.hoverSpeed) car.hover = true;
    const g = car.hover ? T.hoverGravity : T.gravity;
    car.vy -= g * dt;
    if (car.hover) {
      // Boost lifts the kites, fading out with height so a glide levels off around 7 m.
      if (wantsBoost) {
        const above = car.y - env.surfaces.height(car.x, car.z, car.y);
        car.vy += 8.5 * Math.max(0, 1 - above / 16) * dt;
        car.boost = Math.max(0, car.boost - T.boostDrain * 0.5 * dt);
      }
      if (input.brake > 0) car.vy -= 12 * input.brake * dt;
      if (input.throttle > 0 && vf < T.maxSpeed) vf += 3 * dt;
      car.vy = Math.max(car.vy, -14);
    }
    vf -= T.airDrag * 0.5 * vf * Math.abs(vf) * dt;
    const target = input.steer * (car.hover ? 0.75 : 0.35);
    car.yawRate += (target - car.yawRate) * Math.min(1, 4 * dt);
    vl *= Math.exp(-0.5 * dt);
  }

  car.yaw += car.yawRate * dt;
  const nfx = -Math.sin(car.yaw), nfz = -Math.cos(car.yaw);
  const nrx = -nfz, nrz = nfx;
  car.vx = nfx * vf + nrx * vl;
  car.vz = nfz * vf + nrz * vl;
  car.slip = vl;

  // Integrate horizontal motion.
  const oldGround = car.grounded ? car.y : env.surfaces.height(car.x, car.z, car.y);
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  collideWalls(car, env, dt);
  if (env.obstacles) collideObstacles(car, env);

  // Bounds.
  const B = env.bounds, m = 6;
  if (car.x < B.minX + m) { car.x = B.minX + m; car.vx = Math.max(0, car.vx); }
  if (car.x > B.maxX - m) { car.x = B.maxX - m; car.vx = Math.min(0, car.vx); }
  if (car.z < B.minZ + m) { car.z = B.minZ + m; car.vz = Math.max(0, car.vz); }
  if (car.z > B.maxZ - m) { car.z = B.maxZ - m; car.vz = Math.min(0, car.vz); }

  // Vertical: follow the ground, or fly when it falls away faster than gravity can follow.
  const ground = env.surfaces.height(car.x, car.z, car.y);
  if (car.grounded) {
    const gEff = car.absSpeed > T.hoverSpeed ? T.hoverGravity * 1.8 : T.gravity;
    const slopeV = (ground - oldGround) / dt; // vertical speed the road imposes
    const ballistic = car.y + car.vy * dt - 0.5 * gEff * dt * dt;
    if (ground < car.y - 0.02 && ballistic > ground + 0.01 && car.prevSlopeV - slopeV > gEff * dt * 1.0) {
      car.grounded = false;
      car.vy = car.prevSlopeV;
      car.y = Math.max(ground, car.y + car.vy * dt);
      car.airTime = 0;
    } else if (ground - car.y > 0.75 && ground - car.y < 2) {
      // Too tall to climb: treat as a kerb and stop.
      car.x -= car.vx * dt; car.z -= car.vz * dt;
      car.vx *= -0.2; car.vz *= -0.2;
    } else {
      car.y = ground;
      car.prevSlopeV = slopeV;
    }
  } else {
    car.y += car.vy * dt;
    car.airTime += dt;
    if (car.y <= ground) {
      car.landing = Math.max(0, -car.vy);
      if (car.landing > 9) { car.vx *= 0.93; car.vz *= 0.93; }
      car.y = ground;
      car.vy = 0;
      car.prevSlopeV = 0;
      car.grounded = true;
      car.hover = false;
      car.airTime = 0;
    }
  }

  // Remember a safe spot for recovery.
  car.safeTimer += dt;
  if (car.safeTimer > 0.5 && car.grounded && car.surface === 'road' && car.absSpeed > 2) {
    car.safeTimer = 0;
    car.safe = { x: car.x, y: car.y, z: car.z, yaw: car.yaw };
  }
  car.impact *= Math.exp(-6 * dt);
  car.landing *= Math.exp(-6 * dt);
  car.splash = (car.surface === 'water' || car.surface === 'river') && car.grounded ? Math.min(1, car.absSpeed / 15) : 0;
}

function collideWalls(car: CarState, env: PhysicsEnv, dt: number) {
  const T = TUNING;
  const r = T.radius;
  for (let iter = 0; iter < 2; iter++) {
    const fx = car.forwardX, fz = car.forwardZ;
    for (const k of [T.axle, -T.axle, 0]) {
      const cx = car.x + fx * k, cz = car.z + fz * k;
      let pushX = 0, pushZ = 0, hits = 0;
      env.walls.query(cx, cz, r + 0.5, (ax, az, bx, bz, top, bottom) => {
        if (top < car.y + 0.4 || bottom > car.y + 1.6) return;
        const t = segParam(cx, cz, ax, az, bx, bz);
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        let dx = cx - px, dz = cz - pz;
        const d = Math.hypot(dx, dz);
        if (d >= r) return;
        if (d < 1e-4) {
          // Exactly on the wall line: push out along the segment's left normal.
          const L = Math.hypot(bx - ax, bz - az) || 1;
          dx = (bz - az) / L; dz = -(bx - ax) / L;
        } else { dx /= d; dz /= d; }
        const pen = r - d;
        pushX += dx * pen; pushZ += dz * pen; hits++;
      });
      if (!hits) continue;
      const pl = Math.hypot(pushX, pushZ);
      if (pl < 1e-6) continue;
      const nx = pushX / pl, nz = pushZ / pl;
      car.x += pushX; car.z += pushZ;
      const vn = car.vx * nx + car.vz * nz;
      if (vn < 0) {
        const e = 0.18;
        car.vx -= (1 + e) * vn * nx;
        car.vz -= (1 + e) * vn * nz;
        // Scrape: tangential friction scales with the impact.
        const f = Math.max(0.55, 1 - (-vn) * 0.02);
        car.vx *= f; car.vz *= f;
        if (-vn > car.impact) { car.impact = -vn; car.impactX = nx; car.impactZ = nz; }
        // Turn the nose away from head-on hits so you can keep driving.
        const cross = car.forwardX * nz - car.forwardZ * nx;
        if (-vn > 5) car.yawRate += (cross > 0 ? -1 : 1) * Math.min(1.5, -vn * 0.06);
      }
    }
  }
  void dt;
}

function collideObstacles(car: CarState, env: PhysicsEnv) {
  const list = env.obstacles!(car.x, car.z, 8);
  const fx = car.forwardX, fz = car.forwardZ;
  for (const o of list) {
    for (const k of [TUNING.axle, -TUNING.axle]) {
      const cx = car.x + fx * k, cz = car.z + fz * k;
      const dx = cx - o.x, dz = cz - o.z;
      const d = Math.hypot(dx, dz);
      const R = TUNING.radius + o.r;
      if (d >= R || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d;
      const pen = R - d;
      car.x += nx * pen; car.z += nz * pen;
      const rvx = car.vx - o.vx, rvz = car.vz - o.vz;
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        car.vx -= 1.3 * vn * nx; car.vz -= 1.3 * vn * nz;
        car.vx *= 0.9; car.vz *= 0.9;
        if (-vn > car.impact) { car.impact = -vn; car.impactX = nx; car.impactZ = nz; }
        o.hit(-vn, -nx, -nz);
      }
    }
  }
}

/** Nearest point on any road, with the road direction closest to `yaw`. */
export function nearestRoadPose(env: PhysicsEnv, x: number, z: number, yaw: number) {
  for (const R of [30, 80, 200, 500]) {
    const n = env.roads.nearest(x, z, R);
    if (!n) continue;
    const ix = env.roads.index;
    const id = n.seg;
    const ax = ix.ax[id], az = ix.az[id], bx = ix.bx[id], bz = ix.bz[id];
    const px = ax + (bx - ax) * n.t, pz = az + (bz - az) * n.t;
    const dx = bx - ax, dz = bz - az;
    // yaw where forward = (-sin, -cos) points along (dx, dz).
    let ry = Math.atan2(-dx, -dz);
    const diff = Math.atan2(Math.sin(ry - yaw), Math.cos(ry - yaw));
    if (Math.abs(diff) > Math.PI / 2) ry += Math.PI;
    if (distToSeg(px, pz, ax, az, bx, bz) < 1e3) return { x: px, z: pz, yaw: ry };
  }
  return null;
}

export const FIXED_DT = DT;
