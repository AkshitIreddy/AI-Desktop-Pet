/**
 * VisionService — feeds native screen captures into a Convai vision source.
 *
 * Pipeline: Rust `capture_screen` (JPEG, ≤1280 px) → <img> decode → offscreen
 * <canvas> → `videoControls.publishCanvas(canvas, { source:'screen' })` once;
 * `canvas.captureStream(fps)` picks up subsequent redraws automatically, so
 * the loop only redraws at the configured cadence. Timed grants auto-revoke;
 * `lookOnce` publishes for a single forced comment then unpublishes.
 * The webcam is NEVER enabled.
 */
import type { ConvaiClient, VisionSourceHandle } from '@convai/web-sdk/core';
import { ipc } from '../../shared/ipc';

export interface VisionHost {
  ensureConnected(): Promise<void>;
  client(): ConvaiClient | null;
  /** Clamped capture rate from settings (0.25–2 fps). */
  visionFps(): number;
  setVisionStatus(active: boolean, expiresAt: number): void;
  /** Vision frames count as session activity (keeps idle disconnect away). */
  touch(): void;
  /** Resolves on the next turnEnd, or after timeoutMs. */
  waitTurnEnd(timeoutMs: number): Promise<void>;
}

export interface VisionService {
  grant(minutes: number): Promise<void>;
  revoke(): Promise<void>;
  lookOnce(prompt?: string): Promise<void>;
  dispose(): Promise<void>;
}

const DEFAULT_LOOK_PROMPT =
  "Take a quick look at the user's screen and react to what you see, briefly and in character.";
const CAPTURE_MAX_DIM = 1280;
const CAPTURE_QUALITY = 70;
/** Time for the first published frame to actually flow before triggering. */
const FIRST_FRAME_SETTLE_MS = 1200;
const LOOK_RESPONSE_TIMEOUT_MS = 10_000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode screen capture.'));
    img.src = src;
  });
}

export function createVisionService(host: VisionHost): VisionService {
  let canvas: HTMLCanvasElement | null = null;
  let handle: VisionSourceHandle | null = null;
  let active = false;
  let inFlight: Promise<void> | null = null;
  let loop: ReturnType<typeof setInterval> | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let expiresAt = 0;

  async function drawFrame(force = false): Promise<boolean> {
    while (inFlight !== null) {
      if (!force) return false; // loop tick: coalesce with the running capture
      await inFlight; // mandatory frame (grant/lookOnce): wait out the stale one
    }
    if (canvas === null) return false;
    let done!: () => void;
    const mine = new Promise<void>((r) => {
      done = r;
    });
    inFlight = mine;
    try {
      const cap = await ipc.captureScreen(CAPTURE_MAX_DIM, CAPTURE_QUALITY);
      const img = await loadImage(`data:image/jpeg;base64,${cap.base64Jpeg}`);
      if (canvas === null) return false; // revoked while decoding
      if (canvas.width !== cap.width || canvas.height !== cap.height) {
        canvas.width = cap.width;
        canvas.height = cap.height;
      }
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      host.touch();
      return true;
    } catch {
      return false; // skip the frame; the previous one stays published
    } finally {
      done();
      if (inFlight === mine) inFlight = null;
    }
  }

  function stopTimers(): void {
    if (loop !== null) clearInterval(loop);
    loop = null;
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  function armExpiry(): void {
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => {
      void revoke();
    }, Math.max(0, expiresAt - Date.now()));
  }

  async function unpublish(): Promise<void> {
    const client = host.client();
    const h = handle;
    handle = null;
    if (client !== null && h !== null) {
      try {
        await client.videoControls.unpublishVisionSource(h);
      } catch {
        // Track may already be gone (disconnect); nothing to do.
      }
    }
  }

  async function grant(minutes: number): Promise<void> {
    await host.ensureConnected();
    expiresAt = Date.now() + Math.max(1, minutes) * 60_000;
    if (active) {
      // Extend the running grant.
      armExpiry();
      host.setVisionStatus(true, expiresAt);
      return;
    }
    const client = host.client();
    if (client === null) throw new Error('Not connected — try again.');
    canvas = document.createElement('canvas');
    const ok = await drawFrame(true);
    if (!ok || canvas.width === 0) {
      canvas = null;
      throw new Error('Screen capture failed — try again.');
    }
    const fps = host.visionFps();
    handle = await client.videoControls.publishCanvas(canvas, {
      source: 'screen',
      name: 'user-screen',
      fps,
    });
    active = true;
    loop = setInterval(() => {
      void drawFrame();
    }, Math.max(500, Math.round(1000 / fps)));
    armExpiry();
    host.setVisionStatus(true, expiresAt);
  }

  async function revoke(): Promise<void> {
    stopTimers();
    const wasActive = active;
    active = false;
    expiresAt = 0;
    host.setVisionStatus(false, 0);
    if (wasActive) await unpublish();
    canvas = null;
  }

  async function lookOnce(prompt?: string): Promise<void> {
    const text = prompt ?? DEFAULT_LOOK_PROMPT;
    if (active) {
      // A grant is already streaming frames — just force a comment.
      host.client()?.visionTrigger({ respondMode: 'must_respond', text });
      host.touch();
      await host.waitTurnEnd(LOOK_RESPONSE_TIMEOUT_MS);
      return;
    }
    await host.ensureConnected();
    const client = host.client();
    if (client === null) throw new Error('Not connected — try again.');
    canvas = document.createElement('canvas');
    const ok = await drawFrame(true);
    if (!ok || canvas.width === 0) {
      canvas = null;
      throw new Error('Screen capture failed — try again.');
    }
    let once: VisionSourceHandle | null = null;
    try {
      once = await client.videoControls.publishCanvas(canvas, {
        source: 'screen',
        name: 'user-screen',
        fps: 1,
      });
      await new Promise((r) => setTimeout(r, FIRST_FRAME_SETTLE_MS));
      client.visionTrigger({ respondMode: 'must_respond', text });
      host.touch();
      await host.waitTurnEnd(LOOK_RESPONSE_TIMEOUT_MS);
    } finally {
      if (once !== null) {
        try {
          await client.videoControls.unpublishVisionSource(once);
        } catch {
          // Already torn down.
        }
      }
      if (!active) canvas = null;
    }
  }

  return {
    grant,
    revoke,
    lookOnce,
    dispose: () => revoke(),
  };
}
