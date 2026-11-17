/**
 * Three.js view of a level. Purely presentational: it is told what happened
 * (an arrow escaped, a tap was blocked, what is selected) and animates it.
 * It never decides game outcomes; taps are reported back via callbacks.
 */
import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
  Euler,
} from 'three';
import { keyOf, rayLength } from '../core/grid';
import { buildShape } from '../core/shapes';
import type { Arrow, Level, Vec3 } from '../core/types';
import { ArrowTube, arrowUniforms, createArrowMaterial, HEAD_LEN, TUBE_R } from './arrowMesh';
import { PointerInput } from './controls';
import { ARROW_COLORS, BLOCK_RED, colorFor } from './palette';
import { Particles } from './particles';
import { buildArrowPath, samplePath, type ArrowPath } from './path';
import { buildPickTarget, pick, type PickTarget } from './picking';
import { RayPreview } from './rayPreview';
import { buildShell, cellDepths, type Shell } from './shell';

export interface ViewCallbacks {
  onArrowTap(id: number): void;
  onEmptyTap(): void;
}

export interface Selection {
  id: number;
  /** Ids of every arrow in the selected arrow's exit ray. */
  blockers: number[];
  /** Empty cells before the nearest blocker, or null if the ray is clear. */
  gap: number | null;
}

interface ArrowVis {
  arrow: Arrow;
  path: ArrowPath;
  tube: ArrowTube;
  mesh: Mesh;
  mat: MeshStandardMaterial;
  color: Color;
  target: PickTarget;
  /** 0 = outermost layer, 1 = innermost. */
  depthN: number;
  state: 'idle' | 'busy' | 'leaving';
  alpha: number;
  fade: number;
  dim: number;
  flash: number;
  hint: number;
}

interface Anim {
  elapsed: number;
  dur: number;
  step(k: number, dt: number): void;
  done?(): void;
}

const FOV = 34;
const ROTATE_SPEED = 0.0085;
const DOUBLE_TAP_MS = 320;
const RED = new Color(BLOCK_RED);
const WHITE = new Color(0xffffff);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

const addScaled = (out: Color, c: Color, k: number) => {
  out.r += c.r * k;
  out.g += c.g * k;
  out.b += c.b * k;
};

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

export class GameView {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  private root = new Group();
  private particles = new Particles();
  private ray = new RayPreview();
  private input: PointerInput;
  private arrows = new Map<number, ArrowVis>();
  private shell: Shell | null = null;
  private level: Level | null = null;
  private depths = new Map<number, number>();
  private maxDepth = 0;
  /** Arrows mid-escape: out of the game but still being drawn. */
  private leaving = new Set<ArrowVis>();
  private anims: Anim[] = [];

  private selection: Selection | null = null;
  private xray = false;
  private peel = 0;
  private reduceMotion = false;

  private homeQuat = new Quaternion();
  private resetting = 0;
  private spinX = 0;
  private spinY = 0;
  private dragging = false;
  private zoom = 1;
  private zoomTarget = 1;
  private baseDist = 10;
  private radius = 3;
  private shake = 0;
  private autoSpin = 0;

  private lastEmptyTap = 0;
  private raf = 0;
  private lastFrame = 0;
  private running = false;
  private resizeObserver: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    private callbacks: ViewCallbacks,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene.add(new HemisphereLight(0xffffff, 0x3a4a80, 1.5));
    const key = new DirectionalLight(0xffffff, 2.1);
    key.position.set(-3, 6, 8);
    const fill = new DirectionalLight(0x9fc4ff, 0.6);
    fill.position.set(5, -2, 3);
    this.scene.add(key, fill, this.root);
    this.root.add(this.particles.points, this.ray.mesh);

