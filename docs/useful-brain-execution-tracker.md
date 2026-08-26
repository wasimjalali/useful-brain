# Useful Brain implementation execution tracker

Status: ready for Grok 4.6 xhigh

Architecture authority: `docs/useful-brain-master-plan.md`

Execution prompt: `docs/useful-brain-grok-execution-prompt.md`

## 1. Objective

Migrate the existing Useful Brain application from Convex and the legacy model path to the approved Cloudflare-native RAG and Pi agent architecture. Preserve the proven Nura behavior and the named Burooj Sanad and Tabari contracts. Do not delete either legacy path until its retirement gate passes.

This file is the implementation checklist and evidence ledger. Update it as work lands. A checked box without a commit, test or report link is not complete.

## 2. Fixed architecture

- One isolated application and Cloudflare resource set per company.
- Next.js on Cloudflare Workers through OpenNext initially.
- Separate web, brain and ingestion Worker responsibilities.
- Separate corpus and operations D1 databases.
- R2 for source files, normalized artifacts, exports and archives.
- D1 FTS5 plus Vectorize for ACL-safe hybrid retrieval.
- Workers AI for embeddings and reranking.
- AI Gateway for model routing with payload collection disabled.
- Queues and Workflows for durable ingestion, approval waits and deterministic resume.
- Durable Objects only for one-run locks, stream fan-out and cancellation.
- Cloudflare Access at the perimeter and independent assertion verification in Brain.
- Pi Agent Core as the only agent loop.
- One policy gateway for native tools, MCP and plugins.
- Convex remains a migration source and rollback path until cutover.

Changing one of these decisions is an architecture change. Stop, write the evidence and request GPT-5.6 Sol adjudication before editing code to follow a different design.

## 3. Approval boundaries

Grok must stop and ask Wasim before:

- installing or changing npm packages
- applying a D1 schema migration outside a disposable local test database
- changing authentication or authorization behavior
- creating Cloudflare resources that may produce charges
- choosing a paid model or paid product tier
- deleting Convex code, data or resources
- deleting or archiving the Burooj repository
- changing a fixed architecture decision

Repository inspection, local tests, throwaway source spikes, documentation, branch work and non-destructive read-only Cloudflare checks do not require a new approval.

## 4. Execution protocol

For every phase:

1. Read `AGENTS.md`, the relevant master-plan sections and this tracker.
2. Inspect only the code and Burooj sources required for the current phase.
3. Verify current Next.js, Cloudflare and Pi APIs from primary documentation.
4. Create a phase branch from current `main`. Never work directly on `main`.
5. Write or port contract tests before custom behavior where practical.
6. Implement only the current phase and its prerequisites.
7. Update this tracker and any stale project markdown.
8. Run `npx tsc --noEmit`, `npm run lint`, `npm test` and `npm run build`.
9. Run the phase-specific tests and required critical-code reviews.
10. Commit conventionally, push, open a PR and wait for required checks.
11. Add `docs/implementation-reports/phase-N-<name>.md` with the evidence template in Section 13.
12. Continue only after the phase exit is satisfied.

Do not weaken or delete a failing test to make a gate pass. Record deviations and unresolved failures explicitly.

## 5. Status board

| Phase | Status | Exit evidence |
| --- | --- | --- |
| Plan review and product rename | Complete | Master plan v1.2 and renamed repository |
| Phase 0: feasibility and baselines | Not started | Pending |
| Phase 1: Cloudflare foundation | Blocked by Phase 0 | Pending |
| Phase 2: ingestion and generations | Blocked by Phase 1 | Pending |
| Phase 3: ACL-safe retrieval | Blocked by Phase 2 | Pending |
| Phase 4: grounded answers | Blocked by Phase 3 | Pending |
| Phase 5: Pi knowledge agent | Blocked by Phase 4 | Pending |
| Phase 6: connectors, MCP and plugins | Blocked by Phase 5 | Pending |
| Phase 7: cutover and retirement | Blocked by Phase 6 | Pending |

## 6. Phase 0: feasibility and baselines

Goal: prove the chosen runtime path and lock the migration baseline before production foundation work.

### Repository and toolchain

- [ ] Confirm the repository is `wasimjalali/useful-brain` and the local directory is `useful-brain`.
- [ ] Record the current Useful Brain commit, Node.js version, npm version and lockfile state.
- [ ] Record the Burooj Sanad source commit `630ba08dc7cad6aa71942d6842ce6d8d55a26873` or document why the available checkout differs.
- [ ] Inventory current runtime dependencies without installing anything.
- [ ] Propose the minimum package changes needed for OpenNext, Wrangler, Pi and Worker tests, then pause for package approval.

