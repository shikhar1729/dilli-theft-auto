// Procedural vehicles. Every design here is original and unbranded: a classic
// black-and-yellow taxi, a CNG auto-rickshaw, an open roadster and an open jeep,
// plus traffic (DTC-style bus, hatchbacks). Models face local -Z; origin at the
// ground, centred between the axles.
import * as THREE from 'three';
import { toTexture } from '../textures';
import { bakeVertexColored } from '../geom';

export type CarModelId = 'taxi' | 'auto' | 'roadster' | 'jeep';
export type DecalId = 'none' | 'stripes' | 'horn' | 'marigold' | 'rangoli';

export interface CarPaint { id: string; name: string; body: string; accent: string }

export const CAR_MODELS: { id: CarModelId; name: string; tag: string; paints: CarPaint[] }[] = [
  {
    id: 'taxi', name: 'Kaali Peeli', tag: 'Classic taxi · Hood ornament included',
    paints: [
      { id: 'kp', name: 'Kaali Peeli', body: '#18181a', accent: '#f4c20d' },
      { id: 'cng', name: 'CNG Green', body: '#2e8b3e', accent: '#f4c20d' },
      { id: 'sarkari', name: 'Sarkari White', body: '#efeee8', accent: '#efeee8' },
    ],
  },
  {
    id: 'auto', name: 'Tuk-Tuk', tag: 'Three wheels · Zero fear',
    paints: [
      { id: 'delhi', name: 'Delhi CNG', body: '#1f8a3a', accent: '#f6c516' },
      { id: 'night', name: 'Raat Rani', body: '#1b1b1f', accent: '#f6c516' },
      { id: 'sky', name: 'Aasmani', body: '#2a74c9', accent: '#f2efe6' },
    ],
  },
  {
    id: 'roadster', name: 'Gulmohar', tag: 'Open roadster · Wind in your hair',
    paints: [
      { id: 'genda', name: 'Genda Orange', body: '#f08a1c', accent: '#2b2b2b' },
      { id: 'mor', name: 'Mor Blue', body: '#15707c', accent: '#e9e3d3' },
      { id: 'sindoor', name: 'Sindoor Red', body: '#c62d2d', accent: '#e9e3d3' },
    ],
  },
  {
    id: 'jeep', name: 'Ridge Runner', tag: 'Open jeep · Built for the Ridge',
    paints: [
      { id: 'olive', name: 'Fauji Olive', body: '#5c6b3a', accent: '#2a2a28' },
      { id: 'safed', name: 'Safed', body: '#ecebe4', accent: '#2a2a28' },
      { id: 'mitti', name: 'Mitti', body: '#b7864f', accent: '#2a2a28' },
    ],
  },
];

export const DECALS: { id: DecalId; name: string }[] = [
  { id: 'stripes', name: 'Kesari stripes' },
  { id: 'horn', name: 'Horn OK Please' },
  { id: 'marigold', name: 'Marigold' },
  { id: 'rangoli', name: 'Rangoli' },
  { id: 'none', name: 'No decal' },
];

export interface VehicleRig {
  root: THREE.Group;        // positioned/rotated by the game
  body: THREE.Group;        // pitch/roll/bounce
  wheels: THREE.Object3D[]; // spin about X
  steerWheels: THREE.Object3D[];
  kites: THREE.Object3D[];  // hover wings
  seat: THREE.Vector3;      // driver hip position (body space)
  driverSlot: THREE.Group;
  setPaint(p: CarPaint): void;
  setDecal(d: DecalId): void;
  dispose(): void;
}

const glassMat = () => new THREE.MeshPhongMaterial({ color: 0x1e2a33, shininess: 100, specular: 0x8899aa });
const chromeMat = () => new THREE.MeshPhongMaterial({ color: 0xdadde0, shininess: 120, specular: 0xffffff });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x1b1b1b });
const hubMat = new THREE.MeshPhongMaterial({ color: 0xc9ccd0, shininess: 60 });
const blackMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xc81e1e });
const seatMat = new THREE.MeshLambertMaterial({ color: 0x6b3b24 });

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Side profile (x forward = front, y up) extruded across the car's width. */
function profile(points: [number, number][], width: number, bevel = 0.06) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // shape +x → world -z (front)
  g.computeVertexNormals();
  return g;
}

