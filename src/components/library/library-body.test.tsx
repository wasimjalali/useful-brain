// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LibraryBody } from "./library-body";

afterEach(cleanup);

const rows = [
  { id: "d1", title: "Employee Handbook", department: "HR", readers: "Everyone" },
  { id: "d2", title: "On-Call Rotation", department: "Engineering", readers: "Engineering" },
];
const chips = [
  { label: "All", count: 2 },
  { label: "Engineering", count: 1 },
  { label: "HR", count: 1 },
  { label: "Legal", count: 0 },
];

function setup(over: Partial<React.ComponentProps<typeof LibraryBody>> = {}) {
  const props = {
    rows,
    chips,
    department: "All",
    query: "",
    loading: false,
    onQueryChange: vi.fn(),
    onDepartmentChange: vi.fn(),
    onAsk: vi.fn(),
    onRequest: vi.fn(),
    ...over,
  };
  render(<LibraryBody {...props} />);
  return props;
}

describe("LibraryBody", () => {
  it("hides chips with zero count", () => {
    setup();
    expect(screen.queryByRole("button", { name: /Legal/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Engineering/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /^All/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("changes department and asks about a document", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /HR/ }));
    expect(p.onDepartmentChange).toHaveBeenCalledWith("HR");
    fireEvent.click(screen.getAllByRole("button", { name: "Ask about this" })[1]);
    expect(p.onAsk).toHaveBeenCalledWith("d2");
  });

  it("renders 12 skeleton rows while loading", () => {
    setup({ loading: true, rows: [] });
    expect(document.querySelectorAll("[data-skeleton-row]").length).toBe(12);
    expect(screen.queryByText("Employee Handbook")).toBeNull();
  });

  it("shows the no-match state with both actions", () => {
    const p = setup({ rows: [], query: "2027 holiday", chips: [{ label: "All", count: 0 }] });
    expect(screen.getByText("Nothing you can read matches “2027 holiday”")).toBeTruthy();
    expect(screen.getByText("It may not exist yet, or it may be restricted to another team.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Request this document" }));
    expect(p.onRequest).toHaveBeenCalledWith("2027 holiday");
    // the field's own clear icon plus the ghost button
    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" }).at(-1)!);
    expect(p.onQueryChange).toHaveBeenCalledWith("");
    expect(p.onDepartmentChange).toHaveBeenCalledWith("All");
  });
});
