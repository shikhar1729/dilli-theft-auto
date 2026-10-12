// Street food stalls: hand-painted carts (thelas) with an umbrella, a vendor and a
// bilingual sign. Each tile's stalls are merged into one mesh.
import * as THREE from 'three';
import { mergeGeometries } from '../geom';

export const STALL_TYPES = [
  { id: 'chhole', name: 'Chhole Kulche', hi: 'छोले कुलचे', price: 60, color: '#d9431e', board: '#ffd23f', umbrella: ['#e63946', '#f1faee'] },
  { id: 'shikanji', name: 'Shikanji', hi: 'शिकंजी', price: 20, color: '#2a9d8f', board: '#f6f3d0', umbrella: ['#2a9d8f', '#f4d35e'] },
  { id: 'golgappe', name: 'Golgappe', hi: 'गोलगप्पे', price: 30, color: '#7b2cbf', board: '#ffe066', umbrella: ['#7b2cbf', '#ffd166'] },
  { id: 'chai', name: 'Chai', hi: 'चाय', price: 15, color: '#8a4b2a', board: '#fff3e0', umbrella: ['#3a86ff', '#ffffff'] },
  { id: 'momos', name: 'Momos', hi: 'मोमोज़', price: 70, color: '#d62828', board: '#fefae0', umbrella: ['#d62828', '#fcbf49'] },
  { id: 'bhutta', name: 'Bhutta', hi: 'भुट्टा', price: 30, color: '#386641', board: '#f2e8cf', umbrella: ['#386641', '#f2e8cf'] },
  { id: 'kulfi', name: 'Kulfi', hi: 'कुल्फ़ी', price: 40, color: '#c1121f', board: '#ffffff', umbrella: ['#c1121f', '#ffffff'] },
];

const SLOT_W = 256, SLOT_H = 96;
let atlas: THREE.CanvasTexture | null = null;
/** Sign boards in slots on the left; the right edge is plain white for untextured parts. */
function signAtlas() {
  if (atlas) return atlas;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 1024);
  STALL_TYPES.forEach((t, i) => {
    const y = i * (SLOT_H + 8);
    g.fillStyle = t.board; g.fillRect(0, y, SLOT_W, SLOT_H);
    g.strokeStyle = t.color; g.lineWidth = 8; g.strokeRect(4, y + 4, SLOT_W - 8, SLOT_H - 8);
    g.fillStyle = t.color;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 34px Impact, Anton, "Arial Narrow", sans-serif';
    g.fillText(t.name.toUpperCase(), SLOT_W / 2, y + 34);
    g.font = 'bold 26px "Kohinoor Devanagari", "Noto Sans Devanagari", Mangal, sans-serif';
    g.fillStyle = '#222222';
    g.fillText(t.hi, SLOT_W / 2, y + 70);
  });
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

let material: THREE.MeshLambertMaterial | null = null;
export function stallMaterial() {
  material ??= new THREE.MeshLambertMaterial({ vertexColors: true, map: signAtlas() });
  return material;
}