    this.input = new PointerInput(canvas, {
      onDragStart: () => {
        this.dragging = true;
        this.resetting = 0;
        this.autoSpin = 0;
        this.spinX = this.spinY = 0;
      },
      onDrag: (dx, dy, dt) => {
        this.rotate(dx * ROTATE_SPEED, dy * ROTATE_SPEED);
        // Smoothed angular velocity, carried on as inertia when the finger lifts.
        const k = 0.35;
        this.spinX += ((dx * ROTATE_SPEED) / dt - this.spinX) * k;
        this.spinY += ((dy * ROTATE_SPEED) / dt - this.spinY) * k;
      },
      onDragEnd: () => {
        this.dragging = false;
        if (this.reduceMotion) this.spinX = this.spinY = 0;
      },
      onZoom: (f) => {
        this.zoomTarget = Math.max(0.55, Math.min(2.4, this.zoomTarget * f));
      },
      onTap: (x, y) => this.handleTap(x, y),
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  // ---------------------------------------------------------------- level --

  loadLevel(level: Level, removed: readonly number[] = []): void {
    this.clearLevel();
    this.level = level;
    const size = level.size;
    const cells: Vec3[] = level.shape
      ? buildShape(level.shape.id, level.shape.size).cells
      : level.arrows.flatMap((a) => a.cells);
    this.shell = buildShell(cells, size);
    this.root.add(this.shell.group);

    this.depths = cellDepths(cells, size);
    const gone = new Set(removed);
    const means = level.arrows.map((a) => this.meanDepth(a));
    this.maxDepth = Math.max(0, ...means);
    for (const arrow of level.arrows) if (!gone.has(arrow.id)) this.addArrow(arrow);

    this.radius = Math.hypot(size[0], size[1], size[2]) / 2 + 0.4;
    const flat = Math.min(size[0], size[1], size[2]) === 1;
    this.homeQuat.setFromEuler(flat ? new Euler(-0.32, 0.12, 0) : new Euler(0.5, -0.66, 0));
    this.root.quaternion.copy(this.homeQuat);
    this.root.scale.setScalar(1);
    this.zoom = this.zoomTarget = 1;
    this.spinX = this.spinY = 0;
    this.autoSpin = 0;
    this.resetting = 0;
    this.selection = null;
    this.ray.hide();
    this.fitCamera();

    if (!this.reduceMotion) {
      this.anims.push({
        elapsed: 0,
        dur: 0.45,
        step: (k) => {
          const e = 1 - Math.pow(1 - k, 3);
          this.root.scale.setScalar(0.82 + 0.18 * e + 0.05 * Math.sin(k * Math.PI));
        },
        done: () => this.root.scale.setScalar(1),
      });
    }
  }

  /** True when the level has inner layers worth x-raying or peeling. */
  get hasLayers(): boolean {
    return this.maxDepth > 0.01;
  }

  private meanDepth(arrow: Arrow): number {
    const size = this.level!.size;
    return (
      arrow.cells.reduce((s, c) => s + (this.depths.get(keyOf(size, c)) ?? 0), 0) /
      arrow.cells.length
    );
  }

  private addArrow(arrow: Arrow): ArrowVis {
    const size = this.level!.size;
    const exitLen = Math.hypot(size[0], size[1], size[2]) + 7;
    const path = buildArrowPath(arrow, size, exitLen);
    const tube = new ArrowTube(path);
    const mat = createArrowMaterial(colorFor(arrow.id));
    const mesh = new Mesh(tube.geometry, mat);
    mesh.frustumCulled = false;
    this.root.add(mesh);
    const vis: ArrowVis = {
      arrow,
      path,
      tube,
      mesh,
      mat,
      color: new Color(colorFor(arrow.id)),
      target: buildPickTarget(arrow.id, path),
      depthN: this.maxDepth > 0.01 ? this.meanDepth(arrow) / this.maxDepth : 1,
      state: 'idle',
      alpha: 1,
      fade: 1,
      dim: 1,
      flash: 0,
      hint: 0,
    };
    this.arrows.set(arrow.id, vis);
    return vis;
  }

  private removeArrow(vis: ArrowVis): void {
    this.root.remove(vis.mesh);
    vis.tube.dispose();
    vis.mat.dispose();
    this.leaving.delete(vis);
    if (this.arrows.get(vis.arrow.id) === vis) this.arrows.delete(vis.arrow.id);
  }

  private clearLevel(): void {
    for (const vis of [...this.arrows.values()]) this.removeArrow(vis);
    // Arrows mid-escape are no longer in the map; their animations own them.
    for (const anim of this.anims) anim.done?.();
    this.anims = [];
    if (this.shell) {
      this.root.remove(this.shell.group);
      this.shell.dispose();
      this.shell = null;
    }
  }

  // ------------------------------------------------------------- settings --

  setXray(on: boolean): void {
    this.xray = on;
  }

  setPeel(amount: number): void {
    this.peel = Math.max(0, Math.min(1, amount));
  }

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
    arrowUniforms.uBreath.value = on ? 0 : 0.012;
  }

  setSelection(sel: Selection | null): void {
    this.selection = sel;
    const vis = sel ? this.arrows.get(sel.id) : undefined;
    if (!sel || !vis || !this.level) {
      this.ray.hide();
      return;
    }
    const tipOffset = 0.12 + HEAD_LEN;
    samplePath(vis.path, vis.tube.length, tmpA);
    const toEdge = rayLength(this.level.size, vis.arrow) + 0.5 - tipOffset;
    const blockedAt = sel.gap === null ? Infinity : Math.max(0.1, sel.gap + 1 - tipOffset - TUBE_R);
    this.ray.show(tmpA, vis.path.dir, toEdge + 1.6, blockedAt);
  }

  // ----------------------------------------------------------- animations --

  /** Slide the arrow out along its own curve, launch it, and dispose it. */
  playEscape(id: number): void {
    const vis = this.arrows.get(id);
    if (!vis) return;
    this.arrows.delete(id);
    vis.state = 'leaving';
    this.leaving.add(vis);
    if (this.selection?.id === id) this.setSelection(null);
    const travel = vis.path.totalLen - vis.tube.length - 0.3;
    const tip = samplePath(vis.path, vis.tube.length, new Vector3());
    if (!this.reduceMotion) this.particles.burst(tip, vis.color, 10, 2.2, 0.45);
    const pos = new Vector3();
    const vel = new Vector3();
    let emitted = 0;
    this.anims.push({
      elapsed: 0,
      dur: this.reduceMotion ? 0.28 : 0.52 + travel * 0.014,
      step: (k) => {
        if (this.reduceMotion) {
          vis.tube.update(k * 1.2);
          vis.fade = 1 - k;
          return;
        }
        const s = travel * (0.06 * k + 0.94 * k * k * k);
        vis.tube.update(s);
        vis.fade = 1 - smooth((k - 0.72) / 0.28);
        // Sparkle trail shed from the tail once it's really moving.
        const want = Math.floor(s * 2.2);
        while (emitted < want && k < 0.9) {
          emitted++;
          samplePath(vis.path, s + 0.2 + Math.random() * 0.5, pos);
          vel
            .copy(vis.path.dir)
            .multiplyScalar(-0.6)
            .add(
              tmpB
                .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
                .multiplyScalar(0.7),
            );
          this.particles.emit(pos, vel, vis.color, 0.5 + Math.random() * 0.3);
        }
      },
      done: () => this.removeArrow(vis),
    });
  }

  /** Lunge at the blocker and bounce back; the blocker flashes red. */
  playBonk(id: number, blockerId: number, gap: number): void {
    const vis = this.arrows.get(id);
    const blocker = this.arrows.get(blockerId);
    if (!vis) return;
    if (this.reduceMotion) {
      if (blocker) blocker.flash = 1;
      vis.flash = 0.6;
      return;
    }
    vis.state = 'busy';
    const reach = Math.min(gap + 0.3, 1.5);
    let hit = false;
    this.anims.push({
      elapsed: 0,
      dur: 0.5,
      step: (k) => {
        const HIT = 0.24;
        let s: number;
        if (k < HIT) {
          const t = k / HIT;
          s = reach * t * t;
        } else {
          const x = (k - HIT) / (1 - HIT);
          s = reach * Math.max(0, Math.exp(-5 * x) * Math.cos(9 * x)) * (1 - x);
          if (!hit) {
            hit = true;
            if (blocker) blocker.flash = 1;
            vis.flash = 0.5;
            this.shake = 1;
            samplePath(vis.path, reach + vis.tube.length, tmpA);
            this.particles.burst(tmpA, RED, 12, 2.4, 0.4);
          }
        }
        vis.tube.update(s);
      },
      done: () => {
        vis.tube.update(0);
        if (vis.state === 'busy') vis.state = 'idle';
      },
    });
  }

  /** Bring an arrow back (undo): it slides back in from its exit direction. */
  restoreArrow(arrow: Arrow): void {
    if (!this.level || this.arrows.has(arrow.id)) return;
    const vis = this.addArrow(arrow);
    if (this.reduceMotion) return;
    vis.state = 'busy';
    vis.fade = 0;
    this.anims.push({
      elapsed: 0,
      dur: 0.32,
      step: (k) => {
        const e = 1 - Math.pow(1 - k, 3);
        vis.tube.update(2.2 * (1 - e));
        vis.fade = Math.min(1, k * 2.5);
      },
      done: () => {
        vis.tube.update(0);
        vis.fade = 1;
        if (vis.state === 'busy') vis.state = 'idle';
      },
    });
  }

  flashHint(id: number): void {
    const vis = this.arrows.get(id);
    if (vis) vis.hint = 1;
  }

  /** Confetti and a lazy victory spin. */
  celebrate(): void {
    if (this.reduceMotion) return;
    this.autoSpin = 1;
    const at = new Vector3();
    let fired = 0;
    this.anims.push({
      elapsed: 0,
      dur: 1.3,
      step: (k) => {
        const want = Math.floor(k * 7);
        while (fired <= want && fired < 7) {
          fired++;
          at.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(
            this.radius * 1.3,
          );
          this.particles.burst(
            at,
            new Color(ARROW_COLORS[fired % ARROW_COLORS.length]),
            26,
            3.4,
            0.9,
          );
        }
      },
    });
  }

  resetView(): void {
    this.resetting = 1;
    this.zoomTarget = 1;
    this.spinX = this.spinY = 0;
    this.autoSpin = 0;
  }

  // ---------------------------------------------------------------- input --

  private rotate(yaw: number, pitch: number): void {
    // Rotate about the screen axes so dragging always feels like turning the object.
    this.root.quaternion.premultiply(tmpQ.setFromAxisAngle(Y_AXIS, yaw));
    this.root.quaternion.premultiply(tmpQ.setFromAxisAngle(X_AXIS, pitch));
  }

  /** Arrow under a client-space point, or null. Opaque arrows win over faded ones. */
  pickAt(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this.camera.updateMatrixWorld();
    this.root.updateMatrixWorld();
    const origin = this.camera.position.clone();
    const dir = new Vector3(ndcX, ndcY, 0.5).unproject(this.camera).sub(origin).normalize();
    const inv = new Matrix4().copy(this.root.matrixWorld).invert();
    origin.applyMatrix4(inv);
    dir.transformDirection(inv);

    // ~14 CSS px of forgiveness, converted to world units at the puzzle's distance.
    const worldPerPx = (2 * this.camera.position.z * Math.tan((FOV * Math.PI) / 360)) / rect.height;
    const fat = Math.max(0.1, 14 * worldPerPx);
    const solid: PickTarget[] = [];
    const faint: PickTarget[] = [];
    for (const vis of this.arrows.values()) {
      const a = this.layerAlpha(vis);
      if (a >= 0.5) solid.push(vis.target);
      else if (a > 0.05) faint.push(vis.target);
    }
    const hit = pick(origin, dir, solid, fat);
    if (hit?.exact) return hit.id;
    const faintHit = pick(origin, dir, faint, fat);
    if (faintHit?.exact) return faintHit.id;
    return hit?.id ?? faintHit?.id ?? null;
  }

  private handleTap(x: number, y: number): void {
    const id = this.pickAt(x, y);
    if (id !== null) {
      this.lastEmptyTap = 0;
      this.callbacks.onArrowTap(id);
      return;
    }
    const now = performance.now();
    if (now - this.lastEmptyTap < DOUBLE_TAP_MS) {
      this.lastEmptyTap = 0;
      this.resetView();
    } else {
      this.lastEmptyTap = now;
      this.callbacks.onEmptyTap();
    }
  }

  // ---------------------------------------------------------------- frame --

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.tick(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private layerAlpha(vis: ArrowVis): number {
    const sel = this.selection;
    const forced =
      vis.hint > 0 ||
      vis.flash > 0 ||
      vis.state !== 'idle' ||
      (sel && (sel.id === vis.arrow.id || sel.blockers.includes(vis.arrow.id)));
    if (forced || !this.hasLayers) return 1;
    if (this.peel > 0 && vis.depthN < this.peel - 0.001) return 0;
    return this.xray ? 0.1 + 0.9 * smooth((vis.depthN - 0.25) / 0.75) : 1;
  }

  /** Advance animations and draw one frame. Public so tests/screenshots can step time. */
  tick(dt: number): void {
    arrowUniforms.uTime.value += dt;
    const time = arrowUniforms.uTime.value;

    // Orbit inertia, victory spin and view reset.
    if (!this.dragging) {
      if (this.resetting > 0) {
        this.root.quaternion.slerp(this.homeQuat, 1 - Math.exp(-dt * 12));
        if (this.root.quaternion.angleTo(this.homeQuat) < 0.004) {
          this.root.quaternion.copy(this.homeQuat);
          this.resetting = 0;
        }
      } else if (Math.abs(this.spinX) + Math.abs(this.spinY) > 0.01) {
        this.rotate(this.spinX * dt, this.spinY * dt);
        const decay = Math.exp(-dt * 3.2);
        this.spinX *= decay;
        this.spinY *= decay;
      } else if (this.autoSpin > 0) {
        this.rotate(dt * 0.7, 0);
      }
    }
    if (Math.abs(this.zoom - this.zoomTarget) > 0.0005) {
      this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-dt * 16));
      this.camera.position.z = this.baseDist / this.zoom;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 5);
      const a = this.shake * this.shake * 0.07;
      this.root.position.set(Math.sin(time * 90) * a, Math.cos(time * 70) * a, 0);
    }

