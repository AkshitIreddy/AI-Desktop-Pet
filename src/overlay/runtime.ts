/**
 * OverlayRuntime — boots the pet engine + Convai layer, owns the single
 * timer-paced animation loop, imperatively drives pet DOM nodes, and feeds a
 * lightweight zustand store that the React tree renders from.
 *
 * React never re-renders on pet movement: PetLayer registers refs here and the
 * loop writes transforms/frames directly. Panels that must follow a pet
 * (bubbles, wheel, vision badge) subscribe to per-frame callbacks instead.
 */
import { create } from 'zustand';
import { appStore, spriteFolder, spriteUrl } from '../shared/store';
import {
  ipc,
  notifyDashboardChanged,
  onCharactersChanged,
  onCursorPos,
  onMonitorsChanged,
  onOpenChatRequest,
  onReminderDue,
  onSettingsChanged,
} from '../shared/ipc';
import { applyTheme, watchSystemTheme } from '../shared/theme';
import { sounds } from '../shared/sounds';
import { DEFAULT_SETTINGS } from '../shared/constants';
import type {
  AgentActivity,
  AppSettings,
  PetStateName,
  VirtualScreen,
} from '../shared/types';
import type { DirectorApi, DirectorEvent, MonitorRegion, OverlayEnv } from './engine/api';
import { createDirector } from './engine/BehaviorDirector';
import { hitRegionRegistry } from './engine/hitRegions';
import { createConvaiLayer } from './convai/ConvaiManager';
import type { ConvaiLayer } from './convai/api';
import { clearPetSkillState, type UiApi } from '../skills/handlers';
import { syncHotkeys } from './hotkeys';

/** Director contract plus the runtime-only hooks the engine module exposes. */
export type DirectorRuntime = DirectorApi & {
  tick(now: number): void;
  beginDrag(name: string): void;
  dragTo(name: string, x: number, y: number): void;
  endDrag(name: string, vx: number, vy: number): void;
};

export interface PetFrameInfo {
  x: number;
  y: number;
  size: number;
  hidden: boolean;
  state: PetStateName;
}

/* ------------------------------ zustand UI store ------------------------------ */

export interface PetSnapshot {
  name: string;
  displayName: string;
  /** Sprite folder under /assets/. */
  folder: string;
  /** Initial sprite frame URL (asset-protocol aware — custom sets included). */
  frameSrc: string;
  state: PetStateName;
  hidden: boolean;
  pinned: boolean;
  size: number;
}

export type ToastKind = 'info' | 'success' | 'error';
export interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
}

interface OverlayUiState {
  ready: boolean;
  settings: AppSettings;
  pets: PetSnapshot[];
  wheelPet: string | null;
  chatPet: string | null;
  composerPet: string | null;
  notesOpen: boolean;
  journalPet: string | null;
  toasts: ToastItem[];
}

export const useOverlayStore = create<OverlayUiState>(() => ({
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  pets: [],
  wheelPet: null,
  chatPet: null,
  composerPet: null,
  notesOpen: false,
  journalPet: null,
  toasts: [],
}));

