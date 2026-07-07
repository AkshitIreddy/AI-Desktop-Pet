/**
 * Global hotkeys — registered by the overlay window through the
 * global-shortcut plugin. Re-synced on boot and after every settings save:
 * unregisterAll(), then register each bound accelerator from
 * settings.hotkeys. Actions target the "active" pet — the one the user last
 * clicked, dragged or chatted with (else the first spawned one).
 */
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { appStore } from '../shared/store';
import { sounds } from '../shared/sounds';
import { HOTKEY_ACTIONS } from '../shared/types';
import type { AppSettings, HotkeyAction, SkillId } from '../shared/types';
import { runSkill } from '../skills/handlers';
import { overlayUi, runtime } from './runtime';

/** Hotkey actions that route through the skill system, wheel-style. */
const SKILL_OF: Partial<Record<HotkeyAction, SkillId>> = {
  'toggle-voice': 'voice',
  'toggle-vision': 'show-screen',
  'look-once': 'look-once',
  'dance-party': 'dance-party',
};

function fire(action: HotkeyAction): void {
  // Notes need no pet — the board is a plain local surface.
  if (action === 'open-notes') {
    overlayUi.openNotes();
    return;
  }
  const name = runtime.getActivePet();
  if (!name) return; // nothing spawned — a global beep here would be noise

  switch (action) {
    case 'open-chat':
      overlayUi.openChat(name);
      break;
    case 'new-reminder':
      overlayUi.openReminderComposer(name);
      break;
    case 'toggle-wheel':
      overlayUi.toggleWheel(name);
      break;
    default: {
      const skill = SKILL_OF[action];
      const pet = runtime.director.pets.get(name);
      if (!skill || !pet) return;
      sounds.play('select');
      void runSkill({
        skill,
        pet,
        director: runtime.director,
        layer: runtime.layer,
        store: appStore,
        ui: overlayUi,
      });
    }
  }
}

let syncSeq = 0;
let lastFailureKey = '';

/**
 * Re-register every bound hotkey. Registration conflicts (another app owns
 * the accelerator) are non-fatal: the failing bindings are reported in a
 * single toast, once per distinct failure set.
 */
export async function syncHotkeys(settings: AppSettings): Promise<void> {
  const seq = ++syncSeq;
  try {
    await unregisterAll();
  } catch {
    // Plugin unavailable (old build) — registering below will fail too.
  }
  const failures: string[] = [];
  for (const action of HOTKEY_ACTIONS) {
    if (seq !== syncSeq) return; // superseded by a newer sync
    const accel = settings.hotkeys?.[action]?.trim();
    if (!accel) continue;
    try {
      await register(accel, (event) => {
        if (event.state === 'Pressed') fire(action);
      });
    } catch {
      failures.push(accel);
    }
  }
  if (seq !== syncSeq) return;
  const key = failures.join(',');
  if (failures.length && key !== lastFailureKey) {
    overlayUi.toast(
      failures.length === 1
        ? `Couldn't register hotkey ${failures[0]} — another app may already use it`
        : `Couldn't register hotkeys ${failures.join(', ')} — another app may already use them`,
      'error',
    );
    sounds.play('error');
  }
  lastFailureKey = key;
}
