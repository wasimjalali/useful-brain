import { describe, expect, it } from "vitest";

import { departmentLabel, modelDisplayName, roleLabel, shortGenerationId } from "./labels";

describe("labels", () => {
  it("formats departments", () => {
    expect(departmentLabel("hr")).toBe("HR");
    expect(departmentLabel("support")).toBe("Support");
    expect(departmentLabel("engineering")).toBe("Engineering");
  });

  it("formats roles from the README list", () => {
    expect(roleLabel("manager")).toBe("Managers");
    expect(roleLabel("director")).toBe("Directors");
    expect(roleLabel("hr_manager")).toBe("HR managers");
    expect(roleLabel("finance_manager")).toBe("Finance managers");
    expect(roleLabel("support_manager")).toBe("Support managers");
    expect(roleLabel("sales_manager")).toBe("Sales managers");
    expect(roleLabel("standard")).toBe("Members");
  });
});

describe("modelDisplayName", () => {
  it("names known models and passes unknown ids through", () => {
    expect(modelDisplayName("@cf/zai-org/glm-5.3-flash")).toBe("GLM 5.3 Flash");
    expect(modelDisplayName("@cf/zai-org/glm-5.3")).toBe("GLM 5.3");
    expect(modelDisplayName("@cf/qwen/qwen3-embedding-0.6b")).toBe("Qwen3 Embedding 0.6B");
    expect(modelDisplayName("@cf/baai/bge-reranker-base")).toBe("BGE Reranker Base");
    expect(modelDisplayName("@cf/acme/unknown")).toBe("@cf/acme/unknown");
  });
});

describe("shortGenerationId", () => {
  it("keeps g- and eight hex characters", () => {
    expect(shortGenerationId("g-c305cf57-aaaa-4bbb-8ccc-123456789abc")).toBe("g-c305cf57");
    expect(shortGenerationId("g-c305cf57")).toBe("g-c305cf57");
    expect(shortGenerationId("None")).toBe("None");
  });
});
