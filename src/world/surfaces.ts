// Drivable ground: terrain, flyover decks and raised platforms (monument plinths).
import { terrainHeight } from '../terrain';
import type { RoadNetwork } from '../map';

interface Platform { x: number; z: number; hw: number; hd: number; c: number; s: number; h: number; round: boolean; ramp?: boolean }

export class Surfaces {
  private platforms: Platform[] = [];
  constructor(readonly roads: RoadNetwork) {}

  addPlatform(x: number, z: number, w: number, d: number, yaw: number, h: number) {
    this.platforms.push({ x, z, hw: w / 2, hd: d / 2, c: Math.cos(yaw), s: Math.sin(yaw), h, round: false });
  }
  /** Wedge rising along the car-forward direction of `yaw` (yaw as used by CarState). */
  addRamp(x: number, z: number, w: number, len: number, yaw: number, h: number) {
    this.platforms.push({ x, z, hw: w / 2, hd: len / 2, c: Math.cos(yaw), s: Math.sin(yaw), h, round: false, ramp: true });
  }
  addRoundPlatform(x: number, z: number, r: number, h: number) {
    this.platforms.push({ x, z, hw: r, hd: r, c: 1, s: 0, h, round: true });
  }

  /** Base ground (terrain + platforms), ignoring flyovers. */
  baseHeight(x: number, z: number) {
    const t = terrainHeight(x, z);
    let best = t;
    for (const p of this.platforms) {
      const dx = x - p.x, dz = z - p.z;
      if (p.round) {
        if (dx * dx + dz * dz < p.hw * p.hw) best = Math.max(best, t + p.h);
        continue;
      }
      if (p.ramp) {
        // forward = (-sin, -cos), right = (cos, -sin)
        const f = -dx * p.s - dz * p.c, r = dx * p.c - dz * p.s;
        if (Math.abs(r) < p.hw && Math.abs(f) < p.hd) best = Math.max(best, t + (p.h * (f + p.hd)) / (2 * p.hd));
        continue;
      }
      const u = dx * p.c - dz * p.s, v = dx * p.s + dz * p.c;
      if (Math.abs(u) < p.hw && Math.abs(v) < p.hd) best = Math.max(best, t + p.h);
    }
    return best;
  }

  /** Drivable height below a car at height y (flyover decks count only when the car is on or near them). */
  height(x: number, z: number, y: number) {
    const base = this.baseHeight(x, z);
    const deck = this.roads.deckHeight(x, z, y);
    return deck > base ? deck : base;
  }
}
