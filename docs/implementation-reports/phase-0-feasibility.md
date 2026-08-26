# Phase 0 feasibility and baselines

1. Phase: 0. Commit range: `phase-0-feasibility-baselines` from `main` `057b24d0a810490af673b06c1e0cea875b400a2c`. Technical spikes and the first-pilot planning profile are recorded. This pull request is the Phase 0 PR.
2. Objective: prove the runtime path, lock migration baselines and record first-pilot planning assumptions before Phase 1. Unpaid Pi Worker, local OpenNext and the planning profile are complete. Phase 1 stays closed.
3. Files and systems changed: tracker, this report, the Burooj ledger, gitignore/tsconfig/eslint/vitest excludes, isolated Pi spike under `spikes/phase-0-pi-worker/`, root OpenNext/Next 16.3.3 packages, `open-next.config.ts`, preview-only `wrangler.jsonc`, `public/_headers`, master-plan first-pilot planning profile, `.github/workflows/verify.yml`. No `migrate`/`deploy`/`upload`. No production Cloudflare resources. Burooj was read-only.
4. Architecture decisions or deviations: none. OpenNext first is unchanged. Default `defineCloudflareConfig()` uses dummy cache (no R2). Types via `wrangler types`. Tests via `@cloudflare/vitest-plugin`. `@cloudflare/workers-types` is not directly installed and `npm ls @cloudflare/workers-types` is empty at root and in the spike; Wrangler still lists it as an optional peer in the lockfiles. `legacy-peer-deps=true` is confined to disposable Pi spike installs (`npm run install:spike:pi` / `npm ci --legacy-peer-deps` in `spikes/phase-0-pi-worker/`). It must not become a root or production installation policy. There is no root `.npmrc`.
5. Tests run with exact results: see sections 4–5.
6. Security and code-review findings: no inline review comments on PR #10. Pi spike uses unpaid `fauxProvider()` only. `.dev.vars` holds `NEXTJS_ENV=development` and is gitignored. Unfixable in Phase 0: `node:fs` synthetic-doc inventory on Workers (R2 in Phase 2), live AI Gateway / Workers AI still unapproved, credits excluded until Developer Platform eligibility is confirmed.
7. Cloudflare resources created and measured cost: none. Dry-run and `check startup` were local. Preview used dummy cache only.
8. Data migrations and rollback proof: none. Convex and Burooj are untouched.
9. Remaining risks, blocked items and user decisions: live AI Gateway / Workers AI still unapproved; `node:fs` synthetic-doc path must move to R2 before cutover; credits remain excluded from cost justification until Developer Platform eligibility is confirmed in the billing dashboard. GitHub had no checks on the first PR push; `.github/workflows/verify.yml` is the Phase 0 PR gate. Do not provision Cloudflare resources or run paid inference.
10. Recommended next phase: Phase 1 after this PR is green. Do not provision Cloudflare resources or run paid inference until Phase 1 approvals pass.

## 1. Repository and toolchain

| Item | Value |
| --- | --- |
| Remote | `https://github.com/wasimjalali/useful-brain.git` |
| Local directory | `/Users/wasimjalali/Desktop/Personal Project/useful-brain` |
| Branch | `phase-0-feasibility-baselines` |
| Useful Brain HEAD | `057b24d0a810490af673b06c1e0cea875b400a2c` (uncommitted Phase 0 work on top) |
| Node.js | `v22.23.1` |
| npm | `10.9.8` |
| Lockfile before Phase 0 installs | v3, 572 packages, SHA-256 `16e75991af5848b4a554ed89c2ce4915313987fd7a25329f9a6c29d1c6509c74` |
| Lockfile after approved installs | v3, 944 packages, SHA-256 `1edc5a8da721393dec83dcf0666d1d273bbbb5dcbb748e35e8d247d1340fb494` |
| Project Wrangler | `4.126.0` |
| Burooj HEAD | `630ba08dc7cad6aa71942d6842ce6d8d55a26873` |

Burooj worktree is dirty with Tabari UI files. Sanad evals were run with `SANAD_STORE=memory` and `SANAD_EMBEDDING_PROVIDER=fake`. No live corpus writes.

## 2. Current dependency inventory

After the approved installs (resolved):

| Package | Resolved |
| --- | --- |
| next | 16.3.3 |
| eslint-config-next | 16.3.3 |
| react / react-dom | 19.2.4 |
| convex | 1.42.1 |
| unpdf | 1.6.2 |
| @opennextjs/cloudflare | 1.20.3 |
| wrangler | 4.126.0 |
| rclone.js | 0.6.6 |
| typescript | 5.9.3 |
| vitest | 4.1.9 |

Isolated Pi spike (`spikes/phase-0-pi-worker/`): `pi-agent-core` 0.84.3, `pi-ai` 0.84.3, `wrangler` 4.126.0, `@cloudflare/vitest-plugin` 1.1.0, `vitest` 4.1.9, `typescript` 5.9.3, `@types/node` 22.20.1. `@cloudflare/vitest-pool-workers` is not installed. `@cloudflare/workers-types` is not a direct dependency and `npm ls @cloudflare/workers-types` is empty at root and in the spike. Wrangler still names it as an optional peer in both lockfiles. Runtime types are generated with `wrangler types`.

