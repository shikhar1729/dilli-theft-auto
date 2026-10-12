// Game controller: boot, modes (menu, race, free drive, watch, multiplayer), the
// main loop, and the glue between simulation, world, UI and audio.
import * as THREE from 'three';
import { loadMap, MapData } from './map';
import { buildWorld, World } from './world/world';
import { CarState, stepCar, FIXED_DT, PhysicsEnv, nearestRoadPose, CarInput, NO_INPUT } from './physics';
import { Course, CourseProps, buildCourseProps, installRamps, RaceSession, ringInstances, Ring, formatTime } from './race';
import { CameraRig } from './camera';
import { Input } from './input';
import { GameAudio } from './audio';
import { UI, HUD } from './ui';
import { MapCanvas } from './minimap';
import { prefs, savePrefs, bestTime, recordTime } from './store';
import { buildCar, animateRig, CAR_MODELS, VehicleRig } from './vehicles/models';
import { buildDriver, DRIVERS } from './vehicles/drivers';
import { Traffic } from './traffic';
import { Autopilot } from './autopilot';
import { terrainHeight } from './terrain';
import { Multiplayer } from './multiplayer';
import { fetchLeaderboard, postScore } from './leaderboard';
import { Metro } from './metro';
import { STALL_TYPES } from './world/stalls';

type Mode = 'menu' | 'race' | 'free' | 'watch' | 'mp';

interface Stop { id: string; label: string; at: string; dist: number; pitch: number; yaw: number; dx?: number; dz?: number; h?: number }
const STOPS: Stop[] = [
  { id: 'rb', label: 'Rashtrapati Bhavan', at: 'rbDome', dist: 230, pitch: 0.2, yaw: Math.PI * 0.5 + 0.35, h: 30 },
  { id: 'blocks', label: 'North & South Block', at: 'vijayChowk', dist: 150, pitch: 0.16, yaw: Math.PI * 0.5 - 0.05, dx: -260, h: 22 },
  { id: 'kartavya', label: 'Kartavya Path', at: 'vijayChowk', dist: 170, pitch: 0.16, yaw: -Math.PI / 2 - 0.05, dx: 760, dz: 40, h: 22 },
  { id: 'gate', label: 'India Gate', at: 'indiaGate', dist: 95, pitch: 0.14, yaw: -Math.PI / 2 - 0.5, h: 18 },
  { id: 'canopy', label: 'Canopy & War Memorial', at: 'canopy', dist: 120, pitch: 0.3, yaw: 0.9, dx: 90, h: 6 },
  { id: 'cp', label: 'Connaught Place', at: 'cpCenter', dist: 210, pitch: 0.42, yaw: 0.6, h: 20 },
  { id: 'jantar', label: 'Jantar Mantar', at: 'samratYantra', dist: 55, pitch: 0.2, yaw: 2.4, h: 8 },
  { id: 'bangla', label: 'Bangla Sahib', at: 'banglaSahib', dist: 90, pitch: 0.22, yaw: 0.4, h: 14 },
  { id: 'chanakyapuri', label: 'Chanakyapuri', at: 'chanakyapuri', dist: 260, pitch: 0.35, yaw: 0.9, h: 10 },
  { id: 'humayun', label: 'Humayun\u2019s Tomb', at: 'humayunTomb', dist: 150, pitch: 0.2, yaw: Math.PI, h: 24 },
  { id: 'yamuna', label: 'Yamuna & Vikas Marg', at: 'ito', dist: 260, pitch: 0.22, yaw: -1.9, dx: 900, h: 10 },
  { id: 'akshardham', label: 'Akshardham', at: 'akshardham', dist: 170, pitch: 0.2, yaw: Math.PI / 2 + 0.3, h: 22 },
  { id: 'laxmi', label: 'Laxmi Nagar', at: 'laxmiNagar', dist: 190, pitch: 0.4, yaw: 0.7, h: 12 },
  { id: 'patparganj', label: 'Patparganj societies', at: 'patparganj', dist: 260, pitch: 0.45, yaw: 2.2, h: 20 },
];
const MENU_STOPS = ['gate', 'akshardham', 'rb', 'cp', 'humayun', 'patparganj', 'kartavya', 'chanakyapuri'];

export class Game {
  renderer: THREE.WebGLRenderer;
  ui = new UI();
  hud!: HUD;
  input = new Input();
  audio = new GameAudio();
  cam: CameraRig;
  map!: MapData;
  world!: World;
  env!: PhysicsEnv;
  mapCanvas!: MapCanvas;
  courses: Course[] = [];
  private props = new Map<string, CourseProps>();
  private activeProps: CourseProps | null = null;
  rings: Ring[] = [];
  private ringMesh: THREE.InstancedMesh | null = null;
  traffic!: Traffic;
  metro!: Metro;
  serverAvailable = false;
  private stallTimer = 0;
  private stallCooldown = new Map<string, number>();

