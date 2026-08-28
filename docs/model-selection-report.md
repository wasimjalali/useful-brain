# Cloudflare-hosted model selection

Date: 2026-08-28

Wasim selected GLM 5.3 Flash for chat. Embeddings and reranking stay on the locked Workers AI models from earlier phases.

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