function wheel(r: number, w: number) {
  const g = new THREE.Group();
  const tyre = mesh(new THREE.CylinderGeometry(r, r, w, 18), tyreMat);
  tyre.rotation.z = Math.PI / 2;
  const hub = mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 12), hubMat);
  hub.rotation.z = Math.PI / 2;
  const spoke = mesh(new THREE.BoxGeometry(w + 0.04, r * 0.18, r * 1.0), blackMat);
  g.add(tyre, hub, spoke);
  return g;
}

function kite(color: string, side: number) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(1.5, 1.1); s.lineTo(3.3, 0); s.lineTo(1.5, -0.9); s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  const sail = mesh(geo, m);
  const spar = mesh(new THREE.BoxGeometry(2.9, 0.04, 0.04), new THREE.MeshLambertMaterial({ color: 0x8a6a3a }), 1.45, 0.02, 0);
  const spar2 = mesh(new THREE.BoxGeometry(0.04, 0.04, 1.65), spar.material as THREE.Material, 1.3, 0.02, -0.07);
  const tail = mesh(new THREE.PlaneGeometry(0.25, 1.1), new THREE.MeshLambertMaterial({ color: '#f5f0e6', side: THREE.DoubleSide }), 2.9, 0, 0.6);
  tail.rotation.x = -Math.PI / 2;
  g.add(sail, spar, spar2, tail);
  g.scale.set(side, 1, 1);
  return g;
}

// ------------------------------------------------------------------ decal textures

const decalCache = new Map<DecalId, THREE.Texture>();
export function decalTexture(id: DecalId): THREE.Texture | null {
  if (id === 'none') return null;
  if (decalCache.has(id)) return decalCache.get(id)!;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 128);
  if (id === 'stripes') {
    [['#ff9933', 18], ['#ffffff', 52], ['#138808', 86]].forEach(([col, y]) => { g.fillStyle = col as string; g.fillRect(0, y as number, 256, 24); });
  } else if (id === 'horn') {
    g.fillStyle = '#f7d046'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#d6286d'; g.lineWidth = 10; g.strokeRect(6, 6, 244, 116);
    g.fillStyle = '#1b6fb8';
    g.font = 'bold 34px Impact, Anton, sans-serif'; g.textAlign = 'center';
    g.fillText('HORN OK', 128, 58);
    g.fillStyle = '#d6286d'; g.fillText('PLEASE', 128, 98);
  } else if (id === 'marigold') {
    for (let i = 0; i < 9; i++) {
      const x = 20 + i * 27, y = 64 + Math.sin(i) * 26;
      for (let r = 16; r > 2; r -= 4) { g.fillStyle = r % 8 ? '#f5a524' : '#e9781f'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    }
  } else if (id === 'rangoli') {
    const cols = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#7b2cbf'];
    for (let ring = 5; ring > 0; ring--) {
      g.fillStyle = cols[ring % cols.length];
      for (let p = 0; p < 12; p++) {
        const a = (p / 12) * Math.PI * 2;
        g.beginPath(); g.ellipse(128 + Math.cos(a) * ring * 9, 64 + Math.sin(a) * ring * 9, ring * 4, ring * 2, a, 0, Math.PI * 2); g.fill();
      }
    }
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(128, 64, 7, 0, Math.PI * 2); g.fill();
  }
  const t = toTexture(c, false);
  decalCache.set(id, t);
  return t;
}

// ------------------------------------------------------------------ player cars

