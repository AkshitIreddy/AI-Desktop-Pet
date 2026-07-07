/**
 * NotesBoard — floating, draggable glass board of sticky notes. Pure local
 * feature (no AI): persists through AppStore, syncs via its subscribe().
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { appStore } from '../../shared/store';
import type { Note } from '../../shared/types';
import { hitRegionRegistry } from '../engine/hitRegions';
import { overlayUi, runtime, useOverlayStore } from '../runtime';
import { usePanelDrag } from './ChatPanel';

/** Let the active pet comment on a freshly written sticky note (best-effort). */
function reactToNote(text: string): void {
  const name = runtime.getActivePet();
  if (!name) return;
  try {
    runtime.layer.forPet(name).reactToNote(text);
  } catch {
    // A missing comment should never break note-taking.
  }
}

const W = 360;
const H = 480;

const PASTELS = ['#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#ffc6ff'];

export function NotesBoard() {
  const reduce = useOverlayStore((s) => s.settings.reduceMotion);
  const [notes, setNotes] = useState<Note[]>(() => [...appStore.state.notes]);
  const ref = useRef<HTMLDivElement>(null);

  const { pos, headerProps } = usePanelDrag(
    { x: Math.max(8, runtime.env.width - W - 48), y: 72 },
    { w: W, h: H },
  );

  useEffect(() => {
    const release = runtime.acquireFocus();
    const unsub = appStore.subscribe((st) => setNotes([...st.notes]));
    return () => {
      unsub();
      release();
    };
  }, []);

  // Layout geometry (pos + offsetHeight) rather than getBoundingClientRect so
  // the framer-motion entry transform can't shrink/offset the hit region.
  useEffect(() => {
    const el = ref.current;
    if (el) hitRegionRegistry.set('notes', { x: pos.x, y: pos.y, w: W, h: el.offsetHeight });
  });
  useEffect(() => () => hitRegionRegistry.set('notes', null), []);

  const add = () => {
    void appStore.addNote('', PASTELS[notes.length % PASTELS.length]);
  };

  return (
    <motion.div
      ref={ref}
      className="notes-board cdp-glass"
      style={{ left: pos.x, top: pos.y, width: W, maxHeight: H }}
      initial={reduce ? false : { opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }}
    >
      <header className="panel-header" {...headerProps}>
        <div className="panel-title">Sticky notes</div>
        <button type="button" className="icon-btn" title="Add a note" onClick={add}>
          +
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Close"
          onClick={() => overlayUi.closeNotes()}
        >
          ×
        </button>
      </header>

      <div className="notes-grid">
        {notes.length === 0 && (
          <div className="notes-empty">
            Nothing here yet — press <strong>+</strong> to stick a note.
          </div>
        )}
        <AnimatePresence>
          {notes.map((n) => (
            <motion.div
              key={n.id}
              className="note-card"
              style={{ background: n.color }}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, scale: 0.9, rotate: -2 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85, rotate: 3 }}
              transition={
                reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 30 }
              }
            >
              <textarea
                className="note-text"
                defaultValue={n.text}
                placeholder="Write it down…"
                autoFocus={!n.text}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v === n.text) return;
                  void appStore.updateNote(n.id, { text: v });
                  // First time this note gains content = "a note was added".
                  if (v.trim() && !n.text.trim()) reactToNote(v.trim());
                }}
              />
              <button
                type="button"
                className="note-delete"
                title="Delete note"
                onClick={() => void appStore.deleteNote(n.id)}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M5 5l14 14M19 5 5 19" />
                </svg>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
