export const DOCUMENT_EMBEDDING_INSTRUCTION = null;

export const QUERY_EMBEDDING_INSTRUCTION =
  "Given a web search query, retrieve relevant passages that answer the query";

export const EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_METRIC = "cosine" as const;

export type EmbeddingRequest =
  | { kind: "documents"; texts: string[] }
  | { kind: "query"; text: string; instruction?: string | null };

export function embeddingPayload(request: EmbeddingRequest): Record<string, unknown> {
  if (request.kind === "documents") {
    return { documents: request.texts };
  }
  const instruction = request.instruction === undefined ? QUERY_EMBEDDING_INSTRUCTION : request.instruction;
  if (instruction === null || instruction === "") {
    return { queries: [request.text] };
  }
  return { queries: [request.text], instruction };
}

export function assertDistinctQueryAndDocumentPayloads(): void {
  const documentPayload = embeddingPayload({ kind: "documents", texts: ["refund policy"] });
  const queryPayload = embeddingPayload({ kind: "query", text: "refund policy" });
  if (JSON.stringify(documentPayload) === JSON.stringify(queryPayload)) {
    throw new Error("query and document embedding instructions must remain distinct");
  }
}
