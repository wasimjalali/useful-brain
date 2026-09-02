import { fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  buildEvidenceItems,
  ChatWorkspace,
  filterCitedEvidence,
} from "./chat-workspace";
import { EvidenceChunkDialog, EvidenceInspector } from "./evidence-inspector";
import type { GroundedAnswerResponse } from "@/lib/rag/grounded-answer";
import type { ChatTurn } from "@/lib/rag/chat-history";

const answerWithFiveRetrievedAndOneCited: GroundedAnswerResponse = {
  question: "Can customers return opened products?",
  answer: "Opened products may be returned within 30 days. [1]",
  answerModel: "gpt-5.4-mini",
  structuredAnswer: {
    answerType: "grounded",
    paragraphs: [
      {
        text: "Opened products may be returned within 30 days.",
        citations: ["[1]"],
      },
    ],
  },
  retrieval: {
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    results: [
      {
        rank: 1,
        score: 0.91,
        chunkId: "return_policy__chunk_001",
        source: "return_policy.md",
        section: "Opened products",
        text: "Opened products may be returned within 30 days.",
        tokenEstimate: 11,
        citationLabel: "[1]",
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        rank: index + 2,
        score: 0.8 - index * 0.05,
        chunkId: `shipping_policy__chunk_00${index + 2}`,
        source: "shipping_policy.md",
        section: `Shipping cutoff ${index + 1}`,
        text: `Shipping policy detail ${index + 1}.`,
        tokenEstimate: 9,
        citationLabel: `[${index + 2}]`,
      })),
    ],
  },
};

