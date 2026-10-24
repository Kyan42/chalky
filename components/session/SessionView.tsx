"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BuildingLoader } from "@/components/BuildingLoader";
import { INK_COLORS, InkLayer, snapshot } from "@/components/InkLayer";
import { Orb, type OrbState } from "@/components/Orb";
import { Stage, type StageClip, type StageHandle } from "@/components/Stage";
import { SyllabusRail } from "@/components/SyllabusRail";
import { circledElements } from "@/lib/clayzo/hitTest";
import type { Manifest, StrokeData } from "@/lib/types";
import { audioUnlocked } from "@/lib/voice/audio";
import { useVoice } from "@/lib/voice/useVoice";
import { useSpeechQueue } from "./useSpeechQueue";

/**
 * talk     voice conversation with the orb (onboarding, between chapters)
 * play     an animation is playing
 * paused   the student paused it: they can draw and ask
 * answer   end-of-chapter question: draw and talk, then "I'm done"
 * grading  the tutor is looking at the answer
 * choice   after the answer: 10 seconds to ask a question about it, otherwise on to the next chapter
 * waiting  a detour or custom feedback animation is being built
 * done     lesson complete
 */
type Mode = "talk" | "play" | "paused" | "answer" | "grading" | "choice" | "waiting" | "done";

type Purpose = "chapter" | "feedback" | "detour";
type Playing = {
  segmentId: Id<"segments">;
  purpose: Purpose;
  chapterIndex: number;
  startTick: number;
  key: string;
  /** What to go back to (and from which tick) when a detour ends. */
  resume?: Omit<Playing, "key">;
};

const RESUME = /^\W*(ok(ay)?|sure|yes|yeah|got it|thanks?( you)?|cool|great)?\W*(resume|continue|keep going|go on|carry on|play|next|never ?mind|move on)\b/i;
const HOLD = /^\W*(stop|pause|wait|hold on|hang on|one sec(ond)?)\W*$/i;
const SKIP = /\b(skip( (it|this|the question))?|next (question|chapter)|pass)\W*$/i;
const DONE = /\b(i'?m done|i am done|that'?s (it|my answer)|done|finished|submit)\W*$/i;

const words = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

