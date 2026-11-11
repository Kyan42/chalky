// A check-in's bridge never confirms an answer: splitBridge (lib/lesson/bridge.ts) takes a confirming opening
// off it and keeps that sentence as the expected answer.   npx tsx scripts/test-bridge.ts
import { splitBridge } from "@/lib/lesson/bridge";

let failed = 0;
const expect = (input: string, bridge: string | undefined, confirms: string | undefined) => {
  const got = splitBridge(input);
  const ok = got.bridge === bridge && got.confirms === confirms;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
};
// From live plans (2026-11-11): the planner wrote the answer into the bridge.
expect("Yes, cat. Now let's see how the model figures that out.", "Now let's see how the model figures that out.", "Yes, cat.");
expect("Right, it would blur. Next, how those thicknesses get chosen.", "Next, how those thicknesses get chosen.", "Right, it would blur.");
expect("Yes: key for matching, value for content. Let's run numbers.", "Let's run numbers.", "Yes: key for matching, value for content.");
expect("Right. Now to turn scores into shares.", "Now to turn scores into shares.", "Right.");
expect("Yes, cat.", undefined, "Yes, cat.");
// Bridges that only name what comes next stay as they are.
expect("Okay, now let's zoom in on one molecule.", "Okay, now let's zoom in on one molecule.", undefined);
expect("Good, let's put real numbers on it.", "Good, let's put real numbers on it.", undefined);
expect("Great, let's pull it all together.", "Great, let's pull it all together.", undefined);
expect("Now here's the puzzle most people miss.", "Now here's the puzzle most people miss.", undefined);
console.log(failed ? `\n${failed} check(s) failed` : "\nall bridge checks passed");
process.exit(failed ? 1 : 0);
