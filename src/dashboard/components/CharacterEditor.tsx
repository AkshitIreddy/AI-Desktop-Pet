/**
 * CharacterEditor — slide-over panel with draft state + dirty tracking.
 * Nothing persists until Save (except Archive/Delete, which are immediate
 * and confirmed).
 */
import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { sounds } from '../../shared/sounds';
import { spriteUrl } from '../../shared/store';
import type { CharacterRecord, SkillId } from '../../shared/types';
import { SKILLS } from '../../skills/registry';
import { CONVAI_ID_RE, useDashboard } from '../state';
import { ConfirmDialog, SkillIcon, Toggle } from './controls';
import { LtmWarningModal } from './LtmWarningModal';
import { SkillParamsButton } from './SkillParams';
import { LoadoutEditor } from './SkillPicker';

interface Draft {
  displayName: string;
  convaiId: string;
  voiceEnabled: boolean;
  freeWill: boolean;
  longTermMemory: boolean;
  skillLoadout: SkillId[];
  homeX: number | undefined;
  skillSettings: Partial<Record<SkillId, Record<string, number>>>;
}

function toDraft(rec: CharacterRecord): Draft {
  const skillSettings: Draft['skillSettings'] = {};
  for (const [id, params] of Object.entries(rec.skillSettings ?? {})) {
    skillSettings[id as SkillId] = { ...params };
  }
  return {
    displayName: rec.displayName,
    convaiId: rec.convaiId,
    voiceEnabled: rec.voiceEnabled,
    freeWill: rec.freeWill,
    longTermMemory: rec.longTermMemory,
    skillLoadout: [...rec.skillLoadout],
    homeX: rec.homeX,
    skillSettings,
  };
}

