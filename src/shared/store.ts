/**
 * AppStore — persistence for settings, characters, reminders and notes on top
 * of tauri-plugin-store. Both windows load their own instance; cross-window
 * sync happens via the notify* helpers in ipc.ts (the overlay re-reads on
 * `characters-changed` / applies `settings-changed` payloads directly).
 */
import { LazyStore } from '@tauri-apps/plugin-store';
import { convertFileSrc } from '@tauri-apps/api/core';
import defaultCharacters from './characters.default.json';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SKILL_LOADOUT,
  LEGACY_DEFAULT_BUMPS,
  SCHEMA_VERSION,
} from './constants';
import { ipc } from './ipc';
import type {
  AnimationConfig,
  AppSettings,
  CharacterRecord,
  Note,
  PersistedState,
  Reminder,
} from './types';

const FILE = 'app-data.json';
const KEY = 'state';

type Listener = (state: PersistedState) => void;

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function buildDefaultCharacters(): Record<string, CharacterRecord> {
  const out: Record<string, CharacterRecord> = {};
  for (const [name, entry] of Object.entries(
    defaultCharacters as Record<
      string,
      { displayName: string; convaiId: string; animation: AnimationConfig }
    >,
  )) {
    out[name] = {
      name,
      displayName: entry.displayName,
      convaiId: entry.convaiId,
      spawned: false,
      archived: false,
      isUserAdded: false,
      longTermMemory: false,
      freeWill: false,
      voiceEnabled: true,
      skillLoadout: [...DEFAULT_SKILL_LOADOUT],
      animation: entry.animation,
    };
  }
  return out;
}

export class AppStore {
  private store = new LazyStore(FILE);
  private listeners = new Set<Listener>();
  private writeListeners = new Set<() => void>();
  state!: PersistedState;

  /**
   * Load persisted state. Only the initializing window (the dashboard) passes
   * `{ init: true }`, which generates first-run defaults (endUserId) and
   * persists them — a single writer, so both windows can never race to mint
   * and save two different ids on first run.
   */
  async load(opts?: { init?: boolean }): Promise<PersistedState> {
    const existing = await this.store.get<PersistedState>(KEY);
    if (existing && existing.characters && existing.settings) {
      // Any prior schema version upgrades in place via mergeDefaults — never
      // wipe a user's data because SCHEMA_VERSION moved.
      this.state = this.mergeDefaults(existing);
    } else {
      this.state = {
        schemaVersion: SCHEMA_VERSION,
        settings: { ...DEFAULT_SETTINGS },
        characters: buildDefaultCharacters(),
        reminders: [],
        notes: [],
      };
      await this.migrateLegacy();
    }
    if (opts?.init) {
      if (!this.state.settings.endUserId) {
        this.state.settings.endUserId = crypto.randomUUID();
      }
      await this.persist();
    }
    return this.state;
  }

  /** Keep old installs working when new settings/character fields appear. */
  private mergeDefaults(loaded: PersistedState): PersistedState {
    const settings: AppSettings = { ...DEFAULT_SETTINGS, ...loaded.settings };
    // Stored values still equal to an old default follow the new default.
    for (const bump of LEGACY_DEFAULT_BUMPS) {
      if (settings[bump.key] === bump.from) settings[bump.key] = bump.to;
    }
    const characters: Record<string, CharacterRecord> = {};
    const defaults = buildDefaultCharacters();
    for (const [name, def] of Object.entries(defaults)) {
      characters[name] = { ...def, ...(loaded.characters[name] ?? {}) };
    }
    // Bundled Cartman was renamed "South Park Cartman" (keeps him out of the
    // top of the alphabetical grid). Carry along installs that never renamed him.
    if (characters['cartman']?.displayName === 'Cartman') {
      characters['cartman'].displayName = defaults['cartman'].displayName;
    }
    for (const [name, rec] of Object.entries(loaded.characters)) {
      if (!characters[name]) {
        characters[name] = {
          ...rec,
          skillLoadout: rec.skillLoadout?.length === 8 ? rec.skillLoadout : [...DEFAULT_SKILL_LOADOUT],
        };
      }
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      settings,
      characters,
      reminders: loaded.reminders ?? [],
      notes: loaded.notes ?? [],
    };
  }

  /** One-time import from the v1 Electron install (api key, ids, spawn flags). */
  private async migrateLegacy(): Promise<void> {
    try {
      const legacy = await ipc.readLegacyConfig();
      if (!legacy) return;
      const apiKey = legacy['apiKey'];
      // Import only values that actually look like a Convai API key — v1
      // config files can hold junk here, which would show up in Settings as
      // a mystery key that was never the user's.
      if (typeof apiKey === 'string' && /^[0-9a-f]{32}$/i.test(apiKey.trim())) {
        this.state.settings.apiKey = apiKey.trim();
      }
      const chars = legacy['characters'] as
        | Record<string, { id?: string; spawn?: boolean; archived?: boolean }>
        | undefined;
      if (chars) {
        for (const [name, old] of Object.entries(chars)) {
          const rec = this.state.characters[sanitizeName(name)];
          if (!rec) continue;
          if (typeof old.id === 'string' && old.id) rec.convaiId = old.id;
          if (typeof old.spawn === 'boolean') rec.spawned = old.spawn;
          if (typeof old.archived === 'boolean') rec.archived = old.archived;
        }
      }
    } catch {
      // Legacy config is best-effort; never block first run on it.
    }
  }

  private async persist(): Promise<void> {
    await this.store.set(KEY, this.state);
    await this.store.save();
    for (const cb of this.listeners) cb(this.state);
    for (const cb of this.writeListeners) cb();
  }

