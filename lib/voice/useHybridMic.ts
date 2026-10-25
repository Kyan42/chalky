"use client";

/**
 * The hybrid microphone: open mic whenever Chalky is silent, a held key to
 * barge in while Chalky is talking.
 *
 * - `speaking` false: the mic streams to Ink-2 with its turn detection; every
 *   utterance comes back through `onUtterance`.
 * - `speaking` true: the mic is muted (Chalky must not hear itself). Holding
 *   `key` (default Space) fires `onBargeIn` at once on key down and opens the
 *   mic; releasing it ends the turn. Presses shorter than `minHoldMs` or with
 *   no words are ignored (`onBargeInCancelled`, so the caller can resume).
 *
 * Ink has no "finalize" message, so after the key is released the mic keeps
 * streaming (silence, now) until Ink ends the turn, for at most `tailMs`;
 * then whatever was heard is emitted. Turns that end within `mergeMs` of
 * each other are joined into one utterance (see turn-merger.ts).
 *
 * Built on the existing stt.ts and audio.ts; useListening.ts is untouched.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { startMicrophone, unlockAudio, type Microphone } from "./audio";
import { InkSession } from "./stt";
import { cartesiaToken } from "./token";
import { TurnMerger } from "./turn-merger";

export type MicMode = "off" | "open" | "muted" | "held" | "tail";

export interface HybridMicOptions {
  /** True while Chalky's voice is playing (plus a short echo tail). */
  speaking: boolean;
  /** Stream echo-cancelled input during playback and interrupt on recognized speech. */
  autoInterrupt?: boolean;
  /** KeyboardEvent.code of the barge-in key. */
  key?: string;
  /** Turns ending within this window merge into one utterance. */
  mergeMs?: number;
  /** A barge-in shorter than this (or without words) is ignored. */
  minHoldMs?: number;
  /** After the key is released, wait this long for Ink to end the turn. */
  tailMs?: number;
  /** The learner pressed the key while Chalky was speaking: stop talking now. */
  onBargeIn?: () => void;
  /** The press was too short or heard nothing: carry on as if it hadn't happened. */
  onBargeInCancelled?: () => void;
  onPartial?: (text: string) => void;
  onUtterance?: (text: string, meta: { via: "open" | "barge"; turns: number; holdMs?: number }) => void;
  onError?: (message: string) => void;
}

