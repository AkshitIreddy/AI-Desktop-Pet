/**
 * HotkeyRecorder — a click-to-record field for one global hotkey binding.
 * Click → "Press keys…" captures a single combo on keydown and builds a
 * Tauri accelerator ("CommandOrControl+Alt+X"). Esc cancels, Backspace/Delete
 * clears the binding. Plain letters/digits need a modifier; F-keys don't.
 */
import { useEffect, useState } from 'react';
import { sounds } from '../../shared/sounds';

const MODIFIER_KEYS = new Set([
  'Control',
  'Alt',
  'Shift',
  'Meta',
  'AltGraph',
  'CapsLock',
  'NumLock',
  'ScrollLock',
]);

const F_KEY_RE = /^F([1-9]|1[0-9]|2[0-4])$/;

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  '+': 'Plus',
  '-': '-',
  '=': '=',
  '[': '[',
  ']': ']',
  ';': ';',
  "'": "'",
  ',': ',',
  '.': '.',
  '/': '/',
  '\\': '\\',
  '`': '`',
};

function mainKeyOf(e: KeyboardEvent): string {
  const k = e.key;
  if (/^[a-z]$/i.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return k;
  if (F_KEY_RE.test(k)) return k;
  return NAMED_KEYS[k] ?? '';
}

/**
 * null = keep listening (modifier-only / unmappable key),
 * 'needs-modifier' = valid key but no modifier held,
 * otherwise the finished accelerator string.
 */
function acceleratorFrom(e: KeyboardEvent): string | null | 'needs-modifier' {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const main = mainKeyOf(e);
  if (!main) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (mods.length === 0 && !F_KEY_RE.test(main)) return 'needs-modifier';
  return [...mods, main].join('+');
}

/** Pretty per-key chips: CommandOrControl renders as Ctrl on Windows. */
function displayParts(accelerator: string): string[] {
  return accelerator
    .split('+')
    .map((p) => (p === 'CommandOrControl' ? 'Ctrl' : p));
}

export function HotkeyRecorder(props: {
  /** Current accelerator, '' when unbound. */
  value: string;
  /** Accessible name of the action being bound. */
  actionLabel: string;
  /** Label of another action already using this combo (duplicate warning). */
  conflict?: string;
  onCommit: (accelerator: string) => void;
  onClear: () => void;
}) {
  const { value, actionLabel, conflict, onCommit, onClear } = props;
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (!recording) return;
    setHint('');
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        onClear();
        setRecording(false);
        sounds.play('select');
        return;
      }
      const acc = acceleratorFrom(e);
      if (acc === null) return;
      if (acc === 'needs-modifier') {
        setHint('Hold Ctrl, Alt or Shift too (F-keys can stand alone).');
        return;
      }
      onCommit(acc);
      setRecording(false);
      sounds.play('select');
    };
    const stop = () => setRecording(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', stop);
    };
  }, [recording, onCommit, onClear]);

  return (
    <div className="cdp-hotkey-wrap">
      <div className="cdp-hotkey-row">
        <button
          type="button"
          className="cdp-hotkey"
          data-recording={recording || undefined}
          data-set={(!recording && !!value) || undefined}
          aria-label={
            recording
              ? `Recording hotkey for ${actionLabel} — press a key combination, Esc to cancel, Backspace to clear`
              : `Hotkey for ${actionLabel}: ${value ? displayParts(value).join(' ') : 'not set'}. Click to record.`
          }
          onClick={() => {
            if (!recording) sounds.play('hover');
            setRecording((r) => !r);
          }}
        >
          {recording ? (
            <span className="cdp-hotkey-listen">Press keys…</span>
          ) : value ? (
            displayParts(value).map((part, i) => (
              <kbd key={`${part}-${i}`} className="cdp-hotkey-key">
                {part}
              </kbd>
            ))
          ) : (
            <span className="cdp-hotkey-empty">Not set</span>
          )}
        </button>
        {value && !recording && (
          <button
            type="button"
            className="cdp-hotkey-clear"
            aria-label={`Clear hotkey for ${actionLabel}`}
            title="Clear"
            onClick={() => {
              sounds.play('select');
              onClear();
            }}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>
      {recording && hint && (
        <span className="cdp-input-note" data-warn>
          {hint}
        </span>
      )}
      {!recording && conflict && (
        <span className="cdp-input-note" data-warn>
          Also bound to “{conflict}” — only one will win.
        </span>
      )}
    </div>
  );
}
