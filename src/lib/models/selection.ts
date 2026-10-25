import { EMBEDDING_DIMENSIONS, EMBEDDING_METRIC, EMBEDDING_MODEL } from "../embeddings/instructions";
import { RERANKER_MODEL } from "../retrieve/rerank";

export const CHAT_MODEL_ID = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
export const CHAT_MODEL_NAME = "DeepSeek V4.1 Flash";
export const CHAT_MODEL_PROVIDER = "cloudflare-workers-ai";

export const SELECTED_MODELS = {
  chat: {
    id: CHAT_MODEL_ID,
    name: CHAT_MODEL_NAME,
    provider: CHAT_MODEL_PROVIDER,
    role: "chat",
  },
  embedding: {
    id: EMBEDDING_MODEL,
    name: "BGE-M3",
    provider: CHAT_MODEL_PROVIDER,
    role: "embedding",
    dimensions: EMBEDDING_DIMENSIONS,
    metric: EMBEDDING_METRIC,
  },
  rerank: {
    id: RERANKER_MODEL,
    name: "BGE Reranker Base",
    provider: CHAT_MODEL_PROVIDER,
    role: "rerank",
  },
} as const;

export function selectedCloudflareHostedModels(): Array<{ id: string; role: string }> {
  return Object.values(SELECTED_MODELS).map((model) => ({ id: model.id, role: model.role }));
}
