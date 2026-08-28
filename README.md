# Useful Brain

Useful Brain is a local portfolio knowledge and action agent. It answers from approved sources, shows the evidence behind every factual claim and takes actions only through explicit tool policy and approval boundaries. It is not a billed product and not a public SaaS.

The product was previously named Nura RAG Copilot. The product name, package name, GitHub repository, local directory and active UI copy now use Useful Brain.

## Planning status

The architecture is finalized in the [Useful Brain production master plan](./docs/useful-brain-master-plan.md). This is a local portfolio product for hiring-manager demonstration: no billing, public signup or required Cloudflare Access.

Phases 0–7A are merged to `main`. The live UI is Cloudflare Brain (D1, Vectorize, Workers AI). GLM 5.3 Flash is the chat model. Convex has been removed. Commercial Phase 7B (real company data, production resource set) stays closed.

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

The working application is Next.js talking to the Brain Worker over a Service Binding:

- visible vector and keyword retrieval with inline citations
- grounded refusals when evidence is missing
- server-owned conversations and evidence snapshots in operations D1
- versioned corpus builds with explicit promotion
- persisted evaluation runs
- Workers AI chat (`@cf/zai-org/glm-5.3-flash`), embeddings (`@cf/qwen/qwen3-embedding-0.6b`), and rerank (`@cf/baai/bge-reranker-base`)

Local UI with Brain connected:

```bash
npm run preview:cf
```

That command builds OpenNext, applies local D1 migrations, and runs `wrangler dev` with the web and Brain configs so the `BRAIN` service binding is live on `127.0.0.1`.

## Burooj migration source

Northwind (65 documents, 120 questions) lives in `content/northwind/`. The recoverable Burooj archive is the gitignored `.archives/burooj-630ba08dc7cad6aa71942d6842ce6d8d55a26873.bundle`. The local Burooj checkout was deleted 2026-08-28. GitHub repo deletion needs the `delete_repo` token scope.

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
