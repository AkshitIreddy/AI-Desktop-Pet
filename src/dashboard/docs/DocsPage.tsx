/**
 * In-app documentation — two-pane layout with a sticky scrollspy nav on the
 * left and the guide content on the right. Owns its own scroll container, so
 * the dashboard shell just needs to give the page a definite height.
 */
import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sounds } from '../../shared/sounds';
import { fuzzyScore } from '../search';
import { DOC_SECTIONS } from './content';
import './docs.css';

/** settings.reduceMotion drives --cdp-anim; honor it without a store round-trip. */
function motionReduced(): boolean {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--cdp-anim').trim();
  return v === '0s' || v === '0ms';
}

/** Sticky-header offset used by both the scrollspy and click-to-scroll. */
const SPY_OFFSET = 96;

export function DocsPage() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(DOC_SECTIONS[0].id);
  const [query, setQuery] = useState('');
  // Full text of each rendered section, extracted once after mount, so the
  // search can match body copy and not just titles.
  const [sectionText, setSectionText] = useState<Record<string, string>>({});
  // Suppress spy updates while a click-initiated smooth scroll is in flight
  // (time-bounded so an interrupted scroll can never freeze the highlight).
  const clickGuard = useRef<number>(0);

  const spy = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    if (performance.now() < clickGuard.current) return;
    // Rect-based offsets: framer's entrance transform on the content pane
    // makes offsetTop unreliable, rects are not.
    const rootTop = root.getBoundingClientRect().top;
    let current = DOC_SECTIONS[0].id;
    for (const el of root.querySelectorAll<HTMLElement>('[data-doc-id]')) {
      if (el.getBoundingClientRect().top - rootTop <= SPY_OFFSET) {
        current = el.dataset.docId ?? current;
      }
    }
    // Bottom of the scroller → always light up the last section.
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
      current = DOC_SECTIONS[DOC_SECTIONS.length - 1].id;
    }
    setActive(current);
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    spy();
    root.addEventListener('scroll', spy, { passive: true });
    return () => root.removeEventListener('scroll', spy);
  }, [spy]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const out: Record<string, string> = {};
    for (const el of root.querySelectorAll<HTMLElement>('[data-doc-id]')) {
      const id = el.dataset.docId;
      if (id) out[id] = el.textContent ?? '';
    }
    setSectionText(out);
  }, []);

  const q = query.trim();
  const scored = useMemo(
    () =>
      DOC_SECTIONS.map((s) => ({
        section: s,
        score: q
          ? fuzzyScore(q, `${s.navTitle} ${s.title} ${sectionText[s.id] ?? ''}`)
          : 1,
      })),
    [q, sectionText],
  );
  const visible = scored.filter((x) => x.score > 0);
  const best = visible.reduce(
    (top, x) => (top === null || x.score > top.score ? x : top),
    null as (typeof scored)[number] | null,
  );

  const jumpTo = (id: string) => {
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-doc-id="${id}"]`);
    if (!root || !el) return;
    setActive(id);
    const smooth = !motionReduced();
    clickGuard.current = performance.now() + (smooth ? 800 : 100);
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 24;
    root.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  };

  const reduced = motionReduced();

  return (
    <div className="docs">
      <nav className="docs-nav" aria-label="Documentation sections">
        <div className="docs-nav-title">Guide</div>
        <div className="docs-search">
          <input
            className="cdp-input"
            placeholder="Search docs…"
            aria-label="Search documentation"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q && best) {
                sounds.play('select');
                jumpTo(best.section.id);
              }
              if (e.key === 'Escape') setQuery('');
            }}
          />
        </div>
        {q && visible.length === 0 && (
          <span className="docs-search-empty">No sections match.</span>
        )}
        {visible.map(({ section: s }) => {
          const i = DOC_SECTIONS.indexOf(s);
          const isActive = active === s.id;
          return (
            <button
              key={s.id}
              type="button"
              className={`docs-nav-item${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'true' : undefined}
              data-best={(q && best?.section.id === s.id) || undefined}
              onClick={() => {
                sounds.play('select');
                jumpTo(s.id);
              }}
            >
              {isActive && (
                <motion.span
                  className="docs-nav-ind"
                  layoutId="docs-nav-ind"
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 500, damping: 38 }
                  }
                />
              )}
              <span className="docs-nav-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="docs-nav-label">{s.navTitle}</span>
            </button>
          );
        })}
      </nav>

      <div className="docs-scroll" ref={scrollRef}>
        <motion.main
          className="docs-content"
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <header className="docs-hero">
            <h1>How everything works</h1>
            <p>
              The complete guide to your desktop companions — from first API key to
              window-walking, screen vision, and long-term memory.
            </p>
          </header>

          {DOC_SECTIONS.map((s, i) => (
            <section key={s.id} className="docs-section" data-doc-id={s.id} id={`doc-${s.id}`}>
              <h2>
                <span className="docs-sec-num">{String(i + 1).padStart(2, '0')}</span>
                {s.title}
              </h2>
              {s.body}
            </section>
          ))}

          <footer className="docs-footer">
            Made with care — if something here is wrong or missing, the repository issues page
            is the right place to say so.
          </footer>
        </motion.main>
      </div>
    </div>
  );
}

export default DocsPage;
