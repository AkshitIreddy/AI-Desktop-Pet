/**
 * Reusable, animated form controls for the dashboard. All colors come from
 * --cdp-* variables; motion respects settings.reduceMotion via the global
 * MotionConfig in App plus the [data-reduce-motion] CSS hammer.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ACCENT_PRESETS } from '../../shared/constants';
import { sounds, type SoundCue } from '../../shared/sounds';

export const SPRING = { type: 'spring', stiffness: 500, damping: 34 } as const;
export const SPRING_SOFT = { type: 'spring', stiffness: 320, damping: 30 } as const;

/* ---------------------------------- Toggle ---------------------------------- */

export function Toggle(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'md' | 'lg';
  /** Cue played on change; null silences (caller plays its own). */
  sound?: SoundCue | null;
}) {
  const { checked, onChange, label, disabled, size = 'md', sound = 'select' } = props;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`cdp-toggle ${size === 'lg' ? 'cdp-toggle-lg' : ''}`}
      data-on={checked || undefined}
      onClick={() => {
        if (sound) sounds.play(sound);
        onChange(!checked);
      }}
    >
      <motion.span className="cdp-toggle-thumb" layout transition={SPRING} />
    </button>
  );
}

/* ---------------------------------- Slider ---------------------------------- */

export function Slider(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const { value, min, max, step = 1, onChange, label, format, disabled } = props;
  const pct = ((value - min) / (max - min)) * 100;
  const fill: CSSProperties = {
    background: `linear-gradient(to right, var(--cdp-accent) ${pct}%, var(--cdp-surface-hover) ${pct}%)`,
  };
  return (
    <div className="cdp-slider">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={fill}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="cdp-slider-value">{format ? format(value) : value}</span>
    </div>
  );
}

/* ------------------------------- ColorSwatchRow ------------------------------ */

export function ColorSwatchRow(props: {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
}) {
  const { value, onChange, label = 'Accent color' } = props;
  const customRef = useRef<HTMLInputElement>(null);
  const isPreset = ACCENT_PRESETS.some(
    (p) => p.toLowerCase() === value.toLowerCase(),
  );
  return (
    <div className="cdp-swatch-row" role="radiogroup" aria-label={label}>
      {ACCENT_PRESETS.map((hex) => {
        const active = hex.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`Accent ${hex}`}
            className="cdp-swatch"
            data-active={active || undefined}
            style={{ background: hex }}
            onClick={() => {
              sounds.play('select');
              onChange(hex);
            }}
          >
            {active && (
              <motion.span
                className="cdp-swatch-ring"
                layoutId="swatch-ring"
                transition={SPRING}
              />
            )}
          </button>
        );
      })}
      <button
        type="button"
        className="cdp-swatch cdp-swatch-custom"
        aria-label="Custom accent color"
        data-active={!isPreset || undefined}
        style={!isPreset ? { background: value } : undefined}
        onClick={() => customRef.current?.click()}
        title="Pick a custom color"
      >
        {!isPreset ? (
          <motion.span
            className="cdp-swatch-ring"
            layoutId="swatch-ring"
            transition={SPRING}
          />
        ) : (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
        <input
          ref={customRef}
          type="color"
          value={value}
          tabIndex={-1}
          aria-hidden
          onChange={(e) => onChange(e.target.value)}
        />
      </button>
    </div>
  );
}

/* ---------------------------------- Select ----------------------------------- */

