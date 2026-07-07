/**
 * AddCharacterModal — 3-step wizard: pick a look (bundled sprite set OR a
 * folder of your own shimeji frames) → name it and link a Convai id →
 * confirm. Custom folders are copied into app data by the Rust
 * `import_sprite_set` command, which also derives the AnimationConfig from
 * the file naming.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useId, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import defaultCharacters from '../../shared/characters.default.json';
import { ipc } from '../../shared/ipc';
import { sounds } from '../../shared/sounds';
import { spriteUrl } from '../../shared/store';
import type { AnimationConfig, CharacterRecord } from '../../shared/types';
import { CONVAI_ID_RE, useDashboard } from '../state';
import { ModalShell } from './controls';

interface SpriteSet {
  name: string;
  displayName: string;
  animation: AnimationConfig;
}

interface CustomSet {
  /** Stored directory (inside app data) returned by import_sprite_set. */
  dir: string;
  animation: AnimationConfig;
  /** Folder basename, for display. */
  label: string;
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

/** Preview URL for a walk1 frame of either source. */
function previewSrc(sprite: SpriteSet | null, custom: CustomSet | null): string {
  if (custom) {
    return spriteUrl({ spriteDir: custom.dir } as CharacterRecord, 'walk1.png');
  }
  if (sprite) {
    return spriteUrl({ name: sprite.name } as CharacterRecord, 'walk1.png');
  }
  return '';
}

export function AddCharacterModal(props: { open: boolean; onClose: () => void }) {
  const { open: isOpen, onClose } = props;
  const addCharacter = useDashboard((s) => s.addCharacter);
  const toast = useDashboard((s) => s.toast);
  const titleId = useId();

  const [step, setStep] = useState(0);
  const [sprite, setSprite] = useState<SpriteSet | null>(null);
  const [custom, setCustom] = useState<CustomSet | null>(null);
  const [importing, setImporting] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [convaiId, setConvaiId] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep(0);
    setSprite(null);
    setCustom(null);
    setImporting(false);
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
  const hasLook = sprite !== null || custom !== null;
  const canNext =
    step === 0 ? hasLook : step === 1 ? !!displayName.trim() && !idInvalid : true;

  const importOwn = async () => {
    if (importing) return;
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: 'Pick the folder with your sprite frames',
      });
      if (!picked || Array.isArray(picked)) return;
      setImporting(true);
      const base = picked.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'custom';
      const name = base.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'custom';
      const res = await ipc.importSpriteSet(picked, name);
      setCustom({ dir: res.dir, animation: res.animation, label: base });
      setSprite(null);
      if (!displayName.trim()) setDisplayName(base);
      sounds.play('select');
    } catch (err) {
      sounds.play('error');
      toast(
        err instanceof Error ? err.message : String(err ?? 'Could not import sprites.'),
        'error',
      );
    } finally {
      setImporting(false);
    }
  };

  const finish = async () => {
    if (!hasLook || busy || idInvalid) return;
    setBusy(true);
    try {
      await addCharacter(
        displayName.trim(),
        convaiId.trim(),
        custom ? custom.animation : sprite!.animation,
        custom ? { spriteDir: custom.dir } : { spriteSource: sprite!.name },
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
      {isOpen && (
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
                    Pick a look — borrow a bundled sprite set, or import a folder of
                    your own shimeji frames.
                  </p>

                  <button
                    type="button"
                    className="cdp-import-card"
                    data-on={custom !== null || undefined}
                    aria-pressed={custom !== null}
                    disabled={importing}
                    onClick={() => void importOwn()}
                  >
                    {custom ? (
                      <img
                        src={previewSrc(null, custom)}
                        alt=""
                        draggable={false}
                        className="cdp-import-preview"
                      />
                    ) : (
                      <span className="cdp-import-icon" aria-hidden>
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                          <path d="M12 10v6" />
                          <path d="M9 13l3-3 3 3" />
                        </svg>
                      </span>
                    )}
                    <span className="cdp-import-meta">
                      <strong>
                        {importing
                          ? 'Importing…'
                          : custom
                            ? `Your sprites: ${custom.label}`
                            : 'Import your own'}
                      </strong>
                      <span>
                        {custom
                          ? 'Looks good! Click to pick a different folder.'
                          : 'Pick a folder of PNG frames. walk1…N.png is required; climb, fall, drag, id1_1…, sp1_1… are optional.'}
                      </span>
                    </span>
                  </button>

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
                          setCustom(null);
                        }}
                      >
                        <img
                          src={spriteUrl({ name: set.name } as CharacterRecord, 'walk1.png')}
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

              {step === 2 && hasLook && (
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div
                    className="cdp-char-preview"
                    style={{ width: 150, margin: '0 auto 14px' }}
                  >
                    <img src={previewSrc(sprite, custom)} alt="" draggable={false} />
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 640 }}>{displayName.trim()}</p>
                  <p className="cdp-modal-body" style={{ marginTop: 6 }}>
                    {custom ? `Your “${custom.label}” sprites` : `${sprite!.displayName} sprite set`}
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
