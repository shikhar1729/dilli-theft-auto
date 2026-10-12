// Persistent player preferences and personal bests (localStorage, guarded).
import type { CarModelId, DecalId } from './vehicles/models';

export type Graphics = 'low' | 'medium' | 'high';
export interface Prefs {
  name: string;
  driver: string;
  car: CarModelId;
  paint: string;
  decal: DecalId;
  course: string;
  graphics: Graphics;
  autoAccel: boolean;
  units: 'kmh' | 'mph';
  muted: boolean;
}

const KEY = 'dilli-theft-auto-prefs-v1';
const BEST = 'dilli-theft-auto-best-v1';

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch { return fallback; }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
}

const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const prefs: Prefs = read<Prefs>(KEY, {
  name: '',
  driver: 'bunty',
  car: 'taxi',
  paint: 'kp',
  decal: 'stripes',
  course: 'raisina-run',
  graphics: isTouch ? 'low' : 'medium',
  autoAccel: isTouch,
  units: 'kmh',
  muted: false,
});
export function savePrefs() { write(KEY, prefs); }

const bests: Record<string, number> = read<Record<string, number>>(BEST, {});
export function bestTime(course: string): number { return bests[course] ?? 0; }
export function recordTime(course: string, t: number): boolean {
  if (!bests[course] || t < bests[course]) { bests[course] = t; write(BEST, bests); return true; }
  return false;
}
export function resetBest(course: string) { delete bests[course]; write(BEST, bests); }
export const IS_TOUCH = isTouch;
