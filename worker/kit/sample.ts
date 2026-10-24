// Builds a sample chapter with the kit and silent placeholder timing, for checking the kit and
// the app without any API keys:  npx tsx worker/kit/sample.ts
import { mkdirSync } from "node:fs";
import { CANVAS } from "../../lib/types";
import { createScene, type Timing } from "./kit";

const narration = [
  "Picture electricity as water flowing through a pipe. The push is voltage, the flow is current.",
  "A resistor is a narrow section of pipe. It fights the flow, so less current gets through.",
  "Ohm's law ties them together: voltage equals current times resistance.",
  "So if you double the resistance and keep the voltage the same, the current is cut in half.",
];

let clock = 0.4;
const timing: Timing = {
  beats: narration.map((text, index) => {
    const words = text.split(" ");
    const duration = words.length * 0.36;
    const start = clock;
    clock += duration + 0.4;
    return {
      index,
      narration: text,
      visual: "",
      audioUri: `audio/beat-${index}.wav`,
      start,
      duration,
      words: words.map((word, i) => ({ word, start: start + i * 0.36, end: start + (i + 1) * 0.36 })),
    };
  }),
  totalSeconds: clock,
  tailSeconds: 6,
};

const scene = createScene({ timing });
const cx = CANVAS.width / 2;

scene.title("title", { text: "Ohm's law", at: scene.beatStart(0), label: "title", concept: "Ohm's law" });
scene.box("battery", { x: 420, y: 560, width: 220, height: 300, color: "yellow", text: "Voltage", at: scene.wordTick(0, "push"), concept: "voltage, the push" });
scene.arrow("flow", {
  points: [{ x: 560, y: 470 }, { x: 1360, y: 470 }],
  color: "teal",
  width: 12,
  at: scene.wordTick(0, "flow"),
  label: "current arrow",
  concept: "current, the flow",
});
scene.label("flow-label", { text: "current", x: 960, y: 420, color: "teal", at: scene.wordTick(0, "flow") + scene.sec(0.4) });
scene.box("resistor", { x: 960, y: 650, width: 360, height: 120, color: "pink", text: "Resistor", at: scene.wordTick(1, "resistor"), concept: "resistance" });
scene.highlight("resistor-ring", { x: 960, y: 650, radius: 230, at: scene.wordTick(1, "fights"), until: scene.beatEnd(1) });
scene.text("equation", { text: "V = I × R", x: cx, y: 860, size: 96, weight: 800, color: "yellow", at: scene.wordTick(2, "voltage"), until: scene.beatEnd(3) + scene.sec(0.5), concept: "Ohm's law equation" });
scene.label("halve", { text: "2× R → ½ I", x: 1500, y: 650, size: 48, color: "orange", at: scene.wordTick(3, "half"), until: scene.beatEnd(3) + scene.sec(0.5) });
scene.questionCard({ prompt: "Draw what happens to the current arrow if we add a second resistor in series.", at: scene.beatEnd(3) + scene.sec(0.3) });

mkdirSync("public/dev", { recursive: true });
scene.write("public/dev/sample.json", "Sample: Ohm's law");
