# Useful Brain implementation execution tracker

Status: Phase 1 repair on `phase-1-cloudflare-foundation` ([PR #11](https://github.com/wasimjalali/useful-brain/pull/11)). Phase 0 is merged. Do not merge PR #11 or provision Cloudflare resources until Phase 1 repairs, workerd evidence and independent review are complete.

Architecture authority: `docs/useful-brain-master-plan.md`

Execution prompt: `docs/useful-brain-grok-execution-prompt.md`

Standing authorization: 2026-08-26. Grok 4.6 xhigh may execute Phase 1 through Phase 6 and Phase 7A without ordinary phase-by-phase approval. Phase 7B stays closed.

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

Wasim granted standing authorization on 2026-08-26 for Grok 4.6 xhigh to execute Phase 1 through Phase 6 and Phase 7A without requesting ordinary phase-by-phase approval. That covers:

1. Installing the approved packages in `AGENTS.md`.
2. Making D1 schema and authentication changes required by the approved master plan.
3. Provisioning the approved staging-only Cloudflare resources **after PR #11 is corrected, independently reviewed and merged**.
4. Running synthetic Workers AI and model evaluations within the approved usage boundaries.
5. Creating branches, committing, pushing, opening PRs and merging green PRs.
6. Continuing automatically from one completed phase to the next.
7. Updating the master plan, tracker, execution prompt, migration ledger and implementation reports.
8. Selecting Cloudflare-hosted models through the evidence-based process in the master plan.
9. Using eligible Cloudflare credits for staging infrastructure and Workers AI inference.

This authorization does **not** cover real company data, production cutover, destructive retirement, uncovered external-provider spending or unlimited resource usage.

Grok must still stop and ask Wasim before:

- installing a package outside the approved list when no package-free path exists
- purchasing another subscription or paid add-on
- creating a production resource set
- exceeding a configured gross usage safety limit
- using a service not covered by confirmed credits
- changing a fixed architecture decision
- deleting Convex code, data or resources
- deleting or archiving the Burooj repository
- Phase 7B production launch, real traffic cutover or destructive legacy-resource removal
- a manual identity, domain or protected-secret bootstrap that cannot be done in code

The $25 Cloudflare and $75 model figures are gross usage safety boundaries, not reserved budgets. Idle empty staging resources are expected to add approximately $0 above the existing $5 Workers Paid minimum. Record gross metered cost before credits separately from uncovered cash cost. Do not describe credit-covered consumption as free inference.

## 4. Execution protocol

For every phase:

1. Read `AGENTS.md`, the relevant master-plan sections and this tracker.
2. Inspect only the code and Burooj sources required for the current phase.
3. Verify current Next.js, Cloudflare and Pi APIs from primary documentation.
4. Create a phase branch from current `main`. Never work directly on `main`.
5. Write or port contract tests before custom behavior where practical. Critical Worker behavior requires workerd tests, not Node-only mocks.
6. Implement only the current phase and its prerequisites.
7. Update this tracker and any stale project markdown.
8. Run `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, relevant workerd tests, Wrangler dry runs, phase-specific evals, `npm audit --omit=dev --audit-level=high` and security tests.
9. Run independent review with `codex review --base main`. Fix every confirmed P0/P1 and every confirmed high or critical security finding. A self-review is not independent.
10. Commit conventionally, push, open a PR and wait for GitHub checks.
11. Add `docs/implementation-reports/phase-N-<name>.md` with the evidence template in Section 13.
12. Merge only when checks and independent review are green, then start the next phase from updated `main`.

Do not weaken or delete a failing test to make a gate pass. Record deviations and unresolved failures explicitly. A Wrangler dry-run that only bundles an exported symbol is not evidence that a Workflow, Durable Object or Service Binding path works.

## 5. Status board

| Phase | Status | Exit evidence |
| --- | --- | --- |
| Plan review and product rename | Complete | Master plan v1.2 and renamed repository |
| Phase 0: feasibility and baselines | Complete | [PR #10](https://github.com/wasimjalali/useful-brain/pull/10); [phase-0 report](implementation-reports/phase-0-feasibility.md) |
| Phase 1: Cloudflare foundation | In progress — PR #11 must be repaired | Workerd Workflow, DO lock, Service Binding identity and staging auth remain incomplete |
| Phase 2: ingestion and generations | Blocked by Phase 1 | Pending |
| Phase 3: ACL-safe retrieval | Blocked by Phase 2 | Pending |
| Phase 4: grounded answers | Blocked by Phase 3 | Pending |
| Phase 5: Pi knowledge agent | Blocked by Phase 4 | Pending |
| Phase 6: connectors, MCP and plugins | Blocked by Phase 5 | Pending |
| Phase 7A: staging release candidate | Blocked by Phase 6 | Authorized after Phase 6; synthetic only |
| Phase 7B: production launch and retirement | Closed | Requires one final explicit Wasim approval |

## 6. Phase 0: feasibility and baselines

Goal: prove the chosen runtime path and lock the migration baseline before production foundation work.

### Repository and toolchain

- [x] Confirm the repository is `wasimjalali/useful-brain` and the local directory is `useful-brain`. Evidence: remote `https://github.com/wasimjalali/useful-brain.git`, directory `/Users/wasimjalali/Desktop/Personal Project/useful-brain`.
- [x] Record the current Useful Brain commit, Node.js version, npm version and lockfile state. Evidence: [phase-0 report](implementation-reports/phase-0-feasibility.md) section 1. HEAD `057b24d0a810490af673b06c1e0cea875b400a2c`, Node `v22.23.1`, npm `10.9.8`, lockfile SHA-256 `16e75991af5848b4a554ed89c2ce4915313987fd7a25329f9a6c29d1c6509c74`.
- [x] Record the Burooj Sanad source commit `630ba08dc7cad6aa71942d6842ce6d8d55a26873` or document why the available checkout differs. Evidence: sibling HEAD matches. Worktree is dirty with Tabari UI files only; Sanad evals used `SANAD_STORE=memory`.
- [x] Inventory current runtime dependencies without installing anything. Evidence: [phase-0 report](implementation-reports/phase-0-feasibility.md) section 2.
- [x] Propose the minimum package changes needed for OpenNext, Wrangler, Pi and Worker tests, then pause for package approval. Evidence: [phase-0 report](implementation-reports/phase-0-feasibility.md) section 3. Wasim approved the list on 2026-08-26 with two corrections: `@cloudflare/vitest-plugin@1.1.0` instead of `@cloudflare/vitest-pool-workers`, and generated types via `wrangler types` instead of installing `@cloudflare/workers-types`. Wrangler still lists `@cloudflare/workers-types` as an optional peer in the lockfiles; it is not a direct dependency and `npm ls @cloudflare/workers-types` is empty.

### Pi Worker spike

Unpaid `fauxProvider()` proof in `spikes/phase-0-pi-worker/`. Root `tsc`/`eslint`/`vitest` exclude `spikes/**`; spike has its own passing checks via `npm run typecheck:spike:pi` and `npm run test:spike:pi`.

- [x] Build a disposable Worker entrypoint that imports only `@earendil-works/pi-agent-core` and the minimum `pi-ai` provider factory. Evidence: `spikes/phase-0-pi-worker/src/index.ts` and `src/pi-run.ts` import `Agent` from `@earendil-works/pi-agent-core` and `fauxProvider` from `@earendil-works/pi-ai/providers/faux`.
- [x] Verify `nodejs_compat`, bundle size, startup time and absence of Node-only session, OAuth or SQLite dependencies. Evidence: wrangler 4.126.0 `check startup` and `deploy --dry-run --outdir dist` (local only): **656.90 KiB / gzip 114.68 KiB**; local startup window 35.6 ms, active 16.0 ms. `npm run check:bundle` found no sqlite, OAuth, or Node session backends. `@cloudflare/vitest-pool-workers` is not installed. `@cloudflare/workers-types` is not a direct dependency; types come from `wrangler types` → `worker-configuration.d.ts`. Wrangler names it as an optional peer in the lockfile.
- [x] Prove text streaming and typed tool events. Evidence: `spikes/phase-0-pi-worker/test/pi-spike.test.ts` — 5 passed, including `text_delta` and `tool_execution_start`/`end`.
- [x] Prove sequential mutating-tool configuration. Evidence: same suite; `increment_counter` end timestamp ≤ `record_value` start; counter=1.
- [x] Prove cancellation through `AbortController` or Pi’s supported abort path. Evidence: `Agent.abort()` after first `text_delta`; `aborted` true; last event `agent_end`.
- [x] Prove a fresh agent can reconstruct durable state without an in-memory session. Evidence: `reconstructAgent(snapshotState(...))` is a different instance with equal cloned messages and can `prompt` further.
- [x] Record measured results and the exact package versions. Evidence: [phase-0 report](implementation-reports/phase-0-feasibility.md) section 4. Versions: `pi-agent-core` 0.84.3, `pi-ai` 0.84.3, `wrangler` 4.126.0, `@cloudflare/vitest-plugin` 1.1.0, `vitest` 4.1.9, `typescript` 5.9.3, `@types/node` 22.20.1. Spike `npm install` required `--legacy-peer-deps` after npm 10.9.8 arborist `edgesOut` crash. That flag is confined to disposable Pi spike installs (`npm run install:spike:pi`) and must not become a root or production installation policy. There is no root `.npmrc`.

Live AI Gateway / Workers AI remain **unapproved** and were not run.

### OpenNext spike

Local `opennextjs-cloudflare build` and `preview` only. No `migrate`, `deploy`, `upload`, remote cache population, or Cloudflare resource creation.

- [x] Run the supported OpenNext compatibility check against the current Next.js application. Evidence: OpenNext has no `check` command. `opennextjs-cloudflare build` 1.20.3 against Next 16.3.3 completed; preview populated dummy cache only (“Incremental cache does not need populating”).
- [x] Verify App Router server actions, streaming, static assets, route handlers and current PDF behavior. Evidence: local preview `http://127.0.0.1:8790` — `GET /` 200 `text/html` with `x-opennext: 1` (chunked); Chat / Knowledge / Evaluations rendered; `POST /` 200 (237 ms) for the grounded-question server action; `/icon.svg` 200; `public/file.svg` 200; `/_next/static` CSS `Cache-Control: public,max-age=31536000,immutable`; unknown path 404. No route handlers in the app. `node:fs` synthetic-doc inventory returned 0 documents on Workers (`loadSyntheticDocuments` catch). `unpdf` remains covered by the Node unit suite; Worker upload-to-disk was not exercised because it uses `node:fs`.
- [x] Record bundle size, startup time and unsupported APIs. Evidence: wrangler dry-run / `check startup` (local): **7500.89 KiB / gzip 1599.31 KiB**; startup window 145.8 ms, active 43.6 ms. Unsupported for cutover: `node:fs` writes/reads under `content/synthetic-docs`. No `export const runtime = "edge"`.
- [x] Confirm that no current feature requires a Node server outside Workers. Evidence: Chat, Convex HTTP, and Evaluations UI run on the OpenNext Worker. Local document inventory and add-document persistence need an R2 replacement before cutover; they do not require keeping a Node server if that path is replaced.

### Baselines

- [x] Run the current Useful Brain TypeScript, lint, test and production-build suite. Evidence: `npx tsc --noEmit`, `npm run lint`, `npm test` (25 files, 154 tests), `npm run build` all exit 0 on 2026-08-26.
- [x] Record current Nura retrieval, citation, refusal and operation-record results. Evidence: [phase-0 report](implementation-reports/phase-0-feasibility.md) section 5. Unit suite only; live Foundry evals were not run.
- [x] Run Burooj’s locked fake-provider and real-stack baselines without writing to a live corpus. Evidence: fake-provider `tests/test_evals.py` 34 passed; `_run_evals --local` memory fingerprint in the phase report. Real-stack numbers copied from Burooj docs at the locked commit; live D1/Vectorize was not queried or written.
- [x] Record the exact retrieval fingerprint: 300/30 chunking, 0.70/0.30 fusion, six keyword candidates, 20 rerank candidates, BGE reranker and 0.05 starting floor. Evidence: [migration ledger](burooj-migration-ledger.md).
- [x] Preserve q086-q090 and q116-q120 as separate named slices. Evidence: ledger named-slice table; local fake-provider slice metrics recorded.
- [x] Create the initial Burooj migration ledger with source behavior, target contract test and implementation status. Evidence: [burooj-migration-ledger.md](burooj-migration-ledger.md).

### Product inputs

Recorded as the first-pilot planning profile. These are planning assumptions, not customer contractual promises. Source of truth: [master plan](useful-brain-master-plan.md) Phase 0 first-pilot planning profile and [phase-0 report](implementation-reports/phase-0-feasibility.md) section 6.

- [x] Record company 1 residency and retention requirements. Evidence: EU-based first pilot; GDPR-compatible processing with contractual transfer safeguards, not strict EU-only; D1 and R2 `eu` jurisdiction; 30/90/30/365 day retention classes; AI Gateway payload storage disabled; synthetic data until a production data-handling review.
- [x] Record expected corpus size, file-size range and reindex cadence. Evidence: up to 10,000 documents, 10 GB sources, 25 MB max file, ~100,000 chunks; hourly incremental sync; monthly full rebuild and on retrieval-config changes.
- [x] Record expected employees, concurrent chats and service-token callers. Evidence: up to 50 employees, 10 concurrent chat or agent runs, 5 service-token callers; one isolated application and Cloudflare resource set per company.
- [x] Decide whether agent actions must ship with v1 or knowledge-only RAG may ship first if Pi cannot run safely on Workers. Evidence: ship the Pi agent shell; first release is knowledge-first (retrieval, grounded answers, evaluations, read-only tools); external mutating connector actions stay disabled until later phases; knowledge-only RAG is the fallback only if a production-only Pi problem appears later.
- [x] Decide who may see operator retrieval diagnostics. Evidence: company administrators and designated operators see complete retrieval diagnostics; ordinary employees see authorized citations and evidence only.
- [x] Set numeric p95 latency, retrieval quality and monthly-cost budgets. Evidence: retrieval 1.5 s, first token 3 s, complete answer 15 s, searchable 5 min; ACL/invalid-citation/unanswerable zeros; fake-provider floors 0.907 / 0.821 / 0.831; real-stack slices at or above BGE+0.05; Cloudflare ≤ $25/month, external generation ≤ $75/month, combined ≤ $100/company/month; idle is the existing $5 Workers Paid minimum.
- [x] Confirm whether the Cloudflare credit applies to the Developer Platform invoice. Evidence: eligibility is **not** confirmed. Credits are excluded from cost justification until the billing dashboard confirms Developer Platform eligibility.

### Phase 0 exit

- [x] Pi Worker spike passes or Wasim approves a documented fallback. Unpaid `fauxProvider()` proof passed. Live AI Gateway / Workers AI remain unapproved.
- [x] OpenNext spike passes or Wasim approves a documented fallback. Local build/preview passed. `node:fs` synthetic-doc path is recorded for R2 replacement; not a Node-server requirement.
- [x] Both legacy baselines and the migration fingerprint are recorded.
- [x] Product inputs and numeric budgets are recorded.
- [x] Phase 0 report and PR are green. [PR #10](https://github.com/wasimjalali/useful-brain/pull/10) merged 2026-08-26. Wasim accepted merge. GitHub Actions did not execute the new `verify` workflow until it landed on `main` (first workflow in the repo). Local root and Pi spike checks passed. Do not provision Cloudflare resources or run paid AI calls until Phase 1 approvals pass.

## 7. Phase 1: Cloudflare foundation

Goal: deploy an authenticated, least-privilege skeleton with no production corpus migration.

No remote D1, R2, Vectorize, Queue, Workflow or Access resource has been created. `RESOURCES_PROVISIONED` remains `false`. The operations `0001_init.sql` file has **not** been applied to any remote D1, so the principal/grant schema may still be corrected in that initial migration rather than adding a follow-on migration.

### Repair list (PR #11 — do not merge until complete)

- [x] Replace `IngestionWorkflow` with a Cloudflare `WorkflowEntrypoint` that runs at least one real, bounded, idempotent `step.do`. Evidence: `workers/ingestion/src/workflow.ts` extends `WorkflowEntrypoint` with official `run(event, step)` and `step.do("accept-ingestion-job")`. Confirmed against https://developers.cloudflare.com/workflows/build/workers-api/ (accessed 2026-08-26). Workerd: `workers/ingestion/test/workflow.test.ts`.
- [x] Access JWT implementation: JWKS refetch floor after cold-start failure; join in-flight fetches; stream and cancel JWKS over 256 KiB; team domain restricted to bare HTTPS `*.cloudflareaccess.com`; never-fetched keys fail closed. Evidence: `src/lib/auth/access-jwt.ts`, Node `src/lib/auth/access-jwt.test.ts`, workerd `workers/brain/test/access-jwt.test.ts`. Bounded 3600s stale-key grace is retained from Burooj and reconciled in the master plan and ledger; **independent security verdict still required before merge**.
- [x] Brain and Ingestion staging/production: `workers_dev: false`, `preview_urls: false`, no public routes, `global_fetch_strictly_public`. Evidence: `src/lib/cf/wrangler-config.test.ts` plus `wrangler deploy --dry-run --env staging` (Brain gzip 8.09 KiB, Ingestion gzip 7.13 KiB, R2 `eu`, `LOOPBACK_RUNTIME=false`). Live deployed config is not yet available because resources are not provisioned.
- [x] Web-to-Brain identity forwarding in workerd: Web helper copies only `Cf-Access-Jwt-Assertion` and strips spoofed principal headers; Brain verifies independently and loads grants from operations D1. Evidence: `src/lib/cf/service-binding-identity.ts`, `src/app/api/brain/whoami/route.ts`, `workers/brain/test/identity.test.ts`. Miniflare cannot bind Brain as a second service to itself; a real staging Service Binding smoke test remains after provisioning.
- [x] Loopback development identity: no `x-forwarded-for` / `cf-connecting-ip` origin proof. Trusted `LOOPBACK_RUNTIME` Wrangler var plus `dev.ip: 127.0.0.1`. Staging/production fail startup if loopback is enabled. Evidence: `src/lib/auth/identity-mode.ts`, `src/lib/cf/startup.test.ts`, workerd identity spoofing/startup tests.
- [x] Operations principal schema: stable `principals.id`, unique `(kind, subject)`, roles/departments on `principal_id`, disjoint user/service-token namespaces, no nullable user FK. Corrected in `migrations/operations/0001_init.sql` because no remote D1 has applied it. Evidence: `src/lib/store/migrations-contract.test.ts`, `src/lib/auth/principal.test.ts`, `workers/brain/test/principal-schema.test.ts`.
- [x] Conversation Durable Object: SQLite `new_sqlite_classes`, `transactionSync` lock, bounded IDs, one concurrent winner, owner-only release, eviction/restart. Evidence: `workers/brain/src/conversation-lock.ts`, `workers/brain/test/conversation-lock.test.ts`.
- [x] `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` removed from committed staging/production vars. Tests inject Access fixtures through Miniflare bindings only.
- [x] `@cloudflare/vitest-plugin@1.1.0` installed. Critical Worker tests run in workerd (`npm run test:workers`). Node tests remain for pure helpers.
- [x] Redacted structured JSON operational logs. Staging observability `head_sampling_rate: 0.1`. Evidence: `src/lib/cf/operational-log.ts` and test.
- [x] `npm audit --omit=dev --audit-level=high` exits 0 after overrides `postcss@8.5.26`, `nanoid@3.3.18`, `adm-zip@0.6.0`. rclone.js `extractEntryTo` still works. Full-tree (including dev) still reports `brace-expansion` and `js-yaml` highs; those are not in the production audit.
- [ ] Independent review (`codex review --base main`) green after the follow-up fix. 2026-08-26 gpt-5.6-sol review (session `01a03f93-2b5c-7ca0-b232-4e2128b08b68`) did **not** flag the retained 3600s stale-key grace as P0/P1. It reported one P1 (loopback `workers_dev` default) and two P2s (malformed lock JSON → 500; missing `typecheck:workers` in CI). Those findings are fixed in source: `workers_dev`/`preview_urls` false on every environment including loopback, `WorkerValidationError` for malformed lock JSON, and CI `typecheck:workers`. Re-run review before merge.

### Helper-level items (not phase-complete evidence)

- [x] Separate web, brain and ingestion Worker entrypoints exist. Evidence: root `wrangler.jsonc`, `workers/brain/`, `workers/ingestion/`. **Not** staging-auth evidence.
- [x] Independent corpus and operations D1 migration files exist. Evidence: `migrations/corpus/0001_init.sql`, `migrations/operations/0001_init.sql`. Principal schema repaired in `0001_init.sql` (no remote apply).
- [x] Request IDs and safe error-contract helpers exist. Evidence: `src/lib/cf/request-id.ts`, `src/lib/cf/worker-errors.ts`.
- [x] Access JWT Node unit tests exist, including JWKS floor, in-flight join, 256 KiB stream cancel, hostile-domain, rotation and stale-grace. Evidence: `src/lib/auth/access-jwt.test.ts`. Not a substitute for the independent stale-grace verdict.
- [x] AI Gateway payload-off helper test. Evidence: `src/lib/cf/ai-gateway.test.ts`.
- [x] Local Wrangler dry-run of brain and ingestion. Evidence: wrangler 4.126.0 `--dry-run --env development` and `--env staging`.
- [ ] Deploy the empty skeleton to staging only after PR #11 is merged and the approved staging resources exist.

### Phase 1 exit

- [ ] Staging skeleton authenticates through Access.
- [ ] Least-privilege bindings are verified on a live staging deployment (`workers_dev`/`preview_urls` off for Brain and Ingestion). Source and dry-run evidence is recorded above.
- [x] No unauthenticated mutation route is reachable in the skeleton. Evidence: GET `/health` is the only public Worker route; `/whoami` fails closed without a valid assertion.
- [x] AI Gateway payload-off test passes.
- [x] Workerd tests pass for Workflow, Durable Object concurrency, identity forwarding, Access JWT, queue consumer and loopback startup. A live Service Binding smoke test is still required after staging exists.
- [ ] Full project checks, independent review, phase report and PR are green.

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

## 12. Phase 6, Phase 7A and Phase 7B

### Phase 6: connectors, MCP and plugins

Synthetic proofs only. Do not wait for third-party production credentials.

- [ ] Create a connector registry with capability, authentication, rate-limit, data-classification and health metadata.
- [ ] Add per-connector scopes and revocation.
- [ ] Add one allowlisted GitHub or HTTP read connector through the policy gateway.
- [ ] Add one self-hosted staging MCP test server, one MCP read tool and one synthetic approval-required MCP write tool.
- [ ] Add one staging action-sink connector proving preview, exact normalized arguments, approval binding, idempotency, audit, revocation, retry safety, untrusted-result handling and duplicate-delivery protection.
- [ ] Treat every connector, MCP and plugin result as untrusted data.
- [ ] Do not claim the synthetic action sink is a production vendor integration.

Exit: one read connector and one approved write connector pass all policy and security gates. A marketplace is not required.

### Phase 7A: staging release candidate

Authorized for continuous execution after Phase 6. Synthetic data only.

- [ ] Staging load tests
- [ ] D1 and R2 restore drills
- [ ] Incident drills
- [ ] Corpus rollback proof (generation pointer, not Time Travel)
- [ ] Synthetic shadow mode
- [ ] Synthetic canary mode
- [ ] Staging-primary mode
- [ ] Operational runbooks
- [ ] Rollback runbooks
- [ ] Budget and alert validation
- [ ] Burooj migration-ledger completion
- [ ] Recoverable Burooj archive creation

Exit: staging is the release candidate with restore, incident and budget evidence. No real company data.

### Phase 7B: production launch and retirement

Requires one final explicit Wasim approval. Do not start.

- [ ] Real company data
- [ ] Production resource set
- [ ] Real production traffic
- [ ] Production-primary cutover
- [ ] Rollback-window expiry
- [ ] Convex deletion
- [ ] Burooj deletion
- [ ] Destructive legacy-resource removal

Exit: only after Wasim explicitly approves real production cutover and retirement.

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
