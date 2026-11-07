/**
 * A pannable, zoomable camera for the Keterkaitan views: screen = world × k + (x, y).
 * Wheel pans (two-finger scroll too); with Ctrl or ⌘, or a trackpad pinch, it zooms at the
 * pointer. Dragging pans, two fingers pinch, a double click zooms in. A press that does not move
 * stays a click on whatever it pressed. Camera moves glide (zoom changes geometrically while the
 * view's centre moves evenly) unless reduced motion is asked for.
 */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface View {
  x: number;
  y: number;
  k: number;
}

const motionOk = () => typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

export class PanZoom {
  x = $state(0);
  y = $state(0);
  k = $state(0.6);
  vw = $state(0);
  vh = $state(0);
  /** True while the camera moves; the layer is only promoted then, so it re-rasters crisp after. */
  moving = $state(false);
  /** Set when a press turned into a drag, until the next press. */
  dragged = $state(false);

  /** Room kept at the top of the view (a strip of names drawn over it). */
  top = $state(0);
  readonly min: number;
  readonly max: number;
  private placed = false;
  private raf = 0;
  private idle = 0;

  constructor(opts: { top?: number; min?: number; max?: number } = {}) {
    this.top = opts.top ?? 0;
    this.min = opts.min ?? 0.2;
    this.max = opts.max ?? 1.6;
  }

  get view(): View {
    return { x: this.x, y: this.y, k: this.k };
  }
  get anchor() {
    return { x: this.vw / 2, y: this.top + (this.vh - this.top) / 2 };
  }
  clampK(k: number, lo = this.min, hi = this.max) {
    return Math.min(hi, Math.max(lo, k));
  }
  sx(x: number) {
    return x * this.k + this.x;
  }
  sy(y: number) {
    return y * this.k + this.y;
  }

  /** The view that fits a box, zoom kept between lo and hi. */
  frame(b: Bounds, lo: number, hi: number, pad = 28): View {
    const aw = Math.max(1, this.vw - pad * 2);
    const ah = Math.max(1, this.vh - this.top - pad * 2);
    const k = this.clampK(Math.min(aw / Math.max(1, b.x1 - b.x0), ah / Math.max(1, b.y1 - b.y0)), lo, hi);
    const c = this.anchor;
    return { x: c.x - ((b.x0 + b.x1) / 2) * k, y: c.y - ((b.y0 + b.y1) / 2) * k, k };
  }
  /** Whether a box fits the view at a zoom, with a margin. */
  fits(b: Bounds, k: number, margin = 40) {
    return (b.x1 - b.x0) * k <= this.vw - margin && (b.y1 - b.y0) * k <= this.vh - this.top - margin;
  }

  private set(v: View) {
    this.x = v.x;
    this.y = v.y;
    this.k = v.k;
  }
  private settle() {
    clearTimeout(this.idle);
    this.idle = window.setTimeout(() => (this.moving = false), 180);
  }
  private nudge() {
    this.moving = true;
    this.settle();
  }
  stop() {
    cancelAnimationFrame(this.raf);
  }

  flyTo(target: View, ms = 560) {
    this.stop();
    if (ms <= 0 || !motionOk() || !this.placed) {
      this.set(target);
      this.placed = true;
      this.nudge();
      return;
    }
    const from = this.view;
    const c = this.anchor;
    const c0 = { x: (c.x - from.x) / from.k, y: (c.y - from.y) / from.k };
    const c1 = { x: (c.x - target.x) / target.k, y: (c.y - target.y) / target.k };
    const t0 = performance.now();
    this.moving = true;
    const step = (now: number) => {
      const p = motionOk() ? Math.min(1, (now - t0) / ms) : 1;
      const e = 1 - (1 - p) ** 3;
      const k = from.k * (target.k / from.k) ** e;
      this.set({ x: c.x - (c0.x + (c1.x - c0.x) * e) * k, y: c.y - (c0.y + (c1.y - c0.y) * e) * k, k });
      if (p < 1) this.raf = requestAnimationFrame(step);
      else this.settle();
    };
    this.raf = requestAnimationFrame(step);
  }

