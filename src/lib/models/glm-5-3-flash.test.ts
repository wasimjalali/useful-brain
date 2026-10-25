import { describe, expect, it } from "vitest";

import { GLM_5_3_FLASH_ID, glm53FlashModel, workersAiChatModel } from "./glm-5-3-flash";
import { CHAT_MODEL_ID, CHAT_MODEL_PROVIDER } from "./selection";

describe("GLM 5.3 Flash Pi model", () => {
  it("clones the Cloudflare-hosted Workers AI catalog entry", () => {
    const model = glm53FlashModel();
    expect(model.id).toBe(GLM_5_3_FLASH_ID);
    expect(model.provider).toBe(CHAT_MODEL_PROVIDER);
    expect(model.api).toBe("openai-completions");
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(["text", "image"]);
    expect(model.cost).toEqual({ input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 });
    expect(model.contextWindow).toBe(1_048_576);
  });
});

describe("workersAiChatModel", () => {
  it("builds the production chat model from the GLM descriptor with only id and name swapped", () => {
    const model = workersAiChatModel(CHAT_MODEL_ID);
    expect(model).toEqual({ ...glm53FlashModel(), id: CHAT_MODEL_ID, name: CHAT_MODEL_ID });
    expect(model.id).toBe("@cf/deepseek-ai/deepseek-v4.1-flash-1017");
  });

  it("returns the GLM descriptor unchanged for GLM", () => {
    expect(workersAiChatModel(GLM_5_3_FLASH_ID)).toEqual(glm53FlashModel());
  });
});
