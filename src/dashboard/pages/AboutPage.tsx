import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  CONVAI_DOCS_URL,
  CONVAI_SDK_URL,
  LATEST_RELEASE_URL,
  REPO_URL,
} from '../../shared/constants';
import { APP_VERSION } from '../state';
import { SectionCard } from '../components/controls';

const WHATS_NEW = [
  'Complete rewrite on Tauri 2 — a fraction of the old footprint, one shared overlay instead of a window per pet',
  'Pets walk on top of your app windows, sit on sills and peek around edges',
  'Radial skill wheel — 8 customizable slots from a library of 22 skills',
  'Throw physics: fling a pet and watch the dizzy landing',
  'Character↔character crosstalk conversations',
  'Timed screen vision with an on-pet countdown badge',
  'Opt-in long-term memory with a built-in memory journal',
  'Reminders with native notifications, plus a sticky-notes board',
  'Free-will chatter with quiet hours',
  'Rename any character, add new ones from bundled sprite sets',
  'Three synthesized sound packs — zero audio assets shipped',
  'Light/dark themes, accent colors, reduced-motion support',
];

function LinkBtn(props: { href: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className="cdp-btn"
      onClick={() => void openUrl(props.href)}
    >
      {props.children}
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7 17L17 7M9 7h8v8" />
      </svg>
    </button>
  );
}

export function AboutPage() {
  return (
    <div className="cdp-page-inner" style={{ maxWidth: 760 }}>
      <motion.div
        className="cdp-about-hero"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="cdp-about-logo" aria-hidden>
          <img src="/assets/klee/walk1.png" alt="" draggable={false} />
        </div>
        <h1>Convai Desktop Pets</h1>
        <p className="tagline">
          AI companions that live on your desktop · v{APP_VERSION} · built with Tauri +
          Convai
        </p>
        <div className="cdp-about-links">
          <LinkBtn href={REPO_URL}>GitHub</LinkBtn>
          <LinkBtn href={LATEST_RELEASE_URL}>Latest release</LinkBtn>
          <LinkBtn href={CONVAI_DOCS_URL}>Convai docs</LinkBtn>
          <LinkBtn href={CONVAI_SDK_URL}>Web SDK</LinkBtn>
        </div>
      </motion.div>

      <SectionCard title="What's new in 2.0">
        <ul className="cdp-whatsnew">
          {WHATS_NEW.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="Acknowledgments & credits"
        description="This project wouldn't be possible without the amazing work of the following creators."
      >
        <div className="cdp-credits">
          <h4>Character artists</h4>
          <ul>
            <li>
              <a
                href="#uuteki"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl('https://linktr.ee/uuteki');
                }}
              >
                @uuteki
              </a>{' '}
              — Creator of the Genshin Impact character shimejis: Venti, Thoma, Kazuha,
              Ayaka, Chongyun, Klee, Hu Tao, and Albedo
            </li>
            <li>
              <a
                href="#phinbella"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl(
                    'https://www.deviantart.com/phinbella-flynn/art/Cartman-Shimeji-747213748',
                  );
                }}
              >
                Phinbella-Flynn
              </a>{' '}
              — Creator of the Cartman shimeji
            </li>
            <li>
              <a
                href="#sojia"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl(
                    'https://sojia.deviantart.com/art/Spongebob-Shimeji-Mascot-317014699',
                  );
                }}
              >
                Sojia
              </a>{' '}
              — Creator of the Spongebob shimeji
            </li>
            <li>
              <a
                href="#cakedoom"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl(
                    'https://cakedoom.deviantart.com/art/Deadpool-shimeji-267525091',
                  );
                }}
              >
                Cakedoom
              </a>{' '}
              — Creator of the Deadpool shimeji
            </li>
          </ul>
          <p style={{ fontSize: 12.5, color: 'var(--cdp-text-faint)', marginTop: 8 }}>
            Want more shimejis? Check out the{' '}
            <a
              href="#directory"
              onClick={(e) => {
                e.preventDefault();
                void openUrl('https://shimejis.xyz/directory');
              }}
            >
              Shimejis Directory
            </a>{' '}
            for hundreds of characters.
          </p>

          <h4>Original Shimeji creator</h4>
          <ul>
            <li>Yuki Yamada — Creator of the original Shimeji concept and software (2009)</li>
          </ul>

          <h4>Shimeji-ee development</h4>
          <ul>
            <li>Shimeji-ee Group — For the enhanced Shimeji engine</li>
            <li>
              <a
                href="#kilkakon"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl('https://kilkakon.com');
                }}
              >
                Kilkakon
              </a>{' '}
              — For continued development and improvements to Shimeji-ee
            </li>
            <li>TigerHix — For contributions on GitHub that were incorporated into this project</li>
          </ul>

          <h4>Additional libraries</h4>
          <ul>
            <li>John O&rsquo;Conner — i18n internationalization classes</li>
            <li>Nilo J. González — NimROD Look And Feel (LGPL v3)</li>
          </ul>

          <h4>Technologies</h4>
          <ul>
            <li>
              <a
                href="#tauri"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl('https://tauri.app');
                }}
              >
                Tauri
              </a>{' '}
              — Cross-platform desktop framework
            </li>
            <li>
              <a
                href="#convai"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl('https://convai.com');
                }}
              >
                Convai
              </a>{' '}
              — AI conversation engine
            </li>
          </ul>
        </div>
      </SectionCard>

      <SectionCard
        title="Licenses"
        description="This project includes components under various licenses."
      >
        <p style={{ fontSize: 13, color: 'var(--cdp-text-dim)' }}>
          See the <code>licenses/</code> folder in the repository for complete details.
        </p>
      </SectionCard>
    </div>
  );
}
