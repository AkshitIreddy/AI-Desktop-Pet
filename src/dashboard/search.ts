/**
 * Tiny fuzzy matcher shared by the Settings, Skills and Docs search boxes.
 *
 * `fuzzyScore(query, haystack)` tokenizes both sides and requires EVERY query
 * token to land somewhere in the haystack (exact > prefix > substring >
 * subsequence). A synonyms map lets everyday words find the technical labels
 * ("colour" → accent/theme, "mic" → voice, "monitor" → vision…). Returns 0
 * for "no match", higher numbers for better matches.
 */

/** Query-token → extra tokens that are also tried against the haystack. */
const SYNONYMS: Record<string, string[]> = {
  // appearance
  color: ['accent', 'theme', 'appearance'],
  colour: ['accent', 'theme', 'appearance'],
  colors: ['accent', 'theme', 'appearance'],
  dark: ['theme'],
  light: ['theme'],
  look: ['theme', 'appearance', 'accent'],
  // sound
  sound: ['sfx', 'audio', 'volume', 'pack', 'voice', 'effects'],
  audio: ['sound', 'sfx', 'volume', 'voice', 'pack'],
  volume: ['sound', 'sfx', 'voice', 'loud'],
  music: ['sound', 'sfx', 'pack'],
  mute: ['volume', 'sound', 'off'],
  loud: ['volume', 'sound'],
  // voice / mic
  mic: ['voice', 'microphone'],
  microphone: ['voice', 'mic'],
  talk: ['voice', 'chat', 'speech'],
  speak: ['voice', 'speech', 'bubble'],
  tts: ['voice'],
  // AI / connection
  ai: ['convai', 'key', 'character', 'brain'],
  brain: ['convai', 'ai', 'key'],
  api: ['key', 'convai', 'connection'],
  key: ['api', 'convai', 'connection'],
  token: ['api', 'key'],
  account: ['convai', 'connection', 'key'],
  connect: ['connection', 'convai', 'connected'],
  // motion / behavior
  speed: ['animation', 'activity'],
  fast: ['speed', 'animation', 'activity'],
  slow: ['speed', 'animation', 'activity'],
  move: ['animation', 'activity', 'motion', 'walking'],
  lazy: ['activity', 'idle', 'sleep'],
  // vision
  screen: ['vision', 'display', 'monitor', 'capture', 'see'],
  monitor: ['vision', 'screen', 'display'],
  display: ['vision', 'screen', 'monitor', 'theme'],
  see: ['vision', 'screen', 'look'],
  eyes: ['vision', 'screen'],
  camera: ['vision', 'capture'],
  // hotkeys
  hotkey: ['shortcut', 'keyboard', 'hotkeys'],
  hotkeys: ['shortcut', 'keyboard'],
  shortcut: ['hotkey', 'hotkeys', 'keyboard', 'keys'],
  shortcuts: ['hotkey', 'hotkeys', 'keyboard', 'keys'],
  keyboard: ['hotkeys', 'shortcut'],
  bind: ['hotkeys', 'shortcut'],
  // misc
  boot: ['autostart', 'startup', 'start'],
  startup: ['autostart', 'start', 'windows'],
  launch: ['autostart', 'start'],
  memory: ['ltm', 'remember', 'end-user'],
  remember: ['memory', 'ltm'],
  transparent: ['opacity'],
  ghost: ['opacity'],
  size: ['scale', 'pet', 'font'],
  scale: ['size'],
  bubble: ['speech', 'bubbles'],
  text: ['font', 'speech', 'chat'],
  night: ['quiet', 'hours', 'theme'],
  dnd: ['quiet', 'hours'],
  wipe: ['reset', 'defaults'],
  reset: ['defaults', 'restore'],
  chatty: ['chatter', 'frequency', 'free'],
};

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

function bestWordScore(candidate: string, words: string[]): number {
  let best = 0;
  for (const w of words) {
    let s = 0;
    if (w === candidate) s = 4;
    else if (w.startsWith(candidate)) s = 3;
    else if (candidate.length >= 3 && w.includes(candidate)) s = 2;
    else if (candidate.length >= 3 && isSubsequence(candidate, w)) s = 1;
    if (s > best) best = s;
    if (best === 4) break;
  }
  return best;
}

/**
 * Score `haystack` against `query`. 0 = no match. Every query token must
 * match (directly or via a synonym); the sum of per-token qualities is
 * returned so callers can rank multiple candidates.
 */
export function fuzzyScore(query: string, haystack: string): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 1;
  const words = tokenize(haystack);
  if (words.length === 0) return 0;
  let total = 0;
  for (const token of qTokens) {
    // The literal token counts full value; synonym hits count slightly less
    // so a direct label match always outranks a synonym detour.
    let best = bestWordScore(token, words);
    if (best < 4) {
      for (const syn of SYNONYMS[token] ?? []) {
        const s = bestWordScore(syn, words) * 0.75;
        if (s > best) best = s;
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}
