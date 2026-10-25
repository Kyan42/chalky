/**
 * POST /api/quiz  { kind: "label", question, items: [{ n, id, answer }], answer, inkMarks? }
 *              |  { kind: "sketch", question, ask, rubric: string[], image?, inkMarks?, board?, answer? }
 *              |  { kind: "predict", question, ask, answer, after: [{ say, section?, quiz? }] }  (rubric: the next section, cut here)
 *   →  QuizGrade (lib/lesson/quiz.ts)
 */
import { gradeLabel, gradePredict, gradeSketch, predictRubric } from "@/lib/lesson/quiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n).map((x) => x.slice(0, max)) : []);

export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (b.kind === "label") {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 6).flatMap((x, k) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const answer = str(o.answer, 80).trim();
        return answer ? [{ n: typeof o.n === "number" ? o.n : k + 1, id: str(o.id, 60), answer }] : [];
      });
      if (!items.length) return Response.json({ error: "items are required" }, { status: 400 });
      return Response.json(await gradeLabel({ question: str(b.question, 300), items, answer: str(b.answer, 600), inkMarks: strs(b.inkMarks, 8, 120) }, request.signal));
    }
    if (b.kind === "sketch") {
      const image = typeof b.image === "string" && b.image.length < 1_400_000 && /^[A-Za-z0-9+/=]+$/.test(b.image) ? b.image : undefined;
      return Response.json(await gradeSketch({ question: str(b.question, 300), ask: str(b.ask, 300), rubric: strs(b.rubric, 8, 400), image, inkMarks: strs(b.inkMarks, 8, 120), board: strs(b.board, 40, 60), answer: str(b.answer, 400) }, request.signal));
    }
    if (b.kind === "predict") {
      const after = (Array.isArray(b.after) ? b.after : []).slice(0, 12).flatMap((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const say = str(o.say, 400);
        return say ? [{ say, ...(typeof o.section === "string" ? { section: o.section } : {}), ...(typeof o.quiz === "string" ? { quiz: o.quiz } : {}) }] : [];
      });
      const rubric = predictRubric(after);
      if (!rubric.length) return Response.json({ error: "no next section to grade against" }, { status: 400 });
      return Response.json({ ...(await gradePredict({ question: str(b.question, 300), ask: str(b.ask, 300), answer: str(b.answer, 600), rubric, socratic: b.socratic === true }, request.signal)), rubric });
    }
    return Response.json({ error: "kind must be label, sketch or predict" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 500 });
  }
}
