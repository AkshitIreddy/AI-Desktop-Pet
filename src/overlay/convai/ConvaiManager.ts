/**
 * ConvaiManager — per-pet ConvaiClient lifecycle + event fan-out.
 *
 * Each spawned pet gets a lazy client (created on first need, disconnected
 * after 5 min of inactivity). Global live connections are capped at 2 with
 * LRU eviction (GAP 7: concurrent-session limits per API key are unpublished;
 * crosstalk is the only flow that intentionally holds two). All SDK events
 * are fanned out as ConvaiStatus / ChatEntry / bubble streams for the UI.
 */
import { MemoryManager } from '@convai/web-sdk/core';
import type { ChatMessage, ConvaiClientState } from '@convai/web-sdk/core';
import { AudioRenderer, ConvaiClient } from '@convai/web-sdk/vanilla';
import { AppStore } from '../../shared/store';
import type {
  AgentActivity,
  AppSettings,
  CharacterRecord,
  ChatEntry,
  ConvaiStatus,
} from '../../shared/types';
import type { ConvaiLayer, MemoryOps, PetConvai } from './api';
import { createContextBus, type ContextBus, type ContextPeer } from './contextBus';
import { createCrosstalk } from './crosstalk';
import { createRemindersEngine } from './reminders';
import { createVisionService, type VisionService } from './visionService';

const MAX_LIVE_CONNECTIONS = 2;
const IDLE_DISCONNECT_MS = 5 * 60_000;
const BOT_READY_TIMEOUT_MS = 15_000;
/** touchActivity within this window ≈ "the chat UI is open right now". */
const CHAT_ACTIVE_WINDOW_MS = 45_000;
const IDLE_RESET_THROTTLE_MS = 10_000;
const MAX_LOCAL_USER_ENTRIES = 100;

function friendlyError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const m = raw.toLowerCase();
  if (/(401|403|api[ _-]?key|auth|unauthorized|forbidden)/.test(m)) {
    return 'Check your API key in Settings.';
  }
  if (/(422|uuid|character)/.test(m)) {
    return 'That Convai character ID looks wrong — double-check it in the dashboard.';
  }
  if (/(microphone|getusermedia|notallowed|device)/.test(m)) {
    return 'Microphone unavailable — check Windows microphone privacy settings.';
  }
  if (/(network|fetch|offline|timed? ?out|unreachable|socket)/.test(m)) {
    return 'Could not reach Convai — check your internet connection.';
  }
  return fallback;
}

/** DisconnectReason codes per SDK enum; null = clean/expected, no error toast. */
function friendlyDisconnect(reason: number): string | null {
  switch (reason) {
    case 1: // CLIENT_INITIATED
      return null;
    case 2: // DUPLICATE_IDENTITY
      return 'This character connected from somewhere else, so this session ended.';
    case 7: // JOIN_FAILURE
      return 'Could not join — check your API key and character ID in Settings.';
    case 4: // PARTICIPANT_REMOVED
    case 5: // ROOM_DELETED
      return 'Convai closed the session — it will reconnect when needed.';
    default:
      return 'Connection to Convai dropped — it will reconnect when needed.';
  }
}

function activityFrom(state: ConvaiClientState): AgentActivity {
  if (state.isConnecting) return 'connecting';
  if (!state.isConnected) return 'disconnected';
  switch (state.agentState) {
    case 'speaking':
      return 'speaking';
    case 'listening':
      return 'listening';
    case 'thinking':
      return 'thinking';
    default:
      return 'connected';
  }
}

function fallbackRecord(name: string): CharacterRecord {
  return {
    name,
    displayName: name,
    convaiId: '',
    spawned: false,
    archived: false,
    isUserAdded: false,
    longTermMemory: false,
    freeWill: false,
    voiceEnabled: true,
    skillLoadout: [],
    animation: {
      walk_max_frame: 0,
      drag_max_frames: 0,
      fall_max_frames: 0,
      climb_max_frames: 0,
      special_actions: {},
      idle_actions: {},
    },
  };
}

interface SessionCtx {
  store: AppStore;
  live: Set<PetSession>;
  /** Shared connect gate: serializes evict+reserve so concurrent connects respect the cap. */
  gate: { p: Promise<void> };
  getBus(): ContextBus;
}

