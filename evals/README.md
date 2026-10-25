# Evals

Every eval campaign in this repo gets documented here: model evals (comparing models on a fixed task) and system evals (measuring and improving the application itself). Reports are written blog-ready so they can be published with minimal editing. Frozen result snapshots live in `results/` so the run-level numbers in a report stay verifiable; each report states which of its figures are backed by a snapshot and which are recorded in prose only (smoke scores, vendor prices, prior-session baselines). Raw run artifacts in `eval-output/` are gitignored and regenerable.

## Reports

| Date | Type | Report | Headline |
| --- | --- | --- | --- |
| 2026-10-25 | Model | [DeepSeek V4.1 Flash vs GLM 5.3 Flash](model-evals/2026-10-25-workers-ai-chat-models.md) | DeepSeek's 503s exposed a search-cap bug (fixed in PR #72); on the fixed build 118/120 vs 117/120 at half the latency (p50 7.5 s vs 14.3 s); production switched to DeepSeek |
| 2026-10-25 | Model | [Embedder bake-off: BGE-M3](model-evals/2026-10-25-embedder-bge-m3.md) | Dense recall@3 0.990 vs 0.969, query embed p95 133 ms vs 4 s, indexing 13x faster; full battery 118/120 for both; BGE-M3 replaced Qwen3 at the same price |
| 2026-10-08 | System | [Pointer twin fix](system-evals/2026-10-08-pointer-twin-fix.md) | The coverage pass returned empty content 67% of the time; fixed: full battery 117/120 with 0 leaks (vs 115/120 twice on the [redesign build](system-evals/2026-10-08-redesign-verification.md)), q028 0/4 to 3/3, q088 1/4 to 3/3; new tuning set shows no measurable change (46/48 vs 47/48) |
| 2026-10-08 | System | [Redesign verification](system-evals/2026-10-08-redesign-verification.md) | 115/120 twice, 0 leaks; A/B finds no sign the redesign caused the gap from 118 |
| 2026-09-06 | System | [Pointer-triggered coverage](system-evals/2026-09-06-northwind-pointer-coverage.md) | Systemic fixes only: 116 to 118/120, no corpus-fitted logic |
| 2026-08-31 | System | [Northwind grounding repair](system-evals/2026-08-31-northwind-grounding-repair.md) | Live pass rate 72% to 95% (114/120) without touching a scorer |
| 2026-08-31 | Model | [Chat model bake-off](model-evals/2026-08-31-chat-model-bakeoff.md) | GLM 5.3 Flash confirmed: 114/120 at one ninth the price of its closest rival |

## Layout

```
evals/
  README.md            this index
  model-evals/         one report per model comparison campaign
  system-evals/        one report per application improvement campaign
  embedder-bakeoff/    harness for the dense-retrieval embedder comparison (eval-only Worker plus script)
  results/<date>/      frozen findings JSON backing each report
```

In the 2026-10-25 findings, a `questionsFile` of `<scratchpad>/...` means the repo copy: `search-budget-fix-check/questions.json` or `smoke-10-questions.json`.

The 2026-10-25 results are split by build:

```
results/2026-10-25-chat-models/
  (top level)                  pre-fix full runs, d9a0203, prompt v13: findings, checkpoint, summary and logs per model, plus the 10-question smoke
  fix-build-full/              final full runs on the fix build, e1e0432, prompt v14
  search-budget-fix-check/
    questions.json             the 19-question check set
    round1/                    soft cap only, 0cd4689
    strict/                    a later cap is hard, 5c61bea
    softcap/                   final rules, f050672
results/2026-10-25-embedder-bakeoff/
  summary.json, raw-*.json     Stage 1, dense retrieval per embedder
  full-battery-bge-m3/         Stage 2, full battery on a BGE-M3 index (d9a0203, dirty tree)
```

Conventions: reports are date-prefixed markdown, one file per campaign. Each report carries a TL;DR, the setup, results, what changed and why, honest caveats and exact reproduce commands. Never edit a published report's numbers; a new campaign gets a new file.

## Reproduce

The live Northwind eval needs the isolated eval worker and the seeded corpus generation:

```bash
npx wrangler dev --config workers/brain/wrangler.jsonc --port 8789 --persist-to .wrangler/state-eval
npm run eval:northwind -- --live http://127.0.0.1:8789                 # locked production model
npm run eval:northwind -- --live http://127.0.0.1:8789 --model <id>    # loopback-only candidate override
npm run eval:northwind -- --live http://127.0.0.1:8789 --model <id> --score-unavailable   # score a turn that stays 503 as a failure instead of stopping
npm run eval:northwind -- --live http://127.0.0.1:8789 --questions content/northwind/tuning-questions.json   # tuning set, not the locked 120
```

Results land in `eval-output/findings*.json`. `--score-unavailable` is recorded in the checkpoint and the findings; `--resume` only continues a run that used the same setting (any other mismatch starts over, with a stderr notice naming the differing fields) and asks the unavailable questions again. The 2026-10-25 frozen snapshots predate the `scoreUnavailable` and `latency.unavailable` fields; the pre-fix DeepSeek run and the BGE-M3 battery used the flag ("scored as a failure (--score-unavailable)" appears in their run logs). A `--questions` run lands in `eval-output/tuning/<file>/` so it can never be mistaken for, or resumed into, the locked run.
