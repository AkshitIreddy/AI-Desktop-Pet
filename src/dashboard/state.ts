/**
 * Dashboard-side zustand store. Wraps the shared AppStore: every mutation
 * persists first, then mirrors into React state, then notifies the overlay
 * via the cross-window events (the dashboard NEVER talks to the engine
 * directly).
 */
import { create } from 'zustand';
import {
  ipc,
  notifyCharactersChanged,
  notifySettingsChanged,
  onCharactersChanged,
} from '../shared/ipc';
import { sounds } from '../shared/sounds';
import { appStore } from '../shared/store';
import { applyTheme } from '../shared/theme';
import type {
  AnimationConfig,
  AppSettings,
  CharacterRecord,
} from '../shared/types';
import { DEFAULT_SETTINGS, freeWillCadenceLabel } from '../shared/constants';

export const APP_VERSION = __APP_VERSION__;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export type PageId = 'characters' | 'skills' | 'settings' | 'docs' | 'about';

interface DashboardState {
  ready: boolean;
  settings: AppSettings;
  characters: Record<string, CharacterRecord>;
  toasts: Toast[];
  /** Esc/backdrop hid the onboarding tour for this session only. */
  tourHidden: boolean;
  setTourHidden(hidden: boolean): void;

  init(): Promise<void>;
  /** Persist + applyTheme + notify overlay. Use for discrete controls. */
  saveSettings(patch: Partial<AppSettings>): Promise<void>;
  /**
   * Optimistic local update, persist/notify debounced 150 ms (sliders).
   * `onResult` fires once when the pending flush persists (or fails).
   */
  saveSettingsDebounced(
    patch: Partial<AppSettings>,
    onResult?: (ok: boolean) => void,
  ): void;
  /** Reset every setting to defaults (keeps api key + end-user id). */
  resetSettings(): Promise<void>;
  updateCharacter(
    name: string,
    patch: Partial<Omit<CharacterRecord, 'name'>>,
  ): Promise<void>;
  setSpawned(name: string, spawned: boolean): Promise<void>;
  addCharacter(
    displayName: string,
    convaiId: string,
    animation: AnimationConfig,
    sprites: { spriteSource?: string; spriteDir?: string },
  ): Promise<CharacterRecord>;
  deleteCharacter(name: string): Promise<void>;
  regenerateEndUserId(): Promise<void>;

  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
}

/** Mirror derived side effects of a settings change onto this window. */
function applySettingsSideEffects(settings: AppSettings): void {
  applyTheme(settings);
  const root = document.documentElement;
  if (settings.reduceMotion) root.dataset.reduceMotion = 'true';
  else delete root.dataset.reduceMotion;
  sounds.configure(settings.soundPack, settings.sfxVolume);
}

function snapshotCharacters(): Record<string, CharacterRecord> {
  const out: Record<string, CharacterRecord> = {};
  for (const [name, rec] of Object.entries(appStore.state.characters)) {
    out[name] = { ...rec, skillLoadout: [...rec.skillLoadout] };
  }
  return out;
}

let toastSeq = 1;
let pendingPatch: Partial<AppSettings> = {};
let pendingOnResult: ((ok: boolean) => void) | undefined;
let debounceTimer: number | undefined;

