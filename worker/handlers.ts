import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { withComputedRevision, type AnimationDocument } from "@clayzo/animation/authoring";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { freezeFrame } from "../lib/clayzo/freeze";
import { inkNodes } from "../lib/clayzo/ink";
import { CANVAS, type Beat, type Bounds, type SegmentKind, type StrokeData, type StrokePoint } from "../lib/types";
import { buildWithClaudeCode, type BuiltAnimation } from "./builder";
import { chapterBrief, chapterFeedbackBrief, detourBrief } from "./briefs";
import { download, upload, workerMutation, workerQuery } from "./convex";
import { ROOT } from "./env";
import { voiceBeats } from "./sonic";

const run = promisify(execFile);

export type Job = Doc<"jobs">;
type Progress = (message: string) => Promise<void>;

const FONT = path.join(ROOT, "public/fonts/Manrope.ttf");

function jobDir(job: Job) {
  const dir = path.join(ROOT, "worker/jobs", job._id);
  mkdirSync(path.join(dir, "fonts"), { recursive: true });
  copyFileSync(FONT, path.join(dir, "fonts/Manrope.ttf"));
  copyFileSync(path.join(ROOT, "worker/kit/KIT.md"), path.join(dir, "KIT.md"));
  return dir;
}

function writeTiming(dir: string, file: string, voiced: Awaited<ReturnType<typeof voiceBeats>>, tailSeconds: number) {
  writeFileSync(path.join(dir, file), JSON.stringify({ ...voiced, tailSeconds }, null, 2));
}

