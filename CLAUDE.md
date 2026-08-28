# CLAUDE.md

The project rules, safety constraints and migration gate live in `AGENTS.md` and apply here:

@AGENTS.md

The production architecture and phased delivery plan live in:

@docs/useful-brain-master-plan.md

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

The product is now named Useful Brain. Active UI terminology lives in `src/lib/useful-brain-config.ts`. The constellation mark and wordmark live in `src/components/useful-brain-logo.tsx`.

The live backend is Cloudflare Workers (web + Brain). Convex has been removed. Do not reintroduce it.

The target backend is the Cloudflare path in `docs/useful-brain-master-plan.md`.

## Current code map

- `workers/brain/`: identity, conversations, retrieval, evaluations and Pi Agent Core.
- `workers/ingestion/`: corpus ingest workflows.
- `content/northwind/`: Northwind support corpus (65 documents, 120 questions).
- `src/app/`: Next.js App Router, server actions, global styles and metadata.
- `src/components/`: workspace, chat, evidence, knowledge and evaluation UI.
- `src/lib/rag/`: loading, chunking, retrieval types and answer helpers.
- `src/lib/eval/`: evaluation battery.
- `docs/useful-brain-master-plan.md`: source of truth for the architecture.
- `docs/superpowers/`: historical Nura design and implementation records.

## Important current behavior to preserve

- Explicit corpus promotion keeps a failed draft from changing active retrieval.
- Conversations use server-owned bounded history and persist exact evidence snapshots.
- Answer validation requires real citations and refuses missing evidence.
- Provider calls have bounded retry and sanitized operation records.
- The UI exposes the retrieval evidence used for every answer.

The master plan defines how these contracts move to D1, R2, Vectorize, Workflows, Queues, Durable Objects, optional Access JWT verification, Workers AI, AI Gateway and Pi Agent Core. This is a local portfolio product: no billing, public signup or required Cloudflare Access.