export const useDashboard = create<DashboardState>((set, get) => ({
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  characters: {},
  toasts: [],
  tourHidden: false,

  setTourHidden(hidden) {
    set({ tourHidden: hidden });
  },

  async init() {
    // The dashboard is the first-run owner (mints endUserId, persists defaults).
    const state = await appStore.load({ init: true });
    applySettingsSideEffects(state.settings);
    set({
      ready: true,
      settings: { ...state.settings },
      characters: snapshotCharacters(),
    });
    // Re-assert the GPU preference each launch: the registry entry names the
    // WebView2 runtime exe by full path, which changes on runtime updates.
    if (state.settings.gpuPreference !== 'default') {
      void ipc.setGpuPreference(state.settings.gpuPreference).catch(() => {});
    }
  },

  async saveSettings(patch) {
    // Absorb any pending debounced patch atomically so this write never
    // reverts optimistic slider edits and the (cancelled) flush can't diverge.
    window.clearTimeout(debounceTimer);
    debounceTimer = undefined;
    const merged = { ...pendingPatch, ...patch };
    const report = pendingOnResult;
    pendingPatch = {};
    pendingOnResult = undefined;
    try {
      const settings = await appStore.saveSettings(merged);
      applySettingsSideEffects(settings);
      set({ settings: { ...settings } });
      report?.(true);
      await notifySettingsChanged(settings);
    } catch (err) {
      report?.(false);
      throw err;
    }
  },

  saveSettingsDebounced(patch, onResult) {
    pendingPatch = { ...pendingPatch, ...patch };
    if (onResult) pendingOnResult = onResult;
    const next = { ...get().settings, ...patch };
    applySettingsSideEffects(next);
    set({ settings: next });
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = undefined;
      const flush = pendingPatch;
      const report = pendingOnResult;
      pendingPatch = {};
      pendingOnResult = undefined;
      void appStore
        .saveSettings(flush)
        .then((saved) => {
          // Mirror the persisted result, keeping any newer optimistic edits.
          set({ settings: { ...saved, ...pendingPatch } });
          report?.(true);
          return notifySettingsChanged(saved);
        })
        .catch(() => {
          report?.(false);
          get().toast('Could not save settings.', 'error');
        });
    }, 150);
  },

  async resetSettings() {
    // Drop any pending debounced patch — it would resurrect pre-reset values.
    window.clearTimeout(debounceTimer);
    debounceTimer = undefined;
    const report = pendingOnResult;
    pendingPatch = {};
    pendingOnResult = undefined;
    const settings = await appStore.resetSettings();
    applySettingsSideEffects(settings);
    set({ settings: { ...settings } });
    report?.(true);
    await notifySettingsChanged(settings);
  },

  async updateCharacter(name, patch) {
    await appStore.updateCharacter(name, patch);
    set({ characters: snapshotCharacters() });
    await notifyCharactersChanged();
    // Switching free will on while the global cadence is Off would silently do
    // nothing — turn it back up to the default and say so, rather than leave a
    // toggle that appears enabled but never speaks.
    if (patch.freeWill === true && get().settings.freeWillFrequency === 0) {
      await get().saveSettings({ freeWillFrequency: DEFAULT_SETTINGS.freeWillFrequency });
      get().toast(
        `Free will was switched off globally — comments are back on (${freeWillCadenceLabel(
          DEFAULT_SETTINGS.freeWillFrequency,
        )}). Adjust in Settings → Free will.`,
        'info',
      );
    }
  },

  async setSpawned(name, spawned) {
    await appStore.updateCharacter(name, { spawned });
    set({ characters: snapshotCharacters() });
    sounds.play(spawned ? 'spawn' : 'despawn');
    await notifyCharactersChanged();
  },

  async addCharacter(displayName, convaiId, animation, sprites) {
    const rec = await appStore.addCharacter(
      displayName,
      convaiId,
      animation,
      sprites,
    );
    set({ characters: snapshotCharacters() });
    await notifyCharactersChanged();
    return rec;
  },

  async deleteCharacter(name) {
    await appStore.deleteCharacter(name);
    set({ characters: snapshotCharacters() });
    await notifyCharactersChanged();
  },

  async regenerateEndUserId() {
    await get().saveSettings({ endUserId: crypto.randomUUID() });
    get().toast('New end-user id generated. Old memories are now orphaned.', 'info');
  },

  toast(text, kind = 'info') {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    if (kind === 'error') sounds.play('error');
    window.setTimeout(() => get().dismissToast(id), 4200);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/**
 * Refresh the zustand mirror from the shared store whenever the dashboard
 * becomes visible/focused, so overlay-side mutations (freeWill toggles from
 * the skill wheel, reminders, notes) show up without a restart and editors
 * never start from stale values.
 */
async function refreshFromStore(): Promise<void> {
  if (!useDashboard.getState().ready) return;
  await appStore.reload();
  useDashboard.setState({
    // Keep any not-yet-flushed optimistic slider edits on top.
    settings: { ...appStore.state.settings, ...pendingPatch },
    characters: snapshotCharacters(),
  });
}

// Live: the overlay emits this right after it writes (free-will toggled from
// the skill wheel, a reminder added…), so an open dashboard updates at once.
void onCharactersChanged(() => void refreshFromStore());
// Fallbacks for anything that changed while this window was hidden.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refreshFromStore();
});
window.addEventListener('focus', () => void refreshFromStore());

/** Sorted, convenient views used by several pages. */
export function characterList(
  characters: Record<string, CharacterRecord>,
): CharacterRecord[] {
  return Object.values(characters).sort((a, b) => {
    if (a.isUserAdded !== b.isUserAdded) return a.isUserAdded ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });
}

export const CONVAI_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
