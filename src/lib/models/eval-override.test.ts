import { describe, expect, it } from "vitest";

import {
  EVAL_CHAT_MODELS,
  EvalModelOverrideForbidden,
  EvalModelOverrideInvalid,
  evalChatModel,
  parseEvalModelOverride,
} from "./eval-override";
import { CHAT_MODEL_ID } from "./selection";

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

  it("keeps the locked model descriptor for the default id and rebrands candidates", () => {
    expect(evalChatModel(CHAT_MODEL_ID).id).toBe(CHAT_MODEL_ID);
    const candidate = evalChatModel("@cf/google/gemma-4-26b-a4b-it");
    expect(candidate.id).toBe("@cf/google/gemma-4-26b-a4b-it");
    expect(candidate.api).toBe("openai-completions");
  });
});
