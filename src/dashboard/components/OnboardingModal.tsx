/**
 * OnboardingModal — 4-step first-run tour. Shown while
 * settings.showOnboarding is true; only Finish (and Docs) persist it off.
 * Esc/backdrop dismissal is session-local (onDismiss) so an accidental
 * keypress doesn't kill the tour for good.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useId, useState, type CSSProperties } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { sounds } from '../../shared/sounds';
import { spriteUrl } from '../../shared/store';
import { characterList, useDashboard } from '../state';
import { ModalShell } from './controls';

const STEP_COUNT = 4;

export function OnboardingModal(props: {
  onOpenDocs: () => void;
  onDismiss: () => void;
}) {
  const settings = useDashboard((s) => s.settings);
  const characters = useDashboard((s) => s.characters);
  const saveSettings = useDashboard((s) => s.saveSettings);
  const setSpawned = useDashboard((s) => s.setSpawned);

  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [showKey, setShowKey] = useState(false);
  // True when a key already existed when the tour opened — i.e. it was
  // migrated from a previous install (or typed on an earlier run). The key
  // step must SHOW it rather than silently carrying it along.
  const [hadMigratedKey] = useState(() => !!settings.apiKey.trim());
  const titleId = useId();

  const roster = characterList(characters).filter((c) => !c.archived);
  const spawnedCount = roster.filter((c) => c.spawned).length;

  const persistKey = async () => {
    const trimmed = apiKey.trim();
    if (trimmed !== settings.apiKey) await saveSettings({ apiKey: trimmed });
  };

  const finish = async () => {
    await persistKey();
    await saveSettings({ showOnboarding: false });
    sounds.play('complete');
  };

  const next = async () => {
    sounds.play('select');
    if (step === 1) await persistKey();
    setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  };

  return (
    <ModalShell
      onClose={() => {
        // Session-local dismissal: keep any typed key, but don't persist
        // showOnboarding off — the tour returns on next launch.
        void persistKey();
        props.onDismiss();
      }}
      width={640}
      labelledBy={titleId}
    >
      <div className="cdp-onb">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            {step === 0 && (
              <>
                <div className="cdp-onb-hero" aria-hidden>
                  <img src="/assets/venti/walk1.png" alt="" draggable={false} />
                  <img src="/assets/klee/walk1.png" alt="" draggable={false} />
                  <img src="/assets/hutao/walk1.png" alt="" draggable={false} />
                </div>
                <h2 id={titleId}>Welcome to Desktop Pets</h2>
                <p className="lede">
                  Your pets live right on your desktop — they walk your taskbar, climb
                  your windows, tumble when you throw them, and hold real conversations
                  powered by Convai.
                </p>
              </>
            )}

            {step === 1 && (
              <>
                <h2 id={titleId}>Connect Convai</h2>
                <p className="lede">
                  {hadMigratedKey
                    ? 'Found a key from your previous install — keep it or paste a new one.'
                    : 'An API key unlocks chat, voice and vision. You can skip this and add it later in Settings.'}
                </p>
                <div className="cdp-apikey-wrap" style={{ maxWidth: 420, margin: '0 auto' }}>
                  <input
                    className="cdp-input cdp-input-mono"
                    type={showKey ? 'text' : 'password'}
                    placeholder="Paste your Convai API key"
                    aria-label="Convai API key"
                    value={apiKey}
                    autoFocus
                    spellCheck={false}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <button
                    type="button"
                    className="cdp-apikey-eye"
                    aria-label={showKey ? 'Hide API key' : 'Reveal API key'}
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? (
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M1 1l22 22" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                {hadMigratedKey && apiKey.trim() && (
                  <p
                    style={{
                      textAlign: 'center',
                      marginTop: 8,
                      fontSize: 12,
                      color: 'var(--cdp-text-faint)',
                    }}
                  >
                    Click the eye to check it — continuing keeps this key.
                  </p>
                )}
                <p style={{ textAlign: 'center', marginTop: 10, fontSize: 12.5 }}>
                  <a
                    href="#key"
                    onClick={(e) => {
                      e.preventDefault();
                      void openUrl('https://convai.com');
                    }}
                  >
                    Get a free API key at convai.com
                  </a>
                </p>
              </>
            )}

            {step === 2 && (
              <>
                <h2 id={titleId}>How to interact</h2>
                <p className="lede">Three moves are all you need.</p>
                <div className="cdp-onb-tiles">
                  <div className="cdp-onb-tile">
                    <div className="cdp-onb-art" aria-hidden>
                      <div className="cdp-onb-wheel">
                        {Array.from({ length: 8 }, (_, i) => (
                          <i key={i} style={{ '--i': i } as CSSProperties} />
                        ))}
                      </div>
                      <svg className="cdp-onb-cursor" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
                        <path d="M4 4l7.5 16 2-6.5L20 11.5Z" />
                      </svg>
                    </div>
                    <h4>Click</h4>
                    <p>Opens the radial skill wheel — 8 skills per character.</p>
                  </div>
                  <div className="cdp-onb-tile">
                    <div className="cdp-onb-art" aria-hidden>
                      <span className="cdp-onb-bubble">hi!</span>
                    </div>
                    <h4>
                      <span className="cdp-onb-kbd">Alt</span> + Click
                    </h4>
                    <p>Jumps straight into a chat, v1 style.</p>
                  </div>
                  <div className="cdp-onb-tile">
                    <div className="cdp-onb-art" aria-hidden>
                      <img
                        className="cdp-onb-throw"
                        src="/assets/spongebob/walk1.png"
                        alt=""
                        draggable={false}
                      />
                    </div>
                    <h4>Drag &amp; throw</h4>
                    <p>Pick them up, fling them — real momentum, dizzy landings.</p>
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 id={titleId}>Spawn your first pet</h2>
                <p className="lede">
                  {spawnedCount > 0
                    ? `${spawnedCount} spawned — look at your desktop!`
                    : 'Tap a character to bring it to life. You can spawn as many as you like.'}
                </p>
                <div className="cdp-onb-picker">
                  {roster.map((rec) => (
                    <button
                      key={rec.name}
                      type="button"
                      className="cdp-onb-pick"
                      data-on={rec.spawned || undefined}
                      aria-pressed={rec.spawned}
                      onClick={() => void setSpawned(rec.name, !rec.spawned)}
                    >
                      <img
                        src={spriteUrl(rec, 'walk1.png')}
                        alt=""
                        draggable={false}
                        loading="lazy"
                      />
                      {rec.displayName}
                    </button>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="cdp-onb-dots" aria-hidden>
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <span key={i} className="cdp-onb-dot" data-active={i === step || undefined} />
          ))}
        </div>

        <div className="cdp-onb-nav">
          <button
            type="button"
            className="cdp-btn cdp-btn-ghost"
            onClick={() => {
              void finish().then(() => props.onOpenDocs());
            }}
          >
            Docs
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            {step > 0 && (
              <button
                type="button"
                className="cdp-btn"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                Back
              </button>
            )}
            {step === 1 && !apiKey.trim() && (
              <button type="button" className="cdp-btn" onClick={() => void next()}>
                Skip for now
              </button>
            )}
            {step < STEP_COUNT - 1 ? (
              <button
                type="button"
                className="cdp-btn cdp-btn-primary"
                onClick={() => void next()}
              >
                {step === 0 ? "Let's go" : 'Continue'}
              </button>
            ) : (
              <button
                type="button"
                className="cdp-btn cdp-btn-primary"
                onClick={() => void finish()}
              >
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
