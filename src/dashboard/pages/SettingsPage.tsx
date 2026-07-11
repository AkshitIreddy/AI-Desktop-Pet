import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { openUrl } from '@tauri-apps/plugin-opener';
import { sounds } from '../../shared/sounds';
import type {
  GpuPreference,
  HotkeyAction,
  SoundPack,
  SpeechBubbleStyle,
  ThemeMode,
} from '../../shared/types';
import { HOTKEY_ACTIONS } from '../../shared/types';
import { ipc } from '../../shared/ipc';
import { fuzzyScore } from '../search';
import { useDashboard } from '../state';
import { HotkeyRecorder } from '../components/HotkeyRecorder';
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

const HOTKEY_META: Record<HotkeyAction, { label: string; hint: string }> = {
  'open-chat': { label: 'Open chat', hint: 'Pop open the chat panel.' },
  'toggle-voice': { label: 'Toggle voice', hint: 'Start or stop the live voice conversation.' },
  'toggle-vision': { label: 'Toggle screen sharing', hint: 'Grant or revoke screen vision.' },
  'look-once': { label: 'Take a look', hint: 'One quick glance at your screen, with a comment.' },
  'open-notes': { label: 'Open notes', hint: 'Show the sticky-notes board.' },
  'new-reminder': { label: 'New reminder', hint: 'Open the reminder composer.' },
  'dance-party': { label: 'Dance party', hint: 'Everyone breaks into their special moves.' },
  'toggle-wheel': { label: 'Skill wheel', hint: 'Open or close the skill wheel.' },
};

/* Search haystacks — one per section, covering titles, row labels and the
   words people actually type. The synonyms map in search.ts does the rest. */
const HAY = {
  connection:
    'connection convai api key account link update key paste end user id identity regenerate memory always connected auto connect spawn instant replies',
  appearance:
    'appearance theme system light dark accent color colour swatch pink reduce motion animation calm',
  pets: 'pets size scale opacity ghost transparent animation speed activity level naps mischief',
  behaviors:
    'behaviors window walking climb cursor interactions mouse chase character interactions joint chatter frequency conversations',
  interaction:
    'interaction chat panel close after sending skill wheel close after choosing autoclose overlay',
  speech:
    'speech bubbles style glass solid retro font size linger words text',
  sound:
    'voice sound volume effects sfx pack soft glass retro mute audio loudness chimes',
  freewill:
    'free will frequency unprompted comments quiet hours night do not disturb',
  vision:
    'vision screen sharing capture rate fps session length minutes monitor display see',
  hotkeys:
    'hotkeys global shortcuts keyboard bindings combo open chat toggle voice vision take a look notes reminder dance party skill wheel',
  system:
    'system start with windows autostart login idle sleep nap onboarding tour replay reset all settings defaults restore gpu graphics card integrated dedicated discrete power saving high performance renderer usage',
} as const;