export function useHybridMic(options: HybridMicOptions) {
  const opts = useRef(options);
  opts.current = options;
  const key = options.key ?? "Space";
  const mergeMs = options.mergeMs ?? 700;
  const minHoldMs = options.minHoldMs ?? 300;
  const tailMs = options.tailMs ?? 1200;

  const ink = useRef<InkSession | null>(null);
  const mic = useRef<Microphone | null>(null);
  const merger = useRef<TurnMerger | null>(null);
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<MicMode>("off");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Everything the audio callback and key handlers read, kept in refs so they never go stale.
  const speakingRef = useRef(options.speaking);
  speakingRef.current = options.speaking;
  const held = useRef<{ since: number; words: boolean } | null>(null);
  const tail = useRef<{ timer: ReturnType<typeof setTimeout>; holdMs: number } | null>(null);
  const lastPartial = useRef("");

  const modeNow = useCallback((): MicMode => {
    if (!ink.current) return "off";
    if (held.current) return "held";
    if (tail.current) return "tail";
    return speakingRef.current && !opts.current.autoInterrupt ? "muted" : "open";
  }, []);
  const refreshMode = useCallback(() => setMode(modeNow()), [modeNow]);

  /** Whether mic audio goes to Ink right now. */
  const gateOpen = useCallback(() => {
    if (held.current || tail.current) return true;
    return !!opts.current.autoInterrupt || !speakingRef.current;
  }, []);

  const endTail = useCallback(() => {
    if (!tail.current) return;
    clearTimeout(tail.current.timer);
    tail.current = null;
  }, []);

  /** Call from a click: unlocks audio, starts the mic and connects to Ink-2. */
  const start = useCallback(async () => {
    if (ink.current) return;
    try {
      await unlockAudio();
      merger.current = new TurnMerger({ mergeMs }, (text, turns) => {
        const via = tail.current || held.current ? "barge" : "open";
        const holdMs = tail.current?.holdMs;
        endTail();
        setPartial("");
        lastPartial.current = "";
        refreshMode();
        opts.current.onUtterance?.(text, { via, turns, ...(holdMs !== undefined ? { holdMs } : {}) });
      });
      const session = new InkSession(cartesiaToken, {
        onStart: () => merger.current?.turnStart(),
        onUpdate: (t) => {
          if (t.trim() && speakingRef.current && opts.current.autoInterrupt) {
            speakingRef.current = false;
            opts.current.onBargeIn?.();
          }
          lastPartial.current = t;
          if (held.current && t.trim()) held.current.words = true;
          setPartial(t);
          opts.current.onPartial?.(t);
        },
        onEnd: (t) => {
          lastPartial.current = "";
          setPartial("");
          merger.current?.turnEnd(t);
          // The key is up and Ink has ended the turn: no need to wait any longer.
          if (tail.current) merger.current?.flush();
        },
        onError: (message) => {
          setError(message);
          opts.current.onError?.(message);
        },
      });
      ink.current = session;
      await session.connect();
      mic.current = await startMicrophone((pcm) => {
        if (gateOpen()) ink.current?.send(pcm);
      });
      setStarted(true);
      setError(null);
      refreshMode();
    } catch (e) {
      ink.current?.close();
      ink.current = null;
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, [mergeMs, endTail, refreshMode, gateOpen]);

  // Chalky starting to speak closes the open mic; a turn caught half-way is dropped (it was never going to end).
  useEffect(() => {
    if (options.speaking && !options.autoInterrupt && !held.current && !tail.current) {
      merger.current?.discard();
      setPartial("");
      lastPartial.current = "";
    }
    refreshMode();
  }, [options.speaking, options.autoInterrupt, refreshMode]);

  // The barge-in key: down opens the mic and interrupts Chalky; up ends the turn.
  useEffect(() => {
    // Typing into a text field must not barge in; a focused checkbox or button must not swallow the key either.
    const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", "password", "number"]);
    const isTyping = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return false;
      if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
      return el.tagName === "INPUT" && TEXT_INPUTS.has((el as HTMLInputElement).type);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== key || e.repeat || isTyping(e) || !ink.current) return;
      if (!speakingRef.current || held.current) return;
      e.preventDefault();
      endTail();
      merger.current?.discard();
      merger.current?.setHold(true);
      held.current = { since: performance.now(), words: false };
      lastPartial.current = "";
      refreshMode();
      opts.current.onBargeIn?.();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== key || !held.current) return;
      e.preventDefault();
      const h = held.current;
      held.current = null;
      const holdMs = performance.now() - h.since;
      const heard = h.words || !!lastPartial.current.trim() || !!merger.current?.buffered;
      if (holdMs < minHoldMs || !heard) {
        merger.current?.discard();
        merger.current?.setHold(false);
        setPartial("");
        lastPartial.current = "";
        refreshMode();
        opts.current.onBargeInCancelled?.();
        return;
      }
      // Keep streaming (silence) until Ink ends the turn, or give up after tailMs.
      const timer = setTimeout(() => {
        const m = merger.current;
        if (!m) return;
        const partialText = lastPartial.current.trim();
        if (m.active && partialText) {
          // Ink never closed the turn: take its last partial as the utterance.
          const text = [m.buffered, partialText].filter(Boolean).join(" ");
          const turns = m.bufferedTurns + 1;
          m.discard();
          m.setHold(false);
          endTail();
          setPartial("");
          lastPartial.current = "";
          refreshMode();
          opts.current.onUtterance?.(text, { via: "barge", turns, holdMs });
        } else if (m.buffered) m.flush();
        else {
          endTail();
          refreshMode();
          opts.current.onBargeInCancelled?.();
        }
      }, tailMs);
      tail.current = { timer, holdMs };
      // Ink already closed the turn(s): the key release is the end of the utterance.
      if (!merger.current?.active && merger.current?.buffered) merger.current.flush();
      else merger.current?.setHold(false);
      refreshMode();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [key, minHoldMs, tailMs, endTail, refreshMode]);

  useEffect(
    () => () => {
      endTail();
      mic.current?.stop();
      ink.current?.close();
    },
    [endTail],
  );

  const setKeyterms = useCallback((terms: string[]) => ink.current?.setKeyterms(terms), []);
  const level = useCallback(() => (gateOpen() ? (mic.current?.level() ?? 0) : 0), [gateOpen]);

  return { start, started, mode, partial, error, level, setKeyterms };
}
