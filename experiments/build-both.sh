#!/usr/bin/env bash
# tsc and the production build with each provider set (MODEL_PROVIDER in the environment wins over .env.local).
#   bash experiments/build-both.sh > experiments/build-both.log 2>&1
for p in openai anthropic; do
  echo "=== MODEL_PROVIDER=$p"
  rm -rf .next
  MODEL_PROVIDER=$p npx tsc --noEmit -p . && echo "tsc ok"
  MODEL_PROVIDER=$p npm run build 2>&1 | grep -E "Compiled|Failed|rror" | head -5
done
rm -rf .next
