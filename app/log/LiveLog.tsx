"use client";

/**
 * /log: recent lessons and, for the selected one, its decisions, beats with
 * timings, learner record and event stream. With NEXT_PUBLIC_CONVEX_URL it
 * subscribes to Convex (convex/lessons.ts lessonLive), so a running lesson
 * updates as its transcript posts arrive; without it, it polls the saved files
 * through GET /api/live-log every 2 s.
 */
import { ConvexProvider, ConvexReactClient, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import s from "./log.module.css";

type Row = Record<string, unknown> & { t?: number; kind?: string };

interface LessonSummary {
  lessonId: string;
  question: string;
  title: string;
  startedAt: string;
  end: string | null;
  eventCount: number;
  beatCount: number;
  updatedAt: number;
}

interface LearnerView {
  level: string;
  prior: string;
  focus: string;
  confusions: string[];
  replies?: string[];
  lessonIds?: string[];
  quizzes?: { kind: string; asked: string; answered: string; score: number; verdict?: string; skipped?: boolean }[];
}

interface LessonDetail {
  summary: LessonSummary & { askedVia: string; endedAt: string | null; build: string | null; learnerId: string | null };
  events: Row[];
  beats: Row[];
  learner: LearnerView | null;
  prefetch: Row | null;
  /** The learner merged across lessons (Convex only). */
  merged: LearnerView | null;
  memory: string;
}

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null;

export default function LiveLog() {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(new URLSearchParams(location.search).get("id")), []);
  const select = (id: string | null) => {
    setSelected(id);
    history.replaceState(null, "", id ? `?id=${id}` : location.pathname);
  };
  if (convex)
    return (
      <ConvexProvider client={convex}>
        <FromConvex selected={selected} select={select} />
      </ConvexProvider>
    );
  return <FromFiles selected={selected} select={select} />;
}

interface SourceProps {
  selected: string | null;
  select: (id: string | null) => void;
}

function FromConvex({ selected, select }: SourceProps) {
  const lessons = useQuery(api.lessons.recentLessons, {});
  const id = selected ?? lessons?.[0]?.lessonId ?? null;
  const live = useQuery(api.lessons.lessonLive, id ? { lessonId: id } : "skip");
  const learnerId = live?.lesson.learnerId ?? null;
  const memory = useQuery(api.learners.learnerMemory, learnerId && id ? { learnerId, before: id } : "skip");
  const detail = useMemo<LessonDetail | null>(() => {
    if (!live) return null;
    const { lesson } = live;
    return {
      summary: { ...lesson },
      events: live.events.map((e) => JSON.parse(e.json) as Row),
      beats: live.beats.map((b) => JSON.parse(b.json) as Row),
      learner: lesson.learner,
      prefetch: lesson.prefetch ? (JSON.parse(lesson.prefetch) as Row) : null,
      merged: live.learner,
      memory: memory ?? "",
    };
  }, [live, memory]);
  return (
    <View source="Convex · live subscription" lessons={lessons ?? null} id={id} pinned={!!selected} select={select} detail={detail} loading={live === undefined} />
  );
}

