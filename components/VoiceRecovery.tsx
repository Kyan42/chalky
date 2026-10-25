"use client";

import { useEffect, useState } from 'react';
import { subscribeVoiceState, voiceNeedsGesture, unlockVoice } from '@/lib/voice/audio';

/** Mobile browsers may interrupt audio after an app switch or phone call. Resume from a real tap. */
export default function VoiceRecovery({ active }: { active: boolean }) {
  const [needed, setNeeded] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const check = () => setNeeded(active && document.visibilityState === 'visible' && voiceNeedsGesture());
    const unsubscribe = subscribeVoiceState(check);
    document.addEventListener('visibilitychange', check);
    check();
    return () => { unsubscribe(); document.removeEventListener('visibilitychange', check); };
  }, [active]);
  if (!needed) return null;
  return <button type="button" className="audio-recovery" onClick={() => {
    setError(false);
    void unlockVoice().then(() => setNeeded(voiceNeedsGesture())).catch(() => setError(true));
  }}>{error ? 'Tap to retry audio' : 'Tap to resume audio'}</button>;
}