interface ConnSnapshot {
  apiKey: string;
  convaiId: string;
  ltm: boolean;
  video: boolean;
}

class PetSession implements PetConvai {
  readonly name: string;
  readonly peer: ContextPeer;
  /** LRU key for capacity eviction. */
  lastActivity = Date.now();
  /** Crosstalk protection: pinned sessions are never LRU-evicted. */
  pinned = false;
  /**
   * Some accounts/backends reject video-capable sessions. After one failed
   * video connect we fall back to audio-only for the rest of this connection
   * epoch (vision then reports a friendly error instead of a generic connect
   * failure); a full disconnect/reset re-probes video on the next connect.
   */
  private videoCapable = true;
  /** Bumped on every client teardown; in-flight connects bail when it moves. */
  private clientEpoch = 0;
  /** Set by dispose(); a disposed session must never reconnect. */
  private disposed = false;

  private readonly store: AppStore;
  private readonly live: Set<PetSession>;
  private readonly gate: { p: Promise<void> };
  private readonly getBus: () => ContextBus;
  private readonly vision: VisionService;

  private client_: ConvaiClient | null = null;
  private renderer: AudioRenderer | null = null;
  private audioContainer: HTMLElement | null = null;
  private audioObserver: MutationObserver | null = null;
  private unsubs: Array<() => void> = [];
  private connSnap: ConnSnapshot | null = null;
  private connecting: Promise<void> | null = null;

  private st: ConvaiStatus = {
    activity: 'disconnected',
    micOn: false,
    visionActive: false,
    visionExpiresAt: 0,
    emotion: null,
    error: null,
  };
  private statusCbs = new Set<(s: ConvaiStatus) => void>();
  private chatCbs = new Set<(entries: ChatEntry[]) => void>();
  private bubbleCbs = new Set<(text: string, final: boolean) => void>();
  private turnWaiters = new Set<() => void>();

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastIdleReset = 0;

  private voiceOn: boolean;
  private whisper = false;
  private ttsMuted = false;

  private lastRec: CharacterRecord;
  private lastMessages: ChatMessage[] = [];
  /** sendUserTextMessage is not echoed into chatMessages — mirror it locally. */
  private localUser: ChatEntry[] = [];
  private bubble = { id: null as string | null, text: '', finalized: true, pendingFinal: false };

  constructor(name: string, ctx: SessionCtx) {
    this.name = name;
    this.store = ctx.store;
    this.live = ctx.live;
    this.gate = ctx.gate;
    this.getBus = ctx.getBus;
    this.lastRec = ctx.store.state.characters[name] ?? fallbackRecord(name);
    this.voiceOn = this.lastRec.voiceEnabled;
    this.vision = createVisionService({
      ensureConnected: () => this.ensureConnected(),
      client: () => this.client_,
      visionFps: () => Math.min(2, Math.max(0.25, this.store.state.settings.visionFps || 1)),
      setVisionStatus: (active, expiresAt) =>
        this.setStatus({ visionActive: active, visionExpiresAt: expiresAt }),
      touch: () => this.touchActivity(),
      waitTurnEnd: (ms) => this.waitTurnEnd(ms),
    });
    this.peer = {
      name,
      displayName: () => this.rec().displayName,
      freeWill: () => this.rec().freeWill,
      spawned: () => this.rec().spawned && !this.rec().archived,
      isConnected: () => this.isLive(),
      connect: () => this.ensureConnected(),
      pushContext: (text, runLlm) => {
        const c = this.client_;
        if (c === null || !c.state.isConnected) return;
        try {
          c.updateContext({ text, mode: 'append', run_llm: runLlm });
          if (runLlm !== 'false') this.touchActivity();
        } catch {
          // Context is decorative; a failed append must never surface.
        }
      },
    };
  }

  /* -------------------------------- PetConvai -------------------------------- */

  status(): ConvaiStatus {
    return { ...this.st };
  }

  onStatus(cb: (s: ConvaiStatus) => void): () => void {
    this.statusCbs.add(cb);
    try {
      cb({ ...this.st });
    } catch {
      // listener errors never propagate
    }
    return () => this.statusCbs.delete(cb);
  }

