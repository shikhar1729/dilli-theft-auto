// 2D map rendering: a heading-up minimap assembled from per-tile canvases, and
// the route postcards used in the menus.
import type { MapData } from './map';
import { AREA, decode } from './map';
import { STALL_TYPES } from './world/stalls';
import type { Course } from './race';
import type { TileManager, Tile } from './world/tiles';

const MPP = 2; // metres per pixel of a tile canvas
const AREA_COL: Record<number, string> = {
  [AREA.grass]: '#b9d39a', [AREA.wood]: '#9fc184', [AREA.pitch]: '#a8d68a', [AREA.stadium]: '#d6cfc2',
  [AREA.water]: '#8cc3d6', [AREA.river]: '#8cc3d6', [AREA.plaza]: '#e8c9b3',
};
const BG = '#e9dfc8';

export class MapCanvas {
  private cache = new Map<string, { c: HTMLCanvasElement; withData: boolean }>();
  private globalBoxes: { i: number; x0: number; x1: number; z0: number; z1: number }[];
  private metro: { c: string; p: number[]; m: number[] }[];

  constructor(readonly map: MapData, readonly tiles: TileManager) {
    this.globalBoxes = tiles.globalAreas.map((i) => {
      const p = map.areas[i].p;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]); }
      return { i, x0, x1, z0, z1 };
    });
    tiles.onData = (t) => this.cache.delete(t.key);
    this.metro = (map.metro ?? []).map((l) => ({ c: l.c, p: decode(l.p), m: l.m }));
  }

  private path(g: CanvasRenderingContext2D, flat: number[], ox: number, oz: number, close: boolean) {
    for (let i = 0; i < flat.length; i += 2) {
      const x = (flat[i] - ox) / MPP, y = (flat[i + 1] - oz) / MPP;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    if (close) g.closePath();
  }

  private tileCanvas(t: Tile) {
    const hit = this.cache.get(t.key);
    if (hit && (hit.withData || !t.data)) return hit.c;
    const S = this.tiles.size;
    const px = Math.ceil(S / MPP);
    const c = hit?.c ?? document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d')!;
    const ox = t.tx * S, oz = t.tz * S;
    g.fillStyle = BG;
    g.fillRect(0, 0, px, px);
    const drawArea = (i: number) => {
      const a = this.map.areas[i];
      const col = AREA_COL[a.k];
      if (!col) return;
      g.fillStyle = col;
      g.beginPath();
      this.path(g, a.p, ox, oz, true);
      a.q?.forEach((h) => this.path(g, h, ox, oz, true));
      g.fill('evenodd');
    };
    for (const b of this.globalBoxes) if (b.x1 > ox && b.x0 < ox + S && b.z1 > oz && b.z0 < oz + S) drawArea(b.i);
    for (const i of t.areas) drawArea(i);
    g.lineCap = 'round'; g.lineJoin = 'round';
    // Roads from this tile and its neighbours, so strokes continue across edges.
    const pieces: { i: number; a: number; b: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const n = this.tiles.tiles.get(`${t.tx + dx}_${t.tz + dz}`);
      if (n) pieces.push(...n.roads);
    }
    for (const pass of [0, 1]) {
      for (const pc of pieces) {
        const r = this.map.roads[pc.i];
        if (r.t >= 6) continue;
        g.lineWidth = Math.max(1.2, r.w / MPP) + (pass ? 0 : 1.6);
        g.strokeStyle = pass ? (r.t <= 2 ? '#ffffff' : r.t <= 4 ? '#fbf8f1' : '#f1ece2') : '#c9bea6';
        g.beginPath();
        this.path(g, r.p.slice(pc.a * 2, pc.b * 2 + 2), ox, oz, false);
        g.stroke();
      }
    }
    if (t.data) {
      g.fillStyle = '#cdbfa6';
      g.beginPath();
      for (const b of t.data.b) this.path(g, b.p, ox, oz, true);
      g.fill();
    }
    // Metro lines in their colours (dashed where they run underground).
    g.lineWidth = 3;
    for (const l of this.metro) {
      g.strokeStyle = l.c;
      for (let i = 0; i + 3 < l.p.length; i += 2) {
        const ax = l.p[i], az = l.p[i + 1], bx = l.p[i + 2], bz = l.p[i + 3];
        if (Math.max(ax, bx) < ox - 10 || Math.min(ax, bx) > ox + S + 10 || Math.max(az, bz) < oz - 10 || Math.min(az, bz) > oz + S + 10) continue;
        g.setLineDash(l.m[i / 2] === 0 ? [6, 6] : []);
        g.beginPath();
        g.moveTo((ax - ox) / MPP, (az - oz) / MPP);
        g.lineTo((bx - ox) / MPP, (bz - oz) / MPP);
        g.stroke();
      }
    }
    g.setLineDash([]);
    // Food stalls.
    const st = t.data?.s ?? [];
    for (let i = 0; i < st.length; i += 4) {
      g.fillStyle = STALL_TYPES[st[i + 3]]?.color ?? '#e8542f';
      g.beginPath();
      g.arc((st[i] / 10 - ox) / MPP, (st[i + 1] / 10 - oz) / MPP, 3.2, 0, Math.PI * 2);
      g.fill();
    }
    this.cache.set(t.key, { c, withData: !!t.data });
    if (this.cache.size > 60) {
      // Drop the oldest entries.
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    return c;
  }

  /** Draws the heading-up minimap centred on (x, z). */
  drawMini(out: HTMLCanvasElement, x: number, z: number, yaw: number, metersAcross: number, overlay: (g: CanvasRenderingContext2D, toScreen: (wx: number, wz: number) => [number, number]) => void) {
    const g = out.getContext('2d')!;
    const W = out.width, H = out.height;
    const scale = W / metersAcross;
    g.save();
    g.fillStyle = BG;
    g.fillRect(0, 0, W, H);
    g.translate(W / 2, H * 0.58);
    g.rotate(yaw);
    g.scale(scale, scale);
    const S = this.tiles.size;
    const reach = metersAcross * 0.8;
    for (let tx = Math.floor((x - reach) / S); tx <= Math.floor((x + reach) / S); tx++) {
      for (let tz = Math.floor((z - reach) / S); tz <= Math.floor((z + reach) / S); tz++) {
        const t = this.tiles.tiles.get(`${tx}_${tz}`);
        if (!t) continue;
        g.drawImage(this.tileCanvas(t), tx * S - x, tz * S - z, S, S);
      }
    }
    g.restore();
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const toScreen = (wx: number, wz: number): [number, number] => {
      const dx = (wx - x) * scale, dz = (wz - z) * scale;
      return [W / 2 + dx * cos - dz * sin, H * 0.58 + dx * sin + dz * cos];
    };
    overlay(g, toScreen);
  }

  /** Static postcard of a course route (roads, parks and water only). */
  postcard(course: Course, w: number, h: number, landmarks: Record<string, [number, number]>, labels: [string, string][]): HTMLCanvasElement {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < course.x.length; i++) {
      x0 = Math.min(x0, course.x[i]); x1 = Math.max(x1, course.x[i]);
      z0 = Math.min(z0, course.z[i]); z1 = Math.max(z1, course.z[i]);
    }
    const pad = 300;
    x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
    const s = Math.min(w / (x1 - x0), h / (z1 - z0));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const vx0 = cx - w / 2 / s, vx1 = cx + w / 2 / s, vz0 = cz - h / 2 / s, vz1 = cz + h / 2 / s;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = BG; g.fillRect(0, 0, w, h);
    const P = (x: number, z: number): [number, number] => [w / 2 + (x - cx) * s, h / 2 + (z - cz) * s];
    const inView = (p: number[]) => { for (let i = 0; i < p.length; i += 2) if (p[i] > vx0 && p[i] < vx1 && p[i + 1] > vz0 && p[i + 1] < vz1) return true; return false; };
    for (const a of this.map.areas) {
      const col = AREA_COL[a.k];
      if (!col || !(inView(a.p) || a.k === AREA.river)) continue;
      g.fillStyle = col;
      g.beginPath();
      for (let i = 0; i < a.p.length; i += 2) { const [px, py] = P(a.p[i], a.p[i + 1]); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
      g.closePath();
      g.fill();
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of this.map.roads) {
      if (r.t >= 5 || !inView(r.p)) continue;
      g.strokeStyle = r.t <= 2 ? '#ffffff' : '#f6f1e6';
      g.lineWidth = Math.max(0.8, r.w * s * (r.t <= 2 ? 1.4 : 1));
      g.beginPath();
      for (let i = 0; i < r.p.length; i += 2) { const [px, py] = P(r.p[i], r.p[i + 1]); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
      g.stroke();
    }
    g.strokeStyle = 'rgba(15,61,76,0.35)'; g.lineWidth = 9;
    g.beginPath(); course.x.forEach((x, i) => { const [a, b] = P(x, course.z[i]); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke();
    g.strokeStyle = '#f5a524'; g.lineWidth = 4.5; g.stroke();
    const [sx, sy] = P(course.x[0], course.z[0]);
    const [ex, ey] = P(course.x[course.x.length - 1], course.z[course.z.length - 1]);
    g.fillStyle = '#0f3d4c'; g.beginPath(); g.arc(sx, sy, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8542f'; g.beginPath(); g.arc(ex, ey, 6, 0, Math.PI * 2); g.fill();
    g.font = '600 11px "DM Sans", sans-serif';
    for (const [key, label] of labels) {
      const L = landmarks[key];
      if (!L) continue;
      const [lx, ly] = P(L[0], L[1]);
      if (lx < 10 || ly < 10 || lx > w - 110 || ly > h - 10) continue;
      g.fillStyle = '#0f3d4c';
      g.beginPath(); g.arc(lx, ly, 3, 0, Math.PI * 2); g.fill();
      g.fillText(label.toUpperCase(), lx + 6, ly + 4);
    }
    return c;
  }
}
