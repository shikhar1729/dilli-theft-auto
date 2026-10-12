// Small 3D preview used in the driver and car pickers: the selected car and driver
// on a turntable in a Connaught Place-style colonnade.
import * as THREE from 'three';
import { buildCar, CarModelId, CarPaint, DecalId, VehicleRig } from './vehicles/models';
import { buildDriver, DriverProfile } from './vehicles/drivers';
import { toTexture } from './textures';

export class Showroom {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private turntable = new THREE.Group();
  private rig: VehicleRig | null = null;
  private driver: THREE.Group | null = null;
  private yaw = Math.PI + 0.5;
  private drag: { x: number; yaw: number } | null = null;
  private focus: 'driver' | 'car' = 'car';
  private running = false;
  private t = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.scene.background = new THREE.Color(0xe9dfc8);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x8a7a5c, 1.6));
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
    sun.position.set(-4, 7, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    (sun.shadow.camera as THREE.OrthographicCamera).left = -5;
    (sun.shadow.camera as THREE.OrthographicCamera).right = 5;
    (sun.shadow.camera as THREE.OrthographicCamera).top = 5;
    (sun.shadow.camera as THREE.OrthographicCamera).bottom = -5;
    this.scene.add(sun);
    this.buildSet();
    this.scene.add(this.turntable);
    canvas.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, yaw: this.yaw }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.drag) this.yaw = this.drag.yaw + (e.clientX - this.drag.x) * 0.01; });
    const end = () => { this.drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  private buildSet() {
    // Paving disc and a curved white colonnade behind, like Connaught Place's arcades.
    const paving = document.createElement('canvas');
    paving.width = paving.height = 256;
    const g = paving.getContext('2d')!;
    g.fillStyle = '#d9cbb4'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(120,90,60,0.25)'; g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 256); g.stroke(); g.beginPath(); g.moveTo(0, i * 32); g.lineTo(256, i * 32); g.stroke(); }
    const tex = toTexture(paving);
    tex.repeat.set(6, 6);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 48), new THREE.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, 0.12, 48), new THREE.MeshLambertMaterial({ color: 0xf2ece0 }));
    disc.position.y = 0.06;
    disc.receiveShadow = true;
    this.turntable.add(disc);
    const white = new THREE.MeshLambertMaterial({ color: 0xfbfaf5 });
    const shade = new THREE.MeshLambertMaterial({ color: 0x3a3631 });
    for (let i = -6; i <= 6; i++) {
      const a = i * 0.16 + Math.PI;
      const r = 11;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 4.2, 12), white);
      col.position.set(x, 2.1, z);
      this.scene.add(col);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.7, 4.2, 0.2), shade);
      back.position.set(Math.sin(a) * (r + 1.2), 2.1, Math.cos(a) * (r + 1.2));
      back.lookAt(0, 2.1, 0);
      this.scene.add(back);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(11.3, 0.5, 6, 64, 2.2), white);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = Math.PI / 2 - 1.1 + Math.PI;
    ring.position.y = 4.5;
    this.scene.add(ring);
  }

  private stool: THREE.Group | null = null;

  setup(model: CarModelId, paint: CarPaint, decal: DecalId, driver: DriverProfile, focus: 'driver' | 'car') {
    this.focus = focus;
    if (this.rig) { this.turntable.remove(this.rig.root); this.rig.dispose(); this.rig = null; }
    if (this.stool) { this.turntable.remove(this.stool); this.stool = null; }
    this.driver = buildDriver(driver, focus === 'driver');
    if (focus === 'driver') {
      // Portrait: the driver alone on a stool, no car in the way.
      const stool = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.12, 20), new THREE.MeshLambertMaterial({ color: 0x6b3b24 }));
      seat.position.y = 0.64;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.6, 10), new THREE.MeshLambertMaterial({ color: 0x3a3a3a }));
      leg.position.y = 0.3;
      stool.add(seat, leg);
      this.driver.position.set(0, 0.72, 0);
      stool.add(this.driver);
      stool.traverse((o) => { o.castShadow = true; });
      this.turntable.add(stool);
      this.stool = stool;
    } else {
      this.rig = buildCar(model, paint, decal);
      this.rig.root.position.y = 0.12;
      this.turntable.add(this.rig.root);
      this.rig.driverSlot.add(this.driver);
    }
    this.resize();
  }
  setPaint(p: CarPaint) { this.rig?.setPaint(p); }
  setDecal(d: DecalId) { this.rig?.setDecal(d); }

  resize() {
    const w = this.canvas.clientWidth || 600, h = this.canvas.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.t += dt;
      if (this.focus === 'driver') {
        // Portrait: keep the face toward the camera with a gentle sway.
        if (!this.drag) this.yaw += (Math.PI + Math.sin(this.t * 0.6) * 0.35 - this.yaw) * Math.min(1, dt * 2);
      } else if (!this.drag) this.yaw += dt * 0.25;
      this.turntable.rotation.y = this.yaw;
      this.turntable.updateMatrixWorld(true);
      if (this.focus === 'driver' && this.driver) {
        const head = new THREE.Vector3();
        (this.driver?.userData.head as THREE.Object3D | undefined)?.getWorldPosition(head);
        // Camera sits in front of the car (cars face local -Z) at head height.
        // The name tag covers the lower third of the preview, so frame the face high.
        this.camera.position.set(0, head.y + 0.02, 2.9);
        this.camera.lookAt(0, head.y - 0.3, 0);
        this.camera.fov = 24;
      } else {
        this.camera.position.set(0, 2.6, 8.6);
        this.camera.lookAt(0, 0.8, 0);
        this.camera.fov = 32;
      }
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; }
}
