import type { VirtualScreen } from '../../shared/types';
import type { OverlayEnv } from './api';

type DisplayGeometry = Pick<OverlayEnv, 'width' | 'height' | 'scale' | 'originX' | 'originY' | 'monitors'>;

/** Native layout is physical; CSS positions and hit regions share the live WebView scale. */
export function displayGeometry(vs: VirtualScreen, webviewScale: number): DisplayGeometry {
  const scale = Number.isFinite(webviewScale) && webviewScale > 0 ? webviewScale : vs.scale;
  const width = vs.w / scale;
  const height = vs.h / scale;
  return {
    width,
    height,
    scale,
    originX: vs.x,
    originY: vs.y,
    monitors: vs.monitors.map((m) => ({
      left: (m.x - vs.x) / scale,
      right: (m.x + m.w - vs.x) / scale,
      top: (m.y - vs.y) / scale,
      bottom: (m.y + m.h - vs.y) / scale,
      // The native overlay leaves a small strip for auto-hide taskbars.
      floorY: Math.min(height, (m.workY + m.workH - vs.y) / scale),
      primary: m.primary,
    })),
  };
}
