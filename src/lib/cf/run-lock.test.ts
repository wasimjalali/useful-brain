import { describe, expect, it } from "vitest";

import { acquireRunLock, releaseRunLock } from "./run-lock";

describe("conversation run lock", () => {
  it("allows the first run and rejects a second concurrent run", () => {
    expect(acquireRunLock(undefined, "run-1")).toEqual({ ok: true, runId: "run-1" });
    expect(acquireRunLock("run-1", "run-2")).toEqual({ ok: false, status: 409 });
    expect(acquireRunLock("run-1", "run-1")).toEqual({ ok: true, runId: "run-1" });
  });

  it("releases only the owning run", () => {
    expect(releaseRunLock("run-1", "run-2")).toEqual({ ok: false, status: 409 });
    expect(releaseRunLock("run-1", "run-1")).toEqual({ ok: true });
  });
});
