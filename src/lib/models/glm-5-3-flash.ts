import type { Model } from "@earendil-works/pi-ai";

import { CHAT_MODEL_PROVIDER } from "./selection";

export const GLM_5_3_FLASH_ID = "@cf/zai-org/glm-5.3-flash";

export function glm53FlashModel(): Model<"openai-completions"> {
  return {
    id: GLM_5_3_FLASH_ID,
    name: "GLM-5.3 Flash",
    api: "openai-completions",
    provider: CHAT_MODEL_PROVIDER,
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: {
      input: 0.15,
      output: 0.5,
      cacheRead: 0.03,
      cacheWrite: 0,
    },
    contextWindow: 1_048_576,
    maxTokens: 1_048_576,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsLongCacheRetention: false,
      sendSessionAffinityHeaders: true,
    },
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
      max: null,
    },
  };
}

/**
 * The runtime descriptor for any approved Workers AI chat model, production
 * or eval candidate. Identity fields switch to the model; transport and API
 * shape stay GLM 5.3 Flash's (OpenAI-compatible chat completions on Workers
 * AI), which every approved candidate shares. Production (`CHAT_MODEL_ID`)
 * and the loopback `evalModel` override both build through this function, so
 * production sends exactly what the evals measured.
 */
export function workersAiChatModel(id: string): Model<"openai-completions"> {
  const base = glm53FlashModel();
  if (id === base.id) {
    return base;
  }
  return { ...base, id, name: id };
}
