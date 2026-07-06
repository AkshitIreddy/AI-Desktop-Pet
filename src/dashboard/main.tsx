/**
 * Dashboard entry. Boot order matters: load persisted state first so the
 * theme paints before the first React frame (no flash of wrong theme).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { watchSystemTheme } from '../shared/theme';
import { App } from './App';
import { useDashboard } from './state';
import './dashboard.css';

async function boot(): Promise<void> {
  // Loads store, applies theme + reduce-motion flag, configures SoundEngine.
  await useDashboard.getState().init();
  watchSystemTheme(() => useDashboard.getState().settings);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
