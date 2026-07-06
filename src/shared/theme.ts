/**
 * Design tokens + runtime theming. Both windows call applyTheme() whenever
 * settings change; everything downstream styles itself with CSS variables.
 */
import type { AppSettings, ThemeMode } from './types';

interface Palette {
  bg: string;
  bgElevated: string;
  bgSunken: string;
  surface: string;
  surfaceHover: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  shadow: string;
}

const DARK: Palette = {
  bg: '#0d0f14',
  bgElevated: '#14171f',
  bgSunken: '#090a0e',
  surface: 'rgba(255,255,255,0.045)',
  surfaceHover: 'rgba(255,255,255,0.09)',
  border: 'rgba(255,255,255,0.09)',
  text: '#f2f4f8',
  textDim: 'rgba(242,244,248,0.64)',
  textFaint: 'rgba(242,244,248,0.38)',
  shadow: '0 12px 40px rgba(0,0,0,0.55)',
};

const LIGHT: Palette = {
  bg: '#f5f6fa',
  bgElevated: '#ffffff',
  bgSunken: '#e9ebf2',
  surface: 'rgba(15,18,30,0.04)',
  surfaceHover: 'rgba(15,18,30,0.08)',
  border: 'rgba(15,18,30,0.10)',
  text: '#171a22',
  textDim: 'rgba(23,26,34,0.66)',
  textFaint: 'rgba(23,26,34,0.42)',
  shadow: '0 12px 36px rgba(20,24,40,0.16)',
};

export function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Injects all --cdp-* variables onto :root. Cheap; call on every change. */
export function applyTheme(settings: AppSettings, doc: Document = document): void {
  const mode = resolveMode(settings.theme);
  const p = mode === 'light' ? LIGHT : DARK;
  const accent = hexToRgb(settings.accentColor);
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [10, 10, 16];

  const root = doc.documentElement;
  const set = (k: string, v: string) => root.style.setProperty(k, v);

  set('--cdp-accent', settings.accentColor);
  set('--cdp-accent-soft', `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.16)`);
  set('--cdp-accent-glow', `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.42)`);
  set('--cdp-accent-hover', mix(accent, mode === 'light' ? black : white, 0.15));
  set('--cdp-accent-text', mix(accent, mode === 'light' ? black : white, 0.25));
  set('--cdp-on-accent', '#ffffff');

  set('--cdp-bg', p.bg);
  set('--cdp-bg-elevated', p.bgElevated);
  set('--cdp-bg-sunken', p.bgSunken);
  set('--cdp-surface', p.surface);
  set('--cdp-surface-hover', p.surfaceHover);
  set('--cdp-border', p.border);
  set('--cdp-text', p.text);
  set('--cdp-text-dim', p.textDim);
  set('--cdp-text-faint', p.textFaint);
  set('--cdp-shadow', p.shadow);

  set('--cdp-radius-sm', '8px');
  set('--cdp-radius', '14px');
  set('--cdp-radius-lg', '22px');
  set('--cdp-font', "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif");
  set('--cdp-anim', settings.reduceMotion ? '0s' : '0.22s');
  set('--cdp-anim-slow', settings.reduceMotion ? '0s' : '0.45s');

  root.dataset.theme = mode;
  root.dataset.bubble = settings.speechBubbleStyle;
}

/** React to OS theme flips while in system mode. */
export function watchSystemTheme(getSettings: () => AppSettings, doc: Document = document): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => {
    const s = getSettings();
    if (s.theme === 'system') applyTheme(s, doc);
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