export function buildCar(id: CarModelId, paint: CarPaint, decal: DecalId): VehicleRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const bodyMat = new THREE.MeshPhongMaterial({ color: paint.body, shininess: 70, specular: 0x666666 });
  const accentMat = new THREE.MeshPhongMaterial({ color: paint.accent, shininess: 60, specular: 0x444444 });
  const wheels: THREE.Object3D[] = [];
  const steerWheels: THREE.Object3D[] = [];
  const driverSlot = new THREE.Group();
  const seat = new THREE.Vector3();
  const decalMeshes: THREE.Mesh[] = [];
  const decalMat = new THREE.MeshLambertMaterial({ transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const addDecal = (w: number, h: number, pos: THREE.Vector3, rot: THREE.Euler) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMat);
    m.position.copy(pos); m.rotation.copy(rot);
    decalMeshes.push(m); body.add(m);
  };
  const addWheel = (x: number, z: number, r: number, w: number, steer: boolean) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const wh = wheel(r, w);
    pivot.add(wh);
    body.add(pivot);
    wheels.push(wh);
    if (steer) steerWheels.push(pivot);
  };

  if (id === 'taxi') {
    const lower = mesh(profile([[2.2, 0.32], [2.25, 0.62], [1.95, 0.8], [1.2, 0.95], [0.6, 0.98], [-1.55, 0.98], [-2.1, 0.86], [-2.2, 0.48], [-2.0, 0.32]], 1.76, 0.09), bodyMat);
    const cabin = mesh(profile([[0.72, 0.96], [0.2, 1.5], [-0.95, 1.52], [-1.45, 0.96]], 1.5, 0.05), glassMat());
    const roof = mesh(profile([[0.22, 1.46], [0.2, 1.58], [-0.98, 1.6], [-0.98, 1.47]], 1.54, 0.04), accentMat);
    body.add(lower, cabin, roof);
    // Taxi sign and chrome.
    body.add(mesh(new THREE.BoxGeometry(0.55, 0.16, 0.22), new THREE.MeshLambertMaterial({ color: 0xf8f4e8 }), 0, 1.68, -0.35));
    body.add(mesh(new THREE.BoxGeometry(1.8, 0.14, 0.12), chromeMat(), 0, 0.42, -2.25), mesh(new THREE.BoxGeometry(1.8, 0.14, 0.12), chromeMat(), 0, 0.42, 2.22));
    for (const s of [-1, 1]) {
      const hl = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 14), lampMat, s * 0.62, 0.7, -2.2);
      hl.rotation.x = Math.PI / 2; body.add(hl);
      body.add(mesh(new THREE.BoxGeometry(0.22, 0.12, 0.05), tailMat, s * 0.7, 0.7, 2.21));
    }
    // Yellow accent band along the flanks for two-tone paints.
    for (const s of [-1, 1]) body.add(mesh(new THREE.BoxGeometry(0.02, 0.1, 3.7), accentMat, s * 0.89, 0.72, 0));
    addWheel(-0.86, -1.35, 0.36, 0.24, true); addWheel(0.86, -1.35, 0.36, 0.24, true);
    addWheel(-0.86, 1.4, 0.36, 0.24, false); addWheel(0.86, 1.4, 0.36, 0.24, false);
    seat.set(-0.4, 0.62, -0.05);
    addDecal(1.1, 0.55, new THREE.Vector3(0, 0.99, -1.25), new THREE.Euler(-Math.PI / 2 + 0.12, 0, 0));
    for (const s of [-1, 1]) addDecal(1.3, 0.38, new THREE.Vector3(s * 0.91, 0.6, 0.15), new THREE.Euler(0, s * Math.PI / 2, 0));
  } else if (id === 'auto') {
    body.add(mesh(new THREE.BoxGeometry(1.25, 0.14, 2.35), blackMat, 0, 0.36, 0.1));
    const nose = mesh(profile([[1.38, 0.4], [1.42, 0.95], [1.1, 1.18], [0.75, 1.18], [0.7, 0.4]], 0.82, 0.06), bodyMat);
    body.add(nose);
    body.add(mesh(new THREE.BoxGeometry(1.3, 0.6, 1.25), bodyMat, 0, 0.42, 0.75));
    body.add(mesh(new THREE.BoxGeometry(1.3, 0.85, 0.12), bodyMat, 0, 0.42, 1.36));
    body.add(mesh(new THREE.BoxGeometry(1.1, 0.18, 0.55), seatMat, 0, 1.02, 0.95));
    body.add(mesh(new THREE.BoxGeometry(1.1, 0.5, 0.12), seatMat, 0, 1.15, 1.22));
    body.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.42), seatMat, 0, 0.85, -0.25));
    // Canopy on four poles.
    const canopyGeo = new THREE.CylinderGeometry(0.7, 0.7, 2.55, 20, 1, false, -Math.PI / 2, Math.PI);
    canopyGeo.rotateX(Math.PI / 2);
    const canopy = mesh(canopyGeo, accentMat, 0, 1.62, 0.12);
    canopy.scale.set(0.94, 0.42, 1);
    body.add(canopy);
    for (const sx of [-0.62, 0.62]) for (const sz of [-1.05, 1.3]) body.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), blackMat, sx, 0.4 + 0.65, sz));
    const hl = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 12), lampMat, 0, 0.88, -1.44);
    hl.rotation.x = Math.PI / 2; body.add(hl);
    body.add(mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), chromeMat(), 0, 1.12, -0.88)); // handlebar
    for (const s of [-1, 1]) body.add(mesh(new THREE.BoxGeometry(0.16, 0.1, 0.04), tailMat, s * 0.5, 0.6, 1.43));
    addWheel(0, -1.05, 0.3, 0.18, true);
    addWheel(-0.6, 0.85, 0.3, 0.18, false); addWheel(0.6, 0.85, 0.3, 0.18, false);
    seat.set(0, 0.92, -0.25);
    addDecal(1.0, 0.5, new THREE.Vector3(0, 0.66, 1.43), new THREE.Euler(0, 0, 0));
    for (const s of [-1, 1]) addDecal(1.0, 0.42, new THREE.Vector3(s * 0.66, 0.72, 0.72), new THREE.Euler(0, s * Math.PI / 2, 0));
  } else if (id === 'roadster') {
    const lower = mesh(profile([[2.05, 0.3], [2.1, 0.58], [1.7, 0.78], [0.45, 0.86], [-0.2, 0.84], [-1.2, 0.9], [-1.95, 0.72], [-2.05, 0.38], [-1.9, 0.3]], 1.7, 0.1), bodyMat);
    body.add(lower);
    for (const sz of [-1.3, 1.3]) for (const s of [-1, 1]) {
      const f = mesh(new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat, s * 0.78, 0.55, sz);
      f.scale.set(0.55, 0.62, 1.15); body.add(f);
    }
    body.add(mesh(new THREE.BoxGeometry(1.25, 0.12, 1.15), new THREE.MeshLambertMaterial({ color: 0x2a1d17 }), 0, 0.84, 0.05)); // cockpit tub
    body.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.15), seatMat, -0.32, 0.9, 0.42), mesh(new THREE.BoxGeometry(0.5, 0.5, 0.15), seatMat, 0.32, 0.9, 0.42));
    const ws = mesh(new THREE.PlaneGeometry(1.3, 0.38), new THREE.MeshPhongMaterial({ color: 0xbfd8e6, transparent: true, opacity: 0.45, shininess: 120, side: THREE.DoubleSide }), 0, 1.06, -0.55);
    ws.rotation.x = -0.35; body.add(ws);
    body.add(mesh(new THREE.BoxGeometry(1.34, 0.04, 0.04), chromeMat(), 0, 1.25, -0.48));
    body.add(mesh(new THREE.BoxGeometry(1.1, 0.12, 0.3), chromeMat(), 0, 0.44, -2.08));
    for (const s of [-1, 1]) {
      const hl = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 14), lampMat, s * 0.62, 0.72, -1.72);
      hl.rotation.x = Math.PI / 2; body.add(hl);
      body.add(mesh(new THREE.BoxGeometry(0.18, 0.1, 0.05), tailMat, s * 0.6, 0.66, 2.02));
    }
    addWheel(-0.8, -1.3, 0.34, 0.24, true); addWheel(0.8, -1.3, 0.34, 0.24, true);
    addWheel(-0.8, 1.3, 0.34, 0.24, false); addWheel(0.8, 1.3, 0.34, 0.24, false);
    seat.set(-0.32, 0.72, 0.25);
    addDecal(0.95, 0.5, new THREE.Vector3(0, 0.88, -1.05), new THREE.Euler(-Math.PI / 2 + 0.07, 0, 0));
    for (const s of [-1, 1]) addDecal(1.1, 0.32, new THREE.Vector3(s * 0.86, 0.6, -0.2), new THREE.Euler(0, s * Math.PI / 2, 0));
  } else {
    // Jeep
    body.add(mesh(new THREE.BoxGeometry(1.62, 0.62, 3.5), bodyMat, 0, 0.5, 0.1));
    body.add(mesh(new THREE.BoxGeometry(1.5, 0.22, 1.25), bodyMat, 0, 1.06, -1.12)); // bonnet
    body.add(mesh(new THREE.BoxGeometry(1.4, 0.38, 0.06), new THREE.MeshLambertMaterial({ color: 0x2b2b2b }), 0, 0.78, -1.77)); // grille
    for (const s of [-1, 1]) {
      body.add(mesh(new THREE.BoxGeometry(0.3, 0.06, 1.0), accentMat, s * 0.88, 0.94, -1.25));
      body.add(mesh(new THREE.BoxGeometry(0.3, 0.06, 0.9), accentMat, s * 0.88, 0.94, 1.25));
      const hl = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 14), lampMat, s * 0.5, 0.92, -1.8);
      hl.rotation.x = Math.PI / 2; body.add(hl);
      body.add(mesh(new THREE.BoxGeometry(0.16, 0.12, 0.05), tailMat, s * 0.62, 0.85, 1.86));
    }
    const frame = mesh(new THREE.BoxGeometry(1.5, 0.5, 0.05), new THREE.MeshPhongMaterial({ color: 0xbfd8e6, transparent: true, opacity: 0.4, side: THREE.DoubleSide }), 0, 1.28, -0.5);
    frame.rotation.x = -0.15; body.add(frame);
    for (const s of [-1, 1]) {
      body.add(mesh(new THREE.BoxGeometry(0.07, 1.0, 0.07), accentMat, s * 0.74, 1.1, 0.45));
    }
    body.add(mesh(new THREE.BoxGeometry(1.55, 0.07, 0.07), accentMat, 0, 2.08, 0.45));
    body.add(mesh(new THREE.BoxGeometry(0.5, 0.45, 0.14), seatMat, -0.36, 1.1, 0.25), mesh(new THREE.BoxGeometry(0.5, 0.45, 0.14), seatMat, 0.36, 1.1, 0.25));
    body.add(mesh(new THREE.BoxGeometry(1.3, 0.4, 0.14), seatMat, 0, 1.1, 1.15));
    const spare = wheel(0.36, 0.22); spare.rotation.y = Math.PI / 2; spare.rotation.z = Math.PI / 2; spare.position.set(0, 0.95, 1.95);
    body.add(spare);
    addWheel(-0.82, -1.25, 0.4, 0.28, true); addWheel(0.82, -1.25, 0.4, 0.28, true);
    addWheel(-0.82, 1.25, 0.4, 0.28, false); addWheel(0.82, 1.25, 0.4, 0.28, false);
    seat.set(-0.36, 0.88, 0.1);
    addDecal(1.1, 0.55, new THREE.Vector3(0, 1.175, -1.12), new THREE.Euler(-Math.PI / 2, 0, 0));
    for (const s of [-1, 1]) addDecal(1.4, 0.42, new THREE.Vector3(s * 0.815, 0.55, 0.3), new THREE.Euler(0, s * Math.PI / 2, 0));
  }

  driverSlot.position.copy(seat);
  body.add(driverSlot);

  const kites: THREE.Object3D[] = [];
  const kiteCols = ['#e8336d', '#ff8f1f', '#1fa3a3', '#7b3fbf'];
  for (const s of [-1, 1]) {
    const k = kite(kiteCols[(s + 1) / 2 + (id.length % 2) * 2], s);
    k.position.set(s * 0.6, 0.95, 0.2);
    // Angle the kites up like wings so they read from the chase camera.
    k.rotation.set(-0.12, 0, s * 0.42);
    k.scale.multiplyScalar(0.001);
    k.visible = false;
    body.add(k);
    kites.push(k);
  }

  const setDecal = (d: DecalId) => {
    const t = decalTexture(d);
    decalMat.map = t;
    decalMat.needsUpdate = true;
    for (const m of decalMeshes) m.visible = !!t;
  };
  setDecal(decal);

  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return {
    root, body, wheels, steerWheels, kites, seat, driverSlot,
    setPaint(p) { bodyMat.color.set(p.body); accentMat.color.set(p.accent); },
    setDecal,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.geometry.dispose(); }
      });
    },
  };
}

