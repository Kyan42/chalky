# Presets

Small whiteboard drawings ("blocks") that a lesson places on the board and chains together to
explain a concept, so the model names `leaf` instead of drawing one stroke by stroke.

- `types.ts` — a block: line art in its own box, grouped into named parts (`nucleus`, `roots`), with
  named anchor points (`surface`, `roots`, `right`) for later steps to aim at.
- `board.ts` — the board you chain steps on. Steps run one after another unless given `at`
  (seconds) or `with: true` (alongside the previous one), plus an optional `delay`.
  - `place(block, { x, y, size })` draws a block stroke by stroke (`enter: "pop"` pops it in)
  - `arrow(from, to, { bend })` draws a marker arrow
  - `travel(block, { from, to, size, count, stay })` sends copies (molecules, drops) between points
  - `highlight(target, { part, at, hold })` draws one chalk loop around a block, one of its parts, or a
    label (`label` returns its box), on cue; `hold` fades it after that many seconds
  - `pulse(ref)`, `move(ref, { x, y, size })`, `remove(ref)`, `label(text, { x, y })`, `wait(s)`
  - `ref.at("anchor")` and `ref.center("part")` give board points to aim at
  - `build(id, name)` returns the Clayzo document
- `themes.ts` — how the board looks. `CHALK` (the default): chalk-textured outlines on white, no
  fills. `CHALKBOARD`: pastel chalk on green slate. `WHITEBOARD`: clean marker lines with pale fills.
  Pick one with `new Board({ theme })`. The chalk grain is a GPU shader, so render on a machine with a GPU.
- `biology/` — sun, cloud, water drop, energy, leaf, plant, tree, cell, mitochondrion, DNA, neuron,
  CO2, O2, H2O, glucose.

Preview (labels need `presets/out/fonts/Manrope.ttf`, the app's font from `public/fonts`):

```bash
npx tsx presets/preview.ts [chalk|whiteboard|chalkboard]   # presets/out/<theme>-gallery.json, -photosynthesis.json, -respiration.json
npx clayzo export presets/out/chalk-photosynthesis.json presets/out/chalk-photosynthesis.mp4 --format mp4
```
