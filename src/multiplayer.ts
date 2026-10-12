// Multiplayer client: private rooms for 2–8 players. Each client simulates its own
// car; the server relays positions, starts races and collects finish times. Cars
// share the road without car-to-car collisions.
import * as THREE from 'three';
import type { Game } from './game';
import type { RaceSession, RaceEvent } from './race';
import { formatTime } from './race';
import { prefs, savePrefs } from './store';
import { buildCar, animateRig, CAR_MODELS, VehicleRig, DecalId } from './vehicles/models';
import { buildDriver, DRIVERS } from './vehicles/drivers';

interface RoomPlayer { id: string; name: string; driver: string; car: string; paint: string; decal: string; ready: boolean; color: string; finish: number | null }
interface Room { code: string; host: string; phase: 'lobby' | 'racing' | 'results'; course: string; players: RoomPlayer[] }
interface Remote { rig: VehicleRig; key: string; samples: { t: number; s: number[] }[]; label: THREE.Sprite; wheel: number; progress: number }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export class Multiplayer {
  private ws: WebSocket | null = null;
  room: Room | null = null;
  you = '';
  pendingJoin: string | null = null;
  private remotes = new Map<string, Remote>();
  private group = new THREE.Group();
  private sendTimer = 0;
  private clockOffset = 0;
  private lobbyEl: HTMLElement | null = null;
  private lastResults: { standings: { id: string; name: string; color: string; time: number | null }[] } | null = null;
  private myFinish: number | null = null;

  constructor(readonly game: Game) {
    game.world.scene.add(this.group);
  }

  get active() { return !!this.room; }
  get isHost() { return this.room?.host === this.you; }

