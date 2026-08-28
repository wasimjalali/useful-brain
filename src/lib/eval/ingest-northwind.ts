import { chunkDocument } from "../ingest/chunker";
import { FakeEmbeddingProvider } from "../retrieve/fake-embed";
import { MemoryChunkStore } from "../retrieve/memory-store";
import { KnowledgePipeline, type KnowledgePipelineOptions } from "../retrieve/pipeline";
import { FAKE_PROVIDER_FINGERPRINT, type RetrievalFingerprint } from "../retrieve/fingerprint";
import type { ChunkRecord } from "../retrieve/types";
import type { NorthwindDocument } from "./northwind-loader";

export async function ingestNorthwind(
  documents: NorthwindDocument[],
  options: {
    maxTokens?: number;
    overlapTokens?: number;
    fingerprint?: RetrievalFingerprint;
    reranker?: KnowledgePipelineOptions["reranker"];
  } = {},
): Promise<{ pipeline: KnowledgePipeline; chunkCount: number }> {
  const fingerprint = options.fingerprint ?? FAKE_PROVIDER_FINGERPRINT;
  const maxTokens = options.maxTokens ?? fingerprint.maxTokens;
  const overlapTokens = options.overlapTokens ?? fingerprint.overlapTokens;
  const store = new MemoryChunkStore();
  const embedder = new FakeEmbeddingProvider(64);
  const records: ChunkRecord[] = [];
  for (const document of documents) {
    const chunks = chunkDocument({ documentId: document.documentId, content: document.body }, { maxTokens, overlapTokens });
    const embeddings = await embedder.embedTexts(chunks.map((chunk) => chunk.content));
    for (const [index, chunk] of chunks.entries()) {
      records.push({
        chunkId: chunk.chunkId,
        documentId: document.documentId,
        title: document.title,
        sourceName: document.sourceName,
        sourcePath: document.sourcePath,
        sectionHeading: chunk.sectionHeading,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        accessScope: document.accessScope,
        allowedRoles: document.allowedRoles,
        allowedDepartments: document.allowedDepartments,
        ownerUserId:
          typeof document.metadata.owner_user_id === "string" ? document.metadata.owner_user_id : "",
        metadata: document.metadata,
        embedding: embeddings[index],
        version: document.version,
        effectiveDate: document.effectiveDate,
      });
    }
  }
  store.upsert(records);
  return {
    pipeline: new KnowledgePipeline({
      store,
      embedder,
      fingerprint,
      reranker: options.reranker ?? null,
    }),
    chunkCount: records.length,
  };
}