  mode: Mode = 'menu';
  paused = false;
  player = new CarState();
  rig: VehicleRig | null = null;
  race: RaceSession | null = null;
  course: Course | null = null;
  autopilot: Autopilot | null = null;
  mp: Multiplayer | null = null;
  private acc = 0;
  private t = 0;
  private last = performance.now();
  private lastInput: CarInput = NO_INPUT;
  private menuStop = 0;
  private menuTimer = 0;
  private scenic: string | null = null;
  private resultsTimer = -1;
  private chai: { obj: THREE.Group; x: number; y: number; z: number; label: string; got: boolean }[] = [];
  private loadR = 1200;
  private unloadR = 1900;
  private holding = false;
  private riverTime = 0;
  private wasHolding = false;
  private chaiGroup = new THREE.Group();
  private hudTimer = 0;
  private wasHover = false;
  private wasWater = false;
  private impactCooldown = 0;
  private lastCount = -1;
  drawDistance = 1100;
  private orbitDrag: { x: number; y: number; yaw: number; pitch: number } | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.cam = new CameraRig(innerWidth / innerHeight);
    addEventListener('resize', () => this.resize());
    this.resize();
    // Drag to look around in scenic and menu views.
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.cam.orbit || this.mode === 'menu') return;
      this.orbitDrag = { x: e.clientX, y: e.clientY, yaw: this.cam.orbit.yaw, pitch: this.cam.orbit.pitch };
    });
    addEventListener('pointermove', (e) => {
      if (!this.orbitDrag || !this.cam.orbit) return;
      this.cam.orbit.yaw = this.orbitDrag.yaw - (e.clientX - this.orbitDrag.x) * 0.006;
      this.cam.orbit.pitch = Math.max(0.03, Math.min(1.2, this.orbitDrag.pitch + (e.clientY - this.orbitDrag.y) * 0.004));
    });
    addEventListener('pointerup', () => (this.orbitDrag = null));
    // Audio needs a user gesture.
    const unlock = () => { this.audio.start(); this.audio.setMuted(prefs.muted); };
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.cam.camera.aspect = innerWidth / innerHeight;
    this.cam.camera.updateProjectionMatrix();
  }

  applyGraphics() {
    const g = prefs.graphics;
    const dpr = devicePixelRatio || 1;
    this.renderer.setPixelRatio(g === 'low' ? Math.min(dpr, 1) * 0.8 : g === 'medium' ? Math.min(dpr, 1.35) : Math.min(dpr, 2));
    this.renderer.shadowMap.enabled = g !== 'low';
    this.world?.sky.setShadows(g !== 'low', g === 'high' ? 2048 : 1024);
    this.drawDistance = g === 'low' ? 650 : g === 'medium' ? 1000 : 1500;
    this.loadR = g === 'low' ? 750 : g === 'medium' ? 1100 : 1500;
    this.unloadR = this.loadR + 700;
    if (this.world) (this.world.scene.fog as THREE.FogExp2).density = g === 'low' ? 0.0011 : g === 'medium' ? 0.00068 : 0.0005;
    if (this.traffic) this.traffic.target = g === 'low' ? 16 : g === 'medium' ? 30 : 42;
    this.resize();
  }

  // ------------------------------------------------------------------ boot
  async boot() {
    const ui = this.ui;
    ui.loading('Loading New Delhi', 0.05);
    try {
      this.map = await loadMap((f) => ui.loading('Loading New Delhi', 0.05 + f * 0.35));
    } catch (e) {
      ui.loadingError(String((e as Error).message || e));
      return;
    }
    let stepN = 0;
    this.world = await buildWorld(this.map, (label) => ui.loading(label, 0.42 + 0.12 * stepN++));
    const w = this.world;
    this.env = { surfaces: w.surfaces, walls: w.walls, roads: w.roads, areas: w.areas, bounds: this.map.bounds };
    ui.loading('Marking the race routes', 0.9);
    await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 50); });
    this.courses = this.map.courses.map((c) => new Course(c, w.roads, this.map.landmarks, (x, z, y) => w.surfaces.height(x, z, y)));
    for (const c of this.courses) {
      installRamps(c, w.surfaces, w.scene);
      for (const r of c.rings) { r.idx = this.rings.length; this.rings.push(r); }
    }
    this.ringMesh = ringInstances(this.rings.length);
    this.updateRings();
    w.scene.add(this.ringMesh, this.chaiGroup);
    this.ui.courses = this.courses;
    this.mapCanvas = new MapCanvas(this.map, w.tiles);
    const labels: [string, string][] = [['indiaGate', 'India Gate'], ['rbDome', 'Rashtrapati Bhavan'], ['cpCenter', 'Connaught Place'], ['samratYantra', 'Jantar Mantar'], ['vijayChowk', 'Vijay Chowk'], ['banglaSahib', 'Bangla Sahib'], ['akshardham', 'Akshardham'], ['laxmiNagar', 'Laxmi Nagar'], ['ito', 'ITO'], ['yamunaSports', 'Yamuna Sports Complex'], ['madhuVihar', 'Madhu Vihar'], ['teenMurti', 'Teen Murti'], ['nehruPark', 'Nehru Park']];
    for (const c of this.courses) this.ui.postcards.set(c.id, () => this.mapCanvas.postcard(c, 760, 360, this.map.landmarks, labels));

    this.traffic = new Traffic(this.map);
    this.traffic.onHonk = (x, z) => {
      const d = Math.hypot(x - this.player.x, z - this.player.z);
      if (d < 120) this.audio.horn(0.1 * (1 - d / 140), 0.25 + Math.random() * 0.3, 0.85 + Math.random() * 0.4);
    };
    this.traffic.onMoo = () => this.audio.tone([150, 120], 0.25, 0.12, 'sawtooth');
    w.scene.add(this.traffic.group);
    this.env.obstacles = this.traffic.obstacles;
    this.metro = new Metro(this.map);
    w.scene.add(this.metro.group);
    // Multiplayer and the global leaderboard need the game server (not available on static hosting).
    fetch(`${import.meta.env.BASE_URL}api/health`).then((r) => r.ok && r.json()).then((j) => { this.serverAvailable = !!j?.ok; this.ui.serverAvailable = this.serverAvailable; }).catch(() => {});

    this.buildChai();
    this.hud = new HUD(this.ui.root);
    this.ui.hud = this.hud;
    this.hud.visible(false);
    this.hud.onButton = (a) => {
      if (a === 'pause') this.input.trigger('pause');
      if (a === 'mute') this.input.trigger('mute');
      if (a.startsWith('stop:')) this.scenicStop(a.slice(5));
    };
    this.mp = new Multiplayer(this);
    this.ui.h = {
      startSolo: () => this.startRace('race'),
      createRoom: () => this.mp!.create(),
      joinRoom: (code) => this.mp!.join(code),
      explore: () => this.startFree(),
      watch: () => this.startWatch(),
      resume: () => { this.paused = false; this.last = performance.now(); },
      restart: () => { this.paused = false; if (this.mode === 'free') this.startFree(); else this.startRace('race'); },
      quit: () => this.toMenu(),
      toggleMute: () => this.toggleMute(),
      settingsChanged: () => { this.applyGraphics(); this.input.autoAccelerate = prefs.autoAccel; },
      courseChanged: () => {},
      leaderboard: (c) => fetchLeaderboard(c),
      submitScore: (c, t) => postScore(c, t),
    };
    this.applyGraphics();
    this.input.autoAccelerate = prefs.autoAccel;
    this.buildPlayer();
    // Stream in the city around the first view before showing the menu.
    const first = this.map.landmarks.indiaGate;
    await w.tiles.ensure(first[0], first[1], 700, (f) => ui.loading('Building the city', 0.9 + f * 0.1));
    this.toMenu();
    ui.hideLoading();
    (window as any).dta = this; // read-only diagnostics
    this.renderer.setAnimationLoop(() => this.frame());
    // Deep link to a multiplayer room.
    const room = new URLSearchParams(location.search).get('room');
    if (room) { this.ui.hideLanding(); this.ui.startJoinFlow(room.toUpperCase()); }
  }

  buildPlayer() {
    if (this.rig) { this.world.scene.remove(this.rig.root); this.rig.dispose(); }
    const m = CAR_MODELS.find((x) => x.id === prefs.car) ?? CAR_MODELS[0];
    const p = m.paints.find((x) => x.id === prefs.paint) ?? m.paints[0];
    this.rig = buildCar(m.id, p, prefs.decal);
    const d = DRIVERS.find((x) => x.id === prefs.driver) ?? DRIVERS[0];
    this.rig.driverSlot.add(buildDriver(d));
    this.world.scene.add(this.rig.root);
  }

  private buildChai() {
    const cup: [number, number][] = [[0, 0], [0.42, 0], [0.62, 0.75], [0.66, 0.9], [0.58, 0.92], [0.5, 0.84], [0, 0.84]];
    const clayGeo = new THREE.LatheGeometry(cup.map(([a, b]) => new THREE.Vector2(a, b)), 20);
    const clayMat = new THREE.MeshLambertMaterial({ color: 0xc0643a, emissive: 0x3a1206, side: THREE.DoubleSide });
    for (const s of this.map.chai) {
      const g = new THREE.Group();
      const clay = new THREE.Mesh(clayGeo, clayMat);
      clay.scale.setScalar(1.8);
      const tea = new THREE.Mesh(new THREE.CircleGeometry(0.56 * 1.8, 20), new THREE.MeshLambertMaterial({ color: 0xc89a62 }));
      tea.rotation.x = -Math.PI / 2; tea.position.y = 0.8 * 1.8;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.12, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffd36b }));
      halo.rotation.x = Math.PI / 2; halo.position.y = 0.1;
      // A tall beacon so chai stops can be spotted over rooftops.
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc44d, transparent: true, opacity: 0.35, depthWrite: false }));
      beacon.position.y = 30;
      g.add(clay, tea, halo, beacon);
      const y = this.world.surfaces.baseHeight(s.x, s.z) + 1.6;
      g.position.set(s.x, y, s.z);
      this.chaiGroup.add(g);
      this.chai.push({ obj: g, x: s.x, y, z: s.z, label: s.label, got: false });
    }
    this.chaiGroup.visible = false;
  }

  toggleMute() {
    prefs.muted = !prefs.muted;
    savePrefs();
    this.audio.setMuted(prefs.muted);
    this.hud?.setMuteIcon(prefs.muted);
  }

  // ------------------------------------------------------------------ modes
  private setCourse(c: Course | null) {
    if (this.activeProps) { this.world.scene.remove(this.activeProps.group); this.activeProps = null; }
    this.course = c;
    if (!c) return;
    let p = this.props.get(c.id);
    if (!p) { p = buildCourseProps(c); this.props.set(c.id, p); }
    this.activeProps = p;
    p.setActiveGate(0);
    this.world.scene.add(p.group);
  }

  private resetRings() { for (const r of this.rings) r.taken = false; this.updateRings(); }

  private ringSpin = 0;
  private updateRings() {
    const m = this.ringMesh;
    if (!m) return;
    const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), mat = new THREE.Matrix4();
    for (const r of this.rings) {
      e.set(0, r.yaw, this.ringSpin, 'YXZ');
      q.setFromEuler(e);
      s.setScalar(r.taken ? 0 : 1);
      m.setMatrixAt(r.idx, mat.compose(p.set(r.x, r.y, r.z), q, s));
    }
    m.instanceMatrix.needsUpdate = true;
  }

  toMenu() {
    this.mp?.leave();
    this.toMenuKeepRoom();
    this.ui.showLanding();
  }

  /** Back to the attract camera without leaving a multiplayer room. */
  toMenuKeepRoom() {
    this.mode = 'menu';
    this.paused = false;
    this.race = null;
    this.autopilot = null;
    this.setCourse(null);
    this.scenic = null;
    this.chaiGroup.visible = false;
    this.hud.visible(false);
    this.hud.scenic(null);
    this.hud.players(null);
    this.hud.big('');
    this.input.enabled = false;
    if (this.rig) this.rig.root.visible = false;
    this.ui.closeModal();
    this.menuStop = 0; // India Gate first
    this.menuTimer = 0;
    this.enterMenuStop();
    this.traffic.clear();
  }

  private stopTarget(id: string) {
    const s = STOPS.find((x) => x.id === id) ?? STOPS[0];
    const L = this.map.landmarks[s.at];
    return new THREE.Vector3(L[0] + (s.dx ?? 0), (terrainHeight(L[0], L[1]) || 0) + (s.h ?? 10), L[1] + (s.dz ?? 0));
  }

  private enterMenuStop() {
    const id = MENU_STOPS[this.menuStop % MENU_STOPS.length];
    const s = STOPS.find((x) => x.id === id) ?? STOPS[0];
    this.cam.setOrbit(this.stopTarget(id), s.dist * 1.1, s.yaw, s.pitch + 0.05, 0.05);
  }

  startRace(mode: 'race' | 'mp', course?: Course, grid = 0) {
    this.ui.hideLanding();
    this.ui.closeModal();
    const c = course ?? this.ui.course();
    if (mode === 'race') this.mp?.leave();
    this.buildPlayer();
    this.mode = mode;
    this.paused = false;
    this.setCourse(c);
    this.race = new RaceSession(c);
    this.autopilot = null;
    this.scenic = null;
    this.cam.orbit = null;
    this.cam.reset();
    // Grid slots: two columns, staggered back from the line.
    const row = Math.floor(grid / 2), col = grid % 2;
    const pose = c.poseAt(Math.max(2, 10 - row * 7), grid ? (col ? 2.6 : -2.6) : 0);
    this.player.place(pose.x, this.world.surfaces.height(pose.x, pose.z, pose.y), pose.z, pose.yaw);
    this.player.boost = 1;
    this.player.frozen = true;
    this.rig!.root.visible = true;
    this.chaiGroup.visible = false;
    this.resetRings();
    this.hud.visible(true);
    this.hud.scenic(null);
    this.hud.show('turn', false);
    this.hud.show('wrong', false);
    this.input.enabled = true;
    this.input.clearActions();
    this.resultsTimer = -1;
    this.lastCount = -1;
    this.traffic.clear();
    this.acc = 0;
  }

  startFree() {
    this.mp?.leave();
    this.ui.hideLanding();
    this.ui.closeModal();
    this.buildPlayer();
    this.mode = 'free';
    this.paused = false;
    this.race = null;
    this.autopilot = null;
    this.setCourse(null);
    this.cam.orbit = null;
    this.cam.reset();
    const L = this.map.landmarks.cpCenter;
    const pose = nearestRoadPose(this.env, L[0], L[1] + 330, Math.PI) ?? { x: L[0], z: L[1] + 330, yaw: 0 };
    this.player.place(pose.x, this.world.surfaces.baseHeight(pose.x, pose.z), pose.z, pose.yaw);
    this.player.frozen = false;
    this.player.boost = 1;
    this.rig!.root.visible = true;
    for (const c of this.chai) { c.got = false; c.obj.visible = true; }
    this.chaiGroup.visible = true;
    this.resetRings();
    this.hud.visible(true);
    this.hud.scenic(null);
    this.hud.show('turn', false);
    this.hud.show('wrong', false);
    this.hud.big('');
    this.input.enabled = true;
    this.input.clearActions();
    this.t0Free = 0;
    this.hud.toast(`Explore Delhi · find ${this.chai.length} cups of chai`, 3500);
  }
  private t0Free = 0;

  startWatch(course?: Course) {
    this.mp?.leave();
    this.ui.hideLanding();
    const c = course ?? this.ui.course();
    this.buildPlayer();
    this.mode = 'watch';
    this.paused = false;
    this.setCourse(c);
    this.race = new RaceSession(c);
    this.race.countdown = 0.01;
    this.autopilot = new Autopilot(c);
    this.cam.orbit = null;
    this.cam.reset();
    this.scenic = null;
    const pose = c.poseAt(10);
    this.player.place(pose.x, this.world.surfaces.height(pose.x, pose.z, pose.y), pose.z, pose.yaw);
    this.player.frozen = false;
    this.player.boost = 1;
    this.rig!.root.visible = true;
    this.resetRings();
    this.hud.visible(true);
    this.hud.scenic([...STOPS.map((s) => ({ id: s.id, label: s.label })), { id: 'resume', label: '▶ Resume' }, { id: 'exit', label: '✕ Exit' }]);
    this.input.enabled = false;
    this.traffic.clear();
  }

  scenicStop(id: string) {
    if (id === 'exit') { this.toMenu(); return; }
    if (id === 'resume') { this.scenic = null; this.cam.orbit = null; this.cam.reset(); this.hud.scenic([...STOPS.map((s) => ({ id: s.id, label: s.label })), { id: 'resume', label: '▶ Resume' }, { id: 'exit', label: '✕ Exit' }]); return; }
    const s = STOPS.find((x) => x.id === id);
    if (!s) return;
    this.scenic = id;
    const L = this.map.landmarks[s.at];
    const tgt = new THREE.Vector3(L[0] + (s.dx ?? 0), terrainHeight(L[0], L[1]) + (s.h ?? 10), L[1] + (s.dz ?? 0));
    this.cam.setOrbit(tgt, s.dist, s.yaw, s.pitch, 0);
    this.hud.scenic([...STOPS.map((x) => ({ id: x.id, label: x.label })), { id: 'resume', label: '▶ Resume' }, { id: 'exit', label: '✕ Exit' }], id);
  }

  recover() {
    const car = this.player;
    if (this.race && this.course) {
      const d = this.course.cum[this.race.hint];
      const p = this.course.poseAt(Math.max(0, d - 6));
      car.place(p.x, this.world.surfaces.height(p.x, p.z, p.y), p.z, p.yaw);
    } else {
      const p = nearestRoadPose(this.env, car.x, car.z, car.yaw) ?? car.safe;
      car.place(p.x, this.world.surfaces.baseHeight(p.x, p.z), p.z, p.yaw);
    }
    this.cam.reset();
    this.hud.toast('Back on the road');
  }

  // ------------------------------------------------------------------ loop
  /** Test hook: advance the game by `seconds` without requestAnimationFrame (e.g. in a background tab). */
  debugAdvance(seconds: number, step = 1 / 60) {
    for (let s = 0; s < seconds; s += step) this.frame(step, s + step < seconds);
    this.last = performance.now();
  }

  private frame(fixedDt?: number, skipRender = false) {
    const now = performance.now();
    const dt = fixedDt ?? Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const inp = this.input;

    if (inp.consume('mute')) this.toggleMute();
    if (this.mode !== 'menu') {
      if (inp.consume('pause') && !this.ui.modalOpen) {
        if (this.mode === 'mp') this.ui.pause(true);
        else { this.paused = true; this.ui.pause(false); }
      }
      if (!this.paused && !this.ui.modalOpen) {
        if (inp.consume('camera')) this.cam.cycle();
        if (inp.consume('recover') && this.mode !== 'watch') this.recover();
        if (inp.consume('restart')) {
          if (this.mode === 'race') this.startRace('race');
          else if (this.mode === 'free') this.startFree();
          else if (this.mode === 'mp') this.ui.pause(true);
        }
        if (inp.consume('horn')) this.audio.horn(0.16, 0.4);
      }
    } else inp.clearActions();

    // Stream city tiles around the player (or the camera's orbit target).
    const focus = this.cam.orbit && (this.mode === 'menu' || this.scenic) ? this.cam.orbit.target : new THREE.Vector3(this.player.x, 0, this.player.z);
    const tiles = this.world.tiles;
    const driving = this.mode !== 'menu';
    this.holding = driving && !this.scenic && !tiles.ready(this.player.x, this.player.z, 420);
    tiles.update(focus.x, focus.z, this.loadR, this.unloadR, this.holding ? 30 : 5);
    if (this.mode === 'menu' && this.menuTimer > 8) {
      // Prefetch the next attract-mode view.
      const next = this.stopTarget(MENU_STOPS[(this.menuStop + 1) % MENU_STOPS.length]);
      tiles.update(next.x, next.z, 600, Infinity, 3);
    }
    if (driving) {
      if (this.holding) this.hud.big('LOADING', `Building the city · ${Math.round(tiles.progress(this.player.x, this.player.z, 420) * 100)}%`);
      else if (this.wasHolding) { this.hud.big(''); this.lastCount = -1; this.last = performance.now(); }
    }
    this.wasHolding = this.holding;

    const simulate = (this.mode === 'race' || this.mode === 'free' || this.mode === 'mp' || this.mode === 'watch') && !this.paused && !this.holding && !(this.mode === 'watch' && this.scenic);
    if (simulate) this.simulate(dt);

    if (!this.paused) {
      const pl = this.mode === 'menu' ? null : { x: this.player.x, z: this.player.z, vx: this.player.vx, vz: this.player.vz };
      // Keep the route clear for demonstrations, lighter on it during races, and away from the grid.
      const c = this.course, race = this.race, me = this.player;
      const avoid = (x: number, z: number) =>
        (!!race && race.phase === 'countdown' && Math.hypot(x - me.x, z - me.z) < 150) ||
        (!!c && c.nearRoute(x, z) && (this.mode === 'watch' || Math.random() < 0.6));
      this.traffic.update(dt, focus.x, focus.z, pl, Math.random, avoid);
    }

    // Player visuals.
    if (this.rig && this.rig.root.visible) this.updateRig(dt);
    this.mp?.render(dt);

    // Rings and chai.
    this.ringSpin += dt * 0.8;
    this.updateRings();
    for (const c of this.chai) if (!c.got) { c.obj.rotation.y += dt * 1.6; c.obj.position.y = c.y + Math.sin(this.t * 2 + c.x) * 0.25; }
    this.activeProps?.update(this.t);

    // Camera.
    if (this.mode === 'menu') {
      this.menuTimer += dt;
      if (this.menuTimer > 13) { this.menuTimer = 0; this.menuStop++; this.enterMenuStop(); }
      this.cam.updateOrbit(dt);
    } else if (this.cam.orbit) this.cam.updateOrbit(dt);
    else this.cam.follow(this.player, dt, this.world.walls);

    const camPos = this.cam.camera.position;
    this.world.sky.follow(this.mode === 'menu' ? focus : new THREE.Vector3(this.player.x, this.player.y, this.player.z));
    this.world.update(this.t);
    this.metro.update(this.t, this.cam.camera.position.x, this.cam.camera.position.z, this.drawDistance + 500);
    if (this.mode !== 'menu') this.updateHUD(dt);
    this.audio.update(dt, {
      speed: this.player.speed, throttle: this.lastInput.throttle, slip: this.player.slip, boosting: this.player.boosting,
      grounded: this.player.grounded, active: this.mode !== 'menu' && !this.paused,
      rumble: Math.max(0, 1 - this.metro.nearest / 140),
    });
    void camPos;
    if (!skipRender) this.renderer.render(this.world.scene, this.cam.camera);
  }

  private simulate(dt: number) {
    const car = this.player;
    const race = this.race;
    // The demonstration drive ghosts through traffic.
    this.env.obstacles = this.mode === 'watch' ? undefined : this.traffic.obstacles;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps++ < 20) {
      this.acc -= FIXED_DT;
      let input: CarInput;
      if (this.mode === 'watch' && this.autopilot) input = this.autopilot.drive(car);
      else input = this.input.read(FIXED_DT, this.mode === 'race' || this.mode === 'mp');
      if (this.hud.touchEl) Object.assign(this.input.touch, this.hud.touch);
      if (race && race.phase === 'finished' && this.mode !== 'watch') input = { throttle: 0, brake: 0.4, steer: input.steer * 0.3, boost: false, drift: false };
      car.frozen = !!race && race.phase === 'countdown';
      this.lastInput = input;
      const px = car.x, pz = car.z;
      stepCar(car, input, this.env, FIXED_DT);
      if (race) {
        const evs = this.mode === 'mp' && this.mp ? this.mp.raceUpdate(race, FIXED_DT, px, pz) : race.update(FIXED_DT, px, pz, car.x, car.z, car.vx, car.vz);
        for (const e of evs) this.onRaceEvent(e);
      }
    }
    if (this.acc > FIXED_DT * 4) this.acc = 0;

    // Collectables and rings.
    for (const r of this.rings) {
      if (r.taken) continue;
      if (Math.abs(r.x - car.x) < 4 && Math.abs(r.z - car.z) < 4 && Math.abs(r.y - (car.y + 1)) < 3.4) {
        r.taken = true;
        car.boost = Math.min(1, car.boost + 0.35);
        this.audio.ring();
        if (this.mode !== 'race' && this.mode !== 'mp') setTimeout(() => { r.taken = false; }, 25000);
      }
    }
    if (this.mode === 'free') {
      this.t0Free += dt;
      for (const c of this.chai) {
        if (c.got) continue;
        if (Math.hypot(c.x - car.x, c.z - car.z) < 4.5 && Math.abs(c.y - car.y) < 6) {
          c.got = true;
          c.obj.visible = false;
          this.audio.collect();
          const n = this.chai.filter((x) => x.got).length;
          this.hud.toast(n === this.chai.length ? 'Sab chai mil gayi! All five found' : `Chai ${n} of ${this.chai.length} · ${c.label}`, 2600);
        }
      }
    }
    // Feedback.
    this.impactCooldown -= dt;
    if (car.impact > 6 && this.impactCooldown <= 0) {
      this.impactCooldown = 0.4;
      this.audio.impact(car.impact);
      this.cam.kick(Math.min(1, car.impact / 25));
      car.impact = 0;
    }
    if (car.landing > 8) { this.cam.kick(Math.min(0.6, car.landing / 30)); car.landing = 0; }
    if (car.hover && !this.wasHover) { this.audio.kites(); if (this.mode !== 'watch') this.hud.toast('Kites up! Shift to climb, S to dive', 1600); }
    this.wasHover = car.hover;
    // Pit stop: pull up beside a food stall and the vendor tops up your boost.
    if (this.mode !== 'watch' && car.absSpeed < 2.5 && car.grounded) {
      let stall: { id: string; type: number } | null = null;
      this.world.tiles.stallsNear(car.x, car.z, 8, (id, sx, sz, type) => {
        if (Math.hypot(sx - car.x, sz - car.z) < 7.5 && (this.stallCooldown.get(id) ?? 0) < this.t) stall = { id, type };
      });
      if (stall) {
        this.stallTimer += dt;
        if (this.stallTimer > 0.8) {
          const s = stall as { id: string; type: number };
          const T = STALL_TYPES[s.type];
          this.stallTimer = 0;
          this.stallCooldown.set(s.id, this.t + 60);
          car.boost = 1;
          this.audio.collect();
          this.hud.toast(`${T.name} break · ₹${T.price} · boost refilled`, 2400);
        }
      } else this.stallTimer = 0;
    } else this.stallTimer = 0;

    // Driving into the Yamuna: a moment of shame, then back to the nearest road.
    if (car.surface === 'river' && car.grounded) {
      this.riverTime += dt;
      if (this.riverTime > 0.8 && this.mode !== 'watch') {
        this.riverTime = 0;
        this.recover();
        this.hud.toast('Yamuna mein nahi! Back on the road', 2200);
      }
    } else this.riverTime = 0;
    const inWater = (car.surface === 'water' || car.surface === 'river') && car.grounded;
    if (inWater && !this.wasWater && car.absSpeed > 5) { this.audio.splash(); this.hud.toast('Chhapaak!', 900); }
    this.wasWater = inWater;
    if (this.mode === 'watch' && race && race.phase === 'finished') {
      // Loop the demonstration.
      this.startWatch(race.course);
    }
  }

  private onRaceEvent(e: ReturnType<RaceSession['update']>[number]) {
    const race = this.race!;
    if (e.type === 'checkpoint') { this.audio.checkpoint(); this.activeProps?.setActiveGate(race.gateIndex); if (this.mode !== 'watch') this.hud.toast(`Checkpoint ${e.index} · ${formatTime(e.split)}`); }
    if (e.type === 'lap') { this.audio.checkpoint(); this.activeProps?.setActiveGate(0); this.hud.toast(`Lap ${e.lap} of ${race.course.laps}`); }
    if (e.type === 'wrongway') this.hud.show('wrong', e.on && this.mode !== 'watch');
    if (e.type === 'finish') {
      this.audio.finish();
      this.activeProps?.setActiveGate(race.course.gates.length);
      if (this.mode === 'race') {
        const prev = bestTime(race.course.id);
        const isBest = recordTime(race.course.id, e.time);
        this.hud.big('FINISH', formatTime(e.time));
        setTimeout(() => {
          if (this.mode !== 'race' || this.race !== race) return;
          this.hud.big('');
          this.ui.results({ course: race.course, time: e.time, best: isBest ? e.time : prev, isBest });
        }, 1600);
      }
      if (this.mode === 'mp') this.mp?.finished(e.time);
    }
  }

  private updateRig(dt: number) {
    const car = this.player, rig = this.rig!;
    rig.root.position.set(car.x, car.y, car.z);
    rig.root.rotation.y = car.yaw;
    // Attitude from the ground under the wheels.
    let pitch = 0, roll = 0;
    if (car.grounded) {
      const fx = car.forwardX, fz = car.forwardZ, rx = -fz, rz = fx;
      const S = this.world.surfaces;
      const hf = S.height(car.x + fx * 1.3, car.z + fz * 1.3, car.y + 0.5), hb = S.height(car.x - fx * 1.3, car.z - fz * 1.3, car.y + 0.5);
      const hr = S.height(car.x + rx * 0.8, car.z + rz * 0.8, car.y + 0.5), hl = S.height(car.x - rx * 0.8, car.z - rz * 0.8, car.y + 0.5);
      pitch = Math.atan2(hf - hb, 2.6);
      roll = Math.atan2(hr - hl, 1.6);
      roll += Math.max(-0.08, Math.min(0.08, car.yawRate * car.speed * 0.004));
      pitch -= Math.max(-0.05, Math.min(0.05, (this.lastInput.throttle - this.lastInput.brake) * 0.02));
    } else {
      pitch = Math.max(-0.35, Math.min(0.3, car.vy * 0.025));
      roll = -car.yawRate * 0.25;
    }
    car.pitch += (pitch - car.pitch) * Math.min(1, dt * 10);
    car.roll += (roll - car.roll) * Math.min(1, dt * 8);
    car.wheelSpin -= (car.speed * dt) / 0.36;
    car.steerVis += (this.lastInput.steer - car.steerVis) * Math.min(1, dt * 10);
    const bounce = car.surface === 'grass' && car.grounded ? Math.sin(this.t * 40) * 0.015 * Math.min(1, car.absSpeed / 10) : 0;
    animateRig(rig, { wheelSpin: car.wheelSpin, steerVis: car.steerVis, pitch: car.pitch, roll: car.roll, hover: car.hover }, dt, bounce);
  }

  private streetTimer = 0;
  private updateHUD(dt: number) {
    const hud = this.hud, car = this.player, race = this.race;
    const kmh = prefs.units === 'kmh';
    const v = Math.abs(car.speed) * (kmh ? 3.6 : 2.237);
    hud.set('speed', String(Math.round(v)));
    hud.set('unit', kmh ? 'KM/H' : 'MPH');
    const ms = Math.abs(car.speed);
    const gear = car.speed < -0.5 ? 'R' : ms < 0.5 ? 'N' : String([9, 17, 26, 35, 46, 999].findIndex((g) => ms < g) + 1);
    hud.set('gear', gear);
    (hud.r('boost') as HTMLElement).style.width = `${Math.round(car.boost * 100)}%`;
    hud.set('boosthint', car.hover ? 'SHIFT · LIFT' : 'SHIFT');

    if (race) {
      if (this.mode !== 'watch') {
        // Countdown 3-2-1, then GO! for the first moment of the race.
        const n = race.phase === 'countdown' ? Math.max(0, Math.ceil(race.countdown - 0.4)) : race.phase === 'racing' && race.elapsed < 0.8 ? 0 : -1;
        if (n !== this.lastCount) {
          this.lastCount = n;
          if (n > 0) { hud.big(String(n), `${race.course.name} · Kites fly above ${kmh ? '87 km/h' : '54 mph'}`); this.audio.countdown(false); }
          else if (n === 0) { hud.big('GO!'); this.audio.countdown(true); }
          else if (race.phase === 'racing') hud.big('');
        }
      }
      hud.set('time', formatTime(race.phase === 'countdown' ? 0 : race.phase === 'finished' ? race.finishTime : race.elapsed).replace('--:--.--', '00:00.00'));
      hud.set('best', formatTime(bestTime(race.course.id)));
      hud.set('cplabel', race.course.laps > 1 ? `Checkpoint · Lap ${Math.min(race.lap, race.course.laps)}/${race.course.laps}` : 'Checkpoint');
      hud.set('cp', `${race.gatesPassed} / ${race.totalGates}`);
      const nt = race.phase === 'racing' && this.mode !== 'watch' ? race.nextTurn() : null;
      hud.show('turn', !!nt);
      if (nt) {
        const sharp = nt.turn.angle > 100;
        hud.set('tarrow', nt.turn.dir === 'left' ? (sharp ? '⤺' : '↰') : sharp ? '⤻' : '↱');
        const dist = Math.round(nt.dist / 10) * 10;
        hud.set('tdist', dist < 15 ? 'NOW' : `IN ${dist} M · ${nt.turn.angle > 70 ? 'TURN' : 'BEAR'} ${nt.turn.dir.toUpperCase()}`);
        hud.set('tname', nt.turn.street);
        hud.r('turn').classList.toggle('brake', nt.turn.angle > 60 && nt.dist < car.absSpeed * 3.2 && car.absSpeed > 22);
      }
    } else {
      hud.set('time', formatTime(this.t0Free).replace('--:--.--', '00:00.00'));
      hud.set('best', '--:--.--');
      hud.set('cplabel', 'Chai found');
      hud.set('cp', `${this.chai.filter((c) => c.got).length} / ${this.chai.length}`);
      hud.show('turn', false);
    }

    // Street and district names.
    this.streetTimer -= dt;
    if (this.streetTimer <= 0) {
      this.streetTimer = 0.35;
      const n = this.world.roads.nearest(car.x, car.z, 25);
      const name = n ? this.map.roads[this.world.roads.segs[n.seg].road].n : '';
      let station = '';
      for (const st of this.map.stations ?? []) if (Math.hypot(st.x - car.x, st.z - car.z) < 140) { station = `${st.n} ${/rail|RRTS|Namo/i.test(st.t + st.n) ? 'station' : 'Metro'}`; break; }
      hud.set('street', name || station || (car.surface === 'grass' ? 'Off-road · Lawns' : car.surface === 'water' ? 'In the canal!' : car.surface === 'river' ? 'In the Yamuna!' : ''));
      hud.set('area', this.district(car.x, car.z));
    }

    // Minimap (about 15 fps is plenty).
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1 / 15;
      const across = 420 + Math.min(260, car.absSpeed * 6);
      this.mapCanvas.drawMini(hud.mini, car.x, car.z, car.yaw, across, (g, P) => {
        const c = this.course;
        if (c) {
          g.strokeStyle = 'rgba(232,84,47,0.9)'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
          g.beginPath();
          const from = race ? Math.max(0, race.hint - 10) : 0;
          for (let i = from; i < c.x.length; i += 3) { const [a, b] = P(c.x[i], c.z[i]); if (i === from) g.moveTo(a, b); else g.lineTo(a, b); }
          g.stroke();
          if (race && race.phase !== 'finished') {
            const gt = c.gates[race.gateIndex];
            const [a, b] = P(gt.x, gt.z);
            g.fillStyle = '#f5b829'; g.strokeStyle = '#0f3d4c'; g.lineWidth = 3;
            g.beginPath(); g.arc(a, b, 9, 0, Math.PI * 2); g.fill(); g.stroke();
          }
        }
        if (this.mode === 'free') {
          const W = hud.mini.width, H = hud.mini.height;
          let nearest: (typeof this.chai)[number] | null = null, nd = Infinity;
          for (const ch of this.chai) {
            if (ch.got) continue;
            const [a, b] = P(ch.x, ch.z);
            g.fillStyle = '#c0643a'; g.strokeStyle = '#fff'; g.lineWidth = 2;
            g.beginPath(); g.arc(a, b, 8, 0, Math.PI * 2); g.fill(); g.stroke();
            const d = Math.hypot(ch.x - car.x, ch.z - car.z);
            if (d < nd) { nd = d; nearest = ch; }
          }
          if (nearest) {
            // Edge arrow towards the nearest chai when it is off the map.
            const [a, b] = P(nearest.x, nearest.z);
            const cx = W / 2, cy = H * 0.58;
            if (a < 12 || b < 12 || a > W - 12 || b > H - 12) {
              const ang = Math.atan2(b - cy, a - cx);
              const r = Math.min(W, H) / 2 - 16;
              const ex = cx + Math.cos(ang) * r, ey = Math.min(H - 14, Math.max(14, cy + Math.sin(ang) * r));
              g.save(); g.translate(ex, ey); g.rotate(ang);
              g.fillStyle = '#c0643a'; g.strokeStyle = '#fff'; g.lineWidth = 2;
              g.beginPath(); g.moveTo(12, 0); g.lineTo(-8, -9); g.lineTo(-4, 0); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
              g.restore();
              g.fillStyle = '#0f3d4c'; g.font = 'bold 18px "DM Sans", sans-serif'; g.textAlign = 'center';
              g.fillText(`${(nd / 1000).toFixed(1)} km`, Math.min(W - 40, Math.max(40, ex)), Math.min(H - 30, Math.max(46, ey + (ey > cy ? -18 : 30))));
              g.textAlign = 'start';
            }
          }
        }
        g.fillStyle = 'rgba(40,40,40,0.55)';
        for (const tv of this.traffic.positions()) { const [a, b] = P(tv.x, tv.z); g.fillRect(a - 2.5, b - 2.5, 5, 5); }
        this.mp?.drawMini(g, P);
        // Player arrow (always points up).
        const [px, py] = P(car.x, car.z);
        g.fillStyle = '#0f3d4c'; g.strokeStyle = '#fff'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(px, py - 13); g.lineTo(px + 9, py + 9); g.lineTo(px, py + 4); g.lineTo(px - 9, py + 9); g.closePath(); g.stroke(); g.fill();
      });
    }
  }

  district(x: number, z: number) {
    const L = this.map.landmarks;
    const d = (k: string) => (L[k] ? Math.hypot(x - L[k][0], z - L[k][1]) : Infinity);
    if (d('cpCenter') < 480) return 'Connaught Place';
    if (terrainHeight(x, z) > 4) return 'Raisina Hill';
    if (d('indiaGate') < 420) return 'India Gate';
    if (x > L.vijayChowk[0] - 50 && x < L.indiaGate[0] && Math.abs(z - (L.vijayChowk[1] + (x - L.vijayChowk[0]) * 0.0523)) < 230) return 'Central Vista';
    const near: [string, string, number][] = [
      ['akshardham', 'Akshardham', 450], ['humayunTomb', 'Nizamuddin', 600], ['nizamuddinDargah', 'Nizamuddin', 500],
      ['laxmiNagar', 'Laxmi Nagar', 700], ['madhuVihar', 'Madhu Vihar', 600], ['patparganj', 'Patparganj · IP Extension', 750],
      ['preetVihar', 'Preet Vihar', 500], ['yamunaSports', 'Yamuna Sports Complex', 600], ['ito', 'ITO', 450],
      ['bharatMandapam', 'Pragati Maidan', 550], ['lodhiGarden', 'Lodhi Garden', 650], ['safdarjungTomb', 'Safdarjung', 500],
      ['teenMurti', 'Teen Murti', 400], ['nehruPark', 'Chanakyapuri', 900], ['chanakyapuri', 'Chanakyapuri', 1400],
      ['samratYantra', 'Jantar Mantar', 260], ['banglaSahib', 'Gole Market', 320], ['ndls', 'New Delhi Station', 500],
    ];
    let best = '', bd = Infinity;
    for (const [k, name, r] of near) { const dd = d(k); if (dd < r && dd / r < bd) { bd = dd / r; best = name; } }
    if (best) return best;
    if (x > 2900 && x < 4700) return 'Yamuna';
    if (x >= 4700) return z < -1500 ? 'Shahdara' : z > 1000 ? 'Mayur Vihar' : 'East Delhi';
    if (z < -1900) return x < 600 ? 'Paharganj' : 'Ajmeri Gate';
    return 'Lutyens\u2019 Delhi';
  }
}

export { savePrefs };
