/**
 * Skill execution — every wheel wedge routes through runSkill(). Handlers stay
 * UI-framework-free: panels are opened through the UiApi the overlay passes in.
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { SKILLS } from './registry';
import { ipc } from '../shared/ipc';
import { sounds } from '../shared/sounds';
import type { AppStore } from '../shared/store';
import { skillParam } from '../shared/types';
import type { SkillId } from '../shared/types';
import type { DirectorApi, PetHandle } from '../overlay/engine/api';
import type { ConvaiLayer } from '../overlay/convai/api';

export interface UiApi {
  openChat(name: string): void;
  openReminderComposer(name: string): void;
  openNotes(): void;
  openMemoryJournal(name: string): void;
  toast(msg: string, kind?: 'info' | 'success' | 'error'): void;
}

export interface SkillContext {
  skill: SkillId;
  pet: PetHandle;
  director: DirectorApi;
  layer: ConvaiLayer;
  store: AppStore;
  ui: UiApi;
}

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong';
}

/* ------------------------------- toggle state -------------------------------- */

const staying = new Set<string>();
const following = new Set<string>();
const whispering = new Set<string>();
const pomodoros = new Map<string, { endsAt: number; timer: number; minutes: number }>();

const DANCE_PARTY_MS = 6_000;

/** Runtime calls this when a pet despawns so toggles don't leak across spawns. */
export function clearPetSkillState(name: string): void {
  staying.delete(name);
  following.delete(name);
  whispering.delete(name);
  const p = pomodoros.get(name);
  if (p) {
    window.clearTimeout(p.timer);
    pomodoros.delete(name);
  }
}

export function getSkillState(
  pet: PetHandle,
  skill: SkillId,
  layer: ConvaiLayer,
  store: AppStore,
): boolean {
  const name = pet.rec.name;
  switch (skill) {
    case 'voice':
      return safeStatus(layer, name)?.micOn ?? false;
    case 'show-screen':
      return safeStatus(layer, name)?.visionActive ?? false;
    case 'free-will':
      return store.state.characters[name]?.freeWill ?? pet.rec.freeWill;
    case 'stay':
      return staying.has(name);
    case 'follow-cursor':
      return following.has(name);
    case 'sleep':
      return pet.state === 'sleeping';
    case 'whisper':
      return whispering.has(name);
    case 'pomodoro':
      return pomodoros.has(name);
    default:
      return false;
  }
}

function safeStatus(layer: ConvaiLayer, name: string) {
  try {
    return layer.forPet(name).status();
  } catch {
    return null;
  }
}

async function notifyNative(title: string, body: string): Promise<void> {
  try {
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === 'granted';
    if (ok) sendNotification({ title, body });
  } catch {
    // Notifications are best-effort.
  }
}

/* --------------------------------- runSkill ----------------------------------- */

