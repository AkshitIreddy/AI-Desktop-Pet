/**
 * ContextBus — ambient narration + free-will nudges for every pet.
 *
 * Narrations are cheap `updateContext` appends (run_llm "false") throttled to
 * one flush per 10 s per pet, and only ever sent to a client that is already
 * CONNECTED — the bus never opens a connection just to narrate. Nudges
 * (run_llm "auto") let the server decide whether the character reacts;
 * prompts (run_llm "true") force a reply and DO connect on demand.
 */
import { ipc } from '../../shared/ipc';
import type { AppSettings } from '../../shared/types';

/** Minimal view of a pet session the bus needs (implemented by ConvaiManager). */
export interface ContextPeer {
  readonly name: string;
  displayName(): string;
  freeWill(): boolean;
  /** Spawned and not archived. */
  spawned(): boolean;
  isConnected(): boolean;
  connect(): Promise<void>;
  /** Send an updateContext append. Must be a no-op when not connected. */
  pushContext(text: string, runLlm: 'true' | 'false' | 'auto'): void;
}

export interface ContextBusDeps {
  getSettings(): AppSettings;
  /** All candidate pets (spawned characters), lazily created sessions. */
  peers(): ContextPeer[];
  /** Number of live Convai connections right now (GAP 7 cap awareness). */
  liveCount(): number;
}

export interface ContextBus {
  narrate(peer: ContextPeer, text: string): void;
  nudge(peer: ContextPeer, text: string): void;
  prompt(peer: ContextPeer, text: string): Promise<void>;
  /** Starts the free-will scheduler (idempotent). */
  start(): void;
  stop(): void;
}

const FLUSH_INTERVAL_MS = 10_000;
const MAX_QUEUED = 6;
const SCHEDULER_TICK_MS = 30_000;
/** Never evict another pet's connection just for an ambient comment. */
const MAX_LIVE_FOR_FREE_WILL_CONNECT = 2;

/** 'HH:MM' → minutes since midnight, or null when unset/invalid. */
function parseHHMM(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Quiet hours: no nudges, no free-will, no crosstalk. Handles midnight wrap. */
export function inQuietHours(settings: AppSettings, now: Date = new Date()): boolean {
  const start = parseHHMM(settings.quietHoursStart);
  const end = parseHHMM(settings.quietHoursEnd);
  if (start === null || end === null || start === end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

/** freeWillFrequency 0–100 → minutes between nudges (100→3 min, 0→never). */
export function freeWillIntervalMinutes(frequency: number): number | null {
  if (frequency <= 0) return null;
  const f = Math.min(100, Math.max(1, frequency));
  return 3 + (100 - f) * 0.27; // linear-ish: f=1 → ~29.7 min, f=100 → 3 min
}

function timeOfDay(d: Date): string {
  const h = d.getHours();
  if (h < 5) return 'late night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

interface PeerQueue {
  pending: string[];
  lastFlush: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createContextBus(deps: ContextBusDeps): ContextBus {
  const queues = new Map<string, PeerQueue>();
  /** Last narrated activity per pet, reused as free-will ambience. */
  const doingNotes = new Map<string, string>();
  const nextNudgeAt = new Map<string, number>();
  let scheduler: ReturnType<typeof setInterval> | null = null;

  function queueOf(name: string): PeerQueue {
    let q = queues.get(name);
    if (!q) {
      q = { pending: [], lastFlush: 0, timer: null };
      queues.set(name, q);
    }
    return q;
  }

  function flush(peer: ContextPeer, q: PeerQueue): void {
    if (q.pending.length === 0) return;
    const text = q.pending.join(' ');
    q.pending = [];
    if (!peer.isConnected()) return; // dropped silently — never connect to narrate
    q.lastFlush = Date.now();
    peer.pushContext(text, 'false');
  }

  function narrate(peer: ContextPeer, text: string): void {
    doingNotes.set(peer.name, text);
    if (!peer.isConnected()) return;
    const q = queueOf(peer.name);
    q.pending.push(text);
    if (q.pending.length > MAX_QUEUED) q.pending.splice(0, q.pending.length - MAX_QUEUED);
    const wait = q.lastFlush + FLUSH_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      flush(peer, q);
    } else if (q.timer === null) {
      q.timer = setTimeout(() => {
        q.timer = null;
        flush(peer, q);
      }, wait);
    }
  }

  function nudge(peer: ContextPeer, text: string): void {
    if (inQuietHours(deps.getSettings())) return;
    if (!peer.isConnected()) return;
    peer.pushContext(text, 'auto');
  }

  async function prompt(peer: ContextPeer, text: string): Promise<void> {
    await peer.connect();
    peer.pushContext(text, 'true');
  }

  /** Wholesome ambience only: time of day, pet activity, window TITLE (never content). */
  async function ambientText(peer: ContextPeer, settings: AppSettings): Promise<string> {
    const now = new Date();
    const clock = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const parts = [`Ambient moment — it is ${timeOfDay(now)}, ${clock}.`];
    const doing = doingNotes.get(peer.name);
    if (doing) parts.push(`You (${peer.displayName()}) were just ${doing}.`);
    if (settings.windowWalking) {
      try {
        const windows = await ipc.listWindows();
        const top = windows.find((w) => !w.minimized && w.title.trim().length > 0);
        if (top) parts.push(`The user's front window is titled "${top.title}".`);
      } catch {
        // Window info is decorative; skip on failure.
      }
    }
    parts.push(
      'If you feel like it, say one short, friendly line to the user in character. Staying quiet is fine too.',
    );
    return parts.join(' ');
  }

  async function freeWillTick(): Promise<void> {
    const settings = deps.getSettings();
    if (inQuietHours(settings)) return;
    const intervalMin = freeWillIntervalMinutes(settings.freeWillFrequency);
    if (intervalMin === null) return;
    const now = Date.now();
    for (const peer of deps.peers()) {
      if (!peer.freeWill() || !peer.spawned()) continue;
      const due = nextNudgeAt.get(peer.name) ?? 0;
      if (now < due) continue;
      const jitter = 0.75 + Math.random() * 0.5;
      nextNudgeAt.set(peer.name, now + intervalMin * 60_000 * jitter);
      if (!peer.isConnected()) {
        // Free will may open a connection, but never at another pet's expense.
        if (deps.liveCount() >= MAX_LIVE_FOR_FREE_WILL_CONNECT) continue;
        try {
          await peer.connect();
        } catch {
          continue; // no key / offline — try again next interval
        }
      }
      try {
        peer.pushContext(await ambientText(peer, settings), 'auto');
      } catch {
        // Ambient chatter must never surface errors.
      }
    }
  }

  return {
    narrate,
    nudge,
    prompt,
    start(): void {
      if (scheduler !== null) return;
      scheduler = setInterval(() => {
        void freeWillTick().catch(() => undefined);
      }, SCHEDULER_TICK_MS);
    },
    stop(): void {
      if (scheduler !== null) clearInterval(scheduler);
      scheduler = null;
      for (const q of queues.values()) {
        if (q.timer !== null) clearTimeout(q.timer);
        q.timer = null;
        q.pending = [];
      }
    },
  };
}
