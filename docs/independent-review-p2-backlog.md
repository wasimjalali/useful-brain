# Independent review P2 bug backlog

Status: repaired on `grok/phase-7a-p2-repairs`. Owner: Grok 4.6 xhigh. Sources: GPT-5.6 Sol independent review sessions `01a0483e-2a9f-73a0-8e7e-dde20c61bdc6` and `01a048de-592c-7113-b1b1-db1290f9732e` on 2026-08-28.

These findings were real correctness or durability bugs, but none was a confirmed P0/P1 or high/critical security blocker for the synthetic Phase 7A release candidate. Historical findings below are preserved. Each item now records its regression, fix and verification. Phase 7B stays closed.

Local proof for this repair (2026-08-28, Node `v22.22.2`): `npx tsc --noEmit` exit 0; `npm run typecheck:workers` exit 0; `npm run lint` exit 0; Node Vitest 80 files / 392 tests passed; Brain workerd 9 files / 36 tests passed; Ingestion workerd 4 files / 11 tests passed; `npm run build` Next 16.3.3 exit 0; `npm run build:cf` OpenNext 1.20.3 exit 0; wrangler 4.126.0 `--dry-run --env staging` web gzip 1608.06 KiB (`IDENTITY_MODE=disabled`, `LOOPBACK_RUNTIME=false`), brain gzip 14.01 KiB, ingestion gzip 9.68 KiB; `npm audit --omit=dev --audit-level=high` 0 vulnerabilities.

## P2-1: total tool-call budget misses non-search tools

- Location: `src/lib/agent/run.ts:165`; duplicate search-only accounting in `src/lib/agent/search-knowledge.ts`.
- Cause: the central `beforeToolCall` hook checks wall time but does not increment the total tool-call budget. `search_knowledge` increments inside its own executor, while native, MCP and plugin tools do not.
- Contract: `docs/useful-brain-master-plan.md:331` limits a run to eight total tool calls and four `search_knowledge` calls.
- Required regression: drive mixed registered tools through the central hook and prove the ninth total call is blocked while search calls are counted exactly once.
- Acceptance: move total accounting into the central barrier, remove duplicate search accounting and keep all existing budget floors unchanged.
- Repair: `beforeToolCall` in `src/lib/agent/run.ts` now calls `budgets.noteToolCall`. `search_knowledge` no longer increments the tracker. The four-call search limit remains inside `BudgetTracker.noteToolCall`.
- Regression: `src/lib/agent/agent-loop.test.ts` mixed-tool unit test plus Pi `beforeToolCall` barrier (ninth call blocked, two searches counted once). Host search-tool test asserts `toolCalls === 0` after two `execute` calls.
- Verification: focused Node Vitest on `agent-loop.test.ts` and `host-grounding.test.ts` passed; full Node suite 383 passed.

## P2-2: approval resume has no dead-letter recovery

- Location: `workers/brain/wrangler.jsonc:183` and the equivalent development and production consumer blocks.
- Cause: the approval resume consumer exhausts five retries without a dead-letter queue or reconciler. A prolonged operations D1 outage can discard the only resume message and leave an approved run pending.
- Contract: `docs/useful-brain-master-plan.md:285` requires one durable deterministic resume after approval.
- Required regression: verify every approval-resume consumer declares a dedicated DLQ, then add a bounded replay or operator reconciliation path that preserves identifier-only messages and exact approval binding.
- Acceptance: failed deliveries remain recoverable without repeating a completed side effect. Do not provision or touch `usefulapply-*` or `sanad-*` resources.
- Repair: every Brain environment consumer now sets `dead_letter_queue` to `useful-brain-approval-resume-dlq-{env}` and consumes that DLQ with three extra retries. `listRecoverableApprovalResumes` / `replayRecoverableApprovalResumes` re-enqueue identifier-only `{ runId, idempotencyKey }` payloads. Resume remains idempotent through `synthetic_mutating_effects`. Production queue names stay placeholders (`RESOURCES_PROVISIONED=false`). Staging DLQ is created automatically on the next Brain staging deploy per Wrangler `dead_letter_queue` behavior. No production resources were created.
- Regression: `src/lib/cf/wrangler-config.test.ts` asserts every primary approval-resume consumer has a dedicated DLQ plus a DLQ consumer. `workers/brain/test/approval-resume.test.ts` lists, replays and DLQ-consumes a pending approved run, then proves a second pass does not insert another effect.
- Verification: Brain workerd approval-resume tests passed (4 tests in that file).