### Pi Worker spike

- [ ] Build a disposable Worker entrypoint that imports only `@earendil-works/pi-agent-core` and the minimum `pi-ai` provider factory.
- [ ] Verify `nodejs_compat`, bundle size, startup time and absence of Node-only session, OAuth or SQLite dependencies.
- [ ] Prove text streaming and typed tool events.
- [ ] Prove sequential mutating-tool configuration.
- [ ] Prove cancellation through `AbortController` or Pi’s supported abort path.
- [ ] Prove a fresh agent can reconstruct durable state without an in-memory session.
- [ ] Record measured results and the exact package versions.

### OpenNext spike

- [ ] Run the supported OpenNext compatibility check against the current Next.js application.
- [ ] Verify App Router server actions, streaming, static assets, route handlers and current PDF behavior.
- [ ] Record bundle size, startup time and unsupported APIs.
- [ ] Confirm that no current feature requires a Node server outside Workers.

### Baselines

- [ ] Run the current Useful Brain TypeScript, lint, test and production-build suite.
- [ ] Record current Nura retrieval, citation, refusal and operation-record results.
- [ ] Run Burooj’s locked fake-provider and real-stack baselines without writing to a live corpus.
- [ ] Record the exact retrieval fingerprint: 300/30 chunking, 0.70/0.30 fusion, six keyword candidates, 20 rerank candidates, BGE reranker and 0.05 starting floor.
- [ ] Preserve q086-q090 and q116-q120 as separate named slices.
- [ ] Create the initial Burooj migration ledger with source behavior, target contract test and implementation status.

### Product inputs

- [ ] Record company 1 residency and retention requirements.
- [ ] Record expected corpus size, file-size range and reindex cadence.
- [ ] Record expected employees, concurrent chats and service-token callers.
- [ ] Decide whether agent actions must ship with v1 or knowledge-only RAG may ship first if Pi cannot run safely on Workers.
- [ ] Decide who may see operator retrieval diagnostics.
- [ ] Set numeric p95 latency, retrieval quality and monthly-cost budgets.
- [ ] Confirm whether the Cloudflare credit applies to the Developer Platform invoice.

### Phase 0 exit

- [ ] Pi Worker spike passes or Wasim approves a documented fallback.
- [ ] OpenNext spike passes or Wasim approves a documented fallback.
- [ ] Both legacy baselines and the migration fingerprint are recorded.
- [ ] Product inputs and numeric budgets are recorded.
- [ ] Phase 0 report and PR are green.

## 7. Phase 1: Cloudflare foundation

Goal: deploy an authenticated, least-privilege skeleton with no production corpus migration.

- [ ] Obtain package, schema, auth and resource-provisioning approvals before the relevant changes.
- [ ] Add separate web, brain and ingestion Worker entrypoints with typed bindings.
- [ ] Add development, staging and production Wrangler configuration without secrets or production coordinates in the repository.
- [ ] Create independent corpus and operations D1 migration histories.
- [ ] Add R2, Vectorize, Queue, Workflow, Durable Object, Workers AI, AI Gateway and Service Binding definitions.
- [ ] Implement request IDs and safe cross-Worker error contracts.
- [ ] Implement Brain-side Access application JWT verification with RS256, issuer, audience, time claims and `type=app` validation.
- [ ] Resolve roles and departments only from the operations database.
- [ ] Keep employee and service-token namespaces distinct.
- [ ] Make Access, loopback asserted development identity and disabled identity mutually exclusive.
- [ ] Fail startup in staging or production when a development identity escape hatch is enabled.
- [ ] Prove Brain rejects an unsigned principal passed through a Service Binding.
- [ ] Configure AI Gateway metadata logging with payload collection off.
- [ ] Add a configuration test for `cf-aig-collect-log-payload: false` on production model requests.
- [ ] Deploy the empty skeleton to staging only after Wasim approves provisioning.

### Phase 1 exit

- [ ] Staging skeleton authenticates through Access.
- [ ] Least-privilege bindings are verified.
- [ ] No unauthenticated mutation route is reachable.
- [ ] AI Gateway payload-off test passes.
- [ ] Full project checks, critical reviews, phase report and PR are green.

## 8. Phase 2: ingestion and corpus generations

Goal: reproduce the approved corpus lifecycle with D1 as authority and Vectorize as projection.

