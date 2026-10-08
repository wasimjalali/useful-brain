import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  pathname: "/chat",
  search: "",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  useParams: () => ({}),
}));

import { AppShell } from "@/components/shell/app-shell";
import { admin, clearViewport, member, setViewport } from "@/components/shell/test-support";
import type { ApprovalView as ApprovalRecord } from "@/lib/contracts/approvals";
import type { DocumentResponse } from "@/lib/contracts/library";
import { actionFailure, actionSuccess, AppError } from "@/lib/rag/app-errors";
import type { GroundedAnswerResponse } from "@/lib/rag/grounded-answer";
import { emptyEmbeddingStorageStatus } from "@/lib/rag/storage-records";

import { ChatSession, type ChatActions } from "./chat-view";
import type { ChatTurnState } from "./turn-model";
import type { AskAction, CancelAction } from "./use-chat-turn";

function result(rank: number, label: string, title: string, section: string, text: string, documentId: string) {
  return {
    rank,
    score: 0.9,
    chunkId: `chunk_${rank}`,
    source: `${documentId}.md`,
    section,
    text,
    tokenEstimate: 10,
    citationLabel: label,
    documentId,
    documentTitle: title,
    keywordScore: 0.868,
    vectorScore: 0.84,
    rerankScore: 0.991,
  };
}

function answerFor(
  text: string,
  overrides: Partial<GroundedAnswerResponse> = {},
): GroundedAnswerResponse {
  return {
    question: "q",
    answer: text,
    answerModel: "model",
    structuredAnswer: {
      answerType: "grounded",
      paragraphs: [
        { text: `${text} [1]. Eligible after six months [2].`, citations: ["[1]", "[2]"] },
      ],
    },
    retrieval: {
      embeddingModel: "embed",
      embeddingDimensions: 1024,
      results: [
        result(1, "[1]", "Parental Leave Policy", "Paid Leave Duration", "Eligible employees receive sixteen weeks of fully paid leave.", "nw_hr_parental_leave"),
        result(2, "[2]", "Employee Handbook", "Eligibility", "Eligibility starts after six months of service.", "nw_hr_handbook"),
        result(3, "[3]", "Travel Policy", "Booking", "Book flights through the portal.", "nw_travel"),
      ],
    },
    conversationId: "conversation-1",
    assistantMessageId: "msg-1",
    corpusGenerationId: "g-c305cf57",
    ...overrides,
  };
}

const grounded = answerFor("You get sixteen weeks of paid leave");

const refusal: GroundedAnswerResponse = {
  ...grounded,
  assistantMessageId: "msg-refusal",
  answer: "I do not have enough retrieved evidence.",
  structuredAnswer: {
    answerType: "insufficient_evidence",
    paragraphs: [{ text: "I do not have enough retrieved evidence.", citations: [] }],
  },
  retrieval: { embeddingModel: "embed", embeddingDimensions: 1024, results: [] },
};

function stored(
  id: string,
  question: string,
  answer: GroundedAnswerResponse | null,
  extra: Partial<ChatTurnState> = {},
): ChatTurnState {
  return {
    id,
    question,
    answer,
    error: null,
    answerType: answer ? answer.structuredAnswer.answerType : null,
    latencyMs: 2100,
    passagesRetrieved: 8,
    feedback: null,
    documentRequested: false,
    ...extra,
  };
}

const document: DocumentResponse = {
  id: "nw_hr_parental_leave",
  title: "Parental Leave Policy",
  version: "2.0",
  effectiveDate: "2026-02-01",
  ownerDepartment: "HR",
  readers: { kind: "everyone", names: [] },
  sections: [{ heading: "Paid Leave Duration", text: "Eligible employees receive sixteen weeks of fully paid leave." }],
  spans: [{ section: 0, start: 0, end: 61, citation: "[1]", active: true }],
};

function makeActions(overrides: Partial<ChatActions> = {}): ChatActions {
  return {
    setFeedback: vi.fn(async () => actionSuccess(null)),
    requestDocument: vi.fn(async () => actionSuccess(null)),
    loadDocument: vi.fn(async () => actionSuccess(document)),
    loadConversation: vi.fn(async () => actionFailure(new AppError("INTERNAL_ERROR", "x", true))),
    startApproval: vi.fn(async () =>
      actionSuccess({ workflowId: "wf1", binding: { tool: "create_ticket" } as never }),
    ),
    decideApproval: vi.fn(async () => actionSuccess(null)),
    ...overrides,
  };
}

