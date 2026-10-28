#!/usr/bin/env bash
# The OpenAI lessons for docs/openai.md, on a dev server started with MODEL_PROVIDER=openai, one after another:
# photosynthesis and "why is the sky blue" (real lessons, voice), the cached CRISPR research lesson, and "I'm done".
#   bash experiments/openai-lessons.sh > experiments/openai-lessons.log 2>&1
export BASE_URL=${BASE_URL:-http://localhost:3006}
export LIVE_RUNS=experiments/live-runs
bash scripts/warm.sh > /dev/null 2>&1
curl -s -o /dev/null "$BASE_URL/lesson"
curl -s -o /dev/null "$BASE_URL/_next/static/chunks/app/lesson/page.js"
echo "=== photosynthesis"
REAL="How does photosynthesis work?" SOCRATIC=1 node scripts/e2e-quiz-cadence.mjs
echo "=== why is the sky blue"
REAL="Why is the sky blue?" SOCRATIC=1 node scripts/e2e-quiz-cadence.mjs
echo "=== CRISPR (research, cached)"
RUN=crispr-openai node scripts/e2e-research.mjs
echo "=== I'm done"
node experiments/end-lesson-voice.mjs
