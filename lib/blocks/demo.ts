/**
 * Two demo boards for the blocks gallery (app/experiments/blocks):
 *
 * - every block, five across, drawn a beat after the last (optionally with each part's box and
 *   every anchor overlaid), straight through the renderer;
 * - Janani's photosynthesis script from her presets/preview.ts, re-expressed as scene-language
 *   elements and compiled by the live preset compiler, exactly as a lesson beat would be.
 */
import type { AnimationDocument } from "@clayzo/animation/authoring";
import { Scene } from "@/experiments/visual-flex/doc";
import type { Theme } from "@/lib/board/theme";
import { compilePresetBoard, type LayoutReport, type PresetElement } from "@/lib/lesson/presets";
import { BLOCKS, type Block } from "./index";
import { renderBlock } from "./render";

/** Colours for part boxes in the overlay, in part order. */
export const PART_COLORS = ["red", "blue", "green", "purple", "yellow"];

/**
 * Blocks five across (a topic's worth: up to 20 fit), rows shrinking to fit the board; `overlay`
 * adds part boxes (by colour, in part order) and anchor dots.
 */
export function galleryDoc(overlay: boolean, theme?: Theme, blocks: Block[] = BLOCKS.slice(0, 20)): AnimationDocument {
  const s = new Scene(theme);
  const dy = Math.min(32, 96 / Math.ceil(blocks.length / 5)), size = Math.min(11, dy / 2.4);
  blocks.forEach((block, i) => {
    const cx = 10 + (i % 5) * 20, cy = 2 + dy * (Math.floor(i / 5) + 0.4);
    const at = overlay ? -1 : i * 0.25;
    const r = renderBlock(s, block, { cx, cy, size, at });
    s.text(block.title, (cx / 100) * 1200, ((cy + size * 1.22) / 100) * 800, { at: overlay ? -1 : at + 0.4, size: 20, color: "grey", width: 230 });
    if (!overlay) return;
    block.parts.forEach((p, k) => {
      const b = r.parts[p.id];
      if (!b) return;
      s.stroke([[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]], { at: -1, dur: 0.1, closed: true, width: 1.5, color: PART_COLORS[k % PART_COLORS.length] });
    });
    for (const [x, y] of Object.values(r.anchors)) s.circle(x, y, 3.5, { at: -1, color: "red" });
  });
  return s.build(overlay ? "blocks-gallery-overlay" : "blocks-gallery", "Blocks gallery");
}

const el = (id: string, kind: string, at: number, args: number[], text = "", refs = "", color = "ink", dur = 0.6): PresetElement => ({ id, kind, at, dur, color, args, text, refs });

/**
 * Her photosynthesis script, one beat long: light, water and carbon dioxide go in; sugar and
 * oxygen come out. Times are seconds after the anchor word, laid out like her sequential steps.
 */
export const PHOTOSYNTHESIS: PresetElement[] = [
  el("plant", "block", 0, [50, 60, 33], "plant", "", "ink", 2),
  el("sun", "block", 2.0, [16, 22, 14], "sun"),
  el("light", "label", 2.4, [], "light", "sun", "yellow"),
  el("sunlight", "connect", 2.7, [], "", "sun.bottom-right,plant.leaf", "yellow", 0.8),
  el("water-up", "travel", 3.8, [0, 0, 0, 0, 3.2, 3, 0], "drop", "plant.roots,plant.leaves", "blue"),
  el("water", "label", 3.8, [], "water", "plant.roots", "blue"),
  el("co2-in", "travel", 5.6, [90, 46, 60, 34, 6, 3, 0], "co2", "xy,plant.leaf"),
  el("co2-label", "text", 5.6, [88, 38, 26], "carbon dioxide"),
  el("leaves", "highlight", 7.4, [], "", "plant.leaves", "yellow", 1.8),
  el("glucose", "block", 8.4, [70, 70, 8, 1], "glucose"),
  el("to-glucose", "connect", 8.6, [], "", "plant.leaf,glucose", "ink", 0.5),
  el("glucose-label", "label", 9.0, [], "glucose (food)", "glucose", "yellow"),
  el("o2-out", "travel", 9.6, [60, 34, 82, 14, 5, 3, 1], "o2", "plant.leaf,xy", "red"),
  el("oxygen", "text", 10.8, [82, 25, 26], "oxygen", "", "red"),
];

/** The photosynthesis board as one beat (animating) or as an earlier beat (`finished`). */
export function photosynthesisDoc(finished = false, theme?: Theme): { doc: AnimationDocument; report: LayoutReport } {
  const groups = finished ? [PHOTOSYNTHESIS, []] : [PHOTOSYNTHESIS];
  return compilePresetBoard(groups, groups.length - 1, finished ? "photosynthesis-still" : "photosynthesis", theme);
}