/** Animates wheels, steering, kites and body attitude from the simulation state. */
export function animateRig(rig: VehicleRig, s: { wheelSpin: number; steerVis: number; pitch: number; roll: number; hover: boolean }, dt: number, bounce = 0) {
  for (const w of rig.wheels) w.rotation.x = s.wheelSpin;
  for (const w of rig.steerWheels) w.rotation.y = s.steerVis * 0.45;
  rig.body.rotation.set(s.pitch, 0, s.roll);
  rig.body.position.y = bounce;
  for (const k of rig.kites) {
    const target = s.hover ? 1 : 0;
    const cur = Math.abs(k.scale.y);
    const next = cur + (target - cur) * Math.min(1, dt * 6);
    k.visible = next > 0.02;
    k.scale.set(Math.sign(k.scale.x || 1) * next, next, next);
  }
}

// ------------------------------------------------------------------ traffic

export type TrafficKind = 'auto' | 'bus' | 'hatch' | 'sedan' | 'taxi';

const trafficCache = new Map<string, THREE.BufferGeometry>();
const trafficMat = new THREE.MeshLambertMaterial({ vertexColors: true });

/** Traffic vehicles are baked into a single mesh each: one draw call per vehicle. */
export function buildTraffic(kind: TrafficKind, color: string): THREE.Group {
  const key = `${kind}|${color}`;
  let geo = trafficCache.get(key);
  if (!geo) {
    const src = buildTrafficDetailed(kind, color);
    geo = bakeVertexColored(src, src)!;
    geo.computeBoundingSphere();
    trafficCache.set(key, geo);
  }
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, trafficMat);
  m.castShadow = true;
  g.add(m);
  g.userData.wheels = [];
  return g;
}