## P2-3: concurrent request-ID creation is not atomic

- Location: `src/lib/store/conversations.ts:146`.
- Cause: two first-message retries can both miss the request-ID lookup, create different parent conversations and race on the unique assistant-message request ID. One caller errors and may leave an orphan conversation instead of replaying the winning turn.
- Contract: `AGENTS.md:53` requires idempotent mutating operations.
- Required regression: issue two concurrent `createPendingTurn` calls with the same request ID and no supplied conversation ID. Both must return the same conversation and assistant message, with exactly one user message, one assistant message and no orphan conversation.
- Acceptance: claim the request ID atomically or recover the winning record on conflict without weakening ownership checks.
- Repair: operations migration `0006_request_id_claims.sql` adds `request_id_claims`. `createPendingTurn` inserts the claim with `ON CONFLICT(request_id) DO NOTHING`, materializes the winning conversation and messages, recovers unique conflicts, and refuses a claim owned by another principal.
- Regression: `workers/brain/test/conversations-d1.test.ts` concurrent `Promise.all` first turns share one conversation, one user row, one assistant row and leave zero empty conversations.
- Verification: Brain workerd conversations tests passed.

## P2-4: D1 FTS candidate limit uses chunk-ID order

- Location: `src/lib/acl/access.ts:196`.
- Cause: `keywordSearchSql` returns rank `0.0`, orders by `chunk_id` and applies `LIMIT` before local authorized rescoring. Relevant authorized matches beyond the arbitrary ID window cannot be recovered.
- Contract: `docs/useful-brain-master-plan.md:255` permits store-global BM25 only for candidate generation. Scores must be recomputed over allowed passages before fusion or exposure.
- Required regression: insert more authorized matches than the candidate limit, place the strongest lexical match after the ID window and prove it reaches local rescoring without exposing store-global rank.
- Acceptance: use BM25 only to select an overfetched authorized candidate set, then discard it and retain the existing ACL-local heading-aware rescore for fusion and traces.
- Repair: `keywordSearchSql` orders by `bm25(chunks_fts), c.chunk_id` and still selects `0.0 AS rank`. `ftsCandidateFetchLimit` overfetches 4× up to `MAX_CANDIDATE_LIMIT`. Local `rescoreLocally` is unchanged and still scores title, heading and body.
- Regression: `workers/ingestion/test/fts5.test.ts` places `chunk-zzz` after five weaker `chunk-aaa`… matches and proves LIMIT 3 returns `chunk-zzz` first with rank `0.0`. `src/lib/store/cloudflare-fts.test.ts` asserts the SQL shape and overfetch helper. `src/lib/retrieve/keyword-score.test.ts` still requires heading-aware local scores.
- Verification: ingestion workerd FTS tests passed (3 tests).

## P2-5: natural-language FTS requires every token

- Location: `src/lib/acl/access.ts:200`.
- Cause: `fts5MatchQuery` joins every token with `AND`. Questions such as `What is the refund window?` require documents to contain question words and can silently remove the keyword channel.
- Contract: `AGENTS.md:64` requires measured, versioned retrieval-parameter changes.
- Required regression: prove natural-language queries retain meaningful terms, literal identifiers such as `RF-75` remain safely quoted and punctuation cannot become raw FTS syntax.
- Acceptance: choose a measured stopword and OR/phrase strategy, record a new retrieval fingerprint version and rerun both fake-provider ratchets without lowering any floor.
- Repair: `fts5MatchQuery` drops English question stopwords, quotes hyphenated identifiers such as `RF-75` as one term, quotes remaining tokens, and joins with `OR`. Fingerprints now include `ftsMatchStrategy: stopword-or-v1` in `fingerprintId`. Fake-provider stays 500/50 and 0.20/0.80. Real-stack stays 300/30 and 0.70/0.30.
- Regression: `src/lib/store/cloudflare-fts.test.ts` (`What is the refund window?` → `"refund" OR "window"`; `RF-75` quoted; `NEAR(` cannot appear unquoted). Workerd NL query against refund body matches. `src/lib/retrieve/parent-off.test.ts` locks both fingerprints. Fake-provider floors 0.90/0.80/0.82/0.49 and fake-rerank floors 0.62/0.53/0.55/0.39 still pass inside `npm test`.
- Verification: Node eval files passed in the 383-test run.

