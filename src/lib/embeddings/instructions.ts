export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_METRIC = "cosine" as const;

export type EmbeddingRequest =
  | { kind: "documents"; texts: string[] }
  | { kind: "query"; text: string };

/**
 * BGE-M3 embeds documents and queries the same way and takes no instruction.
 * Its `query` field switches the model to scoring mode, so it is never sent:
 * every input goes in as a context.
 */
export function embeddingPayload(request: EmbeddingRequest): Record<string, unknown> {
  const texts = request.kind === "documents" ? request.texts : [request.text];
  return { contexts: texts.map((text) => ({ text })) };
}