function FromFiles({ selected, select }: SourceProps) {
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null);
  const [raw, setRaw] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = selected ?? lessons?.[0]?.lessonId ?? null;
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/live-log", { cache: "no-store" });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? r.statusText);
        if (!stop) setLessons(body), setError(null);
      } catch (e) {
        if (!stop) setError(String((e as Error).message ?? e));
      }
    };
    void tick();
    const timer = setInterval(tick, 2000);
    return () => ((stop = true), clearInterval(timer));
  }, []);
  useEffect(() => {
    if (!id) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/live-log?id=${id}`, { cache: "no-store" }).catch(() => null);
      if (r?.ok && !stop) setRaw(await r.json());
    };
    void tick();
    const timer = setInterval(tick, 2000);
    return () => ((stop = true), clearInterval(timer));
  }, [id]);
  const detail = useMemo<LessonDetail | null>(() => {
    if (!raw || raw.id !== id) return null;
    const str = (x: unknown) => (typeof x === "string" ? x : "");
    const events = (raw.events as Row[]) ?? [];
    const beats = (raw.beats as Row[]) ?? [];
    return {
      summary: {
        lessonId: str(raw.id),
        question: str(raw.question),
        title: str(raw.title),
        startedAt: str(raw.startedAt),
        askedVia: str(raw.askedVia),
        endedAt: (raw.endedAt as string) ?? null,
        end: (raw.end as string) ?? null,
        build: null,
        learnerId: (raw.learnerId as string) ?? null,
        eventCount: events.length,
        beatCount: beats.length,
        updatedAt: lessons?.find((l) => l.lessonId === id)?.updatedAt ?? 0,
      },
      events,
      beats,
      learner: (raw.learner as LearnerView) ?? null,
      prefetch: (raw.prefetch as Row) ?? null,
      merged: null,
      memory: "",
    };
  }, [raw, id, lessons]);
  return (
    <View
      source="Saved files · polling every 2 s (no Convex deployment configured)"
      error={error}
      lessons={lessons}
      id={id}
      pinned={!!selected}
      select={select}
      detail={detail}
      loading={!!id && !detail}
    />
  );
}

// ---------- The page ----------

const secs = (ms: unknown) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)} s` : "–");
const millis = (ms: unknown) => (typeof ms === "number" ? `${Math.round(ms)} ms` : "–");
const clock = (iso: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }) : "");

function status(l: { end: string | null; updatedAt: number }) {
  if (l.end === "done") return <span className={`${s.badge} ${s.done}`}>done</span>;
  if (l.end === "stopped") return <span className={`${s.badge} ${s.stopped}`}>stopped</span>;
  if (l.end) return <span className={`${s.badge} ${s.error}`}>error</span>;
  return <span className={`${s.badge} ${s.live}`}>{Date.now() - l.updatedAt < 15_000 ? "live" : "open"}</span>;
}

interface ViewProps {
  source: string;
  error?: string | null;
  lessons: LessonSummary[] | null;
  id: string | null;
  pinned: boolean;
  select: (id: string | null) => void;
  detail: LessonDetail | null;
  loading: boolean;
}

function View({ source, error, lessons, id, pinned, select, detail, loading }: ViewProps) {
  return (
    <div className={s.page}>
      <header className={s.top}>
        <h1>Chalky · live log</h1>
        <span className={s.source}>{source}</span>
        {pinned ? (
          <button className={s.follow} onClick={() => select(null)}>
            Follow the newest lesson
          </button>
        ) : (
          <span className={s.source}>following the newest lesson</span>
        )}
      </header>
      {error && <p className={s.warn}>{error}</p>}
      <div className={s.cols}>
        <nav className={s.list}>
          {lessons === null && <p className={s.muted}>Loading…</p>}
          {lessons?.length === 0 && <p className={s.muted}>No lessons yet. Ask Chalky something on the home page.</p>}
          {lessons?.map((l) => (
            <button key={l.lessonId} className={`${s.item} ${l.lessonId === id ? s.on : ""}`} onClick={() => select(l.lessonId)}>
              <span className={s.itemTitle}>{l.title || l.question || l.lessonId}</span>
              <span className={s.itemMeta}>
                {status(l)} {day(l.startedAt)} {clock(l.startedAt)} · {l.eventCount} events · {l.beatCount} beats
              </span>
            </button>
          ))}
        </nav>
        <main className={s.detail}>
          {!id && <p className={s.muted}>Pick a lesson.</p>}
          {id && loading && <p className={s.muted}>Loading {id}…</p>}
          {detail && <Detail d={detail} />}
        </main>
      </div>
    </div>
  );
}

