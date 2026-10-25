/**
 * The scene rules a plan change must keep, enforced on its beats as they stream in: the same rules the
 * layout pass (lib/lesson/layout.ts) gives the first plan. A scene holds at most four drawings, the
 * drawings in a scene don't overlap, and nothing already on a scene's board is drawn there again.
 *
 * The first plan's layout pass is a model call over the whole lesson; a change can't wait for one (the
 * page draws each changed beat as soon as it arrives, and the change itself already takes 7-17 s), so
 * a change gets these rules applied here, beat by beat, with no model:
 *   - an add whose id or label is already in the scene is dropped (the beat refers to it instead; a draw
 *     beat left with nothing new becomes a point beat at it, or talk);
 *   - a fifth drawing in a scene, or one with no free space left there, opens the next scene (fresh
 *     space on the one board: the page glides the camera there);
 *   - a drawing whose region overlaps one already in its scene is moved to the nearest free spot of
 *     about the same size.
 * No "server-only": scripts/test-amend-scenes.ts runs it under tsx.
 */
import type { PlannedBeat, Region } from "./types";

export const MAX_DRAWS_PER_SCENE = 4;

/** What one scene holds once a change is in: for the transcript. */
export interface SceneTally {
  scene: number;
  /** Draw beats kept from before the change, and added by it. */
  kept: number;
  draws: number;
  points: number;
  /** Sketches answers drew there (they count as drawings too). */
  sketches: number;
}

export interface SceneReport {
  scenes: SceneTally[];
  /** Adds dropped because the scene already had them (now referred to by id). */
  deduped: string[];
  /** Drawings moved to a free spot in their scene. */
  replaced: number;
  /** Drawings moved on to a new scene (the scene was full). */
  movedOn: number;
  notes: string[];
}

const area = (r: Region) => Math.max(0, r.w) * Math.max(0, r.h);
function overlap(a: Region, b: Region): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
/** Two drawings collide when they share more than a sliver (1 grid unit squared). */
export const collides = (a: Region, b: Region) => overlap(a, b) > 1;

/** The free spot (5-unit margin at the edges, 2 between drawings) nearest `want`, as big as fits, or null. */
export function freeSpot(taken: Region[], want: Region): Region | null {
  const cx = want.x + want.w / 2, cy = want.y + want.h / 2;
  const sizes: [number, number][] = [
    [want.w, want.h],
    [want.w * 0.8, want.h * 0.8],
    [40, 40],
    [32, 32],
    [26, 26],
  ];
  for (const [w0, h0] of sizes) {
    const w = Math.min(90, Math.max(12, w0)), h = Math.min(90, Math.max(12, h0));
    let best: { r: Region; d: number } | null = null;
    for (let x = 5; x + w <= 95.01; x += 2.5)
      for (let y = 5; y + h <= 95.01; y += 2.5) {
        const r = { x, y, w, h };
        if (taken.some((t) => overlap({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 }, t) > 0)) continue;
        const d = Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
        if (!best || d < best.d) best = { r, d };
      }
    if (best) return best.r;
  }
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => s.split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""));

export class SceneGuard {
  /** Per scene: the drawings' regions, how many drawings came from before the change, and its elements. */
  private drawn = new Map<number, Region[]>();
  private keptCount = new Map<number, number>();
  private points = new Map<number, number>();
  private sketchCount = new Map<number, number>();
  private elements = new Map<number, Map<string, { id: string; region: Region }>>();
  private report: SceneReport = { scenes: [], deduped: [], replaced: 0, movedOn: 0, notes: [] };

  /** `kept`: the beats before the change that stay (their drawings are on the board, or will be); `sketches`: answers' sketches. */
  constructor(kept: PlannedBeat[], sketches: PlannedBeat[] = []) {
    for (const b of kept) {
      if (b.mode !== "draw") continue;
      this.record(b.scene, b.region, b.adds);
      this.keptCount.set(b.scene, (this.keptCount.get(b.scene) ?? 0) + 1);
    }
    for (const b of sketches) {
      this.record(b.scene, b.region, b.adds);
      this.sketchCount.set(b.scene, (this.sketchCount.get(b.scene) ?? 0) + 1);
    }
  }

  private record(scene: number, region: Region, adds: PlannedBeat["adds"]) {
    if (!this.drawn.has(scene)) this.drawn.set(scene, []);
    this.drawn.get(scene)!.push(region);
    if (!this.elements.has(scene)) this.elements.set(scene, new Map());
    const els = this.elements.get(scene)!;
    for (const a of adds) {
      els.set(norm(a.id), { id: a.id, region });
      if (a.what && norm(a.what).length > 2) els.set(norm(a.what), { id: a.id, region });
    }
  }

