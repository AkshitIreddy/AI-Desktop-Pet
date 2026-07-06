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
  activityLevel: 55,
  windowWalking: true,
  cursorInteractions: true,
  characterInteractions: true,
  chatterFrequency: 35,
  speechBubbleStyle: 'glass',
  speechBubbleFontSize: 14,
  speechBubbleSeconds: 6,
  voiceVolume: 80,
  sfxVolume: 60,
  soundPack: 'soft',
  freeWillFrequency: 30,
  quietHoursStart: '',
  quietHoursEnd: '',
  visionFps: 1,
  visionSessionMinutes: 10,
  idleSleepMinutes: 10,
  autostart: false,
  reduceMotion: false,
  showOnboarding: true,
};

/** Base timing constants of the v1 shimeji engine (before animationSpeed scaling). */
export const BASE_FRAME_MS = 200;
export const BASE_MOVE_MS = 12;
export const PET_BASE_SIZE = 100;
