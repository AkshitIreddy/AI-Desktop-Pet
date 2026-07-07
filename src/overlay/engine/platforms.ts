/**
 * platforms — turns native window rects (Rust `list_windows`, PHYSICAL px,
 * z-ordered top-first) into walkable Platforms in LOGICAL overlay coords.
 * Polls every 500 ms, but only while `shouldPoll()` says pets exist and
 * windowWalking is enabled. Diffs window ids to announce new windows.
 */
import { ipc } from '../../shared/ipc';
import type { NativeWindow, Platform } from '../../shared/types';
import type { OverlayEnv } from './api';
import { monitorAt } from './monitors';

const POLL_MS = 500;
/** Platforms narrower than this (logical px) are useless to walk on. */
const MIN_WIDTH = 120;
/** Windows covering more than this fraction of THEIR monitor are fullscreen apps. */
const MAX_COVERAGE = 0.8;
/** Keep only the top-most N windows by z-order. */
const MAX_PLATFORMS = 6;

interface StartOpts {
  env: OverlayEnv;
  shouldPoll: () => boolean;
  onUpdate: (platforms: Platform[]) => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let current: Platform[] = [];
let knownIds = new Set<number>();
/** True right after (re)start or a polling pause — suppresses appear events. */
let baselineNeeded = true;
const titles = new Map<number, string>();
const appearedCbs = new Set<(p: Platform) => void>();

export function startPlatforms(opts: StartOpts): void {
  stopPlatforms();
  baselineNeeded = true;
  timer = setInterval(() => {
    void poll(opts);
  }, POLL_MS);
}

export function stopPlatforms(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

export function getPlatforms(): Platform[] {
  return current;
}

/** Fires once per newly-appeared native window (already converted). */
export function onWindowAppeared(cb: (p: Platform) => void): () => void {
  appearedCbs.add(cb);
  return () => {
    appearedCbs.delete(cb);
  };
}

/** Last-seen title for a native window id (platform-lost narration). */
export function windowTitle(id: number): string {
  return titles.get(id) ?? 'a window';
}

async function poll(opts: StartOpts): Promise<void> {
  if (inFlight) return;
  if (!opts.shouldPoll()) {
    // Windows present when polling resumes are not "new".
    baselineNeeded = true;
    if (current.length > 0) {
      current = [];
      opts.onUpdate(current);
    }
    return;
  }
  inFlight = true;
  try {
    const wins = await ipc.listWindows();
    const env = opts.env;
    const next: Platform[] = [];
    const ids = new Set<number>();
    for (const win of wins) {
      if (next.length >= MAX_PLATFORMS) break;
      const p = toPlatform(win, env);
      if (!p) continue;
      next.push(p);
      ids.add(win.id);
      titles.set(win.id, win.title || win.app);
    }
    const fresh = baselineNeeded
      ? []
      : next.filter((p) => p.windowId !== undefined && !knownIds.has(p.windowId));
    baselineNeeded = false;
    knownIds = ids;
    current = next;
    opts.onUpdate(next);
    for (const p of fresh) {
      for (const cb of appearedCbs) cb(p);
    }
  } catch {
    // list_windows is best-effort; keep the last platforms on failure.
  } finally {
    inFlight = false;
  }
}

function toPlatform(win: NativeWindow, env: OverlayEnv): Platform | null {
  if (win.minimized) return null;
  // Native rects are physical virtual-screen px; overlay origin is the
  // overlay window's origin — subtract it, then divide by scale once.
  const y = (win.rect.y - env.originY) / env.scale;
  const left = Math.max(0, (win.rect.x - env.originX) / env.scale);
  const right = Math.min(env.width, (win.rect.x + win.rect.w - env.originX) / env.scale);
  const bottom = Math.min(env.height, (win.rect.y + win.rect.h - env.originY) / env.scale);
  if (right - left < MIN_WIDTH) return null;
  // Everything below is judged against the MONITOR the window sits on.
  const m = monitorAt(env, (left + right) / 2);
  // Windows covering most of their monitor are fullscreen/maximized apps.
  const monitorArea = Math.max(1, (m.right - m.left) * (m.bottom - m.top));
  const clippedH = Math.max(0, bottom - Math.max(y, m.top));
  if ((right - left) * clippedH > monitorArea * MAX_COVERAGE) return null;
  // Top edge must be reachable: below the monitor's top bar and not right
  // at that monitor's floor.
  if (y < m.top + 12 || y > m.floorY - 40) return null;
  return { kind: 'window', windowId: win.id, y, left, right, bottom };
}
