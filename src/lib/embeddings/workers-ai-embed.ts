import { EMBEDDING_DIMENSIONS, embeddingPayload, type EmbeddingRequest } from "./instructions";

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export type WorkersAiRunner = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

export function parseEmbeddingVectors(payload: unknown, expectedCount: number): number[][] {
  const vectors = readVectors(payload);
  if (vectors.length !== expectedCount) {
    throw new EmbeddingError(
      `embedding response returned ${vectors.length} vectors for ${expectedCount} inputs`,
    );
  }
  for (const vector of vectors) {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingError(
        `embedding vector length ${vector.length} does not match ${EMBEDDING_DIMENSIONS}`,
      );
    }
  }
  return vectors;
}

export async function embedWithWorkersAi(
  ai: WorkersAiRunner,
  model: string,
  request: EmbeddingRequest,
): Promise<number[][]> {
  const expected = request.kind === "documents" ? request.texts.length : 1;
  const payload = await ai.run(model, embeddingPayload(request));
  return parseEmbeddingVectors(payload, expected);
}

function readVectors(payload: unknown): number[][] {
  if (!payload || typeof payload !== "object") {
    throw new EmbeddingError("embedding response missing body");
  }
  const body = payload as {
    data?: unknown;
    result?: { data?: unknown; shape?: unknown };
    shape?: unknown;
  };
  const data = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.result?.data)
      ? body.result.data
      : null;
  if (!data) {
    throw new EmbeddingError("embedding response missing data[]");
  }
  return data.map((entry, index) => {
    if (Array.isArray(entry)) {
      return asNumberVector(entry, index);
    }
    if (entry && typeof entry === "object" && Array.isArray((entry as { embedding?: unknown }).embedding)) {
      return asNumberVector((entry as { embedding: unknown[] }).embedding, index);
    }
    throw new EmbeddingError(`embedding entry ${index} is not a vector`);
  });
}

function asNumberVector(values: unknown[], index: number): number[] {
  const vector = values.map((value) => Number(value));
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new EmbeddingError(`embedding entry ${index} contains a non-finite value`);
  }
  return vector;
}
