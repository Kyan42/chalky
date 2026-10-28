// Runs once when the Next server starts: begin loading the Moss block index (lib/moss/blocks.ts)
// so the first drawn beat finds it ready instead of falling back to the keyword match.
// The `if` form lets Next drop the import from its edge build (Moss is a native Node addon).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warmBlockIndex } = await import("@/lib/moss/blocks");
    warmBlockIndex();
    // Learned blocks (slow mode's own drawings, lib/blocks/learned.ts), so the first plan and beat list them.
    const { loadLearned } = await import("@/lib/blocks/learned");
    void loadLearned();
    // And sessions made ahead for the first lesson's board and learner memory (lib/moss/session.ts).
    const { warmSessions } = await import("@/lib/moss/session");
    warmSessions();
    // Chalky's fixed lines in the default voice (lib/tts-cache.ts), so Start talking speaks at once.
    const { warmStock } = await import("@/lib/tts-cache");
    void warmStock();
  }
}
