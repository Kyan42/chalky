#!/usr/bin/env bash
# Waits for the dev server and compiles every route the lesson uses (cheap 400s), so timings aren't cold.
BASE=${BASE_URL:-http://localhost:3004}
for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 120 "$BASE/lesson"); [ "$c" = "200" ] && break; sleep 2; done
for r in tts converse plan opener draw layout amend reply live-log; do curl -s -o /dev/null --max-time 120 -X POST -H "Content-Type: application/json" -d '{}' "$BASE/api/$r"; done
curl -s -o /dev/null "$BASE/api/fixture?name=why-is-the-sky-blue&beats=1"; curl -s -o /dev/null -X POST "$BASE/api/cartesia/token"
echo "warm ($c)"
