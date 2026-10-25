"use client";

import { useEffect, useRef } from 'react';
import { SessionRecap } from './LearningHistory';
import type { LearningSession } from '@/lib/learning-history';

export default function LessonEnding({ session, saved, error, onClose, onContinue, onSaved, onReflect }: { session: LearningSession; saved: boolean; error: string; onClose: () => void; onContinue: (session: LearningSession) => void; onSaved: (session: LearningSession) => void; onReflect?: (session: LearningSession) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="preferences-panel lesson-ending-panel" ref={dialog} aria-labelledby="lesson-ending-title" onClose={onClose} onCancel={onClose}>
    <div className="preferences-content">
      <header><h2 id="lesson-ending-title">A good place to pause.</h2><button aria-label="Close lesson recap" onClick={onClose}>×</button></header>
      <p role="status">{error || (saved ? 'Your session is saved in Settings → Learning history.' : 'Saving your session…')}</p>
      <h3 className="history-topic">{session.topic}</h3>
      <SessionRecap session={session} onContinue={onContinue} onSaved={onSaved} onReflect={onReflect} />
      <div className="history-actions"><button onClick={onClose}>Done for now</button><a className="history-back" href="/lesson">Start a new topic</a></div>
    </div>
  </dialog>;
}
