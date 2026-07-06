/**
 * Overlay entry — boots the runtime (store, engine, Convai, rAF loop) first,
 * then mounts the React tree that renders from its zustand store.
 */
import { createRoot } from 'react-dom/client';
import { runtime } from './runtime';
import { OverlayApp } from './OverlayApp';
import './overlay.css';

const root = createRoot(document.getElementById('root')!);

runtime
  .start()
  .then(() => {
    root.render(<OverlayApp />);
  })
  .catch((err) => {
    console.error('[overlay] boot failed', err);
  });
