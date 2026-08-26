# Phase 1 Cloudflare foundation

1. Phase: 1. Branch: `phase-1-cloudflare-foundation` from `main` `b345644` (merge of [PR #10](https://github.com/wasimjalali/useful-brain/pull/10)). Repair of [PR #11](https://github.com/wasimjalali/useful-brain/pull/11). Do not merge until independent review is green. Staging deploy remains blocked.
2. Objective: authenticated, least-privilege Worker skeleton with independent D1 histories, Access JWT verification, Service Binding identity forwarding, a valid Workflow entrypoint, an atomic SQLite conversation lock, workerd tests and a clean production-tree audit. No production corpus migration. No Cloudflare resource creation.
3. Files and systems changed: `src/lib/auth/*`, `src/lib/cf/*`, `src/lib/store/*`, `src/lib/ingest/*`, `src/app/api/brain/whoami/route.ts`, `migrations/{corpus,operations}/0001_init.sql`, `workers/brain/`, `workers/ingestion/`, root and Worker Wrangler configs, `@cloudflare/vitest-plugin@1.1.0`, patched `postcss`/`nanoid`/`adm-zip` overrides, tracker, ledger, this report. Convex auth is unchanged.
4. Architecture decisions or deviations: Access JWT uses Web Crypto instead of `jose`. AI Gateway payload collection is enforced as `cf-aig-collect-log-payload: false` in application headers, not a Wrangler binding. Staging and production keep `RESOURCES_PROVISIONED=false` so those environments fail startup until resources exist. Bounded 3600s JWKS stale-key grace is retained from Burooj and needs an independent security verdict. Workerd cannot bind Brain as a second service to itself; identity tests call `createBrainBoundRequest` then the Brain Worker fetch handler. `adm-zip@0.6.0` is a verified override for rclone.js/OpenNext (build-time zip extract only).
5. Tests run with exact results (2026-08-26): `npx tsc --noEmit` exit 0; `npm run lint` exit 0; Node Vitest 41 files, 236 passed; Brain workerd 4 files / 12 tests passed; Ingestion workerd 2 files / 3 tests passed; `npm run typecheck:workers` exit 0; `npm run build` Next 16.3.3 exit 0; `npm run build:cf` OpenNext 1.20.3 wrote `.open-next/worker.js`; `npx wrangler deploy --dry-run --config wrangler.jsonc --env development` uploaded 7517.34 KiB / gzip 1604.96 KiB with `BRAIN` service binding; `opennextjs-cloudflare preview --env development` Ready on `http://127.0.0.1:8799`, `GET /` 200, Brain binding local `[not connected]`; `npm audit --omit=dev --audit-level=high` 0 vulnerabilities; wrangler 4.126.0 `--dry-run --env development` and `--env staging` for brain (gzip 8.09 KiB) and ingestion (gzip 7.13 KiB, R2 `eu`). GitHub `verify` on `12e1d30` passed Root checks and Pi spike.
6. Security and code-review findings: unsigned Service Binding principal headers are rejected; JWKS outages return 503 `UNAVAILABLE` rather than 401 after the refetch floor; identity misconfiguration returns 500; loopback ignores caller-controlled forwarding headers and requires `LOOPBACK_RUNTIME`; disabled identity cannot serve authenticated routes; GET `/health` is the only public Worker route; Access team domain rejects ports, credentials, paths, queries and fragments; Brain/Ingestion/Web set `workers_dev`/`preview_urls` false in every environment including loopback. Independent `codex review --base main` (2026-08-26, gpt-5.6-sol, session `01a03f93-2b5c-7ca0-b232-4e2128b08b68`) did not flag the 3600s stale-key grace. It reported P1 loopback workers.dev exposure and P2 malformed-lock JSON plus missing Worker typecheck in CI; those are fixed and review must be re-run.
7. Cloudflare resources created and measured cost: none. Placeholder D1 IDs are not live databases. Dry-run was local only. Gross model cost: $0. Uncovered cash cost: $0.
8. Data migrations and rollback proof: SQL files only. Not applied to any remote D1, so `0001_init.sql` was corrected in place rather than adding `0002_*.sql`. Convex remains the live backend.
9. Remaining risks, blocked items and user decisions: independent review including the stale-key grace verdict; live staging Service Binding and Access smoke after provisioning; enable `PRAGMA foreign_keys = ON` on every operations D1 session that mutates grants. Do not provision resources or start Phase 2 until PR #11 merges.
10. Recommended next step: run `codex review --base main`, fix confirmed P0/P1 and high/critical findings, wait for GitHub checks, then merge. Phase 1 exit stays closed until the staging deploy is completed.

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

## Provisioning list (not executed)

Standing authorization covers staging provisioning only after this PR is independently reviewed and merged:

- `wrangler d1 create useful-brain-corpus-staging --jurisdiction eu`
- `wrangler d1 create useful-brain-operations-staging --jurisdiction eu`
- R2 `useful-brain-sources-staging` with `jurisdiction: "eu"`
- Vectorize `useful-brain-staging`
- Queues `useful-brain-ingest-staging` and `useful-brain-ingest-dlq-staging`
- Ingestion Workflow `useful-brain-ingestion-staging`
- Cloudflare Access application for the Web staging route; record AUD and team domain as secrets, not in git
- Staging deploy of web, brain, and ingestion Workers
- Set `RESOURCES_PROVISIONED=true` only after IDs are recorded
