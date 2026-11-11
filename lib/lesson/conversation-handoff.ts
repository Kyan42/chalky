import type { ConverseTrailer } from './converse';

type Handoff = Pick<ConverseTrailer, 'resume' | 'level' | 'check'> &
  Partial<Pick<ConverseTrailer, 'end' | 'lesson' | 'amend' | 'research' | 'delegate' | 'quiz'>>;

/** Only repair a conversational handoff; a queued lesson or goodbye owns its next step. */
export function handoffQuestion(trailer: Handoff, spoken: string, canContinue: boolean): string | null {
  if (trailer.end || trailer.lesson || trailer.amend || trailer.research || trailer.delegate || trailer.quiz ||
      trailer.level === 'replan' || trailer.level === 'detour') return null;
  if (canContinue && trailer.resume !== 'wait') return null;
  if (/[?？؟][\s"'”’]*$/.test(spoken.trim())) return null;
  // A "yes" to this must mean what the lesson then does: go on (isResume). The line used to offer to
  // "explore that a little more", and a "yes" went on with the lesson without exploring anything.
  return trailer.check || 'Shall I keep going?';
}
