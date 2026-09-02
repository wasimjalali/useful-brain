import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SELECTED_MODELS } from "@/lib/models/selection";

import { SettingsWorkspace } from "./settings-workspace";

describe("SettingsWorkspace", () => {
  it("opens on operator and reveals retrieval and models on demand", () => {
    render(
      <SettingsWorkspace
        identity={{
          id: "principal-dev",
          kind: "user",
          roles: ["operator", "standard"],
          departments: ["support"],
        }}
        onAssumePrincipal={vi.fn()}
        retrievalMode="keyword"
        status={{
          storedDocuments: 65,
          storedChunks: 808,
          embeddedChunks: 808,
          lastRunStatus: "succeeded",
          lastRunMessage: null,
          lastEmbeddedAt: 1,
          activeVersionId: "g-active",
          readyVersionId: null,
          corpusStatus: "active",
        }}
      />,
    );

    expect(screen.getByText("principal-dev")).toBeInTheDocument();
    expect(screen.getByLabelText("Assume principal")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retrieval" }));
    expect(screen.getByText("Retrieval ready")).toBeInTheDocument();
    expect(screen.getByText("Keyword retrieval in local preview")).toBeInTheDocument();
    expect(screen.getByText("Synthetic documents only")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(screen.getByText(SELECTED_MODELS.chat.id)).toBeInTheDocument();
    expect(screen.getByText(SELECTED_MODELS.rerank.id)).toBeInTheDocument();
  });
});
