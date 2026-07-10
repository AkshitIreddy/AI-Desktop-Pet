/**
 * SpeechBubble — floats above its pet, streaming character utterances.
 * Not interactive: pointer-events none, no hit region. Position is written
 * imperatively each frame from the runtime's per-pet position feed.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clamp, runtime, useOverlayStore } from '../runtime';

export function SpeechBubble({ petName }: { petName: string }) {
  const fontSize = useOverlayStore((s) => s.settings.speechBubbleFontSize);
  const seconds = useOverlayStore((s) => s.settings.speechBubbleSeconds);
  const reduce = useOverlayStore((s) => s.settings.reduceMotion);

  const [text, setText] = useState('');
  const [visible, setVisible] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef(0);
  const secondsRef = useRef(seconds);
  secondsRef.current = seconds;

  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = runtime.layer.forPet(petName).onBubble((t, final) => {
        window.clearTimeout(hideTimer.current);
        setText(t);
        setVisible(true);
        if (final) {
          hideTimer.current = window.setTimeout(
            () => setVisible(false),
            secondsRef.current * 1000,
          );
        }
      });
    } catch {
      // Convai layer not ready for this pet; bubble stays silent.
    }
    return () => {
      off?.();
      window.clearTimeout(hideTimer.current);
    };
  }, [petName]);

  // Follow the pet each frame; keep the tail pointed at the pet when clamped.
  useEffect(() => {
    const env = runtime.env;
    let lastTransform = '';
    return runtime.onPetFrame(petName, (f) => {
      const el = anchorRef.current;
      if (!el) return;
      if (f.hidden) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w) return;
      const petCx = f.x + f.size / 2;
      const x = Math.round(clamp(petCx - w / 2, 8, env.width - w - 8));
      const y = Math.round(Math.max(8, f.y - h - 14));
      const t = `translate3d(${x}px, ${y}px, 0)`;
      if (t === lastTransform) return;
      lastTransform = t;
      el.style.transform = t;
      el.style.setProperty('--tail-x', `${clamp(petCx - x, 16, w - 16)}px`);
    });
  }, [petName]);

  return (
    <div ref={anchorRef} className="speech-bubble-anchor">
      <AnimatePresence>
        {visible && text && (
          <motion.div
            className="speech-bubble"
            style={{ fontSize }}
            initial={reduce ? false : { opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.97 }}
            transition={
              reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 28 }
            }
          >
            {text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
