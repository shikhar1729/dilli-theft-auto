// Procedural canvas textures. Everything is generated at load time, so the game
// ships no image assets.
import * as THREE from 'three';

let seed = 1337;
export function rand() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

export function toTexture(c: HTMLCanvasElement, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, blobs = 0, blobAmp = 0) {
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (rand() - 0.5) * amp;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < blobs; i++) {
    const x = rand() * w, y = rand() * h, r = 8 + rand() * w * 0.12;
    const v = (rand() - 0.5) * blobAmp;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const col = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    grad.addColorStop(0, col); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      g.save(); g.translate(ox, oy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
    }
  }
}

export function asphaltTexture() {
  const { c, g } = canvas(512, 512);
  noise(g, 512, 512, [124, 123, 122], 30, 40, 24);
  // Patches and tar seams.
  g.strokeStyle = 'rgba(30,30,32,0.35)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    let x = rand() * 512, y = rand() * 512;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rand() - 0.5) * 60; y += (rand() - 0.5) * 60; g.lineTo(x, y); }
    g.stroke();
  }
  return toTexture(c);
}

export function groundTexture() {
  const { c, g } = canvas(512, 512);
  noise(g, 512, 512, [150, 140, 108], 30, 70, 50);
  // Scattered dry grass tufts.
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(96,112,58,0.45)' : 'rgba(170,150,100,0.35)';
    g.fillRect(rand() * 512, rand() * 512, 2, 2);
  }
  return toTexture(c);
}

export function grassTexture() {
  const { c, g } = canvas(512, 512);
  noise(g, 512, 512, [104, 140, 66], 36, 60, 34);
  // Mowing stripes, Lutyens-lawn style.
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,220,0.05)' : 'rgba(0,30,0,0.05)';
    g.fillRect(0, i * 64, 512, 64);
  }
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(60,96,40,0.5)' : 'rgba(150,180,90,0.4)';
    g.fillRect(rand() * 512, rand() * 512, 1, 3);
  }
  return toTexture(c);
}

export function pavingTexture(base = [186, 110, 84], line = 'rgba(80,40,30,0.45)') {
  const { c, g } = canvas(256, 256);
  noise(g, 256, 256, base as [number, number, number], 22, 10, 18);
  g.strokeStyle = line;
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
    for (let j = 0; j < 4; j++) {
      const off = i % 2 ? 32 : 0;
      g.beginPath(); g.moveTo(j * 64 + off, i * 64); g.lineTo(j * 64 + off, i * 64 + 64); g.stroke();
    }
  }
  return toTexture(c);
}

export function waterNormalTexture() {
  const { c, g } = canvas(256, 256);
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const a = Math.sin((x / 256) * Math.PI * 8 + Math.sin((y / 256) * Math.PI * 4) * 1.5);
    const b = Math.cos((y / 256) * Math.PI * 10 + Math.cos((x / 256) * Math.PI * 6) * 1.2);
    const i = (y * 256 + x) * 4;
    img.data[i] = 128 + a * 40; img.data[i + 1] = 128 + b * 40; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, true, false);
}

// ------------------------------------------------------------------ facades
// Each facade texture is 128 x 256: the top half is the repeating upper-floor tile,
// the bottom half is the ground-floor tile. The building shader picks one per floor.

type Painter = (g: CanvasRenderingContext2D, ground: boolean) => void;

function facade(paint: Painter) {
  const { c, g } = canvas(128, 256);
  g.save(); paint(g, false); g.restore();
  g.save(); g.translate(0, 128); paint(g, true); g.restore();
  return toTexture(c);
}

const fill = (g: CanvasRenderingContext2D, col: string, x: number, y: number, w: number, h: number) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
function speckle(g: CanvasRenderingContext2D, amount = 300, alpha = 0.06) {
  for (let i = 0; i < amount; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    g.fillRect(rand() * 128, rand() * 128, 2, 2);
  }
}
function window_(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, glass = '#3b4a57', frame = '#e9e4da') {
  fill(g, frame, x - 3, y - 3, w + 6, h + 6);
  const grad = g.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, glass); grad.addColorStop(1, '#6f8496');
  g.fillStyle = grad; g.fillRect(x, y, w, h);
  fill(g, 'rgba(255,255,255,0.18)', x + 2, y + 2, w * 0.35, h - 4);
}
function arch(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h);
  g.closePath(); g.fill();
}
function chajja(g: CanvasRenderingContext2D, y: number) {
  fill(g, 'rgba(0,0,0,0.22)', 0, y + 6, 128, 8);
  fill(g, 'rgba(255,255,255,0.5)', 0, y, 128, 6);
}

