// Geometry helpers: triangulation, terrain draping, ribbons and mesh assembly.
import * as THREE from 'three';
import { terrainHeight, inHillRegion } from './terrain';

/** Growable typed buffers for one merged mesh. */
export class MeshBuilder {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  nrm: number[] | null = null;
  constructor(readonly withColor = false, withNormals = false) { if (withNormals) this.nrm = []; }
  vert(x: number, y: number, z: number, u = 0, v = 0, c?: THREE.Color, n?: [number, number, number]) {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    if (this.withColor) this.col.push(c ? c.r : 1, c ? c.g : 1, c ? c.b : 1);
    if (this.nrm) this.nrm.push(...(n ?? [0, 1, 0]));
  }
  get count() { return this.pos.length / 3; }
  build(computeNormals = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.nrm) g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    else if (computeNormals) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export function flatToVec2(flat: number[]) {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i], flat[i + 1]));
  return out;
}

/** Triangulates a polygon (flat x,z ring + holes). Returns vertex list and face indices. */
export function triangulate(outer: number[], holes: number[][] = []) {
  const contour = flatToVec2(outer);
  const hs = holes.map(flatToVec2);
  // ShapeUtils wants clockwise contour in its own convention; it handles either, but holes must be opposite.
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  for (const h of hs) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
  let faces: number[][] = [];
  try { faces = THREE.ShapeUtils.triangulateShape(contour, hs); } catch { faces = []; }
  const verts = contour.concat(...hs);
  return { verts, faces };
}

/**
 * Emits triangles (x,z) into a builder, lifting each vertex onto the terrain plus
 * `lift`. Triangles inside the hill region are subdivided so they follow the slope.
 */
export function drapeTriangle(
  b: MeshBuilder, ax: number, az: number, bx: number, bz: number, cx: number, cz: number,
  lift: number, uvScale: number, color?: THREE.Color, maxEdge = 10, depth = 0,
) {
  const hilly = inHillRegion(ax, az, 30) || inHillRegion(bx, bz, 30) || inHillRegion(cx, cz, 30);
  if (hilly && depth < 7) {
    const lab = Math.hypot(bx - ax, bz - az), lbc = Math.hypot(cx - bx, cz - bz), lca = Math.hypot(ax - cx, az - cz);
    const longest = Math.max(lab, lbc, lca);
    if (longest > maxEdge) {
      // Split the longest edge only (keeps triangle count low).
      if (longest === lab) {
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        drapeTriangle(b, ax, az, mx, mz, cx, cz, lift, uvScale, color, maxEdge, depth + 1);
        drapeTriangle(b, mx, mz, bx, bz, cx, cz, lift, uvScale, color, maxEdge, depth + 1);
      } else if (longest === lbc) {
        const mx = (bx + cx) / 2, mz = (bz + cz) / 2;
        drapeTriangle(b, ax, az, bx, bz, mx, mz, lift, uvScale, color, maxEdge, depth + 1);
        drapeTriangle(b, ax, az, mx, mz, cx, cz, lift, uvScale, color, maxEdge, depth + 1);
      } else {
        const mx = (cx + ax) / 2, mz = (cz + az) / 2;
        drapeTriangle(b, ax, az, bx, bz, mx, mz, lift, uvScale, color, maxEdge, depth + 1);
        drapeTriangle(b, mx, mz, bx, bz, cx, cz, lift, uvScale, color, maxEdge, depth + 1);
      }
      return;
    }
  }
  const y = (x: number, z: number) => (hilly ? terrainHeight(x, z) : 0) + lift;
  // Counter-clockwise when viewed from +Y (x east, z south) means negative signed area in x/z.
  const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  if (cross > 0) {
    b.vert(ax, y(ax, az), az, ax / uvScale, az / uvScale, color);
    b.vert(cx, y(cx, cz), cz, cx / uvScale, cz / uvScale, color);
    b.vert(bx, y(bx, bz), bz, bx / uvScale, bz / uvScale, color);
  } else {
    b.vert(ax, y(ax, az), az, ax / uvScale, az / uvScale, color);
    b.vert(bx, y(bx, bz), bz, bx / uvScale, bz / uvScale, color);
    b.vert(cx, y(cx, cz), cz, cx / uvScale, cz / uvScale, color);
  }
}

