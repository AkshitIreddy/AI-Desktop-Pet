/**
 * ContextBus — ambient narration + free-will nudges for every pet.
 *
 * Narrations are cheap `updateContext` appends (run_llm "false") throttled to
 * one flush per 10 s per pet, and only ever sent to a client that is already
 * CONNECTED — the bus never opens a connection just to narrate. Nudges
 * (run_llm "auto") let the server decide whether the character reacts;
 * prompts (run_llm "true") force a reply and DO connect on demand.
 */
import { freeWillIntervalMinutes } from '../../shared/constants';
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
  /** Mid-crosstalk — an ambient nudge's reply would be captured as a crosstalk turn. */
  isBusy(name: string): boolean;
  /**
   * ANY pet is currently thinking or speaking. Free will holds off so pets
   * take turns instead of talking over each other.
   */
  voiceBusy(): boolean;
  /** Vision grant active — the watch-party commentary loop replaces free-will nudges. */
  visionActive(name: string): boolean;
  /** Ambient color for free-will prompts: pending reminders + sticky notes. */
  stats(): { upcomingReminders: number; notes: number };
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
/** 15 s tick keeps the ~45 s cadence at freeWillFrequency 100 honest. */
const SCHEDULER_TICK_MS = 15_000;
/** Never evict another pet's connection just for an ambient comment (= MAX_LIVE_CONNECTIONS). */
const MAX_LIVE_FOR_FREE_WILL_CONNECT = 3;
/** Every Nth free-will nudge is run_llm "true" so the pet reliably says something. */
const FORCED_NUDGE_EVERY = 4;

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

// The frequency → cadence mapping lives in shared/constants so the Settings
// slider can label itself with the exact cadence this scheduler uses.
export { freeWillIntervalMinutes };

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
  /** Lifetime nudge count per pet — every FORCED_NUDGE_EVERY-th is forced. */
  const nudgeCounts = new Map<string, number>();
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

  /** Gentle closers for run_llm "auto" nudges — varied so prompts don't go stale. */
  const SOFT_CLOSERS = [
    'If you feel like it, say one short, friendly line to the user in character. Staying quiet is fine too.',
    'Feel free to make one brief, in-character remark about any of this — or stay quiet.',
    'If anything here inspires you, share one short line in character. Silence is fine too.',
  ];
  const FORCED_CLOSER =
    'Say one short, friendly line to the user in character about any of this.';

  /** Wholesome ambience only: time of day, pet activity, window TITLE (never content). */
  async function ambientText(
    peer: ContextPeer,
    settings: AppSettings,
    forced: boolean,
  ): Promise<string> {
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
    const { upcomingReminders, notes } = deps.stats();
    if (upcomingReminders > 0) {
      parts.push(
        `The user has ${upcomingReminders} pending reminder${upcomingReminders === 1 ? '' : 's'} with you all.`,
      );
    }
    if (notes > 0) {
      parts.push(`There ${notes === 1 ? 'is 1 sticky note' : `are ${notes} sticky notes`} pinned on the notes board.`);
    }
    parts.push(
      forced ? FORCED_CLOSER : SOFT_CLOSERS[Math.floor(Math.random() * SOFT_CLOSERS.length)],
    );
    return parts.join(' ');
  }

  async function freeWillTick(): Promise<void> {
    const settings = deps.getSettings();
    if (inQuietHours(settings)) return;
    const intervalMin = freeWillIntervalMinutes(settings.freeWillFrequency);
    if (intervalMin === null) return;
    const now = Date.now();
    // One voice at a time: if any pet is mid-thought or mid-sentence, let it
    // finish. Due nudges are not lost — the schedule only advances for the pet
    // that actually gets nudged, so everyone else fires on a later tick.
    if (deps.voiceBusy()) return;
    for (const peer of deps.peers()) {
      if (!peer.freeWill() || !peer.spawned() || deps.isBusy(peer.name)) continue;
      const due = nextNudgeAt.get(peer.name);
      if (due === undefined) {
        // First encounter — seed the schedule so the first ambient nudge
        // waits one full (jittered) interval after boot instead of firing now.
        const seedJitter = 0.75 + Math.random() * 0.5;
        nextNudgeAt.set(peer.name, now + intervalMin * 60_000 * seedJitter);
        continue;
      }
      if (now < due) continue;
      const jitter = 0.75 + Math.random() * 0.5;
      nextNudgeAt.set(peer.name, now + intervalMin * 60_000 * jitter);
      // While the pet is watching the screen, the vision commentary loop
      // replaces plain free-will nudges (the schedule above still advances,
      // so there is no nudge burst when the grant expires).
      if (deps.visionActive(peer.name)) continue;
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
        const count = (nudgeCounts.get(peer.name) ?? 0) + 1;
        nudgeCounts.set(peer.name, count);
        // Every ~4th nudge forces a reply so free will stays audibly alive
        // instead of the model electing silence every time.
        const forced = count % FORCED_NUDGE_EVERY === 0;
        peer.pushContext(await ambientText(peer, settings, forced), forced ? 'true' : 'auto');
      } catch {
        // Ambient chatter must never surface errors.
      }
      // At most ONE pet is nudged per tick — two pets whose schedules land on
      // the same tick would otherwise start talking simultaneously.
      return;
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