type RenderOptions = {
  askAction?: AskAction;
  cancelAction?: CancelAction;
  actions?: ChatActions;
  initialTurns?: ChatTurnState[];
  retrievalReady?: boolean;
  identity?: typeof member;
  suggestions?: Array<{ question: string; department: string }>;
  scopeDocumentId?: string | null;
};

function renderChat(options: RenderOptions = {}) {
  const actions = options.actions ?? makeActions();
  const tree = () => (
    <AppShell
      deleteConversationAction={async () => actionSuccess(null)}
      embeddingStorageStatus={emptyEmbeddingStorageStatus}
      identity={options.identity ?? member}
      initialConversations={[]}
      retrievalMode="keyword"
      retrievalReady={options.retrievalReady ?? true}
    >
      <ChatSession
        actions={actions}
        askAction={options.askAction ?? (async () => actionSuccess(grounded))}
        cancelAction={options.cancelAction}
        initialConversation={
          options.initialTurns
            ? { id: "conversation-1", title: "Saved chat", turns: options.initialTurns }
            : null
        }
        scopeDocumentId={options.scopeDocumentId}
        suggestions={options.suggestions}
      />
    </AppShell>
  );
  const view = render(tree());
  return { ...view, actions, rerenderChat: () => view.rerender(tree()) };
}

function askQuestion(text: string) {
  fireEvent.change(screen.getByLabelText("Question"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

function panel(): HTMLElement {
  return document_.querySelector(".ub-panel") as HTMLElement;
}
const document_ = globalThis.document;

let replaceState: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  nav.pathname = "/chat";
  nav.search = "";
  nav.push.mockClear();
  nav.replace.mockClear();
  clearViewport();
  window.history.replaceState(null, "", "/chat");
  replaceState = vi.spyOn(window.history, "replaceState");
});

afterEach(() => {
  replaceState.mockRestore();
  clearViewport();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("empty chat", () => {
  it("shows the heading, the composer and the asker's suggestions", () => {
    renderChat({
      suggestions: [
        { question: "How long are system logs kept?", department: "Engineering" },
        { question: "What is the first-response target for a P1 ticket?", department: "Support" },
      ],
    });
    expect(screen.getByRole("heading", { name: "Ask about Northwind" })).toBeInTheDocument();
    expect(screen.getByText("Every answer cites the documents you can read.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask a question")).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /How long are system logs kept/ }));
    expect(screen.getByLabelText("Question")).toHaveValue("How long are system logs kept?");
  });

  it("shows no suggestion rows when there are none", () => {
    renderChat({ suggestions: [] });
    expect(screen.queryByRole("list")).toBeEmptyDOMElement();
  });

  it("shows a setup state when an admin's corpus has no active generation", () => {
    renderChat({ retrievalReady: false, identity: admin });
    expect(screen.getByText("Chat becomes available after a ready generation is promoted.")).toBeInTheDocument();
  });

  it("sends the Library scope on the first turn only", async () => {
    const askAction = vi.fn<AskAction>(async () => actionSuccess(grounded));
    renderChat({ askAction, scopeDocumentId: "nw_hr_parental_leave" });
    askQuestion("one");
    await screen.findByText(/You get sixteen weeks/);
    askQuestion("two");
    await screen.findAllByText(/You get sixteen weeks/);
    expect(askAction.mock.calls[0][0].scopeDocumentId).toBe("nw_hr_parental_leave");
    expect(askAction.mock.calls[1][0]).not.toHaveProperty("scopeDocumentId");
  });
});

