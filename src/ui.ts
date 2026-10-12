// DOM user interface: loading, landing page, race flow (play → driver → car),
// pause, results, how-to-play, race picker, leaderboard and the in-race HUD.
import { DRIVERS } from './vehicles/drivers';
import { CAR_MODELS, DECALS, CarModelId, DecalId } from './vehicles/models';
import { prefs, savePrefs, bestTime, resetBest, IS_TOUCH, Graphics } from './store';
import { formatTime } from './race';
import type { Course } from './race';
import { Showroom } from './showroom';

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface UIHandlers {
  startSolo(): void;
  createRoom(): void;
  joinRoom(code: string): void;
  explore(): void;
  watch(): void;
  resume(): void;
  restart(): void;
  quit(): void;
  toggleMute(): void;
  settingsChanged(): void;
  courseChanged(): void;
  leaderboard(course: string): Promise<{ name: string; time: number; driver: string; car: string }[] | null>;
  submitScore(course: string, time: number): Promise<boolean>;
}

const brandHTML = (dark = false) => `<div class="brand"><div class="mark"${dark ? ' style="color:var(--teal);text-shadow:none"' : ''}>DTA</div><div class="name"${dark ? ' style="color:var(--teal);border-color:rgba(15,61,76,.25)"' : ''}>DILLI THEFT<br>AUTO</div></div>`;

export class UI {
  readonly root = document.getElementById('ui')!;
  private loadingEl: HTMLElement | null = null;
  private landingEl: HTMLElement | null = null;
  private modalEl: HTMLElement | null = null;
  private showroom: Showroom | null = null;
  postcards = new Map<string, () => HTMLCanvasElement>();
  courses: Course[] = [];
  h!: UIHandlers;
  /** False on static hosting (e.g. GitHub Pages): no rooms or global leaderboard there. */
  serverAvailable = false;

  // ------------------------------------------------------------------ loading
  loading(msg: string, frac: number) {
    if (!this.loadingEl) {
      this.loadingEl = el(`<div class="loading"><div class="inner"><div class="logo">DTA</div><div class="logo-bar"></div><div class="msg"></div><div class="bar"><i></i></div></div></div>`);
      this.root.appendChild(this.loadingEl);
    }
    $(this.loadingEl, '.msg').textContent = msg;
    $(this.loadingEl, '.bar i').style.width = `${Math.round(frac * 100)}%`;
  }
  loadingError(msg: string) {
    this.loading('Something went wrong', 1);
    const e = el(`<div class="err"></div>`);
    e.textContent = msg;
    $(this.loadingEl!, '.inner').appendChild(e);
  }
  hideLoading() {
    const l = this.loadingEl;
    if (!l) return;
    l.style.opacity = '0';
    setTimeout(() => l.remove(), 500);
    this.loadingEl = null;
  }

