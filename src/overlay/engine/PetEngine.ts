/**
 * PetEngine — one `Pet` per spawned character, implementing PetHandle.
 *
 * Faithful port of the v1 shimeji feel: gravity 0.1 / damping 0.98 per move
 * step, decoupled sprite-frame vs position timing (BASE_FRAME_MS/BASE_MOVE_MS
 * ÷ animationSpeed), the landing-bounce frame choreography (140/600 ms), the
 * climb scaleX/rotate transforms with ±35 px edge overlap, midpoint
 * continue-climbing coin flips and walk-distance randomization after bails.
 *
 * v2 additions: imperative task API (cancellable promises), throw momentum on
 * drag release (vx decays with damping, soft wall bounces), window platforms
 * with per-tick re-validation and calm shimeji-style side-climb mounting
 * (walk to the window's edge, climb straight up, step onto the corner),
 * hide/teleport/sleep states.
 *
 * No rAF of its own — the director drives `tick(now, dt)`. No DOM access; the
 * UI renders from the PetHandle snapshot (frameUrl/transform/x/y/size).
 */
import { BASE_FRAME_MS, BASE_MOVE_MS, PET_BASE_SIZE } from '../../shared/constants';
import { spriteFolder } from '../../shared/store';
import type {
  CharacterRecord,
  EdgeSide,
  Facing,
  PetStateName,
  Platform,
  Rect,
  SpriteAction,
} from '../../shared/types';
import type { DirectorEvent, OverlayEnv, PetHandle } from './api';

export const GRAVITY = 0.1;
export const DAMPING = 0.98;
/** endDrag speeds above this count as a "throw" (feeds dizzy-tumble). */
export const THROW_SPEED = 25;
/** Landing speeds above this are a hard landing (louder thump). */
const HARD_LANDING = 4.5;
/** v1 rendered climbing sprites overlapping the edge by 35 px at base size. */
const EDGE_OVERLAP = 35;
/** Raw v1 move durations during falls/landings (deliberately NOT speed-scaled). */
const FALL_MOVE_MS = 8;
const BOUNCE_MOVE_MS = 140;
const SETTLE_MOVE_MS = 600;
/** A pet left hanging mid-climb with no task drops after this long. */
const CLIMB_HOLD_MS = 2500;
/** Wall bounce restitution for thrown pets. */
const WALL_BOUNCE = 0.45;

export interface PetHooks {
  emit(ev: DirectorEvent): void;
  windowTitle(id: number): string;
}

interface Task {
  kind: 'walk' | 'climb' | 'mount' | 'action';
  resolve(ok: boolean): void;
  /** mount only */
  platform?: Platform;
  side?: 'left' | 'right';
  phase?: 'walk' | 'climb';
}

interface ActiveAction {
  frames: string[];
  loop: boolean;
  loopTimes: number;
  loopEndOnly: boolean;
  loopCount: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi > lo ? hi : lo);
}

/** v1 walk-distance randomization: rand(w/6) + w/6. */
export function v1WalkDistance(width: number): number {
  return Math.floor(Math.random() * (width / 6)) + Math.floor(width / 6);
}

/** Windows whose bottom edge hangs within this of the floor can be climbed. */
export const REACH_GAP = 140;

/** True when a window platform is mountable by a calm floor-side climb. */
export function climbEligible(p: Platform, envHeight: number): boolean {
  return (
    p.kind === 'window' && p.bottom !== undefined && envHeight - p.bottom <= REACH_GAP
  );
}

/**
 * The nearer side of a window with floor room for the pet to stand and climb
 * (left side ⇒ the pet stands at p.left - petSize, its right edge touching
 * the window), or null when neither side fits on screen.
 */
export function pickMountSide(
  p: Platform,
  petX: number,
  petSize: number,
  envWidth: number,
): 'left' | 'right' | null {
  const leftX = p.left - petSize;
  const rightX = p.right;
  const leftOk = leftX >= 0;
  const rightOk = rightX <= envWidth - petSize;
  if (leftOk && rightOk) {
    return Math.abs(leftX - petX) <= Math.abs(rightX - petX) ? 'left' : 'right';
  }
  return leftOk ? 'left' : rightOk ? 'right' : null;
}

export class Pet implements PetHandle {
  readonly rec: CharacterRecord;

  private env: OverlayEnv;
  private hooks: PetHooks;

  private pos = { x: 0, y: 0 };
  private vel = { x: 0, y: 0 };
  private stateName: PetStateName = 'falling';
  private facingDir: Facing = 'left';

  private frames: { walk: string[]; climb: string[]; fall: string[]; drag: string[] };
  private idleActions: Record<string, SpriteAction>;
  private specialActions: Record<string, SpriteAction>;
  private folder: string;
  private sleepFrame: string;

