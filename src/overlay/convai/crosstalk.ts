/**
 * Crosstalk — short character↔character conversations.
 *
 * The only code path allowed to hold TWO live Convai connections at once
 * (the global cap). Each turn: prompt the speaker with what the other just
 * said, wait for their reply via the bubble stream (30 s timeout), then swap.
 * Only one voice plays at a time; quiet hours and despawns abort silently.
 */
import type { AppSettings } from '../../shared/types';
import type { CrosstalkApi, PetConvai } from './api';
import { inQuietHours } from './contextBus';

export interface CrosstalkDeps {
  getSettings(): AppSettings;
  forPet(name: string): PetConvai;
  /** Forced reply (run_llm "true"); connects on demand. */
  promptPet(name: string, text: string): Promise<void>;
  /** Silent context append (run_llm "false"); dropped when not connected. */
  narratePet(name: string, text: string): void;
  /** Quiet-chatter override: mute TTS without touching rec.voiceEnabled. */
  setTtsMuted(name: string, muted: boolean): void;
  /** Protect a connection from LRU eviction while the pair is talking. */
  pinConnection(name: string, pinned: boolean): void;
  isSpawned(name: string): boolean;
  displayName(name: string): string;
}

const TURN_TIMEOUT_MS = 30_000;
const BETWEEN_TURNS_MS = 700;
const QUIET_CHATTER_THRESHOLD = 15;
const GIST_MAX_CHARS = 90;

export function createCrosstalk(deps: CrosstalkDeps): CrosstalkApi {
  let running = false;
  let stopped = false;
  const abortResolvers = new Set<(v: string | null) => void>();

  function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Wait for the speaker's next finished utterance (final bubble). */
  function awaitReply(pet: PetConvai): { promise: Promise<string | null>; cleanup: () => void } {
    let off: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resolveRef: ((v: string | null) => void) | null = null;
    const promise = new Promise<string | null>((resolve) => {
      resolveRef = resolve;
      abortResolvers.add(resolve);
      off = pet.onBubble((text, final) => {
        if (final) resolve(text);
      });
      timer = setTimeout(() => resolve(null), TURN_TIMEOUT_MS);
    });
    const cleanup = () => {
      off?.();
      if (timer !== null) clearTimeout(timer);
      if (resolveRef !== null) abortResolvers.delete(resolveRef);
    };
    return { promise, cleanup };
  }

  async function speakTurn(speaker: string, promptText: string): Promise<string | null> {
    const pet = deps.forPet(speaker);
    const waiter = awaitReply(pet);
    try {
      await deps.promptPet(speaker, promptText);
    } catch {
      waiter.cleanup();
      return null;
    }
    const reply = await waiter.promise;
    waiter.cleanup();
    return reply;
  }

  async function run(a: string, b: string, topic: string | undefined, turns: number): Promise<void> {
    const pair: [string, string] = [a, b];
    const quiet = deps.getSettings().chatterFrequency < QUIET_CHATTER_THRESHOLD;
    for (const n of pair) deps.pinConnection(n, true);
    try {
      await Promise.all(pair.map((n) => deps.forPet(n).ensureConnected()));
    } catch {
      for (const n of pair) deps.pinConnection(n, false);
      return; // either side unreachable — abort silently
    }
    if (quiet) for (const n of pair) deps.setTtsMuted(n, true);

    let lastText: string | null = null;
    let gist: string | null = topic ?? null;
    try {
      outer: for (let t = 0; t < turns && !stopped; t++) {
        for (const [speaker, listener] of [
          [a, b],
          [b, a],
        ] as const) {
          if (stopped || !deps.isSpawned(a) || !deps.isSpawned(b)) break outer;
          // One voice at a time — cut the previous speaker's TTS if it lingers.
          const other = deps.forPet(listener);
          if (other.status().activity === 'speaking') other.interrupt();
          const preamble = `You are hanging out with ${deps.displayName(listener)}, another desktop companion. `;
          const promptText =
            lastText === null
              ? preamble +
                (topic ?? 'Casually start a short friendly chat with them — one or two sentences.')
              : `${preamble}They just said: "${lastText}". Reply briefly in character.`;
          const reply = await speakTurn(speaker, promptText);
          if (stopped) break outer;
          if (reply === null || reply.trim() === '') break outer; // fizzled
          lastText = reply;
          if (gist === null) gist = reply;
          await delay(BETWEEN_TURNS_MS);
        }
      }
    } finally {
      if (quiet) for (const n of pair) deps.setTtsMuted(n, false);
      for (const n of pair) deps.pinConnection(n, false);
      if (gist !== null && lastText !== null) {
        // Server-side LTM captures the exchange itself; this cheap note lets
        // the characters reference the hangout within the live session too.
        const short = gist.length > GIST_MAX_CHARS ? `${gist.slice(0, GIST_MAX_CHARS)}…` : gist;
        deps.narratePet(a, `You just had a chat with ${deps.displayName(b)} about "${short}".`);
        deps.narratePet(b, `You just had a chat with ${deps.displayName(a)} about "${short}".`);
      }
    }
  }

  return {
    get active(): boolean {
      return running;
    },

    async start(a: string, b: string, topic?: string, turns = 3): Promise<void> {
      if (running || a === b) return;
      if (inQuietHours(deps.getSettings())) return;
      if (!deps.isSpawned(a) || !deps.isSpawned(b)) return;
      // Watch party takes precedence: a pet with an active vision grant is
      // busy commentating on the user's screen and skips crosstalk pairing.
      if (deps.forPet(a).status().visionActive || deps.forPet(b).status().visionActive) return;
      running = true;
      stopped = false;
      try {
        await run(a, b, topic, Math.max(1, turns));
      } finally {
        running = false;
      }
    },

    stop(): void {
      stopped = true;
      for (const resolve of abortResolvers) resolve(null);
      abortResolvers.clear();
    },
  };
}
