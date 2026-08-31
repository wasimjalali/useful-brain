# Cloudflare-hosted model selection

Date: 2026-08-28; bake-off evidence added 2026-08-31

Wasim selected GLM 5.3 Flash for chat. Embeddings and reranking stay on the locked Workers AI models from earlier phases. The 2026-08-31 bake-off below confirms that choice with measured evidence.

## Chat

| Field | Choice |
| --- | --- |
| Model | [`@cf/zai-org/glm-5.3-flash`](https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/) |
| Why | Operator choice on 2026-08-28. Function calling, reasoning, and vision. Cheaper than GLM-5.2 while remaining Cloudflare-hosted. |
| Context | 1,048,576 tokens |
| Pricing | $0.15 / $0.50 / $0.03 cached per M tokens ([Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)) |
| Access | Workers Paid or AI Gateway credits |
| Pi catalog | Pi 0.84.3 has GLM-4.7-flash and GLM-5.2, not 5.3-flash. Useful Brain clones the 4.7-flash OpenAI-completions shape and overrides id, cost, and context. |

Gemma remains eligible. It was not chosen because the operator named GLM 5.3 Flash.

## Embeddings

| Field | Choice |
| --- | --- |
| Model | `@cf/qwen/qwen3-embedding-0.6b` |
| Dimensions | 1024 |
| Metric | cosine |

Locked in Phase 2. Changing it requires a Vectorize rebuild.

## Rerank

| Field | Choice |
| --- | --- |
| Model | `@cf/baai/bge-reranker-base` |

Locked in Phase 3.

## Runtime

Brain calls `env.AI.run()` for chat, embeddings, and rerank. Local `wrangler dev` uses `"ai": { "binding": "AI", "remote": true }` on the development Worker. Staging and production use the same binding without `remote`.

## Chat model bake-off (2026-08-31)

Method: every candidate verified live in the account catalog (`npx wrangler ai models`), schema-checked for function calling, then run through the same grounded-citation loop. A loopback-only `evalModel` override on `POST /turns` (allowlisted in `src/lib/models/eval-override.ts`, 403 outside loopback, 400 off-allowlist) selects the chat model per turn; the harness fails closed when the response's `answerModel` differs from the requested model. Identical decoding everywhere: temperature 0, seed 7, thinking disabled on extraction calls. All full runs used the same corpus generation `g-8ee33d45`, hybrid retrieval, all 120 questions under each question's principal, zero skips, zero forbidden-document retrievals, zero vector-degraded turns. Scorers unchanged: multi-hop requires every gold document cited; abstention categories require `insufficient_evidence`.

Dropped before a full run:

| Candidate | Reason |
| --- | --- |
| `@cf/openai/gpt-oss-120b` | No chat-completions tool schema on Workers AI; cannot drive the `search_knowledge` loop through the existing adapter. |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | Smoke 5/10; legacy input schema, skips the search tool and over-abstains with sub-second failures. |
| `@cf/moonshotai/kimi-k2.6` | Smoke 6/10; extreme latency (up to 131s per question) with a burst of remote-binding internal errors. |

Full 120-question results (run in parallel against one local worker, so latency includes contention; the earlier solo GLM segment measured p50 ~19.6s):

| Model | Pass | Factual | Trap | Permission | Unanswerable | Multi-hop | Retrieved recall | Latency p50 / p95 | Price $/M in / out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `@cf/zai-org/glm-5.3-flash` (locked) | **114/120 (95.0%)** | 66/70 | 17/17 | 12/13 | 10/10 | 9/10 | 0.974 | 15.6s / 56.3s | 0.15 / 0.50 |
| `@cf/zai-org/glm-5.3` | 114/120 (95.0%) | 67/70 | 17/17 | 12/13 | 10/10 | 8/10 | 0.969 | 15.3s / 56.0s | 1.40 / 4.40 |
| `@cf/deepseek-ai/deepseek-v4-flash-0731` | 109/120 (90.8%) | 64/70 | 17/17 | 12/13 | 10/10 | 6/10 | 0.943 | 11.2s / 35.9s | 0.44 / 1.32 |
| `@cf/google/gemma-4-26b-a4b-it` | 105/120 (87.5%) | 62/70 | 16/17 | 11/13 | 10/10 | 6/10 | 0.928 | 17.9s / 56.8s | 0.10 / 0.30 |
| `@cf/deepseek-ai/deepseek-v4-pro-0813` | 105/120 (87.5%) | 62/70 | 15/17 | 12/13 | 10/10 | 6/10 | 0.933 | 14.9s / 82.3s | 1.32 / 3.96 |

Recommendation: **keep GLM 5.3 Flash**. It ties the best pass rate at roughly one ninth of GLM 5.3's price, and it is the only model that passed all five expanded multi-hop questions. DeepSeek V4 Flash is the named latency alternative (fastest, 90.8%) if the 15s p95 answer budget becomes binding. Questions failed by every model (q073, q100, q105, q110) point at corpus and retrieval difficulty rather than model choice.

Cost: all seven smokes plus five full runs stayed comfortably inside the $75/month gross Workers AI safety boundary (order of a few dollars total at the documented unit prices; the harness does not meter tokens per run, so gross spend is bounded by the pricing table above rather than measured per token).

Per-model evidence lives in `eval-output/findings.<model>.json` and `eval-output/live-summary.<model>.json` (gitignored, regenerate with `npm run eval:northwind -- --live http://127.0.0.1:8789 --model <id>`).