  onChat(cb: (entries: ChatEntry[]) => void): () => void {
    this.chatCbs.add(cb);
    try {
      cb(this.entries());
    } catch {
      // listener errors never propagate
    }
    return () => this.chatCbs.delete(cb);
  }

  onBubble(cb: (text: string, final: boolean) => void): () => void {
    this.bubbleCbs.add(cb);
    return () => this.bubbleCbs.delete(cb);
  }

  ensureConnected(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Session closed.'));
    this.touchActivity();
    const c = this.client_;
    if (c !== null && c.state.isConnected && c.isBotReady) return Promise.resolve();
    if (this.connecting !== null) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    // A full disconnect ends the connection epoch — re-probe video next time.
    this.videoCapable = true;
    await this.vision.revoke();
    const c = this.client_;
    if (c !== null && (c.state.isConnected || c.state.isConnecting)) {
      try {
        await c.disconnect();
      } catch {
        // Already down.
      }
    }
    this.live.delete(this);
    this.setStatus({ activity: 'disconnected', micOn: false });
  }

  sendText(text: string): void {
    const t = text.trim();
    if (t.length === 0) return;
    this.localUser.push({
      id: crypto.randomUUID(),
      role: 'user',
      text: t,
      timestamp: Date.now(),
      streaming: false,
    });
    if (this.localUser.length > MAX_LOCAL_USER_ENTRIES) {
      this.localUser.splice(0, this.localUser.length - MAX_LOCAL_USER_ENTRIES);
    }
    this.emitChat();
    this.ensureConnected()
      .then(() => {
        this.client_?.sendUserTextMessage(t);
        this.touchActivity();
      })
      .catch((err: unknown) => {
        this.setStatus({ error: friendlyError(err, 'Could not send that — try again.') });
      });
  }

  interrupt(): void {
    try {
      this.client_?.sendInterruptMessage();
    } catch {
      // Not connected — nothing to interrupt.
    }
    this.maybeFinalizeBubble();
    this.touchActivity();
  }

  async setMic(on: boolean): Promise<void> {
    try {
      if (on) {
        await this.ensureConnected();
        await this.client_?.audioControls.enableAudio();
        this.setStatus({ micOn: true, error: null });
      } else {
        if (this.isLive()) await this.client_?.audioControls.disableAudio();
        this.setStatus({ micOn: false });
      }
      this.touchActivity();
    } catch (err) {
      const msg = friendlyError(
        err,
        'Microphone unavailable — check Windows microphone privacy settings.',
      );
      this.setStatus({ micOn: false, error: msg });
      throw new Error(msg);
    }
  }

  async grantVision(minutes: number): Promise<void> {
    try {
      await this.ensureConnected();
      if (!this.videoCapable) {
        throw new Error(
          'Convai refused a video-capable session for this character — screen vision is unavailable, but chat and voice still work.',
        );
      }
      await this.vision.grant(minutes);
      this.touchActivity();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Screen sharing failed — try again.';
      this.setStatus({ error: msg });
      throw new Error(msg);
    }
  }

  async revokeVision(): Promise<void> {
    await this.vision.revoke();
  }

  async lookOnce(prompt?: string): Promise<void> {
    try {
      await this.ensureConnected();
      if (!this.videoCapable) {
        throw new Error(
          'Convai refused a video-capable session for this character — screen vision is unavailable, but chat and voice still work.',
        );
      }
      await this.vision.lookOnce(prompt);
      this.touchActivity();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Screen peek failed — try again.';
      this.setStatus({ error: msg });
      throw new Error(msg);
    }
  }

  narrate(text: string): void {
    this.getBus().narrate(this.peer, text);
  }

  nudge(text: string): void {
    this.getBus().nudge(this.peer, text);
  }

  prompt(text: string): void {
    this.getBus()
      .prompt(this.peer, text)
      .catch((err: unknown) => {
        this.setStatus({ error: friendlyError(err, 'Could not reach Convai — try again.') });
      });
  }

  setVoiceEnabled(on: boolean): void {
    this.voiceOn = on;
    this.applyTts();
  }

