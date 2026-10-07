import { describe, expect, it } from "vitest";

import type { SourcesDocument, SourcesDraft, SourcesResponse } from "@/lib/contracts/sources";

import { filterRows, mapSources } from "./sources-mappers";

const NOW = Date.UTC(2026, 8, 6, 12);

function doc(over: Partial<SourcesDocument> = {}): SourcesDocument {
  return {
    id: "d1",
    title: "Leave Policy",
    fileName: "leave-policy.md",
    department: "hr",
    readers: { kind: "everyone", names: [] },
    chunks: 4,
    updatedAt: NOW,
    status: "active",
    ...over,
  };
}

function draft(over: Partial<SourcesDraft> = {}): SourcesDraft {
  return {
    id: "g-7d19a4e0",
    kind: "upload",
    state: "building",
    embeddedChunks: 41,
    totalChunks: 58,
    documents: 2,
    failedFiles: 1,
    ...over,
  };
}

function response(over: Partial<SourcesResponse> = {}): SourcesResponse {
  return {
    active: { id: "g-c305cf57", promotedAt: NOW, documents: 62, chunks: 787, retrieval: "hybrid" },
    draft: null,
    documents: [doc()],
    ...over,
  };
}

describe("mapSources", () => {
  it("maps the active generation", () => {
    expect(mapSources(response()).active).toEqual({
      id: "g-c305cf57",
      promotedLabel: "6 Sep 2026",
      documents: 62,
      chunks: 787,
      retrieval: "Hybrid",
    });
  });

  it("shows an empty active generation when none is promoted", () => {
    expect(mapSources(response({ active: null })).active).toMatchObject({ id: "None", documents: 0, chunks: 0 });
  });

  it("never exposes the title or file name of a private document", () => {
    const view = mapSources(
      response({ documents: [doc({ title: "Private document", fileName: "", department: null, readers: { kind: "private", names: [] } })] }),
    );
    expect(view.rows[0]).toMatchObject({ title: null, fileName: null, readers: "Private", department: "None" });
  });

  it("labels readers and departments", () => {
    const rows = mapSources(
      response({
        documents: [
          doc({ id: "a", readers: { kind: "departments", names: ["hr", "finance"] } }),
          doc({ id: "b", readers: { kind: "roles", names: ["hr_manager"] }, department: null }),
        ],
      }),
    ).rows;
    expect(rows[0]).toMatchObject({ readers: "HR, Finance", department: "HR" });
    expect(rows[1]).toMatchObject({ readers: "Hr manager", department: "None" });
  });

  it("counts statuses and ignores failed files in the document count", () => {
    const view = mapSources(
      response({
        documents: [doc({ id: "a" }), doc({ id: "b", status: "draft" }), doc({ id: "c", status: "failed", errorMessage: "This file is empty." })],
      }),
    );
    expect(view.counts).toEqual({ all: 3, active: 1, draft: 1, failed: 1 });
    expect(view.documentCount).toBe(2);
    expect(view.rows[2]).toMatchObject({ errorMessage: "This file is empty.", chunks: null });
  });

  it.each([
    ["building", "building"],
    ["checking", "building"],
  ] as const)("maps draft state %s to the building view", (state, expected) => {
    expect(mapSources(response({ draft: draft({ state }) })).draft).toMatchObject({ state: expected, embeddedChunks: 41, totalChunks: 58, failed: 1 });
  });

  it("maps checks passed with the check results", () => {
    const view = mapSources(
      response({
        draft: draft({
          state: "checks_passed",
          totalChunks: 58,
          checks: { reconciled: true, aclLeaks: 0, liveRecall: 0.995, errorCode: null },
        }),
      }),
    );
    expect(view.draft).toEqual({
      state: "checks_passed",
      id: "g-7d19a4e0",
      summary: "2 documents, 58 chunks · reconciled · ACL leaks 0 · live recall 0.995",
    });
  });

  it("explains a failed check from the closed code, never the raw code", () => {
    const view = mapSources(
      response({
        draft: draft({ state: "checks_failed", checks: { reconciled: true, aclLeaks: 2, liveRecall: null, errorCode: "ACL_LEAK" } }),
      }),
    );
    expect(view.draft?.state).toBe("checks_failed");
    expect(view.draft).toMatchObject({ summary: expect.not.stringContaining("ACL_LEAK") });
    expect((view.draft as { summary: string }).summary.length).toBeGreaterThan(10);
  });

  it("falls back to a generic line for an unknown code and for a failed draft", () => {
    const unknown = mapSources(
      response({ draft: draft({ state: "checks_failed", checks: { reconciled: false, aclLeaks: 0, liveRecall: null, errorCode: "WHO_KNOWS" } }) }),
    ).draft as { summary: string };
    expect(unknown.summary).toBe("The checks didn't pass.");
    const failed = mapSources(response({ draft: draft({ state: "failed" }) })).draft;
    expect(failed).toMatchObject({ state: "checks_failed", summary: "The draft couldn't be built." });
  });

  it("maps a paused check", () => {
    const view = mapSources(response({ draft: draft({ state: "checks_paused" }) }));
    expect(view.draft).toMatchObject({ state: "paused", summary: "Checks are paused for today. They resume tomorrow." });
  });
});

describe("filterRows", () => {
  const rows = mapSources(
    response({
      documents: [
        doc({ id: "a", title: "Leave Policy", fileName: "leave-policy.md" }),
        doc({ id: "b", title: "Expenses", fileName: "travel.pdf", status: "draft" }),
        doc({ id: "c", title: "Private document", fileName: "", readers: { kind: "private", names: [] } }),
      ],
    }),
  ).rows;

  it("filters by status and by title or file name, case-insensitively", () => {
    expect(filterRows(rows, "all", "").length).toBe(3);
    expect(filterRows(rows, "draft", "").map((r) => r.id)).toEqual(["b"]);
    expect(filterRows(rows, "all", "LEAVE").map((r) => r.id)).toEqual(["a"]);
    expect(filterRows(rows, "all", "travel").map((r) => r.id)).toEqual(["b"]);
  });

  it("does not match a private document by its hidden title", () => {
    expect(filterRows(rows, "all", "private")).toEqual([]);
  });
});