export function displayNameOf(name: string): string {
  const rec = appStore.state?.characters?.[name];
  return rec?.displayName ?? name;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function activityLabel(a: AgentActivity | undefined): string {
  switch (a) {
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Online';
    case 'listening':
      return 'Listening';
    case 'thinking':
      return 'Thinking…';
    case 'speaking':
      return 'Speaking';
    default:
      return 'Offline';
  }
}

/* --------------------------------- UI actions --------------------------------- */

let toastSeq = 0;

export const overlayUi: UiApi & {
  closeChat(): void;
  closeReminderComposer(): void;
  closeNotes(): void;
  closeMemoryJournal(): void;
  toggleWheel(name: string): void;
  closeWheel(): void;
} = {
  openChat(name: string) {
    if (!runtime.director?.pets.has(name)) {
      overlayUi.toast(`${displayNameOf(name)} is not spawned right now`, 'info');
      return;
    }
    runtime.setActivePet(name);
    overlayUi.closeWheel();
    useOverlayStore.setState({ chatPet: name });
  },
  closeChat() {
    useOverlayStore.setState({ chatPet: null });
  },
  openReminderComposer(name: string) {
    overlayUi.closeWheel();
    useOverlayStore.setState({ composerPet: name });
  },
  closeReminderComposer() {
    useOverlayStore.setState({ composerPet: null });
  },
  openNotes() {
    overlayUi.closeWheel();
    useOverlayStore.setState({ notesOpen: true });
  },
  closeNotes() {
    useOverlayStore.setState({ notesOpen: false });
  },
  openMemoryJournal(name: string) {
    overlayUi.closeWheel();
    useOverlayStore.setState({ journalPet: name });
  },
  closeMemoryJournal() {
    useOverlayStore.setState({ journalPet: null });
  },
  toggleWheel(name: string) {
    if (useOverlayStore.getState().wheelPet === name) {
      overlayUi.closeWheel();
    } else {
      runtime.setActivePet(name);
      sounds.play('wheel-open');
      runtime.setSuspendKey('wheel', true);
      useOverlayStore.setState({ wheelPet: name });
    }
  },
  closeWheel() {
    if (!useOverlayStore.getState().wheelPet) return;
    sounds.play('wheel-close');
    runtime.setSuspendKey('wheel', false);
    useOverlayStore.setState({ wheelPet: null });
  },
  toast(msg: string, kind: ToastKind = 'info') {
    const id = ++toastSeq;
    useOverlayStore.setState((s) => ({ toasts: [...s.toasts, { id, msg, kind }] }));
    window.setTimeout(() => {
      useOverlayStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
};

/* ---------------------------------- runtime ----------------------------------- */

interface PetRefs {
  root: HTMLDivElement;
  img: HTMLImageElement | null;
  /** Last transform written to root — skips same-value writes in the loop. */
  lastTransform?: string;
}

function humanizeBehavior(id: string): string {
  return id.replace(/[-_]/g, ' ');
}

/**
 * Convert the physical-px monitor list into logical, origin-relative regions
 * for the engine. Each monitor keeps its own floor: the work-area bottom
 * (taskbar excluded) converted to logical px minus the union origin.
 */
function toEnvMonitors(vs: VirtualScreen): MonitorRegion[] {
  return vs.monitors.map((m) => ({
    left: (m.x - vs.x) / vs.scale,
    right: (m.x + m.w - vs.x) / vs.scale,
    top: (m.y - vs.y) / vs.scale,
    bottom: (m.y + m.h - vs.y) / vs.scale,
    floorY: (m.workY + m.workH - vs.y) / vs.scale,
    primary: m.primary,
  }));
}

/** Loop interval while something is moving (~60 Hz sim, ~30 Hz DOM writes). */
const ACTIVE_TICK_MS = 16;
/** Decision-poll interval while the scene is at rest (compositor asleep). */
const IDLE_TICK_MS = 100;

class OverlayRuntime {
  env!: OverlayEnv;
  director!: DirectorRuntime;
  layer!: ConvaiLayer;

  private timer = 0;
  private lastSimAt = 0;
  private lastDrawAt = 0;
  /** While `now < forceActiveUntil` the loop stays at 60 Hz (drag/spawn grace). */
  private forceActiveUntil = 0;
  private started = false;
  private petRefs = new Map<string, PetRefs>();
  private frameSubs = new Map<string, Set<(f: PetFrameInfo) => void>>();
  private lastSnapshotKey = '\0';
  private suspendKeys = new Set<string>();
  private focusCount = 0;
  private activePet: string | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await appStore.load();
    const vs = await this.readVirtualScreen();
    const settings = appStore.state.settings;

    this.env = {
      width: vs.w / vs.scale,
      height: vs.h / vs.scale,
      scale: vs.scale,
      originX: vs.x,
      originY: vs.y,
      cursor: { x: -1e4, y: -1e4, lastMovedAt: performance.now() },
      platforms: [],
      monitors: toEnvMonitors(vs),
      settings,
    };

    applyTheme(settings);
    watchSystemTheme(() => appStore.state.settings);
    sounds.configure(settings.soundPack, settings.sfxVolume);
    hitRegionRegistry.setScale(vs.scale);
    hitRegionRegistry.setOrigin(vs.x, vs.y);

    this.director = createDirector(this.env) as DirectorRuntime;
    this.layer = createConvaiLayer(appStore);
    this.layer.reminders.start();

    for (const rec of appStore.characters) {
      if (rec.spawned && !rec.archived) this.director.spawn(rec);
    }
    this.syncCursorStream();
    this.kickAutoConnect();

    this.director.onEvent(this.handleEvent);

    await Promise.all([
      onCursorPos((p) => {
        const c = this.env.cursor;
        const x = (p.x - this.env.originX) / this.env.scale;
        const y = (p.y - this.env.originY) / this.env.scale;
        if (x !== c.x || y !== c.y) {
          c.x = x;
          c.y = y;
          c.lastMovedAt = performance.now();
        }
      }),
      onSettingsChanged((s) => this.applySettings(s)),
      onCharactersChanged(() => void this.refreshCharacters()),
      // Display/DPI/taskbar changes: refresh env in place (director holds the
      // same object by reference) and re-anchor hit-region conversions.
      onMonitorsChanged((next) => this.applyVirtualScreen(next)),
      // Chime + native notification come from the reminders engine itself;
      // the overlay only makes the pet celebrate.
      onReminderDue((r) => {
        const pet = this.director.pets.get(r.characterName);
        if (pet && !pet.hidden) {
          this.wake();
          void pet.playSpecial().catch(() => {});
        }
      }),
      onOpenChatRequest((name) => overlayUi.openChat(name)),
    ]);

    // Tell an open dashboard whenever the overlay writes (free-will toggled
    // from the wheel, reminders, notes) so its UI updates live rather than
    // only when the window regains focus.
    appStore.onWrite(() => {
      void notifyDashboardChanged().catch(() => {});
    });

    useOverlayStore.setState({ ready: true, settings: { ...settings } });
    this.timer = window.setTimeout(this.loop, 0);
    await ipc.overlayReady();
    void syncHotkeys(settings);

    window.addEventListener('beforeunload', () => {
      if (this.timer) clearTimeout(this.timer);
      void this.layer.disposeAll();
    });
  }

  /* ------------------------------ virtual screen ------------------------------- */

  /** Monitor layout, falling back to the primary work area on older builds. */
  private async readVirtualScreen(): Promise<VirtualScreen> {
    try {
      return await ipc.getMonitors();
    } catch {
      const wa = await ipc.getWorkArea();
      return {
        x: wa.x,
        y: wa.y,
        w: wa.w,
        h: wa.h,
        scale: wa.scale,
        monitors: [
          {
            x: wa.x,
            y: wa.y,
            w: wa.w,
            h: wa.h,
            workX: wa.x,
            workY: wa.y,
            workW: wa.w,
            workH: wa.h,
            scale: wa.scale,
            primary: true,
          },
        ],
      };
    }
  }

  /** Display change: refresh env in place, re-anchor hit regions, clamp pets. */
  private applyVirtualScreen(vs: VirtualScreen): void {
    this.env.width = vs.w / vs.scale;
    this.env.height = vs.h / vs.scale;
    this.env.scale = vs.scale;
    this.env.originX = vs.x;
    this.env.originY = vs.y;
    this.env.monitors = toEnvMonitors(vs);
    hitRegionRegistry.setScale(vs.scale);
    hitRegionRegistry.setOrigin(vs.x, vs.y);
    // Pull pets that ended up outside the new bounds back inside.
    for (const pet of this.director.pets.values()) {
      const nx = clamp(pet.x, 0, Math.max(0, this.env.width - pet.size));
      const ny = clamp(pet.y, 0, Math.max(0, this.env.height - pet.size));
      if (nx !== pet.x || ny !== pet.y) pet.teleport(nx, ny);
    }
    this.wake();
  }

  /* --------------------------- settings & characters --------------------------- */

  private applySettings(s: AppSettings): void {
    appStore.state.settings = s;
    this.env.settings = s;
    applyTheme(s);
    this.director.applySettings(s);
    this.layer.refresh();
    sounds.configure(s.soundPack, s.sfxVolume);
    useOverlayStore.setState({ settings: { ...s } });
    void syncHotkeys(s);
    this.syncCursorStream();
    this.kickAutoConnect();
    this.wake();
  }

  /**
   * Auto-connect: warm up Convai sessions for every spawned pet so free will
   * and first replies are instant. Best-effort — the Convai layer skips itself
   * when autoConnect is off, the api key is missing or a pet is already live.
   */
  private kickAutoConnect(): void {
    if (!appStore.state.settings.autoConnect) return;
    const names = [...this.director.pets.keys()];
    if (!names.length) return;
    try {
      void this.layer.ensureSpawnedConnected(names).catch(() => {});
    } catch {
      // Connection warm-up is opportunistic; never let it break the overlay.
    }
  }

  private async refreshCharacters(): Promise<void> {
    await appStore.reload();
    const wanted = new Set(
      appStore.characters.filter((r) => r.spawned && !r.archived).map((r) => r.name),
    );
    for (const name of [...this.director.pets.keys()]) {
      if (!wanted.has(name)) this.despawnPet(name);
    }
    for (const name of wanted) {
      const pet = this.director.pets.get(name);
      if (pet) {
        // Already spawned: refresh the record in place (homeX, displayName…)
        // so edits apply without a respawn — pet.rec is held by reference.
        Object.assign(pet.rec, appStore.state.characters[name]);
      } else {
        this.director.spawn(appStore.state.characters[name]);
        sounds.play('spawn');
      }
    }
    this.layer.refresh();
    this.syncCursorStream();
    this.kickAutoConnect();
    useOverlayStore.setState({ settings: { ...appStore.state.settings } });
    this.wake();
  }

  private despawnPet(name: string): void {
    if (this.activePet === name) this.activePet = null;
    const s = useOverlayStore.getState();
    if (s.wheelPet === name) overlayUi.closeWheel();
    if (s.chatPet === name) overlayUi.closeChat();
    if (s.composerPet === name) overlayUi.closeReminderComposer();
    if (s.journalPet === name) overlayUi.closeMemoryJournal();
    this.setSuspendKey(`drag:${name}`, false);
    this.director.despawn(name);
    void this.layer.dropPet(name);
    clearPetSkillState(name);
    hitRegionRegistry.set(`pet:${name}`, null);
    sounds.play('despawn');
  }

  /**
   * The ~30 Hz cursor-pos stream wakes the webview on every mouse move; only
   * ask for it while something consumes it — cursor behaviors (chase/watch)
   * or idle-sleep detection (cursor.lastMovedAt).
   */
  private syncCursorStream(): void {
    const s = appStore.state.settings;
    const wanted =
      this.director.pets.size > 0 && (s.cursorInteractions || s.idleSleepMinutes > 0);
    void ipc.setCursorStream(wanted);
  }

  /* ------------------------------ director events ------------------------------ */

  private handleEvent = (ev: DirectorEvent): void => {
    switch (ev.type) {
      case 'behavior-start':
        this.narrate(
          ev.pet,
          `You just started: ${humanizeBehavior(ev.behavior)}${ev.detail ? ` — ${ev.detail}` : ''}.`,
        );
        break;
      case 'behavior-end':
        break;
      case 'landed':
        if (ev.hard) {
          sounds.play('land');
          this.narrate(ev.pet, 'You just fell and landed hard on the ground. Ouch!');
        }
        break;
      case 'thrown':
        this.narrate(
          ev.pet,
          `The user just threw you across the screen${ev.speed > 30 ? ' really fast' : ''}!`,
        );
        break;
      case 'picked-up':
        this.narrate(ev.pet, 'The user just picked you up with the mouse cursor.');
        break;
      case 'slept':
        this.narrate(ev.pet, 'You just curled up and fell asleep.');
        break;
      case 'woke':
        this.narrate(ev.pet, 'You just woke up from your nap.');
        break;
      case 'hidden':
        sounds.play('despawn');
        this.narrate(ev.pet, 'You just slipped away to hide for a while.');
        break;
      case 'returned':
        sounds.play('spawn');
        this.narrate(ev.pet, 'You just popped back onto the desktop after hiding.');
        break;
      case 'platform-lost':
        this.narrate(
          ev.pet,
          ev.covered
            ? `The window you were standing on ("${ev.windowTitle}") just got covered by another window — you are falling!`
            : `The window you were standing on ("${ev.windowTitle}") just moved — you are falling!`,
        );
        break;
      case 'meet': {
        const [a, b] = ev.pets;
        this.narrate(a, `You just ran into ${displayNameOf(b)} on the desktop.`);
        this.narrate(b, `You just ran into ${displayNameOf(a)} on the desktop.`);
        const st = appStore.state.settings;
        if (
          st.characterInteractions &&
          Math.random() * 100 < st.chatterFrequency &&
          !this.layer.crosstalk.active
        ) {
          void this.layer.crosstalk.start(a, b).catch(() => {});
        }
        break;
      }
    }
  };

  private narrate(pet: string, text: string): void {
    try {
      this.layer.forPet(pet).narrate(text);
    } catch {
      // Narration is best-effort ambience; never let it break the loop.
    }
  }

  /* --------------------------------- rAF loop ---------------------------------- */

  private loop = (): void => {
    const now = performance.now();
    if (!this.director) {
      this.timer = window.setTimeout(this.loop, IDLE_TICK_MS);
      return;
    }
    // Advance the sim at ~60 Hz — movement is one step per tick, so this keeps
    // pet speed constant and independent of the draw rate below.
    if (now - this.lastSimAt >= 15) {
      this.lastSimAt = now;
      this.director.tick(now);
    }

    // One pass over the pets: is anything moving, and is one being dragged?
    let active = now < this.forceActiveUntil;
    let dragging = false;
    for (const pet of this.director.pets.values()) {
      if (pet.state === 'dragging') {
        dragging = true;
        active = true;
      } else if (!pet.visuallyIdle) {
        active = true;
      }
    }

    // Flush pet transforms to the DOM at ~30 Hz (60 Hz while a pet is grabbed).
    if (now - this.lastDrawAt >= (dragging ? 15 : 31)) {
      this.lastDrawAt = now;
      this.drawPets();
    }

    // Pace with a timer, NOT requestAnimationFrame. A pending rAF makes Chromium
    // drive its whole compositor at the panel's refresh rate — on a high-refresh
    // display (this dev's is ~220 Hz) that pins the GPU re-compositing the
    // fullscreen transparent overlay even though we only need ~60/30 Hz. A timer
    // wakes the compositor only when we actually write the DOM, and drops to a
    // slow poll while everything is at rest so the GPU can idle entirely.
    this.timer = window.setTimeout(this.loop, active ? ACTIVE_TICK_MS : IDLE_TICK_MS);
  };

  /**
   * Jump to the active tick rate at once for motion triggered from OUTSIDE the
   * loop (drag, spawn, settings/display change) so it renders immediately
   * instead of waiting out the slow idle poll.
   */
  wake(ms = 300): void {
    if (!this.started) return;
    this.forceActiveUntil = performance.now() + ms;
    if (this.timer) clearTimeout(this.timer);
    this.timer = window.setTimeout(this.loop, 0);
  }

  /** Write pet position/frame/state to the DOM and fan out per-frame follows. */
  private drawPets(): void {
    for (const [name, pet] of this.director.pets) {
      const refs = this.petRefs.get(name);
      if (refs) {
        const root = refs.root;
        if (pet.hidden) {
          if (root.style.display !== 'none') root.style.display = 'none';
        } else {
          if (root.style.display) root.style.display = '';
          // Whole-px positions: subpixel translate makes the compositor
          // resample the sprite (blurrier AND costlier on integrated GPUs),
          // and rounding lets tiny sim jitters skip the write entirely.
          const tf = `translate3d(${Math.round(pet.x)}px, ${Math.round(pet.y)}px, 0)`;
          if (refs.lastTransform !== tf) {
            refs.lastTransform = tf;
            root.style.transform = tf;
          }
          const sz = `${pet.size}px`;
          if (root.style.width !== sz) {
            root.style.width = sz;
            root.style.height = sz;
          }
          if (root.dataset.state !== pet.state) root.dataset.state = pet.state;
          const img = refs.img;
          if (img) {
            if (img.dataset.frame !== pet.frameUrl) {
              img.dataset.frame = pet.frameUrl;
              img.src = pet.frameUrl;
            }
            // Sprite flips/rotations stay on the img so the zzz pseudo and
            // hover lift on ancestors are never mirrored with the sprite.
            if (img.style.transform !== pet.transform) img.style.transform = pet.transform;
          }
        }
      }

      if (pet.hidden) {
        hitRegionRegistry.set(`pet:${name}`, null);
      } else {
        const b = pet.bbox();
        hitRegionRegistry.set(`pet:${name}`, {
          x: b.x - 8,
          y: b.y - 8,
          w: b.w + 16,
          h: b.h + 16,
        });
      }

      const subs = this.frameSubs.get(name);
      if (subs?.size) {
        const info: PetFrameInfo = {
          x: pet.x,
          y: pet.y,
          size: pet.size,
          hidden: pet.hidden,
          state: pet.state,
        };
        for (const cb of subs) cb(info);
      }
    }

    this.publishSnapshots();
  }

  private publishSnapshots(): void {
    const pets: PetSnapshot[] = [];
    let key = '';
    for (const [name, pet] of this.director.pets) {
      const rec = appStore.state.characters[name] ?? pet.rec;
      const snap: PetSnapshot = {
        name,
        displayName: rec.displayName,
        folder: spriteFolder(rec),
        frameSrc: spriteUrl(rec, 'walk1.png'),
        state: pet.state,
        hidden: pet.hidden,
        pinned: pet.pinned,
        size: pet.size,
      };
      pets.push(snap);
      key += `${name}|${snap.displayName}|${snap.frameSrc}|${snap.state}|${snap.hidden ? 1 : 0}|${
        snap.pinned ? 1 : 0
      }|${Math.round(snap.size)};`;
    }
    if (key !== this.lastSnapshotKey) {
      this.lastSnapshotKey = key;
      useOverlayStore.setState({ pets });
    }
  }

  /* ------------------------------ component hooks ------------------------------ */

  registerPetEl(name: string, root: HTMLDivElement | null): void {
    if (!root) {
      this.petRefs.delete(name);
      return;
    }
    this.petRefs.set(name, { root, img: root.querySelector('img') });
  }

  /** Per-frame pet position feed for bubbles/wheel/badges. */
  onPetFrame(name: string, cb: (f: PetFrameInfo) => void): () => void {
    let subs = this.frameSubs.get(name);
    if (!subs) {
      subs = new Set();
      this.frameSubs.set(name, subs);
    }
    subs.add(cb);
    return () => {
      subs.delete(cb);
      if (!subs.size) this.frameSubs.delete(name);
    };
  }

  /** Remember the pet the user last clicked/dragged/chatted with. */
  setActivePet(name: string): void {
    if (this.director?.pets.has(name)) this.activePet = name;
  }

  /**
   * Hotkey / note-reaction target: last pet the user clicked, dragged or
   * chatted with, else the Convai layer's recency pick, else the first
   * spawned pet.
   */
  getActivePet(): string | null {
    if (this.activePet && this.director.pets.has(this.activePet)) return this.activePet;
    try {
      for (const name of this.layer.activeCandidates()) {
        if (this.director.pets.has(name)) return name;
      }
    } catch {
      // Layer not ready — fall through to spawn order.
    }
    const first = this.director.pets.keys().next();
    return first.done ? null : first.value;
  }

  /** Reference-counted director suspension (drag in progress, wheel open…). */
  setSuspendKey(key: string, on: boolean): void {
    if (on) this.wake(); // a drag / open panel needs immediate rendering
    const before = this.suspendKeys.size > 0;
    if (on) this.suspendKeys.add(key);
    else this.suspendKeys.delete(key);
    const after = this.suspendKeys.size > 0;
    if (before !== after) this.director.setSuspended(after);
  }

  /** Reference-counted overlay focusability (any open text input). */
  acquireFocus(): () => void {
    if (++this.focusCount === 1) void ipc.setOverlayFocusable(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.focusCount === 0) void ipc.setOverlayFocusable(false);
    };
  }
}

export const runtime = new OverlayRuntime();
