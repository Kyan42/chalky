# chalky

Hold a key, ask a question out loud, and Chalky teaches it back by voice while visuals build on a
whiteboard. Cal Hacks 13.

This branch is the **first spike**: one hard-coded lesson beat, played end to end with real
Cartesia Sonic voice and a real Clayzo WebGL animation, inside a bare whiteboard layout. Findings
are in [`SPIKE_NOTES.md`](SPIKE_NOTES.md).

## Run it

Requires Node 22.13+.

```bash
npm install
cp .env.example .env.local     # then put your key in CARTESIA_API_KEY
npm run dev                    # http://localhost:3000
```

Click **Play**. Chalky says "Noise is a wave of air pressure, rising and falling." and the wave
starts drawing on the word "wave". Press **Space** to interrupt (the audio stops, the wave
freezes, the stage dims), and **Space** again to replay the beat from the start.

The key is read only by the server route (`app/api/tts/route.ts`) and never reaches the browser.
If `CARTESIA_API_KEY` is unset, the route calls Cartesia without an `Authorization` header. That
is for environments whose egress proxy injects the key, like the Claude Code cloud environment,
where the dev server must also run with `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses the proxy.

## Layout

| Path | What it is |
|---|---|
| `app/page.tsx`, `components/Whiteboard.tsx` | The whiteboard (topic bar, stage, evidence column, caption strip) and the beat loop: play, sync, interrupt, resume |
| `app/api/tts/route.ts`, `lib/sonic.ts` | Server route: Sonic SSE with word timestamps, re-streamed to the browser as NDJSON |
| `lib/audio/stream-player.ts` | Web Audio playback of streamed PCM; the audio clock everything follows |
| `lib/beat.ts` | Beat types, the hard-coded beat `b1`, word normalization, and `at` resolution |
| `lib/visuals/wave.ts` | The `wave.draw` Clayzo document, authored in TypeScript |
| `app/spike/clayzo/page.tsx` | Clayzo spike: coverage, seek precision, 6 players, document swap |
| `scripts/e2e.mjs`, `scripts/spike-clayzo.mjs` | Playwright runs that drive the app and record evidence into `docs/` |

## Verify

With the dev server running:

```bash
npx playwright install chromium     # once, if you don't have it
node scripts/e2e.mjs                # Play → Space → Space, plus an early interrupt; screenshots in docs/screenshots/
node scripts/spike-clayzo.mjs       # Clayzo measurements → docs/clayzo-spike-results.json
npx tsx scripts/author-wave.ts      # validates the wave document in Node
npm run typecheck
```

The Clayzo agent skills used to author the wave can be restored with
`npx skills experimental_install` (pinned in `skills-lock.json`).
