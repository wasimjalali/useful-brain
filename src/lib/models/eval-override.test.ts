import { describe, expect, it } from "vitest";

import {
  EVAL_CHAT_MODELS,
  EvalModelOverrideForbidden,
  EvalModelOverrideInvalid,
  evalChatModel,
  parseEvalModelOverride,
} from "./eval-override";
import { GLM_5_3_FLASH_ID, glm53FlashModel } from "./glm-5-3-flash";
import { CHAT_MODEL_ID } from "./selection";
import { workersAiChatModel } from "./workers-ai-chat-model";

describe("eval model override", () => {
  it("returns undefined when the field is absent", () => {
    expect(parseEvalModelOverride("loopback", undefined)).toBeUndefined();
    expect(parseEvalModelOverride("access", null)).toBeUndefined();
  });

  it("accepts only approved candidates in loopback mode", () => {
    for (const model of EVAL_CHAT_MODELS) {
      expect(parseEvalModelOverride("loopback", model)).toBe(model);
    }
  });

  it("fails closed outside loopback identity mode", () => {
    expect(() => parseEvalModelOverride("access", CHAT_MODEL_ID)).toThrow(
      EvalModelOverrideForbidden,
    );
    expect(() => parseEvalModelOverride("disabled", CHAT_MODEL_ID)).toThrow(
      EvalModelOverrideForbidden,
    );
  });

  it("rejects unapproved or malformed model ids", () => {
    expect(() => parseEvalModelOverride("loopback", "@cf/openai/gpt-oss-120b")).toThrow(
      EvalModelOverrideInvalid,
    );
    expect(() => parseEvalModelOverride("loopback", 42)).toThrow(EvalModelOverrideInvalid);
    expect(() => parseEvalModelOverride("loopback", { id: CHAT_MODEL_ID })).toThrow(
      EvalModelOverrideInvalid,
    );
  });

  it("builds the production descriptor for the production id, GLM unchanged, and rebrands other candidates", () => {
    expect(evalChatModel(CHAT_MODEL_ID)).toEqual(workersAiChatModel(CHAT_MODEL_ID));
    expect(evalChatModel(GLM_5_3_FLASH_ID)).toEqual(glm53FlashModel());
    const candidate = evalChatModel("@cf/google/gemma-4-26b-a4b-it");
    expect(candidate.id).toBe("@cf/google/gemma-4-26b-a4b-it");
    expect(candidate.api).toBe("openai-completions");
  });
});
