import type { Bounds, QuestionSpec, VoicedBeat } from "../lib/types";

function beatTable(beats: VoicedBeat[]) {
  return beats
    .map(
      (b) =>
        `Beat ${b.index} (${b.start.toFixed(2)}s to ${(b.start + b.duration).toFixed(2)}s)\n` +
        `  says: "${b.narration}"\n` +
        `  visual idea: ${b.visual}\n` +
        `  words: ${b.words.map((w) => `${w.word}@${w.start.toFixed(2)}`).join(" ")}`,
    )
    .join("\n\n");
}

const WORKFLOW = `How to work:
1. Read KIT.md, then skim ../../kit/kit.ts if you need a detail.
2. Write author.ts in this folder. It must use the kit and end by calling scene.write(...) for every file listed below.
3. Run it: npx tsx author.ts
4. Look at it: npx clayzo render-frame <file>.json sheet.png --samples 8 --max-dimension 480, then Read sheet.png.
   If render-frame says you need to sign in, skip the visual check but still make sure the script runs cleanly.
5. Fix overlaps, empty stretches, off-screen elements, unreadable text, anything that pops in off-beat. One or two passes, then stop.
6. Finish with a one-line summary.`;

export function chapterBrief(o: {
  topic: string;
  level: string;
  outline: { index: number; title: string; objective: string }[];
  chapter: { index: number; title: string; objective: string; question: QuestionSpec };
  beats: VoicedBeat[];
  sources: { title: string; summary: string; excerpt: string }[];
}) {
  return `Build chapter ${o.chapter.index + 1} of a lesson on "${o.topic}" for a ${o.level || "curious"} learner.

Lesson outline:
${o.outline.map((c) => `${c.index + 1}. ${c.title}: ${c.objective}`).join("\n")}

This chapter: "${o.chapter.title}". Goal: ${o.chapter.objective}

The narration is already recorded. timing.json has it; here it is with word timestamps (seconds):

${beatTable(o.beats)}

After the last beat, end on the question card with this prompt (it is read aloud separately):
"${o.chapter.question.prompt}"
Correct answer, for your reference: ${o.chapter.question.correctAnswer}
${o.sources.length ? `\nThe student's reference material (follow its terms and diagrams):\n${o.sources.map((s) => `- ${s.title}: ${s.summary}\n${s.excerpt.slice(0, 3000)}`).join("\n")}\n` : ""}
File to write: chapter.json. createScene({ timingPath: "timing.json" }). Make it genuinely great motion design: a clear visual metaphor or diagram that builds up beat by beat, every key noun appearing on its word, the frame never static for long. Finish with scene.questionCard({ prompt, at: just after the last beat }) and keep the area above the card readable, since the student will draw on it.
The student is waiting to watch this, so get to a good chapter.json quickly; one review pass is enough.

${WORKFLOW}`;
}

/** The pre-built feedback for a chapter's question, built after the chapter so the chapter can play sooner. */
export function chapterFeedbackBrief(o: {
  topic: string;
  question: QuestionSpec;
  correctBeats: VoicedBeat[];
  mistakeBeats: VoicedBeat[];
}) {
  return `Make the two feedback animations for the end-of-chapter question in a lesson on "${o.topic}".
question-frame.json is the chapter's final frame with the question card on screen: "${o.question.prompt}"
Correct answer: ${o.question.correctAnswer}

Files to write:
1. feedback-correct.json: createScene({ timingPath: "timing-correct.json", startFromPath: "question-frame.json" }). A short celebration that reinforces why the answer is right. Narration:
${beatTable(o.correctBeats)}
2. feedback-mistake.json: createScene({ timingPath: "timing-mistake.json", startFromPath: "question-frame.json" }). Shows the common mistake ("${o.question.commonMistake}") and then the correct idea. Narration:
${beatTable(o.mistakeBeats)}
For both, use frozenCamera to dim or zoom the frozen question frame (for example opacity 0.25 at the first beat) so the new explanation reads clearly on top, and don't add a question card. Prefix your node ids with "f-".

${WORKFLOW}`;
}

export function detourBrief(o: {
  topic: string;
  request: string;
  beats: VoicedBeat[];
  focus: Bounds | null;
  output: string;
  purpose: "detour" | "feedback";
}) {
  const focus = o.focus
    ? `The student circled the area around x=${Math.round(o.focus.x)}..${Math.round(o.focus.x + o.focus.width)}, y=${Math.round(o.focus.y)}..${Math.round(o.focus.y + o.focus.height)} (their ink is part of the frozen frame).`
    : "The student did not circle anything.";
  const shape =
    o.purpose === "detour"
      ? `This is a detour: the student paused the lesson to ask about something. Start on the frozen frame, zoom toward what they asked about (frozenCamera on the first beat, scale about 1.6 to 2.2 centred on the focus), then dim it (opacity about 0.2) as your new explanation builds on top. In the last second, remove your new elements (until) and frozenCamera back to { x: 960, y: 540, scale: 1, opacity: 1 } so the final frame is the original paused frame again and the lesson can resume seamlessly.`
      : `This is feedback on the student's answer to a question. Their drawing is part of the frozen frame. Start on it, point at what they drew (highlight), then show why it is right or where it goes wrong and what the correct picture is. Dim the frozen frame (frozenCamera opacity about 0.3) when you draw the correction on top.`;
  return `Make a short ${o.purpose} animation for a lesson on "${o.topic}".

What it should explain: ${o.request}
${focus}

${shape}

createScene({ timingPath: "timing.json", startFromPath: "frozen.json" }) and write ${o.output}.
The narration is already recorded (seconds):

${beatTable(o.beats)}

${WORKFLOW}`;
}
