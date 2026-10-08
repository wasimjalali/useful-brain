import { describe, expect, it } from "vitest";

import type { ActivityResponse, ActivityRow, TurnStep } from "@/lib/contracts/admin-metrics";

import { emptyMessage, mapFilters, mapRows, mapTrace } from "./mappers";

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  messageId: "m1", createdAt: Date.UTC(2026, 9, 8, 9, 42), person: "Maya Chen", question: "Q?", outcome: "answered", sources: 3, latencyMs: 3400, ...over,
});

describe("mapRows", () => {
  it("formats time and latency, and keeps missing values as placeholders", () => {
    expect(mapRows([row()])[0]).toEqual({ id: "m1", time: "09:42", person: "Maya Chen", question: "Q?", outcome: "answered", sources: 3, latency: "3.4 s" });
    expect(mapRows([row({ latencyMs: null })])[0].latency).toBe("-");
  });
});

describe("mapFilters", () => {
  it("lists All first with the total, then each outcome with its count", () => {
    const counts: ActivityResponse["counts"] = { answered: 189, no_evidence: 18, approved: 4, denied: 1, error: 2 };
    const f = mapFilters(214, counts);
    expect(f.map((x) => `${x.label} ${x.count}`)).toEqual(["All 214", "Answered 189", "No evidence 18", "Approved 4", "Denied 1", "Error 2"]);
    expect(f[0].value).toBe("all");
  });
});

describe("mapTrace", () => {
  it("names steps, flattens detail and shows durations", () => {
    const steps: TurnStep[] = [
      { seq: 1, step: "tool_call", detail: { tool: "search_knowledge", calls: 2 }, durationMs: 120 },
      { seq: 2, step: "result", detail: {}, durationMs: null },
    ];
    expect(mapTrace(steps)).toEqual([
      { step: "tool call", detail: "tool: search_knowledge · calls: 2", duration: "120 ms" },
      { step: "result", detail: "-", duration: "-" },
    ]);
  });
});

describe("emptyMessage", () => {
  it("phrases the filtered empty state", () => {
    expect(emptyMessage("denied")).toBe("No denied actions this week");
    expect(emptyMessage("error")).toBe("No errors this week");
  });
});
