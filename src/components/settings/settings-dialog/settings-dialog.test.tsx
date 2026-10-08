import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsDialog } from "@/components/settings/settings-dialog";
import type { SettingsModelConfig } from "@/lib/contracts/settings-view";

const account = {
  name: "Maya Chen",
  email: "maya.chen@northwind.example",
  role: "Member",
  department: "Engineering",
  readableDocuments: 34,
};
const config: SettingsModelConfig = {
  answerModel: "@cf/zai-org/glm-5.3-flash",
  embeddingModel: "@cf/qwen/qwen3-embedding-0.6b",
  rerankerModel: "@cf/baai/bge-reranker-base",
  retrieval: "Hybrid, keyword and vector",
  passagesPerAnswer: 8,
  rerankFloor: 0.05,
  activeGeneration: "g-c305cf57",
};

function setup(over: Partial<React.ComponentProps<typeof SettingsDialog>> = {}) {
  const props = {
    account,
    isAdmin: false,
    onClose: vi.fn(),
    onSignOut: vi.fn(),
    ...over,
  };
  render(<SettingsDialog {...props} />);
  return props;
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

describe("SettingsDialog", () => {
  it("hides the admin group for members and refuses admin sections", () => {
    setup({ initialSection: "model" });
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByText("Model and retrieval")).toBeNull();
    expect(screen.getByText("Follows your device. Light right now.")).toBeInTheDocument();
  });

  it("changes the theme and updates the note", () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByText("Always dark, whatever your device uses.")).toBeInTheDocument();
  });

  it("shows only the readable count for members", () => {
    setup({ initialSection: "account" });
    expect(screen.getByText("Can read 34 documents")).toBeInTheDocument();
  });

  it("shows the total only when provided and signs out", () => {
    const props = setup({
      initialSection: "account",
      isAdmin: true,
      account: { ...account, readableDocuments: 31, totalDocuments: 62 },
    });
    expect(screen.getByText("Can read 31 of 62 documents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(props.onSignOut).toHaveBeenCalledOnce();
  });

  it("renders read-only config and a disabled GitHub connect for admins", () => {
    setup({
      isAdmin: true,
      config,
      connectors: [
        { id: "uploads", name: "Uploads", description: "Built in", status: "active" },
        {
          id: "github",
          name: "GitHub",
          description: "Sync a repository folder into a draft",
          status: "not_connected",
          connectable: true,
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Model and retrieval" }));
    expect(screen.getByText("Read-only. Changes go through evals.")).toBeInTheDocument();
    expect(screen.getByText("@cf/qwen/qwen3-embedding-0.6b")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connectors" }));
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("closes from the close button and Escape", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
