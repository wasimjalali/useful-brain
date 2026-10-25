import type { Model } from "@earendil-works/pi-ai";

import { GLM_5_3_FLASH_ID, glm53FlashModel } from "./glm-5-3-flash";

/**
 * The runtime descriptor for any approved Workers AI chat model, production
 * or eval candidate. Identity fields switch to the model; transport and API
 * shape stay GLM 5.3 Flash's (OpenAI-compatible chat completions on Workers
 * AI), which every approved candidate shares. Production (`CHAT_MODEL_ID`)
 * and the loopback `evalModel` override both build through this function, so
 * production sends exactly what the evals measured.
 *
 * The cost, contextWindow, maxTokens and thinking fields are inherited from
 * GLM on purpose: the eval measured exactly this request, nothing reads them
 * and usage is reported as 0. A future cost or budget check must not read
 * them.
 */
export function workersAiChatModel(id: string): Model<"openai-completions"> {
  const base = glm53FlashModel();
  if (id === GLM_5_3_FLASH_ID) {
    return base;
  }
  return { ...base, id, name: id };
}