  /** What `scene` already holds: ids with what they are, for the change's prompt. */
  holdings(scene: number): string[] {
    const seen = new Set<string>();
    return [...(this.elements.get(scene)?.values() ?? [])].flatMap((e) => (seen.has(e.id) ? [] : (seen.add(e.id), [e.id])));
  }

  /**
   * Applies the rules to one changed beat (already checked by the planner's checkBeat). `st` is the
   * planner's scene state: moving a beat on to a new scene moves `st.scene` with it, so later beats
   * follow, and fixes `st.known` so point beats check against the right scene.
   */
  guard(beat: PlannedBeat, st: { scene: number; known: Map<number, Set<string>> }): PlannedBeat {
    let b = beat;
    if (b.mode === "draw") {
      // Already on this scene's board: refer to it, don't draw it again.
      const els = this.elements.get(b.scene);
      const dupes = b.adds.filter((a) => els?.has(norm(a.id)) || (a.what && els?.has(norm(a.what))));
      if (dupes.length) {
        this.report.deduped.push(...dupes.map((a) => a.id));
        this.report.notes.push(`${b.id}: ${dupes.map((a) => `${a.id} is already in scene ${b.scene} as ${(els!.get(norm(a.id)) ?? els!.get(norm(a.what)))!.id}`).join("; ")}; referred to, not redrawn`);
        for (const a of dupes) st.known.get(b.scene)?.delete(a.id);
        const adds = b.adds.filter((a) => !dupes.includes(a));
        if (!adds.length) {
          // Nothing new left to draw: point at what it meant, by a word of the sentence that names it, or just say it.
          const said = words(b.say);
          const points = dupes.flatMap((a) => {
            const el = (els!.get(norm(a.id)) ?? els!.get(norm(a.what)))!;
            const name = [...el.id.split(/[-_.]/), ...words(a.what)].find((w) => w.length > 2 && said.includes(w.toLowerCase()));
            return name ? [{ id: el.id, word: b.say.split(/\s+/)[said.indexOf(name.toLowerCase())] }] : [];
          });
          b = points.length ? { ...b, mode: "point", adds: [], points: points.slice(0, 3), region: els!.get(norm(points[0].id))!.region } : { ...b, mode: "talk", adds: [], points: [] };
          this.report.notes.push(`${b.id}: became a ${b.mode} beat`);
        } else b = { ...b, adds };
      }
    }
    if (b.mode === "draw") {
      const taken = this.drawn.get(b.scene) ?? [];
      let region = b.region;
      const full = taken.length >= MAX_DRAWS_PER_SCENE;
      if (!full && taken.some((t) => collides(region, t))) {
        const spot = freeSpot(taken, region);
        if (spot) {
          this.report.replaced++;
          this.report.notes.push(`${b.id}: region overlapped scene ${b.scene}'s drawings; moved to [${[spot.x, spot.y, spot.w, spot.h].map(Math.round).join(", ")}]`);
          region = spot;
        }
      }
      if (full || taken.some((t) => collides(region, t))) {
        // No room in this scene: fresh space, the next scene.
        const next = Math.max(st.scene, b.scene) + 1;
        this.report.movedOn++;
        this.report.notes.push(`${b.id}: scene ${b.scene} ${full ? `already has ${MAX_DRAWS_PER_SCENE} drawings` : "has no free space for it"}; moved on to scene ${next}`);
        for (const a of b.adds) st.known.get(b.scene)?.delete(a.id);
        st.scene = next;
        st.known.set(next, new Set(b.adds.map((a) => a.id)));
        b = { ...b, scene: next };
      }
      b = { ...b, region };
      this.record(b.scene, region, b.adds);
    } else if (b.mode === "point") this.points.set(b.scene, (this.points.get(b.scene) ?? 0) + 1);
    return b;
  }

  /** Per scene, what it holds now (scenes this change touched or that already had drawings). */
  summary(): SceneReport {
    const scenes = [...new Set([...this.drawn.keys(), ...this.points.keys()])].sort((a, b) => a - b);
    this.report.scenes = scenes.map((scene) => {
      const kept = this.keptCount.get(scene) ?? 0;
      const sketches = this.sketchCount.get(scene) ?? 0;
      return { scene, kept, draws: (this.drawn.get(scene)?.length ?? 0) - kept - sketches, points: this.points.get(scene) ?? 0, sketches };
    });
    return this.report;
  }

  /** Every scene's drawing regions (kept and new), for checks. */
  regions(): Map<number, Region[]> {
    return this.drawn;
  }
}
