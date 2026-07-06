import { useEffect, useRef, useState } from 'react';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { openUrl } from '@tauri-apps/plugin-opener';
import { sounds } from '../../shared/sounds';
import type {
  SoundPack,
  SpeechBubbleStyle,
  ThemeMode,
} from '../../shared/types';
import { useDashboard } from '../state';
import {
  ColorSwatchRow,
  ConfirmDialog,
  CopyButton,
  FieldRow,
  SectionCard,
  Segmented,
  Slider,
  TimeField,
  Toggle,
} from '../components/controls';

function icon(path: string) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden dangerouslySetInnerHTML={{ __html: path }} />
  );
}

export function SettingsPage() {
  const s = useDashboard((st) => st.settings);
  const saveSettings = useDashboard((st) => st.saveSettings);
  const saveDebounced = useDashboard((st) => st.saveSettingsDebounced);
  const toast = useDashboard((st) => st.toast);
  const regenerateEndUserId = useDashboard((st) => st.regenerateEndUserId);
  const setTourHidden = useDashboard((st) => st.setTourHidden);

  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const syncedAutostart = useRef(false);
  const keySavedHide = useRef<number | null>(null);

  const onApiKeyChange = (value: string) => {
    setKeySaved(false);
    // The flash confirms the actual persistence result of the debounced flush.
    saveDebounced({ apiKey: value.trim() }, (ok) => {
      if (!ok) return;
      setKeySaved(true);
      sounds.play('select');
      if (keySavedHide.current !== null) window.clearTimeout(keySavedHide.current);
      keySavedHide.current = window.setTimeout(() => setKeySaved(false), 2600);
    });
  };

  // Reconcile the stored flag with the OS on first visit.
  useEffect(() => {
    if (syncedAutostart.current) return;
    syncedAutostart.current = true;
    void isEnabled()
      .then((actual) => {
        if (actual !== useDashboard.getState().settings.autostart) {
          void saveSettings({ autostart: actual });
        }
      })
      .catch(() => {
        /* plugin unavailable in dev — leave the stored value */
      });
  }, [saveSettings]);

  const toggleAutostart = async (next: boolean) => {
    setAutostartBusy(true);
    try {
      if (next) await enable();
      else await disable();
      await saveSettings({ autostart: next });
    } catch {
      toast('Could not update “start with Windows”.', 'error');
    } finally {
      setAutostartBusy(false);
    }
  };

  return (
    <div className="cdp-page-inner" style={{ maxWidth: 760 }}>
      <h1 className="cdp-page-title">Settings</h1>
      <p className="cdp-page-sub">Everything applies live — no restart needed.</p>

      {/* ------------------------------ Connection ------------------------------ */}
      <SectionCard
        title="Connection"
        description="Your Convai account link — powers chat, voice, vision and memory."
        icon={icon('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>')}
      >
        <FieldRow
          label="API key"
          hint={
            <>
              Stored locally, never shared.{' '}
              <a
                href="#key"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl('https://convai.com');
                }}
              >
                Get an API key
              </a>
            </>
          }
          wide
        >
          <div className="cdp-apikey-wrap">
            <input
              className="cdp-input cdp-input-mono"
              type={showKey ? 'text' : 'password'}
              value={s.apiKey}
              placeholder="Paste your Convai API key"
              aria-label="Convai API key"
              spellCheck={false}
              onChange={(e) => onApiKeyChange(e.target.value)}
            />
            {keySaved && <span className="cdp-saved-flash">Saved ✓</span>}
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
        </FieldRow>

        <FieldRow
          label="End-user id"
          hint="Identifies this install to Convai — long-term memories are keyed to it."
          wide
        >
          <div className="cdp-endid" style={{ flex: 1 }}>
            <code title={s.endUserId}>{s.endUserId}</code>
            <span style={{ flex: 1 }} />
            <CopyButton text={s.endUserId} />
            <button
              type="button"
              className="cdp-btn cdp-btn-ghost cdp-btn-sm"
              onClick={() => setConfirmRegen(true)}
            >
              Regenerate…
            </button>
          </div>
        </FieldRow>
      </SectionCard>

      {/* ------------------------------ Appearance ------------------------------ */}
      <SectionCard
        title="Appearance"
        description="Theme and accent for this dashboard and overlay UI."
        icon={icon('<circle cx="13.5" cy="6.5" r="2.5"/><path d="M12 2a10 10 0 1 0 10 10c0-1.2-1-2-2.2-2H17a3 3 0 0 1-3-3V6a4 4 0 0 0-2-4Z"/>')}
      >
        <FieldRow label="Theme">
          <Segmented<ThemeMode>
            ariaLabel="Theme"
            value={s.theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={(theme) => void saveSettings({ theme })}
          />
        </FieldRow>
        <FieldRow label="Accent color" wide>
          <ColorSwatchRow
            value={s.accentColor}
            onChange={(accentColor) => saveDebounced({ accentColor })}
          />
        </FieldRow>
        <FieldRow
          label="Reduce motion"
          hint="Calms every animation — cards, modals, pets’ UI flourishes."
        >
          <Toggle
            checked={s.reduceMotion}
            onChange={(reduceMotion) => void saveSettings({ reduceMotion })}
            label="Reduce motion"
          />
        </FieldRow>
      </SectionCard>

      {/* --------------------------------- Pets --------------------------------- */}
      <SectionCard
        title="Pets"
        description="How your companions look and move on the desktop."
        icon={icon('<circle cx="12" cy="8" r="4.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>')}
      >
        <FieldRow label="Size" hint="Render scale for every pet.">
          <Slider
            label="Pet size"
            min={50}
            max={200}
            step={5}
            value={s.petSize}
            format={(v) => `${v}%`}
            onChange={(petSize) => saveDebounced({ petSize })}
          />
        </FieldRow>
        <FieldRow label="Opacity" hint="Make them ghostly to keep your screen readable.">
          <Slider
            label="Pet opacity"
            min={30}
            max={100}
            step={5}
            value={s.petOpacity}
            format={(v) => `${v}%`}
            onChange={(petOpacity) => saveDebounced({ petOpacity })}
          />
        </FieldRow>
        <FieldRow label="Animation speed" hint="Multiplies walk and sprite speed.">
          <Slider
            label="Animation speed"
            min={0.5}
            max={2}
            step={0.05}
            value={s.animationSpeed}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(animationSpeed) => saveDebounced({ animationSpeed })}
          />
        </FieldRow>
        <FieldRow
          label="Activity level"
          hint="Low = long naps and lazy strolls. High = constant mischief."
        >
          <Slider
            label="Activity level"
            min={0}
            max={100}
            value={s.activityLevel}
            onChange={(activityLevel) => saveDebounced({ activityLevel })}
          />
        </FieldRow>
      </SectionCard>

      {/* ------------------------------- Behaviors ------------------------------ */}
      <SectionCard
        title="Behaviors"
        description="What pets are allowed to do around your desktop."
        icon={icon('<path d="M12 3l2.1 5.1L19 9.2l-4 3.4 1.3 5.4L12 15.2 7.7 18l1.3-5.4-4-3.4 4.9-1.1Z"/>')}
      >
        <FieldRow
          label="Window walking"
          hint="Pets climb onto and stroll along your app windows."
        >
          <Toggle
            checked={s.windowWalking}
            onChange={(windowWalking) => void saveSettings({ windowWalking })}
            label="Window walking"
          />
        </FieldRow>
        <FieldRow
          label="Cursor interactions"
          hint="Chasing, watching and inspecting your mouse cursor."
        >
          <Toggle
            checked={s.cursorInteractions}
            onChange={(cursorInteractions) => void saveSettings({ cursorInteractions })}
            label="Cursor interactions"
          />
        </FieldRow>
        <FieldRow
          label="Character interactions"
          hint="Strolls together, meet-and-greets, dance parties, crosstalk."
        >
          <Toggle
            checked={s.characterInteractions}
            onChange={(characterInteractions) =>
              void saveSettings({ characterInteractions })
            }
            label="Character interactions"
          />
        </FieldRow>
        <FieldRow
          label="Chatter frequency"
          hint="How often nearby characters strike up conversations."
        >
          <Slider
            label="Chatter frequency"
            min={0}
            max={100}
            value={s.chatterFrequency}
            format={(v) => (v === 0 ? 'Off' : `${v}`)}
            onChange={(chatterFrequency) => saveDebounced({ chatterFrequency })}
          />
        </FieldRow>
      </SectionCard>

      {/* -------------------------------- Speech -------------------------------- */}
      <SectionCard
        title="Speech bubbles"
        description="How your pets’ words appear on screen."
        icon={icon('<path d="M21 11.5a8.38 8.38 0 0 1-9 8.36 8.5 8.5 0 0 1-3.4-.7L3 21l1.84-4.6A8.38 8.38 0 0 1 3.5 11.5a8.5 8.5 0 1 1 17.5 0Z"/>')}
      >
        <FieldRow label="Style">
          <Segmented<SpeechBubbleStyle>
            ariaLabel="Speech bubble style"
            value={s.speechBubbleStyle}
            options={[
              {
                value: 'glass',
                label: <span className="cdp-bubble-preview" data-style="glass">glass</span>,
              },
              {
                value: 'solid',
                label: <span className="cdp-bubble-preview" data-style="solid">solid</span>,
              },
              {
                value: 'retro',
                label: <span className="cdp-bubble-preview" data-style="retro">retro</span>,
              },
            ]}
            onChange={(speechBubbleStyle) => void saveSettings({ speechBubbleStyle })}
          />
        </FieldRow>
        <FieldRow label="Font size">
          <Slider
            label="Speech bubble font size"
            min={12}
            max={20}
            value={s.speechBubbleFontSize}
            format={(v) => `${v}px`}
            onChange={(speechBubbleFontSize) => saveDebounced({ speechBubbleFontSize })}
          />
        </FieldRow>
        <FieldRow label="Linger" hint="How long a bubble stays after the voice finishes.">
          <Slider
            label="Speech bubble linger seconds"
            min={2}
            max={15}
            value={s.speechBubbleSeconds}
            format={(v) => `${v}s`}
            onChange={(speechBubbleSeconds) => saveDebounced({ speechBubbleSeconds })}
          />
        </FieldRow>
      </SectionCard>

      {/* ----------------------------- Voice & sound ---------------------------- */}
      <SectionCard
        title="Voice & sound"
        description="Character voices and the app’s own sound effects."
        icon={icon('<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>')}
      >
        <FieldRow label="Voice volume" hint="Loudness of character speech.">
          <Slider
            label="Voice volume"
            min={0}
            max={100}
            value={s.voiceVolume}
            format={(v) => (v === 0 ? 'Muted' : `${v}%`)}
            onChange={(voiceVolume) => saveDebounced({ voiceVolume })}
          />
        </FieldRow>
        <FieldRow label="Effects volume" hint="Wheel ticks, chimes, spawn pops.">
          <Slider
            label="Sound effects volume"
            min={0}
            max={100}
            value={s.sfxVolume}
            format={(v) => (v === 0 ? 'Muted' : `${v}%`)}
            onChange={(sfxVolume) => saveDebounced({ sfxVolume })}
          />
        </FieldRow>
        <FieldRow label="Sound pack" hint="Each pack reshapes every cue.">
          <Segmented<SoundPack>
            ariaLabel="Sound pack"
            value={s.soundPack}
            sound={null}
            options={[
              { value: 'soft', label: 'Soft', title: 'Warm sine chimes' },
              { value: 'glass', label: 'Glass', title: 'Airy bell tones' },
              { value: 'retro', label: 'Retro', title: 'Square-wave blips' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(soundPack) =>
              void saveSettings({ soundPack }).then(() => sounds.play('select'))
            }
          />
        </FieldRow>
      </SectionCard>

      {/* -------------------------------- Free will ----------------------------- */}
      <SectionCard
        title="Free will"
        description="Unprompted comments from characters that have free will enabled."
        icon={icon('<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>')}
      >
        <FieldRow label="Frequency" hint="0 turns free-will chatter off globally.">
          <Slider
            label="Free will frequency"
            min={0}
            max={100}
            value={s.freeWillFrequency}
            format={(v) => (v === 0 ? 'Off' : `${v}`)}
            onChange={(freeWillFrequency) => saveDebounced({ freeWillFrequency })}
          />
        </FieldRow>
        <FieldRow
          label="Quiet hours"
          hint="No unprompted chatter between these times. Clear both to disable."
        >
          <TimeField
            label="Quiet hours start"
            value={s.quietHoursStart}
            onChange={(quietHoursStart) => void saveSettings({ quietHoursStart })}
          />
          <span style={{ color: 'var(--cdp-text-faint)' }}>to</span>
          <TimeField
            label="Quiet hours end"
            value={s.quietHoursEnd}
            onChange={(quietHoursEnd) => void saveSettings({ quietHoursEnd })}
          />
        </FieldRow>
      </SectionCard>

      {/* --------------------------------- Vision ------------------------------- */}
      <SectionCard
        title="Vision"
        description="Screen-sharing sessions started with the “Show screen” skill."
        icon={icon('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/>')}
      >
        <FieldRow label="Capture rate" hint="Frames per second sent while a grant is active.">
          <Segmented<number>
            ariaLabel="Vision capture rate"
            value={s.visionFps}
            options={[
              { value: 0.25, label: '0.25 fps' },
              { value: 0.5, label: '0.5 fps' },
              { value: 1, label: '1 fps' },
              { value: 2, label: '2 fps' },
            ]}
            onChange={(visionFps) => void saveSettings({ visionFps })}
          />
        </FieldRow>
        <FieldRow
          label="Session length"
          hint="Vision auto-revokes after this many minutes."
        >
          <Slider
            label="Vision session minutes"
            min={1}
            max={30}
            value={s.visionSessionMinutes}
            format={(v) => `${v} min`}
            onChange={(visionSessionMinutes) => saveDebounced({ visionSessionMinutes })}
          />
        </FieldRow>
      </SectionCard>

      {/* --------------------------------- System ------------------------------- */}
      <SectionCard
        title="System"
        description="How the app behaves on your machine."
        icon={icon('<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 18v3"/>')}
      >
        <FieldRow label="Start with Windows" hint="Launch pets automatically at login.">
          <Toggle
            checked={s.autostart}
            disabled={autostartBusy}
            onChange={(next) => void toggleAutostart(next)}
            label="Start with Windows"
          />
        </FieldRow>
        <FieldRow
          label="Idle sleep"
          hint="Pets nap when you step away this long. 0 keeps them awake."
        >
          <Slider
            label="Idle sleep minutes"
            min={0}
            max={60}
            step={5}
            value={s.idleSleepMinutes}
            format={(v) => (v === 0 ? 'Never' : `${v} min`)}
            onChange={(idleSleepMinutes) => saveDebounced({ idleSleepMinutes })}
          />
        </FieldRow>
        <FieldRow label="Onboarding" hint="Replay the first-run tour.">
          <button
            type="button"
            className="cdp-btn cdp-btn-sm"
            onClick={() => {
              setTourHidden(false); // clear a session-local Esc dismissal
              void saveSettings({ showOnboarding: true });
            }}
          >
            Show onboarding again
          </button>
        </FieldRow>
      </SectionCard>

      <ConfirmDialog
        open={confirmRegen}
        title="Regenerate end-user id?"
        body={
          <p>
            Characters remember you by this id. A new one <strong>orphans every
            long-term memory</strong> tied to the current id — your pets will treat you
            as a stranger.
          </p>
        }
        confirmLabel="Regenerate"
        danger
        onCancel={() => setConfirmRegen(false)}
        onConfirm={() => {
          setConfirmRegen(false);
          void regenerateEndUserId();
        }}
      />
    </div>
  );
}
