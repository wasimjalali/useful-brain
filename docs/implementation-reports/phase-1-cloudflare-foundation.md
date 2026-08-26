# Phase 1 Cloudflare foundation

1. Phase: 1. Branch: `phase-1-cloudflare-foundation` from `main` `b345644` (merge of [PR #10](https://github.com/wasimjalali/useful-brain/pull/10)). Local skeleton and identity contracts only. Staging deploy is blocked.
2. Objective: authenticated, least-privilege Worker skeleton with independent D1 histories, Access JWT verification, request IDs, and safe error contracts. No production corpus migration. No Cloudflare resource creation.
3. Files and systems changed: `src/lib/auth/*`, `src/lib/cf/*`, `src/lib/store/migrations-contract.test.ts`, `migrations/{corpus,operations}/0001_init.sql`, `workers/brain/`, `workers/ingestion/`, root and Worker Wrangler configs, tracker, ledger, this report, CI dry-run steps. Convex auth is unchanged. No new npm packages.
4. Architecture decisions or deviations: Access JWT uses Web Crypto instead of `jose`. AI Gateway payload collection is enforced as `cf-aig-collect-log-payload: false` in application headers, not a Wrangler binding. Staging and production keep `RESOURCES_PROVISIONED=false` so those environments fail startup until Wasim approves provisioning. Durable Object and Workflow classes are local stubs; they bundle under `wrangler deploy --dry-run`. Worker tests run in Node/Vitest, not `@cloudflare/vitest-plugin`.
5. Tests run with exact results: `npx tsc --noEmit` exit 0; `npm run lint` exit 0; `npm test` 36 files, **212 passed**; `npm run build` Next 16.3.3 exit 0; `wrangler deploy --dry-run --env development` for brain (gzip 6.48 KiB) and ingestion (gzip 6.00 KiB, R2 `eu`).
6. Security and code-review findings: unsigned Service Binding principal headers are rejected; JWKS outages return 503 `UNAVAILABLE` rather than 401; identity misconfiguration returns 500; loopback ignores `X-Forwarded-For` chains; disabled identity cannot serve authenticated routes; GET `/health` is the only public Worker route. No GitHub review comments remained on PR #10 after merge. Critical Access JWT, startup, and service-binding code still needs the independent adversarial review required by `AGENTS.md` before a staging merge.
7. Cloudflare resources created and measured cost: none. Placeholder D1 IDs are not live databases. Dry-run was local only.
8. Data migrations and rollback proof: SQL files only. Not applied to any remote D1. Convex remains the live backend.
9. Remaining risks, blocked items and user decisions: staging skeleton cannot authenticate through Access until resources exist. Need Wasim approval to create EU D1×2 (`wrangler d1 create --jurisdiction eu`), R2 `eu` buckets, Vectorize indexes, ingest queue + DLQ, ingestion Workflow, Access application (AUD + team domain), set `RESOURCES_PROVISIONED=true` for staging, and deploy the empty skeleton. Live AI Gateway / Workers AI remain unapproved. Do not start Phase 2.
10. Recommended next step: merge this PR after checks and the required identity/auth review. Phase 1 exit stays closed until the staging deploy is approved and completed. Phase 2 stays blocked.

## Provisioning list (not executed)

Ask Wasim before any of:

- `wrangler d1 create useful-brain-corpus-staging --jurisdiction eu`
- `wrangler d1 create useful-brain-operations-staging --jurisdiction eu`
- R2 buckets with `jurisdiction: "eu"` for sources (and later artifacts)
- Vectorize index `useful-brain-staging`
- Queues `useful-brain-ingest-staging` and `useful-brain-ingest-dlq-staging`
- Ingestion Workflow binding
- Cloudflare Access application; record AUD and team domain as secrets/vars, not in git
- Staging deploy of web, brain, and ingestion Workers
