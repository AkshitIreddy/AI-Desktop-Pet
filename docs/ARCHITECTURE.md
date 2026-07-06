# Convai Desktop Pets 2.0 — Architecture

Complete rewrite of the Electron app on **Tauri v2** for a dramatically smaller footprint
(system WebView2 instead of bundled Chromium; **one** shared overlay webview for all pets
instead of one fullscreen window per pet; native Rust for screen capture, window
enumeration and cursor tracking).

## Stack

| Layer | Tech |
|---|---|
| Shell | Tauri 2.11 (Rust 2021), plugins: store, notification, autostart, opener, dialog, single-instance |
| Frontend | React 19 + TypeScript 5 + Vite, Zustand state, framer-motion animations |
| AI | `@convai/web-sdk@1.6.0-beta.3` (`/vanilla` entry: `ConvaiClient` + `AudioRenderer`), LiveKit WebRTC transport |
| Native (win) | `windows` crate (EnumWindows/DWM/GetCursorPos), `xcap` (screen capture), `webview2-com` (mic permission auto-grant) |

## Window model

Two windows defined in `tauri.conf.json`:

1. **`main`** — dashboard (1200×800, decorated). Character management, settings,
   docs, onboarding. Closing hides to tray.
2. **`overlay`** — fullscreen transparent, undecorated, always-on-top, skip-taskbar,
   non-focusable at rest, spanning the primary monitor work area. Hosts **all** pets,
   speech bubbles, skill wheel, chat panel, reminder composer. Starts fully
   click-through; Rust toggles `set_ignore_cursor_events` based on hit-regions
   reported by the frontend vs a 60 Hz global cursor poll. When a focusable UI
   (chat input, reminder composer) opens, frontend calls `set_overlay_focusable(true)`.

## Repository layout

```
├─ index.html / overlay.html          # Vite multi-page entries
├─ vite.config.ts, tsconfig.json, package.json
├─ public/assets/<character>/*.png    # shimeji sprite frames (walk/climb/fall/drag/idN_/spN_)
├─ src/
│  ├─ shared/                         # code shared by both windows
│  │  ├─ types.ts                     # ALL cross-module types (single source of truth)
│  │  ├─ characters.default.json      # bundled characters: animation config + default convai ids
│  │  ├─ store.ts                     # AppStore: tauri-plugin-store persistence + defaults + electron migration
│  │  ├─ ipc.ts                       # typed Rust command wrappers + event subscriptions
│  │  ├─ sounds.ts                    # SoundEngine: WebAudio-synthesized SFX packs (soft/glass/retro/off)
│  │  └─ theme.ts                     # design tokens, accent presets, css-var injection
│  ├─ skills/registry.ts              # SKILLS: all 20 skill definitions + DEFAULT_LOADOUT (8)
│  ├─ overlay/
│  │  ├─ main.tsx                     # overlay entry; boots OverlayRuntime
│  │  ├─ OverlayApp.tsx               # React root: renders pets + UI portals
│  │  ├─ runtime.ts                   # OverlayRuntime: owns engine + convai + stores, single rAF loop
│  │  ├─ engine/
│  │  │  ├─ PetEngine.ts              # per-pet physics + sprite state machine
│  │  │  ├─ BehaviorDirector.ts       # global scheduler: weights, cooldowns, locks, joint actions
│  │  │  ├─ behaviors.ts              # BEHAVIORS catalog (20+)
│  │  │  ├─ platforms.ts              # native window rects → walkable platforms
│  │  │  └─ hitRegions.ts             # collects interactive rects → ipc.updateHitRegions
│  │  ├─ convai/
│  │  │  ├─ ConvaiManager.ts          # per-pet client lifecycle + event fan-out
│  │  │  ├─ visionService.ts          # native frames → canvas → publishCanvas, timed grants
│  │  │  ├─ contextBus.ts             # updateContext throttling, ambient narration, free-will
│  │  │  ├─ reminders.ts              # reminder/notes engine + scheduler
│  │  │  └─ crosstalk.ts              # character↔character conversations
│  │  └─ components/                  # PetSprite, SkillWheel, ChatPanel, SpeechBubble,
│  │                                  # ReminderComposer, NotesBoard, MemoryJournal, VisionBadge…
│  └─ dashboard/
│     ├─ main.tsx, App.tsx            # nav shell (sidebar): Characters / Skills / Settings / Docs / About
│     ├─ pages/…                      # CharactersPage, SettingsPage, DocsPage, OnboardingModal
│     └─ components/…
├─ src-tauri/
│  ├─ tauri.conf.json, capabilities/default.json, icons/
│  └─ src/
│     ├─ lib.rs                       # builder, plugin registration, tray, window setup
│     ├─ overlay.rs                   # cursor poll thread, hit regions, ignore-cursor toggling
│     ├─ win_info.rs                  # list_windows (EnumWindows + DWM), cfg(windows)
│     ├─ capture.rs                   # capture_screen via xcap → JPEG bytes
│     └─ mic_permission.rs            # WebView2 PermissionRequested auto-grant, cfg(windows)
└─ .github/workflows/build.yml        # tauri-action release matrix
```