function ChatWorkspaceHarness({
  answer = answerWithFiveRetrievedAndOneCited,
  onSubmit = vi.fn(),
}: {
  answer?: GroundedAnswerResponse;
  onSubmit?: (question: string) => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const evidence = useMemo(() => buildEvidenceItems(answer), [answer]);
  const citedEvidence = useMemo(
    () => filterCitedEvidence(answer, evidence),
    [answer, evidence],
  );
  const turns: ChatTurn[] = [
    {
      id: "turn_1",
      question: answer.question,
      answer,
      error: null,
    },
  ];

  return (
    <>
      <ChatWorkspace
        askDisabled={false}
        canReset
        focusedEvidenceId={focusId}
        onFocusEvidence={(_turnId, evidenceId) => {
          setFocusId(evidenceId);
          setSourcesOpen(true);
        }}
        onNewChat={vi.fn()}
        onOpenSources={() => setSourcesOpen(true)}
        onSubmit={onSubmit}
        pendingQuestion={null}
        ready
        turns={turns}
      />
      {sourcesOpen ? (
        <EvidenceInspector
          citedItems={citedEvidence}
          focusId={focusId}
          onClose={() => setSourcesOpen(false)}
          onOpenChunk={vi.fn()}
          retrievedItems={evidence}
        />
      ) : null}
    </>
  );
}

describe("ChatWorkspace", () => {
  it("copies the grounded answer", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<ChatWorkspaceHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));

    expect(writeText).toHaveBeenCalledWith(
      "Opened products may be returned within 30 days. [1]",
    );
    expect(screen.getByRole("button", { name: "Copied answer" })).toBeInTheDocument();
  });

  it("retries with the assistant turn's original question", () => {
    const onSubmit = vi.fn();
    render(<ChatWorkspaceHarness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry question" }));

    expect(onSubmit).toHaveBeenCalledWith(
      "Can customers return opened products?",
    );
  });

  it("offers recovery for a retryable answer error", () => {
    const onSubmit = vi.fn();
    render(
      <ChatWorkspace
        askDisabled={false}
        canReset
        focusedEvidenceId={null}
        onFocusEvidence={vi.fn()}
        onNewChat={vi.fn()}
        onOpenSources={vi.fn()}
        onSubmit={onSubmit}
        pendingQuestion={null}
        ready
        turns={[
          {
            id: "failed-turn",
            question: "Can I return an opened product?",
            answer: null,
            error: "The model service is temporarily unavailable. Try again.",
            errorRetryable: true,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry answer" }));
    expect(onSubmit).toHaveBeenCalledWith("Can I return an opened product?");
  });

  it("keeps feedback state local to the answer turn", () => {
    render(<ChatWorkspaceHarness />);

    const helpful = screen.getByRole("button", { name: "Mark answer helpful" });
    const unhelpful = screen.getByRole("button", {
      name: "Mark answer unhelpful",
    });
    fireEvent.click(helpful);

    expect(helpful).toHaveAttribute("aria-pressed", "true");
    expect(unhelpful).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(unhelpful);

    expect(helpful).toHaveAttribute("aria-pressed", "false");
    expect(unhelpful).toHaveAttribute("aria-pressed", "true");
  });

  it("shows cited and retrieved evidence separately", () => {
    render(<ChatWorkspaceHarness />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Evidence: 1 cited of 5 retrieved",
      }),
    );

    expect(screen.getByRole("tab", { name: "Cited 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Retrieved 5" }));

    expect(
      screen.getAllByRole("button", { name: /View full chunk/ }),
    ).toHaveLength(5);
  });

  it("opens on the retrieved tab when the focused item is not cited", () => {
    const evidence = buildEvidenceItems(answerWithFiveRetrievedAndOneCited);

    render(
      <EvidenceInspector
        citedItems={filterCitedEvidence(answerWithFiveRetrievedAndOneCited, evidence)}
        focusId={evidence[1].id}
        onClose={vi.fn()}
        onOpenChunk={vi.fn()}
        retrievedItems={evidence}
      />,
    );

    expect(screen.getByRole("tab", { name: "Retrieved 5" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("changes tabs when a new focus token targets a cited item", () => {
    const evidence = buildEvidenceItems(answerWithFiveRetrievedAndOneCited);
    const citedItems = filterCitedEvidence(answerWithFiveRetrievedAndOneCited, evidence);
    const { rerender } = render(
      <EvidenceInspector
        citedItems={citedItems}
        focusId={evidence[1].id}
        focusToken={1}
        onClose={vi.fn()}
        onOpenChunk={vi.fn()}
        retrievedItems={evidence}
      />,
    );

    rerender(
      <EvidenceInspector
        citedItems={citedItems}
        focusId={evidence[0].id}
        focusToken={2}
        onClose={vi.fn()}
        onOpenChunk={vi.fn()}
        retrievedItems={evidence}
      />,
    );

    expect(screen.getByRole("tab", { name: "Cited 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("preserves a manually selected tab until the focus token changes", () => {
    const evidence = buildEvidenceItems(answerWithFiveRetrievedAndOneCited);
    const citedItems = filterCitedEvidence(answerWithFiveRetrievedAndOneCited, evidence);
    const { rerender } = render(
      <EvidenceInspector
        citedItems={citedItems}
        focusId={evidence[0].id}
        focusToken={1}
        onClose={vi.fn()}
        onOpenChunk={vi.fn()}
        retrievedItems={evidence}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Retrieved 5" }));
    rerender(
      <EvidenceInspector
        citedItems={[...citedItems]}
        focusId={evidence[0].id}
        focusToken={1}
        onClose={vi.fn()}
        onOpenChunk={vi.fn()}
        retrievedItems={evidence}
      />,
    );

    expect(screen.getByRole("tab", { name: "Retrieved 5" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("names citation controls with the document and section", () => {
    render(<ChatWorkspaceHarness />);

    const citation = screen.getByRole("button", {
      name: "Open source return_policy.md, Opened products",
    });

    expect(citation).toHaveClass("citation-control");
    expect(citation).toBeInTheDocument();
  });

  it("previews a sample prompt on hover and fills the composer on click", () => {
    const onSubmit = vi.fn();
    render(
      <ChatWorkspace
        askDisabled={false}
        canReset
        focusedEvidenceId={null}
        onFocusEvidence={vi.fn()}
        onNewChat={vi.fn()}
        onOpenSources={vi.fn()}
        onSubmit={onSubmit}
        pendingQuestion={null}
        ready
        turns={[]}
      />,
    );

    const sample = screen.getByRole("button", {
      name: "What is the first-response target for a P1 support ticket?",
    });
    expect(sample).toHaveTextContent("P1 first response");

    fireEvent.mouseEnter(sample);
    expect(screen.getByLabelText("Question")).toHaveValue(
      "What is the first-response target for a P1 support ticket?",
    );
    expect(screen.getByRole("button", { name: "Generate answer" })).toBeDisabled();

    fireEvent.mouseLeave(sample);
    expect(screen.getByLabelText("Question")).toHaveValue("");

    fireEvent.click(sample);
    expect(screen.getByLabelText("Question")).toHaveValue(
      "What is the first-response target for a P1 support ticket?",
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Generate answer" })).toBeEnabled();
  });

  it("keeps the composer compact with a smaller send mark in a 40px hit area", () => {
    render(<ChatWorkspaceHarness />);

    expect(screen.getByLabelText("Question")).toHaveClass("min-h-[40px]");
    expect(screen.getByLabelText("Question")).toHaveClass("composer-scroll");
    const send = screen.getByRole("button", { name: "Generate answer" });
    expect(send).toHaveClass("size-7");
    expect(send.parentElement).toHaveClass("size-10");
  });

  it("uses toggle semantics only for answer feedback", () => {
    render(<ChatWorkspaceHarness />);

    expect(screen.getByRole("button", { name: "Copy answer" })).not.toHaveAttribute(
      "aria-pressed",
    );
    expect(screen.getByRole("button", { name: "Retry question" })).not.toHaveAttribute(
      "aria-pressed",
    );
    expect(
      screen.getByRole("button", { name: "Mark answer helpful" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Mark answer unhelpful" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("highlights a full chunk sentence after normalized evidence matching", () => {
    render(
      <EvidenceChunkDialog
        focusText="  OPENED products may be returned within 30 days. "
        item={buildEvidenceItems(answerWithFiveRetrievedAndOneCited)[0]}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Opened products may be returned within 30 days."),
    ).toHaveClass("evidence-sentence");
  });

  it("falls back to the full chunk when no sentence matches", () => {
    render(
      <EvidenceChunkDialog
        focusText="This sentence is not present in the retrieved chunk."
        item={buildEvidenceItems(answerWithFiveRetrievedAndOneCited)[0]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Opened products may be returned/)).not.toHaveClass(
      "evidence-sentence",
    );
    expect(
      screen.getByText("Opened products may be returned within 30 days."),
    ).toBeInTheDocument();
  });
});
