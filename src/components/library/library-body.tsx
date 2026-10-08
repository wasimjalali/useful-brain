"use client";

import { CheckIcon, FileTextIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { SearchField } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableCell,
  TableHead,
  TableHeaderRow,
  TableRow,
  TableRowActions,
} from "@/components/ui/table";
import type { LibraryChipView, LibraryRowView } from "@/lib/contracts/library-view";

const COLUMNS = "minmax(0,2.4fr) minmax(0,1fr) minmax(0,1.6fr) 140px";
const SKELETON_WIDTHS = [220, 300, 180, 260, 340, 200, 240, 160, 310, 230, 190, 270];

export function LibraryBody({
  rows,
  chips,
  department,
  query,
  loading,
  onQueryChange,
  onDepartmentChange,
  onAsk,
  onRequest,
  requested = false,
  requestError = false,
}: {
  rows: LibraryRowView[];
  chips: LibraryChipView[];
  department: string;
  query: string;
  loading: boolean;
  onQueryChange: (value: string) => void;
  onDepartmentChange: (department: string) => void;
  onAsk: (documentId: string) => void;
  /** Omit when no backend can take a free-text request. */
  onRequest?: (query: string) => void;
  /** The current query was already requested. */
  requested?: boolean;
  /** The last request failed. */
  requestError?: boolean;
}) {
  const empty = !loading && rows.length === 0;
  const hasQuery = query.trim() !== "";
  return (
    <div className="flex flex-col gap-4 px-12 pb-8 pt-5">
      <SearchField
        label="Search titles and sections"
        onChange={onQueryChange}
        placeholder="Search titles and sections"
        value={query}
        width={340}
      />
      <div className="flex flex-wrap gap-2">
        {chips
          .filter((chip) => chip.count > 0 || chip.label === department)
          .map((chip) => (
            <FilterChip
              count={chip.count}
              key={chip.label}
              onClick={() => onDepartmentChange(chip.label)}
              pressed={chip.label === department}
            >
              {chip.label}
            </FilterChip>
          ))}
      </div>
      {empty ? (
        <div className="flex flex-col items-start gap-1 py-10">
          <p className="text-[15px] font-medium text-ink">
            {hasQuery ? `Nothing you can read matches “${query}”` : "No documents you can read yet"}
          </p>
          {hasQuery ? (
            <p className="text-[13px] text-ink-muted">
              It may not exist yet, or it may be restricted to another team.
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            {!hasQuery ? null : onRequest && requested ? (
              <span
                aria-disabled="true"
                className="inline-flex h-[34px] items-center gap-[7px] rounded-[10px] bg-sunken pl-3 pr-3.5 text-[13px] font-medium text-ink-muted"
              >
                <CheckIcon aria-hidden className="text-success" height={15} strokeWidth={2} width={15} />
                Requested
              </span>
            ) : onRequest ? (
              <Button onClick={() => onRequest(query)} variant="secondary">
                Request this document
              </Button>
            ) : null}
            {hasQuery ? (
              <Button
                onClick={() => {
                  onQueryChange("");
                  onDepartmentChange("All");
                }}
                variant="ghost"
              >
                Clear search
              </Button>
            ) : null}
          </div>
          {requestError ? (
            <p className="mt-2 text-[12px] text-danger" role="alert">
              Couldn&apos;t send the request. Try again.
            </p>
          ) : null}
        </div>
      ) : (
        <Table columns={COLUMNS} label="Documents">
          <TableHeaderRow>
            <TableHead>Document</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Who can read</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableHeaderRow>
          {loading ? (
            <div aria-busy="true">
              <span className="sr-only">Loading documents</span>
              {SKELETON_WIDTHS.map((width, index) => (
                <div className="ub-tr" data-skeleton-row key={index}>
                  <Skeleton height={10} width={width} />
                </div>
              ))}
            </div>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
                    <span className="truncate text-[14px] font-medium">{row.title}</span>
                  </span>
                </TableCell>
                <TableCell>{row.department}</TableCell>
                <TableCell>{row.readers}</TableCell>
                <TableRowActions>
                  <Button onClick={() => onAsk(row.id)} size={32} variant="secondary">
                    Ask about this
                  </Button>
                </TableRowActions>
              </TableRow>
            ))
          )}
        </Table>
      )}
    </div>
  );
}
