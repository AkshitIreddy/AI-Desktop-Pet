/**
 * BEHAVIORS — the ambient behavior catalog (ARCHITECTURE.md §Behavior catalog,
 * entries 1–20). Pure definitions: the BehaviorDirector owns eligibility
 * sampling, locks, cooldowns, joint reservations and abort signals.
 *
 * Event-driven entries (new-window-curiosity, time-of-day, idle-nap,
 * dizzy-tumble) return false from eligible() so the weighted sampler skips
 * them; the director triggers them directly with a `data` payload.
 */
import type { AppSettings, EdgeSide, Platform } from '../../shared/types';
import type { DirectorApi, DirectorEvent, MonitorRegion, OverlayEnv, PetHandle } from './api';
import { climbEligible } from './PetEngine';
import {
  MAX_HOP_STEP_UP,
  leftmostMonitor,
  monitorClampX,
  monitorList,
  monitorOf,
  neighborMonitor,
  rightmostMonitor,
  touchesOuterEdge,
} from './monitors';

/** Directors expose emit() to behaviors (meet-and-greet broadcasts 'meet'). */
export interface DirectorLink extends DirectorApi {
  emit(ev: DirectorEvent): void;
}

export interface BehaviorCtx {
  director: DirectorLink;
  env: OverlayEnv;
  /** Initiating pet. */
  pet: PetHandle;
  /** Second participant when participants === 2. */
  partner?: PetHandle;
  /** All pets reserved for this run (initiator first). */
  pets: PetHandle[];
  signal: AbortSignal;
  /** Trigger payload for event-driven behaviors (Platform, period string…). */
  data?: unknown;
}

export interface BehaviorDef {
  id: string;
  weight: number;
  cooldownMs: number;
  locks: string[];
  participants: 1 | 2 | 'all';
  gatedBy?: keyof Pick<
    AppSettings,
    'windowWalking' | 'cursorInteractions' | 'characterInteractions'
  >;
  eligible(env: OverlayEnv, pet: PetHandle, pets: PetHandle[]): boolean;
  run(ctx: BehaviorCtx): Promise<void>;
}

/* --------------------------------- helpers --------------------------------- */

/** Abort-aware sleep; resolves early (never rejects) when the signal fires. */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

/** Wait until the pet is back on a surface (after fall()). */
export async function settle(pet: PetHandle, signal: AbortSignal): Promise<void> {
  while (!signal.aborted && !pet.grounded && !pet.hidden && pet.state !== 'dragging') {
    await wait(90, signal);
  }
}

/** v1 walk-distance randomization: rand(w/6) + w/6. */
export function v1WalkDistance(width: number): number {
  return Math.floor(Math.random() * (width / 6)) + Math.floor(width / 6);
}

/**
 * Windows a pet can calmly climb from the floor (hops were removed, so
 * anything floating high above its monitor's floor is not walkable). When a
 * pet is given, only windows overlapping the pet's CURRENT monitor count —
 * ambient behaviors never drag a pet onto another screen.
 */
function windowPlatforms(env: OverlayEnv, pet?: PetHandle): Platform[] {
  const m = pet ? monitorOf(env, pet) : null;
  return env.platforms.filter(
    (p) => climbEligible(p, env) && (!m || (p.right > m.left && p.left < m.right)),
  );
}

function center(p: PetHandle): number {
  return p.x + p.size / 2;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Which union-outer edges the pet's monitor owns (screen-edge climbing only
 * exists on the leftmost monitor's left and the rightmost monitor's right).
 */
function reachableOuterSides(env: OverlayEnv, pet: PetHandle): Array<'left' | 'right'> {
  const m = monitorOf(env, pet);
  const sides: Array<'left' | 'right'> = [];
  if (touchesOuterEdge(env, m, 'left')) sides.push('left');
  if (touchesOuterEdge(env, m, 'right')) sides.push('right');
  return sides;
}

function pickOuterSide(env: OverlayEnv, pet: PetHandle): EdgeSide | null {
  const sides = reachableOuterSides(env, pet);
  if (!sides.length) return null;
  if (sides.length === 1) return sides[0];
  const m = monitorOf(env, pet);
  return center(pet) < (m.left + m.right) / 2 ? 'left' : 'right';
}

function outerEdgeX(env: OverlayEnv, side: EdgeSide, petSize: number): number {
  return side === 'left'
    ? leftmostMonitor(env).left
    : rightmostMonitor(env).right - petSize;
}

