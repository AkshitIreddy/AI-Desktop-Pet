import { motion } from 'framer-motion';
import { sounds } from '../../shared/sounds';
import { APP_VERSION, type PageId } from '../state';
import { SPRING } from './controls';

interface NavDef {
  id: PageId;
  label: string;
  icon: string;
}

const NAV: NavDef[] = [
  {
    id: 'characters',
    label: 'Characters',
    icon: '<circle cx="12" cy="8" r="4.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/><path d="M9.5 8.5c.4.6 1.4 1 2.5 1s2.1-.4 2.5-1"/>',
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: '<path d="M12 3l2.1 5.1L19 9.2l-4 3.4 1.3 5.4L12 15.2 7.7 18l1.3-5.4-4-3.4 4.9-1.1Z"/>',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  },
  {
    id: 'docs',
    label: 'Docs',
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  },
  {
    id: 'about',
    label: 'About',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5"/><circle cx="12" cy="8.2" r="0.5" fill="currentColor"/>',
  },
];

export function Sidebar(props: { page: PageId; onNavigate: (p: PageId) => void }) {
  const { page, onNavigate } = props;
  return (
    <aside className="cdp-sidebar">
      <div className="cdp-logo">
        <span className="cdp-logo-mark" aria-hidden>
          <img src="/assets/klee/walk1.png" alt="" draggable={false} />
        </span>
        <span className="cdp-logo-name">
          Desktop Pets
          <small>powered by Convai</small>
        </span>
      </div>

      <nav className="cdp-nav" aria-label="Main">
        {NAV.map((item) => {
          const active = item.id === page;
          return (
            <motion.button
              key={item.id}
              type="button"
              className="cdp-nav-item"
              data-active={active || undefined}
              aria-current={active ? 'page' : undefined}
              title={item.label}
              // Press feedback lives on the icon only — the row itself never
              // translates or indents, so text alignment stays rock solid.
              whileTap="pressed"
              onClick={() => {
                if (active) return;
                sounds.play('select');
                onNavigate(item.id);
              }}
            >
              {active && (
                <motion.span
                  className="cdp-nav-pill"
                  layoutId="nav-pill"
                  transition={SPRING}
                />
              )}
              <motion.span
                className="cdp-nav-icon"
                variants={{ pressed: { scale: 0.92 } }}
                transition={SPRING}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: item.icon }}
                />
              </motion.span>
              <span>{item.label}</span>
            </motion.button>
          );
        })}
      </nav>

      <div className="cdp-sidebar-foot">
        <span>v{APP_VERSION}</span>
      </div>
    </aside>
  );
}
