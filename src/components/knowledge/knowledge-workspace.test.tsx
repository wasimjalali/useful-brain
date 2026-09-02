import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KnowledgeWorkspace } from "./knowledge-workspace";

const documents = [
  {
    source: "return_policy.md",
    title: "Return Policy",
    text: "# Return Policy\n\n## Eligibility\nReturns are accepted within 30 days.",
  },
  {
    source: "shipping_policy.md",
    title: "Shipping Policy",
    text: "# Shipping Policy\n\n## Delivery\nStandard shipping takes five days.",
  },
];

const chunks = [
  {
    id: "return_policy__chunk_001",
    source: "return_policy.md",
    section: "Eligibility",
    text: "Returns are accepted within 30 days.",
    tokenEstimate: 7,
    createdAt: "2026-07-01T00:00:00.000Z",
  },
];

const embeddingStorageStatus = {
  storedDocuments: 2,
  storedChunks: 1,
  embeddedChunks: 1,
  lastRunStatus: "succeeded",
  lastRunMessage: "All chunks embedded.",
  lastEmbeddedAt: 1782920000000,
} as const;

describe("KnowledgeWorkspace", () => {
  it("shows an honest first-run state for an empty corpus", () => {
    render(
      <KnowledgeWorkspace
        addDocumentAction={async () => {}}
        chunks={[]}
        documents={[]}
        embedAction={async () => {}}
        embeddingStorageStatus={{
          storedDocuments: 0,
          storedChunks: 0,
          embeddedChunks: 0,
          lastRunStatus: "not_started",
          lastRunMessage: null,
          lastEmbeddedAt: null,
          activeVersionId: null,
          readyVersionId: null,
          corpusStatus: "not_started",
        }}
      />,
    );

    expect(screen.getByText("Setup needed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Seed Northwind corpus" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Upload document" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Knowledge documents" })).toBeNull();
  });

  it("filters documents by title, source and status", () => {
    render(
      <KnowledgeWorkspace
        addDocumentAction={async () => {}}
        chunks={chunks}
        documents={documents}
        embedAction={async () => {}}
        embeddingStorageStatus={embeddingStorageStatus}
      />,
    );

    const table = screen.getByRole("table", { name: "Knowledge documents" });
    const search = screen.getByRole("searchbox", { name: "Search documents" });

    fireEvent.change(search, { target: { value: "return" } });
    expect(within(table).getByRole("row", { name: /Return Policy/ })).toBeInTheDocument();
    expect(
      within(table).queryByRole("row", { name: /Shipping Policy/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "shipping_policy.md" } });
    expect(within(table).getByRole("row", { name: /Shipping Policy/ })).toBeInTheDocument();
    expect(
      within(table).queryByRole("row", { name: /Return Policy/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Filter by status" }));
    fireEvent.click(screen.getByRole("option", { name: "Needs indexing" }));
    expect(within(table).getByRole("row", { name: /Shipping Policy/ })).toBeInTheDocument();
    expect(
      within(table).queryByRole("row", { name: /Return Policy/ }),
    ).not.toBeInTheDocument();
  });

  it("opens a document detail panel with ingestion status", () => {
    render(
      <KnowledgeWorkspace
        addDocumentAction={async () => {}}
        chunks={chunks}
        documents={documents}
        embedAction={async () => {}}
        embeddingStorageStatus={embeddingStorageStatus}
      />,
    );

    const table = screen.getByRole("table", { name: "Knowledge documents" });
    fireEvent.click(
      within(table).getByRole("button", { name: "View Return Policy" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Return Policy details" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Active")).toBeInTheDocument();
    expect(within(dialog).getByText("1 indexed chunk")).toBeInTheDocument();
  });

  it("marks documents and chunks as needing indexing when no embeddings exist", () => {
    render(
      <KnowledgeWorkspace
        addDocumentAction={async () => {}}
        chunks={chunks}
        documents={documents}
        embedAction={async () => {}}
        embeddingStorageStatus={{ ...embeddingStorageStatus, embeddedChunks: 0 }}
      />,
    );

    const table = screen.getByRole("table", { name: "Knowledge documents" });
    expect(
      within(table).getByRole("row", { name: /Return Policy.*Needs indexing/ }),
    ).toBeInTheDocument();

    const chunkPreview = screen
      .getByText("return_policy__chunk_001")
      .closest("article");
    expect(chunkPreview).not.toBeNull();
    expect(within(chunkPreview!).getByText("Needs indexing")).toBeInTheDocument();

    fireEvent.click(
      within(table).getByRole("button", { name: "View Return Policy" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Return Policy details" });
    expect(within(dialog).getByText("1 chunk waiting for indexing")).toBeInTheDocument();
    expect(within(dialog).queryByText("Available to retrieval.")).toBeNull();
  });

  it("does not mark documents or chunks active before indexing starts", () => {
    render(
      <KnowledgeWorkspace
        addDocumentAction={async () => {}}
        chunks={chunks}
        documents={documents}
        embedAction={async () => {}}
        embeddingStorageStatus={{
          ...embeddingStorageStatus,
          lastRunStatus: "not_started",
        }}
      />,
    );

    const table = screen.getByRole("table", { name: "Knowledge documents" });
    expect(
      within(table).getByRole("row", { name: /Return Policy.*Needs indexing/ }),
    ).toBeInTheDocument();

    const chunkPreview = screen
      .getByText("return_policy__chunk_001")
      .closest("article");
    expect(chunkPreview).not.toBeNull();
    expect(within(chunkPreview!).getByText("Needs indexing")).toBeInTheDocument();
  });

  it("shows processing while a local indexing action starts with zero embeddings", async () => {
    let resolveEmbedding: (() => void) | undefined;
    render(
      <KnowledgeWorkspace
        addDocumentAction={async () => {}}
        chunks={chunks}
        documents={documents}
        embedAction={async () => {}}
        reindexAction={() =>
          new Promise<void>((resolve) => {
            resolveEmbedding = resolve;
          })
        }
        embeddingStorageStatus={{ ...embeddingStorageStatus, embeddedChunks: 0 }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Re-index sources" }));

    const table = screen.getByRole("table", { name: "Knowledge documents" });
    await waitFor(() => {
      expect(
        within(table).getByRole("row", { name: /Return Policy.*Processing/ }),
      ).toBeInTheDocument();
    });

    const chunkPreview = screen
      .getByText("return_policy__chunk_001")
      .closest("article");
    expect(chunkPreview).not.toBeNull();
    expect(within(chunkPreview!).getByText("Processing")).toBeInTheDocument();
    expect(resolveEmbedding).toBeDefined();
  });

  it("shows processing while persisted indexing runs with zero embeddings", () => {
    render(
      <KnowledgeWorkspace
        addDocumentAction={async () => {}}
        chunks={chunks}
        documents={documents}
        embedAction={async () => {}}
        embeddingStorageStatus={{
          ...embeddingStorageStatus,
          embeddedChunks: 0,
          lastRunStatus: "running",
        }}
      />,
    );

    const table = screen.getByRole("table", { name: "Knowledge documents" });
    expect(
      within(table).getByRole("row", { name: /Return Policy.*Processing/ }),
    ).toBeInTheDocument();

    const chunkPreview = screen
      .getByText("return_policy__chunk_001")
      .closest("article");
    expect(chunkPreview).not.toBeNull();
    expect(within(chunkPreview!).getByText("Processing")).toBeInTheDocument();
  });

  it("preserves failed status when an indexing run fails before embeddings are stored", () => {
    render(
      <KnowledgeWorkspace
        addDocumentAction={async () => {}}
        chunks={chunks}
        documents={documents}
        embedAction={async () => {}}
        reindexAction={async () => {}}
        embeddingStorageStatus={{
          ...embeddingStorageStatus,
          embeddedChunks: 0,
          lastRunStatus: "failed",
        }}
      />,
    );

    const table = screen.getByRole("table", { name: "Knowledge documents" });
    expect(
      within(table).getByRole("row", { name: /Return Policy.*Failed/ }),
    ).toBeInTheDocument();

    const chunkPreview = screen
      .getByText("return_policy__chunk_001")
      .closest("article");
    expect(chunkPreview).not.toBeNull();
    expect(within(chunkPreview!).getByText("Failed")).toBeInTheDocument();

    fireEvent.click(
      within(table).getByRole("button", { name: "View Return Policy" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Return Policy details" });
    expect(within(dialog).getByRole("button", { name: "Re-index" })).toBeInTheDocument();
  });

  it("keeps corpus re-index when every document is active", () => {
    render(
      <KnowledgeWorkspace
        addDocumentAction={async () => {}}
        chunks={[
          chunks[0],
          {
            id: "shipping_policy__chunk_001",
            source: "shipping_policy.md",
            section: "Delivery",
            text: "Standard shipping takes five days.",
            tokenEstimate: 6,
            createdAt: "2026-07-01T00:00:00.000Z",
          },
        ]}
        documents={documents}
        embedAction={async () => {}}
        reindexAction={async () => {}}
        embeddingStorageStatus={{
          ...embeddingStorageStatus,
          storedDocuments: 2,
          storedChunks: 2,
          embeddedChunks: 2,
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Re-index sources" }),
    ).toBeInTheDocument();
  });

  it("pages the document inventory", () => {
    const manyDocuments = Array.from({ length: 16 }, (_, index) => ({
      source: `doc-${index}.md`,
      title: `Document ${index + 1}`,
      text: `Body ${index + 1}`,
    }));

    render(
      <KnowledgeWorkspace
        addDocumentAction={async () => {}}
        chunks={[]}
        documents={manyDocuments}
        embedAction={async () => {}}
        embeddingStorageStatus={embeddingStorageStatus}
      />,
    );

    const table = screen.getByRole("table", { name: "Knowledge documents" });
    expect(within(table).getAllByRole("button", { name: /View Document/ })).toHaveLength(12);
    expect(within(table).queryByRole("button", { name: "View Document 9" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(within(table).getAllByRole("button", { name: /View Document/ })).toHaveLength(16);
    expect(within(table).getByRole("button", { name: "View Document 9" })).toBeInTheDocument();
  });

  it("shows a ready corpus and promotes it explicitly", async () => {
    const promoteAction = vi.fn().mockResolvedValue(undefined);
    render(
      <KnowledgeWorkspace
        addDocumentAction={async () => {}}
        chunks={chunks}
        documents={documents}
        embedAction={async () => {}}
        embeddingStorageStatus={{
          ...embeddingStorageStatus,
          corpusStatus: "ready",
          readyVersionId: "version-1",
        }}
        promoteAction={promoteAction}
      />,
    );

    expect(screen.getAllByText("Ready to promote").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Promote ready corpus" }));
    await waitFor(() => {
      expect(promoteAction).toHaveBeenCalledWith("version-1");
    });
  });
});