  setWhisper(on: boolean): void {
    this.whisper = on;
    this.applyTts();
  }

  memories(): MemoryOps | null {
    const settings = this.store.state.settings;
    const rec = this.rec();
    if (!rec.longTermMemory || settings.apiKey.trim().length === 0 || !settings.endUserId) {
      return null;
    }
    // Standalone manager: memory CRUD works without a live connection.
    const mgr = new MemoryManager(settings.apiKey, rec.convaiId, settings.endUserId);
    return {
      async list(page = 1) {
        const res = await mgr.listMemories({ page, pageSize: 50 });
        return {
          items: res.memories.map((m) => ({ id: m.id, memory: m.memory, createdAt: m.created_at })),
          total: res.total_count,
          hasMore: res.has_more,
        };
      },
      async remove(id: string) {
        await mgr.deleteMemory(id);
      },
      async removeAll() {
        await mgr.deleteAllMemories();
      },
    };
  }

  touchActivity(): void {
    this.lastActivity = Date.now();
    this.armIdleTimer();
    const c = this.client_;
    if (
      c !== null &&
      c.state.isConnected &&
      Date.now() - this.lastIdleReset > IDLE_RESET_THROTTLE_MS
    ) {
      this.lastIdleReset = Date.now();
      try {
        c.resetIdleTimer();
      } catch {
        // Transport went away between checks.
      }
    }
  }

  /* ----------------------------- layer internals ----------------------------- */

  /** Crosstalk quiet-chatter: mute TTS without touching rec.voiceEnabled. */
  setTtsMuted(muted: boolean): void {
    this.ttsMuted = muted;
    this.applyTts();
  }

  setPinned(pinned: boolean): void {
    this.pinned = pinned;
    if (!pinned) this.touchActivity();
  }

