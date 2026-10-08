#!/bin/bash
# Usage: tuning-run.sh <label> <repeats> <file stem> [port]
#   stem: tuning-questions or tuning-abstention-questions; port defaults to 8791.
# Runs the live harness on a tuning file against an eval Brain and copies each repeat here.
set -e
cd "$(dirname "$0")/../../.."
OUT=evals/results/2026-10-08-quality
STEM="$3"
PORT="${4:-8791}"
mkdir -p "$OUT"
for i in $(seq 1 "$2"); do
  npx jiti src/lib/eval/live-northwind-eval.ts --live "http://127.0.0.1:$PORT" --questions "content/northwind/$STEM.json" > /dev/null 2> "$OUT/$STEM-$1-r$i.log"
  cp "eval-output/tuning/$STEM/findings.json" "$OUT/$STEM-$1-r$i-findings.json"
  cp "eval-output/tuning/$STEM/live-summary.json" "$OUT/$STEM-$1-r$i-live-summary.json"
  python3 -c "import json;d=json.load(open('$OUT/$STEM-$1-r$i-findings.json'));l=d['live'];print('$1 r$i', l['passed'],'/',l['scored'], [f['questionId'] for f in d['failures']], d.get('pipelineVersion'))"
done