  private profile() {
    return { name: prefs.name || 'Racer', driver: prefs.driver, car: prefs.car, paint: prefs.paint, decal: prefs.decal };
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === 1) { resolve(); return; }
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('timeout')); ws.close(); }, 6000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.send({ t: 'profile', profile: this.profile() });
        for (let i = 0; i < 3; i++) setTimeout(() => this.send({ t: 'ping', c: Date.now() }), i * 300);
        resolve();
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('connect')); };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.room) {
          this.room = null;
          this.clearRemotes();
          this.closeLobby();
          this.game.hud.toast('Disconnected from the room', 3000);
          if (this.game.mode === 'mp') this.game.toMenu();
        }
      };
      ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    });
  }
  private send(m: unknown) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }

  async create() {
    try { await this.connect(); } catch { this.offline(); return; }
    this.send({ t: 'profile', profile: this.profile() });
    this.send({ t: 'create', course: prefs.course });
  }
  async join(code: string) {
    try { await this.connect(); } catch { this.offline(); return; }
    this.send({ t: 'profile', profile: this.profile() });
    this.send({ t: 'join', room: code });
  }
  private offline() {
    this.game.ui.toastMessage('Multiplayer needs the game server (npm run dev or npm start)', 4000);
    this.game.toMenu();
    alertBox(this.game, 'Multiplayer is offline', 'Rooms run on the included game server. Start it with <code>npm run dev</code> (development) or <code>npm run build && npm start</code>, then open the printed address.');
  }

  leave() {
    if (!this.room && !this.ws) return;
    this.send({ t: 'leave' });
    this.room = null;
    this.ws?.close();
    this.ws = null;
    this.clearRemotes();
    this.closeLobby();
    this.game.hud?.players(null);
    if (location.search.includes('room=')) history.replaceState(null, '', location.pathname);
  }

  private onMessage(m: any) {
    switch (m.t) {
      case 'pong': {
        const now = Date.now();
        const rtt = now - m.c;
        this.clockOffset = m.s - (m.c + rtt / 2);
        break;
      }
      case 'error': this.game.hud.toast(m.msg, 3000); if (!this.room) this.game.toMenu(); break;
      case 'joined':
        this.you = m.you;
        this.room = m.room;
        history.replaceState(null, '', `?room=${m.room.code}`);
        this.game.ui.hideLanding();
        this.showLobby();
        break;
      case 'room':
        this.room = m.room;
        if (this.lobbyEl) this.renderLobby();
        this.syncRemotes();
        break;
      case 'left': this.removeRemote(m.id); break;
      case 'start': this.onStart(m.course, m.at, m.grid); break;
      case 'states': {
        const now = performance.now();
        for (const [id, s] of Object.entries(m.p as Record<string, number[]>)) {
          if (id === this.you) continue;
          const r = this.remotes.get(id);
          if (!r) continue;
          r.samples.push({ t: now, s });
          if (r.samples.length > 12) r.samples.shift();
          r.progress = s[5] ?? 0;
        }
        break;
      }
      case 'results':
        this.lastResults = m;
        this.showResults();
        break;
      case 'rematch':
        this.game.ui.closeModal();
        this.myFinish = null;
        this.showLobby();
        break;
    }
  }

  // ------------------------------------------------------------------ lobby
  private closeLobby() { this.lobbyEl?.remove(); this.lobbyEl = null; }

  showLobby() {
    this.closeLobby();
    this.game.ui.closeModal();
    if (this.game.mode !== 'menu') this.game.toMenuKeepRoom();
    this.game.ui.hideLanding();
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal medium"><div class="m-head"><div class="brand"><div class="mark" style="color:var(--teal);text-shadow:none">DTA</div><div class="name" style="color:var(--teal);border-color:rgba(15,61,76,.25)">DILLI THEFT<br>AUTO</div></div><div class="eyebrow">Multiplayer room</div><button class="close" data-a="leave" aria-label="Leave">✕</button></div><div class="m-body lobby"></div><div class="m-foot"><span>Equal cars · No car-to-car contact</span><span>2–8 players</span></div></div>`;
    wrap.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'leave') { this.leave(); this.game.toMenu(); }
      if (a === 'copy') {
        const link = `${location.origin}${location.pathname}?room=${this.room?.code}`;
        navigator.clipboard?.writeText(link).then(() => { b.textContent = 'Copied!'; }, () => { b.textContent = link; });
      }
      if (a === 'ready') { const me = this.room?.players.find((p) => p.id === this.you); this.send({ t: 'ready', ready: !me?.ready }); }
      if (a === 'start') this.send({ t: 'start' });
      if (b.dataset.course) this.send({ t: 'course', course: b.dataset.course });
    });
    this.game.ui.root.appendChild(wrap);
    this.lobbyEl = wrap;
    this.renderLobby();
  }

  private renderLobby() {
    const r = this.room;
    const body = this.lobbyEl?.querySelector('.lobby');
    if (!r || !body) return;
    const me = r.players.find((p) => p.id === this.you);
    const host = this.isHost;
    const others = r.players.filter((p) => p.id !== this.you);
    const canStart = host && others.every((p) => p.ready);
    const course = this.game.courses.find((c) => c.id === r.course);
    body.innerHTML = `
      <div class="eyebrow">Room code</div>
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:4px 0 14px"><div class="h1" style="letter-spacing:6px;margin:0">${esc(r.code)}</div><button class="btn ghost" data-a="copy">Copy invite link</button></div>
      <div class="eyebrow">Race</div>
      <div class="opt-row" style="margin:8px 0 16px">${this.game.courses.map((c) => `<button class="pill ${c.id === r.course ? 'on' : ''}" ${host ? `data-course="${c.id}"` : 'disabled'}>${esc(c.name)} · ${(c.length * c.laps / 1000).toFixed(1)} km</button>`).join('')}</div>
      <div class="eyebrow">Racers (${r.players.length}/8)</div>
      <ol class="lb-list" style="margin:6px 0 16px">${r.players.map((p) => {
        const d = DRIVERS.find((x) => x.id === p.driver);
        const car = CAR_MODELS.find((x) => x.id === p.car);
        return `<li class="${p.id === this.you ? 'me' : ''}"><div><b><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${p.color};margin-right:6px"></i>${esc(p.name)}${p.id === r.host ? ' · host' : ''}</b><small>${esc(d?.name ?? '')} · ${esc(car?.name ?? '')}</small></div><span>${p.id === r.host ? 'HOST' : p.ready ? 'READY' : 'NOT READY'}</span></li>`;
      }).join('')}</ol>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        ${host ? `<button class="btn" data-a="start" ${canStart ? '' : 'disabled'}>Start race ↗</button><span class="note">${others.length ? (canStart ? 'Everyone is ready.' : 'Waiting for everyone to be ready…') : 'Share the link. You can also start alone.'}</span>` : `<button class="btn ${me?.ready ? 'dark' : ''}" data-a="ready">${me?.ready ? 'Ready ✓' : 'I’m ready'}</button><span class="note">The host starts the race when everyone is ready.</span>`}
      </div>
      <p class="note">${esc(course?.blurb ?? '')}</p>`;
  }

  // ------------------------------------------------------------------ race
  private onStart(courseId: string, at: number, grid: Record<string, number>) {
    this.closeLobby();
    this.game.ui.closeModal();
    const course = this.game.courses.find((c) => c.id === courseId) ?? this.game.courses[0];
    this.myFinish = null;
    this.lastResults = null;
    this.game.startRace('mp', course, grid[this.you] ?? 0);
    const race = this.game.race!;
    race.countdown = Math.max(0.5, (at - (Date.now() + this.clockOffset)) / 1000);
    this.syncRemotes();
    for (const [id, r] of this.remotes) {
      const pose = course.poseAt(Math.max(2, 10 - Math.floor((grid[id] ?? 0) / 2) * 7), (grid[id] ?? 0) ? ((grid[id] % 2) ? 2.6 : -2.6) : 0);
      r.samples = [{ t: performance.now(), s: [pose.x, pose.y, pose.z, pose.yaw, 0, 0, 0] }];
    }
  }

  raceUpdate(race: RaceSession, dt: number, px: number, pz: number): RaceEvent[] {
    const car = this.game.player;
    const ev = race.update(dt, px, pz, car.x, car.z, car.vx, car.vz);
    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      this.sendTimer = 1 / 15;
      this.send({ t: 'state', s: [car.x, car.y, car.z, car.yaw, car.speed, race.progress, car.hover ? 1 : 0] });
    }
    return ev;
  }

  finished(time: number) {
    this.myFinish = time;
    this.send({ t: 'finish', time });
    this.game.hud.big('FINISH', `${formatTime(time)} · waiting for others`);
    setTimeout(() => { if (this.game.mode === 'mp' && !this.lastResults) this.game.hud.big(''); }, 2500);
  }

  private showResults() {
    const res = this.lastResults;
    if (!res) return;
    this.game.hud.big('');
    const course = this.game.race?.course ?? this.game.courses.find((c) => c.id === this.room?.course) ?? this.game.courses[0];
    this.game.ui.results({
      course, time: this.myFinish ?? 0, best: 0, isBest: false, multi: true, host: this.isHost,
      standings: res.standings.map((s) => ({ name: s.name, time: s.time, you: s.id === this.you, color: s.color })),
      onRematch: () => this.send({ t: 'rematch' }),
    });
  }

  // ------------------------------------------------------------------ remote cars
  private syncRemotes() {
    if (!this.room) return;
    const ids = new Set(this.room.players.map((p) => p.id));
    for (const id of [...this.remotes.keys()]) if (!ids.has(id)) this.removeRemote(id);
    for (const p of this.room.players) {
      if (p.id === this.you) continue;
      const key = `${p.car}|${p.paint}|${p.decal}|${p.driver}|${p.name}`;
      const ex = this.remotes.get(p.id);
      if (ex && ex.key === key) continue;
      if (ex) this.removeRemote(p.id);
      const model = CAR_MODELS.find((m) => m.id === p.car) ?? CAR_MODELS[0];
      const paint = model.paints.find((x) => x.id === p.paint) ?? model.paints[0];
      const rig = buildCar(model.id, paint, (p.decal as DecalId) || 'none');
      rig.driverSlot.add(buildDriver(DRIVERS.find((d) => d.id === p.driver) ?? DRIVERS[0]));
      const label = nameSprite(p.name, p.color);
      label.position.set(0, 3.1, 0);
      rig.root.add(label);
      rig.root.visible = false;
      this.group.add(rig.root);
      this.remotes.set(p.id, { rig, key, samples: [], label, wheel: 0, progress: 0 });
    }
  }
  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.group.remove(r.rig.root);
    r.rig.dispose();
    this.remotes.delete(id);
  }
  private clearRemotes() { for (const id of [...this.remotes.keys()]) this.removeRemote(id); }

  render(dt: number) {
    if (this.game.mode !== 'mp') { this.group.visible = false; return; }
    this.group.visible = true;
    const renderT = performance.now() - 130;
    for (const r of this.remotes.values()) {
      const S = r.samples;
      if (!S.length) { r.rig.root.visible = false; continue; }
      r.rig.root.visible = true;
      let a = S[0], b = S[S.length - 1];
      for (let i = 0; i < S.length - 1; i++) if (S[i].t <= renderT && S[i + 1].t >= renderT) { a = S[i]; b = S[i + 1]; break; }
      const k = b.t > a.t ? Math.max(0, Math.min(1.2, (renderT - a.t) / (b.t - a.t))) : 1;
      const lerp = (i: number) => a.s[i] + (b.s[i] - a.s[i]) * k;
      let dy = b.s[3] - a.s[3];
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      r.rig.root.position.set(lerp(0), lerp(1), lerp(2));
      r.rig.root.rotation.y = a.s[3] + dy * k;
      r.wheel -= (lerp(4) * dt) / 0.36;
      animateRig(r.rig, { wheelSpin: r.wheel, steerVis: 0, pitch: 0, roll: 0, hover: b.s[6] > 0.5 }, dt);
    }
    // Live standings.
    if (this.room && this.game.race) {
      const rows = this.room.players.map((p) => ({
        p, prog: p.id === this.you ? this.game.race!.progress : this.remotes.get(p.id)?.progress ?? 0,
      })).sort((x, y) => (x.p.finish ?? Infinity) - (y.p.finish ?? Infinity) || y.prog - x.prog);
      this.game.hud.players(rows.map((r, i) => ({ name: `${i + 1}. ${r.p.name}${r.p.id === this.you ? ' (you)' : ''}`, color: r.p.color, info: r.p.finish ? formatTime(r.p.finish) : `${(r.prog / 1000).toFixed(1)} km` })));
    }
  }

  drawMini(g: CanvasRenderingContext2D, P: (x: number, z: number) => [number, number]) {
    if (this.game.mode !== 'mp' || !this.room) return;
    for (const p of this.room.players) {
      const r = this.remotes.get(p.id);
      if (!r || !r.rig.root.visible) continue;
      const [x, y] = P(r.rig.root.position.x, r.rig.root.position.z);
      g.fillStyle = p.color; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }
}

function nameSprite(name: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(15,61,76,0.85)';
  g.beginPath(); g.roundRect(4, 8, 248, 48, 24); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(32, 32, 10, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 28px "DM Sans", sans-serif'; g.textBaseline = 'middle';
  g.fillText(name.slice(0, 14), 52, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(3.2, 0.8, 1);
  s.renderOrder = 10;
  return s;
}

function alertBox(game: Game, title: string, html: string) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal small"><div class="m-head"><div class="eyebrow">${esc(title)}</div><button class="close" aria-label="Close">✕</button></div><div class="m-body"><p style="font-size:14px;line-height:1.6">${html}</p></div></div>`;
  wrap.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.close') || e.target === wrap) wrap.remove(); });
  game.ui.root.appendChild(wrap);
}

export { savePrefs };
