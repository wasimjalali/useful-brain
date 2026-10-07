import { describe, expect, it } from "vitest";

import type { OverviewResponse, HealthRow, UnansweredQuestion } from "@/lib/contracts/admin-metrics";

import { mapHealth, mapKpis, mapUnanswered, rangeSubtitle } from "./mappers";

const totals = (over: Partial<OverviewResponse["current"]> = {}) => ({
  questions: 214,
  grounded: 196,
  groundedPercent: 91.6,
  noEvidence: 18,
  medianLatencyMs: 2400,
  latencySamples: 200,
  ...over,
});
const day = (d: string, over = {}) => ({ day: d, ...totals(), ...over });
const daily = [
  day("2026-10-02"), day("2026-10-03"), day("2026-10-04"), day("2026-10-05"),
  day("2026-10-06"), day("2026-10-07"), day("2026-10-08"),
];
const overview = (current = totals(), previous = totals({ questions: 191, groundedPercent: 90.8, medianLatencyMs: 2600 })): OverviewResponse => ({
  range: "7d", generatedAt: 0, current, previous, daily,
});

describe("rangeSubtitle", () => {
  it("collapses the month when both ends share it", () => {
    expect(rangeSubtitle(daily)).toBe("This week · 2 to 8 Oct 2026");
  });
  it("keeps both months across a month boundary", () => {
    const d = [day("2026-09-28"), day("2026-10-04")];
    expect(rangeSubtitle(d)).toBe("This week · 28 Sep to 4 Oct 2026");
  });
  it("fails loud on empty data", () => {
    expect(() => rangeSubtitle([])).toThrow();
  });
});

describe("mapKpis", () => {
  it("builds four cells with deltas and weekday labels from the data", () => {
    const [q, g, n, m] = mapKpis(overview());
    expect(q).toMatchObject({ label: "Questions this week", value: "214", delta: "+12% on last week", startLabel: "Fri", endLabel: "Thu" });
    expect(g).toMatchObject({ label: "Answered with citations", value: "91.6%", delta: "+0.8 pts" });
    expect(n).toMatchObject({ label: "No evidence", value: "18", delta: "8.4% of questions" });
    expect(m).toMatchObject({ label: "Median answer", value: "2.4 s", delta: "−0.2 s" });
    expect(q.points).toHaveLength(7);
  });
  it("handles a week with no questions or latency", () => {
    const empty = totals({ questions: 0, grounded: 0, groundedPercent: null, noEvidence: 0, medianLatencyMs: null, latencySamples: 0 });
    const [q, g, n, m] = mapKpis(overview(empty, empty));
    expect(q.delta).toBe("No questions last week");
    expect(g).toMatchObject({ value: "-", delta: "No data last week" });
    expect(n.delta).toBe("No questions");
    expect(m).toMatchObject({ value: "-", delta: "No data last week" });
  });
  it("shows no change when the median did not move", () => {
    const [, , , m] = mapKpis(overview(totals(), totals()));
    expect(m.delta).toBe("No change");
  });
  it("drops days without a value from the percent and latency sparklines", () => {
    const o = overview();
    o.daily = o.daily.map((d, i) => (i === 2 ? { ...d, groundedPercent: null, medianLatencyMs: null } : d));
    const [, g, , m] = mapKpis(o);
    expect(g.points).toHaveLength(6);
    expect(m.points).toHaveLength(6);
  });
});

describe("mapUnanswered", () => {
  const now = Date.UTC(2026, 9, 8, 12);
  const q = (over: Partial<UnansweredQuestion> = {}): UnansweredQuestion => ({
    question: "Is there parking?", asks: 3, lastAskedAt: now - 3600_000, requests: 1, likelyDepartment: "HR", ...over,
  });
  it("joins the present parts only", () => {
    expect(mapUnanswered([q()], now)[0].meta).toBe("Last asked today · 1 document request · likely HR");
    expect(mapUnanswered([q({ requests: 0, likelyDepartment: undefined })], now)[0].meta).toBe("Last asked today");
    expect(mapUnanswered([q({ requests: 2, lastAskedAt: now - 3 * 86_400_000 })], now)[0].meta).toBe("Last asked 3 days ago · 2 document requests · likely HR");
    expect(mapUnanswered([q({ lastAskedAt: now - 86_400_000 })], now)[0].meta).toContain("yesterday");
  });
  it("keeps ask counts", () => {
    expect(mapUnanswered([q()], now)[0]).toMatchObject({ question: "Is there parking?", asks: 3 });
  });
});

describe("mapHealth", () => {
  const row = (over: Partial<HealthRow>): HealthRow => ({ service: "brain", status: "ok", detail: "ok", ...over });
  it("maps closed codes to copy", () => {
    const rows = mapHealth([
      row({ service: "vector_index", detail: "synced", generationId: "g-c305cf57" }),
      row({ service: "ai_gateway", detail: "not_in_call_path" }),
      row({ service: "workers_ai", detail: "no_calls_yet" }),
      row({ service: "corpus_db", status: "error", detail: "last_call_failed" }),
      row({ service: "brain", detail: "ok" }),
      row({ service: "vector_index", status: "warning", detail: "drift" }),
    ]);
    expect(rows[0]).toMatchObject({ name: "Vector index", detail: "Synced to g-c305cf57", mono: true });
    expect(rows[1]).toMatchObject({ name: "AI Gateway", detail: "Not in the call path" });
    expect(rows[2].detail).toBe("No calls yet");
    expect(rows[3]).toMatchObject({ name: "Corpus database", status: "error", detail: "Last call failed" });
    expect(rows[4]).toMatchObject({ name: "Brain worker", detail: "Healthy" });
    expect(rows[5].detail).toBe("Out of sync");
    expect(rows[5].mono).toBeFalsy();
  });
});
