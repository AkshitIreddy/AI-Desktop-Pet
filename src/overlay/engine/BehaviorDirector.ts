/**
 * BehaviorDirector — the single scheduler that owns every Pet. The runtime
 * calls director.tick(now) from its one rAF loop; everything else (idle-gap
 * sampling, weighted behavior picks, locks, joint reservations, cooldowns,
 * variety de-weighting, personal space, pins, skill-driven behaviors,
 * reactive events) happens here.
 */
import type { CharacterRecord, AppSettings, Platform, SkillId } from '../../shared/types';
import type { DirectorApi, DirectorEvent, OverlayEnv, PetHandle } from './api';
import {
  BEHAVIORS,
  BEHAVIORS_BY_ID,
  wait,
  type BehaviorCtx,
  type BehaviorDef,
  type DirectorLink,
} from './behaviors';
import { hitRegionRegistry } from './hitRegions';
import { onWindowAppeared, startPlatforms, windowTitle } from './platforms';
import { climbEligible, Pet, THROW_SPEED } from './PetEngine';

/** Hit-region padding around each pet's bbox (logical px). */
const PET_HIT_PAD = 10;
/** hide-skill duration. */
const HIDE_MS = 15 * 60_000;
/** Personal space: overlap fraction / dwell before a sidestep. */
const OVERLAP_FRACTION = 0.4;
const OVERLAP_DWELL_MS = 2_000;
const SIDESTEP_COOLDOWN_MS = 5_000;

export interface DirectorHandle extends DirectorApi {
  tick(now: number): void;
  beginDrag(name: string): void;
  dragTo(name: string, x: number, y: number): void;
  endDrag(name: string, vx: number, vy: number): void;
}

interface PetMeta {
  spawnSeq: number;
  nextDecisionAt: number;
  /** Last 5 behavior ids — de-weighted ×0.25 on the next pick. */
  recent: string[];
  claimedBy: number | null;
  pendingDizzy: boolean;
  periodsDone: Set<string>;
  sidestepAt: number;
}

interface RunningInstance {
  id: number;
  behavior: string;
  ctrl: AbortController;
  pets: Pet[];
  locks: string[];
}

interface SkillLoop {
  ctrl: AbortController;
  inst: number;
  pet: Pet;
}

class Director implements DirectorLink, DirectorHandle {
  readonly env: OverlayEnv;

  private petsMap = new Map<string, Pet>();
  private metas = new Map<string, PetMeta>();
  private eventCbs = new Set<(ev: DirectorEvent) => void>();
  private locks = new Map<string, number>();
  private cooldownUntil = new Map<string, number>();
  private running = new Map<number, RunningInstance>();
  private skillLoops = new Map<string, SkillLoop>();
  private windowQueue: Platform[] = [];
  private dizzyQueue: string[] = [];
  private overlapSince = new Map<string, number>();
  private suspended = false;
  private seq = 0;
  private spawnSeq = 0;

  constructor(env: OverlayEnv) {
    this.env = env;
    startPlatforms({
      env,
      shouldPoll: () => this.env.settings.windowWalking && this.petsMap.size > 0,
      onUpdate: (ps) => {
        this.env.platforms = ps;
      },
    });
    onWindowAppeared((p) => {
      if (this.windowQueue.length < 4) this.windowQueue.push(p);
    });
  }

  get pets(): ReadonlyMap<string, PetHandle> {
    return this.petsMap;
  }

  /* -------------------------------- lifecycle -------------------------------- */

  spawn(rec: CharacterRecord): PetHandle {
    const existing = this.petsMap.get(rec.name);
    if (existing) return existing;
    const pet = new Pet(rec, this.env, {
      emit: (ev) => this.handlePetEvent(ev),
      windowTitle: (id) => windowTitle(id),
    });
    this.petsMap.set(rec.name, pet);
    this.metas.set(rec.name, {
      spawnSeq: ++this.spawnSeq,
      nextDecisionAt: performance.now() + 2_500 + Math.random() * 2_500,
      recent: [],
      claimedBy: null,
      pendingDizzy: false,
      periodsDone: new Set(),
      sidestepAt: 0,
    });
    return pet;
  }

