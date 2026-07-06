/**
 * Shown before enabling long-term memory on a character. The requirements and
 * plan limits below come from verified Convai pricing/docs research — keep the
 * numbers in sync with convai.com/pricing when they change.
 */
import { AnimatePresence } from 'framer-motion';
import { useId } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  CONVAI_DASHBOARD_URL,
  CONVAI_PRICING_URL,
} from '../../shared/constants';
import { sounds } from '../../shared/sounds';
import { useDashboard } from '../state';
import { CopyButton, ModalShell } from './controls';

export function LtmWarningModal(props: {
  open: boolean;
  characterName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { open, characterName, onConfirm, onCancel } = props;
  const endUserId = useDashboard((s) => s.settings.endUserId);
  const titleId = useId();

  return (
    <AnimatePresence>
      {open && (
        <ModalShell onClose={onCancel} width={540} labelledBy={titleId}>
          <h3 id={titleId} className="cdp-modal-title">
            Enable long-term memory for {characterName}?
          </h3>
          <div className="cdp-modal-body">
            <p>
              Memory only works when <strong>both</strong> of these are true — otherwise
              the character simply won&rsquo;t remember anything:
            </p>
            <ul>
              <li>
                <strong>Enable Long Term Memory</strong> is turned on for this character
                in the Convai dashboard (<em>Character&nbsp;→ Memory tab&nbsp;→ Memory
                Settings</em>).
              </li>
              <li>
                Your Convai plan has enough long-term-memory allowance. Distinct
                remembered users per API key have been limited to <strong>1</strong> on
                Personal, <strong>5</strong> on mid tiers and <strong>100+</strong> on
                Enterprise (customizable). LTM also raises per-interaction credit usage
                (2k / 4k / 8k token tiers), and interaction quotas vary by plan — e.g.
                Indie Dev allows 3,000 interactions per month and Scale caps 200 monthly
                active end users.
              </li>
            </ul>
            <p>
              Memories are keyed to this install&rsquo;s end-user id (set in Settings):
            </p>
            <div className="cdp-endid" style={{ marginTop: 8 }}>
              <code title={endUserId}>{endUserId}</code>
              <CopyButton text={endUserId} />
            </div>
          </div>
          <div className="cdp-modal-actions">
            <button
              type="button"
              className="cdp-btn cdp-btn-ghost"
              onClick={() => void openUrl(CONVAI_PRICING_URL)}
            >
              Open Convai pricing
            </button>
            <button
              type="button"
              className="cdp-btn cdp-btn-ghost"
              onClick={() => void openUrl(CONVAI_DASHBOARD_URL)}
            >
              Open my dashboard
            </button>
            <button type="button" className="cdp-btn" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="cdp-btn cdp-btn-primary"
              onClick={() => {
                sounds.play('complete');
                onConfirm();
              }}
            >
              I understand, enable
            </button>
          </div>
        </ModalShell>
      )}
    </AnimatePresence>
  );
}
