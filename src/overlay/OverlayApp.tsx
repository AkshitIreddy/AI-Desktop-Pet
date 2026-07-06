/**
 * OverlayApp — React root of the overlay window. Composes the pet layer with
 * every floating UI surface; all state comes from the runtime's zustand store.
 */
import { AnimatePresence } from 'framer-motion';
import { useOverlayStore } from './runtime';
import { PetLayer } from './components/PetLayer';
import { SpeechBubble } from './components/SpeechBubble';
import { VisionBadge } from './components/VisionBadge';
import { SkillWheel } from './components/SkillWheel';
import { ChatPanel } from './components/ChatPanel';
import { ReminderComposer } from './components/ReminderComposer';
import { NotesBoard } from './components/NotesBoard';
import { MemoryJournal } from './components/MemoryJournal';
import { Toasts } from './components/Toasts';

export function OverlayApp() {
  const ready = useOverlayStore((s) => s.ready);
  const pets = useOverlayStore((s) => s.pets);
  const wheelPet = useOverlayStore((s) => s.wheelPet);
  const chatPet = useOverlayStore((s) => s.chatPet);
  const composerPet = useOverlayStore((s) => s.composerPet);
  const notesOpen = useOverlayStore((s) => s.notesOpen);
  const journalPet = useOverlayStore((s) => s.journalPet);

  if (!ready) return null;

  return (
    <>
      <PetLayer />

      {pets.map((p) => (
        <SpeechBubble key={`bubble-${p.name}`} petName={p.name} />
      ))}
      {/* Vision state lives in the chat-panel header only — a floating badge
          above the pet collides with speech bubbles. */}

      {wheelPet && <SkillWheel key={`wheel-${wheelPet}`} petName={wheelPet} />}

      <AnimatePresence>
        {chatPet && <ChatPanel key={`chat-${chatPet}`} petName={chatPet} />}
      </AnimatePresence>

      {composerPet && <ReminderComposer key={`composer-${composerPet}`} petName={composerPet} />}
      {notesOpen && <NotesBoard />}
      {journalPet && <MemoryJournal key={`journal-${journalPet}`} petName={journalPet} />}

      <Toasts />
    </>
  );
}