  zoomAt(px: number, py: number, factor: number) {
    const k = this.clampK(this.k * factor);
    const f = k / this.k;
    this.set({ x: px - (px - this.x) * f, y: py - (py - this.y) * f, k });
    this.nudge();
  }
  zoomBy(factor: number) {
    const c = this.anchor;
    const k = this.clampK(this.k * factor);
    const f = k / this.k;
    this.flyTo({ x: c.x - (c.x - this.x) * f, y: c.y - (c.y - this.y) * f, k }, 260);
  }
  /** Brings a box into view at a readable zoom when it is outside it. */
  reveal(b: Bounds, minK: number, margin = 20) {
    const inside =
      this.sx(b.x0) >= margin &&
      this.sy(b.y0) >= this.top + margin &&
      this.sx(b.x1) <= this.vw - margin &&
      this.sy(b.y1) <= this.vh - margin;
    if (inside) return;
    const k = Math.max(this.k, minK);
    const c = this.anchor;
    this.flyTo({ x: c.x - ((b.x0 + b.x1) / 2) * k, y: c.y - ((b.y0 + b.y1) / 2) * k, k }, 320);
  }

  /**
   * Wires the gestures to a viewport. `ignore` names elements where a press never starts a pan
   * (toolbars, header strips); `noZoom` names those a double click should leave alone.
   */
  attach(el: HTMLElement, opts: { ignore?: string; noZoom?: string; onpan?: () => void } = {}) {
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; cx: number; cy: number; panning: boolean } | null = null;
    let pinch: { d: number; k: number; mx: number; my: number; cx: number; cy: number } | null = null;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.stop();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * 0.0024));
      else {
        const dx = (e.shiftKey ? e.deltaY : e.deltaX) * unit;
        const dy = (e.shiftKey ? 0 : e.deltaY) * unit;
        this.set({ x: this.x - dx, y: this.y - dy, k: this.k });
        this.nudge();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (opts.ignore && (e.target as HTMLElement).closest(opts.ignore)) return;
      this.stop();
      this.dragged = false;
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) drag = { x: p.x, y: p.y, cx: this.x, cy: this.y, panning: false };
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = {
          d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          k: this.k,
          mx: (a.x + b.x) / 2,
          my: (a.y + b.y) / 2,
          cx: this.x,
          cy: this.y
        };
        for (const id of pointers.keys()) el.setPointerCapture(id);
        drag = null;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const k = this.clampK((pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d);
        const wx = (pinch.mx - pinch.cx) / pinch.k;
        const wy = (pinch.my - pinch.cy) / pinch.k;
        this.set({ x: (a.x + b.x) / 2 - wx * k, y: (a.y + b.y) / 2 - wy * k, k });
        this.nudge();
        return;
      }
      if (!drag) return;
      if (!drag.panning && Math.hypot(p.x - drag.x, p.y - drag.y) > 5) {
        drag.panning = true;
        this.dragged = true;
        opts.onpan?.();
        // Captured from here on, so the release is not a click on what was pressed.
        el.setPointerCapture(e.pointerId);
      }
      if (drag.panning) {
        this.set({ x: drag.cx + p.x - drag.x, y: drag.cy + p.y - drag.y, k: this.k });
        this.nudge();
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) drag = null;
    };
    const onDbl = (e: MouseEvent) => {
      if (opts.noZoom && (e.target as HTMLElement).closest(opts.noZoom)) return;
      const p = local(e);
      const k = this.clampK(this.k * 1.6);
      const f = k / this.k;
      this.flyTo({ x: p.x - (p.x - this.x) * f, y: p.y - (p.y - this.y) * f, k }, 300);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('dblclick', onDbl);
    return () => {
      this.stop();
      clearTimeout(this.idle);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('dblclick', onDbl);
    };
  }
}
