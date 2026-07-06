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

  /** Timed screen-vision grant; auto-revokes. Extends the timer if active. */
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
   * finished. turns = utterances per character (default 3).
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
  /** Disconnect everything (app teardown). */
  disposeAll(): Promise<void>;
  readonly crosstalk: CrosstalkApi;
  readonly reminders: RemindersEngine;
}
