import {
  Table,
  TableCell,
  TableHead,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/table";
import type { GroupRowView } from "@/lib/contracts/admin-manage-view";

const COLUMNS = "minmax(0,1fr) 110px 90px 150px 260px";

export function GroupsTable({ groups }: { groups: GroupRowView[] }) {
  return (
    <Table columns={COLUMNS} label="Groups">
      <TableHeaderRow>
        <TableHead>Group</TableHead>
        <TableHead>Type</TableHead>
        <TableHead>
          <span className="block text-right">People</span>
        </TableHead>
        <TableHead>Adds documents</TableHead>
        <TableHead>Rule</TableHead>
      </TableHeaderRow>
      {groups.map((group) => (
        <TableRow key={group.id}>
          <div className="truncate text-[13px] font-medium" role="cell" title={group.name}>
            {group.name}
          </div>
          <TableCell>{group.type}</TableCell>
          <div className="text-right text-[13px]" role="cell">
            {group.people}
          </div>
          <TableCell>{group.addsDocuments}</TableCell>
          <div className="truncate font-mono text-xs text-ink-muted" role="cell" title={group.rule}>
            {group.rule}
          </div>
        </TableRow>
      ))}
    </Table>
  );
}