  private frameMs = BASE_FRAME_MS;
  private moveMs = BASE_MOVE_MS;
  private moveMsOverride: number | null = null;
  private lastFrameAt = 0;
  private lastMoveAt = 0;
  private lastNow = 0;

  private frameIdx = 0;
  private frameUrlStr: string;
  private transformStr = 'scaleX(1) rotate(0deg)';

  private task: Task | null = null;
  private walkTarget: number | null = null;
  private action: ActiveAction | null = null;

  private climbTarget = 0;
  private climbDirSign: 1 | -1 = -1;
  private climbMidChecked = false;
  private climbHoldSince = 0;

  private fallAnimStarted = false;
  /** pos.y before the current fall step — landing uses crossing detection. */
  private prevFallY = 0;
  /** Window a startled fall must not re-land on (it just jerked away). */
  private avoidWindowId: number | null = null;
  /** Walk this direction a random v1 distance after the current fall lands. */
  private pendingLandWalk: 1 | -1 | null = null;

  private dragFrame = '';

  private platformRef: Platform | null = null;
  private pinReasons = new Set<string>();
  private hiddenFlag = false;
  private hideUntil = 0;

  constructor(rec: CharacterRecord, env: OverlayEnv, hooks: PetHooks) {
    this.rec = rec;
    this.env = env;
    this.hooks = hooks;
    this.folder = spriteFolder(rec);
    const a = rec.animation;
    const seq = (prefix: string, n: number): string[] =>
      Array.from({ length: Math.max(1, n) }, (_, i) => this.frameUrlFor(`${prefix}${i + 1}`));
    this.frames = {
      walk: seq('walk', a.walk_max_frame),
      climb: seq('climb', a.climb_max_frames),
      fall: seq('fall', a.fall_max_frames),
      drag: seq('drag', a.drag_max_frames),
    };
    this.idleActions = a.idle_actions ?? {};
    this.specialActions = a.special_actions ?? {};
    // Sleeping uses idle_action_2 (sitting) held at a slow pulse.
    const sleepKey = this.idleActions['idle_action_2']
      ? '2'
      : actionNumber(Object.keys(this.idleActions)[0] ?? '');
    this.sleepFrame = sleepKey
      ? this.frameUrlFor(`id${sleepKey}_1`)
      : this.frames.walk[0];
    this.frameUrlStr = this.frames.fall[0] ?? this.frames.walk[0];
    this.applySettings();
    // Spawn like v1: drop in from the top at a random x.
    this.pos.x = Math.random() * Math.max(0, env.width - this.size);
    this.pos.y = 0;
    this.startFalling(0, 0);
  }

  /* ------------------------------ snapshot API ------------------------------ */

  get x(): number {
    const k = this.size / PET_BASE_SIZE;
    if (this.stateName === 'climbing-left') return this.pos.x - EDGE_OVERLAP * k;
    if (this.stateName === 'climbing-right') return this.pos.x + EDGE_OVERLAP * k;
    return this.pos.x;
  }

  get y(): number {
    if (this.stateName === 'climbing-top') {
      return this.pos.y - EDGE_OVERLAP * (this.size / PET_BASE_SIZE);
    }
    return this.pos.y;
  }

  get size(): number {
    return (PET_BASE_SIZE * this.env.settings.petSize) / 100;
  }

  get state(): PetStateName {
    return this.stateName;
  }

  get facing(): Facing {
    return this.facingDir;
  }

  get grounded(): boolean {
    return (
      this.platformRef !== null &&
      this.stateName !== 'falling' &&
      this.stateName !== 'dragging' &&
      !this.hiddenFlag
    );
  }

  get platform(): Platform | null {
    return this.platformRef;
  }

  get pinned(): boolean {
    return this.pinReasons.size > 0;
  }

  get busy(): boolean {
    return this.task !== null || this.stateName === 'dragging';
  }

  get hidden(): boolean {
    return this.hiddenFlag;
  }

  get frameUrl(): string {
    return this.hiddenFlag ? '' : this.frameUrlStr;
  }

  get transform(): string {
    return this.transformStr;
  }

  bbox(): Rect {
    return { x: this.x, y: this.y, w: this.size, h: this.size };
  }

  /* ------------------------------- imperatives ------------------------------ */

  walkTo(x: number): Promise<boolean> {
    if (!this.canAct()) return Promise.resolve(false);
    // Refuse to "walk" while hanging mid-wall — behaviors must climb down.
    if (this.isClimbing()) {
      if (this.pos.y < this.floorY() - 2) return Promise.resolve(false);
      this.platformRef = this.floorPlatform(); // stepping off a floor-level climb
    }
    return new Promise<boolean>((resolve) => {
      this.cancelTask();
      this.task = { kind: 'walk', resolve };
      this.walkTarget = this.clampWalkX(x);
      if (this.stateName !== 'falling') {
        this.setState('walking');
        this.faceToward(this.walkTarget);
      }
      // While falling the walk resumes automatically on landing.
    });
  }

