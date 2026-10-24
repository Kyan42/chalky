# Board layout experiment: what makes the whiteboard look good?

**Answer:** plan the layout first, then draw every beat in parallel with self-laying-out presets, on **one fresh board per scene** (at most four drawings). That was the only setup that produced boards that read cleanly. All of a lesson's visuals were ready in **9–15 s**, against **31–52 s** drawing beat after beat. Sonnet 5.5 and Opus 5.5 drawers looked about the same, and Haiku 5.5 was a little rougher.

Judged by looking at the rendered boards (October 24, 2026). One plan per question was reused by every variant: photosynthesis, sewage systems, heat pumps. Images are in [`images/`](images/).

## What was compared

| Variant | How visuals are made | Visuals ready |
| --- | --- | --- |
| A. Today | Old scene language (raw coordinates); each beat sees the real board; Haiku | 47–52 s (sequential) |
| B. Presets, sequential | New presets (labels, arrows and layouts placed by the compiler); each beat sees the real board; Sonnet | 31–36 s |
| C / D / E. Layout + parallel | One layout pass gives each beat a region and the element ids it creates, then all beats draw at once; Sonnet / Haiku / Opus | 10–14 s |
| F / G / H. Scenes + parallel | Like C–E, but the layout pass also splits the lesson into scenes (fresh board, ≤4 drawings each), and each drawing is scaled into its region; Sonnet / Opus / Haiku | 9–15 s |

The layout pass itself takes 6.6–7.9 s (Sonnet).

## What the boards showed

- **Round 1 ([images](images/round1-what-is-photosynthesis.jpg)).** Every variant was cluttered by the end of the lesson, Opus included. One 100×100 board can't hold 8–10 drawings, and dim veils left whole areas washed out. Layout + parallel (C–E) was the most organised of the four mid-lesson. Sequential presets (B) still piled things up. Haiku in parallel (D) sometimes drew a shape far past its region (a green circle over half the board).
- **Round 2 ([photosynthesis](images/round2-what-is-photosynthesis.jpg), [sewage](images/round2-how-do-sewage-systems-work.jpg), [heat pump](images/round2-how-does-a-heat-pump-work.jpg)).** Scenes fixed the crowding, and every scene reads as one picture:
  - **Heat pump:** loop, compressor, expansion valve, then the 1 + 2 = 3 bars.
  - **Photosynthesis:** sun and plant, then the chloroplast, then glucose uses and the equation.
  - **Sewage:** house to plant, then the treatment flow.

  The compiler kept labels off each other. Fitting each drawing into its region stopped Haiku's oversized shapes.

## Still rough
- Dim veils fade too strongly in a finished scene (sewage scene 2, photosynthesis scene 2). They should be lighter, or wear off.
- Free lines can still run through labels or boxes (sewage "gentle slope"). Arrows are only snapped when they use `connect`.
- Detail packed inside one big shape (the chloroplast) is still busy. A zoom-in scene would read better.
- The layout pass once put a later beat back into scene 1 (photosynthesis b8), out of order. Scene numbers need to be enforced as non-decreasing.
- Highlights are momentary, so these still images don't show them.

## What it means for the live app
- Use **scenes + layout + parallel presets** for every beat after the first. Use **Sonnet** drawers: Opus wasn't visibly better, and Haiku was rougher.
- The layout pass needs the whole plan (about 10 s), then about 7 s itself, so the first beat can't wait for it. Draw beat 1 straight away with Haiku in a default "main picture" region of scene 1, and lay out the rest while it plays.

## Reproduce
```bash
npm run dev
npx tsx experiments/board-layout/run.ts            # round 1: A–E
npx tsx experiments/board-layout/run.ts round2     # round 2: F–H (reuses the cached plans)
```
Boards render at `/experiments/board-view?src=<question-slug>/<file>.json`; the files are in `public/experiments/board-compare/` (not committed).
