// npx tsx scripts/test-first-person.ts
import { firstPerson } from "../lib/lesson/voice";

const cases: [string, string][] = [
  ["Chalky's board shows the two waves.", "My board shows the two waves."],
  ["Look at Chalky's drawing here.", "Look at my drawing here."],
  ["Chalky will draw that next.", "I'll draw that next."],
  ["Chalky is going to zoom in.", "I'm going to zoom in."],
  ["Now Chalky can show you the molecule.", "Now I can show you the molecule."],
  ["Chalky's going to slow down.", "I'm going to slow down."],
  ["You can ask Chalky anything.", "You can ask me anything."],
  ["Chalky draws a rope next.", "I draw a rope next."],
  ["Then Chalky goes back to the waves.", "Then I go back to the waves."],
  ["Chalky tries a different angle.", "I try a different angle."],
  ["Hey, I'm Chalky! What do you want to learn today?", "Hey, I'm Chalky! What do you want to learn today?"],
  ["Sunlight is a mix of colors.", "Sunlight is a mix of colors."],
];
let failed = 0;
for (const [input, want] of cases) {
  const { text, rewrites } = firstPerson(input);
  const ok = text === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  "${input}" -> "${text}"${ok ? "" : ` (want "${want}")`}${rewrites.length ? `  [${rewrites.map((r) => `${r.from} => ${r.to}`).join("; ")}]` : ""}`);
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