  // ------------------------------------------------------------------ landing
  showLanding() {
    this.hideLanding();
    const c = this.course();
    const best = bestTime(c.id);
    const L = el(`
      <div class="landing">
        <div class="topbar">
          ${brandHTML()}
          <div class="top-actions">
            <span><i class="dot"></i>Solo</span><span>/</span><span>Race with friends</span>
            <button class="icon-btn" data-a="mute" aria-label="Toggle sound">${prefs.muted ? '🔇' : '🔊'}</button>
          </div>
        </div>
        <div class="hero">
          <div class="kicker">New Delhi / Online arcade</div>
          <h1 class="title"><span>DILLI</span><span class="y">THEFT</span><span>AUTO</span></h1>
          <p class="tagline">Race Delhi. Bring your friends.<br>Pick your driver, dodge the autos, and race to India Gate.</p>
          <div class="cta-row">
            <button class="cta" data-a="start">Start race <span>↗</span></button>
            <button class="link" data-a="howto">How to play</button>
            <button class="link" data-a="courses">Choose a race</button>
          </div>
          <div class="sub-links">
            <button class="link" data-a="leaderboard">Global leaderboard ↗</button>
          </div>
          <div class="sub-links" style="margin-top:10px">
            <button class="link" data-a="explore">Explore Delhi ↗</button>
            <button class="link" data-a="watch">Watch a run ↗</button>
          </div>
        </div>
        <div class="postcard" data-a="courses">
          <div class="meta">
            <div class="num">0${this.courses.indexOf(c) + 1}</div>
            <div><small>Postcard of</small><b>${esc(c.name)}</b><small>${(c.length * c.laps / 1000).toFixed(1)} km · ${c.ramps.length} kite jumps${best ? ` · best ${formatTime(best)}` : ''}</small></div>
            <small>Explore the city ↗</small>
          </div>
          <div class="pc-canvas"></div>
        </div>
        <div class="caption">New Delhi, reimagined<br><span>${esc(c.blurb)}</span></div>
      </div>`);
    const pc = this.postcards.get(c.id)?.();
    if (pc) $(L, '.pc-canvas').appendChild(pc);
    L.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      if (a === 'start') this.raceFlow('play');
      if (a === 'howto') this.howTo();
      if (a === 'courses') this.chooseRace();
      if (a === 'leaderboard') this.leaderboard();
      if (a === 'explore') { this.hideLanding(); this.h.explore(); }
      if (a === 'watch') { this.hideLanding(); this.h.watch(); }
      if (a === 'mute') { this.h.toggleMute(); (e.target as HTMLElement).textContent = prefs.muted ? '🔇' : '🔊'; }
    });
    this.root.appendChild(L);
    this.landingEl = L;
  }
  hideLanding() { this.landingEl?.remove(); this.landingEl = null; }
  get landingVisible() { return !!this.landingEl; }

  course() { return this.courses.find((c) => c.id === prefs.course) ?? this.courses[0]; }

  // ------------------------------------------------------------------ modal shell
  private openModal(inner: HTMLElement, cls = '') {
    this.closeModal();
    const wrap = el(`<div class="modal-wrap"><div class="modal ${cls}"></div></div>`);
    $(wrap, '.modal').appendChild(inner);
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap && cls) this.closeModal(); });
    this.root.appendChild(wrap);
    this.modalEl = wrap;
    return wrap;
  }
  closeModal() {
    this.showroom?.stop();
    this.modalEl?.remove();
    this.modalEl = null;
  }
  get modalOpen() { return !!this.modalEl; }

  private head(steps: string[] | null, active: number, title = '') {
    return `<div class="m-head">${brandHTML(true)}${steps ? `<div class="steps">${steps.map((s, i) => `<span class="${i === active ? 'on' : ''}"><i>0${i + 1}</i>${s}</span>`).join('')}</div>` : `<div class="eyebrow">${title}</div>`}<button class="close" data-a="close" aria-label="Close">✕</button></div>`;
  }

  // ------------------------------------------------------------------ race flow
  raceFlow(step: 'play' | 'driver' | 'car', mode: 'solo' | 'multi' = 'solo') {
    const steps = ['Play', 'Driver', 'Car'];
    const c = this.course();
    const footer = `<div class="m-foot"><span>${esc(c.name)} / New Delhi</span><span>Single player / Multiplayer</span></div>`;
    let body = '';
    if (step === 'play') {
      body = `
        <div class="m-body">
          <div class="eyebrow">New Delhi</div>
          <div class="h1">How are we racing?</div>
          <p class="lede">One city. Your kind of race.</p>
          <div class="choice-row">
            <button class="choice" data-a="solo"><div><small>01</small><b>Single player</b><p>Chase your best time.</p></div><span class="arrow">↗</span></button>
            <button class="choice green" data-a="multi" ${this.serverAvailable ? '' : 'style="opacity:.6"'}><div><small>02—08</small><b>Multiplayer</b><p>${this.serverAvailable ? 'Create a room. Invite your friends. Race together.' : 'Rooms need the game server. This web version is single player: run the game locally with <code>npm start</code> to race friends.'}</p></div><span class="arrow">${this.serverAvailable ? '↗' : '⌁'}</span></button>
          </div>
          ${this.serverAvailable ? '<div class="join"><input class="input" maxlength="6" placeholder="ROOM CODE" style="width:130px;text-transform:uppercase"><button class="btn ghost" data-a="join">Join with a code →</button></div>' : ''}
          <div class="note">${esc(c.name)} · Equal cars · No car-to-car contact</div>
        </div>`;
    } else if (step === 'driver') {
      body = `
        <div class="m-body">
          <div class="eyebrow">New Delhi</div>
          <div class="h1">Choose your driver</div>
          <div class="picker" style="margin-top:14px">
            <div class="preview"><canvas></canvas><div class="drag">Drag to look around</div><div class="tag"><small class="idx"></small><div><b class="dn"></b><span class="dl"></span></div></div></div>
            <div><div class="eyebrow" style="margin-bottom:10px">The lineup</div><div class="lineup">${DRIVERS.map((d, i) => `<button class="racer ${d.id === prefs.driver ? 'on' : ''}" data-driver="${d.id}"><span class="chip" style="background:${d.color}">0${i + 1}</span><b>${esc(d.name)}</b></button>`).join('')}</div>
              <div class="note">Original characters · Equal driving performance</div>
              <div style="margin-top:22px;display:flex;justify-content:space-between;align-items:center"><button class="link" data-a="back" style="color:var(--teal)">← Back</button><button class="btn" data-a="next">Choose car →</button></div>
            </div>
          </div>
        </div>`;
    } else {
      body = `
        <div class="m-body">
          <div class="eyebrow">New Delhi</div>
          <div class="h1">Choose your ride</div>
          <div class="picker" style="margin-top:14px">
            <div class="preview"><canvas></canvas><div class="drag">Drag to look around</div><div class="tag"><div><b class="cn"></b><span class="ct"></span></div></div></div>
            <div class="opts">
              <div><div class="eyebrow">Car</div><div class="opt-row models">${CAR_MODELS.map((m) => `<button class="pill ${m.id === prefs.car ? 'on' : ''}" data-model="${m.id}">${esc(m.name)}</button>`).join('')}</div></div>
              <div><div class="eyebrow">Paint</div><div class="opt-row paints"></div></div>
              <div><div class="eyebrow">Decal · optional</div><div class="opt-row">${DECALS.map((d) => `<button class="pill ${d.id === prefs.decal ? 'on' : ''}" data-decal="${d.id}">${esc(d.name)}</button>`).join('')}</div></div>
              ${mode === 'solo' ? `<div><div class="eyebrow">Race</div><div class="opt-row">${this.courses.map((co) => `<button class="pill course-pill ${co.id === prefs.course ? 'on' : ''}" data-course="${co.id}">${esc(co.name)}<small>${(co.length * co.laps / 1000).toFixed(1)} km${bestTime(co.id) ? ' · PB ' + formatTime(bestTime(co.id)) : ''}</small></button>`).join('')}</div></div>` : ''}
              <div><div class="eyebrow">Your name</div><input class="input nickname" maxlength="16" placeholder="Nickname" value="${esc(prefs.name)}" style="width:220px"></div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><button class="link" data-a="back" style="color:var(--teal)">← Back</button><button class="btn" data-a="go">${mode === 'solo' ? 'Start race ↗' : this.flowMode === 'join' ? `Join room ${esc(this.joinCode)} ↗` : 'Create room ↗'}</button></div>
            </div>
          </div>
        </div>`;
    }
    const inner = el(`<div style="display:contents">${this.head(steps, ['play', 'driver', 'car'].indexOf(step))}${body}${footer}</div>`);
    const wrap = this.openModal(inner);
    const canvas = wrap.querySelector('canvas');
    if (canvas) {
      this.showroom ??= new Showroom(document.createElement('canvas'));
      // Reuse one WebGL context: move the showroom canvas into the preview.
      const sc = this.showroom.canvas;
      canvas.replaceWith(sc);
      this.refreshShowroom(step === 'driver' ? 'driver' : 'car', wrap);
      requestAnimationFrame(() => { this.showroom!.resize(); this.showroom!.start(); });
    }
    if (step === 'car') this.renderPaints(wrap);

    wrap.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!t) return;
      const a = t.dataset.a;
      if (a === 'close') { this.closeModal(); if (!this.landingEl && this.h && this.flowMode === 'join') { this.flowMode = ''; this.h.quit(); } }
      if (a === 'solo') this.raceFlow('driver', 'solo');
      if (a === 'multi') { if (!this.serverAvailable) return; this.flowMode = ''; this.raceFlow('driver', 'multi'); }
      if (a === 'join') {
        const code = ($(wrap, '.join input') as HTMLInputElement).value.trim().toUpperCase();
        if (code.length >= 4) { this.flowMode = 'join'; this.joinCode = code; this.raceFlow('driver', 'multi'); }
      }
      if (a === 'back') this.raceFlow(step === 'car' ? 'driver' : 'play', mode);
      if (a === 'next') this.raceFlow('car', mode);
      if (a === 'go') {
        const name = ($(wrap, 'input.nickname') as HTMLInputElement).value.trim().slice(0, 16);
        prefs.name = name; savePrefs();
        this.closeModal();
        if (mode === 'solo') this.h.startSolo();
        else if (this.flowMode === 'join') { this.flowMode = ''; this.h.joinRoom(this.joinCode); }
        else this.h.createRoom();
      }
      if (t.dataset.driver) {
        prefs.driver = t.dataset.driver; savePrefs();
        wrap.querySelectorAll('[data-driver]').forEach((b) => b.classList.toggle('on', b === t));
        this.refreshShowroom('driver', wrap);
      }
      if (t.dataset.model) {
        prefs.car = t.dataset.model as CarModelId;
        prefs.paint = CAR_MODELS.find((m) => m.id === prefs.car)!.paints[0].id;
        savePrefs();
        wrap.querySelectorAll('[data-model]').forEach((b) => b.classList.toggle('on', b === t));
        this.renderPaints(wrap);
        this.refreshShowroom('car', wrap);
      }
      if (t.dataset.paint) {
        prefs.paint = t.dataset.paint; savePrefs();
        wrap.querySelectorAll('[data-paint]').forEach((b) => b.classList.toggle('on', b === t));
        this.refreshShowroom('car', wrap);
      }
      if (t.dataset.decal) {
        prefs.decal = t.dataset.decal as DecalId; savePrefs();
        wrap.querySelectorAll('[data-decal]').forEach((b) => b.classList.toggle('on', b === t));
        this.showroom?.setDecal(prefs.decal);
      }
      if (t.dataset.course) {
        prefs.course = t.dataset.course; savePrefs();
        wrap.querySelectorAll('[data-course]').forEach((b) => b.classList.toggle('on', b === t));
        this.h.courseChanged();
      }
    });
  }
  private flowMode = '';
  private joinCode = '';
  startJoinFlow(code: string) { this.flowMode = 'join'; this.joinCode = code; this.raceFlow('driver', 'multi'); }

  private renderPaints(wrap: HTMLElement) {
    const m = CAR_MODELS.find((x) => x.id === prefs.car)!;
    $(wrap, '.paints').innerHTML = m.paints.map((p) => `<button class="pill ${p.id === prefs.paint ? 'on' : ''}" data-paint="${p.id}"><span class="sw" style="background:linear-gradient(135deg, ${p.body} 55%, ${p.accent} 55%)"></span>${esc(p.name)}</button>`).join('');
  }

  private refreshShowroom(focus: 'driver' | 'car', wrap: HTMLElement) {
    const d = DRIVERS.find((x) => x.id === prefs.driver) ?? DRIVERS[0];
    const m = CAR_MODELS.find((x) => x.id === prefs.car) ?? CAR_MODELS[0];
    const p = m.paints.find((x) => x.id === prefs.paint) ?? m.paints[0];
    this.showroom?.setup(m.id, p, prefs.decal, d, focus);
    const dn = wrap.querySelector('.dn'); if (dn) dn.textContent = d.name;
    const dl = wrap.querySelector('.dl'); if (dl) dl.textContent = d.line;
    const idx = wrap.querySelector('.idx'); if (idx) idx.textContent = `0${DRIVERS.indexOf(d) + 1} / 0${DRIVERS.length}`;
    const cn = wrap.querySelector('.cn'); if (cn) cn.textContent = `${m.name} · ${p.name}`;
    const ct = wrap.querySelector('.ct'); if (ct) ct.textContent = `${m.tag} · Equal performance`;
  }

  // ------------------------------------------------------------------ race picker
  chooseRace() {
    const inner = el(`<div style="display:contents">${this.head(null, 0, 'Choose a race')}
      <div class="m-body"><div class="h1">Choose a race</div><p class="lede">Every route follows real Delhi streets, from Lutyens\u2019 Delhi and Chanakyapuri to Laxmi Nagar and Patparganj across the Yamuna.</p>
      <div class="cards">${this.courses.map((c, i) => `<button class="card ${c.id === prefs.course ? 'on' : ''}" data-course="${c.id}"><div class="pc"></div><div class="c-body"><small class="eyebrow">0${i + 1} · ${esc(c.region)}${c.laps > 1 ? ` · ${c.laps} laps` : ''}</small><br><b>${esc(c.name)}</b><p>${esc(c.blurb)}</p><div class="stats"><span>${(c.length * c.laps / 1000).toFixed(1)} km</span><span>${c.ramps.length} kite jumps</span><span>${bestTime(c.id) ? 'PB ' + formatTime(bestTime(c.id)) : 'No time yet'}</span></div></div></button>`).join('')}</div>
      </div><div class="m-foot"><span>Map data © OpenStreetMap contributors · Buildings: Overture Maps (Google, Microsoft)</span><span>Tap a postcard to select</span></div></div>`);
    const wrap = this.openModal(inner, 'medium');
    wrap.querySelectorAll<HTMLElement>('[data-course]').forEach((b) => {
      const pc = this.postcards.get(b.dataset.course!)?.();
      if (pc) b.querySelector('.pc')!.appendChild(pc);
    });
    wrap.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!t) return;
      if (t.dataset.a === 'close') this.closeModal();
      if (t.dataset.course) {
        prefs.course = t.dataset.course; savePrefs();
        this.h.courseChanged();
        this.closeModal();
        if (this.landingEl) this.showLanding();
      }
    });
  }

  // ------------------------------------------------------------------ how to play + settings
  howTo(fromPause = false) {
    const inner = el(`<div style="display:contents">${this.head(null, 0, 'How to play')}
      <div class="m-body">
        <div class="h1">How to play</div>
        <p class="lede">Race through checkpoints in order. Hit the yellow ramps above ${prefs.units === 'kmh' ? '87 km/h' : '54 mph'} and your kites open — glide, and grab marigold rings to refill boost.</p>
        <table class="controls">
          <tr><td>Accelerate</td><td><kbd>W</kbd><kbd>↑</kbd></td></tr>
          <tr><td>Steer</td><td><kbd>A</kbd><kbd>D</kbd> or <kbd>←</kbd><kbd>→</kbd></td></tr>
          <tr><td>Brake / reverse · dive in flight</td><td><kbd>S</kbd><kbd>↓</kbd></td></tr>
          <tr><td>Boost · lift in flight</td><td><kbd>Shift</kbd></td></tr>
          <tr><td>Drift</td><td><kbd>Space</kbd></td></tr>
          <tr><td>Horn (essential in Delhi)</td><td><kbd>H</kbd></td></tr>
          <tr><td>Change camera</td><td><kbd>C</kbd></td></tr>
          <tr><td>Recover to the road</td><td><kbd>Q</kbd></td></tr>
          <tr><td>Restart · Pause · Mute</td><td><kbd>R</kbd> <kbd>Esc</kbd> <kbd>M</kbd></td></tr>
          <tr><td>Gamepad</td><td>RT gas · LT brake · B drift · X/RB boost · Y recover</td></tr>
        </table>
        <div class="settings">
          <div class="setting"><span>Auto-accelerate in races</span><button class="pill ${prefs.autoAccel ? 'on' : ''}" data-set="auto">${prefs.autoAccel ? 'On' : 'Off'}</button></div>
          <div class="setting"><span>Graphics</span><span class="opt-row">${(['low', 'medium', 'high'] as Graphics[]).map((g) => `<button class="pill ${prefs.graphics === g ? 'on' : ''}" data-gfx="${g}">${g}</button>`).join('')}</span></div>
          <div class="setting"><span>Speed units</span><span class="opt-row"><button class="pill ${prefs.units === 'kmh' ? 'on' : ''}" data-units="kmh">km/h</button><button class="pill ${prefs.units === 'mph' ? 'on' : ''}" data-units="mph">mph</button></span></div>
          <div class="setting"><span>Fullscreen</span><button class="pill" data-set="fs">Toggle</button></div>
          <div class="setting"><span>Best time for ${esc(this.course().name)}: <b>${formatTime(bestTime(this.course().id))}</b></span><button class="pill" data-set="reset">Reset best</button></div>
        </div>
      </div>
      <div class="m-foot"><span>Map data © OpenStreetMap contributors (ODbL) · Buildings: Overture Maps</span><span>${fromPause ? '<button class="btn dark" data-a="back">Back</button>' : 'Equal cars for everyone'}</span></div></div>`);
    const wrap = this.openModal(inner, 'medium');
    wrap.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!t) return;
      if (t.dataset.a === 'close' || t.dataset.a === 'back') { this.closeModal(); if (fromPause) this.pause(); return; }
      if (t.dataset.set === 'auto') { prefs.autoAccel = !prefs.autoAccel; t.textContent = prefs.autoAccel ? 'On' : 'Off'; t.classList.toggle('on', prefs.autoAccel); }
      if (t.dataset.set === 'fs') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); }
      if (t.dataset.set === 'reset') { resetBest(this.course().id); t.textContent = 'Reset'; }
      if (t.dataset.gfx) { prefs.graphics = t.dataset.gfx as Graphics; wrap.querySelectorAll('[data-gfx]').forEach((b) => b.classList.toggle('on', b === t)); }
      if (t.dataset.units) { prefs.units = t.dataset.units as 'kmh' | 'mph'; wrap.querySelectorAll('[data-units]').forEach((b) => b.classList.toggle('on', b === t)); }
      savePrefs();
      this.h.settingsChanged();
    });
  }

  // ------------------------------------------------------------------ leaderboard
  async leaderboard(courseId = prefs.course) {
    const inner = el(`<div style="display:contents">${this.head(null, 0, 'Global leaderboard')}
      <div class="m-body"><div class="h1">Global leaderboard</div>
      <div class="opt-row" style="margin-bottom:16px">${this.courses.map((c) => `<button class="pill ${c.id === courseId ? 'on' : ''}" data-course="${c.id}">${esc(c.name)}</button>`).join('')}</div>
      <ol class="lb-list"><li style="grid-template-columns:1fr">Loading…</li></ol></div>
      <div class="m-foot"><span>Solo runs only · Fastest per name</span><span>Your best: ${formatTime(bestTime(courseId))}</span></div></div>`);
    const wrap = this.openModal(inner, 'small');
    wrap.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!t) return;
      if (t.dataset.a === 'close') this.closeModal();
      if (t.dataset.course) this.leaderboard(t.dataset.course);
    });
    const rows = await this.h.leaderboard(courseId);
    const list = wrap.querySelector('.lb-list');
    if (!list) return;
    if (!rows) { list.innerHTML = `<li style="grid-template-columns:1fr;display:block">The global leaderboard needs the game server (<code>npm start</code>). Your personal best is still saved on this device.</li>`; return; }
    if (!rows.length) { list.innerHTML = `<li style="grid-template-columns:1fr;display:block">No times yet. Be the first!</li>`; return; }
    list.innerHTML = rows.map((r) => {
      const d = DRIVERS.find((x) => x.id === r.driver);
      return `<li class="${r.name === prefs.name ? 'me' : ''}"><div><b>${esc(r.name)}</b><small>${esc(d?.name ?? '')} · ${esc(CAR_MODELS.find((m) => m.id === r.car)?.name ?? '')}</small></div><span>${formatTime(r.time)}</span></li>`;
    }).join('');
  }

  // ------------------------------------------------------------------ pause / results
  pause(multi = false) {
    const inner = el(`<div style="display:contents">${this.head(null, 0, multi ? 'Room' : 'Paused')}
      <div class="m-body" style="display:grid;gap:12px">
        <div class="h1">${multi ? 'Race in progress' : 'Paused'}</div>
        ${multi ? '<p class="lede">The shared race keeps running while this menu is open.</p>' : ''}
        <button class="btn" data-a="resume">Resume</button>
        ${multi ? '' : '<button class="btn ghost" data-a="restart">Restart race</button>'}
        <button class="btn ghost" data-a="howto">How to play &amp; settings</button>
        <button class="btn ghost" data-a="quit">${multi ? 'Leave room' : 'Quit to menu'}</button>
      </div></div>`);
    const wrap = this.openModal(inner, 'small');
    wrap.addEventListener('click', (e) => {
      const a = ((e.target as HTMLElement).closest('button') as HTMLButtonElement | null)?.dataset.a;
      if (!a) return;
      if (a === 'close' || a === 'resume') { this.closeModal(); this.h.resume(); }
      if (a === 'restart') { this.closeModal(); this.h.restart(); }
      if (a === 'howto') this.howTo(true);
      if (a === 'quit') { this.closeModal(); this.h.quit(); }
    });
  }

  results(o: { course: Course; time: number; best: number; isBest: boolean; standings?: { name: string; time: number | null; you: boolean; color: string }[]; host?: boolean; multi?: boolean; onRematch?: () => void }) {
    const st = o.standings;
    const inner = el(`<div style="display:contents">${this.head(null, 0, o.multi ? 'Results' : 'Finished')}
      <div class="m-body">
        <div class="eyebrow">${esc(o.course.name)}</div>
        <div class="result-time">${formatTime(o.time)}</div>
        <div style="margin:10px 0 18px">${o.isBest ? '<span class="badge">New personal best</span>' : `<span class="eyebrow">Personal best ${formatTime(o.best)}</span>`}</div>
        ${st ? `<ol class="lb-list standings">${st.map((s) => `<li class="${s.you ? 'me' : ''}"><div><b><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${s.color};margin-right:6px"></i>${esc(s.name)}</b></div><span>${s.time ? formatTime(s.time) : 'DNF'}</span></li>`).join('')}</ol>` : ''}
        ${!o.multi ? `<div class="join" style="margin-top:6px"><input class="input lbname" maxlength="16" placeholder="Nickname" value="${esc(prefs.name)}" style="width:180px"><button class="btn ghost" data-a="submit">Post to leaderboard</button><span class="lbmsg note"></span></div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:22px">
          ${o.multi ? (o.host ? '<button class="btn" data-a="rematch">Rematch</button>' : '<span class="note">Waiting for the host to start a rematch…</span>') : '<button class="btn" data-a="again">Race again</button>'}
          ${!o.multi ? '<button class="btn ghost" data-a="courses">Choose race</button>' : ''}
          <button class="btn ghost" data-a="menu">${o.multi ? 'Leave room' : 'Menu'}</button>
        </div>
      </div></div>`);
    const wrap = this.openModal(inner, 'small');
    wrap.addEventListener('click', async (e) => {
      const a = ((e.target as HTMLElement).closest('button') as HTMLButtonElement | null)?.dataset.a;
      if (!a) return;
      if (a === 'close' || a === 'menu') { this.closeModal(); this.h.quit(); }
      if (a === 'again') { this.closeModal(); this.h.restart(); }
      if (a === 'rematch') { this.closeModal(); o.onRematch?.(); }
      if (a === 'courses') { this.h.quit(); this.chooseRace(); }
      if (a === 'submit') {
        const n = ($(wrap, '.lbname') as HTMLInputElement).value.trim().slice(0, 16);
        const msg = $(wrap, '.lbmsg');
        if (!n) { msg.textContent = 'Add a nickname first.'; return; }
        prefs.name = n; savePrefs();
        msg.textContent = 'Posting…';
        const ok = await this.h.submitScore(o.course.id, o.time);
        msg.textContent = ok ? 'Posted!' : 'Leaderboard offline — saved locally.';
      }
    });
  }

  toastMessage(text: string, ms = 1800) { this.hud?.toast(text, ms); }
  hud: HUD | null = null;
}

// ------------------------------------------------------------------ HUD

export class HUD {
  readonly el: HTMLElement;
  readonly mini: HTMLCanvasElement;
  private toastTimer = 0;
  private refs: Record<string, HTMLElement> = {};
  onButton: (a: string) => void = () => {};
  touchEl: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.el = el(`
      <div class="hud">
        ${brandHTML()}
        <div class="timer"><div><small>Your time</small><b data-r="time">00:00.00</b></div><div><small>Personal best</small><b data-r="best">--:--.--</b></div><div data-r="cpwrap"><small data-r="cplabel">Checkpoint</small><b data-r="cp">0 / 0</b></div></div>
        <div class="hud-btns interactive"><button class="icon-btn" data-a="mute" aria-label="Sound">🔊</button><button class="icon-btn" data-a="pause" aria-label="Pause">❚❚</button></div>
        <div class="mini"><canvas width="340" height="340"></canvas><div class="street" data-r="street"></div><div class="area" data-r="area"></div></div>
        <div class="speedo"><div class="gear">GEAR <b data-r="gear">N</b></div><div class="v" data-r="speed">0</div><div class="unit" data-r="unit">KM/H</div><div class="boost"><i data-r="boost"></i></div><div class="boost-label"><span>BOOST</span><span data-r="boosthint">SHIFT</span></div></div>
        <div class="turn hidden" data-r="turn"><div class="arrow" data-r="tarrow">↱</div><div><small data-r="tdist">IN 200 M</small><b data-r="tname">Kartavya Path</b></div></div>
        <div class="center-big hidden" data-r="big"></div>
        <div class="toast hidden" data-r="toast"></div>
        <div class="wrongway hidden" data-r="wrong">WRONG WAY</div>
        <div class="scenic interactive hidden" data-r="scenic"></div>
        <div class="players-live hidden" data-r="players"></div>
      </div>`);
    this.el.querySelectorAll<HTMLElement>('[data-r]').forEach((n) => (this.refs[n.dataset.r!] = n));
    this.mini = this.el.querySelector('.mini canvas') as HTMLCanvasElement;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (b?.dataset.a) this.onButton(b.dataset.a);
      if (b?.dataset.stop) this.onButton('stop:' + b.dataset.stop);
    });
    root.appendChild(this.el);
    if (IS_TOUCH) this.buildTouch(root);
  }

  r(k: string) { return this.refs[k]; }
  set(k: string, text: string) { const n = this.refs[k]; if (n && n.textContent !== text) n.textContent = text; }
  show(k: string, on: boolean) { this.refs[k]?.classList.toggle('hidden', !on); }

  toast(text: string, ms = 1800) {
    this.set('toast', text);
    this.show('toast', true);
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.show('toast', false), ms);
  }
  big(text: string, sub = '') {
    const b = this.refs.big;
    if (!text) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    b.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  }
  scenic(stops: { id: string; label: string }[] | null, active = '') {
    const s = this.refs.scenic;
    if (!stops) { s.classList.add('hidden'); return; }
    s.classList.remove('hidden');
    s.innerHTML = stops.map((x) => `<button data-stop="${x.id}" class="${x.id === active ? 'on' : ''}">${esc(x.label)}</button>`).join('');
  }
  players(rows: { name: string; color: string; info: string }[] | null) {
    const p = this.refs.players;
    if (!rows) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    p.innerHTML = rows.map((r) => `<div><span><i style="background:${r.color}"></i>${esc(r.name)}</span><span>${esc(r.info)}</span></div>`).join('');
  }
  setMuteIcon(m: boolean) { const b = this.el.querySelector('[data-a="mute"]'); if (b) b.textContent = m ? '🔇' : '🔊'; }
  visible(on: boolean) { this.el.classList.toggle('hidden', !on); this.touchEl?.classList.toggle('hidden', !on); }

  touch = { left: false, right: false, gas: false, brake: false, boost: false, drift: false };
  private buildTouch(root: HTMLElement) {
    const t = el(`<div class="touch"><button class="tl" data-t="left">◀</button><button class="tr" data-t="right">▶</button><button class="tbrake" data-t="brake">BRAKE</button><button class="tgas" data-t="gas">GAS</button><button class="tboost" data-t="boost">BOOST</button><button class="tdrift" data-t="drift">DRIFT</button></div>`);
    t.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const k = b.dataset.t as keyof HUD['touch'];
      const on = (e: Event) => { e.preventDefault(); this.touch[k] = true; b.classList.add('down'); };
      const off = (e: Event) => { e.preventDefault(); this.touch[k] = false; b.classList.remove('down'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    });
    root.appendChild(t);
    this.touchEl = t;
  }
}
