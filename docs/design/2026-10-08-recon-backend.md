# Phase 0 recon: backend half (branch feat/redesign-2026-10, read-only)

All paths are relative to the repo root unless absolute. `BI` = `workers/brain/src/index.ts`.

## 0. Findings that change the plan (read first)

1. **The live chat turn has exactly one tool, `search_knowledge`.** `runKnowledgeAgent` defaults `tools` to it (`src/lib/agent/run.ts:~295`). `createAgentRun`/`completeAgentRun` have **no production caller** (grep: only definitions in `src/lib/store/agent-runs.ts:33,76` plus tests). `/approvals/start|event` exist but nothing in chat ever creates a `pending_approval` run. Approval cards (gaps 10, 11) therefore need the whole write path wired into `executeTurn`, not just a schema tweak.
2. **Session-mode users have no roles or departments and no code path assigns them.** `createAccount` (`src/lib/auth/session-account.ts:137`) inserts only `principals`/`auth_users`/`auth_sessions`. Roles/departments are only inserted by `ensureLoopbackPrincipal` (`src/lib/store/loopback-principal.ts:57,65`) and test seeds. A session user sees only `public` docs (24 of 65). Admin, People, invites and the demo personas (Maya, Priya, Jordan) all need a seeding/assignment path that does not exist.
3. **Today's upload is a synchronous full-corpus rebuild in one Brain request.** UI server action -> `POST /knowledge/seed {merge:true}` -> `loadSeedDocumentsFromGeneration` + `seedNorthwindCorpus` re-chunks and re-embeds every document (`BI:686-736`, `src/lib/store/corpus-seed.ts`). Non-operators get `stampPrivateOwner` (private to the uploader). No per-file stage, no R2 write (an `r2_key` string is stored, nothing is put), the "reconciliation audit" in the seed path is tautological (`vectorIds: () => actualIds`, corpus-seed.ts, derived from `expected`). The ingestion worker is a stub (`workers/ingestion/src/workflow.ts`: ack -> ensureDraft -> `reconcileAndFinalize` with `vectorIds: () => []`, which yields `partial`/failed for any non-empty generation).
4. **Documents have no stored body.** `document_versions` holds digest + a fake `r2_key`. Full text for a reader must be rebuilt from `chunks.content` joined with `\n\n` (`loadSeedDocumentsFromGeneration`), which duplicates the 30-token overlap. `GET /documents/:id` and highlight spans need a body store (new table) or the highlight offsets drift.
5. **Front matter IS persisted, but only denormalised.** `version`, `effective_date`, `department`, `title`, `source_name`, `allowed_*`, `owner_user_id` live in `chunks.metadata` JSON (written by `seedNorthwindCorpus` from `SeedDocumentInput.metadata`; confirmed in `src/lib/eval/northwind-seed-documents.json`). `documents`/`document_versions` have no title/department/version columns. FTS5 (`chunks_fts`) indexes `content` only, not titles or headings (`migrations/corpus/0003_fts5.sql`).
6. **AI Gateway is not in the live call path.** Models call the `AI` binding directly (`src/lib/models/*`, no gateway option; `src/lib/cf/ai-gateway.ts` is a header helper only). The operational log is stdout only (`src/lib/cf/operational-log.ts:writeOperationalLog` = `console.log`). Health row "AI Gateway: N retries in the last hour" has no data source.
7. **No unvalidated model text reaches the UI today.** Chat model is called with `stream: false` (`src/lib/models/workers-ai-chat.ts:138`), `/turns` returns one validated JSON, the `token` ConversationEvent type exists (`src/lib/cf/conversation-events.ts:2`) but `ConversationRunLock.broadcast` has no caller. Audit correction 8 is already satisfied; keep it that way.
8. **`runRetrievalEvals` cannot run against a Cloudflare generation as written.** It takes the in-memory `KnowledgePipeline` and reads `pipeline.store.get` for ACL cross-checks (`src/lib/eval/run-retrieval-eval.ts:55,67`). `CloudflareKnowledgePipeline` has no `.store`.
9. **Brain workerd tests have no `CORPUS_DB`.** `workers/brain/wrangler.test.jsonc` binds only `OPERATIONS_DB`; `apply-migrations.ts` applies only operations migrations. Every corpus-backed Brain route (library, documents, search, readable count, sources) needs the test harness extended first.

## 1. Brain HTTP surface (all in `BI`, one `fetch` router)

Order in `fetch`: startup assert -> `GET /health` (public) -> `handlePublicAuthRoute` (`/auth/signup|login|logout` POST, public, only in session/loopback) -> loopback principal bootstrap -> `PRAGMA foreign_keys=ON` -> `authenticateWorkerRequest` -> routes below. Unknown path -> plain `404 "not found"` (BI:894). No NOT_FOUND code exists in `WorkerErrorCode` (`src/lib/cf/worker-errors.ts`: AUTH_REQUIRED, FORBIDDEN, UNAVAILABLE, VALIDATION_FAILED, INTERNAL_ERROR, RATE_LIMITED, CANCELLED).

| Method | Path | Identity / authz | Handler | Returns |
|---|---|---|---|---|
| GET | /health | none | inline BI:209 | `"ok"` |
| POST | /auth/signup, /auth/login, /auth/logout | public; signup needs `SIGNUP_CODE` | `src/lib/auth/session-routes.ts` | `{user:{id,email,name}, sessionToken}` |
| GET | /whoami | any principal | BI:262 | `{id, kind, subject, roles, departments}` (no isAdmin, no count) |
| GET | /stream (WS) | principal + conversation owner | BI:283 -> DO `ConversationRunLock.fetch` | WS; only `cancelled` events fan out today |
| POST | /approvals/start | principal == run.principalId + conversation owner | BI:296 `upsertApproval` + `APPROVAL_WORKFLOW.create` | `202 {pendingApproval, workflowId, binding}` |
| POST | /approvals/event | principal == binding.principalId | BI:356 `sendEvent` | `{ok, workflowId}` (decision `approve|reject`) |
| POST | /cancel | owner of request/conversation | BI:397 `failTurn` + DO `cancel` | `{ok, runId, conversationId}` |
| POST | /lock, /unlock | conversation owner | BI:459 | lock result |
| POST | /turns | any principal; `assumePrincipal` loopback only; `evalModel` loopback only | BI:483 `executeTurn` | `GroundedAnswerResponse` (sync, full) |
| GET | /turns/:requestId/progress | owner via request_id_claims; others get 404 | BI:549 | `{stage}` / `{stage:"done"}` / `{stage:"failed",errorCode}` |
| GET | /conversations | owner | BI:596 `listRecentConversations` (30) | `[{id,title,createdAt,updatedAt}]` |
| GET/DELETE | /conversations/:id | owner (FORBIDDEN otherwise) | BI:612 `loadConversationForUi` / `deleteConversation` | conversation with turns |
| GET | /knowledge | any principal, ACL-filtered by `canAccessChunk` | BI:648 `loadKnowledgeInventory` (uses `ready ?? active` gen) | documents/chunks/status |
| POST | /knowledge/seed | `merge:true` any user (stamped private); else `operator` | BI:686 | `{generationId, chunkCount, vectorize}` |
| POST | /knowledge/reindex | `operator` | BI:738 | same |
| DELETE | /knowledge/documents/:id | operator or owner | BI:773 | rebuild result |
| POST | /knowledge/promote | operator, or `mayPromoteGeneration` | BI:818 | `{ok, generationId}` |
| GET | /evaluations | any principal; own runs only | BI:859 `listRecentEvalRuns` | `EvalRunResult[]` (manual 12-case set) |
| POST | /evaluations/run | ANY principal (no admin gate) | BI:872 `runManualEvaluations` | run result |
| queue / scheduled | approval resume | n/a | BI:914,932 | cron `*/5` expires/re-enqueues approved runs |

