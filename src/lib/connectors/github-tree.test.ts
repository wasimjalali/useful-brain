import { describe, expect, it } from "vitest";

import { ConnectorError, canDeleteStale, listGithubTextPaths, staleDocumentIds } from "./github-tree";

describe("GitHub sync", () => {
  it("refuses a truncated tree and never treats it as a shrink", () => {
    expect(() =>
      listGithubTextPaths({
        truncated: true,
        tree: [{ type: "blob", path: "only.md" }],
      }),
    ).toThrow(ConnectorError);
    expect(
      listGithubTextPaths({
        truncated: false,
        tree: [
          { type: "blob", path: "b.md" },
          { type: "blob", path: "a.txt" },
          { type: "tree", path: "dir" },
        ],
      }),
    ).toEqual(["a.txt", "b.md"]);
  });

  it("deletes stale documents only after a complete successful list and ingest", () => {
    expect(canDeleteStale({ listComplete: true, ingestComplete: true })).toBe(true);
    expect(canDeleteStale({ listComplete: false, ingestComplete: true })).toBe(false);
    expect(staleDocumentIds(["keep.md", "gone.md"], ["keep.md"])).toEqual(["gone.md"]);
  });
});