export async function runSkill(ctx: SkillContext): Promise<void> {
  const { skill, pet, director, layer, store, ui } = ctx;
  const name = pet.rec.name;
  const rec = store.state.characters[name] ?? pet.rec;
  const def = SKILLS[skill];

  if (def.needsConvai && !store.state.settings.apiKey.trim()) {
    ui.toast('Add your Convai API key in the dashboard first', 'error');
    sounds.play('error');
    void ipc.showMainWindow();
    return;
  }

  try {
    switch (skill) {
      case 'chat':
        ui.openChat(name);
        break;

      case 'voice': {
        const pc = layer.forPet(name);
        if (pc.status().micOn) {
          await pc.setMic(false);
        } else {
          await pc.ensureConnected();
          await pc.setMic(true);
        }
        break;
      }

      case 'show-screen': {
        const pc = layer.forPet(name);
        if (pc.status().visionActive) {
          await pc.revokeVision();
          ui.toast(`${rec.displayName} can no longer see your screen`, 'info');
        } else {
          await pc.ensureConnected();
          // Per-character session length; falls back to the global setting.
          const mins =
            skillParam(rec, 'show-screen', SKILLS['show-screen'], 'minutes') ||
            store.state.settings.visionSessionMinutes;
          await pc.grantVision(mins);
          ui.toast(`${rec.displayName} can see your screen for ${mins} min`, 'success');
        }
        break;
      }

      case 'free-will': {
        const next = !(store.state.characters[name]?.freeWill ?? false);
        await store.updateCharacter(name, { freeWill: next });
        layer.refresh();
        ui.toast(
          next
            ? `${rec.displayName} will now speak up freely`
            : `${rec.displayName} will stay quiet unless spoken to`,
          'info',
        );
        break;
      }

      case 'stay':
        if (staying.delete(name)) {
          director.stopSkill(name, 'stay');
        } else {
          following.delete(name); // director.runSkill('stay') kills the follow-cursor loop
          staying.add(name);
          director.runSkill(name, 'stay');
        }
        break;

      case 'follow-cursor':
        if (following.delete(name)) {
          director.stopSkill(name, 'follow-cursor');
        } else {
          following.add(name);
          director.runSkill(name, 'follow-cursor');
        }
        break;

      case 'reminder':
        ui.openReminderComposer(name);
        break;

      case 'notes':
        ui.openNotes();
        break;

      case 'sleep':
        if (pet.state === 'sleeping') pet.wake();
        else pet.sleep();
        break;

      case 'wander':
        if (staying.delete(name)) director.stopSkill(name, 'stay');
        if (following.delete(name)) director.stopSkill(name, 'follow-cursor');
        cancelPomodoro(ctx);
        if (pet.state === 'sleeping') pet.wake();
        director.runSkill(name, 'wander');
        break;

      case 'look-once': {
        const pc = layer.forPet(name);
        try {
          await pc.ensureConnected();
          await pc.lookOnce();
        } catch (err) {
          ui.toast(`Couldn't take a look: ${messageOf(err)}`, 'error');
          sounds.play('error');
        }
        break;
      }

      case 'summon':
        director.runSkill(name, 'summon');
        break;

      case 'friend-chat': {
        const others = [...director.pets.values()].filter(
          (p) => p.rec.name !== name && !p.hidden,
        );
        if (!others.length) {
          ui.toast('No other characters are out right now', 'info');
          break;
        }
        let best = others[0];
        let bd = Infinity;
        for (const o of others) {
          const d = Math.abs(o.x - pet.x);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        void layer.crosstalk
          .start(name, best.rec.name)
          .catch((err) => ui.toast(messageOf(err), 'error'));
        break;
      }

      case 'dance-party':
        director.runSkill(name, 'dance-party');
        window.setTimeout(() => sounds.play('complete'), DANCE_PARTY_MS);
        break;

      case 'pomodoro': {
        if (pomodoros.has(name)) {
          cancelPomodoro(ctx);
          ui.toast('Focus session cancelled', 'info');
          break;
        }
        following.delete(name); // director.runSkill('pomodoro') kills the follow-cursor loop
        director.runSkill(name, 'pomodoro'); // abort running behavior + pin + sit
        const minutes = skillParam(rec, 'pomodoro', SKILLS['pomodoro'], 'minutes') || 25;
        const ms = minutes * 60_000;
        const timer = window.setTimeout(() => finishPomodoro(ctx), ms);
        pomodoros.set(name, { endsAt: Date.now() + ms, timer, minutes });
        ui.toast(
          `Focus time — ${rec.displayName} will sit with you for ${minutes} minutes`,
          'success',
        );
        break;
      }

      case 'daily-briefing': {
        const pc = layer.forPet(name);
        await pc.ensureConnected();
        const hour = new Date().getHours();
        const tod =
          hour < 5 ? 'late night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
        const pending = store.state.reminders
          .filter((r) => !r.fired)
          .sort((a, b) => a.dueAt - b.dueAt)
          .slice(0, 6);
        const remindersText = pending.length
          ? pending
              .map(
                (r) =>
                  `"${r.text}" due ${new Date(r.dueAt).toLocaleString([], {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`,
              )
              .join('; ')
          : 'none';
        pc.prompt(
          `Give the user a short, warm ${tod} briefing right now. ` +
            `Their pending reminders: ${remindersText}. ` +
            `Keep it under three sentences and add a bit of cheer.`,
        );
        break;
      }

      case 'memory-journal':
        if (!store.state.characters[name]?.longTermMemory) {
          ui.toast(
            `Turn on long-term memory for ${rec.displayName} in the dashboard's character settings first`,
            'info',
          );
          break;
        }
        ui.openMemoryJournal(name);
        break;

      case 'whisper': {
        const pc = layer.forPet(name);
        const on = !whispering.has(name);
        if (on) whispering.add(name);
        else whispering.delete(name);
        pc.setWhisper(on);
        ui.toast(
          on
            ? `${rec.displayName} will reply silently in text`
            : `${rec.displayName} can speak out loud again`,
          'info',
        );
        break;
      }

      case 'teleport-home':
        director.runSkill(name, 'teleport-home');
        break;

      case 'hide': {
        following.delete(name); // followLoop self-exits when the pet hides
        director.runSkill(name, 'hide'); // duration param is read engine-side
        const hideMins = skillParam(rec, 'hide', SKILLS['hide'], 'minutes') || 15;
        ui.toast(
          `${rec.displayName} will be back in ${hideMins} minute${hideMins === 1 ? '' : 's'}`,
          'info',
        );
        break;
      }

      case 'do-a-trick':
        void pet.playSpecial().catch(() => {});
        break;

      case 'walk-my-window':
        director.runSkill(name, 'walk-my-window');
        break;
    }
  } catch (err) {
    ui.toast(messageOf(err), 'error');
    sounds.play('error');
  }
}

function cancelPomodoro(ctx: SkillContext): boolean {
  const name = ctx.pet.rec.name;
  const p = pomodoros.get(name);
  if (!p) return false;
  window.clearTimeout(p.timer);
  pomodoros.delete(name);
  ctx.pet.unpin('pomodoro');
  ctx.pet.wake(); // cancelled — stand back up, no celebration
  return true;
}

function finishPomodoro(ctx: SkillContext): void {
  const { pet, director, layer, store } = ctx;
  const name = pet.rec.name;
  const session = pomodoros.get(name);
  if (!session || !pomodoros.delete(name)) return;
  const minutes = session.minutes;
  director.stopSkill(name, 'pomodoro'); // unpin + wake + celebrate one-shot
  sounds.play('complete');
  const displayName = store.state.characters[name]?.displayName ?? name;
  void notifyNative(
    'Focus session complete',
    `${minutes} minutes done — ${displayName} is proud of you!`,
  );
  if (store.state.settings.apiKey.trim()) {
    const pc = layer.forPet(name);
    void pc
      .ensureConnected()
      .then(() =>
        pc.prompt(
          `The ${minutes}-minute focus session you were keeping the user company for just ended. ` +
            'Congratulate them warmly and briefly.',
        ),
      )
      .catch(() => {});
  }
}
