/**
 * Typed wrappers around the Rust commands and cross-window events.
 * All rects/positions crossing this boundary are PHYSICAL pixels.
 */
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AnimationConfig,
  AppSettings,
  CaptureResult,
  CursorPos,
  NativeWindow,
  Rect,
  Reminder,
  VirtualScreen,
  WorkArea,
} from './types';
import {
  EVT_CHARACTERS_CHANGED,
  EVT_CURSOR,
  EVT_OPEN_CHAT,
  EVT_REMINDER_DUE,
  EVT_SETTINGS_CHANGED,
} from './types';

export const ipc = {
  updateHitRegions: (regions: Rect[]) =>
    invoke<void>('update_hit_regions', { regions }),
  setOverlayFocusable: (focusable: boolean) =>
    invoke<void>('set_overlay_focusable', { focusable }),
  overlayReady: () => invoke<void>('overlay_ready'),
  getCursorPos: () => invoke<{ x: number; y: number }>('get_cursor_pos'),
  listWindows: () => invoke<NativeWindow[]>('list_windows'),
  captureScreen: (maxDim = 1280, quality = 70) =>
    invoke<CaptureResult>('capture_screen', { maxDim, quality }),
  getWorkArea: () => invoke<WorkArea>('get_work_area'),
  /** All monitors + the virtual-screen union the overlay covers. */
  getMonitors: () => invoke<VirtualScreen>('get_monitors'),
  /**
   * Copy a user-picked sprite folder into $APPDATA/sprites/<name> and derive
   * its AnimationConfig from the shimeji file naming (walkN/climbN/fallN/
   * dragN/idK_N/spK_N .png). Returns the stored dir + config.
   */
  importSpriteSet: (sourceDir: string, name: string) =>
    invoke<{ dir: string; animation: AnimationConfig }>('import_sprite_set', {
      sourceDir,
      name,
    }),
  /** Gate the ~30 Hz cursor-pos emit; off while no pets are spawned. */
  setCursorStream: (enabled: boolean) =>
    invoke<void>('set_cursor_stream', { enabled }),
  showMainWindow: () => invoke<void>('show_main_window'),
  /** Old Electron install's config.json contents, or null. */
  readLegacyConfig: () =>
    invoke<Record<string, unknown> | null>('read_legacy_config'),
  /**
   * Write the Windows per-app GPU preference for this exe + the WebView2
   * runtime exe. No-op on other platforms; applies on next app start.
   */
  setGpuPreference: (pref: string) =>
    invoke<void>('set_gpu_preference', { pref }),
};

/* ------------------------------ event helpers ------------------------------ */

export const onCursorPos = (cb: (pos: CursorPos) => void): Promise<UnlistenFn> =>
  listen<CursorPos>(EVT_CURSOR, (e) => cb(e.payload));

/** Rust re-emits the primary work area on display/DPI/taskbar changes. */
export const onWorkAreaChanged = (
  cb: (area: WorkArea) => void,
): Promise<UnlistenFn> => listen<WorkArea>('work-area-changed', (e) => cb(e.payload));

/** Rust re-emits the full monitor layout on display changes. */
export const onMonitorsChanged = (
  cb: (vs: VirtualScreen) => void,
): Promise<UnlistenFn> => listen<VirtualScreen>('monitors-changed', (e) => cb(e.payload));

export const notifySettingsChanged = (settings: AppSettings) =>
  emitTo('overlay', EVT_SETTINGS_CHANGED, settings);

export const onSettingsChanged = (
  cb: (settings: AppSettings) => void,
): Promise<UnlistenFn> =>
  listen<AppSettings>(EVT_SETTINGS_CHANGED, (e) => cb(e.payload));

export const notifyCharactersChanged = () =>
  emitTo('overlay', EVT_CHARACTERS_CHANGED, null);

export const onCharactersChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen(EVT_CHARACTERS_CHANGED, () => cb());

export const notifyReminderDue = (reminder: Reminder) =>
  emitTo('overlay', EVT_REMINDER_DUE, reminder);

export const onReminderDue = (
  cb: (reminder: Reminder) => void,
): Promise<UnlistenFn> => listen<Reminder>(EVT_REMINDER_DUE, (e) => cb(e.payload));

/** Dashboard asks the overlay to open chat with a character. */
export const requestOpenChat = (characterName: string) =>
  emitTo('overlay', EVT_OPEN_CHAT, characterName);

export const onOpenChatRequest = (
  cb: (characterName: string) => void,
): Promise<UnlistenFn> => listen<string>(EVT_OPEN_CHAT, (e) => cb(e.payload));