- [ ] Port the source, document, document-version, chunk, generation and reconciliation models to TypeScript.
- [ ] Port the 300-token target, 30-token overlap, heading boundaries, sentence-aware cuts and character anchors.
- [ ] Add stable IDs and content digests.
- [ ] Add direct R2 upload finalization without buffering whole files in a Worker.
- [ ] Stream and bound Markdown, text, HTML and PDF parsing under the 128 MB Worker limit.
- [ ] Implement separate query and document embedding instructions.
- [ ] Use cosine Vectorize indexes and generation namespaces.
- [ ] Store only fixed-width `acl_group` as indexed ACL metadata.
- [ ] Create metadata indexes before vector upserts and require re-upsert before filtered queries.
- [ ] Make Queue payloads identifier-only.
- [ ] Create deterministic Workflow instance IDs and idempotent steps.
- [ ] Wait for exact equality on the newest opaque mutation ID.
- [ ] Compare a paginated Vectorize ID inventory with the D1 ledger.
- [ ] Mark a moving audit as partial and block promotion.
- [ ] Implement explicit ready, promote, rollback and archive transitions.
- [ ] Prove a failed generation cannot change the active pointer.
- [ ] Add GitHub sync that refuses truncated listings and deletes only after a complete successful sync.
- [ ] Keep arbitrary HTTP sources allowlist-only until redirect address pinning is proved safe on Workers.
- [ ] Recursively scrub connector configuration and allow only named secret-binding references.

### Phase 2 exit

- [ ] Complete generations promote and roll back.
- [ ] Partial D1 or Vectorize writes are visible and reconcilable.
- [ ] Failed and moving audits block promotion.
- [ ] GitHub truncation, queue retry and workflow-resume tests pass.
- [ ] Full project checks, critical reviews, phase report and PR are green.

## 9. Phase 3: ACL-safe hybrid retrieval

Goal: meet or beat Burooj’s locked retrieval behavior without allowing denied content to affect results or traces.

- [ ] Port the 65-document Northwind corpus and all 120 inherited questions.
- [ ] Reject duplicate eval keys.
- [ ] Implement the external-content FTS5 table with `INTEGER PRIMARY KEY AUTOINCREMENT` and synchronized insert, update and delete triggers.
- [ ] Forbid `INSERT OR REPLACE`; use `ON CONFLICT DO UPDATE`.
- [ ] Implement an injective, length-prefixed `acl_group` canonical form hashed to 32 hexadecimal characters.
- [ ] Reject non-string or empty private owners.
- [ ] Bound principal grants and raise `AclTooWide` without truncation.
- [ ] Enumerate only ACL groups the principal may read.
- [ ] Measure the serialized Vectorize filter and reject it at 2,048 bytes or more. Do not copy Burooj’s 500-group ceiling.
- [ ] Require both generation namespace and ACL filter on every Vectorize query.
- [ ] Apply equivalent store-side ACL constraints to D1 FTS candidate generation.
- [ ] Recompute keyword scores over the allowed set only.
- [ ] Fuse at the locked 0.70/0.30 starting profile.
- [ ] Rerank 20 allowed candidates and apply the locked 0.05 starting floor.
- [ ] Keep parent expansion and conflict detection off.
- [ ] Remove denied IDs, scores, removal counts and partial-document offsets from user-visible traces.
- [ ] Implement D1 and Vectorize ACL equivalence contract tests.
- [ ] Port permission, keyword-oracle and window-eviction suites.
- [ ] Keep fake-provider and real-stack ratchets separate.
- [ ] Use new documents and questions for new holdout work. Never tune on the inherited locked set.

### Phase 3 exit

- [ ] Zero unauthorized chunks, citations or trace-derived side channels.
- [ ] Retrieval meets or beats both locked ratchets or has an approved written exception.
- [ ] Vectorize inventory reconciles before every real-stack evaluation.
- [ ] Full project checks, critical reviews, phase report and PR are green.

## 10. Phase 4: grounded answers and conversation migration

Goal: reproduce citations, refusals, replay and server-owned history before adding the agent loop.

- [ ] Port the structured answer contract and deterministic `insufficient_evidence` result.
- [ ] Validate every citation against the current-run evidence snapshot.
- [ ] Store immutable evidence snapshots and prompt, model, retrieval and corpus versions.
- [ ] Migrate server-owned conversations and bounded history behavior.
- [ ] Port the Tabari must-retrieve host finalizer.
- [ ] Build the evidence ledger only from successful current-turn retrieval tool results.
- [ ] Replace unavailable retrieval with one deterministic response that leaks no transport detail.
- [ ] Treat retrieved text and every tool result as untrusted data.
- [ ] Add Durable Object one-run locks, hibernating WebSocket fan-out and cancellation only.
- [ ] Persist durable state in the operations database before releasing the run lock.
- [ ] Shadow Convex answers without changing user-visible behavior.