  despawn(name: string): void {
    const pet = this.petsMap.get(name);
    if (!pet) return;
    this.abortFor(pet);
    for (const [key, loop] of this.skillLoops) {
      if (loop.pet === pet) {
        loop.ctrl.abort();
        this.skillLoops.delete(key);
      }
    }
    pet.interrupt();
    hitRegionRegistry.set(`pet:${name}`, null);
    this.petsMap.delete(name);
    this.metas.delete(name);
  }

  onEvent(cb: (ev: DirectorEvent) => void): () => void {
    this.eventCbs.add(cb);
    return () => {
      this.eventCbs.delete(cb);
    };
  }

  emit(ev: DirectorEvent): void {
    for (const cb of this.eventCbs) {
      try {
        cb(ev);
      } catch {
        // listener errors must never break the tick loop
      }
    }
  }

  applySettings(settings: AppSettings): void {
    this.env.settings = settings;
    for (const pet of this.petsMap.values()) pet.applySettings();
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  /* ------------------------------- drag relay ------------------------------- */

  beginDrag(name: string): void {
    const pet = this.petsMap.get(name);
    if (!pet || pet.hidden) return;
    this.abortFor(pet);
    pet.beginDrag(); // emits 'picked-up'
  }

  dragTo(name: string, x: number, y: number): void {
    this.petsMap.get(name)?.dragTo(x, y);
  }

  endDrag(name: string, vx: number, vy: number): void {
    this.petsMap.get(name)?.endDrag(vx, vy); // emits 'thrown'
  }

  /* --------------------------------- ticking --------------------------------- */

  tick(now: number): void {
    const dt = 16;
    for (const pet of this.petsMap.values()) pet.tick(now, dt);
    for (const [name, pet] of this.petsMap) {
      if (pet.hidden) {
        hitRegionRegistry.set(`pet:${name}`, null);
      } else {
        const b = pet.bbox();
        hitRegionRegistry.set(`pet:${name}`, {
          x: b.x - PET_HIT_PAD,
          y: b.y - PET_HIT_PAD,
          w: b.w + PET_HIT_PAD * 2,
          h: b.h + PET_HIT_PAD * 2,
        });
      }
    }
    if (this.suspended) return;
    this.reactives(now);
    this.personalSpace(now);
    this.schedule(now);
  }

  /* ---------------------------- reactive triggers ---------------------------- */

  private reactives(now: number): void {
    // dizzy-tumble: thrown hard, now landed
    while (this.dizzyQueue.length) {
      const name = this.dizzyQueue.shift();
      const pet = name ? this.petsMap.get(name) : undefined;
      if (pet && this.isFree(pet)) this.trigger('dizzy-tumble', pet, undefined, 'dizzy');
    }

    // new-window-curiosity: nearest free pet investigates
    if (this.windowQueue.length && this.env.settings.windowWalking) {
      const p = this.windowQueue.shift();
      if (p) {
        const cx = (p.left + p.right) / 2;
        const candidates = [...this.petsMap.values()]
          .filter((q) => this.isFree(q))
          .sort(
            (a, b) =>
              Math.abs(a.x + a.size / 2 - cx) - Math.abs(b.x + b.size / 2 - cx),
          );
        if (candidates.length) {
          this.trigger(
            'new-window-curiosity',
            candidates[0],
            p,
            p.windowId !== undefined ? windowTitle(p.windowId) : undefined,
          );
        }
      }
    }

    // time-of-day: once per period per pet (5-9 stretch, 23-2 yawn)
    const d = new Date();
    const h = d.getHours();
    const period = h >= 5 && h < 9 ? 'morning' : h >= 23 || h < 2 ? 'night' : null;
    if (period) {
      const anchor = new Date(d);
      if (period === 'night' && h < 2) anchor.setDate(anchor.getDate() - 1);
      const key = `${period}:${anchor.getFullYear()}-${anchor.getMonth()}-${anchor.getDate()}`;
      for (const pet of this.petsMap.values()) {
        const meta = this.metas.get(pet.rec.name);
        if (!meta || meta.periodsDone.has(key) || !this.isFree(pet)) continue;
        meta.periodsDone.add(key);
        this.trigger('time-of-day', pet, period, period);
        break; // one pet per tick; the rest follow on later ticks
      }
    }

    // idle-nap: user idle for idleSleepMinutes
    const mins = this.env.settings.idleSleepMinutes;
    if (mins > 0 && this.env.cursor.lastMovedAt > 0) {
      if (now - this.env.cursor.lastMovedAt > mins * 60_000) {
        for (const pet of this.petsMap.values()) {
          if (pet.state !== 'sleeping' && this.isFree(pet)) {
            this.trigger('idle-nap', pet);
          }
        }
      }
    }
  }

  /* ------------------------------ personal space ----------------------------- */

  private personalSpace(now: number): void {
    const arr = [...this.petsMap.values()].filter(
      (p) =>
        !p.hidden &&
        p.grounded &&
        !p.pinned &&
        p.state !== 'sleeping' &&
        p.state !== 'dragging',
    );
    const seen = new Set<string>();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        const key = `${a.rec.name}|${b.rec.name}`;
        seen.add(key);
        if (overlapFraction(a, b) > OVERLAP_FRACTION) {
          const since = this.overlapSince.get(key) ?? now;
          if (!this.overlapSince.has(key)) this.overlapSince.set(key, now);
          if (now - since > OVERLAP_DWELL_MS) {
            const later =
              (this.metas.get(a.rec.name)?.spawnSeq ?? 0) >
              (this.metas.get(b.rec.name)?.spawnSeq ?? 0)
                ? a
                : b;
            const other = later === a ? b : a;
            const meta = this.metas.get(later.rec.name);
            if (meta && this.isFree(later) && now > meta.sidestepAt) {
              const dir = later.x + later.size / 2 >= other.x + other.size / 2 ? 1 : -1;
              void later.walkTo(later.x + dir * (60 + Math.random() * 60));
              meta.sidestepAt = now + SIDESTEP_COOLDOWN_MS;
            }
            this.overlapSince.delete(key);
          }
        } else {
          this.overlapSince.delete(key);
        }
      }
    }
    for (const key of this.overlapSince.keys()) {
      if (!seen.has(key)) this.overlapSince.delete(key);
    }
  }

  /* -------------------------------- scheduling ------------------------------- */

  private schedule(now: number): void {
    for (const pet of this.petsMap.values()) {
      const meta = this.metas.get(pet.rec.name);
      if (!meta || now < meta.nextDecisionAt) continue;
      if (!this.isFree(pet)) continue;
      if (!this.pickAndStart(pet, now)) {
        meta.nextDecisionAt = now + 1_500 + Math.random() * 1_500;
      }
    }
  }

  private pickAndStart(pet: Pet, now: number): boolean {
    const meta = this.metas.get(pet.rec.name);
    if (!meta) return false;
    const all = [...this.petsMap.values()];
    const othersFree = all.filter((p) => p !== pet && this.isFree(p));
    const candidates: { def: BehaviorDef; weight: number }[] = [];
    for (const def of BEHAVIORS) {
      if (def.weight <= 0) continue;
      if (def.gatedBy && !this.env.settings[def.gatedBy]) continue;
      if ((this.cooldownUntil.get(def.id) ?? 0) > now) continue;
      if (def.locks.some((l) => this.locks.has(l))) continue;
      if (def.participants !== 1 && othersFree.length === 0) continue;
      if (!def.eligible(this.env, pet, all)) continue;
      const w = def.weight * (meta.recent.includes(def.id) ? 0.25 : 1);
      candidates.push({ def, weight: w });
    }
    if (!candidates.length) return false;
    const total = candidates.reduce((s, c) => s + c.weight, 0);
    let roll = Math.random() * total;
    let chosen = candidates[candidates.length - 1].def;
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) {
        chosen = c.def;
        break;
      }
    }
    return this.startBehavior(chosen, pet, now);
  }

  private trigger(id: string, pet: Pet, data?: unknown, detail?: string): void {
    const def = BEHAVIORS_BY_ID.get(id);
    if (!def) return;
    const now = performance.now();
    if ((this.cooldownUntil.get(id) ?? 0) > now) return;
    if (def.gatedBy && !this.env.settings[def.gatedBy]) return;
    if (def.locks.some((l) => this.locks.has(l))) return;
    if (!this.isFree(pet)) return;
    this.startBehavior(def, pet, now, data, detail);
  }

  private startBehavior(
    def: BehaviorDef,
    pet: Pet,
    now: number,
    data?: unknown,
    detail?: string,
  ): boolean {
    // Joint reservations: every participant idle+unpinned+visible, or no start.
    let partner: Pet | undefined;
    const participants: Pet[] = [pet];
    if (def.participants === 2) {
      partner = this.nearestFreeOther(pet);
      if (!partner) return false;
      participants.push(partner);
    } else if (def.participants === 'all') {
      const others = [...this.petsMap.values()].filter(
        (p) => p !== pet && this.isFree(p),
      );
      if (!others.length) return false;
      participants.push(...others);
    }

    const inst = ++this.seq;
    for (const lock of def.locks) this.locks.set(lock, inst);
    for (const p of participants) {
      const m = this.metas.get(p.rec.name);
      if (m) m.claimedBy = inst;
    }
    this.cooldownUntil.set(def.id, now + def.cooldownMs);
    this.pushRecent(pet, def.id);
    if (partner) this.pushRecent(partner, def.id);

    const ctrl = new AbortController();
    this.running.set(inst, {
      id: inst,
      behavior: def.id,
      ctrl,
      pets: participants,
      locks: def.locks,
    });
    this.emit({
      type: 'behavior-start',
      pet: pet.rec.name,
      behavior: def.id,
      detail: detail ?? (typeof data === 'string' ? data : undefined),
    });
    const ctx: BehaviorCtx = {
      director: this,
      env: this.env,
      pet,
      partner,
      pets: participants,
      signal: ctrl.signal,
      data,
    };
    void def
      .run(ctx)
      .catch(() => {})
      .finally(() => this.finishInstance(inst, pet.rec.name, def.id));
    return true;
  }

  private finishInstance(inst: number, petName: string, behavior: string): void {
    const run = this.running.get(inst);
    this.running.delete(inst);
    if (run) {
      for (const lock of run.locks) {
        if (this.locks.get(lock) === inst) this.locks.delete(lock);
      }
      const now = performance.now();
      for (const p of run.pets) {
        const m = this.metas.get(p.rec.name);
        if (m && m.claimedBy === inst) {
          m.claimedBy = null;
          m.nextDecisionAt = now + this.sampleGap();
        }
      }
    }
    this.emit({ type: 'behavior-end', pet: petName, behavior });
  }

  /** Abort every running behavior instance that involves this pet. */
  private abortFor(pet: Pet): void {
    for (const run of [...this.running.values()]) {
      if (!run.pets.includes(pet)) continue;
      run.ctrl.abort();
      for (const p of run.pets) p.interrupt();
    }
  }

  /* ---------------------------------- skills --------------------------------- */

  runSkill(petName: string, skill: SkillId): void {
    const pet = this.petsMap.get(petName);
    if (!pet) return;
    switch (skill) {
      case 'follow-cursor':
        this.startFollowCursor(pet);
        break;
      case 'summon':
        this.runSummon(pet);
        break;
      case 'dance-party':
        this.runDanceParty(pet);
        break;
      case 'walk-my-window':
        this.runWalkMyWindow(pet);
        break;
      case 'teleport-home': {
        this.abortFor(pet);
        const hx = (pet.rec.homeX ?? 0.82) * this.env.width - pet.size / 2;
        pet.teleport(hx, this.env.height - pet.size);
        this.emit({ type: 'behavior-start', pet: petName, behavior: 'teleport-home' });
        this.emit({ type: 'behavior-end', pet: petName, behavior: 'teleport-home' });
        break;
      }
      case 'hide':
        this.abortFor(pet);
        pet.hide(HIDE_MS); // emits 'hidden' now, 'returned' later
        break;
      case 'do-a-trick':
        this.runOneShot(pet, 'do-a-trick', async () => {
          await pet.playSpecial();
        });
        break;
      case 'stay':
        this.abortFor(pet);
        this.stopFollowLoop(pet);
        pet.interrupt();
        pet.pin('stay');
        break;
      case 'sleep':
        this.abortFor(pet);
        pet.pin('sleep');
        pet.sleep(); // emits 'slept'
        break;
      case 'pomodoro':
        this.abortFor(pet);
        this.stopFollowLoop(pet);
        pet.pin('pomodoro');
        pet.sleep(); // sits quietly (sitting sprite, slow pulse)
        break;
      case 'wander':
        this.releasePet(pet);
        break;
      default:
        break; // chat/voice/vision/… are not movement skills
    }
  }

  stopSkill(petName: string, skill: SkillId): void {
    const pet = this.petsMap.get(petName);
    if (!pet) return;
    switch (skill) {
      case 'follow-cursor':
        this.stopFollowLoop(pet);
        pet.interrupt();
        break;
      case 'stay':
        pet.unpin('stay');
        break;
      case 'sleep':
        pet.unpin('sleep');
        pet.wake(); // emits 'woke'
        break;
      case 'pomodoro':
        pet.unpin('pomodoro');
        pet.wake();
        this.runOneShot(pet, 'pomodoro-celebrate', async () => {
          await pet.playSpecial(); // session finished — celebrate!
        });
        break;
      default:
        break;
    }
  }

  private releasePet(pet: Pet): void {
    this.stopFollowLoop(pet);
    pet.unpin('stay');
    pet.unpin('sleep');
    pet.unpin('pomodoro');
    if (pet.state === 'sleeping') pet.wake();
    const m = this.metas.get(pet.rec.name);
    if (m) m.nextDecisionAt = performance.now() + 500;
  }

  private runOneShot(
    pet: Pet,
    id: string,
    fn: (signal: AbortSignal) => Promise<void>,
  ): void {
    this.abortFor(pet);
    const inst = ++this.seq;
    const ctrl = new AbortController();
    const meta = this.metas.get(pet.rec.name);
    if (meta) meta.claimedBy = inst;
    this.running.set(inst, { id: inst, behavior: id, ctrl, pets: [pet], locks: [] });
    this.emit({ type: 'behavior-start', pet: pet.rec.name, behavior: id });
    void fn(ctrl.signal)
      .catch(() => {})
      .finally(() => this.finishInstance(inst, pet.rec.name, id));
  }

  private startFollowCursor(pet: Pet): void {
    const key = `${pet.rec.name}:follow-cursor`;
    if (this.skillLoops.has(key)) return;
    // The user's intent beats whatever ambient behavior holds the cursor lock.
    const holder = this.locks.get('cursor');
    if (holder !== undefined) {
      const run = this.running.get(holder);
      if (run) {
        run.ctrl.abort();
        for (const p of run.pets) p.interrupt();
      }
    }
    // Only one pet may own the cursor — stop any other follow loop.
    for (const [k, loop] of [...this.skillLoops]) {
      if (k.endsWith(':follow-cursor') && loop.pet !== pet) {
        loop.ctrl.abort();
        loop.pet.interrupt();
        this.skillLoops.delete(k);
      }
    }
    this.abortFor(pet);
    pet.interrupt();
    const inst = ++this.seq;
    this.locks.set('cursor', inst);
    const meta = this.metas.get(pet.rec.name);
    if (meta) meta.claimedBy = inst;
    const ctrl = new AbortController();
    this.skillLoops.set(key, { ctrl, inst, pet });
    this.emit({ type: 'behavior-start', pet: pet.rec.name, behavior: 'follow-cursor' });
    void this.followLoop(pet, inst, ctrl.signal).finally(() => {
      if (this.locks.get('cursor') === inst) this.locks.delete('cursor');
      const m = this.metas.get(pet.rec.name);
      if (m && m.claimedBy === inst) {
        m.claimedBy = null;
        m.nextDecisionAt = performance.now() + this.sampleGap();
      }
      this.skillLoops.delete(key);
      this.emit({ type: 'behavior-end', pet: pet.rec.name, behavior: 'follow-cursor' });
    });
  }

  private async followLoop(pet: Pet, inst: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && this.petsMap.has(pet.rec.name) && !pet.hidden) {
      const meta = this.metas.get(pet.rec.name);
      if (meta && meta.claimedBy === null) meta.claimedBy = inst; // re-claim after one-shots
      if (pet.state === 'dragging' || pet.pinned || !pet.grounded) {
        await wait(250, signal);
        continue;
      }
      const petCenter = pet.x + pet.size / 2;
      const dx = this.env.cursor.x - petCenter;
      if (Math.abs(dx) > 40 + pet.size / 2 + 24) {
        // Trail with easing: short re-aimed segments, stopping 40 px away.
        const eased = petCenter + Math.max(-150, Math.min(150, dx));
        const stop =
          dx > 0
            ? Math.min(eased, this.env.cursor.x - 40 - pet.size / 2)
            : Math.max(eased, this.env.cursor.x + 40 + pet.size / 2);
        await pet.walkTo(stop - pet.size / 2);
      } else {
        pet.face(dx < 0 ? 'left' : 'right');
        await wait(180, signal);
      }
    }
  }

  private stopFollowLoop(pet: Pet): void {
    const key = `${pet.rec.name}:follow-cursor`;
    const loop = this.skillLoops.get(key);
    if (loop) {
      loop.ctrl.abort();
      this.skillLoops.delete(key);
    }
  }

  private runSummon(caller: Pet): void {
    const movers = [...this.petsMap.values()].filter(
      (p) => p !== caller && !p.hidden && !p.pinned && p.state !== 'dragging',
    );
    if (!movers.length) return;
    for (const p of movers) this.abortFor(p);
    const inst = ++this.seq;
    const ctrl = new AbortController();
    for (const p of movers) {
      const m = this.metas.get(p.rec.name);
      if (m) m.claimedBy = inst;
    }
    this.running.set(inst, {
      id: inst,
      behavior: 'summon',
      ctrl,
      pets: movers,
      locks: [],
    });
    this.emit({ type: 'behavior-start', pet: caller.rec.name, behavior: 'summon' });
    const cx = caller.x + caller.size / 2;
    void Promise.all(
      movers.map(async (p, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const rank = Math.floor(i / 2) + 1;
        await p.walkTo(cx + side * rank * (p.size + 18) - p.size / 2);
        if (!ctrl.signal.aborted) {
          p.face(p.x + p.size / 2 < cx ? 'right' : 'left');
        }
      }),
    )
      .catch(() => {})
      .finally(() => this.finishInstance(inst, caller.rec.name, 'summon'));
  }

  private runDanceParty(caller: Pet): void {
    const dancers = [...this.petsMap.values()].filter(
      (p) => !p.hidden && !p.pinned && p.state !== 'dragging',
    );
    if (!dancers.length) return;
    for (const p of dancers) this.abortFor(p);
    const inst = ++this.seq;
    const ctrl = new AbortController();
    for (const p of dancers) {
      const m = this.metas.get(p.rec.name);
      if (m) m.claimedBy = inst;
    }
    this.running.set(inst, {
      id: inst,
      behavior: 'dance-party',
      ctrl,
      pets: dancers,
      locks: [],
    });
    this.emit({ type: 'behavior-start', pet: caller.rec.name, behavior: 'dance-party' });
    void Promise.all(
      dancers.map(async (p) => {
        for (let i = 0; i < 3 && !ctrl.signal.aborted; i++) {
          await p.playSpecial();
        }
      }),
    )
      .catch(() => {})
      .finally(() => this.finishInstance(inst, caller.rec.name, 'dance-party'));
  }

  private runWalkMyWindow(pet: Pet): void {
    // list_windows is z-ordered top-first, so the first climbable window
    // platform belongs to the user's focused/top-most reachable window.
    const p = this.env.platforms.find((q) => climbEligible(q, this.env.height));
    if (!p) return;
    this.runOneShot(pet, 'walk-my-window', async (signal) => {
      const mid = (p.left + p.right) / 2 - pet.size / 2;
      if (!(await pet.climbToPlatform(p)) || signal.aborted) return;
      if (!(await pet.walkTo(p.right - pet.size)) || signal.aborted) return;
      if (!(await pet.walkTo(p.left)) || signal.aborted) return;
      await pet.walkTo(mid);
    });
  }

  /* --------------------------------- internals ------------------------------- */

  private handlePetEvent(ev: DirectorEvent): void {
    if (ev.type === 'thrown' && ev.speed > THROW_SPEED) {
      const m = this.metas.get(ev.pet);
      if (m) m.pendingDizzy = true;
    } else if (ev.type === 'landed') {
      const m = this.metas.get(ev.pet);
      if (m?.pendingDizzy) {
        m.pendingDizzy = false;
        this.dizzyQueue.push(ev.pet);
      }
    }
    this.emit(ev);
  }

  private isFree(pet: Pet): boolean {
    const m = this.metas.get(pet.rec.name);
    if (!m || m.claimedBy !== null) return false;
    return (
      !pet.pinned &&
      !pet.busy &&
      !pet.hidden &&
      pet.state !== 'sleeping' &&
      pet.state !== 'dragging' &&
      pet.grounded
    );
  }

  private nearestFreeOther(pet: Pet): Pet | undefined {
    let best: Pet | undefined;
    let bestDist = Infinity;
    for (const p of this.petsMap.values()) {
      if (p === pet || !this.isFree(p)) continue;
      const d = Math.abs(p.x + p.size / 2 - (pet.x + pet.size / 2));
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  private pushRecent(pet: Pet, id: string): void {
    const m = this.metas.get(pet.rec.name);
    if (!m) return;
    m.recent.push(id);
    if (m.recent.length > 5) m.recent.shift();
  }

  /** Idle-gap sampling scaled by activityLevel: calm 8–25 s, lively 2–8 s. */
  private sampleGap(): number {
    const a = Math.min(100, Math.max(0, this.env.settings.activityLevel)) / 100;
    const minS = 8 - 6 * a;
    const maxS = 25 - 17 * a;
    return (minS + Math.random() * (maxS - minS)) * 1000;
  }
}

function overlapFraction(a: PetHandle, b: PetHandle): number {
  const ra = a.bbox();
  const rb = b.bbox();
  const ix = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
  const iy = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
  if (ix <= 0 || iy <= 0) return 0;
  const minArea = Math.min(ra.w * ra.h, rb.w * rb.h);
  return minArea > 0 ? (ix * iy) / minArea : 0;
}

export function createDirector(env: OverlayEnv): DirectorHandle {
  return new Director(env);
}