## P2-6: repeated searches reset citation labels

- Location: `src/lib/agent/host-grounding.ts:135` and `src/lib/agent/search-knowledge.ts`.
- Cause: every `search_knowledge` result labels its own hits from `[1]`, while the host finalizer appends hits from all searches to one turn-wide ledger. A citation such as `[1]` from the second search is validated against the first search's first hit.
- Contract: `AGENTS.md:58-60` requires current-run evidence visibility and valid citations for every grounded paragraph.
- Required regression: perform two searches with distinct evidence, cite the second result using the label shown to the model and prove the host resolves it to the second chunk without accepting a citation to the first.
- Acceptance: expose stable turn-wide labels to the model or rebase each result before validation and persistence. Preserve fail-closed behavior for unknown or ambiguous labels.
- Repair: `runKnowledgeAgent` shares one `TurnEvidenceLedger`. `appendSearchHit` assigns turn-wide labels in the tool payload. Host ingest honors payload labels via `byLabel` and sets `labelConflict` when two chunks claim the same label. Unknown or conflicting labels refuse the answer.
- Regression: `src/lib/agent/host-grounding.test.ts` two-search tool test: second payload label `[2]` grounds `Beta policy applies.[2]` and refuses `Beta policy applies.[1]`. A second test with two `[1]` labels for different chunks fails closed.
- Verification: focused host-grounding tests passed.

## P2-7: durable approval resume omits MCP writes

- Location: `workers/brain/src/approval-resume.ts:35`.
- Cause: the approval Workflow enqueues resumptions for all approved writes, but the resume dispatcher accepts only `create_draft` and `action_sink_write`. An approved `mcp_create_ticket` is rejected and its run never completes.
- Contract: `docs/useful-brain-master-plan.md:285` requires one durable deterministic resume after approval, and the Phase 6 contract exposes an approval-required MCP write.
- Required regression: persist a pending `mcp_create_ticket`, approve it through the Workflow and prove the queue reconstructs the exact call, executes it once and completes the run.
- Acceptance: add an idempotent durable MCP dispatch path with the same stored-binding recheck, or stop exposing the tool to the approval Workflow until such reconstruction exists.
- Repair: the durable dispatcher allow-list now includes `mcp_create_ticket` with the stored `{ title }` arguments. Execution is the existing idempotent `synthetic_mutating_effects` insert plus run completion, matching drafts and the action sink. No live MCP client is required inside the Worker resume path.
- Regression: `workers/brain/test/approval-resume.test.ts` approves `mcp_create_ticket`, resumes from the primary queue and again from the DLQ, and asserts one effect row and `agent_runs.status = completed`.
- Verification: Brain workerd approval-resume tests passed.

## P2-8: evidence snapshots drop document IDs

- Location: `src/lib/store/conversations.ts:342` and the evidence contract in `src/lib/answer/contract.ts`.
- Cause: evidence conversion drops `SearchHit.citation.documentId`, so completed snapshots persist `document_id` as `NULL` even though the schema reserves the field. Replay cannot identify the cited document after corpus changes.
- Contract: `AGENTS.md:58-63` requires visible retrieval identity and exact replayable evidence snapshots.
- Required regression: complete and replay a turn whose evidence includes a document ID, then prove the stored and replayed snapshot preserves the same ID together with the chunk, text and corpus generation.
- Acceptance: carry document ID through the evidence types, insert it into `evidence_snapshots` and load it on replay without weakening immutable snapshot ownership.
- Repair: `RetrievalResultForAnswer.documentId` is carried from `hitsToEvidence`, bound in `completeTurn`, selected in `loadReplay`, and shown in the evidence prompt when present. Writer ownership checks are unchanged.
- Regression: `workers/brain/test/conversations-d1.test.ts` replay asserts `documentId`, `chunkId`, text, `[1]`, `corpusGenerationId` and owner-scoped load.
- Verification: Brain workerd conversation tests passed.

