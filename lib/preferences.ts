export const LANGUAGES = { en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian", ja: "Japanese", zh: "Chinese", hi: "Hindi", ko: "Korean" } as const;
export type Preferences = { voice: string; language: keyof typeof LANGUAGES; visuals: "balanced" | "more" | "less"; approach: "socratic" | "analogies" | "explain"; pace: "balanced" | "stepwise" | "concise"; draw: "fast" | "slow"; interrupt: "" | "on" | "off" };
export const DEFAULT_PREFERENCES: Preferences = { voice: "", language: "en", visuals: "balanced", approach: "socratic", pace: "balanced", draw: "fast", interrupt: "" };
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
      // "" until they choose: the build's default (voiceInterruptOn).
      interrupt: p.interrupt === "on" || p.interrupt === "off" ? p.interrupt : "",
    };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}

/** The preferences from a cookie string (document.cookie in the browser). */
export function readPreferences(cookie: string): Preferences {
  return parsePreferences(cookie.split("; ").find((p) => p.startsWith("chalky-preferences="))?.split("=")[1]);
}

/** Socratic: each section opens with a question first ("Ask me first", and "Everyday analogies" too); "Just explain" turns it off. */
export const socratic = (p: Preferences) => p.approach !== "explain";

/** Fired on window when Preferences changes the cookie, so a running lesson can follow at once. */
export const PREFERENCES_CHANGED = "chalky-preferences-changed";

/**
 * Voice interrupt (talking over Chalky pauses it): the learner's choice, else on unless the build turns it off
 * (NEXT_PUBLIC_CHALKY_VOICE_BARGE_IN=0). Off: hold Space to cut in, e.g. in a loud hall.
 */
export const voiceInterruptOn = (p: Preferences) => (p.interrupt ? p.interrupt === "on" : process.env.NEXT_PUBLIC_CHALKY_VOICE_BARGE_IN !== "0");
