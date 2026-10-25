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

export type MicMode = "off" | "paused" | "open" | "muted" | "held" | "tail" | "voice";

/** Sounds that aren't words: they never count toward a voice barge-in. */
const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "oh", "mm", "mhm", "hmm", "huh", "uh-huh"]);

/** A turn that opens with one of these is a barge-in on that word alone, without waiting for a second. */
const COMMAND_WORD = /^(stop|wait|pause|hold on)\b/i;

/** Real words in a transcript: at least two letters, not a filler. */
export function realWords(text: string): number {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z'-]/g, ""))
    .filter((w) => w.length >= 2 && !FILLERS.has(w)).length;
}

export interface HybridMicOptions {
  /** True while Chalky's voice is playing (plus a short echo tail). */
  speaking: boolean;
  /** The learner stopped Chalky: hear nothing at all, and ignore the barge-in key, until this goes false. */
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
  /**
   * Voice barge-in (experimental, off by default): the mic keeps streaming
   * while Chalky speaks, and a turn that starts then counts as a barge-in once
   * Ink hears two real words in it (fillers don't count). The first such
   * partial fires onBargeIn (pause now); the turn then ends as usual and comes
   * back as an utterance via "barge". A turn that starts while Chalky speaks
   * and never reaches two real words is dropped (onVoiceIgnored): echo, a
   * cough, an "mm". Space keeps working either way.
   */
  voiceBargeIn?: boolean;
  /** A voice barge-in fired, on this partial transcript. */
  onVoiceBargeIn?: (partial: string) => void;
  /** A turn heard while Chalky spoke was dropped: it never reached two real words. */
  onVoiceIgnored?: (text: string) => void;
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
  const pausedRef = useRef(!!options.paused);
  pausedRef.current = !!options.paused;
  const held = useRef<{ since: number; words: boolean } | null>(null);
  const tail = useRef<{ timer: ReturnType<typeof setTimeout>; holdMs: number } | null>(null);
  const lastPartial = useRef("");
  const voiceRef = useRef(!!options.voiceBargeIn);
  voiceRef.current = !!options.voiceBargeIn;
  /** The current Ink turn began while Chalky was speaking (voice mode). */
  const turnWhileSpeaking = useRef(false);
  /** That turn has become a barge-in (two real words heard). */
  const voiceBarged = useRef(false);

  const modeNow = useCallback((): MicMode => {
    if (!ink.current) return "off";
    if (pausedRef.current) return "paused";
    if (held.current) return "held";
    if (tail.current) return "tail";
    if (speakingRef.current) return voiceRef.current ? "voice" : "muted";
    return "open";
  }, []);
  const refreshMode = useCallback(() => setMode(modeNow()), [modeNow]);

  /** Whether mic audio goes to Ink right now. */
  const gateOpen = useCallback(() => {
    if (pausedRef.current) return false;
    if (held.current || tail.current || voiceRef.current) return true;
    return !speakingRef.current;
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
        const via = tail.current || held.current || voiceBarged.current ? "barge" : "open";
        voiceBarged.current = false;
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
          merger.current?.turnStart();
          turnWhileSpeaking.current = voiceRef.current && speakingRef.current && !held.current;
        },
        onUpdate: (t) => {
          lastPartial.current = t;
          if (held.current && t.trim()) held.current.words = true;
          // Voice barge-in: the first partial with two real words while Chalky talks pauses it at once;
          // a turn that opens with "stop", "wait", "pause" or "hold on" counts on that one word (Leo's fast path).
          if (turnWhileSpeaking.current && !voiceBarged.current && (realWords(t) >= 2 || COMMAND_WORD.test(t.trim()))) {
            voiceBarged.current = true;
            opts.current.onVoiceBargeIn?.(t);
            opts.current.onBargeIn?.();
          }
          setPartial(t);
          opts.current.onPartial?.(t);
        },
        onEnd: (t) => {
          lastPartial.current = "";
          setPartial("");
          if (turnWhileSpeaking.current && !voiceBarged.current) {
            // Heard while Chalky spoke, never two real words: not the learner talking to Chalky.
            turnWhileSpeaking.current = false;
            merger.current?.turnEnd("");
            opts.current.onVoiceIgnored?.(t);
            applyKeyterms();
            return;
          }
          turnWhileSpeaking.current = false;
          merger.current?.turnEnd(t);
          applyKeyterms();
          // The key is up and Ink has ended the turn: no need to wait any longer.
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
  }, [mergeMs, endTail, refreshMode, gateOpen]);

  /** Turns the mic off and closes Ink: nothing is heard until start() is called again (a click). */
  const stop = useCallback(() => {
    endTail();
    held.current = null;
    merger.current?.discard();
    merger.current = null;
    mic.current?.stop();
    mic.current = null;
    ink.current?.close();
    ink.current = null;
    turnWhileSpeaking.current = false;
    voiceBarged.current = false;
    lastPartial.current = "";
    setPartial("");
    setStarted(false);
    refreshMode();
  }, [endTail, refreshMode]);

  // Chalky starting to speak closes the open mic; a turn caught half-way is dropped (it was never going to end).
  // With voice barge-in the mic stays open, and a turn in progress is left to finish.
  useEffect(() => {
    if (options.speaking && !held.current && !tail.current && !voiceRef.current) {
      merger.current?.discard();
      setPartial("");
      lastPartial.current = "";
    }
    refreshMode();
  }, [options.speaking, refreshMode]);

  // Paused: drop whatever was half heard, including a held key's turn, so nothing arrives later.
  useEffect(() => {
    if (!options.paused) return refreshMode();
    endTail();
    held.current = null;
    merger.current?.discard();
    merger.current?.setHold(false);
    setPartial("");
    lastPartial.current = "";
    refreshMode();
  }, [options.paused, endTail, refreshMode]);

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
      if (e.code !== key || e.repeat || isTyping(e) || !ink.current || pausedRef.current) return;
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

  return { start, stop, started, mode, partial, error, level, setKeyterms };
}
