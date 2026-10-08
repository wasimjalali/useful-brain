# CLAUDE.md

The project rules, safety constraints and migration gate live in `AGENTS.md` and apply here:

@AGENTS.md

Architecture: `docs/useful-brain-master-plan.md` (read the relevant section on demand).

## Commands

```bash
npm run dev
npm run build
npm run lint
npm test
npm run test:watch
npx tsc --noEmit
```

Run a focused test with:

```bash
npx vitest run src/lib/rag/retrieval.test.ts
npm test -- retrieval
```

## Repository state

The product is now named Useful Brain. Active UI terminology lives in `src/lib/useful-brain-config.ts`. The document-and-quote mark and Nunito wordmark live in `src/components/useful-brain-logo.tsx`.

The live backend is Cloudflare Workers (web + Brain). Convex has been removed. Do not reintroduce it.

The target backend is the Cloudflare path in `docs/useful-brain-master-plan.md`.

## Current code map

- `workers/brain/`: identity, conversations, retrieval, evaluations and Pi Agent Core. HTTP routes in `workers/brain/src/routes/` (`chat`, `documents`, `tickets`, `admin-metrics`, `admin-people`, `admin-sources`).
- `workers/ingestion/`: corpus ingest workflows.
- `content/northwind/`: Northwind support corpus (65 documents, 120 questions).
- `src/app/`: Next.js App Router, server actions, global styles and metadata. Member routes live in the `src/app/(app)/` route group, with the admin routes beside them (Overview, Sources, People, Evals, Activity).
- `src/components/`: `shell` (rail, stage, shortcuts), `chat` (with `chat/answer` and `chat/evidence`), `library`, `search` (Cmd+K), `admin/*` (activity, evals, overview, people, sources), `settings/settings-dialog` and `ui` (primitives).
- `src/lib/contracts/`: typed Brain and UI contracts. `src/lib/labels.ts` and `src/lib/theme.ts` hold user-facing labels and theme handling. `src/lib/library/` maps library data. `src/lib/ingest/` holds parsing, chunking and draft checks.
- `migrations/operations/` (0001-0015) and `migrations/corpus/` (0001-0005): D1 migrations.
- `scripts/seed-demo.ts`: seeds demo people into the local database (`npm run seed:demo`, needs `DEMO_PASSWORD`).
- `src/lib/rag/`: loading, chunking, retrieval types and answer helpers.
- `src/lib/eval/`: evaluation battery.
- `evals/`: documented eval campaigns (model evals, system evals, frozen result snapshots), written blog-ready.
- `docs/useful-brain-master-plan.md`: source of truth for the architecture.
- `docs/superpowers/`: historical Nura design and implementation records.

## Important current behavior to preserve

- Explicit corpus promotion keeps a failed draft from changing active retrieval.
- Conversations use server-owned bounded history and persist exact evidence snapshots.
- Answer validation requires real citations and refuses missing evidence.
- Provider calls have bounded retry and sanitized operation records.
- The UI exposes the retrieval evidence used for every answer.
- Admin routes are enforced in Brain (`requireAdmin`), not only in the UI. The admin role grants no read rights.
- Member-facing document counts are asker-readable only, never corpus totals.
- View as is admin-only, resolves grants on the server and is never persisted.
- Uploads go to a draft generation. It must pass reconciliation and the retrieval/ACL guard with 0 leaks before it can be promoted.

The master plan defines how these contracts move to D1, R2, Vectorize, Workflows, Queues, Durable Objects, optional Access JWT verification, Workers AI, AI Gateway and Pi Agent Core. This is a portfolio product: no billing or required Cloudflare Access. Staging identity is email/password sessions.
