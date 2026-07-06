/**
 * hitRegionRegistry — the single funnel for every interactive rect in the
 * overlay (pets, skill wheel, chat panel, composers…). Callers work in
 * LOGICAL overlay px; the registry converts to PHYSICAL virtual-screen px
 * (origin + logical × scale — the space Rust compares the cursor against)
 * and pushes to `update_hit_regions` at most every 50 ms, only on change.
 */
import { ipc } from '../../shared/ipc';
import type { Rect } from '../../shared/types';

const FLUSH_MS = 50;

const rects = new Map<string, Rect>();
let scale = 1;
let originX = 0;
let originY = 0;
let lastSent = '';
let lastFlushAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  const physical = [...rects.values()].map((r) => ({
    x: Math.round(originX + r.x * scale),
    y: Math.round(originY + r.y * scale),
    w: Math.round(r.w * scale),
    h: Math.round(r.h * scale),
  }));
  const serialized = JSON.stringify(physical);
  if (serialized === lastSent) return;
  lastSent = serialized;
  void ipc.updateHitRegions(physical).catch(() => {
    // Rust side not ready yet — the next change retries.
    lastSent = '';
  });
}

function schedule(): void {
  if (timer !== null) return;
  const since = performance.now() - lastFlushAt;
  timer = setTimeout(() => {
    timer = null;
    lastFlushAt = performance.now();
    flush();
  }, Math.max(0, FLUSH_MS - since));
}

export const hitRegionRegistry = {
  /** DPI scale factor (physical = logical × scale). */
  setScale(s: number): void {
    if (s > 0 && s !== scale) {
      scale = s;
      schedule();
    }
  },
  /** Overlay origin in physical/virtual-screen px (work-area origin). */
  setOrigin(x: number, y: number): void {
    if (x !== originX || y !== originY) {
      originX = x;
      originY = y;
      schedule();
    }
  },
  /** Register/replace a rect (logical overlay px). Pass null to remove. */
  set(id: string, rect: Rect | null): void {
    if (rect === null) {
      if (rects.delete(id)) schedule();
      return;
    }
    const prev = rects.get(id);
    if (
      prev &&
      prev.x === rect.x &&
      prev.y === rect.y &&
      prev.w === rect.w &&
      prev.h === rect.h
    ) {
      return;
    }
    rects.set(id, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    schedule();
  },
};
