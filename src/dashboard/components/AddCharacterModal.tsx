/**
 * AddCharacterModal — 3-step wizard: pick a bundled sprite set → name it and
 * link a Convai id → confirm. User-added characters reuse a bundled sprite
 * set (spriteSource) while keeping their own Convai identity.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useId, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import defaultCharacters from '../../shared/characters.default.json';
import { sounds } from '../../shared/sounds';
import type { AnimationConfig } from '../../shared/types';
import { CONVAI_ID_RE, useDashboard } from '../state';
import { ModalShell } from './controls';

interface SpriteSet {
  name: string;
  displayName: string;
  animation: AnimationConfig;
}

const SPRITE_SETS: SpriteSet[] = Object.entries(
  defaultCharacters as Record<
    string,
    { displayName: string; convaiId: string; animation: AnimationConfig }
  >,
).map(([name, entry]) => ({
  name,
  displayName: entry.displayName,
  animation: entry.animation,
}));

const STEPS = ['Sprite', 'Identity', 'Confirm'] as const;

export function AddCharacterModal(props: { open: boolean; onClose: () => void }) {
  const { open, onClose } = props;
  const addCharacter = useDashboard((s) => s.addCharacter);
  const toast = useDashboard((s) => s.toast);
  const titleId = useId();

  const [step, setStep] = useState(0);
  const [sprite, setSprite] = useState<SpriteSet | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [convaiId, setConvaiId] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep(0);
    setSprite(null);
    setDisplayName('');
    setConvaiId('');
    setBusy(false);
  };

  const close = () => {
    onClose();
    // Reset after the exit animation so step content doesn't flash.
    window.setTimeout(reset, 260);
  };

  const idInvalid = !!convaiId.trim() && !CONVAI_ID_RE.test(convaiId.trim());
  const canNext =
    step === 0 ? sprite !== null : step === 1 ? !!displayName.trim() && !idInvalid : true;

  const finish = async () => {
    if (!sprite || busy || idInvalid) return;
    setBusy(true);
    try {
      await addCharacter(
        displayName.trim(),
        convaiId.trim(),
        sprite.animation,
        sprite.name,
      );
      sounds.play('spawn');
      toast(`${displayName.trim()} joined the roster!`, 'success');
      close();
    } catch (err) {
      setBusy(false);
      toast(err instanceof Error ? err.message : 'Could not add character.', 'error');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <ModalShell onClose={close} width={560} labelledBy={titleId}>
          <h3 id={titleId} className="cdp-modal-title">
            Add a character
          </h3>

          <div className="cdp-steps" aria-label={`Step ${step + 1} of 3`}>
            {STEPS.map((label, i) => (
              <span key={label} style={{ display: 'contents' }}>
                <span
                  className="cdp-step-num"
                  data-active={i === step || undefined}
                  data-done={i < step || undefined}
                >
                  {i < step ? '✓' : i + 1}
                </span>
                <span>{label}</span>
                {i < STEPS.length - 1 && <span className="cdp-step-line" />}
              </span>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 22 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -22 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {step === 0 && (
                <>
                  <p className="cdp-modal-body" style={{ marginBottom: 12 }}>
                    Pick a look. Your new character borrows one of the bundled sprite
                    sets — custom sprite import is coming soon.
                  </p>
                  <div className="cdp-sprite-grid" role="radiogroup" aria-label="Sprite set">
                    {SPRITE_SETS.map((set) => (
                      <button
                        key={set.name}
                        type="button"
                        role="radio"
                        aria-checked={sprite?.name === set.name}
                        className="cdp-onb-pick"
                        data-on={sprite?.name === set.name || undefined}
                        onClick={() => {
                          sounds.play('select');
                          setSprite(set);
                        }}
                      >
                        <img
                          src={`/assets/${set.name}/walk1.png`}
                          alt=""
                          draggable={false}
                          loading="lazy"
                        />
                        {set.displayName}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <label className="cdp-editor-label" htmlFor="add-name">
                    Display name
                  </label>
                  <input
                    id="add-name"
                    className="cdp-input"
                    autoFocus
                    placeholder="e.g. Professor Waffles"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                  <label
                    className="cdp-editor-label"
                    htmlFor="add-id"
                    style={{ marginTop: 16 }}
                  >
                    Convai character id <span style={{ color: 'var(--cdp-text-faint)', fontWeight: 450 }}>(optional, add later)</span>
                  </label>
                  <input
                    id="add-id"
                    className="cdp-input cdp-input-mono"
                    spellCheck={false}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={convaiId}
                    data-invalid={idInvalid || undefined}
                    onChange={(e) => setConvaiId(e.target.value)}
                  />
                  <span className="cdp-input-note" data-warn={idInvalid || undefined}>
                    {idInvalid ? (
                      'That does not look like a character id (UUID expected).'
                    ) : (
                      <>
                        Don&rsquo;t have one?{' '}
                        <a
                          href="#create"
                          onClick={(e) => {
                            e.preventDefault();
                            void openUrl('https://convai.com');
                          }}
                        >
                          Create one at convai.com
                        </a>{' '}
                        — design a personality and voice, then paste its id here.
                      </>
                    )}
                  </span>
                </>
              )}

              {step === 2 && sprite && (
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div
                    className="cdp-char-preview"
                    style={{ width: 150, margin: '0 auto 14px' }}
                  >
                    <img
                      src={`/assets/${sprite.name}/walk1.png`}
                      alt=""
                      draggable={false}
                    />
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 640 }}>{displayName.trim()}</p>
                  <p className="cdp-modal-body" style={{ marginTop: 6 }}>
                    {sprite.displayName} sprite set
                    {convaiId.trim()
                      ? ` · linked to ${convaiId.trim().slice(0, 8)}…`
                      : ' · no Convai id yet (chat disabled until you add one)'}
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="cdp-modal-actions">
            <button
              type="button"
              className="cdp-btn cdp-btn-ghost"
              onClick={step === 0 ? close : () => setStep(step - 1)}
            >
              {step === 0 ? 'Cancel' : 'Back'}
            </button>
            {step < 2 ? (
              <button
                type="button"
                className="cdp-btn cdp-btn-primary"
                disabled={!canNext}
                onClick={() => {
                  sounds.play('select');
                  setStep(step + 1);
                }}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="cdp-btn cdp-btn-primary"
                disabled={busy}
                onClick={() => void finish()}
              >
                {busy ? 'Adding…' : 'Add character'}
              </button>
            )}
          </div>
        </ModalShell>
      )}
    </AnimatePresence>
  );
}
