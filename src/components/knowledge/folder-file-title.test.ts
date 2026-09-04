import { describe, expect, it } from "vitest";

import { folderFileTitle } from "./knowledge-workspace";

describe("folderFileTitle", () => {
  it("drops the selected root folder and the extension", () => {
    expect(folderFileTitle("policies/return-policy.md")).toBe("return-policy");
  });

  it("keeps subfolder nesting for same-named files", () => {
    expect(folderFileTitle("policies/2026/refund.md")).toBe("2026 / refund");
  });

  it("handles a bare filename with no root folder", () => {
    expect(folderFileTitle("warranty.md")).toBe("warranty");
  });

  it("trims stray slashes and whitespace", () => {
    expect(folderFileTitle("/policies//notes.txt")).toBe("notes");
  });
});
