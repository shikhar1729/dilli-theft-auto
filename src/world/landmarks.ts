// Hand-built models for Delhi's landmarks, placed at their OpenStreetMap positions.
// Proportions follow published dimensions; detail is simplified for real time.
import * as THREE from 'three';
import type { MapData, WallIndex } from '../map';
import type { Surfaces } from './surfaces';
import { terrainHeight } from '../terrain';
import { textTexture, flagTexture, toTexture } from '../textures';
import { mergeInPlace } from '../geom';

const mat = {
  sandstone: new THREE.MeshLambertMaterial({ color: 0xd9b48f }),
  sandLight: new THREE.MeshLambertMaterial({ color: 0xe6c9a4 }),
  redstone: new THREE.MeshLambertMaterial({ color: 0xa9563d }),
  cream: new THREE.MeshLambertMaterial({ color: 0xeedcbc }),
  white: new THREE.MeshLambertMaterial({ color: 0xf7f5ef }),
  marble: new THREE.MeshPhongMaterial({ color: 0xfbfaf6, shininess: 30, specular: 0x333333 }),
  gold: new THREE.MeshPhongMaterial({ color: 0xe0a92a, shininess: 80, specular: 0xfff0b0, emissive: 0x2a1a00 }),
  copper: new THREE.MeshPhongMaterial({ color: 0x8a6a52, shininess: 20, specular: 0x332211 }),
  granite: new THREE.MeshPhongMaterial({ color: 0x26262a, shininess: 60, specular: 0x555555 }),
  salmon: new THREE.MeshLambertMaterial({ color: 0xd9846a }),
  steel: new THREE.MeshPhongMaterial({ color: 0xdfe3e6, shininess: 70, specular: 0xffffff }),
  dark: new THREE.MeshLambertMaterial({ color: 0x3a2f28 }),
  glass: new THREE.MeshPhongMaterial({ color: 0xcfe8ff, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.85 }),
  flame: new THREE.MeshBasicMaterial({ color: 0xffa21f }),
};

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function cyl(rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 24) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function dome(r: number, m: THREE.Material, x = 0, y = 0, z = 0, squash = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), m);
  mesh.position.set(x, y, z);
  mesh.scale.y = squash;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function lathe(profile: [number, number][], m: THREE.Material, scale = 1) {
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * scale, y * scale)), 28), m);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
/** Region above a semicircular arch, extruded along local X (depth). */
function archHead(span: number, spring: number, top: number, depth: number, m: THREE.Material) {
  const r = span / 2;
  const s = new THREE.Shape();
  s.moveTo(-r, spring);
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI - (i / 16) * Math.PI;
    s.lineTo(Math.cos(a) * r, spring + Math.sin(a) * r);
  }
  s.lineTo(r, top); s.lineTo(-r, top); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2); // shape plane (x=across, y=up) → extrude along local X
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Turtle for placing a landmark in a rotated local frame (a = along axis, c = across). */
class Frame {
  readonly group = new THREE.Group();
  readonly cos: number; readonly sin: number;
  constructor(readonly x: number, readonly z: number, readonly theta: number, readonly y = terrainHeight(x, z)) {
    this.cos = Math.cos(theta); this.sin = Math.sin(theta);
    this.group.position.set(x, y, z);
    this.group.rotation.y = -theta;
  }
  world(a: number, c: number): [number, number] {
    return [this.x + a * this.cos - c * this.sin, this.z + a * this.sin + c * this.cos];
  }
  solid(walls: WallIndex, a: number, c: number, la: number, lc: number, h: number) {
    const [x, z] = this.world(a, c);
    walls.addBox(x, z, la, lc, -this.theta, this.y, this.y + h);
  }
  add(...o: THREE.Object3D[]) { this.group.add(...o); return this; }
}

export interface Landmarks {
  group: THREE.Group;
  update(t: number): void;
  axisAngle: number;
}

