/**
 * MemoryJournal — centered modal listing a character's Convai long-term
 * memories with per-row delete and a two-step clear-all.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { messageOf } from '../../skills/handlers';
import type { MemoryItem } from '../convai/api';
import { hitRegionRegistry } from '../engine/hitRegions';
import { displayNameOf, overlayUi, runtime, useOverlayStore } from '../runtime';

const W = 440;
const H = 520;

export function MemoryJournal({ petName }: { petName: string }) {
  const reduce = useOverlayStore((s) => s.settings.reduceMotion);
  const ops = useMemo(() => {
    try {
      return runtime.layer.forPet(petName).memories();
    } catch {
      return null;
    }
  }, [petName]);

  const [items, setItems] = useState<MemoryItem[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const pos = useMemo(() => {
    const env = runtime.env;
    return {
      x: Math.max(8, (env.width - W) / 2),
      y: Math.max(8, (env.height - H) / 2),
    };
  }, []);

  const load = useCallback(
    async (p: number, append: boolean) => {
      if (!ops) return;
      if (!append) setPhase('loading');
      try {
        const res = await ops.list(p);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setHasMore(res.hasMore);
        setPage(p);
        setPhase('ready');
      } catch (e) {
        setErr(messageOf(e));
        setPhase('error');
      }
    },
    [ops],
  );

  useEffect(() => {
    void load(1, false);
  }, [load]);

  useEffect(() => {
    hitRegionRegistry.set('journal', { x: pos.x, y: pos.y, w: W, h: H });
    // Focus lease so the non-focusable overlay actually receives Escape.
    const release = runtime.acquireFocus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') overlayUi.closeMemoryJournal();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      release();
      hitRegionRegistry.set('journal', null);
    };
  }, [pos]);

  const remove = async (id: string) => {
    if (!ops || busy) return;
    setBusy(true);
    try {
      await ops.remove(id);
      setItems((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      overlayUi.toast(messageOf(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!ops || busy) return;
    if (!confirmClear) {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 3500);
      return;
    }
    setBusy(true);
    setConfirmClear(false);
    try {
      await ops.removeAll();
      setItems([]);
      setHasMore(false);
      overlayUi.toast('All memories cleared', 'success');
    } catch (e) {
      overlayUi.toast(messageOf(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      ref={ref}
      className="memory-journal cdp-glass"
      style={{ left: pos.x, top: pos.y, width: W, height: H }}
      initial={reduce ? false : { opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }}
    >
      <header className="panel-header">
        <div className="panel-title">{displayNameOf(petName)}&rsquo;s memories</div>
        {ops && items.length > 0 && (
          <button
            type="button"
            className={`text-btn danger ${confirmClear ? 'is-confirm' : ''}`}
            disabled={busy}
            onClick={clearAll}
          >
            {confirmClear ? 'Really clear all?' : 'Clear all'}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          title="Close"
          onClick={() => overlayUi.closeMemoryJournal()}
        >
          ×
        </button>
      </header>

      <div className="journal-body">
        {!ops && (
          <div className="journal-state">
            Long-term memory is off for this character. Turn it on in the dashboard&rsquo;s
            character settings.
          </div>
        )}
        {ops && phase === 'loading' && (
          <div className="journal-state">
            <span className="spinner" /> Loading memories…
          </div>
        )}
        {ops && phase === 'error' && (
          <div className="journal-state is-error">
            {err}
            <button type="button" className="text-btn" onClick={() => void load(1, false)}>
              Try again
            </button>
          </div>
        )}
        {ops && phase === 'ready' && items.length === 0 && (
          <div className="journal-state">
            No memories yet — chat a while and {displayNameOf(petName)} will start remembering.
          </div>
        )}
        {ops && phase === 'ready' && items.length > 0 && (
          <ul className="journal-list">
            {items.map((m) => (
              <li key={m.id} className="journal-row">
                <div className="journal-memory">{m.memory}</div>
                <div className="journal-meta">
                  {new Date(m.createdAt).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
                <button
                  type="button"
                  className="icon-btn journal-delete"
                  title="Forget this"
                  disabled={busy}
                  onClick={() => void remove(m.id)}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" />
                  </svg>
                </button>
              </li>
            ))}
            {hasMore && (
              <li className="journal-more">
                <button
                  type="button"
                  className="text-btn"
                  disabled={busy}
                  onClick={() => void load(page + 1, true)}
                >
                  Load more
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      <footer className="journal-footer">
        Memories are stored by Convai for your end-user id.
      </footer>
    </motion.div>
  );
}
