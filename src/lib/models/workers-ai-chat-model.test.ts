import { describe, expect, it } from "vitest";

import { liveRuntime } from "../brain/execute-turn";
import { GLM_5_3_FLASH_ID, glm53FlashModel } from "./glm-5-3-flash";
import { CHAT_MODEL_ID } from "./selection";
import { workersAiChatModel } from "./workers-ai-chat-model";

describe("workersAiChatModel", () => {
  it("builds the production chat model from the GLM descriptor with only id and name swapped", () => {
    const model = workersAiChatModel(CHAT_MODEL_ID);
    expect(model).toEqual({ ...glm53FlashModel(), id: CHAT_MODEL_ID, name: CHAT_MODEL_ID });
    expect(model.id).toBe("@cf/deepseek-ai/deepseek-v4.1-flash-1017");
  });

  it("returns the GLM descriptor unchanged for GLM", () => {
    expect(workersAiChatModel(GLM_5_3_FLASH_ID)).toEqual(glm53FlashModel());
  });

  it("is what the production runtime builds", () => {
    const runtime = liveRuntime({ run: async () => ({}) });
    expect(runtime?.model).toEqual(workersAiChatModel(CHAT_MODEL_ID));
    expect(runtime?.model.id).toBe(CHAT_MODEL_ID);
  });
});
