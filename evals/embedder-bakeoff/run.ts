// Embedder bake-off: Qwen3 Embedding 0.6B (production) vs BGE-M3 on the
// Northwind corpus, dense retrieval only. Chunks come from the production
// chunker (300/30), each question's principal filters chunks before ranking,
// and documents are scored against the locked 120-question gold set.
//
//   npx wrangler dev -c evals/embedder-bakeoff/wrangler.jsonc --port 8791 --ip 127.0.0.1
//   npx jiti evals/embedder-bakeoff/run.ts --url http://127.0.0.1:8791 --out evals/results/<dir>
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { canAccessChunk } from "../../src/lib/acl/access";
import { embeddingPayload } from "../../src/lib/embeddings/instructions";
import { chunkDocument } from "../../src/lib/ingest/chunker";
import { mean, ndcg, rankedDocumentIds, recall, reciprocalRank } from "../../src/lib/eval/metrics";
import {
  ABSTENTION_CATEGORIES,
  loadDocuments,
  loadQuestions,
  type NorthwindDocument,
} from "../../src/lib/eval/northwind-loader";

const QWEN = "@cf/qwen/qwen3-embedding-0.6b";
const BGE_M3 = "@cf/baai/bge-m3";
const DIMENSIONS = 1024;
const BATCH = 8;

type Model = typeof QWEN | typeof BGE_M3;

type Chunk = {
  chunkId: string;
  documentId: string;
  content: string;
  document: NorthwindDocument;
};

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} is required`);
  }
  return value;
}

// Production payloads for Qwen3 (documents raw, queries with the instruction).
// BGE-M3 has no instruction field; its `query` field switches it to scoring
// mode, so queries go in as plain contexts too.
function payload(model: Model, kind: "documents" | "query", texts: string[]): Record<string, unknown> {
  if (model === QWEN) {
    return kind === "documents"
      ? embeddingPayload({ kind: "documents", texts })
      : embeddingPayload({ kind: "query", text: texts[0] });
  }
  return { contexts: texts.map((text) => ({ text })) };
}

function vectorsFrom(output: unknown, expected: number): number[][] {
  const body = output as { data?: unknown; response?: unknown; result?: { data?: unknown } };
  const vectors = body?.data ?? body?.response ?? body?.result?.data;
  if (!Array.isArray(vectors) || vectors.length !== expected) {
    throw new Error(`expected ${expected} vectors, got ${JSON.stringify(output).slice(0, 200)}`);
  }
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== DIMENSIONS) {
      throw new Error(`vector length ${Array.isArray(vector) ? vector.length : "?"} != ${DIMENSIONS}`);
    }
  }
  return vectors as number[][];
}

async function embed(url: string, model: Model, kind: "documents" | "query", texts: string[]) {
  const response = await fetch(`${url}/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: payload(model, kind, texts) }),
  });
  if (!response.ok) {
    throw new Error(`${model} ${kind}: HTTP ${response.status} ${await response.text()}`);
  }
  const { ms, output } = (await response.json()) as { ms: number; output: unknown };
  return { ms, vectors: vectorsFrom(output, texts.length).map(normalize) };
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    throw new Error("zero-length embedding");
  }
  return vector.map((value) => value / norm);
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  const url = arg("--url").replace(/\/$/, "");
  const outDir = arg("--out");
  const root = path.join(process.cwd(), "content", "northwind");
  const documents = loadDocuments(root);
  const { questions } = loadQuestions(path.join(root, "questions.json"), documents);
  const chunks: Chunk[] = documents.flatMap((document) =>
    chunkDocument({ documentId: document.documentId, content: document.body }).map((chunk) => ({
      chunkId: chunk.chunkId,
      documentId: document.documentId,
      content: chunk.content,
      document,
    })),
  );
  console.log(`${documents.length} documents, ${chunks.length} chunks, ${questions.length} questions`);

  const summaries: Record<string, unknown> = {};
  mkdirSync(outDir, { recursive: true });
  for (const model of [QWEN, BGE_M3] as Model[]) {
    const chunkVectors: number[][] = [];
    let indexMs = 0;
    for (let index = 0; index < chunks.length; index += BATCH) {
      const slice = chunks.slice(index, index + BATCH);
      const { ms, vectors } = await embed(url, model, "documents", slice.map((chunk) => chunk.content));
      indexMs += ms;
      chunkVectors.push(...vectors);
    }

    const rows = [];
    const queryMs: number[] = [];
    for (const question of questions) {
      const { ms, vectors } = await embed(url, model, "query", [question.query]);
      queryMs.push(ms);
      const scored = chunks
        .map((chunk, index) => ({ chunk, score: dot(vectors[0], chunkVectors[index]) }))
        .filter(({ chunk }) =>
          canAccessChunk(question.principal, {
            ...chunk.document,
            ownerUserId:
              typeof chunk.document.metadata.owner_user_id === "string"
                ? chunk.document.metadata.owner_user_id
                : "",
          }).allowed,
        )
        .sort((left, right) => right.score - left.score);
      const ranked = rankedDocumentIds(scored.map(({ chunk }) => chunk.documentId));
      const requireAll = question.category === "multi_hop" || question.category === "multi_hop_expanded";
      rows.push({
        questionId: question.questionId,
        category: question.category,
        expected: question.expectedDocumentIds,
        top10: ranked.slice(0, 10),
        leaked: ranked.filter((id) => question.forbiddenDocumentIds.includes(id)).length,
        recallAt3: recall(ranked.slice(0, 3), question.expectedDocumentIds, requireAll),
        recallAt8: recall(ranked.slice(0, 8), question.expectedDocumentIds, requireAll),
        mrr: reciprocalRank(ranked, question.expectedDocumentIds),
        ndcgAt10: ndcg(ranked, question.expectedDocumentIds, 10, requireAll),
        queryMs: ms,
      });
    }

    const answerable = rows.filter(
      (row) => !ABSTENTION_CATEGORIES.has(row.category) && row.expected.length > 0,
    );
    const byCategory: Record<string, { n: number; recallAt3: number; mrr: number }> = {};
    for (const category of new Set(answerable.map((row) => row.category))) {
      const inCategory = answerable.filter((row) => row.category === category);
      byCategory[category] = {
        n: inCategory.length,
        recallAt3: mean(inCategory.map((row) => row.recallAt3)),
        mrr: mean(inCategory.map((row) => row.mrr)),
      };
    }
    const summary = {
      model,
      scoredQuestions: answerable.length,
      recallAt3: mean(answerable.map((row) => row.recallAt3)),
      recallAt8: mean(answerable.map((row) => row.recallAt8)),
      mrr: mean(answerable.map((row) => row.mrr)),
      ndcgAt10: mean(answerable.map((row) => row.ndcgAt10)),
      byCategory,
      leakedDocuments: rows.reduce((sum, row) => sum + row.leaked, 0),
      queryLatencyMs: { p50: percentile(queryMs, 50), p95: percentile(queryMs, 95) },
      indexMs,
      chunks: chunks.length,
    };
    summaries[model] = summary;
    const slug = model.replace(/^@cf\//, "").replace(/[^a-zA-Z0-9.-]+/g, "-");
    writeFileSync(path.join(outDir, `raw-${slug}.json`), `${JSON.stringify({ summary, rows }, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  }
  writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summaries, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