export const FACADE_KINDS = 12;
export function facadeTextures(): THREE.Texture[] {
  const shopColors = ['#c0392b', '#2471a3', '#d68910', '#1e8449', '#7d3c98', '#cb4335'];
  return [
    // 0 plaster (tinted per building)
    facade((g, gr) => {
      fill(g, '#f2eee6', 0, 0, 128, 128); speckle(g);
      if (gr) {
        fill(g, '#6d6f72', 10, 46, 108, 82);
        for (let y = 50; y < 128; y += 5) fill(g, 'rgba(0,0,0,0.25)', 10, y, 108, 1);
        fill(g, shopColors[Math.floor(rand() * shopColors.length)], 4, 18, 120, 22);
        fill(g, 'rgba(255,255,255,0.85)', 16, 25, 60 + rand() * 30, 7);
      } else { window_(g, 32, 34, 64, 62); chajja(g, 22); fill(g, 'rgba(0,0,0,0.1)', 0, 124, 128, 4); }
    }),
    // 1 bungalow
    facade((g, gr) => {
      fill(g, '#f6f1e4', 0, 0, 128, 128); speckle(g, 200, 0.04);
      if (gr) { arch(g, 18, 26, 92, 102, '#3f3a33'); fill(g, '#efe9dc', 14, 120, 100, 8); }
      else { window_(g, 40, 30, 48, 70, '#46525a'); fill(g, '#4f7a4a', 24, 30, 14, 70); fill(g, '#4f7a4a', 90, 30, 14, 70); chajja(g, 18); }
    }),
    // 2 commercial
    facade((g, gr) => {
      fill(g, '#e7e0d2', 0, 0, 128, 128); speckle(g);
      if (gr) { window_(g, 8, 30, 112, 98, '#26323c', '#bfb7a8'); fill(g, '#9a1f1f', 0, 8, 128, 16); }
      else { window_(g, 6, 34, 116, 58, '#34495e', '#d9d2c3'); fill(g, 'rgba(0,0,0,0.12)', 0, 100, 128, 8); }
    }),
    // 3 heritage sandstone: red sandstone ground floor, cream upper floors
    facade((g, gr) => {
      if (gr) {
        fill(g, '#a8533c', 0, 0, 128, 128); speckle(g, 400, 0.08);
        for (let y = 0; y < 128; y += 16) fill(g, 'rgba(60,20,10,0.18)', 0, y, 128, 2);
        arch(g, 34, 34, 60, 94, '#4a2a22');
      } else {
        fill(g, '#e8d3b0', 0, 0, 128, 128); speckle(g, 300, 0.06);
        window_(g, 44, 36, 40, 60, '#3a3530', '#c99b78');
        fill(g, '#c78a68', 0, 0, 128, 10); fill(g, 'rgba(0,0,0,0.2)', 0, 10, 128, 3);
      }
    }),
    // 4 religious / white marble
    facade((g, gr) => {
      fill(g, '#fbfaf6', 0, 0, 128, 128); speckle(g, 200, 0.03);
      arch(g, 36, gr ? 30 : 34, 56, gr ? 98 : 64, gr ? '#5a5048' : '#d8d2c6');
      fill(g, '#e6c34a', 0, gr ? 0 : 118, 128, 6);
    }),
    // 5 Connaught Place colonnade
    facade((g, gr) => {
      fill(g, '#fbfaf5', 0, 0, 128, 128); speckle(g, 160, 0.04);
      if (gr) {
        arch(g, 16, 18, 96, 110, '#2b2a28');
        fill(g, '#f3c76a', 30, 70, 68, 40); fill(g, 'rgba(255,240,200,0.6)', 30, 60, 68, 8);
        fill(g, '#fbfaf5', 0, 0, 14, 128); fill(g, '#fbfaf5', 114, 0, 14, 128);
      } else {
        window_(g, 38, 30, 52, 66, '#3c4650', '#ffffff');
        g.fillStyle = '#e9e5dc'; g.beginPath(); g.moveTo(30, 28); g.lineTo(64, 12); g.lineTo(98, 28); g.closePath(); g.fill();
      }
    }),
    // 6 apartments (pastel tint applied per building)
    facade((g, gr) => {
      fill(g, '#f4f1ea', 0, 0, 128, 128); speckle(g);
      if (gr) { fill(g, '#5c5f63', 14, 48, 100, 80); fill(g, '#7a7f84', 20, 54, 40, 74); }
      else {
        window_(g, 18, 26, 44, 56); window_(g, 74, 26, 36, 56);
        fill(g, 'rgba(60,60,60,0.55)', 10, 86, 108, 4);
        for (let x = 12; x < 118; x += 8) fill(g, 'rgba(60,60,60,0.55)', x, 86, 2, 26);
        fill(g, 'rgba(0,0,0,0.15)', 0, 112, 128, 16);
      }
    }),
    // 7 glass tower
    facade((g, gr) => {
      const grad = g.createLinearGradient(0, 0, 128, 128);
      grad.addColorStop(0, '#5f7b92'); grad.addColorStop(1, '#a9bccb');
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
      fill(g, '#c9d0d6', 0, 0, 128, 8); fill(g, '#c9d0d6', 0, 0, 6, 128);
      fill(g, 'rgba(255,255,255,0.2)', 20, 10, 30, 118);
      if (gr) fill(g, '#2e3a44', 10, 40, 108, 88);
    }),
    // 8 Jantar Mantar salmon
    facade((g) => {
      fill(g, '#d9876f', 0, 0, 128, 128); speckle(g, 400, 0.07);
      fill(g, '#f3ece2', 0, 0, 128, 6); fill(g, '#f3ece2', 0, 122, 128, 6);
    }),
    // 9 sheds / plain
    facade((g) => {
      fill(g, '#cfc7b8', 0, 0, 128, 128); speckle(g, 500, 0.08);
      for (let x = 0; x < 128; x += 16) fill(g, 'rgba(0,0,0,0.08)', x, 0, 3, 128);
    }),
    // 10 ruins / rubble stone
    facade((g) => {
      fill(g, '#9d8a72', 0, 0, 128, 128);
      for (let i = 0; i < 70; i++) {
        g.fillStyle = `rgb(${130 + rand() * 50},${112 + rand() * 40},${90 + rand() * 30})`;
        g.fillRect(rand() * 128, rand() * 128, 10 + rand() * 18, 6 + rand() * 8);
      }
      speckle(g, 300, 0.1);
    }),
    // 11 embassy / modern institutional: white render, deep window bands, glass lobby
    facade((g, gr) => {
      fill(g, '#f4f2ec', 0, 0, 128, 128); speckle(g, 160, 0.03);
      if (gr) {
        window_(g, 6, 22, 116, 106, '#2c3a44', '#d9d6cf');
        fill(g, 'rgba(255,255,255,0.12)', 6, 22, 116, 6);
      } else {
        fill(g, 'rgba(0,0,0,0.18)', 0, 30, 128, 6);
        window_(g, 4, 40, 120, 50, '#33434f', '#e6e3dc');
        for (let x = 30; x < 128; x += 32) fill(g, '#e6e3dc', x, 40, 4, 50);
        fill(g, 'rgba(0,0,0,0.08)', 0, 100, 128, 28);
      }
    }),
  ];
}

/** Text drawn on a transparent canvas, e.g. monument inscriptions or signs. */
export function textTexture(text: string, opts: { w?: number; h?: number; font?: string; color?: string; bg?: string } = {}) {
  const { c, g } = canvas(opts.w ?? 512, opts.h ?? 128);
  if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, c.width, c.height); }
  g.fillStyle = opts.color ?? '#3a2a20';
  g.font = opts.font ?? 'bold 84px Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  return toTexture(c, false);
}

export function flagTexture() {
  const { c, g } = canvas(384, 256);
  fill(g, '#ff9933', 0, 0, 384, 86);
  fill(g, '#ffffff', 0, 85, 384, 86);
  fill(g, '#138808', 0, 170, 384, 86);
  // Ashoka Chakra: 24 spokes.
  const cx = 192, cy = 128, r = 36;
  g.strokeStyle = '#000080'; g.lineWidth = 4;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1.6;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke();
  }
  g.fillStyle = '#000080'; g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill();
  return toTexture(c, false);
}
