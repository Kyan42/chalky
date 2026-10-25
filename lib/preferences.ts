export const LANGUAGES = { en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian", ja: "Japanese", zh: "Chinese", hi: "Hindi", ko: "Korean" } as const;
export type Preferences = { voice: string; language: keyof typeof LANGUAGES; visuals: "balanced" | "more" | "less"; approach: "socratic" | "analogies" | "explain"; pace: "balanced" | "stepwise" | "concise"; draw: "fast" | "slow" };
export const DEFAULT_PREFERENCES: Preferences = { voice: "", language: "en", visuals: "balanced", approach: "socratic", pace: "balanced", draw: "fast" };
export function parsePreferences(raw?: string): Preferences {
  try {
    const p = JSON.parse(decodeURIComponent(raw || ""));
    return {
      voice: typeof p.voice === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.voice) ? p.voice : "",
      language: Object.prototype.hasOwnProperty.call(LANGUAGES, p.language) ? p.language : "en",
      visuals: ["more", "less"].includes(p.visuals) ? p.visuals : "balanced",
      // Ask me first (Socratic) unless they chose otherwise; the older values ("balanced", "practice") mean the default.
      approach: ["analogies", "explain"].includes(p.approach) ? p.approach : "socratic",
      pace: ["stepwise", "concise"].includes(p.pace) ? p.pace : "balanced",
      draw: p.draw === "slow" ? "slow" : "fast",
    };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}

/** The preferences from a cookie string (document.cookie in the browser). */
export function readPreferences(cookie: string): Preferences {
  return parsePreferences(cookie.split("; ").find((p) => p.startsWith("chalky-preferences="))?.split("=")[1]);
}

/** Socratic: each section opens with a question first ("Ask me first", and "Everyday analogies" too); "Just explain" turns it off. */
export const socratic = (p: Preferences) => p.approach !== "explain";
