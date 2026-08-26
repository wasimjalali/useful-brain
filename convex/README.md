# Convex Backend

This directory holds Useful Brain's legacy Convex backend: identity guards, durable conversations, corpus versioning, vector retrieval, persisted evaluations and safe operation records.

It remains the working migration source and rollback path until the Cloudflare cutover gates in `../docs/useful-brain-master-plan.md` pass. Do not add new target architecture here.

## Schema

`schema.ts` defines the production data model:

- `corpora` and `corpusVersions` - active-version pointer plus draft, ready, active, failed and archived lifecycle records.
- `sourceDocuments` and `documentChunks` - version-scoped documents and chunks. Chunks store reuse metadata and the filtered 1536-dimension vector index.
- `embeddingRuns` - each corpus build and its result.
- `conversations`, `messages` and `messageEvidence` - owner-scoped chat history with exact retrieval snapshots.
- `evalRuns` and `evalCaseResults` - durable evaluation history.
- `operations` - sanitized answer, embedding and evaluation summaries.

## Functions

- `auth.ts` - production identity and role guard, plus the explicit local development actor.
- `conversations.ts` - idempotent pending turns, bounded server history and evidence persistence.
- `corpusVersions.ts` - compatible vector reuse, complete draft storage and atomic promotion.
- `ragStorage.ts` - active corpus status and embedding run records.
- `ragEmbedding.ts` - builds a ready corpus without mutating the active version.
- `ragRetrieval.ts` - searches only the active version, with a safe legacy migration fallback.
- `ragAnswer.ts` - server-owned follow-up context, grounded answers, citations and operation summaries.
- `evaluations.ts` - persisted runs and case results.
- `operations.ts` - safe metadata records with no prompts, source text or credentials.
- `providerRetry.ts`, `answerProvider.ts` and `embeddingProvider.ts` - bounded transient retry and Foundry request handling.

## Interactive setup

Run this once to log in, create a dev deployment, write local Convex settings, and generate `convex/_generated/`:

```bash
npx convex dev
```

After setup, commit the generated Convex files so the project typechecks consistently.

For local development only:

```bash
npx convex env set NURA_ALLOW_ANONYMOUS_DEV true
```

Production must leave this unset and provide Convex identity. Knowledge and evaluation mutations require `knowledge_manager` or `operator`.
