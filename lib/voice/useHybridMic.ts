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
  /** Keep the echo-cancelled microphone open and interrupt on recognized speech. */
  autoInterrupt?: boolean;
  /** Explicit user pause: suspend microphone input. */
  paused?: boolean;
  /** KeyboardEvent.code of the barge-in key. */
  key?: string;
  /** Turns ending within this window merge into one utterance. */
  mergeMs?: number;
  /**
   * Chalky has just asked the learner something (an intake or check-in
   * question): wait this long after a turn ends for more before calling it an
   * utterance, so a pause mid-answer doesn't cut it off. Ink's eager end is
   * never used. Barge-in timing is unaffected.
   */
  patient?: boolean;
  patientMs?: number;
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
  /** Ink-2 key terms for the first connection (at most 100; see lib/voice/keyterms.ts). */
  keyterms?: string[];
}

export function useHybridMic(options: HybridMicOptions) {
  const opts = useRef(options);
  opts.current = options;
  const key = options.key ?? "Space";
  const mergeMs = options.mergeMs ?? 700;
  const patientMs = options.patientMs ?? 1800;
  const windowMs = options.patient ? patientMs : mergeMs;
  const windowRef = useRef(windowMs);
  windowRef.current = windowMs;
  useEffect(() => merger.current?.setWindow(windowMs), [windowMs]);
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
  const voiceInterrupted = useRef(false);
  const candidate = useRef<{ since: number; text: string; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const clearCandidate = useCallback(() => {
    if (candidate.current?.timer) clearTimeout(candidate.current.timer);
    candidate.current = null;
  }, []);
  const publishPartial = useCallback((text: string) => {
    lastPartial.current = text;
    if (held.current && text.trim()) held.current.words = true;
    const combined = [merger.current?.buffered, text.trim()].filter(Boolean).join(" ");
    setPartial(combined);
    if (combined) opts.current.onPartial?.(combined);
  }, []);
  // Speech detection alone can be a cough or a chair scrape. Require words,
  // then a short confirmation window before taking the floor from Chalky.
  const confirmCandidate = useCallback((ended = false) => {
    const c = candidate.current;
    if (!c || opts.current.paused) return false;
    const words = c.text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
    const meaningful = words.filter(w => !["um", "uh", "hmm", "hm", "ah", "oh"].includes(w));
    if (!meaningful.length) return false;
    const command = /^(stop|wait|pause|hold on)\b/i.test(c.text.trim());
    const delay = command ? 120 : meaningful.length >= 2 ? 350 : 550;
    const remaining = delay - (performance.now() - c.since);
    if (remaining > 0) {
      if (!ended) {
        if (c.timer) clearTimeout(c.timer);
        c.timer = setTimeout(() => confirmCandidate(), remaining);
      }
      return false;
    }
    const text = c.text;
    clearCandidate();
    voiceInterrupted.current = true;
    merger.current?.turnStart();
    opts.current.onBargeIn?.();
    publishPartial(text);
    return true;
  }, [clearCandidate, publishPartial]);

  const modeNow = useCallback((): MicMode => {
    if (!ink.current) return "off";
    if (opts.current.paused) return "muted";
    if (held.current) return "held";
    if (tail.current) return "tail";
    return speakingRef.current && !opts.current.autoInterrupt ? "muted" : "open";
  }, []);
  const refreshMode = useCallback(() => setMode(modeNow()), [modeNow]);

  /** Whether mic audio goes to Ink right now. */
  const gateOpen = useCallback(() => {
    if (opts.current.paused) return false;
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
      merger.current = new TurnMerger({ mergeMs: windowRef.current }, (text, turns) => {
        if (opts.current.paused) return;
        const via = tail.current || held.current ? "barge" : "open";
        const holdMs = tail.current?.holdMs;
        endTail();
        setPartial("");
        lastPartial.current = "";
        refreshMode();
        opts.current.onUtterance?.(text, { via, turns, ...(holdMs !== undefined ? { holdMs } : {}) });
        applyKeyterms();
      });
      const session = new InkSession(cartesiaToken, {
        onStart: () => {
          if (opts.current.paused) return;
          clearCandidate();
          if (opts.current.autoInterrupt && speakingRef.current && !held.current && !voiceInterrupted.current) {
            candidate.current = { since: performance.now(), text: "" };
          }
          // Start the merger only when words arrive: noise must not extend
          // an existing learner turn indefinitely.
        },
        onUpdate: (t) => {
          if (opts.current.paused) return;
          if (!candidate.current && opts.current.autoInterrupt && speakingRef.current && !held.current && !voiceInterrupted.current) {
            candidate.current = { since: performance.now(), text: "" };
          }
          if (candidate.current) {
            candidate.current.text = t;
            confirmCandidate();
            return;
          }
          if (t.trim()) merger.current?.turnStart();
          publishPartial(t);
        },
        onEnd: (t) => {
          if (opts.current.paused) return;
          if (candidate.current) {
            candidate.current.text = t;
            const accepted = confirmCandidate(true);
            clearCandidate();
            if (!accepted) return;
          }
          lastPartial.current = "";
          merger.current?.turnEnd(t);
          const combined = merger.current?.buffered ?? t;
          setPartial(combined);
          if (combined.trim()) opts.current.onPartial?.(combined);
          applyKeyterms();
          if (tail.current) merger.current?.flush();
        },
        onError: (message) => {
          setError(message);
          opts.current.onError?.(message);
        },
      }, opts.current.keyterms ?? []);
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
  }, [mergeMs, endTail, refreshMode, gateOpen, clearCandidate, confirmCandidate, publishPartial]);

  // Chalky starting to speak closes the open mic; a turn caught half-way is dropped (it was never going to end).
  useEffect(() => {
    if (options.speaking && !options.autoInterrupt && !held.current && !tail.current) {
      merger.current?.discard();
      setPartial("");
      lastPartial.current = "";
    }
    if (options.paused) { clearCandidate(); merger.current?.discard(); setPartial(""); lastPartial.current = ""; }
    if (!options.speaking) voiceInterrupted.current = false;
    refreshMode();
  }, [options.speaking, options.autoInterrupt, options.paused, refreshMode, clearCandidate]);

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
      clearCandidate();
      mic.current?.stop();
      ink.current?.close();
    },
    [endTail, clearCandidate],
  );

  /**
   * Changing key terms reconnects Ink's socket, which would drop a turn in
   * progress: a change asked for mid-turn (or while a turn may still merge, or
   * the barge-in key is down) waits until the utterance is complete.
   */
  const pendingTerms = useRef<string[] | null>(null);
  const applyKeyterms = useCallback(() => {
    const terms = pendingTerms.current;
    if (!terms || !ink.current) return;
    if (merger.current?.active || merger.current?.buffered || held.current || tail.current || lastPartial.current.trim()) return;
    pendingTerms.current = null;
    ink.current.setKeyterms(terms);
  }, []);
  const setKeyterms = useCallback(
    (terms: string[]) => {
      pendingTerms.current = terms;
      applyKeyterms();
    },
    [applyKeyterms],
  );
  const level = useCallback(() => (gateOpen() ? (mic.current?.level() ?? 0) : 0), [gateOpen]);

  return { start, started, mode, partial, error, level, setKeyterms };
}