Not present: any `/admin/*`, `/library`, `/documents`, `/search`, `/config`, `/messages/*`, `/people`, `/invites`.

### Identity resolution (`src/lib/auth/worker-identity.ts:117-166`, `identity-mode.ts`)
- Modes: `access | loopback | session | disabled`. `disabled` throws on authenticated routes. Spoof headers rejected (`rejectSpoofedPrincipal`).
- `session`: cookie `usefulbrain.session` -> `resolveSessionPrincipal` (sha256 token hash join auth_sessions/auth_users/principals, roles/departments via `json_group_array`) else `SessionRequiredError` (401 AUTH_REQUIRED).
- `loopback`: session cookie wins if present, else `LOOPBACK_SUBJECT` directory lookup. Loopback principal `principal-dev` is seeded with ALL roles in `LOOPBACK_ROLES` (incl. `operator`, `it_admin`) and all 8 departments (`loopback-principal.ts:10-37`).
- `access`: CF Access JWT + directory lookup.
- Staging/prod use `session` (`wrangler.jsonc` env.staging IDENTITY_MODE). `assertIdentityConfiguration` forbids loopback on staging.
- Roles are free text (`roles.role TEXT`, no CHECK). `operator` is the only role that gates anything (`requireOperator`, BI:184). There is no `admin` anywhere.

### assumePrincipal
- Parsed at `BI:502-513` via `parseAssumedPrincipal(identityMode, raw)`; hard gate `if (identityMode !== "loopback") throw AssumedPrincipalForbidden` (`worker-identity.ts:50`). Test `workers/brain/test/assume-principal.test.ts` asserts the 403 outside loopback.
- Shape is **client-supplied** `{userId, roles[], departments[]}` (arbitrary grants, bounded to 40 terms by `MAX_FILTER_TERMS`). Only retrieval ACL changes (`retrievalPrincipal`, execute-turn.ts:91); storage owner and tool policy stay with the real principal. Assumed turns skip history (`execute-turn.ts:~206`) but **are persisted** in the real principal's conversation unless `persistConversation:false`. Response echoes `assumedPrincipal`.
- The Next server action `askGroundedQuestion` already forwards `assumePrincipal` (`src/app/actions.ts:92-123`).

## 2. Current schema

Operations D1 (`migrations/operations/0001-0011`)
| Table | Key columns |
|---|---|
| principals (0001) | id PK, kind user/service_token, subject, created_at, UNIQUE(kind,subject) |
| roles / departments (0001) | (principal_id, role) / (principal_id, department) PKs. No CHECK on values. |
| auth_users (0011) | id = principals.id, email UNIQUE, name, password_hash |
| auth_sessions (0011) | id, user_id, token_hash UNIQUE, expires_at; auth_login_attempts(email, attempted_at) |
| conversations (0002) | id, owner_principal_id, title, created/updated_at |
| messages (0002,0005,0007) | id, conversation_id, request_id (unique partial), role, content, status pending/completed/failed, answer_type (grounded/insufficient_evidence/unavailable/must_retrieve/invalid_citation), answer_model, embedding_model/dimensions, structured_paragraphs_json, prompt_version, retrieval_config_version, corpus_generation_id, error_code, completion_token, parent_user_message_id. **No latency_ms, no passages_retrieved, no scope/view-as flag.** |
| evidence_snapshots (0002,0010) | PK(message_id,rank), score, chunk_id, source (file name), section, text, token_estimate, citation_label, document_id, generation_id, vector/keyword/fused/rerank_score. Holds ALL retrieved hits (<=8 per search), not only cited. Cited-vs-retrieved is derived from `structured_paragraphs_json`. No doc title/version. |
| request_id_claims (0006,0008) | request_id PK, conversation/user/assistant message ids, owner_principal_id, payload_digest |
| turn_completion_claims (0005) | message_id PK, completion_token UNIQUE |
| agent_runs (0003) | id, conversation_id, principal_id, status running/completed/failed/cancelled/pending_approval, model, prompt_version, corpus_generation_id, evidence_message_id |
| tool_calls (0003,0004) | id, run_id, tool, argument_fingerprint, **normalized_arguments_json** (exact, unredacted), redacted_result, status ok/error/denied/pending_approval |
| approvals (0003,0004) | idempotency_key PK, principal_id, conversation_id, tool, argument_fingerprint (= canonical sorted-key JSON of args, i.e. the args themselves), **expires_at**, status pending/approved/rejected/expired, run_id (unique partial) |
| idempotent_effects, synthetic_mutating_effects (0004) | effect keys; latter stores tool + normalized_arguments_json |
| eval_runs (0009) | id, owner_principal_id, status, total, passed, results_json (manual 12-case set only) |

Corpus D1 (`migrations/corpus/0001-0003`)
| Table | Key columns |
|---|---|
| corpus_generations | id, state draft/indexing/reconciling/ready/active/archived/failed, chunking_version, embedding_model, embedding_dimensions, metadata_index_ready, error_code, created/updated_at |
| corpus_state | singleton, active_generation_id |
| sources | id, kind `upload|github|http`, display_name, config_json |
| documents | id, source_id, path, access_scope, UNIQUE(source_id,path). No title/department/version/owner. |
| document_versions | id, document_id, generation_id, r2_key (not a real object), content_digest, byte_size. UNIQUE(document_id,generation_id). No body, no front matter. |
| chunks (rebuilt in 0003) | id AUTOINCREMENT, chunk_id UNIQUE, document_id, document_version_id, generation_id, heading, chunk_index, content, **start_offset, end_offset** (exist; offsets are body-relative, set from chunker charStart/charEnd), content_digest, vector_id UNIQUE, acl_group, access_scope, allowed_roles JSON, allowed_departments JSON, metadata JSON (front matter + title + owner_user_id) |
| chunks_fts | FTS5 external-content over `content` only (porter unicode61) |
| vector_mutations, reconciliation_audits | audit id = generation id, status complete/partial/unsupported, missing_count, orphan_count |

Absent: tickets, feedback, document requests, invites, turn steps, upload batches/files, health events, view-as audit, draft check results.

## 3. The 17 gaps

Legend: M missing, P partial, E exists. Conflicts marked **[CONFLICT]**; decisions marked **[DECIDE]**.

