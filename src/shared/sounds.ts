/**
 * SoundEngine — synthesizes all UI sound effects with WebAudio, so the app
 * ships zero audio assets. Three packs shape the same cue set differently:
 *   soft  — warm sine chimes, gentle attack (default, calming)
 *   glass — FM bell tones, airy
 *   retro — square-wave blips, subtle
 */
import type { SoundPack } from './types';

export type SoundCue =
  | 'wheel-open'
  | 'wheel-close'
  | 'hover'
  | 'select'
  | 'send'
  | 'receive'
  | 'reminder'
  | 'spawn'
  | 'despawn'
  | 'land'
  | 'notify'
  | 'complete'
  | 'error';

interface Tone {
  freq: number;
  /** seconds */
  dur: number;
  /** relative gain 0..1 */
  gain: number;
  /** seconds offset from cue start */
  at: number;
  /** optional pitch glide target */
  glideTo?: number;
}

/** Cue definitions as simple tone stacks; the pack decides timbre. */
const CUES: Record<SoundCue, Tone[]> = {
  'wheel-open': [
    { freq: 523.25, dur: 0.16, gain: 0.5, at: 0 },
    { freq: 783.99, dur: 0.22, gain: 0.4, at: 0.06 },
  ],
  'wheel-close': [
    { freq: 783.99, dur: 0.14, gain: 0.35, at: 0 },
    { freq: 523.25, dur: 0.18, gain: 0.3, at: 0.05 },
  ],
  hover: [{ freq: 880, dur: 0.05, gain: 0.12, at: 0 }],
  select: [
    { freq: 659.25, dur: 0.1, gain: 0.4, at: 0 },
    { freq: 987.77, dur: 0.16, gain: 0.32, at: 0.05 },
  ],
  send: [{ freq: 587.33, dur: 0.14, gain: 0.35, at: 0, glideTo: 880 }],
  receive: [{ freq: 880, dur: 0.2, gain: 0.3, at: 0, glideTo: 659.25 }],
  reminder: [
    { freq: 659.25, dur: 0.24, gain: 0.45, at: 0 },
    { freq: 830.61, dur: 0.24, gain: 0.4, at: 0.18 },
    { freq: 987.77, dur: 0.38, gain: 0.35, at: 0.36 },
  ],
  spawn: [
    { freq: 392, dur: 0.12, gain: 0.35, at: 0 },
    { freq: 523.25, dur: 0.12, gain: 0.35, at: 0.08 },
    { freq: 659.25, dur: 0.2, gain: 0.35, at: 0.16 },
  ],
  despawn: [
    { freq: 659.25, dur: 0.12, gain: 0.3, at: 0 },
    { freq: 392, dur: 0.22, gain: 0.28, at: 0.09 },
  ],
  land: [{ freq: 160, dur: 0.09, gain: 0.25, at: 0, glideTo: 90 }],
  notify: [
    { freq: 739.99, dur: 0.14, gain: 0.4, at: 0 },
    { freq: 1108.73, dur: 0.22, gain: 0.3, at: 0.09 },
  ],
  complete: [
    { freq: 523.25, dur: 0.12, gain: 0.4, at: 0 },
    { freq: 659.25, dur: 0.12, gain: 0.4, at: 0.1 },
    { freq: 783.99, dur: 0.12, gain: 0.4, at: 0.2 },
    { freq: 1046.5, dur: 0.3, gain: 0.4, at: 0.3 },
  ],
  error: [
    { freq: 311.13, dur: 0.16, gain: 0.35, at: 0 },
    { freq: 233.08, dur: 0.24, gain: 0.3, at: 0.12 },
  ],
};

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private pack: SoundPack = 'soft';
  /** 0..1 */
  private volume = 0.6;
  private lastHover = 0;

  configure(pack: SoundPack, volumePct: number): void {
    this.pack = pack;
    this.volume = Math.max(0, Math.min(1, volumePct / 100));
  }

  play(cue: SoundCue): void {
    if (this.pack === 'off' || this.volume <= 0) return;
    // Hover ticks are rate-limited so wheel sweeps stay calm.
    if (cue === 'hover') {
      const now = performance.now();
      if (now - this.lastHover < 70) return;
      this.lastHover = now;
    }
    try {
      const ctx = this.context();
      const t0 = ctx.currentTime + 0.01;
      for (const tone of CUES[cue]) this.tone(ctx, tone, t0);
    } catch {
      // Audio is decorative; never let it throw into app logic.
    }
  }

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(ctx: AudioContext, tone: Tone, t0: number): void {
    const start = t0 + tone.at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const peak = tone.gain * this.volume * 0.5;

    let dur = tone.dur;
    switch (this.pack) {
      case 'soft': {
        osc.type = 'sine';
        break;
      }
      case 'glass': {
        // FM-ish shimmer: triangle carrier + faster decay + 5th overtone.
        osc.type = 'triangle';
        const shimmer = ctx.createOscillator();
        const shimmerGain = ctx.createGain();
        shimmer.type = 'sine';
        shimmer.frequency.value = tone.freq * 3.01;
        shimmerGain.gain.setValueAtTime(peak * 0.25, start);
        shimmerGain.gain.exponentialRampToValueAtTime(0.0001, start + dur * 0.8);
        shimmer.connect(shimmerGain).connect(ctx.destination);
        shimmer.start(start);
        shimmer.stop(start + dur);
        break;
      }
      case 'retro': {
        osc.type = 'square';
        dur = Math.min(dur, 0.12);
        break;
      }
      default:
        osc.type = 'sine';
    }

    osc.frequency.setValueAtTime(tone.freq, start);
    if (tone.glideTo) {
      osc.frequency.exponentialRampToValueAtTime(tone.glideTo, start + dur);
    }

    const attack = this.pack === 'retro' ? 0.002 : 0.015;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(this.pack === 'retro' ? peak * 0.6 : peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
}

export const sounds = new SoundEngine();
