import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { spriteFolder } from '../../shared/store';
import type { SkillId } from '../../shared/types';
import { ALL_SKILL_IDS, SKILLS } from '../../skills/registry';
import { characterList, useDashboard } from '../state';
import { SkillIcon } from '../components/controls';
import { LoadoutEditor } from '../components/SkillPicker';

const GATE_LABEL = {
  windowWalking: 'window walking',
  cursorInteractions: 'cursor interactions',
  characterInteractions: 'character interactions',
} as const;

export function SkillsPage() {
  const characters = useDashboard((s) => s.characters);
  const settings = useDashboard((s) => s.settings);
  const updateCharacter = useDashboard((s) => s.updateCharacter);

  const roster = useMemo(
    () => characterList(characters).filter((c) => !c.archived),
    [characters],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRec =
    (selected && characters[selected] && !characters[selected].archived
      ? characters[selected]
      : undefined) ?? roster[0];

  return (
    <div className="cdp-page-inner">
      <h1 className="cdp-page-title">Skills</h1>
      <p className="cdp-page-sub">
        All 22 skills your pets can carry. Each character exposes 8 of them in its
        radial wheel — click a pet on your desktop to open it.
      </p>

      <div className="cdp-skills-grid">
        {ALL_SKILL_IDS.map((id: SkillId, i) => {
          const def = SKILLS[id];
          const gateOff = def.gatedBy && !settings[def.gatedBy];
          return (
            <motion.div
              key={id}
              className="cdp-skill-card"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.45), duration: 0.3, ease: 'easeOut' }}
              whileHover={{ y: -3 }}
            >
              <span className="icon">
                <SkillIcon icon={def.icon} size={22} />
              </span>
              <div>
                <h3>{def.label}</h3>
                <p>{def.description}</p>
                <div className="chips">
                  <span className="cdp-chip">{def.kind}</span>
                  {def.needsConvai && (
                    <span className="cdp-chip cdp-chip-accent">needs Convai</span>
                  )}
                  {def.gatedBy && (
                    <span
                      className={`cdp-chip ${gateOff ? 'cdp-chip-warn' : ''}`}
                      title={
                        gateOff
                          ? `Currently hidden from wheels — "${GATE_LABEL[def.gatedBy]}" is off in Settings`
                          : `Requires the "${GATE_LABEL[def.gatedBy]}" setting (currently on)`
                      }
                    >
                      needs {GATE_LABEL[def.gatedBy]}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <h2 className="cdp-page-title" style={{ fontSize: 17, margin: '38px 0 4px' }}>
        Per-character loadout
      </h2>
      <p className="cdp-page-sub" style={{ marginBottom: 16 }}>
        Pick a character, then click any of its 8 wheel slots to swap skills. Changes
        save instantly.
      </p>

      {roster.length === 0 ? (
        <div className="cdp-empty">
          <span style={{ fontSize: 34 }} aria-hidden>
            🎒
          </span>
          <strong>No characters to equip</strong>
          <span>Unarchive or add a character on the Characters page first.</span>
        </div>
      ) : (
        <>
          <div className="cdp-char-chip-row" role="tablist" aria-label="Choose a character">
            {roster.map((rec) => (
              <button
                key={rec.name}
                type="button"
                role="tab"
                aria-selected={selectedRec?.name === rec.name}
                className="cdp-char-chip"
                data-active={selectedRec?.name === rec.name || undefined}
                onClick={() => setSelected(rec.name)}
              >
                <img
                  src={`/assets/${spriteFolder(rec)}/walk1.png`}
                  alt=""
                  draggable={false}
                  loading="lazy"
                />
                {rec.displayName}
              </button>
            ))}
          </div>

          {selectedRec && (
            <motion.div
              key={selectedRec.name}
              className="cdp-section"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              style={{ maxWidth: 560 }}
            >
              <LoadoutEditor
                loadout={selectedRec.skillLoadout}
                onChange={(next) =>
                  void updateCharacter(selectedRec.name, { skillLoadout: next })
                }
              />
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