/** FieldRow whose label glows when it matches the settings search query. */
function Row(props: {
  q: string;
  label: string;
  hay?: string;
  hint?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const { q, label, hay = '', hint, wide, children } = props;
  const hit = !!q && fuzzyScore(q, `${label} ${hay}`) > 0;
  return (
    <FieldRow
      wide={wide}
      hint={hint}
      label={
        <span className="cdp-row-label" data-hit={hit || undefined}>
          {label}
        </span>
      }
    >
      {children}
    </FieldRow>
  );
}

export function SettingsPage() {
  const s = useDashboard((st) => st.settings);
  const saveSettings = useDashboard((st) => st.saveSettings);
  const saveDebounced = useDashboard((st) => st.saveSettingsDebounced);
  const resetSettings = useDashboard((st) => st.resetSettings);
  const toast = useDashboard((st) => st.toast);
  const regenerateEndUserId = useDashboard((st) => st.regenerateEndUserId);
  const setTourHidden = useDashboard((st) => st.setTourHidden);

  const [query, setQuery] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [keyEditing, setKeyEditing] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const syncedAutostart = useRef(false);
  const keySavedHide = useRef<number | null>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const q = query.trim();
  const vis = (hay: string) => !q || fuzzyScore(q, hay) > 0;
  const visibleCount = useMemo(
    () => Object.values(HAY).filter((h) => vis(h)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q],
  );

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

  const startKeyEdit = () => {
    sounds.play('select');
    setKeyEditing(true);
    const el = keyInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
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

  const applyGpuPreference = async (gpuPreference: GpuPreference) => {
    try {
      await ipc.setGpuPreference(gpuPreference);
      await saveSettings({ gpuPreference });
      toast('GPU preference saved — restart the app to apply it.', 'success');
    } catch {
      toast('Could not update the GPU preference.', 'error');
    }
  };

  const setHotkey = (action: HotkeyAction, accelerator: string) => {
    const hotkeys = { ...s.hotkeys };
    if (accelerator) hotkeys[action] = accelerator;
    else delete hotkeys[action];
    void saveSettings({ hotkeys });
  };

  const conflictFor = (action: HotkeyAction): string | undefined => {
    const acc = s.hotkeys[action];
    if (!acc) return undefined;
    for (const other of HOTKEY_ACTIONS) {
      if (other !== action && s.hotkeys[other] === acc) {
        return HOTKEY_META[other].label;
      }
    }
    return undefined;
  };

  return (
    <div className="cdp-page-inner" style={{ maxWidth: 760 }}>
      <h1 className="cdp-page-title">Settings</h1>
      <p className="cdp-page-sub">Everything applies live — no restart needed.</p>

      <div className="cdp-search cdp-settings-search">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          className="cdp-input"
          placeholder="Search settings… (try “colour”, “mic”, “shortcut”)"
          aria-label="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {q && visibleCount === 0 && (
        <div className="cdp-empty">
          <span style={{ fontSize: 34 }} aria-hidden>
            🔍
          </span>
          <strong>No settings match “{query}”</strong>
          <span>Try another word — “sound”, “screen”, “key”, “hotkey”…</span>
        </div>
      )}

      {/* ------------------------------ Connection ------------------------------ */}
      {vis(HAY.connection) && (
        <SectionCard
          title="Connection"
          description="Your Convai account link — powers chat, voice, vision and memory."
          icon={icon('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>')}
        >
          <Row
            q={q}
            label="API key"
            hay="convai api key paste update"
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
                ref={keyInputRef}
                className="cdp-input cdp-input-mono"
                type={showKey ? 'text' : 'password'}
                value={s.apiKey}
                placeholder="Paste your Convai API key"
                aria-label="Convai API key"
                spellCheck={false}
                data-editing={keyEditing || undefined}
                onFocus={() => setKeyEditing(true)}
                onBlur={() => setKeyEditing(false)}
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
            <button
              type="button"
              className="cdp-btn cdp-btn-sm"
              onClick={startKeyEdit}
              title="Edit the key — the field selects itself so you can paste right over it"
            >
              Update key
            </button>
          </Row>

          <Row
            q={q}
            label="Always connected"
            hay="auto connect spawn free will instant replies session"
            hint="Pets connect to Convai the moment they spawn, so free will and replies are instant."
          >
            <Toggle
              checked={s.autoConnect}
              onChange={(autoConnect) => void saveSettings({ autoConnect })}
              label="Always connected"
            />
          </Row>

          <Row
            q={q}
            label="End-user id"
            hay="identity install uuid memories regenerate"
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
          </Row>
        </SectionCard>
      )}

      {/* ------------------------------ Appearance ------------------------------ */}
      {vis(HAY.appearance) && (
        <SectionCard
          title="Appearance"
          description="Theme and accent for this dashboard and overlay UI."
          icon={icon('<circle cx="13.5" cy="6.5" r="2.5"/><path d="M12 2a10 10 0 1 0 10 10c0-1.2-1-2-2.2-2H17a3 3 0 0 1-3-3V6a4 4 0 0 0-2-4Z"/>')}
        >
          <Row q={q} label="Theme" hay="system light dark mode">
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
          </Row>
          <Row q={q} label="Accent color" hay="colour swatch pink highlight" wide>
            <ColorSwatchRow
              value={s.accentColor}
              onChange={(accentColor) => saveDebounced({ accentColor })}
            />
          </Row>
          <Row
            q={q}
            label="Reduce motion"
            hay="animation calm accessibility"
            hint="Calms every animation — cards, modals, pets’ UI flourishes."
          >
            <Toggle
              checked={s.reduceMotion}
              onChange={(reduceMotion) => void saveSettings({ reduceMotion })}
              label="Reduce motion"
            />
          </Row>
        </SectionCard>
      )}

      {/* --------------------------------- Pets --------------------------------- */}
      {vis(HAY.pets) && (
        <SectionCard
          title="Pets"
          description="How your companions look and move on the desktop."
          icon={icon('<circle cx="12" cy="8" r="4.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>')}
        >
          <Row q={q} label="Size" hay="scale render pet" hint="Render scale for every pet.">
            <Slider
              label="Pet size"
              min={50}
              max={200}
              step={5}
              value={s.petSize}
              format={(v) => `${v}%`}
              onChange={(petSize) => saveDebounced({ petSize })}
            />
          </Row>
          <Row
            q={q}
            label="Opacity"
            hay="transparent ghost see through"
            hint="Make them ghostly to keep your screen readable."
          >
            <Slider
              label="Pet opacity"
              min={30}
              max={100}
              step={5}
              value={s.petOpacity}
              format={(v) => `${v}%`}
              onChange={(petOpacity) => saveDebounced({ petOpacity })}
            />
          </Row>
          <Row
            q={q}
            label="Animation speed"
            hay="walk sprite fast slow"
            hint="Multiplies walk and sprite speed."
          >
            <Slider
              label="Animation speed"
              min={0.5}
              max={2}
              step={0.05}
              value={s.animationSpeed}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(animationSpeed) => saveDebounced({ animationSpeed })}
            />
          </Row>
          <Row
            q={q}
            label="Activity level"
            hay="behavior frequency naps lazy busy"
            hint="Low = long naps and lazy strolls. High = constant mischief."
          >
            <Slider
              label="Activity level"
              min={0}
              max={100}
              value={s.activityLevel}
              onChange={(activityLevel) => saveDebounced({ activityLevel })}
            />
          </Row>
        </SectionCard>
      )}

      {/* ------------------------------- Behaviors ------------------------------ */}
      {vis(HAY.behaviors) && (
        <SectionCard
          title="Behaviors"
          description="What pets are allowed to do around your desktop."
          icon={icon('<path d="M12 3l2.1 5.1L19 9.2l-4 3.4 1.3 5.4L12 15.2 7.7 18l1.3-5.4-4-3.4 4.9-1.1Z"/>')}
        >
          <Row
            q={q}
            label="Window walking"
            hay="climb stroll app windows"
            hint="Pets climb onto and stroll along your app windows."
          >
            <Toggle
              checked={s.windowWalking}
              onChange={(windowWalking) => void saveSettings({ windowWalking })}
              label="Window walking"
            />
          </Row>
          <Row
            q={q}
            label="Cursor interactions"
            hay="mouse chase watch inspect"
            hint="Chasing, watching and inspecting your mouse cursor."
          >
            <Toggle
              checked={s.cursorInteractions}
              onChange={(cursorInteractions) => void saveSettings({ cursorInteractions })}
              label="Cursor interactions"
            />
          </Row>
          <Row
            q={q}
            label="Character interactions"
            hay="joint strolls greet dance crosstalk together"
            hint="Strolls together, meet-and-greets, dance parties, crosstalk."
          >
            <Toggle
              checked={s.characterInteractions}
              onChange={(characterInteractions) =>
                void saveSettings({ characterInteractions })
              }
              label="Character interactions"
            />
          </Row>
          <Row
            q={q}
            label="Chatter frequency"
            hay="conversations crosstalk talk often"
            hint="How often nearby characters strike up conversations on their own. Off by default — raise it to allow unprompted character-to-character talk."
          >
            <Slider
              label="Chatter frequency"
              min={0}
              max={100}
              value={s.chatterFrequency}
              format={(v) => (v === 0 ? 'Off' : `${v}`)}
              onChange={(chatterFrequency) => saveDebounced({ chatterFrequency })}
            />
          </Row>
        </SectionCard>
      )}

      {/* ------------------------------ Interaction ----------------------------- */}
      {vis(HAY.interaction) && (
        <SectionCard
          title="Interaction"
          description="How the overlay UI behaves while you talk to your pets."
          icon={icon('<path d="M4 4l7.5 16 2-6.5L20 11.5Z"/><path d="M13.5 13.5L19 19"/>')}
        >
          <Row
            q={q}
            label="Close chat after sending"
            hay="chat panel enter send autoclose"
            hint="The chat panel slips away right after you send a message."
          >
            <Toggle
              checked={s.autoCloseChatOnSend}
              onChange={(autoCloseChatOnSend) =>
                void saveSettings({ autoCloseChatOnSend })
              }
              label="Close chat after sending"
            />
          </Row>
          <Row
            q={q}
            label="Close wheel after choosing"
            hay="skill wheel pick select autoclose"
            hint="The skill wheel closes as soon as you pick any skill."
          >
            <Toggle
              checked={s.autoCloseWheelOnSelect}
              onChange={(autoCloseWheelOnSelect) =>
                void saveSettings({ autoCloseWheelOnSelect })
              }
              label="Close wheel after choosing"
            />
          </Row>
        </SectionCard>
      )}

      {/* -------------------------------- Speech -------------------------------- */}
      {vis(HAY.speech) && (
        <SectionCard
          title="Speech bubbles"
          description="How your pets’ words appear on screen."
          icon={icon('<path d="M21 11.5a8.38 8.38 0 0 1-9 8.36 8.5 8.5 0 0 1-3.4-.7L3 21l1.84-4.6A8.38 8.38 0 0 1 3.5 11.5a8.5 8.5 0 1 1 17.5 0Z"/>')}
        >
          <Row q={q} label="Style" hay="glass solid retro bubble">
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
          </Row>
          <Row q={q} label="Font size" hay="text bubble px">
            <Slider
              label="Speech bubble font size"
              min={12}
              max={20}
              value={s.speechBubbleFontSize}
              format={(v) => `${v}px`}
              onChange={(speechBubbleFontSize) => saveDebounced({ speechBubbleFontSize })}
            />
          </Row>
          <Row
            q={q}
            label="Linger"
            hay="stay duration seconds bubble"
            hint="How long a bubble stays after the voice finishes."
          >
            <Slider
              label="Speech bubble linger seconds"
              min={2}
              max={15}
              value={s.speechBubbleSeconds}
              format={(v) => `${v}s`}
              onChange={(speechBubbleSeconds) => saveDebounced({ speechBubbleSeconds })}
            />
          </Row>
        </SectionCard>
      )}

      {/* ----------------------------- Voice & sound ---------------------------- */}
      {vis(HAY.sound) && (
        <SectionCard
          title="Voice & sound"
          description="Character voices and the app’s own sound effects."
          icon={icon('<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>')}
        >
          <Row q={q} label="Voice volume" hay="speech loud tts" hint="Loudness of character speech.">
            <Slider
              label="Voice volume"
              min={0}
              max={100}
              value={s.voiceVolume}
              format={(v) => (v === 0 ? 'Muted' : `${v}%`)}
              onChange={(voiceVolume) => saveDebounced({ voiceVolume })}
            />
          </Row>
          <Row
            q={q}
            label="Effects volume"
            hay="sfx ui ticks chimes"
            hint="Wheel ticks, chimes, spawn pops."
          >
            <Slider
              label="Sound effects volume"
              min={0}
              max={100}
              value={s.sfxVolume}
              format={(v) => (v === 0 ? 'Muted' : `${v}%`)}
              onChange={(sfxVolume) => saveDebounced({ sfxVolume })}
            />
          </Row>
          <Row q={q} label="Sound pack" hay="soft glass retro timbre" hint="Each pack reshapes every cue.">
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
          </Row>
        </SectionCard>
      )}

      {/* -------------------------------- Free will ----------------------------- */}
      {vis(HAY.freewill) && (
        <SectionCard
          title="Free will"
          description="Unprompted comments from characters that have free will enabled."
          icon={icon('<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>')}
        >
          <Row
            q={q}
            label="Frequency"
            hay="cadence unprompted chatter"
            hint="0 turns free-will chatter off globally."
          >
            <Slider
              label="Free will frequency"
              min={0}
              max={100}
              value={s.freeWillFrequency}
              format={(v) => (v === 0 ? 'Off' : `${v}`)}
              onChange={(freeWillFrequency) => saveDebounced({ freeWillFrequency })}
            />
          </Row>
          <Row
            q={q}
            label="Quiet hours"
            hay="night do not disturb silence times"
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
          </Row>
        </SectionCard>
      )}

      {/* --------------------------------- Vision ------------------------------- */}
      {vis(HAY.vision) && (
        <SectionCard
          title="Vision"
          description="Screen-sharing sessions started with the “Show screen” skill."
          icon={icon('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/>')}
        >
          <Row
            q={q}
            label="Capture rate"
            hay="fps frames screen"
            hint="Frames per second sent while a grant is active."
          >
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
          </Row>
          <Row
            q={q}
            label="Session length"
            hay="minutes auto revoke expiry"
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
          </Row>
        </SectionCard>
      )}

      {/* -------------------------------- Hotkeys ------------------------------- */}
      {vis(HAY.hotkeys) && (
        <SectionCard
          title="Hotkeys"
          description="Global shortcuts that work from any app. Click a field, press your combo."
          icon={icon('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01"/><path d="M9 14h6"/>')}
        >
          {HOTKEY_ACTIONS.map((action) => (
            <Row
              q={q}
              key={action}
              label={HOTKEY_META[action].label}
              hay="hotkey shortcut keyboard"
              hint={HOTKEY_META[action].hint}
            >
              <HotkeyRecorder
                value={s.hotkeys[action] ?? ''}
                actionLabel={HOTKEY_META[action].label}
                conflict={conflictFor(action)}
                onCommit={(acc) => setHotkey(action, acc)}
                onClear={() => setHotkey(action, '')}
              />
            </Row>
          ))}
          <p className="cdp-input-note" style={{ marginTop: 10 }}>
            Hotkeys act on the character you interacted with last.
          </p>
        </SectionCard>
      )}

      {/* --------------------------------- System ------------------------------- */}
      {vis(HAY.system) && (
        <SectionCard
          title="System"
          description="How the app behaves on your machine."
          icon={icon('<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 18v3"/>')}
        >
          <Row
            q={q}
            label="Start with Windows"
            hay="autostart login boot launch"
            hint="Launch pets automatically at login."
          >
            <Toggle
              checked={s.autostart}
              disabled={autostartBusy}
              onChange={(next) => void toggleAutostart(next)}
              label="Start with Windows"
            />
          </Row>
          <Row
            q={q}
            label="GPU"
            hay="graphics card integrated dedicated discrete power performance renderer"
            hint={
              <>
                Which GPU draws the pets (Windows). Applied via Windows graphics
                settings for the app <em>and</em> its WebView2 runtime — the
                runtime entry is shared with other WebView2 apps. Restart the
                app to apply.
              </>
            }
          >
            <Segmented<GpuPreference>
              ariaLabel="GPU preference"
              value={s.gpuPreference}
              options={[
                { value: 'default', label: 'Windows default' },
                { value: 'power-saving', label: 'Power saving', title: 'Integrated GPU' },
                { value: 'high-performance', label: 'High performance', title: 'Dedicated GPU' },
              ]}
              onChange={(pref) => void applyGpuPreference(pref)}
            />
          </Row>
          <Row
            q={q}
            label="Idle sleep"
            hay="nap away afk minutes"
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
          </Row>
          <Row q={q} label="Onboarding" hay="tour first run replay welcome" hint="Replay the first-run tour.">
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
          </Row>
          <Row
            q={q}
            label="Reset all settings"
            hay="defaults restore factory wipe"
            hint="Every option above returns to its default. Characters, reminders and notes stay."
          >
            <button
              type="button"
              className="cdp-btn cdp-btn-danger-outline cdp-btn-sm"
              onClick={() => setConfirmReset(true)}
            >
              Reset…
            </button>
          </Row>
        </SectionCard>
      )}

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

      <ConfirmDialog
        open={confirmReset}
        title="Reset all settings?"
        body={
          <p>
            Every setting returns to its default value. Your <strong>API key and
            end-user id are kept</strong>, and your characters, reminders and notes
            are untouched.
          </p>
        }
        confirmLabel="Reset settings"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          void resetSettings().then(() => {
            toast('Settings are back to their defaults.', 'success');
          });
        }}
      />
    </div>
  );
}
