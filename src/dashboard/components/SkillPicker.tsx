/**
 * SkillPicker — popover listing all 22 skills for one loadout slot — plus
 * LoadoutEditor, the 8-slot grid used by both the character editor (draft
 * mode) and the Skills page (immediate mode).
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SKILL_LOADOUT } from '../../shared/constants';
import { sounds } from '../../shared/sounds';
import type { SkillId } from '../../shared/types';
import { ALL_SKILL_IDS, SKILLS } from '../../skills/registry';
import { useDashboard } from '../state';
import { SkillIcon } from './controls';

const GATE_LABEL = {
  windowWalking: 'Window walking',
  cursorInteractions: 'Cursor interactions',
  characterInteractions: 'Character interactions',
} as const;

export function SkillPicker(props: {
  slot: number;
  loadout: SkillId[];
  onPick: (skill: SkillId) => void;
  onClose: () => void;
}) {
  const { slot, loadout, onPick, onClose } = props;
  const settings = useDashboard((s) => s.settings);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const ids = ALL_SKILL_IDS.filter((id) => {
    if (!q) return true;
    const def = SKILLS[id];
    return (
      def.label.toLowerCase().includes(q) || def.description.toLowerCase().includes(q)
    );
  });

  return (
    <motion.div
      ref={ref}
      className="cdp-skillpicker"
      role="listbox"
      aria-label={`Pick a skill for slot ${slot + 1}`}
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 480, damping: 34 }}
    >
      <div className="cdp-skillpicker-head">
        <input
          className="cdp-input"
          placeholder="Search 22 skills…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search skills"
        />
      </div>
      <div className="cdp-skillpicker-list">
        {ids.map((id) => {
          const def = SKILLS[id];
          const usedAt = loadout.indexOf(id);
          const isCurrent = usedAt === slot;
          const usedElsewhere = usedAt !== -1 && !isCurrent;
          const gateOff = def.gatedBy && !settings[def.gatedBy];
          return (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={isCurrent}
              className="cdp-skillpicker-item"
              data-used={usedElsewhere || undefined}
              data-current={isCurrent || undefined}
              title={usedElsewhere ? `Currently in slot ${usedAt + 1} — picking swaps the two` : undefined}
              onClick={() => {
                sounds.play('select');
                onPick(id);
              }}
            >
              <span className="icon">
                <SkillIcon icon={def.icon} />
              </span>
              <span className="meta">
                <span className="name">
                  {def.label}
                  {def.needsConvai && (
                    <span className="cdp-chip cdp-chip-accent">needs Convai</span>
                  )}
                  {def.gatedBy && (
                    <span
                      className={`cdp-chip ${gateOff ? 'cdp-chip-warn' : ''}`}
                      title={
                        gateOff
                          ? `Hidden from the wheel until "${GATE_LABEL[def.gatedBy]}" is enabled in Settings`
                          : `Needs the "${GATE_LABEL[def.gatedBy]}" setting`
                      }
                    >
                      {gateOff ? `off: ${GATE_LABEL[def.gatedBy]}` : GATE_LABEL[def.gatedBy]}
                    </span>
                  )}
                  {usedElsewhere && (
                    <span className="cdp-chip">slot {usedAt + 1}</span>
                  )}
                </span>
                <span className="desc">{def.description}</span>
              </span>
            </button>
          );
        })}
        {ids.length === 0 && (
          <div className="cdp-empty" style={{ padding: '24px 10px', border: 'none' }}>
            No skills match “{query}”.
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* -------------------------------- LoadoutEditor ------------------------------- */

export function LoadoutEditor(props: {
  loadout: SkillId[];
  onChange: (next: SkillId[]) => void;
}) {
  const { loadout, onChange } = props;
  const [openSlot, setOpenSlot] = useState<number | null>(null);

  const pick = (skill: SkillId) => {
    if (openSlot === null) return;
    const next = [...loadout];
    const already = next.indexOf(skill);
    // Swap with the other slot instead of duplicating.
    if (already !== -1 && already !== openSlot) next[already] = next[openSlot];
    next[openSlot] = skill;
    onChange(next);
    setOpenSlot(null);
  };

  return (
    <div className="cdp-loadout">
      <div className="cdp-loadout-grid" role="group" aria-label="Skill wheel loadout — 8 slots">
        {loadout.map((id, i) => {
          const def = SKILLS[id];
          return (
            <button
              key={i}
              type="button"
              className="cdp-slot"
              data-open={openSlot === i || undefined}
              aria-label={`Slot ${i + 1}: ${def.label}. Click to change.`}
              onClick={() => {
                sounds.play(openSlot === i ? 'wheel-close' : 'wheel-open');
                setOpenSlot(openSlot === i ? null : i);
              }}
            >
              <span className="cdp-slot-num">{i + 1}</span>
              <SkillIcon icon={def.icon} size={20} />
              <span className="cdp-slot-label">{def.label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="cdp-btn cdp-btn-ghost cdp-btn-sm"
          onClick={() => {
            sounds.play('select');
            onChange([...DEFAULT_SKILL_LOADOUT]);
            setOpenSlot(null);
          }}
        >
          Reset to defaults
        </button>
      </div>

      <AnimatePresence>
        {openSlot !== null && (
          <SkillPicker
            slot={openSlot}
            loadout={loadout}
            onPick={pick}
            onClose={() => setOpenSlot(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