function Detail({ d }: { d: LessonDetail }) {
  const { summary: l, events, beats } = d;
  const decisions = events.filter((e) => ["intake-decision", "reply", "detour", "replan", "check-in-settled"].includes(String(e.kind)) || e.role === "intake" || e.role === "bridge");
  const last = events.at(-1)?.t;
  return (
    <>
      <section className={s.head}>
        <h2>{l.title || "(untitled yet)"}</h2>
        <p className={s.question}>“{l.question}”</p>
        <p className={s.meta}>
          {status(l)} asked by {l.askedVia || "?"} · started {day(l.startedAt)} {clock(l.startedAt)}
          {l.endedAt ? ` · ended ${clock(l.endedAt)}` : typeof last === "number" ? ` · ${secs(last)} in` : ""}
          {l.end && l.end !== "done" && l.end !== "stopped" ? ` · ${l.end}` : ""}
          {l.build ? ` · build ${l.build}` : ""}
          {l.learnerId ? ` · learner ${l.learnerId}` : ""}
          <span className={s.id}> · {l.lessonId}</span>
        </p>
      </section>

      <section>
        <h3>Intake and reply decisions ({decisions.length})</h3>
        {decisions.length === 0 ? <p className={s.muted}>None yet.</p> : <EventTable rows={decisions} />}
      </section>

      <section>
        <h3>Beats played ({beats.length})</h3>
        {beats.length === 0 ? <p className={s.muted}>None yet.</p> : <BeatTable beats={beats} />}
        {d.prefetch && (
          <p className={s.meta}>
            Prefetch: {Object.entries(d.prefetch).map(([k, v]) => `${k} ${v}`).join(" · ")}
          </p>
        )}
      </section>

      <section className={s.learnerCols}>
        <div>
          <h3>Learner, this lesson</h3>
          {d.learner ? <Learner l={d.learner} /> : <p className={s.muted}>Not sent yet (the record arrives with the final post).</p>}
        </div>
        {(d.merged || d.memory) && (
          <div>
            <h3>Learner across lessons</h3>
            {d.merged && <Learner l={d.merged} />}
            {d.memory && <pre className={s.memory}>{d.memory}</pre>}
          </div>
        )}
      </section>

      <section>
        <h3>Event stream ({events.length})</h3>
        <EventTable rows={events} />
      </section>
    </>
  );
}

function Learner({ l }: { l: LearnerView }) {
  return (
    <dl className={s.learner}>
      <dt>level</dt>
      <dd>{l.level}</dd>
      <dt>prior</dt>
      <dd>{l.prior || "–"}</dd>
      <dt>focus</dt>
      <dd>{l.focus || "–"}</dd>
      <dt>stuck on</dt>
      <dd>{l.confusions.length ? <ol>{l.confusions.map((c, i) => <li key={i}>{c}</li>)}</ol> : "–"}</dd>
      {!!l.quizzes?.length && (
        <>
          <dt>quizzes</dt>
          <dd>
            <ol>
              {l.quizzes.map((z, i) => (
                <li key={i}>
                  {z.kind}: {z.skipped ? "skipped" : z.verdict ?? `${Math.round(z.score * 100)}%`} · “{z.asked}”{z.answered ? ` → “${z.answered}”` : ""}
                </li>
              ))}
            </ol>
          </dd>
        </>
      )}
      {l.replies && (
        <>
          <dt>replies</dt>
          <dd>{l.replies.length ? <ol>{l.replies.map((r, i) => <li key={i}>“{r}”</li>)}</ol> : "–"}</dd>
        </>
      )}
      {l.lessonIds && (
        <>
          <dt>lessons</dt>
          <dd>{l.lessonIds.length}</dd>
        </>
      )}
    </dl>
  );
}

