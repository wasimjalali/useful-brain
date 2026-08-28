import { RERANKER_MODEL, type Reranker } from "./rerank";
import { parseWorkersAiRerankResponse, workersAiRerankRequest } from "./workers-ai-rerank";
import type { WorkersAiRunner } from "../embeddings/workers-ai-embed";

export class WorkersAiReranker implements Reranker {
  constructor(private readonly ai: WorkersAiRunner) {}

  async rerank(query: string, passages: string[]): Promise<number[]> {
    if (passages.length === 0) {
      return [];
    }
    const request = workersAiRerankRequest(query, passages);
    const payload = await this.ai.run(RERANKER_MODEL, request);
    return parseWorkersAiRerankResponse(payload, passages.length);
  }
}