## Rust ⇄ Frontend contract

### Commands (invoke)
| Command | Args | Returns | Notes |
|---|---|---|---|
| `update_hit_regions` | `regions: Vec<Rect>` | — | Rect = `{x,y,w,h}` physical px. Overlay interactivity zones. |
| `set_overlay_focusable` | `focusable: bool` | — | For text inputs in overlay. |
| `list_windows` | — | `Vec<NativeWindow>` | `{id, title, app, rect: Rect, minimized: bool}` visible, non-cloaked, non-tool windows of other apps, z-ordered top-first. Empty vec on non-Windows. |
| `capture_screen` | `max_dim: u32, quality: u8` | `CaptureResult { base64_jpeg, width, height }` | Primary monitor. |
| `get_cursor_pos` | — | `{x, y}` | Physical px, virtual-screen coords. |
| `get_work_area` | — | `{x, y, w, h, scale}` | Primary monitor work area (excludes taskbar), physical px + scale factor. |
| `show_main_window` | — | — | Show + focus dashboard. |
| `overlay_ready` | — | — | Overlay booted; Rust starts cursor poll. |

### Events (emit → overlay)
| Event | Payload | Cadence |
|---|---|---|
| `cursor-pos` | `{x, y, overInteractive}` | ~30 Hz while pets active (physical px) |
| `settings-changed` | `AppSettings` | on dashboard save (emitted frontend→frontend via `emit_to`) |
| `characters-changed` | — | dashboard mutated characters; overlay re-reads store |
| `reminder-due` | `Reminder` | from overlay scheduler → also fires native notification |

All coordinates crossing the IPC boundary are **physical pixels**; the overlay divides
by `scale` once at ingestion. CSS/DOM positions inside the overlay are logical px.

## Shared types (authoritative shapes, mirrored in `src/shared/types.ts`)

```ts
interface CharacterRecord {
  name: string;             // unique key, sanitized [a-z0-9_-]
  displayName: string;      // user-editable pretty name (NEW: rename in app)
  convaiId: string;         // user-editable character id
  spawned: boolean;
  archived: boolean;
  isUserAdded: boolean;
  longTermMemory: boolean;  // default FALSE — see Memory section
  freeWill: boolean;        // may speak unprompted when true
  voiceEnabled: boolean;    // TTS on/off per character
  skillLoadout: SkillId[];  // exactly 8 slots
  animation: AnimationConfig; // walk/climb/fall/drag frame counts + idle/special actions
  home?: { xPct: number };  // teleport-home anchor (percent of work-area width)
}

interface AppSettings {
  apiKey: string;
  endUserId: string;            // stable uuid, generated first run (memory scope)
  theme: 'system' | 'light' | 'dark';
  accentColor: string;          // hex
  petSize: number;              // 50–200 (%)
  petOpacity: number;           // 30–100 (%)
  animationSpeed: number;       // 0.5–2.0
  activityLevel: number;        // 0–100: scales behavior frequency/idle time
  windowWalking: boolean;       // walk on top of app windows
  cursorInteractions: boolean;  // follow/watch cursor behaviors
  characterInteractions: boolean; // multi-pet joint behaviors
  chatterFrequency: number;     // 0–100: crosstalk likelihood
  speechBubbleStyle: 'glass' | 'solid' | 'retro';
  speechBubbleFontSize: number; // px 12–20
  speechBubbleSeconds: number;  // linger after voice ends 2–15
  voiceVolume: number;          // 0–100
  sfxVolume: number;            // 0–100
  soundPack: 'soft' | 'glass' | 'retro' | 'off';
  freeWillFrequency: number;    // 0–100 → ambient comment cadence
  quietHoursStart: string;      // 'HH:MM' | '' disabled
  quietHoursEnd: string;
  visionFps: number;            // 0.25–2
  visionSessionMinutes: number; // auto-revoke timer 1–30
  idleSleepMinutes: number;     // pets nap after user idle; 0 = never
  autostart: boolean;
  reduceMotion: boolean;
  showOnboarding: boolean;
}

type SkillId =
  | 'chat' | 'voice' | 'show-screen' | 'free-will' | 'stay' | 'follow-cursor'
  | 'reminder' | 'notes' | 'sleep' | 'wander' | 'look-once' | 'summon'
  | 'friend-chat' | 'dance-party' | 'pomodoro' | 'daily-briefing'
  | 'memory-journal' | 'whisper' | 'teleport-home' | 'hide' | 'do-a-trick'
  | 'walk-my-window';   // 22 total

interface Reminder { id: string; characterName: string; text: string;
  dueAt: number; createdAt: number; acknowledged: boolean; fired: boolean; }
interface Note { id: string; text: string; color: string; createdAt: number; }
```

