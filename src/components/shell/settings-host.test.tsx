import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsHost } from "@/components/shell/settings-host";
import { admin, member } from "@/components/shell/test-support";

const signOutAction = vi.fn();
const loadAdminSettingsAction = vi.fn();

vi.mock("@/app/actions", () => ({ signOutAction: () => signOutAction() }));
vi.mock("@/app/settings-actions", () => ({
  loadAdminSettingsAction: () => loadAdminSettingsAction(),
}));

const adminData = {
  config: {
    answerModel: "@cf/zai-org/glm-5.3-flash",
    embeddingModel: "@cf/qwen/qwen3-embedding-0.6b",
    rerankerModel: "@cf/baai/bge-reranker-base",
    retrieval: "Hybrid, keyword and vector",
    passagesPerAnswer: 8,
    rerankFloor: 0.05,
    activeGeneration: "g-c305cf57",
  },
  connectors: [{ id: "uploads", name: "Uploads", description: "Built in, 62 documents", status: "active" }],
  totalDocuments: 62,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

describe("SettingsHost", () => {
  it("never shows the total or admin sections to a member and never calls the admin endpoints", () => {
    render(<SettingsHost identity={member} onClose={vi.fn()} />);
    expect(loadAdminSettingsAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Admin")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByText("Can read 34 documents")).toBeInTheDocument();
    expect(screen.queryByText(/ of \d+ documents/)).toBeNull();
  });

  it("shows an admin the total and the live config", async () => {
    loadAdminSettingsAction.mockResolvedValue({ ok: true, data: adminData });
    await act(async () => {
      render(<SettingsHost identity={admin} onClose={vi.fn()} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByText("Can read 34 of 62 documents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Model and retrieval" }));
    expect(screen.getByText("@cf/qwen/qwen3-embedding-0.6b")).toBeInTheDocument();
    expect(screen.getByText("g-c305cf57")).toBeInTheDocument();
  });

  it("says so when the admin config fails to load", async () => {
    loadAdminSettingsAction.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Couldn't load settings.", retryable: true },
    });
    await act(async () => {
      render(<SettingsHost identity={admin} onClose={vi.fn()} />);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load settings.");
  });

  it("signs out through the existing logout action", () => {
    render(<SettingsHost identity={member} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOutAction).toHaveBeenCalledOnce();
  });
});