Spike `npm install` needed `--legacy-peer-deps` after npm 10.9.8 arborist crashed (`Cannot read properties of null (reading 'edgesOut')`). Use `npm run install:spike:pi` or `npm ci --legacy-peer-deps` in `spikes/phase-0-pi-worker/`. That flag must not become a root or production installation policy. There is no root `.npmrc`. A local spike `.npmrc` is gitignored so it cannot become a committed production policy. The root install of OpenNext/Next did not use it.

## 3. Package approval (executed)

Wasim approved the Phase 0 install on 2026-08-26 with these corrections:

- Isolated Pi spike: `@cloudflare/vitest-plugin@1.1.0`, not `@cloudflare/vitest-pool-workers`.
- Types: `wrangler types`, not a direct `@cloudflare/workers-types` install. Wrangler still lists `@cloudflare/workers-types` as an optional peer in the lockfiles.
- `legacy-peer-deps=true` is confined to disposable Pi spike installs and must not become a root or production installation policy.
- OpenNext/Next only after the unpaid Pi proof: `@opennextjs/cloudflare@1.20.3`, `wrangler@4.126.0`, `rclone.js@0.6.6`, `next@16.3.3`, `eslint-config-next@16.3.3`.
- Local OpenNext build/preview only. No `migrate`, `deploy`, `upload`, remote cache, or Cloudflare resources.
- Live AI Gateway / Workers AI unapproved.
- Do not commit incidental `next-env.d.ts` unless Next 16.3.3 verification requires it. `npx tsc --noEmit` still passes with the HEAD file; `next build` rewrites it to import `.next/types/root-params.d.ts`. Left uncommitted.

## 4. Spikes

### Pi Worker (unpaid `fauxProvider()`)

Commands: `npm run typecheck:spike:pi`, `npm run test:spike:pi`, plus in the spike directory `check:startup`, `dry-run`, `check:bundle`.

| Check | Result |
| --- | --- |
| Typecheck | `wrangler types` + `tsc --noEmit` (src and test) exit 0 |
| Worker tests | 1 file, **5 passed** (`@cloudflare/vitest-plugin` 1.1.0) |
| Bundle | 656.90 KiB / gzip **114.68 KiB** (Workers Paid gzip limit 10 MiB) |
| Startup (local) | window 35.6 ms, active 16.0 ms |
| Forbidden modules | none of sqlite, OAuth, `node:child_process`, `node:readline` |
| Imports | `Agent` + `@earendil-works/pi-ai/providers/faux` only |

Contracts proved: `text_delta` streaming, typed tool start/end events, sequential mutating tools, `Agent.abort()` after first delta, fresh agent from cloned messages.

### OpenNext (local only)

`open-next.config.ts` is `defineCloudflareConfig()` with dummy cache. Root `wrangler.jsonc` has `nodejs_compat`, `global_fetch_strictly_public`, Assets, and a local self service binding. No R2, D1, KV, Images, or Durable Objects.

| Check | Result |
| --- | --- |
| `opennextjs-cloudflare build` | exit 0, Next 16.3.3, OpenNext 1.20.3, aws adapter 4.1.1 |
| Preview cache | “Incremental cache does not need populating”; “Tag cache does not need populating” |
| Bundle | 7500.89 KiB / gzip **1599.31 KiB** |
| Startup (local) | window 145.8 ms, active 43.6 ms |
| `GET /` | 200, `x-opennext: 1`, chunked HTML |
| Static | `/icon.svg` 200, `/file.svg` 200, `/_next/static` CSS immutable cache header |
| Missing route | 404 |
| UI | Chat, Knowledge, Evaluations rendered on `http://127.0.0.1:8790` |
| Server action | `POST /` 200 in 237 ms (grounded-question action reached the Worker) |
| Route handlers | none in the app |
| `node:fs` | Knowledge inventory **0 documents** on Workers; Convex vector count still 50 |

`unpdf` is not separately proven inside workerd. Add-document currently writes with `node:fs` and was not run on the Worker.

## 5. Tests and baselines

Useful Brain **before** Next 16.3.3, Node v22.23.1:

```
npx tsc --noEmit          # exit 0
npm run lint              # exit 0
npm test                  # 25 files, 154 tests
npm run build             # Next.js 16.2.9, `/` dynamic, `/_not-found` and `/icon.svg` static
```

Useful Brain **PR verification**, Node v22.23.1:

```
npx tsc --noEmit          # exit 0
npm run lint              # exit 0 (`.wrangler/**` ignored)
npm test                  # 25 files, 154 tests
npm run build             # Next.js 16.3.3, same routes
npm run typecheck:spike:pi  # exit 0
npm run test:spike:pi       # 1 file, 5 passed
```

**Regression:** none in tsc, lint, test count, or route table.

Nura contracts covered by that suite (unit, not live Foundry evals):

- Retrieval display: `src/lib/rag/retrieval.test.ts`
- Citation labels, invalid citations, `insufficient_evidence`: `convex/groundedAnswer.test.ts`
- Eval grounding/refusal/health assertions: `src/lib/eval/run-eval.test.ts` over the 10-case `MANUAL_EVAL_SET`
- Sanitized operation records: `convex/operations.test.ts`
- Failed draft does not change the active corpus: `convex/corpusVersions.test.ts`
- Current chunker remains heading-v2, 160/220 words, zero overlap

Live MANUAL_EVAL_SET against Convex/Foundry was not run (paid model path, approval boundary).

Burooj fake-provider, memory store only (unchanged from the earlier capture):

```
SANAD_STORE=memory SANAD_EMBEDDING_PROVIDER=fake SANAD_RERANKER_PROVIDER=none
.venv/bin/python -m pytest tests/test_evals.py -q
# 34 passed in 15.28s
```

Local `sanad evals --local` equivalent (`_run_evals(top_k=3, local=True)`):

- 120 questions, 0 ACL leaks
- recall 0.907, MRR 0.821, nDCG 0.831, citation 0.505
- q086–q090: 0.80 / 0.80 / 0.707 / 0.00
- q116–q120: 0.60 / 0.80 / 0.600 / 0.20
- git_revision `630ba08dc7cad6aa71942d6842ce6d8d55a26873`
- corpus sha256 `d09189fc8f6def51d91f7f509624fddb783dcadb527e8ea694276d04c99ee031`
- questions sha256 `3d3a96d1c327ce0c1241b8843318585f4299946ff3c37eee56e6e5b8c70a9ade`

Real-stack baselines were **not** re-run. Re-running would ingest or query the live D1/Vectorize corpus. Locked numbers from Burooj docs at the same commit are in `docs/burooj-migration-ledger.md`.

## 6. First-pilot planning profile

Approved 2026-08-26. Planning assumptions for the first isolated company deployment, not customer contractual promises. Also recorded in the master plan Phase 0 section.

### Residency and retention

- Target an EU-based first pilot.
- GDPR-compatible processing with contractual transfer safeguards. Not strict EU-only processing.
- Create D1 databases and R2 buckets with the `eu` jurisdiction.
- Do not onboard a company requiring strict EU-only processing until Vectorize, Workers AI, AI Gateway, Worker execution and outbound model calls have a documented compliant path.
- Source documents remain until deleted by the company. Purge deleted source objects and obsolete parser artifacts within 30 days.
- Retain conversations and exact evidence snapshots for 90 days.
- Retain operational logs for 30 days.
- Retain approval, security and mutating-action audit records for 365 days.
- Disable AI Gateway prompt and response payload storage. Retain metadata-only usage records.
- Continue using synthetic data until a production data-handling review explicitly permits real company content.

### First-pilot workload envelope

- Up to 10,000 documents
- Up to 10 GB of source files
- Maximum individual file size: 25 MB
- Planning estimate: up to 100,000 chunks
- Incremental connector synchronization: hourly
- Full corpus rebuild: monthly and on retrieval configuration changes

### Users and concurrency

- Up to 50 employees
- Up to 10 concurrent chat or agent runs
- Up to 5 service-token callers
- One isolated application and Cloudflare resource set per company

### Initial product scope

- Ship the Pi-based agent shell with the first release.
- The first release is knowledge-first: retrieval, grounded answers, evaluations and read-only tools.
- External mutating connector actions remain disabled until their policy, approval and idempotency phases pass.
- If a production-only Pi problem appears later, knowledge-only RAG may ship while the agent runtime issue is resolved.

### Diagnostic visibility

- Company administrators and designated operators may see complete retrieval diagnostics.
- Ordinary employees may see citations and evidence they are authorized to read.
- Ordinary employees may not see ACL calculations, hidden candidates, raw policy traces, model prompts or cross-user operational traces.

### Numeric release budgets

Latency:

- Retrieval p95: no more than 1.5 seconds
- Time to first generated token p95: no more than 3 seconds
- Complete grounded answer p95: no more than 15 seconds, excluding approval waits and external connector latency
- Accepted document searchable p95: no more than 5 minutes for ordinary files

Quality:

- ACL leaks: exactly 0
- Invalid citations: exactly 0
- Unsupported answers for locked unanswerable cases: exactly 0
- Full fake-provider evaluation floors: recall 0.907, MRR 0.821 and nDCG 0.831
- Locked real-stack slices must meet or exceed the recorded BGE plus 0.05 results
- Retrieval changes may not reduce either the fake or real locked baseline without an explicit reviewed decision

Cost:

- Idle deployment: existing $5 Workers Paid account minimum, with effectively $0 incremental idle Cloudflare cost
- First-pilot Cloudflare platform budget: no more than $25 per month
- External generation-model budget: no more than $75 per month
- Initial combined operating budget: no more than $100 per company per month
- Credits are excluded from cost justification until the billing dashboard confirms Developer Platform eligibility
- Add budget alerts before any repeated live-stack evaluation or external model workload
