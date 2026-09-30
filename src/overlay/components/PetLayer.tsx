/**
 * PetLayer — mounts one absolutely-positioned div per spawned pet. Position,
 * frame and sprite transform are driven imperatively by the runtime's rAF loop
 * (via registerPetEl); React only mounts/unmounts and handles pointer input.
 */
import { useEffect, useRef } from 'react';
import { overlayUi, runtime, useOverlayStore } from '../runtime';
import { hitRegionRegistry } from '../engine/hitRegions';
import type { PetHandle } from '../engine/api';

const DRAG_THRESHOLD_PX = 6;
const CLICK_MAX_MS = 300;

interface Track {
  el: HTMLDivElement;
  pet: PetHandle;
  pointerId: number;
  startX: number;
  startY: number;
  startT: number;
  grabDX: number;
  grabDY: number;
  dragging: boolean;
  samples: { x: number; y: number; t: number }[];
}

export function PetLayer() {
  const pets = useOverlayStore((s) => s.pets);
  const petOpacity = useOverlayStore((s) => s.settings.petOpacity);
  const tracks = useRef(new Map<string, Track>()).current;

  const releaseTrack = (name: string): Track | undefined => {
    const t = tracks.get(name);
    if (!t) return;
    tracks.delete(name);
    t.pet.unpin('pointer');
    delete t.el.dataset.dragging;
    hitRegionRegistry.capture(`pet:${name}`, false);
    runtime.setSuspendKey(`drag:${name}`, false);
    try {
      if (t.el.hasPointerCapture(t.pointerId)) t.el.releasePointerCapture(t.pointerId);
    } catch {
      // The element/pointer may already have been removed by Windows.
    }
    return t;
  };

  useEffect(() => {
    const cancelAll = () => {
      for (const name of tracks.keys()) {
        const t = releaseTrack(name);
        if (t?.dragging) runtime.director.endDrag(name, 0, 0);
      }
    };
    window.addEventListener('blur', cancelAll);
    return () => {
      window.removeEventListener('blur', cancelAll);
      cancelAll();
    };
  }, [tracks]);

  useEffect(() => {
    const names = new Set(pets.map((p) => p.name));
    for (const name of tracks.keys()) {
      if (!names.has(name)) releaseTrack(name);
    }
  }, [pets, tracks]);

  const onDown = (name: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || tracks.has(name)) return;
    const pet = runtime.director.pets.get(name);
    if (!pet) return;
    runtime.setActivePet(name);
    // Hold still from mouse-down, including the click-vs-drag threshold.
    pet.pin('pointer');
    runtime.setSuspendKey(`drag:${name}`, true);
    hitRegionRegistry.capture(`pet:${name}`, true);
    tracks.set(name, {
      el: e.currentTarget,
      pet,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startT: performance.now(),
      grabDX: e.clientX - pet.x,
      grabDY: e.clientY - pet.y,
      dragging: false,
      samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
    });
    // Capture immediately so up/cancel always land on this element even if
    // the pet walks away or the cursor leaves — a Track can never go stale.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone (pen lift / synthetic events) — the buttons
      // check in onMove keeps the track from going phantom.
    }
  };

  const onMove = (name: string, e: React.PointerEvent<HTMLDivElement>) => {
    const t = tracks.get(name);
    if (!t || t.pointerId !== e.pointerId) return;
    // A missed up must release both the engine and native capture.
    if ((e.buttons & 1) === 0) {
      onCancel(name, e);
      return;
    }
    t.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (t.samples.length > 4) t.samples.shift();
    if (!t.dragging) {
      if (Math.hypot(e.clientX - t.startX, e.clientY - t.startY) <= DRAG_THRESHOLD_PX) return;
      t.dragging = true;
      runtime.director.beginDrag(name);
      e.currentTarget.dataset.dragging = 'true';
    }
    runtime.director.dragTo(name, e.clientX - t.grabDX, e.clientY - t.grabDY);
  };

  const onUp = (name: string, e: React.PointerEvent<HTMLDivElement>) => {
    const t = tracks.get(name);
    if (!t || t.pointerId !== e.pointerId) return;
    releaseTrack(name);

    if (t.dragging) {
      // Release velocity ≈ px per 16 ms frame, from the last 4 move samples.
      let vx = 0;
      let vy = 0;
      const s = t.samples;
      if (s.length >= 2) {
        const a = s[0];
        const b = s[s.length - 1];
        const dt = b.t - a.t;
        if (dt > 0) {
          vx = ((b.x - a.x) / dt) * 16;
          vy = ((b.y - a.y) / dt) * 16;
        }
      }
      runtime.director.endDrag(name, vx, vy);
      return;
    }

    const dt = performance.now() - t.startT;
    const dist = Math.hypot(e.clientX - t.startX, e.clientY - t.startY);
    if (dt <= CLICK_MAX_MS && dist <= DRAG_THRESHOLD_PX) {
      if (e.altKey) overlayUi.openChat(name);
      else overlayUi.toggleWheel(name);
      try {
        runtime.layer.forPet(name).touchActivity();
      } catch {
        /* decorative */
      }
    }
  };

  const onCancel = (name: string, e: React.PointerEvent<HTMLDivElement>) => {
    const t = tracks.get(name);
    if (!t || t.pointerId !== e.pointerId) return;
    releaseTrack(name);
    if (t.dragging) {
      runtime.director.endDrag(name, 0, 0);
    }
  };

  return (
    <div className="pet-layer">
      {pets.map((p) => (
        <div
          key={p.name}
          className="pet"
          data-state={p.state}
          style={{
            width: p.size,
            height: p.size,
            opacity: petOpacity / 100,
            display: p.hidden ? 'none' : undefined,
          }}
          ref={(el) => {
            runtime.registerPetEl(p.name, el);
          }}
          onPointerDown={(e) => onDown(p.name, e)}
          onPointerMove={(e) => onMove(p.name, e)}
          onPointerUp={(e) => onUp(p.name, e)}
          onPointerCancel={(e) => onCancel(p.name, e)}
          onLostPointerCapture={(e) => onCancel(p.name, e)}
        >
          <div className="pet-body">
            <img src={p.frameSrc} alt={p.displayName} draggable={false} />
          </div>
        </div>
      ))}
    </div>
  );
}
