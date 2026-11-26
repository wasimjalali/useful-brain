import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatWorkspace } from "./chat-workspace";

const SUGGESTIONS = [
  { question: "How long are system logs kept?", department: "Engineering" },
  { question: "What is the first-response target for a P1 ticket?", department: "Support" },
];

function renderWorkspace(props: { suggestionsAfterAnswers?: boolean; pendingQuestion?: string | null }) {
  return render(
    <ChatWorkspace
      hasTurns
      onSubmit={vi.fn()}
      pendingQuestion={props.pendingQuestion ?? null}
      placeholder="Ask"
      progress={null}
      ready
      suggestions={SUGGESTIONS}
      suggestionsAfterAnswers={props.suggestionsAfterAnswers}
      title="Chat"
    >
      <p>An answer</p>
    </ChatWorkspace>,
  );
}

describe("ChatWorkspace suggestions after answers", () => {
  it("keeps the sample questions under the answers when asked to, and a pick fills the composer", () => {
    renderWorkspace({ suggestionsAfterAnswers: true });
    fireEvent.click(screen.getByRole("button", { name: /How long are system logs kept\?/ }));
    expect(screen.getByDisplayValue("How long are system logs kept?")).toBeInTheDocument();
  });

  it("shows no sample questions under answers by default or while a question is pending", () => {
    const { unmount } = renderWorkspace({});
    expect(screen.queryByRole("button", { name: /How long are system logs kept\?/ })).toBeNull();
    unmount();
    renderWorkspace({ suggestionsAfterAnswers: true, pendingQuestion: "Something" });
    expect(screen.queryByRole("button", { name: /How long are system logs kept\?/ })).toBeNull();
  });
});
