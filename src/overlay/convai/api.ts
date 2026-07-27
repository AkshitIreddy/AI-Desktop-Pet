/**
 * CONTRACT — public API of the Convai layer, consumed by the overlay UI,
 * skill handlers and the behavior director. Implemented in ConvaiManager.ts
 * and friends. Types only; no implementation imports here.
 */
import type { ChatEntry, ConvaiStatus, Reminder } from '../../shared/types';

export interface MemoryItem {
  id: string;
  memory: string;
  createdAt: string;
}

export interface MemoryOps {
  list(page?: number): Promise<{ items: MemoryItem[]; total: number; hasMore: boolean }>;
  remove(id: string): Promise<void>;
  removeAll(): Promise<void>;
}

export interface PetConvai {
  readonly name: string;
  status(): ConvaiStatus;
  /**
   * True while the character is thinking, or while its voice is audibly
   * playing. Stronger than `status().activity === 'speaking'`: the server-side
   * agent state and LOCAL audio playback can disagree (TTS lags the text
   * stream), and this covers both.
   */
  isTalking(): boolean;
  onStatus(cb: (s: ConvaiStatus) => void): () => void;
  /** Full chat transcript snapshots (streaming entries update in place). */
  onChat(cb: (entries: ChatEntry[]) => void): () => void;
  /**
   * Bubble-worthy character utterances (streamed). `final` marks the end of
   * a turn — the UI keeps the bubble for settings.speechBubbleSeconds after.
   */
  onBubble(cb: (text: string, final: boolean) => void): () => void;

  /** Connect if needed (no-op when live). Rejects with a friendly message. */
  ensureConnected(): Promise<void>;
  disconnect(): Promise<void>;

  sendText(text: string): void;
  /** Stop the character mid-reply. */
  interrupt(): void;
  setMic(on: boolean): Promise<void>;

  /**
   * Timed screen-vision grant; auto-revokes. Extends the timer if active.
   * The duration ALWAYS comes from the caller — the UI resolves the
   * show-screen "minutes" skill param (falling back to
   * settings.visionSessionMinutes when the character has no override); the
   * layer never reads that setting itself. While active, a watch-party
   * commentary loop runs at a cadence from the "chattiness" skill param
   * (100→~45 s, 50→~2 min, 0→never); plain free-will nudges are suspended
   * and the pet is excluded from crosstalk pairing (reminders still fire).
   */
  grantVision(minutes: number): Promise<void>;
  revokeVision(): Promise<void>;
  /** One capture + forced comment on what's visible; no ongoing access. */
  lookOnce(prompt?: string): Promise<void>;

  /** Background context, never triggers a reply (run_llm "false"). */
  narrate(text: string): void;
  /** Context the character MAY react to (run_llm "auto") — free-will path. */
  nudge(text: string): void;
  /** Context the character MUST respond to (run_llm "true"). */
  prompt(text: string): void;
  /** One short in-character reaction to a sticky note the user just pinned. */
  reactToNote(noteText: string): void;

  setVoiceEnabled(on: boolean): void;
  /** Whisper mode: force text-only replies regardless of voiceEnabled. */
  setWhisper(on: boolean): void;

  /** null unless the character has longTermMemory on and an api key is set. */
  memories(): MemoryOps | null;
  /** Keep the server-side idle timer alive on user interaction. */
  touchActivity(): void;
}

export interface CrosstalkApi {
  /** True while any pair is mid-conversation. */
  readonly active: boolean;
  /**
   * Run a short conversation between two spawned characters. Resolves when
   * finished. turns = utterances per character (default 1 — a single
   * exchange: initiator speaks, partner replies once).
   */
  start(a: string, b: string, topic?: string, turns?: number): Promise<void>;
  stop(): void;
}

export interface RemindersEngine {
  /** Create + persist + have the character acknowledge it. */
  create(characterName: string, text: string, dueAt: number): Promise<Reminder>;
  cancel(id: string): Promise<void>;
  /** Starts the scheduler loop (idempotent). */
  start(): void;
}

export interface ConvaiLayer {
  /** Lazy per-character facade; safe to call for any stored character. */
  forPet(name: string): PetConvai;
  /** Disconnect + dispose a character's client (on despawn). */
  dropPet(name: string): Promise<void>;
  /** Re-read settings/characters (api key, LTM toggles, voice…). */
  refresh(): void;
  /**
   * AUTO-CONNECT (settings.autoConnect): connect the given spawned pets now
   * instead of lazily. Respects the live-connection cap — freeWill pets win
   * slots first, then the most recently active; the rest stay lazy. Every
   * failure is silent apart from that pet's status error. No-op when
   * autoConnect is off or no API key is set. The runtime calls this on boot
   * and on spawn changes; the layer also self-triggers it from refresh().
   */
  ensureSpawnedConnected(names: string[]): Promise<void>;
  /**
   * Spawned, non-archived character names, most recently interacted-with
   * first — the UI's pick list for "the active pet" (hotkeys, note reactions).
   */
  activeCandidates(): string[];
  /** Disconnect everything (app teardown). */
  disposeAll(): Promise<void>;
  readonly crosstalk: CrosstalkApi;
  readonly reminders: RemindersEngine;
}
