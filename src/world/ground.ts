// The ground plane (with Raisina Hill) and areas too large for one tile: the
// Yamuna and its floodplain parks.
import * as THREE from 'three';
import type { MapData } from '../map';
import { terrainHeight, HILL_BOUNDS } from '../terrain';
import { MeshBuilder } from '../geom';
import { materials } from './materials';
import { buildAreas } from './tilebuild';

export function buildGround(map: MapData, globalAreas: number[]) {
  const group = new THREE.Group();
  group.name = 'ground';
  const B = map.bounds;
  const gb = new MeshBuilder(true);
  // Lutyens' Delhi and Chanakyapuri are lawn and garden; elsewhere the ground is dusty.
  const tintAt = (x: number, z: number) => {
    const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const inX = smooth(-5600, -5000, x) * (1 - smooth(2200, 2800, x));
    const inZ = smooth(-1500, -900, z) * (1 - smooth(4600, 5200, z));
    const cp = Math.hypot(x - 167, z + 1420) < 700 ? 0.35 : 1;
    const g = inX * inZ * cp;
    return new THREE.Color(1 - 0.22 * g, 1 - 0.04 * g, 1 - 0.3 * g);
  };
  const pad = 2500, tile = 200;
  const x0 = B.minX - pad, x1 = B.maxX + pad, z0 = B.minZ - pad, z1 = B.maxZ + pad;
  for (let x = x0; x < x1; x += tile) for (let z = z0; z < z1; z += tile) {
    const xe = Math.min(x + tile, x1), ze = Math.min(z + tile, z1);
    const hill = !(xe < HILL_BOUNDS.minX || x > HILL_BOUNDS.maxX || ze < HILL_BOUNDS.minZ || z > HILL_BOUNDS.maxZ);
    const step = hill ? 10 : tile;
    for (let u = x; u < xe - 0.01; u += step) for (let v = z; v < ze - 0.01; v += step) {
      const u1 = Math.min(u + step, xe), v1 = Math.min(v + step, ze);
      const h = (a: number, b: number) => (hill ? terrainHeight(a, b) : 0);
      const s = 1 / 30;
      const c00 = tintAt(u, v), c01 = tintAt(u, v1), c11 = tintAt(u1, v1), c10 = tintAt(u1, v);
      gb.vert(u, h(u, v), v, u * s, v * s, c00); gb.vert(u, h(u, v1), v1, u * s, v1 * s, c01); gb.vert(u1, h(u1, v1), v1, u1 * s, v1 * s, c11);
      gb.vert(u, h(u, v), v, u * s, v * s, c00); gb.vert(u1, h(u1, v1), v1, u1 * s, v1 * s, c11); gb.vert(u1, h(u1, v), v, u1 * s, v * s, c10);
    }
  }
  const ground = new THREE.Mesh(gb.build(), materials().ground);
  ground.receiveShadow = true;
  group.add(ground);
  buildAreas(map, globalAreas, group);
  group.updateMatrixWorld(true);
  group.traverse((o) => { o.matrixAutoUpdate = false; });
  return group;
}
