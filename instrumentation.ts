// Runs once when the Next server starts: begin loading the retrieval engine (lib/retrieval: the local
// model and block vectors, or the Moss index) so the first drawn beat finds it ready instead of
// falling back to the keyword match.
// The `if` form lets Next drop the import from its edge build (both engines are native Node addons).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warmBlockIndex } = await import("@/lib/retrieval/blocks");
    warmBlockIndex();
    // Learned blocks (slow mode's own drawings, lib/blocks/learned.ts), so the first plan and beat list them.
    const { loadLearned } = await import("@/lib/blocks/learned");
    void loadLearned();
    // The model for the first lesson's board and learner memory, or Moss's spare sessions (lib/retrieval/session.ts).
    const { warmSessions } = await import("@/lib/retrieval/session");
    warmSessions();
    // Chalky's fixed lines in the default voice (lib/tts-cache.ts), so Start talking speaks at once.
    const { warmStock } = await import("@/lib/tts-cache");
    void warmStock();
  }
}
