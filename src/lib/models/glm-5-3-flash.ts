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
