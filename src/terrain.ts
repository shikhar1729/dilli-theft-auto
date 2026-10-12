// Ground elevation. New Delhi's core is nearly flat; the one hill that matters is
// Raisina Hill, which lifts Rashtrapati Bhavan, North Block and South Block above
// Vijay Chowk. The plateau's eastern edge is a short, steep ramp (the famous
// "gradient" between the Secretariat blocks), slightly exaggerated for play.

const HILL_H = 13;
// Plateau rectangle (world metres). East edge = crest between the Secretariat blocks.
const PX0 = -3400, PX1 = -1110, PZ0 = 200, PZ1 = 1080;
const EAST_RUN = 205; // crest → Vijay Chowk
const SIDE_RUN = 520; // gentle fall-off on other sides

const A = 0.07, B = 0.16; // rounding at crest and foot, as fractions of the run
const NORM = 1 - A / 2 - B / 2;
function fall(t: number) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let f: number;
  if (t < A) f = (t * t) / (2 * A);
  else if (t < 1 - B) f = t - A / 2;
  else f = NORM - ((1 - t) * (1 - t)) / (2 * B);
  return f / NORM;
}

export function terrainHeight(x: number, z: number): number {
  if (x > PX1 + EAST_RUN + 5 || z < PZ0 - SIDE_RUN - 5 || z > PZ1 + SIDE_RUN + 5) return 0;
  const e = Math.max(0, x - PX1) / EAST_RUN;
  const w = Math.max(0, PX0 - x);
  const dz = Math.max(0, PZ0 - z, z - PZ1);
  const s = Math.hypot(w, dz) / SIDE_RUN;
  const t = Math.min(1, Math.hypot(e, s));
  return HILL_H * (1 - fall(t));
}

/** Bounding box of the non-flat region, for meshing. */
export const HILL_BOUNDS = { minX: PX0 - SIDE_RUN, maxX: PX1 + EAST_RUN, minZ: PZ0 - SIDE_RUN, maxZ: PZ1 + SIDE_RUN };

export function inHillRegion(x: number, z: number, pad = 0) {
  return x > HILL_BOUNDS.minX - pad && x < HILL_BOUNDS.maxX + pad && z > HILL_BOUNDS.minZ - pad && z < HILL_BOUNDS.maxZ + pad;
}