describe("answer", () => {
  it("numbers chips from the validated citations and lists only cited sources", async () => {
    renderChat();
    askQuestion("How much parental leave do I get?");
    await screen.findByText(/You get sixteen weeks/);

    expect(screen.getByRole("button", { name: "Citation 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Citation 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Citation 3" })).toBeNull();
    expect(screen.getByRole("button", { name: "Source 1: Parental Leave Policy, Paid Leave Duration" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Source 3/ })).toBeNull();
    expect(screen.getByPlaceholderText("Ask a follow-up")).toBeInTheDocument();
  });

  it("moves the URL without a router push and lists the chat in the rail", async () => {
    renderChat();
    askQuestion("How much parental leave do I get?");
    await screen.findByText(/You get sixteen weeks/);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/chat/conversation-1");
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "How much parental leave do I get?" })).toHaveAttribute(
      "href",
      "/chat/conversation-1",
    );
  });

  it("shows the stored meta once the stored turn is read back", async () => {
    const actions = makeActions({
      loadConversation: vi.fn(async () =>
        actionSuccess({
          id: "conversation-1",
          title: "t",
          createdAt: 0,
          updatedAt: 0,
          turns: [stored("msg-1", "q", grounded, { latencyMs: 2100, passagesRetrieved: 8 }) as never],
        }),
      ),
    });
    renderChat({ actions });
    askQuestion("How much parental leave do I get?");
    expect(await screen.findByText("8 passages · 2.1 s")).toBeInTheDocument();
  });

  it("renders the host action note as plain text without a chip or a source", async () => {
    const withNote = answerFor("That fits P1", {
      structuredAnswer: {
        answerType: "grounded",
        paragraphs: [
          { text: "That fits P1 [1].", citations: ["[1]"] },
          { text: "I've prepared the ticket for the Support desk.", citations: [], kind: "action_note" } as never,
        ],
      },
    });
    renderChat({ askAction: async () => actionSuccess(withNote) });
    askQuestion("Open a P1 ticket");
    expect(await screen.findByText("I've prepared the ticket for the Support desk.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Citation/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Source/ })).toHaveLength(1);
  });

  it("keeps the transcript, then clears it on New chat even though the URL stays /chat", async () => {
    renderChat();
    askQuestion("one");
    await screen.findByText(/You get sixteen weeks/);
    fireEvent.click(screen.getAllByRole("link", { name: /New chat/ })[0]);
    expect(screen.getByRole("heading", { name: "Ask about Northwind" })).toBeInTheDocument();
    expect(screen.queryByText(/You get sixteen weeks/)).toBeNull();
  });

  it("keeps an in-flight answer out of the next chat", async () => {
    let resolveAsk: (value: Awaited<ReturnType<AskAction>>) => void = () => {};
    const askAction = vi.fn<AskAction>(() => new Promise((resolve) => { resolveAsk = resolve; }));
    renderChat({ askAction });
    askQuestion("one");
    fireEvent.click(screen.getAllByRole("link", { name: /New chat/ })[0]);
    await act(async () => {
      resolveAsk(actionSuccess(grounded));
    });
    expect(screen.queryByText(/You get sixteen weeks/)).toBeNull();
    expect(replaceState).not.toHaveBeenCalledWith(null, "", "/chat/conversation-1");
  });
});

