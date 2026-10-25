/**
 * What goes out to the web lookup. The learner's own words when, once greetings, fillers and "could you
 * check" are stripped, they are already a short question (that keeps the contract's "the question as
 * asked", and the cache, which is keyed on it); otherwise the conversation model's search query, then the
 * lesson's question. "Hey Chalky, I'm learning, I'm doing some research on uh VLAs, vision language action
 * models. Could you check l…" never goes to Google as is.
 */

const LEAD = /^(?:(?:hey|hi|hello|ok(?:ay)?|so|um+|uh+|er+|wait|hold on|hang on|sorry|actually|well|chalky)\b[,.!?]?\s*)+/i;
const ASK = /^(?:(?:could|can|would|will) you (?:please )?(?:check|look up|look into|find(?: out)?|search(?: for)?|tell me|see)\b\s*(?:on |about |for |if |whether )?|please (?:check|look up|find)\b\s*|i(?:'m| am) (?:curious|wondering) (?:about |whether |if )?)/i;
const FILLER = /\b(?:um+|uh+|er+)\b[,.]?\s*|\blike,\s*/gi;
/** Talk about the learner, not the question: the text is not a search yet. */
const ABOUT_ME = /\b(i'?m (?:learning|doing|studying|working|trying)|i am (?:learning|doing|studying)|research on|chalky)\b/i;

/** The text without greetings, fillers and a leading "could you check". */
export function cleanQuestion(text: string): string {
  let t = text.replace(FILLER, "").replace(/\s{2,}/g, " ").trim();
  for (let k = 0; k < 3; k++) t = t.replace(LEAD, "").replace(ASK, "").replace(/^[,.;:!?\s]+/, "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/** One short sentence that is a question about something, not talk about the learner. */
export function searchShaped(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  return !!text && sentences.length <= 1 && text.split(/\s+/).length <= 14 && !ABOUT_ME.test(text) && !text.endsWith("…");
}

/** The lookup's question: the learner's words if search-shaped, else the model's query, else the lesson's question. */
export function researchQuery(heard: string, modelQuery?: string | null, lessonQuestion?: string | null): string {
  const own = cleanQuestion(heard);
  if (searchShaped(own)) return own;
  for (const q of [modelQuery, lessonQuestion]) {
    const c = q ? cleanQuestion(q) : "";
    if (c) return c.slice(0, 200);
  }
  return (own || heard).slice(0, 200);
}
