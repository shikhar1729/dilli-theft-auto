// The driver lineup: seven original, fictional Delhi characters built from simple
// shapes. Equal driving performance; personality only.
import * as THREE from 'three';

export interface DriverProfile {
  id: string;
  name: string;
  line: string;
  color: string;   // UI chip colour
  skin: string;
  shirt: string;
  hair: string;
  style: 'quiff' | 'bun' | 'turban' | 'cap' | 'ponytail' | 'whitebun' | 'curls';
  extras: ('aviators' | 'roundglasses' | 'bigshades' | 'beard' | 'moustache' | 'chain' | 'bindi' | 'dupatta' | 'helmet')[];
  turban?: string;
}

export const DRIVERS: DriverProfile[] = [
  { id: 'bunty', name: 'Bunty', line: 'Knows every shortcut in Karol Bagh.', color: '#f08a1c', skin: '#b9825d', shirt: '#f4f1ea', hair: '#1c1612', style: 'quiff', extras: ['aviators', 'chain'] },
  { id: 'pinky', name: 'Pinky Aunty', line: 'Parks wherever she likes.', color: '#e8559a', skin: '#c8956f', shirt: '#e8559a', hair: '#24170f', style: 'bun', extras: ['bigshades', 'bindi', 'dupatta'] },
  { id: 'harpreet', name: 'Harpreet', line: 'Twenty years. Zero scratches.', color: '#2a74c9', skin: '#a8714f', shirt: '#2a4f8a', hair: '#1b1410', style: 'turban', turban: '#f39c12', extras: ['beard'] },
  { id: 'raju', name: 'Raju', line: 'Meter? Which meter?', color: '#1f8a3a', skin: '#8d5a3b', shirt: '#b49a62', hair: '#151110', style: 'cap', extras: ['moustache'] },
  { id: 'meera', name: 'Meera', line: 'Fastest in North Campus.', color: '#c62d2d', skin: '#b07a55', shirt: '#c62d2d', hair: '#1a120d', style: 'ponytail', extras: ['helmet'] },
  { id: 'dadi', name: 'Dadi', line: 'Driving since 1962.', color: '#7b3fbf', skin: '#b98b68', shirt: '#f3efe6', hair: '#e8e6e1', style: 'whitebun', extras: ['roundglasses'] },
  { id: 'vicky', name: 'Vicky', line: 'Overtakes from the left.', color: '#15707c', skin: '#9c6847', shirt: '#2b2b2e', hair: '#16110e', style: 'curls', extras: ['aviators', 'moustache'] },
];

