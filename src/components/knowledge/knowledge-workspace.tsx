"use client";

import { useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { MAX_UPLOAD_BYTES } from "@/lib/rag/extract-upload";
import { CloseIcon, LayersIcon, PlusIcon, UploadIcon } from "@/components/icons";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { StatusLabel, type StatusTone } from "@/components/ui/status-label";
import type { ActionResult } from "@/lib/rag/app-errors";
import type { DocumentChunk, KnowledgeDocument } from "@/lib/rag/types";
import type { EmbeddingStorageStatus } from "@/lib/rag/storage-records";
import type { KnowledgeInventory } from "@/lib/store/knowledge-inventory";

export type DocumentStatus =
  | "active"
  | "processing"
  | "ready"
  | "needs_indexing"
  | "failed";

export type KnowledgeWorkspaceProps = {
  documents: KnowledgeDocument[];
  chunks: DocumentChunk[];
  deleteDocumentAction?: (documentId: string) => Promise<ActionResult<null>>;
  addDocumentAction: (formData: FormData) => Promise<void>;
  embedAction: () => Promise<void>;
  embeddingStorageStatus: EmbeddingStorageStatus;
  initialAddOpen?: boolean;
  isOperator?: boolean;
  promoteAction?: (versionId: string) => Promise<void>;
  reindexAction?: () => Promise<void>;
  retrievalMode?: KnowledgeInventory["retrievalMode"];
};

type DocumentInventoryItem = {
  document: KnowledgeDocument;
  chunks: DocumentChunk[];
  status: DocumentStatus;
  sectionCount: number;
  wordCount: number;
};

const STATUS_COPY: Record<DocumentStatus, string> = {
  active: "Active",
  processing: "Processing",
  ready: "Ready to promote",
  needs_indexing: "Needs indexing",
  failed: "Failed",
};

const STATUS_TONE: Record<DocumentStatus, StatusTone> = {
  active: "success",
  processing: "neutral",
  ready: "success",
  needs_indexing: "warning",
  failed: "danger",
};

const DOCUMENT_PAGE_SIZE = 12;
const CHUNK_PAGE_SIZE = 5;

export function KnowledgeWorkspace({
  addDocumentAction,
  chunks,
  deleteDocumentAction,
  documents,
  embedAction,
  embeddingStorageStatus,
  initialAddOpen = false,
  isOperator = false,
  promoteAction,
  reindexAction,
  retrievalMode = "keyword",
}: KnowledgeWorkspaceProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(initialAddOpen);
  const [selectedDocument, setSelectedDocument] =
    useState<DocumentInventoryItem | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatus>(
    "all",
  );
  const [sort, setSort] = useState<"title" | "source" | "chunks">("title");
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [documentLimit, setDocumentLimit] = useState(DOCUMENT_PAGE_SIZE);
  const [chunkLimit, setChunkLimit] = useState(CHUNK_PAGE_SIZE);

  const inventory = useMemo(() => {
    const chunksBySource = new Map<string, DocumentChunk[]>();
    for (const chunk of chunks) {
      const sourceChunks = chunksBySource.get(chunk.source) ?? [];
      sourceChunks.push(chunk);
      chunksBySource.set(chunk.source, sourceChunks);
    }

    return documents.map((document) => {
      const documentChunks = chunksBySource.get(document.source) ?? [];
      return {
        document,
        chunks: documentChunks,
        status: getDocumentStatus({
          chunkCount: documentChunks.length,
          embeddingStorageStatus,
          isEmbedding: isEmbedding || isReindexing,
          totalChunkCount: chunks.length,
        }),
        sectionCount: new Set(documentChunks.map((chunk) => chunk.section)).size,
        wordCount: countWords(document.text),
      };
    });
  }, [chunks, documents, embeddingStorageStatus, isEmbedding, isReindexing]);

  const visibleDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = inventory.filter((item) => {
      const matchesQuery =
        !normalizedQuery ||
        item.document.title.toLocaleLowerCase().includes(normalizedQuery) ||
        item.document.source.toLocaleLowerCase().includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;
      return matchesQuery && matchesStatus;
    });

    return filtered.sort((left, right) => {
      if (sort === "chunks") {
        return right.chunks.length - left.chunks.length ||
          left.document.title.localeCompare(right.document.title);
      }
      const leftValue = left.document[sort];
      const rightValue = right.document[sort];
      return leftValue.localeCompare(rightValue);
    });
  }, [inventory, query, sort, statusFilter]);

  const pagedDocuments = visibleDocuments.slice(0, documentLimit);
  const previewChunks = chunks.slice(0, chunkLimit);
  const activeCount = inventory.filter((item) => item.status === "active").length;
  const documentStatusBySource = useMemo(
    () => new Map(inventory.map((item) => [item.document.source, item.status])),
    [inventory],
  );

  async function handleEmbed() {
    setEmbedError(null);
    setIsEmbedding(true);
    try {
      await embedAction();
      router.refresh();
    } catch (caught) {
      setEmbedError(
        caught instanceof Error ? caught.message : "Indexing failed.",
      );
    } finally {
      setIsEmbedding(false);
    }
  }

  async function handlePromote() {
    const readyVersionId = embeddingStorageStatus.readyVersionId;
    if (!promoteAction || !readyVersionId) return;
    setEmbedError(null);
    setIsPromoting(true);
    try {
      await promoteAction(readyVersionId);
      router.refresh();
    } catch (caught) {
      setEmbedError(
        caught instanceof Error ? caught.message : "Corpus promotion failed.",
      );
    } finally {
      setIsPromoting(false);
    }
  }

  async function handleReindex() {
    if (!reindexAction) return;
    setEmbedError(null);
    setIsReindexing(true);
    try {
      await reindexAction();
      router.refresh();
    } catch (caught) {
      setEmbedError(caught instanceof Error ? caught.message : "Re-indexing failed.");
    } finally {
      setIsReindexing(false);
    }
  }

  function closeAddDocument() {
    setAddOpen(false);
    router.refresh();
    if (initialAddOpen) {
      router.push("/knowledge");
    }
  }

  const firstRun =
    documents.length === 0 && embeddingStorageStatus.corpusStatus === "not_started";

  if (firstRun) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Sources</h1>
        </header>
        <section className="first-run-panel" aria-labelledby="first-run-heading">
          <div>
            <p className="section-label">Setup needed</p>
            <h2 className="mt-2 text-xl font-semibold text-ink" id="first-run-heading">
              Add the first documents
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">
              Chat stays unavailable until a ready generation is promoted.
            </p>
          </div>
          {embedError ? <p className="text-sm font-medium text-danger" role="alert">{embedError}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            {isOperator ? (
              <button
                className="btn btn-primary min-h-11 px-4 text-sm"
                disabled={isEmbedding}
                onClick={handleEmbed}
                type="button"
              >
                <LayersIcon className="size-4" />
                {isEmbedding ? "Seeding Northwind" : "Seed Northwind corpus"}
              </button>
            ) : null}
            <button
              className="btn btn-primary min-h-11 px-4 text-sm"
              onClick={() => setAddOpen(true)}
              type="button"
            >
              <UploadIcon className="size-4" />
              Upload document
            </button>
          </div>
        </section>
        {addOpen ? <AddDocumentDialog action={addDocumentAction} onClose={closeAddDocument} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Sources</h1>
        <button
          className="btn btn-primary min-h-10 shrink-0 px-3.5 text-sm"
          onClick={() => setAddOpen(true)}
          type="button"
        >
          <PlusIcon className="size-4" />
          Upload document
        </button>
      </header>

      <CorpusSummary
        documents={documents.length}
        chunks={chunks.length}
        retrievalMode={retrievalMode}
        status={embeddingStorageStatus}
      />

      <section aria-labelledby="document-inventory-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink" id="document-inventory-heading">
              Document inventory
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              <span className="tnum">{documents.length}</span> documents, {" "}
              <span className="tnum">{chunks.length}</span> chunks and {" "}
              <span className="tnum">{activeCount}</span> active sources.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {reindexAction && isOperator ? (
              <button
                className="btn btn-secondary min-h-10 px-3.5 text-sm"
                disabled={isReindexing || isPromoting}
                onClick={handleReindex}
                type="button"
              >
                <LayersIcon className="size-4" />
                {isReindexing ? "Re-indexing" : "Re-index sources"}
              </button>
            ) : null}
            {embeddingStorageStatus.readyVersionId && promoteAction ? (
              <button
                className="btn btn-primary min-h-10 px-3.5 text-sm"
                disabled={isPromoting || isEmbedding || isReindexing}
                onClick={handlePromote}
                type="button"
              >
                <UploadIcon className="size-4" />
                {isPromoting ? "Promoting" : "Promote ready corpus"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex min-w-52 flex-col gap-1.5 text-[13px] font-medium text-ink-muted">
              Search documents
              <input
                className="field-input min-h-10 px-3 text-sm text-ink outline-none"
                name="document-search"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setDocumentLimit(DOCUMENT_PAGE_SIZE);
                }}
                placeholder="Title or source"
                type="search"
                value={query}
              />
            </label>
            <label className="flex min-w-40 flex-col gap-1.5 text-[13px] font-medium text-ink-muted">
              Filter by status
              <Select
                id="document-status-filter"
                onChange={(next) => {
                  setStatusFilter(next as "all" | DocumentStatus);
                  setDocumentLimit(DOCUMENT_PAGE_SIZE);
                }}
                options={[
                  { value: "all", label: "All statuses" },
                  ...Object.entries(STATUS_COPY).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
                value={statusFilter}
              />
            </label>
            <label className="flex min-w-36 flex-col gap-1.5 text-[13px] font-medium text-ink-muted">
              Sort documents
              <Select
                id="document-sort"
                onChange={(next) => {
                  setSort(next as "title" | "source" | "chunks");
                  setDocumentLimit(DOCUMENT_PAGE_SIZE);
                }}
                options={[
                  { value: "title", label: "Title" },
                  { value: "source", label: "Source" },
                  { value: "chunks", label: "Most chunks" },
                ]}
                value={sort}
              />
            </label>
        </div>

        {embedError ? (
          <p className="text-sm font-medium text-danger" role="alert">
            {embedError}
          </p>
        ) : null}

        <DocumentTable
          documents={pagedDocuments}
          onSelectDocument={setSelectedDocument}
        />
        <DocumentRows
          documents={pagedDocuments}
          onSelectDocument={setSelectedDocument}
        />
        {visibleDocuments.length > documentLimit ? (
          <button
            className="btn btn-secondary min-h-10 self-start px-3.5 text-sm"
            onClick={() =>
              setDocumentLimit((current) => current + DOCUMENT_PAGE_SIZE)
            }
            type="button"
          >
            Load more
          </button>
        ) : null}
      </section>

      <section aria-labelledby="recent-chunks-heading" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink" id="recent-chunks-heading">
          Chunk preview
        </h2>
        {chunks.length > 0 ? (
          <>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              {previewChunks.map((chunk) => (
                <article className="border-b border-border px-4 py-3 last:border-b-0" key={chunk.id}>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <span className="font-mono text-xs font-semibold text-accent-deep">{chunk.id}</span>
                    <div className="flex items-center gap-3">
                      <span className="tnum text-xs text-ink-faint">~{chunk.tokenEstimate} tokens</span>
                      <DocumentStatusLabel
                        status={documentStatusBySource.get(chunk.source) ?? "needs_indexing"}
                      />
                    </div>
                  </div>
                  <p className="mt-1 text-xs font-medium text-ink-muted">{chunk.section}</p>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink-muted">{chunk.text}</p>
                </article>
              ))}
            </div>
            {chunks.length > chunkLimit ? (
              <button
                className="btn btn-secondary min-h-10 self-start px-3.5 text-sm"
                onClick={() =>
                  setChunkLimit((current) => current + CHUNK_PAGE_SIZE)
                }
                type="button"
              >
                Load more chunks
              </button>
            ) : null}
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-sm text-ink-muted">
            No chunks have been created yet.
          </p>
        )}
      </section>

      {addOpen ? (
        <AddDocumentDialog
          action={addDocumentAction}
          onClose={closeAddDocument}
        />
      ) : null}

      {selectedDocument ? (
        <DocumentDetailDialog
          canDelete={documents.length > 1}
          deleteAction={deleteDocumentAction}
          item={selectedDocument}
          onClose={() => setSelectedDocument(null)}
          onReindex={
            reindexAction &&
            (selectedDocument.status === "failed" ||
              selectedDocument.status === "needs_indexing")
              ? handleReindex
              : undefined
          }
          reindexing={isReindexing}
        />
      ) : null}
    </div>
  );
}

function CorpusSummary({
  chunks,
  documents,
  retrievalMode,
  status,
}: {
  chunks: number;
  documents: number;
  retrievalMode: KnowledgeInventory["retrievalMode"];
  status: EmbeddingStorageStatus;
}) {
  const statusLabel = status.readyVersionId
    ? "Ready to promote"
    : status.corpusStatus === "active"
      ? "Active"
      : status.corpusStatus === "failed"
        ? "Failed"
        : "Building";
  return (
    <section className="corpus-summary" aria-label="Corpus status">
      <div>
        <p className="section-label">Generation status</p>
        <p className="mt-1 text-lg font-semibold text-ink">{statusLabel}</p>
      </div>
      <SummaryMetric label="Documents" value={documents.toLocaleString("en-US")} />
      <SummaryMetric label="Chunks" value={chunks.toLocaleString("en-US")} />
      <SummaryMetric
        label="Retrieval"
        value={retrievalMode === "hybrid" ? "Hybrid" : "Keyword only"}
      />
      <div className="min-w-0 md:col-span-2 xl:col-span-1">
        <p className="section-label">Generation</p>
        <p className="mt-1 truncate font-mono text-xs text-ink-muted">
          {status.readyVersionId ?? status.activeVersionId ?? "None"}
        </p>
      </div>
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="section-label">{label}</p>
      <p className="tnum mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function DocumentTable({
  documents,
  onSelectDocument,
}: {
  documents: DocumentInventoryItem[];
  onSelectDocument: (document: DocumentInventoryItem) => void;
}) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
      <table aria-label="Knowledge documents" className="operational-table w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border bg-sunken text-xs font-medium text-ink-muted">
            <th className="px-4 py-3" scope="col">Document</th>
            <th className="px-4 py-3" scope="col">Source</th>
            <th className="px-4 py-3 text-right" scope="col">Sections</th>
            <th className="px-4 py-3 text-right" scope="col">Chunks</th>
            <th className="px-4 py-3" scope="col">Latest section</th>
            <th className="px-4 py-3" scope="col">Ingestion status</th>
          </tr>
        </thead>
        <tbody>
          {documents.length > 0 ? (
            documents.map((item) => (
              <tr className="border-b border-border last:border-b-0" key={item.document.source}>
                <td className="px-4 py-3.5">
                  <button
                    aria-label={`View ${item.document.title}`}
                    className="text-left text-sm font-semibold text-ink underline-offset-4 hover:text-accent-deep hover:underline"
                    onClick={() => onSelectDocument(item)}
                    type="button"
                  >
                    {item.document.title}
                  </button>
                </td>
                <td className="max-w-56 truncate px-4 py-3.5 font-mono text-xs text-ink-muted">
                  {item.document.source}
                </td>
                <td className="tnum px-4 py-3.5 text-right text-sm text-ink-muted">
                  {item.sectionCount}
                </td>
                <td className="tnum px-4 py-3.5 text-right text-sm text-ink-muted">
                  {item.chunks.length}
                </td>
                <td className="max-w-48 truncate px-4 py-3.5 text-sm text-ink-muted">
                  {item.chunks[0]?.section ?? "No chunks"}
                </td>
                <td className="px-4 py-3.5">
                  <DocumentStatusLabel status={item.status} />
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-4 py-8 text-sm text-ink-muted" colSpan={6}>
                No documents match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DocumentRows({
  documents,
  onSelectDocument,
}: {
  documents: DocumentInventoryItem[];
  onSelectDocument: (document: DocumentInventoryItem) => void;
}) {
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {documents.length > 0 ? (
        documents.map((item) => (
          <article className="rounded-xl border border-border bg-surface p-4" key={item.document.source}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button
                  aria-label={`View ${item.document.title}`}
                  className="text-left text-sm font-semibold text-ink underline-offset-4 hover:text-accent-deep hover:underline"
                  onClick={() => onSelectDocument(item)}
                  type="button"
                >
                  {item.document.title}
                </button>
                <p className="mt-1 truncate font-mono text-xs text-ink-muted">
                  {item.document.source}
                </p>
              </div>
              <DocumentStatusLabel status={item.status} />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3">
              <InlineMetric label="Sections" value={item.sectionCount.toString()} />
              <InlineMetric label="Chunks" value={item.chunks.length.toString()} />
              <InlineMetric label="Section" value={item.chunks[0]?.section ?? "None"} />
            </dl>
          </article>
        ))
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-sm text-ink-muted">
          No documents match the current filters.
        </p>
      )}
    </div>
  );
}

function DocumentDetailDialog({
  canDelete,
  deleteAction,
  item,
  onClose,
  onReindex,
  reindexing = false,
}: {
  canDelete: boolean;
  deleteAction?: (documentId: string) => Promise<ActionResult<null>>;
  item: DocumentInventoryItem;
  onClose: () => void;
  onReindex?: () => Promise<void>;
  reindexing?: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!deleteAction || !item.document.id || deleting || !canDelete) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      const result = await deleteAction(item.document.id);
      if (!result.ok) {
        setDeleteError(result.error.message);
        return;
      }
      onClose();
      router.refresh();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "The document could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog ariaLabel={`${item.document.title} details`} maxWidth="max-w-2xl" onClose={onClose}>
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-ink">{item.document.title}</h2>
          <p className="mt-1 truncate font-mono text-xs text-ink-muted">{item.document.source}</p>
        </div>
        <button
          aria-label="Close"
          className="icon-btn size-8 shrink-0"
          onClick={onClose}
          type="button"
        >
          <CloseIcon className="size-5" />
        </button>
      </div>
      <div className="flex flex-col gap-5 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DocumentStatusLabel status={item.status} />
          <span className="text-sm text-ink-muted">{ingestionNote(item.status)}</span>
        </div>
        <dl className="grid grid-cols-3 gap-3">
          <DetailMetric label="Sections" value={item.sectionCount.toString()} />
          <DetailMetric label="Chunk state" value={chunkStateLabel(item.status, item.chunks.length)} />
          <DetailMetric label="Words" value={item.wordCount.toLocaleString("en-US")} />
        </dl>
        <div>
          <h3 className="text-sm font-semibold text-ink">Chunk preview</h3>
          {item.chunks.length > 0 ? (
            <div className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border">
              {item.chunks.map((chunk) => (
                <div className="px-3 py-2.5" key={chunk.id}>
                  <p className="font-mono text-xs font-medium text-accent-deep">{chunk.id}</p>
                  <p className="mt-1 text-xs text-ink-muted">{chunk.section}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">No chunks are available for this document yet.</p>
          )}
        </div>
        {onReindex || (deleteAction && item.document.id) ? (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            {onReindex ? (
              <button
                className="btn btn-primary min-h-10 self-start px-3.5 text-sm"
                disabled={reindexing}
                onClick={() => {
                  void onReindex();
                  onClose();
                }}
                type="button"
              >
                {reindexing ? "Re-indexing" : "Re-index"}
              </button>
            ) : null}
            {deleteAction && item.document.id ? (
              <>
                <p className="text-sm text-ink-muted">
                  Deletion creates a ready generation. Retrieval changes only after promotion.
                </p>
                {deleteError ? <p className="mt-2 text-sm text-danger" role="alert">{deleteError}</p> : null}
                <button
                  className="btn btn-secondary min-h-10 self-start px-3.5 text-sm text-danger"
                  disabled={deleting || !canDelete}
                  onClick={handleDelete}
                  type="button"
                >
                  {deleting ? "Deleting document" : "Delete document"}
                </button>
                {!canDelete ? (
                  <p className="text-xs text-ink-faint">At least one document must remain.</p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function DocumentStatusLabel({ status }: { status: DocumentStatus }) {
  return <StatusLabel tone={STATUS_TONE[status]}>{STATUS_COPY[status]}</StatusLabel>;
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-ink-faint">{label}</dt>
      <dd className="tnum mt-1 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-canvas px-3 py-2.5">
      <dt className="text-[11px] font-medium text-ink-faint">{label}</dt>
      <dd className="tnum mt-1 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

type FolderQueueItemState = "waiting" | "uploading" | "added" | "failed";

type FolderQueueItem = {
  file: File;
  title: string;
  state: FolderQueueItemState;
  message?: string;
};

const FOLDER_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".pdf"]);

/**
 * Titles from a folder's relative path (root folder dropped) so two files
 * named alike in different subfolders become distinct documents instead of
 * silently merging into one slug.
 */
export function folderFileTitle(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  const withoutRoot = parts.length > 1 ? parts.slice(1) : parts;
  const base = withoutRoot.join(" / ").replace(/\.[^.]+$/, "").trim();
  return base;
}

function relativePathOf(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
}

function AddDocumentDialog({
  action,
  onClose,
}: {
  action: (formData: FormData) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [folderQueue, setFolderQueue] = useState<FolderQueueItem[] | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const cancelledRef = useRef(false);

  function requestClose() {
    cancelledRef.current = true;
    onClose();
  }

  async function handle(formData: FormData) {
    setError(null);
    const file = formData.get("file");
    const hasFile = file instanceof File && file.size > 0;
    const title = String(formData.get("title") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();

    if (!hasFile && (!title || !body)) {
      setError("Upload a file, or enter a title and document text.");
      return;
    }

    try {
      await action(formData);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not add the document.",
      );
    }
  }

  function updateQueueItem(index: number, patch: Partial<FolderQueueItem>) {
    setFolderQueue(
      (current) =>
        current?.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...patch } : item,
        ) ?? null,
    );
  }

  async function runFolderQueue(items: FolderQueueItem[]) {
    setFolderQueue(items);
    setFolderBusy(true);
    setError(null);
    for (let index = 0; index < items.length; index += 1) {
      const planned = items[index];
      if (cancelledRef.current) {
        if (planned.state !== "failed") {
          updateQueueItem(index, { state: "failed", message: "Cancelled" });
        }
        continue;
      }
      // Pre-queue rejects (unsupported, empty, oversized) keep their skip
      // message and are never sent to the server.
      if (planned.state === "failed") {
        continue;
      }
      updateQueueItem(index, { state: "uploading" });
      try {
        const formData = new FormData();
        formData.set("file", planned.file, planned.file.name);
        formData.set("title", planned.title);
        await action(formData);
        updateQueueItem(index, { state: "added" });
      } catch (caught) {
        updateQueueItem(index, {
          state: "failed",
          message:
            caught instanceof Error ? caught.message : "Could not add the document.",
        });
      }
    }
    setFolderBusy(false);
  }

  function queueFolder(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    const queued: FolderQueueItem[] = [];
    for (const file of Array.from(files)) {
      const relativePath = relativePathOf(file);
      const extension = (relativePath || file.name).match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";
      const emptyState: FolderQueueItemState | null =
        !FOLDER_EXTENSIONS.has(extension)
          ? "failed"
          : file.size === 0
            ? "failed"
            : file.size > MAX_UPLOAD_BYTES
              ? "failed"
              : null;
      const skipMessage =
        !FOLDER_EXTENSIONS.has(extension)
          ? "Skipped: unsupported file type"
          : file.size === 0
            ? "Skipped: empty file"
            : "Skipped: larger than 10 MB";
      if (emptyState) {
        queued.push({ file, title: folderFileTitle(relativePath) || file.name, state: "failed", message: skipMessage });
        continue;
      }
      queued.push({
        file,
        title: folderFileTitle(relativePath) || file.name.replace(/\.[^.]+$/, ""),
        state: "waiting",
      });
    }
    if (queued.every((item) => item.state === "failed")) {
      setError("No supported files in that folder. Upload .md, .txt or .pdf files.");
      return;
    }
    void runFolderQueue(queued);
  }

  const folderDone =
    !folderBusy && folderQueue !== null && folderQueue.length > 0;

  return (
    <Dialog ariaLabel="Upload document" maxWidth="max-w-lg" onClose={requestClose}>
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Upload document</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Upload a Markdown, text or PDF file, or paste text with { " " }
            <code className="font-mono">## Heading</code> lines.
          </p>
        </div>
        <button
          aria-label="Close"
          className="icon-btn size-8 shrink-0"
          onClick={requestClose}
          type="button"
        >
          <CloseIcon className="size-5" />
        </button>
      </div>

      {folderQueue !== null ? (
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] font-medium text-ink-muted">
              {folderBusy
                ? `Uploading ${folderQueue.filter((item) => item.state === "added" || item.state === "failed").length + 1 > folderQueue.length ? folderQueue.length : folderQueue.filter((item) => item.state !== "waiting").length + 1} of ${folderQueue.length}`
                : `Finished: ${folderQueue.filter((item) => item.state === "added").length} added, ${folderQueue.filter((item) => item.state === "failed").length} not uploaded`}
            </p>
            <ul className="max-h-64 overflow-y-auto rounded-xl border border-border bg-surface">
              {folderQueue.map((item, index) => (
                <li
                  className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0"
                  key={`${item.title}:${index}`}
                >
                  <span className="min-w-0 truncate text-sm text-ink">{item.title}</span>
                  <span
                    className={[
                      "shrink-0 text-xs font-medium",
                      item.state === "added"
                        ? "text-success"
                        : item.state === "failed"
                          ? "text-danger"
                          : "text-ink-faint",
                    ].join(" ")}
                  >
                    {item.state === "added"
                      ? "Added"
                      : item.state === "uploading"
                        ? "Uploading"
                        : item.state === "failed"
                          ? item.message ?? "Failed"
                          : "Waiting"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {folderDone ? (
            <div className="flex justify-end">
              <button
                className="btn btn-primary h-10 px-4 text-sm"
                onClick={requestClose}
                type="button"
              >
                Done
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <form action={handle} className="flex flex-col gap-4 px-5 py-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong bg-canvas px-4 py-6 text-center transition hover:border-accent hover:bg-accent-soft">
            <input
              accept=".md,.markdown,.txt,.pdf"
              className="sr-only"
              name="file"
              onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
              type="file"
            />
            <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent-deep">
              <UploadIcon className="size-5" />
            </span>
            <span className="break-words text-sm font-medium text-ink">
              {fileName ?? "Click to upload a file"}
            </span>
            <span className="text-xs text-ink-faint">
              Markdown, text or PDF, up to 10 MB
            </span>
          </label>

          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong bg-canvas px-4 py-4 text-center transition hover:border-accent hover:bg-accent-soft">
            <input
              className="sr-only"
              multiple
              onChange={(event) => queueFolder(event.target.files)}
              type="file"
              { ...{ webkitdirectory: "", directory: "" } }
            />
            <span className="text-sm font-medium text-ink">Upload a folder</span>
            <span className="text-xs text-ink-faint">
              Every .md, .txt or .pdf file inside is indexed
            </span>
          </label>

          <div className="flex items-center gap-3 text-xs font-medium text-ink-faint">
            <span className="h-px flex-1 bg-border" />
            or paste manually
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-muted" htmlFor="doc-title">
              Title
            </label>
            <input
              className="field-input px-3 py-2.5 text-sm text-ink outline-none"
              id="doc-title"
              name="title"
              placeholder="Warranty policy"
              type="text"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-muted" htmlFor="doc-body">
              Document text
            </label>
            <textarea
              className="field-input min-h-40 resize-y px-3 py-2.5 text-sm leading-6 text-ink outline-none"
              id="doc-body"
              name="body"
              placeholder={"## Coverage\nProducts are covered for 12 months.\n\n## Exclusions\nMisuse is not covered."}
            />
          </div>
          {error ? (
            <p className="text-[13px] font-medium text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              className="btn btn-secondary h-10 px-4 text-sm"
              onClick={requestClose}
              type="button"
            >
              Cancel
            </button>
            <AddDocumentSubmit />
          </div>
        </form>
      )}
    </Dialog>
  );
}

function AddDocumentSubmit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary h-10 px-4 text-sm" disabled={pending} type="submit">
      <PlusIcon className="size-4" />
      Upload document
    </button>
  );
}

function getDocumentStatus({
  chunkCount,
  embeddingStorageStatus,
  isEmbedding,
  totalChunkCount,
}: {
  chunkCount: number;
  embeddingStorageStatus: EmbeddingStorageStatus;
  isEmbedding: boolean;
  totalChunkCount: number;
}): DocumentStatus {
  if (isEmbedding || embeddingStorageStatus.lastRunStatus === "running") {
    return "processing";
  }
  if (embeddingStorageStatus.corpusStatus === "ready") {
    return "ready";
  }
  if (embeddingStorageStatus.lastRunStatus === "failed") {
    return "failed";
  }
  if (
    chunkCount === 0 ||
    embeddingStorageStatus.embeddedChunks === 0 ||
    embeddingStorageStatus.lastRunStatus === "not_started"
  ) {
    return "needs_indexing";
  }
  if (
    embeddingStorageStatus.lastRunStatus === "succeeded" &&
    embeddingStorageStatus.embeddedChunks >= totalChunkCount
  ) {
    return "active";
  }
  return "needs_indexing";
}

function ingestionNote(status: DocumentStatus) {
  if (status === "active") {
    return "All chunks are indexed and available to retrieval.";
  }
  if (status === "processing") {
    return "The current indexing run is in progress. This document is not ready for retrieval.";
  }
  if (status === "ready") {
    return "All chunks are indexed in a draft. Promote it to make retrieval use this version.";
  }
  if (status === "failed") {
    return "The latest indexing run failed. This document is not ready for retrieval.";
  }
  return "Indexing has not started for this document. Its chunks are not available to retrieval.";
}

function chunkStateLabel(status: DocumentStatus, chunkCount: number) {
  const count = `${chunkCount} ${chunkCount === 1 ? "chunk" : "chunks"}`;
  if (status === "active") {
    return `${chunkCount} ${chunkCount === 1 ? "indexed chunk" : "indexed chunks"}`;
  }
  if (status === "processing") {
    return `${count} processing`;
  }
  if (status === "ready") {
    return `${count} ready to promote`;
  }
  if (status === "failed") {
    return `${count} not indexed`;
  }
  return `${count} waiting for indexing`;
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
