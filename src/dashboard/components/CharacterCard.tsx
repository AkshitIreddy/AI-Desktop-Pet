import { motion } from 'framer-motion';
import { spriteFolder } from '../../shared/store';
import type { CharacterRecord } from '../../shared/types';
import { useDashboard } from '../state';
import { Toggle } from './controls';

export function CharacterCard(props: {
  rec: CharacterRecord;
  index: number;
  onEdit: (name: string) => void;
}) {
  const { rec, index, onEdit } = props;
  const setSpawned = useDashboard((s) => s.setSpawned);

  return (
    <motion.article
      layout
      className="cdp-char-card"
      data-spawned={rec.spawned || undefined}
      initial={{ opacity: 0, y: 22, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{
        type: 'spring',
        stiffness: 380,
        damping: 30,
        delay: Math.min(index * 0.045, 0.4),
      }}
      whileHover={{ y: -4 }}
    >
      <div className="cdp-char-preview">
        <img
          src={`/assets/${spriteFolder(rec)}/walk1.png`}
          alt={`${rec.displayName} sprite`}
          draggable={false}
          loading="lazy"
        />
      </div>

      <h3 className="cdp-char-name" title={rec.displayName}>
        {rec.displayName}
      </h3>

      <div className="cdp-char-badges">
        {rec.spawned && <span className="cdp-chip cdp-chip-ok">Active</span>}
        {rec.archived && <span className="cdp-chip">Archived</span>}
        {rec.longTermMemory && (
          <span className="cdp-chip cdp-chip-accent" title="Long-term memory is on">
            LTM
          </span>
        )}
        {rec.freeWill && (
          <span className="cdp-chip cdp-chip-accent" title="May speak unprompted">
            Free will
          </span>
        )}
        {rec.isUserAdded && <span className="cdp-chip">Custom</span>}
      </div>

      <div className="cdp-char-foot">
        <span className="cdp-char-foot-active">
          <Toggle
            checked={rec.spawned}
            onChange={(next) => void setSpawned(rec.name, next)}
            label={`Spawn ${rec.displayName} on the desktop`}
            size="lg"
            sound={null}
          />
          Active
        </span>
        <button
          type="button"
          className="cdp-btn cdp-btn-ghost cdp-btn-sm"
          onClick={() => onEdit(rec.name)}
          aria-label={`Edit ${rec.displayName}`}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
          Edit
        </button>
      </div>
    </motion.article>
  );
}
