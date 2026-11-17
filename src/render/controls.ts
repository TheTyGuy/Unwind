/**
 * Touch-first pointer input: one-finger drag orbits, two-finger pinch zooms,
 * and a short, still press counts as a tap. Reports gestures; owns no camera.
 */
export interface InputHandlers {
  onDragStart(): void;
  /** Pixel deltas since the previous move, plus elapsed seconds. */
  onDrag(dx: number, dy: number, dt: number): void;
  onDragEnd(): void;
  /** Multiplicative zoom change (>1 zooms in). */
  onZoom(factor: number): void;
  onTap(x: number, y: number): void;
}

export const TAP_MAX_MOVE = 10;
export const TAP_MAX_MS = 350;

/** Pure tap test, shared with unit tests. */
export function isTap(moved: number, elapsedMs: number, multiTouch: boolean): boolean {
  return !multiTouch && moved <= TAP_MAX_MOVE && elapsedMs <= TAP_MAX_MS;
}

interface Pointer {
  x: number;
  y: number;
}

export class PointerInput {
  private pointers = new Map<number, Pointer>();
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private lastTime = 0;
  private moved = 0;
  private dragging = false;
  private multi = false;
  private pinchDist = 0;
  private off: (() => void)[] = [];

  constructor(
    private el: HTMLElement,
    private handlers: InputHandlers,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn, opts);
      this.off.push(() => el.removeEventListener(type, fn, opts));
    };
    on('pointerdown', this.down);
    on('pointermove', this.move);
    on('pointerup', this.up);
    on('pointercancel', this.cancel);
    on('wheel', this.wheel, { passive: false });
    on('contextmenu', (e) => e.preventDefault());
  }

  private down = (e: PointerEvent) => {
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured */
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.startTime = this.lastTime = performance.now();
      this.moved = 0;
      this.dragging = false;
      this.multi = false;
    } else {
      this.multi = true;
      if (this.dragging) this.handlers.onDragEnd();
      this.dragging = false;
      this.pinchDist = this.spread();
    }
  };

  private move = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size >= 2) {
      const dist = this.spread();
      if (this.pinchDist > 0 && dist > 0) this.handlers.onZoom(dist / this.pinchDist);
      this.pinchDist = dist;
      return;
    }
    if (this.multi) return; // leftover finger after a pinch: ignore until all lift
    this.moved = Math.max(this.moved, Math.hypot(e.clientX - this.startX, e.clientY - this.startY));
    if (!this.dragging && this.moved > TAP_MAX_MOVE) {
      this.dragging = true;
      this.handlers.onDragStart();
    }
    if (this.dragging) {
      const now = performance.now();
      this.handlers.onDrag(dx, dy, Math.max(0.001, (now - this.lastTime) / 1000));
      this.lastTime = now;
    }
  };

  private up = (e: PointerEvent) => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size > 0) {
      this.pinchDist = 0;
      return;
    }
    if (this.dragging) this.handlers.onDragEnd();
    else if (isTap(this.moved, performance.now() - this.startTime, this.multi))
      this.handlers.onTap(e.clientX, e.clientY);
    this.dragging = false;
  };

  private cancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.dragging && this.pointers.size === 0) this.handlers.onDragEnd();
    if (this.pointers.size === 0) this.dragging = false;
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.handlers.onZoom(Math.exp(-e.deltaY * 0.0015));
  };

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  dispose(): void {
    this.off.forEach((fn) => fn());
    this.pointers.clear();
  }
}
