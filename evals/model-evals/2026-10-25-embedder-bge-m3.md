# Embedder bake-off: BGE-M3 replaces Qwen3 Embedding 0.6B

Date: 2026-10-25. Repo: Useful Brain. Corpus: Northwind (65 documents, 808 chunks, 120 locked questions).

## TL;DR

We asked whether a Cloudflare-hosted embedder could beat our production Qwen3 Embedding 0.6B. Only one candidate in today's Workers AI catalog was worth a run: BGE-M3, same price, same 1024 dimensions, a 60k-token context window against Qwen's 8k. On dense retrieval alone BGE-M3 won every ranking metric but one and was far faster. Inside the full product, where keyword search and the reranker narrow the gap, it tied: 118/120 for both. Same price, faster, longer inputs, no accuracy loss, so it replaced Qwen3 ([PR #73](https://github.com/wasimjalali/useful-brain/pull/73)).

| | Qwen3 Embedding 0.6B (before) | BGE-M3 (after) |
| --- | --- | --- |
| Dense recall@3 (97 answerable questions) | 0.969 | **0.990** |
| Dense recall@8 | **1.000** | 0.995 |
| Dense MRR | 0.945 | **0.957** |
| Dense nDCG@10 | 0.953 | **0.962** |
| Query embed p50 / p95 | 400 / 4,042 ms | **105 / 133 ms** |
| Indexing 808 chunks | 193 s | **15 s** |
| Full battery, GLM 5.3 Flash | 118/120 | 118/120 |
| Full battery retrieved recall | **0.995** | 0.990 |
| Price per M input tokens | $0.0118 | $0.0118 |

## The question

Our earlier eval reports kept retrieval fixed and changed the chat model. This time we checked the other half. The Workers AI catalog on 2026-10-25 lists 73 models. Its embedders are the BGE family (small, base, large, M3), EmbeddingGemma 300M (still beta, 768 dimensions), PLaMo (Japanese) and our Qwen3 0.6B. There is still exactly one reranker, BGE Reranker Base, so the reranker stayed. EmbeddingGemma would have needed a new index shape while still in beta, so it was skipped. That left BGE-M3.

On paper Qwen3 0.6B should win: it is newer (June 2025 against January 2024) and scores higher on the multilingual MTEB tables in the Qwen3 Embedding paper. Benchmarks on paper are not our corpus, so we measured.

## Two stages

**Stage 1, dense retrieval only.** A small eval-only Worker forwards embedding calls to the remote Workers AI binding and times them. A script chunks the 65 Northwind documents with the production chunker (300 tokens, 30 overlap), embeds every chunk and every question with both models, applies each question's principal ACL before ranking (as production does), ranks chunks by cosine similarity, collapses to documents and scores against the locked gold set. Qwen3 gets its production query instruction; BGE-M3 has no instruction field. The 23 permission and unanswerable questions have no gold documents, so 97 questions are scored. No Vectorize index, no product code, a fraction of a cent.

Per question, the two models disagreed on four recall@3 results: BGE-M3 found q055 (trap), q100 (an identifier lookup every chat model failed in August) and the second hop of q120; Qwen3 found the second hop of q090. Neither leaked a forbidden document.

**Stage 2, the full product.** Dense wins can vanish inside a hybrid system, so BGE-M3 ran the full 120-question live battery. A new dev Vectorize index (`useful-brain-development-bge-m3`, 1024 dimensions, cosine, with the `acl_group` metadata index) received Northwind embedded with BGE-M3 through the Brain's own seed path, on a fresh local D1. The harness waited until Vectorize reported all 808 vectors processed, then asked every question with GLM 5.3 Flash, the production chat model. Everything else matched the Qwen3 baseline run from the same day: same code, same prompt version (v13), same reranker and fusion weights.

Result: 118/120 for both. Qwen3 missed q073 and q085; BGE-M3 missed q073 and q074. q073 fails for every model we have tried; q074 and q085 are permission questions where the model sometimes answers from readable but off-topic documents. Zero leaks, zero vector-degraded turns.

## Latency, read carefully

The headline latency of the BGE-M3 battery was worse (p50 13.8 s, p95 52.3 s against 12.0 s and 37.3 s), and it would be wrong to read that as the embedder. The last questions of that run overlapped a separate live check on the same machine, and the tail is dominated by the chat model: one q074 turn took 233 s through retries. On q001 to q095, which ran alone, the median per-question difference was 0.2 s in BGE-M3's favour, which matches the query-embedding gain (about 0.3 s saved per search). Turn latency is the chat model's; the embedder's part is small either way, but BGE-M3's is smaller and far less spiky (p95 133 ms against 4 s).

## Decision and why

Wasim's rule: replace it if it wins on the benchmarks and brings a positive return. It won the retrieval benchmark, tied in the product, costs the same, indexes 13 times faster and accepts 60k-token inputs, which opens bigger chunks or whole-document embedding later. The switch is [PR #73](https://github.com/wasimjalali/useful-brain/pull/73): BGE-M3 payloads, the embedding model added to the retrieval configuration version, generations that record their real embedding model (they used to inherit the migration default), a fail-closed guard against querying or promoting a generation embedded with another model, and new dev and staging indexes.

## Honest caveats

- One full-battery run per embedder. Category totals have been stable across runs, but single questions flip between runs (q074 and q085 especially).
- The BGE-M3 dense numbers come from the same chunks and ACLs as production but not through Vectorize's ANN index; the full battery is the end-to-end check.
- The embedder's retrieval win (about two questions of 97 at recall@3) did not show up as a pass-rate win because the hybrid pipeline (keyword channel, keyword rescue, reranker) already recovered those documents for Qwen3.
- Pass and latency numbers for the Qwen3 baseline come from the same day's GLM 5.3 Flash run, documented in the [Workers AI chat model report](2026-10-25-workers-ai-chat-models.md).

## Cost

Stage 1 embedded about 808 chunks and 120 questions twice: under one cent. Stage 2 is one full battery (GLM 5.3 Flash) plus one BGE-M3 seed: well under a dollar against Workers AI list prices.

## Reproduce

```bash
# Stage 1: dense retrieval only
npx wrangler dev -c evals/embedder-bakeoff/wrangler.jsonc --port 8791 --ip 127.0.0.1
npx jiti evals/embedder-bakeoff/run.ts --url http://127.0.0.1:8791 --out evals/results/2026-10-25-embedder-bakeoff

# Stage 2: full battery on a BGE-M3 index (after the switch, development already points at it)
CI=true npx wrangler d1 migrations apply useful-brain-corpus-development --local --persist-to .wrangler/state-eval-bge -c workers/brain/wrangler.jsonc
CI=true npx wrangler d1 migrations apply useful-brain-operations-development --local --persist-to .wrangler/state-eval-bge -c workers/brain/wrangler.jsonc
npx wrangler dev --config workers/brain/wrangler.jsonc --port 8789 --ip 127.0.0.1 --persist-to .wrangler/state-eval-bge
npm run eval:northwind -- --live http://127.0.0.1:8789 --score-unavailable
```

Frozen evidence: [`results/2026-10-25-embedder-bakeoff/`](../results/2026-10-25-embedder-bakeoff/) (`summary.json`, per-question `raw-*.json`, and `full-battery-bge-m3/`).
