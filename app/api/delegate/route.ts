/**
 * POST /api/delegate  { request, utterance, question, beats, beatIndex, scene, scenes, history, learner?, image? }
 *   →  { actions, ms, model, call }
 * The slow executor for a request the fast reply handed over (lib/lesson/delegate.ts).
 */
import { delegate, type DelegateInput } from "@/lib/lesson/delegate";
import { cleanLearner } from "@/lib/lesson/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const req = str(body.request, 400).trim();
  if (!req) return Response.json({ error: "request is required" }, { status: 400 });
  const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
  const input: DelegateInput = {
    request: req,
    utterance: str(body.utterance, 1000),
    question: str(body.question, 500),
    beats: arr(body.beats, 40).map((b, i) => {
      const o = (b ?? {}) as Record<string, unknown>;
      return { id: str(o.id, 60) || `b${i + 1}`, say: str(o.say, 600), mode: str(o.mode, 10) || "draw", scene: int(o.scene, 1) };
    }),
    beatIndex: int(body.beatIndex, -1),
    scene: int(body.scene, 1),
    scenes: arr(body.scenes, 20).map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        scene: int(o.scene, 1),
        title: str(o.title, 120),
        elements: arr(o.elements, 80).flatMap((e) => {
          const r = (e ?? {}) as Record<string, unknown>;
          const id = str(r.id, 60).trim();
          const b = (r.box ?? null) as Record<string, unknown> | null;
          const box = b && [b.x, b.y, b.w, b.h].every((v) => typeof v === "number" && Number.isFinite(v)) ? { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number } : undefined;
          return id ? [{ id, kind: str(r.kind, 30) || "element", label: str(r.label, 120), ...(box ? { box } : {}) }] : [];
        }),
      };
    }),
    history: arr(body.history, 12).flatMap((h) => {
      const o = (h ?? {}) as Record<string, unknown>;
      const text = str(o.text, 600);
      return text ? [{ who: o.who === "chalky" ? ("chalky" as const) : ("learner" as const), text }] : [];
    }),
    learner: cleanLearner(body.learner),
    image: typeof body.image === "string" && body.image.length < 1_400_000 && /^[A-Za-z0-9+/=]+$/.test(body.image) ? body.image : undefined,
  };
  try {
    return Response.json(await delegate(input, request.signal));
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error), actions: [] }, { status: 500 });
  }
}