/** Uploads a built animation and the audio files it references. Fonts ship with the app. */
async function uploadAnimation(dir: string, built: BuiltAnimation, kind: SegmentKind, from?: { segmentId: Id<"segments">; tick: number }) {
  const assets: { uri: string; storageId: Id<"_storage"> }[] = [];
  for (const asset of Object.values(built.document.assets)) {
    if (asset.type !== "audio" && asset.type !== "image") continue;
    const file = path.join(dir, asset.uri);
    if (!existsSync(file)) throw new Error(`${built.file} references ${asset.uri}, which does not exist`);
    const mime = asset.type === "audio" ? asset.mimeType : asset.mimeType;
    assets.push({ uri: asset.uri, storageId: await upload(new Uint8Array(readFileSync(file)), mime) });
  }
  return {
    kind,
    documentStorageId: await upload(JSON.stringify(built.document), "application/json"),
    assets,
    manifest: built.manifest,
    durationTicks: built.document.timing.durationTicks,
    ticksPerSecond: built.document.timing.ticksPerSecond,
    from,
  };
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

// ---- Chapters --------------------------------------------------------------------------------------

export async function buildChapter(job: Job, progress: Progress) {
  const context = await workerQuery(api.worker.chapterContext, { chapterId: job.payload.chapterId });
  const { chapter, session } = context;
  const dir = jobDir(job);

  await workerMutation(api.jobs.progress, { jobId: job._id, progress: "Recording the narration", chapterStatus: "voicing" });
  const main = await voiceBeats(chapter.beats, dir, "beat");
  writeTiming(dir, "timing.json", main, 7);

  await workerMutation(api.jobs.progress, { jobId: job._id, progress: "Designing the animation", chapterStatus: "animating" });
  const [built] = await buildWithClaudeCode({
    dir,
    expect: ["chapter.json"],
    onProgress: (message) => void progress(message),
    brief: chapterBrief({
      topic: session?.topic ?? chapter.title,
      level: session?.level ?? "",
      outline: context.outline,
      chapter,
      beats: main.beats,
      sources: context.sources,
    }),
  });

  await progress("Uploading");
  await workerMutation(api.jobs.completeChapter, { jobId: job._id, segments: [await uploadAnimation(dir, built, "chapter")] });
}

/** The chapter's "correct" and "common mistake" feedback, starting from its question frame. */
export async function buildChapterFeedback(job: Job, progress: Progress) {
  const { chapter, session } = await workerQuery(api.worker.chapterContext, { chapterId: job.payload.chapterId });
  const dir = jobDir(job);
  const segment = await workerQuery(api.worker.segment, { segmentId: job.payload.chapterSegmentId });
  const document = JSON.parse(new TextDecoder().decode(await download(segment.documentUrl))) as AnimationDocument;
  const questionTick = (segment.manifest as { questionTick?: number }).questionTick ?? document.timing.durationTicks - 8;
  writeFileSync(path.join(dir, "question-frame.json"), JSON.stringify(withComputedRevision(freezeFrame(document, questionTick, 8))));

  await progress("Recording feedback");
  const correct: Beat[] = [
    { narration: `That's it! ${chapter.question.correctAnswer}`, visual: "Celebrate and reinforce the right answer." },
  ];
  const mistake: Beat[] = [
    {
      narration: `Close, but here's the catch. A lot of people think ${lowerFirst(chapter.question.commonMistake)}`,
      visual: "Show the mistaken picture and mark what is wrong.",
    },
    { narration: `Here's what actually happens. ${chapter.question.correctAnswer}`, visual: "Show the correct picture." },
  ];
  const [good, bad] = await Promise.all([voiceBeats(correct, dir, "correct"), voiceBeats(mistake, dir, "mistake")]);
  writeTiming(dir, "timing-correct.json", good, 1.5);
  writeTiming(dir, "timing-mistake.json", bad, 1.5);

  await progress("Animating feedback");
  const built = await buildWithClaudeCode({
    dir,
    expect: ["feedback-correct.json", "feedback-mistake.json"],
    onProgress: (message) => void progress(message),
    brief: chapterFeedbackBrief({
      topic: session?.topic ?? chapter.title,
      question: chapter.question,
      correctBeats: good.beats,
      mistakeBeats: bad.beats,
    }),
  });
  await progress("Uploading");
  const kinds: SegmentKind[] = ["feedback_correct", "feedback_mistake"];
  const segments = [];
  for (const [i, animation] of built.entries()) segments.push(await uploadAnimation(dir, animation, kinds[i]));
  await workerMutation(api.jobs.completeChapterFeedback, { jobId: job._id, segments });
}

// ---- Detours and custom feedback: both start from a paused frame -------------------------------------

function toStrokeData(strokes: Doc<"strokes">[]): StrokeData[] {
  return strokes.map((s) => ({ points: s.points as StrokePoint[], color: s.color, size: s.size, tick: s.tick, offsetMs: s.offsetMs }));
}

function inkBounds(strokes: StrokeData[]): Bounds | null {
  const points = strokes.flatMap((s) => s.points);
  if (points.length === 0) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

async function frozenStart(job: Job, dir: string) {
  const segment = await workerQuery(api.worker.segment, { segmentId: job.payload.segmentId });
  const document = JSON.parse(new TextDecoder().decode(await download(segment.documentUrl))) as AnimationDocument;
  const frozen = freezeFrame(document, job.payload.tick, 8);
  const strokes = job.payload.inkId ? toStrokeData(await workerQuery(api.worker.strokesForInk, { inkId: job.payload.inkId })) : [];
  const composition = frozen.compositions[frozen.rootCompositionId];
  for (const node of inkNodes(strokes, { prefix: "student-ink", outTick: 8, drawn: true })) {
    composition.nodes[node.id] = node;
    composition.rootNodeIds.push(node.id);
  }
  writeFileSync(path.join(dir, "frozen.json"), JSON.stringify(withComputedRevision(frozen)));
  return { focus: inkBounds(strokes), topic: document.name };
}

async function buildFromFrame(job: Job, progress: Progress, purpose: "detour" | "feedback") {
  const dir = jobDir(job);
  await progress("Freezing the frame");
  const { focus, topic } = await frozenStart(job, dir);
  await progress("Recording the narration");
  const voiced = await voiceBeats(job.payload.narration as Beat[], dir, purpose);
  writeTiming(dir, "timing.json", voiced, 1.2);
  await progress("Designing the animation");
  const output = `${purpose}.json`;
  const [built] = await buildWithClaudeCode({
    dir,
    expect: [output],
    onProgress: (message) => void progress(message),
    brief: detourBrief({ topic, request: job.payload.brief, beats: voiced.beats, focus, output, purpose }),
  });
  await progress("Uploading");
  const segment = await uploadAnimation(dir, built, purpose === "detour" ? "detour" : "feedback_custom", {
    segmentId: job.payload.segmentId,
    tick: job.payload.tick,
  });
  await workerMutation(api.jobs.completeSegment, { jobId: job._id, segment });
}

export const buildDetour = (job: Job, progress: Progress) => buildFromFrame(job, progress, "detour");
export const buildFeedback = (job: Job, progress: Progress) => buildFromFrame(job, progress, "feedback");

// ---- Export: the whole lesson, with the student's drawings, as one MP4 --------------------------------

/** Ink periods longer than this are sped up in the export. */
const MAX_INK_SECONDS = 20;

async function hasAudio(file: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
  return stdout.trim().length > 0;
}

export async function exportLesson(job: Job, progress: Progress) {
  const dir = jobDir(job);
  const { timeline, strokes } = await workerQuery(api.worker.sessionRecording, { sessionId: job.sessionId });
  const entries = timeline.filter((entry) => entry.toTick !== undefined);
  if (entries.length === 0) throw new Error("Nothing has been watched yet");

  const documents = new Map<string, { document: AnimationDocument; segmentDir: string }>();
  async function load(segmentId: Id<"segments">) {
    const cached = documents.get(segmentId);
    if (cached) return cached;
    const segment = await workerQuery(api.worker.segment, { segmentId });
    const segmentDir = path.join(dir, segmentId);
    mkdirSync(path.join(segmentDir, "audio"), { recursive: true });
    mkdirSync(path.join(segmentDir, "fonts"), { recursive: true });
    copyFileSync(FONT, path.join(segmentDir, "fonts/Manrope.ttf"));
    for (const asset of segment.assetUrls) {
      mkdirSync(path.dirname(path.join(segmentDir, asset.uri)), { recursive: true });
      writeFileSync(path.join(segmentDir, asset.uri), await download(asset.url));
    }
    const document = JSON.parse(new TextDecoder().decode(await download(segment.documentUrl))) as AnimationDocument;
    const loaded = { document, segmentDir };
    documents.set(segmentId, loaded);
    return loaded;
  }

  const clips: string[] = [];
  for (const [index, entry] of entries.entries()) {
    await progress(`Rendering clip ${index + 1} of ${entries.length}`);
    const { document, segmentDir } = await load(entry.segmentId);
    const raw = path.join(dir, `clip-${index}-raw.mp4`);
    if (entry.kind === "play") {
      const docFile = path.join(segmentDir, "document.json");
      writeFileSync(docFile, JSON.stringify(document));
      await run("npx", ["clayzo", "export", docFile, raw, "--format", "mp4", "--tier", "review", "--start", String(entry.fromTick), "--end", String(entry.toTick), "--no-progress"], { cwd: ROOT, maxBuffer: 1 << 26 });
    } else {
      // The frozen frame with the student's strokes drawing on as they drew them.
      const seconds = Math.min(MAX_INK_SECONDS, Math.max(1, ((entry.endedAt ?? entry.startedAt) - entry.startedAt) / 1000));
      const durationTicks = Math.round((seconds * CANVAS.ticksPerSecond) / 8) * 8;
      const realMs = Math.max(1, (entry.endedAt ?? entry.startedAt) - entry.startedAt);
      const speed = Math.min(1, (seconds * 1000) / realMs);
      const ink = toStrokeData(strokes.filter((s) => s.inkId === entry._id));
      const still = freezeFrame(document, entry.fromTick, durationTicks);
      const composition = still.compositions[still.rootCompositionId];
      const nodes = inkNodes(ink, {
        prefix: "ink",
        outTick: durationTicks,
        startTickFor: (s) => ((s.offsetMs * speed) / 1000) * CANVAS.ticksPerSecond,
      });
      for (const node of nodes) {
        composition.nodes[node.id] = node;
        composition.rootNodeIds.push(node.id);
      }
      const docFile = path.join(segmentDir, `ink-${index}.json`);
      writeFileSync(docFile, JSON.stringify(withComputedRevision(still)));
      await run("npx", ["clayzo", "export", docFile, raw, "--format", "mp4", "--tier", "review", "--no-progress"], { cwd: ROOT, maxBuffer: 1 << 26 });
    }
    // Normalise every clip (same codec, size and an audio track) so they concatenate cleanly.
    const clip = path.join(dir, `clip-${index}.mp4`);
    const silence = !(await hasAudio(raw));
    await run("ffmpeg", [
      "-y",
      "-i", raw,
      ...(silence ? ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"] : []),
      "-map", "0:v:0",
      "-map", silence ? "1:a:0" : "0:a:0",
      ...(silence ? ["-shortest"] : []),
      "-vf", `scale=${CANVAS.width}:${CANVAS.height},fps=${CANVAS.fps}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      clip,
    ]);
    clips.push(clip);
  }

  await progress("Stitching the video");
  const list = path.join(dir, "clips.txt");
  writeFileSync(list, clips.map((clip) => `file '${clip}'`).join("\n"));
  const output = path.join(dir, "lesson.mp4");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", output]);
  await progress("Uploading the video");
  const storageId = await upload(new Uint8Array(readFileSync(output)), "video/mp4");
  await workerMutation(api.jobs.completeExport, { jobId: job._id, storageId });
}
