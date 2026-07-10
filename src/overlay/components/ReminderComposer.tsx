/**
 * ReminderComposer — small glass dialog near the pet with two tabs:
 * "New" (what + when; saving goes through the Convai layer's reminders engine
 * so the character acknowledges it) and "Upcoming" (every stored reminder,
 * soonest first, with delete).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { sounds } from '../../shared/sounds';
import { appStore } from '../../shared/store';
import type { Reminder } from '../../shared/types';
import { messageOf } from '../../skills/handlers';
import { hitRegionRegistry } from '../engine/hitRegions';
import { monitorAt } from '../engine/monitors';
import { clamp, displayNameOf, overlayUi, runtime, useOverlayStore } from '../runtime';

const W = 320;

type ComposerTab = 'new' | 'upcoming';

function toLocalInput(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

function chipTimes(): { label: string; at: () => Date }[] {
  return [
    { label: 'In 30 min', at: () => new Date(Date.now() + 30 * 60_000) },
    { label: 'In 1 h', at: () => new Date(Date.now() + 60 * 60_000) },
    {
      label: 'Tonight 20:00',
      at: () => {
        const d = new Date();
        d.setHours(20, 0, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return d;
      },
    },
    {
      label: 'Tomorrow 9:00',
      at: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
  ];
}

function formatWhen(dueAt: number): string {
  const d = new Date(dueAt);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `at ${time}`;
  return `on ${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

function sortedReminders(list: Reminder[]): Reminder[] {
  return [...list].sort((a, b) => a.dueAt - b.dueAt);
}

export function ReminderComposer({ petName }: { petName: string }) {
  const reduce = useOverlayStore((s) => s.settings.reduceMotion);
  const [tab, setTab] = useState<ComposerTab>('new');
  const [text, setText] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 30 * 60_000)));
  const [chip, setChip] = useState<number | null>(0);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>(() =>
    sortedReminders(appStore.state.reminders),
  );
  const ref = useRef<HTMLDivElement>(null);
  const chips = useMemo(chipTimes, []);

  const pos = useMemo(() => {
    const env = runtime.env;
    const pet = runtime.director.pets.get(petName);
    if (!pet) return { x: (env.width - W) / 2, y: env.height / 2 - 140 };
    // Anchor on the pet's own monitor, above its taskbar (see SkillWheel).
    const b = pet.bbox();
    const m = monitorAt(env, b.x + b.w / 2);
    let x = b.x + b.w + 14;
    if (x + W > m.right - 8) x = b.x - W - 14;
    return {
      x: clamp(x, m.left + 8, m.right - W - 8),
      y: clamp(b.y - 60, m.top + 8, m.floorY - 300),
    };
  }, [petName]);

  // Focus lease + Escape to close + live reminder list.
  useEffect(() => {
    const release = runtime.acquireFocus();
    const unsub = appStore.subscribe((st) => setReminders(sortedReminders(st.reminders)));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') overlayUi.closeReminderComposer();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unsub();
      release();
    };
  }, []);

  // Hit region tracks the rendered rect (height varies with validation text).
  // Uses layout geometry (pos + offsetHeight) rather than getBoundingClientRect
  // so the framer-motion entry transform can't shrink/offset the region.
  useEffect(() => {
    const el = ref.current;
    if (el) hitRegionRegistry.set('composer', { x: pos.x, y: pos.y, w: W, h: el.offsetHeight });
  });
  useEffect(() => () => hitRegionRegistry.set('composer', null), []);

  const switchTab = (next: ComposerTab) => {
    if (next === tab) return;
    sounds.play('select');
    setTab(next);
    setErr('');
  };

  const remove = (id: string) => {
    sounds.play('select');
    runtime.layer.reminders.cancel(id).catch((e) => {
      overlayUi.toast(messageOf(e), 'error');
      sounds.play('error');
    });
  };

  const pickChip = (i: number) => {
    setChip(i);
    setWhen(toLocalInput(chips[i].at()));
    setErr('');
  };

  const save = async () => {
    const note = text.trim();
    const dueAt = new Date(when).getTime();
    if (!note) {
      setErr('Write what to remind you about');
      return;
    }
    if (!Number.isFinite(dueAt) || dueAt <= Date.now()) {
      setErr('Pick a time in the future');
      return;
    }
    setSaving(true);
    try {
      await runtime.layer.reminders.create(petName, note, dueAt);
      sounds.play('select');
      overlayUi.closeReminderComposer();
      overlayUi.toast(
        `${displayNameOf(petName)} will remind you ${formatWhen(dueAt)}`,
        'success',
      );
    } catch (e) {
      setErr(messageOf(e));
      setSaving(false);
    }
  };

  return (
    <motion.div
      ref={ref}
      className="composer cdp-glass"
      style={{ left: pos.x, top: pos.y, width: W }}
      initial={reduce ? false : { opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 28 }}
    >
      <header className="panel-header">
        <div className="panel-title">Reminders</div>
        <button
          type="button"
          className="icon-btn"
          title="Close"
          onClick={() => overlayUi.closeReminderComposer()}
        >
          ×
        </button>
      </header>

      <div className="composer-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'new'}
          className={`composer-tab ${tab === 'new' ? 'is-selected' : ''}`}
          onClick={() => switchTab('new')}
        >
          New
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'upcoming'}
          className={`composer-tab ${tab === 'upcoming' ? 'is-selected' : ''}`}
          onClick={() => switchTab('upcoming')}
        >
          Upcoming{reminders.length ? ` (${reminders.length})` : ''}
        </button>
      </div>

      {tab === 'new' ? (
        <>
          <textarea
            className="composer-text"
            rows={2}
            autoFocus
            placeholder="What should I remind you about?"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (err) setErr('');
            }}
          />

          <div className="composer-chips">
            {chips.map((c, i) => (
              <button
                key={c.label}
                type="button"
                className={`chip ${chip === i ? 'is-selected' : ''}`}
                onClick={() => pickChip(i)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <input
            className="composer-when"
            type="datetime-local"
            value={when}
            min={toLocalInput(new Date())}
            onChange={(e) => {
              setWhen(e.target.value);
              setChip(null);
              setErr('');
            }}
          />

          {err && <div className="composer-error">{err}</div>}

          <button type="button" className="primary-btn" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save reminder'}
          </button>
        </>
      ) : (
        <div className="upcoming-list">
          {reminders.length === 0 && (
            <div className="upcoming-empty">Nothing scheduled — you're all caught up.</div>
          )}
          {reminders.map((r) => (
            <div key={r.id} className={`upcoming-row ${r.fired ? 'is-fired' : ''}`}>
              <div className="upcoming-main">
                <div className="upcoming-text">{r.text}</div>
                <div className="upcoming-meta">
                  {displayNameOf(r.characterName)} · due {formatWhen(r.dueAt)}
                  {r.fired && <span className="upcoming-fired">Delivered</span>}
                </div>
              </div>
              <button
                type="button"
                className="icon-btn upcoming-delete"
                title="Delete reminder"
                onClick={() => remove(r.id)}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 7h16" />
                  <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  <path d="M6.5 7l1 13h9l1-13" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
