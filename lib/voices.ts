/**
 * The voices the learner can pick in Preferences: four Cartesia voices, looked up once by name
 * (GET /voices/?q=<name>, the English entry). Sarah is Chalky's default (CARTESIA_VOICE_ID).
 */
export interface ChalkyVoice {
  id: string;
  name: string;
  tagline: string;
  gender: "feminine" | "masculine";
}

export const VOICES: ChalkyVoice[] = [
  { id: "694f9389-aac1-45b6-b726-9d9369183238", name: "Sarah", tagline: "Mindful Woman", gender: "feminine" },
  { id: "b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1", name: "Clive", tagline: "Measured Expert", gender: "masculine" },
  { id: "a33f7a4c-100f-41cf-a1fd-5822e8fc253f", name: "Lauren", tagline: "Lively Narrator", gender: "feminine" },
  { id: "ef191366-f52f-447a-a398-ed8c0f2943a1", name: "Archie", tagline: "Approachable Mate", gender: "masculine" },
];
export const DEFAULT_VOICE_ID = VOICES[0].id;

/** Speaking speeds: Chalky's usual (no cookie: Sonic's default, 0.92) and three presets. */
export const SPEEDS = [
  { value: "default", speed: 0.92, label: "Chalky's usual · 0.92×" },
  { value: "0.8", speed: 0.8, label: "Relaxed · 0.8×" },
  { value: "1", speed: 1, label: "Normal · 1×" },
  { value: "1.2", speed: 1.2, label: "Brisk · 1.2×" },
] as const;

/** The line a voice sample says: Chalky's greeting. */
export const SAMPLE_LINE = "Hey, I'm Chalky! What do you want to learn today?";
