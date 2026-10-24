"use client";

import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import type { Voice } from "@/lib/voice/useVoice";

/**
 * Says the tutor's messages out loud, in order, exactly once. Messages come from Convex (the tutor
 * actions write them), plus local lines like chapter titles via `sayLocal`.
 */
export function useSpeechQueue(voice: Voice, messages: Doc<"messages">[] | undefined) {
  const markSpoken = useMutation(api.messages.markSpoken);
  const queue = useRef<{ id?: Doc<"messages">["_id"]; text: string }[]>([]);
  const seen = useRef(new Set<string>());
  const busy = useRef(false);
  const mountedAt = useRef(0);
  const [current, setCurrent] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);

  const pump = useCallback(async () => {
    // Without voice (not started yet), wait; if voice failed, fall back to captions only.
    if (busy.current || (!voice.started && !voice.error)) return;
    busy.current = true;
    setActive(true);
    while (queue.current.length) {
      const next = queue.current.shift()!;
      setPending(queue.current.length);
      setCurrent(next.text);
      if (next.id) void markSpoken({ messageId: next.id });
      if (voice.started) await voice.speak(next.text);
      else await new Promise((r) => setTimeout(r, Math.min(6000, 800 + next.text.split(/\s+/).length * 250)));
    }
    setCurrent(null);
    setPending(0);
    busy.current = false;
    setActive(false);
  }, [voice, markSpoken]);

  useEffect(() => {
    if (!messages) return;
    for (const message of messages) {
      if (message.role !== "agent" || !message.speak || message.spoken || seen.current.has(message._id)) continue;
      seen.current.add(message._id);
      // Don't replay a backlog when the page is reloaded.
      if (message.createdAt < mountedAt.current - 30_000) continue;
      queue.current.push({ id: message._id, text: message.text });
    }
    setPending(queue.current.length);
    void pump();
  }, [messages, pump]);

  useEffect(() => {
    void pump();
  }, [voice.started, voice.error, pump]);

  const sayLocal = useCallback(
    (text: string) => {
      queue.current.push({ text });
      setPending(queue.current.length);
      void pump();
    },
    [pump],
  );

  const quiet = !active && pending === 0 && !voice.agentSpeaking;

  /** Resolves once everything queued (including messages still arriving) has been said. */
  const untilQuiet = useCallback(async (settleMs = 600) => {
    await new Promise((r) => setTimeout(r, settleMs));
    while (busy.current || queue.current.length) await new Promise((r) => setTimeout(r, 150));
  }, []);

  /** Drops everything not yet said and cuts the tutor off. */
  const hush = useCallback(() => {
    queue.current = [];
    setPending(0);
    voice.stopSpeaking();
  }, [voice]);

  return { current, quiet, sayLocal, untilQuiet, hush };
}
