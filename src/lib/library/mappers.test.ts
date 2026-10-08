import { describe, expect, it } from "vitest";

import type { LibraryDocument } from "@/lib/contracts/library";

import { buildChips, departmentLabel, filterDocuments, readersLabel, toRows } from "./mappers";

const doc = (over: Partial<LibraryDocument>): LibraryDocument => ({
  id: "d",
  title: "Doc",
  department: "HR",
  readers: { kind: "everyone", names: [] },
  headings: [],
  ...over,
});

const docs = [
  doc({ id: "d1", title: "Employee Handbook", department: "HR", headings: ["Leave", "Conduct"] }),
  doc({ id: "d2", title: "On-Call Rotation", department: "Engineering", headings: ["Paging"] }),
  doc({ id: "d3", title: "Leave Policy", department: "HR" }),
  doc({ id: "d4", title: "Untagged", department: null }),
];

describe("readersLabel", () => {
  it("maps each reader kind", () => {
    expect(readersLabel({ kind: "everyone", names: [] })).toBe("Everyone");
    expect(readersLabel({ kind: "departments", names: ["Support", "Engineering"] })).toBe("Support, Engineering");
    expect(readersLabel({ kind: "roles", names: ["Manager"] })).toBe("Manager");
    expect(readersLabel({ kind: "private", names: [] })).toBe("Only you");
  });
});

describe("filterDocuments", () => {
  it("returns everything for a blank query", () => {
    expect(filterDocuments(docs, "  ")).toHaveLength(4);
  });
  it("matches title and headings case-insensitively", () => {
    expect(filterDocuments(docs, "leave").map((d) => d.id)).toEqual(["d1", "d3"]);
    expect(filterDocuments(docs, "PAGING").map((d) => d.id)).toEqual(["d2"]);
  });
  it("returns nothing when nothing matches", () => {
    expect(filterDocuments(docs, "zzz")).toEqual([]);
  });
});

describe("buildChips", () => {
  it("counts from the given set with All first and zero chips dropped", () => {
    const chips = buildChips(filterDocuments(docs, "leave"));
    expect(chips).toEqual([
      { label: "All", count: 2 },
      { label: "HR", count: 2 },
    ]);
  });
  it("follows the query, not the corpus", () => {
    expect(buildChips(filterDocuments(docs, "paging"))).toEqual([
      { label: "All", count: 1 },
      { label: "Engineering", count: 1 },
    ]);
  });
  it("groups a missing department as General", () => {
    expect(buildChips(docs).map((c) => c.label)).toEqual(["All", "Engineering", "General", "HR"]);
  });
});

describe("toRows", () => {
  it("formats rows and applies the department", () => {
    const rows = toRows(docs, "HR");
    expect(rows.map((r) => r.id)).toEqual(["d1", "d3"]);
    expect(rows[0]).toEqual({ id: "d1", title: "Employee Handbook", department: "HR", readers: "Everyone" });
    expect(toRows(docs, "All")).toHaveLength(4);
  });
});

describe("wire value labels", () => {
  it("formats departments and roles like the Sources page", () => {
    expect(departmentLabel("hr")).toBe("HR");
    expect(departmentLabel("sales")).toBe("Sales");
    expect(readersLabel({ kind: "roles", names: ["hr_manager", "support_manager"] })).toBe("HR managers, Support managers");
    expect(readersLabel({ kind: "departments", names: ["hr", "legal"] })).toBe("HR, Legal");
    expect(toRows([doc({ department: "hr" })], "All")[0].department).toBe("HR");
  });
});