const lambert = (c: string) => new THREE.MeshLambertMaterial({ color: c });
function part(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

/**
 * Builds a seated driver. Origin at the hips; faces -Z. `full` adds legs for showroom use.
 */
export function buildDriver(p: DriverProfile, full = false): THREE.Group {
  const g = new THREE.Group();
  const skin = lambert(p.skin), shirt = lambert(p.shirt), hair = lambert(p.hair);
  // Torso and arms reaching for the wheel.
  const torso = part(new THREE.CapsuleGeometry(0.2, 0.32, 4, 10), shirt, 0, 0.36, 0.02);
  torso.scale.set(1.15, 1, 0.8);
  g.add(torso);
  for (const s of [-1, 1]) {
    const arm = part(new THREE.CapsuleGeometry(0.06, 0.36, 4, 8), shirt, s * 0.22, 0.42, -0.2);
    arm.rotation.x = -1.1; arm.rotation.z = s * 0.15;
    g.add(arm);
    g.add(part(new THREE.SphereGeometry(0.06, 8, 6), skin, s * 0.2, 0.32, -0.4));
  }
  if (full) {
    for (const s of [-1, 1]) {
      const leg = part(new THREE.CapsuleGeometry(0.08, 0.4, 4, 8), lambert('#2d3340'), s * 0.11, 0.02, -0.25);
      leg.rotation.x = Math.PI / 2; g.add(leg);
    }
  }
  // Neck and head.
  g.add(part(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skin, 0, 0.66, 0));
  const head = new THREE.Group();
  head.position.set(0, 0.84, 0);
  g.add(head);
  const skull = part(new THREE.SphereGeometry(0.15, 20, 16), skin);
  skull.scale.set(0.92, 1.08, 0.98);
  head.add(skull);
  head.add(part(new THREE.SphereGeometry(0.025, 8, 6), skin, 0, -0.01, -0.15)); // nose
  for (const s of [-1, 1]) {
    head.add(part(new THREE.SphereGeometry(0.035, 8, 6), skin, s * 0.14, 0, 0.01)); // ears
    head.add(part(new THREE.SphereGeometry(0.018, 8, 6), lambert('#1a1410'), s * 0.05, 0.03, -0.135)); // eyes
  }
  head.add(part(new THREE.BoxGeometry(0.06, 0.012, 0.01), lambert('#7a3b2e'), 0, -0.07, -0.14)); // mouth

  const cap = (r: number, m: THREE.Material, y = 0.02, squash = 1) => {
    const h = part(new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, y, 0.01);
    h.scale.y = squash;
    return h;
  };
  switch (p.style) {
    case 'quiff': {
      head.add(cap(0.165, hair, 0.02, 0.95));
      const q = part(new THREE.SphereGeometry(0.09, 12, 8), hair, 0, 0.15, -0.07);
      q.scale.set(1.3, 0.7, 1); head.add(q);
      break;
    }
    case 'bun': case 'whitebun':
      head.add(cap(0.165, hair, 0.02, 0.95));
      head.add(part(new THREE.SphereGeometry(0.075, 12, 10), hair, 0, 0.07, 0.15));
      break;
    case 'ponytail': {
      head.add(cap(0.165, hair, 0.02, 0.95));
      const tail = part(new THREE.CapsuleGeometry(0.04, 0.2, 4, 8), hair, 0, -0.02, 0.17);
      tail.rotation.x = 0.4; head.add(tail);
      break;
    }
    case 'curls':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        head.add(part(new THREE.SphereGeometry(0.06, 8, 6), hair, Math.cos(a) * 0.1, 0.1 + Math.sin(i) * 0.02, Math.sin(a) * 0.1));
      }
      break;
    case 'cap': {
      head.add(cap(0.162, lambert('#f2efe6'), 0.04, 0.75));
      const brim = part(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 14, 1, false, Math.PI / 2, Math.PI), lambert('#f2efe6'), 0, 0.05, -0.1);
      head.add(brim);
      break;
    }
    case 'turban': {
      // Dastar: layered wraps peaking at the front.
      const tm = lambert(p.turban ?? '#f39c12');
      for (let i = 0; i < 4; i++) {
        const t = part(new THREE.TorusGeometry(0.15 - i * 0.022, 0.05, 8, 20), tm, 0, 0.07 + i * 0.045, 0.01);
        t.rotation.x = Math.PI / 2 + 0.25; head.add(t);
      }
      head.add(cap(0.11, tm, 0.18, 0.7));
      break;
    }
  }
  for (const e of p.extras) {
    if (e === 'aviators' || e === 'bigshades' || e === 'roundglasses') {
      const dark = e !== 'roundglasses';
      const lens = dark ? new THREE.MeshPhongMaterial({ color: e === 'aviators' ? 0x3a2a14 : 0x111111, shininess: 120, specular: 0xbbbbbb }) : new THREE.MeshPhongMaterial({ color: 0xcfe6f0, transparent: true, opacity: 0.5 });
      const r = e === 'bigshades' ? 0.05 : e === 'aviators' ? 0.042 : 0.036;
      for (const s of [-1, 1]) {
        const l = part(new THREE.CircleGeometry(r, 16), lens, s * 0.055, 0.03, -0.152);
        l.rotation.y = Math.PI; head.add(l);
        if (!dark) {
          const rim = part(new THREE.TorusGeometry(r, 0.006, 6, 18), lambert('#5b4b3a'), s * 0.055, 0.03, -0.153);
          head.add(rim);
        }
      }
      head.add(part(new THREE.BoxGeometry(0.03, 0.008, 0.008), lambert('#333'), 0, 0.035, -0.155));
    }
    if (e === 'beard') {
      const b = part(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hair, 0, -0.02, -0.03);
      b.scale.set(1, 1.05, 1); head.add(b);
    }
    if (e === 'moustache') head.add(part(new THREE.BoxGeometry(0.09, 0.022, 0.02), hair, 0, -0.045, -0.145));
    if (e === 'bindi') head.add(part(new THREE.SphereGeometry(0.012, 8, 6), lambert('#c0122c'), 0, 0.08, -0.145));
    if (e === 'chain') {
      const c = part(new THREE.TorusGeometry(0.11, 0.012, 6, 18), new THREE.MeshPhongMaterial({ color: 0xe0b23a, shininess: 90 }), 0, 0.58, -0.07);
      c.rotation.x = Math.PI / 2 - 0.4; g.add(c);
    }
    if (e === 'dupatta') {
      const d = part(new THREE.TorusGeometry(0.2, 0.05, 6, 16, Math.PI), lambert('#f6c516'), 0, 0.58, 0);
      d.rotation.set(Math.PI / 2 + 0.3, 0, 0); g.add(d);
    }
    if (e === 'helmet') {
      const h = part(new THREE.SphereGeometry(0.175, 20, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), new THREE.MeshPhongMaterial({ color: 0xf2efe6, shininess: 90 }), 0, 0.0, 0.01);
      head.add(h);
      const stripe = part(new THREE.BoxGeometry(0.04, 0.02, 0.33), lambert('#c62d2d'), 0, 0.17, 0.01);
      head.add(stripe);
    }
  }
  g.userData.head = head;
  return g;
}
