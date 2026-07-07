/**
 * The full skill collection. Each character exposes 8 of these in its radial
 * wheel (character.skillLoadout, editable in the dashboard).
 *
 * `icon` is inner SVG markup for a 24×24 viewBox, stroke-based (stroke:
 * currentColor, stroke-width 2, no fill unless stated).
 */
import type { SkillDef, SkillId } from '../shared/types';

export { DEFAULT_SKILL_LOADOUT } from '../shared/constants';

const defs: SkillDef[] = [
  {
    id: 'chat',
    label: 'Chat',
    icon: '<path d="M21 11.5a8.38 8.38 0 0 1-9 8.36 8.5 8.5 0 0 1-3.4-.7L3 21l1.84-4.6A8.38 8.38 0 0 1 3.5 11.5a8.5 8.5 0 1 1 17.5 0Z"/>',
    description: 'Open a chat panel and talk by text. Replies stream in with voice if enabled.',
    kind: 'action',
    needsConvai: true,
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/>',
    description: 'Live voice conversation — your microphone stays open until you toggle it off.',
    kind: 'toggle',
    needsConvai: true,
  },
  {
    id: 'show-screen',
    label: 'Show screen',
    icon: '<rect x="2" y="4" width="20" height="14" rx="2"/><circle cx="12" cy="11" r="3"/><path d="M8 21h8"/>',
    description: 'Let this character see your screen for a limited time. A countdown badge shows while active.',
    kind: 'toggle',
    needsConvai: true,
    params: [
      { key: 'minutes', label: 'Session length', min: 1, max: 60, step: 1, default: 10, unit: 'min' },
      { key: 'chattiness', label: 'Comment cadence', min: 0, max: 100, step: 5, default: 70, unit: '%' },
    ],
  },
  {
    id: 'free-will',
    label: 'Free will',
    icon: '<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>',
    description: 'Allow the character to comment on its own whenever it feels like it.',
    kind: 'toggle',
    needsConvai: true,
  },
  {
    id: 'stay',
    label: 'Stay',
    icon: '<path d="M12 17v5"/><path d="M9 3h6l-1 7 4 3H6l4-3-1-7Z"/>',
    description: 'Pin the character exactly where it is. No wandering until released.',
    kind: 'toggle',
    needsConvai: false,
  },
  {
    id: 'follow-cursor',
    label: 'Follow cursor',
    icon: '<path d="M4 4l7.5 16 2-6.5L20 11.5Z"/><path d="M13.5 13.5L19 19"/>',
    description: 'The character tags along after your mouse cursor.',
    kind: 'toggle',
    needsConvai: false,
    gatedBy: 'cursorInteractions',
  },
  {
    id: 'reminder',
    label: 'Reminder',
    icon: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    description: 'Write a note with a date and time — the character confirms it and reminds you when it is due.',
    kind: 'action',
    needsConvai: false,
  },
  {
    id: 'notes',
    label: 'Notes',
    icon: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5Z"/><path d="M15 3v6h6"/>',
    description: 'Open a sticky-notes board that lives on your desktop.',
    kind: 'action',
    needsConvai: false,
  },
  {
    id: 'sleep',
    label: 'Sleep',
    icon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
    description: 'The character curls up for a nap where it stands. Click again to wake it.',
    kind: 'toggle',
    needsConvai: false,
  },
  {
    id: 'wander',
    label: 'Wander',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5Z"/>',
    description: 'Release the character back to free roaming (clears stay, sleep and follow).',
    kind: 'action',
    needsConvai: false,
  },
  {
    id: 'look-once',
    label: 'Take a look',
    icon: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/>',
    description: 'One quick glance at your screen right now, with a comment — no ongoing access.',
    kind: 'action',
    needsConvai: true,
  },
  {
    id: 'summon',
    label: 'Summon friends',
    icon: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M16 15.5a5 5 0 0 1 5.5 4.5"/>',
    description: 'Call every other active character over for a hangout.',
    kind: 'action',
    needsConvai: false,
    gatedBy: 'characterInteractions',
  },
  {
    id: 'friend-chat',
    label: 'Friend chat',
    icon: '<path d="M14 9a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h1v3l3.5-3H11a3 3 0 0 0 3-3Z"/><path d="M14 7h5a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-1v3l-3-3"/>',
    description: 'Start a conversation with another active character — they chat in speech bubbles.',
    kind: 'action',
    needsConvai: true,
    gatedBy: 'characterInteractions',
  },
  {
    id: 'dance-party',
    label: 'Dance party',
    icon: '<circle cx="7" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M10 18V5l10-2v13"/>',
    description: 'Every active character breaks into their special moves at once.',
    kind: 'action',
    needsConvai: false,
  },
  {
    id: 'pomodoro',
    label: 'Focus timer',
    icon: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/>',
    description: 'A focus session. The character sits quietly, then celebrates when you finish.',
    kind: 'toggle',
    needsConvai: false,
    params: [
      { key: 'minutes', label: 'Session length', min: 5, max: 90, step: 5, default: 25, unit: 'min' },
    ],
  },
  {
    id: 'daily-briefing',
    label: 'Daily briefing',
    icon: '<path d="M12 2v4"/><path d="M5 10a7 7 0 0 1 14 0"/><path d="M2 17h20"/><path d="M4 21h16"/><path d="M4.2 12.2l1.4 1.4"/><path d="M19.8 12.2l-1.4 1.4"/>',
    description: 'A hello for this time of day: your pending reminders and a bit of cheer.',
    kind: 'action',
    needsConvai: true,
  },
  {
    id: 'memory-journal',
    label: 'Memories',
    icon: '<path d="M2 4h7a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H2Z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H22Z"/>',
    description: 'Browse and manage what this character remembers about you (needs long-term memory).',
    kind: 'action',
    needsConvai: true,
  },
  {
    id: 'whisper',
    label: 'Whisper mode',
    icon: '<path d="M11 5 6 9H2v6h4l5 4Z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>',
    description: 'Text-only replies — the character stays silent while this is on.',
    kind: 'toggle',
    needsConvai: false,
  },
  {
    id: 'teleport-home',
    label: 'Go home',
    icon: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    description: 'Hop straight to this character’s home spot (set it in the dashboard).',
    kind: 'action',
    needsConvai: false,
  },
  {
    id: 'hide',
    label: 'Hide awhile',
    icon: '<path d="M4 21v-9a8 8 0 0 1 16 0v9l-3-2-2.5 2-2.5-2-2.5 2L7 19Z"/><circle cx="9.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="11" r="1" fill="currentColor" stroke="none"/>',
    description: 'The character slips away for a while, then pops back in.',
    kind: 'action',
    needsConvai: false,
    params: [
      { key: 'minutes', label: 'Hide for', min: 1, max: 120, step: 1, default: 15, unit: 'min' },
    ],
  },
  {
    id: 'do-a-trick',
    label: 'Do a trick',
    icon: '<path d="M12 2.5l2.6 6.2 6.7.5-5.1 4.4 1.6 6.6L12 16.7l-5.8 3.5 1.6-6.6-5.1-4.4 6.7-.5Z"/>',
    description: 'Perform a random special animation on demand.',
    kind: 'action',
    needsConvai: false,
  },
  {
    id: 'walk-my-window',
    label: 'Climb my window',
    icon: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20"/><circle cx="5.5" cy="6.5" r="0.8" fill="currentColor" stroke="none"/><circle cx="8.5" cy="6.5" r="0.8" fill="currentColor" stroke="none"/>',
    description: 'Sends the character to walk along the top edge of your focused window.',
    kind: 'action',
    needsConvai: false,
    gatedBy: 'windowWalking',
  },
];

export const SKILLS: Record<SkillId, SkillDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
) as Record<SkillId, SkillDef>;

export const ALL_SKILL_IDS: SkillId[] = defs.map((d) => d.id);