## Follow-up P2s from independent Sol xhigh review (after the eight repairs)

Independent GPT-5.6 Sol xhigh review of PR #14 (Cursor Task `bc-ec42973e-79b3-528e-badc-3ee89ae34f70`) confirmed four more in-plan P2s. Codex CLI `codex review --base origin/main` could not complete: first session `01a0490c-f75d-7810-8ff3-55a5e26c2b24` died on sandbox `EPERM` listen, retry session `01a04918-4433-75c0-87d4-febe4b0061b3` returned workspace out of credits. Sol xhigh is the designated independent reviewer in `AGENTS.md`.

### P2-9: approval resume reconciliation was not invoked after DLQ exhaustion

- Location: `workers/brain/wrangler.jsonc` DLQ consumers; `workers/brain/src/index.ts` queue handler; `workers/brain/src/approval-resume.ts` list/replay helpers.
- Cause: the DLQ consumer has three retries and no further DLQ. `replayRecoverableApprovalResumes` existed but was not called from a scheduled handler, queue path or operator command. After eight failed deliveries Cloudflare discards the message while D1 still has `approved` + `pending_approval`.
- Contract: `docs/useful-brain-master-plan.md:285` requires one durable deterministic resume after approval.
- Repair: `enqueueRecoverableApprovalResumes` re-enqueues identifier-only `{ runId, idempotencyKey }` payloads from D1. Brain `scheduled()` calls it. Loopback and staging wrangler set `triggers.crons` to `*/5 * * * *`. Production `crons` is `[]` so this PR does not provision a production cron. Resume stays idempotent.
- Regression: `src/lib/cf/wrangler-config.test.ts` cron assertions; `workers/brain/test/approval-resume.test.ts` enqueue + `scheduled` + consume without a second effect.
- Verification: Brain workerd approval-resume tests passed.

### P2-10: model and read-tool timeouts were unused

- Location: `src/lib/agent/budgets.ts`; `src/lib/agent/run.ts`; `src/lib/connectors/http-allowlist.ts`; `src/lib/connectors/tools.ts`; `src/lib/agent/search-knowledge.ts`.
- Cause: `modelTimeoutMs` and `readToolTimeoutMs` were constants only. Wall time was checked before a tool call. HTTP fetch did not receive the agent abort signal.
- Contract: `docs/useful-brain-master-plan.md:331` (60s model timeout, 10s read-tool timeout, 90s wall time).
- Repair: `toolDeadlineSignal` / `awaitWithDeadline`. Model stream uses a 60s deadline. Search, HTTP and MCP reads use a 10s deadline plus the agent signal. `fetchAllowlistedSource` forwards `AbortSignal`. `afterToolCall` re-checks wall time.
- Regression: `src/lib/agent/deadlines.test.ts`; `src/lib/connectors/http-allowlist.test.ts` hung fetch; `src/lib/connectors/phase6.test.ts` hung HTTP read.
- Verification: focused Node Vitest passed.

### P2-11: persisted tool results were raw and counted JS string length

- Location: `src/lib/agent/run.ts` `toolCallsFromMessages`; `src/lib/store/agent-runs.ts`.
- Cause: storage used the untrusted tool text with `.slice` by UTF-16 code units. `afterToolCall`'s `details.redacted` was not what persistence wrote. A bearer token in an HTTP or MCP payload landed in `tool_calls.redacted_result`. 32,768 CJK code units are 98,304 UTF-8 bytes.
- Contract: `AGENTS.md:74` and `docs/useful-brain-master-plan.md:331` (32 KiB persisted redacted tool results; no secrets in ordinary D1 rows).
- Repair: `redactToolResultForStorage` strips untrusted prefixes, scrubs bearer tokens and secret assignments, then truncates on UTF-8 byte boundaries. `toolCallsFromMessages` persists that value.
- Regression: `src/lib/agent/redact-tool-result.test.ts`; `src/lib/agent/agent-loop.test.ts` secret-bearing plugin result.
- Verification: focused Node Vitest passed.

### P2-12: timestamp ties swapped questions and answers