export function SessionView({ sessionId }: { sessionId: Id<"sessions"> }) {
  const session = useQuery(api.sessions.get, { sessionId });
  const chapters = useQuery(api.chapters.list, { sessionId });
  const messages = useQuery(api.messages.list, { sessionId });
  const sources = useQuery(api.sources.list, { sessionId });
  const jobs = useQuery(api.jobs.listBySession, { sessionId });

  const respond = useAction(api.tutor.respond);
  const interject = useAction(api.tutor.interject);
  const grade = useAction(api.tutor.grade);
  const greet = useMutation(api.messages.greet);
  const advance = useMutation(api.sessions.advance);
  const timelineStart = useMutation(api.timeline.start);
  const timelineEnd = useMutation(api.timeline.end);
  const addStroke = useMutation(api.strokes.add);
  const removeStroke = useMutation(api.strokes.remove);
  const uploadUrl = useMutation(api.files.generateUploadUrl);

  const [rawMode, setMode] = useState<Mode>("talk");
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [thinking, setThinking] = useState(false);
  const [strokes, setStrokes] = useState<(StrokeData & { id?: Id<"strokes"> })[]>([]);
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [waitingJob, setWaitingJob] = useState<Id<"jobs"> | null>(null);
  const [waitingFor, setWaitingFor] = useState<"feedback" | "detour">("detour");
  const [error, setError] = useState<string | null>(null);
  /** A detour that finished after the student moved on, offered as a "Watch" toast. */
  const [readyDetour, setReadyDetour] = useState<{ title: string; segmentId: Id<"segments"> } | null>(null);
  const [tick, setTick] = useState(0);

  const stage = useRef<StageHandle>(null);
  const playEntry = useRef<Id<"timeline"> | null>(null);
  const ink = useRef<{ id: Id<"timeline">; startedAt: number; tick: number; segmentId: Id<"segments"> } | null>(null);
  /** Settles once the ink period being opened exists; strokes and questions made right after pausing wait on it. */
  const inkReady = useRef<Promise<void>>(Promise.resolve());
  const answerText = useRef("");
  const afterFeedback = useRef<"advance" | null>(null);
  /** Chapters whose end-of-chapter question has been answered or skipped. */
  const answered = useRef(new Set<number>());
  const starting = useRef(false);
  /** The chapter we just moved to; auto-start ignores any other until the session catches up. */
  const targetChapter = useRef<number | null>(null);

  const mode: Mode = session?.status === "done" && rawMode === "talk" ? "done" : rawMode;
  const segment = useQuery(api.segments.get, playing ? { segmentId: playing.segmentId } : "skip");
  const manifest = (segment?.manifest ?? null) as Manifest | null;
  const chapter = chapters?.find((c) => c.index === (playing?.chapterIndex ?? session?.currentChapter ?? 0));

  // Mirror state into refs for the voice callbacks, which outlive renders.
  const live = useRef({ mode, playing, strokes, manifest, chapter, tick });
  useEffect(() => {
    live.current = { mode, playing, strokes, manifest, chapter, tick };
  });

  // ---- Voice ---------------------------------------------------------------------------------------

  const looksLikeEcho = useCallback((text: string) => {
    // The animation's narration comes out of the speakers; don't mistake it for the student.
    const m = live.current.manifest;
    if (!m) return false;
    const t = live.current.tick;
    const near = m.beats.filter((b) => b.startTick <= t + 240 && b.endTick >= t - 960).map((b) => b.narration).join(" ");
    const narration = new Set(words(near));
    const heard = words(text).filter((w) => w.length > 2);
    if (heard.length === 0) return true;
    return heard.filter((w) => narration.has(w)).length / heard.length >= 0.6;
  }, []);

  const voice = useVoice({
    onUpdate: (text) => {
      if (live.current.mode === "play" && words(text).length >= 2 && !looksLikeEcho(text)) pause();
    },
    onEnd: (text) => void onTurn(text),
  });
  const speech = useSpeechQueue(voice, messages);

  // Coming from the landing page, audio is already unlocked: start listening right away (once).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || voice.started || !audioUnlocked()) return;
    autoStarted.current = true;
    void voice.start().catch(() => {});
  }, [voice]);

  useEffect(() => {
    if (voice.started) void greet({ sessionId });
  }, [voice.started, greet, sessionId]);

  useEffect(() => {
    if (!chapters?.length) return;
    voice.setKeyterms([session?.topic ?? "", ...chapters.flatMap((c) => [c.title, ...c.title.split(/\s+/).filter((w) => w.length > 5)])]);
  }, [chapters, session?.topic, voice]);

  // ---- Timeline (for replay and export) ------------------------------------------------------------

  const closePlay = useCallback(
    async (toTick: number) => {
      const entry = playEntry.current;
      playEntry.current = null;
      if (entry) await timelineEnd({ entryId: entry, toTick: Math.round(toTick) });
    },
    [timelineEnd],
  );

  const openPlay = useCallback(
    async (segmentId: Id<"segments">, fromTick: number) => {
      playEntry.current = await timelineStart({ sessionId, kind: "play", segmentId, fromTick: Math.round(fromTick) });
    },
    [timelineStart, sessionId],
  );

  const openInk = useCallback(
    (segmentId: Id<"segments">, atTick: number) => {
      setStrokes([]);
      const startedAt = performance.now();
      inkReady.current = timelineStart({ sessionId, kind: "ink", segmentId, fromTick: Math.round(atTick) }).then((id) => {
        ink.current = { id, startedAt, tick: Math.round(atTick), segmentId };
      });
      return inkReady.current;
    },
    [timelineStart, sessionId],
  );

  const closeInk = useCallback(async () => {
    const current = ink.current;
    ink.current = null;
    if (current) await timelineEnd({ entryId: current.id, toTick: current.tick });
  }, [timelineEnd]);

  // ---- Playback ------------------------------------------------------------------------------------

  const startPlay = useCallback(
    async (next: Omit<Playing, "key">) => {
      setStrokes([]);
      setPlaying({ ...next, key: `${next.segmentId}:${next.startTick}:${Date.now()}` });
      setMode("play");
      await openPlay(next.segmentId, next.startTick);
    },
    [openPlay],
  );

  const pause = useCallback(() => {
    const { mode: m, playing: p } = live.current;
    if (m !== "play" || !p || !stage.current) return;
    stage.current.pause();
    const at = stage.current.tick();
    setMode("paused");
    inkReady.current = closePlay(at).then(() => openInk(p.segmentId, at));
  }, [closePlay, openInk]);


  const advanceChapter = useCallback(async () => {
    await closeInk();
    const next = (live.current.playing?.chapterIndex ?? session?.currentChapter ?? 0) + 1;
    targetChapter.current = next;
    setPlaying(null);
    setStrokes([]);
    starting.current = false;
    // Move the session first, so the auto-start below never sees the old chapter as "current".
    await advance({ sessionId, toChapter: next });
    setMode("talk");
  }, [advance, closeInk, session?.currentChapter, sessionId]);

  const resume = useCallback(async () => {
    const { playing: p, mode: m } = live.current;
    if (!p || !stage.current) return;
    setWaitingJob(null);
    // Waiting on feedback, or paused after the question: carrying on means the next chapter.
    if ((m === "waiting" && afterFeedback.current === "advance") || (p.purpose === "chapter" && answered.current.has(p.chapterIndex))) {
      afterFeedback.current = null;
      await advanceChapter();
      return;
    }
    await closeInk();
    setStrokes([]);
    setMode("play");
    await openPlay(p.segmentId, stage.current.tick());
    stage.current.play();
  }, [advanceChapter, closeInk, openPlay]);

  const uploadSnapshot = useCallback(async () => {
    const blob = await snapshot(stage.current?.canvas() ?? null, live.current.strokes);
    if (!blob) return undefined;
    const url = await uploadUrl({});
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    return storageId;
  }, [uploadUrl]);

  // The end-of-chapter question card reached: switch to answering.
  const onQuestion = useCallback(
    async (atTick: number) => {
      const { playing: p, chapter: c } = live.current;
      if (!p) return;
      await closePlay(atTick);
      if (answered.current.has(p.chapterIndex)) {
        setMode("choice");
        return;
      }
      answerText.current = "";
      await openInk(p.segmentId, atTick);
      setMode("answer");
      if (c) speech.sayLocal(`${c.question.prompt} Draw on the screen and talk me through it. Say "I'm done" when you're finished.`);
    },
    [closePlay, openInk, speech],
  );

  const onEnded = useCallback(async () => {
    const { playing: p, manifest: m } = live.current;
    if (!p) return;
    const end = segment?.durationTicks ?? 0;
    if (p.purpose === "chapter") {
      // No question card in this animation: ask at the end. Already answered: move on.
      if (m?.questionTick === undefined && !answered.current.has(p.chapterIndex)) await onQuestion(end);
      else await closePlay(end).then(advanceChapter);
      return;
    }
    await closePlay(end);
    if (p.purpose === "detour" && p.resume) {
      speech.sayLocal("Okay, back to where we were.");
      await speech.untilQuiet(200);
      await startPlay(p.resume);
    } else if (p.purpose === "detour") {
      setPlaying(null);
      setMode("talk");
    } else if (p.purpose === "feedback") {
      await advanceChapter();
    }
  }, [advanceChapter, closePlay, onQuestion, segment?.durationTicks, speech, startPlay]);

  // ---- What the student says ------------------------------------------------------------------------

  const submitAnswer = useCallback(async () => {
    await inkReady.current;
    const { playing: p, chapter: c } = live.current;
    if (!p || !c || !ink.current) return;
    answered.current.add(p.chapterIndex);
    setMode("grading");
    setThinking(true);
    try {
      const imageStorageId = await uploadSnapshot();
      const result = await grade({
        sessionId,
        chapterId: c._id,
        segmentId: p.segmentId,
        tick: ink.current.tick,
        inkId: ink.current.id,
        transcript: answerText.current.trim(),
        imageStorageId,
      });
      setThinking(false);
      // The feedback is spoken; there's no feedback animation unless they ask a question.
      void result;
      await speech.untilQuiet();
      await closeInk();
      setMode("choice");
    } catch (e) {
      setThinking(false);
      setError(e instanceof Error ? e.message : String(e));
      setMode("answer");
    }
  }, [closeInk, grade, sessionId, speech, uploadSnapshot]);

  /** From the post-answer choice: draw and talk about the question frame; a detour is built for it. */
  const startAsking = useCallback(async () => {
    const { playing: p } = live.current;
    if (!p || !stage.current) return;
    setMode("paused");
    await openInk(p.segmentId, stage.current.tick());
    speech.sayLocal("Sure, what's your question? You can circle things too.");
  }, [openInk, speech]);

  /** The Next button: leave whatever is playing (chapter, feedback, detour, question) and start the next chapter. */
  const goNext = useCallback(async () => {
    // The click counts as the gesture browsers need for sound, so start voice now if a reload reset it.
    if (!voice.started) void voice.start().catch((e) => setError(String(e)));
    const p = live.current.playing;
    if (p && stage.current) {
      stage.current.pause();
      await closePlay(stage.current.tick());
      answered.current.add(p.chapterIndex);
    }
    afterFeedback.current = null;
    setWaitingJob(null);
    speech.hush();
    await advanceChapter();
  }, [advanceChapter, closePlay, speech, voice]);

  const skipQuestion = useCallback(async () => {
    const p = live.current.playing;
    if (!p) return;
    answered.current.add(p.chapterIndex);
    speech.sayLocal("No problem, let's keep going.");
    await speech.untilQuiet(200);
    await advanceChapter();
  }, [advanceChapter, speech]);

  const askAboutFrame = useCallback(
    async (text: string) => {
      await inkReady.current;
      const { playing: p, strokes: s, manifest: m } = live.current;
      if (!p || !stage.current || !ink.current) return;
      if (!text.trim() && s.length === 0) return;
      if (s.length === 0 && RESUME.test(text)) return void resume();
      if (s.length === 0 && HOLD.test(text)) return;
      setThinking(true);
      try {
        const at = stage.current.tick();
        const imageStorageId = await uploadSnapshot();
        const result = await interject({
          sessionId,
          segmentId: p.segmentId,
          tick: Math.round(at),
          transcript: text,
          inkId: ink.current.id,
          imageStorageId,
          circled: circledElements(m, at, s),
        });
        setThinking(false);
        if (result.intent === "resume") {
          await speech.untilQuiet();
          await resume();
        } else if (result.jobId) {
          afterFeedback.current = null;
          setWaitingFor("detour");
          setWaitingJob(result.jobId);
          setMode("waiting");
        }
      } catch (e) {
        setThinking(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [interject, resume, sessionId, speech, uploadSnapshot],
  );

  const onTurn = useCallback(
    async (text: string) => {
      const m = live.current.mode;
      if (m === "talk" || m === "done") {
        if (!text.trim()) return;
        setThinking(true);
        try {
          await respond({ sessionId, text });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setThinking(false);
        }
      } else if (m === "play") {
        if (words(text).length >= 2 && !looksLikeEcho(text)) {
          pause();
          await askAboutFrame(text);
        }
      } else if (m === "paused") {
        await askAboutFrame(text);
      } else if (m === "waiting") {
        if (RESUME.test(text)) await resume();
      } else if (m === "choice") {
        if (RESUME.test(text) || SKIP.test(text) || /^\W*(no|nope|nah|i'?m good)\b/i.test(text)) return void advanceChapter();
        if (words(text).length >= 2) {
          await startAsking();
          await askAboutFrame(text);
        }
      } else if (m === "answer") {
        // "Carry on" / "skip" before answering anything skips the question.
        if (!answerText.current && live.current.strokes.length === 0 && (RESUME.test(text) || SKIP.test(text))) return void skipQuestion();
        answerText.current = `${answerText.current} ${text}`.trim();
        if (DONE.test(text)) await submitAnswer();
      }
    },
    [advanceChapter, askAboutFrame, looksLikeEcho, pause, respond, resume, sessionId, skipQuestion, startAsking, submitAnswer],
  );

  // ---- Background work landing ----------------------------------------------------------------------

  // A detour or custom feedback animation finished building.
  useEffect(() => {
    if (!waitingJob || !jobs) return;
    const job = jobs.find((j) => j._id === waitingJob);
    const p = live.current.playing;
    if (!job || !p) return;
    if (job.status === "done" && job.resultSegmentId) {
      // Reacting to a Convex update: the job's result arriving is the event.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWaitingJob(null);
      void (async () => {
        await speech.untilQuiet(0);
        if (afterFeedback.current === "advance") {
          await startPlay({ segmentId: job.resultSegmentId!, purpose: "feedback", chapterIndex: p.chapterIndex, startTick: 0 });
        } else {
          const at = ink.current?.tick ?? Math.round(stage.current?.tick() ?? 0);
          await closeInk();
          await startPlay({
            segmentId: job.resultSegmentId!,
            purpose: "detour",
            chapterIndex: p.chapterIndex,
            startTick: 0,
            resume: { segmentId: p.segmentId, purpose: p.purpose, chapterIndex: p.chapterIndex, startTick: at, resume: p.resume },
          });
        }
      })();
    } else if (job.status === "failed") {
      setWaitingJob(null);
      speech.sayLocal("I couldn't build that animation, sorry. Let's keep going.");
      if (afterFeedback.current === "advance") void advanceChapter();
      else setMode("paused");
    }
  }, [jobs, waitingJob, speech, startPlay, closeInk, advanceChapter]);

  /** Plays a detour that finished building, then returns to whatever was on screen. */
  const playDetour = useCallback(
    async (segmentId: Id<"segments">) => {
      if (!voice.started) void voice.start().catch((e) => setError(String(e)));
      const { playing: p, mode: m } = live.current;
      let resumeTo: Playing["resume"];
      if (p && stage.current && m !== "talk" && m !== "done") {
        const at = Math.round(stage.current.tick());
        if (m === "play") {
          stage.current.pause();
          await closePlay(at);
        } else {
          await closeInk();
        }
        resumeTo = { segmentId: p.segmentId, purpose: p.purpose, chapterIndex: p.chapterIndex, startTick: at, resume: p.resume };
      }
      setReadyDetour(null);
      setWaitingJob(null);
      speech.hush();
      await startPlay({
        segmentId,
        purpose: "detour",
        chapterIndex: p?.chapterIndex ?? session?.currentChapter ?? 0,
        startTick: 0,
        resume: resumeTo,
      });
    },
    [closeInk, closePlay, session?.currentChapter, speech, startPlay, voice],
  );

  // A detour that finishes after the student moved on: offer it instead of interrupting.
  const seenDetours = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!jobs) return;
    const done = jobs.filter((j) => j.kind === "detour" && j.status === "done" && j.resultSegmentId);
    if (seenDetours.current === null) {
      seenDetours.current = new Set(done.map((j) => j._id));
      return;
    }
    for (const job of done) {
      if (seenDetours.current.has(job._id)) continue;
      seenDetours.current.add(job._id);
      // A Convex update (the detour finishing) is the event being reacted to.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (job._id !== waitingJob) setReadyDetour({ title: (job.payload.title as string) || "Your question", segmentId: job.resultSegmentId! });
    }
  }, [jobs, waitingJob]);
  useEffect(() => {
    if (!readyDetour) return;
    const id = setTimeout(() => setReadyDetour(null), 15_000);
    return () => clearTimeout(id);
  }, [readyDetour]);

  // The choice window: if nothing happens for 10 seconds, move on.
  const CHOICE_MS = 10_000;
  useEffect(() => {
    if (mode !== "choice") return;
    const id = setTimeout(() => void advanceChapter(), CHOICE_MS);
    return () => clearTimeout(id);
  }, [mode, advanceChapter]);

  // Start the current chapter as soon as it is built and the tutor has finished talking.
  const currentChapter = chapters?.find((c) => c.index === session?.currentChapter);
  useEffect(() => {
    // Voice that failed to start still lets the lesson play, with captions instead of speech.
    if (mode !== "talk" || session?.status !== "learning" || (!voice.started && !voice.error)) return;
    if (!currentChapter?.chapterSegmentId || !speech.quiet || thinking || starting.current) return;
    if (targetChapter.current !== null && currentChapter.index !== targetChapter.current) return;
    starting.current = true;
    void (async () => {
      speech.sayLocal(`Chapter ${currentChapter.index + 1}. ${currentChapter.title}.`);
      await speech.untilQuiet(100);
      await startPlay({ segmentId: currentChapter.chapterSegmentId!, purpose: "chapter", chapterIndex: currentChapter.index, startTick: 0 });
      starting.current = false;
    })();
  }, [mode, session?.status, currentChapter, speech, thinking, startPlay, voice.started, voice.error]);


  // Space pauses and resumes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || (event.target as HTMLElement)?.tagName === "INPUT") return;
      event.preventDefault();
      if (live.current.mode === "play") pause();
      else if (live.current.mode === "paused" || live.current.mode === "waiting") void resume();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pause, resume]);

  // ---- Ink ------------------------------------------------------------------------------------------

  const onStroke = useCallback(
    async (s: Omit<StrokeData, "tick" | "offsetMs">) => {
      const endedAt = performance.now();
      await inkReady.current;
      const current = ink.current;
      if (!current) return;
      const durationMs = s.points[s.points.length - 1]?.[3] ?? 0;
      const stroke: StrokeData = { ...s, tick: current.tick, offsetMs: Math.max(0, endedAt - current.startedAt - durationMs) };
      setStrokes((all) => [...all, stroke]);
      const id = await addStroke({
        sessionId,
        segmentId: current.segmentId,
        inkId: current.id,
        tick: stroke.tick,
        offsetMs: stroke.offsetMs,
        points: stroke.points,
        color: stroke.color,
        size: stroke.size,
        purpose: live.current.mode === "answer" ? "answer" : "interject",
      });
      setStrokes((all) => all.map((x) => (x === stroke ? { ...x, id } : x)));
    },
    [addStroke, sessionId],
  );

  const undoStroke = useCallback(() => {
    setStrokes((all) => {
      const last = all[all.length - 1];
      if (last?.id) void removeStroke({ strokeId: last.id });
      return all.slice(0, -1);
    });
  }, [removeStroke]);

  // ---- Render ---------------------------------------------------------------------------------------

  const clip: StageClip | null = useMemo(() => {
    if (!playing || !segment || segment._id !== playing.segmentId) return null;
    return {
      key: playing.key,
      segment,
      startTick: playing.startTick,
      autoplay: true,
      stopAtTick: playing.purpose === "chapter" ? (segment.manifest as Manifest | null)?.questionTick : undefined,
    };
  }, [playing, segment]);

  const inkEnabled = mode === "paused" || mode === "answer";
  const showStage = playing !== null && mode !== "talk" && mode !== "done";
  const orbState: OrbState = !voice.started
    ? "idle"
    : voice.agentSpeaking
      ? "speaking"
      : thinking || session?.status === "planning"
        ? "thinking"
        : voice.partial
          ? "hearing"
          : "listening";
  const waitingJobDoc = jobs?.find((j) => j._id === waitingJob);
  const lastAgent = [...(messages ?? [])].reverse().find((m) => m.role === "agent");
  const caption = voice.partial ? `“${voice.partial}”` : (speech.current ?? (mode === "talk" ? lastAgent?.text : null));
  const building = chapters?.find((c) => c.index === session?.currentChapter && c.status !== "ready");
  const buildingJob = jobs?.find((j) => j.kind === "chapter" && j.payload.chapterId === building?._id && j.status !== "failed");
  const nextChapter = chapters?.find((c) => c.index === (session?.currentChapter ?? 0) + 1);
  const canGoNext = Boolean(nextChapter?.chapterSegmentId) && mode !== "grading" && mode !== "done";

  if (session === null) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="text-[var(--muted)]">
          This session doesn&apos;t exist. <Link className="underline" href="/">Start a new one</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-4 px-6 py-4">
        <Link href="/" className="text-lg font-extrabold tracking-tight">
          chalky
        </Link>
        <span className="truncate text-sm text-[var(--muted)]">{session?.topic ?? "New lesson"}</span>
        {sources && sources.length > 0 && (
          <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted)]">
            {sources.length} source{sources.length > 1 ? "s" : ""}
            {sources.some((s) => s.status === "pending") ? " · reading" : ""}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {(session?.status === "done" || (session?.currentChapter ?? 0) > 0) && (
            <Link href={`/s/${sessionId}/replay`} className="rounded-full border border-[var(--border)] px-3 py-1 text-sm hover:bg-white/5">
              Replay
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-1 gap-6 px-6 pb-6">
        <section className="relative flex flex-1 flex-col items-center justify-center gap-6">
          {showStage ? (
            <div className="w-full max-w-6xl">
              <Stage
                ref={stage}
                clip={clip}
                onTick={setTick}
                onStop={(t) => void onQuestion(t)}
                onEnded={() => void onEnded()}
                onError={(e) => setError(e.message)}
              >
                <InkLayer enabled={inkEnabled} strokes={strokes} color={inkColor} size={8} onStroke={(s) => void onStroke(s)} />
                {mode === "paused" && strokes.length === 0 && !thinking && (
                  <Banner>Paused. Circle anything and ask about it, or say &ldquo;keep going&rdquo;.</Banner>
                )}
                {mode === "answer" && <Banner tone="warn">Your turn: draw and talk. Say &ldquo;I&apos;m done&rdquo; when you&apos;re finished.</Banner>}
                {(mode === "grading" || (thinking && mode === "paused")) && <Banner>Looking at your work…</Banner>}
                {mode === "choice" && (
                  <div className="fade-up absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-6 pt-16 pb-6">
                    <p className="text-sm text-white/80">Any questions about this? Otherwise we&apos;ll move on.</p>
                    <div className="flex gap-3">
                      <button className="rounded-full bg-[var(--accent)] px-5 py-2 font-semibold text-black" onClick={() => void startAsking()}>
                        Ask a question
                      </button>
                      <button className="rounded-full bg-white/15 px-5 py-2 font-semibold hover:bg-white/25" onClick={() => void advanceChapter()}>
                        Next chapter →
                      </button>
                    </div>
                    <div className="h-1 w-56 overflow-hidden rounded-full bg-white/15">
                      <div className="choice-countdown h-full bg-white/70" style={{ animationDuration: `${CHOICE_MS}ms` }} />
                    </div>
                  </div>
                )}
                {mode === "waiting" && (
                  <div className="fade-up absolute inset-0 z-20 grid place-items-center bg-[#06070d]/70 backdrop-blur-[2px]">
                    <div className="flex flex-col items-center gap-4">
                      <BuildingLoader
                        compact
                        title={
                          waitingFor === "feedback"
                            ? "Animating feedback on your answer"
                            : `Animating “${(waitingJobDoc?.payload.title as string) || "your question"}”`
                        }
                        progress={waitingJobDoc?.status === "queued" ? "Waiting for the builder" : waitingJobDoc?.progress}
                        since={waitingJobDoc?.createdAt}
                      />
                      <button className="rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20" onClick={() => void resume()}>
                        {waitingFor === "feedback" ? "Skip to next chapter" : "Keep watching instead (it'll be in your lesson list)"}
                      </button>
                    </div>
                  </div>
                )}
              </Stage>
              <div className="mt-4 flex min-h-12 items-center gap-4">
                <button onClick={() => (voice.agentSpeaking ? speech.hush() : undefined)} className="shrink-0" title="Tap to interrupt">
                  <Orb state={orbState} levels={voice.levels} size={56} />
                </button>
                <p className="flex-1 text-lg leading-snug text-[var(--foreground)]/90">{caption}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-8 text-center">
              <button onClick={() => (voice.agentSpeaking ? speech.hush() : undefined)} title="Tap to interrupt">
                <Orb state={orbState} levels={voice.levels} size={260} />
              </button>
              <p className="min-h-16 max-w-2xl text-2xl leading-snug font-medium">
                {mode === "done" ? "Lesson complete. Nice work!" : caption}
              </p>
              {mode === "talk" && (session?.status === "planning" || building) && (
                <BuildingLoader
                  title={building ? `Chapter ${building.index + 1}: ${building.title}` : "Planning your lesson"}
                  progress={building?.status === "planned" ? "Waiting for the builder" : building?.progress}
                  since={buildingJob?.createdAt ?? session?._creationTime}
                />
              )}
              {mode === "done" && (
                <Link href={`/s/${sessionId}/replay`} className="rounded-full bg-[var(--foreground)] px-6 py-3 font-semibold text-black">
                  Watch your lesson
                </Link>
              )}
              {!voice.started && (
                <button
                  className="rounded-full bg-[var(--foreground)] px-6 py-3 font-semibold text-black"
                  onClick={() => void voice.start().catch((e) => setError(String(e)))}
                >
                  Tap to start talking
                </button>
              )}
            </div>
          )}

          <ControlBar>
            <IconButton
              label={voice.muted ? "Unmute mic" : "Mute mic"}
              active={!voice.muted}
              onClick={() => voice.setMuted(!voice.muted)}
              icon={voice.muted ? "mic-off" : "mic"}
            />
            {showStage && (mode === "play" || mode === "paused" || mode === "waiting") && (
              <IconButton
                label={mode === "play" ? "Pause (space)" : "Resume (space)"}
                onClick={() => (mode === "play" ? pause() : void resume())}
                icon={mode === "play" ? "pause" : "play"}
              />
            )}
            {inkEnabled && (
              <>
                <div className="mx-1 h-8 w-px bg-white/10" />
                {INK_COLORS.map((c) => (
                  <button
                    key={c}
                    aria-label={`Ink ${c}`}
                    onClick={() => setInkColor(c)}
                    className={`h-7 w-7 rounded-full border-2 ${inkColor === c ? "border-white" : "border-transparent"}`}
                    style={{ background: c }}
                  />
                ))}
                <IconButton label="Undo" onClick={undoStroke} icon="undo" disabled={strokes.length === 0} />
              </>
            )}
            {mode === "answer" && (
              <>
                <button className="ml-2 rounded-full bg-[var(--warn)] px-5 py-2 font-semibold text-black" onClick={() => void submitAnswer()}>
                  I&apos;m done
                </button>
                <button className="rounded-full px-3 py-2 text-sm text-[var(--muted)] hover:text-white" onClick={() => void skipQuestion()}>
                  Skip
                </button>
              </>
            )}
            {mode === "paused" && strokes.length > 0 && (
              <button className="ml-2 rounded-full bg-[var(--accent)] px-5 py-2 font-semibold text-black" onClick={() => void askAboutFrame("Explain this in more detail.")}>
                Explain this
              </button>
            )}
          </ControlBar>

          {readyDetour && (
            <div className="fade-up fixed bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface-2)] py-2 pr-2 pl-4 text-sm shadow-xl">
              <span>
                Your explanation of <strong>{readyDetour.title}</strong> is ready
              </span>
              <button className="rounded-full bg-[var(--accent)] px-3 py-1 font-semibold text-black" onClick={() => void playDetour(readyDetour.segmentId)}>
                Watch
              </button>
              <button aria-label="Dismiss" className="px-2 text-[var(--muted)]" onClick={() => setReadyDetour(null)}>
                ×
              </button>
            </div>
          )}

          {canGoNext && nextChapter && (
            <button
              onClick={() => void goNext()}
              className="fade-up fixed right-6 bottom-6 z-30 flex items-center gap-2 rounded-full bg-[var(--foreground)] px-5 py-3 font-semibold text-black shadow-xl transition-transform hover:scale-[1.03]"
              title={`Skip to chapter ${nextChapter.index + 1}`}
            >
              <span className="text-xs font-medium text-black/60">Chapter {nextChapter.index + 1}</span>
              <span className="max-w-56 truncate">{nextChapter.title}</span>
              <span aria-hidden>→</span>
            </button>
          )}

          {(error || voice.error) && (
            <div className="fixed bottom-24 left-1/2 max-w-xl -translate-x-1/2 rounded-xl bg-[var(--danger)]/15 px-4 py-2 text-sm text-[var(--danger)]">
              {error ?? voice.error}
              <button className="ml-3 underline" onClick={() => setError(null)}>
                dismiss
              </button>
            </div>
          )}
        </section>

        {chapters && chapters.length > 0 && (
          <aside className="hidden w-72 shrink-0 lg:block">
            <h2 className="mb-3 text-xs font-semibold tracking-widest text-[var(--muted)] uppercase">Your lesson</h2>
            <SyllabusRail chapters={chapters} current={session?.currentChapter ?? 0} jobs={jobs ?? []} onPlayDetour={(id) => void playDetour(id)} />
          </aside>
        )}
      </div>
    </main>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <div
      className={`fade-up pointer-events-auto absolute top-4 left-1/2 z-20 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium backdrop-blur ${
        tone === "warn" ? "bg-[var(--warn)]/90 text-black" : "bg-black/60 text-white"
      }`}
    >
      {children}
    </div>
  );
}

function ControlBar({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)]/80 px-3 py-2 backdrop-blur">{children}</div>;
}

const ICONS: Record<string, string> = {
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0M12 17v4",
  "mic-off": "M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.9 2.3M17 12a5 5 0 0 1-.6 2.4M7 12a5 5 0 0 0 7.7 4.2M12 17v4M3 3l18 18",
  pause: "M8 5v14M16 5v14",
  play: "M7 5l12 7-12 7z",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2",
};

function IconButton({ label, icon, onClick, active, disabled }: { label: string; icon: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-10 w-10 place-items-center rounded-full transition-colors ${active ? "bg-white/15" : "bg-white/5 hover:bg-white/10"}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICONS[icon]} />
      </svg>
    </button>
  );
}
