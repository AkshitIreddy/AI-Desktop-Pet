/**
 * monitors — pure helpers over OverlayEnv.monitors (logical overlay coords).
 *
 * Multi-monitor floor model:
 * - `floorAt(x)` is the floor of the monitor CONTAINING x (nearest by center
 *   when x sits in a gap between monitors).
 * - A pet may WALK across the boundary of two horizontally adjacent monitors
 *   when their floors differ by ≤ FLOOR_STEP_TOLERANCE. A neighbor floor
 *   LOWER by more than that is crossed by tipping into a natural fall; a
 *   neighbor floor HIGHER by more than that is a wall.
 * - Screen-edge climbing only uses the OUTER edges of the union (leftmost
 *   monitor's left, rightmost monitor's right); the climbable top edge is
 *   the containing monitor's top.
 *
 * When env.monitors is empty (runtime not yet feeding monitor data) every
 * helper falls back to a single monitor spanning the whole overlay, which
 * reproduces the previous single-screen behavior exactly.
 */
import type { MonitorRegion, OverlayEnv, PetHandle } from './api';

/** Max floor-height difference (logical px) a pet can simply walk across. */
export const FLOOR_STEP_TOLERANCE = 48;
/** Max raised-floor step a screen-hop can clear (keeps the arc rise ≤ 60). */
export const MAX_HOP_STEP_UP = 36;
/** Two monitors are horizontally adjacent when their edges are this close. */
const ADJACENCY_GAP = 6;

export function monitorList(env: OverlayEnv): MonitorRegion[] {
  if (env.monitors.length > 0) return env.monitors;
  return [
    {
      left: 0,
      right: env.width,
      top: 0,
      bottom: env.height,
      floorY: env.height,
      primary: true,
    },
  ];
}

/** Monitor containing x, else the nearest by horizontal center. */
export function monitorAt(env: OverlayEnv, x: number): MonitorRegion {
  const list = monitorList(env);
  let best = list[0];
  let bestDist = Infinity;
  for (const m of list) {
    if (x >= m.left && x < m.right) return m;
    const d = Math.abs((m.left + m.right) / 2 - x);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

/** Floor y (walk surface) under coordinate x. */
export function floorAt(env: OverlayEnv, x: number): number {
  return monitorAt(env, x).floorY;
}

/** OS primary monitor (homeX / spawn anchor); first entry when unmarked. */
export function primaryMonitor(env: OverlayEnv): MonitorRegion {
  const list = monitorList(env);
  return list.find((m) => m.primary) ?? list[0];
}

export function leftmostMonitor(env: OverlayEnv): MonitorRegion {
  return monitorList(env).reduce((a, b) => (b.left < a.left ? b : a));
}

export function rightmostMonitor(env: OverlayEnv): MonitorRegion {
  return monitorList(env).reduce((a, b) => (b.right > a.right ? b : a));
}

/** Whether m owns the union's outer left/right edge (climbable wall). */
export function touchesOuterEdge(
  env: OverlayEnv,
  m: MonitorRegion,
  side: 'left' | 'right',
): boolean {
  return side === 'left'
    ? m.left <= leftmostMonitor(env).left + 0.5
    : m.right >= rightmostMonitor(env).right - 0.5;
}

/** Same containing monitor (compared by bounds, safe across fallbacks). */
export function sameMonitor(env: OverlayEnv, xa: number, xb: number): boolean {
  const a = monitorAt(env, xa);
  const b = monitorAt(env, xb);
  return a.left === b.left && a.right === b.right && a.top === b.top;
}

/**
 * The horizontally adjacent monitor in `dir`, or null. Requires near-touching
 * x edges and some vertical overlap (diagonal-only neighbors don't count).
 */
export function neighborMonitor(
  env: OverlayEnv,
  m: MonitorRegion,
  dir: 1 | -1,
): MonitorRegion | null {
  for (const n of monitorList(env)) {
    if (n.left === m.left && n.right === m.right && n.top === m.top) continue;
    const gap = dir > 0 ? n.left - m.right : m.left - n.right;
    if (Math.abs(gap) > ADJACENCY_GAP) continue;
    if (n.top >= m.bottom || n.bottom <= m.top) continue;
    return n;
  }
  return null;
}

/**
 * Walkable x range (sprite-left values) for a pet of `size` standing on the
 * floor at x. Extends across neighbors whose floors are not RAISED by more
 * than FLOOR_STEP_TOLERANCE — walking onto a much lower neighbor is allowed
 * (the engine tips the pet into a natural fall at the boundary); a raised
 * neighbor is a wall.
 */
export function walkableRange(
  env: OverlayEnv,
  x: number,
  size: number,
): { min: number; max: number } {
  const start = monitorAt(env, x);
  const count = monitorList(env).length;
  let min = start.left;
  let max = start.right - size;
  let cur = start;
  for (let i = 0; i < count; i++) {
    const n = neighborMonitor(env, cur, 1);
    if (!n || cur.floorY - n.floorY > FLOOR_STEP_TOLERANCE) break;
    max = n.right - size;
    cur = n;
  }
  cur = start;
  for (let i = 0; i < count; i++) {
    const n = neighborMonitor(env, cur, -1);
    if (!n || cur.floorY - n.floorY > FLOOR_STEP_TOLERANCE) break;
    min = n.left;
    cur = n;
  }
  return { min, max };
}

/** Monitor of a pet, by sprite center. */
export function monitorOf(env: OverlayEnv, pet: PetHandle): MonitorRegion {
  return monitorAt(env, pet.x + pet.size / 2);
}

/** Clamp a sprite-left x inside a monitor. */
export function monitorClampX(m: MonitorRegion, x: number, size: number): number {
  const max = Math.max(m.left, m.right - size);
  return Math.min(Math.max(x, m.left), max);
}
