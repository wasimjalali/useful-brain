import { describe, expect, it } from "vitest";

import { DEFAULT_USEFUL_BRAIN_CONFIG } from "./useful-brain-config";

describe("DEFAULT_USEFUL_BRAIN_CONFIG", () => {
  it("defines the client-facing Useful Brain terminology", () => {
    expect(DEFAULT_USEFUL_BRAIN_CONFIG).toEqual({
      productName: "Useful Brain",
      productSubtitle: "Company knowledge",
      supportRoleLabel: "Knowledge agent",
      knowledgeLabel: "Sources",
      evaluationsLabel: "Evals",
    });
  });
});