function buildTrafficDetailed(kind: TrafficKind, color: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'auto' || kind === 'taxi') {
    const rig = buildCar(kind === 'auto' ? 'auto' : 'taxi', kind === 'auto' ? CAR_MODELS[1].paints[0] : CAR_MODELS[0].paints[0], 'none');
    // Simple seated figure so autos are not empty.
    const d = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 4, 8), new THREE.MeshLambertMaterial({ color: kind === 'auto' ? 0x8d7a52 : 0xe6e2d8 }));
    d.position.copy(rig.seat).add(new THREE.Vector3(0, 0.45, 0));
    rig.body.add(d);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshLambertMaterial({ color: 0x8b5a3c }));
    head.position.copy(d.position).add(new THREE.Vector3(0, 0.45, 0));
    rig.body.add(head);
    g.add(rig.root);
    g.userData.wheels = rig.wheels;
    return g;
  }
  const bodyMat = new THREE.MeshPhongMaterial({ color, shininess: 60, specular: 0x555555 });
  const wheels: THREE.Object3D[] = [];
  const addW = (x: number, z: number, r: number) => { const w = wheel(r, 0.26); w.position.set(x, r, z); g.add(w); wheels.push(w); };
  if (kind === 'bus') {
    // Low-floor city bus in the familiar red / green CNG livery.
    g.add(mesh(new THREE.BoxGeometry(2.55, 2.5, 11.5), bodyMat, 0, 0.45, 0));
    g.add(mesh(new THREE.BoxGeometry(2.57, 0.9, 11.3), glassMat(), 0, 1.75, -0.1));
    g.add(mesh(new THREE.BoxGeometry(2.58, 0.35, 11.52), new THREE.MeshLambertMaterial({ color: 0xf2eee4 }), 0, 2.95, 0));
    g.add(mesh(new THREE.BoxGeometry(2.4, 1.3, 0.05), glassMat(), 0, 1.4, -5.77));
    for (const s of [-1, 1]) {
      const hl = mesh(new THREE.BoxGeometry(0.4, 0.18, 0.05), lampMat, s * 0.9, 0.85, -5.77); g.add(hl);
    }
    addW(-1.1, -3.6, 0.5); addW(1.1, -3.6, 0.5); addW(-1.1, 3.4, 0.5); addW(1.1, 3.4, 0.5);
  } else {
    const L = kind === 'hatch' ? 3.7 : 4.4;
    const lower = mesh(profile([[L / 2, 0.32], [L / 2 + 0.03, 0.66], [L / 2 - 0.6, 0.86], [L / 2 - 1.1, 0.9], [-L / 2 + 0.25, 0.92], [-L / 2, 0.8], [-L / 2, 0.36]], 1.7, 0.08), bodyMat);
    const cabin = mesh(profile(kind === 'hatch'
      ? [[L / 2 - 1.0, 0.9], [L / 2 - 1.6, 1.42], [-L / 2 + 0.35, 1.45], [-L / 2 + 0.1, 0.9]]
      : [[L / 2 - 1.15, 0.9], [L / 2 - 1.75, 1.4], [-L / 2 + 1.1, 1.42], [-L / 2 + 0.6, 0.9]], 1.5, 0.05), glassMat());
    const roof = mesh(new THREE.BoxGeometry(1.42, 0.06, kind === 'hatch' ? 1.6 : 1.4), bodyMat, 0, 1.43, kind === 'hatch' ? 0.25 : 0.15);
    g.add(lower, cabin, roof);
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), lampMat, s * 0.6, 0.7, -L / 2 - 0.02));
      g.add(mesh(new THREE.BoxGeometry(0.25, 0.12, 0.05), tailMat, s * 0.65, 0.72, L / 2 + 0.02));
    }
    const wz = L / 2 - 0.8;
    addW(-0.82, -wz, 0.32); addW(0.82, -wz, 0.32); addW(-0.82, wz, 0.32); addW(0.82, wz, 0.32);
  }
  g.userData.wheels = wheels;
  return g;
}
