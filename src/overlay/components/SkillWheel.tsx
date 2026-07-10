/**
 * SkillWheel — 8-wedge radial menu built from character.skillLoadout.
 * Follows its pet each frame (position fed by the runtime, not React state),
 * clamps to stay fully on-screen, and registers a single 'wheel' hit region.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { appStore } from '../../shared/store';
import { sounds } from '../../shared/sounds';
import type { ConvaiStatus, SkillDef } from '../../shared/types';
import { SKILLS } from '../../skills/registry';
import { getSkillState, runSkill } from '../../skills/handlers';
import { hitRegionRegistry } from '../engine/hitRegions';
import { monitorAt } from '../engine/monitors';
import { activityLabel, clamp, overlayUi, runtime, useOverlayStore } from '../runtime';

const SIZE = 320;
const CX = SIZE / 2;
const INNER_R = 92;
const OUTER_R = 152;
const GAP_DEG = 2.4;
const ICON_R = (INNER_R + OUTER_R) / 2;

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY_ + r * Math.sin(a)];
}
const CY_ = SIZE / 2;

function wedgePath(midDeg: number): string {
  const a0 = midDeg - 22.5 + GAP_DEG;
  const a1 = midDeg + 22.5 - GAP_DEG;
  const [x0o, y0o] = polar(OUTER_R, a0);
  const [x1o, y1o] = polar(OUTER_R, a1);
  const [x0i, y0i] = polar(INNER_R, a0);
  const [x1i, y1i] = polar(INNER_R, a1);
  return (
    `M ${x0o} ${y0o} A ${OUTER_R} ${OUTER_R} 0 0 1 ${x1o} ${y1o} ` +
    `L ${x1i} ${y1i} A ${INNER_R} ${INNER_R} 0 0 0 ${x0i} ${y0i} Z`
  );
}

function activeArcPath(midDeg: number): string {
  const r = OUTER_R - 4;
  const a0 = midDeg - 22.5 + GAP_DEG + 2;
  const a1 = midDeg + 22.5 - GAP_DEG - 2;
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
}

const GATE_LABEL: Record<NonNullable<SkillDef['gatedBy']>, string> = {
  windowWalking: 'Window walking',
  cursorInteractions: 'Cursor interactions',
  characterInteractions: 'Character interactions',
};

export function SkillWheel({ petName }: { petName: string }) {
  const settings = useOverlayStore((s) => s.settings);
  // Scale the whole wheel with the pet-size setting: a fixed 320 px wheel
  // reads tiny on dense displays where users bump pets to 150%+. The SVG
  // scales via viewBox (crisp), hub/tooltip via transforms.
  const k = clamp(settings.petSize / 100, 1, 2);
  const box = SIZE * k;
  const [hover, setHover] = useState<number | null>(null);
  const [, setBump] = useState(0);
  const [status, setStatus] = useState<ConvaiStatus | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const rec = appStore.state.characters[petName];
  const pet = runtime.director.pets.get(petName);

  const loadout = useMemo(
    () => (rec?.skillLoadout ?? []).slice(0, 8).map((id) => SKILLS[id]).filter(Boolean),
    [rec],
  );

  useEffect(() => {
    try {
      return runtime.layer.forPet(petName).onStatus(setStatus);
    } catch {
      return undefined;
    }
  }, [petName]);

  // Follow the pet each frame; keep the wheel fully on-screen; hit region.
  useEffect(() => {
    const env = runtime.env;
    let lastTransform = '';
    const off = runtime.onPetFrame(petName, (f) => {
      const el = wrapRef.current;
      if (!el) return;
      if (f.hidden) {
        el.style.display = 'none';
        hitRegionRegistry.set('wheel', null);
        return;
      }
      el.style.display = '';
      // Clamp to the monitor under the pet, not the all-monitors union: the
      // union can extend past this screen's bottom edge, and even alone its
      // bottom lies under the taskbar. floorY (work-area bottom) keeps the
      // whole wheel visible above the taskbar.
      const m = monitorAt(env, f.x + f.size / 2);
      const x = Math.round(clamp(f.x + f.size / 2 - box / 2, m.left + 8, m.right - box - 8));
      const y = Math.round(clamp(f.y + f.size / 2 - box / 2, m.top + 8, m.floorY - box - 8));
      hitRegionRegistry.set('wheel', { x, y, w: box, h: box });
      const t = `translate3d(${x}px, ${y}px, 0)`;
      if (t === lastTransform) return;
      lastTransform = t;
      el.style.transform = t;
      // Near the floor the hover tooltip (which hangs below the wheel) would
      // be clipped — flip it above the wheel instead.
      if (y + box > m.floorY - 64) el.dataset.tipAbove = 'true';
      else delete el.dataset.tipAbove;
    });
    return () => {
      off();
      hitRegionRegistry.set('wheel', null);
    };
  }, [petName, box]);

  // Escape closes; clicks elsewhere in the webview close too (pets excluded —
  // their own click handler decides whether to toggle or move the wheel).
  // The wheel holds a focus lease while open so keydown is actually delivered
  // (the overlay is non-focusable at rest); losing focus — clicking the desktop
  // or another app — counts as click-out and dismisses the wheel.
  useEffect(() => {
    const release = runtime.acquireFocus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') overlayUi.closeWheel();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (wrapRef.current?.contains(t)) return;
      if (t.closest('.pet')) return;
      overlayUi.closeWheel();
    };
    const onBlur = () => overlayUi.closeWheel();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
      release();
    };
  }, []);

  if (!rec || !pet) return null;

  const reduce = settings.reduceMotion;
  const activity = status?.activity ?? 'disconnected';
  const hovered = hover !== null ? loadout[hover] : null;

  const invoke = (def: SkillDef) => {
    const locked = !!def.gatedBy && !settings[def.gatedBy];
    if (locked) {
      overlayUi.toast(
        `Enable “${GATE_LABEL[def.gatedBy!]}” in Settings to use ${def.label}`,
        'info',
      );
      return;
    }
    sounds.play('select');
    void runSkill({
      skill: def.id,
      pet,
      director: runtime.director,
      layer: runtime.layer,
      store: appStore,
      ui: overlayUi,
    }).finally(() => setBump((b) => b + 1));
    // Auto-close covers toggles too — the toast/status conveys the new state.
    // With it off, the wheel stays open so skills can be chained (panels that
    // a skill opens still dismiss it via overlayUi.open*).
    if (settings.autoCloseWheelOnSelect) overlayUi.closeWheel();
    else setBump((b) => b + 1);
  };

  return (
    <div
      ref={wrapRef}
      className="skill-wheel"
      style={{ width: box, height: box, '--wheel-scale': k } as React.CSSProperties}
    >
      <motion.svg
        width={box}
        height={box}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        initial={reduce ? false : { scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 30 }}
      >
        {loadout.map((def, i) => {
          const mid = -90 + i * 45;
          const locked = !!def.gatedBy && !settings[def.gatedBy];
          const active =
            def.kind === 'toggle' && getSkillState(pet, def.id, runtime.layer, appStore);
          const [ix, iy] = polar(ICON_R, mid);
          return (
            <motion.g
              key={def.id}
              className={[
                'wheel-wedge',
                locked ? 'is-locked' : '',
                active ? 'is-active' : '',
                hover === i ? 'is-hover' : '',
              ].join(' ')}
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              initial={reduce ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: hover === i && !locked ? 1.06 : 1, opacity: locked ? 0.4 : 1 }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 480, damping: 28, delay: hover === null ? i * 0.025 : 0 }
              }
              onPointerEnter={() => {
                setHover(i);
                if (!locked) sounds.play('hover');
              }}
              onPointerLeave={() => setHover((h) => (h === i ? null : h))}
              onClick={() => invoke(def)}
            >
              <path className="wheel-wedge-bg" d={wedgePath(mid)} />
              {active && <path className="wheel-wedge-ring" d={activeArcPath(mid)} />}
              <g
                className="wheel-wedge-icon"
                transform={`translate(${ix - 12}, ${iy - 12})`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dangerouslySetInnerHTML={{ __html: def.icon }}
              />
              {locked && (
                <g
                  className="wheel-wedge-lock"
                  transform={`translate(${ix - 5}, ${iy + 8}) scale(0.45)`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </g>
              )}
            </motion.g>
          );
        })}
      </motion.svg>

      <motion.div
        className="wheel-hub"
        initial={reduce ? false : { scale: 0.6 * k, opacity: 0 }}
        animate={{ scale: k, opacity: 1 }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 26 }}
      >
        <span className={`activity-dot act-${activity}`} />
        <div className="wheel-name" title={rec.displayName}>
          {rec.displayName}
        </div>
        <div className="wheel-activity">{activityLabel(activity)}</div>
        <button
          type="button"
          className="wheel-close"
          aria-label="Close"
          onClick={() => overlayUi.closeWheel()}
        >
          ×
        </button>
      </motion.div>

      {hovered && (
        <div className="wheel-tip" role="tooltip">
          <strong>{hovered.label}</strong>
          <span>{hovered.description}</span>
        </div>
      )}
    </div>
  );
}
