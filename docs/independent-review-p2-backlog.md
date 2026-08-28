# Independent review P2 bug backlog

Status: open after PR #13. Owner: Grok 4.6 xhigh. Source: GPT-5.6 Sol independent review session `01a0483e-2a9f-73a0-8e7e-dde20c61bdc6` on 2026-08-28.

These findings are real correctness or durability bugs, but none is a confirmed P0/P1 or high/critical security blocker for the synthetic Phase 7A release candidate. Fix them in a follow-up branch after PR #13 merges. Keep Phase 7B closed.

## P2-1: total tool-call budget misses non-search tools

- Location: `src/lib/agent/run.ts:165`; duplicate search-only accounting in `src/lib/agent/search-knowledge.ts`.
- Cause: the central `beforeToolCall` hook checks wall time but does not increment the total tool-call budget. `search_knowledge` increments inside its own executor, while native, MCP and plugin tools do not.
- Contract: `docs/useful-brain-master-plan.md:331` limits a run to eight total tool calls and four `search_knowledge` calls.
- Required regression: drive mixed registered tools through the central hook and prove the ninth total call is blocked while search calls are counted exactly once.
- Acceptance: move total accounting into the central barrier, remove duplicate search accounting and keep all existing budget floors unchanged.

## P2-2: approval resume has no dead-letter recovery

- Location: `workers/brain/wrangler.jsonc:183` and the equivalent development and production consumer blocks.
- Cause: the approval resume consumer exhausts five retries without a dead-letter queue or reconciler. A prolonged operations D1 outage can discard the only resume message and leave an approved run pending.
- Contract: `docs/useful-brain-master-plan.md:285` requires one durable deterministic resume after approval.
- Required regression: verify every approval-resume consumer declares a dedicated DLQ, then add a bounded replay or operator reconciliation path that preserves identifier-only messages and exact approval binding.
- Acceptance: failed deliveries remain recoverable without repeating a completed side effect. Do not provision or touch `usefulapply-*` or `sanad-*` resources.

## P2-3: concurrent request-ID creation is not atomic

- Location: `src/lib/store/conversations.ts:146`.
- Cause: two first-message retries can both miss the request-ID lookup, create different parent conversations and race on the unique assistant-message request ID. One caller errors and may leave an orphan conversation instead of replaying the winning turn.
- Contract: `AGENTS.md:53` requires idempotent mutating operations.
- Required regression: issue two concurrent `createPendingTurn` calls with the same request ID and no supplied conversation ID. Both must return the same conversation and assistant message, with exactly one user message, one assistant message and no orphan conversation.
- Acceptance: claim the request ID atomically or recover the winning record on conflict without weakening ownership checks.

## P2-4: D1 FTS candidate limit uses chunk-ID order

- Location: `src/lib/acl/access.ts:196`.
- Cause: `keywordSearchSql` returns rank `0.0`, orders by `chunk_id` and applies `LIMIT` before local authorized rescoring. Relevant authorized matches beyond the arbitrary ID window cannot be recovered.
- Contract: `docs/useful-brain-master-plan.md:255` permits store-global BM25 only for candidate generation. Scores must be recomputed over allowed passages before fusion or exposure.
- Required regression: insert more authorized matches than the candidate limit, place the strongest lexical match after the ID window and prove it reaches local rescoring without exposing store-global rank.
- Acceptance: use BM25 only to select an overfetched authorized candidate set, then discard it and retain the existing ACL-local heading-aware rescore for fusion and traces.

## P2-5: natural-language FTS requires every token

- Location: `src/lib/acl/access.ts:200`.
- Cause: `fts5MatchQuery` joins every token with `AND`. Questions such as `What is the refund window?` require documents to contain question words and can silently remove the keyword channel.
- Contract: `AGENTS.md:64` requires measured, versioned retrieval-parameter changes.
- Required regression: prove natural-language queries retain meaningful terms, literal identifiers such as `RF-75` remain safely quoted and punctuation cannot become raw FTS syntax.
- Acceptance: choose a measured stopword and OR/phrase strategy, record a new retrieval fingerprint version and rerun both fake-provider ratchets without lowering any floor.

## Required landing gates

For each follow-up repair:

1. Add a failing regression before the fix.
2. Run the focused regression.
3. Run `npx tsc --noEmit`, `npm run typecheck:workers`, `npm run lint`, `npm test` and `npm run build` with Node `22.22.2`.
4. Run staging dry-runs for web, Brain and ingestion plus `npm audit --omit=dev --audit-level=high`.
5. Run `codex review --base origin/main` and fix confirmed P0/P1 or high/critical findings.
6. Use a new branch and PR. Do not start Phase 7B, apply real company data, create production resources, delete Convex or delete Burooj.
