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

The working backend under `convex/` is legacy migration source code. It still powers the current application until the Cloudflare path reaches the cutover gates. Do not extend Convex for new target behavior.

The target backend does not exist yet. Do not start it until the external architecture review has been incorporated and the planning gate in `AGENTS.md` is open.

## Current code map

- `convex/`: current identity, conversations, corpus versions, vector retrieval, evaluations and provider adapters.
- `content/synthetic-docs/`: current synthetic support corpus.
- `src/app/`: Next.js App Router, server actions, global styles and metadata.
- `src/components/`: workspace, chat, evidence, knowledge and evaluation UI.
- `src/lib/rag/`: current loading, chunking, retrieval types and answer helpers.
- `src/lib/eval/`: current evaluation battery.
- `docs/useful-brain-master-plan.md`: source of truth for the target architecture.
- `docs/superpowers/`: historical Nura design and implementation records.

## Important current behavior to preserve

- Explicit corpus promotion keeps a failed draft from changing active retrieval.
- Conversations use server-owned bounded history and persist exact evidence snapshots.
- Answer validation requires real citations and refuses missing evidence.
- Provider calls have bounded retry and sanitized operation records.
- The UI exposes the retrieval evidence used for every answer.

The master plan defines how these contracts move to D1, R2, Vectorize, Workflows, Queues, Durable Objects, optional Access JWT verification, Workers AI, AI Gateway and Pi Agent Core. This is a local portfolio product: no billing, public signup or required Cloudflare Access.
