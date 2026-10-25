export const LANGUAGES = { en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian", ja: "Japanese", zh: "Chinese", hi: "Hindi", ko: "Korean" } as const;
export type Preferences = { voice: string; language: keyof typeof LANGUAGES; visuals: "balanced" | "more" | "less"; approach: "balanced" | "analogies" | "practice"; pace: "balanced" | "stepwise" | "concise" };
export const DEFAULT_PREFERENCES: Preferences = { voice: "", language: "en", visuals: "balanced", approach: "balanced", pace: "balanced" };
export function parsePreferences(raw?: string): Preferences {
  try {
    const p = JSON.parse(decodeURIComponent(raw || ""));
    return {
      voice: typeof p.voice === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.voice) ? p.voice : "",
      language: Object.prototype.hasOwnProperty.call(LANGUAGES, p.language) ? p.language : "en",
      visuals: ["more", "less"].includes(p.visuals) ? p.visuals : "balanced",
      approach: ["analogies", "practice"].includes(p.approach) ? p.approach : "balanced",
      pace: ["stepwise", "concise"].includes(p.pace) ? p.pace : "balanced",
    };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}
