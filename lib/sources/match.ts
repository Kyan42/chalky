/**
 * Which passage of a source goes with a beat: plain word overlap between the beat's line and each
 * sentence of the page, no model call (free, instant, and works on cached pages for any new plan).
 * Runs in the browser, so the cache holds pages, not per-beat answers, and a re-planned lesson
 * matches against the same pages.
 */
import type { SourceCard } from "./types";

const STOP = new Set(
  "a an and are as at be been but by can did do does for from had has have how i if in into is it its it's just like me more most my no not now of on one or our out so some than that the their them then there these they this those through to too up us very was we were what when where which while who why will with you your yeah okay ok right let's lets here see look thing things kind really also get got going go make makes made".split(" "),
);

/** Lowercased content words, crudely stemmed so "plants" meets "plant" and "breathing" meets "breathe". */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9'-]*/g) ?? [])
    .map((w) => w.replace(/'s$/, ""))
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3).replace(/e$/, "");
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("es") && /(ss|sh|ch|x)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2).replace(/e$/, "");
  return w.replace(/e$/, "");
}

/** Splits at . ! ? followed by a space and a capital, digit or quote; not inside "0.5", "e.g." or "et al.". */
export function sentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?]["')\]]?)(?<!\b(?:e\.g|i\.e|et al|vs|Fig|Eq|Dr|Mr|Ms|St|approx|cf)\.)\s+(?=["'(\[]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface PassageMatch {
  /** Up to three sentences around the best one, from the same paragraph. */
  before: string;
  sentence: string;
  after: string;
  /** Distinct content words shared with the beat (0 means nothing matched; the card shows its excerpt). */
  score: number;
}

/**
 * The best passage of a card for one beat line. `topic` (the question and title) breaks ties and
 * counts a little, so a beat like "Now watch what happens next" still lands on an on-topic sentence.
 */
export function bestPassage(card: SourceCard, line: string, topic = ""): PassageMatch | null {
  const want = new Set(words(line));
  const about = new Set(words(topic));
  if (!want.size && !about.size) return null;
  let best: { p: number; s: number; score: number } | null = null;
  const split = card.paragraphs.map(sentences);
  split.forEach((ss, p) =>
    ss.forEach((s, i) => {
      const got = new Set(words(s));
      if (got.size < 4) return;
      let score = 0;
      for (const w of got) score += want.has(w) ? 1 : about.has(w) ? 0.25 : 0;
      // A long sentence matches more by luck; nudge towards the tighter one.
      score -= got.size / 400;
      if (!best || score > best.score) best = { p, s: i, score };
    }),
  );
  if (!best) return null;
  const { p, s, score } = best as { p: number; s: number; score: number };
  const ss = split[p];
  const shared = new Set(words(ss[s]).filter((w) => want.has(w))).size;
  return {
    before: s > 0 ? ss[s - 1] : "",
    sentence: ss[s],
    after: s + 1 < ss.length ? ss[s + 1] : "",
    score: score > 0 ? shared : 0,
  };
}