describe("working state", () => {
  it("starts at the asker's readable count and follows the reported progress", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ stage: "reading", passages: 8 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderChat({ askAction: () => new Promise(() => undefined) });
    askQuestion("How much parental leave do I get?");
    expect(screen.getByRole("status")).toHaveTextContent("Searching 34 documents");
    await act(async () => {});
    await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Reading 8 passages"));
  });

  it("turns Send into Stop and cancels by request id, then offers a retry", async () => {
    const askAction = vi.fn<AskAction>(() => new Promise(() => undefined));
    const cancelAction = vi.fn<CancelAction>(async () => actionSuccess({ conversationId: "conversation-cancelled" }));
    renderChat({ askAction, cancelAction });
    askQuestion("one");
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The answer stopped before it finished. Your question is saved.",
    );
    expect(cancelAction).toHaveBeenCalledWith(expect.any(String));
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("error and retry", () => {
  it("shows the error alert and re-runs a stored failed turn through retryOfMessageId", async () => {
    const askAction = vi.fn<AskAction>(async () => actionSuccess(grounded));
    renderChat({
      askAction,
      initialTurns: [stored("msg-failed", "How much parental leave do I get?", null, { error: "x", answerType: null })],
    });
    expect(screen.getByRole("alert")).toHaveTextContent("The answer stopped before it finished. Your question is saved.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText(/You get sixteen weeks/);
    expect(askAction).toHaveBeenCalledWith(
      expect.objectContaining({ retryOfMessageId: "msg-failed", conversationId: "conversation-1" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    // The retry took the failed turn's place: one answer, not two turns.
    expect(screen.getAllByRole("button", { name: "Good" })).toHaveLength(1);
  });

  it("retries a live failure through the stored message id", async () => {
    const askAction = vi
      .fn<AskAction>()
      .mockResolvedValueOnce(actionSuccess(grounded))
      .mockResolvedValueOnce({ ok: false, error: { code: "PROVIDER_TEMPORARY", message: "down", retryable: true } })
      .mockResolvedValueOnce(actionSuccess(answerFor("Second try works")));
    const actions = makeActions({
      loadConversation: vi.fn(async () =>
        actionSuccess({
          id: "conversation-1",
          title: "t",
          createdAt: 0,
          updatedAt: 0,
          turns: [stored("msg-live-failed", "two", null, { error: "x", answerType: null }) as never],
        }),
      ),
    });
    renderChat({ askAction, actions });
    askQuestion("one");
    await screen.findByText(/You get sixteen weeks/);
    askQuestion("two");
    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findByText(/Second try works/);
    expect(askAction).toHaveBeenLastCalledWith(expect.objectContaining({ retryOfMessageId: "msg-live-failed" }));
  });
});

describe("feedback", () => {
  it("saves, reads back and clears the person's feedback", async () => {
    const actions = makeActions();
    renderChat({ actions });
    askQuestion("one");
    await screen.findByText(/You get sixteen weeks/);

    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    expect(actions.setFeedback).toHaveBeenLastCalledWith("msg-1", "up");
    expect(screen.getByRole("button", { name: "Good" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    expect(actions.setFeedback).toHaveBeenLastCalledWith("msg-1", null);
    expect(screen.getByRole("button", { name: "Good" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Bad" }));
    expect(actions.setFeedback).toHaveBeenLastCalledWith("msg-1", "down");
  });

  it("shows feedback saved earlier when a conversation reloads", () => {
    renderChat({ initialTurns: [stored("msg-1", "q", grounded, { feedback: "down" })] });
    expect(screen.getByRole("button", { name: "Bad" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Good" })).toHaveAttribute("aria-pressed", "false");
  });

  it("puts the button back and says so when saving fails", async () => {
    const actions = makeActions({
      setFeedback: vi.fn(async () => actionFailure(new AppError("INTERNAL_ERROR", "x", true))),
    });
    renderChat({ actions, initialTurns: [stored("msg-1", "q", grounded)] });
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your feedback could not be saved.");
    expect(screen.getByRole("button", { name: "Good" })).toHaveAttribute("aria-pressed", "false");
  });

  it("asks an answered question again as a new turn from Retry", async () => {
    const askAction = vi.fn<AskAction>(async () => actionSuccess(grounded));
    renderChat({ askAction, initialTurns: [stored("msg-1", "q", grounded)] });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await vi.waitFor(() => expect(askAction).toHaveBeenCalled());
    expect(askAction.mock.calls[0][0]).not.toHaveProperty("retryOfMessageId");
    expect(askAction.mock.calls[0][0].question).toBe("q");
  });
});

describe("no evidence", () => {
  const refusalTurn = stored("msg-refusal", "When is the 2027 holiday calendar published?", refusal, {
    answerType: "insufficient_evidence",
    latencyMs: 1400,
  });

  it("refuses without guessing and shows how many documents were searched", () => {
    renderChat({ initialTurns: [refusalTurn] });
    expect(screen.getByText(/I couldn't find this in the documents you can read, so I won't guess\./)).toBeInTheDocument();
    expect(screen.getByText("Searched 34 documents · 1.4 s")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Evidence" })).toBeNull();
  });

  it("requests the document once and ends in a disabled Requested state", async () => {
    const actions = makeActions();
    renderChat({ actions, initialTurns: [refusalTurn] });
    fireEvent.click(screen.getByRole("button", { name: "Request this document" }));
    await screen.findByText("Requested");
    expect(actions.requestDocument).toHaveBeenCalledWith("msg-refusal");
    expect(screen.getByText("Admins see it under Unanswered questions.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request this document" })).toBeNull();
  });

  it("shows an already requested document as Requested after a reload", () => {
    renderChat({ initialTurns: [{ ...refusalTurn, documentRequested: true }] });
    expect(screen.getByText("Requested")).toBeInTheDocument();
  });

  it("keeps the button and says so when the request fails", async () => {
    const actions = makeActions({
      requestDocument: vi.fn(async () => actionFailure(new AppError("INTERNAL_ERROR", "x", true))),
    });
    renderChat({ actions, initialTurns: [refusalTurn] });
    fireEvent.click(screen.getByRole("button", { name: "Request this document" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The request could not be sent.");
    expect(screen.getByRole("button", { name: "Request this document" })).toBeInTheDocument();
  });
});

describe("evidence panel", () => {
  const turn = () => stored("msg-1", "How much parental leave do I get?", grounded);

  it("opens Cited and Retrieved tabs from the stored snapshot and keeps the state in the URL", () => {
    renderChat({ initialTurns: [turn()] });
    expect(panel()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    expect(panel()).toHaveTextContent("Parental Leave Policy");
    expect(within(panel()).getByRole("tab", { name: /Cited/ })).toHaveTextContent("2");
    expect(within(panel()).getByRole("tab", { name: /Retrieved/ })).toHaveTextContent("3");
    expect(window.location.search).toBe("?evidence=cited");

    fireEvent.click(within(panel()).getByRole("tab", { name: /Retrieved/ }));
    expect(window.location.search).toBe("?evidence=retrieved");
    expect(panel()).toHaveTextContent("Travel Policy");

    fireEvent.click(within(panel()).getByRole("button", { name: "Close evidence" }));
    expect(panel()).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("reopens on the tab the URL names", () => {
    nav.search = "evidence=retrieved";
    renderChat({ initialTurns: [turn()] });
    expect(within(panel()).getByRole("tab", { name: /Retrieved/ })).toHaveAttribute("aria-selected", "true");
  });

  it("links a hovered chip to its passage", () => {
    renderChat({ initialTurns: [turn()] });
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    fireEvent.mouseEnter(screen.getAllByRole("button", { name: "Citation 2" })[0]);
    const passage = panel().querySelector('[data-passage="2"]') as HTMLElement;
    expect(passage).toHaveAttribute("data-active", "true");
    expect(panel().querySelector('[data-passage="1"]')).not.toHaveAttribute("data-active");
  });

  it("shows chunk, generation and scores to admins only", () => {
    const { unmount } = renderChat({ initialTurns: [turn()], identity: member });
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    expect(panel()).not.toHaveTextContent("g-c305cf57");
    expect(panel()).not.toHaveTextContent("chunk_1");
    unmount();

    renderChat({ initialTurns: [turn()], identity: admin });
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    expect(panel()).toHaveTextContent("chunk_1");
    expect(panel()).toHaveTextContent("g-c305cf57");
    expect(panel()).toHaveTextContent("Keyword 0.868 · Vector 0.840 · Rerank 0.991");
  });

  it("opens the document with the message and citation, then goes back to evidence", async () => {
    const actions = makeActions();
    renderChat({ actions, initialTurns: [turn()] });
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    fireEvent.click(within(panel()).getAllByRole("button", { name: /Open document/ })[0]);
    expect(await within(panel()).findByRole("heading", { name: "Parental Leave Policy" })).toBeInTheDocument();
    expect(actions.loadDocument).toHaveBeenCalledWith({
      documentId: "nw_hr_parental_leave",
      messageId: "msg-1",
      citation: "[1]",
    });
    expect(panel()).toHaveTextContent("1 Feb 2026");
    expect(window.location.search).toContain("doc=nw_hr_parental_leave");
    expect(window.location.search).toContain("c=1");

    fireEvent.click(within(panel()).getByRole("button", { name: "Back to evidence" }));
    expect(within(panel()).getByRole("tab", { name: /Cited/ })).toBeInTheDocument();
    expect(window.location.search).toBe("?evidence=cited");
  });

  it("shows a quiet message when the document is not available", async () => {
    const actions = makeActions({
      loadDocument: vi.fn(async () => actionFailure(new AppError("NOT_FOUND", "x", false))),
    });
    renderChat({ actions, initialTurns: [turn()] });
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    fireEvent.click(within(panel()).getAllByRole("button", { name: /Open document/ })[0]);
    expect(await within(panel()).findByText("This document isn't available")).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent("Version");
  });

  it("opens the reader from a deep link", async () => {
    nav.search = "evidence=cited&doc=nw_hr_parental_leave&c=1";
    window.history.replaceState(null, "", "/chat?evidence=cited&doc=nw_hr_parental_leave&c=1");
    const actions = makeActions();
    renderChat({ actions, initialTurns: [turn()] });
    expect(await within(panel()).findByRole("heading", { name: "Parental Leave Policy" })).toBeInTheDocument();
    expect(actions.loadDocument).toHaveBeenCalledWith({
      documentId: "nw_hr_parental_leave",
      messageId: "msg-1",
      citation: "[1]",
    });
  });

  it("opens a document from search without spans and without a Back button", async () => {
    nav.search = "doc=nw_hr_parental_leave";
    window.history.replaceState(null, "", "/chat?doc=nw_hr_parental_leave");
    const actions = makeActions();
    renderChat({ actions });
    expect(await within(panel()).findByRole("heading", { name: "Parental Leave Policy" })).toBeInTheDocument();
    expect(actions.loadDocument).toHaveBeenCalledWith({ documentId: "nw_hr_parental_leave" });
    expect(within(panel()).queryByRole("button", { name: "Back to evidence" })).toBeNull();
  });

  it("uses the bottom sheet and a 44px sources summary on a narrow screen", () => {
    setViewport(390);
    renderChat({ initialTurns: [turn()] });
    expect(screen.queryByRole("button", { name: /^Source 1/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Sources/ }));
    expect(screen.getByRole("dialog", { name: "Evidence" })).toHaveTextContent("Parental Leave Policy");
    fireEvent.click(screen.getByRole("button", { name: "Close sheet" }));
    expect(screen.queryByRole("dialog", { name: "Evidence" })).toBeNull();
  });
});

describe("approval", () => {
  function approvalTurn(approval: ApprovalRecord) {
    return stored("msg-1", "Open a P1 ticket", grounded, { approval });
  }
  const pending: ApprovalRecord = {
    runId: "run1",
    state: "pending",
    tool: "create_ticket",
    arguments: { desk: "Support", priority: "P1" as never, customer: "Halvorsen Freight", subject: "Atlas sync stalled" },
    expiresAt: Date.now() + 15 * 60_000,
  };

  it("shows the exact arguments with Approve and Deny", () => {
    renderChat({ initialTurns: [approvalTurn(pending)] });
    expect(screen.getByText("Needs your approval")).toBeInTheDocument();
    expect(screen.getByText("Halvorsen Freight")).toBeInTheDocument();
    expect(screen.getByText("Approves these exact arguments only")).toBeInTheDocument();
  });

  it("approves in order with the binding Brain returned, then shows the ticket", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const order: string[] = [];
    const binding = { tool: "create_ticket", argumentFingerprint: "fp" } as never;
    const actions = makeActions({
      startApproval: vi.fn(async () => {
        order.push("start");
        return actionSuccess({ workflowId: "wf1", binding });
      }),
      decideApproval: vi.fn(async () => {
        order.push("decide");
        return actionSuccess(null);
      }),
      loadConversation: vi.fn(async () =>
        actionSuccess({
          id: "conversation-1",
          title: "t",
          createdAt: 0,
          updatedAt: 0,
          turns: [
            approvalTurn({
              ...pending,
              state: "approved",
              ticket: { id: "SUP-4821", createdAt: new Date(2026, 8, 6, 9, 42).getTime() },
            }) as never,
          ],
        }),
      ),
    });
    renderChat({ actions, initialTurns: [approvalTurn(pending)] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve and run" }));
    });
    expect(actions.startApproval).toHaveBeenCalledWith("run1");
    expect(actions.decideApproval).toHaveBeenCalledWith({ workflowId: "wf1", decision: "approve", binding });
    expect(order).toEqual(["start", "decide"]);
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("Ticket SUP-4821 created")).toBeInTheDocument();
    expect(screen.getByText("create_ticket · P1 · 09:42")).toBeInTheDocument();
  });

  it("denies with decision reject and shows the denied state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const actions = makeActions({
      loadConversation: vi.fn(async () =>
        actionSuccess({
          id: "conversation-1",
          title: "t",
          createdAt: 0,
          updatedAt: 0,
          turns: [approvalTurn({ ...pending, state: "denied" }) as never],
        }),
      ),
    });
    renderChat({ actions, initialTurns: [approvalTurn(pending)] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    });
    expect(actions.decideApproval).toHaveBeenCalledWith(expect.objectContaining({ decision: "reject" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("Denied. Nothing was run.")).toBeInTheDocument();
  });

  it("never records a decision when the approval cannot be started", async () => {
    const actions = makeActions({
      startApproval: vi.fn(async () => actionFailure(new AppError("FORBIDDEN", "x", false))),
    });
    renderChat({ actions, initialTurns: [approvalTurn(pending)] });
    fireEvent.click(screen.getByRole("button", { name: "Approve and run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The approval could not be started.");
    expect(actions.decideApproval).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Approve and run" })).toBeEnabled();
  });

  it("stops waiting after a bounded number of checks", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const actions = makeActions({
      loadConversation: vi.fn(async () =>
        actionSuccess({
          id: "conversation-1",
          title: "t",
          createdAt: 0,
          updatedAt: 0,
          turns: [approvalTurn(pending) as never],
        }),
      ),
    });
    renderChat({ actions, initialTurns: [approvalTurn(pending)] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve and run" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(actions.loadConversation).toHaveBeenCalledTimes(15);
    expect(screen.getByRole("alert")).toHaveTextContent("still processing");
  });

  it("shows an expired approval with the exact copy and no buttons", () => {
    renderChat({ initialTurns: [approvalTurn({ ...pending, expiresAt: Date.now() - 1000 })] });
    expect(screen.getByText("This approval expired. Ask again to get a fresh one.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve and run" })).toBeNull();
  });
});

describe("view as", () => {
  const viewed = answerFor("Priya sees this", {
    assistantMessageId: undefined,
    conversationId: undefined,
    ...{ assumedPerson: { id: "p1", displayName: "Priya Shah", department: "Support", readableDocuments: 34 } },
  } as never);

  it("sends the person's id, skips progress polling and shows the banner and composer copy", async () => {
    nav.search = "viewAs=p1";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const askAction = vi.fn<AskAction>(async () => actionSuccess(viewed));
    renderChat({ askAction, identity: admin });
    askQuestion("What can you see?");
    await screen.findByText(/Priya sees this/);
    expect(askAction).toHaveBeenCalledWith(expect.objectContaining({ assumePrincipalId: "p1" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Viewing as Priya Shah")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask as Priya Shah")).toBeInTheDocument();
    // Brain stored nothing, so there is nothing to give feedback on.
    expect(screen.queryByRole("button", { name: "Good" })).toBeNull();
  });

  it("exits View as and starts a clean chat", async () => {
    nav.search = "viewAs=p1";
    renderChat({ askAction: async () => actionSuccess(viewed), identity: admin });
    askQuestion("What can you see?");
    await screen.findByText(/Priya sees this/);
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(screen.queryByText("Viewing as Priya Shah")).toBeNull();
    expect(screen.getByPlaceholderText("Ask a question")).toBeInTheDocument();
  });

  it("tells the admin which restricted document would have matched", () => {
    renderChat({
      identity: admin,
      initialTurns: [
        stored("msg-r", "salary bands?", refusal, {
          answerType: "insufficient_evidence",
          adminDiagnostic: [{ title: "Salary Bands", readers: { kind: "departments", names: ["HR"] } }],
        }),
      ],
    });
    expect(screen.getByText(/Only you see this: Salary Bands exists, but only HR can read it\./)).toBeInTheDocument();
  });
});


describe("review fixes", () => {
  const turnOf = (id: string, question: string) => stored(id, question, { ...grounded, assistantMessageId: id });
  const pendingApproval: ApprovalRecord = {
    runId: "run1",
    state: "pending",
    tool: "create_ticket",
    arguments: { desk: "Support", priority: "P1" as never, customer: "Halvorsen Freight", subject: "Atlas sync stalled" },
    expiresAt: Date.now() + 15 * 60_000,
  };
  const approvalTurn = (approval: ApprovalRecord) =>
    stored("msg-1", "Open a P1 ticket", grounded, { approval });
  const conversationWith = (approval: ApprovalRecord) =>
    actionSuccess({
      id: "conversation-1",
      title: "t",
      createdAt: 0,
      updatedAt: 0,
      turns: [approvalTurn(approval) as never],
    });

  it("keeps polling past approved-without-ticket until the ticket exists", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const approvedNoTicket = { ...pendingApproval, state: "approved" as const };
    const approvedWithTicket = {
      ...approvedNoTicket,
      ticket: { id: "SUP-4821", createdAt: new Date(2026, 8, 6, 9, 42).getTime() },
    };
    const loadConversation = vi
      .fn()
      .mockResolvedValueOnce(conversationWith(approvedNoTicket))
      .mockResolvedValueOnce(conversationWith(approvedWithTicket));
    renderChat({ actions: makeActions({ loadConversation }), initialTurns: [approvalTurn(pendingApproval)] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve and run" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByText("Ticket SUP-4821 created")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(loadConversation).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Ticket SUP-4821 created")).toBeInTheDocument();
  });

  it("opens the ticket page from the done state", async () => {
    renderChat({
      initialTurns: [
        approvalTurn({
          ...pendingApproval,
          state: "approved",
          ticket: { id: "SUP-4821", createdAt: Date.now() },
        }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /Open ticket/ }));
    expect(nav.push).toHaveBeenCalledWith("/tickets/SUP-4821");
  });

  it("does not open the evidence panel for clicks that are not about citations", () => {
    const actions = makeActions();
    renderChat({ actions, initialTurns: [turnOf("msg-1", "How much leave?")] });
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    expect(panel()).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Citation 1" })[0]);
    expect(panel()).not.toBeNull();
    fireEvent.click(within(panel()).getByRole("button", { name: "Close evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "Bad" }));
    expect(panel()).toBeNull();
  });

  it("keeps the tab when a click lands in the turn the open panel already shows", () => {
    renderChat({ initialTurns: [turnOf("msg-1", "How much leave?")] });
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    fireEvent.click(within(panel()).getByRole("tab", { name: /Retrieved/ }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    expect(within(panel()).getByRole("tab", { name: /Retrieved/ })).toHaveAttribute("aria-selected", "true");
  });

  it("opens a document from search while the chat is already mounted", async () => {
    const actions = makeActions();
    const { rerenderChat } = renderChat({ actions });
    expect(panel()).toBeNull();
    nav.search = "doc=nw_hr_parental_leave";
    rerenderChat();
    expect(await within(panel()).findByRole("heading", { name: "Parental Leave Policy" })).toBeInTheDocument();
    expect(actions.loadDocument).toHaveBeenCalledWith({ documentId: "nw_hr_parental_leave" });
  });

  it("does not reopen a reader the person closed", async () => {
    const actions = makeActions();
    const { rerenderChat } = renderChat({ actions });
    nav.search = "doc=nw_hr_parental_leave";
    rerenderChat();
    await within(panel()).findByRole("heading", { name: "Parental Leave Policy" });
    fireEvent.click(within(panel()).getByRole("button", { name: /Close/ }));
    rerenderChat();
    expect(panel()).toBeNull();
    expect(actions.loadDocument).toHaveBeenCalledTimes(1);
  });

  it("keeps the query string when the URL moves to the conversation", async () => {
    window.history.replaceState(null, "", "/chat?from=search");
    renderChat();
    askQuestion("one");
    await screen.findByText(/You get sixteen weeks/);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/chat/conversation-1?from=search");
  });

  it("lights a citation only in the turn that was hovered", () => {
    renderChat({ initialTurns: [turnOf("msg-1", "one"), turnOf("msg-2", "two")] });
    const first = screen.getAllByRole("button", { name: "Citation 1" });
    fireEvent.mouseEnter(first[0]);
    expect(first[0]).toHaveAttribute("data-active", "true");
    expect(first[1]).not.toHaveAttribute("data-active");
  });

  it("clears a pinned citation when the panel moves to another turn", () => {
    renderChat({ initialTurns: [turnOf("msg-1", "one"), turnOf("msg-2", "two")] });
    const chips = () => screen.getAllByRole("button", { name: "Citation 1" });
    fireEvent.click(chips()[0]);
    fireEvent.mouseLeave(chips()[0]);
    expect(chips()[0]).toHaveAttribute("data-active", "true");
    // The panel is open on turn 1; a click inside turn 2 retargets it.
    fireEvent.click(screen.getAllByRole("button", { name: "Good" })[1]);
    expect(chips()[0]).not.toHaveAttribute("data-active");
  });

  describe("failed turns", () => {
    const failWith = (error: { code: string; message: string; retryable: boolean }) =>
      renderChat({ askAction: async () => ({ ok: false, error } as never) });

    it("sends an expired session to sign in and offers no Retry", async () => {
      failWith({ code: "AUTH_REQUIRED", message: "Sign in required.", retryable: false });
      askQuestion("one");
      const alert = await screen.findByRole("alert");
      expect(within(alert).queryByRole("button", { name: "Retry" })).toBeNull();
      fireEvent.click(within(alert).getByRole("button", { name: "Sign in" }));
      expect(nav.push).toHaveBeenCalledWith("/login");
    });

    it("shows a non-retryable reason without Retry", async () => {
      failWith({ code: "FORBIDDEN", message: "You can't ask that here.", retryable: false });
      askQuestion("one");
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("You can't ask that here.");
      expect(within(alert).queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it("keeps the saved-question copy and Retry for a retryable failure", async () => {
      failWith({ code: "PROVIDER_TEMPORARY", message: "down", retryable: true });
      askQuestion("one");
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("The answer stopped before it finished. Your question is saved.");
      expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
  });
});
