/**
 * VisionBadge — countdown pill (eye + mm:ss ring) while a screen-vision grant
 * is active. 'header' variant sits in the ChatPanel header; 'floating' hovers
 * above the pet with its own hit region. Clicking either revokes the grant.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ConvaiStatus } from '../../shared/types';
import { messageOf } from '../../skills/handlers';
import { hitRegionRegistry } from '../engine/hitRegions';
import { clamp, displayNameOf, overlayUi, runtime, useOverlayStore } from '../runtime';

const RING_R = 7;
const RING_C = 2 * Math.PI * RING_R;

export function VisionBadge({
  petName,
  variant,
}: {
  petName: string;
  variant: 'header' | 'floating';
}) {
  const sessionMinutes = useOverlayStore((s) => s.settings.visionSessionMinutes);
  const [status, setStatus] = useState<ConvaiStatus | null>(null);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const pc = runtime.layer.forPet(petName);
      setStatus(pc.status());
      return pc.onStatus(setStatus);
    } catch {
      return undefined;
    }
  }, [petName]);

  const active = !!status?.visionActive && (status?.visionExpiresAt ?? 0) > Date.now();

  // 500 ms countdown repaint while active.
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [active]);

  // Floating variant follows the pet and registers its own hit region.
  useEffect(() => {
    if (variant !== 'floating') return;
    const env = runtime.env;
    const regionId = `vision:${petName}`;
    const off = runtime.onPetFrame(petName, (f) => {
      const el = wrapRef.current;
      if (!el) return;
      if (f.hidden) {
        el.style.display = 'none';
        hitRegionRegistry.set(regionId, null);
        return;
      }
      el.style.display = '';
      const w = el.offsetWidth || 86;
      const h = el.offsetHeight || 26;
      const x = clamp(f.x + f.size / 2 - w / 2, 8, env.width - w - 8);
      const y = Math.max(8, f.y - h - 60);
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      hitRegionRegistry.set(regionId, { x, y, w, h });
    });
    return () => {
      off();
      hitRegionRegistry.set(regionId, null);
    };
  }, [variant, petName, active]);

  if (!active) return null;

  const remaining = Math.max(0, (status?.visionExpiresAt ?? 0) - Date.now());
  const total = Math.max(1, sessionMinutes * 60_000);
  const frac = clamp(remaining / total, 0, 1);
  const mm = Math.floor(remaining / 60_000);
  const ss = Math.floor((remaining % 60_000) / 1000);

  const revoke = () => {
    runtime.layer
      .forPet(petName)
      .revokeVision()
      .then(() => overlayUi.toast(`${displayNameOf(petName)} can no longer see your screen`, 'info'))
      .catch((err) => overlayUi.toast(messageOf(err), 'error'));
  };

  const pill = (
    <button
      type="button"
      className="vision-badge"
      title="Screen sharing is on — click to stop"
      onClick={revoke}
    >
      <svg className="vision-ring" viewBox="0 0 18 18" width="18" height="18">
        <circle className="vision-ring-track" cx="9" cy="9" r={RING_R} />
        <circle
          className="vision-ring-fill"
          cx="9"
          cy="9"
          r={RING_R}
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - frac)}
        />
        <g className="vision-eye" transform="translate(4.5, 4.5) scale(0.375)">
          <path
            d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
          />
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </g>
      </svg>
      <span className="vision-time">
        {mm}:{ss.toString().padStart(2, '0')}
      </span>
    </button>
  );

  if (variant === 'header') return pill;

  return (
    <div ref={wrapRef} className="vision-float">
      {pill}
    </div>
  );
}
