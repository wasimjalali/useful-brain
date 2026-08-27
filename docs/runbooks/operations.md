# Operations runbook (Phase 7A staging)

Local portfolio agent. Synthetic data only. No billing, public signup, or production cutover.

## Operator identity

- Local: `IDENTITY_MODE=loopback` on `127.0.0.1` with `LOOPBACK_RUNTIME=true`.
- Staging `workers.dev`: `IDENTITY_MODE=disabled`. Never enable loopback on a public URL.
- Cloudflare Access JWT is optional demonstration code, not a launch gate.

## Staging surfaces

- Web: `https://useful-brain-staging.karko-ai.workers.dev`
- Health: `GET /api/health` (web) and Brain `/health`
- Brain/Ingestion: `workers_dev: false`
- Corpus D1: `useful-brain-corpus-staging`
- Operations D1: `useful-brain-operations-staging`
- Vectorize: `useful-brain-staging` 1024 cosine
- R2: `useful-brain-sources-staging` (`eu`)
- Approval workflow: `useful-brain-approval-staging`

## Daily checks

1. `GET /api/health` returns 200.
2. Confirm `RESOURCES_PROVISIONED=true` only on staging.
3. Confirm no real company objects in R2.
4. Record gross Cloudflare spend before credits. Idle should stay at the existing Workers Paid minimum.

## Incidents (fail closed)

- Missing identity, ACL, corpus state, citations, or tool permission: refuse.
- Partial D1/Vectorize write: record and reconcile; do not hide.
- Revoked connector: deny.
- Invalid citation: refuse grounded answer.

## Release modes (synthetic)

- `shadow`: Convex remains the live UI. Cloudflare scores in the background.
- `canary`: Convex remains live. 10% synthetic traffic may exercise Cloudflare.
- `staging_primary`: Cloudflare staging is the synthetic source of truth. Still no real company data.

Phase 7B production-primary is closed.
