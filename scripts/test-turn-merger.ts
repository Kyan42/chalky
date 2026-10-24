// Checks the turn merger with a fake clock: npx tsx scripts/test-turn-merger.ts
import { TurnMerger } from "../lib/voice/turn-merger";

let now = 0;
let timers: { at: number; fn: () => void; id: number }[] = [];
let nextId = 1;
const advance = (ms: number) => {
  const until = now + ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    now = due.at;
    timers = timers.filter((t) => t.id !== due.id);
    due.fn();
  }
  now = until;
};
const make = () => {
  const out: [string, number][] = [];
  const m = new TurnMerger(
    { mergeMs: 700, now: () => now, setTimer: (fn, ms) => timers.push({ at: now + ms, fn, id: nextId++ }) && nextId - 1, clearTimer: (id) => (timers = timers.filter((t) => t.id !== id)) },
    (text, turns) => out.push([text, turns]),
  );
  return { m, out };
};
let failed = 0;
const expect = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

{
  // Two turns 400 ms apart merge; a third 2 s later is its own utterance.
  const { m, out } = make();
  m.turnStart();
  advance(1000);
  m.turnEnd("why does blue");
  advance(400);
  m.turnStart();
  advance(600);
  m.turnEnd("scatter more than red?");
  advance(699);
  expect("nothing emitted inside the window", out, []);
  advance(1);
  expect("two close turns merge", out, [["why does blue scatter more than red?", 2]]);
  advance(2000);
  m.turnStart();
  advance(500);
  m.turnEnd("ok got it");
  advance(700);
  expect("a later turn stands alone", out[1], ["ok got it", 1]);
}
{
  // A turn that starts inside the window keeps it open until that turn ends, however long it runs.
  const { m, out } = make();
  m.turnStart();
  m.turnEnd("first part");
  advance(300);
  m.turnStart();
  advance(5000);
  expect("window held open by an active turn", out, []);
  m.turnEnd("second part");
  advance(700);
  expect("merged after the long second turn", out, [["first part second part", 2]]);
}
{
  // Empty turns are ignored; discard drops a turn in progress but not what came before it.
  const { m, out } = make();
  m.turnStart();
  m.turnEnd("   ");
  advance(1000);
  expect("empty turn emits nothing", out, []);
  m.turnStart();
  m.turnEnd("keep this");
  m.turnStart();
  m.discard();
  m.turnEnd("dropped");
  advance(700);
  expect("discard drops only the current turn and the buffer", out, []);
}
{
  // Held: Ink's turn ends don't close the window; the release flushes.
  const { m, out } = make();
  m.setHold(true);
  m.turnStart();
  m.turnEnd("hold on");
  advance(3000);
  expect("held window never closes", out, []);
  m.turnStart();
  m.turnEnd("what was that");
  m.setHold(false);
  expect("release arms the window", out, []);
  advance(700);
  expect("flushes after release", out, [["hold on what was that", 2]]);
  expect("buffer empty afterwards", m.buffered, "");
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall turn-merger checks passed");
process.exit(failed ? 1 : 0);
