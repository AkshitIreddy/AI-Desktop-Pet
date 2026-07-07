import { sounds } from '../../shared/sounds';
import { APP_VERSION, useDashboard, type PageId } from '../state';

const TITLES: Record<PageId, string> = {
  characters: 'Characters',
  skills: 'Skills',
  settings: 'Settings',
  docs: 'Docs',
  about: 'About',
};

export function TopBar(props: { page: PageId; onNavigate: (p: PageId) => void }) {
  const { page, onNavigate } = props;
  const hasKey = useDashboard((s) => !!s.settings.apiKey.trim());

  return (
    <header className="cdp-topbar">
      <h1 className="cdp-topbar-title">{TITLES[page]}</h1>
      <button
        type="button"
        className="cdp-key-chip"
        data-missing={!hasKey || undefined}
        title={
          hasKey
            ? 'Convai API key is set — open Settings to change it'
            : 'No Convai API key yet — click to add one'
        }
        onClick={() => {
          sounds.play('select');
          onNavigate('settings');
        }}
      >
        <span className="dot" aria-hidden />
        {hasKey ? 'API key set' : 'No API key'}
      </button>
      <span className="cdp-version-chip">v{APP_VERSION}</span>
    </header>
  );
}
