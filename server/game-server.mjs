// Multiplayer rooms (WebSocket) and the global leaderboard (JSON file).
// Shared by the Vite dev server plugin and the production server (server/index.mjs).
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['#f5b829', '#e8542f', '#2a74c9', '#1f8a3a', '#e8559a', '#7b3fbf', '#15707c', '#c62d2d'];
const MAX_PLAYERS = 8;
const COURSES = new Set(['raisina-run', 'janpath-dash', 'cp-circuit', 'yamuna-paar', 'akshardham-express', 'madhu-vihar-mile', 'shanti-path']);

const clean = (s, n = 16) => String(s ?? '').replace(/[^\p{L}\p{N} ._\-']/gu, '').trim().slice(0, n);

export function createGameServer({ dataDir = process.cwd() } = {}) {
  const rooms = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  let nextId = 1;

  const newCode = () => {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
  };
  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const snapshot = (room) => ({
    code: room.code, host: room.host, phase: room.phase, course: room.course,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, driver: p.driver, car: p.car, paint: p.paint, decal: p.decal, ready: p.ready, color: p.color, finish: p.finish })),
  });
  const broadcast = (room, msg) => { for (const p of room.players.values()) send(p.ws, msg); };
  const pushRoom = (room) => broadcast(room, { t: 'room', room: snapshot(room) });

  function finishRace(room) {
    if (room.phase !== 'racing') return;
    room.phase = 'results';
    clearTimeout(room.dnfTimer);
    const standings = [...room.players.values()]
      .map((p) => ({ id: p.id, name: p.name, color: p.color, time: p.finish }))
      .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
    broadcast(room, { t: 'results', standings });
    for (const p of room.players.values()) p.ready = false;
    pushRoom(room);
  }

  function leave(player) {
    const room = player.room;
    if (!room) return;
    room.players.delete(player.id);
    player.room = null;
    if (!room.players.size) { clearTimeout(room.dnfTimer); rooms.delete(room.code); return; }
    if (room.host === player.id) room.host = room.players.keys().next().value;
    broadcast(room, { t: 'left', id: player.id });
    if (room.phase === 'racing' && [...room.players.values()].every((p) => p.finish != null)) finishRace(room);
    pushRoom(room);
  }

  wss.on('connection', (ws) => {
    const player = { id: String(nextId++), ws, room: null, name: 'Racer', driver: 'bunty', car: 'taxi', paint: '', decal: 'none', ready: false, color: COLORS[0], finish: null, state: null };
    let msgs = 0;
    const rate = setInterval(() => (msgs = 0), 1000);
    ws.on('message', (raw) => {
      if (++msgs > 60) return;
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      const room = player.room;
      switch (m.t) {
        case 'ping': send(ws, { t: 'pong', c: m.c, s: Date.now() }); break;
        case 'profile': {
          const p = m.profile || {};
          player.name = clean(p.name) || `Racer ${player.id}`;
          player.driver = clean(p.driver, 20); player.car = clean(p.car, 20);
          player.paint = clean(p.paint, 20); player.decal = clean(p.decal, 20);
          if (room) pushRoom(room);
          break;
        }
        case 'create': {
          if (room) leave(player);
          const code = newCode();
          const r = { code, host: player.id, phase: 'lobby', course: COURSES.has(m.course) ? m.course : 'raisina-run', players: new Map(), dnfTimer: null };
          rooms.set(code, r);
          player.color = COLORS[0];
          r.players.set(player.id, player);
          player.room = r;
          send(ws, { t: 'joined', you: player.id, room: snapshot(r) });
          break;
        }
        case 'join': {
          const r = rooms.get(String(m.room || '').toUpperCase());
          if (!r) { send(ws, { t: 'error', msg: 'Room not found. Check the code.' }); break; }
          if (r.players.size >= MAX_PLAYERS) { send(ws, { t: 'error', msg: 'That room is full (8 players).' }); break; }
          if (room) leave(player);
          const used = new Set([...r.players.values()].map((p) => p.color));
          player.color = COLORS.find((c) => !used.has(c)) ?? COLORS[0];
          player.ready = false; player.finish = null;
          r.players.set(player.id, player);
          player.room = r;
          send(ws, { t: 'joined', you: player.id, room: snapshot(r) });
          pushRoom(r);
          break;
        }
        case 'leave': leave(player); break;
        case 'ready': if (room && room.phase !== 'racing') { player.ready = !!m.ready; pushRoom(room); } break;
        case 'course': if (room && room.host === player.id && room.phase !== 'racing' && COURSES.has(m.course)) { room.course = m.course; pushRoom(room); } break;
        case 'start': {
          if (!room || room.host !== player.id || room.phase === 'racing') break;
          const others = [...room.players.values()].filter((p) => p.id !== player.id);
          if (others.some((p) => !p.ready)) { send(ws, { t: 'error', msg: 'Everyone needs to be ready.' }); break; }
          room.phase = 'racing';
          const order = [...room.players.keys()].sort(() => Math.random() - 0.5);
          for (const p of room.players.values()) { p.finish = null; p.state = null; }
          const at = Date.now() + 4200;
          broadcast(room, { t: 'start', course: room.course, at, grid: Object.fromEntries(order.map((id, i) => [id, i])) });
          pushRoom(room);
          break;
        }
        case 'state': {
          if (!room || room.phase !== 'racing' || !Array.isArray(m.s) || m.s.length > 8) break;
          player.state = m.s.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0));
          break;
        }
        case 'finish': {
          if (!room || room.phase !== 'racing' || player.finish != null) break;
          const t = Number(m.time);
          if (!(t > 10 && t < 3600)) break;
          player.finish = t;
          pushRoom(room);
          if ([...room.players.values()].every((p) => p.finish != null)) finishRace(room);
          else if (!room.dnfTimer) room.dnfTimer = setTimeout(() => finishRace(room), 45000);
          break;
        }
        case 'rematch': {
          if (!room || room.host !== player.id || room.phase !== 'results') break;
          room.phase = 'lobby';
          room.dnfTimer = null;
          for (const p of room.players.values()) { p.finish = null; p.ready = false; }
          broadcast(room, { t: 'rematch' });
          pushRoom(room);
          break;
        }
      }
    });
    ws.on('close', () => { clearInterval(rate); leave(player); });
    ws.on('error', () => {});
  });

  // Relay positions at 15 Hz.
  const tick = setInterval(() => {
    for (const room of rooms.values()) {
      if (room.phase !== 'racing') continue;
      const p = {};
      for (const pl of room.players.values()) if (pl.state) p[pl.id] = pl.state;
      broadcast(room, { t: 'states', p });
    }
  }, 66);
  tick.unref?.();

  // ---------------------------------------------------------------- leaderboard
  const lbFile = path.join(dataDir, '.leaderboard.json');
  let board = {};
  try { board = JSON.parse(fs.readFileSync(lbFile, 'utf8')); } catch { board = {}; }
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.writeFile(lbFile, JSON.stringify(board), () => {}), 500); };

  async function handleApi(req, res) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.endsWith('/api/health')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return true;
    }
    if (!url.pathname.startsWith('/api/leaderboard')) return false;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      const c = url.searchParams.get('course');
      res.end(JSON.stringify(COURSES.has(c) ? (board[c] || []).slice(0, 25) : []));
      return true;
    }
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2000) break; }
      let m;
      try { m = JSON.parse(body); } catch { res.statusCode = 400; res.end('{"ok":false}'); return true; }
      const name = clean(m.name), time = Number(m.time);
      if (!COURSES.has(m.course) || !name || !(time > 20 && time < 3600)) { res.statusCode = 400; res.end('{"ok":false}'); return true; }
      const list = (board[m.course] ||= []);
      const prev = list.find((r) => r.name.toLowerCase() === name.toLowerCase());
      if (!prev || time < prev.time) {
        if (prev) list.splice(list.indexOf(prev), 1);
        list.push({ name, time: Math.round(time * 1000) / 1000, driver: clean(m.driver, 20), car: clean(m.car, 20), at: Date.now() });
        list.sort((a, b) => a.time - b.time);
        list.length = Math.min(list.length, 100);
        save();
      }
      res.end('{"ok":true}');
      return true;
    }
    res.statusCode = 405;
    res.end('{}');
    return true;
  }

  return {
    handleUpgrade(req, socket, head) {
      if (!req.url?.startsWith('/ws')) return false;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      return true;
    },
    handleApi,
    close() { clearInterval(tick); wss.close(); },
  };
}
