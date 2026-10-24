"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Orb } from "@/components/Orb";
import { unlockAudio } from "@/lib/voice/audio";

type Pending = { kind: "pdf"; file: File } | { kind: "url"; url: string };

export default function Home() {
  const router = useRouter();
  const createSession = useMutation(api.sessions.create);
  const uploadUrl = useMutation(api.sources.generateUploadUrl);
  const addPdf = useMutation(api.sources.addPdf);
  const addUrl = useMutation(api.sources.addUrl);
  const recent = useQuery(api.sessions.list);

  const [sources, setSources] = useState<Pending[]>([]);
  const [link, setLink] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const addLink = () => {
    try {
      const url = new URL(link.trim());
      setSources((all) => [...all, { kind: "url", url: url.toString() }]);
      setLink("");
    } catch {
      setError("That doesn't look like a link.");
    }
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      // Unlock audio and ask for the mic now, while we have the click.
      await unlockAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());

      const sessionId = await createSession({});
      for (const source of sources) {
        if (source.kind === "url") {
          await addUrl({ sessionId, url: source.url });
        } else {
          const url = await uploadUrl({});
          const response = await fetch(url, { method: "POST", headers: { "Content-Type": source.file.type || "application/pdf" }, body: source.file });
          const { storageId } = await response.json();
          await addPdf({ sessionId, storageId, title: source.file.name.replace(/\.pdf$/i, "") });
        }
      }
      router.push(`/s/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="px-6 py-4 text-lg font-extrabold tracking-tight">chalky</header>
      <section className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-16 text-center">
        <Orb state={starting ? "thinking" : "idle"} levels={() => ({ mic: 0, agent: 0 })} size={220} />
        <div className="space-y-3">
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Learn anything through animation</h1>
          <p className="mx-auto max-w-xl text-lg text-[var(--muted)]">
            Tell Chalky what you want to learn. It builds an animated lesson chapter by chapter, talks you through it, and lets you draw and ask questions on any frame.
          </p>
        </div>

        <div className="w-full max-w-xl space-y-3">
          <div className="flex gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && link && addLink()}
              placeholder="Paste a link to learn from (optional)"
              className="flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            />
            <button className="rounded-full border border-[var(--border)] px-4 text-sm hover:bg-white/5" onClick={() => (link ? addLink() : fileInput.current?.click())}>
              {link ? "Add link" : "+ PDF"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])].map((file) => ({ kind: "pdf" as const, file }));
                setSources((all) => [...all, ...files]);
                e.target.value = "";
              }}
            />
          </div>
          {sources.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {sources.map((source, i) => (
                <span key={i} className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs">
                  {source.kind === "pdf" ? `📄 ${source.file.name}` : `🔗 ${new URL(source.url).hostname}`}
                  <button aria-label="Remove" onClick={() => setSources((all) => all.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => void start()}
          disabled={starting}
          className="rounded-full bg-[var(--foreground)] px-8 py-4 text-lg font-semibold text-black shadow-lg transition-transform hover:scale-[1.02]"
        >
          {starting ? "Starting…" : "Start talking"}
        </button>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        {recent && recent.length > 0 && (
          <div className="w-full max-w-xl pt-6 text-left">
            <h2 className="mb-2 text-xs font-semibold tracking-widest text-[var(--muted)] uppercase">Recent lessons</h2>
            <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
              {recent
                .filter((s) => s.topic)
                .slice(0, 6)
                .map((s) => (
                  <li key={s._id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <Link href={`/s/${s._id}`} className="truncate hover:underline">
                      {s.topic}
                    </Link>
                    <Link href={`/s/${s._id}/replay`} className="text-[var(--muted)] hover:text-white">
                      Replay
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
