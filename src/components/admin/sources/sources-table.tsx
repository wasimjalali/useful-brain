import { StatusPill } from "@/components/ui/status";
import {
  Table,
  TableCell,
  TableHead,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/table";
import type { SourceRowView, SourceStatus } from "@/lib/contracts/admin-manage-view";

const COLUMNS = "minmax(0,1fr) 112px 200px 64px 104px 84px";

const STATUS_LABEL: Record<SourceStatus, string> = {
  active: "Active",
  draft: "Draft",
  failed: "Failed",
};

function DocumentCell({ row }: { row: SourceRowView }) {
  const isPrivate = row.title === null;
  const title = isPrivate ? "Private document" : row.title;
  // A private document's file name would reveal its title, so it is never shown.
  const sub = isPrivate ? null : row.errorMessage ?? row.fileName;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-1.5" role="cell">
      <span
        className={`truncate text-[13px] leading-[18px] font-medium ${isPrivate ? "text-ink-muted" : ""}`}
        title={isPrivate ? undefined : (title ?? undefined)}
      >
        {title}
      </span>
      {sub ? (
        <span
          className={`truncate font-mono text-[11px] leading-4 ${row.errorMessage ? "text-danger" : "text-ink-faint-text"}`}
          title={sub}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}

export function SourcesTable({ rows }: { rows: SourceRowView[] }) {
  return (
    <Table columns={COLUMNS} label="Documents">
      <TableHeaderRow>
        <TableHead>Document</TableHead>
        <TableHead>Department</TableHead>
        <TableHead>Who can read</TableHead>
        <TableHead>
          <span className="block text-right">Chunks</span>
        </TableHead>
        <TableHead>Updated</TableHead>
        <TableHead>Status</TableHead>
      </TableHeaderRow>
      {rows.map((row) => (
        <TableRow key={row.id} tall>
          <DocumentCell row={row} />
          <TableCell>{row.department}</TableCell>
          <TableCell>{row.readers}</TableCell>
          <div className="text-right text-[13px]" role="cell">
            {row.chunks ?? 0}
          </div>
          <TableCell>{row.updatedLabel}</TableCell>
          <div role="cell">
            <StatusPill tone={row.status}>{STATUS_LABEL[row.status]}</StatusPill>
          </div>
        </TableRow>
      ))}
    </Table>
  );
}
