/**
 * CONTRACT — public API of the pet engine, consumed by the overlay UI,
 * skill handlers and the Convai layer. Implemented in PetEngine.ts /
 * BehaviorDirector.ts. Keep this file dependency-light: types only.
 *
 * Coordinate system: logical (CSS) pixels inside the overlay window.
 * (0,0) is the overlay's top-left; the floor is `env.height`.
 */
import type {
  AppSettings,
  CharacterRecord,
  EdgeSide,
  Facing,
  PetStateName,
  Platform,
  Rect,
  SkillId,
} from '../../shared/types';

/**
 * One monitor of the virtual screen in LOGICAL overlay coordinates.
 * The runtime converts these from the Rust `VirtualScreen`/`MonitorInfo`
 * shapes (physical px) at boot and on `monitors-changed`.
 */
export interface MonitorRegion {
  left: number;
  right: number;
  top: number;
  /** Bottom of the monitor bounds (may sit below the walkable floor). */
  bottom: number;
  /** Walkable floor: this monitor's WORK-AREA bottom (excludes taskbar). */
  floorY: number;
  /**
   * OS primary monitor (homeX / spawn anchor). Optional so the runtime can
   * fill entries progressively; when absent the first entry is used.
   */
  primary?: boolean;
}

export interface OverlayEnv {
  /** Overlay size in logical px. */
  width: number;
  height: number;
  /** DPI scale (physical = logical × scale). */
  scale: number;
  /** Origin of the overlay in physical/virtual-screen px (for converting native rects). */
  originX: number;
  originY: number;
  /** Latest cursor position in logical overlay coords. */
  cursor: { x: number; y: number; lastMovedAt: number };
  /** Walkable platforms derived from native windows (refreshed ~500 ms). */
  platforms: Platform[];
  /**
   * Per-monitor regions (logical overlay coords), converted from
   * `ipc.getMonitors()` by the runtime. An EMPTY array means "treat the whole
   * overlay as one monitor" — the engine falls back to
   * `{0..width, 0..height, floorY: height}` so a not-yet-updated runtime
   * keeps the exact single-monitor behavior.
   */
  monitors: MonitorRegion[];
  settings: AppSettings;
}

/** Events the director broadcasts; UI plays sounds, Convai layer narrates. */
export type DirectorEvent =
  | { type: 'behavior-start'; pet: string; behavior: string; detail?: string }
  | { type: 'behavior-end'; pet: string; behavior: string }
  | { type: 'landed'; pet: string; hard: boolean }
  | { type: 'thrown'; pet: string; speed: number }
  | { type: 'picked-up'; pet: string }
  | { type: 'meet'; pets: [string, string] }
  | { type: 'slept'; pet: string }
  | { type: 'woke'; pet: string }
  | { type: 'hidden'; pet: string }
  | { type: 'returned'; pet: string }
  | { type: 'platform-lost'; pet: string; windowTitle: string };

export interface PetHandle {
  readonly rec: CharacterRecord;
  /** Sprite box top-left, logical px. */
  readonly x: number;
  readonly y: number;
  /** Rendered box size (logical px, already petSize-scaled). */
  readonly size: number;
  readonly state: PetStateName;
  readonly facing: Facing;
  readonly grounded: boolean;
  readonly platform: Platform | null;
  readonly pinned: boolean;
  /** Currently executing an imperative/behavior step. */
  readonly busy: boolean;
  readonly hidden: boolean;
  /** Current sprite frame URL (UI renders this). */
  readonly frameUrl: string;
  /** CSS transform for the sprite (flips/rotations while climbing). */
  readonly transform: string;

  /* Imperatives return false when interrupted before finishing. */
  walkTo(x: number): Promise<boolean>;
  climbEdge(side: EdgeSide, toY: number): Promise<boolean>;
  /**
   * Calm shimeji mount: walk to the window's side on the floor, climb its
   * border, step onto the top. False for windows floating out of reach.
   */
  climbToPlatform(p: Platform, side?: 'left' | 'right'): Promise<boolean>;
  /** @deprecated Ballistic hops were removed — delegates to climbToPlatform. */
  hopToPlatform(p: Platform, x: number): Promise<boolean>;
  /**
   * Reverse a window mount: walk to the near top corner, climb down the
   * window's side border to the floor, then step off. False when the pet is
   * not standing on a window platform (or the window vanished mid-climb).
   */
  dismountPlatform(): Promise<boolean>;
  /**
   * screen-hop only: ONE gentle low arc across the boundary onto the
   * horizontally adjacent monitor's floor (rise ≤ 60 px, forward ≤ 120 px).
   * This is the single sanctioned exception to the no-ballistic-hops rule.
   * False when there is no passable neighbor in that direction.
   */
  hopAcross(dir: 1 | -1): Promise<boolean>;
  playIdle(): Promise<void>;
  playSpecial(name?: string): Promise<void>;
  face(dir: Facing): void;
  teleport(x: number, y: number): void;
  /** Release into gravity fall from current position. */
  fall(): void;
  sleep(): void;
  wake(): void;
  pin(reason: string): void;
  unpin(reason: string): void;
  /** Vanish with a puff and return after ms. */
  hide(ms: number): void;
  /** Cancel the current imperative/behavior. */
  interrupt(): void;
  /** Logical-px bounding box (for hit regions and UI anchoring). */
  bbox(): Rect;
}

export interface DirectorApi {
  readonly env: OverlayEnv;
  readonly pets: ReadonlyMap<string, PetHandle>;
  spawn(rec: CharacterRecord): PetHandle;
  despawn(name: string): void;
  /** Trigger a skill-driven behavior (summon, dance-party, walk-my-window, follow-cursor…). */
  runSkill(petName: string, skill: SkillId): void;
  /** Stop a toggle skill behavior (follow-cursor off, etc.). */
  stopSkill(petName: string, skill: SkillId): void;
  onEvent(cb: (ev: DirectorEvent) => void): () => void;
  /** Recompute settings-dependent knobs (speed, size, weights). */
  applySettings(settings: AppSettings): void;
  /** Pause all behavior scheduling (drag in progress, wheel open…). */
  setSuspended(suspended: boolean): void;
}
