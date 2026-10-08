import { describe, expect, it } from "vitest";

import type { EvalsAdminView } from "@/lib/contracts/admin-metrics";

import { mapEvals, mapEvalsSummary } from "./mappers";

const view = (over: Partial<EvalsAdminView> = {}): EvalsAdminView => ({
  title: "Northwind",
  model: "@cf/zai-org/glm-5.3-flash",
  questions: 120,
  documents: 65,
  latestKey: "latest",
  runs: [
    { key: "baseline", label: "Baseline", date: "30 Aug", passed: 77, scored: 107, passRate: 0.72, note: "" },
    { key: "latest", label: "Latest", date: "6 Sep 2026", passed: 118, scored: 120, passRate: 0.98, note: "" },
  ],
  categories: [
    { id: "factual", label: "Factual", passed: 69, scored: 70 },
    { id: "multi_hop", label: "Multi-hop", passed: 9, scored: 10 },
  ],
  retrieval: { recallAt3: 0.912, mrr: 0.825, ndcg: 0.83, liveRetrievedRecall: 0.995, aclLeaks: 0 },
  failures: [
    { id: "q093", category: "factual", detail: "", question: "What is ERR-7702?", askedAs: "support_agent", expected: [{ documentId: "doc-a", title: "Doc A Title", section: "Billing" }, { documentId: "doc-b", title: "Doc B Title", section: null }], note: "Exact token." },
  ],
  ...over,
});

describe("mapEvals", () => {
  it("maps runs, categories, metrics and failures", () => {
    const m = mapEvals(view());
    expect(m.subtitle).toBe("120 questions across 2 categories, run against the active generation");
    expect(m.runs[1]).toEqual({ id: "latest", name: "Latest", date: "6 Sep 2026", passed: 118, total: 120 });
    expect(m.categories[0]).toEqual({ id: "factual", name: "Factual", passed: 69, total: 70 });
    expect(m.metrics.map((x) => [x.label, x.value, x.tone])).toEqual([
      ["ACL leaks", "0", "success"],
      ["Live recall", "0.995", undefined],
      ["Recall@3", "0.912", undefined],
      ["MRR", "0.825", undefined],
    ]);
    expect(m.failures[0]).toMatchObject({ category: "Factual", askedAs: "support_agent" });
    expect(m.failures[0].expected[0]).toEqual({ document: "Doc A Title", section: "Billing" });
    expect(m.failures[0].expected[1]).toEqual({ document: "Doc B Title", section: "Whole document" });
    expect(m.failureCount).toBe(1);
  });
  it("never shows leaks as success", () => {
    const m = mapEvals(view({ retrieval: { ...view().retrieval, aclLeaks: 2 } }));
    expect(m.metrics[0]).toMatchObject({ value: "2", tone: undefined });
  });
  it("says five when the campaign has five categories", () => {
    const cats = ["factual", "b", "c", "d", "e"].map((id) => ({ id, label: id, passed: 1, scored: 1 }));
    expect(mapEvals(view({ categories: cats })).subtitle).toContain("across five categories");
  });
  it("fails loud when a failure category is unknown", () => {
    expect(() => mapEvals(view({ failures: [{ ...view().failures[0], category: "nope" }] }))).toThrow();
  });
});

describe("mapEvalsSummary", () => {
  it("takes the latest run and leaks", () => {
    expect(mapEvalsSummary(view())).toEqual({ passed: 118, total: 120, aclLeaks: 0, latestRunLabel: "Latest run 6 Sep 2026" });
  });
  it("fails loud without a latest run", () => {
    expect(() => mapEvalsSummary(view({ latestKey: "x" }))).toThrow();
  });
});
