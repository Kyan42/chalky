/**
 * The layout refinement: once the whole plan has streamed in, one Sonnet pass
 * re-lays out every beat not drawn yet (from the board-layout experiment, round
 * 2: scenes of at most four drawings, every beat a region and ids), around the
 * first beats, which were drawn straight away from the planner's own layout.
 * The planner's per-beat layout stays as the first guess, so nothing waits.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { trackCall } from "./calllog";
import { cleanId } from "./planner";
import type { CallLog, PlannedBeat, Region } from "./types";

const MODEL = process.env.LAYOUT_MODEL || "claude-sonnet-5-5";
const TIMEOUT_MS = Number(process.env.LAYOUT_TIMEOUT_MS) || 25000;

/** A beat drawn before the layout ran: it keeps its region, and these are the ids actually on the board. */
export interface FixedBeat {
  id: string;
  region: Region;
  ids: string[];
}

/** The layout's answer for one beat; talk beats are left out. */
export interface LaidOutBeat {
  id: string;
  scene: number;
  region: Region;
  adds: { id: string; what: string }[];
  points: { id: string; word: string }[];
}

const REGION = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
  required: ["x", "y", "w", "h"],
  additionalProperties: false,
};

const SCHEMA = {
  type: "object",
  properties: {
    beats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          scene: { type: "number" },
          region: REGION,
          adds: { type: "array", items: { type: "object", properties: { id: { type: "string" }, what: { type: "string" } }, required: ["id", "what"], additionalProperties: false } },
          points: { type: "array", items: { type: "object", properties: { id: { type: "string" }, word: { type: "string" } }, required: ["id", "word"], additionalProperties: false } },
        },
        required: ["id", "scene", "region", "adds", "points"],
        additionalProperties: false,
      },
    },
  },
  required: ["beats"],
  additionalProperties: false,
};

const span = (r: Region) => `x ${r.x}..${r.x + r.w}, y ${r.y}..${r.y + r.h}`;

function prompt(question: string, beats: PlannedBeat[], fixed: FixedBeat[]): string {
  const list = beats
    .filter((b) => b.mode !== "talk")
    .map((b) => `${b.id} (${b.mode}): says "${b.say}"\n   planned visual: ${b.visual}`)
    .join("\n");
  const already = fixed.length
    ? `\n\nAlready drawn, before this layout: keep these in scene 1 with exactly these regions and ids (other scene-1 regions must not overlap them; later scene-1 beats can refer to their ids):\n${fixed.map((f) => `- ${f.id}: region ${span(f.region)}; shapes ${f.ids.join(", ") || "(none)"}`).join("\n")}`
    : "";
  return `You lay out a teacher's whiteboard for a spoken lesson so that every beat's drawing can be made at the same time. The board is a 100x100 grid (x right, y down; 3:2 on screen).

Lesson question: ${question}
Beats that draw or point:
${list}${already}

First split the lesson into scenes. A scene is one picture the teacher builds up and then wipes, like moving to a clean part of the whiteboard. A scene holds at most 4 draw beats (point beats don't count) and should be one coherent picture: start a new scene when the lesson zooms in, moves to a new stage, or switches to an example. Number scenes 1, 2, 3 in order; scene numbers never go down from one beat to the next.

Then, within each scene (the board starts empty for each scene):
- region: where that beat's new drawing goes. Draw beats in the same scene get regions that don't overlap, sized to what they draw: the scene's main picture (its first draw beat) can take about 55 to 65 wide by 60 to 75 tall; additions 25 to 40 each side, next to the part they relate to so arrows between them are short. Use the whole board over a scene; keep 5 units clear at every edge. For a point beat, give the region of what it points at, in its scene.
- adds: the shapes this beat draws (1 to 4), each with a short unique id of letters, digits and dashes (like "sun", "leaf", "co2-arrow") and a few words on what it is. Name shapes, not the arrows or labels between them. Never add something an earlier beat of the scene already draws. Point beats add nothing.
- points: for point beats, 1 to 3 of {id: a shape added earlier IN THE SAME SCENE, word: the one word in this beat's text that names it, copied exactly}. Draw beats point at nothing here.

Return JSON matching the schema.`;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

function cleanRegion(raw: unknown, fallback: Region): Region {
  const r = raw as Partial<Region> | undefined;
  const x = Math.max(0, Math.min(95, num(r?.x, fallback.x))), y = Math.max(0, Math.min(95, num(r?.y, fallback.y)));
  return { x, y, w: Math.max(5, Math.min(100 - x, num(r?.w, fallback.w))), h: Math.max(5, Math.min(100 - y, num(r?.h, fallback.h))) };
}

/** Lays out every visual beat; the fixed ones keep their region and ids, and the rest are checked the way the planner's are. */
export async function layoutLesson(question: string, beats: PlannedBeat[], fixed: FixedBeat[], signal?: AbortSignal): Promise<{ beats: LaidOutBeat[]; ms: number; model: string; call: CallLog }> {
  const t0 = performance.now();
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const tracked = trackCall("layout", MODEL);
  const message = await tracked
    .watch(tracked.client.messages.stream(
      {
        model: MODEL,
        max_tokens: 8000,
        system: "You plan whiteboard layouts. Answer with the requested JSON only.",
        messages: [{ role: "user", content: prompt(question, beats, fixed) }],
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      } as Anthropic.MessageStreamParams,
      { signal: signal ? AbortSignal.any([signal, deadline]) : deadline },
    ))
    .finalMessage();
  if (message.stop_reason !== "end_turn") throw new Error(`layout stopped: ${message.stop_reason}`);
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const raw = (JSON.parse(text) as { beats: Partial<LaidOutBeat>[] }).beats;

  const out: LaidOutBeat[] = [];
  let scene = 1;
  const known = new Map<number, Set<string>>();
  const remember = (s: number, ids: string[]) => {
    if (!known.has(s)) known.set(s, new Set());
    for (const id of ids) known.get(s)!.add(id);
  };
  for (const beat of beats) {
    if (beat.mode === "talk") continue;
    const f = fixed.find((x) => x.id === beat.id);
    if (f) {
      remember(1, f.ids);
      out.push({ id: beat.id, scene: 1, region: f.region, adds: f.ids.map((id) => ({ id, what: beat.adds.find((a) => a.id === id)?.what ?? "" })), points: [] });
      continue;
    }
    const l = raw.find((x) => x.id === beat.id);
    // Scenes only move forward; the model sometimes sends a later beat back to an earlier scene.
    scene = Math.max(scene, Math.round(num(l?.scene, scene)));
    const words = beat.say.split(/\s+/).map(norm);
    const adds =
      beat.mode === "draw"
        ? (Array.isArray(l?.adds) ? l!.adds : beat.adds)
            .map((a) => ({ id: cleanId(a?.id), what: String(a?.what ?? "").trim() }))
            .filter((a) => a.id && !known.get(scene)?.has(a.id))
            .slice(0, 6)
        : [];
    remember(scene, adds.map((a) => a.id));
    const points =
      beat.mode === "point"
        ? (Array.isArray(l?.points) && l!.points.length ? l!.points : beat.points)
            .map((p) => ({ id: cleanId(p?.id), word: String(p?.word ?? "").trim() }))
            .filter((p) => p.id && known.get(scene)?.has(p.id) && p.word && words.includes(norm(p.word)))
            .slice(0, 4)
        : [];
    out.push({ id: beat.id, scene, region: cleanRegion(l?.region, beat.region), adds, points });
  }
  return { beats: out, ms: Math.round(performance.now() - t0), model: MODEL, call: tracked.finish() };
}
