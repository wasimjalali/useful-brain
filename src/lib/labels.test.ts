import { describe, expect, it } from "vitest";

import { departmentLabel, roleLabel, shortGenerationId } from "./labels";

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

describe("shortGenerationId", () => {
  it("keeps g- and eight hex characters", () => {
    expect(shortGenerationId("g-c305cf57-aaaa-4bbb-8ccc-123456789abc")).toBe("g-c305cf57");
    expect(shortGenerationId("g-c305cf57")).toBe("g-c305cf57");
    expect(shortGenerationId("None")).toBe("None");
  });
});
