import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { spriteUrl } from '../../shared/store';
import type { SkillId } from '../../shared/types';
import { ALL_SKILL_IDS, SKILLS } from '../../skills/registry';
import { fuzzyScore } from '../search';
import { characterList, useDashboard } from '../state';
import { SkillIcon } from '../components/controls';
import { SkillParamsButton } from '../components/SkillParams';
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
  const [query, setQuery] = useState('');
  const selectedRec =
    (selected && characters[selected] && !characters[selected].archived
      ? characters[selected]
      : undefined) ?? roster[0];

  const q = query.trim();
  const visibleIds = q
    ? ALL_SKILL_IDS.filter(
        (id) => fuzzyScore(q, `${SKILLS[id].label} ${SKILLS[id].description}`) > 0,
      )
    : ALL_SKILL_IDS;

  const saveParam = (skill: SkillId, key: string, value: number) => {
    if (!selectedRec) return;
    const prev = selectedRec.skillSettings ?? {};
    const skillSettings = {
      ...prev,
      [skill]: { ...(prev[skill] ?? {}), [key]: value },
    };
    void updateCharacter(selectedRec.name, { skillSettings });
  };

  return (
    <div className="cdp-page-inner">
      <h1 className="cdp-page-title">Skills</h1>
      <p className="cdp-page-sub">
        All 22 skills your pets can carry. Each character exposes 8 of them in its
        radial wheel — click a pet on your desktop to open it. Skills with a gear
        have tunable parameters, saved per character.
      </p>

      <div className="cdp-char-toolbar">
        <div className="cdp-search">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            className="cdp-input"
            placeholder="Search skills…"
            aria-label="Search skills"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {visibleIds.length === 0 ? (
        <div className="cdp-empty">
          <span style={{ fontSize: 34 }} aria-hidden>
            🔍
          </span>
          <strong>No skills match “{query}”</strong>
          <span>Try another word — “screen”, “timer”, “dance”…</span>
        </div>
      ) : (
        <div className="cdp-skills-grid">
          {visibleIds.map((id: SkillId, i) => {
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
                {def.params && selectedRec && (
                  <span className="cdp-skill-card-gear">
                    <SkillParamsButton
                      def={def}
                      values={selectedRec.skillSettings?.[id]}
                      subtitle={`for ${selectedRec.displayName}`}
                      onSave={(key, value) => saveParam(id, key, value)}
                    />
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      <h2 className="cdp-page-title" style={{ fontSize: 17, margin: '38px 0 4px' }}>
        Per-character loadout
      </h2>
      <p className="cdp-page-sub" style={{ marginBottom: 16 }}>
        Pick a character, then click any of its 8 wheel slots to swap skills. The
        gears above tune parameters for this character too. Changes save instantly.
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
                  src={spriteUrl(rec, 'walk1.png')}
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