export function drapePolygon(b: MeshBuilder, outer: number[], holes: number[][] | undefined, lift: number, uvScale: number, color?: THREE.Color) {
  const { verts, faces } = triangulate(outer, holes);
  for (const [i, j, k] of faces) {
    const A = verts[i], B = verts[j], C = verts[k];
    drapeTriangle(b, A.x, A.y, B.x, B.y, C.x, C.y, lift, uvScale, color);
  }
}

/** Resamples a polyline so no segment exceeds maxLen (finer on the hill). */
export function densify(flat: number[], maxLen = 40, hillLen = 8): number[] {
  const out: number[] = [flat[0], flat[1]];
  for (let i = 2; i < flat.length; i += 2) {
    const ax = flat[i - 2], az = flat[i - 1], bx = flat[i], bz = flat[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    const lim = inHillRegion(ax, az, 20) || inHillRegion(bx, bz, 20) ? hillLen : maxLen;
    const n = Math.max(1, Math.ceil(L / lim));
    for (let k = 1; k <= n; k++) out.push(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
  }
  return out;
}

/** Offsets a polyline sideways (positive = to the right of travel direction). */
export function offsetPolyline(flat: number[], off: number): number[] {
  const n = flat.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [nx, nz] = vertexNormal(flat, i);
    out.push(flat[i * 2] + nx * off, flat[i * 2 + 1] + nz * off);
  }
  return out;
}

/** Right-hand unit normal at vertex i with miter scaling (clamped). */
export function vertexNormal(flat: number[], i: number): [number, number] {
  const n = flat.length / 2;
  const seg = (a: number) => {
    const dx = flat[a * 2 + 2] - flat[a * 2], dz = flat[a * 2 + 3] - flat[a * 2 + 1];
    const L = Math.hypot(dx, dz) || 1;
    return [dx / L, dz / L];
  };
  const d0 = i > 0 ? seg(i - 1) : seg(0);
  const d1 = i < n - 1 ? seg(i) : seg(n - 2);
  // Right of direction (dx, dz) in x-east/z-south is (-dz, dx).
  let nx = -(d0[1] + d1[1]), nz = d0[0] + d1[0];
  const L = Math.hypot(nx, nz);
  if (L < 1e-6) return [-d1[1], d1[0]];
  nx /= L; nz /= L;
  const cos = nx * -d1[1] + nz * d1[0];
  const miter = Math.min(2.2, 1 / Math.max(0.2, cos));
  return [nx * miter, nz * miter];
}

/**
 * Builds a flat ribbon along a polyline (draped on terrain unless heights given).
 * u runs along the length (metres / uLen); v across (0..1) unless worldUV.
 */
export function ribbon(
  b: MeshBuilder, flat: number[], width: number, lift: number,
  opts: { worldUV?: number; uLen?: number; color?: THREE.Color; heights?: number[]; offset?: number } = {},
) {
  const n = flat.length / 2;
  if (n < 2) return;
  const half = width / 2;
  const L: number[] = [];
  const R: number[] = [];
  const along: number[] = [0];
  for (let i = 0; i < n; i++) {
    const [nx, nz] = vertexNormal(flat, i);
    const x = flat[i * 2] + nx * (opts.offset ?? 0), z = flat[i * 2 + 1] + nz * (opts.offset ?? 0);
    L.push(x - nx * half, z - nz * half);
    R.push(x + nx * half, z + nz * half);
    if (i > 0) along.push(along[i - 1] + Math.hypot(flat[i * 2] - flat[i * 2 - 2], flat[i * 2 + 1] - flat[i * 2 - 1]));
  }
  const yAt = (x: number, z: number, i: number) => (opts.heights ? opts.heights[i] : terrainHeight(x, z)) + lift;
  const uv = (x: number, z: number, i: number, side: number): [number, number] =>
    opts.worldUV ? [x / opts.worldUV, z / opts.worldUV] : [along[i] / (opts.uLen ?? 1), side];
  for (let i = 0; i < n - 1; i++) {
    const l0x = L[i * 2], l0z = L[i * 2 + 1], r0x = R[i * 2], r0z = R[i * 2 + 1];
    const l1x = L[i * 2 + 2], l1z = L[i * 2 + 3], r1x = R[i * 2 + 2], r1z = R[i * 2 + 3];
    const q = [
      [l0x, l0z, i, 0], [r0x, r0z, i, 1], [r1x, r1z, i + 1, 1],
      [l0x, l0z, i, 0], [r1x, r1z, i + 1, 1], [l1x, l1z, i + 1, 0],
    ] as const;
    for (const [x, z, k, s] of q) {
      const [u, v] = uv(x, z, k, s);
      b.vert(x, yAt(x, z, k), z, u, v, opts.color);
    }
  }
}

/** A flat disc (junction filler) draped on the terrain. */
export function disc(b: MeshBuilder, x: number, z: number, r: number, lift: number, worldUV: number, color?: THREE.Color, y?: number) {
  const seg = 12;
  const yy = (px: number, pz: number) => (y ?? terrainHeight(px, pz)) + lift;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const x0 = x + Math.cos(a0) * r, z0 = z + Math.sin(a0) * r;
    const x1 = x + Math.cos(a1) * r, z1 = z + Math.sin(a1) * r;
    b.vert(x, yy(x, z), z, x / worldUV, z / worldUV, color);
    b.vert(x1, yy(x1, z1), z1, x1 / worldUV, z1 / worldUV, color);
    b.vert(x0, yy(x0, z0), z0, x0 / worldUV, z0 / worldUV, color);
  }
}