### Phase 4 exit

- [ ] Zero invalid citation IDs.
- [ ] Zero unsupported answers in the locked unanswerable set.
- [ ] Replay reconstructs the stored answer and evidence.
- [ ] Shadow parity and host-grounding suites pass.
- [ ] Full project checks, critical reviews, phase report and PR are green.

## 11. Phase 5: Pi knowledge agent

Goal: introduce Pi without weakening the host’s grounding, policy or durable replay contracts.

- [ ] Install only approved Pi packages and only the provider factories required by the selected model.
- [ ] Construct a fresh Pi Agent for each run from operations D1 state.
- [ ] Expose `search_knowledge` as the first read-only tool.
- [ ] Preserve the Phase 4 host finalizer after every Pi knowledge turn.
- [ ] Add turn, token, tool-call and wall-time budgets.
- [ ] Propagate cancellation through Brain and Pi.
- [ ] Add typed event streaming and durable run state.
- [ ] Build one central policy gateway used inside every tool `execute()` path.
- [ ] Treat `beforeToolCall` and `afterToolCall` as additional guards, not the control plane.
- [ ] Declare every mutating tool sequential.
- [ ] Bind approval to principal, conversation, tool, normalized arguments, expiry and idempotency key.
- [ ] End a Brain run at `pending_approval`; never keep Pi or a Durable Object waiter alive.
- [ ] Wait through Workflow `waitForEvent`, then enqueue one deterministic resume.
- [ ] Reconstruct state and recheck policy before the side effect.
- [ ] Deny high-risk actions in the first release.
- [ ] Store the model, prompt version, corpus generation, evidence snapshot, tool inputs, redacted tool results and approval record for replay.

### Phase 5 exit

- [ ] Must-retrieve and current-turn citation-ledger tests pass.
- [ ] Cancellation, turn-limit and tool-error tests pass.
- [ ] Argument tampering invalidates approval.
- [ ] Duplicate delivery cannot repeat a side effect.
- [ ] Every mutating side effect crosses the policy gateway sequentially.
- [ ] Full project checks, critical reviews, phase report and PR are green.

## 12. Phase 6 and Phase 7

### Phase 6: connectors, MCP and plugins

- [ ] Create a connector registry with capability, authentication, rate-limit, data-classification and health metadata.
- [ ] Add per-connector scopes and revocation.
- [ ] Add one read connector through the policy gateway.
- [ ] Add remote MCP tools through the same policy gateway.
- [ ] Treat every connector, MCP and plugin result as untrusted data.
- [ ] Add one approved write connector with preview, approval, idempotency and audit.
- [ ] Prove revocation, failure, untrusted-result and retry behavior.

Exit: one read connector and one approved write connector pass all policy and security gates. A marketplace is not required.

### Phase 7: cutover and retirement

- [ ] Run staging load, restore and incident drills.
- [ ] Prove restore for both D1 databases and R2 exports.
- [ ] Prove corpus rollback uses the generation pointer, not Time Travel.
- [ ] Run Cloudflare in shadow, canary and primary modes.
- [ ] Keep Convex read-only through the rollback window.
- [ ] Complete the Burooj migration ledger and all Section 12 retirement gates in the master plan.
- [ ] Create a recoverable Burooj archive.
- [ ] Ask Wasim for explicit Burooj deletion approval.
- [ ] Remove legacy code and resources only after parity, rollback expiry and approval.

Exit: Cloudflare is primary, the rollback window expires successfully and retirement is deliberate and recoverable.

## 13. Required phase report

Every phase report must contain:

1. Phase and commit range.
2. Objective and completed tracker items.
3. Files and systems changed.
4. Architecture decisions or deviations.
5. Tests run with exact results.
6. Security and code-review findings with resolutions.
7. Cloudflare resources created and measured cost.
8. Data migrations and rollback proof.
9. Remaining risks, blocked items and user decisions.
10. Recommended next phase and whether its entry gate is open.

The final implementation report also includes the completed Burooj migration ledger, final cost measurements, launch-gate evidence, rollback instructions and every legacy resource still awaiting deliberate retirement.
