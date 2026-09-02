import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatSearchDialog } from "./chat-search-dialog";

describe("ChatSearchDialog", () => {
  it("filters recents by title", () => {
    const onSelect = vi.fn();
    render(
      <ChatSearchDialog
        conversations={[
          {
            id: "a",
            title: "Parental leave policy",
            turns: [],
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "b",
            title: "Refund window",
            turns: [],
            createdAt: 2,
            updatedAt: 2,
          },
        ]}
        onClose={vi.fn()}
        onNewChat={vi.fn()}
        onSelect={onSelect}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search chats" }), {
      target: { value: "refund" },
    });

    expect(screen.getByRole("button", { name: "Refund window" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Parental leave policy" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Refund window" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
