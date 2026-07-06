/**
 * Dashboard-side zustand store. Wraps the shared AppStore: every mutation
 * persists first, then mirrors into React state, then notifies the overlay
 * via the cross-window events (the dashboard NEVER talks to the engine
 * directly).
 */
import { create } from 'zustand';
import { notifyCharactersChanged, notifySettingsChanged } from '../shared/ipc';
import { sounds } from '../shared/sounds';
import { appStore } from '../shared/store';
import { applyTheme } from '../shared/theme';
import type {
  AnimationConfig,
  AppSettings,
  CharacterRecord,
} from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/constants';

export const APP_VERSION = '2.0.0';

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

  init(): Promise<void>;
  /** Persist + applyTheme + notify overlay. Use for discrete controls. */
  saveSettings(patch: Partial<AppSettings>): Promise<void>;
  /** Optimistic local update, persist/notify debounced 150 ms (sliders). */
  saveSettingsDebounced(patch: Partial<AppSettings>): void;
  updateCharacter(
    name: string,
    patch: Partial<Omit<CharacterRecord, 'name'>>,
  ): Promise<void>;
  setSpawned(name: string, spawned: boolean): Promise<void>;
  addCharacter(
    displayName: string,
    convaiId: string,
    animation: AnimationConfig,
    spriteSource: string,
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
let debounceTimer: number | undefined;

export const useDashboard = create<DashboardState>((set, get) => ({
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  characters: {},
  toasts: [],

  async init() {
    const state = await appStore.load();
    applySettingsSideEffects(state.settings);
    set({
      ready: true,
      settings: { ...state.settings },
      characters: snapshotCharacters(),
    });
  },

  async saveSettings(patch) {
    const settings = await appStore.saveSettings(patch);
    applySettingsSideEffects(settings);
    set({ settings: { ...settings } });
    await notifySettingsChanged(settings);
  },

  saveSettingsDebounced(patch) {
    pendingPatch = { ...pendingPatch, ...patch };
    const next = { ...get().settings, ...patch };
    applySettingsSideEffects(next);
    set({ settings: next });
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      const flush = pendingPatch;
      pendingPatch = {};
      void appStore
        .saveSettings(flush)
        .then((saved) => notifySettingsChanged(saved))
        .catch(() => get().toast('Could not save settings.', 'error'));
    }, 150);
  },

  async updateCharacter(name, patch) {
    await appStore.updateCharacter(name, patch);
    set({ characters: snapshotCharacters() });
    await notifyCharactersChanged();
  },

  async setSpawned(name, spawned) {
    await appStore.updateCharacter(name, { spawned });
    set({ characters: snapshotCharacters() });
    sounds.play(spawned ? 'spawn' : 'despawn');
    await notifyCharactersChanged();
  },

  async addCharacter(displayName, convaiId, animation, spriteSource) {
    const rec = await appStore.addCharacter(
      displayName,
      convaiId,
      animation,
      spriteSource,
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