function cursorMovedRecently(env: OverlayEnv, ms: number): boolean {
  return (
    env.cursor.lastMovedAt > 0 && performance.now() - env.cursor.lastMovedAt < ms
  );
}

function cursorOnScreen(env: OverlayEnv): boolean {
  const c = env.cursor;
  return c.x >= 0 && c.x <= env.width && c.y >= 0 && c.y <= env.height;
}

/** Cursor inside the pet's own monitor (walk-to-cursor behaviors stay home). */
function cursorOnPetMonitor(env: OverlayEnv, pet: PetHandle): boolean {
  if (!cursorOnScreen(env)) return false;
  const m = monitorOf(env, pet);
  const c = env.cursor;
  return c.x >= m.left && c.x < m.right && c.y >= m.top && c.y <= m.bottom;
}

/**
 * E3 window dismount variety: when a window-top behavior finishes, randomly
 * either climb back down the window's side (the mount in reverse) or do the
 * classic walk-off-the-edge fall.
 */
export async function leavePlatform(pet: PetHandle, signal: AbortSignal): Promise<void> {
  if (!signal.aborted && Math.random() < 0.5) {
    if (await pet.dismountPlatform()) return;
  }
  if (signal.aborted) return;
  pet.fall();
  await settle(pet, signal);
}

/* --------------------------------- catalog --------------------------------- */