  /**
   * Fires after a LOCAL write only (never on reload), so a window can tell the
   * other window "I changed something" without the two echoing each other.
   */
  onWrite(cb: () => void): () => void {
    this.writeListeners.add(cb);
    return () => this.writeListeners.delete(cb);
  }

  /**
   * Re-read the shared store so mutations never persist a stale snapshot.
   * Both windows write the whole blob last-writer-wins; tauri-plugin-store
   * shares one Rust-side store per path, so this cheap get() always returns
   * the other window's latest committed state.
   */
  private async sync(): Promise<void> {
    const loaded = await this.store.get<PersistedState>(KEY);
    if (loaded && loaded.schemaVersion === SCHEMA_VERSION) this.state = loaded;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /* ------------------------------- settings ------------------------------- */

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    await this.sync();
    this.state.settings = { ...this.state.settings, ...patch };
    await this.persist();
    return this.state.settings;
  }

  /** Reset every setting to defaults, keeping identity (api key, end-user id). */
  async resetSettings(): Promise<AppSettings> {
    await this.sync();
    const { apiKey, endUserId } = this.state.settings;
    this.state.settings = {
      ...DEFAULT_SETTINGS,
      apiKey,
      endUserId,
      showOnboarding: false,
    };
    await this.persist();
    return this.state.settings;
  }

  /* ------------------------------ characters ------------------------------ */

  get characters(): CharacterRecord[] {
    return Object.values(this.state.characters);
  }

  async reload(): Promise<PersistedState> {
    const loaded = await this.store.get<PersistedState>(KEY);
    if (loaded) {
      this.state = loaded;
      for (const cb of this.listeners) cb(this.state);
    }
    return this.state;
  }

  async updateCharacter(
    name: string,
    patch: Partial<Omit<CharacterRecord, 'name'>>,
  ): Promise<CharacterRecord | undefined> {
    await this.sync();
    const rec = this.state.characters[name];
    if (!rec) return undefined;
    Object.assign(rec, patch);
    await this.persist();
    return rec;
  }

  /**
   * Add a user character. Sprites must already exist under
   * public/assets/<name>/ (bundled) — user-added characters reuse an existing
   * sprite set (spriteSource) while keeping their own Convai identity.
   */
  async addCharacter(
    displayName: string,
    convaiId: string,
    animation: AnimationConfig,
    sprites: { spriteSource?: string; spriteDir?: string },
  ): Promise<CharacterRecord> {
    await this.sync();
    let name = sanitizeName(displayName);
    if (!name) throw new Error('Name must contain letters or numbers.');
    while (this.state.characters[name]) name = `${name}-2`;
    const rec: CharacterRecord = {
      name,
      displayName,
      convaiId,
      spawned: false,
      archived: false,
      isUserAdded: true,
      longTermMemory: false,
      freeWill: false,
      voiceEnabled: true,
      skillLoadout: [...DEFAULT_SKILL_LOADOUT],
      animation,
      spriteSource: sprites.spriteSource,
      spriteDir: sprites.spriteDir,
    };
    this.state.characters[name] = rec;
    await this.persist();
    return rec;
  }

  async deleteCharacter(name: string): Promise<void> {
    await this.sync();
    const rec = this.state.characters[name];
    if (!rec) return;
    if (!rec.isUserAdded) throw new Error('Bundled characters can be archived, not deleted.');
    delete this.state.characters[name];
    await this.persist();
  }

  /* --------------------------- reminders & notes --------------------------- */

  async addReminder(r: Omit<Reminder, 'id' | 'createdAt' | 'acknowledged' | 'fired'>): Promise<Reminder> {
    await this.sync();
    const reminder: Reminder = {
      ...r,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      acknowledged: false,
      fired: false,
    };
    this.state.reminders.push(reminder);
    await this.persist();
    return reminder;
  }

  async updateReminder(id: string, patch: Partial<Reminder>): Promise<void> {
    await this.sync();
    const r = this.state.reminders.find((x) => x.id === id);
    if (!r) return;
    Object.assign(r, patch);
    await this.persist();
  }

  async deleteReminder(id: string): Promise<void> {
    await this.sync();
    this.state.reminders = this.state.reminders.filter((x) => x.id !== id);
    await this.persist();
  }

  async addNote(text: string, color: string): Promise<Note> {
    await this.sync();
    const note: Note = { id: crypto.randomUUID(), text, color, createdAt: Date.now() };
    this.state.notes.push(note);
    await this.persist();
    return note;
  }

  async updateNote(id: string, patch: Partial<Note>): Promise<void> {
    await this.sync();
    const n = this.state.notes.find((x) => x.id === id);
    if (!n) return;
    Object.assign(n, patch);
    await this.persist();
  }

  async deleteNote(id: string): Promise<void> {
    await this.sync();
    this.state.notes = this.state.notes.filter((x) => x.id !== id);
    await this.persist();
  }
}

/** Sprite folder for a character (user-added ones reuse a bundled sprite set). */
export function spriteFolder(rec: CharacterRecord): string {
  return rec.spriteSource ?? rec.name;
}

/**
 * URL for a sprite frame file. Custom imported sets live on disk and are
 * served through the asset protocol; bundled sets come from /assets.
 */
export function spriteUrl(rec: CharacterRecord, file: string): string {
  if (rec.spriteDir) {
    const sep = rec.spriteDir.includes('\\') ? '\\' : '/';
    return convertFileSrc(`${rec.spriteDir}${sep}${file}`);
  }
  return `/assets/${spriteFolder(rec)}/${file}`;
}

export const appStore = new AppStore();