  /** Apply store changes: reconnectable config → drop; live knobs → adjust. */
  refreshFromStore(): void {
    const rec = this.store.state.characters[this.name];
    if (!rec) return; // removal handled by the layer
    this.lastRec = rec;
    this.voiceOn = rec.voiceEnabled;
    this.applyTts();
    this.applyVolume();
    if (this.connSnap !== null) {
      const s = this.store.state.settings;
      if (
        this.connSnap.apiKey !== s.apiKey ||
        this.connSnap.convaiId !== rec.convaiId ||
        this.connSnap.ltm !== rec.longTermMemory
      ) {
        // Identity-level change: drop the client; it reconnects lazily with
        // the new config on next need.
        void this.resetClient().catch(() => undefined);
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.vision.dispose();
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    await this.teardownClient();
    this.live.delete(this);
    this.st = { ...this.st, activity: 'disconnected', micOn: false };
    this.statusCbs.clear();
    this.chatCbs.clear();
    this.bubbleCbs.clear();
    for (const w of [...this.turnWaiters]) w();
  }

  /* --------------------------------- private --------------------------------- */

  private rec(): CharacterRecord {
    const r = this.store.state.characters[this.name];
    if (r) this.lastRec = r;
    return this.lastRec;
  }

  private isLive(): boolean {
    return this.client_ !== null && this.client_.state.isConnected;
  }

  private effectiveTts(): boolean {
    return this.voiceOn && !this.whisper && !this.ttsMuted;
  }

  private applyTts(): void {
    const c = this.client_;
    if (c !== null && c.state.isConnected) {
      try {
        c.toggleTts(this.effectiveTts());
      } catch {
        // Transport not ready; connect config will carry the right value.
      }
    }
  }

  private async doConnect(): Promise<void> {
    // Guard against dispose()/resetClient() running while we are connecting:
    // any teardown bumps clientEpoch, and a stale connect must not resurrect
    // the session. obtainClient tears down the old client itself, so the
    // epoch is re-captured after every obtainClient call.
    let epoch = this.clientEpoch;
    const bailIfStale = async (c: ConvaiClient): Promise<void> => {
      if (this.clientEpoch === epoch && !this.disposed) return;
      try {
        await c.disconnect();
      } catch {
        // Already down.
      }
      if (this.client_ === c) await this.teardownClient();
      this.live.delete(this);
      throw new Error('Session closed while connecting.');
    };
    const settings = this.store.state.settings;
    const rec = this.rec();
    if (settings.apiKey.trim().length === 0) {
      const msg = 'Add your Convai API key in Settings first.';
      this.setStatus({ error: msg });
      throw new Error(msg);
    }
    if (rec.convaiId.trim().length === 0) {
      const msg = `${rec.displayName} has no Convai character ID — set one in the dashboard.`;
      this.setStatus({ error: msg });
      throw new Error(msg);
    }
    // Serialize evict+reserve across sessions so concurrent connects can
    // never overshoot the cap: the live slot is claimed before the network
    // connect begins (failure paths below release it via live.delete).
    const prev = this.gate.p;
    let release!: () => void;
    this.gate.p = new Promise((r) => (release = r));
    await prev;
    try {
      await this.evictForCapacity();
      this.live.add(this);
    } finally {
      release();
    }
    this.setStatus({ activity: 'connecting', error: null });

    let client = await this.obtainClient(settings, rec);
    epoch = this.clientEpoch;
    this.live.add(this); // teardown inside obtainClient clears the reservation
    try {
      await this.connectAndAwaitReady(client);
    } catch (err) {
      try {
        await client.disconnect();
      } catch {
        // Never got up.
      }
      await bailIfStale(client);
      const msg =
        err instanceof Error ? err.message : 'Could not reach Convai — try again in a moment.';
      const authLike = /API key|character ID/i.test(msg);
      // Video-capable sessions are rejected by some plans/backends; retry
      // audio-only once before surfacing an error to the user.
      if (this.videoCapable && !authLike) {
        console.warn(`[convai:${this.name}] video connect failed — retrying audio-only`);
        this.videoCapable = false;
        client = await this.obtainClient(settings, rec);
        epoch = this.clientEpoch;
        this.live.add(this); // re-claim the slot after the rebuild's teardown
        try {
          await this.connectAndAwaitReady(client);
        } catch (err2) {
          try {
            await client.disconnect();
          } catch {
            // Never got up.
          }
          // Audio-only failed too — the problem wasn't video. Don't latch the
          // downgrade; let the next connect attempt try video again.
          this.videoCapable = true;
          this.live.delete(this);
          const msg2 =
            err2 instanceof Error ? err2.message : 'Could not reach Convai — try again in a moment.';
          this.setStatus({ activity: 'disconnected', error: msg2 });
          throw new Error(msg2);
        }
      } else {
        this.live.delete(this);
        this.setStatus({ activity: 'disconnected', error: msg });
        throw new Error(msg);
      }
    }
    await bailIfStale(client);
    this.live.add(this);
    this.setStatus({ activity: activityFrom(client.state), error: null });
    this.applyTts();
    this.applyVolume();
    this.touchActivity();
  }

  /** GAP 7 mitigation: at most 2 live connections; LRU-disconnect the rest. */
  private async evictForCapacity(): Promise<void> {
    while (this.live.size >= MAX_LIVE_CONNECTIONS && !this.live.has(this)) {
      const candidates = [...this.live].filter((s) => s !== this && !s.pinned);
      if (candidates.length === 0) return; // both pinned (crosstalk) — allow overflow
      candidates.sort((a, b) => a.lastActivity - b.lastActivity);
      await candidates[0].disconnect();
    }
  }

  private async obtainClient(settings: AppSettings, rec: CharacterRecord): Promise<ConvaiClient> {
    const snap: ConnSnapshot = {
      apiKey: settings.apiKey,
      convaiId: rec.convaiId,
      ltm: rec.longTermMemory,
      video: this.videoCapable,
    };
    if (
      this.client_ !== null &&
      this.connSnap !== null &&
      this.connSnap.apiKey === snap.apiKey &&
      this.connSnap.convaiId === snap.convaiId &&
      this.connSnap.ltm === snap.ltm &&
      this.connSnap.video === snap.video
    ) {
      return this.client_;
    }
    await this.teardownClient();
    const client = new ConvaiClient({
      apiKey: settings.apiKey,
      characterId: rec.convaiId,
      endUserId: rec.longTermMemory && settings.endUserId ? settings.endUserId : undefined,
      enableVideo: this.videoCapable,
      startWithAudioOn: false,
      startWithVideoOn: false,
      ttsEnabled: this.effectiveTts(),
      enableEmotion: true,
      logRtviMessages: false,
      keepInContext: false,
      respondModes: { vision: 'silent', contextUpdate: 'auto', sceneMetadata: 'silent' },
      // The server validates source against a fixed enum — custom values 422.
      invocationMetadata: { source: 'web_sdk', clientVersion: '2.0.0' },
    });
    this.client_ = client;
    this.connSnap = snap;
    this.attachRenderer(client);
    this.attachEvents(client);
    return client;
  }

  private connectAndAwaitReady(client: ConvaiClient): Promise<void> {
    if (client.state.isConnected && client.isBotReady) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const offs: Array<() => void> = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        for (const off of offs) off();
        if (err) reject(err);
        else resolve();
      };
      timer = setTimeout(
        () => finish(new Error('Convai took too long to answer — try again in a moment.')),
        BOT_READY_TIMEOUT_MS,
      );
      offs.push(client.on('botReady', () => finish()));
      offs.push(
        client.on('error', (err: unknown) => {
          console.error('[convai] connect error event (raw):', err);
          finish(
            new Error(friendlyError(err, 'Could not reach Convai — check your internet connection.')),
          );
        }),
      );
      offs.push(
        client.on('disconnect', (reason: number) => {
          console.error('[convai] disconnected during connect, reason:', reason);
          finish(
            new Error(
              friendlyDisconnect(reason) ?? 'Connection closed before the character was ready.',
            ),
          );
        }),
      );
      client.connect().catch((err: unknown) => {
        console.error('[convai] connect() rejected (raw):', err);
        finish(
          new Error(friendlyError(err, 'Could not reach Convai — check your internet connection.')),
        );
      });
    });
  }

  /**
   * AudioRenderer appends a hidden `convai-audio-renderer-*` container div to
   * document.body and adds an <audio> element per remote track. We diff the
   * containers around construction to find ours, then keep every element's
   * volume synced to settings.voiceVolume via a MutationObserver.
   */
  private attachRenderer(client: ConvaiClient): void {
    const query = 'div[id^="convai-audio-renderer-"]';
    const before = new Set(Array.from(document.querySelectorAll(query)).map((el) => el.id));
    try {
      this.renderer = new AudioRenderer(client.room);
    } catch {
      this.renderer = null; // audio still flows nowhere; chat stays usable
      return;
    }
    const container =
      Array.from(document.querySelectorAll<HTMLDivElement>(query)).find(
        (el) => !before.has(el.id),
      ) ?? null;
    this.audioContainer = container;
    if (container !== null) {
      this.audioObserver = new MutationObserver(() => this.applyVolume());
      this.audioObserver.observe(container, { childList: true });
      this.applyVolume();
    }
  }

  private applyVolume(): void {
    const container = this.audioContainer;
    if (container === null) return;
    const v = Math.min(1, Math.max(0, this.store.state.settings.voiceVolume / 100));
    container.querySelectorAll('audio').forEach((el) => {
      el.volume = v;
    });
  }

  private attachEvents(client: ConvaiClient): void {
    const on = (event: string, cb: (...args: never[]) => void): void => {
      this.unsubs.push(client.on(event, cb as (...args: unknown[]) => void));
    };
    on('stateChange', (state: ConvaiClientState) => {
      this.setStatus({
        activity: activityFrom(state),
        emotion: state.emotion?.emotion ?? null,
      });
    });
    on('messagesChange', (messages: ChatMessage[]) => {
      this.lastMessages = [...messages];
      this.emitChat();
      this.trackBubble(messages);
    });
    on('speakingChange', (speaking: boolean) => {
      if (!speaking) this.maybeFinalizeBubble();
    });
    on('turnEnd', () => {
      this.maybeFinalizeBubble();
      for (const w of [...this.turnWaiters]) w();
    });
    on('error', (err: unknown) => {
      this.setStatus({ error: friendlyError(err, 'Connection hiccup — recovering.') });
    });
    on('disconnect', (reason: number) => {
      this.live.delete(this);
      void this.vision.revoke();
      const msg = friendlyDisconnect(reason);
      this.setStatus({
        activity: 'disconnected',
        micOn: false,
        ...(msg !== null ? { error: msg } : {}),
      });
    });
    on('idleWarning', () => {
      // Keep the session alive while the chat UI is actively in use.
      if (Date.now() - this.lastActivity < CHAT_ACTIVE_WINDOW_MS) {
        try {
          client.resetIdleTimer();
        } catch {
          // Transport gone; the disconnect handler takes over.
        }
      }
    });
  }

  private async teardownClient(): Promise<void> {
    this.clientEpoch++; // any in-flight doConnect for the old client must bail
    for (const off of this.unsubs) {
      try {
        off();
      } catch {
        // Listener already removed.
      }
    }
    this.unsubs = [];
    this.audioObserver?.disconnect();
    this.audioObserver = null;
    try {
      this.renderer?.destroy();
    } catch {
      // Container already removed.
    }
    this.renderer = null;
    this.audioContainer = null;
    const c = this.client_;
    this.client_ = null;
    this.connSnap = null;
    this.lastMessages = [];
    if (c !== null && (c.state.isConnected || c.state.isConnecting)) {
      try {
        await c.disconnect();
      } catch {
        // Already down.
      }
    }
    this.live.delete(this);
  }

  private async resetClient(): Promise<void> {
    // Identity-level reset ends the connection epoch — re-probe video next time.
    this.videoCapable = true;
    await this.vision.revoke();
    await this.teardownClient();
    this.setStatus({ activity: 'disconnected', micOn: false });
  }

  /* ------------------------------ idle disconnect ------------------------------ */

  private armIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (!this.isLive()) return;
    this.idleTimer = setTimeout(() => this.idleCheck(), IDLE_DISCONNECT_MS);
  }

  private idleCheck(): void {
    this.idleTimer = null;
    if (!this.isLive()) return;
    const idleFor = Date.now() - this.lastActivity;
    const busy = this.pinned || this.st.visionActive || this.st.micOn;
    if (!busy && idleFor >= IDLE_DISCONNECT_MS) {
      void this.disconnect().catch(() => undefined);
      return;
    }
    this.idleTimer = setTimeout(
      () => this.idleCheck(),
      Math.max(10_000, IDLE_DISCONNECT_MS - idleFor),
    );
  }

  /* ------------------------------ chat + bubbles ------------------------------ */

  private entries(): ChatEntry[] {
    const out: ChatEntry[] = [...this.localUser];
    // Typed messages ARE echoed back by the SDK (voice transcriptions too) —
    // drop echoes that duplicate a recent locally-mirrored entry.
    const mirrored = new Set(
      this.localUser.filter((e) => Date.now() - e.timestamp < 120_000).map((e) => e.text),
    );
    for (const m of this.lastMessages) {
      let role: ChatEntry['role'] | null = null;
      if (m.type === 'user' || m.type === 'user-transcription') role = 'user';
      else if (m.type === 'convai' || m.type === 'bot-output' || m.type === 'bot-llm-text') {
        role = 'character';
      }
      if (role === null || m.content.length === 0) continue; // internal types ignored
      if (role === 'user' && mirrored.has(m.content.trim())) continue;
      out.push({
        id: m.id,
        role,
        text: m.content,
        timestamp: Date.parse(m.timestamp) || Date.now(),
        streaming: m.isStreaming === true,
      });
    }
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out;
  }

  private trackBubble(messages: ChatMessage[]): void {
    let last: ChatMessage | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const t = messages[i].type;
      if (t === 'bot-llm-text' || t === 'bot-output' || t === 'convai') {
        last = messages[i];
        break;
      }
    }
    if (last === null || last.content.length === 0) return;
    if (this.bubble.id !== last.id) {
      this.bubble = { id: last.id, text: '', finalized: false, pendingFinal: false };
    }
    if (this.bubble.finalized) return;
    if (last.content !== this.bubble.text) {
      this.bubble.text = last.content;
      this.emitBubble(last.content, false);
    }
    if (last.isStreaming === false) {
      // Text is complete; hold `final` until the voice stops so the bubble's
      // linger countdown starts at the end of speech, not the end of tokens.
      if (this.client_?.state.isSpeaking) this.bubble.pendingFinal = true;
      else this.finalizeBubble();
    }
  }

  private maybeFinalizeBubble(): void {
    if (!this.bubble.finalized && this.bubble.text.length > 0) this.finalizeBubble();
  }

  private finalizeBubble(): void {
    if (this.bubble.finalized || this.bubble.text.length === 0) return;
    this.bubble.finalized = true;
    this.bubble.pendingFinal = false;
    this.emitBubble(this.bubble.text, true);
  }

  private waitTurnEnd(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        this.turnWaiters.delete(done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.turnWaiters.add(done);
    });
  }

  /* --------------------------------- emitters --------------------------------- */

  private setStatus(patch: Partial<ConvaiStatus>): void {
    Object.assign(this.st, patch);
    const snap = { ...this.st };
    for (const cb of this.statusCbs) {
      try {
        cb(snap);
      } catch {
        // Listener errors never propagate.
      }
    }
  }

  private emitChat(): void {
    const entries = this.entries();
    for (const cb of this.chatCbs) {
      try {
        cb(entries);
      } catch {
        // Listener errors never propagate.
      }
    }
  }

  private emitBubble(text: string, final: boolean): void {
    for (const cb of this.bubbleCbs) {
      try {
        cb(text, final);
      } catch {
        // Listener errors never propagate.
      }
    }
  }
}

