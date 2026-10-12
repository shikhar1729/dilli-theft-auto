// "Watch a Run": drives a course with the same physics as the player.
import type { CarState, CarInput } from './physics';
import { TUNING } from './physics';
import type { Course } from './race';

export class Autopilot {
  hint = 0;
  constructor(readonly course: Course) {}

  drive(car: CarState): CarInput {
    const c = this.course;
    // Laps: once past the end of a closed course, continue from its start.
    if (c.closed && this.hint > c.x.length - 12 && Math.hypot(car.x - c.x[0], car.z - c.z[0]) < 25) this.hint = 0;
    const pr = c.project(car.x, car.z, this.hint, 30);
    this.hint = pr.index;
    const at = (d: number) => c.indexAt(c.closed && d > c.length ? d - c.length : d);
    const v = car.absSpeed;
    const look = 9 + v * 0.55;
    const ti = at(c.cum[this.hint] + look);
    const tx = c.x[ti], tz = c.z[ti];
    const want = Math.atan2(-(tx - car.x), -(tz - car.z));
    let diff = want - car.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const steer = Math.max(-1, Math.min(1, diff * 2.6));

    // Corner speed from the sharpest bend in the braking window.
    let maxK = 0;
    const span = 30 + v * 2.2;
    for (let d = 0; d < span; d += 8) {
      const i0 = at(c.cum[this.hint] + d), i1 = at(c.cum[this.hint] + d + 12);
      const [ax, az] = c.dirAt(i0), [bx, bz] = c.dirAt(i1);
      const ang = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
      maxK = Math.max(maxK, ang / 12);
    }
    const target = Math.min(TUNING.maxSpeed, Math.sqrt((TUNING.latLimit * 0.7) / Math.max(maxK, 1e-4)));
    const throttle = v < target - 1 ? 1 : v < target ? 0.4 : 0;
    const brake = v > target + 3 ? 1 : v > target + 1 ? 0.4 : 0;
    const straight = maxK < 0.004 && Math.abs(diff) < 0.05;
    return { throttle, brake, steer: car.hover ? steer * 0.6 : steer, boost: straight && car.grounded && car.boost > 0.35, drift: false };
  }
}
