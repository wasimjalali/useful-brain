// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryDocument } from "@/lib/contracts/library";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const requestDocumentAction = vi.fn();
vi.mock("@/app/library-actions", () => ({
  requestDocumentAction: (question: string) => requestDocumentAction(question),
}));

import { LibraryClient } from "./library-client";

afterEach(() => {
  cleanup();
  push.mockClear();
  requestDocumentAction.mockReset();
});

const everyone = { kind: "everyone" as const, names: [] };
const documents: LibraryDocument[] = [
  { id: "d1", title: "Employee Handbook", department: "HR", readers: everyone, headings: ["Leave"] },
  { id: "d2", title: "On-Call Rotation", department: "Engineering", readers: { kind: "departments", names: ["Engineering"] }, headings: ["Paging"] },
  { id: "d3", title: "Leave Policy", department: "HR", readers: everyone, headings: [] },
];

describe("LibraryClient", () => {
  it("lists the returned documents with counts on the chips", () => {
    render(<LibraryClient documents={documents} />);
    expect(screen.getAllByRole("button", { name: "Ask about this" })).toHaveLength(3);
    expect(screen.getByRole("button", { name: /^All/ })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /^HR/ })).toHaveTextContent("2");
  });

  it("recomputes chip counts from the query and hides zero chips", () => {
    render(<LibraryClient documents={documents} />);
    fireEvent.change(screen.getByLabelText("Search titles and sections"), { target: { value: "paging" } });
    expect(screen.getByRole("button", { name: /^All/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /Engineering/ })).toHaveTextContent("1");
    expect(screen.queryByRole("button", { name: /^HR/ })).toBeNull();
  });

  it("filters rows by department", () => {
    render(<LibraryClient documents={documents} />);
    fireEvent.click(screen.getByRole("button", { name: /^HR/ }));
    expect(screen.getAllByRole("button", { name: "Ask about this" })).toHaveLength(2);
    expect(screen.queryByText("On-Call Rotation")).toBeNull();
  });

  it("requests a missing document once and shows Requested", async () => {
    requestDocumentAction.mockResolvedValue({ ok: true, data: { requested: true } });
    render(<LibraryClient documents={documents} />);
    fireEvent.change(screen.getByLabelText("Search titles and sections"), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing you can read matches “zzz”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request this document" }));
    await waitFor(() => expect(screen.getByText("Requested")).toBeInTheDocument());
    expect(requestDocumentAction).toHaveBeenCalledWith("zzz");
    expect(screen.queryByRole("button", { name: "Request this document" })).toBeNull();
  });

  it("keeps the request button when the request fails", async () => {
    requestDocumentAction.mockResolvedValue({ ok: false, error: { code: "INTERNAL_ERROR", message: "x", retryable: true } });
    render(<LibraryClient documents={documents} />);
    fireEvent.change(screen.getByLabelText("Search titles and sections"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Request this document" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't send the request. Try again."));
    expect(screen.getByRole("button", { name: "Request this document" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" }).at(-1)!);
    expect(screen.getAllByRole("button", { name: "Ask about this" })).toHaveLength(3);
  });

  it("starts a document-scoped chat", () => {
    render(<LibraryClient documents={documents} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Ask about this" })[1]);
    expect(push).toHaveBeenCalledWith("/chat?scope=d2");
  });

  it("renders the loading skeleton", () => {
    render(<LibraryClient documents={[]} loading />);
    expect(screen.getByText("Loading documents")).toBeInTheDocument();
  });
});
