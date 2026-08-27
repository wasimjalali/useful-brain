# Phase 1 Cloudflare foundation

1. Phase: 1. Code merged in [PR #11](https://github.com/wasimjalali/useful-brain/pull/11). Remainder (provision/deploy/smoke) is on `phase-1-through-7a-staging` from `main` `45e8ffd`. Access exit is partially open. See remainder section below.
2. Objective: authenticated, least-privilege Worker skeleton with independent D1 histories, Access JWT verification, Service Binding identity forwarding, a valid Workflow entrypoint, an atomic SQLite conversation lock, workerd tests and a clean production-tree audit. No production corpus migration. No Cloudflare resource creation.
3. Files and systems changed: `src/lib/auth/*`, `src/lib/cf/*`, `src/lib/store/*`, `src/lib/ingest/*`, `src/app/api/brain/whoami/route.ts`, `migrations/{corpus,operations}/0001_init.sql`, `workers/brain/`, `workers/ingestion/`, root and Worker Wrangler configs, `@cloudflare/vitest-plugin@1.1.0`, patched `postcss`/`nanoid`/`adm-zip` overrides, tracker, ledger, this report. Convex auth is unchanged.
4. Architecture decisions or deviations: Access JWT uses Web Crypto instead of `jose`. AI Gateway payload collection is enforced as `cf-aig-collect-log-payload: false` in application headers, not a Wrangler binding. Staging and production keep `RESOURCES_PROVISIONED=false` so those environments fail startup until resources exist. Bounded 3600s JWKS stale-key grace is retained from Burooj and needs an independent security verdict. Workerd cannot bind Brain as a second service to itself; identity tests call `createBrainBoundRequest` then the Brain Worker fetch handler. `adm-zip@0.6.0` is a verified override for rclone.js/OpenNext (build-time zip extract only).
5. Tests run with exact results (2026-08-26): `npx tsc --noEmit` exit 0; `npm run lint` exit 0; Node Vitest 41 files, 236 passed; Brain workerd 4 files / 12 tests passed; Ingestion workerd 2 files / 3 tests passed; `npm run typecheck:workers` exit 0; `npm run build` Next 16.3.3 exit 0; `npm run build:cf` OpenNext 1.20.3 wrote `.open-next/worker.js`; `npx wrangler deploy --dry-run --config wrangler.jsonc --env development` uploaded 7517.34 KiB / gzip 1604.96 KiB with `BRAIN` service binding; `opennextjs-cloudflare preview --env development` Ready on `http://127.0.0.1:8799`, `GET /` 200, Brain binding local `[not connected]`; `npm audit --omit=dev --audit-level=high` 0 vulnerabilities; wrangler 4.126.0 `--dry-run --env development` and `--env staging` for brain (gzip 8.09 KiB) and ingestion (gzip 7.13 KiB, R2 `eu`). GitHub `verify` on `12e1d30` passed Root checks and Pi spike.
6. Security and code-review findings: unsigned Service Binding principal headers are rejected; JWKS outages return 503 `UNAVAILABLE` rather than 401 after the refetch floor; identity misconfiguration returns 500; loopback ignores caller-controlled forwarding headers and requires `LOOPBACK_RUNTIME`; disabled identity cannot serve authenticated routes; GET `/health` is the only public Worker route; Access team domain rejects ports, credentials, paths, queries and fragments; Brain/Ingestion/Web set `workers_dev`/`preview_urls` false in every environment including loopback. Independent `codex review --base main` (2026-08-26, gpt-5.6-sol, session `01a03f93-2b5c-7ca0-b232-4e2128b08b68`) did not flag the 3600s stale-key grace. It reported P1 loopback workers.dev exposure and P2 malformed-lock JSON plus missing Worker typecheck in CI; those are fixed and review must be re-run.
7. Cloudflare resources created and measured cost: none. Placeholder D1 IDs are not live databases. Dry-run was local only. Gross model cost: $0. Uncovered cash cost: $0.
8. Data migrations and rollback proof: SQL files only. Not applied to any remote D1, so `0001_init.sql` was corrected in place rather than adding `0002_*.sql`. Convex remains the live backend.
9. Remaining risks, blocked items and user decisions: independent review including the stale-key grace verdict; live staging Service Binding and Access smoke after provisioning; enable `PRAGMA foreign_keys = ON` on every operations D1 session that mutates grants. Do not provision resources or start Phase 2 until PR #11 merges.
10. Recommended next step: Phase 2 on `phase-1-through-7a-staging`. Access remains deferred.

## Dependency audit

Command: `npm audit --omit=dev --audit-level=high` (2026-08-26) → 0 vulnerabilities.

Overrides in root `package.json`:

| Package | Overridden to | Advisory | Verification |
| --- | --- | --- | --- |
| `postcss` | `8.5.26` | GHSA-fxqj-rqcc-2cmp / GHSA-r28c-9q8g-f849 (`<=8.5.22`) | Next production build |
| `nanoid` | `3.3.18` | GHSA-28wg-ghj8-5hjv / GHSA-2v37-7h3g-55p8 (`<=3.3.17`) | Compatible with PostCSS 8 CJS |
| `adm-zip` | `0.6.0` | GHSA-xcpc-8h2w-3j85 (`<0.6.0`) | `src/lib/cf/dependency-overrides.test.ts` matches rclone.js `extractEntryTo` |

Did not run `npm audit fix --force`. Did not downgrade OpenNext.

Full `npm audit` (including `devDependencies`) still reports high `brace-expansion` and `js-yaml`. Those packages are not in the `--omit=dev` production tree. Owner: Wasim. Review date: 2026-08-26. Re-check when ESLint/Vitest next move.

## Remainder: provision, deploy, smoke (2026-08-27)

1. Phase: 1 remainder. Branch: `phase-1-through-7a-staging` from `main` `45e8ffd` (PR #12 on merged Phase 1). Commit range starts after that merge.
2. Objective: provision staging-only EU resources, apply `0001_init.sql`, deploy the empty web/brain/ingestion skeleton, smoke health and fail-closed whoami over the Service Binding, record Access as partially open.
3. Files and systems changed: `src/lib/auth/identity-mode.ts` and tests, `src/lib/cf/startup.test.ts`, `src/lib/cf/wrangler-config.test.ts`, `src/app/api/health/route.ts`, `workers/brain/test/identity.test.ts`, root and Worker Wrangler staging vars/IDs, tracker, AGENTS.md, master-plan status lines, this report.
4. Architecture decisions or deviations: Wasim 2026-08-27 authorized a **staging-only** `IDENTITY_MODE=disabled` exception because Cloudflare Access needs a custom domain that does not exist yet. Loopback remains development / `127.0.0.1` only. Staging forbids `LOOPBACK_RUNTIME=true` and Wrangler `access.dev`. Production still requires Access. Web staging `workers_dev: true`; Brain and Ingestion stay `workers_dev: false`, `preview_urls: false`. This is not a silent architecture change. Independent review is deferred to the single consolidated PR after Phase 7A.
5. Tests run with exact results (2026-08-27, Node `v22.22.2`): `npx tsc --noEmit` exit 0; `npm run lint` exit 0; Node Vitest 41 files, 239 passed; Brain workerd 4 files / 13 tests passed; Ingestion workerd 2 files / 3 tests passed; `npm run build` Next 16.3.3 exit 0; `npm run build:cf` OpenNext 1.20.3; wrangler 4.126.0 `--dry-run --env staging` Brain gzip 8.21 KiB, Ingestion gzip 7.22 KiB, Web gzip 1608.06 KiB; `npm audit --omit=dev --audit-level=high` 0 vulnerabilities.
6. Security: live `GET /api/health` 200 `ok` with Brain `x-request-id`; live `GET /api/brain/whoami` 500 `INTERNAL_ERROR` (disabled identity cannot serve authenticated routes); spoofed principal headers do not authenticate; Brain/Ingestion `*.workers.dev` return Cloudflare 1042; no Access AUD or team domain committed; `LOOPBACK_RUNTIME=false` on staging.
7. Cloudflare resources created (staging only, account `3d757afb0bb862e97e04c9eddc8db6d0`, Karko AI). Did not touch `usefulapply-*` or `sanad-*`.

| Resource | Name | ID / notes |
| --- | --- | --- |
| D1 corpus | `useful-brain-corpus-staging` | `d9c08e55-e2fa-4489-a9ee-50fdf818d62c`, jurisdiction `eu`, region EEUR |
| D1 operations | `useful-brain-operations-staging` | `c2f5b3bc-3924-4e7e-be25-b1aa2020ac3e`, jurisdiction `eu`, region EEUR |
| R2 | `useful-brain-sources-staging` | jurisdiction `eu` |
| Vectorize | `useful-brain-staging` | 1024 dimensions, cosine (`@cf/qwen/qwen3-embedding-0.6b`) |
| Queue | `useful-brain-ingest-staging` | producer Brain, consumer Ingestion |
| Queue DLQ | `useful-brain-ingest-dlq-staging` | |
| Workflow | `useful-brain-ingestion-staging` | class `IngestionWorkflow` |
| Worker web | `useful-brain-staging` | version `0e5bf441-5b17-4846-abec-bba9e76ed2a9`, `https://useful-brain-staging.karko-ai.workers.dev` |
| Worker brain | `useful-brain-brain-staging` | version `1256a5e6-a289-47e2-b205-8d0a8229c7c8`, not public |
| Worker ingestion | `useful-brain-ingestion-staging` | version `f6833bd1-72d0-4c52-97ad-a05d2c5719e4`, not public |

Gross metered cost: empty staging D1/R2/Vectorize/Queues plus three Workers. Idle is expected at approximately the existing $5 Workers Paid minimum. Uncovered cash cost: $0. Gross model cost: $0. No production resources.

8. Data migrations: `migrations/corpus/0001_init.sql` and `migrations/operations/0001_init.sql` applied remotely to the staging D1s (`d1_migrations` recorded both). Tables present: `corpus_generations`, `corpus_state`, `principals`, `roles`, `departments`. Rollback: leave the generation pointer unset; do not use D1 Time Travel for corpus rollback. Convex remains the live application backend.
9. Remaining risks: Access exit is partially open until a custom domain exists; `PRAGMA foreign_keys = ON` still required on mutating operations D1 sessions; independent review waits for the consolidated PR; GitHub Actions quota exhausted so CI did not run.
10. Recommended next phase: Phase 2. Entry gate is open.

## Provisioning list (executed 2026-08-27)

- [x] `wrangler d1 create useful-brain-corpus-staging --jurisdiction eu`
- [x] `wrangler d1 create useful-brain-operations-staging --jurisdiction eu`
- [x] R2 `useful-brain-sources-staging` with `jurisdiction: "eu"`
- [x] Vectorize `useful-brain-staging` (1024, cosine)
- [x] Queues `useful-brain-ingest-staging` and `useful-brain-ingest-dlq-staging`
- [x] Ingestion Workflow `useful-brain-ingestion-staging`
- [ ] Cloudflare Access application — deferred, no custom domain. Do not invent `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`.
- [x] Staging deploy of web, brain, and ingestion Workers
- [x] `RESOURCES_PROVISIONED=true` on staging after IDs were recorded. Production remains `false`.