export function Select<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const { value, options, onChange, label } = props;
  return (
    <div className="cdp-select-wrap">
      <select
        className="cdp-select"
        aria-label={label}
        value={value}
        onChange={(e) => {
          sounds.play('select');
          onChange(e.target.value as T);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg className="cdp-select-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}

/* --------------------------------- TimeField --------------------------------- */

export function TimeField(props: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
}) {
  const { value, onChange, label } = props;
  return (
    <div className="cdp-timefield">
      <input
        type="time"
        className="cdp-input"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <AnimatePresence>
        {value && (
          <motion.button
            type="button"
            className="cdp-timefield-clear"
            aria-label={`Clear ${label}`}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            onClick={() => onChange('')}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------- Segmented ---------------------------------- */

export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  /** Cue on select (default 'select'); null silences. */
  sound?: SoundCue | null;
}) {
  const { value, options, onChange, ariaLabel, sound = 'select' } = props;
  const group = useId();
  return (
    <div className="cdp-segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            className="cdp-segment"
            data-active={active || undefined}
            onClick={() => {
              if (o.value === value) return;
              if (sound) sounds.play(sound);
              onChange(o.value);
            }}
          >
            {active && (
              <motion.span
                className="cdp-segment-pill"
                layoutId={`seg-${group}`}
                transition={SPRING}
              />
            )}
            <span className="cdp-segment-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------- SectionCard -------------------------------- */

export function SectionCard(props: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  danger?: boolean;
}) {
  const { title, description, icon, children, danger } = props;
  return (
    <motion.section
      className={`cdp-section ${danger ? 'cdp-section-danger' : ''}`}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <header className="cdp-section-head">
        {icon && <span className="cdp-section-icon">{icon}</span>}
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </header>
      <div className="cdp-section-body">{children}</div>
    </motion.section>
  );
}

/** Label + hint on the left, control on the right. */
export function FieldRow(props: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const { label, hint, children, wide } = props;
  return (
    <div className={`cdp-field-row ${wide ? 'cdp-field-row-wide' : ''}`}>
      <div className="cdp-field-meta">
        <span className="cdp-field-label">{label}</span>
        {hint && <span className="cdp-field-hint">{hint}</span>}
      </div>
      <div className="cdp-field-control">{children}</div>
    </div>
  );
}

/* -------------------------------- Modal shell -------------------------------- */

/** Render inside <AnimatePresence> from the caller. */
export function ModalShell(props: {
  onClose: () => void;
  children: ReactNode;
  width?: number;
  labelledBy?: string;
}) {
  const { onClose, children, width = 460, labelledBy } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <motion.div
      className="cdp-modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="cdp-modal"
        style={{ maxWidth: width }}
        initial={{ opacity: 0, scale: 0.92, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={SPRING_SOFT}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------- ConfirmDialog ------------------------------- */

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** When set, the user must type this exact text to enable Confirm. */
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {
    open,
    title,
    body,
    confirmLabel = 'Confirm',
    danger,
    requireText,
    onConfirm,
    onCancel,
  } = props;
  const [typed, setTyped] = useState('');
  const titleId = useId();
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);
  const blocked = !!requireText && typed !== requireText;
  return (
    <AnimatePresence>
      {open && (
        <ModalShell onClose={onCancel} labelledBy={titleId} width={420}>
          <h3 id={titleId} className="cdp-modal-title">
            {title}
          </h3>
          <div className="cdp-modal-body">{body}</div>
          {requireText && (
            <input
              className="cdp-input cdp-confirm-type"
              placeholder={`Type "${requireText}" to confirm`}
              value={typed}
              autoFocus
              onChange={(e) => setTyped(e.target.value)}
              aria-label={`Type ${requireText} to confirm`}
            />
          )}
          <div className="cdp-modal-actions">
            <button type="button" className="cdp-btn" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className={danger ? 'cdp-btn cdp-btn-danger' : 'cdp-btn cdp-btn-primary'}
              disabled={blocked}
              onClick={() => {
                sounds.play(danger ? 'despawn' : 'select');
                onConfirm();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </ModalShell>
      )}
    </AnimatePresence>
  );
}

/* --------------------------------- SkillIcon --------------------------------- */

/** Renders a skill's stroke icon (inner SVG markup from the registry). */
export function SkillIcon(props: { icon: string; size?: number }) {
  const { icon, size = 20 } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: icon }}
    />
  );
}

/* -------------------------------- CopyButton --------------------------------- */

export function CopyButton(props: { text: string; label?: string }) {
  const { text, label = 'Copy' } = props;
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="cdp-btn cdp-btn-ghost cdp-btn-sm"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          sounds.play('select');
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? 'Copied!' : label}
    </button>
  );
}
