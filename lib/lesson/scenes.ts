/**
 * The scene board, server side (from the board-layout experiment, round 2):
 * a layout pass splits the lesson into scenes of at most four drawings and
 * gives every beat a region and the element ids it creates; then each beat is
 * drawn independently, so they can all be drawn at once. The browser compiles
 * the elements into Clayzo documents (lib/lesson/presets.ts).
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import {
  parallelPrompt, PRESET_SCHEMA, SCENE_LAYOUT_SCHEMA, sceneLayoutPrompt, SYSTEM,
  type FixedBeat, type LayoutBeat,
} from "@/experiments/board-layout/prompts";
import { anthropic } from "./anthropic";
import { fitToRegion, type PresetElement } from "./presets";
import type { PlannedBeat } from "./types";

export type { FixedBeat, LayoutBeat };

const LAYOUT_MODEL = "claude-sonnet-5-5";
const TIMEOUT_MS = 40_000;

async function structured<T>(model: string, system: string, user: string, schema: object, signal?: AbortSignal): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const message = await anthropic()
    .messages.stream(
      {
        model, max_tokens: 8000, system, messages: [{ role: "user", content: user }], thinking: { type: "adaptive" },
        output_config: { effort: "low", format: { type: "json_schema", schema } },
      } as Anthropic.MessageStreamParams,
      { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS) },
    )
    .finalMessage();
  if (message.stop_reason !== "end_turn") throw new Error(`stopped: ${message.stop_reason}`);
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return { value: JSON.parse(text) as T, ms: Math.round(performance.now() - t0) };
}

/** Splits the lesson into scenes and gives every visual beat a region and element ids. */
export async function layoutLesson(question: string, beats: PlannedBeat[], fixed: FixedBeat[], signal?: AbortSignal) {
  const r = await structured<{ beats: LayoutBeat[] }>(LAYOUT_MODEL, "You plan whiteboard layouts. Answer with the requested JSON only.", sceneLayoutPrompt(question, beats, fixed), SCENE_LAYOUT_SCHEMA, signal);
  const visual = beats.filter((b) => b.mode !== "talk");
  let scene = 1;
  const plan = visual.map((b): LayoutBeat => {
    const f = fixed.find((x) => x.id === b.id);
    const l = r.value.beats.find((x) => x.id === b.id);
    if (f) return { id: b.id, scene: 1, region: f.region, introduces: f.ids.map((id) => ({ id, what: "" })), refs: [] };
    // Scenes only move forward; the model sometimes sends a later beat back to an earlier scene.
    scene = Math.max(scene, Math.round(l?.scene ?? scene));
    return { id: b.id, scene, region: l?.region ?? { x: 5, y: 5, w: 90, h: 90 }, introduces: l?.introduces ?? [], refs: l?.refs ?? [] };
  });
  return { plan, ms: r.ms };
}

/** Draws one beat inside its region, from the plan alone (not the drawn board). */
export async function drawBeat(question: string, beat: PlannedBeat, plan: LayoutBeat, earlier: LayoutBeat[], model: string, signal?: AbortSignal) {
  const r = await structured<{ elements: PresetElement[] }>(model, SYSTEM, parallelPrompt(question, beat, plan, earlier), PRESET_SCHEMA, signal);
  const elements = beat.mode === "point" ? r.value.elements.filter((e) => e.kind === "highlight" || e.kind === "dim") : fitToRegion(r.value.elements, plan.region);
  return { elements, ms: r.ms };
}
