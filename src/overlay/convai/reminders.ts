/**
 * RemindersEngine — persists reminders in the AppStore, has the character
 * acknowledge new ones out loud, and fires native notifications + character
 * announcements when due (30 s scheduler). If the pet is not spawned or
 * cannot connect, the notification alone still fires.
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { notifyReminderDue } from '../../shared/ipc';
import { sounds } from '../../shared/sounds';
import type { AppStore } from '../../shared/store';
import type { Reminder } from '../../shared/types';
import type { RemindersEngine } from './api';

export interface RemindersDeps {
  store: AppStore;
  /** Force a spoken reply from a character (connects on demand). */
  promptPet(name: string, text: string): Promise<void>;
  hasApiKey(): boolean;
  isSpawned(name: string): boolean;
  displayName(name: string): string;
}

const TICK_MS = 30_000;

function friendlyWhen(ts: number): string {
  return new Date(ts).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function agoText(ts: number): string {
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Unfired reminders due within `withinMs`, soonest first (dashboard helper). */
export function upcomingReminders(store: AppStore, withinMs = 24 * 60 * 60_000): Reminder[] {
  const horizon = Date.now() + withinMs;
  return store.state.reminders
    .filter((r) => !r.fired && r.dueAt <= horizon)
    .sort((a, b) => a.dueAt - b.dueAt);
}

export function createRemindersEngine(deps: RemindersDeps): RemindersEngine & { stop(): void } {
  let timer: ReturnType<typeof setInterval> | null = null;
  let notifyAllowed: boolean | null = null;

  async function canNotify(): Promise<boolean> {
    if (notifyAllowed !== null) return notifyAllowed;
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
      notifyAllowed = granted;
    } catch {
      notifyAllowed = false;
    }
    return notifyAllowed;
  }

  async function fire(reminder: Reminder): Promise<void> {
    // Mark first so a slow prompt can never double-fire on the next tick.
    await deps.store.updateReminder(reminder.id, { fired: true });
    const title = deps.displayName(reminder.characterName);
    if (await canNotify()) {
      try {
        sendNotification({ title, body: reminder.text });
      } catch {
        // Toast delivery is best-effort (unpackaged dev builds may lack identity).
      }
    }
    sounds.play('reminder');
    // Let the overlay UI bounce the pet / show the bubble.
    void notifyReminderDue({ ...reminder, fired: true }).catch(() => undefined);
    if (deps.hasApiKey() && deps.isSpawned(reminder.characterName)) {
      deps
        .promptPet(
          reminder.characterName,
          `REMINDER DUE now: "${reminder.text}" (set ${agoText(reminder.createdAt)}). ` +
            'Tell the user about it now, briefly.',
        )
        .catch(() => undefined); // notification already delivered
    }
  }

  async function tick(): Promise<void> {
    const now = Date.now();
    const due = deps.store.state.reminders.filter((r) => !r.fired && r.dueAt <= now);
    for (const r of due) {
      try {
        await fire(r);
      } catch {
        // Never let one broken reminder stall the scheduler.
      }
    }
  }

  return {
    async create(characterName: string, text: string, dueAt: number): Promise<Reminder> {
      const reminder = await deps.store.addReminder({ characterName, text, dueAt });
      if (deps.hasApiKey()) {
        deps
          .promptPet(
            characterName,
            `The user just set a reminder: "${text}" for ${friendlyWhen(dueAt)}. ` +
              'Confirm to them in one short sentence that you will remind them.',
          )
          .then(() => deps.store.updateReminder(reminder.id, { acknowledged: true }))
          .catch(() => undefined); // silent: the reminder itself is already saved
      }
      return reminder;
    },

    async cancel(id: string): Promise<void> {
      await deps.store.deleteReminder(id);
    },

    start(): void {
      if (timer !== null) return;
      timer = setInterval(() => {
        void tick().catch(() => undefined);
      }, TICK_MS);
      void tick().catch(() => undefined); // catch up anything already due
    },

    stop(): void {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
