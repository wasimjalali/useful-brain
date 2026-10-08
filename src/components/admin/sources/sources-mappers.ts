import type {
  ActiveGenerationView,
  DraftGenerationView,
  SourceCounts,
  SourceFilter,
  SourceRowView,
} from "@/lib/contracts/admin-manage-view";
import type { SourcesDocument, SourcesDraft, SourcesResponse } from "@/lib/contracts/sources";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function label(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced === "hr" ? "HR" : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function readersLabel(readers: SourcesDocument["readers"]): string {
  if (readers.kind === "everyone") return "Everyone";
  if (readers.kind === "private") return "Private";
  return readers.names.map(label).join(", ");
}

/** Closed check codes (src/lib/ingest/draft-checks.ts decideChecks) to plain language. */
const CHECK_FAILURES: Record<string, string> = {
  RECONCILIATION_FAILED: "The search index doesn't match the draft.",
  ACL_LEAK: "A document would be readable by someone who shouldn't see it.",
  ACL_PARITY: "Reader rules don't match for an uploaded document.",
  RETRIEVAL_UNAVAILABLE: "Search couldn't be tested. Try again in a few minutes.",
  RECALL_BELOW_FLOOR: "Search quality dropped below the accepted floor.",
  NOTHING_ADDED: "No file in this draft could be added.",
};

function mapDraft(draft: SourcesDraft): DraftGenerationView {
  if (draft.state === "building" || draft.state === "checking") {
    return {
      state: "building",
      id: draft.id,
      embeddedChunks: draft.embeddedChunks,
      totalChunks: draft.totalChunks,
      documents: draft.documents,
      failed: draft.failedFiles,
    };
  }
  if (draft.state === "checks_passed") {
    const parts = [
      `${draft.documents} ${draft.documents === 1 ? "document" : "documents"}, ${draft.totalChunks} chunks`,
    ];
    if (draft.checks) {
      if (draft.checks.reconciled) parts.push("reconciled");
      parts.push(`ACL leaks ${draft.checks.aclLeaks}`);
      if (draft.checks.liveRecall !== null) parts.push(`live recall ${draft.checks.liveRecall}`);
    }
    return { state: "checks_passed", id: draft.id, summary: parts.join(" · ") };
  }
  if (draft.state === "checks_paused") {
    return { state: "paused", id: draft.id, summary: "Checks are paused for today. They resume tomorrow." };
  }
  if (draft.state === "failed") {
    return { state: "checks_failed", id: draft.id, summary: "The draft couldn't be built." };
  }
  const code = draft.checks?.errorCode ?? "";
  return { state: "checks_failed", id: draft.id, summary: CHECK_FAILURES[code] ?? "The checks didn't pass." };
}

function mapRow(document: SourcesDocument): SourceRowView {
  const isPrivate = document.readers.kind === "private";
  return {
    id: document.id,
    title: isPrivate ? null : document.title,
    fileName: isPrivate ? null : document.fileName || null,
    errorMessage: document.errorMessage ?? null,
    department: document.department ? label(document.department) : "None",
    readers: readersLabel(document.readers),
    chunks: document.status === "failed" ? null : document.chunks,
    updatedLabel: formatDate(document.updatedAt),
    status: document.status,
  };
}

export type SourcesViewModel = {
  active: ActiveGenerationView;
  draft: DraftGenerationView | null;
  rows: SourceRowView[];
  counts: SourceCounts;
  documentCount: number;
};

export function mapSources(response: SourcesResponse): SourcesViewModel {
  const { active, draft, documents } = response;
  const rows = documents.map(mapRow);
  const count = (status: SourceRowView["status"]) => rows.filter((row) => row.status === status).length;
  return {
    active: active
      ? {
          id: active.id,
          promotedLabel: formatDate(active.promotedAt),
          documents: active.documents,
          chunks: active.chunks,
          retrieval: active.retrieval === "hybrid" ? "Hybrid" : "Keyword",
        }
      : { id: "None", promotedLabel: "Never", documents: 0, chunks: 0, retrieval: "None" },
    draft: draft ? mapDraft(draft) : null,
    rows,
    counts: { all: rows.length, active: count("active"), draft: count("draft"), failed: count("failed") },
    documentCount: rows.length - count("failed"),
  };
}

export function filterRows(rows: SourceRowView[], filter: SourceFilter, query: string): SourceRowView[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== "all" && row.status !== filter) return false;
    if (!needle) return true;
    return (
      (row.title?.toLowerCase().includes(needle) ?? false) ||
      (row.fileName?.toLowerCase().includes(needle) ?? false)
    );
  });
}
