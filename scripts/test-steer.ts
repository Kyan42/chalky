// What the learner's words mean after Chalky has answered a cut-in (lib/lesson/resume.ts).
//   npx tsx scripts/test-steer.ts
import { acceptsOffer, isResume, offersMore, wantsMore, wantsSlower } from "@/lib/lesson/resume";
import { hearName } from "@/lib/voice/keyterms";

let failed = 0;
const check = (name: string, got: boolean, want: boolean) => {
  if (got !== want) failed++;
  console.log(`${got === want ? "PASS" : "FAIL"}  ${name}`);
};
// Asking to go deeper is a detour, not another one-line answer (from a live run, 2026-11-11).
for (const s of ["Yeah, could you walk me through that?", "Can you explain that a bit more?", "Tell me more about the hidden layer.", "Go deeper on that.", "Can you break that down?"]) check(`wants more: "${s}"`, wantsMore(s), true);
for (const s of ["What does hidden layer mean?", "Uh, yes.", "Okay, keep going.", "Is the red one the longer wave?", "No more questions."]) check(`not asking for more: "${s}"`, wantsMore(s), false);
// Asking for a slower pace, or to stay on one part (from live runs, 2026-11-11: both were only acknowledged).
for (const s of ["Can we actually go slower? I want to go like one thing at a time and spend some time on it. So start with just this part.", "Wait, hold on. Let's go a little slower. Um, start with just what this is.", "Slow down a bit.", "That was too fast.", "Can you take it step by step?"]) check(`wants slower: "${s}"`, wantsSlower(s), true);
for (const s of ["Is the red one the slower wave?", "Why is training so slow?", "What does hidden layer mean?", "Okay, keep going."]) check(`not asking for slower: "${s}"`, wantsSlower(s), false);
for (const s of ["So start with just this part.", "Yeah, maybe explain that separately first.", "Can we dive deeper into this?", "Let's focus on the tokens for a second.", "Can we spend some more time on this?", "Zoom in on that box."]) check(`wants more: "${s}"`, wantsMore(s), true);
// A line that offers more, against one that asks whether to carry on.
check("offer: explore", offersMore("That is the middle column. Would you like to explore that a little more?"), true);
check("offer: want me to", offersMore("Want me to go deeper on that?"), true);
check("offer: draw", offersMore("Should I draw one neuron up close?"), true);
check("not an offer: keep going", offersMore("That is the middle column. Shall I keep going?"), false);
check("not an offer: ready", offersMore("Ready to go on?"), false);
check("not an offer: a check question", offersMore("So which layer do we never see?"), false);
// "Yes" to an offer accepts it; "yes" to "shall I keep going?" carries on; "keep going" always carries on.
check('"Uh, yes." to an offer accepts it', acceptsOffer("Uh, yes.", "Want me to go deeper on that?"), true);
check('"Uh, yes." to "Shall I keep going?" carries on', isResume("Uh, yes.") && !acceptsOffer("Uh, yes.", "Shall I keep going?"), true);
check('"Yeah, keep going." carries on even after an offer', acceptsOffer("Yeah, keep going.", "Want me to go deeper on that?"), false);
// The recogniser's "Chucky" is shown, sent and logged as "Chalky"; real names are left alone.
check("Chucky -> Chalky", hearName("All right, Chucky. can you quiz me on how LLMs work?") === "All right, Chalky. can you quiz me on how LLMs work?", true);
check("Charlie stays", hearName("My friend Charlie asked about this.") === "My friend Charlie asked about this.", true);
console.log(failed ? `\n${failed} check(s) failed` : "\nall steering checks passed");
process.exit(failed ? 1 : 0);
