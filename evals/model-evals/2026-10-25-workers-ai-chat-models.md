# DeepSeek V4.1 Flash against GLM 5.3 Flash, and the search cap it exposed

Date: 2026-10-25. Repo: Useful Brain. Eval: the 120-question Northwind live battery.

## TL;DR

Cloudflare added new chat models since our [August bake-off](2026-08-31-chat-model-bakeoff.md). The strongest candidate was DeepSeek V4.1 Flash (released 2026-10-17): cheaper than V4 Flash, the fastest model in August, with tool calling and a reasoning switch. On the first run it lost two questions to HTTP 503s that GLM 5.3 Flash, our production model, almost never hit.

The cause was our own agent, not the model: a model that wanted a fifth search hit the per-turn search cap, and the host counted the blocked call as a failed backend search. That is fixed and merged ([PR #72](https://github.com/wasimjalali/useful-brain/pull/72)). On the fixed build DeepSeek scored 118/120 against GLM's 117/120 and answered in half the time, at about 2.4 times the token price. DeepSeek V4.1 Flash is now the production chat model.

| | GLM 5.3 Flash | DeepSeek V4.1 Flash |
| --- | --- | --- |
| Full battery, before the fix | **118/120** | 116/120 (2 of the misses were 503s) |
| Full battery, on the fix (prompt v14) | 117/120 | **118/120** |
| Latency p50 / p95, before the fix | 12.0 s / 37.3 s | **6.9 s / 25.2 s** |
| Latency p50 / p95, on the fix | 14.3 s / 41.4 s | **7.5 s / 20.4 s** |
| Unavailable (503) turns, on the fix | **0** | 1 (q071) |
| Price per M tokens, in / out | **$0.15 / $0.50** | $0.30 / $1.20 |
| Forbidden-document leaks | 0 | 0 |

Prices are Workers AI list prices on 2026-10-25.

## Candidates

The Workers AI catalog had 73 models on 2026-10-25. New Cloudflare-hosted chat models since August, all with tool calling: DeepSeek V4.1 Flash, Qwen 3.8 27B ($0.45 / $3.20), Nemotron 3 Super 120B ($0.50 / $1.50), Kimi K2.7 Code ($0.95 / $4.00, reasoning always on) and the official DeepSeek V4 Flash 0731. Clef, Cloudflare's new decision-model family, takes a state and a schema of typed questions rather than running a tool loop, so it doesn't fit. Wasim chose to run only DeepSeek V4.1 Flash, the top pick on price, speed and lineage.

DeepSeek V4.1 Flash's Workers AI schema matches V4 Flash's (the August finisher), so the only code change was one line in the eval allowlist.

## Method

Same harness as August: the loopback-only `evalModel` override, identical prompts, retrieval, corpus and decoding, temperature 0 and a pinned seed on extraction calls. Two changes. First, models ran one at a time, never in parallel, because August's parallel runs muddied latency. Second, a new opt-in `--score-unavailable` flag scores a turn that returns 503 on all four retries as a failure instead of stopping the run. Without it, DeepSeek's run stopped twice (q069, q074) and could never finish.

DeepSeek first ran a 10-question smoke (factual, trap, permission, unanswerable, both multi-hop slices and q100, an identifier lookup every model failed in August). It passed 10/10 with p50 8.9 s, so it ran the full battery.

## The bug DeepSeek found

GLM's full run had 3 turn attempts return 503, all recovered on retry. DeepSeek had 21, and two questions failed all four retries. Workers AI health records showed equal timeouts for both models (6 each) and zero call failures, so the platform wasn't the cause.

A debugger agent replayed q069 against live Workers AI through the real agent loop and found it in two tries. The agent caps `search_knowledge` at four calls per turn. On permission questions, where the asker can't read the relevant document, every search comes back weak. GLM gives up after one to three searches and refuses. DeepSeek rephrases and asks for a fifth. The cap blocked it with `terminate: true`, pi-agent-core recorded the blocked call as an error result, and the host's `searchFailed` check read that as a failed backend search. So the turn returned `BRAIN_KNOWLEDGE_UNAVAILABLE`, and an answerable or refusable question became a 503.

The fix took nine commits and a long review. A first version made the cap soft so the model answers from its four searches. Review then found that this let a capped turn answer a permission trap from off-topic documents, that a model looping after the cap was reported as an honest refusal, that host repair passes could overturn a capped refusal, and that a non-search call at the tool limit could hide a looper. The final rules:

- A cap in a search-only message is soft. The model gets a plain status, with no instructions inside a tool result. The rule (answer only from evidence that states the asked fact, otherwise refuse) lives in the system prompt, now `grounded-answer.v14`.
- After a cap, no host pass may create or rewrite an answer. The model's draft stands only if it validates as-is.
- Mixed messages, real search errors, colliding ids, any hard budget block and a turn-limit cut-off all fail closed as unavailable.

Live, on the 19 hardest questions (13 permission, 5 expanded multi-hop, q028):

| Version | DeepSeek V4.1 Flash | GLM 5.3 Flash |
| --- | --- | --- |
| Round 1 (soft cap only) | 16/19, 0 unavailable | 17/19, 0 unavailable |
| Strict (a later cap is hard) | 12/19, 5 unavailable | 15/19, 0 unavailable |
| Final (soft cap in any search-only message) | 16/19, 0 unavailable | 17/19, 0 unavailable |
| Final build, full 120 questions | 118/120, 1 unavailable | 117/120, 0 unavailable |

The strict version is the instructive row. Treating a second capped search as a failure looked safe in review, but DeepSeek ignores the budget status once and searches again, so five permission questions went back to 503. The final rules give it room to change course and still bound loopers with the tool and turn limits.

## Decision

On the fixed build the accuracy gap closed: DeepSeek 118/120 (misses q071, one turn still unavailable, and q090) against GLM 117/120 (q028, q073, q075). One question either way is inside run-to-run noise. Speed is not: DeepSeek answered about twice as fast in every run today, at p50 and p95. Price goes the other way, about 2 to 2.4 times per token, which is cents at portfolio volume.

Wasim switched production to DeepSeek V4.1 Flash. The answer time a visitor feels is the product's weakest point, and this halves it without giving up accuracy. GLM 5.3 Flash stays on the eval allowlist as the comparison point. The switch sends exactly the request the eval measured: GLM's Workers AI chat descriptor with the model id swapped, and thinking off on extraction calls.

The one remaining unavailable turn (q071) can't be attributed after the fact, because eval turns aren't persisted. It is either a fail-closed budget path working as designed or a Workers AI timeout.

## Honest caveats

- One full run per model per build. Single questions flip between runs: q028, q074, q075 and q085 have all changed outcome across today's runs without code changes touching them.
- q074 (an engineer asks for final pay rules they can't read) sometimes gets a grounded answer from off-topic readable documents on both models, even with host rewrites off after a cap. That's model behaviour, not the fix. No forbidden document was retrieved or cited in any run.
- On the fix build, a capped multi-hop turn can now end as a refusal where host repair used to complete it (DeepSeek's q117). That's the cost of never letting the host write an answer after a cap.
- GLM's fix-build latency (14.3 s p50) ran higher than its morning run (12.0 s). Both ran alone; the difference is Workers AI variance plus one extra system-prompt sentence.

## Cost

Five chat battery runs (GLM twice, DeepSeek twice across three resumed parts, one BGE-M3 GLM run reported in the [embedder write-up](2026-10-25-embedder-bge-m3.md)), five 19-question checks, one smoke and the debugger replay: a few dollars of Workers AI against list prices. Reviews ran on Claude subagents and DeepSeek V4.1 Flash through Pi (about $0.10 per DeepSeek review).

## Reproduce

```bash
npx wrangler dev --config workers/brain/wrangler.jsonc --port 8789 --ip 127.0.0.1 --persist-to .wrangler/state-eval
npm run eval:northwind -- --live http://127.0.0.1:8789 --score-unavailable --model "@cf/deepseek-ai/deepseek-v4.1-flash-1017"
npm run eval:northwind -- --live http://127.0.0.1:8789 --score-unavailable --model "@cf/zai-org/glm-5.3-flash"
```

The 19-question check set is `results/2026-10-25-chat-models/search-budget-fix-check/questions.json` (pass it with `--questions`).

Frozen evidence: [`results/2026-10-25-chat-models/`](../results/2026-10-25-chat-models/).