export function CharacterEditor(props: { rec: CharacterRecord; onClose: () => void }) {
  const { rec, onClose } = props;
  const updateCharacter = useDashboard((s) => s.updateCharacter);
  const deleteCharacter = useDashboard((s) => s.deleteCharacter);
  const toast = useDashboard((s) => s.toast);

  const [draft, setDraft] = useState<Draft>(() => toDraft(rec));
  const [ltmModal, setLtmModal] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const original = useMemo(() => JSON.stringify(toDraft(rec)), [rec]);
  const dirty = JSON.stringify(draft) !== original;
  const nameEmpty = !draft.displayName.trim();
  const idInvalid = !!draft.convaiId.trim() && !CONVAI_ID_RE.test(draft.convaiId.trim());

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const save = async () => {
    if (nameEmpty) {
      toast('Display name cannot be empty.', 'error');
      return;
    }
    await updateCharacter(rec.name, {
      displayName: draft.displayName.trim(),
      convaiId: draft.convaiId.trim(),
      voiceEnabled: draft.voiceEnabled,
      freeWill: draft.freeWill,
      longTermMemory: draft.longTermMemory,
      skillLoadout: draft.skillLoadout,
      homeX: draft.homeX,
      skillSettings: draft.skillSettings,
    });
    sounds.play('complete');
    toast(`${draft.displayName.trim()} saved.`, 'success');
    onClose();
  };

  const homePct = Math.round((draft.homeX ?? 0.5) * 100);
  const walkSprite = spriteUrl(rec, 'walk1.png');
  const paramSkills = draft.skillLoadout.filter((id) => SKILLS[id].params?.length);

  const setParam = (skill: SkillId, key: string, value: number) =>
    setDraft((d) => ({
      ...d,
      skillSettings: {
        ...d.skillSettings,
        [skill]: { ...(d.skillSettings[skill] ?? {}), [key]: value },
      },
    }));

  return (
    <>
      <motion.div
        className="cdp-slideover-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onMouseDown={requestClose}
      />
      <motion.aside
        className="cdp-slideover"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${rec.displayName}`}
        initial={{ x: '104%' }}
        animate={{ x: 0 }}
        exit={{ x: '104%' }}
        transition={{ type: 'spring', stiffness: 360, damping: 36 }}
      >
        <header className="cdp-slideover-head">
          <img src={walkSprite} alt="" draggable={false} />
          <h2>{rec.displayName}</h2>
          {dirty && <span className="cdp-dirty-dot" title="Unsaved changes" />}
          <button
            type="button"
            className="cdp-btn cdp-btn-ghost cdp-btn-sm"
            aria-label="Close editor"
            onClick={requestClose}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="cdp-slideover-body">
          {/* Identity */}
          <div className="cdp-editor-group">
            <h3>Identity</h3>
            <label className="cdp-editor-label" htmlFor="ce-name">
              Display name
            </label>
            <input
              id="ce-name"
              className="cdp-input"
              value={draft.displayName}
              data-invalid={nameEmpty || undefined}
              onChange={(e) => patch({ displayName: e.target.value })}
              placeholder="How this character is named everywhere"
            />
            {nameEmpty && (
              <span className="cdp-input-note" data-warn>
                A name is required.
              </span>
            )}

            <label className="cdp-editor-label" htmlFor="ce-id" style={{ marginTop: 14 }}>
              Convai character id
            </label>
            <input
              id="ce-id"
              className="cdp-input cdp-input-mono"
              value={draft.convaiId}
              data-invalid={idInvalid || undefined}
              spellCheck={false}
              onChange={(e) => patch({ convaiId: e.target.value })}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
            <span className="cdp-input-note" data-warn={idInvalid || undefined}>
              {idInvalid
                ? 'That does not look like a character id (UUID expected). Find your character id in the Convai dashboard.'
                : 'Find your character id in the Convai dashboard.'}
            </span>
          </div>

          {/* Behavior toggles */}
          <div className="cdp-editor-group">
            <h3>Conversation</h3>
            <div className="cdp-field-row">
              <div className="cdp-field-meta">
                <span className="cdp-field-label">Voice</span>
                <span className="cdp-field-hint">Speak replies out loud (TTS).</span>
              </div>
              <Toggle
                checked={draft.voiceEnabled}
                onChange={(v) => patch({ voiceEnabled: v })}
                label="Voice enabled"
              />
            </div>
            <div className="cdp-field-row">
              <div className="cdp-field-meta">
                <span className="cdp-field-label">Free will</span>
                <span className="cdp-field-hint">
                  May comment unprompted about what it sees and does. Frequency and
                  quiet hours live in Settings.
                </span>
              </div>
              <Toggle
                checked={draft.freeWill}
                onChange={(v) => patch({ freeWill: v })}
                label="Free will"
              />
            </div>
            <div className="cdp-field-row">
              <div className="cdp-field-meta">
                <span className="cdp-field-label">Long-term memory</span>
                <span className="cdp-field-hint">
                  Remembers you between sessions. Needs setup in the Convai dashboard
                  and a plan with LTM allowance.
                </span>
              </div>
              <Toggle
                checked={draft.longTermMemory}
                onChange={(v) => {
                  if (v) setLtmModal(true);
                  else patch({ longTermMemory: false });
                }}
                label="Long-term memory"
              />
            </div>
          </div>

          {/* Home spot */}
          <div className="cdp-editor-group">
            <h3>Home spot</h3>
            <span className="cdp-field-hint">
              Where “Go home” teleports this character, as a fraction of your screen
              width.
            </span>
            <div className="cdp-slider" style={{ width: '100%', marginTop: 10 }}>
              <input
                type="range"
                aria-label="Home spot (percent of screen width)"
                min={0}
                max={100}
                value={homePct}
                style={{
                  background: `linear-gradient(to right, var(--cdp-accent) ${homePct}%, var(--cdp-surface-hover) ${homePct}%)`,
                }}
                onChange={(e) => patch({ homeX: Number(e.target.value) / 100 })}
              />
              <span className="cdp-slider-value">{homePct}%</span>
            </div>
            <div className="cdp-home-strip" aria-hidden>
              <img
                src={walkSprite}
                alt=""
                draggable={false}
                style={{ left: `${homePct}%` }}
              />
            </div>
          </div>

          {/* Skill loadout */}
          <div className="cdp-editor-group">
            <h3>Skill wheel — 8 slots</h3>
            <span className="cdp-field-hint" style={{ display: 'block', marginBottom: 10 }}>
              Click a slot to swap in any of the 22 skills.
            </span>
            <LoadoutEditor
              loadout={draft.skillLoadout}
              onChange={(next) => patch({ skillLoadout: next })}
            />

            {paramSkills.length > 0 && (
              <div className="cdp-loadout-params">
                <span className="cdp-field-hint" style={{ display: 'block', margin: '14px 0 8px' }}>
                  Tunable skills in this loadout — saved with this character.
                </span>
                {paramSkills.map((id) => {
                  const def = SKILLS[id];
                  return (
                    <div key={id} className="cdp-loadout-param-row">
                      <span className="icon" aria-hidden>
                        <SkillIcon icon={def.icon} size={15} />
                      </span>
                      <span className="label">{def.label}</span>
                      <SkillParamsButton
                        def={def}
                        values={draft.skillSettings[id]}
                        subtitle={`for ${draft.displayName || rec.displayName}`}
                        onSave={(key, value) => setParam(id, key, value)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Danger zone */}
          <div className="cdp-editor-group">
            <h3>Danger zone</h3>
            {rec.isUserAdded ? (
              <div className="cdp-field-row">
                <div className="cdp-field-meta">
                  <span className="cdp-field-label">Delete character</span>
                  <span className="cdp-field-hint">
                    Removes it permanently. This cannot be undone.
                  </span>
                </div>
                <button
                  type="button"
                  className="cdp-btn cdp-btn-danger-outline cdp-btn-sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete…
                </button>
              </div>
            ) : (
              <div className="cdp-field-row">
                <div className="cdp-field-meta">
                  <span className="cdp-field-label">Archive character</span>
                  <span className="cdp-field-hint">
                    Bundled characters can&rsquo;t be deleted — archiving hides them from
                    the grid. Unarchive anytime.
                  </span>
                </div>
                <button
                  type="button"
                  className="cdp-btn cdp-btn-danger-outline cdp-btn-sm"
                  onClick={() => setConfirmArchive(true)}
                >
                  Archive…
                </button>
              </div>
            )}
          </div>
        </div>

        <footer className="cdp-slideover-foot">
          <span style={{ flex: 1, fontSize: 12, color: 'var(--cdp-text-faint)' }}>
            {dirty ? 'Unsaved changes' : 'Up to date'}
          </span>
          <button type="button" className="cdp-btn" onClick={requestClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cdp-btn cdp-btn-primary"
            disabled={!dirty || nameEmpty}
            onClick={() => void save()}
          >
            Save changes
          </button>
        </footer>
      </motion.aside>

      <LtmWarningModal
        open={ltmModal}
        characterName={draft.displayName || rec.displayName}
        onConfirm={() => {
          patch({ longTermMemory: true });
          setLtmModal(false);
        }}
        onCancel={() => setLtmModal(false)}
      />

      <ConfirmDialog
        open={confirmArchive}
        title={`Archive ${rec.displayName}?`}
        body={
          <p>
            It will despawn and move to the archived list at the bottom of the
            Characters page. Its settings are kept.
          </p>
        }
        confirmLabel="Archive"
        danger
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => {
          setConfirmArchive(false);
          void updateCharacter(rec.name, { archived: true, spawned: false }).then(() => {
            toast(`${rec.displayName} archived.`);
            onClose();
          });
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${rec.displayName}?`}
        body={
          <p>
            This permanently removes the character and its configuration. Type the
            character&rsquo;s name to confirm.
          </p>
        }
        confirmLabel="Delete forever"
        danger
        requireText={rec.displayName}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void deleteCharacter(rec.name).then(() => {
            toast(`${rec.displayName} deleted.`);
            onClose();
          });
        }}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard changes?"
        body={<p>You have unsaved edits. Close the editor and lose them?</p>}
        confirmLabel="Discard"
        danger
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
