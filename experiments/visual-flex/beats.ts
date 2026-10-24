/**
 * Eight lesson beats from different subjects. Each has one spoken sentence and
 * the word the visual starts on. The model sees `question`, `say` and `at`.
 */
export interface ExperimentBeat {
  id: string;
  question: string;
  say: string;
  at: string;
}

export const BEATS: ExperimentBeat[] = [
  {
    id: "headphones",
    question: "How do noise-cancelling headphones work?",
    say: "The headphones play an inverted copy of the noise, so the two waves cancel out.",
    at: "inverted",
  },
  {
    id: "photosynthesis",
    question: "What is photosynthesis?",
    say: "Leaves take in sunlight, water, and carbon dioxide, and turn them into sugar and oxygen.",
    at: "sunlight",
  },
  {
    id: "compound-interest",
    question: "Why does compound interest matter?",
    say: "With compound interest, your balance grows faster every year, because interest earns interest.",
    at: "grows",
  },
  {
    id: "binary-search",
    question: "How does binary search work?",
    say: "Binary search halves the list at every step, so a million items take only twenty guesses.",
    at: "halves",
  },
  {
    id: "heart",
    question: "How does blood circulate?",
    say: "The heart pumps blood out to the body, and veins carry it back in a loop.",
    at: "pumps",
  },
  {
    id: "demand",
    question: "What is a demand curve?",
    say: "When prices rise, buyers want less, so the demand curve slopes down.",
    at: "prices",
  },
  {
    id: "seasons",
    question: "Why do we have seasons?",
    say: "Earth is tilted, so for half the year one hemisphere leans toward the sun and gets summer.",
    at: "tilted",
  },
  {
    id: "neural-network",
    question: "What is a neural network?",
    say: "A neural network passes numbers through layers, and each layer weighs its inputs.",
    at: "layers",
  },
];

/** Seconds of speech left after the anchor word, estimated at 2.6 words per second. */
export function estimateVisualSeconds(beat: ExperimentBeat): number {
  const words = beat.say.split(/\s+/);
  const i = words.findIndex((w) => w.toLowerCase().replace(/[^a-z]/g, "") === beat.at);
  return Math.max(1.5, +((words.length - Math.max(0, i)) / 2.6).toFixed(1));
}
