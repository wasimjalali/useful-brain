import { describe, expect, it } from "vitest";

import { glm53FlashModel } from "./glm-5-3-flash";
import { CHAT_MODEL_ID, CHAT_MODEL_PROVIDER } from "./selection";

describe("GLM 5.3 Flash Pi model", () => {
  it("clones the Cloudflare-hosted Workers AI catalog entry", () => {
    const model = glm53FlashModel();
    expect(model.id).toBe(CHAT_MODEL_ID);
    expect(model.provider).toBe(CHAT_MODEL_PROVIDER);
    expect(model.api).toBe("openai-completions");
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(["text", "image"]);
    expect(model.cost).toEqual({ input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 });
    expect(model.contextWindow).toBe(1_048_576);
  });
});
