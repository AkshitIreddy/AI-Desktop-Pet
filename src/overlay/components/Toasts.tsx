/**
 * Toasts — stacked, bottom-center, non-interactive (pointer-events: none, no
 * hit regions). The store auto-dismisses each toast after 4 s.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useOverlayStore } from '../runtime';

const ICONS = {
  info: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.5" fill="currentColor" />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.4 4.6-5" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
    </svg>
  ),
} as const;

export function Toasts() {
  const toasts = useOverlayStore((s) => s.toasts);
  const reduce = useOverlayStore((s) => s.settings.reduceMotion);

  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout={!reduce}
            className={`toast toast-${t.kind}`}
            initial={reduce ? false : { opacity: 0, y: 18, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            transition={
              reduce ? { duration: 0 } : { type: 'spring', stiffness: 440, damping: 32 }
            }
          >
            <span className="toast-icon">{ICONS[t.kind]}</span>
            {t.msg}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
