/** Browser-owned learning history. No account is required and no other learner's logs are listed. */
export interface LearningSession {
  id: string;
  topic: string;
  startedAt: string;
  endedAt: string | null;
  status: 'in-progress' | 'completed' | 'saved';
  covered: string[];
  questions: string[];
  reflection?: string;
  confidence?: 'clear' | 'practice' | 'unsure';
  boardImage?: string;
}

export interface HistoryTranscript {
  id: string;
  question: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  end: string | null;
  beats: Record<string, unknown>[];
  events: Record<string, unknown>[];
  learner: { confusions: string[]; replies: string[] } | null;
}

export function historyFromTranscript(t: HistoryTranscript): LearningSession {
  // Only speech that actually finished: speculative plans are deliberately excluded.
  const speech = [
    ...t.beats.filter(b => !b.interrupted).map(b => b.say),
    // Not the goodbye of an ended lesson ("Sure, let's stop here."): it covered nothing.
    ...t.events.filter(e => e.kind === 'reply' && !(Array.isArray(e.actions) && e.actions.some(a => (a as { type?: string })?.type === 'end_lesson'))).map(e => e.text),
  ].filter((s): s is string => typeof s === 'string');
  const statements = speech.flatMap(s => s.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [])
    .map(s => s.trim()).filter(s => s.length > 10 && !s.endsWith('?'));
  return {
    id: t.id, topic: t.title && t.title !== 'Planning…' ? t.title : t.question,
    startedAt: t.startedAt, endedAt: t.endedAt,
    // "done": the lesson played to the end; "ended by learner": they said they were done (end_lesson).
    status: t.end === 'done' || t.end?.startsWith('ended') ? 'completed' : t.end ? 'saved' : 'in-progress',
    covered: [...new Set(statements)].slice(-6).map(s => s.slice(0, 360)),
    questions: [...new Set(t.learner?.confusions ?? [])].slice(-3),
  };
}

export function continuationPrompt(session: LearningSession): string {
  return `I'd like to continue learning about ${session.topic}. Here is my previous session for context (not proof of mastery):\n${session.covered.join('\n')}\n${session.questions.length ? `Things I found tricky: ${session.questions.join('; ')}.\n` : ''}${session.reflection ? `My reflection: ${session.reflection}\n` : ''}${session.confidence ? `How I felt: ${session.confidence}.\n` : ''}Please ask me one short question to find where to pick up, then guide me from my answer.`;
}

const DB_NAME = 'chalky-learning-history';
const STORE = 'sessions';
export const HISTORY_CHANGED = 'chalky-history-changed';
let opening: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Chalky tabs, then try again.'));
  }).catch(error => { opening = null; throw error; });
  return opening;
}

export async function saveLearningSession(session: LearningSession): Promise<LearningSession> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let saved = session;
    const get = store.get(session.id);
    get.onsuccess = () => {
      const prior = get.result as LearningSession | undefined;
      saved = { ...prior, ...session };
      // A delayed autosave must not reopen a finished session or erase a reflection.
      if (prior?.status === 'completed') { saved.status = 'completed'; saved.endedAt = prior.endedAt; }
      store.put(saved);
    };
    tx.oncomplete = () => { window.dispatchEvent(new Event(HISTORY_CHANGED)); resolve(saved); };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('History could not be saved.'));
  });
}

export async function listLearningSessions(): Promise<LearningSession[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as LearningSession[]).sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
    request.onerror = () => reject(request.error);
  });
}
