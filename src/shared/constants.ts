import type { AppSettings, SkillId } from './types';

/**
 * TODO(AkshitIreddy): replace with a Convai character ID that has long-term
 * memory enabled in the dashboard, so first-run users can try the memory
 * features out of the box. Until then the bundled v1 character ids are kept.
 */
export const DEFAULT_LTM_CHARACTER_ID = '';

export const CONVAI_DASHBOARD_URL = 'https://convai.com/pipeline';
export const CONVAI_PRICING_URL = 'https://convai.com/pricing';
export const CONVAI_DOCS_URL = 'https://docs.convai.com/api-docs';
export const CONVAI_SDK_URL = 'https://www.npmjs.com/package/@convai/web-sdk/v/1.6.0-beta.3';
export const REPO_URL = 'https://github.com/AkshitIreddy/convai-desktop-pet';
export const LATEST_RELEASE_URL = `${REPO_URL}/releases/latest`;

export const DEFAULT_SKILL_LOADOUT: SkillId[] = [
  'chat',
  'voice',
  'show-screen',
  'free-will',
  'reminder',
  'stay',
  'friend-chat',
  'sleep',
];

export const SCHEMA_VERSION = 2;

export const ACCENT_PRESETS = [
  '#ec4899', // pink (v1 default)
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#f97316', // orange
];

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  endUserId: '', // filled with a uuid on first run by AppStore
  theme: 'system',
  accentColor: '#ec4899',
  petSize: 100,
  petOpacity: 100,
  animationSpeed: 1.0,
  activityLevel: 70,
  windowWalking: true,
  cursorInteractions: true,
  characterInteractions: true,
  // 0 = Off: characters never strike up conversations with each other on
  // their own unless the user raises the slider (Friend chat stays available
  // from the wheel — invoking it IS user consent).
  chatterFrequency: 0,
  speechBubbleStyle: 'glass',
  speechBubbleFontSize: 14,
  speechBubbleSeconds: 6,
  voiceVolume: 80,
  sfxVolume: 60,
  soundPack: 'soft',
  freeWillFrequency: 55,
  quietHoursStart: '',
  quietHoursEnd: '',
  visionFps: 1,
  visionSessionMinutes: 10,
  idleSleepMinutes: 0,
  autostart: false,
  reduceMotion: false,
  showOnboarding: true,
  autoConnect: true,
  autoCloseChatOnSend: true,
  autoCloseWheelOnSelect: true,
  gpuPreference: 'default',
  hotkeys: {},
};

/** Old defaults that changed since 2.1 — stored values equal to these are bumped. */
export const LEGACY_DEFAULT_BUMPS: Array<{
  key: 'activityLevel' | 'freeWillFrequency' | 'idleSleepMinutes' | 'chatterFrequency';
  from: number;
  to: number;
}> = [
  { key: 'activityLevel', from: 55, to: 70 },
  { key: 'freeWillFrequency', from: 30, to: 55 },
  // Naps surprised people ("where did she go?") — off unless opted into.
  { key: 'idleSleepMinutes', from: 10, to: 0 },
  // Unprompted character↔character talk is opt-in now.
  { key: 'chatterFrequency', from: 35, to: 0 },
];

/** Base timing constants of the v1 shimeji engine (before animationSpeed scaling). */
export const BASE_FRAME_MS = 200;
export const BASE_MOVE_MS = 12;
export const PET_BASE_SIZE = 100;
