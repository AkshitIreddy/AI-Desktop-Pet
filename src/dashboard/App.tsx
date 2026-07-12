import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Suspense, lazy, useEffect, useState } from 'react';
import { useDashboard, type PageId } from './state';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { OnboardingModal } from './components/OnboardingModal';
import { CharactersPage } from './pages/CharactersPage';
import { SkillsPage } from './pages/SkillsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';

// Docs page + styles are owned by the docs module; loaded on demand.
const DocsPage = lazy(async () => {
  await import('./docs/docs.css');
  const mod = await import('./docs/DocsPage');
  return { default: mod.DocsPage };
});

function Toasts() {
  const toasts = useDashboard((s) => s.toasts);
  const dismiss = useDashboard((s) => s.dismissToast);
  return (
    <div className="cdp-toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            className="cdp-toast"
            data-kind={t.kind}
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            onClick={() => dismiss(t.id)}
            title="Dismiss"
          >
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function App() {
  const ready = useDashboard((s) => s.ready);
  const reduceMotion = useDashboard((s) => s.settings.reduceMotion);
  const showOnboarding = useDashboard((s) => s.settings.showOnboarding);
  // Esc/backdrop hides the tour for this session only; Finish persists it off.
  const tourHidden = useDashboard((s) => s.tourHidden);
  const setTourHidden = useDashboard((s) => s.setTourHidden);
  const [page, setPage] = useState<PageId>('characters');

  // Freeze every CSS animation while the dashboard isn't focused/visible. It
  // usually sits minimized in the tray while the pet runs, and WebView2 does
  // NOT occlude a minimized/hidden Tauri window — so its decorative sprite-bob
  // animations would otherwise keep the shared GPU process compositing at the
  // monitor's refresh rate (~60% GPU on this machine). Resumes on focus.
  useEffect(() => {
    const sync = () =>
      document.body.classList.toggle('cdp-idle', document.hidden || !document.hasFocus());
    sync();
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  if (!ready) {
    return (
      <div className="cdp-loading">
        <div className="cdp-spinner" aria-label="Loading" />
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      <div className="cdp-shell">
        <Sidebar page={page} onNavigate={setPage} />
        <div className="cdp-main">
          <TopBar page={page} onNavigate={setPage} />
          {/* Docs owns its scroll (sticky nav + scrollspy) — full-bleed, no page scroll. */}
          <main className="cdp-page" data-fullbleed={page === 'docs' ? '' : undefined}>
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                className="cdp-page-enter"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                {page === 'characters' && <CharactersPage />}
                {page === 'skills' && <SkillsPage />}
                {page === 'settings' && <SettingsPage />}
                {page === 'about' && <AboutPage />}
                {page === 'docs' && (
                  <Suspense
                    fallback={
                      <div className="cdp-loading" style={{ height: '60vh' }}>
                        <div className="cdp-spinner" aria-label="Loading docs" />
                      </div>
                    }
                  >
                    <DocsPage />
                  </Suspense>
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      <AnimatePresence>
        {showOnboarding && !tourHidden && (
          <OnboardingModal
            onOpenDocs={() => setPage('docs')}
            onDismiss={() => setTourHidden(true)}
          />
        )}
      </AnimatePresence>

      <Toasts />
    </MotionConfig>
  );
}