/** Colours a geometry and points its UVs at the atlas's white column. */
function part(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0) {
  g = g.index ? g.toNonIndexed() : g;
  g.translate(x, y, z);
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; uv[i * 2] = 0.98; uv[i * 2 + 1] = 0.02; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

const cache = new Map<number, THREE.BufferGeometry>();
/** One stall of the given type, front facing local -Z, origin on the ground. */
export function stallGeometry(type: number): THREE.BufferGeometry {
  const hit = cache.get(type);
  if (hit) return hit;
  const T = STALL_TYPES[type];
  const P: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, col: THREE.ColorRepresentation, x: number, y: number, z: number) => P.push(part(new THREE.BoxGeometry(w, h, d), col, x, y + h / 2, z));
  const cyl = (rt: number, rb: number, h: number, col: THREE.ColorRepresentation, x: number, y: number, z: number, seg = 10) => P.push(part(new THREE.CylinderGeometry(rt, rb, h, seg), col, x, y + h / 2, z));
  const ball = (r: number, col: THREE.ColorRepresentation, x: number, y: number, z: number) => P.push(part(new THREE.SphereGeometry(r, 8, 6), col, x, y, z));
  // Cart: painted body on bicycle wheels, steel counter.
  box(1.9, 0.75, 0.95, T.color, 0, 0.45, 0);
  box(2.0, 0.05, 1.05, '#c9ced2', 0, 1.2, 0);
  for (const [x, z] of [[-0.75, -0.4], [0.75, -0.4], [-0.75, 0.4], [0.75, 0.4]]) {
    const w = new THREE.TorusGeometry(0.28, 0.04, 5, 12); // wheels roll along the cart's length (x)
    P.push(part(w, '#2b2b2b', x * 1.0, 0.3, z * 1.25));
  }
  box(0.06, 0.06, 1.4, '#555555', 1.15, 0.85, 0); // push handle
  // Umbrella with alternating panels.
  cyl(0.03, 0.03, 2.2, '#777777', 0.55, 1.2, 0.25, 6);
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.ConeGeometry(1.5, 0.55, 8, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4);
    P.push(part(seg, T.umbrella[i % 2], 0.55, 3.05, 0.25));
    const under = new THREE.ConeGeometry(1.5, 0.55, 8, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4);
    under.scale(-1, 1, 1); // back faces so the canopy reads from below
    P.push(part(under, T.umbrella[i % 2], 0.55, 3.05, 0.25));
  }
  // Wares on the counter.
  if (type === 0) { cyl(0.32, 0.26, 0.42, '#b5651d', -0.45, 1.25, 0); cyl(0.22, 0.22, 0.12, '#e9d8a6', 0.35, 1.25, -0.1); cyl(0.18, 0.18, 0.04, '#d9dde0', 0.35, 1.37, 0.25); }
  if (type === 1) { for (const x of [-0.6, -0.15]) { cyl(0.18, 0.18, 0.5, '#f4f1a0', x, 1.25, 0); } ball(0.3, '#b5532d', 0.45, 1.5, 0); for (let i = 0; i < 6; i++) ball(0.06, '#f6e04b', 0.2 + (i % 3) * 0.13, 1.28, -0.3 + Math.floor(i / 3) * 0.12); }
  if (type === 2) { for (let i = 0; i < 14; i++) ball(0.07, '#d4a373', -0.55 + (i % 5) * 0.15, 1.3 + Math.floor(i / 5) * 0.11, -0.1 + ((i * 7) % 3) * 0.1); cyl(0.25, 0.22, 0.4, '#bfc6cc', 0.45, 1.25, 0); cyl(0.2, 0.2, 0.02, '#6a994e', 0.45, 1.66, 0); }
  if (type === 3) { box(0.5, 0.3, 0.4, '#222222', -0.4, 1.25, 0); cyl(0.12, 0.16, 0.28, '#c0c7cc', -0.4, 1.55, 0); for (let i = 0; i < 5; i++) cyl(0.04, 0.03, 0.08, '#b5532d', 0.2 + i * 0.12, 1.25, -0.25); box(1.4, 0.45, 0.35, '#7a5230', 0, 0, -1.2); }
  if (type === 4) { for (let i = 0; i < 4; i++) cyl(0.3, 0.3, 0.16, '#cfd4d8', -0.35, 1.25 + i * 0.17, 0, 14); cyl(0.12, 0.1, 0.08, '#c1121f', 0.4, 1.25, -0.15); }
  if (type === 5) { box(0.7, 0.18, 0.5, '#1b1b1b', -0.2, 1.25, 0); box(0.6, 0.03, 0.4, '#e85d04', -0.2, 1.43, 0); for (let i = 0; i < 5; i++) { const c = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6); c.rotateZ(Math.PI / 2); P.push(part(c, '#e9c46a', 0.4, 1.32, -0.25 + i * 0.12)); } }
  if (type === 6) { box(1.2, 0.55, 0.7, '#ffffff', -0.2, 1.25, 0); box(1.22, 0.12, 0.72, '#c1121f', -0.2, 1.62, 0); cyl(0.05, 0.08, 0.12, '#e0b33a', 0.55, 1.25, 0); }
  // Vendor.
  P.push(part(new THREE.CapsuleGeometry(0.22, 0.75, 4, 8), ['#f1faee', '#e9c46a', '#9d6b53', '#457b9d'][type % 4], 0.2, 1.0, 0.95));
  ball(0.17, '#8d5a3b', 0.2, 1.75, 0.95);
  P.push(part(new THREE.SphereGeometry(0.18, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#1b1410', 0.2, 1.77, 0.97));
  // Sign board on two posts, facing the road (-Z).
  cyl(0.025, 0.025, 1.0, '#555555', -0.8, 1.2, -0.45, 5);
  cyl(0.025, 0.025, 1.0, '#555555', 0.8, 1.2, -0.45, 5);
  const sign = new THREE.PlaneGeometry(1.9, 0.72).toNonIndexed();
  sign.rotateY(Math.PI);
  sign.translate(0, 2.35, -0.47);
  const n = sign.getAttribute('position').count;
  const uv = sign.getAttribute('uv') as THREE.BufferAttribute;
  const v0 = 1 - (type * (SLOT_H + 8) + SLOT_H) / 1024, v1 = 1 - (type * (SLOT_H + 8)) / 1024, u1 = SLOT_W / 512;
  for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) > 0.5 ? 0 : u1, uv.getY(i) > 0.5 ? v1 : v0);
  const col = new Float32Array(n * 3).fill(1);
  sign.setAttribute('color', new THREE.BufferAttribute(col, 3));
  P.push(sign);
  const back = new THREE.PlaneGeometry(1.9, 0.72);
  P.push(part(back, '#555555', 0, 2.35, -0.43));
  const g = mergeGeometries(P);
  g.computeVertexNormals();
  cache.set(type, g);
  return g;
}

/** Merges a tile's stalls into one mesh. data: [x, z (dm), yaw (mrad), type] × n. */
export function buildStallMesh(data: number[], heightAt: (x: number, z: number) => number): THREE.Mesh | null {
  if (!data.length) return null;
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  for (let i = 0; i < data.length; i += 4) {
    const x = data[i] / 10, z = data[i + 1] / 10;
    q.setFromAxisAngle(up, data[i + 2] / 1000);
    const g = stallGeometry(data[i + 3]).clone();
    g.applyMatrix4(m.compose(pos.set(x, heightAt(x, z), z), q, one));
    parts.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), stallMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
