import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { RagVisibilityDashboard } from "./rag-visibility-dashboard";
import type { GroundedAnswerResponse } from "@/lib/rag/grounded-answer";
import type { Conversation } from "@/lib/rag/chat-history";
import { WorkspaceShell, type WorkspaceView } from "@/components/workspace/workspace-shell";
import { WorkspaceNav } from "@/components/workspace/workspace-nav";
import { Dialog } from "@/components/ui/dialog";
import { StatusLabel } from "@/components/ui/status-label";
import { actionSuccess } from "@/lib/rag/app-errors";

function WorkspaceShellHarness({
  conversations = [],
}: {
  conversations?: Conversation[];
}) {
  const [activeView, setActiveView] = useState<WorkspaceView>("chat");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );

  return (
    <WorkspaceShell
      activeView={activeView}
      navigation={
        <WorkspaceNav
          activeConversationId={activeConversationId}
          activeView={activeView}
          conversations={conversations}
          onSelectConversation={setActiveConversationId}
          onSelectView={setActiveView}
        />
      }
      onSelectView={setActiveView}
    >
      <p>{activeView} content</p>
      <p>{activeConversationId ? `selected ${activeConversationId}` : "no chat selected"}</p>
    </WorkspaceShell>
  );
}

const documents = [
  {
    source: "return_policy.md",
    title: "Return Policy",
    text: "# Return Policy\n\n## Opened Products\nCustomers can return opened products.",
  },
];

const chunks = [
  {
    id: "return_policy__chunk_001",
    source: "return_policy.md",
    section: "Opened Products",
    text: "Customers can return opened products within the policy window.",
    tokenEstimate: 11,
    createdAt: "2026-07-01T00:00:00.000Z",
  },
];

const embeddingStorageStatus = {
  storedDocuments: 10,
  storedChunks: 31,
  embeddedChunks: 30,
  lastRunStatus: "failed",
  lastRunMessage: "1 chunk returned 3 dimensions.",
  lastEmbeddedAt: 1782920000000,
  activeVersionId: "g-active",
  readyVersionId: null,
  corpusStatus: "active",
} as const;

const groundedAnswer: GroundedAnswerResponse = {
  question: "Can customers return opened products?",
  answer:
    "Opened products may be returned within 30 days. [1]\n\nOrders outside the policy window are not eligible. [2]",
  answerModel: "gpt-5.4-mini",
  structuredAnswer: {
    answerType: "grounded",
    paragraphs: [
      {
        text: "Opened products may be returned within 30 days.",
        citations: ["[1]"],
      },
      {
        text: "Orders outside the policy window are not eligible.",
        citations: ["[2]"],
      },
    ],
  },
  retrieval: {
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    results: [
      {
        rank: 1,
        score: 0.81234,
        chunkId: "return_policy__chunk_001",
        source: "return_policy.md",
        section: "Opened Products",
        text: "Customers can return opened products within the policy window.",
        tokenEstimate: 11,
        citationLabel: "[1]",
      },
      {
        rank: 2,
        score: 0.61234,
        chunkId: "return_policy__chunk_002",
        source: "return_policy.md",
        section: "Non-Returnable Orders",
        text: "Orders outside the policy window are not eligible.",
        tokenEstimate: 8,
        citationLabel: "[2]",
      },
    ],
  },
};

const followupAnswer: GroundedAnswerResponse = {
  question: "What about express shipping?",
  answer: "Express orders placed before 2 PM ship the same day. [1]",
  answerModel: "gpt-5.4-mini",
  structuredAnswer: {
    answerType: "grounded",
    paragraphs: [
      {
        text: "Express orders placed before 2 PM ship the same day.",
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
        score: 0.72,
        chunkId: "shipping_policy__chunk_001",
        source: "shipping_policy.md",
        section: "Express",
        text: "Express orders placed before 2 PM ship the same day.",
        tokenEstimate: 9,
        citationLabel: "[1]",
      },
    ],
  },
};

const sameChunkFollowupAnswer: GroundedAnswerResponse = {
  question: "What does the return policy require?",
  answer: "Returns need the original order number. [1]",
  answerModel: "gpt-5.4-mini",
  structuredAnswer: {
    answerType: "grounded",
    paragraphs: [
      {
        text: "Returns need the original order number.",
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
        score: 0.72,
        chunkId: "return_policy__chunk_001",
        source: "return_policy.md",
        section: "Opened Products",
        text: "Opened products may be returned within 30 days.",
        tokenEstimate: 11,
        citationLabel: "[1]",
      },
    ],
  },
};

const insufficientAnswer: GroundedAnswerResponse = {
  question: "Can this cure headaches?",
  answer: "I do not have enough retrieved evidence to answer that question.",
  answerModel: "gpt-5.4-mini",
  structuredAnswer: {
    answerType: "insufficient_evidence",
    paragraphs: [
      {
        text: "I do not have enough retrieved evidence to answer that question.",
        citations: [],
      },
    ],
  },
  retrieval: {
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    results: [],
  },
};