| # | Status | Evidence | What must be added | Conflicts / flags |
|---|---|---|---|---|
| 1 Admin role + authz | M | No `admin` string in repo; `requireOperator` BI:184; whoami BI:262-281 | `ADMIN_ROLE="admin"` const, `requireAdmin(principal)` (fails closed, throws `WorkerForbiddenError`) applied in one `/admin/*` router prefix check before any handler. `whoami` -> `{id,kind,subject,roles,departments,isAdmin,readableDocumentCount}`. Add `admin` to `LOOPBACK_ROLES`. Keep `operator` for legacy `/knowledge/*` (accept `admin||operator` there during transition). Bootstrap first admin by documented `wrangler d1 execute` insert or invite seed. | **[DECIDE]** admin vs existing `operator`: recommend `isAdmin = roles.includes("admin")`; operator stays legacy. Admin grants NO document read rights (ACL unchanged, master plan §6). No role-assignment path exists (finding 2). `POST /evaluations/run` has no admin gate today; must become admin-only. |
| 2 Turn progress counts | P | `TURN_STAGES` = searching/drafting/checking_citations/saving (`turn-progress.ts:8`); markStage execute-turn.ts:203,224,239; DO `setStage` conversation-lock.ts:144 (column `stage TEXT`, lazy ALTER at :43); payload from BI:569-583; `latency_ms`/`passages_retrieved` absent | Closed union `searching{readableDocuments:int}`, `reading{passages:int}`, `writing`, `done`, `failed{errorCode}`. Store ints in DO via new lazy columns (`stage_n INTEGER`). Counts validated `Number.isInteger && 0..100000`, no text fields. Map: `searching` at turn start (count from ACL-count query), `reading` in `onFirstSearchComplete` (ledger hit count), `writing` when next model stream starts (wrap `runtime.stream`), `checking_citations/saving` kept internal or folded into `writing`. Monotonic via same `canAdvanceTurnStage`. Persist `latency_ms` (Date.now()-start in `completeTurn`) + `passages_retrieved` on the assistant message (ALTER ADD COLUMN, kept OUT of `completionDigest` to preserve idempotent replay). | Existing enum has 4 UI labels in `chat-workspace.tsx:257`; renaming breaks it, so extend additively and migrate the UI together. `reading` -> `writing` dwell is ~0 ms (single non-streaming call follows immediately); UI needs a min dwell or accept skip. `failed{errorCode}` already closed (`TURN_FAILURE_CODES`). Count must be asker-readable (ACL SQL), never corpus total. |
| 3 Feedback | M | none | `message_feedback(message_id, principal_id, value, created_at, PK(message_id,principal_id))`. `POST /messages/:id/feedback {value:"up"|"down"}` upsert (idempotent), `DELETE`. Authz: message must be an assistant message in a conversation owned by caller else 404. Delete cascade in `deleteConversation` (conversation-queries.ts:~228). | none |
| 4 Document requests | M | none | `document_requests` (see §8) UNIQUE(principal_id, question_normalized). `POST /messages/:id/request-document` -> `{requested:true}` always 200 on repeat (idempotent). Only allowed when target message is own assistant message with `answer_type='insufficient_evidence'`. `question_normalized` = lowercase, NFKC, collapsed whitespace, trimmed, <=300 chars, computed server-side from the parent user message (client never supplies text). | none |
| 5 Unanswered | M | none; below-floor candidates are dropped inside `applyRelevanceFloor` (cloudflare-pipeline.ts:392), not recorded | `GET /admin/unanswered?range=7d`: group `messages` (assistant, completed, answer_type=insufficient_evidence, not view-as/eval) by normalized parent question; ask count, last asked, request count (join document_requests). "Likely department": at turn time record best below-floor candidate's department into `messages.best_candidate_department` (new nullable col; needs `RetrievalTrace` extension to return top below-floor chunk id/document). Omit when null. | View-as and eval turns are excluded by construction if assumed turns are never persisted (gap 15). Department leak: dept of a below-floor doc the asker cannot read is revealed to admin only; fine for admin, never in member UI. **[DECIDE]** is changing the trace shape acceptable ("Retrieval parameters change only through eval"): it adds a field, not a parameter, so OK. |
| 6 Overview metrics | M | none | `GET /admin/overview?range=7d` -> totals, grounded %, no-evidence, median latency (compute median in JS from `latency_ms` list, no MEDIAN in SQLite), 7 daily buckets per KPI. Needs `latency_ms` (gap 2) so history before the migration has null latency: exclude nulls and say so (`n`). | Exclude `persist:false` eval turns (not stored) and view-as (not stored). "delta vs last week" needs two ranges in one query. |
| 7 Health | M | `reconciliation_audits` exists; AI binding calls unrecorded; AI Gateway not used (finding 6); log is stdout | `GET /admin/health`: Brain self `ok`; corpus D1 `SELECT 1` ping with timeout; vector index = latest `reconciliation_audits` for the active generation (`complete`+0 missing/orphans = ok, partial=warning, none=warning); Workers AI = new `service_health_events` row written by a thin wrapper around `AI.run` (status ok/error, code only); AI Gateway = **not configured** (return `warning`/`not_configured`, or drop the row). Each `{service, status:"ok|warning|error", detail}`; `detail` is a closed code mapped to text by UI/Brain, no provider strings (HOST_LEAK regex precedent in worker-errors.ts). | **[CONFLICT]** master plan §4/§8 says AI Gateway routes models and logs retries; code does not. Spec row "2 retries in the last hour" cannot be backed. **[DECIDE]** show "not configured" honestly. Seeded audit is self-referential (finding 3) so "Synced to g-..." is only as real as the audit. |
| 8 Library + reader | M | `GET /knowledge` exists (BI:648) but uses ready-else-active gen, has no sections/labels; no body store | `GET /library` (active generation only, ACL before listing): id, title, department, readers label, headings. `GET /documents/:id` -> metadata (version, effective_date, owner department, readers label) + sections `[{heading, text}]`; **404 not 403** for unreadable or unknown or not-in-active-gen (indistinguishable). `?message=<id>` -> `spans` only if the message is in caller's conversation and the doc was cited by it. Needs corpus `document_catalog` + `document_bodies` (§8) written at seed time. | Spans: derive sentence offsets by locating the cited paragraph text inside the cited chunk range `[start_offset,end_offset]` of the body; offsets are only returned for docs the caller fully reads (consistent with `principalHasFullDocumentAccess`, cloudflare-pipeline.ts:~250; master plan §6 forbids layout-revealing offsets for partial access). Doc readable = all its chunks readable (ACL is per document today). Readers label for `private`: "Only you"/owner-only; never print another user's id. |
| 9 Search | M | FTS5 content-only; chunk heading in `chunks.heading` | `GET /search?q=` (q 2..200 chars): <=5 own chats (title + message `LIKE` escaped, owner-scoped; no FTS needed) and <=5 readable docs. Docs: new FTS5 `document_search_fts(title, headings)` external-content over `document_catalog`, ACL predicate in the same SQL (`aclSqlAndParams` works unchanged if catalog uses the same column names `access_scope/allowed_roles/allowed_departments/metadata` and alias `c`), generation = active. Return `{matches:[[start,end]]}` ranges computed server-side over title. | ACL in SQL before ranking, same as `keywordSearchSql` (access.ts:~190). Chat hits restricted to caller. Do not search assumed-principal data. Rate limit: none exists in Brain; consider a cheap per-principal cap. |
| 10 Approvals w/ visible args | P | Exact args at `tool_calls.normalized_arguments_json` (unredacted); `approvals.argument_fingerprint` is the same canonical JSON; expiry `approvals.expires_at`, 15 min (`budgets.ts:10`), statuses incl. `expired` (workflow timeout path `approval-workflow.ts:40`) | Add `approvals.display_arguments_json` (redacted via `redactJsonSecrets`, bounded) written in `upsertApproval`; keep exact args for execution (redacting execution args would break `argumentFingerprint(args) === stored`, approval-resume.ts:~83). Surface approval state in `loadConversationForUi` (currently NO tool/approval data there, conversation-queries.ts) by joining `agent_runs.evidence_message_id = assistant message id`. Derive `expired` at read time when `status='pending' && now>expires_at`. Make live chat create the run (see §5). | Approve/deny keep binding fingerprint + idempotency key (unchanged). Client never supplies args; server re-derives binding (`serverOwnedApprovalBinding`) already. |
| 11 create_ticket | P | Tool is `mcp_create_ticket` `{title}` (`connectors/tools.ts:23`, policy REGISTRY `policy.ts`), in-memory store in `startSyntheticMcp` (`mcp-session.ts:21`), durable dispatcher only accepts exactly `{title}` (`approval-resume.ts:31-45`); effects table `synthetic_mutating_effects` | New tool `create_ticket` (policy: `external_write`, sequential) with typebox `{desk:"Support", priority:"P0|P1|P2|P3", customer:string(1..120), subject:string(1..200)}` (use `typebox/value` `Value.Check` at the route/tool boundary; used nowhere for routes today). `tickets` table in operations D1, `SUP-` + autoincrement seq seeded to 4800 (migration inserts into `sqlite_sequence`), UNIQUE(idempotency_key), insert inside `commitApprovedResumeWrites` batch guarded by `STILL_APPROVED_RESUME`. Replace `assertSupportedArguments` with a per-tool schema map. Keep old `mcp_create_ticket` + its tests untouched (additive). | Wire into `executeTurn` (finding 1). Master plan §7: mutating tools sequential, policy gateway on every path: satisfied by registry. Tool name differs from spec (`create_ticket` vs registered `mcp_create_ticket`); register new name. Stays synthetic (AGENTS: synthetic data only). |
| 12 Activity + traces | M | no step storage; pipeline has no timings; `OPERATIONAL_LOG` stdout only | `turn_steps(message_id, seq, step, detail_json, duration_ms)` closed `step` enum (rewrite,retrieve,rerank,generate,tool_call,approval,result). Writer = `executeTurn` collecting spans (extend `RetrievalTrace` with `timings{vectorMs,keywordMs,rerankMs}`), details = ids, counts, scores only, passed through `redact-tool-result` helpers; batched into the `completeTurn` batch or a follow-up idempotent insert (`ON CONFLICT(message_id,seq) DO NOTHING`). `GET /admin/activity?outcome=&cursor=` keyset on `(created_at,id)`; `GET /admin/activity/:messageId`. Outcome derived: grounded->answered, insufficient_evidence->no_evidence, failed->error, approval status->approved/denied. Person = principal subject. | **[DECIDE]** Admin sees other users' questions and answers? Spec shows the Question column. Master plan §9: restricted operator view OK; §9 also says employee surfaces never expose cross-user traces. Admin-only, IDs+scores only for steps, question text visible: needs Wasim's nod. "rewrite" step: there is no query-rewrite stage today; record the model's `search_knowledge` query (still user-derived text) or drop the step. |
| 13 Sources + uploads | P/M | see §6 | `GET /admin/sources`: active generation summary (`corpus_generations`, `corpus_state`, doc/chunk counts, `REAL_STACK_FINGERPRINT`), draft (state + progress), documents via catalog. `POST /admin/uploads`, `GET /admin/uploads/:batchId`, promote/discard endpoints (§6, §8). | **[CONFLICT]** (a) gap 17 + audit 3/5 say evals are read-only/repo-run, gap 13 says Brain runs `run-retrieval-eval` on the draft: this is a retrieval/ACL check (no answer model) so it is compatible with "evals read-only in the UI", but it is a new server-side eval runner and costs Workers AI (120 embeds + 120 rerank calls per draft; cost decision is Wasim's). Master plan §10 forbids tuning against the locked 120; running it as a regression/ACL guard on a draft is fine, never writes the active corpus. (b) "live recall 0.995" on a draft of 2 uploaded docs measures regression of old docs, not the new files; add a per-upload ACL parity probe. (c) Upload ACL selection (Everyone/Departments/Roles) vs today's ingest: `stampPrivateOwner` forces private for non-operators and `seedDocumentFromUpload` hard-codes `public` + dept `support` (`src/app/actions.ts:332-365`); new flow must map selection -> `accessScope` (`public`/`department`/`role`) and validate against the known department/role vocab, admin only. (d) Admin listing other users' `private` docs: show title + "Private" label only. |
| 14 People/groups/invites | M | no list endpoints; no email stack; no assign path | `GET /admin/people` (principals JOIN auth_users, roles, departments, last_active = max(auth_sessions.created_at)/messages.created_at, readable count computed with `canAccessChunk` / `aclSqlAndParams` over distinct catalog docs per person). `GET /admin/groups` derived: departments, roles, built-in; document delta = count of docs only readable via that group. `invites(id, email, role, department, token_hash, expires_at, accepted_at, created_by)`; `POST /admin/invites` returns a one-time URL (token shown once, only sha256 stored); public `POST /auth/invite/accept {token,password,name}` adds to `isPublicAuthPath` (`session-routes.ts:20`) and creates principal + auth_user + roles + departments + session in one `db.batch`, single-use via `UPDATE ... WHERE accepted_at IS NULL AND expires_at>? ` rowcount check. | **[CONFLICT-lite]** AGENTS/master plan: "no public signup, SSO onboarding, tenant switching". Admin-issued, single-use, expiring invite links are not public signup, and the existing signup gate (`SIGNUP_CODE`) stays; call it out in the plan. `roles`/`departments` have no vocab constraint: validate invite role/department against the Northwind vocab (departments: engineering, executive, finance, hr, legal, operations, sales, support; roles from questions.json principals: standard, manager, director, hr_manager, finance_manager, sales_manager, support_manager, executive, it_admin). Admin cannot invite another `admin` unless explicit flag (privilege escalation). Per-person readable counts = N principals x one count query; cache per request, cap list at 200. |
| 15 View as (session mode) | M | gate `worker-identity.ts:50`; client-supplied grants; assumed turns persisted | Allow when `identityMode in {loopback, session}` AND `principal` has admin (loopback keeps old behavior). **Change the input**: accept `assumePrincipalId` (a principals.id), resolve roles/departments **server-side** from D1 (never trust browser-supplied grant lists, master plan §4 table row "Web Worker"); keep old shape for loopback evals. Force ephemeral: `persist=false` for any assumed turn in session mode; no `history`. Write `view_as_audits(id, admin_principal_id, assumed_principal_id, request_id, question_sha256, answer_type, cited_document_ids_json, created_at)` BEFORE the turn (insert) and update after (idempotent by request_id). Exclude from metrics (nothing in `messages`). Exists-but-restricted diagnostic: after refusal only, `SELECT` distinct catalog docs (title, readers label) matching question tokens with NO ACL filter, only if admin; response field `adminDiagnostic` set only for admin caller, never passed to `runKnowledgeAgent`. | **[CONFLICT]** (1) Code and docs say assumePrincipal is "confined to the loopback trust boundary" (worker-identity.ts comment) and `assume-principal.test.ts` pins the 403; those must be rewritten, and this is an impersonation feature = security-sensitive row: three reviewers (Sol high + Sonnet high + Opus). Not forbidden by AGENTS.md text, but opens a hole `rejectSpoofedPrincipal` is designed to close, so it needs an independent security verdict. (2) Master plan §6/§9: "never expose ... denied candidates"; the diagnostic reveals existence+title of a restricted doc to an admin who may not be allowed to read it. **[DECIDE]** keep title only, no chunk id/score/text, exclude `private` owner docs, audit every use. (3) Ephemeral view-as turns lose the progress poller/Stop (both key off persisted messages, `loadOwnedTurnProgressByRequestId`); either accept generic status line for view-as or add an ephemeral progress path. (4) Assumed echo `assumedPrincipal` in response: for session mode return `{id,displayName}` only. |
| 16 Config read-out | M (data exists) | `CHAT_MODEL_ID`, `SELECTED_MODELS` (`models/selection.ts`), `REAL_STACK_FINGERPRINT` (topK 8, floor 0.05, reranker), `fingerprintId`, `activeGenerationId` | `GET /config` (admin) -> `{models:{answer,embedding,reranker}, retrieval:{mode:"hybrid"|"keyword", topK, relevanceFloor, configVersion}, activeGenerationId, connectors:[{id,label,kind,approval:"required"|"none",status}]}`. Mode from `env.VECTORIZE ? hybrid : keyword` as in BI:666. Connectors: derive from `sources` (kind `upload`/`github`/`http`) + policy REGISTRY tools with `risk!="read"`; do NOT expose `seedSyntheticConnectors()` ids as-is. | GitHub "Connect" button has no Brain endpoint (connectors/github-tree.ts is library code only, no sync route). **[DECIDE]** render disabled/"coming soon" or add a source-create endpoint (outside the 17). Admin-only here (README). |
| 17 Evals read-out | P | `GET /evaluations` = own manual runs only (BI:859); frozen campaign data is TS constants in `src/lib/eval/campaign-snapshot.ts` (baseline/pass1/final/coverage + `NORTHWIND_CAMPAIGN.retrieval`), raw JSON in `evals/results/**/findings.*.json` (not readable from a Worker) | Extend to `GET /evaluations` (admin) -> `{model, runs:[{key,label,date,passed,scored,categories}], retrieval{recallAt3,mrr,liveRetrievedRecall,aclLeaks}, failures:[{id,category,asked_as,expected:[{documentId,section}],note,detail}], manualRuns}`. Failures' `asked_as/expected/note` from `content/northwind/questions.json` (52 KB; import at build, tree-shake to the failing ids). Add a vitest that asserts snapshot constants equal the committed `evals/results` JSON so they cannot drift. Do NOT edit `evals/results`. | Design label "Pass 2" vs constant label `Pass 2`/`final`, "Latest" = `coverage` OK. Existing manual `/evaluations/run` stays admin-gated; UI is read-only. Never delete eval results (global rule). |

### Extra gaps not in the 17 (need endpoints too)
- **E1 Suggested questions** (screen 01, "only from documents the member can read"): new `GET /suggestions` returning <=4 entries from a curated list intersected with readable docs (catalog join). No store today.
- **E2 Retry same user message** (screen 06): `createPendingTurn` always inserts a new user message. Need `POST /turns {retryOfMessageId}` reusing `parent_user_message_id` (idempotent per original + attempt).
- **E3 "Ask about this" scoped chat** (Library): `scopeDocumentId` on `/turns` (retrieval restricted AFTER ACL; unreadable doc -> 404).
- **E4 Account card "Can read 31 of 62"** and People bars "of 62 active": **[CONFLICT]** with audit correction 1 (members must not learn corpus totals). Members get readable count only; the denominator may appear on admin screens only.
- **E5 Sources shows other users' private uploads** to admin: see gap 13(d).
- **E6 Conversation payload** (`loadConversationForUi`) collapses `answerType` to grounded|insufficient_evidence (conversation-queries.ts:~170) and drops `latency_ms`, tools, approvals, feedback: extend additively.

## 4. Turn pipeline today

UI (`chat-workspace.tsx`) -> Next server action `askGroundedQuestion` (`src/app/actions.ts:92`) -> `brainJson("/turns")` (`src/lib/cf/brain-client.ts`, service binding `BRAIN`, forwards cookie + access JWT + x-request-id) -> `BI:483` validates question (<=2000), `parseAssumedPrincipal`, `parseEvalModelOverride` -> `executeTurn` (`src/lib/brain/execute-turn.ts`):
1. `activeGenerationId` once; `CloudflareKnowledgePipeline` (or empty pipeline if no corpus/generation).
2. `createPendingTurn` (request_id claim, conversation, user msg, pending assistant msg) -> DO `lock.acquire`.
3. `markStage("searching")` (:203) -> `runKnowledgeAgent` (Pi agent): tool loop, `search_knowledge` (ACL via `aclFilterFor`, FTS with `aclSqlAndParams`, Vectorize acl_group filter, rerank, floor, topK 8), `onFirstSearchComplete` -> `markStage("drafting")` (:224), host grounding/citation repair/coverage pass inside `run.ts`.
4. `markStage("checking_citations")` (:239) -> `structuredJsonFromGroundedProse` -> `persistThenRelease` -> `completeTurn` (answer_type, structured paragraphs, all evidence rows with channel scores) -> lock release.
5. Returns full JSON. Client polls `/api/turns/:requestId` (Next route -> Brain `/turns/:id/progress`) for the stage, and `/cancel` for Stop.

Stage storage: DO SQLite `run_lock.stage` (conversation-lock.ts:43-76,144-189); progress endpoint reads it only when `lock.runId === handle.runId`, else reports `searching`.

Unvalidated text reaching UI: **none** (finding 7). `stream:false` model call; `serializeConversationEvent` is the only fan-out and has no producer for `token`. Keep: do not wire `token` events.

Readable document count with the same ACL code as retrieval: add `countReadableDocuments(db, generationId, principal)` next to `keywordSearchSql` using `aclSqlAndParams(aclFilterFor(principal))`: `SELECT COUNT(DISTINCT c.document_id) FROM chunks c WHERE c.generation_id = ? AND ${sql}` (same predicate string as the FTS channel, so they cannot diverge). Used by: whoami, `searching{readableDocuments}`, Account card, People table. Also test that equals `canAccessChunk`-based count (`loadKnowledgeInventory` computes the same set in JS, `knowledge-inventory.ts:~118`, useful as the oracle).

## 5. Approval + create_ticket

- Args today: `mcp_create_ticket {title}` (typebox, `connectors/tools.ts:23`). Policy: `external_write`, `executionMode:sequential` (policy.ts REGISTRY). `evaluateToolPolicy` -> `pending_approval` with `ApprovalBinding{principalId, conversationId, tool, argumentFingerprint, idempotencyKey, expiresAt}`; `argumentFingerprint = JSON.stringify(normalizeToolArguments(args))` (sorted keys). Idempotency key = `mutatingIdempotencyKey(tool, args, "<principal>-<conversation>-<toolCallId>")` = slug + sha256 prefix (approvals.ts). Expiry `now + AGENT_BUDGETS.approvalExpiryMs` (15 min).
- Flow: tool returns `terminate` + `pendingApproval` -> (library only today) caller persists run via `createAgentRun/completeAgentRun(status pending_approval, toolCalls[pending_approval])` -> client `POST /approvals/start` (server recomputes binding; rejects client mismatch; `upsertApproval` pending; Workflow `waitForEvent` 15 min) -> `POST /approvals/event` -> `decideApproval` (compares event binding to stored; `expireApproval` on timeout) -> enqueue resume -> `resumeApprovedAgentRun` (re-checks fingerprint, expiry, policy; atomic batch writes `synthetic_mutating_effects`, `idempotent_effects`, flips tool_call -> ok, run -> completed, all guarded by `STILL_APPROVED_RESUME`). Cron `*/5` re-enqueues approved and expires overdue.
- In-memory ticket store: `startSyntheticMcp` closure `store` (`mcp-session.ts:21`), id `t-${store.length+100}`; test-only. The durable resume does NOT call MCP at all (it writes `synthetic_mutating_effects`). So "ticket created" today persists only `{resumed:true, tool}` JSON, no ticket id. New `tickets` table fixes this.
- Expired UI state needs: read-time derivation + the workflow's `expired` status; deny state = `rejected`.

## 6. Ingestion and upload

- UI path: Next parses files (`src/lib/rag/extract-upload.ts`: .md/.markdown/.txt/.pdf, 10 MB cap; spec says PDF, DOCX or Markdown up to 25 MB, so **DOCX unsupported today, 25 MB > 10 MB cap and > D1 row**) -> `/knowledge/seed merge`. Non-operator becomes private; ACL selection not supported.
- Generation lifecycle in seed path (all inside the request): `ensureDraftGeneration` -> `indexing` -> chunks upserted (batch 20) -> embed (8/batch) -> Vectorize upsert -> `reconciling` -> self-audit -> `ready`. `/knowledge/promote` -> `promoteGeneration` (atomic batch: ready->active, pointer, old active->archived). No discard endpoint (a stale `ready`/`failed` generation just sits; `latestReadyOrActiveGenerationId` prefers newest `ready`!, which means an un-promoted draft silently becomes the base for the next merge and `loadKnowledgeInventory`).
- States are only `draft|indexing|reconciling|ready|active|archived|failed`; `canMarkReady` needs complete clean audit + metadata_index_ready.
- Reconciliation audit: `recordAudit` upsert by generation id; real inventory (`Vectorize` ID listing) not implemented anywhere live.
- Per-file stage observability: **none**. Chunk-level progress ("Embedding 41 of 58") **none**.
- Ingestion worker has R2 (`SOURCES`), Vectorize, AI, corpus D1 bindings (`workers/ingestion/wrangler.jsonc`), consumes `useful-brain-ingest-*` queue, Brain has the `INGEST_QUEUE` producer binding but no R2/ops access in ingestion. Master-plan-aligned design: Brain `POST /admin/uploads` (admin, ACL selection validated) stores the parsed text + ACL in corpus D1 (`upload_files`, stage `parsing` done) and enqueues `{jobId, idempotencyKey}` (IDs only, existing message shape `queue-message.ts`); `IngestionWorkflow` steps: chunk -> embed -> upsert -> mark per-file stage, updating `upload_files.stage` and `generation_progress`; then `reconcile` with a **real** Vectorize ID listing; then `draft_checks` (ACL parity + retrieval check). Discard = `corpus_generations.state='failed'` + vectors delete by namespace + remove staged rows.
- Existing 3 queue/workflow tests pattern: `workers/ingestion/test/{queue,workflow,generations,fts5}.test.ts` (corpus-bound).

## 7. Test harness

- Brain: `workers/brain/vitest.config.mts` uses `@cloudflare/vitest-plugin` (`cloudflareTest`), `readD1Migrations(migrations/operations)` -> `env.TEST_MIGRATIONS`, `wrangler.test.jsonc` (binds `OPERATIONS_DB`, DO `CONVERSATION`, queue producer, workflow), default `IDENTITY_MODE=access` with a mocked JWKS (`test/jwt.ts`: `generateSigning/jwksResponse/signToken`). `test/apply-migrations.ts` applies ops migrations + `PRAGMA foreign_keys=ON`. Session tests build `sessionEnv = {...env, IDENTITY_MODE:"session", SIGNUP_CODE}` and sign up via `/auth/signup` (`session-auth.test.ts`, `promote-auth.test.ts`). Requests built via `createBrainServiceRequest` (access) or `new Request("https://brain.internal/...")` + `cookie: usefulbrain.session=<token>`.
- Seed (`test/seed.ts`): principal-alice (alice@karkoai.com, role operator, dept engineering), principal-dev (dev@localhost, operator), principal-bot (service_token, role ingest). No `admin` role, no members with departments, no corpus. Session-created users have no roles.
- Corpus tests: Node-side with hand-rolled `CorpusSql` stubs (`cloudflare-pipeline.test.ts:1-60`) or ingestion workerd with real D1 (`workers/ingestion/test/*`, `TEST_MIGRATIONS` = corpus). `promote-auth.test.ts` stubs `CORPUS_DB` inline.
- Root vitest (`vitest.config.ts`, jsdom) excludes `workers/**`; `npm test` runs root then `npm run test:workers` (types:workers -> brain -> ingestion). CI `.github/workflows/verify.yml`: tsc, typecheck:workers, lint, test, build, 3 wrangler dry-runs.
- **To add**: (1) bind `CORPUS_DB` in `workers/brain/wrangler.test.jsonc` (+ `migrations_dir`), add a second migrations binding `TEST_CORPUS_MIGRATIONS` in the vitest config and apply both in `apply-migrations.ts`; extend `env.d.ts`. (2) Extend `seed.ts` with Northwind-shaped members: `member-maya` (engineering/standard), `member-priya` (support/standard), `member-jordan` (operations, role `admin`), `member-hr` (hr_manager), each with an `auth_users` row + session token helper. (3) A `seedCorpus()` helper inserting a small synthetic generation through `seedNorthwindCorpus` with `ai`/`vectorize` undefined (keyword-only) using 6-8 docs spanning public/department/role/private. (4) tests follow `ui-api.test.ts` shape. Per global rules: write failure cases first, prefer E2E-style Brain route tests; no post-hoc unit tests.

## 8. Proposed backend contracts

Naming: `src/lib/contracts/redesign.ts` (shared types, closed unions), validation via `typebox/value` (`Value.Check`) at each route, errors via existing `WorkerValidationError`/`WorkerForbiddenError` + new `WorkerNotFoundError` (404, code `NOT_FOUND`, added to `WorkerErrorCode` and the Next `brainJson` mapper). All new routes sit before the 404 in BI; admin routes behind one `if (path.startsWith("/admin/")) requireAdmin(principal)`.

### Migrations (all additive; never edit applied files)
Operations:
- `0012_turn_metrics_feedback.sql`
  ```sql
  ALTER TABLE messages ADD COLUMN latency_ms INTEGER;
  ALTER TABLE messages ADD COLUMN passages_retrieved INTEGER;
  ALTER TABLE messages ADD COLUMN best_candidate_department TEXT;
  CREATE INDEX messages_by_type_created ON messages (role, status, answer_type, created_at);
  CREATE TABLE message_feedback (
    message_id TEXT NOT NULL REFERENCES messages (id),
    principal_id TEXT NOT NULL REFERENCES principals (id),
    value TEXT NOT NULL CHECK (value IN ('up','down')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, principal_id));
  CREATE TABLE document_requests (
    id TEXT PRIMARY KEY,
    principal_id TEXT NOT NULL REFERENCES principals (id),
    message_id TEXT NOT NULL REFERENCES messages (id),
    question_normalized TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (principal_id, question_normalized));
  CREATE INDEX document_requests_by_question ON document_requests (question_normalized);
  ```
- `0013_admin_invites_viewas.sql`
  ```sql
  CREATE TABLE invites (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, department TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, accepted_at INTEGER,
    created_by TEXT NOT NULL REFERENCES principals (id), created_at INTEGER NOT NULL);
  CREATE UNIQUE INDEX invites_open_email ON invites (email) WHERE accepted_at IS NULL;
  CREATE TABLE view_as_audits (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
    admin_principal_id TEXT NOT NULL REFERENCES principals (id),
    assumed_principal_id TEXT NOT NULL REFERENCES principals (id),
    question_sha256 TEXT NOT NULL, answer_type TEXT, cited_document_ids_json TEXT,
    diagnostic_shown INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  ```
- `0014_tickets_approval_display.sql`
  ```sql
  ALTER TABLE approvals ADD COLUMN display_arguments_json TEXT;
  CREATE TABLE tickets (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, idempotency_key TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL REFERENCES agent_runs (id), principal_id TEXT NOT NULL REFERENCES principals (id),
    desk TEXT NOT NULL CHECK (desk = 'Support'),
    priority TEXT NOT NULL CHECK (priority IN ('P0','P1','P2','P3')),
    customer TEXT NOT NULL, subject TEXT NOT NULL, created_at INTEGER NOT NULL);
  INSERT INTO sqlite_sequence (name, seq) VALUES ('tickets', 4799);
  ```
  (id shown as `'SUP-' || seq`; first ticket SUP-4800. Verify `sqlite_sequence` insert works under D1/workerd in a test before relying on it; fallback: seed row then delete.)
- `0015_turn_steps_health.sql`
  ```sql
  CREATE TABLE turn_steps (
    message_id TEXT NOT NULL REFERENCES messages (id), seq INTEGER NOT NULL,
    step TEXT NOT NULL CHECK (step IN ('rewrite','retrieve','rerank','generate','tool_call','approval','result')),
    detail_json TEXT NOT NULL DEFAULT '{}', duration_ms INTEGER,
    PRIMARY KEY (message_id, seq));
  CREATE TABLE service_health_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, service TEXT NOT NULL CHECK (service IN ('workers_ai','vectorize','corpus_db')),
    status TEXT NOT NULL CHECK (status IN ('ok','error')), code TEXT, at INTEGER NOT NULL);
  CREATE INDEX service_health_by_service_at ON service_health_events (service, at);
  ```
  (Trim rows >24 h in the `scheduled` handler.)

Corpus:
- `0004_document_catalog.sql`
  ```sql
  CREATE TABLE document_catalog (
    document_id TEXT NOT NULL, generation_id TEXT NOT NULL,
    title TEXT NOT NULL, department TEXT, version TEXT, effective_date TEXT, headings_json TEXT NOT NULL DEFAULT '[]',
    access_scope TEXT NOT NULL, allowed_roles TEXT NOT NULL DEFAULT '[]', allowed_departments TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',          -- same column names as chunks so aclSqlAndParams("c.") works
    chunk_count INTEGER NOT NULL, updated_at INTEGER NOT NULL, file_name TEXT NOT NULL,
    PRIMARY KEY (document_id, generation_id));
  CREATE TABLE document_bodies (
    document_id TEXT NOT NULL, generation_id TEXT NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY (document_id, generation_id));
  CREATE VIRTUAL TABLE document_search_fts USING fts5(title, headings, content='document_catalog_fts_src', ...);
  ```
  (use an INTEGER AUTOINCREMENT rowid column on `document_catalog` and external-content FTS with the same insert/delete/update trigger pattern as `0003_fts5.sql`; `INSERT OR REPLACE` forbidden.) Backfill: the active generation is rebuilt from `chunks` in a one-time migration step or a Brain startup repair (idempotent), because existing generations lack bodies.
- `0005_uploads_draft_progress.sql`
  ```sql
  CREATE TABLE upload_batches (
    id TEXT PRIMARY KEY, generation_id TEXT NOT NULL, created_by TEXT NOT NULL,
    access_scope TEXT NOT NULL CHECK (access_scope IN ('public','department','role')),
    allowed_roles TEXT NOT NULL DEFAULT '[]', allowed_departments TEXT NOT NULL DEFAULT '[]',
    idempotency_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
  CREATE TABLE upload_files (
    id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES upload_batches (id),
    file_name TEXT NOT NULL, byte_size INTEGER NOT NULL, document_id TEXT,
    stage TEXT NOT NULL CHECK (stage IN ('parsing','chunking','embedding','ready','failed')),
    error_code TEXT, chunks_total INTEGER, chunks_embedded INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
  CREATE TABLE draft_checks (
    generation_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('running','passed','failed')),
    reconciled INTEGER NOT NULL DEFAULT 0, acl_leaks INTEGER, live_recall REAL, questions_run INTEGER,
    started_at INTEGER NOT NULL, finished_at INTEGER);
  ```

### Endpoints and types (TypeScript sketch; all unions closed)
```ts
type WhoAmI = { id: string; kind: "user"|"service_token"; subject: string; roles: string[]; departments: string[]; isAdmin: boolean; readableDocumentCount: number };
type TurnProgress =
  | { stage: "searching"; readableDocuments: number } | { stage: "reading"; passages: number }
  | { stage: "writing" } | { stage: "done" } | { stage: "failed"; errorCode: TurnFailureCode };
// GET /turns/:requestId/progress (existing route, additive union). Old stages kept as accepted-but-hidden until UI migrates.
type FeedbackBody = { value: "up"|"down" };       // POST /messages/:id/feedback -> {value}; DELETE -> {ok:true}
type RequestDocumentRes = { requested: true };     // POST /messages/:id/request-document
type UnansweredRes = { range: "7d"; items: { question: string; asks: number; lastAskedAt: number; requests: number; likelyDepartment?: string }[] };
type OverviewRes = { range: "7d"; from: number; to: number; questions: Kpi; groundedPct: Kpi; noEvidence: Kpi; medianLatencyMs: Kpi };
type Kpi = { value: number; previous: number; daily: number[] /*7*/ };
type HealthRes = { services: { id: "brain"|"corpus_db"|"vector_index"|"workers_ai"|"ai_gateway"; status: "ok"|"warning"|"error"; detail: HealthDetailCode }[] };
type LibraryRes = { documents: { id: string; title: string; department: string|null; readers: ReadersLabel; headings: string[] }[] };
type ReadersLabel = { kind: "everyone"|"departments"|"roles"|"private"; names: string[] };
type DocumentRes = { id: string; title: string; version: string|null; effectiveDate: string|null; ownerDepartment: string|null; readers: ReadersLabel;
  sections: { heading: string; text: string }[]; spans?: { section: number; start: number; end: number; citation: number; active: boolean }[] };
type SearchRes = { chats: { id: string; title: string; updatedAt: number; matches: [number,number][] }[]; documents: { id: string; title: string; snippet: string; department: string|null; matches: [number,number][] }[] };
type ApprovalView = { state: "pending"|"approved"|"denied"|"expired"; tool: "create_ticket"; arguments: { desk: "Support"; priority: "P0"|"P1"|"P2"|"P3"; customer: string; subject: string }; expiresAt: number; ticket?: { id: string /*SUP-4821*/ } };
type CreateTicketArgs = { desk: "Support"; priority: "P0"|"P1"|"P2"|"P3"; customer: string; subject: string };
type ActivityRes = { items: { messageId: string; at: number; person: string; question: string; outcome: "answered"|"no_evidence"|"approved"|"denied"|"error"; sources: number; latencyMs: number|null }[]; nextCursor: string|null };
type ActivityTrace = { messageId: string; steps: { seq: number; step: StepName; detail: Record<string, string|number|boolean|null>; durationMs: number|null }[] };
type SourcesRes = { active: { id: string; promotedAt: number; documents: number; chunks: number; retrieval: "hybrid"|"keyword" } | null;
  draft: { id: string; state: "building"|"checking"|"checks_passed"|"checks_failed"|"failed"; embeddedChunks: number; totalChunks: number; documents: number; failedFiles: number; checks?: { reconciled: boolean; aclLeaks: number; liveRecall: number } } | null;
  documents: { id: string; title: string; fileName: string; department: string|null; readers: ReadersLabel; chunks: number; updatedAt: number; status: "active"|"draft"|"failed"; errorMessage?: string }[] };
type UploadReq = { files: { name: string; size: number; text: string }[]; readers: { kind: "everyone" } | { kind: "departments"; names: string[] } | { kind: "roles"; names: string[] }; idempotencyKey: string };
type UploadStatus = { batchId: string; files: { id: string; name: string; stage: "parsing"|"chunking"|"embedding"|"ready"|"failed"; errorMessage?: string }[] };
// POST /admin/drafts/:id/promote  (requires draft_checks.status='passed' && acl_leaks===0, then promoteGeneration)
// POST /admin/drafts/:id/discard  (state failed/archived + vector delete, never touches active)
type PeopleRes = { people: { id: string; name: string; email: string; role: "admin"|"member"; department: string|null; readable: number; lastActiveAt: number|null }[] };
type GroupsRes = { groups: { id: string; label: string; type: "built_in"|"department"|"role"; people: number; addsDocuments: number; rule: string }[] };
type InviteReq = { email: string; role: string; department: string };  // -> { url: string /* shown once */, expiresAt: number }
type AssumeRef = { assumePrincipalId: string };  // session mode; server loads grants
type TurnRes = GroundedAnswerResponse & { approval?: ApprovalView; adminDiagnostic?: { exists: true; title: string; readers: ReadersLabel }[] /* admin + view-as refusal only */ };
type ConfigRes = { models: { answer: string; embedding: string; reranker: string }; retrieval: { mode: "hybrid"|"keyword"; passages: number; rerankFloor: number; configVersion: string }; activeGenerationId: string|null; connectors: { id: string; label: string; kind: "upload"|"github"|"http"|"action"; approval: boolean; status: "active"|"connected"|"not_connected" }[] };
type EvalsRes = { model: string; runs: CampaignRunView[]; retrieval: { recallAt3: number; mrr: number; liveRetrievedRecall: number; aclLeaks: number }; failures: { id: string; category: string; askedAs: string; expected: { documentId: string; section: string }[]; note: string; detail: string }[] };
```

### Test list (failure cases first; Brain workerd E2E-style)
- Authz: every `/admin/*` route x {no cookie 401, member 403, admin 200}; role string case variants (`Admin`, `admin ` ) denied; admin does not gain document access (member-only doc still absent from admin's `/library` unless ACL grants).
- whoami: `readableDocumentCount` equals `canAccessChunk` oracle for each seeded persona; excludes other users' private docs; progress `searching.readableDocuments` equals that count; never equals corpus total for a restricted persona.
- Progress: closed union rejects unknown stage/non-integer/negative/huge; monotonic (reading cannot follow writing); no text fields present; stale run id ignored.
- Metrics: `latency_ms`/`passages_retrieved` persisted once; replayed duplicate turn does not change digest or double-write; eval and view-as turns absent from overview.
- Feedback: unique per (message,principal); other user's message 404; cascade on conversation delete; DELETE idempotent.
- Document requests: idempotent per normalized question; only for own insufficient_evidence assistant message; client cannot inject question text.
- Unanswered: groups normalized variants; request counts; likely department omitted when null; excludes view-as.
- Library/documents/search: unreadable doc id -> 404 byte-identical to nonexistent; search never returns unreadable doc even when title matches; FTS special characters/quotes; ACL predicate parity with `loadKnowledgeInventory`; draft/archived generations never listed; `?message=` of another user's message -> 404; spans absent for partially readable docs.
- Approvals: args shown equal stored; arg tamper -> deny; pending past `expires_at` reads `expired`; double approve single ticket; ticket survives reload and shows `SUP-4800` then `SUP-4801`; typebox rejects `desk:"Sales"`, `priority:"P9"`, extra keys, oversize strings; secrets in `subject` redacted in `display_arguments_json` but exact in `tool_calls`.
- Live turn wiring: a P1 prompt produces pending approval run with exactly one pending tool call; approval route owner-only.
- Activity: keyset pagination stable under inserts; trace contains no evidence text; admin-only.
- Uploads: ACL selection maps to correct `access_scope` + group key (parity test vs `aclGroupKey`); unsupported/oversize rejected; per-file stage monotonic; batch idempotency key; promote refused until checks pass; discard leaves active generation unchanged; failed build leaves active pointer unchanged.
- People/invites: token one-time, expired, replay, wrong email; cannot invite `admin` without flag; public accept route only; accepted principal gets exactly the invited role/department.
- View as: non-admin 403, admin ok; unknown principal id 404; grants resolved server-side (client grant lists ignored in session mode); assumed turn not stored in either user's conversations; audit row written even on failure; diagnostic only for admin and only after refusal; model context never contains the diagnostic.
- Config/evals: admin-only; values equal `SELECTED_MODELS`/`REAL_STACK_FINGERPRINT`; snapshot constants equal `evals/results` JSON.
- Migrations: apply 0012-0014 over a DB that already has 0001-0011 data (existing rows keep working, nulls handled).

## 9. Contradictions and decisions for Wasim

1. **Member totals leak** (README "Can read 31 of 62", People bars): conflicts with audit correction 1 and AGENTS "ACL applies before ... counts". Show denominator to admins only.
2. **View-as in session mode vs "confined to loopback"**: needs an independent security verdict (3 reviewers) and rewrite of `assume-principal.test.ts`; use server-resolved principal id, not client grants.
3. **Admin-only "exists but restricted" diagnostic** reveals restricted document existence/title; master plan §6/§9 allows only aggregate diagnostics. Needs explicit approval and limits (title only, no private-owner docs, audited).
4. **AI Gateway health/retry row** has no backing: gateway is not in the call path and logs are stdout. Honest "not configured" or add instrumentation.
5. **Draft checks run a retrieval/ACL eval inside the platform** (spend: ~120 embeds + 120 reranks per draft) vs "evals read-only, run from the repo". Compatible only as a retrieval guard; cost needs a yes. The 120 questions do not cover uploaded content, so add an upload ACL parity probe.
6. **Invites** create accounts outside the signup gate; fine if admin-issued/single-use, but master plan lists "public signup, SSO onboarding" out of scope, so document it.
7. **Admin sees other users' questions/answers (Activity) and private uploads (Sources)**: master plan §9 restricts cross-user traces to the operator view; confirm acceptable.
8. **Upload scope**: spec 25 MB + DOCX vs repo 10 MB + md/txt/pdf and a 2 MB D1 row cap; DOCX needs a parser decision (no approved package for it; AGENTS approved-package list). Default plan: keep md/txt/pdf and cap 10 MB, flag DOCX/25 MB as not deliverable without a package approval.
9. **Roles/departments seeding for session users** and the 148-person demo roster: needs a seed approach (synthetic only). Without it the redesign shows an empty admin world.
10. **GitHub "Connect"**: no Brain endpoint; UI should show it disabled or a new source-create endpoint is needed.
11. **`operator` vs `admin`**: recommend separate, `admin` for `/admin/*`, `operator` retained for legacy `/knowledge/*` until the UI cuts over.
12. **Master plan text to update after merge** (stale-doc rule): §8 identity bullet on view-as, §9 operator view contents, execution tracker.
