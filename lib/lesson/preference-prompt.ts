import { cookies } from "next/headers";
import { LANGUAGES, parsePreferences } from "@/lib/preferences";
import { withVoiceRules as baseRules } from "./voice";

export async function withVoiceRules(system: string) {
  // Outside a request (e.g. offline scripts), retain the normal teaching defaults.
  let raw: string | undefined;
  try { raw = (await cookies()).get("chalky-preferences")?.value; } catch {}
  const p = parsePreferences(raw);
  const instructions = [
    `Teach and speak in ${LANGUAGES[p.language]}. Use this language for visible board labels too; preserve JSON keys and API identifiers.`,
    p.visuals === "more" ? "Prefer explanatory diagrams and visual examples for each new idea, while keeping the board legible." : p.visuals === "less" ? "Use fewer drawings: keep only essential diagrams, and explain mainly through conversation." : "Balance clear visuals with spoken explanation.",
    p.approach === "analogies" ? "Use familiar everyday analogies to introduce concepts, then connect them to the actual concept." : p.approach === "explain" ? "Mix examples, explanations and understanding checks." : "Let the learner think first: ask what they expect before you explain, and build on what they say.",
    p.pace === "stepwise" ? "Teach one small step at a time with frequent checks before moving on." : p.pace === "concise" ? "Keep explanations concise and move quickly through familiar basics." : "Use a comfortable teaching pace, adapting to the learner.",
  ];
  return `${baseRules(system)}\n\nLearner preferences (honor explicit requests in the conversation):\n${instructions.join("\n")}`;
}
