# Evals

Every eval campaign in this repo gets documented here: model evals (comparing models on a fixed task) and system evals (measuring and improving the application itself). Reports are written blog-ready so they can be published with minimal editing. Frozen result snapshots live in `results/` so every number in a report stays verifiable; raw run artifacts in `eval-output/` are gitignored and regenerable.

## Reports

| Date | Type | Report | Headline |
| --- | --- | --- | --- |
| 2026-08-31 | System | [Northwind grounding repair](system-evals/2026-08-31-northwind-grounding-repair.md) | Live pass rate 72% to 95% (114/120) without touching a scorer |
| 2026-08-31 | Model | [Chat model bake-off](model-evals/2026-08-31-chat-model-bakeoff.md) | GLM 5.3 Flash confirmed: 114/120 at one ninth the price of its closest rival |

## Layout

```
evals/
  README.md            this index
  model-evals/         one report per model comparison campaign
  system-evals/        one report per application improvement campaign
  results/<date>/      frozen findings JSON backing each report
```

Conventions: reports are date-prefixed markdown, one file per campaign. Each report carries a TL;DR, the setup, results, what changed and why, honest caveats and exact reproduce commands. Never edit a published report's numbers; a new campaign gets a new file.

## Reproduce

The live Northwind eval needs the isolated eval worker and the seeded corpus generation:

```bash
npx wrangler dev --config workers/brain/wrangler.jsonc --port 8789 --persist-to .wrangler/state-eval
npm run eval:northwind -- --live http://127.0.0.1:8789                 # locked production model
npm run eval:northwind -- --live http://127.0.0.1:8789 --model <id>    # loopback-only candidate override
```

Results land in `eval-output/findings*.json`.
