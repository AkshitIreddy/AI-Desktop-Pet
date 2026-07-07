import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { sounds } from '../../shared/sounds';
import { spriteUrl } from '../../shared/store';
import { characterList, useDashboard } from '../state';
import { AddCharacterModal } from '../components/AddCharacterModal';
import { CharacterCard } from '../components/CharacterCard';
import { CharacterEditor } from '../components/CharacterEditor';

export function CharactersPage() {
  const characters = useDashboard((s) => s.characters);
  const updateCharacter = useDashboard((s) => s.updateCharacter);
  const toast = useDashboard((s) => s.toast);

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const all = useMemo(() => characterList(characters), [characters]);
  const q = query.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);

  const active = all.filter((c) => !c.archived && match(c.displayName));
  const archived = all.filter((c) => c.archived && match(c.displayName));
  const spawnedCount = all.filter((c) => c.spawned && !c.archived).length;
  const editingRec = editing ? characters[editing] : undefined;

  return (
    <div className="cdp-page-inner">
      <h1 className="cdp-page-title">Characters</h1>
      <p className="cdp-page-sub">
        Your roster of desktop companions. Toggle one Active to spawn it.
      </p>

      <div className="cdp-char-toolbar">
        <div className="cdp-search">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            className="cdp-input"
            placeholder="Search characters…"
            aria-label="Search characters"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="cdp-btn cdp-btn-primary"
          onClick={() => setAdding(true)}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add character
        </button>
      </div>

      {active.length === 0 ? (
        <div className="cdp-empty">
          <span style={{ fontSize: 34 }} aria-hidden>
            {q ? '🔍' : '🌙'}
          </span>
          <strong>{q ? `No characters match “${query}”` : 'The roster is empty'}</strong>
          <span>
            {q
              ? 'Try a different name, or check the archived list below.'
              : 'Everyone is archived. Unarchive a friend below, or add a new one.'}
          </span>
        </div>
      ) : (
        <motion.div layout className="cdp-char-grid">
          <AnimatePresence mode="popLayout">
            {active.map((rec, i) => (
              <CharacterCard key={rec.name} rec={rec} index={i} onEdit={setEditing} />
            ))}
          </AnimatePresence>
          {!q && (
            <motion.button
              layout
              type="button"
              className="cdp-add-card"
              onClick={() => setAdding(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(active.length * 0.045, 0.4) + 0.1 }}
              whileHover={{ y: -4 }}
            >
              <span className="plus" aria-hidden>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              Add character
            </motion.button>
          )}
        </motion.div>
      )}

      {archived.length > 0 && (
        <div className="cdp-archived">
          <button
            type="button"
            className="cdp-archived-head"
            data-open={archivedOpen || undefined}
            aria-expanded={archivedOpen}
            onClick={() => setArchivedOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 6l6 6-6 6" />
            </svg>
            Archived ({archived.length})
          </button>
          <AnimatePresence initial={false}>
            {archivedOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}
              >
                {archived.map((rec) => (
                  <div key={rec.name} className="cdp-archived-row">
                    <img
                      src={spriteUrl(rec, 'walk1.png')}
                      alt=""
                      draggable={false}
                      loading="lazy"
                    />
                    <span className="name">{rec.displayName}</span>
                    <button
                      type="button"
                      className="cdp-btn cdp-btn-sm"
                      onClick={() => {
                        sounds.play('select');
                        void updateCharacter(rec.name, { archived: false }).then(() =>
                          toast(`${rec.displayName} is back on the roster.`, 'success'),
                        );
                      }}
                    >
                      Unarchive
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {spawnedCount === 0 && (
          <motion.div
            className="cdp-spawn-hint"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            Toggle a character Active and look at your desktop ✨
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingRec && (
          <CharacterEditor
            key={editingRec.name}
            rec={editingRec}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>

      <AddCharacterModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
