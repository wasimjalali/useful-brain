import { RERANKER_MODEL, type Reranker } from "./rerank";
import { parseWorkersAiRerankResponse, workersAiRerankRequest } from "./workers-ai-rerank";
import type { WorkersAiRunner } from "../embeddings/workers-ai-embed";

export class WorkersAiReranker implements Reranker {
  constructor(private readonly ai: WorkersAiRunner) {}

  async rerank(query: string, passages: string[], signal?: AbortSignal): Promise<number[]> {
    if (passages.length === 0) {
      return [];
    }
    signal?.throwIfAborted();
    const request = workersAiRerankRequest(query, passages);
    const payload = await this.ai.run(RERANKER_MODEL, request, { signal });
    signal?.throwIfAborted();
    return parseWorkersAiRerankResponse(payload, passages.length);
  }
}
