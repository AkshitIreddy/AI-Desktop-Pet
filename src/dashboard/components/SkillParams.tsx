/**
 * SkillParams — gear button + small popover with one slider per tunable
 * skill parameter. Shared by the Skills page (immediate persistence for the
 * selected character) and the CharacterEditor loadout section (draft mode).
 *
 * The popover keeps a local draft and reports changes through `onSave`
 * (debounced, flushed on close/unmount) so slider drags don't hammer the
 * store or the overlay-refresh events.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sounds } from '../../shared/sounds';
import type { SkillDef } from '../../shared/types';
import { Slider } from './controls';

export function SkillParamsButton(props: {
  def: SkillDef;
  /** Current per-character overrides for this skill (may be partial). */
  values: Record<string, number> | undefined;
  /** Called per param key when the user changes a slider (debounced). */
  onSave: (key: string, value: number) => void;
  /** Small context line, e.g. the character the edit applies to. */
  subtitle?: string;
  /** Align the popover to the left or right edge of the button. */
  align?: 'left' | 'right';
}) {
  const { def, values, onSave, subtitle, align = 'right' } = props;
  const [open, setOpen] = useState(false);

  if (!def.params?.length) return null;

  return (
    <span className="cdp-params">
      <button
        type="button"
        className="cdp-gear"
        aria-label={`Tune ${def.label} parameters`}
        aria-expanded={open}
        title={`Tune ${def.label}`}
        data-open={open || undefined}
        onClick={() => {
          sounds.play(open ? 'wheel-close' : 'wheel-open');
          setOpen((v) => !v);
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <SkillParamsPopover
            def={def}
            values={values}
            onSave={onSave}
            subtitle={subtitle}
            align={align}
            onClose={() => {
              sounds.play('wheel-close');
              setOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </span>
  );
}

export function SkillParamsPopover(props: {
  def: SkillDef;
  values: Record<string, number> | undefined;
  onSave: (key: string, value: number) => void;
  onClose: () => void;
  subtitle?: string;
  align?: 'left' | 'right';
}) {
  const { def, values, onSave, onClose, subtitle, align = 'right' } = props;
  const ref = useRef<HTMLDivElement>(null);

  // Local draft so slider drags feel instant; saves are debounced below.
  const initial = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of def.params ?? []) {
      const v = values?.[p.key];
      out[p.key] = typeof v === 'number' && Number.isFinite(v) ? v : p.default;
    }
    return out;
  }, [def, values]);
  const [draft, setDraft] = useState(initial);

  const pending = useRef<Record<string, number>>({});
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const flush = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const batch = pending.current;
    pending.current = {};
    for (const [key, value] of Object.entries(batch)) saveRef.current(key, value);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const change = (key: string, value: number) => {
    setDraft((d) => ({ ...d, [key]: value }));
    pending.current[key] = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flushRef.current(), 220);
  };

  // Flush unsaved edits when the popover unmounts (close, page switch).
  useEffect(() => () => flushRef.current(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      className="cdp-params-pop"
      data-align={align}
      role="dialog"
      aria-label={`${def.label} parameters`}
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 480, damping: 34 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="cdp-params-head">
        <strong>{def.label}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {(def.params ?? []).map((p) => (
        <div key={p.key} className="cdp-params-row">
          <span className="cdp-params-label">{p.label}</span>
          <Slider
            label={`${def.label} — ${p.label}`}
            min={p.min}
            max={p.max}
            step={p.step}
            value={draft[p.key] ?? p.default}
            format={(v) => `${v}${p.unit === '%' ? '%' : ` ${p.unit}`}`}
            onChange={(v) => change(p.key, v)}
          />
        </div>
      ))}
      <div className="cdp-params-foot">Saved per character.</div>
    </motion.div>
  );
}
