# Chat model bake-off: seven Cloudflare-hosted models on a grounded-citation task

Date: 2026-08-31. Repo: Useful Brain. Eval: 120-question Northwind live battery.

## TL;DR

We ran every plausible Cloudflare-hosted chat model through the same grounded RAG agent: retrieve with tools, quote evidence verbatim, cite every sentence, refuse when the evidence isn't there. GLM 5.3 Flash, the incumbent, won on the merits: it tied its full-size sibling on the best pass rate and the 5/5 expanded multi-hop slice, edged it on locked multi-hop (4/5 vs 3/5), and costs roughly one ninth as much. The surprise was how much the task shape mattered. Two frontier-scale models never made it past a ten-question smoke because they couldn't drive the tool loop or answer within a usable latency.

| Model | Pass | Multi-hop | Retrieved recall | Latency p50 / p95 | Price $/M in / out |
| --- | --- | --- | --- | --- | --- |
| GLM 5.3 Flash (incumbent) | **114/120 (95.0%)** | 9/10 | 0.974 | 15.6s / 56.3s | 0.15 / 0.50 |
| GLM 5.3 (full) | 114/120 (95.0%) | 8/10 | 0.969 | 15.3s / 56.0s | 1.40 / 4.40 |
| DeepSeek V4 Flash | 109/120 (90.8%) | 6/10 | 0.943 | 11.2s / 35.9s | 0.44 / 1.32 |
| Gemma 4 26B | 105/120 (87.5%) | 6/10 | 0.928 | 17.9s / 56.8s | 0.10 / 0.30 |
| DeepSeek V4 Pro | 105/120 (87.5%) | 6/10 | 0.933 | 14.9s / 82.3s | 1.32 / 3.96 |

Prices are Cloudflare Workers AI list pricing as documented on 2026-08-31, not measured spend. Frozen per-model evidence: [`results/2026-08-31/`](../results/2026-08-31/).

## Method

Fairness was the whole design. Every model ran the identical agent loop, prompt, retrieval stack, corpus generation and decoding parameters (temperature 0, pinned seed, thinking disabled on quote-extraction calls where the model schema allows it). Model selection happened through a loopback-only `evalModel` override on the turn endpoint, gated by a fixed allowlist and rejected outside the local trust boundary, so the locked production selection never changed during the experiment. The harness fails closed if the backend answers with a different model than requested, and per-model checkpoints pin the exact pipeline build so results from different code states can't mix. All runs scored all 120 questions under each question's principal with zero skips and zero forbidden-document retrievals; one turn in the DeepSeek V4 Flash run degraded to keyword-only retrieval after a vector-channel error, and the harness flags that run as not baseline-comparable on retrieval.

Each candidate first ran a ten-question smoke (factual, trap, permission, unanswerable, multi-hop and identifier lookups). Models with broken tool-calling, JSON discipline or refusal behavior were recorded and dropped; survivors ran all 120 questions.

## Who didn't make the full run

- **gpt-oss-120b**: no chat-completions tool schema on Workers AI, so it can't drive the `search_knowledge` loop through the OpenAI-compatible adapter at all.
- **Llama 4 Scout**: 5/10 on the smoke. It skipped the search tool and returned refusals in under a second, consistent with its legacy input schema on this platform.
- **Kimi K2.6**: 6/10 on the smoke with answers taking up to 131 seconds and a burst of remote-binding errors during its window. Unusable latency for this loop.

That's the quiet lesson: a leaderboard-strong model is worth nothing on an agentic task if the serving platform's schema can't carry the tool loop.

## What separated the finishers

- **Multi-hop completeness** was the sharpest discriminator. The scoring rule requires citing every gold document, and only the two GLM models stayed at or above 8/10 (both 5/5 on the expanded slice). Both DeepSeeks and Gemma repeatedly answered one hop well and dropped the second citation.
- **Identifier lookups** (error codes, clause numbers, SKU-style names) broke the non-GLM models most often. Four questions (q073, q100, q105, q110) failed for every finisher, which tells us part of the remaining gap belongs to the corpus and the answer discipline around it, not the model choice.
- **Abstention discipline held everywhere.** Every finisher scored 10/10 on unanswerable questions and at least 11/13 on permission questions, with zero forbidden-document retrievals across all 600 scored turns. The host-side grounding validator deserves most of that credit; it refuses anything it can't verify verbatim regardless of which model wrote it.
- **DeepSeek V4 Flash is the latency pick.** Fastest by a wide margin (p95 35.9s vs 56s+) at a respectable 90.8%, with the one-degraded-turn caveat above attached to its retrieval numbers. If the production 15s p95 answer budget ever becomes binding, it's the named alternative.

## Decision

Keep GLM 5.3 Flash. Equal-best quality (it ties GLM 5.3 on the total and the expanded multi-hop slice and edges it on locked multi-hop), lowest cost of the top tier. The full GLM 5.3 offers nothing here for nine times the price. The production selection stays locked; this report is the recorded evidence behind that choice.

## Honest caveats

- The five full runs executed in parallel against one local worker, so latency numbers include contention. A solo GLM segment measured p50 ~19.6s, so treat latency columns as relative, not absolute.
- Reasoning models on this stack are not fully deterministic even at temperature 0 with a pinned seed. Category totals are stable; individual questions can flip.
- Citation broadening stays visible: grounded answers citing documents outside the gold set numbered 9 (GLM Flash), 8 (GLM full), 4 (DeepSeek Flash), 6 (DeepSeek Pro) and 9 (Gemma) out of 120, recorded as `citedNotExpectedCount` in each frozen findings file.
- The three smoke-only results (gpt-oss-120b, Llama 4 Scout, Kimi K2.6) are recorded in this prose and the execution tracker, not as frozen snapshots.
- Total gross Workers AI spend for the campaign (seven smokes plus five full runs) stayed in the low single-digit dollars against the documented unit prices, far inside the monthly safety boundary. The harness bounds cost by price table rather than metering tokens per run.

## Reproduce

```bash
npx wrangler dev --config workers/brain/wrangler.jsonc --port 8789 --persist-to .wrangler/state-eval
npm run eval:northwind -- --live http://127.0.0.1:8789 --model "@cf/google/gemma-4-26b-a4b-it"
```

The allowlist of accepted model ids lives in `src/lib/models/eval-override.ts`.
