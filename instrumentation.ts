// Runs once when the Next server starts: begin loading the Moss block index (lib/moss/blocks.ts)
// so the first drawn beat finds it ready instead of falling back to the full catalog.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warmBlockIndex } = await import("@/lib/moss/blocks");
  warmBlockIndex();
}
