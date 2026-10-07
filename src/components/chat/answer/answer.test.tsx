import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalView } from "@/lib/contracts/chat-view";

import { CitationLinkProvider } from "../evidence/citation-link";
import { AnswerActions } from "./answer-actions";
import { AnswerText } from "./answer-text";
import { ApprovalCard } from "./approval-card";
import { EmptyState } from "./empty-state";
import { ErrorAlert } from "./error-alert";
import { NoEvidence } from "./no-evidence";
import { RestrictedNote } from "./restricted-note";
import { SourcesRow } from "./sources-row";
import { StatusLine } from "./status-line";
import { UserBubble } from "./user-bubble";
import { ViewAsBanner } from "./view-as-banner";

describe("AnswerText", () => {
  it("places chips at validated [n] markers and drops unvalidated ones", () => {
    render(
      <CitationLinkProvider>
        <AnswerText paragraphs={[{ text: "Sixteen weeks [1]. Six months [2]. Bogus [9].", citations: [1, 2] }]} />
      </CitationLinkProvider>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Citation 9" })).not.toBeInTheDocument();
    expect(screen.queryByText(/\[9\]/)).not.toBeInTheDocument();
    expect(screen.getByText(/Bogus/)).toBeInTheDocument();
  });

  it("falls back to chips at the paragraph end when the text has no valid markers", () => {
    const { container } = render(
      <CitationLinkProvider>
        <AnswerText paragraphs={[{ text: "No markers here.", citations: [3, 1] }]} />
      </CitationLinkProvider>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Citation 3", "Citation 1"]);
    const p = container.querySelector("p")!;
    expect(p.lastElementChild).toBe(buttons[1]);
  });

  it("renders one paragraph per entry and mutes partial text", () => {
    const { container } = render(
      <CitationLinkProvider>
        <AnswerText muted paragraphs={[{ text: "A", citations: [] }, { text: "B", citations: [] }]} />
      </CitationLinkProvider>,
    );
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector("p")).toHaveClass("text-ink-muted");
  });
});

describe("chat states copy", () => {
  it("EmptyState shows heading, subline, composer slot and 4 suggestions", () => {
    const onPick = vi.fn();
    render(
      <EmptyState
        composer={<div>composer-slot</div>}
        onPick={onPick}
        suggestions={[
          { question: "How long are system logs kept?", department: "Engineering" },
          { question: "Q2", department: "HR" },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Ask about Northwind" })).toBeInTheDocument();
    expect(screen.getByText("Every answer cites the documents you can read.")).toBeInTheDocument();
    expect(screen.getByText("composer-slot")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /How long are system logs kept/ }));
    expect(onPick).toHaveBeenCalledWith("How long are system logs kept?");
    expect(screen.getByText("Engineering")).toBeInTheDocument();
  });

  it("UserBubble renders the message", () => {
    render(<UserBubble>Hello there</UserBubble>);
    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });

  it("NoEvidence: request flow ends in a disabled Requested pill and note", () => {
    const onRequest = vi.fn();
    const { rerender } = render(
      <NoEvidence documentsSearched={34} latencyMs={1400} onRequest={onRequest} requested={false} />,
    );
    expect(screen.getByText("I couldn't find this in the documents you can read, so I won't guess.")).toBeInTheDocument();
    expect(screen.getByText("Searched 34 documents · 1.4 s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request this document" }));
    expect(onRequest).toHaveBeenCalledTimes(1);
    rerender(<NoEvidence documentsSearched={34} latencyMs={1400} onRequest={onRequest} requested />);
    expect(screen.queryByRole("button", { name: "Request this document" })).not.toBeInTheDocument();
    expect(screen.getByText("Requested")).toBeInTheDocument();
    expect(screen.getByText("Admins see it under Unanswered questions.")).toBeInTheDocument();
  });

  it("ErrorAlert is an alert with exact copy, muted partial text and Retry", () => {
    const onRetry = vi.fn();
    render(<ErrorAlert onRetry={onRetry} partialText="You get sixteen" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The answer stopped before it finished. Your question is saved.",
    );
    expect(screen.getByText("You get sixteen")).toHaveClass("text-ink-muted");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("ViewAsBanner and RestrictedNote render exact copy", () => {
    const onExit = vi.fn();
    render(
      <>
        <ViewAsBanner department="Support" documentCount={34} name="Priya Shah" onExit={onExit} />
        <RestrictedNote readers="HR" title="Salary Bands" />
      </>,
    );
    expect(screen.getByText("Viewing as Priya Shah", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Support · 34 documents/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(onExit).toHaveBeenCalled();
    expect(screen.getByText("Only you see this: Salary Bands exists, but only HR can read it.")).toBeInTheDocument();
  });
});

describe("SourcesRow and AnswerActions", () => {
  it("SourcesRow renders document and section in one non-wrapping button", () => {
    render(
      <CitationLinkProvider>
        <SourcesRow sources={[{ n: 1, document: "Parental Leave Policy", section: "Paid Leave Duration" }]} />
      </CitationLinkProvider>,
    );
    const btn = screen.getByRole("button", { name: /Source 1/ });
    expect(btn).toHaveTextContent("Parental Leave Policy");
    expect(btn).toHaveTextContent("Paid Leave Duration");
    expect(btn).toHaveClass("whitespace-nowrap");
  });

  it("AnswerActions: meta, feedback pressed state and callbacks", () => {
    const [onCopy, onRetry, onFeedback] = [vi.fn(), vi.fn(), vi.fn()];
    const { rerender } = render(
      <AnswerActions feedback={null} latencyMs={2100} onCopy={onCopy} onFeedback={onFeedback} onRetry={onRetry} passages={8} />,
    );
    expect(screen.getByText("8 passages · 2.1 s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    expect(onCopy).toHaveBeenCalled();
    expect(onRetry).toHaveBeenCalled();
    expect(onFeedback).toHaveBeenCalledWith("up");
    expect(screen.getByRole("button", { name: "Good" })).toHaveAttribute("aria-pressed", "false");
    rerender(
      <AnswerActions feedback="down" latencyMs={2100} onCopy={onCopy} onFeedback={onFeedback} onRetry={onRetry} passages={8} />,
    );
    expect(screen.getByRole("button", { name: "Bad" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Bad" }));
    expect(onFeedback).toHaveBeenLastCalledWith(null);
  });
});

describe("ApprovalCard", () => {
  const pending: ApprovalView = {
    status: "pending",
    tool: "create_ticket",
    args: [
      ["desk", "Support"],
      ["priority", "P1"],
    ],
  };

  it("pending shows tool, arguments, lock note and calls approve and deny", () => {
    const [onApprove, onDeny] = [vi.fn(), vi.fn()];
    render(<ApprovalCard approval={pending} onApprove={onApprove} onDeny={onDeny} />);
    expect(screen.getByText("Needs your approval")).toBeInTheDocument();
    expect(screen.getByText("create_ticket")).toBeInTheDocument();
    expect(screen.getByText("priority")).toBeInTheDocument();
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByText("Approves these exact arguments only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve and run" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onApprove).toHaveBeenCalled();
    expect(onDeny).toHaveBeenCalled();
  });

  it("busy disables both actions", () => {
    render(<ApprovalCard approval={pending} busy onApprove={() => {}} onDeny={() => {}} />);
    expect(screen.getByRole("button", { name: "Approve and run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
  });

  it("done, denied and expired render exact copy", () => {
    const onOpenTicket = vi.fn();
    const { rerender } = render(
      <ApprovalCard
        approval={{ status: "done", ticketId: "SUP-4821", meta: "create_ticket · P1 · 09:42" }}
        onOpenTicket={onOpenTicket}
      />,
    );
    expect(screen.getByText("Ticket SUP-4821 created")).toBeInTheDocument();
    expect(screen.getByText("create_ticket · P1 · 09:42")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open ticket/ }));
    expect(onOpenTicket).toHaveBeenCalled();
    rerender(<ApprovalCard approval={{ status: "denied" }} />);
    expect(screen.getByText("Denied. Nothing was run.")).toBeInTheDocument();
    rerender(<ApprovalCard approval={{ status: "expired" }} />);
    expect(screen.getByText("This approval expired. Ask again to get a fresh one.")).toBeInTheDocument();
  });
});

describe("StatusLine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is a polite status region with the first label", () => {
    render(<StatusLine progress={{ kind: "searching", readableDocuments: 34 }} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Searching 34 documents");
  });

  it("uses singular nouns for one", () => {
    render(<StatusLine progress={{ kind: "reading", passages: 1 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading 1 passage");
  });

  it("holds each label at least 260 ms before the next one", () => {
    const { rerender } = render(<StatusLine progress={{ kind: "searching", readableDocuments: 34 }} />);
    act(() => void vi.advanceTimersByTime(100));
    rerender(<StatusLine progress={{ kind: "reading", passages: 8 }} />);
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByRole("status")).toHaveTextContent("Searching 34 documents");
    act(() => void vi.advanceTimersByTime(60));
    expect(screen.getByRole("status")).toHaveTextContent("Reading 8 passages");
    rerender(<StatusLine progress={{ kind: "writing" }} />);
    act(() => void vi.advanceTimersByTime(259));
    expect(screen.getByRole("status")).toHaveTextContent("Reading 8 passages");
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("Writing a cited answer");
  });

  it("skips a label that was replaced while waiting (latest wins, order kept)", () => {
    const { rerender } = render(<StatusLine progress={{ kind: "searching", readableDocuments: 34 }} />);
    rerender(<StatusLine progress={{ kind: "reading", passages: 8 }} />);
    rerender(<StatusLine progress={{ kind: "writing" }} />);
    act(() => void vi.advanceTimersByTime(260));
    expect(screen.getByRole("status")).toHaveTextContent("Writing a cited answer");
  });

  it("shows a later label immediately when the current one has been held long enough", () => {
    const { rerender } = render(<StatusLine progress={{ kind: "searching", readableDocuments: 34 }} />);
    act(() => void vi.advanceTimersByTime(1000));
    rerender(<StatusLine progress={{ kind: "reading", passages: 8 }} />);
    act(() => void vi.advanceTimersByTime(0));
    expect(screen.getByRole("status")).toHaveTextContent("Reading 8 passages");
  });
});
