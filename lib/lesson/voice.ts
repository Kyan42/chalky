/**
 * Chalky speaks as "I". Every speaking prompt carries VOICE_RULES; notes meant
 * for other prompts (which may echo them aloud) follow NOTE_RULES; and
 * firstPerson() is the safety net applied to every string just before it is
 * spoken. Client-safe: no server-only imports.
 */

export const VOICE_RULES =
  'Speak in the first person. Never say your own name or refer to yourself in the third person: say "I", "my" and "me", and say "the board" or "here", never "Chalky\'s board".';

export const NOTE_RULES =
  'Write notes as second-person instructions to whoever teaches next ("draw the two waves side by side", "the learner thinks X; show Y"). Never mention Chalky or refer to the teacher by name.';

/** Appends the voice rules to a speaking prompt. */
export const withVoiceRules = (system: string) => `${system}\n\n${VOICE_RULES}`;

const VERB_TO_FIRST: Record<string, string> = {
  is: "I'm",
  will: "I'll",
  can: "I can",
  has: "I've",
  was: "I was",
  does: "I do",
  would: "I'd",
  could: "I could",
  should: "I should",
  "'ll": "I'll",
  "'s": "I'm",
};

export interface SelfRewrite {
  from: string;
  to: string;
}

/**
 * Turns third-person self-reference into first person: "Chalky's board" to
 * "my board", "Chalky will draw" to "I'll draw", "ask Chalky" to "ask me", a
 * bare "Chalky" subject to "I". "I'm Chalky" (the greeting) is left alone.
 */
export function firstPerson(input: string): { text: string; rewrites: SelfRewrite[] } {
  if (!/chalky/i.test(input)) return { text: input, rewrites: [] };
  const rewrites: SelfRewrite[] = [];
  const keep: string[] = [];
  // Introductions stay as they are.
  let text = input.replace(/\bI(?:['’]m| am) Chalky\b/gi, (m) => {
    keep.push(m);
    return `\u0000${keep.length - 1}\u0000`;
  });
  const startOfSentence = (s: string, offset: number) => /(^|[.!?]\s+)$/.test(s.slice(0, offset));
  const cap = (w: string, s: string, offset: number) => (startOfSentence(s, offset) ? w[0].toUpperCase() + w.slice(1) : w);
  const sub = (re: RegExp, to: (m: string, groups: string[], offset: number, s: string) => string) => {
    text = text.replace(re, (...args) => {
      const m = args[0] as string;
      const offset = args[args.length - 2] as number;
      const s = args[args.length - 1] as string;
      const out = to(m, args.slice(1, -2) as string[], offset, s);
      rewrites.push({ from: m, to: out });
      return out;
    });
  };
  sub(/\bChalky['’]s\s+(board|drawing|picture|hand|cursor|lesson|voice)\b/gi, (_m, [noun], o, s) => `${cap("my", s, o)} ${noun}`);
  sub(/\bChalky\s+(is|will|can|has|was|does|would|could|should)\b/gi, (_m, [verb]) => VERB_TO_FIRST[verb.toLowerCase()]);
  sub(/\bChalky(['’]ll|['’]s)\b/gi, (_m, [suffix]) => VERB_TO_FIRST[suffix.replace("’", "'").toLowerCase()]);
  sub(/\b(to|ask|asks|tell|with|for|from|let|help|show|by|about|at|follow)\s+Chalky\b/gi, (_m, [word]) => `${word} me`);
  // "Chalky draws" -> "I draw", "Chalky goes" -> "I go": a third-person verb loses its -s.
  sub(/\bChalky\s+([a-z]+)\b/g, (_m, [verb]) => {
    if (!verb.endsWith("s") || /(ss|us|is|as)$/.test(verb)) return `I ${verb}`;
    const stem = /(sh|ch|x|z|o)es$/.test(verb) ? verb.slice(0, -2) : /ies$/.test(verb) ? `${verb.slice(0, -3)}y` : verb.slice(0, -1);
    return `I ${stem}`;
  });
  sub(/\bChalky\b/g, () => "I");
  sub(/\bchalky\b/g, () => "I");
  // eslint-disable-next-line no-control-regex
  text = text.replace(/\u0000(\d+)\u0000/g, (_m, k) => keep[Number(k)]);
  return { text, rewrites };
}
