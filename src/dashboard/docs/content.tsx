/**
 * In-app documentation content as JSX data. DocsPage renders DOC_SECTIONS;
 * everything here is static and self-contained (no fetches). The skill and
 * settings tables render from the live registries so they can never drift
 * from the real app.
 */
import type { ReactNode } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  CONVAI_DASHBOARD_URL,
  CONVAI_DOCS_URL,
  CONVAI_PRICING_URL,
  CONVAI_SDK_URL,
  DEFAULT_SETTINGS,
  LATEST_RELEASE_URL,
  REPO_URL,
} from '../../shared/constants';
import type { SkillDef } from '../../shared/types';
import { ALL_SKILL_IDS, SKILLS } from '../../skills/registry';

export interface DocSection {
  id: string;
  /** Full heading shown in the content pane. */
  title: string;
  /** Short label for the side nav. */
  navTitle: string;
  body: ReactNode;
}

/* ------------------------------ building blocks ------------------------------ */

export function LinkOut({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="docs-link"
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void openUrl(href);
      }}
    >
      {children}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="docs-kbd">{children}</kbd>;
}

function Callout({
  kind,
  title,
  children,
}: {
  kind: 'info' | 'warning' | 'tip';
  title: string;
  children: ReactNode;
}) {
  const icons: Record<typeof kind, ReactNode> = {
    info: <path d="M12 8h.01M11 12h1v4h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />,
    warning: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
    tip: <path d="M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.5 10.9c.7.6 1.2 1.3 1.4 2.1h4.2c.2-.8.7-1.5 1.4-2.1A6 6 0 0 0 12 3Z" />,
  };
  return (
    <div className={`docs-callout docs-callout-${kind}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {icons[kind]}
      </svg>
      <div>
        <div className="docs-callout-title">{title}</div>
        <div className="docs-callout-body">{children}</div>
      </div>
    </div>
  );
}

function SkillIcon({ def }: { def: SkillDef }) {
  return (
    <span className="docs-skill-icon">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        // Icon paths come from our own typed registry, not user input.
        dangerouslySetInnerHTML={{ __html: def.icon }}
      />
    </span>
  );
}

const GATE_LABELS: Record<NonNullable<SkillDef['gatedBy']>, string> = {
  windowWalking: 'Window walking',
  cursorInteractions: 'Cursor interactions',
  characterInteractions: 'Character interactions',
};

/** Rendered from the live registry — always shows all 22 skills, never drifts. */
function SkillTable() {
  return (
    <div className="docs-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Skill</th>
            <th>What it does</th>
            <th>Type</th>
            <th>Needs</th>
          </tr>
        </thead>
        <tbody>
          {ALL_SKILL_IDS.map((id) => {
            const def = SKILLS[id];
            return (
              <tr key={id}>
                <td>
                  <span className="docs-skill-cell">
                    <SkillIcon def={def} />
                    <strong>{def.label}</strong>
                  </span>
                </td>
                <td>{def.description}</td>
                <td>
                  <span className={`docs-badge docs-badge-${def.kind}`}>
                    {def.kind === 'toggle' ? 'Toggle' : 'Action'}
                  </span>
                </td>
                <td className="docs-dim">
                  {[
                    def.needsConvai ? 'Convai connection' : null,
                    def.gatedBy ? `${GATE_LABELS[def.gatedBy]} setting` : null,
                  ]
                    .filter(Boolean)
                    .join(' + ') || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ behavior catalog ------------------------------ */

type BehaviorGate = '' | 'Window walking' | 'Cursor interactions' | 'Character interactions';

const BEHAVIORS: Array<{ name: string; blurb: string; gate: BehaviorGate }> = [
  { name: 'Wander walk', blurb: 'The classic shimeji stroll along the bottom of your screen.', gate: '' },
  { name: 'Edge climb', blurb: 'Scales the left, right, or top edge of the screen and hangs out.', gate: '' },
  { name: 'Idle action', blurb: 'Character-specific idle poses — sitting, fidgeting, daydreaming.', gate: '' },
  { name: 'Special action', blurb: 'Plays one of the character’s signature special animations.', gate: '' },
  { name: 'Window-top walk', blurb: 'Walks to the side of one of your app windows, calmly climbs its edge, and strolls across the top.', gate: 'Window walking' },
  { name: 'Window-sill sit', blurb: 'Perches on a window corner and watches the world go by.', gate: 'Window walking' },
  { name: 'Window peek', blurb: 'Peeks out from behind the edge of a window, then ducks away.', gate: 'Window walking' },
  { name: 'Cursor chase', blurb: 'Trots after your mouse cursor while it’s far away — and gives up politely.', gate: 'Cursor interactions' },
  { name: 'Cursor watch', blurb: 'Turns to face your cursor and tracks it from a distance.', gate: 'Cursor interactions' },
  { name: 'Inspect cursor', blurb: 'Walks over to an idle cursor and puzzles over it.', gate: 'Cursor interactions' },
  { name: 'Side-by-side stroll', blurb: 'Two pets fall into step and take a walk together.', gate: 'Character interactions' },
  { name: 'Meet and greet', blurb: 'Two pets walk up to each other, face off, and trade a few words.', gate: 'Character interactions' },
  { name: 'Follow the leader', blurb: 'One pet leads, the others trail behind in a line.', gate: 'Character interactions' },
  { name: 'Mirror dance', blurb: 'Two pets perform synchronized special moves.', gate: 'Character interactions' },
  { name: 'Taskbar parade', blurb: 'A rare all-pets march in single file across the bottom of the screen.', gate: 'Character interactions' },
  { name: 'Screen-edge patrol', blurb: 'Patrols along the border of the screen like a tiny guard.', gate: '' },
  { name: 'New-window curiosity', blurb: 'A window just opened? Someone has to go investigate.', gate: 'Window walking' },
  { name: 'Time of day', blurb: 'Morning stretches and midnight yawns, matched to your clock.', gate: '' },
  { name: 'Idle nap', blurb: 'When you step away, pets doze off — and greet you when you’re back.', gate: '' },
  { name: 'Dizzy tumble', blurb: 'Throw a pet too hard and it lands in a dizzy spin.', gate: '' },
];

function BehaviorTable() {
  return (
    <div className="docs-table-wrap">
      <table>
        <thead>
          <tr>
            <th className="docs-col-num">#</th>
            <th>Behavior</th>
            <th>What you’ll see</th>
            <th>Requires</th>
          </tr>
        </thead>
        <tbody>
          {BEHAVIORS.map((b, i) => (
            <tr key={b.name}>
              <td className="docs-dim docs-col-num">{i + 1}</td>
              <td><strong>{b.name}</strong></td>
              <td>{b.blurb}</td>
              <td className="docs-dim">{b.gate || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ settings tour ------------------------------ */

const D = DEFAULT_SETTINGS;

const SETTING_ROWS: Array<{ name: string; range: string; def: string; what: string }> = [
  { name: 'Theme', range: 'system · light · dark', def: D.theme, what: 'Dashboard and overlay UI palette. “System” follows your OS theme.' },
  { name: 'Accent color', range: '8 presets or any hex', def: D.accentColor, what: 'Tints buttons, the skill wheel, highlights and focus rings everywhere.' },
  { name: 'Pet size', range: '50–200%', def: `${D.petSize}%`, what: 'Scales every sprite up or down.' },
  { name: 'Pet opacity', range: '30–100%', def: `${D.petOpacity}%`, what: 'Ghost mode — handy while streaming or screenshotting.' },
  { name: 'Animation speed', range: '0.5–2×', def: `${D.animationSpeed}×`, what: 'Multiplier on both sprite frame rate and movement speed.' },
  { name: 'Activity level', range: '0–100', def: `${D.activityLevel}`, what: 'How often pets pick a new behavior versus resting. Low = calm desk companions.' },
  { name: 'Window walking', range: 'on / off', def: D.windowWalking ? 'on' : 'off', what: 'Lets pets treat your app windows as terrain: top-edge walks, sill sits, peeks, new-window curiosity, and the “Climb my window” skill.' },
  { name: 'Cursor interactions', range: 'on / off', def: D.cursorInteractions ? 'on' : 'off', what: 'Cursor chasing, watching and inspecting, plus the “Follow cursor” skill.' },
  { name: 'Character interactions', range: 'on / off', def: D.characterInteractions ? 'on' : 'off', what: 'All multi-pet behaviors — strolls, greetings, parades — plus “Summon friends” and “Friend chat”.' },
  { name: 'Chatter frequency', range: '0–100', def: `${D.chatterFrequency}`, what: 'How often spawned characters strike up conversations with each other on their own.' },
  { name: 'Speech bubbles', range: 'glass · solid · retro / 12–20 px / 2–15 s', def: `${D.speechBubbleStyle}, ${D.speechBubbleFontSize} px, ${D.speechBubbleSeconds} s`, what: 'Bubble style, text size, and how long a bubble lingers after the voice finishes.' },
  { name: 'Voice volume', range: '0–100', def: `${D.voiceVolume}`, what: 'Loudness of character voices. Each character also has its own voice on/off toggle.' },
  { name: 'Sound effects', range: 'soft · glass · retro · off / 0–100', def: `${D.soundPack}, ${D.sfxVolume}`, what: 'UI cue pack (wheel, messages, chimes, landings) and its volume. All synthesized — the app ships zero audio files.' },
  { name: 'Free-will frequency', range: '0–100', def: `${D.freeWillFrequency}`, what: 'How chatty characters with Free will enabled are when commenting unprompted.' },
  { name: 'Quiet hours', range: 'HH:MM–HH:MM or off', def: D.quietHoursStart ? `${D.quietHoursStart}–${D.quietHoursEnd}` : 'off', what: 'Silences unprompted comments and crosstalk during the window. Direct chats still work.' },
  { name: 'Screen vision', range: '0.25–2 fps / 1–30 min', def: `${D.visionFps} fps, ${D.visionSessionMinutes} min`, what: 'Capture rate while a vision grant is active, and how long a grant lasts before auto-revoking.' },
  { name: 'Idle sleep', range: '0–60 min (0 = never)', def: `${D.idleSleepMinutes} min`, what: 'Pets nap after this many minutes without cursor movement, and wake to greet you.' },
  { name: 'Autostart & reduce motion', range: 'on / off each', def: `${D.autostart ? 'on' : 'off'}, ${D.reduceMotion ? 'on' : 'off'}`, what: 'Launch with your computer; tone down UI animation across both windows (pets still animate).' },
];

function SettingsTable() {
  return (
    <div className="docs-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Setting</th>
            <th>Range</th>
            <th>Default</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {SETTING_ROWS.map((r) => (
            <tr key={r.name}>
              <td><strong>{r.name}</strong></td>
              <td className="docs-dim docs-nowrap-sm">{r.range}</td>
              <td className="docs-dim">{r.def}</td>
              <td>{r.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------- sections --------------------------------- */

export const DOC_SECTIONS: DocSection[] = [
  {
    id: 'welcome',
    title: 'Welcome & quick start',
    navTitle: 'Welcome',
    body: (
      <>
        <p>
          Convai Desktop Pets fills your screen with tiny animated companions that walk your
          taskbar, climb your windows, nap when you step away — and hold real conversations,
          out loud, powered by <LinkOut href="https://convai.com">Convai</LinkOut>. Five steps
          to a living desktop:
        </p>
        <ol className="docs-steps">
          <li>
            <strong>Launch the app.</strong> The dashboard opens and a transparent overlay
            quietly covers your desktop. Closing the dashboard just hides it to the tray —
            your pets stay.
          </li>
          <li>
            <strong>Connect Convai.</strong> Grab your API key (next section) and paste it in{' '}
            <strong>Settings → Connection</strong>. Without a key, pets still roam and play —
            they just can&rsquo;t talk.
          </li>
          <li>
            <strong>Spawn a character.</strong> On the <strong>Characters</strong> page, flip
            the <strong>Active</strong> toggle on anyone you like. They drop onto your desktop
            and start exploring.
          </li>
          <li>
            <strong>Say hello.</strong> Click a pet for its skill wheel, or{' '}
            <Kbd>Alt</Kbd>&thinsp;+&thinsp;click to jump straight into chat.
          </li>
          <li>
            <strong>Make it yours.</strong> Per character: rename it, pick its 8 wheel skills,
            toggle voice, free will, and (optionally) long-term memory. Globally: 18 settings
            from accent color to quiet hours.
          </li>
        </ol>
        <Callout kind="tip" title="They are pets, not widgets">
          Drag them around. Throw them. Stack them on a window. They react — that&rsquo;s the
          whole point.
        </Callout>
      </>
    ),
  },
  {
    id: 'api-key',
    title: 'Getting your Convai API key',
    navTitle: 'API key & characters',
    body: (
      <>
        <h3>Your API key</h3>
        <ol className="docs-steps">
          <li>
            Go to <LinkOut href="https://convai.com">convai.com</LinkOut> and sign in (accounts
            are free to create).
          </li>
          <li>
            In the Convai dashboard, click the <strong>shield icon</strong> in the top-right
            corner (just left of your profile avatar). An API Key panel opens.
          </li>
          <li>Reveal the key with the eye icon and copy it.</li>
          <li>
            In this app, open <strong>Settings → Connection</strong> and paste it into the API
            key field.
          </li>
        </ol>
        <Callout kind="warning" title="Keep your key private">
          Your API key grants full access to your Convai account. It is stored only on this
          machine, in the app&rsquo;s local data file — never share it or commit it anywhere
          public.
        </Callout>
        <h3>Character IDs</h3>
        <p>
          Every Convai character has a <strong>Character ID</strong> — a UUID-style string like{' '}
          <code>a1b2c3d4-e5f6-7890-abcd-ef1234567890</code>. To find one, open{' '}
          <LinkOut href={CONVAI_DASHBOARD_URL}>your Convai dashboard</LinkOut>, go to{' '}
          <strong>My Characters</strong>, open a character, and copy its ID. You can also create
          brand-new characters there with custom personalities, backstories and voices.
        </p>
        <p>
          The bundled pets ship with default character IDs, and every one of them is editable:
          open <strong>Characters</strong>, pick a pet, and paste a new Convai ID to give that
          sprite any personality you&rsquo;ve built. One Convai character can drive several
          pets, or every pet can be someone different.
        </p>
      </>
    ),
  },
  {
    id: 'interacting',
    title: 'Interacting with your pets',
    navTitle: 'Interacting',
    body: (
      <>
        <ul className="docs-list">
          <li>
            <strong>Click a pet</strong> — opens its radial <strong>skill wheel</strong>, even
            mid-walk. Eight skills, one click each. <Kbd>Esc</Kbd> or clicking anywhere else
            closes it.
          </li>
          <li>
            <strong><Kbd>Alt</Kbd>&thinsp;+&thinsp;click a pet</strong> — opens the chat panel
            directly, same shortcut as v1. Type, or toggle the mic for live voice.
          </li>
          <li>
            <strong>Drag &amp; throw</strong> — grab a pet and move it anywhere. Release while
            moving and it flies with real momentum, tumbles, bounces, and picks itself up.
            Throw too hard and it gets dizzy.
          </li>
          <li>
            <strong>Tray icon</strong> — the app lives in your system tray. Use it to reopen the
            dashboard or quit entirely; closing the dashboard window never kills your pets.
          </li>
          <li>
            <strong>Dashboard</strong> — spawn and customize characters, edit skill loadouts,
            tune settings, and read these docs.
          </li>
        </ul>
        <Callout kind="info" title="Click-through by design">
          The overlay only intercepts your mouse directly over a pet or an open pet UI.
          Everywhere else your clicks pass straight through to your apps — pets never get in
          the way of work.
        </Callout>
      </>
    ),
  },
  {
    id: 'skill-wheel',
    title: 'The skill wheel',
    navTitle: 'Skill wheel',
    body: (
      <>
        <p>
          The wheel is your pet&rsquo;s command center: 8 wedges spring open around the pet
          when you click it. <strong>Actions</strong> run once; <strong>toggles</strong> stay
          lit until you switch them off. All 22 skills:
        </p>
        <SkillTable />
        <h3>Customizing the 8 slots</h3>
        <p>
          Each character carries its own loadout of exactly 8 skills. In{' '}
          <strong>Characters</strong>, open a character&rsquo;s editor and swap any of the 22
          skills into any slot — a focus-timer buddy, a memory keeper, a chaos gremlin with
          dance-party on speed dial. Skills whose parent setting is off (for example
          &ldquo;Follow cursor&rdquo; with Cursor interactions disabled) hide from the wheel
          until you re-enable it.
        </p>
      </>
    ),
  },
  {
    id: 'vision',
    title: 'Screen vision & privacy',
    navTitle: 'Screen vision',
    body: (
      <>
        <p>
          Characters can <em>see your screen</em> — but only when you say so, and only for as
          long as you say so.
        </p>
        <ul className="docs-list">
          <li>
            <strong>Timed grants.</strong> The &ldquo;Show screen&rdquo; skill starts a vision
            session that auto-revokes after your configured session length (
            {DEFAULT_SETTINGS.visionSessionMinutes} minutes by default, 1–30 in Settings).
          </li>
          <li>
            <strong>Countdown badge.</strong> While a grant is active, a badge above the pet
            shows exactly how long the character can still see. No badge, no vision.
          </li>
          <li>
            <strong>One-shot looks.</strong> &ldquo;Take a look&rdquo; captures a single frame,
            gets one comment, and grants nothing ongoing.
          </li>
          <li>
            <strong>Low and light.</strong> Frames are captured natively at a gentle rate
            ({DEFAULT_SETTINGS.visionFps} fps by default, at most 2), downscaled, and streamed
            to Convai for the character&rsquo;s reply.
          </li>
          <li>
            <strong>Never stored locally.</strong> Captured frames are never written to disk —
            they exist only in memory on their way to the live session.
          </li>
          <li>
            <strong>Revoke anytime.</strong> Toggle &ldquo;Show screen&rdquo; off and capture
            stops immediately; otherwise it stops itself when the timer runs out.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'memory',
    title: 'Long-term memory',
    navTitle: 'Long-term memory',
    body: (
      <>
        <p>
          With long-term memory (LTM), a character remembers you <em>across sessions</em>: at
          the end of a conversation Convai distills it into small facts (&ldquo;the user is
          learning Spanish&rdquo;), and quietly recalls them the next time you talk. It&rsquo;s
          the difference between a chatbot and a companion.
        </p>
        <Callout kind="info" title="Off by default">
          LTM is <strong>disabled by default</strong> for every character in this app. Turn it
          on per character in the dashboard&rsquo;s character editor — after the two
          prerequisites below are in place.
        </Callout>
        <h3>The two prerequisites</h3>
        <ol className="docs-steps">
          <li>
            <strong>Enable it on the Convai side.</strong> In the{' '}
            <LinkOut href={CONVAI_DASHBOARD_URL}>Convai dashboard</LinkOut>, open your
            character → <strong>Memory tab → Memory Settings</strong> → enable{' '}
            <strong>Long Term Memory</strong>. This is per character and takes a moment to
            apply.
          </li>
          <li>
            <strong>Have a plan that allows it.</strong> Memory capacity is a paid-plan
            feature with real limits — see below.
          </li>
        </ol>
        <h3>Plan limits worth knowing</h3>
        <ul className="docs-list">
          <li>
            The number of distinct remembered users (&ldquo;speaker IDs&rdquo;) per API key is
            tier-dependent — historically <strong>1</strong> on the Personal tier,{' '}
            <strong>5</strong> on Gamer/Indie/Professional tiers, and{' '}
            <strong>100+ (customizable)</strong> on Partner/Enterprise. A single-user desktop
            pet fits comfortably in even the smallest allowance.
          </li>
          <li>
            LTM context comes in <strong>2k / 4k / 8k token</strong> sizes; bigger memory
            windows consume more credits per interaction.
          </li>
          <li>
            Interaction quotas apply too — e.g. the Indie Dev plan includes{' '}
            <strong>3,000 interactions/month</strong>, and the Scale plan caps at{' '}
            <strong>200 monthly active end users</strong>. Quotas reset each billing cycle and
            don&rsquo;t roll over.
          </li>
        </ul>
        <Callout kind="warning" title="Numbers change">
          Convai revises plans and limits regularly — treat the figures above as orientation
          and check <LinkOut href={CONVAI_PRICING_URL}>convai.com/pricing</LinkOut> for what
          your plan includes today.
        </Callout>
        <h3>Your end-user ID</h3>
        <p>
          Memories are keyed to the pair of <em>your end-user ID + the character ID</em>. This
          app generates a stable, anonymous UUID on first run and sends it only for characters
          with LTM enabled. You can view or regenerate it in Settings — but{' '}
          <strong>regenerating orphans every existing memory</strong>: Convai treats the new ID
          as a brand-new person, and nothing carries over.
        </p>
        <h3>The memory journal</h3>
        <p>
          Add the <strong>{SKILLS['memory-journal'].label}</strong> skill to a wheel to browse
          everything a character remembers about you — and delete any memory (or all of them)
          whenever you like.
        </p>
      </>
    ),
  },
  {
    id: 'reminders',
    title: 'Reminders & notes',
    navTitle: 'Reminders & notes',
    body: (
      <>
        <h3>Reminders</h3>
        <p>
          Pick the <strong>Reminder</strong> skill and a small composer opens next to the pet:
          write what to remember, pick a date and time, done. Pending reminders show as chips
          you can review or cancel. The character acknowledges the reminder when you create it
          — and when it comes due, it walks up, announces it out loud in a speech bubble, plays
          a chime, and fires a native Windows notification in case you&rsquo;re in another app.
        </p>
        <Callout kind="info" title="Windows notification permissions">
          If you don&rsquo;t see toast notifications, check{' '}
          <strong>Windows Settings → System → Notifications</strong> and make sure they&rsquo;re
          enabled for Convai Desktop Pets — and that Do&nbsp;Not&nbsp;Disturb isn&rsquo;t
          swallowing them.
        </Callout>
        <h3>Notes</h3>
        <p>
          The <strong>Notes</strong> skill opens a sticky-note board that lives on your
          desktop: quick colored notes, no AI involved, no due dates. Jot and close.
        </p>
      </>
    ),
  },
  {
    id: 'together',
    title: 'Characters together',
    navTitle: 'Characters together',
    body: (
      <>
        <p>Spawn two or more characters and the desktop becomes a little society:</p>
        <ul className="docs-list">
          <li>
            <strong>Crosstalk.</strong> Characters hold short spoken conversations with each
            other — each one is told what the other said and answers in its own personality,
            bubbles alternating, one voice at a time. Start one deliberately with the{' '}
            <strong>Friend chat</strong> skill.
          </li>
          <li>
            <strong>Meet &amp; greet.</strong> Left alone, pets wander over to each other, face
            off, and exchange a few words on their own.
          </li>
          <li>
            <strong>Chatter frequency.</strong> The Settings slider decides how often
            spontaneous conversations spark — from library-silent to sitcom.
          </li>
          <li>
            <strong>Quiet hours.</strong> During your configured window, all unprompted talk
            and crosstalk pauses. Direct chats always work.
          </li>
        </ul>
        <Callout kind="tip" title="Shared memories">
          If both characters have long-term memory enabled, they each remember these
          conversations — ask one later what the other told it.
        </Callout>
      </>
    ),
  },
  {
    id: 'behaviors',
    title: 'Ambient behaviors',
    navTitle: 'Ambient behaviors',
    body: (
      <>
        <p>
          Left to their own devices, pets pick from a catalog of 20 ambient behaviors —
          weighted, cooldown-managed, and coordinated so no two pets fight over the same
          window or your cursor. The <strong>Activity level</strong> setting scales how busy
          they are overall.
        </p>
        <BehaviorTable />
        <p className="docs-dim">
          Falling and being dragged are reactive states on top of these — physics happens to
          everyone.
        </p>
      </>
    ),
  },
  {
    id: 'customization',
    title: 'Customization tour',
    navTitle: 'Customization',
    body: (
      <>
        <p>
          Everything below lives in <strong>Settings</strong> and applies instantly — no
          restarts. Per-character options (rename, Convai ID, voice, free will, long-term
          memory, skill loadout, home spot) live in each character&rsquo;s editor on the
          Characters page.
        </p>
        <SettingsTable />
      </>
    ),
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    navTitle: 'Troubleshooting',
    body: (
      <>
        <dl className="docs-faq">
          <dt>The microphone doesn&rsquo;t work in voice mode</dt>
          <dd>
            Open <strong>Windows Settings → Privacy &amp; security → Microphone</strong> and
            make sure microphone access is on, including the &ldquo;Let desktop apps access
            your microphone&rdquo; toggle at the bottom. Then toggle the Voice skill off and on
            again.
          </dd>
          <dt>My character never replies</dt>
          <dd>
            Three usual suspects: the <strong>API key</strong> in Settings → Connection is
            missing or mistyped; the character&rsquo;s <strong>Convai ID</strong> isn&rsquo;t a
            valid UUID-style ID from your dashboard; or your Convai plan&rsquo;s{' '}
            <strong>monthly interaction quota</strong> is exhausted — check your usage on{' '}
            <LinkOut href={CONVAI_DASHBOARD_URL}>convai.com</LinkOut>.
          </dd>
          <dt>My pets are invisible</dt>
          <dd>
            Check the <strong>Active</strong> toggle on the Characters page, and confirm the
            app is actually running via the <strong>tray icon</strong>. Pets live on the
            primary monitor — if you unplugged a display, they may need a respawn (toggle
            Active off and on).
          </dd>
          <dt>Voices are too quiet</dt>
          <dd>
            Raise <strong>Voice volume</strong> in Settings, and check the per-character voice
            toggle in its editor. Windows&rsquo; per-app volume mixer can also be dialing the
            app down.
          </dd>
          <dt>Vision says it has no frames</dt>
          <dd>
            The first frames can take a moment to buffer after a grant starts. Revoke the
            grant (toggle &ldquo;Show screen&rdquo; off) and grant it again; for a quick test,
            use &ldquo;Take a look&rdquo; instead.
          </dd>
          <dt>Start over from scratch</dt>
          <dd>
            Quit the app from the tray, then delete <code>app-data.json</code> from the
            app-data folder — on Windows that&rsquo;s{' '}
            <code>%APPDATA%\com.akshitireddy.convai-desktop-pet</code>. Next launch recreates
            defaults (your Convai account and characters are untouched — that all lives
            server-side).
          </dd>
        </dl>
      </>
    ),
  },
  {
    id: 'links',
    title: 'Links',
    navTitle: 'Links',
    body: (
      <>
        <ul className="docs-list docs-links-list">
          <li>
            <LinkOut href={CONVAI_DOCS_URL}>Convai API documentation</LinkOut> — everything
            about characters, memory, and the platform.
          </li>
          <li>
            <LinkOut href={CONVAI_SDK_URL}>@convai/web-sdk on npm</LinkOut> — the SDK this app
            is built on.
          </li>
          <li>
            <LinkOut href={REPO_URL}>GitHub repository</LinkOut> — source code, issues, and
            contributions welcome.
          </li>
          <li>
            <LinkOut href={LATEST_RELEASE_URL}>Latest release</LinkOut> — downloads for
            Windows, macOS, and Linux.
          </li>
        </ul>
      </>
    ),
  },
];
