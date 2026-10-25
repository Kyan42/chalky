# Mobile lesson experience

Mobile uses the same `/lesson` component, planner, voice interruption, drawing,
preferences, ending and history as desktop. There is no separate mobile lesson
engine. `app/mobile.css` adjusts phones/tablets and short touch-screen landscape
windows; desktop styling remains in `globals.css`.

- Safe-area padding and `100dvh` accommodate browser chrome and notches.
- The board retains its 3:2 coordinate space, so strokes and cursor targets align.
- Portrait puts the captions and voice controls below the board. Short landscape
  windows put them alongside it. Controls have at least 44px touch areas.
- Settings and recap dialogs scroll; 16px form fields avoid automatic input zoom.
- Both audio contexts are unlocked from the initial tap before network awaits.
  If the OS interrupts audio, a tap-to-resume action resumes both clocks.
- Microphone access needs HTTPS on a phone. `http://localhost` is only trusted on
  the device itself; a phone visiting a computer's LAN IP over HTTP cannot use
  the microphone. Use the team's HTTPS preview/production URL for hardware tests.

## Convex and history

Phone sessions use the existing `/api/live-log` → `mirrorLesson` →
`lessons.upsertLesson` path, with the same `chalky_learner` cookie. Switching apps
flushes the current transcript without marking the lesson closed. A page exit
still records `closed`; explicit lesson endings retain their existing end value.
No Convex schema or deployed function change is required for the mobile layout.

The Learning history feature is browser-local IndexedDB. It is not a UI over the
Convex log tables, and a phone has a different cookie and local history than a
laptop. Cross-device history will require an authenticated learner identity and
scoped history reads; sharing a viewport or a voice does not create that link.
The Convex mirror currently logs errors server-side; a local "saved" message is
not confirmation of a successful Convex write. Existing large closing-beacon
markers require file logging to merge; periodic full saves remain important.

## Verification

`npx tsx --test scripts/mobile-audio.test.ts`

`BASE_URL=http://localhost:3002 node scripts/e2e-mobile.mjs`

The browser suite exercises Chromium and WebKit at 320×568, 390×844, 412×915,
768×1024, 844×390 and 1440×900. It uses fixture TTS/STT/model responses with the
real audio graph, player, UI and local history. It checks voice start, mute,
recovery from audio suspension, background transcript saving, preferences,
recaps, and element geometry. Screenshots go to `/tmp/chalky-mobile`.

Before shipping to users, test real microphone permission, acoustic echo/voice
interruption, a phone call/app switch, screen lock and a weak connection on an
actual iPhone and Android device through HTTPS. Browser emulation does not prove
hardware-specific microphone or OS background behavior.
