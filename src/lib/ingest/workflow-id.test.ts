import { describe, expect, it } from "vitest";

import { isWorkflowAlreadyExists, workflowInstanceId } from "./workflow-id";

describe("ingestion workflow ids", () => {
  it("derives a deterministic instance id from the idempotency key", () => {
    expect(workflowInstanceId("idem-1")).toBe("idem-1");
    expect(() => workflowInstanceId("../x")).toThrow(/invalid/);
    expect(isWorkflowAlreadyExists(new Error("instance already exists"))).toBe(true);
    expect(isWorkflowAlreadyExists(new Error("timeout"))).toBe(false);
  });
});
