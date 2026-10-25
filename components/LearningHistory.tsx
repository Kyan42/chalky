"use client";

import { useEffect, useId, useState } from 'react';
import { HISTORY_CHANGED, listLearningSessions, saveLearningSession, type LearningSession } from '@/lib/learning-history';
import './learning-history.css';

/** `onReflect`: a reflection or confidence was saved (the lesson notes it on the learner record). */
export function SessionRecap({ session, onContinue, onSaved, onReflect }: { session: LearningSession; onContinue?: (session: LearningSession) => void; onSaved?: (session: LearningSession) => void; onReflect?: (session: LearningSession) => void }) {
  const reflectionId = useId();
  const [reflection, setReflection] = useState(session.reflection ?? '');
  const [confidence, setConfidence] = useState(session.confidence);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    setSaving(true); setMessage('');
    try {
      const saved = await saveLearningSession({ ...session, reflection: reflection.trim(), confidence });
      onReflect?.(saved);
      setMessage('Reflection saved.'); onSaved?.(saved);
    } catch { setMessage('Couldn’t save. Keep this open and try again.'); }
    finally { setSaving(false); }
  }
  return <div className="session-recap">
    <p className="session-date">{new Date(session.startedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · {session.status === 'completed' ? 'Finished' : 'Saved to revisit'}</p>
    {session.boardImage && <a href={session.boardImage} download="chalky-whiteboard.jpg" title="Download your whiteboard"><img className="history-board" src={session.boardImage} alt={`Saved whiteboard from ${session.topic}`} /></a>}
    <h3>What we covered</h3>
    {session.covered.length ? <ul>{session.covered.map((point, i) => <li key={i}>{point}</li>)}</ul> : <p>We were getting started. You can pick this topic up whenever you’re ready.</p>}
    {session.questions.length > 0 && <><h3>Worth revisiting</h3><ul>{session.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
    <label htmlFor={reflectionId}>One last thought, if you like</label>
    <p>How would you explain the main idea in your own words? What still feels unclear?</p>
    <textarea id={reflectionId} rows={3} maxLength={2000} value={reflection} placeholder="Your takeaway, or a question for next time…" onChange={e => { setReflection(e.target.value); setMessage(''); }} />
    <fieldset><legend>How does it feel?</legend><div className="confidence-options">{([['clear', 'It clicked'], ['practice', 'More practice'], ['unsure', 'Still unsure']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={confidence === value} onClick={() => { setConfidence(value); setMessage(''); }}>{label}</button>)}</div></fieldset>
    <div className="history-actions"><button className="history-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save reflection'}</button>{onContinue && <button onClick={() => onContinue({ ...session, reflection: reflection.trim(), confidence })}>Continue learning</button>}</div>
    {message && <p role="status">{message}</p>}
  </div>;
}

export default function LearningHistory({ onContinue }: { onContinue?: (session: LearningSession) => void }) {
  const [sessions, setSessions] = useState<LearningSession[]>([]);
  const [selected, setSelected] = useState<LearningSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => { void listLearningSessions().then(rows => { if (live) { setSessions(rows); setError(''); } }).catch(() => { if (live) setError('History couldn’t load. Try reopening settings.'); }).finally(() => { if (live) setLoading(false); }); };
    load(); window.addEventListener(HISTORY_CHANGED, load);
    return () => { live = false; window.removeEventListener(HISTORY_CHANGED, load); };
  }, []);
  if (selected) return <><button className="history-back" onClick={() => setSelected(null)}>← All lessons</button><h3 className="history-topic">{selected.topic}</h3><SessionRecap key={selected.id} session={selected} onContinue={onContinue} onSaved={setSelected} /></>;
  return <div className="learning-history">
    <p>Your lessons, takeaways, and whiteboards. Saved on this browser; they won’t appear on another device.</p>
    {loading ? <p role="status">Loading your lessons…</p> : error ? <p role="alert">{error}</p> : sessions.length === 0 ? <div className="history-empty"><h3>A place for what you’re learning.</h3><p>Start a conversation with Chalky. Your session will appear here, ready to revisit.</p></div> : <ul className="history-list">{sessions.map(session => <li key={session.id}><button onClick={() => setSelected(session)}><span className="history-list-title">{session.topic}</span><span>{new Date(session.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {session.status === 'completed' ? 'Finished' : 'Saved to revisit'}</span><span aria-hidden="true">↗</span></button></li>)}</ul>}
  </div>;
}