`AppStore` (shared/store.ts) persists `{characters, settings, reminders, notes}` in
tauri-plugin-store `app-data.json`, seeds from `characters.default.json`, migrates the
old electron-store `config.json` (api key, character ids, spawn flags) if found at
`%APPDATA%/convai-desktop-pet/config.json`.

## Pet engine

`PetEngine` — one instance per spawned pet, pure TS, driven by the runtime's single
`requestAnimationFrame` loop (position updates decoupled from sprite-frame updates,
same timing model as v1: `frameDuration≈200ms/animSpeed`, `moveDuration≈12ms/animSpeed`).

States: `falling | walking | climbing-left | climbing-right | climbing-top |
idle-action | special-action | dragging | sleeping | held-by-behavior`.
Physics: gravity 0.1, damping 0.98, landing bounce reused from v1; **new**: throw
momentum on drag release (velocity from recent pointer deltas), platform support —
a pet may stand on `floor` (work-area bottom) or a `Platform` (top edge of a native
window rect, from `platforms.ts`); when the platform moves >4px/frame or disappears,
pet transitions to `falling` (with a small "startled" hop).

Public API (used by behaviors/skills):
`walkTo(x, opts) | climbTo(edge, y) | play(action) | face(dir) | say(text, opts) |
setPlatform(p) | teleport(x, y) | sleep() | wake() | pin(reason) | unpin(reason)`.

## BehaviorDirector

Single scheduler owning all pets. Every tick it (a) refreshes platform rects (500 ms),
(b) assigns idle pets a behavior via weighted random from eligible catalog entries,
(c) enforces safety:

- **Locks**: each behavior declares `locks: string[]` (e.g. `cursor-follow`,
  `taskbar-parade`, `window:<id>`). A lock may be held by one behavior instance
  globally — prevents two pets fighting over the cursor or stacking on one window.
- **Joint reservations**: multi-pet behaviors atomically reserve all participants
  (both must be idle + unpinned) or don't start.
- **Personal space**: director nudges idle/walking pets apart when bboxes overlap
  >40% for >2 s (the later-arriving pet sidesteps).
- **Cooldowns**: per-behavior `cooldownMs` (global) + per-pet variety memory
  (last 5 behaviors de-weighted ×0.25).
- **Pins**: skills like `stay`, `sleep`, `pomodoro` pin a pet; director skips pinned pets.
- `activityLevel` scales idle-gap sampling (calm = long gaps).

### Behavior catalog (ambient, weighted)
1 wander-walk (v1 walk, base weight) · 2 edge-climb (v1 climb) · 3 idle-action ·
4 special-action · 5 **window-top-walk** (calm shimeji mount: walk to the window's
side, climb its border, stroll across the top — only windows whose bottom edge is
near the floor are climbable; there are NO ballistic hops anywhere) ·
6 **window-sill-sit** (sit idle on a window corner) ·
7 **window-peek** (peek from behind a window edge) · 8 **cursor-chase** (walk toward
cursor while it's far; gives up politely) · 9 **cursor-watch** (face/flip toward cursor
from afar) · 10 **inspect-cursor** (walk to idle cursor, play "thinking") ·
11 **side-by-side-stroll** (joint: two pets walk together) · 12 **meet-and-greet**
(joint: walk to each other, face off, exchange crosstalk bubbles) · 13 **follow-the-leader**
(joint: one leads, others trail) · 14 **mirror-dance** (joint: synced special actions) ·
15 **taskbar-parade** (all-pets line walk, rare) · 16 **screen-edge-patrol** ·
17 **new-window-curiosity** (react when a window appears: walk over, inspect) ·
18 **time-of-day** (morning stretch / midnight yawn special) · 19 **idle-nap** (user
idle > idleSleepMinutes → sleep; wake+greet on return) · 20 **dizzy-tumble** (thrown
fast → dizzy special on landing) · plus `fall`, `drag` as reactive states.

