# Rollback runbook (Phase 7A staging)

Do not use D1 Time Travel. Roll back by corpus generation pointer.

## Corpus

1. Keep the previous ready/active generation retained.
2. Call `rollbackGeneration` / `rollback` with that generation id.
3. Confirm `corpus_state.active_generation_id` moved to the retained generation.
4. A failed draft must leave the active pointer unchanged.

Proof: `src/lib/store/generations.test.ts` and `workers/ingestion/test/generations.test.ts`.

## Application

- Convex remains the live UI through shadow and canary.
- To leave staging-primary, set release mode back to `shadow` or `canary`.
- Worker rollback: redeploy the previous Brain/Ingestion/Web Worker version. Do not delete staging D1/R2.

## Data

- Operations D1 conversations, snapshots, agent runs stay; do not truncate as a rollback.
- Do not delete Convex, Burooj, or production placeholders.

## Stop

Phase 7B (real data, production resources, Convex/Burooj deletion) requires explicit Wasim approval.
