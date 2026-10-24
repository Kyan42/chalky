/** A lesson beat: one or two spoken sentences plus visual actions anchored to words. */
export interface BeatAction {
  /** The spoken word the action starts on. */
  at: string;
  /** A primitive name, e.g. `wave.draw`. The planner never writes Clayzo JSON. */
  do: string;
  id: string;
}

export interface Beat {
  id: string;
  say: string;
  actions: BeatAction[];
}

export interface WordTimestamps {
  words: string[];
  start: number[];
  end: number[];
}

export const BEAT_B1: Beat = {
  id: "b1",
  say: "Noise is a wave of air pressure, rising and falling.",
  actions: [{ at: "wave", do: "wave.draw", id: "noise" }],
};

/** Lowercase and strip punctuation, so "Wave," matches "wave". */
export function normalizeWord(word: string): string {
  return word.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * The index of the word an action is anchored to, or -1. Exact match after
 * normalization first, then a prefix match (Sonic may attach punctuation or
 * split differently).
 */
export function resolveAt(at: string, timestamps: WordTimestamps): number {
  const target = normalizeWord(at);
  const words = timestamps.words.map(normalizeWord);
  const exact = words.indexOf(target);
  if (exact >= 0) return exact;
  return words.findIndex((w) => w.startsWith(target) || (w.length > 2 && target.startsWith(w)));
}

/** Index of the word being spoken at `t` (or the last one started), -1 before the first. */
export function wordAt(t: number, timestamps: WordTimestamps): number {
  let index = -1;
  for (let i = 0; i < timestamps.start.length; i++) if (timestamps.start[i] <= t) index = i;
  return index;
}

/** Sonic sends timestamps in several events; append them in order. */
export function mergeTimestamps(into: WordTimestamps, more: WordTimestamps): WordTimestamps {
  return {
    words: [...into.words, ...more.words],
    start: [...into.start, ...more.start],
    end: [...into.end, ...more.end],
  };
}
