import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SELECTED_MODELS } from "@/lib/models/selection";

import { SettingsWorkspace } from "./settings-workspace";

describe("SettingsWorkspace", () => {
  it("shows identity, locked models and active corpus state", () => {
    render(
      <SettingsWorkspace
        identity={{
          id: "principal-dev",
          kind: "user",
          roles: ["operator", "standard"],
          departments: ["support"],
        }}
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
    expect(screen.getByText("operator, standard")).toBeInTheDocument();
    expect(screen.getByText("Retrieval ready")).toBeInTheDocument();
    expect(screen.getByText("Keyword retrieval in local preview")).toBeInTheDocument();
    expect(screen.getByText(SELECTED_MODELS.chat.id)).toBeInTheDocument();
    expect(screen.getByText(SELECTED_MODELS.rerank.id)).toBeInTheDocument();
    expect(screen.getByText("Synthetic documents only")).toBeInTheDocument();
  });
});