- Location: `src/lib/store/conversations.ts` `loadReplay` and `loadBoundedHistory`.
- Cause: pairing used only `created_at`. Two user rows at the same timestamp and two assistant rows at timestamp+1 ordered as user, user, assistant, assistant and attached the wrong question.
- Contract: `AGENTS.md:63` and `docs/useful-brain-master-plan.md:54` replayable conversation snapshots.
- Repair: operations migration `0007_parent_user_message.sql`. `materializeClaimedTurn` stores `parent_user_message_id` on the assistant row. Replay and bounded history join on that parent. Local workerd only until `0007` is applied to staging operations D1.
- Regression: `workers/brain/test/conversations-d1.test.ts` concurrent same-timestamp turns.
- Verification: Brain workerd conversation tests passed.

### P2-13: expired approved resumes looped forever

- Location: `workers/brain/src/approval-resume.ts`; `src/lib/store/agent-runs.ts` `expireApproval`.
- Cause: a resume delivered after `expiresAt` failed policy and retried. `expireApproval` only terminalized `pending` rows, so `approved` + `pending_approval` stayed recoverable and the five-minute cron re-enqueued them.
- Repair: resume past expiry calls `expireApproval` for approved rows, returns `{ expired: true }` so the queue acks, and `enqueueRecoverableApprovalResumes` expires overdue rows before listing. A second resume is a no-op.
- Regression: `workers/brain/test/approval-resume.test.ts` late delivery: no effect, run `failed`, approval `expired`, queue ack.
- Verification: Brain approval-resume tests passed.

### P2-14: interactive wall time was not a run deadline

- Location: `src/lib/agent/run.ts`; `src/lib/agent/budgets.ts`.
- Cause: each model call had a 60s timeout and tools had 10s, but nothing capped the whole run at 90s. Two 59s model calls plus a 9s read could finish around 127s.
- Repair: `remainingWallTimeMs` caps the model stream. `shouldStopAfterTurn` and the post-idle finalizer check wall time. `AbortSignal.timeout(wallTimeMs)` aborts the agent.
- Regression: `src/lib/agent/agent-loop.test.ts` wall-time unit test.
- Verification: focused Node Vitest passed.

### P2-15: persisted redaction missed Cookie and Basic credentials

- Location: `src/lib/agent/redact-tool-result.ts`.
- Cause: Bearer and selected assignments were scrubbed; `Cookie` / `Set-Cookie` headers and `Authorization: Basic` remained in `tool_calls.redacted_result`.
- Repair: those headers are replaced with `[REDACTED]` before UTF-8 bounding.
- Regression: `src/lib/agent/redact-tool-result.test.ts`.
- Verification: focused Node Vitest passed.

## Adversarial review of remaining Phase 1–7A (after the eight repairs)

Confirmed in-plan defects from the Grok pass: none beyond the original eight. Confirmed in-plan defects from the independent Sol xhigh pass: P2-9 through P2-12 above, now repaired.

Rejected false positives:

- Memory-store keyword search still tokenizes locally instead of calling `fts5MatchQuery`. That is the fake-provider path. Fake and real fingerprints remain separate; D1 FTS is the real-stack contract.
- No live Worker hybrid retriever yet calls `keywordSearchSql`. The SQL builder is still the D1 FTS contract from Phase 3. Wiring it later must bind `ftsCandidateFetchLimit` and keep rank `0.0`.
- Durable Object `sql.exec` in `ConversationRunLock` is DO SQLite, not D1 `.exec()` newline splitting.
- `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in Brain vitest miniflare bindings are JWT test fixtures. They are not in `wrangler.jsonc` and were not invented as product config.
- Production approval-resume DLQ names are placeholders because `RESOURCES_PROVISIONED=false` and Phase 7B is closed.

## Required landing gates

For each follow-up repair:

1. Add a failing regression before the fix.
2. Run the focused regression.
3. Run `npx tsc --noEmit`, `npm run typecheck:workers`, `npm run lint`, `npm test` and `npm run build` with Node `22.22.2`.
4. Run staging dry-runs for web, Brain and ingestion plus `npm audit --omit=dev --audit-level=high`.
5. Independent review is `codex review --base origin/main`. If Codex CLI is out of credits, GPT-5.6 Sol xhigh via a fresh independent process is the substitute designated reviewer. Fix confirmed P0/P1 or high/critical findings.
6. Use a new branch and PR. Do not start Phase 7B, apply real company data, create production resources, delete Convex or delete Burooj.
