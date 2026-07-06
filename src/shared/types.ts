/**
 * Single source of truth for every type that crosses a module boundary.
 * See docs/ARCHITECTURE.md for the full design.
 */

/* ---------------------------------- geometry ---------------------------------- */

/** Physical-pixel rectangle (virtual-screen coordinates). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CursorPos {
  x: number;
  y: number;
  /** True when the cursor is currently inside a reported hit region. */
  overInteractive: boolean;
}

/** Primary-monitor work area (physical px) + DPI scale factor. */
export interface WorkArea {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

/** A visible top-level window of another application. */
export interface NativeWindow {
  id: number;
  title: string;
  app: string;
  rect: Rect;
  minimized: boolean;
}

export interface CaptureResult {
  base64Jpeg: string;
  width: number;
  height: number;
}

/* --------------------------------- characters --------------------------------- */

export interface SpriteAction {
  max_frames: number;
  loop: boolean;
  loop_times: number;
  /** Play all frames each loop vs. hold last frame between loops. */
  loop_end_only?: boolean;
  description: string;
}

/** Animation metadata, format-compatible with the v1 characters.json entries. */
export interface AnimationConfig {
  walk_max_frame: number;
  drag_max_frames: number;
  fall_max_frames: number;
  climb_max_frames: number;
  special_actions: Record<string, SpriteAction>;
  idle_actions: Record<string, SpriteAction>;
}

export interface CharacterRecord {
  /** Unique storage key, sanitized [a-z0-9_-]. Also the sprite folder name. */
  name: string;
  /** User-editable pretty name shown everywhere in the UI. */
  displayName: string;
  /** Convai character ID (editable in the dashboard UI). */
  convaiId: string;
  spawned: boolean;
  archived: boolean;
  isUserAdded: boolean;
  /**
   * Long-term memory opt-in. DEFAULT FALSE.
   * Requires: LTM enabled for this character in the Convai dashboard AND a plan
   * with sufficient LTM limits. When true we pass settings.endUserId as endUserId.
   */
  longTermMemory: boolean;
  /** When true the character may comment unprompted (free-will ambient mode). */
  freeWill: boolean;
  /** TTS voice on/off for this character. */
  voiceEnabled: boolean;
  /** Exactly 8 skill slots shown in the radial wheel. */
  skillLoadout: SkillId[];
  animation: AnimationConfig;
  /** Teleport-home anchor as a fraction of work-area width (0..1). */
  homeX?: number;
}

/* ---------------------------------- settings ---------------------------------- */

export type ThemeMode = 'system' | 'light' | 'dark';
export type SpeechBubbleStyle = 'glass' | 'solid' | 'retro';
export type SoundPack = 'soft' | 'glass' | 'retro' | 'off';

export interface AppSettings {
  apiKey: string;
  /** Stable per-install UUID used as Convai endUserId when LTM is on. */
  endUserId: string;
  theme: ThemeMode;
  accentColor: string;
  /** Pet render size, percent (50–200). */
  petSize: number;
  /** Pet opacity, percent (30–100). */
  petOpacity: number;
  /** Animation speed multiplier (0.5–2). */
  animationSpeed: number;
  /** 0–100. Scales how often pets pick active behaviors vs. rest. */
  activityLevel: number;
  windowWalking: boolean;
  cursorInteractions: boolean;
  characterInteractions: boolean;
  /** 0–100 likelihood weighting for character↔character chatter. */
  chatterFrequency: number;
  speechBubbleStyle: SpeechBubbleStyle;
  speechBubbleFontSize: number;
  /** Seconds a bubble lingers after speech ends (2–15). */
  speechBubbleSeconds: number;
  voiceVolume: number;
  sfxVolume: number;
  soundPack: SoundPack;
  /** 0–100 cadence of unprompted comments when a character has freeWill. */
  freeWillFrequency: number;
  /** 'HH:MM' 24h, empty string disables quiet hours. */
  quietHoursStart: string;
  quietHoursEnd: string;
  /** Vision capture rate while a grant is active (0.25–2 fps). */
  visionFps: number;
  /** Minutes before a vision grant auto-revokes (1–30). */
  visionSessionMinutes: number;
  /** Pets nap after this many minutes without cursor movement. 0 = never. */
  idleSleepMinutes: number;
  autostart: boolean;
  reduceMotion: boolean;
  showOnboarding: boolean;
}

/* ----------------------------------- skills ----------------------------------- */

export type SkillId =
  | 'chat'
  | 'voice'
  | 'show-screen'
  | 'free-will'
  | 'stay'
  | 'follow-cursor'
  | 'reminder'
  | 'notes'
  | 'sleep'
  | 'wander'
  | 'look-once'
  | 'summon'
  | 'friend-chat'
  | 'dance-party'
  | 'pomodoro'
  | 'daily-briefing'
  | 'memory-journal'
  | 'whisper'
  | 'teleport-home'
  | 'hide'
  | 'do-a-trick'
  | 'walk-my-window';

export interface SkillDef {
  id: SkillId;
  label: string;
  /** Inline SVG path data (24×24 viewBox) rendered in the wheel + editor. */
  icon: string;
  description: string;
  /** Toggle skills render an active state in the wheel. */
  kind: 'action' | 'toggle';
  /** Skills that need a live Convai connection to be useful. */
  needsConvai: boolean;
  /** Hidden from the wheel when the matching setting is disabled. */
  gatedBy?: 'windowWalking' | 'cursorInteractions' | 'characterInteractions';
}

/* ------------------------------ reminders & notes ------------------------------ */

export interface Reminder {
  id: string;
  characterName: string;
  text: string;
  dueAt: number;
  createdAt: number;
  /** Character acknowledged creation (spoke about it). */
  acknowledged: boolean;
  /** Reminder has fired. */
  fired: boolean;
}

export interface Note {
  id: string;
  text: string;
  color: string;
  createdAt: number;
}

/* --------------------------------- persistence --------------------------------- */

export interface PersistedState {
  schemaVersion: number;
  settings: AppSettings;
  characters: Record<string, CharacterRecord>;
  reminders: Reminder[];
  notes: Note[];
}

/* ------------------------------------ engine ----------------------------------- */

export type PetStateName =
  | 'falling'
  | 'walking'
  | 'climbing-left'
  | 'climbing-right'
  | 'climbing-top'
  | 'idle-action'
  | 'special-action'
  | 'dragging'
  | 'sleeping'
  | 'held';

export type EdgeSide = 'left' | 'right' | 'top';

/** A walkable surface: the screen floor or the top edge of a native window. */
export interface Platform {
  kind: 'floor' | 'window';
  /** Native window id when kind === 'window'. */
  windowId?: number;
  /** Logical px, overlay coordinates. */
  y: number;
  left: number;
  right: number;
  /** Bottom edge of the source window (logical px) — used to plan side climbs. */
  bottom?: number;
}

export type Facing = 'left' | 'right';

/* ------------------------------------ convai ----------------------------------- */

export type AgentActivity =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'thinking'
  | 'speaking';

export interface ChatEntry {
  id: string;
  role: 'user' | 'character';
  text: string;
  timestamp: number;
  streaming: boolean;
}

/** UI-facing snapshot of one character's Convai session. */
export interface ConvaiStatus {
  activity: AgentActivity;
  micOn: boolean;
  visionActive: boolean;
  /** ms epoch when the current vision grant expires, 0 when inactive. */
  visionExpiresAt: number;
  emotion: string | null;
  error: string | null;
}

/* --------------------------------- tauri events -------------------------------- */

export const EVT_CURSOR = 'cursor-pos';
export const EVT_SETTINGS_CHANGED = 'settings-changed';
export const EVT_CHARACTERS_CHANGED = 'characters-changed';
export const EVT_REMINDER_DUE = 'reminder-due';
export const EVT_OPEN_CHAT = 'open-chat';
