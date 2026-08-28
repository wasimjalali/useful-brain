# Independent review P2 bug backlog

Status: open after PR #13. Owner: Grok 4.6 xhigh. Sources: GPT-5.6 Sol independent review sessions `01a0483e-2a9f-73a0-8e7e-dde20c61bdc6` and `01a048de-592c-7113-b1b1-db1290f9732e` on 2026-08-28.

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

## P2-6: repeated searches reset citation labels

- Location: `src/lib/agent/host-grounding.ts:135` and `src/lib/agent/search-knowledge.ts`.
- Cause: every `search_knowledge` result labels its own hits from `[1]`, while the host finalizer appends hits from all searches to one turn-wide ledger. A citation such as `[1]` from the second search is validated against the first search's first hit.
- Contract: `AGENTS.md:58-60` requires current-run evidence visibility and valid citations for every grounded paragraph.
- Required regression: perform two searches with distinct evidence, cite the second result using the label shown to the model and prove the host resolves it to the second chunk without accepting a citation to the first.
- Acceptance: expose stable turn-wide labels to the model or rebase each result before validation and persistence. Preserve fail-closed behavior for unknown or ambiguous labels.

## P2-7: durable approval resume omits MCP writes

- Location: `workers/brain/src/approval-resume.ts:35`.
- Cause: the approval Workflow enqueues resumptions for all approved writes, but the resume dispatcher accepts only `create_draft` and `action_sink_write`. An approved `mcp_create_ticket` is rejected and its run never completes.
- Contract: `docs/useful-brain-master-plan.md:285` requires one durable deterministic resume after approval, and the Phase 6 contract exposes an approval-required MCP write.
- Required regression: persist a pending `mcp_create_ticket`, approve it through the Workflow and prove the queue reconstructs the exact call, executes it once and completes the run.
- Acceptance: add an idempotent durable MCP dispatch path with the same stored-binding recheck, or stop exposing the tool to the approval Workflow until such reconstruction exists.

## P2-8: evidence snapshots drop document IDs

- Location: `src/lib/store/conversations.ts:342` and the evidence contract in `src/lib/answer/contract.ts`.
- Cause: evidence conversion drops `SearchHit.citation.documentId`, so completed snapshots persist `document_id` as `NULL` even though the schema reserves the field. Replay cannot identify the cited document after corpus changes.
- Contract: `AGENTS.md:58-63` requires visible retrieval identity and exact replayable evidence snapshots.
- Required regression: complete and replay a turn whose evidence includes a document ID, then prove the stored and replayed snapshot preserves the same ID together with the chunk, text and corpus generation.
- Acceptance: carry document ID through the evidence types, insert it into `evidence_snapshots` and load it on replay without weakening immutable snapshot ownership.

## Required landing gates

For each follow-up repair:

1. Add a failing regression before the fix.
2. Run the focused regression.
3. Run `npx tsc --noEmit`, `npm run typecheck:workers`, `npm run lint`, `npm test` and `npm run build` with Node `22.22.2`.
4. Run staging dry-runs for web, Brain and ingestion plus `npm audit --omit=dev --audit-level=high`.
5. Run `codex review --base origin/main` and fix confirmed P0/P1 or high/critical findings.
6. Use a new branch and PR. Do not start Phase 7B, apply real company data, create production resources, delete Convex or delete Burooj.
