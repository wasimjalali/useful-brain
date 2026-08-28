# Useful Brain

Useful Brain is a local portfolio knowledge and action agent. It answers from approved sources, shows the evidence behind every factual claim and takes actions only through explicit tool policy and approval boundaries. It is not a billed product and not a public SaaS.

The product was previously named Nura RAG Copilot. The product name, package name, GitHub repository, local directory and active UI copy now use Useful Brain.

## Planning status

The architecture is finalized in the [Useful Brain production master plan](./docs/useful-brain-master-plan.md). This is a local portfolio product for hiring-manager demonstration: no billing, public signup or required Cloudflare Access.

Phases 0–7A live on `phase-1-through-7a-staging`. Convex remains the live application UI until Phase 7B, which stays closed.

## Target product

- A central knowledge base for approved documents and connected sources.
- Source-grounded answers with visible citations and honest refusals.
- ACL-safe hybrid retrieval, reranking and immutable evidence snapshots.
- A Pi Agent Core runtime for read tools and controlled actions.
- Native tools, MCP servers and plugins behind one policy and approval gateway.
- One isolated local/staging deployment. No billing, public signup or tenant switching.

## Finalized target stack

| Layer | Choice |
| --- | --- |
| Web application | Next.js 16 and TypeScript on Cloudflare Workers through OpenNext initially |
| Styling | Tailwind CSS v4 with the existing role-named design tokens |
| API and agent runtime | Cloudflare Workers with Pi Agent Core |
| Relational data and keyword search | Cloudflare D1 and FTS5 |
| Source files and archives | Cloudflare R2 |
| Vector search | Cloudflare Vectorize |
| Durable ingestion | Cloudflare Workflows and Queues |
| Conversation coordination | Durable Objects and hibernating WebSockets |
| Operator identity | Loopback on 127.0.0.1. Cloudflare Access JWT is optional demonstration code, not required |
| Embeddings and reranking | Cloudflare Workers AI |
| Model routing and telemetry | Cloudflare AI Gateway |
| Tests | Vitest and Testing Library |

## Current implementation

The current working application still uses Convex and its existing model-provider adapter. It already provides:

- visible vector retrieval and inline citations
- grounded refusals when evidence is missing
- server-owned conversations and evidence snapshots
- versioned corpus builds with explicit promotion
- persisted evaluation runs and sanitized operation records
- provider retry, idempotency and role checks

Convex and the old provider path are migration sources, not target dependencies. Do not provision new resources for them.

## Burooj migration source

The sibling `Burooj` repository contains the Sanad Brain implementation that Useful Brain will preserve before Burooj is retired. The migration ledger in the master plan names the retrieval, ACL, connector, reconciliation, corpus and evaluation behavior that must be rewritten in TypeScript.

Burooj must not be deleted until all retirement gates in the master plan pass and a recoverable archive exists.

## Development

The current application uses npm and Node.js 22.19 or newer.

```bash
npm install
npm run dev
```

Verify every change with:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

For contributor, safety and migration rules, see [AGENTS.md](./AGENTS.md).

## License

[MIT](./LICENSE)
