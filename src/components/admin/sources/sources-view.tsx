"use client";

import { RefreshCwIcon, UploadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/field";
import { FilterChip } from "@/components/ui/filter-chip";
import type {
  ActiveGenerationView,
  DraftGenerationView,
  SourceCounts,
  SourceFilter,
  SourceRowView,
} from "@/lib/contracts/admin-manage-view";

import { GenerationCard } from "./generation-card";
import { SourcesTable } from "./sources-table";

const FILTERS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "failed", label: "Failed" },
];

export function SourcesView({
  active,
  draft,
  rows,
  counts,
  filter,
  query,
  documentCount,
  busy,
  onFilterChange,
  onQueryChange,
  onReindex,
  onUpload,
  onPromote,
  onDiscard,
}: {
  active: ActiveGenerationView;
  draft: DraftGenerationView | null;
  /** Rows already filtered by status and query. */
  rows: SourceRowView[];
  counts: SourceCounts;
  filter: SourceFilter;
  query: string;
  documentCount: number;
  busy?: boolean;
  onFilterChange: (filter: SourceFilter) => void;
  onQueryChange: (query: string) => void;
  onReindex: () => void;
  onUpload: () => void;
  onPromote: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-col">
      <header className="flex items-end gap-2 px-12 pt-9">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.02em]">Sources</h1>
          <p className="mt-1 text-[13px] leading-5 text-ink-muted">
            {documentCount} {documentCount === 1 ? "document" : "documents"} · readers only see the active generation
          </p>
        </div>
        <div className="flex shrink-0 gap-2 whitespace-nowrap">
          <Button icon={<RefreshCwIcon className="size-[15px]" />} onClick={onReindex} size={36} variant="secondary">
            Re-index
          </Button>
          <Button icon={<UploadIcon className="size-[15px]" />} onClick={onUpload} size={36} variant="primary">
            Upload documents
          </Button>
        </div>
      </header>
      <div className="mx-12 mt-6">
        <GenerationCard active={active} busy={busy} draft={draft} onDiscard={onDiscard} onPromote={onPromote} />
      </div>
      <div className="flex flex-wrap items-center gap-3 px-12 pt-7">
        <SearchField
          label="Search documents and file names"
          onChange={onQueryChange}
          placeholder="Search documents and file names"
          value={query}
          width={300}
        />
        <div className="flex gap-1.5">
          {FILTERS.map((item) => (
            <FilterChip
              count={counts[item.value]}
              key={item.value}
              onClick={() => onFilterChange(item.value)}
              pressed={filter === item.value}
            >
              {item.label}
            </FilterChip>
          ))}
        </div>
      </div>
      <div className="px-9 pt-3.5 pb-6">
        <SourcesTable rows={rows} />
      </div>
    </div>
  );
}
