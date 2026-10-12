// Keyboard, touch and gamepad input merged into one CarInput.
import type { CarInput } from './physics';

export type Action = 'recover' | 'restart' | 'pause' | 'camera' | 'mute' | 'horn' | 'confirm';

export class Input {
  private keys = new Set<string>();
  private actions = new Set<Action>();
  private steer = 0;
  touch = { left: false, right: false, gas: false, brake: false, boost: false, drift: false };
  autoAccelerate = false;
  enabled = true;
  hornHeld = false;
  private padPrev: boolean[] = [];

  constructor() {
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
      if (!e.repeat) {
        if (k === 'KeyQ') this.actions.add('recover');
        if (k === 'KeyR') this.actions.add('restart');
        if (k === 'Escape' || k === 'KeyP') this.actions.add('pause');
        if (k === 'KeyC') this.actions.add('camera');
        if (k === 'KeyM') this.actions.add('mute');
        if (k === 'KeyH') this.actions.add('horn');
        if (k === 'Enter') this.actions.add('confirm');
      }
      this.keys.add(k);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  consume(a: Action) {
    const had = this.actions.has(a);
    this.actions.delete(a);
    return had;
  }
  trigger(a: Action) { this.actions.add(a); }
  clearActions() { this.actions.clear(); }

  private down(...codes: string[]) { return codes.some((c) => this.keys.has(c)); }

  read(dt: number, allowAuto = true): CarInput {
    if (!this.enabled) { this.steer = 0; return { throttle: 0, brake: 0, steer: 0, boost: false, drift: false }; }
    const T = this.touch;
    const left = this.down('KeyA', 'ArrowLeft') || T.left;
    const right = this.down('KeyD', 'ArrowRight') || T.right;
    let throttle = this.down('KeyW', 'ArrowUp') || T.gas ? 1 : 0;
    let brake = this.down('KeyS', 'ArrowDown') || T.brake ? 1 : 0;
    let boost = this.down('ShiftLeft', 'ShiftRight') || T.boost;
    let drift = this.down('Space') || T.drift;
    this.hornHeld = this.down('KeyH');

    // Keyboard steering ramps so taps make small corrections.
    const target = (left ? 1 : 0) - (right ? 1 : 0);
    const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(this.steer) ? 9 : 4.2;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));
    let steer = this.steer;

    // Gamepad (standard mapping).
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) steer = -Math.sign(ax) * Math.min(1, (Math.abs(ax) - 0.12) / 0.8);
      const b = (i: number) => p.buttons[i]?.value ?? 0;
      throttle = Math.max(throttle, b(7), b(0) > 0.5 ? 1 : 0);
      brake = Math.max(brake, b(6));
      if (b(1) > 0.5) drift = true;
      if (b(2) > 0.5 || b(5) > 0.5) boost = true;
      const edge = (i: number, a: Action) => { const on = b(i) > 0.5; if (on && !this.padPrev[i]) this.actions.add(a); this.padPrev[i] = on; };
      edge(3, 'recover'); edge(9, 'pause'); edge(8, 'restart'); edge(4, 'camera'); edge(12, 'horn');
      break;
    }
    if (allowAuto && this.autoAccelerate && brake === 0) throttle = Math.max(throttle, 1);
    return { throttle, brake, steer, boost, drift };
  }
}
