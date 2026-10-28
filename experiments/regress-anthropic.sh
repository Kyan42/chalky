#!/usr/bin/env bash
# The mic-driven checks on the default (Anthropic) path, one after another, for the provider adapter.
#   bash experiments/regress-anthropic.sh > experiments/regress-anthropic.log 2>&1
export BASE_URL=${BASE_URL:-http://localhost:3006}
export LIVE_RUNS=experiments/live-runs
bash scripts/warm.sh > /dev/null 2>&1
curl -s -o /dev/null "$BASE_URL/lesson"
curl -s -o /dev/null "$BASE_URL/_next/static/chunks/app/lesson/page.js"
echo "=== e2e-quiz-cadence (fixture, answer)"
MODE=answer node scripts/e2e-quiz-cadence.mjs
echo "=== end-lesson-voice"
node experiments/end-lesson-voice.mjs
echo "=== slow-mode-page"
DRAW=slow node experiments/slow-mode-page.mjs
echo "=== e2e-research (CRISPR, real lesson, cached lookup)"
RUN=crispr-provider node scripts/e2e-research.mjs