function BeatTable({ beats }: { beats: Row[] }) {
  return (
    <div className={s.scrollX}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>beat</th>
            <th>mode</th>
            <th>start</th>
            <th>first sound</th>
            <th>played</th>
            <th>prefetched</th>
            <th>drawing</th>
            <th>draw time</th>
            <th>late</th>
            <th>interrupted</th>
            <th>says</th>
          </tr>
        </thead>
        <tbody>
          {beats.map((b, i) => (
            <tr key={i} className={b.interrupted ? s.cut : ""}>
              <td className={s.mono}>{String(b.beatId ?? "")}</td>
              <td>{String(b.mode ?? "")}</td>
              <td className={s.num}>{secs(b.startMs)}</td>
              <td className={s.num}>{millis(b.firstSoundMs)}</td>
              <td className={s.num}>{secs(b.playedMs)}</td>
              <td>{b.prefetched ? (b.fromMemory ? "yes, memory" : "yes") : "no"}</td>
              <td className={s.nowrap}>
                {String(b.draw ?? "–")}
                {b.drawModel ? <span className={s.muted}> · {String(b.drawModel).replace(/^claude-/, "")}</span> : null}
                {b.drawError ? <span className={s.errText}> · {String(b.drawError)}</span> : null}
              </td>
              <td className={s.num}>{millis(b.drawMs)}</td>
              <td className={s.num}>{typeof b.drawLateSec === "number" ? `${b.drawLateSec} s` : "–"}</td>
              <td>{b.interrupted ? `at word ${b.atWord ?? "?"}` : ""}</td>
              <td className={s.say}>{String(b.say ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One line about an event: who said or decided what. */
function describe(e: Row): string {
  const q = (x: unknown) => (typeof x === "string" && x ? `“${x}”` : "");
  const extra = (keys: string[]) =>
    keys
      .filter((k) => e[k] !== undefined && e[k] !== null && e[k] !== "")
      .map((k) => `${k} ${typeof e[k] === "object" ? JSON.stringify(e[k]) : String(e[k])}`)
      .join(" · ");
  switch (e.kind) {
    case "learner":
      return `${e.role ?? ""} (${e.via ?? "?"}${e.beatId ? `, during ${e.beatId}` : ""}): ${q(e.text)}`;
    case "say":
      return `${e.role ?? ""}: ${q(e.text)}${e.model ? ` · ${String(e.model).replace(/^claude-/, "")}` : ""}${typeof e.ms === "number" ? ` ${e.ms} ms` : ""}`;
    case "planned":
      return `${e.beatId} ${e.mode} scene ${e.scene}${e.check ? " check-in" : ""}${e.by ? ` (by ${e.by})` : ""}: ${q(e.say)}`;
    case "beat":
      return `${e.beatId} played ${secs(e.playedMs)}, first sound ${millis(e.firstSoundMs)}, drawing ${e.draw ?? "–"}${e.interrupted ? `, cut at word ${e.atWord}` : ""}`;
    case "intake-decision":
      return `${e.skipped ? "skipped" : e.amend ? "amend the plan" : "keep the plan"} · ${extra(["note", "decideMs", "error"])}`;
    case "reply":
      return `${e.level ?? ""} → ${e.resume ?? ""}: ${q(e.text)}${e.plannerNote ? ` · note: ${e.plannerNote}` : ""}`;
    case "replan":
      return `from beat ${e.fromBeat ?? e.from}${e.intake ? " (after the intake)" : ""}${e.note ? `: ${e.note}` : ""}`;
    case "detour":
      return `at beat ${e.at}: ${Array.isArray(e.beats) ? e.beats.map((b: Row) => b.beatId).join(", ") : ""}`;
    case "plan-title":
      return q(e.title);
    case "quiz-start":
      return `${e.quiz} on ${e.beatId ?? "–"}: ${q(e.ask)}`;
    case "quiz-result":
      return `${e.quiz}: ${e.verdict ?? `${Math.round(Number(e.score) * 100)}%`}${e.skipped ? " (skipped)" : ""} · ${q(e.answered)} → ${q(e.feedback)}${e.model ? ` · ${String(e.model).replace(/^claude-/, "")}` : ""}${typeof e.ms === "number" ? ` ${e.ms} ms` : ""}`;
    case "quiz-skipped":
      return `${e.quiz} on ${e.beatId ?? "–"}${e.said ? `: ${q(e.said)}` : ""}`;
    case "quiz-fallback":
      return `${e.from} → ${e.to}: ${e.why ?? ""}`;
    case "end":
      return String(e.end ?? "");
    default: {
      const rest = Object.fromEntries(Object.entries(e).filter(([k]) => k !== "t" && k !== "kind"));
      const text = JSON.stringify(rest);
      return text.length > 260 ? `${text.slice(0, 259)}…` : text;
    }
  }
}

function EventTable({ rows }: { rows: Row[] }) {
  return (
    <table className={`${s.table} ${s.events}`}>
      <tbody>
        {rows.map((e, i) => (
          <tr key={i} className={s[`k_${String(e.kind).replace(/-/g, "_")}`] ?? ""}>
            <td className={s.num}>{secs(e.t)}</td>
            <td className={s.kind}>{String(e.kind)}</td>
            <td>{describe(e)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