/* ---------------------------------- factory ---------------------------------- */

export function createConvaiLayer(deps: AppStore | { store: AppStore }): ConvaiLayer {
  const store = deps instanceof AppStore ? deps : deps.store;
  const live = new Set<PetSession>();
  const sessions = new Map<string, PetSession>();
  let bus!: ContextBus;

  const ctx: SessionCtx = { store, live, gate: { p: Promise.resolve() }, getBus: () => bus };

  function forSession(name: string): PetSession {
    let s = sessions.get(name);
    if (!s) {
      s = new PetSession(name, ctx);
      sessions.set(name, s);
    }
    return s;
  }

  /** Pinned ≈ mid-crosstalk: a competing prompt's reply would be captured as the crosstalk turn. */
  const isBusy = (name: string): boolean => sessions.get(name)?.pinned === true;

  bus = createContextBus({
    getSettings: () => store.state.settings,
    peers: () =>
      store.characters.filter((r) => r.spawned && !r.archived).map((r) => forSession(r.name).peer),
    liveCount: () => live.size,
    isBusy,
  });
  bus.start();

  const promptPet = (name: string, text: string): Promise<void> =>
    bus.prompt(forSession(name).peer, text);
  const isSpawned = (name: string): boolean => {
    const r = store.state.characters[name];
    return r !== undefined && r.spawned && !r.archived;
  };
  const displayName = (name: string): string => store.state.characters[name]?.displayName ?? name;

  const reminders = createRemindersEngine({
    store,
    promptPet,
    hasApiKey: () => store.state.settings.apiKey.trim().length > 0,
    isSpawned,
    isBusy,
    displayName,
  });

  const crosstalk = createCrosstalk({
    getSettings: () => store.state.settings,
    forPet: (name) => forSession(name),
    promptPet,
    narratePet: (name, text) => bus.narrate(forSession(name).peer, text),
    setTtsMuted: (name, muted) => forSession(name).setTtsMuted(muted),
    pinConnection: (name, pinned) => forSession(name).setPinned(pinned),
    isSpawned,
    displayName,
  });

  return {
    forPet: (name: string): PetConvai => forSession(name),

    async dropPet(name: string): Promise<void> {
      const s = sessions.get(name);
      if (!s) return;
      sessions.delete(name);
      await s.dispose();
    },

    refresh(): void {
      for (const [name, s] of [...sessions]) {
        if (!store.state.characters[name]) {
          sessions.delete(name);
          void s.dispose().catch(() => undefined);
        } else {
          s.refreshFromStore();
        }
      }
    },

    async disposeAll(): Promise<void> {
      bus.stop();
      crosstalk.stop();
      reminders.stop();
      const all = [...sessions.values()];
      sessions.clear();
      await Promise.all(all.map((s) => s.dispose().catch(() => undefined)));
    },

    crosstalk,
    reminders,
  };
}
