# Operations runbook (Phase 7A staging)

Local portfolio agent. Synthetic data only. No billing or production cutover.

## Operator identity

- Local: `IDENTITY_MODE=loopback` on `127.0.0.1` with `LOOPBACK_RUNTIME=true`. A signed-in session cookie, if present, wins over the loopback operator.
- Staging `workers.dev`: `IDENTITY_MODE=session`. Never enable loopback on a public URL.
- Email/password accounts live in operations D1 (`auth_users`, `auth_sessions`). Cookie name is `usefulbrain.session`.
- Signup is gated by `SIGNUP_CODE` (Wrangler secret on Brain). Requests must carry the matching `signupCode`; when the secret is unset, signup is closed entirely. The code lives in the password manager, not in the repo.
- Reserved debug account: `uismoke1@example.com` in staging operations D1. Its password is in Wasim's password manager (entry: "Useful Brain staging debug"). Used for verifying auth changes; never delete this row when cleaning test accounts.
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

## Vectorize inventory secrets (Ingestion worker)

Draft reconciliation lists the whole Vectorize index through the REST API when these two secrets are set, so it can find orphan vectors. Without them it stays binding-only (`getByIds` on the ledger) and records `inventory_checked = 0`. Create an API token with the Account > Vectorize > Read permission only. Values live in the password manager, never in the repo.

Staging:

```bash
npx wrangler secret put VECTORIZE_API_TOKEN -c workers/ingestion/wrangler.jsonc --env staging
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID -c workers/ingestion/wrangler.jsonc --env staging
```

Local dev: put `VECTORIZE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `workers/ingestion/.dev.vars` (gitignored). The index name is the plain var `VECTORIZE_INDEX_NAME` in `workers/ingestion/wrangler.jsonc`, kept equal to each environment's Vectorize `index_name` by a test. Apply corpus migration `0006_draft_inventory.sql` before deploying.

Behavior to know:

- The two secrets switch the feature on. With neither set, reconciliation is binding-only, whatever `VECTORIZE_INDEX_NAME` says (it is a plain var in every environment). With both set it lists the index. With only one secret, or both and no index name, reconciliation fails closed (not reconciled, reason "inventory partly configured") and the worker logs the missing setting names.
- An orphan in the draft's own namespace (a vector in the index with no D1 row) fails the draft after the retries run out. Orphans in other namespaces are counted only.
- More than 2,000 unknown vectors (ids in the index with no D1 row) is retried while the check is pending, since purge deletes may still be landing. If it persists, the final attempt fails closed with a reason naming the count, because the rest could hide an in-draft orphan. The draft then ends as `RECONCILIATION_FAILED` and has no re-check route. Clean up the index, then start a new upload or draft.
- A 429 from the API is waited out only when `Retry-After` is a whole number of seconds, 60 or less, with at most 5 retries per page and 60 seconds of waiting in total. A date form, a larger number or no header fails the attempt and the step retries.
- One listing has a 240 second deadline, waits and in-flight requests included, with a 100 millisecond gap between pages of up to 1,000 ids. At roughly half a second per request the listing alone fits an index of about 100,000 vectors (the planned envelope, about 100 pages, around one minute). The whole reconcile step shares one 5 minute timeout: the ledger `getByIds` fetches, the listing and the orphan resolution all run inside it. A full-envelope reindex draft may therefore only finish on the final attempt, and short pages or a slow API make that more likely. On the deadline the attempt fails and the step retries; on the final attempt the draft fails closed.
- Orphan counts are written to `draft_checks` (`inventory_checked`, `orphan_vectors`, `orphan_vectors_in_draft`) and are not shown in the admin UI. Read them with `wrangler d1 execute` against the corpus database. `inventory_checked = 0` means the check ran binding-only.

Verify after setting the secrets: upload one file on staging, let the draft finish, and confirm its `draft_checks` row has `inventory_checked = 1`. The live API's all-namespace listing and `totalCount` semantics are unverified until this runs once. If it fails closed with a "list is incomplete" or "more ids than totalCount" error, the count semantics differ from the docs and the check needs adjusting.

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
