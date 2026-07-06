/**
 * ChatPanel — one glass chat card at a time, anchored near its pet, draggable
 * by the header. Registers a 'chat' hit region and holds a focus lease so the
 * overlay window accepts keyboard input while open.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { appStore, spriteFolder } from '../../shared/store';
import { sounds } from '../../shared/sounds';
import type { ChatEntry, ConvaiStatus } from '../../shared/types';
import { messageOf } from '../../skills/handlers';
import { hitRegionRegistry } from '../engine/hitRegions';
import { activityLabel, clamp, overlayUi, runtime, useOverlayStore } from '../runtime';
import { VisionBadge } from './VisionBadge';

const W = 340;
const H = 460;

/** Drag-by-header for floating panels. Keeps the panel inside the overlay. */
export function usePanelDrag(
  initial: { x: number; y: number },
  size: { w: number; h: number },
) {
  const [pos, setPos] = useState(initial);
  const drag = useRef<{ dx: number; dy: number; id: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('button, input, textarea, select, a')) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const env = runtime.env;
    setPos({
      x: clamp(e.clientX - d.dx, 0, env.width - size.w),
      y: clamp(e.clientY - d.dy, 0, env.height - Math.min(size.h, 48)),
    });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return {
    pos,
    headerProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}

function initialAnchor(petName: string): { x: number; y: number } {
  const env = runtime.env;
  const pet = runtime.director.pets.get(petName);
  if (!pet) return { x: (env.width - W) / 2, y: (env.height - H) / 2 };
  const b = pet.bbox();
  let x = b.x + b.w + 16;
  if (x + W > env.width - 8) x = b.x - W - 16;
  return {
    x: clamp(x, 8, env.width - W - 8),
    y: clamp(b.y + b.h / 2 - H / 2, 8, env.height - H - 8),
  };
}

export function ChatPanel({ petName }: { petName: string }) {
  const settings = useOverlayStore((s) => s.settings);
  const rec = appStore.state.characters[petName];
  const pc = useMemo(() => runtime.layer.forPet(petName), [petName]);

  const { pos, headerProps } = usePanelDrag(useMemo(() => initialAnchor(petName), [petName]), {
    w: W,
    h: H,
  });

  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [status, setStatus] = useState<ConvaiStatus | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [value, setValue] = useState('');

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const lastCharTurn = useRef<{ id: string; streaming: boolean } | null>(null);

  // Focus lease + subscriptions + connect attempt.
  useEffect(() => {
    const release = runtime.acquireFocus();
    const offChat = pc.onChat(setEntries);
    const offStatus = pc.onStatus(setStatus);
    setStatus(pc.status());
    pc.ensureConnected()
      .then(() => setConnError(null))
      .catch((err) => setConnError(messageOf(err)));
    return () => {
      offChat();
      offStatus();
      release();
    };
  }, [pc]);

  // Hit region follows the panel. Namespaced per pet so an exiting panel
  // (AnimatePresence pet switch) only deletes its own region, never the new one's.
  useEffect(() => {
    hitRegionRegistry.set(`chat:${petName}`, { x: pos.x, y: pos.y, w: W, h: H });
  }, [pos, petName]);
  useEffect(() => () => hitRegionRegistry.set(`chat:${petName}`, null), [petName]);

  // Auto-scroll while the user hasn't scrolled up; receive chime on turn end.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    const last = [...entries].reverse().find((e) => e.role === 'character');
    const prev = lastCharTurn.current;
    if (last && prev && prev.id === last.id && prev.streaming && !last.streaming) {
      sounds.play('receive');
    }
    lastCharTurn.current = last ? { id: last.id, streaming: last.streaming } : null;
  }, [entries]);

  if (!rec) return null;

  const activity = status?.activity ?? 'disconnected';
  const error = status?.error ?? connError;
  const reduce = settings.reduceMotion;

  const send = () => {
    const text = value.trim();
    if (!text) return;
    setValue('');
    const input = inputRef.current;
    if (input) input.style.height = 'auto';
    sounds.play('send');
    pc.ensureConnected()
      .then(() => {
        setConnError(null);
        pc.sendText(text);
        pc.touchActivity();
      })
      .catch((err) => setConnError(messageOf(err)));
  };

  const toggleMic = () => {
    const turnOn = !status?.micOn;
    (turnOn ? pc.ensureConnected().then(() => pc.setMic(true)) : pc.setMic(false)).catch(
      (err) => overlayUi.toast(messageOf(err), 'error'),
    );
  };

  const retry = () => {
    setConnError(null);
    pc.ensureConnected().catch((err) => setConnError(messageOf(err)));
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`; // ~4 lines
  };

  return (
    <motion.div
      className="chat-panel cdp-glass"
      style={{ left: pos.x, top: pos.y, width: W, height: H }}
      initial={reduce ? false : { opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }}
    >
      <header className="panel-header" {...headerProps}>
        <img
          className="chat-avatar"
          src={`/assets/${spriteFolder(rec)}/walk1.png`}
          alt=""
          draggable={false}
        />
        <div className="chat-title">
          <div className="chat-name">{rec.displayName}</div>
          <div className="chat-status">
            <span className={`activity-dot act-${activity}`} />
            {activityLabel(activity)}
          </div>
        </div>
        <VisionBadge petName={petName} variant="header" />
        <button
          type="button"
          className={`icon-btn mic-btn ${status?.micOn ? 'is-on' : ''}`}
          title={status?.micOn ? 'Turn microphone off' : 'Talk with your voice'}
          onClick={toggleMic}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
            <line x1="12" y1="18" x2="12" y2="22" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Close"
          onClick={() => overlayUi.closeChat()}
        >
          ×
        </button>
      </header>

      {(activity === 'connecting' || error) && (
        <div className={`chat-banner ${error ? 'is-error' : ''}`}>
          {error ? (
            <>
              <span className="chat-banner-text">{error}</span>
              <button type="button" className="chat-retry" onClick={retry}>
                Retry
              </button>
            </>
          ) : (
            <>
              <span className="spinner" />
              <span className="chat-banner-text">Connecting…</span>
            </>
          )}
        </div>
      )}

      <div
        ref={listRef}
        className="chat-messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {entries.length === 0 && (
          <div className="chat-empty">Say hi to {rec.displayName} 👋</div>
        )}
        {entries.map((m) => (
          <div key={m.id} className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-char'}`}>
            {m.text}
            {m.streaming && <span className="stream-cursor">▍</span>}
          </div>
        ))}
      </div>

      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          rows={1}
          placeholder={`Message ${rec.displayName}…`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            autoGrow(e.target);
          }}
          onFocus={() => pc.touchActivity()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {activity === 'speaking' && (
          <button
            type="button"
            className="icon-btn interrupt-btn"
            title="Stop speaking"
            onClick={() => pc.interrupt()}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none">
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className={`icon-btn mic-btn ${status?.micOn ? 'is-on' : ''}`}
          title={status?.micOn ? 'Turn microphone off' : 'Talk with your voice'}
          onClick={toggleMic}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
            <line x1="12" y1="18" x2="12" y2="22" />
          </svg>
        </button>
        <button
          type="button"
          className="send-btn"
          disabled={!value.trim()}
          onClick={send}
          title="Send (Enter)"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2 11 13" />
            <path d="M22 2 15 22l-4-9-9-4Z" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}
