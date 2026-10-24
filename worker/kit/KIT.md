# Chalky animation kit

Author every animation with `../../kit/kit.ts` (from inside a job folder). It wraps
`@clayzo/animation/authoring`, so you can drop down to raw Clayzo nodes with `scene.add(...)`
whenever the helpers are not enough; the clayzo-animation-authoring skill covers those.

```ts
import { createScene, COLORS, EASE, color } from "../../kit/kit";
import { pen, arcVertices, circleContour, rectContour, parseSvgPath } from "@clayzo/animation/authoring";

const scene = createScene({ timingPath: "timing.json" });          // fresh scene on the dark grid
// or: createScene({ timingPath: "timing.json", startFromPath: "frozen.json" })  // start on a frozen frame

scene.title("title", { text: "Ohm's law", at: scene.beatStart(0) });
scene.box("battery", { x: 420, y: 560, width: 220, height: 300, color: "yellow", text: "Voltage", at: scene.wordTick(0, "voltage") });
scene.arrow("flow", { points: [{ x: 560, y: 470 }, { x: 1360, y: 470 }], color: "teal", at: scene.wordTick(0, "flow") });
scene.questionCard({ prompt: "…", at: scene.beatEnd(scene.timing.beats.length - 1) + scene.sec(0.3) });
scene.write("chapter.json");   // validates, stamps, writes chapter.json + chapter.manifest.json
```

## Canvas and time

- 1920×1080, origin top-left, y down. Keep content inside an 80 px margin.
- Ticks: 240 per second, 30 fps (8 ticks per frame). Never hand-write tick numbers; use
  `scene.sec(s)`, `scene.beatStart(i)`, `scene.beatEnd(i)`, `scene.wordTick(i, "word")`.
- `timing.json` holds each narration beat's audio and word timestamps. The kit adds the narration
  audio nodes for you. `scene.end` is the document's last tick.

With `startFromPath`, the frozen frame's node ids are already taken (they often include `title`,
`bg` and so on), so give your new nodes a prefix such as `d-`.

## Helpers (all return the node id and record the element in the manifest)

Every helper takes `at` (tick it appears) and optional `until` (tick it fades away), plus optional
`label` / `concept` naming what it is for the tutor ("resistor R1" / "resistance").

| Helper | What it draws |
| - | - |
| `title(id, { text })` | Big headline, top centre |
| `text(id, { text, x, y, size?, weight?, color?, width?, align? })` | Text centred on x,y (or left/right aligned), wraps at `width` |
| `label(id, { text, x, y, color?, size? })` | Small label |
| `box(id, { x, y, width, height, color?, outline?, text?, moves? })` | Rounded card that springs in; `moves: [{ at, x, y }]` glides it |
| `circle(id, { x, y, radius, color?, outline?, text?, moves? })` | Circle or ring that springs in |
| `arrow(id, { points, color?, width?, head?, dashed?, duration? })` | Polyline that draws on, with an arrowhead |
| `highlight(id, { x, y, radius, color? })` | Ring that draws around something to point at it |
| `drawPath(id, { contours, bounds, color?, width?, filled? })` | Any line art (use `pen`, `arcVertices`, `parseSvgPath`), draws on |
| `questionCard({ prompt, at })` | End-of-chapter question card along the bottom; sets the pause point |
| `frozenCamera({ at, x, y, scale, opacity? })` | Only with `startFromPath`: glide the frozen scene so point x,y is centred at `scale` |

Low level: `scene.add(node)`, `scene.track(nodeId, label, concept, bounds, firstTick, lastTick?)`,
`scene.popScale(id, tick)`, `scene.fade(id, inAt, outAt?)`, `scene.path(id, from, moves)`.

Colours: `background ink muted blue teal green yellow orange pink purple red panel` (`COLORS`).
Easing: `EASE.out`, `EASE.inOut`, `EASE.in`, springs `EASE.pop`, `EASE.soft`.

## Style rules

- Dark navy board, bright saturated shapes. One accent colour per idea; reuse it every time that
  idea appears (if current is teal, it is teal everywhere).
- Show, don't write: diagrams, motion and transformation first. Labels ≤ 6 words; at most one
  sentence of on-screen text at a time.
- Sync to the voice: the thing being named appears or reacts on its word (`wordTick`).
- Something should move or change at least every 2–3 seconds; nothing should pop in silently.
- Clear old content when the idea changes (`until`), or glide it aside, so the frame never gets cluttered.
- Leave the bottom 260 px free during the question card; the student draws above it.
- Call `scene.track` for any custom node a student might circle and ask about.
