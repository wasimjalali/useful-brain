# Useful Brain

Useful Brain is a knowledge agent that answers questions about a company corpus and proves every answer. It retrieves only the evidence the asking principal is allowed to read, cites a verbatim source for every factual sentence and refuses when the evidence isn't there. It runs entirely on Cloudflare (Workers, D1, Vectorize, Workers AI) with a Next.js workspace UI.

This is a portfolio knowledge agent: no billing and no tenant switching. Local development still uses loopback on `127.0.0.1`. Staging uses email/password sessions (`IDENTITY_MODE=session`).

![Useful Brain chat with a cited answer and the evidence inspector open.](docs/images/ub-chat-evidence.png)

## The eval story: 72% to 95% without touching the scorer

The system is measured against a locked 120-question battery over a 65-document synthetic corpus (Northwind) with document-level ACLs: 70 factual, 17 trap, 13 permission, 10 unanswerable and 10 multi-hop questions. The scoring rules are harsh and were never loosened: a multi-hop answer must cite every gold document, permission and unanswerable questions must return `insufficient_evidence`, and retrieving any forbidden document is a fail regardless of the answer.

| Run | Score | Notes |
| --- | --- | --- |
| Pre-repair baseline | 77/107 (72%) | 13 permission questions couldn't be scored |
| Pass 1: honest measurement | 95/120 (79.2%) | all 120 scored, multi-hop collapsed to 0/10 |
| Pass 2: answer-layer repair | **114/120 (95.0%)** | multi-hop 9/10, zero ACL leaks, zero forbidden retrievals |

Every gain came from the answer layer. Retrieval metrics and every scoring rule stayed locked the whole time. The full campaign write-ups live in [`evals/`](evals/):

- [From 72% to 95%: repairing a grounded RAG agent without touching the scorer](evals/system-evals/2026-08-31-northwind-grounding-repair.md)
- [Chat model bake-off: GLM 5.3 Flash confirmed across seven candidates](evals/model-evals/2026-08-31-chat-model-bakeoff.md)

Frozen result snapshots back both reports in [`evals/results/`](evals/results/).

![Useful Brain Evals dashboard for the locked Northwind campaign.](docs/images/ub-evaluations.png)

## What it enforces

- **ACL before everything.** Authorization filters run before fusion, reranking, prompt construction and citation. Denied chunks never reach the model, the traces or the user.
- **Verbatim grounding.** A host-side validator only accepts answers whose every sentence is a span of retrieved evidence, cited with current-turn labels. The model can't waive this.
- **Honest refusals.** Missing or below-floor evidence returns `insufficient_evidence` instead of a fluent guess.
- **Replayable answers.** Conversations persist exact evidence snapshots, so an answer can be inspected after the corpus changes.
- **Safe corpus promotion.** Versioned corpus generations with explicit promotion; a failed index build never touches the active generation.

## Architecture

```mermaid
flowchart LR
    U[Operator browser] --> W[Web Worker: Next.js on OpenNext]
    W --> B[Brain Worker: retrieval, grounding, policy, Pi Agent Core]
    B --> CDB[(Corpus D1: documents, ACL, FTS5)]
    B --> ODB[(Operations D1: conversations, runs, evals)]
    B --> V[(Vectorize: rebuildable vector projection)]
    B --> WA[Workers AI: chat, embeddings, reranker]
    W --> I[Ingestion Worker] --> CDB
```

Hybrid retrieval fuses D1 FTS5 keyword search with Vectorize dense search (both ACL-filtered store-side), rescores keywords over the allowed set only, then reranks with a cross-encoder and applies an eval-calibrated relevance floor. D1 is authoritative; Vectorize is a rebuildable projection with exact inventory reconciliation before any generation is promoted.

Models (all Cloudflare-hosted, selected by measured bake-off): `@cf/zai-org/glm-5.3-flash` for chat, `@cf/qwen/qwen3-embedding-0.6b` for embeddings, `@cf/baai/bge-reranker-base` for reranking.

![Useful Brain Sources inventory with the operator corpus and document list.](docs/images/ub-knowledge.png)

## Run it locally

Requires Node.js 22.19+ and npm.

```bash
npm install
npm run preview:cf
```

That builds OpenNext, applies local D1 migrations and starts `wrangler dev` with the web and Brain Workers connected over a Service Binding. The app serves on `http://127.0.0.1:8788` (the Brain Worker takes 8787). Seed the Northwind corpus from the Knowledge base page if it's empty, then ask a question and open the evidence inspector.

Verify changes with:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

## Repo map

- `workers/brain/`: identity, conversations, retrieval, grounding and evaluations.
- `workers/ingestion/`: corpus ingest workflows.
- `content/northwind/`: the 65-document synthetic corpus and 120-question battery.
- `src/`: Next.js workspace UI, retrieval helpers and the eval battery.
- `evals/`: blog-ready eval reports and frozen result snapshots.
- `docs/useful-brain-master-plan.md`: the full production architecture plan.

Contributor, safety and migration rules are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