export function hash01(n: number) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13;
  return (x >>> 0) / 4294967295;
}

/** Merges BufferGeometries that share the same attribute layout (position/normal/uv/color). */
export function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = ['position', 'normal', 'uv', 'color'].filter((n) => parts.every((g) => g.getAttribute(n)));
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = parts[0].getAttribute(name).itemSize;
    const total = parts.reduce((s, g) => s + g.getAttribute(name).count * size, 0);
    const arr = new Float32Array(total);
    let o = 0;
    for (const g of parts) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) arr[o++] = a.array[i * size + k] as number;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

/** Applies a vertex colour to every vertex of a geometry (adds the attribute). */
export function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

/**
 * Bakes every static mesh under `root` into one vertex-coloured geometry (colours
 * come from each mesh's material). Meshes flagged `userData.keep` are skipped.
 * Returns null when there is nothing to merge.
 */
export function bakeVertexColored(root: THREE.Object3D, relativeTo?: THREE.Object3D, onlyLambert = false): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const inv = relativeTo ? new THREE.Matrix4().copy(relativeTo.matrixWorld).invert() : new THREE.Matrix4();
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as any).isInstancedMesh || m.userData.keep) return;
    const mat = m.material as THREE.MeshLambertMaterial;
    if (Array.isArray(mat) || mat.map || mat.transparent) return;
    if (onlyLambert && !(mat as any).isMeshLambertMaterial) return;
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    paint(g, (mat.color ?? new THREE.Color(0xffffff)) as THREE.Color);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    parts.push(g);
    m.userData.baked = true;
  });
  if (!parts.length) return null;
  return mergeGeometries(parts);
}

/** Replaces baked meshes under `root` with one merged mesh (keeps textured / flagged meshes). */
export function mergeInPlace(root: THREE.Object3D, material: THREE.Material, onlyLambert = true) {
  const geo = bakeVertexColored(root, root, onlyLambert);
  if (!geo) return root;
  const remove: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.userData.baked) remove.push(o); });
  for (const o of remove) o.parent?.remove(o);
  // Drop now-empty groups.
  const prune = (o: THREE.Object3D) => { for (const c of [...o.children]) { prune(c); if (!(c as THREE.Mesh).isMesh && !c.children.length && c.type === 'Group' && !c.userData.keep) o.remove(c); } };
  prune(root);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
  return root;
}
