// Global leaderboard client. Works when the game server is running; otherwise null.
import { prefs } from './store';

export async function fetchLeaderboard(course: string) {
  try {
    const r = await fetch(`/api/leaderboard?course=${encodeURIComponent(course)}`, { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    return (await r.json()) as { name: string; time: number; driver: string; car: string }[];
  } catch { return null; }
}

export async function postScore(course: string, time: number) {
  try {
    const r = await fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course, time, name: prefs.name, driver: prefs.driver, car: prefs.car }),
    });
    return r.ok;
  } catch { return false; }
}