    for (let i = this.anims.length - 1; i >= 0; i--) {
      const anim = this.anims[i];
      anim.elapsed += dt;
      const k = Math.min(1, anim.elapsed / anim.dur);
      anim.step(k, dt);
      if (k >= 1) {
        this.anims.splice(i, 1);
        anim.done?.();
      }
    }

    // Per-arrow look: layer fade, selection glow, blocker glow, hint pulse.
    const sel = this.selection;
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    const ease = 1 - Math.exp(-dt * 14);
    for (const vis of this.arrows.values()) this.styleArrow(vis, sel, pulse, ease, dt);
    for (const vis of this.leaving) this.styleArrow(vis, null, pulse, ease, dt);

    this.particles.update(dt);
    this.ray.update(this.reduceMotion ? 0 : dt);
    this.renderer.render(this.scene, this.camera);
  }

  private styleArrow(
    vis: ArrowVis,
    sel: Selection | null,
    pulse: number,
    ease: number,
    dt: number,
  ): void {
    const isSel = sel?.id === vis.arrow.id;
    const isBlocker = !!sel && sel.blockers.includes(vis.arrow.id);
    vis.alpha += (this.layerAlpha(vis) - vis.alpha) * ease;
    const alpha = vis.alpha * vis.fade;
    vis.mesh.visible = alpha > 0.02;
    vis.mat.opacity = alpha;
    const transparent = alpha < 0.985;
    if (vis.mat.transparent !== transparent) {
      vis.mat.transparent = transparent;
      vis.mat.needsUpdate = true;
    }
    vis.mat.depthWrite = alpha > 0.5;
    vis.mesh.renderOrder = transparent ? 10 : 0;

    const dimTarget = sel && !isSel && !isBlocker ? 0.5 : 1;
    vis.dim += (dimTarget - vis.dim) * ease;
    vis.mat.color.copy(vis.color).multiplyScalar(vis.dim);

    const e = vis.mat.emissive.setRGB(0, 0, 0);
    if (isSel) addScaled(e, vis.color, 0.28 + 0.22 * pulse);
    if (isBlocker) addScaled(e, RED, 0.55 + 0.4 * pulse);
    if (vis.flash > 0) {
      addScaled(e, RED, vis.flash * 1.4);
      vis.flash = Math.max(0, vis.flash - dt * 2.2);
    }
    if (vis.hint > 0) {
      addScaled(e, WHITE, vis.hint * (0.25 + 0.55 * pulse));
      vis.hint = Math.max(0, vis.hint - dt / 2.6);
    }
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.fitCamera();
  }

  private fitCamera(): void {
    const v = (FOV * Math.PI) / 360;
    const half = Math.min(v, Math.atan(Math.tan(v) * this.camera.aspect));
    this.baseDist = (this.radius / Math.sin(half)) * 0.9;
    this.camera.position.set(0, 0, this.baseDist / this.zoom);
    this.camera.near = Math.max(0.1, this.baseDist / 50);
    this.camera.far = this.baseDist * 6;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.stop();
    this.clearLevel();
    this.input.dispose();
    this.resizeObserver.disconnect();
    this.particles.dispose();
    this.ray.dispose();
    this.renderer.dispose();
  }
}
