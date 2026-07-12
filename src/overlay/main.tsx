/**
 * Overlay entry — boots the runtime (store, engine, Convai, rAF loop) first,
 * then mounts the React tree that renders from its zustand store.
 */
import { createRoot } from 'react-dom/client';
import { overlayUi, runtime, useOverlayStore } from './runtime';
import { OverlayApp } from './OverlayApp';
import { appStore } from '../shared/store';
import './overlay.css';

const root = createRoot(document.getElementById('root')!);

runtime
  .start()
  .then(() => {
    root.render(<OverlayApp />);
    // Dormant debug bridge — only attaches when explicitly opted in via
    // localStorage. Lets a CDP/automation session (e.g. rendering a demo
    // clip) spawn a cast and choreograph behaviors without a live desktop.
    // Off in normal use, so it never leaks the internals to page scripts.
    if (localStorage.getItem('petdebug') === '1') {
      (window as unknown as { __pet: unknown }).__pet = {
        runtime,
        appStore,
        useOverlayStore,
        overlayUi,
      };
    }
  })
  .catch((err) => {
    console.error('[overlay] boot failed', err);
  });