export function buildLandmarks(map: MapData, walls: WallIndex, surfaces: Surfaces): Landmarks {
  const L = map.landmarks;
  const group = new THREE.Group();
  group.name = 'landmarks';
  const updaters: ((t: number) => void)[] = [];
  // The Central Vista axis runs from Rashtrapati Bhavan's dome to India Gate.
  const axis = Math.atan2(L.indiaGate[1] - L.rbDome[1], L.indiaGate[0] - L.rbDome[0]);

  // ---------------------------------------------------------------- India Gate (42 m)
  {
    const f = new Frame(L.indiaGate[0], L.indiaGate[1], axis);
    const S = mat.sandstone, SL = mat.sandLight;
    f.add(box(26, 0.5, 36, mat.redstone, 0, 0, 0), box(23, 0.5, 33, mat.redstone, 0, 0.5, 0));
    surfaces.addPlatform(f.x, f.z, 26, 36, -axis, 0.5);
    surfaces.addPlatform(f.x, f.z, 23, 33, -axis, 1.0);
    const y0 = 1;
    for (const side of [-1, 1]) {
      const c = side * 9.5;
      // Two sub-piers per side leave the smaller cross arches open.
      f.add(box(7, 29, 9, S, -6, y0, c), box(7, 29, 9, S, 6, y0, c));
      f.add(box(5, 15, 9, S, 0, y0 + 14, c));
      const head = archHead(5, y0 + 11.5, y0 + 14, 9, S);
      head.rotation.y = Math.PI / 2; // cross arch runs along c
      head.position.set(0, 0, c);
      f.add(head);
      f.solid(walls, -6, c, 7, 9, 30);
      f.solid(walls, 6, c, 7, 9, 30);
      // Recessed side-arch shadow.
      f.add(box(4.9, 11.5, 8.9, mat.dark, 0, y0, c));
    }
    // Main arch, 10 m wide, open along the axis.
    f.add(archHead(10, y0 + 17, y0 + 24, 19, S));
    f.add(box(19, 5, 10, S, 0, y0 + 24, 0));
    f.add(box(20.4, 1.1, 30.4, SL, 0, y0 + 29, 0));
    f.add(box(17, 4.5, 25, S, 0, y0 + 30.1, 0));
    f.add(box(17.6, 0.6, 25.6, SL, 0, y0 + 34.6, 0));
    f.add(box(14, 2.6, 19, S, 0, y0 + 35.2, 0));
    f.add(cyl(5.4, 5.6, 1.6, SL, 0, y0 + 37.8, 0));
    f.add(dome(5.2, S, 0, y0 + 39.4, 0, 0.45));
    // Inscription on the attic, both faces.
    const insc = new THREE.MeshBasicMaterial({ map: textTexture('INDIA', { font: 'bold 92px Georgia, serif', color: '#5a3b26' }), transparent: true });
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), insc);
      p.position.set(side * 8.52, y0 + 32.3, 0);
      p.rotation.y = side * Math.PI / 2;
      f.add(p);
    }
    group.add(f.group);
  }

  // ---------------------------------------------------------------- Canopy with Netaji statue
  {
    const f = new Frame(L.canopy[0], L.canopy[1], axis);
    f.add(box(16, 0.6, 16, mat.redstone), box(13, 0.6, 13, mat.sandstone, 0, 0.6, 0));
    surfaces.addPlatform(f.x, f.z, 16, 16, -axis, 0.6);
    for (const a of [-5, 5]) for (const c of [-5, 5]) {
      f.add(box(1.8, 12, 1.8, mat.sandstone, a, 1.2, c));
      f.solid(walls, a, c, 1.8, 1.8, 13);
    }
    for (const rot of [0, Math.PI / 2]) for (const side of [-5, 5]) {
      const h = archHead(8.2, 9.5, 13.2, 1.6, mat.sandstone);
      h.rotation.y = rot;
      h.position.set(rot ? side : 0, 0, rot ? 0 : side);
      if (!rot) { h.rotation.y = Math.PI / 2; h.position.set(0, 0, side); } else { h.rotation.y = 0; h.position.set(side, 0, 0); }
      f.add(h);
    }
    f.add(box(13, 1.2, 13, mat.sandLight, 0, 13.2, 0));
    f.add(cyl(4.5, 4.8, 2.2, mat.sandstone, 0, 14.4, 0));
    f.add(dome(4.6, mat.sandstone, 0, 16.6, 0, 1.05));
    f.add(cyl(0.25, 0.4, 2.2, mat.sandLight, 0, 21.4, 0));
    // Statue (dark granite) on its pedestal.
    f.add(box(2.6, 1.6, 2.6, mat.granite, 0, 1.2, 0));
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 4.2, 6, 12), mat.granite);
    body.position.set(0, 1.2 + 1.6 + 3, 0); body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), mat.granite);
    head.position.set(0, 1.2 + 1.6 + 5.8, 0); head.castShadow = true;
    f.add(body, head);
    f.solid(walls, 0, 0, 2.6, 2.6, 9);
    group.add(f.group);
  }

  // ---------------------------------------------------------------- National War Memorial
  {
    const f = new Frame(L.warMemorial[0], L.warMemorial[1], axis);
    for (const [r, h] of [[16, 0.25], [11, 0.5], [6.5, 0.75]] as const) f.add(cyl(r, r, h, r > 12 ? mat.redstone : mat.cream, 0, 0, 0, 48));
    const ob = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.4, 15.5, 4), mat.cream);
    ob.position.y = 0.75 + 7.75; ob.rotation.y = Math.PI / 4; ob.castShadow = true;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 4), mat.gold);
    tip.position.y = 0.75 + 15.5 + 0.6; tip.rotation.y = Math.PI / 4;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 8), mat.flame);
    flame.position.set(2.2, 1.45, 0);
    f.add(ob, tip, flame);
    flame.userData.keep = true;
    updaters.push((t) => { flame.scale.set(1 + Math.sin(t * 13) * 0.12, 1 + Math.sin(t * 9) * 0.2, 1); });
    f.solid(walls, 0, 0, 2.6, 2.6, 16);
    group.add(f.group);
  }

  // ---------------------------------------------------------------- Rashtrapati Bhavan dome and Jaipur Column
  {
    const [x, z] = L.rbDome;
    const base = terrainHeight(x, z) - 0.3 + 20;
    const g = new THREE.Group();
    g.position.set(x, base, z);
    const colTex = columnTexture();
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 9, 40, 1, true), new THREE.MeshLambertMaterial({ map: colTex }));
    drum.position.y = 4.5; drum.castShadow = true;
    g.add(drum);
    g.add(cyl(17.2, 17.2, 0.9, mat.redstone, 0, 8.6, 0, 40));
    g.add(cyl(14.8, 15.4, 2, mat.cream, 0, 9.5, 0, 40));
    g.add(dome(14.6, mat.copper, 0, 11.5, 0, 1.0));
    g.add(cyl(1.6, 2.4, 2.2, mat.cream, 0, 25.6, 0));
    g.add(cyl(0.2, 0.6, 2.6, mat.cream, 0, 27.8, 0));
    for (let i = 0; i < 4; i++) {
      // Four chhatris around the dome.
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const cx = Math.cos(a) * 26, cz = Math.sin(a) * 26;
      g.add(box(5, 5, 5, mat.cream, cx, 0, cz));
      g.add(dome(2.8, mat.cream, cx, 5, cz, 1));
    }
    group.add(g);

    const jx = x + Math.cos(axis) * 255, jz = z + Math.sin(axis) * 255;
    const jy = terrainHeight(jx, jz);
    const j = new THREE.Group();
    j.position.set(jx, jy, jz);
    j.add(box(7, 3, 7, mat.redstone), box(4.4, 6, 4.4, mat.cream, 0, 3, 0));
    j.add(cyl(0.7, 1.0, 30, mat.cream, 0, 9, 0));
    j.add(cyl(1.4, 0.8, 1.6, mat.gold, 0, 39, 0));
    const star = new THREE.Mesh(starGeometry(2.2, 1.1, 6), mat.glass);
    star.position.y = 42.6;
    j.add(star);
    updaters.push((t) => { star.rotation.y = t * 0.4; });
    walls.addCircle(jx, jz, 3.6, jy, jy + 40);
    surfaces.addRoundPlatform(jx, jz, 0.1, 0);
    group.add(j);
  }

  // ---------------------------------------------------------------- North & South Block domes
  for (const k of ['northBlock', 'southBlock'] as const) {
    const [x, z] = L[k];
    const y = terrainHeight(x, z) - 0.3 + 21;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.add(cyl(8, 8.4, 5, mat.cream, 0, 0, 0, 28), cyl(8.8, 8.8, 0.6, mat.redstone, 0, 5, 0, 28));
    g.add(dome(7.6, mat.redstone, 0, 5.6, 0, 1.05));
    g.add(cyl(1.2, 1.6, 2, mat.cream, 0, 13.4, 0), dome(1.3, mat.cream, 0, 15.4, 0, 1.2));
    // Twin towers flanking each block's dome.
    for (const s of [-1, 1]) {
      const tx = Math.cos(axis) * s * 30, tz = Math.sin(axis) * s * 30;
      g.add(box(6, 9, 6, mat.cream, tx, 0, tz), box(6.8, 0.6, 6.8, mat.redstone, tx, 9, tz), dome(2.6, mat.cream, tx, 9.6, tz, 1.2));
    }
    group.add(g);
  }

  // ---------------------------------------------------------------- Jantar Mantar: Samrat Yantra
  {
    const [x, z] = L.samratYantra;
    const g = new THREE.Group();
    g.position.set(x, terrainHeight(x, z), z);
    const lat = (28.627 * Math.PI) / 180;
    const len = 33, rise = len * Math.tan(lat);
    // Gnomon: right-triangle wall, its hypotenuse pointing at the pole star (north = -Z).
    const s = new THREE.Shape();
    s.moveTo(len / 2, 0); s.lineTo(-len / 2, 0); s.lineTo(-len / 2, 2.4 + rise); s.lineTo(len / 2, 2.4); s.closePath();
    const gn = new THREE.ExtrudeGeometry(s, { depth: 3.6, bevelEnabled: false });
    gn.translate(0, 0, -1.8);
    gn.rotateY(-Math.PI / 2); // shape x → world z (north at -len/2 → z = -16.5)
    const gnomon = new THREE.Mesh(gn, mat.salmon);
    gnomon.castShadow = gnomon.receiveShadow = true;
    g.add(gnomon);
    // Steps on the hypotenuse.
    const steps = new THREE.Mesh(new THREE.PlaneGeometry(2.6, Math.hypot(len, rise)), new THREE.MeshLambertMaterial({ map: stepTexture() }));
    steps.position.set(0, 2.4 + rise / 2 + 0.05, 0);
    steps.rotation.x = -Math.PI / 2 + Math.atan2(rise, len);
    g.add(steps);
    // Quadrant arcs east and west.
    for (const side of [-1, 1]) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(10, 1.3, 8, 24, Math.PI), mat.salmon);
      arc.rotation.set(0, Math.PI / 2, 0);
      arc.position.set(side * 9, 0.8, 0);
      arc.castShadow = true;
      g.add(arc);
      g.add(box(4, 1.6, 22, mat.salmon, side * 9, 0, 0));
    }
    g.add(box(30, 0.5, 36, mat.cream, 0, 0, 0));
    group.add(g);
    walls.addBox(x, z, 4, len, 0, g.position.y, g.position.y + 2.4 + rise);
    walls.addBox(x - 9, z, 4.5, 22, 0, g.position.y, g.position.y + 11);
    walls.addBox(x + 9, z, 4.5, 22, 0, g.position.y, g.position.y + 11);
  }

  // ---------------------------------------------------------------- Gurudwara Bangla Sahib: golden dome, Nishan Sahib
  {
    const [x, z] = L.banglaSahib;
    const y = terrainHeight(x, z) + 13;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const onion: [number, number][] = [[4.6, 0], [5.8, 1.5], [6.6, 3.6], [6.5, 5.4], [5.6, 7.2], [4, 8.8], [2.2, 10.1], [0.9, 11.1], [0.35, 12], [0.01, 12.4]];
    g.add(cyl(4.8, 5, 2.2, mat.marble, 0, 0, 0, 28));
    const o = lathe(onion, mat.gold); o.position.y = 2.2; g.add(o);
    const finial = cyl(0.12, 0.2, 3, mat.gold, 0, 14.4, 0); g.add(finial);
    for (const [dx, dz] of [[-15, -15], [15, -15], [-15, 15], [15, 15]]) {
      g.add(box(3.4, 3, 3.4, mat.marble, dx, 0, dz));
      const sm = lathe(onion, mat.gold, 0.32); sm.position.set(dx, 3, dz); g.add(sm);
    }
    group.add(g);
    // Nishan Sahib.
    const nx = x + 34, nz = z - 6, ny = terrainHeight(nx, nz);
    const pole = cyl(0.25, 0.35, 32, mat.gold, nx, ny, nz);
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 7, -1.6, 0, 0, -3.4, 0], 3));
    flagGeo.computeVertexNormals();
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshLambertMaterial({ color: 0xf28c1e, side: THREE.DoubleSide }));
    flag.position.set(nx + 0.3, ny + 31.5, nz);
    flag.userData.keep = true;
    updaters.push((t) => { flag.rotation.y = Math.sin(t * 1.3) * 0.35; });
    group.add(pole, flag);
    walls.addCircle(nx, nz, 0.8, ny, ny + 32, 6);
  }

  // ---------------------------------------------------------------- Connaught Place: giant tricolour in Central Park
  {
    const [x, z] = L.cpCenter;
    const y = terrainHeight(x, z);
    group.add(cyl(2.4, 2.6, 1, mat.redstone, x, y, z), cyl(0.45, 0.85, 63, mat.steel, x, y + 1, z, 16));
    const W = 21, H = 14;
    const geo = new THREE.PlaneGeometry(W, H, 24, 10);
    geo.translate(W / 2, -H / 2, 0);
    const flag = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: flagTexture(), side: THREE.DoubleSide }));
    flag.position.set(x + 0.5, y + 63.5, z);
    flag.castShadow = true;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const rest = Float32Array.from(pos.array as Float32Array);
    updaters.push((t) => {
      for (let i = 0; i < pos.count; i++) {
        const u = rest[i * 3];
        const amp = (u / W) * 1.6;
        pos.setZ(i, Math.sin(u * 0.35 - t * 3.2) * amp + Math.sin(u * 0.9 - t * 5.1) * amp * 0.25);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      flag.rotation.y = -0.3 + Math.sin(t * 0.21) * 0.12;
    });
    group.add(flag);
    walls.addCircle(x, z, 2.6, y, y + 64, 8);
  }

  // ---------------------------------------------------------------- Agrasen ki Baoli marker arch, Hanuman Mandir spire
  {
    const [x, z] = L.hanumanMandir;
    const y = terrainHeight(x, z);
    const spire = lathe([[3.2, 0], [3, 3], [2.4, 6], [1.4, 8.4], [0.5, 9.6], [0.01, 10.2]], new THREE.MeshLambertMaterial({ color: 0xe8743b }));
    spire.position.set(x, y + 7, z);
    group.add(spire, box(7, 7, 7, mat.white, x, y, z));
    walls.addBox(x, z, 7, 7, 0, y, y + 7);
  }

  // ---------------------------------------------------------------- Akshardham (East Delhi)
  if (L.akshardham) {
    const f = new Frame(L.akshardham[0], L.akshardham[1], 0);
    const pink = new THREE.MeshLambertMaterial({ color: 0xdb9478 });
    const pinkDeep = new THREE.MeshLambertMaterial({ color: 0xc4705a });
    const marble = new THREE.MeshLambertMaterial({ color: 0xf3ece2 });
    const carved = new THREE.MeshLambertMaterial({ map: carvedTexture() });
    // Gajendra Pith: the elephant-frieze plinth.
    f.add(box(104, 1.2, 96, pinkDeep, 0, 0, 0), box(100, 2.6, 92, pink, 0, 1.2, 0));
    const frieze = new THREE.Mesh(new THREE.BoxGeometry(100.4, 1.4, 92.4), new THREE.MeshLambertMaterial({ map: friezeTexture() }));
    frieze.position.y = 2.3;
    f.add(frieze);
    surfaces.addPlatform(f.x, f.z, 104, 96, 0, 1.2);
    f.solid(walls, 0, 0, 100, 92, 4);
    // Main hall with carved columns, a cornice and a stepped roof.
    const hall = new THREE.Mesh(new THREE.BoxGeometry(70, 14, 62), [carved, carved, marble, marble, carved, carved]);
    hall.position.y = 3.8 + 7;
    hall.castShadow = hall.receiveShadow = true;
    f.add(hall);
    f.add(box(74, 1.6, 66, pinkDeep, 0, 17.8, 0), box(64, 2.4, 56, pink, 0, 19.4, 0));
    // Front steps (east).
    for (let i = 0; i < 6; i++) f.add(box(3, 0.6, 26, pink, 51 + i * 3, 3.2 - i * 0.6, 0));
    const onion: [number, number][] = [[1, 0], [1.08, 0.25], [1.15, 0.55], [1.1, 0.85], [0.92, 1.12], [0.66, 1.35], [0.38, 1.52], [0.16, 1.66], [0.06, 1.85], [0.12, 1.95], [0.02, 2.2]];
    const big = lathe(onion, pink, 9.2); big.position.y = 21.8; f.add(big);
    f.add(cyl(9.6, 9.8, 2.2, pinkDeep, 0, 19.6 + 2.2 - 2.2, 0, 32));
    const kalash = cyl(0.3, 0.6, 3, new THREE.MeshPhongMaterial({ color: 0xe0a92a, shininess: 80 }), 0, 21.8 + 9.2 * 2.2, 0);
    f.add(kalash);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const dx = Math.cos(a) * 21, dz = Math.sin(a) * 18;
      f.add(cyl(4.2, 4.4, 2.4, pinkDeep, dx, 21.8, dz, 20));
      const d = lathe(onion, pink, 3.9); d.position.set(dx, 24.2, dz); f.add(d);
    }
    for (const [dx, dz] of [[-29, -25], [29, -25], [-29, 25], [29, 25]]) {
      const sh = new THREE.Mesh(new THREE.ConeGeometry(4.2, 13, 8, 4), pink);
      sh.position.set(dx, 21.8 + 6.5, dz); sh.castShadow = true;
      f.add(sh, cyl(4.6, 4.6, 1.2, pinkDeep, dx, 20.6, dz, 8));
    }
    group.add(f.group);
  }

  // ---------------------------------------------------------------- Humayun's Tomb
  if (L.humayunTomb) {
    const f = new Frame(L.humayunTomb[0], L.humayunTomb[1], 0);
    const red = new THREE.MeshLambertMaterial({ color: 0xb4583f });
    const redLight = new THREE.MeshLambertMaterial({ color: 0xc66a4e });
    const marble = new THREE.MeshPhongMaterial({ color: 0xf6f2ea, shininess: 25, specular: 0x333333 });
    const arcade = new THREE.MeshLambertMaterial({ map: arcadeTexture() });
    // Raised platform (chabutra) with its ring of arched cells.
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(90, 7, 90), [arcade, arcade, redLight, redLight, arcade, arcade]);
    plinth.position.y = 3.5;
    plinth.castShadow = plinth.receiveShadow = true;
    f.add(plinth);
    f.solid(walls, 0, 0, 90, 90, 7);
    // Main mausoleum: a square with chamfered corners and great arched iwans.
    const s = new THREE.Shape();
    const A = 24, C = 8;
    s.moveTo(-A + C, -A); s.lineTo(A - C, -A); s.lineTo(A, -A + C); s.lineTo(A, A - C); s.lineTo(A - C, A); s.lineTo(-A + C, A); s.lineTo(-A, A - C); s.lineTo(-A, -A + C); s.closePath();
    const body = new THREE.ExtrudeGeometry(s, { depth: 21, bevelEnabled: false });
    body.rotateX(-Math.PI / 2);
    const bodyMesh = new THREE.Mesh(body, red);
    bodyMesh.position.y = 7; bodyMesh.castShadow = bodyMesh.receiveShadow = true;
    f.add(bodyMesh);
    const iwanMat = new THREE.MeshLambertMaterial({ map: iwanTexture() });
    for (const [x, z, ry] of [[0, -A - 0.05, Math.PI], [0, A + 0.05, 0], [A + 0.05, 0, Math.PI / 2], [-A - 0.05, 0, -Math.PI / 2]] as const) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(22, 20), iwanMat);
      p.position.set(x, 7 + 10.5, z); p.rotation.y = ry;
      f.add(p);
    }
    f.add(box(50, 1.2, 50, redLight, 0, 28, 0));
    // Drum and the white marble double dome with its finial.
    f.add(cyl(12.4, 12.4, 5, marble, 0, 29.2, 0, 32));
    const domeProfile: [number, number][] = [[12.4, 0], [13.2, 2], [13.4, 4.5], [12.8, 7.5], [11, 10.5], [8.2, 13], [4.8, 14.8], [1.8, 15.8], [0.4, 16.1], [0.01, 16.2]];
    const d = lathe(domeProfile, marble); d.position.y = 34.2; f.add(d);
    f.add(cyl(0.25, 0.5, 4, new THREE.MeshPhongMaterial({ color: 0xc9a227, shininess: 80 }), 0, 50.3, 0));
    // Four chhatris on the roof.
    for (const [x, z] of [[-15, -15], [15, -15], [-15, 15], [15, 15]]) {
      for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) f.add(box(0.6, 4, 0.6, marble, x + px, 29.2, z + pz));
      f.add(box(5.4, 0.7, 5.4, red, x, 33.2, z), dome(2.6, marble, x, 33.9, z, 1.1));
    }
    group.add(f.group);
  }

  // Bake all static, untextured stone into one mesh (animated parts are flagged `keep`).
  group.updateMatrixWorld(true);
  mergeInPlace(group, new THREE.MeshLambertMaterial({ vertexColors: true }));

  return {
    group,
    axisAngle: axis,
    update(t: number) { for (const u of updaters) u(t); },
  };
}

function carvedTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#dc9378'; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 8; i++) {
    const x = i * 32;
    g.fillStyle = '#b86a52'; g.fillRect(x + 4, 18, 24, 104);
    g.fillStyle = '#efc3a6'; g.fillRect(x + 8, 22, 4, 96); g.fillRect(x + 20, 22, 4, 96);
    g.fillStyle = '#7d3a2c';
    g.beginPath(); g.moveTo(x + 8, 60); g.quadraticCurveTo(x + 16, 38, x + 24, 60); g.lineTo(x + 24, 122); g.lineTo(x + 8, 122); g.closePath(); g.fill();
  }
  g.fillStyle = '#c4705a'; g.fillRect(0, 0, 256, 14);
  for (let x = 0; x < 256; x += 8) { g.fillStyle = '#efc3a6'; g.fillRect(x + 2, 4, 4, 6); }
  const t = toTexture(c);
  t.repeat.set(4, 1);
  return t;
}

function friezeTexture() {
  // A procession of stylised elephants around the plinth.
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c97a62'; g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#e8b29a';
  for (let x = 0; x < 256; x += 32) {
    g.beginPath(); g.ellipse(x + 16, 16, 10, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(x + 8, 18, 3, 10); g.fillRect(x + 21, 18, 3, 10);
    g.beginPath(); g.ellipse(x + 26, 12, 4, 4, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(x + 28, 13, 2, 11);
  }
  const t = toTexture(c);
  t.repeat.set(10, 1);
  return t;
}

function arcadeTexture() {
  // Red sandstone cells, each with a white-outlined arch, as on the tomb's platform.
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b4583f'; g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 4; i++) {
    const x = i * 32;
    g.strokeStyle = '#f3ece0'; g.lineWidth = 2;
    g.strokeRect(x + 2, 4, 28, 58);
    g.fillStyle = '#3f2219';
    g.beginPath(); g.moveTo(x + 8, 62); g.lineTo(x + 8, 30); g.quadraticCurveTo(x + 16, 12, x + 24, 30); g.lineTo(x + 24, 62); g.closePath(); g.fill();
    g.stroke();
  }
  const t = toTexture(c);
  t.repeat.set(7, 1);
  return t;
}

function iwanTexture() {
  // The great central arch of each façade, framed in white marble.
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b4583f'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#f3ece0'; g.lineWidth = 4;
  g.strokeRect(10, 6, 108, 120);
  g.fillStyle = '#5a2e22';
  g.beginPath(); g.moveTo(30, 126); g.lineTo(30, 60); g.quadraticCurveTo(64, 10, 98, 60); g.lineTo(98, 126); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = '#f3ece0'; g.lineWidth = 2;
  for (const x of [20, 108]) { g.beginPath(); g.moveTo(x - 6, 120); g.lineTo(x - 6, 80); g.quadraticCurveTo(x, 68, x + 6, 80); g.lineTo(x + 6, 120); g.stroke(); }
  return toTexture(c, false);
}

function columnTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#efdcbc'; g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = '#5a4536'; g.fillRect(i * 16 + 5, 8, 7, 52);
    g.fillStyle = '#f6e8cf'; g.fillRect(i * 16, 8, 4, 52);
  }
  g.fillStyle = '#c99a78'; g.fillRect(0, 0, 256, 8);
  const t = toTexture(c);
  t.repeat.set(6, 1);
  return t;
}

function stepTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9a58c'; g.fillRect(0, 0, 32, 256);
  for (let y = 0; y < 256; y += 8) { g.fillStyle = '#b8644d'; g.fillRect(0, y, 32, 3); }
  g.fillStyle = '#f5ede4'; g.fillRect(0, 0, 3, 256); g.fillRect(29, 0, 3, 256);
  return toTexture(c, false);
}

function starGeometry(outer: number, inner: number, points: number) {
  const s = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const px = Math.cos(a) * r, py = Math.sin(a) * r;
    if (i === 0) s.moveTo(px, py); else s.lineTo(px, py);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 1 });
  g.translate(0, 0, -0.25);
  return g;
}
