# Mounting the source cards in the lesson page

For the owner of `components/Lesson.tsx`. Two additions, nothing removed. This exact change (with
a dev-only `fixture` prop added) was applied and run once on 2026-10-24 against `/lesson?fixture=why-is-the-sky-blue`:
the sources request went out after the plan's title event and came back from the cache; then it
was reverted.

**Where:** the old "Sources will appear here" placeholder is gone from `Lesson.tsx` since the tutor
UI port (it survives only in the unused `components/Whiteboard.tsx`), and the `.evidence` aside is
the debug telemetry panel, hidden unless `?debug=1`. So the cards go **inside `<section
className="stage">`**, after the mascot block: the stage is `position: relative`, and the cards pin
themselves to its top-right corner (`layout="overlay"`, the default), visible in the normal view.

**When the fetch starts:** the component starts it itself once `title` is a real plan title (it
waits while the title is "" or "Planning…"), i.e. on the plan's `title` event, in the background.
Nothing else to call; a new question starts a new fetch.

```diff
 import { Orb, type OrbState } from "@/components/Orb";
+import { SourceCards } from "@/components/SourceCards";
```

```diff
               <video key={mascotSource} className="tutor-mascot" src={mascotSource} autoPlay muted loop playsInline aria-label={speakingAudio ? "Chalky talking" : "Chalky thinking"} />
             </div>
           )}
+          {/* Real web sources (lib/sources/MOUNT.md): fetched in the background once the plan has a title. */}
+          {question && (
+            <SourceCards question={question} title={title} beats={beats.map((b) => b.beat)} currentBeatId={beats[current]?.beat.id ?? ""} onEvent={(e) => logRef.current(e)} />
+          )}
         </section>
         <aside className="evidence lesson-beats" data-testid="telemetry" aria-hidden={!debug}>
```

Props, from state the component already has: `question` (state), `title` (state; "Planning…"
until the title event), `beats` (the `BeatState[]` state, mapped to `PlannedBeat`), `currentBeatId`
(`beats[current]`), `onEvent` → `logRef.current`, so `sources-*` events land in the transcript
(`logEv` itself lives inside the lesson effect; `logRef` is the render-side handle to it).

Cost when there are no sources: no `APIFY_TOKEN` and no cache file → one POST that answers
"no-token" in a few ms, then the component renders nothing.

Check after applying: `/lesson?fixture=why-is-the-sky-blue` with a cached question shows the cards
top right a moment after the title; `?debug=1` shows `sources-cached` in the transcript events.
The debug panel, when open, sits over the same corner (it is `z-index: 5`, the cards `3`).
