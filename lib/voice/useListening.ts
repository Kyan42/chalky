"use client";

/**
 * The listening half of Janani's voice loop (PR #2, lib/voice/useVoice.ts):
 * mic → Ink-2 turns → your handlers. Speaking stays on our own Sonic player,
 * whose word timestamps drive the board.
 *
 * Half-duplex like hers: while `isSpeaking()` returns true the mic isn't sent,
 * so Chalky never hears itself through the speakers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { startMicrophone, unlockAudio, type Microphone } from "./audio";
import { InkSession, type TurnEvents } from "./stt";

type Token = { token: string; version: string; expiresAt: number };

export function useListening(handlers: TurnEvents, isSpeaking: () => boolean) {
  const handlersRef = useRef(handlers);
  const speakingRef = useRef(isSpeaking);
  useEffect(() => {
    handlersRef.current = handlers;
    speakingRef.current = isSpeaking;
  });

  const token = useRef<Promise<Token> | null>(null);
  const auth = useCallback(async () => {
    const current = token.current ? await token.current.catch(() => null) : null;
    if (!current || current.expiresAt - Date.now() < 5 * 60 * 1000) {
      token.current = fetch("/api/cartesia/token", { method: "POST" }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `token request failed (${r.status})`);
        return body as Token;
      });
    }
    return await token.current!;
  }, []);

  const ink = useRef<InkSession | null>(null);
  const mic = useRef<Microphone | null>(null);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutedRef = useRef(false);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  /** Call from a click: unlocks audio, starts the mic and connects to Ink-2. */
  const start = useCallback(async () => {
    if (ink.current) return;
    try {
      await unlockAudio();
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
        if (mutedRef.current || speakingRef.current()) return;
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
    },
    [],
  );

  const setKeyterms = useCallback((terms: string[]) => ink.current?.setKeyterms(terms), []);
  const micLevel = useCallback(() => (muted || speakingRef.current() ? 0 : (mic.current?.level() ?? 0)), [muted]);

  return { start, started, partial, muted, setMuted, error, setKeyterms, micLevel };
}