function successfulAnswer(answer: GroundedAnswerResponse) {
  return actionSuccess(answer);
}

const baseProps = {
  chunks,
  documents,
  addDocumentAction: async () => {},
  embedAction: async () => {},
  askAction: async () => successfulAnswer(groundedAnswer),
  embeddingStorageStatus,
  reindexAction: async () => {},
};

// Type a question into the composer and submit it, the way the user does.
function askQuestion(text: string) {
  fireEvent.change(screen.getByLabelText("Question"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate answer" }));
}

describe("RagVisibilityDashboard", () => {
  it("marks the active workspace and changes views", () => {
    render(<WorkspaceShellHarness />);

    expect(screen.getByRole("button", { name: "Chat" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByRole("button", { name: "Knowledge base" }));

    expect(
      screen.getByRole("button", { name: "Knowledge base" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("restores focus to the mobile navigation trigger when the drawer closes", () => {
    render(<WorkspaceShellHarness />);

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));

    expect(trigger).toHaveFocus();
  });

  it("closes the mobile navigation drawer on Escape", () => {
    render(<WorkspaceShellHarness />);

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes the mobile drawer after selecting a saved conversation", () => {
    const savedConversation: Conversation = {
      id: "saved-conversation",
      title: "Saved conversation",
      turns: [],
      createdAt: 1,
      updatedAt: 1,
    };
    render(<WorkspaceShellHarness conversations={[savedConversation]} />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Saved conversation" }),
    );

    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
    expect(screen.getByText("selected saved-conversation")).toBeInTheDocument();
  });

  it("traps focus in the shared dialog and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog ariaLabel="Test dialog" maxWidth="max-w-lg" onClose={onClose}>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </Dialog>,
    );

    const firstAction = screen.getByRole("button", { name: "First action" });
    const lastAction = screen.getByRole("button", { name: "Last action" });
    lastAction.focus();
    fireEvent.keyDown(document, { key: "Tab" });

    expect(firstAction).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps focus on an empty shared dialog when Tab is pressed", () => {
    render(
      <Dialog ariaLabel="Empty dialog" maxWidth="max-w-lg" onClose={vi.fn()}>
        <p>No actions are available.</p>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Empty dialog" });
    const tabEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    document.dispatchEvent(tabEvent);

    expect(tabEvent.defaultPrevented).toBe(true);
    expect(dialog).toHaveFocus();
  });

  it("renders a reusable status label", () => {
    render(<StatusLabel tone="success">Ready</StatusLabel>);

    expect(screen.getByText("Ready")).toHaveClass("text-success");
  });

  it("renders the four operator workspace views", () => {
    render(<RagVisibilityDashboard {...baseProps} />);

    expect(
      screen.getByRole("heading", { name: "Ask a grounded question" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Knowledge base" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Evaluations" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Retrieval" })).toBeNull();
  });

  it("uses the product chat heading", () => {
    render(<RagVisibilityDashboard {...baseProps} />);

    expect(
      screen.getByRole("heading", { name: "Chat" }),
    ).toHaveTextContent("Chat");
    expect(screen.queryByRole("heading", { name: "Support agent" })).toBeNull();
  });

  it("switches between the chat, knowledge and evaluations views", () => {
    render(<RagVisibilityDashboard {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Knowledge base" }));
    expect(
      screen.getByRole("heading", { name: "Knowledge base" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Evaluations" }));
    expect(
      screen.getByRole("heading", { name: "Evaluations" }),
    ).toBeInTheDocument();
  });

  it("shows documents, chunk preview and the re-embed control", () => {
    render(<RagVisibilityDashboard {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Knowledge base" }));
    expect(screen.getAllByText("return_policy.md").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("return_policy__chunk_001")).toBeInTheDocument();
    expect(screen.getAllByText("Opened Products").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Re-index knowledge base" }),
    ).toBeInTheDocument();
  });

  it("offers a file upload alongside paste in the add-document dialog", () => {
    render(<RagVisibilityDashboard {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Knowledge base" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload document" }));

    expect(screen.getByText("Click to upload a file")).toBeInTheDocument();
    // The dialog renders through a portal to document.body, not the container.
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    expect(fileInput?.getAttribute("accept")).toContain(".pdf");
    expect(fileInput?.getAttribute("accept")).toContain(".md");
  });

  it("exposes a live eval runner instead of static passing checks", () => {
    render(<RagVisibilityDashboard {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Evaluations" }));
    expect(screen.getByRole("button", { name: "Run evaluations" })).toBeInTheDocument();
    expect(screen.getByText(/No run yet/)).toBeInTheDocument();
  });

  it("shows a setup state before embeddings are stored", () => {
    render(
      <RagVisibilityDashboard
        {...baseProps}
        embeddingStorageStatus={{
          ...embeddingStorageStatus,
          activeVersionId: null,
          corpusStatus: "ready",
          embeddedChunks: 0,
          readyVersionId: "g-ready",
        }}
      />,
    );

    expect(
      screen.getByText("Chat becomes available after a ready generation is promoted."),
    ).toBeInTheDocument();
  });

  it("shows a grounded answer with cited retrieved evidence", async () => {
    render(
      <RagVisibilityDashboard
        {...baseProps}
        askAction={async () => successfulAnswer(groundedAnswer)}
      />,
    );

    askQuestion("Can customers return opened products?");

    expect(
      await screen.findByText("Opened products may be returned within 30 days."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Orders outside the policy window are not eligible.")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("[1]").length).toBeGreaterThan(0);
    expect(screen.getAllByText("[2]").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Evidence/ }));
    expect(screen.getAllByText("Score 0.812").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Score 0.612").length).toBeGreaterThan(0);
    expect(screen.getAllByText("return_policy.md").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Opened Products").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Customers can return opened products within the policy window.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("keeps conversation context server-owned for follow-up questions", async () => {
    const askAction = vi.fn(async (input: { conversationId: string | null }) =>
      successfulAnswer({
        ...(input.conversationId === null ? groundedAnswer : followupAnswer),
        conversationId: "conversation-1",
      }),
    );

    render(<RagVisibilityDashboard {...baseProps} askAction={askAction} />);

    askQuestion("Can customers return opened products?");
    await screen.findByText("Opened products may be returned within 30 days.");

    askQuestion("What about express shipping?");
    await screen.findByText(
      "Express orders placed before 2 PM ship the same day.",
    );

    // Both turns stay on screen, while the browser sends only the backend ID.
    expect(
      screen.getByText("Opened products may be returned within 30 days."),
    ).toBeInTheDocument();
    expect(askAction).toHaveBeenCalledTimes(2);
    const secondCall = askAction.mock.calls[1][0] as {
      question: string;
      conversationId: string | null;
      requestId: string;
    };
    expect(secondCall.conversationId).toBe("conversation-1");
    expect(secondCall.requestId).toEqual(expect.any(String));
    expect(secondCall).not.toHaveProperty("history");
  });

  it("clears provenance focus when generic sources open for another turn", async () => {
    const askAction = vi.fn(async (input: { conversationId: string | null }) =>
      successfulAnswer({
        ...(input.conversationId === null
          ? groundedAnswer
          : sameChunkFollowupAnswer),
        conversationId: "conversation-1",
      }),
    );

    render(<RagVisibilityDashboard {...baseProps} askAction={askAction} />);

    askQuestion("Can customers return opened products?");
    await screen.findByText("Opened products may be returned within 30 days.");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open source return_policy.md, Opened Products",
      }),
    );

    askQuestion("What does the return policy require?");
    await screen.findByText("Returns need the original order number.");

    const sourceTriggers = screen.getAllByRole("button", {
      name: "Evidence: 1 cited of 1 retrieved",
    });
    fireEvent.click(sourceTriggers[sourceTriggers.length - 1]);
    fireEvent.click(
      screen.getByRole("button", {
        name: "View full chunk: return_policy.md, Opened Products",
      }),
    );

    expect(document.querySelector("mark.evidence-sentence")).toBeNull();
  });

  it("clears the transcript when a new chat is started", async () => {
    render(
      <RagVisibilityDashboard
        {...baseProps}
        askAction={async () => successfulAnswer(groundedAnswer)}
      />,
    );

    askQuestion("Can customers return opened products?");
    await screen.findByText("Opened products may be returned within 30 days.");

    fireEvent.click(screen.getAllByRole("button", { name: "New chat" })[0]);

    expect(
      screen.getByRole("heading", { name: "Ask a grounded question" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Opened products may be returned within 30 days."),
    ).toBeNull();
  });

  it("shows an insufficient-evidence answer without paragraph citations", async () => {
    render(
      <RagVisibilityDashboard
        {...baseProps}
        askAction={async () => successfulAnswer(insufficientAnswer)}
      />,
    );

    askQuestion("Can this cure headaches?");

    expect(
      await screen.findByText(
        "I do not have enough retrieved evidence to answer that question.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("insufficient evidence")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Evidence/ })).toBeNull();
  });

  it("shows an answer error state", async () => {
    render(
      <RagVisibilityDashboard
        {...baseProps}
        askAction={async () => ({
          ok: false,
          error: {
            code: "PROVIDER_TEMPORARY",
            message: "The model service is temporarily unavailable. Try again.",
            retryable: true,
          },
        })}
      />,
    );

    askQuestion("Can customers return opened products?");

    expect(
      await screen.findByText(
        "The model service is temporarily unavailable. Try again.",
      ),
    ).toBeInTheDocument();
  });
});