Joint behaviors gate on `characterInteractions`; 5–7, 17 gate on `windowWalking`;
8–10 on `cursorInteractions`. Every behavior narrates itself to `contextBus`
(cheap `run_llm:"false"` context updates) so characters can reference what they're doing.

## Convai integration

`ConvaiManager` (per pet): lazy `ConvaiClient` from `/vanilla` —
`{apiKey, characterId, endUserId?: settings.endUserId (only if character.longTermMemory),
enableVideo: true, startWithAudioOn: false, ttsEnabled: voiceEnabled,
visionInputConfig: {…defaults}, respondModes: {vision:'silent', contextUpdate:'auto',
sceneMetadata:'silent'}, invocationMetadata: {source:'desktop-pet'}}` + `AudioRenderer`.
Connects on first need (chat opened, skill used, free-will on, crosstalk); disconnects
after 5 min unused (keeps plan minutes); `resetIdleTimer()` on user interaction.
Fan-out events: `messagesChange`→ChatPanel+SpeechBubble, `stateChange`→sprite mood,
`botReady`, `error`→toast, `idleWarning`→resetIdleTimer if UI open.

- **contextBus**: batches `updateContext` (append, ≤1/10 s, run_llm:'false') with pet
  activity, active window title, time of day. Free-will ticks (freeWillFrequency,
  quiet-hours aware) send run_llm:'auto' nudges. All comments become speech bubbles.
- **visionService**: on grant → capture loop (`capture_screen` → canvas →
  `publishCanvas(canvas, {source:'screen', name:'user-screen', fps: visionFps})`);
  countdown badge above pet; auto `unpublishVisionSource` at expiry. `look-once` skill =
  single capture + `visionTrigger({respondMode:'must_respond'})`.
- **Memory**: `longTermMemory` toggle per character, **default off**. Enabling shows a
  modal: requires (a) LTM enabled on the character in the Convai dashboard, (b) plan
  with sufficient LTM interaction limits — link to convai.com/pricing with the limits
  table from research. MemoryJournal component lists/deletes memories via
  `client.memoryManager`.
- **crosstalk**: director pairs A,B → alternating `updateContext(run_llm:'true')`
  turns (A told what B said, B told what A said, ≤3 turns each, bubbles staggered,
  only one TTS speaker at a time). Both remember it if their LTM is on (server-side).
- **reminders**: composer UI → store; 30 s scheduler; on create + on due →
  `updateContext(run_llm:'true')` acknowledgment/announcement + native notification
  + sound. Notes: sticky-note board, no AI required.

## Skill wheel

Click a pet (even mid-walk) → radial 8-slot wheel at pet position (framer-motion
spring open, wedge hover states, ESC/click-out closes). Slots come from
`character.skillLoadout`; dashboard character editor lets users swap any of the 22
skills into the 8 slots. Defaults:
`['chat','voice','show-screen','free-will','reminder','stay','friend-chat','sleep']`.
Alt+click = chat shortcut (v1 muscle memory).

## Sounds

`SoundEngine` synthesizes short envelopes via WebAudio (no binary assets): wheel open/
close, hover tick, message send/receive, reminder chime, spawn/despawn, land thump.
Three packs (soft sine / glass FM / retro square) × master sfxVolume.

## Migration & compatibility

- Old electron-store config imported once (apiKey, per-character convai ids, spawn).
- `characters.default.json` keeps v1 animation metadata verbatim; sprite paths unchanged.
- v1 default convai character ids retained; `DEFAULT_LTM_CHARACTER_ID` constant in
  `src/shared/constants.ts` is a placeholder for an LTM-enabled character id (owner TODO).

## Performance notes

- One WebView2 process for the overlay regardless of pet count (v1: N Chromium windows).
- Sprites are `<img>` swaps on absolutely-positioned divs; no canvas repaints; single rAF.
- Cursor poll runs in Rust (no webview wakeups when idle); hit-region updates throttled.
- `list_windows` polled at 500 ms only when windowWalking && any pet spawned.
- Screen capture only during vision grants, at ≤2 fps, downscaled to ≤1280 px JPEG.
