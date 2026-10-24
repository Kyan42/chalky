"use client";

import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { outputLevel, startMicrophone, unlockAudio, type Microphone } from "./audio";
import { InkSession, type TurnEvents } from "./stt";
import { SonicSpeaker } from "./tts";

type Token = { token: string; version: string; voiceId: string; expiresAt: number };

/**
 * The whole voice loop: mic → Ink 2 → your handlers, and speak() → Sonic → speakers.
 * While the tutor is talking the mic is not sent (half-duplex), so the tutor never hears itself;
 * the student interrupts by tapping, which calls stopSpeaking().
 */
export function useVoice(handlers: TurnEvents) {
  const getToken = useAction(api.cartesia.token);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const token = useRef<Promise<Token> | null>(null);
  const auth = useCallback(async () => {
    const current = token.current ? await token.current.catch(() => null) : null;
    if (!current || current.expiresAt - Date.now() < 5 * 60 * 1000) token.current = getToken({});
    return await token.current!;
  }, [getToken]);

  const ink = useRef<InkSession | null>(null);
  const speaker = useRef<SonicSpeaker | null>(null);
  const mic = useRef<Microphone | null>(null);
  const [started, setStarted] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutedRef = useRef(false);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  /** Call from a click: unlocks audio, starts the mic and connects to Cartesia. */
  const start = useCallback(async () => {
    if (ink.current) return;
    try {
      await unlockAudio();
      speaker.current = new SonicSpeaker(auth);
      speaker.current.onSpeakingChange = setAgentSpeaking;
      ink.current = new InkSession(auth, {
        onStart: () => handlersRef.current.onStart?.(),
        onUpdate: (t) => {
          setPartial(t);
          handlersRef.current.onUpdate?.(t);
        },
        onEagerEnd: (t) => handlersRef.current.onEagerEnd?.(t),
        onResume: () => handlersRef.current.onResume?.(),
        onEnd: (t) => {
          setPartial("");
          handlersRef.current.onEnd?.(t);
        },
        onError: (message) => {
          setError(message);
          handlersRef.current.onError?.(message);
        },
      });
      await ink.current.connect();
      mic.current = await startMicrophone((pcm) => {
        if (mutedRef.current || speaker.current?.speaking) return;
        ink.current?.send(pcm);
      });
      setStarted(true);
      setError(null);
    } catch (e) {
      ink.current?.close();
      ink.current = null;
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, [auth]);

  useEffect(
    () => () => {
      mic.current?.stop();
      ink.current?.close();
      speaker.current?.stop();
    },
    [],
  );

  const speak = useCallback(async (text: string) => {
    if (!speaker.current) return;
    try {
      await speaker.current.speak(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const stopSpeaking = useCallback(() => speaker.current?.stop(), []);
  const setKeyterms = useCallback((terms: string[]) => ink.current?.setKeyterms(terms), []);
  const levels = useCallback(() => ({ mic: muted ? 0 : (mic.current?.level() ?? 0), agent: outputLevel() }), [muted]);

  return { start, started, speak, stopSpeaking, agentSpeaking, partial, muted, setMuted, error, setKeyterms, levels };
}

export type Voice = ReturnType<typeof useVoice>;