  climbEdge(side: EdgeSide, toY: number): Promise<boolean> {
    if (!this.canAct()) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.cancelTask();
      this.task = { kind: 'climb', resolve };
      this.platformRef = null;
      this.climbMidChecked = false;
      this.frameIdx = 0;
      if (side === 'top') {
        this.pos.y = 0;
        this.climbTarget = clamp(toY, 0, this.env.width - this.size);
        this.climbDirSign = this.climbTarget < this.pos.x ? -1 : 1;
        this.setState('climbing-top');
      } else {
        this.pos.x = side === 'left' ? 0 : this.env.width - this.size;
        this.climbTarget = clamp(toY, 0, this.floorY());
        this.climbDirSign = this.climbTarget < this.pos.y ? -1 : 1;
        this.setState(side === 'left' ? 'climbing-left' : 'climbing-right');
      }
    });
  }

  /**
   * Calm shimeji mount: walk along the floor to the window's side, climb
   * straight up its border, then step onto the top corner. Resolves false
   * immediately for windows floating too far above the floor.
   */
  climbToPlatform(p: Platform, side?: 'left' | 'right'): Promise<boolean> {
    if (!this.canAct() || this.isClimbing()) return Promise.resolve(false);
    if (!climbEligible(p, this.env.height)) return Promise.resolve(false);
    const chosen = side ?? pickMountSide(p, this.pos.x, this.size, this.env.width);
    if (!chosen) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.cancelTask();
      this.task = { kind: 'mount', resolve, platform: p, side: chosen, phase: 'walk' };
      const standX = chosen === 'left' ? p.left - this.size : p.right;
      this.walkTarget = clamp(standX, 0, Math.max(0, this.env.width - this.size));
      if (this.stateName !== 'falling') {
        this.setState('walking');
        this.faceToward(this.walkTarget);
      }
    });
  }

  /** @deprecated Ballistic hops were removed — delegates to climbToPlatform. */
  hopToPlatform(p: Platform, _x: number): Promise<boolean> {
    return this.climbToPlatform(p);
  }

  playIdle(): Promise<void> {
    return this.playAction(this.idleActions, 'id', 'idle-action', undefined);
  }

  playSpecial(name?: string): Promise<void> {
    return this.playAction(this.specialActions, 'sp', 'special-action', name);
  }

  face(dir: Facing): void {
    this.facingDir = dir;
  }

  teleport(x: number, y: number): void {
    if (this.hiddenFlag || this.stateName === 'dragging') return;
    this.cancelTask();
    this.pendingLandWalk = null;
    const floorY = this.floorY();
    this.pos.x = clamp(x, 0, this.env.width - this.size);
    this.pos.y = Math.min(y, floorY);
    if (this.pos.y >= floorY - 0.5) {
      this.pos.y = floorY;
      this.platformRef = this.floorPlatform();
      this.stand();
    } else {
      const under = this.env.platforms.find(
        (p) =>
          Math.abs(p.y - this.size - this.pos.y) <= 2 &&
          this.pos.x + this.size / 2 >= p.left &&
          this.pos.x + this.size / 2 <= p.right,
      );
      if (under) {
        this.pos.y = under.y - this.size;
        this.platformRef = under;
        this.stand();
      } else {
        this.platformRef = null;
        this.startFalling(0, 0);
      }
    }
  }

  fall(): void {
    if (this.hiddenFlag || this.stateName === 'falling' || this.stateName === 'dragging') return;
    this.cancelTask();
    this.platformRef = null;
    this.startFalling(0, 0);
  }

  sleep(): void {
    if (this.hiddenFlag || this.stateName === 'sleeping') return;
    this.cancelTask();
    this.pendingLandWalk = null;
    if (this.platformRef === null) {
      // Settle onto the floor before napping mid-air.
      this.pos.y = this.floorY();
      this.platformRef = this.floorPlatform();
    }
    this.setState('sleeping');
    this.frameUrlStr = this.sleepFrame;
    this.hooks.emit({ type: 'slept', pet: this.rec.name });
  }

  wake(): void {
    if (this.stateName !== 'sleeping') return;
    this.stand();
    this.hooks.emit({ type: 'woke', pet: this.rec.name });
  }

  pin(reason: string): void {
    this.pinReasons.add(reason);
  }

  unpin(reason: string): void {
    this.pinReasons.delete(reason);
  }

  hide(ms: number): void {
    if (this.stateName === 'dragging') return;
    if (this.hiddenFlag) {
      this.hideUntil = this.lastNow + ms;
      return;
    }
    this.cancelTask();
    this.pendingLandWalk = null;
    this.hiddenFlag = true;
    this.hideUntil = this.lastNow + ms;
    this.hooks.emit({ type: 'hidden', pet: this.rec.name });
  }

  interrupt(): void {
    if (this.stateName === 'dragging') return; // drags are ended by the UI
    this.cancelTask();
    this.pendingLandWalk = null;
    if (this.isClimbing()) {
      this.platformRef = null;
      this.startFalling(0, 0);
    } else if (
      this.stateName === 'idle-action' ||
      this.stateName === 'special-action' ||
      this.stateName === 'held' ||
      this.stateName === 'walking'
    ) {
      this.stand();
    }
    // falling continues; sleeping stays asleep (wake() is explicit)
  }

  /* ------------------------- externally-driven drag ------------------------- */
  /* Deviation from api.ts (agreed with the UI agent): the pointer owns drags. */

  beginDrag(): void {
    if (this.hiddenFlag || this.stateName === 'dragging') return;
    this.cancelTask();
    this.pendingLandWalk = null;
    this.platformRef = null;
    this.setState('dragging');
    this.dragFrame =
      this.frames.drag[Math.floor(Math.random() * this.frames.drag.length)] ??
      this.frames.walk[0];
    this.frameUrlStr = this.dragFrame;
    this.hooks.emit({ type: 'picked-up', pet: this.rec.name });
  }

  dragTo(x: number, y: number): void {
    if (this.stateName !== 'dragging') return;
    this.pos.x = clamp(x, 0, this.env.width - this.size);
    this.pos.y = clamp(y, 0, this.env.height - this.size);
  }

  /** Velocities in logical px per move step (≈16 ms frame). */
  endDrag(vx: number, vy: number): void {
    if (this.stateName !== 'dragging') return;
    const speed = Math.hypot(vx, vy);
    this.hooks.emit({ type: 'thrown', pet: this.rec.name, speed });
    this.startFalling(vx, Math.max(vy, -14));
  }

  /* ----------------------------- director-facing ---------------------------- */

  /** Recompute settings-derived knobs (speed, size). */
  applySettings(): void {
    const speed = Math.max(0.1, this.env.settings.animationSpeed || 1);
    this.frameMs = Math.round(BASE_FRAME_MS / speed);
    this.moveMs = Math.round(BASE_MOVE_MS / speed);
    if (this.grounded && this.platformRef) {
      this.pos.y = this.platformRef.y - this.size;
      this.pos.x = this.clampWalkX(this.pos.x);
    }
  }

  tick(now: number, _dt: number): void {
    this.lastNow = now;
    if (this.hiddenFlag) {
      if (now >= this.hideUntil) this.reappear();
      return;
    }
    this.revalidatePlatform();
    if (this.stateName === 'dragging') {
      this.transformStr = this.baseTransform(now);
      return;
    }
    if (this.isClimbing() && this.task === null && now - this.climbHoldSince > CLIMB_HOLD_MS) {
      this.fall();
    }
    this.updateFrame(now);
    if (now - this.lastMoveAt > (this.moveMsOverride ?? this.moveMs)) {
      this.stepMove();
      this.lastMoveAt = now;
    }
    this.transformStr = this.baseTransform(now);
  }

  /* --------------------------------- frames --------------------------------- */

  private updateFrame(now: number): void {
    if (now - this.lastFrameAt <= this.frameMs) return;
    this.lastFrameAt = now;
    switch (this.stateName) {
      case 'dragging':
        return; // frozen random drag frame (v1)
      case 'falling':
        // Airborne shows fall1; the landing frames advance with move steps.
        if (!this.fallAnimStarted) {
          this.frameUrlStr = this.frames.fall[0] ?? this.frames.walk[0];
        }
        return;
      case 'sleeping':
        this.frameUrlStr = this.sleepFrame;
        return;
      case 'held':
        this.frameUrlStr = this.frames.walk[0];
        return;
      case 'climbing-left':
      case 'climbing-right':
      case 'climbing-top': {
        const f = this.frames.climb;
        this.frameIdx = (this.frameIdx + 1) % f.length;
        this.frameUrlStr = f[this.frameIdx];
        return;
      }
      case 'idle-action':
      case 'special-action':
        this.advanceAction();
        return;
      case 'walking': {
        const f = this.frames.walk;
        if (this.walkTarget === null) {
          // Standing still — hold the first walk frame.
          this.frameIdx = 0;
          this.frameUrlStr = f[0];
          return;
        }
        this.frameIdx = (this.frameIdx + 1) % f.length;
        this.frameUrlStr = f[this.frameIdx];
        return;
      }
    }
  }

  /** v1 idle/special frame loop, including loop_end_only hold-last-frame. */
  private advanceAction(): void {
    const a = this.action;
    if (!a) {
      this.stand();
      return;
    }
    const len = a.frames.length;
    if (this.stateName === 'special-action' && a.loopEndOnly) {
      if (this.frameIdx < len - 1 || a.loopCount === 0) {
        this.frameIdx = (this.frameIdx + 1) % len;
      }
    } else {
      this.frameIdx = (this.frameIdx + 1) % len;
    }
    this.frameUrlStr = a.frames[this.frameIdx];
    if (this.frameIdx === len - 1) {
      if (a.loop) {
        a.loopCount++;
        if (a.loopCount >= a.loopTimes) this.finishAction();
      } else {
        this.finishAction();
      }
    }
  }

  private finishAction(): void {
    const t = this.task;
    this.action = null;
    this.task = null;
    this.stand();
    t?.resolve(true);
  }

  /* -------------------------------- movement -------------------------------- */

  private stepMove(): void {
    switch (this.stateName) {
      case 'walking':
        this.stepWalk();
        return;
      case 'climbing-left':
      case 'climbing-right':
      case 'climbing-top':
        this.stepClimb();
        return;
      case 'falling':
        this.stepFalling();
        return;
      default:
        return; // idle/special/sleeping/held/dragging don't move
    }
  }

  private stepWalk(): void {
    if (this.walkTarget === null) return;
    const dx = this.walkTarget - this.pos.x;
    if (Math.abs(dx) < 0.75) {
      this.pos.x = this.walkTarget;
      this.arriveWalk();
      return;
    }
    const dir = dx > 0 ? 1 : -1;
    this.facingDir = dir > 0 ? 'right' : 'left';
    const before = this.pos.x;
    this.pos.x = this.clampWalkX(this.pos.x + dir);
    if (this.pos.x === before) this.arriveWalk(); // pinned against an edge
  }

  private arriveWalk(): void {
    this.walkTarget = null;
    const t = this.task;
    if (t?.kind === 'walk') {
      this.task = null;
      this.stand();
      t.resolve(true);
    } else if (t?.kind === 'mount' && t.phase === 'walk') {
      this.beginMountClimb(t);
    } else {
      this.stand();
    }
  }

  /** The pet reached the window's side — start the slow vertical climb. */
  private beginMountClimb(t: Task): void {
    const live = this.livePlatform(t.platform);
    if (!live || !climbEligible(live, this.env.height) || t.side === undefined) {
      this.task = null;
      this.stand();
      t.resolve(false);
      return;
    }
    const standX = t.side === 'left' ? live.left - this.size : live.right;
    if (Math.abs(standX - this.pos.x) > 3) {
      // The window moved while we were walking — keep following its side.
      this.walkTarget = clamp(standX, 0, Math.max(0, this.env.width - this.size));
      this.faceToward(this.walkTarget);
      return;
    }
    t.phase = 'climb';
    t.platform = live;
    this.platformRef = null;
    this.frameIdx = 0;
    this.climbDirSign = -1;
    this.climbTarget = live.y - this.size;
    this.climbMidChecked = true; // deliberate mounts never coin-flip bail
    // Climbing the window's LEFT border means the pet faces right and its
    // sprite overlaps the edge to its right — visually the screen's
    // right-edge climb, and vice versa.
    this.setState(t.side === 'left' ? 'climbing-right' : 'climbing-left');
  }

  /** Top of the mount climb — step onto the window's surface. */
  private completeMount(t: Task): void {
    this.task = null;
    const live = this.livePlatform(t.platform);
    if (!live) {
      this.platformRef = null;
      this.startFalling(0, 0);
      t.resolve(false);
      return;
    }
    this.platformRef = live;
    this.pos.y = live.y - this.size;
    this.pos.x =
      t.side === 'left' ? live.left + 2 - this.size / 2 : live.right - 2 - this.size / 2;
    this.stand();
    t.resolve(true);
  }

  private livePlatform(p?: Platform): Platform | null {
    if (!p) return null;
    if (p.windowId === undefined) return p;
    return this.env.platforms.find((q) => q.windowId === p.windowId) ?? null;
  }

  /**
   * Mount climbs track a live window: small drift is followed, but a jerk
   * (>4 px) or the window vanishing lets the pet drop off gently.
   */
  private validateMountClimb(): boolean {
    const t = this.task;
    if (!(t?.kind === 'mount' && t.phase === 'climb')) return true;
    const live = this.livePlatform(t.platform);
    if (live && t.side !== undefined && t.platform !== undefined) {
      const standX = t.side === 'left' ? live.left - this.size : live.right;
      const jerked =
        Math.abs(standX - this.pos.x) > 4 || Math.abs(live.y - t.platform.y) > 4;
      if (!jerked) {
        t.platform = live;
        this.climbTarget = live.y - this.size;
        return true;
      }
    }
    this.task = null;
    this.platformRef = null;
    this.startFalling(0, 0);
    t.resolve(false);
    return false;
  }

  private stepClimb(): void {
    if (!this.validateMountClimb()) return;
    if (this.stateName === 'climbing-top') {
      this.pos.x += this.climbDirSign;
      const mid = this.env.width / 2;
      if (
        !this.climbMidChecked &&
        ((this.climbDirSign < 0 && this.pos.x <= mid) ||
          (this.climbDirSign > 0 && this.pos.x >= mid))
      ) {
        this.climbMidChecked = true;
        if (Math.random() < 0.5) {
          // v1: drop from the top bar, then wander a random direction.
          this.bailFromClimb(Math.random() < 0.5 ? -1 : 1);
          return;
        }
      }
      if (
        (this.climbDirSign < 0 && this.pos.x <= this.climbTarget) ||
        (this.climbDirSign > 0 && this.pos.x >= this.climbTarget)
      ) {
        this.pos.x = this.climbTarget;
        this.finishClimb();
      }
      return;
    }

    this.pos.y += this.climbDirSign;
    const mid = this.env.height / 2;
    if (
      !this.climbMidChecked &&
      ((this.climbDirSign < 0 && this.pos.y <= mid) ||
        (this.climbDirSign > 0 && this.pos.y >= mid))
    ) {
      this.climbMidChecked = true;
      if (Math.random() < 0.5) {
        // v1: bail off the wall and walk inward once landed.
        this.bailFromClimb(this.stateName === 'climbing-left' ? 1 : -1);
        return;
      }
    }
    if (
      (this.climbDirSign < 0 && this.pos.y <= this.climbTarget) ||
      (this.climbDirSign > 0 && this.pos.y >= this.climbTarget)
    ) {
      this.pos.y = this.climbTarget;
      const t = this.task;
      if (t?.kind === 'mount' && t.phase === 'climb') {
        this.completeMount(t);
      } else if (this.climbTarget >= this.floorY() - 1) {
        // Climbed back down to the floor.
        this.task = null;
        this.platformRef = this.floorPlatform();
        this.stand();
        t?.resolve(true);
      } else {
        this.finishClimb();
      }
    }
  }

  private finishClimb(): void {
    const t = this.task;
    this.task = null;
    this.climbHoldSince = this.lastNow;
    t?.resolve(true); // stays hanging in the climb state for the next order
  }

  private bailFromClimb(walkDir: 1 | -1): void {
    const t = this.task;
    this.task = null;
    t?.resolve(false);
    this.pendingLandWalk = walkDir;
    this.platformRef = null;
    this.startFalling(0, 0);
  }

  /** v1 falling(): gravity + damping, overshoot 3 px, bounce frames 140/600 ms. */
  private stepFalling(): void {
    this.prevFallY = this.pos.y;
    this.vel.y += GRAVITY;
    this.vel.y *= DAMPING;
    this.pos.y += this.vel.y;

    if (!this.fallAnimStarted && this.vel.x !== 0) {
      // Throw momentum — decays with damping, soft wall bounces.
      this.pos.x += this.vel.x;
      this.vel.x *= DAMPING;
      const maxX = this.env.width - this.size;
      if (this.pos.x < 0) {
        this.pos.x = 0;
        this.vel.x = Math.abs(this.vel.x) * WALL_BOUNCE;
      } else if (this.pos.x > maxX) {
        this.pos.x = maxX;
        this.vel.x = -Math.abs(this.vel.x) * WALL_BOUNCE;
      }
      if (Math.abs(this.vel.x) < 0.05) this.vel.x = 0;
    }

    const landing = this.resolveLanding();
    if (this.pos.y >= landing.y + 3) {
      if (!this.fallAnimStarted) {
        const impact = this.vel.y;
        this.pos.y = landing.y + 3;
        this.fallAnimStarted = true;
        this.frameIdx = 1;
        this.hooks.emit({ type: 'landed', pet: this.rec.name, hard: impact > HARD_LANDING });
        if (impact < 2) {
          // Soft landings (hops, tiny drops) skip the full bounce.
          this.completeLanding(landing);
          return;
        }
      }
      const fallFrames = this.frames.fall;
      if (this.frameIdx < fallFrames.length + 1) {
        this.frameUrlStr = fallFrames[Math.min(this.frameIdx, fallFrames.length - 1)];
        if (this.frameIdx >= 1 && this.frameIdx <= 3) {
          this.pos.y -= this.vel.y;
          this.moveMsOverride = BOUNCE_MOVE_MS;
        } else if (this.frameIdx === 4) {
          this.pos.y -= this.vel.y;
          this.moveMsOverride = SETTLE_MOVE_MS;
        } else {
          this.moveMsOverride = null;
        }
        this.frameIdx++;
      }
      if (this.frameIdx >= fallFrames.length + 1) {
        this.completeLanding(landing);
      }
    }
  }

  /** Where this fall will end: the highest platform under the pet, or floor. */
  private resolveLanding(): { y: number; platform: Platform } {
    const floor = this.floorPlatform();
    const floorY = this.env.height - this.size;
    if (this.vel.y <= 0) return { y: floorY, platform: floor }; // still rising
    const centerX = this.pos.x + this.size / 2;
    let bestY = floorY;
    let best: Platform = floor;
    const consider = (p: Platform) => {
      if (p.windowId !== undefined && p.windowId === this.avoidWindowId) return;
      if (centerX < p.left + 2 || centerX > p.right - 2) return;
      const landY = p.y - this.size;
      // Crossing detection: land only if this step started at or above the
      // v1 overshoot line (landY + 3) — no tunneling past thin platforms.
      if (landY + 3 < this.prevFallY - 0.01) return;
      if (landY < bestY) {
        bestY = landY;
        best = p;
      }
    };
    for (const p of this.env.platforms) consider(p);
    return { y: bestY, platform: best };
  }

  private completeLanding(landing: { y: number; platform: Platform }): void {
    this.pos.y = landing.y;
    this.platformRef = landing.platform;
    this.vel.x = 0;
    this.vel.y = 0;
    this.fallAnimStarted = false;
    this.moveMsOverride = null;
    this.frameIdx = 0;
    this.setState('walking');
    const t = this.task;
    if (t?.kind === 'mount' && t.phase === 'walk') {
      // A mount ordered mid-air resumes its approach walk now that we're down.
      const live = this.livePlatform(t.platform);
      if (!live || !climbEligible(live, this.env.height) || t.side === undefined) {
        this.task = null;
        this.walkTarget = null;
        t.resolve(false);
      } else {
        const standX = t.side === 'left' ? live.left - this.size : live.right;
        this.walkTarget = clamp(standX, 0, Math.max(0, this.env.width - this.size));
        this.faceToward(this.walkTarget);
      }
    } else if (t?.kind === 'walk' && this.walkTarget !== null) {
      // A walk ordered mid-air resumes now.
      this.walkTarget = this.clampWalkX(this.walkTarget);
      this.faceToward(this.walkTarget);
    } else if (this.pendingLandWalk !== null) {
      // v1: after a climb bail, wander a randomized distance inward.
      const dir = this.pendingLandWalk;
      this.pendingLandWalk = null;
      this.walkTarget = this.clampWalkX(this.pos.x + dir * v1WalkDistance(this.env.width));
      this.faceToward(this.walkTarget);
    } else {
      this.walkTarget = null;
    }
  }

  /* ------------------------------ platform watch ----------------------------- */

  private revalidatePlatform(): void {
    const p = this.platformRef;
    if (!p) return;
    if (this.stateName === 'falling' || this.stateName === 'dragging') return;
    if (p.kind === 'floor') {
      this.pos.y = this.env.height - this.size;
      return;
    }
    const live = this.env.platforms.find((q) => q.windowId === p.windowId);
    if (!live) {
      this.hooks.emit({
        type: 'platform-lost',
        pet: this.rec.name,
        windowTitle: this.hooks.windowTitle(p.windowId ?? -1),
      });
      this.startle();
      return;
    }
    const centerX = this.pos.x + this.size / 2;
    const movedY = Math.abs(live.y - p.y);
    const slidOff = centerX < live.left - 2 || centerX > live.right + 2;
    if (movedY > 4 || slidOff) {
      this.startle();
      return;
    }
    // Ride small window moves.
    this.platformRef = live;
    this.pos.y = live.y - this.size;
    this.pos.x = clamp(this.pos.x, live.left + 2 - this.size / 2, live.right - 2 - this.size / 2);
  }

  /** The surface jerked away — the pet simply drops off it. */
  private startle(): void {
    const wasAsleep = this.stateName === 'sleeping';
    const fromWindow = this.platformRef?.windowId;
    this.cancelTask();
    this.pendingLandWalk = null;
    this.platformRef = null;
    if (wasAsleep) this.hooks.emit({ type: 'woke', pet: this.rec.name });
    // A plain gentle drop — no upward pop; sudden jumps fight the calm vibe.
    this.startFalling((Math.random() - 0.5) * 1.2, 0);
    // Don't bounce right back onto the surface that just jerked away.
    this.avoidWindowId = fromWindow ?? null;
  }

  /* --------------------------------- helpers -------------------------------- */

  private playAction(
    catalog: Record<string, SpriteAction>,
    prefix: 'id' | 'sp',
    state: 'idle-action' | 'special-action',
    name: string | undefined,
  ): Promise<void> {
    if (!this.canAct() || this.stateName === 'falling' || this.isClimbing()) {
      return Promise.resolve();
    }
    const keys = Object.keys(catalog);
    const key = name && catalog[name] ? name : keys[Math.floor(Math.random() * keys.length)];
    const def = key ? catalog[key] : undefined;
    if (!key || !def) return Promise.resolve();
    const n = actionNumber(key);
    const frames = Array.from({ length: Math.max(1, def.max_frames) }, (_, i) =>
      this.frameUrlFor(`${prefix}${n}_${i + 1}`),
    );
    return new Promise<void>((resolve) => {
      this.cancelTask();
      this.task = { kind: 'action', resolve: () => resolve() };
      this.action = {
        frames,
        loop: def.loop,
        loopTimes: Math.max(1, def.loop_times),
        loopEndOnly: def.loop_end_only ?? false,
        loopCount: 0,
      };
      this.frameIdx = 0;
      this.setState(state);
      this.frameUrlStr = frames[0];
    });
  }

  private startFalling(vx: number, vy: number): void {
    this.setState('falling');
    this.vel.x = vx;
    this.vel.y = vy;
    this.fallAnimStarted = false;
    this.prevFallY = this.pos.y;
    this.avoidWindowId = null; // startle() re-sets it after this call
    this.frameIdx = 0;
    this.moveMsOverride = FALL_MOVE_MS; // v1 raw value, not speed-scaled
    this.frameUrlStr = this.frames.fall[0] ?? this.frames.walk[0];
  }

  private reappear(): void {
    this.hiddenFlag = false;
    this.pos.x = clamp(this.pos.x, 0, this.env.width - this.size);
    this.pos.y = 0;
    this.platformRef = null;
    this.startFalling(0, 0);
    this.hooks.emit({ type: 'returned', pet: this.rec.name });
  }

  private stand(): void {
    this.setState('walking');
    this.walkTarget = null;
    this.action = null;
    this.frameIdx = 0;
    this.moveMsOverride = null;
    this.frameUrlStr = this.frames.walk[0];
  }

  private setState(s: PetStateName): void {
    this.stateName = s;
  }

  private cancelTask(): void {
    const t = this.task;
    this.task = null;
    this.walkTarget = null;
    this.action = null;
    if (t) t.resolve(false);
  }

  private canAct(): boolean {
    return (
      !this.hiddenFlag && this.stateName !== 'dragging' && this.stateName !== 'sleeping'
    );
  }

  private isClimbing(): boolean {
    return (
      this.stateName === 'climbing-left' ||
      this.stateName === 'climbing-right' ||
      this.stateName === 'climbing-top'
    );
  }

  private clampWalkX(x: number): number {
    const p = this.platformRef;
    if (p && p.kind === 'window') {
      return clamp(x, p.left + 2 - this.size / 2, p.right - 2 - this.size / 2);
    }
    return clamp(x, 0, Math.max(0, this.env.width - this.size));
  }

  private faceToward(targetX: number): void {
    if (Math.abs(targetX - this.pos.x) < 0.5) return;
    this.facingDir = targetX < this.pos.x ? 'left' : 'right';
  }

  private floorY(): number {
    return this.env.height - this.size;
  }

  private floorPlatform(): Platform {
    return { kind: 'floor', y: this.env.height, left: 0, right: this.env.width };
  }

  private frameUrlFor(frame: string): string {
    return `/assets/${this.folder}/${frame}.png`;
  }

  /** v1 sprite-facing convention: sprites face LEFT natively. */
  private baseTransform(now: number): string {
    switch (this.stateName) {
      case 'climbing-left':
        return 'scaleX(1) rotate(0deg)';
      case 'climbing-right':
        return 'scaleX(-1) rotate(0deg)';
      case 'climbing-top':
        return this.climbDirSign < 0 ? 'scaleX(-1) rotate(90deg)' : 'scaleX(1) rotate(90deg)';
      case 'falling':
        return 'scaleX(1) rotate(0deg)'; // v1 resets the transform while falling
      case 'sleeping': {
        const flip = this.facingDir === 'right' ? -1 : 1;
        if (this.env.settings.reduceMotion) return `scaleX(${flip}) rotate(0deg)`;
        const pulse = (1 + 0.02 * Math.sin(now / 600)).toFixed(4);
        return `scaleX(${flip}) rotate(0deg) scale(${pulse})`;
      }
      default:
        return this.facingDir === 'right' ? 'scaleX(-1) rotate(0deg)' : 'scaleX(1) rotate(0deg)';
    }
  }
}

function actionNumber(key: string): string {
  // 'idle_action_2' → '2', 'special_action_1' → '1'
  return key.split('_')[2] ?? '';
}