export const BEHAVIORS: BehaviorDef[] = [
  /* 1 — the v1 walk */
  {
    id: 'wander-walk',
    weight: 3,
    cooldownMs: 0,
    locks: [],
    participants: 1,
    eligible: (_env, pet) => pet.grounded,
    run: async ({ env, pet }) => {
      // Wander range is the pet's CURRENT monitor — a pet placed on screen 2
      // stays on screen 2 (screen-hop is the only sanctioned crossing).
      const m = monitorOf(env, pet);
      const dir = Math.random() < 0.5 ? -1 : 1;
      const target = pet.x + dir * v1WalkDistance(m.right - m.left);
      await pet.walkTo(monitorClampX(m, target, pet.size));
    },
  },

  /* 2 — the v1 wall/top climb with midpoint coin flips (inside Pet) */
  {
    id: 'edge-climb',
    weight: 1.5,
    cooldownMs: 20_000,
    locks: [],
    participants: 1,
    // Climbable walls are the union's OUTER edges — the pet's monitor must
    // own one (on a middle monitor of three there is nothing to climb).
    eligible: (env, pet) =>
      pet.platform?.kind === 'floor' && reachableOuterSides(env, pet).length > 0,
    run: async ({ env, pet, signal }) => {
      const side = pickOuterSide(env, pet);
      if (!side || side === 'top') return;
      const edgeM = side === 'left' ? leftmostMonitor(env) : rightmostMonitor(env);
      if (!(await pet.walkTo(outerEdgeX(env, side, pet.size))) || signal.aborted) return;
      const reachedTop = await pet.climbEdge(side, edgeM.top);
      if (signal.aborted) return;
      if (reachedTop && Math.random() < 0.6) {
        // Traverse the top bar toward the middle (more coin flips inside).
        await pet.climbEdge('top', edgeM.left + (edgeM.right - edgeM.left) * rand(0.3, 0.7));
      }
      if (signal.aborted) return;
      if (!pet.grounded) pet.fall();
      await settle(pet, signal);
    },
  },

  /* 3 */
  {
    id: 'idle-action',
    weight: 2,
    cooldownMs: 4_000,
    locks: [],
    participants: 1,
    eligible: (_env, pet) => pet.grounded,
    run: async ({ pet }) => {
      await pet.playIdle();
    },
  },

  /* 4 */
  {
    id: 'special-action',
    weight: 2,
    cooldownMs: 6_000,
    locks: [],
    participants: 1,
    eligible: (_env, pet) => pet.grounded,
    run: async ({ pet }) => {
      await pet.playSpecial();
    },
  },

  /* 5 — hop onto a native window's top edge and stroll across */
  {
    id: 'window-top-walk',
    weight: 1.2,
    cooldownMs: 25_000,
    locks: ['window-walk'],
    participants: 1,
    gatedBy: 'windowWalking',
    eligible: (env, pet) => pet.grounded && windowPlatforms(env, pet).length > 0,
    run: async ({ env, pet, signal, data }) => {
      const plats = windowPlatforms(env, pet);
      if (!plats.length) return;
      const p = (data as Platform | undefined) ?? pickOne(plats);
      const entry = p.left + (p.right - p.left) * rand(0.2, 0.8);
      if (!(await pet.hopToPlatform(p, entry - pet.size / 2))) return;
      const passes = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < passes && !signal.aborted; i++) {
        const target = i % 2 === 0 ? p.right - pet.size : p.left;
        if (!(await pet.walkTo(target))) return;
        await wait(rand(400, 1200), signal);
      }
      await leavePlatform(pet, signal);
    },
  },

  /* 6 — sit idle at a window corner */
  {
    id: 'window-sill-sit',
    weight: 0.8,
    cooldownMs: 30_000,
    locks: ['window-sit'],
    participants: 1,
    gatedBy: 'windowWalking',
    eligible: (env, pet) => pet.grounded && windowPlatforms(env, pet).length > 0,
    run: async ({ env, pet, signal }) => {
      const plats = windowPlatforms(env, pet);
      if (!plats.length) return;
      const p = pickOne(plats);
      const leftCorner = Math.random() < 0.5;
      const cornerX = leftCorner ? p.left : p.right - pet.size;
      if (!(await pet.hopToPlatform(p, cornerX))) return;
      pet.face(leftCorner ? 'left' : 'right'); // gaze off the edge
      await pet.playIdle();
      if (signal.aborted) return;
      await pet.playIdle();
      await leavePlatform(pet, signal);
    },
  },

  /* 7 — peek over a window edge, then slip away */
  {
    id: 'window-peek',
    weight: 0.6,
    cooldownMs: 45_000,
    locks: [],
    participants: 1,
    gatedBy: 'windowWalking',
    eligible: (env, pet) => pet.grounded && windowPlatforms(env, pet).length > 0,
    run: async ({ env, pet, signal }) => {
      const plats = windowPlatforms(env, pet);
      if (!plats.length) return;
      const p = pickOne(plats);
      const fromLeft = center(pet) < (p.left + p.right) / 2;
      const cornerX = fromLeft ? p.left : p.right - pet.size;
      if (!(await pet.hopToPlatform(p, cornerX))) return;
      pet.face(fromLeft ? 'right' : 'left'); // peer across the window top
      await wait(rand(1200, 2400), signal);
      if (signal.aborted) return;
      await pet.playIdle();
      await leavePlatform(pet, signal);
    },
  },

  /* 8 — chase the cursor while it's far; give up politely */
  {
    id: 'cursor-chase',
    weight: 0.7,
    cooldownMs: 30_000,
    locks: ['cursor'],
    participants: 1,
    gatedBy: 'cursorInteractions',
    eligible: (env, pet) =>
      pet.grounded &&
      cursorOnPetMonitor(env, pet) &&
      cursorMovedRecently(env, 4_000) &&
      Math.abs(env.cursor.x - center(pet)) > 300,
    run: async ({ env, pet, signal }) => {
      const deadline = performance.now() + 6_000;
      while (!signal.aborted && performance.now() < deadline) {
        // The cursor wandered off to another screen — give up politely.
        if (!cursorOnPetMonitor(env, pet)) break;
        const dx = env.cursor.x - center(pet);
        if (Math.abs(dx) <= 60) break;
        // Chase in short segments so a moving cursor keeps re-aiming us.
        const stepTo = center(pet) + Math.max(-140, Math.min(140, dx));
        const stop =
          dx > 0 ? Math.min(stepTo, env.cursor.x - 40) : Math.max(stepTo, env.cursor.x + 40);
        if (!(await pet.walkTo(stop - pet.size / 2))) return;
      }
      if (!signal.aborted) await pet.playIdle(); // arrival ponder / polite give-up
    },
  },

  /* 9 — face the cursor from afar */
  {
    id: 'cursor-watch',
    weight: 1,
    cooldownMs: 15_000,
    locks: [],
    participants: 1,
    gatedBy: 'cursorInteractions',
    eligible: (env, pet) => pet.grounded && cursorOnScreen(env),
    run: async ({ env, pet, signal }) => {
      const until = performance.now() + rand(4_000, 8_000);
      while (!signal.aborted && performance.now() < until) {
        pet.face(env.cursor.x < center(pet) ? 'left' : 'right');
        await wait(280, signal);
      }
    },
  },

  /* 10 — walk to an idle cursor and think about it */
  {
    id: 'inspect-cursor',
    weight: 0.8,
    cooldownMs: 40_000,
    locks: ['cursor'],
    participants: 1,
    gatedBy: 'cursorInteractions',
    eligible: (env, pet) =>
      pet.grounded &&
      cursorOnPetMonitor(env, pet) &&
      env.cursor.lastMovedAt > 0 &&
      performance.now() - env.cursor.lastMovedAt > 5_000,
    run: async ({ env, pet, signal }) => {
      const fromLeft = center(pet) < env.cursor.x;
      const target = fromLeft ? env.cursor.x - 34 - pet.size : env.cursor.x + 34;
      if (!(await pet.walkTo(target)) || signal.aborted) return;
      pet.face(env.cursor.x < center(pet) ? 'left' : 'right');
      await pet.playIdle(); // "thinking"
    },
  },

  /* 11 — two pets walk together */
  {
    id: 'side-by-side-stroll',
    weight: 0.9,
    cooldownMs: 45_000,
    locks: [],
    participants: 2,
    gatedBy: 'characterInteractions',
    eligible: (_env, pet) => pet.grounded,
    run: async ({ env, pet, partner, signal }) => {
      if (!partner) return;
      // The director only pairs same-monitor pets; keep the stroll there too.
      const m = monitorOf(env, pet);
      const gap = pet.size + 14;
      const meetX = Math.min(Math.max(pet.x, m.left), m.right - gap - partner.size);
      await Promise.all([pet.walkTo(meetX), partner.walkTo(meetX + gap)]);
      if (signal.aborted) return;
      const dir = meetX > (m.left + m.right) / 2 ? -1 : 1;
      const dist = v1WalkDistance(m.right - m.left);
      await Promise.all([
        pet.walkTo(monitorClampX(m, pet.x + dir * dist, pet.size)),
        partner.walkTo(monitorClampX(m, partner.x + dir * dist, partner.size)),
      ]);
    },
  },

  /* 12 — walk to each other, face off, emit 'meet' (runtime starts crosstalk) */
  {
    id: 'meet-and-greet',
    weight: 0.9,
    cooldownMs: 60_000,
    locks: [],
    participants: 2,
    gatedBy: 'characterInteractions',
    eligible: (_env, pet) => pet.grounded,
    run: async ({ director, pet, partner, signal }) => {
      if (!partner) return;
      const leftPet = pet.x <= partner.x ? pet : partner;
      const rightPet = leftPet === pet ? partner : pet;
      const mid = (center(leftPet) + center(rightPet)) / 2;
      await Promise.all([
        leftPet.walkTo(mid - leftPet.size - 8),
        rightPet.walkTo(mid + 8),
      ]);
      if (signal.aborted) return;
      leftPet.face('right');
      rightPet.face('left');
      director.emit({ type: 'meet', pets: [pet.rec.name, partner.rec.name] });
      await Promise.all([pet.playIdle(), partner.playIdle()]);
      await wait(600, signal);
    },
  },

  /* 13 — one leads, the rest trail behind */
  {
    id: 'follow-the-leader',
    weight: 0.6,
    cooldownMs: 90_000,
    locks: [],
    participants: 'all',
    gatedBy: 'characterInteractions',
    eligible: (_env, pet, pets) => pet.grounded && pets.length >= 2,
    run: async ({ env, pet, pets, signal }) => {
      const followers = pets.filter((p) => p !== pet);
      if (!followers.length) return;
      const m = monitorOf(env, pet); // director reserves same-monitor pets
      for (let leg = 0; leg < 2 && !signal.aborted; leg++) {
        const target = rand(m.left, Math.max(m.left + 1, m.right - pet.size));
        const behind = target >= pet.x ? -1 : 1;
        await Promise.all<unknown>([
          pet.walkTo(target),
          ...followers.map(async (f, i) => {
            await wait(320 * (i + 1), signal);
            if (signal.aborted) return false;
            return f.walkTo(
              monitorClampX(m, target + behind * (i + 1) * (f.size * 0.9), f.size),
            );
          }),
        ]);
      }
    },
  },

  /* 14 — synced special actions */
  {
    id: 'mirror-dance',
    weight: 0.5,
    cooldownMs: 60_000,
    locks: [],
    participants: 2,
    gatedBy: 'characterInteractions',
    eligible: (_env, pet) => pet.grounded,
    run: async ({ pet, partner, signal }) => {
      if (!partner) return;
      pet.face(partner.x < pet.x ? 'left' : 'right');
      partner.face(pet.x < partner.x ? 'left' : 'right');
      for (let i = 0; i < 2 && !signal.aborted; i++) {
        await Promise.all([pet.playSpecial(), partner.playSpecial()]);
      }
    },
  },

  /* 15 — rare all-pets line march across the bottom of the screen */
  {
    id: 'taskbar-parade',
    weight: 0.2,
    cooldownMs: 300_000,
    locks: ['parade'],
    participants: 'all',
    gatedBy: 'characterInteractions',
    eligible: (_env, pet, pets) => pet.grounded && pets.length >= 2,
    run: async ({ env, pet, pets, signal }) => {
      const m = monitorOf(env, pet); // parade spans the initiator's monitor
      const line = [...pets].sort((a, b) => a.x - b.x);
      const leftToRight = Math.random() < 0.5;
      const dir = leftToRight ? 1 : -1;
      const startX = leftToRight ? m.left + 30 : m.right - 30 - line[0].size;
      await Promise.all(
        line.map((p, i) =>
          p.walkTo(monitorClampX(m, startX + dir * i * (p.size + 16), p.size)),
        ),
      );
      if (signal.aborted) return;
      const endX = leftToRight ? m.right - 60 - line[0].size : m.left + 60;
      await Promise.all(
        line.map(async (p, i) => {
          await wait(i * 260, signal);
          if (signal.aborted) return false;
          return p.walkTo(monitorClampX(m, endX - dir * i * (p.size + 16), p.size));
        }),
      );
    },
  },

  /* 16 — walk to an edge, scale it partway, come back */
  {
    id: 'screen-edge-patrol',
    weight: 0.7,
    cooldownMs: 60_000,
    locks: [],
    participants: 1,
    eligible: (env, pet) =>
      pet.platform?.kind === 'floor' && reachableOuterSides(env, pet).length > 0,
    run: async ({ env, pet, signal }) => {
      const side = pickOuterSide(env, pet);
      if (!side || side === 'top') return;
      const m = side === 'left' ? leftmostMonitor(env) : rightmostMonitor(env);
      if (!(await pet.walkTo(outerEdgeX(env, side, pet.size))) || signal.aborted) return;
      // Stay below the midpoint so the v1 coin flip never triggers here.
      const partway = m.top + (m.floorY - m.top) * 0.55;
      if (!(await pet.climbEdge(side, partway)) || signal.aborted) return;
      await wait(rand(500, 1100), signal);
      if (signal.aborted) return;
      if (!(await pet.climbEdge(side, m.floorY - pet.size)) || signal.aborted) return;
      const inward = side === 'left' ? 1 : -1;
      await pet.walkTo(
        monitorClampX(m, pet.x + inward * v1WalkDistance(m.right - m.left), pet.size),
      );
    },
  },

  /* 17 — EVENT: a new window appeared; the nearest pet investigates */
  {
    id: 'new-window-curiosity',
    weight: 1.5,
    cooldownMs: 10_000,
    locks: [],
    participants: 1,
    gatedBy: 'windowWalking',
    eligible: () => false, // director-triggered (candidate pets share the monitor)
    run: async ({ env, pet, signal, data }) => {
      const p = (data as Platform | undefined) ?? windowPlatforms(env, pet)[0];
      if (!p) return;
      const cx = (p.left + p.right) / 2;
      if (!(await pet.walkTo(cx - pet.size / 2)) || signal.aborted) return;
      pet.face(center(pet) < cx ? 'right' : 'left');
      await pet.playIdle(); // size it up
      if (signal.aborted) return;
      if (Math.random() < 0.5) {
        if (await pet.hopToPlatform(p, cx - pet.size / 2)) {
          await wait(rand(900, 2200), signal);
          if (!signal.aborted) await pet.walkTo(p.right - pet.size);
          pet.fall();
          await settle(pet, signal);
        }
      }
    },
  },

  /* 18 — EVENT: morning stretch (5-9) / midnight yawn (23-2), once per period */
  {
    id: 'time-of-day',
    weight: 1,
    cooldownMs: 30_000,
    locks: [],
    participants: 1,
    eligible: () => false, // director-triggered with data 'morning' | 'night'
    run: async ({ pet, signal, data }) => {
      if (data === 'morning') {
        await pet.playSpecial(); // stretch
      } else {
        await pet.playIdle(); // yawn…
        if (signal.aborted) return;
        await wait(400, signal);
        await pet.playIdle(); // …and blink slowly
      }
    },
  },

  /* 19 — EVENT: user idle → nap until the cursor returns, then greet */
  {
    id: 'idle-nap',
    weight: 1,
    cooldownMs: 30_000,
    locks: [],
    participants: 1,
    eligible: () => false, // director-triggered on cursor idle
    run: async ({ env, pet, signal }) => {
      const sleptAt = env.cursor.lastMovedAt;
      pet.sleep(); // emits 'slept'
      while (!signal.aborted && env.cursor.lastMovedAt === sleptAt && !pet.hidden) {
        await wait(500, signal);
      }
      pet.wake(); // emits 'woke'
      if (!signal.aborted) await pet.playSpecial(); // wake-up greeting
    },
  },

  /* 20 — EVENT: thrown hard → dizzy wobble after landing */
  {
    id: 'dizzy-tumble',
    weight: 1,
    cooldownMs: 5_000,
    locks: [],
    participants: 1,
    eligible: () => false, // director-triggered after 'thrown' > 25 lands
    run: async ({ pet, signal }) => {
      await pet.playSpecial();
      if (signal.aborted) return;
      await wait(300, signal);
    },
  },

  /* 21 — RARE: hop across to the adjacent monitor (multi-monitor only).
   * The pet walks to the shared boundary, takes an idle beat, then does ONE
   * gentle low arc onto the neighbor's floor and resumes wandering there.
   * The single sanctioned crossing between monitors — and deliberately rare
   * so it never starves edge-climbs or the rest of the catalog. */
  {
    id: 'screen-hop',
    weight: 0.25,
    // Global spacing between hops of ANY pet; the 15-minute limit is
    // enforced per-pet via lastScreenHopAt below.
    cooldownMs: 60_000,
    locks: [],
    participants: 1,
    eligible: (env, pet) => {
      if (monitorList(env).length < 2) return false;
      if (pet.platform?.kind !== 'floor') return false;
      const last = lastScreenHopAt.get(pet.rec.name);
      if (last !== undefined && performance.now() - last < SCREEN_HOP_PET_COOLDOWN_MS) {
        return false;
      }
      return hopDirections(env, pet).length > 0;
    },
    run: async ({ env, pet, signal }) => {
      const dirs = hopDirections(env, pet);
      if (!dirs.length) return;
      lastScreenHopAt.set(pet.rec.name, performance.now());
      const dir = pickOne(dirs);
      const m = monitorOf(env, pet);
      // Stand flush against the shared boundary.
      const standX = dir > 0 ? m.right - pet.size : m.left;
      if (!(await pet.walkTo(standX)) || signal.aborted) return;
      pet.face(dir > 0 ? 'right' : 'left');
      await wait(rand(500, 1000), signal); // idle beat at the edge
      if (signal.aborted) return;
      if (!(await pet.hopAcross(dir)) || signal.aborted) return;
      // Resume wandering on the new monitor.
      const nm = monitorOf(env, pet);
      await pet.walkTo(monitorClampX(nm, pet.x + dir * rand(60, 160), pet.size));
    },
  },
];

/** screen-hop per-pet cooldown bookkeeping (15 min per pet). */
const SCREEN_HOP_PET_COOLDOWN_MS = 15 * 60_000;
const lastScreenHopAt = new Map<string, number>();

/** Directions in which the pet's monitor has a hop-able neighbor floor. */
function hopDirections(env: OverlayEnv, pet: PetHandle): Array<1 | -1> {
  const m: MonitorRegion = monitorOf(env, pet);
  const out: Array<1 | -1> = [];
  for (const dir of [1, -1] as const) {
    const n = neighborMonitor(env, m, dir);
    // Lower/equal neighbor floors are always hop-able (the arc simply falls
    // further); raised ones only within the small step the low arc clears.
    if (n && m.floorY - n.floorY <= MAX_HOP_STEP_UP) out.push(dir);
  }
  return out;
}

export const BEHAVIORS_BY_ID: ReadonlyMap<string, BehaviorDef> = new Map(
  BEHAVIORS.map((b) => [b.id, b]),
);
